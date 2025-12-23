const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const {jump2tag, getReferencesInternal, handleSearchTagsCommand} = require('./queryTags');
const {initDB, closeDB} = require('./dbutils');
const {parseAndStoreTags} = require('./buildTags');
const channel = vscode.window.createOutputChannel('gtags-code');
const {createPreview} = require('./gtags_callers');

async function storeTags() {
    await parseAndStoreTags(channel, vscode.workspace.rootPath);
}

async function searchTags(context) {
  handleSearchTagsCommand(context)
}

async function goToDefinition(context) {
  const editor = vscode.window.activeTextEditor
  await jump2tag(context, editor);
}

async function getReferences(context) {
  const editor = vscode.window.activeTextEditor;
  await getReferencesInternal(context, editor);
}

async function getCallers(context) {
  await createPreview(context);
}

module.exports = {
  activate(context) {
    initDB();
    context.subscriptions.push(channel);
    context.subscriptions.push(vscode.commands.registerCommand('extension.storeTags', storeTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.searchTags', searchTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.jumpTag', goToDefinition));
    context.subscriptions.push(vscode.commands.registerCommand('extension.getReferences', getReferences));
    context.subscriptions.push(vscode.commands.registerCommand('extension.getCallers', () => getCallers(context)));
  },
  deactivate() {
    closeDB();
  }
};