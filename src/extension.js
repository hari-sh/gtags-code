const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const {jumputil, getTag} = require('./queryTags');
const {initDB, openDB, closeDB, cleanDB, assignIdsToVariables, searchQuery, resetSearchMap} = require('./dbutils');
const {parseToTagsFile, cleanGtagsFiles} = require('./buildTags');
const channel = vscode.window.createOutputChannel('gtags-code');
const {createPreview} = require('./gtags_callers');
const {spawn} = require('child_process');

function getVersionAsync(cmd, versionArgs = ["--version"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, versionArgs, { shell: true });

    let output = "";

    child.stdout.on("data", d => output += d);
    child.stderr.on("data", d => output += d);

    child.on("error", () => {
        reject(new Error(`Please install gtags or provide gtags/global path in settings `));
    });

    child.on("close", (code) => {
      if (code === 0 || code === 1) {
        resolve(output.trim());
      } else {
        reject(new Error(`Please install gtags or provide gtags/global path in settings `));
      }
    });
  });
}


async function preflight() {
  const config = vscode.workspace.getConfiguration('gtags-code');
  const globalCmd = config.get('globalCmd');
  const gtagsCmd = config.get('gtagsCmd');
  await getVersionAsync(globalCmd);
  await getVersionAsync(gtagsCmd);
}

async function parseAndStoreTags() {
  await preflight();
  channel.show();
  const { performance } = require('perf_hooks');
  const start = performance.now();
  channel.appendLine('Cleaning existing Tags DataBase...');
  await cleanGtagsFiles(vscode.workspace.rootPath);
  await cleanDB();
  await openDB();
  channel.appendLine('Running Gtags...');
  await parseToTagsFile(vscode.workspace.rootPath);
  channel.appendLine('Creating Tags DataBase...');
  await assignIdsToVariables();
  channel.appendLine('Tags DataBase created successfully...');
  const sec = ((performance.now() - start) / 1000).toFixed(3);
  channel.appendLine(`Elapsed: ${sec} seconds`);
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

async function getReferences(context) {
  const editor = vscode.window.activeTextEditor;
  const tag = getTag(editor);
  const terminal = vscode.window.createTerminal(`${tag} - References`);

  terminal.show();
  const config = vscode.workspace.getConfiguration('gtags-code');
  const globalCmd = config.get('globalCmd');
  terminal.sendText(`${globalCmd} --result=grep -xr ${tag}`);
}

module.exports = {
  activate(context) {
    initDB();
    context.subscriptions.push(channel);
    context.subscriptions.push(vscode.commands.registerCommand('extension.storeTags', parseAndStoreTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.searchTags', handleSearchTagsCommand));
    context.subscriptions.push(vscode.commands.registerCommand('extension.jumpTag', jump2tag));
    context.subscriptions.push(vscode.commands.registerCommand('extension.getReferences', getReferences));
    context.subscriptions.push(vscode.commands.registerCommand('extension.getCallers', () => createPreview(context)));
  },
  deactivate() {
    closeDB();
  }
};