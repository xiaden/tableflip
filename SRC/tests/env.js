import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { quoteId } from '../js/core/sqldb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);

// ── Browser global test doubles ──────────────────────────────────────────────
global.window                = global;
global.self                  = global;
function makeStubElement() {
  return {
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    appendChild: () => {},
    removeChild: () => {},
    insertBefore: () => {},
    replaceChildren: () => {},
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    dataset: {},
    parentNode: null,
    offsetHeight: 0,
    offsetWidth: 0,
  };
}

global.document              = {};
global.document.getElementById = () => makeStubElement();
global.document.createElement = () => makeStubElement();
global.document.addEventListener = () => {};
global.document.createTextNode = () => ({});
global.document.querySelectorAll = () => [];
global.document.querySelector = () => null;try { global.location = { href: '', search: '' }; } catch (_) {
  Object.defineProperty(global, 'location', { value: { href: '', search: '' }, writable: true, configurable: true });
}
try { global.navigator = { userAgent: 'node' }; } catch (_) {
  Object.defineProperty(global, 'navigator', { value: { userAgent: 'node' }, writable: false, configurable: true });
}
global.requestAnimationFrame = fn => setTimeout(fn, 0);
global.setTimeout            = setTimeout;
global.clearTimeout          = clearTimeout;

// ── Shared mutable state (reset between tests) ──────────────────────────────
global._testDb    = null;
global._scriptsLoaded = false;

// ── Load vendored SheetJS into global scope ──────────────────────────────────
global.XLSX = require(path.join(SRC, 'js/vendor/xlsx.bundle.js'));

// ── Load app core scripts into global scope ─────────────────────────────────
// With ES modules, importing a file triggers its side effects (window.* aliases).
// Since global.window = global, window.fn = fn sets global.fn = fn.
// The module system handles dependency resolution, so just import the entry points.

async function loadScripts() {
  if (global._scriptsLoaded) return;

  // Import app modules — their side effects (window.* assignments) make functions
  // globally available for the test suite.
  await import(path.join(SRC, 'js/core/state.js'));
  await import(path.join(SRC, 'js/core/utils.js'));
  await import(path.join(SRC, 'js/core/sqldb.js'));
  await import(path.join(SRC, 'js/catalog/source-catalog.js'));
  await import(path.join(SRC, 'js/catalog/column-catalog.js'));
  await import(path.join(SRC, 'js/report/result-set.js'));
  await import(path.join(SRC, 'js/report/output-layout.js'));
  await import(path.join(SRC, 'js/query/sql-where.js'));
  await import(path.join(SRC, 'js/query/sql-aggregates.js'));
  await import(path.join(SRC, 'js/query/sql-calcs.js'));
  await import(path.join(SRC, 'js/query/sql-joins.js'));
  await import(path.join(SRC, 'js/query/sql-detail.js'));
  await import(path.join(SRC, 'js/query/sql-grouped.js'));
  await import(path.join(SRC, 'js/query/sql-totals.js'));
  await import(path.join(SRC, 'js/query/sql-subtotals.js'));
  await import(path.join(SRC, 'js/query/sql-renderer.js'));
  await import(path.join(SRC, 'js/query/query-plan.js'));
  await import(path.join(SRC, 'js/query/lookup-resolver.js'));
  await import(path.join(SRC, 'js/report/report-graph.js'));
  await import(path.join(SRC, 'js/report/report-output.js'));
  await import(path.join(SRC, 'js/report/engine.js'));
  await import(path.join(SRC, 'js/report/calc-validator.js'));
  await import(path.join(SRC, 'js/report/validation.js'));
  await import(path.join(SRC, 'js/ui/aggregation.js'));
  await import(path.join(SRC, 'js/core/state-schema.js'));
  await import(path.join(SRC, 'js/core/state-hydrator.js'));
  await import(path.join(SRC, 'js/core/state-applier.js'));

  global._scriptsLoaded = true;
}

// ── Initialize SQLite ──────────────────────────────────────────────────────
async function initSqlite() {
  if (global._testDb) return;

  const wasmPath = path.join(SRC, 'js/wasm/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const initSqlJs = require(path.join(SRC, 'js/wasm/sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary });
  global.sqlDb = new SQL.Database();
  global._testDb = global.sqlDb;
}

// ── Full environment setup ──────────────────────────────────────────────────
export async function setupEnv() {
  await loadScripts();
  await initSqlite();
}

// ── Test state reset ────────────────────────────────────────────────────────
export function resetTestState() {
  // Drop all user tables from the shared SQLite DB
  const existing = global.sqlDb.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  );
  for (const row of (existing[0] ? existing[0].values : [])) {
    try { global.sqlDb.run(`DROP TABLE IF EXISTS ${quoteId(row[0])}`); } catch (_) {}
  }

  // Reset window.db to default state
  Object.assign(global.db, {
    tables:       {},
    excludedRows: {},
    tableColors:  {},
    columnLabels: {},
    base:         '',
    baseCols:     null,
    stacks:       [],
    lookups:      [],
    calcStages:   [],
    selCols:      null,
    colOrder:     null,
    filters:      [],
    groupBy:      [],
    aggregates:   [],
    aggMode:            'none',
    aggModeState:       null,
    colTotals:          {},
    subtotalBy:         [],
    subtotalFns:        {},
    subtotalGrandTotal: true,
    subtotalSpacer:     false,
    subtotalOnTop:      false,
    mergedCols:         [],
    mergeGroupUnderline: false,
    colState:           null,
    sorts:              [],
    result:             null,
  });

  // Clear validation cache
  if (typeof invalidateValidation === 'function') invalidateValidation();
}

// ── Register cleanup for node:test ──────────────────────────────────────────
if (typeof afterEach === 'function') {
  afterEach(() => resetTestState());
}
