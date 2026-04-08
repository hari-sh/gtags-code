const vscode = require('vscode');
const config = vscode.workspace.getConfiguration('gtags-code');
const globalCmd = config.get('globalCmd');
const gtagsCmd = config.get('gtagsCmd');
const ctagsCmd = config.get('ctagsCmd');
const { spawn } = require('child_process');
const path = require('path');
const fssync = require('fs');
const fs = require('fs').promises;

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

function ensureCtagsAvailable() {
    return new Promise((resolve) => {
        if (!ctagsCmd) {
            resolve(false);
            return;
        }

        let child;
        try {
            child = spawn(ctagsCmd, ['--version'], { shell: true });
        } catch (err) {
            resolve(false);
            return;
        }

        child.on("error", () => {
            resolve(false);
        });

        child.on("close", (code) => {
            if (code === 0 || code === 1) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}

async function preflight() {
    await getVersionAsync(globalCmd);
    await getVersionAsync(gtagsCmd);
}

module.exports = {
    cleanGtagsFiles,
    preflight,
    ensureCtagsAvailable
};