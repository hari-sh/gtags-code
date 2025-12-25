(function (exports) {
    'use strict';

    class VSCodeAPI {
        constructor() {
            this.vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;
            this.pending = new Map();
            this._initListener();
        }

        _initListener() {
            window.addEventListener('message', e => {
                const msg = e.data;
                if (msg.type === 'getTags:response') {
                    const resolve = this.pending.get(msg.id);
                    if (resolve) {
                        this.pending.delete(msg.id);
                        resolve(msg.data);
                    }
                }
            });
        }

        getTags(tagName) {
            if (!this.vscode) return Promise.resolve([]);
            return new Promise(resolve => {
                const id = Math.random().toString(36);
                this.pending.set(id, resolve);
                this.vscode.postMessage({
                    type: 'getTags',
                    id,
                    tagName
                });
            });
        }

        postFileInfo(data) {
            if (!this.vscode) return;
            const id = Math.random().toString(36);
            this.vscode.postMessage({
                type: 'postFileInfo',
                id,
                tagName: data
            });
        }
    }

    exports.VSCodeAPI = VSCodeAPI;

})(this.vscodeWrapper = {});
