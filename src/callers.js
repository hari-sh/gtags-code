

const vscode = require("vscode");

const fileFunctionCache = new Map();
/* ------------------ cache ------------------ */

/* ------------------ core logic ------------------ */

async function getFunctionsInFile(file, cwd, tagsProvider) {
  if (fileFunctionCache.has(file)) {
    return await fileFunctionCache.get(file);
  }

  const funcsPromise = tagsProvider.getFunctionsInFile(cwd, file);
  fileFunctionCache.set(file, funcsPromise);

  return await funcsPromise;
}

async function getEnclosingFunction(file, line, cwd, tagsProvider) {
  const funcs = await getFunctionsInFile(file, cwd, tagsProvider);
  return funcs.filter(f => f.line <= line).at(-1) || null;
}

const HEADERS_EXTENSIONS = [".h", ".hpp", ".hh", ".hxx"];
function isHeaderFile(file) {
  return HEADERS_EXTENSIONS.some(ext => file.endsWith(ext));
}

async function getEnclosingInfoArray(symbol, cwd, tagsProvider) {
  const callers = await tagsProvider.getCallers(cwd, symbol);
  
  // 1. Immediately filter out headers to save unnecessary DB queries
  const nonHeaderCallers = callers.filter(c => !isHeaderFile(c.file));
  
  // 2. Fetch enclosing functions concurrently
  const enclosed = (await Promise.all(
    nonHeaderCallers.map(async (c) => {
      const enclosing = await getEnclosingFunction(c.file, c.line, cwd, tagsProvider);
      return enclosing ? { name: enclosing.symbol, file: c.file, line: enclosing.line } : null;
    })
  )).filter(Boolean); // 3. Remove nulls

  // 4. Remove self-references
  const withoutSelf = enclosed.filter(e => e.name !== symbol);

  // 5. Remove duplicates (only keep singletons)
  const nameCounts = new Map();
  for (const e of withoutSelf) {
    nameCounts.set(e.name, (nameCounts.get(e.name) || 0) + 1);
  }
  
  return withoutSelf.filter(e => nameCounts.get(e.name) === 1);
}

/* ------------------ webPanel.js ------------------ */

const path = require('path');

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


/* ------------------ markutil.js ------------------ */

function getTag(editor) {
    const tag = editor.document.getText(editor.selection).trim()
    if (!tag) {
        const range = editor.document.getWordRangeAtPosition(editor.selection.active);
        if (range) {
            return editor.document.getText(range);
        }
    }
    return tag;
}

async function getTagsRef(tagName, tagsProvider) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return [];
  
  return await getEnclosingInfoArray(tagName, workspaceFolder.uri.fsPath, tagsProvider);
}


module.exports = {
  getTag,
  getTagsRef,
  postFileInfo
};