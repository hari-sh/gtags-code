const path = require('path');

let ClassicLevel;

if (__dirname.includes('src')) {
  // Debug mode: use standard classic-level from node_modules
  ClassicLevel = require('classic-level').ClassicLevel;
} else {
  // Prod mode: patch node-gyp-build to use local prebuilds
  const nodeGypBuild = require('node-gyp-build');
  const originalNodeGypBuild = nodeGypBuild;
  const nodeGypBuildPath = require.resolve('node-gyp-build');
  require.cache[nodeGypBuildPath].exports = function (p) {
    return originalNodeGypBuild(p || path.join(__dirname, 'prebuilds'));
  };
  ClassicLevel = require('classic-level').ClassicLevel;
}

const fs = require('fs').promises;
const { tokenize } = require('./tokens');
const { getSmallest20IntersectionWithAbort } = require('./search');

let db;
let dbpath;
let inputUnionMap = new Map();

function resetSearchMap() {
  inputUnionMap = new Map();
}

function initDB(rootPath) {
  if (!dbpath) {
    dbpath = path.join(rootPath, 'tagsdb');
  }
  if (!db) {
    db = new ClassicLevel(dbpath, { valueEncoding: 'json' });
  }
  return db;
}

function getDB() {
  if (!db) throw new Error('DB is not initialized.');
  return db;
}

function closeDB() {
  if (!db) throw new Error('DB is not initialized.');
  db.close();
}

async function openDB() {
  if (!db) throw new Error('DB is not initialized.');
  await db.open();
}

async function cleanDB() {
  try {
    // 1. Close DB if handle provided
    if (db) {
      try { await db.close(); } catch (_) { }
    }

    // 2. Fast path: try deleting entire folder
    try {
      await fs.rm(dbpath, { recursive: true, force: true });
      return; // done
    } catch (_) {
      // fall through to selective delete
    }

    // 3. Slow path: delete inside, skip locked .log files
    try {
      const entries = await fs.readdir(dbpath);
      for (const file of entries) {
        const full = path.join(dbpath, file);

        try {
          await fs.rm(full, { recursive: true, force: true });
        } catch (err) {
          // Skip locked log files silently
          if (file.endsWith(".log")) {
            continue;
          }
          // Ignore all errors as requested
          continue;
        }
      }
    } catch (_) {
      // folder missing — ignore silently
    }
  } catch (_) {
    // final safety blanket, ignore everything
  }
}


async function getValueFromDb(key) {
  try {
    const value = await db.get(key);
    return value;
  } catch (err) {
    if (err.notFound) {
      return null;
    } else {
      throw err;
    }
  }
}

async function batchWriteIntoDB(data) {
  try {
    await db.batch(data);
  } catch (err) {
    console.error('Batch write failed:', err);
  }
}

async function getIds(words, signal) {
  const groups = [];
  for (const word of words) {
    if (signal?.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }
    let ilist;
    if (inputUnionMap.has(word)) {
      ilist = inputUnionMap.get(word);
    } else {
      ilist = [];
      for await (const [key, value] of db.iterator({ gte: `token:${word}`, lt: `token:${word}~` })) {
        if (signal?.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }
        ilist.push(value);
      }
      inputUnionMap.set(word, ilist);
    }
    groups.push(ilist);
  }
  return getSmallest20IntersectionWithAbort(groups, signal);
}


const searchQuery = async (query, signal) => {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const results = [];
  const ids = await getIds(terms, signal);
  for (const id of ids.slice(0, 15)) {
    if (signal?.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }
    try {
      const variableName = await db.get(`id:${id}`);
      const meta = await db.get(`tag:${variableName}`);
      results.push({
        label: variableName,
        description: meta?.file || ''
      });
    } catch {
      console.log('Unable to get db value');
    }
  }
  return results;
};

module.exports = { initDB, getDB, openDB, cleanDB, closeDB, getValueFromDb, batchWriteIntoDB, searchQuery, resetSearchMap };
