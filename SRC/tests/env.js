'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC = path.resolve(__dirname, '..');

// ── Browser global shims ────────────────────────────────────────────────────
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
try { global.location = { href: '', search: '' }; } catch (_) {
  Object.defineProperty(global, 'location', { value: { href: '', search: '' }, writable: true, configurable: true });
}
try { global.navigator = { userAgent: 'node' }; } catch (_) {
  Object.defineProperty(global, 'navigator', { value: { userAgent: 'node' }, writable: false, configurable: true });
}
global.requestAnimationFrame = fn => setTimeout(fn, 0);
global.setTimeout            = setTimeout;
global.clearTimeout          = clearTimeout;

// ── Shared mutable state (reset between tests) ──────────────────────────────
global._testDb    = null;   // SQL.Database instance
global._scriptsLoaded = false;

// ── Load vendored SheetJS into global scope ──────────────────────────────────
global.XLSX = require(path.join(SRC, 'js/vendor/xlsx.bundle.js'));

// ── Load app core scripts into global scope ─────────────────────────────────
const CORE_SCRIPTS = [
  'js/core/state.js',
  'js/core/utils.js',
  'js/core/sqldb.js',
  'js/catalog/source-catalog.js',
  'js/catalog/column-catalog.js',
  'js/report/result-set.js',
  'js/report/output-layout.js',
  'js/query/sql-where.js',
  'js/query/sql-aggregates.js',
  'js/query/sql-calcs.js',
  'js/query/sql-joins.js',
  'js/query/sql-detail.js',
  'js/query/sql-grouped.js',
  'js/query/sql-totals.js',
  'js/query/sql-subtotals.js',
  'js/query/sql-renderer.js',
  'js/query/query-plan.js',
  'js/query/lookup-resolver.js',
  'js/report/report-graph.js',
  'js/report/report-output.js',
  'js/report/engine.js',
  'js/report/calc-validator.js',
  'js/report/validation.js',
  'js/ui/aggregation.js',
];

function loadScripts() {
  if (global._scriptsLoaded) return;
  for (const rel of CORE_SCRIPTS) {
    const p  = path.join(SRC, rel);
    const code = fs.readFileSync(p, 'utf-8');
    try {
      vm.runInThisContext(code, { filename: rel });
    } catch (e) {
      console.error(`Failed to load ${rel}:`, e.message);
      throw e;
    }
  }
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
async function setupEnv() {
  loadScripts();
  await initSqlite();
}

// ── Test state reset ────────────────────────────────────────────────────────
function resetTestState() {
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

module.exports = { setupEnv, resetTestState };
