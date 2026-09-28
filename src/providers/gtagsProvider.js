const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fssync = require('fs');
const fs = require('fs').promises;

class GtagsProvider {
    constructor(gtagsCmd = 'gtags', globalCmd = 'global') {
        this.gtagsCmd = gtagsCmd;
        this.globalCmd = globalCmd;
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
        return this._runGlobalX(['-xf', file], workspaceRoot);
    }

    async getCallers(workspaceRoot, symbol) {
        return this._runGlobalX(['-rx', symbol], workspaceRoot);
    }

    async _runGlobalX(args, cwd) {
        return new Promise((resolve, reject) => {
            const p = spawn(this.globalCmd, args, { cwd });
            let out = "";
            let err = "";

            p.stdout.on("data", d => (out += d.toString()));
            p.stderr.on("data", d => (err += d.toString()));

            p.on("close", code => {
                if (code !== 0 && !out) {
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
