const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

class TagsCodeViewProvider {
  constructor(context, tagsProvider) {
    this.context = context;
    this.tagsProvider = tagsProvider;
    this.webviewView = null;
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
        const { getTagsRef } = require('./callers');
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const isFunction = !!workspaceFolder &&
          typeof this.tagsProvider.isFunctionSymbol === 'function' &&
          await this.tagsProvider.isFunctionSymbol(workspaceFolder.uri.fsPath, msg.tagName);
        const data = isFunction ? await getTagsRef(msg.tagName, this.tagsProvider) : [];
        webviewView.webview.postMessage({
          type: 'getTags:response',
          id: msg.id,
          data
        });
      } else if (msg.type === 'postFileInfo') {
        const { postFileInfo } = require('./callers');
        await postFileInfo(msg.data);
      }
    });
  }
  
  addTab(symbol) {
    if (this.webviewView) {
      this.webviewView.webview.postMessage({ type: 'addTab', symbol });
    }
  }
}

module.exports = {
  TagsCodeViewProvider
};
