import { describe, it, expect, afterEach } from 'vitest';
import { executeBaseStage } from '../../../report/pipeline-stages/base';
import { executeLookupStage } from '../../../report/pipeline-stages/lookups';
import { executeCalcStage } from '../../../report/pipeline-stages/calcs';
import { executeFilterStage } from '../../../report/pipeline-stages/filters';
import { executeSortStage } from '../../../report/pipeline-stages/sorts';
import { executeAggregationStage } from '../../../report/pipeline-stages/aggregation';
import type { StageContext, StageResult } from '../../../report/pipeline-stages/base';
import type { ReportSpec } from '../../../types';
import { execQuery } from '../../../core/sqldb';
import { ordersColMap, standardSourceCatalog, standardTables, makeReportSpec } from '../../query/helpers';

// ── Helpers ────────────────────────────────────────────────────────────────────

function dropAllTemps() {
  for (let i = 0; i <= 5; i++) {
    try { execQuery(`DROP TABLE IF EXISTS "_pipeline_stage_${i}"`); } catch { /* ignore */ }
  }
  try { execQuery('DROP TABLE IF EXISTS "Contacts"'); } catch { /* ignore */ }
}

function tableExists(name: string): boolean {
  try {
    const rows = execQuery(`SELECT COUNT(*) as cnt FROM "${name}"`);
    return (rows[0]['cnt'] as number) >= 0;
  } catch {
    return false;
  }
}

