const cp = require('child_process');
const readline = require('readline');

class ExternalProvider {
  constructor(options = {}) {
    this.command = options.command || '';
    this.args = options.args || [];
    this.environment = { ...process.env, ...options.env };
    this.tools = { ...options.tools };
    this.channel = options.channel;
    this.child = null;
    this.reader = null;
    this.workspaceRoot = '';
    this.connecting = null;
    this.prewarming = null;
    this.pending = new Map();
    this.nextId = 1;
    this.advertisedTools = [];
  }

  async clearCaches() {
    const child = this.child;
    const reader = this.reader;
    this.child = null;
    this.reader = null;
    this.workspaceRoot = '';
    this.connecting = null;
    this.prewarming = null;
    this.advertisedTools = [];
    if (reader) reader.close();
    if (child) child.kill();
    this._rejectPending(new Error('External MCP connection closed'));
  }

  async _connect(workspaceRoot) {
    if (this.child && this.workspaceRoot !== workspaceRoot) await this.clearCaches();
    if (this.connecting) return this.connecting;
    this.connecting = this._start(workspaceRoot).catch(error => {
      this.connecting = null;
      throw error;
    });
    return this.connecting;
  }

  _expand(value, workspaceRoot) {
    return String(value).replaceAll('${workspaceFolder}', workspaceRoot);
  }

  async _start(workspaceRoot) {
    if (!this.command) throw new Error('Configure gtags-code.external.command.');
    const child = cp.spawn(
      this._expand(this.command, workspaceRoot),
      this.args.map(arg => this._expand(arg, workspaceRoot)),
      {
        cwd: workspaceRoot,
        env: this.environment,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    this.child = child;
    this.workspaceRoot = workspaceRoot;
    child.stderr.on('data', data => {
      if (this.channel) this.channel.append(data.toString());
    });
    child.stdin.on('error', error => this._closeChild(child, error));
    child.on('error', error => this._closeChild(child, error));
    child.on('exit', code => this._closeChild(child, new Error(`External MCP exited with code ${code}`)));
    this.reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.reader.on('line', line => {
      if (!line.trim()) return;
      try { this._receive(JSON.parse(line)); } catch (_) { /* stderr carries diagnostics */ }
    });

    const initialized = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gtags-code', version: '0.1.0' }
    });
    if (!initialized || !initialized.capabilities) throw new Error('Invalid external MCP response');
    this._notify('notifications/initialized', {});
    try {
      const listed = await this._request('tools/list', {});
      this.advertisedTools = Array.isArray(listed && listed.tools) ? listed.tools : [];
    } catch (_) {
      this.advertisedTools = [];
    }
  }

  _closeChild(child, error) {
    if (this.child !== child) return;
    if (this.reader) this.reader.close();
    this.child = null;
    this.reader = null;
    this.workspaceRoot = '';
    this.connecting = null;
    this._rejectPending(error);
  }

  _rejectPending(error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  _receive(message) {
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message || 'External MCP request failed'));
    else request.resolve(message.result);
  }

  _notify(method, params) {
    this._write({ jsonrpc: '2.0', method, params });
  }

  _request(method, params) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this._write({ jsonrpc: '2.0', id, method, params }, id);
    return result;
  }

  _write(message, requestId) {
    const input = this.child && this.child.stdin;
    if (!input || !input.writable) {
      const error = new Error('External MCP is not connected');
      if (requestId !== undefined) {
        const request = this.pending.get(requestId);
        this.pending.delete(requestId);
        request.reject(error);
      } else {
        throw error;
      }
      return;
    }
    input.write(`${JSON.stringify(message)}\n`);
  }

  async _call(workspaceRoot, tool, args = {}) {
    const name = this.tools[tool];
    if (!name) throw new Error(`Configure gtags-code.external.${tool}.`);
    await this._connect(workspaceRoot);
    if (tool !== 'index' && this.prewarming) {
      await this.prewarming.catch(() => {});
    }
    const result = await this._request('tools/call', { name, arguments: args });
    if (result && result.isError) {
      throw new Error(result.content && result.content[0] ? result.content[0].text : 'Tool error');
    }
    if (result && result.structuredContent !== undefined) return result.structuredContent;
    const text = result && result.content && result.content.find(item => item.type === 'text')?.text;
    return text ? JSON.parse(text) : result;
  }

  prewarm(workspaceRoot) {
    if (this.prewarming) return this.prewarming;
    this.prewarming = this._prewarm(workspaceRoot).finally(() => {
      this.prewarming = null;
    });
    return this.prewarming;
  }

  async _prewarm(workspaceRoot) {
    return this._connect(workspaceRoot).then(async () => {
      const readyTool = this._readyToolName();
      if (!readyTool) {
        return;
      }
      await this._request('tools/call', { name: readyTool, arguments: {} });
    }).catch(error => {
      if (this.channel) {
        this.channel.appendLine(`[External MCP] Prewarm failed: ${error.message}`);
      }
    });
  }

  _readyToolName() {
    const exact = this.advertisedTools.find(tool =>
      ['quartz_code_status', 'status', 'health', 'ready'].includes(tool.name)
    );
    if (exact) return exact.name;

    const fuzzy = this.advertisedTools.find(tool =>
      /status|health|ready/i.test(`${tool.name || ''} ${tool.description || ''}`)
    );
    return fuzzy && fuzzy.name;
  }

  async *generateTags(workspaceRoot) {
    const result = await this._call(workspaceRoot, 'index');
    yield* result.message || 'External index is ready.';
  }

  async *streamSymbols(workspaceRoot) {
    let cursor = null;
    do {
      const result = await this._call(workspaceRoot, 'search-symbols', {
        pattern: '.*',
        page_size: 25000,
        ...(cursor ? { cursor } : {})
      });
      for (const item of result.items) yield item.name;
      cursor = result.next_cursor;
    } while (cursor);
  }

  async *queryDefinitions(workspaceRoot, symbol) {
    const result = await this._call(workspaceRoot, 'jump-to-definition', { symbol });
    yield* result.items;
  }

  async *queryReferences(workspaceRoot, symbol) {
    const result = await this._call(workspaceRoot, 'get-ref', { symbol });
    yield* result.items;
  }

  async getCallers(workspaceRoot, symbol) {
    const result = await this._call(workspaceRoot, 'get-callers', { symbol, depth: 1 });
    return result.items;
  }
}

module.exports = ExternalProvider;
