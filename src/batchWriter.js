const { batchWriteIntoDB } = require('./database');

class BatchWriter {
    constructor(batchSize, onFlush) {
        this.batchSize = batchSize;
        this.onFlush = onFlush;
        this.ops = new Array(batchSize);
        this.index = 0;
        this.processed = 0;
        this.pendingWrite = Promise.resolve();
    }

    async add(op) {
        this.ops[this.index++] = op;
        if (this.index >= this.batchSize) {
            const previousWrite = this.pendingWrite;
            this._queueFlush();
            await previousWrite;
        }
    }

    _queueFlush() {
        if (this.index === 0) return;
        
        const operationCount = this.index;
        const flushOps = this.index === this.batchSize ? this.ops : this.ops.slice(0, operationCount);
        this.ops = new Array(this.batchSize);
        this.index = 0;
        
        this.pendingWrite = this.pendingWrite.then(async () => {
            await batchWriteIntoDB(flushOps);
            this.processed += operationCount;
            if (this.onFlush) {
                this.onFlush(this.processed);
            }
        });
    }

    async flush() {
        this._queueFlush();
        await this.pendingWrite;
    }
}

module.exports = BatchWriter;
