const { cleanDB, openDB } = require('./database');
const { tokenize, elapsedTime, cleanWorkspace } = require('./utils');
const BatchWriter = require('./batchWriter');

/**
 * Controller Phase 1: Generate tags via the provider and wait for readiness.
 */
async function generateTags(channel, root, provider) {
    if (provider.clearCaches) await provider.clearCaches();
    await cleanWorkspace(root, provider.workspaceFilesToRemove, channel);

    if (provider.generateTags) {
        for await (const message of provider.generateTags(root)) {
            channel.appendLine(message);
        }
    }
}

/**
 * Controller Phase 2: Stream symbols from the provider and store them in the Tags DB.
 */
async function streamAndStoreSymbols(channel, root, provider) {
    channel.appendLine('Importing structure types and functions into Tags DB...');
    await cleanDB();
    await openDB();

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
            console.error("Error while processing symbol:", err);
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
    channel.appendLine('Tags DataBase created successfully...');
}

/**
 * Master Controller: Orchestrates tag generation followed by symbol streaming & DB storage.
 */
async function parseAndStoreTags(channel, root, provider) {
    channel.show();
    const start = performance.now();
    await generateTags(channel, root, provider);
    await streamAndStoreSymbols(channel, root, provider);
    elapsedTime(start, performance.now(), channel);
}

module.exports = {
    generateTags,
    streamAndStoreSymbols,
    parseAndStoreTags
};
