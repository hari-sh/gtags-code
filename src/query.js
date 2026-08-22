const { spawn, exec } = require('child_process');
const { getValueFromDb, getDB, batchWriteIntoDB, searchQuery } = require('./database');
let vscode;
try {
    vscode = require('vscode');
} catch (_) {
    vscode = null;
}
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');

async function getPattern(filePath, name, canceller, pattern, matchWhole) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    let lno = 0;
    let charPos = 0;
    let found = false;
    for await (const line of rl) {
        lno += 1;
        if ((matchWhole && line === pattern) || line.startsWith(pattern)) {
            found = true;
            charPos = Math.max(line.indexOf(name), 0);
            console.log(`gtags-code: Found '${pattern}' at ${lno}:${charPos}`);
            return { retval: false, found, lno, charPos };
        } else if (canceller && canceller.isCancellationRequested) {
            console.log('gtags-code: Cancelled pattern searching');
            return { retval: false, found, lno, charPos };
        }
    }
}

async function getlno(entry, document, sel, canceller) {
    if (entry.tagKind === 'F') {
        return await getFilelno(document, sel);
    } else {
        return await getlnoPattern(entry, canceller);
    }
}

async function getlnoPattern(entry, canceller) {
    let matchWhole = false;
    let pattern = entry.pattern;
    if (pattern.startsWith("^")) {
        pattern = pattern.substring(1, pattern.length);
    } else {
        console.error(`gtags-code: Unsupported pattern ${pattern}`);
        return;
    }

    if (pattern.endsWith("$")) {
        pattern = pattern.substring(0, pattern.length - 1);
        matchWhole = true;
    }
    console.log(pattern);
    const ldata = await getPattern(entry.file, entry.name, canceller, pattern, matchWhole);
    console.log(ldata);
    if (ldata.found) {
        return new vscode.Selection(ldata.lno - 1, ldata.charPos, ldata.lno - 1, ldata.charPos);
    }
}

async function getFilelno(document, sel) {
    if (!sel) {
        return new vscode.Selection(0, 0, 0, 0);
    }
    let pos = sel.end.translate(0, 1);
    let range = document.getWordRangeAtPosition(pos);
    if (range) {
        let text = document.getText(range);
        if (text.match(/[0-9]+/)) {
            const lno = Math.max(0, parseInt(text, 10) - 1);
            let charPos = 0;

            pos = range.end.translate(0, 1);
            range = document.getWordRangeAtPosition(pos);
            if (range) {
                text = document.getText(range);
                if (text.match(/[0-9]+/)) {
                    charPos = Math.max(0, parseInt(text) - 1);
                }
            }
            console.log(`gtags-code: Resolved file position to line ${lno + 1}, char ${charPos + 1}`);
            return new vscode.Selection(lno, charPos, lno, charPos);
        }
    }
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
    const document = editor ? editor.document : null;
    const triggeredSel = editor ? editor.selection : null;
    const sel = await getlno(entry, document, triggeredSel);
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

async function jumputil(editor, context, key) {
    if (!key) return;
    const value = await getValueFromDb(`tag:${key}`);
    if (value) {
        console.log('Found:', value);
        const options = [value].map(tag => {
            if (!path.isAbsolute(tag.file)) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    tag.file = path.join(workspaceFolder.uri.fsPath, tag.file);
                }
            }
            tag.description = "";
            tag.label = tag.file;
            tag.detail = tag.pattern;
            tag.lno = 0;
            return tag;
        });
        if (!options.length) {
            return vscode.window.showInformationMessage(`gtags-code: No tags found for ${key}`);
        } else if (options.length === 1) {
            return revealInCode(context, editor, options[0]);
        } else {
            return vscode.window.showQuickPick(options).then(opt => {
                return revealInCode(context, editor, opt);
            });
        }
    } else {
        console.log('Key not found');
    }
}

async function handleSearchTagsCommand(context) {
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = 'Search tags...';
    quickPick.matchOnDescription = true;
    quickPick.filterItems = false;
    quickPick.matchOnDescription = false;
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
            jumputil(vscode.window.activeTextEditor, context, selected.label);
        }
        quickPick.hide();
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
}

async function jump2tag(context) {
    const editor = vscode.window.activeTextEditor;
    const tag = getTag(editor);
    return jumputil(editor, context, tag);
}

function getOrCreateTerminal(name) {
    if (!vscode) return null;
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

async function queryReferences(workspaceFolder, symbol, globalCmd = 'global') {
    if (!symbol || !symbol.trim()) return { matches: [], target: '' };

    symbol = symbol.trim();
    const match = symbol.match(/((?:->|\.)(\w+))$/);
    let lastProperty, precedingPartWithDelimiter;
    if (match) {
        lastProperty = match[2];
        precedingPartWithDelimiter = symbol.substring(0, symbol.length - lastProperty.length);
    } else if (/^\w+$/.test(symbol)) {
        lastProperty = symbol;
        precedingPartWithDelimiter = '';
    } else {
        lastProperty = symbol;
        precedingPartWithDelimiter = '';
    }

    const target = precedingPartWithDelimiter ? (precedingPartWithDelimiter + lastProperty) : lastProperty;
    const seenLines = new Set();
    const results = [];

    const handleLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed || seenLines.has(trimmed)) return;
        seenLines.add(trimmed);

        if (precedingPartWithDelimiter && !trimmed.includes(precedingPartWithDelimiter)) {
            return;
        }

        const m = trimmed.match(/^([^:]+):(\d+):(.*)$/);
        if (m) {
            const [, file, lineNo, code] = m;
            const fullPath = path.isAbsolute(file) ? file : path.join(workspaceFolder, file);
            results.push({
                file: fullPath,
                line: parseInt(lineNo, 10),
                code: code.trim()
            });
        }
    };

    const streamGlobal = (args) => new Promise((resolve) => {
        const proc = spawn(globalCmd, args, { cwd: workspaceFolder });
        const rl = readline.createInterface({
            input: proc.stdout,
            crlfDelay: Infinity
        });
        rl.on('line', handleLine);
        proc.on('close', () => resolve());
        proc.on('error', (err) => {
            console.error(`gtags-code: Error spawning ${globalCmd}:`, err);
            resolve();
        });
    });

    await Promise.all([
        streamGlobal(['--result=grep', '-xs', lastProperty]),
        streamGlobal(['--result=grep', '-r', lastProperty])
    ]);

    return { matches: results, target };
}

async function querySymbolReferences(workspaceFolder, symbol, globalCmd = 'global') {
    return queryReferences(workspaceFolder, symbol, globalCmd);
}

async function getReferencesInternal(context, editor, symbolOverride) {
    const symbol = symbolOverride || getTag(editor);
    if (!symbol || !symbol.trim()) {
        if (vscode) vscode.window.showErrorMessage('No tag/symbol selected');
        return;
    }

    const config = vscode ? vscode.workspace.getConfiguration('gtags-code') : null;
    const globalCmd = (config && config.get('globalCmd')) || 'global';
    const workspaceFolder = vscode?.workspace?.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();

    const { matches, target } = await queryReferences(workspaceFolder, symbol, globalCmd);
    displayMatchesInTerminal(symbol, matches, target);
}

async function getSymbolReferencesInternal(context, editor, symbol) {
    return getReferencesInternal(context, editor, symbol);
}

module.exports = {
    jump2tag,
    getReferencesInternal,
    getSymbolReferencesInternal,
    handleSearchTagsCommand,
    getPattern,
    getlnoPattern,
    queryReferences,
    querySymbolReferences
};
