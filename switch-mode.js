const fs = require('fs');
const path = require('path');

const mode = process.argv[2];
if (!mode || !['debug', 'prod'].includes(mode)) {
  console.error('Usage: node switch-mode.js <debug|prod>');
  process.exit(1);
}

const packagePath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

if (mode === 'debug') {
  packageJson.main = './src/extension.js';
  console.log('Switched to debug mode');
} else {
  packageJson.main = './dist/extension.js';
  console.log('Switched to prod mode');
}

fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
