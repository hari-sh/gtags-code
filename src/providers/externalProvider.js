const cp = require('child_process');
const readline = require('readline');
const vscode = require('vscode');

class ExternalProvider {
    constructor(options = {}) {
        this.command = options.command;
        this.indexCommand = options.indexCommand;
        this.timeout = options.timeout || 5000;
        
        this.startPromise = null;
        this.pendingRequests = new Map();
        this.nextMessageId = 1;
        this.process = null;
        
        this.environment = Object.assign({}, process.env);
    }

    async clearCaches() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.startPromise = null;
    }

    async _ensureStarted(workspaceRoot) {
        if (this.startPromise) return this.startPromise;
        this.startPromise = this._startWorkspaceProcess(workspaceRoot);
        return this.startPromise;
    }

    async _startWorkspaceProcess(workspaceRoot) {
        if (!this.command || !this.command.length) {
            throw new Error('Configure gtags-code.externalCommand before using the external engine.');
        }

        const args = this.command.slice(1).map(arg => arg.replace('${workspaceFolder}', workspaceRoot));
        const cmd = this.command[0].replace('${workspaceFolder}', workspaceRoot);

        this.process = cp.spawn(cmd, args, {
            cwd: workspaceRoot,
            env: this.environment
        });

        this.process.on('error', (err) => {
            vscode.window.showErrorMessage(`External engine failed to start: ${err.message}`);
        });

        const rl = readline.createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const message = JSON.parse(line);
                this._handleMessage(message);
            } catch (err) {
                // Ignore parse errors from stdout
            }
        });

        this.process.on('exit', (code) => {
            this.process = null;
            this.startPromise = null;
            for (const [, request] of this.pendingRequests) {
                request.reject(new Error(`External engine process exited with code ${code}`));
            }
            this.pendingRequests.clear();
        });

        // Initialize if required by the engine (can be adapted as needed)
    }

    _handleMessage(message) {
        if (message.id && this.pendingRequests.has(message.id)) {
            const request = this.pendingRequests.get(message.id);
            if (message.error) {
                request.reject(new Error(message.error.message || 'Unknown error'));
            } else {
                request.resolve(message.result);
            }
            this.pendingRequests.delete(message.id);
        }
    }

    async request(workspaceRoot, method, params) {
        await this._ensureStarted(workspaceRoot);

        if (!this.process) {
            throw new Error('External engine is not running');
        }

        const id = this.nextMessageId++;
        const message = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        const promise = new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`External engine request timeout for method: ${method}`));
            }, this.timeout);

            this.pendingRequests.set(id, { resolve, reject, timeoutId });
        });

        this.process.stdin.write(JSON.stringify(message) + '\n');
        return promise;
    }

    async *generateTags(workspaceRoot, files) {
        if (!this.indexCommand || !this.indexCommand.length) {
            return;
        }

        const args = this.indexCommand.slice(1).map(arg => arg.replace('${workspaceFolder}', workspaceRoot));
        const cmd = this.indexCommand[0].replace('${workspaceFolder}', workspaceRoot);

        const proc = cp.spawn(cmd, args, {
            cwd: workspaceRoot,
            env: this.environment
        });

        await new Promise((resolve, reject) => {
            proc.on('exit', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`External indexing process exited with code ${code}`));
            });
            proc.on('error', reject);
        });
        
        yield 'Tags DataBase created successfully.';
    }

    async *streamSymbols(workspaceRoot) {
        const response = await this.request(workspaceRoot, 'search_components', {});
        if (response && Array.isArray(response.items)) {
            for (const item of response.items) {
                yield item;
            }
        }
    }

    async *queryDefinitions(workspaceRoot, key) {
        const response = await this.request(workspaceRoot, 'query_definitions', { key });
        if (response && Array.isArray(response.items)) {
            for (const item of response.items) {
                yield item;
            }
        }
    }

    async *queryReferences(workspaceRoot, symbol) {
        const response = await this.request(workspaceRoot, 'query_references', { symbol });
        if (response && Array.isArray(response.items)) {
            for (const item of response.items) {
                yield item;
            }
        }
    }

    async getCallers(workspaceRoot, symbol) {
        const response = await this.request(workspaceRoot, 'get_callers', { symbol });
        if (response && Array.isArray(response.items)) {
            return response.items;
        }
        return [];
    }
}

module.exports = { ExternalProvider };
