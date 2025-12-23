const path = require('path');
const fs = require('fs');

const productionBundlePath = path.join(__dirname, 'dist/main.js');
const developmentSourcePath = path.join(__dirname, 'src/main.js');

if (fs.existsSync(productionBundlePath)) {
  module.exports = require(productionBundlePath);
} else {
  module.exports = require(developmentSourcePath);
}