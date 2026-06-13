import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild-wasm';

await esbuild.initialize({});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const PKG = path.resolve(SRC, '..', 'pkg');

// 1. Clean output
fs.rmSync(PKG, { recursive: true, force: true });

// 2. Bundle app JS
console.log('[build] bundling…');
await esbuild.build({
  entryPoints: [path.join(SRC, 'preact/app.ts')],
  bundle: true,
  outfile: path.join(PKG, 'js/app.bundle.js'),
  logLevel: 'warning',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.tsx': 'tsx' },
  charset: 'utf8',
});

// 3. Copy static assets (css, vendor, wasm, index.html)
const assets = ['css', 'js/vendor', 'js/wasm'];
for (const name of assets) {
  fs.cpSync(path.join(SRC, name), path.join(PKG, name), { recursive: true });
}
fs.cpSync(path.join(SRC, 'index.html'), path.join(PKG, 'index.html'));

// 4. Inject bundle script into index.html
const htmlPath = path.join(PKG, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf-8');
html = html.replace(
  '</body>',
  '  <script src="js/app.bundle.js"></script>\n</body>',
);
fs.writeFileSync(htmlPath, html);

console.log(`[build] done → ${PKG}`);
