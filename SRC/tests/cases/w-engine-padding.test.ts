import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDERS_COLS, ORDERS_ROWS, CONTACTS_COLS, CONTACTS_ROWS } from '../fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('../../js/query/sql-totals.js', () => ({
  renderTotalsSql: vi.fn(),
}));

let runReport: any;
let invalidateValidation: any;
let sqlDb: any;
let renderTotalsSql: any;

beforeAll(async () => {
  const wasmPath = path.join(__dirname, '../../js/wasm/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  // @ts-expect-error - vendored CJS module
  const initSqlJsModule = await import('../../js/wasm/sql-wasm.js');
  const initSqlJs = initSqlJsModule.default || initSqlJsModule;
  const SQL = await initSqlJs({ wasmBinary });
  sqlDb = new SQL.Database();
  (globalThis as any).sqlDb = sqlDb;
  (globalThis as any).window.sqlDb = sqlDb;

  sqlDb.run(`CREATE TABLE Orders (${ORDERS_COLS.map(c => `"${c}"`).join(', ')})`);
  const ph1 = ORDERS_COLS.map(() => '?').join(', ');
  const stmt1 = sqlDb.prepare(`INSERT INTO Orders VALUES (${ph1})`);
  for (const row of ORDERS_ROWS) {
    stmt1.run(ORDERS_COLS.map(c => row[c as keyof typeof row] ?? null));
  }
  stmt1.free();

  sqlDb.run(`CREATE TABLE Contacts (${CONTACTS_COLS.map(c => `"${c}"`).join(', ')})`);
  const ph2 = CONTACTS_COLS.map(() => '?').join(', ');
  const stmt2 = sqlDb.prepare(`INSERT INTO Contacts VALUES (${ph2})`);
  for (const row of CONTACTS_ROWS) {
    stmt2.run(CONTACTS_COLS.map(c => row[c as keyof typeof row] ?? null));
  }
  stmt2.free();

  const engineMod = await import('../../js/report/engine.js');
  const valMod = await import('../../js/report/validation.js');
  const totalsMod = await import('../../js/query/sql-totals.js');
  runReport = engineMod.runReport;
  invalidateValidation = valMod.invalidateValidation;
  renderTotalsSql = totalsMod.renderTotalsSql;
});

describe('Engine totals padding', () => {
  let db: any;

  beforeEach(() => {
    db = (globalThis as any).db;
    invalidateValidation();
    vi.clearAllMocks();
  });

  function configureReport(overrides: Record<string, unknown> = {}) {
    Object.assign(db, {
      base: 'Orders',
      stacks: [],
      lookups: [],
      calcStages: [],
      selCols: null,
      colOrder: null,
      filters: [],
      sorts: [],
      groupBy: [],
      aggregates: [],
      aggMode: 'none',
      colTotals: {},
      subtotalBy: [],
      subtotalFns: {},
      subtotalGrandTotal: true,
      subtotalSpacer: false,
      subtotalOnTop: false,
      subtotalStrategy: 'combined',
      mergedCols: [],
      mergeGroupUnderline: false,
      excludedRows: {},
      ...overrides,
    });
    invalidateValidation();
  }

  it('should pad detail rows with null for new aggregate columns', () => {
    renderTotalsSql.mockImplementation((_plan: any, detailCols: string[]) => {
      const totalsCols = [...detailCols, 'SUM_Amount'];
      return {
        sql: `SELECT ${detailCols.map((c: string) => `"${c}"`).join(', ')}, SUM("Amount") AS "SUM_Amount" FROM "Orders"`,
        params: [],
        cols: totalsCols,
      };
    });

    configureReport({
      aggMode: 'totals',
      colTotals: { Amount: 'SUM' },
    });

    const result = runReport();
    expect(result).toBeTruthy();
    expect(result.metadata.aggMode).toBe('totals');
    expect(result.columns).toContain('SUM_Amount');
    for (const row of result.rows) {
      expect(row['SUM_Amount']).toBeNull();
    }
  });
});
