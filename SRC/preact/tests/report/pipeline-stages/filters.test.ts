import { describe, it, expect, afterEach } from 'vitest';
import { executeFilterStage } from '../../../report/pipeline-stages/filters';
import type { StageContext } from '../../../report/pipeline-stages/base';
import type { FilterSpec } from '../../../types';
import { execQuery } from '../../../core/sqldb';
import { standardSourceCatalog, standardTables, makeReportSpec } from '../../query/helpers';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    reportSpec: makeReportSpec(),
    tables: standardTables(),
    colMap: new Map(),
    sourceCatalog: standardSourceCatalog(),
    prevTableName: '_pipeline_stage_0',
    stageIndex: 3,
    outputColumns: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
    ...overrides,
  };
}

function dropTemps() {
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"'); } catch { /* ignore */ }
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_3"'); } catch { /* ignore */ }
}

function createPrevTable() {
  execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
  execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" AS SELECT * FROM "Orders"`);
}

function readStage3(): Record<string, unknown>[] {
  return execQuery('SELECT * FROM "_pipeline_stage_3"');
}

function filter(col: string, op: string, opts: Partial<FilterSpec> = {}): FilterSpec {
  return {
    col,
    op,
    val: opts.val,
    vals: opts.vals ?? null,
    enabled: opts.enabled !== undefined ? opts.enabled : true,
    ...opts,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('executeFilterStage', () => {
  afterEach(() => { dropTemps(); });

  it('should pass-through when no filters', () => {
    createPrevTable();
    const ctx = makeCtx();
    const result = executeFilterStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
    expect(result.outputColumns).toEqual(ctx.outputColumns);
  });

  it('should pass-through when all filters disabled', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'equals', { val: 'Acme Corp', enabled: false })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeFilterStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should pass-through when filter has no column', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [{ col: '', op: 'equals', val: 'x', vals: null, enabled: true }],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeFilterStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should filter with equals operator', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'equals', { val: 'Acme Corp', vals: ['Acme Corp'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row['Company']).toBe('Acme Corp');
    }
  });

  it('should filter with not equals operator', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'not equals', { val: 'Acme Corp', vals: ['Acme Corp'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row['Company']).not.toBe('Acme Corp');
    }
  });

  it('should filter with contains operator (LIKE)', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'contains', { val: 'me', vals: ['me'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    // "Acme Corp" contains "me" → 3 rows
    expect(rows.length).toBe(3);
  });

  it('should filter with not contains operator', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'not contains', { val: 'me', vals: ['me'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(String(row['Company'])).not.toContain('me');
    }
  });

  it('should filter with starts with operator', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'starts with', { val: 'Ac', vals: ['Ac'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    expect(rows.length).toBe(3); // Acme Corp
  });

  it('should filter with ends with operator', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'ends with', { val: 'Inc', vals: ['Inc'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    expect(rows.length).toBe(2); // Beta Inc
  });

  it('should filter with greater than operator (CAST to TEXT)', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Amount', 'greater than', { val: '500', vals: ['500'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    // CAST(Amount AS TEXT) > '500' uses lexicographic comparison in SQLite.
    // Amount is stored as REAL, so CAST produces '150.0', '275.0', '99.5', '500.0', '0.0', '820.0', '310.0'
    // Lexicographically: '500.0' > '500' (longer), '820.0' > '500', '99.5' > '500' (9 > 5)
    // So 3 rows should match: ORD-003 (99.5), ORD-004 (500.0), ORD-007 (820.0)
    expect(rows.length).toBe(3);
    const orderIds = rows.map(r => r['OrderId']).sort();
    expect(orderIds).toEqual(['ORD-003', 'ORD-004', 'ORD-007']);
  });

  it('should filter with less than operator', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Amount', 'less than', { val: '100', vals: ['100'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('should filter with is empty operator (matches NULL and empty string)', () => {
    // Insert a row with NULL Amount and one with empty Status
    execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
    execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" AS SELECT * FROM "Orders"`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('ORD-099', 'NullCo', 'Nobody', '', NULL, '2025-01-01', 'Nowhere')`);

    const spec = makeReportSpec({
      filters: [filter('Amount', 'is empty', { vals: [] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    // Should match the row with NULL Amount
    const nullRow = rows.find(r => r['OrderId'] === 'ORD-099');
    expect(nullRow).toBeDefined();
  });

  it('should filter with is not empty operator', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Amount', 'is not empty', { vals: [] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    // ORD-006 has null Amount — should be excluded
    const ord006 = rows.find(r => r['OrderId'] === 'ORD-006');
    expect(ord006).toBeUndefined();
    // Other rows should be present
    expect(rows.length).toBe(7);
  });

  it('should escape LIKE wildcards in values (% and _)', () => {
    // Create a table with values containing % and _
    execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
    execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" (
      "OrderId" TEXT, "Company" TEXT, "Contact" TEXT, "Status" TEXT,
      "Amount" REAL, "OrderDate" TEXT, "Region" TEXT
    )`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('1', '100% Corp', 'A', 'Open', 10, '2025-01-01', 'X')`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('2', '100X Corp', 'B', 'Open', 20, '2025-01-01', 'X')`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('3', 'Other', 'C', 'Open', 30, '2025-01-01', 'X')`);

    // Search for literal "100%" — should only match row 1, not row 2
    const spec = makeReportSpec({
      filters: [filter('Company', 'contains', { val: '100%', vals: ['100%'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    expect(rows.length).toBe(1);
    expect(rows[0]['OrderId']).toBe('1');
  });

  it('should escape LIKE wildcards for underscore', () => {
    execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
    execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" (
      "OrderId" TEXT, "Company" TEXT, "Contact" TEXT, "Status" TEXT,
      "Amount" REAL, "OrderDate" TEXT, "Region" TEXT
    )`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('1', 'A_B Corp', 'A', 'Open', 10, '2025-01-01', 'X')`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('2', 'AXB Corp', 'B', 'Open', 20, '2025-01-01', 'X')`);

    // Search for literal "A_B" — should only match row 1, not row 2
    const spec = makeReportSpec({
      filters: [filter('Company', 'contains', { val: 'A_B', vals: ['A_B'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    expect(rows.length).toBe(1);
    expect(rows[0]['OrderId']).toBe('1');
  });

  it('should handle multiple values (OR within filter)', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'equals', { vals: ['Acme Corp', 'Beta Inc'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    // Acme Corp (3) + Beta Inc (2) = 5
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(['Acme Corp', 'Beta Inc']).toContain(row['Company']);
    }
  });

  it('should AND multiple filters together', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [
        filter('Company', 'equals', { vals: ['Acme Corp'] }),
        filter('Status', 'equals', { vals: ['Open'] }),
      ],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    // Acme Corp AND Open: ORD-001, ORD-003
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row['Company']).toBe('Acme Corp');
      expect(row['Status']).toBe('Open');
    }
  });

  it('should handle filter with single val via .val field (not .vals)', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [{ col: 'Region', op: 'equals', val: 'North', vals: null, enabled: true }],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    // North region: ORD-001, ORD-003, ORD-008
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row['Region']).toBe('North');
    }
  });

  it('should handle SQL injection in column names via quoteId', () => {
    execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
    execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" (
      "col""name" TEXT, "Other" TEXT
    )`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('test', 'a')`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('other', 'b')`);

    const spec = makeReportSpec({
      filters: [filter('col"name', 'equals', { val: 'test', vals: ['test'] })],
      outputColumns: ['col"name', 'Other'],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeFilterStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_3');
    const rows = readStage3();
    expect(rows.length).toBe(1);
    expect(rows[0]['col"name']).toBe('test');
  });

  it('should handle filter value with special characters', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Contact', 'equals', { val: "O'Brien", vals: ["O'Brien"] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeFilterStage(ctx);
    const rows = readStage3();
    // No one named O'Brien in the data
    expect(rows.length).toBe(0);
  });

  it('should create temp table named _pipeline_stage_3', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'equals', { val: 'Acme Corp', vals: ['Acme Corp'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeFilterStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_3');
  });

  it('should preserve outputColumns through filter stage', () => {
    createPrevTable();
    const spec = makeReportSpec({
      filters: [filter('Company', 'equals', { val: 'Acme Corp', vals: ['Acme Corp'] })],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeFilterStage(ctx);
    expect(result.outputColumns).toEqual(ctx.outputColumns);
  });
});
