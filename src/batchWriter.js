const { batchWriteIntoDB } = require('./database');

class BatchWriter {
    constructor(batchSize, onFlush) {
        this.batchSize = batchSize;
        this.onFlush = onFlush;
        this.ops = new Array(batchSize);
        this.index = 0;
        this.processed = 0;
    }

    async add(op) {
        this.ops[this.index++] = op;
        if (this.index >= this.batchSize) {
            await this.flush();
        }
    }

    async flush() {
        if (this.index > 0) {
            const flushOps = this.index === this.batchSize ? this.ops : this.ops.slice(0, this.index);
            await batchWriteIntoDB(flushOps);
            this.processed += this.index;
            if (this.onFlush) {
                this.onFlush(this.processed);
            }
            this.ops = new Array(this.batchSize);
            this.index = 0;
        }
    }
}

module.exports = BatchWriter;
