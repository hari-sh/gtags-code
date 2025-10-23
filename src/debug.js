const logger = require('./logger');
const {getDB} = require('./dbutils');

async function printdb()  {
    const db = getDB();
    await printToken(db);
    await printId(db);
    await printTag(db);
}

async function printToken(db)  {
    for await (const [key, value] of db.iterator({ gte: `token:`, lt: `token;` })) {
        logger.log(key + "(" +value.length + ")")
        logger.log(JSON.stringify(value));
    }
}

async function printId(db)  {
    for await (const [key, value] of db.iterator({ gte: `id:`, lt: `id;` })) {
        logger.log(key);
        logger.log(JSON.stringify(value));
    }
}

async function printTag(db)  {
    for await (const [key, value] of db.iterator({ gte: `tag:`, lt: `tag;` })) {
        logger.log(key + ":" +JSON.stringify(value.tagKind))
        logger.log(JSON.stringify(value.file));
    }
}

module.exports = {
    printdb
}