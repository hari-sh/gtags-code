const cp = require('child_process');
const readline = require('readline');
const vscode = require('vscode');
const path = require('path');

class ExternalProvider {
    constructor(options = {}) {
        const command = this._normalizeCommand(options.command, options.args);
        const indexCommand = this._normalizeCommand(options.indexCommand, options.indexArgs);
        
        this.command = command.executable;
        this.args = command.args;
        this.indexCommand = indexCommand.executable;
        this.indexArgs = indexCommand.args;
        this.timeout = options.timeout || 5000;
        this.environment = Object.assign({}, process.env, options.env || {});
        
        this.startPromise = null;
        this.pendingRequests = new Map();
        this.nextMessageId = 1;
        this.process = null;
        this.protocol = null;
        this.tools = [];
    }

    _normalizeCommand(command, args) {
        if (Array.isArray(command)) {
            return {
                executable: command[0] || '',
                args: [...command.slice(1), ...(Array.isArray(args) ? args : [])]
            };
        }
        return {
            executable: command || '',
            args: Array.isArray(args) ? args : []
        };
    }

    async clearCaches() {
        this._stopProcess(new Error('Cache cleared'));
    }

    _stopProcess(error) {
        const processToStop = this.process;
        this.process = null;
        this.workspaceRoot = null;
        if (processToStop) processToStop.kill();
        for (const [, request] of this.pendingRequests) {
            clearTimeout(request.timeoutId);
            request.reject(error);
        }
        this.pendingRequests.clear();
        this.protocol = null;
        this.tools = [];
        this.startPromise = null;
    }

    async _ensureStarted(workspaceRoot) {
        if (this.process && this.workspaceRoot !== workspaceRoot) {
            await this.clearCaches();
        }
        if (this.startPromise) return this.startPromise;
        this.startPromise = this._startWorkspaceProcess(workspaceRoot).catch(error => {
            this.startPromise = null;
            throw error;
        });
        return this.startPromise;
    }

    async _startWorkspaceProcess(workspaceRoot) {
        if (!this.command || !this.command.length) {
            throw new Error('Configure gtags-code.externalCommand before using the external engine.');
        }

        const args = this.args.map(arg => arg.replace('${workspaceFolder}', workspaceRoot));
        const cmd = this.command.replace('${workspaceFolder}', workspaceRoot);

        const child = cp.spawn(cmd, args, {
            cwd: workspaceRoot,
            env: this.environment,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.process = child;
        this.workspaceRoot = workspaceRoot;

        child.on('error', (err) => {
            if (vscode && vscode.window) vscode.window.showErrorMessage(`External engine failed to start: ${err.message}`);
            this._stopProcess(err);
        });

        child.stderr.on('data', data => {
            const message = data.toString().trim();
            if (message) console.error(`gtags-code external engine: ${message}`);
        });

        const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

        rl.on('line', line => {
            if (!line.trim()) return;
            try {
                this._handleMessage(JSON.parse(line));
            } catch (_) {
                console.error("gtags-code: Ignoring non-JSON external engine output:", line);
            }
        });

        child.on('exit', code => {
            if (this.process !== child) return;
            this._stopProcess(new Error(`External engine process exited with code ${code}`));
        });
        
        this.protocol = null;
        this.tools = [];
        
        try {
            const initialized = await this.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'gtags-code', version: '0.1.0' }
            });
            
            if (initialized && initialized.capabilities) {
                this.protocol = 'mcp';
                this._sendNotification('notifications/initialized', {});
                const listed = await this.sendRequest('tools/list', {});
                this.tools = Array.isArray(listed && listed.tools) ? listed.tools : [];
                return;
            }
        } catch (error) {
            if (!this.process) throw error;
        }

