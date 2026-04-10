const { parseAndStoreTags } = require('./store');
const {initDB, closeDB } = require('./database');
const argv = process.argv;  

const channel = {
    appendLine: (msg) => console.log(msg),
    show: () => {},
    hide: () => {}
}

const exeCmds = {
    global : 'global',
    gtags : 'gtags',
    ctags : 'ctags',
};

const root = argv[2];
(async () => {
    channel.appendLine(`Initializing database at ${root}...`);
    initDB(root);
    await parseAndStoreTags(channel, root, exeCmds);
    closeDB();
})();