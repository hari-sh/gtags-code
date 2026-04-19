const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { getDB, initDB, cleanDB, closeDB, openDB, batchWriteIntoDB } = require('./database');
const { preflight, cleanGtagsFiles, ensureCtagsAvailable } = require('./preflight');
const { tokenize } = require('./tokens');
const { performance } = require('perf_hooks');
const { elapsedTime } = require('./utils');
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

async function runCtags(root, files, channel, ctagsCmd) {
    if (!ctagsCmd) {
        channel.appendLine('Ctags path is not enabled. Skipping variable indexing...');
        return;
    }
    channel.appendLine('Running Ctags...');
    const p = spawn(ctagsCmd, ['-L', '-', '-f', '-', '--kinds-C=v', '--kinds-C++=v', '--verbose=yes'], { cwd: root });

    for (const f of files) {
        p.stdin.write(f + '\n');
    }
    p.stdin.end();

    let processed = 0;
    const rlerr = readline.createInterface({
        input: p.stderr,
        crlfDelay: Infinity
    });
    rlerr.on('line', (line) => {
        if (!line.trim()) {
            return;
        }
        if (line.startsWith('OPENING')) {
            processed++;
            if (processed % 500 === 0) {
                channel.appendLine(`${processed}/${files.length} files processed by ctags...`);
            }
            if (processed === files.length) {
                channel.appendLine(`${processed}/${files.length} files processed by ctags...`);
                channel.appendLine('Finalizing variable indexing...');
            }
        }
    });

    const rl = readline.createInterface({
        input: p.stdout,
        crlfDelay: Infinity
    });

    const db = getDB();
    const batchSize = 200000;
    const batchWriter = new BatchWriter(batchSize, (processed) => {
        channel.appendLine(`${processed} variables processed...`);
    });

    for await (const line of rl) {
        try {
            if (!line.trim() || line.startsWith('!_TAG_')) {
                continue;
            }
            const parts = line.split('\t');
            if (parts.length < 4) {
                console.warn("Malformed line (parts < 4):", line);
                continue;
            }
            const tagName = parts[0];
            const file = parts[1];

            if (!tagName || !file) {
                console.warn("Invalid tagName/file:", line);
                continue;
            }

            // Extract pattern from /^pattern$/ format, keeping ^ and $
            const pattern = parts[2].replace(/^[^/]*\/(.*)\/[^/]*$/, '$1');
            await batchWriter.add({
                type: 'put',
                key: `tag:${tagName}`,
                value: {
                    file,
                    pattern
                }
            });
        } catch (err) {
            // **Critical safety**: catch ANY other errors but keep going
            console.error("Error while processing line:", line, err);
            continue;
        }
    }
    await batchWriter.flush();
    channel.appendLine('Variable indexing completed...');
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

    const db = getDB();
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

            await batchWriter.add({
                type: 'put',
                key: `tag:${tagName}`,
                value: {
                    file,
                    pattern
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
    const ctagsPromise = runCtags(root, files, channel, exeCmds.ctags);
    await runGtags(root, files, channel, exeCmds.gtags);
    await runGlobal(root, channel, exeCmds.global);
    await ctagsPromise;
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
