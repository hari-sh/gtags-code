const path = require('path');
const fs = require('fs');

// Check for mode from environment variable or command line argument
const mode = process.env.GTAGS_MODE || process.argv[2];
if (mode && !['debug', 'prod'].includes(mode)) {
  console.error('Invalid mode. Use "debug" or "prod"');
  process.exit(1);
}

const productionBundlePath = path.join(__dirname, 'dist/main.js');
const developmentSourcePath = path.join(__dirname, 'src/main.js');

const useProduction = mode === 'prod' || (!mode && fs.existsSync(productionBundlePath));

if (useProduction) {
  console.log('Loading production bundle');
  module.exports = require(productionBundlePath);
} else {
  console.log('Loading development source');
  module.exports = require(developmentSourcePath);
}