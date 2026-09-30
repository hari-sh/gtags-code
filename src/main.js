const vscode = require('vscode');
const { jump2tag, getReferencesInternal, handleSearchTagsCommand } = require('./query');
const { initDB, closeDB } = require('./database');
const { parseAndStoreTags } = require('./store');
const { createPreview, getTag } = require('./callers');
const { TagsCodeViewProvider } = require('./tagsCodePanel');
const TagsProviderFactory = require('./providers/factory');

const channel = vscode.window.createOutputChannel('gtags-code');
const config = vscode.workspace.getConfiguration('gtags-code');

const providerConfig = {
  engine: config.get('engine') || 'gtags',
  globalCmd: config.get('globalCmd') || 'global',
  gtagsCmd: config.get('gtagsCmd') || 'gtags'
};

const tagsProvider = TagsProviderFactory.create(providerConfig);

async function storeTags() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }
  await tagsProvider.checkDependencies();
  await parseAndStoreTags(channel, workspaceFolder.uri.fsPath, tagsProvider);
}

async function searchTags(context) {
  handleSearchTagsCommand(context, tagsProvider);
}

async function goToDefinition(context) {
  const editor = vscode.window.activeTextEditor;
  await jump2tag(context, editor, tagsProvider);
}

async function getReferences(context) {
  const editor = vscode.window.activeTextEditor;
  await getReferencesInternal(context, editor, tagsProvider);
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

  if (typeof tagsProvider.isFunctionSymbol === 'function') {
    const isFunction = await tagsProvider.isFunctionSymbol(
      workspaceFolder.uri.fsPath,
      gtagSymbol.trim()
    );

    if (!isFunction) {
      vscode.window.showErrorMessage(`${gtagSymbol.trim()} is not a function`);
      return;
    }
  }

  await vscode.commands.executeCommand('gtags.panelView.focus');
  if (provider) {
    provider.addTab(gtagSymbol.trim());
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
    context.subscriptions.push(vscode.commands.registerCommand('extension.getReferences', getReferences));
    
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
    tagsProvider.clearCaches?.();
    await closeDB();
  }
};