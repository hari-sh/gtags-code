const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const readline = require('readline');
const {spawn} = require('child_process');
const vscode = require('vscode');
const {getDB, batchWriteIntoDB} = require('./dbutils');
const config = vscode.workspace.getConfiguration('gtags-code');
const globalCmd = config.get('globalCmd');
const gtagsCmd = config.get('gtagsCmd');

const exts = new Set(['.c', '.cpp', '.h', '.hpp', '.cc', '.hh', '.cxx', '.hxx']);

async function getSourceFiles(dir, root, out = []) {
    for (const e of await fs.readdir(dir, {withFileTypes: true})) {
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) {
            await getSourceFiles(fullPath, root, out);
        } else if (exts.has(path.extname(e.name))) {
            out.push(path.relative(root, fullPath));
        }
    }
    return out;
}

async function runGtags(root) {
    const files = await getSourceFiles(root, root);
    const p = spawn(gtagsCmd, ['-f', '-'], {cwd: root});
    for (const f of files) {
        p.stdin.write(f + '\n');
    }
    p.stdin.end();
    return new Promise((resolve, reject) => {
        p.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`gtags exited with code ${code}`));
            }
        });
    });
}

async function processGtagsStream(gtagsStream) {
    const debugfile = fssync.createWriteStream(path.join(vscode.workspace.rootPath, '.cache', 'debugfile'));
    const rl = readline.createInterface({
        input: gtagsStream,
        crlfDelay: Infinity
    });

    const db = getDB();
    const batchSize = 1000;
    let batchOps = [];

    for await (const line of rl) {
        if (!line.trim()) return null;
        const parts = line.split(/\s+/);
        if (parts.length < 2) return null;
        const tagName = parts[0];
        const file = parts[2];
        const patternStartIndex = line.indexOf(file) + file.length + 1;
        const pattern = '^' + line.slice(patternStartIndex).trim() + '$';
        debugfile.write(`${tagName}, ${file}, ${pattern}\n`);
        batchOps.push({
            type: 'put',
            key: `tag:${tagName}`,
            value: {
                file,
                pattern,
                tagKind: 'f'
            }
        });

        if (batchOps.length >= batchSize) {
            await batchWriteIntoDB(batchOps);
            batchOps = [];
        }
    }

    if (batchOps.length > 0) {
        await batchWriteIntoDB(batchOps);
    }
    debugfile.end();
}

async function runGlobalCommand(cmd, args, cwd) {
    const child = spawn(cmd, args, {cwd});
    await processGtagsStream(child.stdout);
}

async function parseToTagsFile(root) {
    await runGtags(root);
    await runGlobalCommand(
            globalCmd,
            ['-x', '.'],
            root        
        );
    }

module.exports = {
    parseToTagsFile
};
