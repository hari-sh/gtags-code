const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const targets = [
  'darwin-x64+arm64',
  'linux-x64',
  'win32-x64'
];

for (const target of targets) {
  const src = path.join('node_modules/classic-level/prebuilds', target, 'classic-level.node');
  const destDir = path.join('dist/prebuilds', target);
  const dest = path.join(destDir, 'classic-level.node');

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Copied ${src} → ${dest}`);
}

// Build minified media assets in dist/media
const distMediaDir = path.join('dist', 'media');
fs.mkdirSync(distMediaDir, { recursive: true });

esbuild.buildSync({
  entryPoints: ['media/treeview.js'],
  bundle: false,
  minify: true,
  legalComments: 'none',
  outfile: path.join(distMediaDir, 'treeview.js')
});

esbuild.buildSync({
  entryPoints: ['media/treeview.css'],
  minify: true,
  outfile: path.join(distMediaDir, 'treeview.css')
});

fs.copyFileSync('media/d3.js', path.join(distMediaDir, 'd3.js'));

const rawHtml = fs.readFileSync('media/index.html', 'utf8');
const styleMatch = rawHtml.match(/<style>([\s\S]*?)<\/style>/);
const scriptMatch = rawHtml.match(/<script>([\s\S]*?)<\/script>/);

let minifiedHtml = rawHtml;
if (styleMatch) {
  const minCss = esbuild.transformSync(styleMatch[1], { loader: 'css', minify: true }).code;
  minifiedHtml = minifiedHtml.replace(styleMatch[0], `<style>${minCss}</style>`);
}
if (scriptMatch) {
  const minJs = esbuild.transformSync(scriptMatch[1], { loader: 'js', minify: true }).code;
  minifiedHtml = minifiedHtml.replace(scriptMatch[0], `<script>${minJs}</script>`);
}
fs.writeFileSync(path.join(distMediaDir, 'index.html'), minifiedHtml);
console.log('Built minified media assets in dist/media');

esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  sourcemap: false,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/main.js',
  external: ['vscode', 'node-gyp-build'],
  banner: {
    js: `// Bundled VSCode extension with classic-level and node-gyp-build`,
  },
}).then(() => {
  console.log('Build complete: dist/main.js');
}).catch(e => {
  console.error(e);
  process.exit(1);
});