function runPipeline(spec: ReportSpec, overrides: Partial<StageContext> = {}): StageResult[] {
  const results: StageResult[] = [];
  const tables = overrides.tables ?? standardTables();
  const colMap = overrides.colMap ?? ordersColMap();
  const sourceCatalog = overrides.sourceCatalog ?? standardSourceCatalog();
  const outputColumns = overrides.outputColumns ?? [
    'OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region',
  ];

  // Stage 0: Base
  let ctx: StageContext = {
    reportSpec: spec,
    tables,
    colMap,
    sourceCatalog,
    prevTableName: '',
    stageIndex: 0,
    outputColumns,
    ...overrides,
  };
  let result = executeBaseStage(ctx);
  results.push(result);

  // Stage 1: Lookups
  ctx = { ...ctx, prevTableName: result.outputTableName, outputColumns: result.outputColumns, stageIndex: 1 };
  result = executeLookupStage(ctx);
  results.push(result);

  // Stage 2: Calcs
  ctx = { ...ctx, prevTableName: result.outputTableName, outputColumns: result.outputColumns, stageIndex: 2 };
  result = executeCalcStage(ctx);
  results.push(result);

  // Stage 3: Filters
  ctx = { ...ctx, prevTableName: result.outputTableName, outputColumns: result.outputColumns, stageIndex: 3 };
  result = executeFilterStage(ctx);
  results.push(result);

  // Stage 4: Sorts
  ctx = { ...ctx, prevTableName: result.outputTableName, outputColumns: result.outputColumns, stageIndex: 4 };
  result = executeSortStage(ctx);
  results.push(result);

  // Stage 5: Aggregation
  ctx = { ...ctx, prevTableName: result.outputTableName, outputColumns: result.outputColumns, stageIndex: 5 };
  result = executeAggregationStage(ctx);
  results.push(result);

  return results;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('pipeline integration', () => {
  afterEach(() => { dropAllTemps(); });

  it('should run full pipeline in detail mode and produce correct results', () => {
    const spec = makeReportSpec({
      filters: [{ col: 'Company', op: 'equals', val: 'Acme Corp', vals: ['Acme Corp'], enabled: true }],
      sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
    });
    const results = runPipeline(spec);

    // Verify all 6 stages ran
    expect(results.length).toBe(6);

    // Verify temp table chain
    expect(results[0].outputTableName).toBe('_pipeline_stage_0');
    expect(results[1].outputTableName).toBe('_pipeline_stage_0'); // lookups pass-through
    expect(results[2].outputTableName).toBe('_pipeline_stage_0'); // calcs pass-through
    expect(results[3].outputTableName).toBe('_pipeline_stage_3'); // filters created table
    expect(results[4].outputTableName).toBe('_pipeline_stage_4'); // sorts created table
    expect(results[5].outputTableName).toBe('_pipeline_stage_4'); // aggregation pass-through (detail)

    // Verify final data: 3 Acme rows sorted by Amount DESC
    const finalTable = results[5].outputTableName;
    const rows = execQuery(`SELECT * FROM "${finalTable}"`);
    expect(rows.length).toBe(3);
    const amounts = rows.map(r => r['Amount'] as number);
    expect(amounts[0]).toBeGreaterThanOrEqual(amounts[1]);
    expect(amounts[1]).toBeGreaterThanOrEqual(amounts[2]);
  });

  it('should run full pipeline with grouping', () => {
    const spec = makeReportSpec({
      aggregation: {
        mode: 'group',
        groupBy: ['Company'],
        aggregates: [
          { col: 'Amount', fn: 'SUM', alias: 'TotalAmount', enabled: true },
          { col: '*', fn: 'COUNT ROWS', alias: 'Count', enabled: true },
        ],
        colTotals: {},
        subtotalBy: [],
        subtotalFns: {},
        subtotalGrandTotal: true,
        subtotalSpacer: false,
        subtotalOnTop: false,
        subtotalStrategy: 'combined',
      },
    });
    const results = runPipeline(spec);

    // Final stage should create _pipeline_stage_5
    expect(results[5].outputTableName).toBe('_pipeline_stage_5');
    expect(results[5].outputColumns).toEqual(['Company', 'TotalAmount', 'Count']);

    const rows = execQuery('SELECT * FROM "_pipeline_stage_5"');
    expect(rows.length).toBe(5); // 5 unique companies
    const acme = rows.find(r => r['Company'] === 'Acme Corp');
    expect(acme!['TotalAmount']).toBe(559.5);
    expect(acme!['Count']).toBe(3);
  });

  it('should pass prevTableName and outputColumns through each stage', () => {
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        calculatedColumns: [{
          alias: 'Label',
          mode: 'text',
          text: { operation: 'combine', parts: [{ type: 'column', value: 'Company' }, { type: 'text', value: '-' }, { type: 'column', value: 'Region' }] },
          enabled: true,
        }],
      },
      filters: [{ col: 'Region', op: 'equals', val: 'North', vals: ['North'], enabled: true }],
      sorts: [{ col: 'Amount', dir: 'ASC', enabled: true }],
    });
    const results = runPipeline(spec);

    // Stage 0 (base) → _pipeline_stage_0
    expect(results[0].outputTableName).toBe('_pipeline_stage_0');
    expect(results[0].outputColumns).toEqual(['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region']);

    // Stage 1 (lookups) → pass-through
    expect(results[1].outputTableName).toBe('_pipeline_stage_0');
    expect(results[1].outputColumns).toEqual(results[0].outputColumns);

    // Stage 2 (calcs) → _pipeline_stage_2 with Label added
    expect(results[2].outputTableName).toBe('_pipeline_stage_2');
    expect(results[2].outputColumns).toContain('Label');

    // Stage 3 (filters) → _pipeline_stage_3
    expect(results[3].outputTableName).toBe('_pipeline_stage_3');
    expect(results[3].outputColumns).toEqual(results[2].outputColumns);

    // Stage 4 (sorts) → _pipeline_stage_4
    expect(results[4].outputTableName).toBe('_pipeline_stage_4');
    expect(results[4].outputColumns).toEqual(results[3].outputColumns);

    // Stage 5 (aggregation) → pass-through (detail)
    expect(results[5].outputTableName).toBe('_pipeline_stage_4');

    // Verify data integrity: North region, sorted ASC by Amount
    const rows = execQuery('SELECT * FROM "_pipeline_stage_4"');
    expect(rows.length).toBe(3); // 3 North rows
    for (const row of rows) {
      expect(row['Region']).toBe('North');
      expect(row['Label']).toContain('-');
    }
  });

  it('should maintain data integrity through the pipeline', () => {
    const spec = makeReportSpec();
    const results = runPipeline(spec);
    const finalTable = results[5].outputTableName;
    const rows = execQuery(`SELECT * FROM "${finalTable}"`);
    expect(rows.length).toBe(8); // All 8 Orders rows

    // Verify specific data points
    const ord001 = rows.find(r => r['OrderId'] === 'ORD-001');
    expect(ord001).toBeDefined();
    expect(ord001!['Company']).toBe('Acme Corp');
    expect(ord001!['Amount']).toBe(150);
    expect(ord001!['Region']).toBe('North');
  });

  it('should handle pipeline with lookups, calcs, filters, sorts, and totals', () => {
    // Create Contacts table for lookup
    execQuery('DROP TABLE IF EXISTS "Contacts"');
    execQuery(`CREATE TABLE "Contacts" ("ContactId" TEXT, "Name" TEXT, "Email" TEXT, "Phone" TEXT)`);
    execQuery(`INSERT INTO "Contacts" VALUES ('1', 'Alice', 'alice@test.com', '555-0001')`);
    execQuery(`INSERT INTO "Contacts" VALUES ('2', 'Bob', 'bob@test.com', '555-0002')`);
    execQuery(`INSERT INTO "Contacts" VALUES ('3', 'Carol', 'carol@test.com', '555-0003')`);
    execQuery(`INSERT INTO "Contacts" VALUES ('4', 'Dave', 'dave@test.com', '555-0004')`);
    execQuery(`INSERT INTO "Contacts" VALUES ('5', 'Eve', 'eve@test.com', '555-0005')`);

    const sourceCatalog = standardSourceCatalog();
    sourceCatalog.set('Contacts', {
      id: 'Contacts', name: 'Contacts',
      cols: ['ContactId', 'Name', 'Email', 'Phone'],
      kind: 'imported',
      source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 5 },
    });

    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'Name' }],
          cols: ['Email'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'first' },
        }],
        calculatedColumns: [{
          alias: 'Label',
          mode: 'text',
          text: { operation: 'combine', parts: [{ type: 'column', value: 'Company' }, { type: 'text', value: ' (' }, { type: 'column', value: 'Region' }, { type: 'text', value: ')' }] },
          enabled: true,
        }],
      },
      filters: [{ col: 'Status', op: 'equals', val: 'Open', vals: ['Open'], enabled: true }],
      sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      aggregation: {
        mode: 'totals',
        groupBy: [],
        aggregates: [],
        colTotals: { Amount: 'SUM' },
        subtotalBy: [],
        subtotalFns: {},
        subtotalGrandTotal: true,
        subtotalSpacer: false,
        subtotalOnTop: false,
        subtotalStrategy: 'combined',
      },
    });

    const results = runPipeline(spec, { sourceCatalog });

    // Verify pipeline chain
    expect(results[0].outputTableName).toBe('_pipeline_stage_0'); // base
    expect(results[1].outputTableName).toBe('_pipeline_stage_1'); // lookups joined
    expect(results[2].outputTableName).toBe('_pipeline_stage_2'); // calcs added
    expect(results[3].outputTableName).toBe('_pipeline_stage_3'); // filtered
    expect(results[4].outputTableName).toBe('_pipeline_stage_4'); // sorted
    expect(results[5].outputTableName).toBe('_pipeline_stage_5'); // totals

    // Verify final data
    const rows = execQuery('SELECT * FROM "_pipeline_stage_5"');
    // Open orders: ORD-001 (150), ORD-003 (99.5), ORD-005 (0), ORD-007 (820) = 4 detail + 1 totals = 5
    expect(rows.length).toBe(5);

    const detailRows = rows.filter(r => r['_row_type'] === 0);
    const totalsRows = rows.filter(r => r['_row_type'] === 1);
    expect(detailRows.length).toBe(4);
    expect(totalsRows.length).toBe(1);

    // Verify totals
    expect(totalsRows[0]['Amount']).toBe(1069.5); // 150 + 99.5 + 0 + 820

    // Verify sort order (DESC by Amount)
    const amounts = detailRows.map(r => r['Amount'] as number | null).filter(v => v !== null);
    for (let i = 0; i < amounts.length - 1; i++) {
      expect(amounts[i]! as number).toBeGreaterThanOrEqual(amounts[i + 1]! as number);
    }

    // Verify Label calc is present
    expect(detailRows[0]['Label']).toBeDefined();
    // Verify Email from lookup is present
    expect(detailRows[0]['Email']).toBeDefined();
  });

  it('should verify temp table chain: 0 → 1 → 2 → 3 → 4 → 5', () => {
    // Create Contacts for lookup
    execQuery('DROP TABLE IF EXISTS "Contacts"');
    execQuery(`CREATE TABLE "Contacts" ("ContactId" TEXT, "Name" TEXT, "Email" TEXT, "Phone" TEXT)`);
    execQuery(`INSERT INTO "Contacts" VALUES ('1', 'Alice', 'alice@test.com', '555-0001')`);

    const sourceCatalog = standardSourceCatalog();
    sourceCatalog.set('Contacts', {
      id: 'Contacts', name: 'Contacts',
      cols: ['ContactId', 'Name', 'Email', 'Phone'],
      kind: 'imported',
      source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 1 },
    });

    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'Name' }],
          cols: ['Email'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'first' },
        }],
        calculatedColumns: [{
          alias: 'Label',
          mode: 'text',
          text: { operation: 'combine', parts: [{ type: 'text', value: 'x' }] },
          enabled: true,
        }],
      },
      filters: [{ col: 'Region', op: 'equals', val: 'North', vals: ['North'], enabled: true }],
      sorts: [{ col: 'Amount', dir: 'ASC', enabled: true }],
      aggregation: {
        mode: 'group',
        groupBy: ['Company'],
        aggregates: [{ col: '*', fn: 'COUNT ROWS', alias: 'Count', enabled: true }],
        colTotals: {},
        subtotalBy: [],
        subtotalFns: {},
        subtotalGrandTotal: true,
        subtotalSpacer: false,
        subtotalOnTop: false,
        subtotalStrategy: 'combined',
      },
    });

    const results = runPipeline(spec, { sourceCatalog });

    // Each stage should create its expected temp table
    expect(results[0].outputTableName).toBe('_pipeline_stage_0');
    expect(tableExists('_pipeline_stage_0')).toBe(true);

    expect(results[1].outputTableName).toBe('_pipeline_stage_1');
    expect(tableExists('_pipeline_stage_1')).toBe(true);

    expect(results[2].outputTableName).toBe('_pipeline_stage_2');
    expect(tableExists('_pipeline_stage_2')).toBe(true);

    expect(results[3].outputTableName).toBe('_pipeline_stage_3');
    expect(tableExists('_pipeline_stage_3')).toBe(true);

    expect(results[4].outputTableName).toBe('_pipeline_stage_4');
    expect(tableExists('_pipeline_stage_4')).toBe(true);

    expect(results[5].outputTableName).toBe('_pipeline_stage_5');
    expect(tableExists('_pipeline_stage_5')).toBe(true);
  });
});
