const vscode = require('vscode');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { searchQuery } = require('./database');

async function getlno(entry) {
    if (entry && entry.line) {
        const lineIndex = Math.max(0, parseInt(entry.line, 10) - 1);
        return new vscode.Selection(lineIndex, 0, lineIndex, 0);
    }
    return new vscode.Selection(0, 0, 0, 0);
}

async function openAndReveal(context, editor, document, sel) {
    const doc = await vscode.workspace.openTextDocument(document);
    const showOptions = {
        viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One,
        selection: sel
    };
    return await vscode.window.showTextDocument(doc, showOptions);
}

async function revealInCode(context, editor, entry) {
    if (!entry) return;
    const sel = await getlno(entry);
    return openAndReveal(context, editor, entry.file, sel);
}

function getTag(editor) {
    if (!editor) return '';
    const tag = editor.document.getText(editor.selection).trim();
    if (!tag) {
        const range = editor.document.getWordRangeAtPosition(editor.selection.active);
        if (range) {
            return editor.document.getText(range);
        }
    }
    return tag;
}

async function jumputil(editor, context, key, provider) {
    if (!key) return;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
    const matches = [];
    for await (const match of provider.queryDefinitions(workspaceFolder, key)) {
        matches.push(match);
    }

    if (!matches || matches.length === 0) {
        return vscode.window.showInformationMessage(`gtags-code: No tags found for ${key}`);
    }

    const options = matches.map(tag => {
        const relPath = vscode.workspace.workspaceFolders?.[0]
            ? path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, tag.file)
            : tag.file;

        return {
            file: tag.file,
            line: tag.line,
            label: relPath,
            description: `Line ${tag.line}`,
            detail: tag.code || `${relPath}:${tag.line}`
        };
    });

    if (options.length === 1) {
        return revealInCode(context, editor, options[0]);
    } else {
        return vscode.window.showQuickPick(options, {
            placeHolder: `Select definition for ${key}`
        }).then(opt => {
            if (opt) {
                return revealInCode(context, editor, opt);
            }
        });
    }
}

async function handleSearchTagsCommand(context, provider) {
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = 'Search tags...';
    quickPick.matchOnDescription = true;
    quickPick.filterItems = false;
    quickPick.matchOnDetail = false;

    let abortController = null;

    quickPick.onDidChangeValue(async (input) => {
        if (abortController) {
            abortController.abort();
        }

        if (!input) {
            quickPick.items = [];
            return;
        }

        abortController = new AbortController();
        const signal = abortController.signal;

        try {
            const items = await searchQuery(input, signal);

            if (signal.aborted) return;

            quickPick.items = items.map(r => ({
                label: r.label,
                description: r.description,
                alwaysShow: true
            }));
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Search aborted');
            } else {
                console.error(error);
            }
        }
    });

    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            jumputil(vscode.window.activeTextEditor, context, selected.label, provider);
        }
        quickPick.hide();
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
}

async function jump2tag(context, editor, provider) {
    const tag = getTag(editor);
    return jumputil(editor, context, tag, provider);
}

function getOrCreateTerminal(name) {
    const existing = vscode.window.terminals.find(t => t.name === name || t.name.startsWith('GTags References'));
    if (existing) {
        return existing;
    }
    return vscode.window.createTerminal(name);
}

function shellEscape(str) {
    return "'" + String(str).replace(/'/g, "'\\''") + "'";
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function displayMatchesInTerminal(symbol, matches, targetToHighlight) {
    const terminalTitle = `GTags References: ${symbol}`;
    const terminal = getOrCreateTerminal(terminalTitle);
    if (!terminal) return;

    terminal.show(true);

    const C_RESET = '\x1b[0m';
    const C_BOLD_CYAN = '\x1b[1;36m';
    const C_BOLD_YELLOW = '\x1b[1;33m';
    const C_CYAN = '\x1b[36m';
    const C_YELLOW = '\x1b[33m';
    const C_GRAY = '\x1b[90m';
    const C_RED = '\x1b[31m';

    const timestamp = new Date().toLocaleTimeString();
    const titleEscape = `\x1b]0;${terminalTitle}\x07`;
    const header = `${titleEscape}${C_BOLD_CYAN}=== References for '${C_BOLD_YELLOW}${symbol}${C_BOLD_CYAN}' [${matches.length} found at ${timestamp}] ===${C_RESET}`;
    const separator = `${C_GRAY}--------------------------------------------------------------------------------${C_RESET}`;

    let contentLines = [];
    if (matches.length === 0) {
        contentLines.push(`${C_RED}No matches found.${C_RESET}`);
    } else {
        const targetRegex = targetToHighlight ? new RegExp(`(?<![a-zA-Z0-9_])${escapeRegExp(targetToHighlight)}(?![a-zA-Z0-9_])`, 'g') : null;

        contentLines = matches.map(m => {
            let highlightedCode = m.code;
            if (targetRegex) {
                highlightedCode = m.code.replace(targetRegex, `${C_BOLD_YELLOW}${targetToHighlight}${C_RESET}`);
            }
            return `${C_CYAN}${m.file}${C_RESET}:${C_YELLOW}${m.line}${C_RESET}:${highlightedCode}`;
        });
    }

    const fullOutput = [header, ...contentLines, separator, ''].join('\n');
    const tmpFile = path.join(os.tmpdir(), '.gtags_references.txt');
    try {
        fs.writeFileSync(tmpFile, fullOutput, 'utf8');
        terminal.sendText(`printf '\\033[1A\\033[2K\\r'; cat ${shellEscape(tmpFile)}`);
    } catch (err) {
        console.error('gtags-code: Failed to write reference file', err);
    }
}

async function getReferencesInternal(context, editor, provider, symbolOverride) {
    const symbol = symbolOverride || getTag(editor);
    if (!symbol || !symbol.trim()) {
        vscode.window.showErrorMessage('No tag/symbol selected');
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();

    const target = symbol.trim();
    const matches = [];
    for await (const match of provider.queryReferences(workspaceFolder, symbol)) {
        matches.push(match);
    }
    displayMatchesInTerminal(symbol, matches, target);
}

module.exports = {
    jump2tag,
    getReferencesInternal,
    handleSearchTagsCommand,
    getTag,
    revealInCode
};
