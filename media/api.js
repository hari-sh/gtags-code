const api = (function () {
    const vscode = acquireVsCodeApi();
    const pending = new Map();

    window.addEventListener('message', e => {
        const msg = e.data;

        if (msg.type === 'getTags:response') {
            const resolve = pending.get(msg.id);
            pending.delete(msg.id);
            resolve(msg.data);
        }
    });

    return {
        getTags: function (tagName) {
            return new Promise(resolve => {
                const id = Math.random().toString(36);

                pending.set(id, resolve);

                vscode.postMessage({
                    type: 'getTags',
                    id,
                    tagName
                });
            });
        },

        postFileData: function (tagName) {
            const id = Math.random().toString(36);
            vscode.postMessage({
                type: 'postFileInfo',
                id,
                tagName
            });
        }
    };
})();
