const { spawn } = require("child_process");
const vscode = require("vscode");
const config = vscode.workspace.getConfiguration("gtags");
const globalCmd = config.get("globalCommand") || "global";

function runGlobal(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(globalCmd, args, { cwd });

    let out = "";
    let err = "";

    p.stdout.on("data", d => (out += d.toString()));
    p.stderr.on("data", d => (err += d.toString()));

    p.on("close", code => {
      if (code !== 0 && !out) {
        reject(err || `global ${args.join(" ")} failed`);
        return;
      }
      resolve(out);
    });
  });
}

function parseGlobalX(output) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        symbol: parts[0],
        line: Number(parts[1]),
        file: parts[2],
        source: parts.slice(3).join(" ")
      };
    });
}

/* ------------------ cache ------------------ */

const fileFunctionCache = new Map();

/* ------------------ core logic ------------------ */

async function getFunctionsInFile(file, cwd) {
  if (fileFunctionCache.has(file)) {
    return fileFunctionCache.get(file);
  }

  const out = await runGlobal(["-xf", file], cwd);
  const funcs = parseGlobalX(out);

  fileFunctionCache.set(file, funcs);
  return funcs;
}

async function getEnclosingFunction(file, line, cwd) {
  const funcs = await getFunctionsInFile(file, cwd);
  return funcs.filter(f => f.line <= line).at(-1) || null;
}

async function getCallers(symbol, cwd) {
  const out = await runGlobal(["-rx", symbol], cwd);
  return parseGlobalX(out);
}

async function getCallersWithEnclosure(symbol, cwd) {
  const callers = await getCallers(symbol, cwd);

  for (const c of callers) {
    const enclosing = await getEnclosingFunction(c.file, c.line, cwd);
    c.enclosing = enclosing
      ? {
          name: enclosing.symbol,
          line: enclosing.line
        }
      : null;
  }

  return callers;
}

function mapByEnclosingFull(callers) {
  const map = new Map();

  for (const c of callers) {
    if (!c.enclosing) continue;

    const keyObj = {
      name: c.enclosing.name,
      file: c.file,          // enclosing function file
      line: c.line // enclosing function line
    };

    // stable string key
    const key = `${keyObj.name}|${keyObj.file}|${keyObj.line}`;

    if (!map.has(key)) {
      map.set(key, {
        enclosing: keyObj,
        callers: []
      });
    }

    map.get(key).callers.push(c);
  }

  return map;
}

const HEADERS_EXTENSIONS = [".h", ".hpp", ".hh", ".hxx"];

function isHeaderFile(file) {
  return HEADERS_EXTENSIONS.some(ext => file.endsWith(ext));
}

function removeHeadersAndDuplicates(enclosed) {
  const nonHeaders = enclosed.filter(
    e => !isHeaderFile(e.file)
  );
  const nameCounts = new Map();
  for (const e of nonHeaders) {
    const name = e.name ?? null;
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  const uniqueEnclosed = nonHeaders.filter(
    e => nameCounts.get(e.name) === 1
  );
  return uniqueEnclosed;
}

function getEnclosingInfoArray(callers) {
  const enclosed = callers
    .filter(c => c.enclosing)
    .map(c => ({
      name: c.enclosing.name,
      file: c.file,
      line: c.enclosing.line
    }));
    return removeHeadersAndDuplicates(enclosed);
}

/* ------------------ exports ------------------ */

module.exports = {
  getCallers,
  getCallersWithEnclosure,
  getEnclosingFunction,
  mapByEnclosingFull,
  getEnclosingInfoArray
};
