const vscode = require('vscode');
const { jump2tag, getReferencesInternal, handleSearchTagsCommand, getTag } = require('./navigate');
const { initDB, closeDB } = require('./database');
const { parseAndStoreTags } = require('./store');
const { TagsCodeViewProvider } = require('./tagsCodePanel');
const TagsProviderFactory = require('./providers/factory');
const { checkDependencies } = require('./utils');

const channel = vscode.window.createOutputChannel('gtags-code');
const config = vscode.workspace.getConfiguration('gtags-code');

const providerConfig = {
  engine: config.get('engine') || 'gtags',
  globalCmd: config.get('globalCmd') || 'global',
  gtagsCmd: config.get('gtagsCmd') || 'gtags',
  externalCommand: config.get('externalCommand') || '',
  externalArgs: config.get('externalArgs') || [],
  externalIndexCommand: config.get('externalIndexCommand') || '',
  externalIndexArgs: config.get('externalIndexArgs') || [],
  externalEnv: config.get('externalEnv') || {},
  externalTimeout: config.get('externalTimeout') || 5000,
  externalReadyTimeout: config.get('externalReadyTimeout') || 600000,
  externalConcurrency: config.get('externalConcurrency') || 32
};

const tagsProvider = TagsProviderFactory.create(providerConfig, channel);

async function storeTags() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }
  await checkDependencies(tagsProvider.dependencies);
  await parseAndStoreTags(channel, workspaceFolder.uri.fsPath, tagsProvider);
}

async function searchTags(context) {
  handleSearchTagsCommand(context, tagsProvider);
}

async function goToDefinition(context) {
  const editor = vscode.window.activeTextEditor;
  await jump2tag(context, editor, tagsProvider);
}

async function getReferences(context, provider) {
  const editor = vscode.window.activeTextEditor;
  const gtagSymbol = getTag(editor);
  if (!gtagSymbol || !gtagSymbol.trim()) {
    vscode.window.showErrorMessage('No tag/symbol selected');
    return;
  }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }
  await vscode.commands.executeCommand('gtags.panelView.focus');
  if (provider) {
    provider.addTab(gtagSymbol.trim(), 'references');
  }
}

async function getCallers(context, provider) {
  const editor = vscode.window.activeTextEditor;
  const gtagSymbol = getTag(editor);
  if (!gtagSymbol || !gtagSymbol.trim()) {
    vscode.window.showErrorMessage('No tag/symbol selected');
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  await vscode.commands.executeCommand('gtags.panelView.focus');
  if (provider) {
    provider.addTab(gtagSymbol.trim(), 'callers');
  }
}

let tagsCodePanelProvider;

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
    context.subscriptions.push(vscode.commands.registerCommand('extension.getReferences', () => getReferences(context, tagsCodePanelProvider)));
    
    tagsCodePanelProvider = new TagsCodeViewProvider(context, tagsProvider);
    context.subscriptions.push(vscode.commands.registerCommand('extension.getCallers', () => getCallers(context, tagsCodePanelProvider)));
    
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('gtags.panelView', tagsCodePanelProvider, {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      })
    );
  },
  async deactivate() {
    if (tagsProvider.clearCaches) await tagsProvider.clearCaches();
    await closeDB();
  }
};