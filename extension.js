const path = require('path');
const fs = require('fs');

// Check for mode from environment variable or command line argument
const mode = process.env.GTAGS_MODE || process.argv[2] || 'prod';
if (mode && !['debug', 'prod'].includes(mode)) {
  console.error('Invalid mode. Use "debug" or "prod"');
  process.exit(1);
}

const productionBundlePath = path.join(__dirname, 'dist/main.js');
const developmentSourcePath = path.join(__dirname, 'src/main.js');

const bundleExists = fs.existsSync(productionBundlePath);
const sourceExists = fs.existsSync(developmentSourcePath);

console.log(`Extension mode: ${mode}`);
console.log(`Bundle exists: ${bundleExists} at ${productionBundlePath}`);
console.log(`Source exists: ${sourceExists} at ${developmentSourcePath}`);

const useProduction = mode === 'prod';

if (useProduction) {
  console.log('Loading production bundle');
  try {
    module.exports = require(productionBundlePath);
    console.log('Production bundle loaded successfully');
  } catch (e) {
    console.error('Failed to load production bundle:', e);
    if (sourceExists) {
      console.log('Falling back to development source');
      module.exports = require(developmentSourcePath);
    } else {
      throw e;
    }
  }
} else {
  console.log('Loading development source');
  module.exports = require(developmentSourcePath);
}