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
    const child = spawn(globalCmd, ['-x', '.'], { cwd: root });
    const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity
    });

    const batchSize = 200000;
    const batchWriter = new BatchWriter(batchSize, (processed) => {
        channel.appendLine(`${processed} symbols processed...`);
    });

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
            const lineNo = parseInt(parts[1], 10);
            const file = parts[2];

            if (!tagName || !file || isNaN(lineNo)) {
                console.warn("Invalid tagName/file/lineNo:", line);
                continue;
            }

            await batchWriter.add({
                type: 'put',
                key: `tag:${tagName}`,
                value: {
                    file,
                    line: lineNo
                }
            });
        } catch (err) {
            // **Critical safety**: catch ANY other errors but keep going
            console.error("Error while processing line:", line, err);
            continue;
        }
    }
    await batchWriter.flush();
    channel.appendLine('All structure types and functions are indexed...');
}

async function parseToTagsFile(root, channel, exeCmds) {
    channel.appendLine('Finding Number of files to be indexed...');
    const files = await getSourceFiles(root, root);
    channel.appendLine(`Found ${files.length} source files(s) to index...`);
    await runGtags(root, files, channel, exeCmds.gtags);
    await runGlobal(root, channel, exeCmds.global);
}

async function assignIdsToVariables(channel) {
    const db = getDB();
    channel.appendLine('Creating Tags DataBase...');

    let totalTags = 0;
    const buckets = [];
    for await (const key of db.keys({ gte: 'tag:', lt: 'tag;' })) {
        const tag = key.slice(4);
        const len = tag.length;
        if (!buckets[len]) buckets[len] = [];
        buckets[len].push(tag);
        totalTags++;
    }

    const idWriter = new BatchWriter(200000, (processed) => {
        channel.appendLine(`${processed}/${totalTags} IDs assigned...`);
    });
    let ind = 0;
    const tokenMap = new Map();

    for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b];
        if (!bucket) continue;

        for (let i = 0; i < bucket.length; i++) {
            const varname = bucket[i];
            const varid = ind + 1;
            await idWriter.add({ type: 'put', key: `id:${varid}`, value: varname });
            const tokens = new Set(tokenize(varname));
            for (const token of tokens) {
                let ids = tokenMap.get(token);
                if (!ids) {
                    ids = [];
                    tokenMap.set(token, ids);
                }
                ids.push(varid);
            }
            ind++;
        }
    }
    await idWriter.flush();

    const tokenWriter = new BatchWriter(50000, (processed) => {
        channel.appendLine(`${processed}/${tokenMap.size} tokens processed...`);
    });
    for (const [token, ids] of tokenMap) {
        await tokenWriter.add({ type: 'put', key: `token:${token}`, value: ids });
    }
    await tokenWriter.flush();

    await db.close();
    await db.open();
}


async function parseAndStoreTags(channel, root, exeCmds) {
    channel.show();
    const start = performance.now();
    await cleanGtagsFiles(root, channel);
    await cleanDB();
    await openDB();
    await parseToTagsFile(root, channel, exeCmds);
    await assignIdsToVariables(channel);
    channel.appendLine('Post processing symbols...');
    channel.appendLine('Tags DataBase created successfully...');
    elapsedTime(start, performance.now(), channel);
}

module.exports = {
    parseAndStoreTags
};