        this.protocol = 'direct';
    }

    _handleMessage(message) {
        if (message.id === undefined || !this.pendingRequests.has(message.id)) return;
        const request = this.pendingRequests.get(message.id);
        clearTimeout(request.timeoutId);
        this.pendingRequests.delete(message.id);
        if (message.error) {
            request.reject(new Error(message.error.message || 'Unknown external engine error'));
        } else {
            request.resolve(message.result);
        }
    }

    _sendNotification(method, params) {
        if (!this.process || !this.process.stdin.writable) return;
        this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }

    _sendRequest(method, params) {
        if (!this.process || !this.process.stdin.writable) {
            return Promise.reject(new Error('External engine is not running'));
        }

        const id = this.nextMessageId++;
        const promise = new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`External engine request timeout for method: ${method}`));
            }, this.timeout);

            this.pendingRequests.set(id, { resolve, reject, timeoutId });
        });

        this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        return promise;
    }

    async sendRequest(method, params) {
        return this._sendRequest(method, params);
    }
    
    async sendRequestWithRetry(method, params, attempts = 5) {
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                return await this._sendRequest(method, params);
            } catch (error) {
                if (!this.process || attempt === attempts - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
            }
        }
    }

    _toolProperties(tool) {
        return (tool && tool.inputSchema && tool.inputSchema.properties) || {};
    }

    _findTool(words, predicate = () => true) {
        for (const word of words) {
            const candidate = this.tools.find(t => 
                (t.name || '').toLowerCase().includes(word.toLowerCase()) && predicate(t)
            );
            if (candidate) return candidate;
        }
        return null;
    }

    _searchTool() {
        return this._findTool(['search', 'find', 'query'], tool => {
            const properties = this._toolProperties(tool);
            return Boolean(properties.pattern || properties.query);
        });
    }

    _fileListTool() {
        return this._findTool(['list', 'all', 'file'], tool => {
            const properties = this._toolProperties(tool);
            const keys = Object.keys(properties);
            return /file/i.test(`${tool.name || ''} ${tool.description || ''}`)
                && keys.every(key => key === 'limit' || key === 'offset');
        });
    }

    _fileOverviewTool() {
        return this._findTool(['object', 'overview', 'symbol', 'file'], tool => {
            const properties = this._toolProperties(tool);
            return Boolean(properties.file_node || properties.file || properties.path || properties.file_name);
        });
    }

    _argumentsFor(tool, value, options = {}) {
        const properties = this._toolProperties(tool);
        const args = {};
        const valueKeys = ['pattern', 'query', 'symbol', 'selected_component', 'component', 'name', 'key'];
        const valueKey = valueKeys.find(key => properties[key]);
        if (valueKey) args[valueKey] = value;
        if (properties.content_search && options.contentSearch !== undefined) args.content_search = options.contentSearch;
        if (properties.verbosity) {
            args.verbosity = options.verbosity || (options.contentSearch ? 'full' : 'metadata');
        }
        if (properties.output_format) args.output_format = 'json';
        if (properties.ranked) args.ranked = true;
        if (properties.depth && options.depth) args.depth = options.depth;
        if (properties.limit && options.limit) args.limit = options.limit;
        return args;
    }

    _parseToolResult(result) {
        if (!result || !Array.isArray(result.content)) return result;
        const values = [];
        for (const content of result.content) {
            if (content.type !== 'text' || typeof content.text !== 'string') continue;
            try {
                values.push(JSON.parse(content.text));
            } catch (_) {
                values.push(content.text);
            }
        }
        return values.length === 1 ? values[0] : values;
    }

    _resultItems(value) {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== 'object') return [];
        if (Array.isArray(value.items)) return value.items;
        if (value.first_page && Array.isArray(value.first_page.items)) return value.first_page.items;
        if (Array.isArray(value.results)) return value.results;
        return [];
    }

    _collectNames(value, output) {
        if (Array.isArray(value)) {
            for (const item of value) this._collectNames(item, output);
            return;
        }
        if (!value || typeof value !== 'object') return;
        const name = value.name || value.symbol || value.tagName;
        if (typeof name === 'string' && name) output.add(name);
        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') this._collectNames(child, output);
        }
    }

    async callToolValue(tool, args) {
        const result = await this.sendRequestWithRetry('tools/call', {
            name: tool.name,
            arguments: args
        });
        if (result && result.isError) throw new Error(`External tool failed: ${tool.name}`);
        return this._parseToolResult(result);
    }

    async callToolPages(tool, args) {
        const pages = [];
        let currentTool = tool.name;
        let currentArgs = args;
        let paginationTool = null;
        
        while (currentTool) {
            const result = await this.sendRequestWithRetry('tools/call', {
                name: currentTool,
                arguments: currentArgs
            });
            if (result && result.isError) throw new Error(`External tool failed: ${currentTool}`);
            
            const parsed = this._parseToolResult(result);
            pages.push(parsed);
            
            const next = this._nextPage(parsed, paginationTool);
            if (next && next.tool) paginationTool = next.tool;
            currentTool = next && next.tool;
            currentArgs = next && next.arguments;
        }
        
        return pages;
    }

    _nextPage(value, paginationTool = null) {
        if (!value || typeof value !== 'object') return null;
        const page = value.first_page || value;
        if (page.total_pages && page.page >= page.total_pages) return null;
        if (value.next && value.next.tool) return value.next;
        if (!paginationTool || !page.handle || !page.page || !page.total_pages) return null;
        
        const args = { handle: page.handle, page: page.page + 1 };
        if (page.page_size) args.page_size = page.page_size;
        return { tool: paginationTool, arguments: args };
    }

    async _callTool(workspaceRoot, tool, args) {
        await this._ensureStarted(workspaceRoot);
        const items = [];
        let currentTool = tool.name;
        let currentArgs = args;
        let paginationTool = null;
        while (currentTool) {
            const result = await this.sendRequestWithRetry('tools/call', {
                name: currentTool,
                arguments: currentArgs
            });
            if (result && result.isError) throw new Error(`External tool failed: ${currentTool}`);
            const parsed = this._parseToolResult(result);
            items.push(...this._resultItems(parsed));
            const next = this._nextPage(parsed, paginationTool);
            if (next && next.tool) paginationTool = next.tool;
            currentTool = next && next.tool;
            currentArgs = next && next.arguments;
        }
        return items;
    }

    _absoluteFile(workspaceRoot, file) {
        if (!file) return '';
        return path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
    }

    _normalizeLocation(workspaceRoot, item) {
        if (!item || typeof item !== 'object') return null;
        const file = item.file || item.path || item.file_path || item.filename;
        const line = Number(item.line || item.start_line || item.line_number || item.lno);
        if (!file || !Number.isFinite(line)) return null;
        return {
            name: item.name || item.symbol || item.tagName || '',
            file: this._absoluteFile(workspaceRoot, file),
            line,
            code: item.code || item.source || item.chunk || item.text || '',
            type: item.type || item.kind || ''
        };
    }

    async *generateTags(workspaceRoot) {
        if (!this.indexCommand) return;
        await this.clearCaches();
        const cmd = this.indexCommand.replace('${workspaceFolder}', workspaceRoot);
        const args = this.indexArgs.map(arg => arg.replace('${workspaceFolder}', workspaceRoot));
        
        const proc = cp.spawn(cmd, args, {
            cwd: workspaceRoot,
            env: this.environment,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let errorOutput = '';
        proc.stderr.on('data', data => { errorOutput += data.toString(); });
        
        await new Promise((resolve, reject) => {
            proc.on('exit', code => {
                if (code === 0) resolve();
                else reject(new Error(errorOutput.trim() || `External indexing process exited with code ${code}`));
            });
            proc.on('error', reject);
        });
        yield 'External index created successfully.';
    }

    async *streamSymbols(workspaceRoot) {
        await this._ensureStarted(workspaceRoot);
        if (this.protocol === 'direct') {
            const response = await this.sendRequest('search_components', {});
            if (response && Array.isArray(response.items)) {
                for (const item of response.items) {
                    const name = typeof item === 'string' ? item : item.name || item.symbol;
                    if (name) yield name;
                }
            }
            return;
        }
        
        const seen = new Set();
        const fileListTool = this._fileListTool();
        const fileOverviewTool = this._fileOverviewTool();
        
        if (fileListTool && fileOverviewTool) {
            const listed = await this.callToolValue(fileListTool, this._argumentsFor(fileListTool, '', { limit: 10000 }));
            const files = Array.isArray(listed) ? listed : listed.files || listed.items || [];
            const fileProperty = ['file_node', 'file', 'path', 'file_name']
                .find(key => this._toolProperties(fileOverviewTool)[key]);
            
            for (let offset = 0; offset < files.length; offset += 8) {
                const batch = files.slice(offset, offset + 8);
                const overviewPages = await Promise.all(batch.map(file => {
                    const fileName = typeof file === 'string' ? file : file.file || file.path || file.name;
                    return this.callToolPages(fileOverviewTool, { [fileProperty]: fileName });
                }));
                for (const pages of overviewPages) {
                    for (const page of pages) this._collectNames(page, seen);
                }
            }
        } else {
            if (seen.size === 0) {
                const tool = this._searchTool();
                if (!tool) throw new Error('External engine does not advertise a symbol search tool.');
                const items = await this._callTool(workspaceRoot, tool, this._argumentsFor(tool, '.*', { contentSearch: false, verbosity: 'names_only' }));
                for (const item of items) {
                    const name = typeof item === 'string' ? item : item.name || item.symbol || item.tagName;
                    if (name) seen.add(name);
                }
            }
        }
        
        for (const name of seen) yield name;
    }

    async *queryDefinitions(workspaceRoot, key) {
        await this._ensureStarted(workspaceRoot);
        if (this.protocol === 'direct') {
            const response = await this.sendRequest('query_definitions', { key });
            for (const item of (response && response.items) || []) yield item;
            return;
        }
        
        const dedicated = this._findTool(['definition'], tool => {
            const properties = this._toolProperties(tool);
            return Boolean(properties.symbol || properties.name || properties.key || properties.pattern);
        });
        const tool = dedicated || this._searchTool();
        if (!tool) throw new Error('External engine does not advertise a definition or symbol search tool.');
        
        const pattern = this._toolProperties(tool).pattern ? `^${this._escapeRegExp(key)}$` : key;
        const raw = await this._callTool(workspaceRoot, tool, this._argumentsFor(tool, pattern, { contentSearch: false, verbosity: 'metadata' }));
        let matches = raw.map(item => this._normalizeLocation(workspaceRoot, item)).filter(Boolean);
        matches = matches.filter(item => !item.name || item.name === key);
        const definitions = matches.filter(item => !/declaration|prototype/i.test(item.type));
        
        for (const match of definitions.length ? definitions : matches) yield match;
    }

    async *queryReferences(workspaceRoot, symbol) {
        await this._ensureStarted(workspaceRoot);
        if (this.protocol === 'direct') {
            const response = await this.sendRequest('query_references', { symbol });
            for (const item of (response && response.items) || []) yield item;
            return;
        }
        
        const dedicated = this._findTool(['reference', 'usage', 'users'], tool => {
            const properties = this._toolProperties(tool);
            return Boolean(properties.symbol || properties.selected_component || properties.name || properties.key);
        });
        
        const tool = dedicated || this._searchTool();
        if (!tool) throw new Error('External engine does not advertise a reference or content search tool.');
        const contentSearch = !dedicated;
        
        const raw = await this._callTool(workspaceRoot, tool, this._argumentsFor(tool, symbol, { contentSearch }));
        const symbolPattern = new RegExp(`(?:^|[^a-zA-Z0-9_])${this._escapeRegExp(symbol)}(?![a-zA-Z0-9_])`);
        
        const seen = new Set();
        for (const item of raw) {
            const location = this._normalizeLocation(workspaceRoot, item);
            if (!location) continue;
            
            const lines = String(location.code || "").split(/\r?\n/);
            const matchingLines = contentSearch 
                ? lines.map((code, index) => ({ code, line: location.line + index })).filter(entry => symbolPattern.test(entry.code))
                : [{ code: lines[0] || '', line: location.line }];
                
            for (const match of matchingLines) {
                const unique = `${location.file}:${match.line}:${match.code}`;
                if (seen.has(unique)) continue;
                seen.add(unique);
                yield { file: location.file, line: match.line, code: match.code.trim() };
            }
        }
    }

    async getCallers(workspaceRoot, symbol) {
        await this._ensureStarted(workspaceRoot);
        if (this.protocol === 'direct') {
            const response = await this.sendRequest('get_callers', { symbol });
            return response && Array.isArray(response.items) ? response.items : [];
        }
        
        const tool = this._findTool(['caller'], candidate => {
            const properties = this._toolProperties(candidate);
            return Boolean(properties.symbol || properties.selected_component || properties.name || properties.key);
        });
        if (!tool) throw new Error('External engine does not advertise a caller tool.');
        
        const raw = await this._callTool(workspaceRoot, tool, this._argumentsFor(tool, symbol, { depth: 1, verbosity: 'metadata' }));
        const locations = raw.map(item => this._normalizeLocation(workspaceRoot, item)).filter(Boolean);
        
        const resolved = await Promise.all(locations.map(async location => {
            if (!/declaration|prototype/i.test(location.type)) return location;
            const definitions = [];
            for await (const definition of this.queryDefinitions(workspaceRoot, location.name)) {
                definitions.push(definition);
            }
            return definitions[0] || location;
        }));
        
        const seen = new Set();
        return resolved.filter(item => {
            const key = `${item.name}:${item.file}:${item.line}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).map(item => ({ name: item.name, file: item.file, line: item.line }));
    }
    
    _escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

module.exports = { ExternalProvider };
