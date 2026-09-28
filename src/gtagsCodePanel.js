const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

class GtagsCodeViewProvider {
  constructor(context) {
    this.context = context;
  }

  resolveWebviewView(webviewView, context, token) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
      ]
    };

    const htmlPath = path.join(this.context.extensionPath, 'media', 'gtags-code.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    webviewView.webview.html = html;
  }
}

module.exports = {
  GtagsCodeViewProvider
};
