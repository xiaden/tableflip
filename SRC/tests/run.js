'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const { readdirSync } = require('node:fs');
const path = require('node:path');

const { setupEnv, resetTestState } = require('./env.js');
const { setupTwoTableFixture } = require('./fixtures.js');

// ── Bootstrap ───────────────────────────────────────────────────────────────
before(async () => { await setupEnv(); });

beforeEach(() => {
  resetTestState();
  setupTwoTableFixture();
});

// ── Auto-discover case files ────────────────────────────────────────────────
const casesDir = path.join(__dirname, 'cases');
for (const f of readdirSync(casesDir).sort()) {
  if (f.endsWith('.test.js')) require(path.join(casesDir, f));
}
