const fs = require('fs').promises;
const path = require('path');
const { cleanDB, openDB } = require('./database');
const { tokenize, elapsedTime, cleanWorkspace } = require('./utils');
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


async function prepareProvider(root, channel, provider) {
    let files = [];
    if (provider.requiresSourceFiles !== false) {
        channel.appendLine('Finding Number of files to be indexed...');
        files = await getSourceFiles(root, root);
        channel.appendLine(`Found ${files.length} source files(s) to index...`);
    }
    
    if (provider.waitUntilReady) {
        channel.appendLine('Waiting for external engine to become ready...');
        await provider.waitUntilReady(root);
        channel.appendLine('External engine is ready.');
    } else {
        if (provider.generateTags) {
            for await (const message of provider.generateTags(root, files)) {
                channel.appendLine(message);
            }
        }
    }
}

async function parseToTagsFile(root, channel, provider) {
    channel.appendLine('External indexing is complete. Importing structure types and functions into Tags DB...');
    const idWriter = new BatchWriter(200000, (processed) => {
        channel.appendLine(`${processed} IDs assigned...`);
    });

    let ind = 0;
    const tokenMap = new Map();

    for await (const tagName of provider.streamSymbols(root)) {
        try {
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
            console.error("Error while processing line:", err);
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

async function parseAndStoreTags(channel, root, provider) {
    channel.show();
    const start = performance.now();
    if (provider.clearCaches) await provider.clearCaches();
    await cleanWorkspace(root, provider.workspaceFilesToRemove, channel);
    await prepareProvider(root, channel, provider);
    await cleanDB();
    await openDB();
    await parseToTagsFile(root, channel, provider);
    channel.appendLine('Post processing symbols...');
    channel.appendLine('Tags DataBase created successfully...');
    elapsedTime(start, performance.now(), channel);
}

module.exports = {
    parseAndStoreTags
};
