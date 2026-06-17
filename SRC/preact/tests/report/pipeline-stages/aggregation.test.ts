import { describe, it, expect, afterEach } from 'vitest';
import { executeAggregationStage } from '../../../report/pipeline-stages/aggregation';
import type { StageContext } from '../../../report/pipeline-stages/base';
import type { ReportSpec } from '../../../types';
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
    stageIndex: 5,
    outputColumns: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
    ...overrides,
  };
}

function dropTemps() {
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"'); } catch { /* ignore */ }
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_5"'); } catch { /* ignore */ }
}

function createPrevTable() {
  execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
  execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" AS SELECT * FROM "Orders"`);
}

function readStage5(): Record<string, unknown>[] {
  return execQuery('SELECT * FROM "_pipeline_stage_5"');
}

function aggSpec(overrides: Partial<ReportSpec['aggregation']> = {}): ReportSpec['aggregation'] {
  return {
    mode: 'none',
    groupBy: [],
    aggregates: [],
    colTotals: {},
    subtotalBy: [],
    subtotalFns: {},
    subtotalGrandTotal: true,
    subtotalSpacer: false,
    subtotalOnTop: false,
    subtotalStrategy: 'combined',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('executeAggregationStage', () => {
  afterEach(() => { dropTemps(); });

  // ── Detail mode ────────────────────────────────────────────────────────────

  describe('detail mode (none)', () => {
    it('should pass-through and return prevTableName', () => {
      createPrevTable();
      const spec = makeReportSpec({ aggregation: aggSpec({ mode: 'none' }) });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_0');
      expect(result.outputColumns).toEqual(ctx.outputColumns);
    });

    it('should pass-through for unknown mode', () => {
      createPrevTable();
      const spec = makeReportSpec({ aggregation: aggSpec({ mode: 'unknown' as any }) });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_0');
    });
  });

  // ── Grouped mode ───────────────────────────────────────────────────────────

  describe('grouped mode', () => {
    it('should create grouped aggregation with GROUP BY', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'group',
          groupBy: ['Company'],
          aggregates: [{ col: '*', fn: 'COUNT ROWS', alias: 'Count', enabled: true }],
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_5');
      const rows = readStage5();
      // 5 unique companies: Acme Corp, Beta Inc, Gamma LLC, Delta Co, Echo Ltd
      expect(rows.length).toBe(5);
      expect(result.outputColumns).toEqual(['Company', 'Count']);
    });

    it('should handle multiple aggregates (SUM, COUNT ROWS, AVG)', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'group',
          groupBy: ['Company'],
          aggregates: [
            { col: 'Amount', fn: 'SUM', alias: 'TotalAmount', enabled: true },
            { col: '*', fn: 'COUNT ROWS', alias: 'RowCount', enabled: true },
            { col: 'Amount', fn: 'AVG', alias: 'AvgAmount', enabled: true },
          ],
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputColumns).toEqual(['Company', 'TotalAmount', 'RowCount', 'AvgAmount']);
      const rows = readStage5();
      const acme = rows.find(r => r['Company'] === 'Acme Corp');
      expect(acme).toBeDefined();
      // Acme Corp: 150 + 99.5 + 310 = 559.5, count = 3
      expect(acme!['TotalAmount']).toBe(559.5);
      expect(acme!['RowCount']).toBe(3);
    });

    it('should pass-through when no groupBy and no aggregates', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({ mode: 'group', groupBy: [], aggregates: [] }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_0');
    });

    it('should use defaultAggAlias when alias is empty', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'group',
          groupBy: ['Company'],
          aggregates: [{ col: 'Amount', fn: 'SUM', alias: '', enabled: true }],
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      // defaultAggAlias('SUM', 'Amount') → 'Total Amount'
      expect(result.outputColumns).toContain('Total Amount');
    });

    it('should handle disabled aggregates', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'group',
          groupBy: ['Company'],
          aggregates: [
            { col: '*', fn: 'COUNT ROWS', alias: 'Count', enabled: true },
            { col: 'Amount', fn: 'SUM', alias: 'Total', enabled: false },
          ],
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputColumns).toEqual(['Company', 'Count']);
      expect(result.outputColumns).not.toContain('Total');
    });
  });

  // ── Totals mode ────────────────────────────────────────────────────────────

  describe('totals mode', () => {
    it('should create detail rows + totals row', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'totals',
          colTotals: { Amount: 'SUM' },
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_5');
      const rows = readStage5();
      // 8 detail rows + 1 totals row = 9
      expect(rows.length).toBe(9);
      expect(result.outputColumns).toEqual([...ctx.outputColumns, '_row_type']);
    });

    it('should mark detail rows with _row_type=0 and totals with _row_type=1', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({ mode: 'totals', colTotals: { Amount: 'SUM' } }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const detailRows = rows.filter(r => r['_row_type'] === 0);
      const totalsRows = rows.filter(r => r['_row_type'] === 1);
      expect(detailRows.length).toBe(8);
      expect(totalsRows.length).toBe(1);
    });

    it('should aggregate Amount with SUM in totals branch', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({ mode: 'totals', colTotals: { Amount: 'SUM' } }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const totalsRow = rows.find(r => r['_row_type'] === 1);
      // Sum of Amounts: 150 + 275 + 99.5 + 500 + 0 + null + 820 + 310 = 2154.5
      expect(totalsRow!['Amount']).toBe(2154.5);
    });

    it('should set NULL for columns with fn=skip in totals branch', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({ mode: 'totals', colTotals: { Amount: 'skip', Company: 'skip' } }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const totalsRow = rows.find(r => r['_row_type'] === 1);
      expect(totalsRow!['Amount']).toBeNull();
      expect(totalsRow!['Company']).toBeNull();
    });

    it('should set NULL for columns without a configured fn in totals branch', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({ mode: 'totals', colTotals: { Amount: 'SUM' } }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const totalsRow = rows.find(r => r['_row_type'] === 1);
      // Company has no fn configured → NULL
      expect(totalsRow!['Company']).toBeNull();
      // OrderId has no fn configured → NULL
      expect(totalsRow!['OrderId']).toBeNull();
    });
  });

  // ── Subtotals mode ─────────────────────────────────────────────────────────

  describe('subtotals mode', () => {
    it('should pass-through (detail mode) when subtotalBy is empty', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({ mode: 'subtotals', subtotalBy: [] }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_0');
    });

    it('should create subtotals with combined strategy', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: true,
          subtotalStrategy: 'combined',
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_5');
      const rows = readStage5();
      expect(rows.length).toBeGreaterThan(8); // detail rows + subtotals + grand total
      expect(result.outputColumns).toEqual([...ctx.outputColumns, '_row_type']);

      // Check row types
      const rowTypes = new Set(rows.map(r => r['_row_type']));
      expect(rowTypes.has(0)).toBe(true); // detail
      expect(rowTypes.has(1)).toBe(true); // subtotal
      expect(rowTypes.has(3)).toBe(true); // grand total
    });

    it('should create nested subtotals with multi-level grouping', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region', 'Company'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: true,
          subtotalStrategy: 'nested',
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_5');
      const rows = readStage5();
      // Nested strategy creates one branch per prefix depth
      expect(rows.length).toBeGreaterThan(8);

      // Should have detail rows (0), subtotal rows (1), and grand total (3)
      const rowTypes = new Set(rows.map(r => r['_row_type']));
      expect(rowTypes.has(0)).toBe(true);
      expect(rowTypes.has(1)).toBe(true);
      expect(rowTypes.has(3)).toBe(true);
    });

    it('should include grand total when configured', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: true,
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const grandTotal = rows.filter(r => r['_row_type'] === 3);
      expect(grandTotal.length).toBe(1);
    });

    it('should exclude grand total when all fns are skip', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'skip', Company: 'skip', OrderId: 'skip', Contact: 'skip', Status: 'skip', OrderDate: 'skip' },
          subtotalGrandTotal: true,
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const grandTotal = rows.filter(r => r['_row_type'] === 3);
      expect(grandTotal.length).toBe(0);
    });

    it('should include spacer rows when configured', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'SUM' },
          subtotalSpacer: true,
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const spacers = rows.filter(r => r['_row_type'] === 2);
      expect(spacers.length).toBeGreaterThan(0);
      // Spacer rows should have all data columns as NULL
      for (const spacer of spacers) {
        expect(spacer['Company']).toBeNull();
        expect(spacer['Amount']).toBeNull();
      }
    });

    it('should handle subtotalOnTop (different sort order)', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'SUM' },
          subtotalOnTop: true,
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_5');
      const rows = readStage5();
      expect(rows.length).toBeGreaterThan(8);
    });

    it('should pass-through when outputColumns is empty', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'SUM' },
        }),
      });
      const ctx = makeCtx({ reportSpec: spec, outputColumns: [] });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_0');
    });

    it('should set NULL for subtotalBy columns in grand total row', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: true,
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const grandTotal = rows.find(r => r['_row_type'] === 3);
      expect(grandTotal!['Region']).toBeNull();
    });

    it('should aggregate non-subtotalBy columns in subtotal rows', () => {
      createPrevTable();
      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: false,
        }),
      });
      const ctx = makeCtx({ reportSpec: spec });
      executeAggregationStage(ctx);
      const rows = readStage5();
      const subtotalRows = rows.filter(r => r['_row_type'] === 1);
      // Each subtotal row should have a non-null Amount (the SUM for that region)
      for (const row of subtotalRows) {
        expect(row['Amount']).not.toBeNull();
        expect(typeof row['Amount']).toBe('number');
      }
    });

    it('should handle SQL injection in column names', () => {
      execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
      execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" ("col""name" TEXT, "Amount" REAL)`);
      execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('A', 10)`);
      execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('B', 20)`);

      const spec = makeReportSpec({
        aggregation: aggSpec({
          mode: 'subtotals',
          subtotalBy: ['col"name'],
          subtotalFns: { Amount: 'SUM' },
        }),
      });
      const ctx = makeCtx({
        reportSpec: spec,
        outputColumns: ['col"name', 'Amount'],
      });
      const result = executeAggregationStage(ctx);
      expect(result.outputTableName).toBe('_pipeline_stage_5');
    });
  });

  // ── Temp table naming ──────────────────────────────────────────────────────

  it('should create temp table named _pipeline_stage_5 for grouped mode', () => {
    createPrevTable();
    const spec = makeReportSpec({
      aggregation: aggSpec({
        mode: 'group',
        groupBy: ['Company'],
        aggregates: [{ col: '*', fn: 'COUNT ROWS', alias: 'Count', enabled: true }],
      }),
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeAggregationStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_5');
  });

  it('should create temp table named _pipeline_stage_5 for totals mode', () => {
    createPrevTable();
    const spec = makeReportSpec({
      aggregation: aggSpec({ mode: 'totals', colTotals: { Amount: 'SUM' } }),
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeAggregationStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_5');
  });
});
