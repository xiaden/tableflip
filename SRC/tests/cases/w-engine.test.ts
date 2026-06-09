import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDERS_COLS, ORDERS_ROWS, CONTACTS_COLS, CONTACTS_ROWS } from '../fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let runReport: any;
let _lkKeyPairs: any;
let invalidateValidation: any;
let sqlDb: any;

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
  runReport = engineMod.runReport;
  _lkKeyPairs = engineMod._lkKeyPairs;
  invalidateValidation = valMod.invalidateValidation;
});

describe('Report Engine', () => {
  let db: any;

  beforeEach(() => {
    db = (globalThis as any).db;
    invalidateValidation();
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

  describe('detail mode', () => {
    it('should return a result set for a basic detail report', () => {
      configureReport({
        selCols: new Set(['OrderId', 'Company', 'Amount']),
        colOrder: ['OrderId', 'Company', 'Amount'],
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.columns).toEqual(['OrderId', 'Company', 'Amount']);
      expect(result.rows.length).toBe(8);
      expect(result.metadata.aggMode).toBe('none');
    });

    it('should return all rows when no columns selected', () => {
      configureReport();
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.rows.length).toBe(8);
      expect(result.columns.length).toBeGreaterThan(0);
    });

    it('should apply filters', () => {
      configureReport({
        selCols: new Set(['OrderId', 'Status']),
        colOrder: ['OrderId', 'Status'],
        filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
      });
      const result = runReport();
      expect(result).toBeTruthy();
      for (const row of result.rows) {
        expect(row['Status']).toBe('Open');
      }
    });

    it('should apply sorts', () => {
      configureReport({
        selCols: new Set(['OrderId', 'Amount']),
        colOrder: ['OrderId', 'Amount'],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      const result = runReport();
      expect(result).toBeTruthy();
      const amounts = result.rows.map((r: any) => r['Amount']);
      for (let i = 1; i < amounts.length; i++) {
        if (amounts[i - 1] != null && amounts[i] != null) {
          expect(amounts[i - 1] >= amounts[i]).toBe(true);
        }
      }
    });
  });

  describe('grouped mode', () => {
    it('should return grouped results', () => {
      configureReport({
        aggMode: 'group',
        groupBy: ['Region'],
        aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'TotalAmount', enabled: true }],
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.metadata.aggMode).toBe('group');
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should include group-by column in results', () => {
      configureReport({
        aggMode: 'group',
        groupBy: ['Region'],
        aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'TotalAmount', enabled: true }],
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.columns).toContain('Region');
    });
  });

  describe('totals mode', () => {
    it('should return detail rows with totals row', () => {
      configureReport({
        aggMode: 'totals',
        colTotals: { Amount: 'SUM' },
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.metadata.aggMode).toBe('totals');
      expect(result.metadata.totalsRow).toBeTruthy();
      expect(result.rows.length).toBe(8);
    });

    it('should compute SUM totals', () => {
      configureReport({
        aggMode: 'totals',
        colTotals: { Amount: 'SUM' },
      });
      const result = runReport();
      expect(result).toBeTruthy();
      const totalsRow = result.metadata.totalsRow;
      expect(totalsRow).toBeTruthy();
      const sumKey = Object.keys(totalsRow).find(k => k.toLowerCase().includes('sum') || k.toLowerCase().includes('amount'));
      expect(sumKey).toBeTruthy();
    });
  });

  describe('subtotals mode', () => {
    it('should return subtotals result', () => {
      configureReport({
        aggMode: 'subtotals',
        subtotalBy: ['Region'],
        subtotalFns: { Amount: 'SUM' },
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.metadata.aggMode).toBe('subtotals');
      expect(result.metadata.hasSubtotals).toBe(true);
      expect(result.rows.length).toBeGreaterThan(8);
    });
  });

  describe('blocked validation', () => {
    it('should return null when report is blocked', () => {
      configureReport({ base: 'NonExistent' });
      const result = runReport();
      expect(result).toBeNull();
    });
  });

  describe('result set structure', () => {
    it('should have columns, rows, and metadata', () => {
      configureReport({
        selCols: new Set(['OrderId']),
        colOrder: ['OrderId'],
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result).toHaveProperty('columns');
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('metadata');
      expect(Array.isArray(result.columns)).toBe(true);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.metadata).toHaveProperty('rowCount');
      expect(result.metadata).toHaveProperty('aggMode');
      expect(result.metadata).toHaveProperty('generatedAt');
    });

    it('should have correct rowCount in metadata', () => {
      configureReport({
        selCols: new Set(['OrderId']),
        colOrder: ['OrderId'],
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.metadata.rowCount).toBe(result.rows.length);
    });
  });

  describe('_lkKeyPairs', () => {
    it('should return filtered keyPairs when given a valid array', () => {
      const lk = { keyPairs: [{ left: 'A', right: 'B' }, { left: '', right: 'C' }, { left: 'D', right: '' }, { left: 'E', right: 'F' }] };
      const result = _lkKeyPairs(lk);
      expect(result).toEqual([{ left: 'A', right: 'B' }, { left: 'E', right: 'F' }]);
    });

    it('should return empty array when keyPairs is not an array', () => {
      expect(_lkKeyPairs({ keyPairs: null })).toEqual([]);
      expect(_lkKeyPairs({ keyPairs: undefined })).toEqual([]);
      expect(_lkKeyPairs({ keyPairs: 'string' })).toEqual([]);
      expect(_lkKeyPairs({})).toEqual([]);
    });

    it('should return empty array when all keyPairs are invalid', () => {
      const lk = { keyPairs: [{ left: '', right: '' }, { left: null, right: 'X' }] };
      expect(_lkKeyPairs(lk)).toEqual([]);
    });
  });

  describe('totals mode without totals columns', () => {
    it('should return detail rows when renderTotalsSql returns null', () => {
      configureReport({
        aggMode: 'totals',
        colTotals: {},
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.metadata.aggMode).toBe('totals');
      expect(result.rows.length).toBe(8);
      expect(result.metadata.totalsRow).toBeFalsy();
    });

    it('should return detail rows when all colTotals are skip', () => {
      configureReport({
        aggMode: 'totals',
        colTotals: { Amount: 'skip', OrderId: 'skip' },
      });
      const result = runReport();
      expect(result).toBeTruthy();
      expect(result.metadata.aggMode).toBe('totals');
      expect(result.rows.length).toBe(8);
    });
  });
});
