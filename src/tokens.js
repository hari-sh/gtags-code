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

module.exports = { tokenize };