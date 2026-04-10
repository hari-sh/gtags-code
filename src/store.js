const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { getDB, initDB, cleanDB, closeDB, openDB, batchWriteIntoDB } = require('./database');
const { preflight, cleanGtagsFiles, ensureCtagsAvailable } = require('./preflight');
const { tokenize } = require('./tokens');
const { performance } = require('perf_hooks');

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
    const total = files.length;
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
        if(line.startsWith('OPENING'))  {
            processed++;
            if (processed % 500 === 0) {
                channel.appendLine(`${processed}/${total} files processed by ctags...`);
            }
            if (processed === total) {
                channel.appendLine(`${processed}/${total} files processed by ctags...`);
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
    let symbols = 0;
    let batchOps = [];

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
            
            batchOps.push({
                type: 'put',
                key: `tag:${tagName}`,
                value: {
                    file,
                    pattern,
                    tagKind: 'v'
                }
            });
            if (batchOps.length >= batchSize) {
                symbols += batchOps.length;
                channel.appendLine(`${symbols} variables processed...`);
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
        symbols += batchOps.length;
        await batchWriteIntoDB(batchOps);
        channel.appendLine(`${symbols} variables processed...`);
    }
    channel.appendLine('Variable indexing completed...');
}

async function runGtags(root, files, channel, gtagsCmd) {
    const total = files.length;
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
            channel.appendLine(`${processed}/${total} files indexed...`);
        }
        if (processed === total) {
            channel.appendLine(`${processed}/${total} files indexed...`);
            channel.appendLine('Finalizing file indexing...');
        }
    });

    for (const f of files) {
        p.stdin.write(f + '\n');
    }
    p.stdin.end();
    return new Promise((resolve, reject) => {
        p.on('close', (code) => {
            if (code === 0) {
                channel.appendLine('File indexing completed...');
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
    let symbols = 0;
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
                symbols += batchOps.length;
                channel.appendLine(`${symbols} symbols processed...`);
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
        symbols += batchOps.length;
        await batchWriteIntoDB(batchOps);
        channel.appendLine(`${symbols} symbols processed...`);
    }
    channel.appendLine('All structure types and functions are indexed...');
}

async function parseToTagsFile(root, channel, exeCmds) {
    channel.appendLine('Finding Number of files to be indexed...');
    const files = await getSourceFiles(root, root);
    channel.appendLine(`Found ${files.length} source files(s) to index...`);
    await runGtags(root, files, channel, exeCmds.gtags);
    await runCtags(root, files, channel, exeCmds.ctags);
    await runGlobal(root, channel, exeCmds.global);
}

async function assignIdsToVariables (channel) {
  const db = getDB();
  channel.appendLine('Creating Tags DataBase...');
  const alltags = [];
  for await (const [key, value] of db.iterator({ gte: 'tag:', lt: 'tag;' })) {
    alltags.push(key.slice(4));
  }
  alltags.sort((a,b) => a.length - b.length);
  
  const idbatch = db.batch();
  const tokenMap = new Map();
  for(let ind = 0; ind < alltags.length; ind++) {
    const varname = alltags[ind];
    const varid = ind + 1;
    idbatch.put(`id:${varid}`, varname);
    for (const token of tokenize(varname)) {
      if (!tokenMap.has(token)) tokenMap.set(token, new Set());
      tokenMap.get(token).add(varid);
    }
  }
  await idbatch.write();

  const tokenbatch = db.batch();
  for (const [token, ids] of tokenMap) {
    tokenbatch.put(`token:${token}`, Array.from(ids));
  }
  await tokenbatch.write();
  db.close();
  db.open();
};

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
    const sec = ((performance.now() - start) / 1000).toFixed(3);
    if (sec < 60) {
        const secRounded = Math.floor(sec);
        const millisec = Math.round((sec % 1) * 1000);
        channel.appendLine(`Elapsed: ${secRounded} seconds ${millisec} ms`);
    } else {
        const mins = Math.floor(sec / 60);
        const remainingSec = Math.floor(sec % 60);
        const millisec = Math.round((sec % 1) * 1000);
        channel.appendLine(`Elapsed: ${mins} minutes ${remainingSec} seconds ${millisec} ms`);
    }
}

module.exports = {
    parseAndStoreTags
};
