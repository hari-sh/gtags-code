const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');

function elapsedTime(start, end, channel) {
    const sec = ((end - start) / 1000).toFixed(3);
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

const tokenize = (name) => {
  return name
    .replace(/\.[a-zA-Z0-9]+$/, '')         // remove trailing file extensions like .c, .h, .cpp
    .replace(/([a-z])([A-Z])/g, '$1 $2')    // camelCase → split
    .replace(/[_\-\.\/]+/g, ' ')            // snake_case, kebab-case, dot-separated, paths
    .replace(/[^a-zA-Z0-9 ]/g, '')          // remove other symbols
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
};

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function checkDependencies(cmds) {
    for (const cmd of cmds || []) {
        try {
            await execFile(cmd, ['--version']);
        } catch {
            throw new Error(`Please install ${cmd} or provide its path in settings.`);
        }
    }
}

async function cleanWorkspace(workspaceRoot, files, channel) {
    if (channel && files && files.length > 0) channel.appendLine('Cleaning existing Tags DataBase...');
    for (const file of files || []) {
        const filePath = path.join(workspaceRoot, file);
        if (fssync.existsSync(filePath)) {
            await fs.rm(filePath, { force: true });
        }
    }
}

module.exports = {
    elapsedTime,
    tokenize,
    escapeRegExp,
    checkDependencies,
    cleanWorkspace
};