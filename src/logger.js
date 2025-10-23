const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

let logStream = null;
let logFilePath = null;

function initLogger() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('No workspace folder open. Logging disabled.');
    return;
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;
  const cacheDir = path.join(workspacePath, '.cache');

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir); // create .cache if it doesn't exist
  }

  logFilePath = path.join(cacheDir, 'ctags-code.log');
  logStream = fs.createWriteStream(logFilePath, { flags: 'w' });

  log('--- Extension activated ---');
}

function log(message) {
  if (!logStream) return;

//   const timestamp = new Date().toISOString();
  logStream.write(message + '\n');
}

function disposeLogger() {
  log('--- Extension deactivated ---');
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

function openLogFileInEditor() {
  if (logFilePath) {
    const uri = vscode.Uri.file(logFilePath);
    vscode.workspace.openTextDocument(uri).then(doc => {
      vscode.window.showTextDocument(doc, { preview: false });
    });
  }
}

module.exports = {
  initLogger,
  log,
  disposeLogger,
  openLogFileInEditor
};
