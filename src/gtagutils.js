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
    const rl = readline.createInterface({
        input: gtagsStream,
        crlfDelay: Infinity
    });

    const db = getDB();
    const batchSize = 200000;
    let batchOps = [];

    for await (const line of rl) {
        try {
            if (!line.trim()) {
                continue;
            }

            const parts = line.split(/\s+/);
            if (parts.length < 3) {
                console.warn("Malformed line (parts < 3):", line);
                continue;
            }

            const tagName = parts[0];
            const file = parts[2];

            if (!tagName || !file) {
                console.warn("Invalid tagName/file:", line);
                continue;
            }

            const patternStartIndex = line.indexOf(file);
            if (patternStartIndex < 0) {
                console.warn("File not found in line:", line);
                continue;
            }

            const pattern = '^' + line.slice(patternStartIndex + file.length + 1).trim() + '$';

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
        } catch (err) {
            // **Critical safety**: catch ANY other errors but keep going
            console.error("Error while processing line:", line, err);
            continue;
        }
    }


    if (batchOps.length > 0) {
        await batchWriteIntoDB(batchOps);
    }
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

async function cleanGtagsFiles(root) {
    const gtagsFiles = ['GTAGS', 'GRTAGS', 'GPATH'];
    for (const file of gtagsFiles) {
        const filePath = path.join(root, file);
        if (fssync.existsSync(filePath)) {
            await fs.rm(filePath, {force: true});
        }
    }
}

module.exports = {
    parseToTagsFile,
    cleanGtagsFiles
};
