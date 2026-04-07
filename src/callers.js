const { spawn } = require("child_process");
const vscode = require("vscode");
const config = vscode.workspace.getConfiguration("gtags-code");
const globalCmd = config.get("globalCmd") || "global";

const fileFunctionCache = new Map();
let bottomViewColumn = null;

function runGlobal(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(globalCmd, args, { cwd });

    let out = "";
    let err = "";

    p.stdout.on("data", d => (out += d.toString()));
    p.stderr.on("data", d => (err += d.toString()));

    p.on("close", code => {
      if (code !== 0 && !out) {
        reject(err || `global ${args.join(" ")} failed`);
        return;
      }
      resolve(out);
    });
  });
}

function parseGlobalX(output) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        symbol: parts[0],
        line: Number(parts[1]),
        file: parts[2],
        source: parts.slice(3).join(" ")
      };
    });
}

/* ------------------ cache ------------------ */

/* ------------------ core logic ------------------ */

async function getFunctionsInFile(file, cwd) {
  if (fileFunctionCache.has(file)) {
    return fileFunctionCache.get(file);
  }

  const out = await runGlobal(["-xf", file], cwd);
  const funcs = parseGlobalX(out);

  fileFunctionCache.set(file, funcs);
  return funcs;
}

async function getEnclosingFunction(file, line, cwd) {
  const funcs = await getFunctionsInFile(file, cwd);
  return funcs.filter(f => f.line <= line).at(-1) || null;
}

async function getCallers(symbol, cwd) {
  const out = await runGlobal(["-rx", symbol], cwd);
  return parseGlobalX(out);
}

async function getCallersWithEnclosure(symbol, cwd) {
  const callers = await getCallers(symbol, cwd);

  for (const c of callers) {
    const enclosing = await getEnclosingFunction(c.file, c.line, cwd);
    c.enclosing = enclosing
      ? {
          name: enclosing.symbol,
          line: enclosing.line
        }
      : null;
  }

  return callers;
}

function mapByEnclosingFull(callers) {
  const map = new Map();

  for (const c of callers) {
    if (!c.enclosing) continue;

    const keyObj = {
      name: c.enclosing.name,
      file: c.file,          // enclosing function file
      line: c.line // enclosing function line
    };

    // stable string key
    const key = `${keyObj.name}|${keyObj.file}|${keyObj.line}`;

    if (!map.has(key)) {
      map.set(key, {
        enclosing: keyObj,
        callers: []
      });
    }

    map.get(key).callers.push(c);
  }

  return map;
}

const HEADERS_EXTENSIONS = [".h", ".hpp", ".hh", ".hxx"];

function isHeaderFile(file) {
  return HEADERS_EXTENSIONS.some(ext => file.endsWith(ext));
}

function removeHeadersAndDuplicates(enclosed) {
  const nonHeaders = enclosed.filter(
    e => !isHeaderFile(e.file)
  );
  const nameCounts = new Map();
  for (const e of nonHeaders) {
    const name = e.name ?? null;
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  const uniqueEnclosed = nonHeaders.filter(
    e => nameCounts.get(e.name) === 1
  );
  return uniqueEnclosed;
}

function getEnclosingInfoArray(callers) {
  const enclosed = callers
    .filter(c => c.enclosing)
    .map(c => ({
      name: c.enclosing.name,
      file: c.file,
      line: c.enclosing.line
    }));
    return removeHeadersAndDuplicates(enclosed);
}

/* ------------------ webPanel.js ------------------ */

const path = require('path');
const fs = require('fs');

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

async function getTagsRef(tagName) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return [];
  const callerData = await getCallersWithEnclosure(tagName, workspaceFolder.uri.fsPath);
  const  result = getEnclosingInfoArray(callerData);
  return result.filter(obj => obj.name !== tagName);
}

async function createPreview(context)  {
  const editor = vscode.window.activeTextEditor;
  const gtagSymbol = getTag(editor);
  await createPreviewUtil(context.extensionPath, getTagsRef, gtagSymbol);
}

module.exports = {
  createPreview
};