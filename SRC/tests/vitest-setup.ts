import { beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setupTwoTableFixture } from './fixtures.js';
import { resetDbState } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Module-level setup (runs once when setup file is loaded) ──────────────────

// Load vendored SheetJS
(globalThis as any).XLSX = require(path.join(__dirname, '../js/vendor/xlsx.bundle.js'));

// Global references for hooks
let db: any;
let sqlDb: any;

// ── beforeAll: Async setup (SQLite + app modules) ─────────────────────────────
beforeAll(async () => {
  // 1. Create required DOM elements BEFORE importing app modules
  const requiredElementIds = [
    'filterItems', 'sortItems', 'colChips', 'aggItems', 'totalsItems', 
    'subtotalsItems', 'tablesList', 'previewSel', 'resultsWrap', 'previewWrap',
    'qEmpty', 'qBuilder', 'colCard', 'filterSortCard', 'runRow', 'runBtn',
    'runStatus', 'reportStatusPill', 'aggSection', 'aggAddRow', 'aggHint',
    'totalsSection', 'subtotalsSection', 'mergeToggles', 'colBtnRow',
    'chkGrandTotal', 'chkSubtotalSpacer', 'chkSubtotalOnTop', 'chkMergeGroupUnderline'
  ];

  for (const id of requiredElementIds) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }

  // Add tab buttons and panels
  const tabs = ['query', 'preview', 'results'];
  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.dataset.tab = tab;
    document.body.appendChild(btn);
    
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id = `tab-${tab}`;
    document.body.appendChild(panel);
  }

  // 2. Initialize SQLite WASM
  const wasmPath = path.join(__dirname, '../js/wasm/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const initSqlJsModule = await import(path.join(__dirname, '../js/wasm/sql-wasm.js'));
  const initSqlJs = initSqlJsModule.default || initSqlJsModule;
  const SQL = await initSqlJs({ wasmBinary });
  sqlDb = new SQL.Database();
  (globalThis as any).sqlDb = sqlDb;

  // 3. Import app modules (DOM is now set up)
  await import(path.join(__dirname, '../js/core/state.js'));
  await import(path.join(__dirname, '../js/core/utils.js'));
  await import(path.join(__dirname, '../js/report/validation.js'));
  await import(path.join(__dirname, '../js/ui/views/filter-sort-card.js'));
  await import(path.join(__dirname, '../js/ui/views/output-card.js'));
  await import(path.join(__dirname, '../js/ui/aggregation.js'));
  await import(path.join(__dirname, '../js/ui/sidebar.js'));
  await import(path.join(__dirname, '../js/ui/tabs.js'));

  const queryPlanMod = await import(path.join(__dirname, '../js/query/query-plan.js'));
  const sourceCatalogMod = await import(path.join(__dirname, '../js/catalog/source-catalog.js'));
  const calcValidatorMod = await import(path.join(__dirname, '../js/report/calc-validator.js'));
  (globalThis as any).buildQueryPlan = queryPlanMod.buildQueryPlan;
  (globalThis as any).buildSourceCatalog = sourceCatalogMod.buildSourceCatalog;
  (globalThis as any).checkCalcError = calcValidatorMod.checkCalcError;

  // Set window.sqlDb after all modules are loaded (sqldb.ts sets it to null on load)
  if (typeof window !== 'undefined') (window as any).sqlDb = sqlDb;

  // 4. Get references
  db = (globalThis as any).db;

  // 5. Create tables
  setupTwoTableFixture(db, sqlDb);
});

// ── beforeEach: Cheap reset before each test ──────────────────────────────────
beforeEach(() => {
  // 1. Clear all data from tables (no DDL!)
  sqlDb.run('DELETE FROM Orders');
  sqlDb.run('DELETE FROM Contacts');

  // 2. Re-insert fixture data
  const { ORDERS_COLS, ORDERS_ROWS, CONTACTS_COLS, CONTACTS_ROWS } = require(path.join(__dirname, './fixtures.ts'));
  
  const ph1 = ORDERS_COLS.map(() => '?').join(', ');
  const stmt1 = sqlDb.prepare(`INSERT INTO Orders ("_rowno", ${ORDERS_COLS.map((c: string) => `"${c}"`).join(', ')}) VALUES (?, ${ph1})`);
  for (let i = 0; i < ORDERS_ROWS.length; i++) {
    const row = ORDERS_ROWS[i];
    stmt1.run([i, ...ORDERS_COLS.map((c: string) => row[c as keyof typeof row] ?? null)]);
  }
  stmt1.free();

  const ph2 = CONTACTS_COLS.map(() => '?').join(', ');
  const stmt2 = sqlDb.prepare(`INSERT INTO Contacts ("_rowno", ${CONTACTS_COLS.map((c: string) => `"${c}"`).join(', ')}) VALUES (?, ${ph2})`);
  for (let i = 0; i < CONTACTS_ROWS.length; i++) {
    const row = CONTACTS_ROWS[i];
    stmt2.run([i, ...CONTACTS_COLS.map((c: string) => row[c as keyof typeof row] ?? null)]);
  }
  stmt2.free();

  // 3. Reset db state
  resetDbState();
  
  // 4. Re-register tables after reset
  db.tables['Orders'] = { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 8 };
  db.tables['Contacts'] = { id: 'Contacts', name: 'Contacts', cols: ['Company', 'Contact', 'Email', 'Phone'], rowCount: 8 };
  db.base = 'Orders';
});

// ── afterAll: Cleanup after test file completes ───────────────────────────────
afterAll(() => {
  sqlDb.close();
});
