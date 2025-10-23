const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const {jumputil, getTag, storeTagsToDB} = require('./tagutils');
const {initDB, closeDB, assignIdsToVariables, searchQuery, resetSearchMap} = require('./dbutils');
const logger = require('./logger');
const debug = require('./debug');

async function parseAndStoreTags() {
    await storeTagsToDB(path.join(vscode.workspace.rootPath, 'tags'));
    await assignIdsToVariables();
    // await debug.printdb();
    vscode.window.showInformationMessage('Tags are parsed');
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

module.exports = {
  activate(context) {
    logger.initLogger();
    initDB();
    context.subscriptions.push(vscode.commands.registerCommand('extension.storeTags', parseAndStoreTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.searchTags', handleSearchTagsCommand));
    context.subscriptions.push(vscode.commands.registerCommand('extension.jumpTag', jump2tag));
  },
  deactivate() {
    closeDB();
    logger.disposeLogger();
  }
};