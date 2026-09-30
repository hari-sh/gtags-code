const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fssync = require('fs');
const fs = require('fs').promises;

class GtagsProvider {
    constructor(gtagsCmd = 'gtags', globalCmd = 'global') {
        this.gtagsCmd = gtagsCmd;
        this.globalCmd = globalCmd;
        this.functionCache = new Map();
        this.callGraphCache = new Map();
    }

    clearCaches() {
        this.functionCache.clear();
        this.callGraphCache.clear();
    }

    async generateTags(workspaceRoot, files, channel) {
        channel.appendLine('Running Gtags...');
        const p = spawn(this.gtagsCmd, ['-v', '-f', '-'], { cwd: workspaceRoot });

        let processed = 0;
        const rl = readline.createInterface({
            input: p.stderr,
            crlfDelay: Infinity
        });
        rl.on('line', (line) => {
            if (!line.trim()) {
                return;
            }
            processed++;
            if (processed % 500 === 0) {
                channel.appendLine(`${processed}/${files.length} files processed by gtags...`);
            }
            if (processed === files.length) {
                channel.appendLine(`${processed}/${files.length} files processed by gtags...`);
            }
        });

        for (const f of files) {
            p.stdin.write(f + '\n');
        }
        p.stdin.end();

        return new Promise((resolve, reject) => {
            p.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`gtags exited with code ${code}`));
                }
            });
        });
    }

    async streamSymbols(workspaceRoot, channel, onSymbol) {
        channel.appendLine('Indexing structure types and functions...');
        const child = spawn(this.globalCmd, ['-c'], { cwd: workspaceRoot });
        const rl = readline.createInterface({
            input: child.stdout,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            const tagName = line.trim();
            if (tagName) {
                await onSymbol(tagName);
            }
        }
    }

    async queryDefinitions(workspaceRoot, key) {
        if (!key || !key.trim()) return [];

        const streamGlobal = (args) => new Promise((resolve) => {
            const results = [];
            const proc = spawn(this.globalCmd, args, { cwd: workspaceRoot });
            const rl = readline.createInterface({
                input: proc.stdout,
                crlfDelay: Infinity
            });

            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;

                const parts = trimmed.split(/\s+/);
                if (parts.length >= 3) {
                    const tagName = parts[0];
                    const lineNo = parseInt(parts[1], 10);
                    const file = parts[2];
                    const code = parts.slice(3).join(' ');

                    if (file && !isNaN(lineNo)) {
                        const fullPath = path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
                        results.push({
                            tagName,
                            file: fullPath,
                            line: lineNo,
                            code
                        });
                    }
                }
            });

            proc.on('close', () => resolve(results));
            proc.on('error', (err) => {
                console.error(`gtags-code: Error spawning ${this.globalCmd}:`, err);
                resolve([]);
            });
        });

        let matches = await streamGlobal(['-xd', key.trim()]);
        if (matches.length === 0) {
            matches = await streamGlobal(['-x', key.trim()]);
        }
        return matches;
    }

    async queryReferences(workspaceRoot, symbol) {
        if (!symbol || !symbol.trim()) return { matches: [], target: '' };

        symbol = symbol.trim();
        const match = symbol.match(/((?:->|\.)(\w+))$/);
        let lastProperty, precedingPartWithDelimiter;
        if (match) {
            lastProperty = match[2];
            precedingPartWithDelimiter = symbol.substring(0, symbol.length - lastProperty.length);
        } else if (/^\w+$/.test(symbol)) {
            lastProperty = symbol;
            precedingPartWithDelimiter = '';
        } else {
            lastProperty = symbol;
            precedingPartWithDelimiter = '';
        }

        const target = precedingPartWithDelimiter ? (precedingPartWithDelimiter + lastProperty) : lastProperty;
        const seenLines = new Set();
        const results = [];

        const handleLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed || seenLines.has(trimmed)) return;
            seenLines.add(trimmed);

            if (precedingPartWithDelimiter && !trimmed.includes(precedingPartWithDelimiter)) {
                return;
            }

            const m = trimmed.match(/^([^:]+):(\d+):(.*)$/);
            if (m) {
                const [, file, lineNo, code] = m;
                const fullPath = path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
                results.push({
                    file: fullPath,
                    line: parseInt(lineNo, 10),
                    code: code.trim()
                });
            }
        };

        const streamGlobal = (args) => new Promise((resolve) => {
            const proc = spawn(this.globalCmd, args, { cwd: workspaceRoot });
            const rl = readline.createInterface({
                input: proc.stdout,
                crlfDelay: Infinity
            });
            rl.on('line', handleLine);
            proc.on('close', () => resolve());
            proc.on('error', (err) => {
                console.error(`gtags-code: Error spawning ${this.globalCmd}:`, err);
                resolve();
            });
        });

        await Promise.all([
            streamGlobal(['--result=grep', '-xs', lastProperty]),
            streamGlobal(['--result=grep', '-r', lastProperty])
        ]);

        return { matches: results, target };
    }

    async cleanWorkspace(workspaceRoot, channel) {
        channel.appendLine('Cleaning existing Tags DataBase...');
        const gtagsFiles = ['GTAGS', 'GRTAGS', 'GPATH'];
        for (const file of gtagsFiles) {
            const filePath = path.join(workspaceRoot, file);
            if (fssync.existsSync(filePath)) {
                await fs.rm(filePath, { force: true });
            }
        }
    }

    async getFunctionsInFile(workspaceRoot, file) {
        const tagPath = this.toWorkspacePath(workspaceRoot, file);
        const cacheKey = `${workspaceRoot}:${tagPath}`;
        if (this.functionCache.has(cacheKey)) {
            return this.functionCache.get(cacheKey);
        }

        const functionsPromise = (async () => {
            const tags = await this.runGlobal(['-xf', tagPath], {
                cwd: workspaceRoot,
                reflectionError: false
            });
            const functions = [];

            for (const tag of tags) {
                if (!this._isFunctionTag(tag)) continue;
                const range = this.findFunctionRange(workspaceRoot, tag.file, tag.line);
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
        const cacheKey = `${workspaceRoot}:${symbol}`;
        if (this.callGraphCache.has(cacheKey)) {
            return this.callGraphCache.get(cacheKey);
        }

        const callersPromise = this.isCallableReference(workspaceRoot, symbol);
        this.callGraphCache.set(cacheKey, callersPromise);
        try {
            return await callersPromise;
        } catch (error) {
            this.callGraphCache.delete(cacheKey);
            throw error;
        }
    }

    async isCallableReference(workspaceRoot, symbol) {
        const callers = await this.runGlobal(['-rx', symbol], {
            cwd: workspaceRoot,
            reflectionError: false
        });
        const escapedSymbol = this.escapeRegExp(symbol);
        const callRegex = new RegExp(`(?:^|[^\\w~])${escapedSymbol}\\s*\\(`);
        return callers.filter(tag => callRegex.test(tag.source || ''));
    }

    async isFunctionSymbol(workspaceRoot, symbol) {
        if (!symbol || !symbol.trim()) return false;
        const tags = await this.runGlobal(['-x', symbol.trim()], {
            cwd: workspaceRoot,
            reflectionError: false
        });

        for (const tag of tags) {
            if (!this._isFunctionTag(tag)) continue;
            const functions = await this.getFunctionsInFile(workspaceRoot, tag.file);
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
        return new RegExp(`(?:^|[^\\w~])${this.escapeRegExp(tag.symbol)}\\s*\\(`).test(source);
    }

    findFunctionRange(workspaceRoot, file, line) {
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
            const previous = this.stripLineComment(lines[signatureStartIndex - 1]).trim();
            if (!previous || /[;{}]/.test(previous) || previous.startsWith('#')) break;
            signatureStartIndex--;
        }

        let signature = '';
        let bodyStartIndex = -1;
        const scanEnd = Math.min(lines.length, startIndex + 80);
        for (let index = signatureStartIndex; index < scanEnd; index++) {
            signature += `${this.stripLineComment(lines[index])}\n`;
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
            const code = this.stripLineComment(lines[index]);
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

    stripLineComment(line) {
        return String(line).replace(/\/\/.*$/, '');
    }

    escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    toWorkspacePath(workspaceRoot, file) {
        if (!file) return file;
        if (path.isAbsolute(file)) {
            const relativePath = path.relative(workspaceRoot, file);
            return relativePath.startsWith('..') || path.isAbsolute(relativePath) ? file : relativePath;
        }

        const relativePath = path.relative(workspaceRoot, path.resolve(workspaceRoot, file));
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return relativePath;
        return file;
    }

    async runGlobal(args, options = {}) {
        const { cwd, reflectionError = true } = options;
        return new Promise((resolve, reject) => {
            const p = spawn(this.globalCmd, args, { cwd });
            let out = "";
            let err = "";

            p.stdout.on("data", d => (out += d.toString()));
            p.stderr.on("data", d => (err += d.toString()));

            p.on('error', error => {
                if (reflectionError === false) {
                    resolve([]);
                } else {
                    reject(error);
                }
            });

            p.on("close", code => {
                if (code !== 0) {
                    if (reflectionError === false) {
                        resolve([]);
                        return;
                    }
                    reject(err || `global ${args.join(" ")} failed`);
                    return;
                }
                const results = out.trim().split("\n").filter(Boolean).map(line => {
                    const parts = line.trim().split(/\s+/);
                    return {
                        symbol: parts[0],
                        line: Number(parts[1]),
                        file: parts[2],
                        source: parts.slice(3).join(" ")
                    };
                });
                resolve(results);
            });
        });
    }

    async checkDependencies() {
        const getVersionAsync = (cmd) => new Promise((resolve, reject) => {
            const child = spawn(cmd, ["--version"], { shell: true });
            let output = "";
            child.stdout.on("data", d => output += d);
            child.stderr.on("data", d => output += d);
            child.on("error", () => reject(new Error(`Please install ${cmd} or provide its path in settings.`)));
            child.on("close", (code) => {
                if (code === 0 || code === 1) resolve(output.trim());
                else reject(new Error(`Please install ${cmd} or provide its path in settings.`));
            });
        });
        
        await getVersionAsync(this.globalCmd);
        await getVersionAsync(this.gtagsCmd);
    }
}

module.exports = GtagsProvider;
