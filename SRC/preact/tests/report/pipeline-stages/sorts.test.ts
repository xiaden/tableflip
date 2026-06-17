import { describe, it, expect, afterEach } from 'vitest';
import { executeSortStage } from '../../../report/pipeline-stages/sorts';
import type { StageContext } from '../../../report/pipeline-stages/base';
import type { SortSpec } from '../../../types';
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
    stageIndex: 4,
    outputColumns: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
    ...overrides,
  };
}

function dropTemps() {
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"'); } catch { /* ignore */ }
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_4"'); } catch { /* ignore */ }
}

function createPrevTable() {
  execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
  execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" AS SELECT * FROM "Orders"`);
}

function readStage4(): Record<string, unknown>[] {
  return execQuery('SELECT * FROM "_pipeline_stage_4"');
}

function sort(col: string, dir: string, enabled = true): SortSpec {
  return { col, dir, enabled };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('executeSortStage', () => {
  afterEach(() => { dropTemps(); });

  it('should pass-through when no sorts', () => {
    createPrevTable();
    const ctx = makeCtx();
    const result = executeSortStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
    expect(result.outputColumns).toEqual(ctx.outputColumns);
  });

  it('should pass-through when all sorts disabled', () => {
    createPrevTable();
    const spec = makeReportSpec({
      sorts: [sort('Amount', 'ASC', false)],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeSortStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should pass-through when sort has no col', () => {
    createPrevTable();
    const spec = makeReportSpec({
      sorts: [{ col: '', dir: 'ASC', enabled: true }],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeSortStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should sort ASC by Amount', () => {
    createPrevTable();
    const spec = makeReportSpec({
      sorts: [sort('Amount', 'ASC')],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeSortStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_4');
    const rows = readStage4();
    expect(rows.length).toBe(8);
    // Verify ascending order (non-null values)
    const amounts = rows.map(r => r['Amount'] as number | null).filter(v => v !== null);
    for (let i = 0; i < amounts.length - 1; i++) {
      expect(amounts[i]! as number).toBeLessThanOrEqual(amounts[i + 1]! as number);
    }
    // First non-null should be 0 (ORD-005)
    expect(amounts[0]).toBe(0);
  });

  it('should sort DESC by Amount', () => {
    createPrevTable();
    const spec = makeReportSpec({
      sorts: [sort('Amount', 'DESC')],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeSortStage(ctx);
    const rows = readStage4();
    const amounts = rows.map(r => r['Amount'] as number | null).filter(v => v !== null);
    for (let i = 0; i < amounts.length - 1; i++) {
      expect(amounts[i]! as number).toBeGreaterThanOrEqual(amounts[i + 1]! as number);
    }
    // First should be 820 (ORD-007)
    expect(amounts[0]).toBe(820);
  });

  it('should sort by multiple columns', () => {
    createPrevTable();
    const spec = makeReportSpec({
      sorts: [
        sort('Region', 'ASC'),
        sort('Amount', 'DESC'),
      ],
    });
    const ctx = makeCtx({ reportSpec: spec });
    executeSortStage(ctx);
    const rows = readStage4();
    expect(rows.length).toBe(8);
    // Verify Region is sorted ASC
    const regions = rows.map(r => r['Region'] as string);
    for (let i = 0; i < regions.length - 1; i++) {
      expect(regions[i] <= regions[i + 1]).toBe(true);
    }
    // Within same region, Amount should be DESC
    const northRows = rows.filter(r => r['Region'] === 'North');
    const northAmounts = northRows.map(r => r['Amount'] as number | null).filter(v => v !== null);
    for (let i = 0; i < northAmounts.length - 1; i++) {
      expect(northAmounts[i]! as number).toBeGreaterThanOrEqual(northAmounts[i + 1]! as number);
    }
  });

  it('should handle SQL injection in column names via quoteId', () => {
    execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
    execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" ("col""name" TEXT, "Other" TEXT)`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('b', '1')`);
    execQuery(`INSERT INTO "_pipeline_stage_0" VALUES ('a', '2')`);

    const spec = makeReportSpec({
      sorts: [sort('col"name', 'ASC')],
      outputColumns: ['col"name', 'Other'],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeSortStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_4');
    const rows = readStage4();
    expect(rows[0]['col"name']).toBe('a');
    expect(rows[1]['col"name']).toBe('b');
  });

  it('should create temp table named _pipeline_stage_4', () => {
    createPrevTable();
    const spec = makeReportSpec({
      sorts: [sort('Company', 'ASC')],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeSortStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_4');
  });

  it('should preserve outputColumns through sort stage', () => {
    createPrevTable();
    const spec = makeReportSpec({
      sorts: [sort('Company', 'ASC')],
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeSortStage(ctx);
    expect(result.outputColumns).toEqual(ctx.outputColumns);
  });
});
