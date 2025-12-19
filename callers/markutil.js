const vscode = require('vscode');
const {createPreviewUtil} = require('./webPanel');
const {getCallersWithEnclosure, getEnclosingInfoArray} = require('./gtags_callers');

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
  const callerData = await getCallersWithEnclosure(tagName, vscode.workspace.rootPath);
  const  result = getEnclosingInfoArray(callerData);
  return result.filter(obj => obj.name !== tagName);
}

async function createPreview(context)  {
  const editor = vscode.window.activeTextEditor;
  const gtagSymbol = getTag(editor);
  await createPreviewUtil(context.extensionPath, getTagsRef, gtagSymbol);
}

module.exports = { createPreview };
