import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const PKG = path.resolve(SRC, '..', 'pkg');

// 1. Clean output
fs.rmSync(PKG, { recursive: true, force: true });

// 2. Bundle app JS
console.log('[build] bundling app…');
await esbuild.build({
  entryPoints: [path.join(SRC, 'js/app.ts')],
  bundle: true,
  outfile: path.join(PKG, 'js/app.bundle.js'),
  logLevel: 'warning',
});

// 3. Copy static assets
const assets = ['css', 'js/vendor', 'js/wasm', 'index.html'];
for (const name of assets) {
  fs.cpSync(path.join(SRC, name), path.join(PKG, name), { recursive: true });
}

// 4. Fix index.html in pkg: replace module script with bundle script
const htmlPath = path.join(PKG, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf-8');
html = html.replace(
  '<script type="module" src="js-dev/app.js"></script>',
  '<script src="js/app.bundle.js"></script>'
);
fs.writeFileSync(htmlPath, html);

console.log(`[build] done → ${PKG}`);
