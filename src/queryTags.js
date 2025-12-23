const { spawn } = require('child_process');
const {getValueFromDb, getDB, batchWriteIntoDB, searchQuery, resetSearchMap} = require('./dbutils');
const vscode = require('vscode');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function getPattern(filePath, name, canceller, pattern, matchWhole) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
    });
    let lno = 0
    let charPos = 0
    let found = false
    for await (const line of rl) {
        lno += 1
        if ((matchWhole && line === pattern) || line.startsWith(pattern)) {
            found = true
            charPos = Math.max(line.indexOf(name), 0)
            console.log(`ctags-code: Found '${pattern}' at ${lno}:${charPos}`)
            return {retval:false, found, lno, charPos}
        } else if (canceller && canceller.isCancellationRequested) {
            console.log('ctags-code: Cancelled pattern searching')
            return {retval:false, found, lno, charPos}
        }
    }
}


async function getlno(entry, document, sel, canceller) {
    if (entry.tagKind === 'F') {
        return await getFilelno(document, sel)
    }
    else {
        return await getlnoPattern(entry, canceller)
    }
}

async function getlnoPattern(entry, canceller) {
    let matchWhole = false
    let pattern = entry.pattern
    if (pattern.startsWith("^")) {
        pattern = pattern.substring(1, pattern.length)
    } else {
        console.error(`ctags-code: Unsupported pattern ${pattern}`)
        return;
    }

    if (pattern.endsWith("$")) {
        pattern = pattern.substring(0, pattern.length - 1)
        matchWhole = true
    }
    console.log(pattern);
    const ldata = await getPattern(entry.file, entry.name, canceller, pattern, matchWhole);
    console.log(ldata);
    if (ldata.found) {
        return new vscode.Selection(ldata.lno - 1, ldata.charPos, ldata.lno - 1, ldata.charPos)
    }
}

async function getFilelno(document, sel) {
    if(!sel) {
        return new vscode.Selection(0, 0, 0, 0);
    }
    let pos = sel.end.translate(0, 1)
    let range = document.getWordRangeAtPosition(pos)
    if (range) {
        let text = document.getText(range)
        if (text.match(/[0-9]+/)) {
            const lno = Math.max(0, parseInt(text, 10) - 1)
            let charPos = 0

            pos = range.end.translate(0, 1)
            range = document.getWordRangeAtPosition(pos)
            if (range) {
                text = document.getText(range)
                if (text.match(/[0-9]+/)) {
                    charPos = Math.max(0, parseInt(text) - 1)
                }
            }
            console.log(`ctags-code: Resolved file position to line ${lno + 1}, char ${charPos + 1}`)
            return new vscode.Selection(lno, charPos, lno, charPos)
        }
    }
}

async function openAndReveal(context, editor, document, sel) {
    const doc = await vscode.workspace.openTextDocument(document);
    const showOptions = {
        viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One,
        selection: sel
    };
    return await vscode.window.showTextDocument(doc, showOptions);
}

async function revealCTags(context, editor, entry) {
    if (!entry) {
        return
    }
    const document = editor ? editor.document : null
    const triggeredSel = editor ? editor.selection : null;
    const sel = await getlno(entry, document, triggeredSel);
    return openAndReveal(context, editor, entry.file, sel);
}

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

async function jumputil(editor, context, key) {
    // if (!editor) return;
    if (!key) return;
    const value = await getValueFromDb(`tag:${key}`);
    if (value) {
        console.log('Found:', value);
        const options = [value].map(tag => {
            if (!path.isAbsolute(tag.file)) {
                tag.file = path.join(vscode.workspace.rootPath, tag.file)
            }
            tag.description = ""
            tag.label = tag.file
            tag.detail = tag.pattern
            tag.lno = 0
            return tag
        });
        if (!options.length) {
            return vscode.window.showInformationMessage(`ctags-code: No tags found for ${tag}`)
        } else if (options.length === 1) {
            return revealCTags(context, editor, options[0])
        } else {
            return vscode.window.showQuickPick(options).then(opt => {
                return revealCTags(context, editor, opt)
            })
        }
    } else {
        console.log('Key not found');
    }
}


async function handleSearchTagsCommand(context) {
  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = 'Search tags...';
  quickPick.matchOnDescription = true;
  quickPick.filterItems = false;
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  quickPick.onDidChangeValue(async (input) => {
    if (!input) {
      quickPick.items = [];
      return;
    }
    const items = await searchQuery(input);
    quickPick.items = items.map(r => ({
    label: r.label,
    description: r.description,
    alwaysShow: true
  }));
  });

  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (selected) {
      jumputil(vscode.window.activeTextEditor, context, selected.label)
    }
    quickPick.hide();
    resetSearchMap();
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

async function jump2tag(context) {
  const editor = vscode.window.activeTextEditor
  const tag = getTag(editor)
  return jumputil(editor, context, tag)
}

async function getReferencesInternal(context, editor) {
  const tag = getTag(editor);
  const terminal = vscode.window.createTerminal(`${tag} - References`);
  terminal.show();
  const config = vscode.workspace.getConfiguration('gtags-code');
  const globalCmd = config.get('globalCmd');
  terminal.sendText(`${globalCmd} --result=grep -xr ${tag}`);
}

module.exports = {jump2tag , getReferencesInternal, handleSearchTagsCommand};
