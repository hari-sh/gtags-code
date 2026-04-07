const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const vscode = require('vscode');
const { getDB, initDB, cleanDB, closeDB, openDB, batchWriteIntoDB, assignIdsToVariables } = require('./database');
const { performance } = require('perf_hooks');
const config = vscode.workspace.getConfiguration('gtags-code');
const globalCmd = config.get('globalCmd');
const gtagsCmd = config.get('gtagsCmd');

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

async function runGtags(root, channel) {
    channel.appendLine('Finding Number of files to be indexed...');
    const files = await getSourceFiles(root, root);
    const total = files.length;
    channel.appendLine(`Found ${total} source files(s) to index...`);
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
                resolve();
            } else {
                reject(new Error(`gtags exited with code ${code}`));
            }
        });
    });
}

async function processGtagsStream(gtagsStream, channel) {
    const rl = readline.createInterface({
        input: gtagsStream,
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
                symbols += batchSize;
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
        await batchWriteIntoDB(batchOps);
    }
}

async function runGlobalCommand(cmd, args, cwd, channel) {
    const child = spawn(cmd, args, { cwd });
    await processGtagsStream(child.stdout, channel);
}

async function parseToTagsFile(root, channel) {
    await runGtags(root, channel);
    channel.appendLine('File indexing completed...');
    channel.appendLine('Indexing structure types and functions...');
    await runGlobalCommand(
        globalCmd,
        ['-x', '.'],
        root,
        channel
    );
    channel.appendLine('All structure types and functions are indexed...');
    /*
    channel.appendLine('Indexing global variables...');
    await runGlobalCommand(
            globalCmd,
            ['-sx', '.'],
            root,         
            channel
        );
    channel.appendLine('All global variables are indexed...');
    */
}

async function cleanGtagsFiles(root, channel) {
    channel.appendLine('Cleaning existing Tags DataBase...');
    const gtagsFiles = ['GTAGS', 'GRTAGS', 'GPATH'];
    for (const file of gtagsFiles) {
        const filePath = path.join(root, file);
        if (fssync.existsSync(filePath)) {
            await fs.rm(filePath, { force: true });
        }
    }
}

function getVersionAsync(cmd, versionArgs = ["--version"]) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, versionArgs, { shell: true });

        let output = "";

        child.stdout.on("data", d => output += d);
        child.stderr.on("data", d => output += d);

        child.on("error", () => {
            reject(new Error(`Please install gtags or provide gtags/global path in settings `));
        });

        child.on("close", (code) => {
            if (code === 0 || code === 1) {
                resolve(output.trim());
            } else {
                reject(new Error(`Please install gtags or provide gtags/global path in settings `));
            }
        });
    });
}

async function preflight() {
    const config = vscode.workspace.getConfiguration('gtags-code');
    const globalCmd = config.get('globalCmd');
    const gtagsCmd = config.get('gtagsCmd');
    await getVersionAsync(globalCmd);
    await getVersionAsync(gtagsCmd);
}

async function parseAndStoreTags(channel, root) {
    await preflight();
    channel.show();
    const start = performance.now();
    await cleanGtagsFiles(root, channel);
    await cleanDB();
    await openDB();
    await parseToTagsFile(root, channel);
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
