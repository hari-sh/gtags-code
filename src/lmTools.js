const vscode = require('vscode');
const path = require('path');
const { getValueFromDb, searchQuery } = require('./database');
const { getPattern, queryReferences } = require('./query');

function registerLanguageModelTools(context) {
  // Check if Language Model Tool API is available in current VS Code runtime
  if (!vscode.lm || typeof vscode.lm.registerTool !== 'function') {
    return;
  }

  const getWorkspaceFolder = () => {
    return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  };

  // 1. gtags_get_definition
  context.subscriptions.push(
    vscode.lm.registerTool('gtags_get_definition', {
      async invoke(options, token) {
        const workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: No workspace folder open.')
          ]);
        }

        const symbol = options.input?.symbol;
        if (!symbol) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: symbol parameter is required.')
          ]);
        }

        const tagInfo = await getValueFromDb(`tag:${symbol}`);
        if (!tagInfo) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`No definition found for symbol: ${symbol}`)
          ]);
        }

        const fullPath = path.isAbsolute(tagInfo.file) ? tagInfo.file : path.join(workspaceFolder, tagInfo.file);
        let line = null;
        let column = null;

        if (tagInfo.pattern) {
          let patternStr = tagInfo.pattern;
          let matchWhole = false;
          if (patternStr.startsWith('^')) patternStr = patternStr.substring(1);
          if (patternStr.endsWith('$')) {
            patternStr = patternStr.substring(0, patternStr.length - 1);
            matchWhole = true;
          }
          try {
            const ldata = await getPattern(fullPath, symbol, token, patternStr, matchWhole);
            if (ldata && ldata.found) {
              line = ldata.lno;
              column = ldata.charPos + 1;
            }
          } catch (_) {}
        }

        const locationStr = line ? `${fullPath}:${line}:${column || 1}` : fullPath;
        const result = {
          symbol,
          location: locationStr,
          file: fullPath,
          line: line,
          column: column
        };

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
        ]);
      }
    })
  );

  // 2. gtags_search_symbols
  context.subscriptions.push(
    vscode.lm.registerTool('gtags_search_symbols', {
      async invoke(options, token) {
        const workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: No workspace folder open.')
          ]);
        }

        const query = options.input?.query;
        const limit = typeof options.input?.limit === 'number' ? options.input.limit : 20;
        if (!query) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: query parameter is required.')
          ]);
        }

        const abortController = new AbortController();
        if (token && typeof token.onCancellationRequested === 'function') {
          token.onCancellationRequested(() => abortController.abort());
        }

        const results = await searchQuery(query, abortController.signal, limit);
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(JSON.stringify(results, null, 2))
        ]);
      }
    })
  );

  // 3. gtags_get_references
  context.subscriptions.push(
    vscode.lm.registerTool('gtags_get_references', {
      async invoke(options, token) {
        const workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: No workspace folder open.')
          ]);
        }

        const symbol = options.input?.symbol || options.input?.tag;
        if (!symbol) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: symbol parameter is required.')
          ]);
        }

        const config = vscode.workspace.getConfiguration('gtags-code');
        const globalCmd = config.get('globalCmd') || 'global';

        const { matches } = await queryReferences(workspaceFolder, symbol, globalCmd);
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(JSON.stringify(matches, null, 2))
        ]);
      }
    })
  );
}

module.exports = { registerLanguageModelTools };
