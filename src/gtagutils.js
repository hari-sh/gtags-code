const fs = require.promises;
const fssync = require('fs');
const path = require('path');
const readline = require('readline');
const {spawn} = require('child_process');
const vscode = require('vscode');

const exts = new Set(['.c', '.cpp', '.h', '.hpp', '.cc', '.hh', '.cxx', '.hxx']);

async function getSourceFiles(dir, out = []) {
    for (const e of await fs.readdir(dir, {withFileTypes: true})) {
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) {
            await getSourceFiles(fullPath, out);
        } else if (exts.has(path.extname(e.name))) {
            out.push(fullPath);
        }
    }
    return out;
}

async function runGtags(root) {
    const files = await getSourceFiles(root);
    const p = spawn(gtagsCmd, ['-f', '-'], {cwd: root});
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

function runCommandAndTransform(cmd, args, cwd, outfile, transformLine) {
    const child = spawn(cmd, args, {cwd});
    const rl = readline.createInterface({input: child.stdout});
    const outStream = fssync.createWriteStream(path.join(cwd, outfile));

    rl.on('line', (line) => {
        const transformed = transformLine(line);
        if (transformed) {
            outStream.write(transformed + '\n');
        }
    });

    child.on('close', (code) => {
        outStream.end();
        if (code !== 0) {
            console.error(`${cmd} exited with code ${code}`);
        }
    });
}

function transformGtagsLine(line) {
    if (!line.trim()) return null;
    const parts = line.split(/\s+/);
    if (parts.length < 2) return null;
    const funName = parts[0];
    const fileName = parts[2];
    const patternStartIndex = line.indexOf(fileName) + fileName.length + 1;
    const pattern = line.slice(patternStartIndex).trim();
    const enclosedPattern = `/^${pattern}$/`;
    return `${funName}\t${fileName}\t${enclosedPattern};`;
}

async function parseToTagsFile(root) {
    return new Promise((resolve, reject) => {
        runCommandAndTransform(
            'gtags',
            ['-f', '-', '-d'],
            root,
            'tags',
            transformGtagsLine
        );
        resolve();
    });
}

module.exports = {
    parseToTagsFile
};
