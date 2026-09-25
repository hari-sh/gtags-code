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

module.exports = {
    elapsedTime,
    tokenize
};