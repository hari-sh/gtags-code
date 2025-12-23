const mode = process.argv[2];
if (!mode || !['debug', 'prod'].includes(mode)) {
  console.error('Usage: node switch-mode.js <debug|prod>');
  process.exit(1);
}

console.log(`Switched to ${mode} mode`);
