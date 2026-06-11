import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const PKG = path.resolve(SRC, '..', 'pkg');

// 1. Bundle preact app JS
console.log('[build:preact] bundling…');
await esbuild.build({
  entryPoints: [path.join(SRC, 'preact/app.ts')],
  bundle: true,
  outfile: path.join(PKG, 'js/preact.bundle.js'),
  logLevel: 'warning',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.tsx': 'tsx' },
});

// 2. Copy static assets (css, vendor, wasm, preact_index.html → index.html)
const assets = ['css', 'js/vendor', 'js/wasm'];
for (const name of assets) {
  fs.cpSync(path.join(SRC, name), path.join(PKG, name), { recursive: true });
}

// Copy preact_index.html as index.html
fs.cpSync(path.join(SRC, 'preact_index.html'), path.join(PKG, 'index.html'));

// 3. Fix index.html in pkg: replace module script with bundle script
const htmlPath = path.join(PKG, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf-8');
html = html.replace(
  '<script type="module" src="preact-dev/app.js"></script>',
  '<script src="js/preact.bundle.js"></script>',
);
fs.writeFileSync(htmlPath, html);

console.log(`[build:preact] done → ${PKG}`);
