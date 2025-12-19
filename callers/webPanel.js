const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

let bottomViewColumn = null;

async function ensureBottomGroup() {
  if (vscode.window.visibleTextEditors.length === 0) {
    await vscode.commands.executeCommand('workbench.action.newUntitledFile');
  }

  if (!bottomViewColumn) {
    await vscode.commands.executeCommand(
      'workbench.action.splitEditorDown'
    );

    bottomViewColumn = vscode.window.activeTextEditor.viewColumn;
  }
}

async function revealLocation(file, line) {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) return;

  const fileUri = vscode.Uri.file(
    path.join(root.uri.fsPath, file)
  );
  
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  const doc = await vscode.workspace.openTextDocument(fileUri);

  const editor = await vscode.window.showTextDocument(doc, {
    ViewColumn: vscode.ViewColumn.One,
    preview: false,
    preserveFocus: false
  });

  const pos = new vscode.Position(line - 1, 0);

  editor.selection = new vscode.Selection(pos, pos);

  editor.revealRange(
    new vscode.Range(pos, pos),
    vscode.TextEditorRevealType.InCenter
  );
}



async function postFileInfo(tagData)  {
  await revealLocation(tagData.file, tagData.line);
}

async function createPreviewUtil(extensionPath, getTags, gtagSymbol)  {
     await ensureBottomGroup();
     const panel = vscode.window.createWebviewPanel(
        gtagSymbol,
        gtagSymbol,
        bottomViewColumn ?? vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(path.join(extensionPath, 'media'))
          ]
        }
      );

       if (!bottomViewColumn) {
        vscode.commands.executeCommand(
          'workbench.action.moveEditorToBelowGroup'
        ).then(() => {
          bottomViewColumn = panel.viewColumn;
        });
    }

      vscode.commands.executeCommand(
        'workbench.action.moveEditorToBelowGroup'
      );

      const htmlPath = path.join(extensionPath, 'media', 'index.html');
      let html = fs.readFileSync(htmlPath, 'utf8');

      const webview = panel.webview;
      const mediaPath = webview.asWebviewUri(
        vscode.Uri.file(path.join(extensionPath, 'media'))
      );

      html = html
        .replace(/href="treeview.css"/g, `href="${mediaPath}/treeview.css"`)
        .replace(/src="treeview.js"/g, `src="${mediaPath}/treeview.js"`)
        .replace(/src="d3.js"/g, `src="${mediaPath}/d3.js"`)
        .replace(/src="d3-flextree.js"/g, `src="${mediaPath}/d3-flextree.js"`)
        .replace("__SYMBOL__",JSON.stringify(gtagSymbol).slice(1, -1))

      panel.webview.html = html;
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === 'getTags') {
          const data = await getTags(msg.tagName);
          panel.webview.postMessage({
            type: 'getTags:response',
            id: msg.id,
            data
          });
        }
        if (msg.type === 'postFileInfo') {
          const data = await postFileInfo(msg.tagName);
        }
      });
    }

module.exports = { createPreviewUtil };
