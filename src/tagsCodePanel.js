const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

class TagsCodeViewProvider {
  constructor(context, tagsProvider) {
    this.context = context;
    this.tagsProvider = tagsProvider;
    this.webviewView = null;
    this.isReady = false;
    this.pendingTabs = [];
  }

  resolveWebviewView(webviewView, context, token) {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
      ]
    };

    const htmlPath = path.join(this.context.extensionPath, 'media', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    const mediaPath = webviewView.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
    );

    html = html
      .replace(/href="treeview.css"/g, `href="${mediaPath}/treeview.css"`)
      .replace(/src="treeview.js"/g, `src="${mediaPath}/treeview.js"`)
      .replace(/src="d3.js"/g, `src="${mediaPath}/d3.js"`)
      .replace(/src="d3-flextree.js"/g, `src="${mediaPath}/d3-flextree.js"`);

    webviewView.webview.html = html;

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'getTags') {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        try {
          let data;
          if (msg.mode === 'references') {
            const iterator = this.tagsProvider.queryReferences(workspaceFolder.uri.fsPath, msg.tagName);
            const items = [];
            for await (const item of iterator) {
              item.displayFile = path.relative(workspaceFolder.uri.fsPath, item.file);
              items.push(item);
            }
            data = items;
          } else {
            data = await this.tagsProvider.getCallers(workspaceFolder.uri.fsPath, msg.tagName);
          }
          webviewView.webview.postMessage({
            type: 'getTags:response',
            id: msg.id,
            data
          });
        } catch (e) {
          console.error('gtags-code: Failed to load panel data:', e);
          if (this.tagsProvider.channel) {
            this.tagsProvider.channel.appendLine(`[Error] Failed to load ${msg.mode || 'callers'} for ${msg.tagName}: ${e.message}`);
          }
          webviewView.webview.postMessage({
            type: 'getTags:response',
            id: msg.id,
            data: []
          });
        }
      } else if (msg.type === 'webviewReady') {
        this.isReady = true;
        for (const item of this.pendingTabs) {
          this.webviewView.webview.postMessage({ type: 'addTab', symbol: item.symbol, mode: item.mode });
        }
        this.pendingTabs = [];
      } else if (msg.type === 'postFileInfo') {
        const { revealInCode } = require('./navigate');
        await revealInCode(this.context, vscode.window.activeTextEditor, msg.data);
      }
    });
  }
  
  addTab(symbol, mode = 'callers') {
    if (!this.webviewView || !this.isReady) {
      this.pendingTabs.push({ symbol, mode });
    } else {
      this.webviewView.webview.postMessage({ type: 'addTab', symbol, mode });
    }
  }
}

module.exports = {
  TagsCodeViewProvider
};
