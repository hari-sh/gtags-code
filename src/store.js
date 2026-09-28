const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { getDB, initDB, cleanDB, closeDB, openDB, batchWriteIntoDB } = require('./database');
const { preflight, cleanGtagsFiles } = require('./preflight');
const { tokenize, elapsedTime } = require('./utils');
const BatchWriter = require('./batchWriter');
const exts = new Set(['.c', '.cpp', '.h', '.hpp', '.cc', '.hh', '.cxx', '.hxx']);

async function getSourceFiles(dir, root, out = []) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) {
            await getSourceFiles(fullPath, root, out);
        } else if (exts.has(path.extname(e.name))) {
            out.push(path.relative(root, fullPath));
        }
    }
    return out;
}


async function runGtags(root, files, channel, gtagsCmd) {
    channel.appendLine('Running Gtags...');
    const p = spawn(gtagsCmd, ['-v', '-f', '-'], { cwd: root });

    let processed = 0;
    const rl = readline.createInterface({
        input: p.stderr,
        crlfDelay: Infinity
    });
    rl.on('line', (line) => {
        if (!line.trim()) {
            return;
        }
        processed++;
        if (processed % 500 === 0) {
            channel.appendLine(`${processed}/${files.length} files processed by gtags...`);
        }
        if (processed === files.length) {
            channel.appendLine(`${processed}/${files.length} files processed by gtags...`);
        }
    });

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

async function runGlobal(root, channel, globalCmd) {
    channel.appendLine('Indexing structure types and functions...');
    const child = spawn(globalCmd, ['-c'], { cwd: root });
    const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity
    });

    const idWriter = new BatchWriter(200000, (processed) => {
        channel.appendLine(`${processed} IDs assigned...`);
    });

    let ind = 0;
    const tokenMap = new Map();

    for await (const line of rl) {
        try {
            const tagName = line.trim();
            if (!tagName) continue;

            const varid = ind + 1;
            await idWriter.add({ type: 'put', key: `id:${varid}`, value: tagName });
            const tokens = new Set(tokenize(tagName));
            for (const token of tokens) {
                let ids = tokenMap.get(token);
                if (!ids) {
                    ids = [];
                    tokenMap.set(token, ids);
                }
                ids.push(varid);
            }
            ind++;
        } catch (err) {
            console.error("Error while processing line:", line, err);
            continue;
        }
    }
    await idWriter.flush();
    
    channel.appendLine(`Created IDs for ${ind} symbols. Creating token index...`);

    const tokenWriter = new BatchWriter(50000, (processed) => {
        channel.appendLine(`${processed}/${tokenMap.size} tokens processed...`);
    });
    for (const [token, ids] of tokenMap) {
        await tokenWriter.add({ type: 'put', key: `token:${token}`, value: ids });
    }
    await tokenWriter.flush();
    
    channel.appendLine('All structure types and functions are indexed...');
}

async function parseToTagsFile(root, channel, exeCmds) {
    channel.appendLine('Finding Number of files to be indexed...');
    const files = await getSourceFiles(root, root);
    channel.appendLine(`Found ${files.length} source files(s) to index...`);
    await runGtags(root, files, channel, exeCmds.gtags);
    await runGlobal(root, channel, exeCmds.global);
}


async function parseAndStoreTags(channel, root, exeCmds) {
    channel.show();
    const start = performance.now();
    await cleanGtagsFiles(root, channel);
    await cleanDB();
    await openDB();
    await parseToTagsFile(root, channel, exeCmds);
    channel.appendLine('Post processing symbols...');
    channel.appendLine('Tags DataBase created successfully...');
    elapsedTime(start, performance.now(), channel);
}

module.exports = {
    parseAndStoreTags
};
