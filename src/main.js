const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const { jump2tag, getReferencesInternal, handleSearchTagsCommand } = require('./query');
const { initDB, closeDB } = require('./database');
const { parseAndStoreTags } = require('./store');
const { createPreview } = require('./callers');
const { ensureCtagsAvailable, preflight } =  require('./preflight');

const channel = vscode.window.createOutputChannel('gtags-code');
const config = vscode.workspace.getConfiguration('gtags-code');

const exeCmds = {
  global: config.get('globalCmd') || 'global',
  ctags: config.get('ctagsCmd') || 'ctags',
  gtags: config.get('gtagsCmd') || 'gtags'
};

async function storeTags() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }
  await preflight(exeCmds);
  const ctagsAvailable = await ensureCtagsAvailable(exeCmds.ctags);
  if(!ctagsAvailable) {
    exeCmds.ctags = null;
  }
  await parseAndStoreTags(channel, workspaceFolder.uri.fsPath, exeCmds);
}

async function searchTags(context) {
  handleSearchTagsCommand(context)
}

async function goToDefinition(context) {
  const editor = vscode.window.activeTextEditor;
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
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      initDB(workspaceFolder.uri.fsPath);
    }
    context.subscriptions.push(channel);
    context.subscriptions.push(vscode.commands.registerCommand('extension.storeTags', storeTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.searchTags', searchTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.jumpTag', goToDefinition));
    context.subscriptions.push(vscode.commands.registerCommand('extension.getReferences', getReferences));
    context.subscriptions.push(vscode.commands.registerCommand('extension.getCallers', () => getCallers(context)));

    // Register VS Code Language Model Tools for GitHub Copilot & VS Code Chat
    try {
      const { registerLanguageModelTools } = require('./lmTools');
      registerLanguageModelTools(context);
      channel.appendLine('GTags Language Model Tools registered for Copilot / Chat.');
    } catch (err) {
      channel.appendLine(`Failed to register GTags Language Model Tools: ${err.message}`);
    }
  },
  deactivate() {
    closeDB();
  }
};