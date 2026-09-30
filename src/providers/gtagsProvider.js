const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fssync = require('fs');
const fs = require('fs').promises;
const HEADER_EXTENSIONS = ['.h', '.hpp', '.hh', '.hxx'];

class GtagsProvider {
    constructor(gtagsCmd = 'gtags', globalCmd = 'global') {
        this.gtagsCmd = gtagsCmd;
        this.globalCmd = globalCmd;
        this.functionCache = new Map();
        this.callGraphCache = new Map();
    }

    async clearCaches() {
        this.functionCache.clear();
        this.callGraphCache.clear();
    }

    get dependencies() {
        return [this.globalCmd, this.gtagsCmd];
    }

    async *generateTags(workspaceRoot, files) {
        yield 'Running Gtags...';
        const p = spawn(this.gtagsCmd, ['-v', '-f', '-'], { cwd: workspaceRoot });

        for (const f of files) {
            p.stdin.write(f + '\n');
        }
        p.stdin.end();

        let processed = 0;
        const rl = readline.createInterface({
            input: p.stderr,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            if (line.trim() && (++processed % 500 === 0 || processed === files.length)) {
                yield `${processed}/${files.length} files processed by gtags...`;
            }
        }
        await new Promise((resolve, reject) => {
            p.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`gtags exited with code ${code}`));
                }
            });
        });
    }

    async *_runGlobal(args, options = {}) {
        const { cwd, reflectionError = true } = options;
        const p = spawn(this.globalCmd, args, { cwd });
        const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity });
        let err = "";

        p.stderr.on("data", d => (err += d.toString()));

        const closePromise = new Promise((resolve, reject) => {
            p.on("error", error => {
                if (reflectionError) reject(error);
                else resolve();
            });
            p.on("close", code => {
                if (code !== 0 && reflectionError) reject(new Error(err || `global ${args.join(" ")} failed`));
                else resolve();
            });
        });

        try {
            for await (const line of rl) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 4) {
                    yield {
                        symbol: parts[0],
                        line: Number(parts[1]),
                        file: parts[2],
                        source: parts.slice(3).join(" ")
                    };
                }
            }
            await closePromise;
        } finally {
            p.kill();
        }
    }

    async *streamSymbols(workspaceRoot) {
        const child = spawn(this.globalCmd, ['-c'], { cwd: workspaceRoot });
        const rl = readline.createInterface({
            input: child.stdout,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            const tagName = line.trim();
            if (tagName) {
                yield tagName;
            }
        }
    }

    async *queryDefinitions(workspaceRoot, key) {
        if (!key || !key.trim()) return;

        for await (const tag of this.runGlobal(['-xd', key.trim()], {
            cwd: workspaceRoot,
            reflectionError: false
        })) {
            if (!tag.file || !Number.isFinite(tag.line)) continue;

            const fullPath = path.isAbsolute(tag.file) ? tag.file : path.join(workspaceRoot, tag.file);
            yield {
                tagName: tag.symbol,
                file: fullPath,
                line: tag.line,
                code: tag.source
            };
        }
    }

    async *queryReferences(workspaceRoot, symbol) {
        if (!symbol || !symbol.trim()) return;

        const target = symbol.trim();
        const seenLines = new Set();

        for await (const tag of this.runGlobal(['-rx', target], {
            cwd: workspaceRoot,
            reflectionError: false
        })) {
            const uniqueKey = `${tag.file}:${tag.line}:${tag.source}`;
            if (seenLines.has(uniqueKey)) continue;
            seenLines.add(uniqueKey);

            if (tag.file && Number.isFinite(tag.line)) {
                const fullPath = path.isAbsolute(tag.file) ? tag.file : path.join(workspaceRoot, tag.file);
                yield {
                    file: fullPath,
                    line: tag.line,
                    code: tag.source
                };
            }
        }
    }

    get workspaceFilesToRemove() {
        return ['GTAGS', 'GRTAGS', 'GPATH'];
    }

    async _getFunctionsInFile(workspaceRoot, file) {
        const tagPath = this._toWorkspacePath(workspaceRoot, file);
        const cacheKey = `${workspaceRoot}:${tagPath}`;
        if (this.functionCache.has(cacheKey)) {
            return this.functionCache.get(cacheKey);
        }

        const functionsPromise = (async () => {
            const functions = [];
            for await (const tag of this._runGlobal(['-xf', tagPath], {
                cwd: workspaceRoot,
                reflectionError: false
            })) {
                if (!this._isFunctionTag(tag)) continue;
                const range = this._findFunctionRange(workspaceRoot, tag.file, tag.line);
                if (range) functions.push({ ...tag, ...range });
            }

            return functions;
        })();

        this.functionCache.set(cacheKey, functionsPromise);
        try {
            return await functionsPromise;
        } catch (error) {
            this.functionCache.delete(cacheKey);
            throw error;
        }
    }

    async getCallers(workspaceRoot, symbol) {
        if (!await this._isFunctionSymbol(workspaceRoot, symbol)) {
            throw new Error(`${symbol.trim()} is not a function`);
        }

        const cacheKey = `${workspaceRoot}:${symbol}`;
        if (this.callGraphCache.has(cacheKey)) {
            return this.callGraphCache.get(cacheKey);
        }

        const callersPromise = this._getCallersUncached(workspaceRoot, symbol);

        this.callGraphCache.set(cacheKey, callersPromise);
        try {
            return await callersPromise;
        } catch (error) {
            this.callGraphCache.delete(cacheKey);
            throw error;
        }
    }

    async _getCallersUncached(workspaceRoot, symbol) {
        const callers = await this._isCallableReference(workspaceRoot, symbol);
        const sourceCallers = callers.filter(caller =>
            !HEADER_EXTENSIONS.some(extension => caller.file.endsWith(extension))
        );
        const enclosingFunctions = await Promise.all(
            sourceCallers.map(caller => this._getEnclosingCaller(workspaceRoot, caller))
        );

        return this._filterUniqueCallers(enclosingFunctions.filter(Boolean), symbol);
    }

    async _getEnclosingCaller(workspaceRoot, caller) {
        const functions = await this._getFunctionsInFile(workspaceRoot, caller.file);
        const enclosing = functions
            .filter(func => func.startLine <= caller.line && func.endLine >= caller.line)
            .sort((left, right) =>
                (left.endLine - left.startLine) - (right.endLine - right.startLine)
            )[0];

        return enclosing
            ? { name: enclosing.symbol, file: caller.file, line: enclosing.line }
            : null;
    }

    _filterUniqueCallers(callers, symbol) {
        const withoutSelf = callers.filter(caller => caller.name !== symbol);
        const nameCounts = new Map();

        for (const caller of withoutSelf) {
            nameCounts.set(caller.name, (nameCounts.get(caller.name) || 0) + 1);
        }

        return withoutSelf.filter(caller => nameCounts.get(caller.name) === 1);
    }

    async _isCallableReference(workspaceRoot, symbol) {
        const escapedSymbol = this._escapeRegExp(symbol);
        const callRegex = new RegExp(`(?:^|[^\\w~])${escapedSymbol}\\s*\\(`);
        const callers = [];
        
        for await (const tag of this._runGlobal(['-rx', symbol], {
            cwd: workspaceRoot,
            reflectionError: false
        })) {
            if (callRegex.test(tag.source || '')) {
                callers.push(tag);
            }
        }
        
        return callers;
    }

    async _isFunctionSymbol(workspaceRoot, symbol) {
        if (!symbol || !symbol.trim()) return false;

        for await (const tag of this._runGlobal(['-x', symbol.trim()], {
            cwd: workspaceRoot,
            reflectionError: false
        })) {
            if (!this._isFunctionTag(tag)) continue;
            const functions = await this._getFunctionsInFile(workspaceRoot, tag.file);
            if (functions.some(func => func.symbol === symbol.trim())) return true;
        }

        return false;
    }

    _isFunctionTag(tag) {
        if (!tag || !tag.symbol || !Number.isFinite(tag.line)) return false;
        const source = (tag.source || '').trim();
        if (/^(?:#\s*define|typedef\b|using\b|class\b|struct\b|enum\b|namespace\b)/.test(source)) {
            return false;
        }
        return new RegExp(`(?:^|[^\\w~])${this._escapeRegExp(tag.symbol)}\\s*\\(`).test(source);
    }

    _findFunctionRange(workspaceRoot, file, line) {
        const fullPath = path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
        let lines;
        try {
            lines = fssync.readFileSync(fullPath, 'utf8').split(/\r?\n/);
        } catch {
            return null;
        }

        const startIndex = Math.max(0, Number(line) - 1);
        let signatureStartIndex = startIndex;
        while (signatureStartIndex > 0) {
            const previous = this._stripLineComment(lines[signatureStartIndex - 1]).trim();
            if (!previous || /[;{}]/.test(previous) || previous.startsWith('#')) break;
            signatureStartIndex--;
        }

        let signature = '';
        let bodyStartIndex = -1;
        const scanEnd = Math.min(lines.length, startIndex + 80);
        for (let index = signatureStartIndex; index < scanEnd; index++) {
            signature += `${this._stripLineComment(lines[index])}\n`;
            const semicolonIndex = signature.indexOf(';');
            const braceIndex = signature.indexOf('{');
            if (semicolonIndex !== -1 && (braceIndex === -1 || semicolonIndex < braceIndex)) {
                return null;
            }
            if (braceIndex !== -1) {
                bodyStartIndex = index;
                break;
            }
        }
        if (bodyStartIndex === -1) return null;

        let depth = 0;
        let enteredBody = false;
        for (let index = bodyStartIndex; index < lines.length; index++) {
            const code = this._stripLineComment(lines[index]);
            for (const character of code) {
                if (character === '{') {
                    depth++;
                    enteredBody = true;
                } else if (character === '}') {
                    depth--;
                    if (enteredBody && depth === 0) {
                        return {
                            startLine: signatureStartIndex + 1,
                            bodyStartLine: bodyStartIndex + 1,
                            endLine: index + 1
                        };
                    }
                }
            }
        }

        return null;
    }

    _stripLineComment(line) {
        return String(line).replace(/\/\/.*$/, '');
    }

    _escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _toWorkspacePath(workspaceRoot, file) {
        if (!file) return file;
        if (path.isAbsolute(file)) {
            const relativePath = path.relative(workspaceRoot, file);
            return relativePath.startsWith('..') || path.isAbsolute(relativePath) ? file : relativePath;
        }

        const relativePath = path.relative(workspaceRoot, path.resolve(workspaceRoot, file));
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return relativePath;
        return file;
    }


}

module.exports = GtagsProvider;
