import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, beforeEach } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { setupEnv, resetTestState } = await import('./env.js');
const { setupTwoTableFixture } = await import('./fixtures.js');

// ── Bootstrap ───────────────────────────────────────────────────────────────
before(async () => { await setupEnv(); });

beforeEach(() => {
  resetTestState();
  setupTwoTableFixture();
});

// ── Auto-discover case files ────────────────────────────────────────────────
const casesDir = path.join(__dirname, 'cases');
for (const f of readdirSync(casesDir).sort()) {
  if (f.endsWith('.test.js')) await import(path.join(casesDir, f));
}
