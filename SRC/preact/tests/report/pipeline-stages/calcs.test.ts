import { describe, it, expect, afterEach } from 'vitest';
import { executeCalcStage } from '../../../report/pipeline-stages/calcs';
import type { StageContext } from '../../../report/pipeline-stages/base';
import type { CalcStage } from '../../../types';
import { execQuery } from '../../../core/sqldb';
import { ordersColMap, standardSourceCatalog, standardTables, makeReportSpec } from '../../query/helpers';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    reportSpec: makeReportSpec(),
    tables: standardTables(),
    colMap: ordersColMap(),
    sourceCatalog: standardSourceCatalog(),
    prevTableName: '_pipeline_stage_0',
    stageIndex: 2,
    outputColumns: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
    ...overrides,
  };
}

function dropTemps() {
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"'); } catch { /* ignore */ }
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_2"'); } catch { /* ignore */ }
}

function createPrevTable() {
  execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
  execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" AS SELECT * FROM "Orders"`);
}

function readStage2(): Record<string, unknown>[] {
  return execQuery('SELECT * FROM "_pipeline_stage_2"');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('executeCalcStage', () => {
  afterEach(() => { dropTemps(); });

  it('should pass-through when no calculated columns', () => {
    createPrevTable();
    const ctx = makeCtx();
    const result = executeCalcStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
    expect(result.outputColumns).toEqual(ctx.outputColumns);
  });

  it('should pass-through when all calcs disabled', () => {
    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        calculatedColumns: [
          { alias: 'X', mode: 'text', text: { operation: 'combine', parts: [{ type: 'text', value: 'a' }] }, enabled: false },
        ],
      },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeCalcStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should pass-through when buildCalcExpressions returns empty (invalid mode)', () => {
    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        calculatedColumns: [
          { alias: 'X', mode: 'invalid_mode' as any, enabled: true },
        ],
      },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeCalcStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should create _pipeline_stage_2 with a text combine calc', () => {
    createPrevTable();
    const calc: CalcStage = {
      alias: 'Label',
      mode: 'text',
      text: {
        operation: 'combine',
        parts: [
          { type: 'column', value: 'Company' },
          { type: 'text', value: ' - ' },
          { type: 'column', value: 'Region' },
        ],
      },
      enabled: true,
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, calculatedColumns: [calc] },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeCalcStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_2');
    expect(result.outputColumns).toContain('Label');
    const rows = readStage2();
    expect(rows.length).toBe(8);
    // Verify the calc value: "Acme Corp - North" for first Acme row
    const acmeRow = rows.find(r => r['OrderId'] === 'ORD-001');
    expect(acmeRow!['Label']).toBe('Acme Corp - North');
  });

  it('should strip table prefix from calc SQL ("tid"."col" → "col")', () => {
    createPrevTable();
    // Math calc: Amount + 10
    // buildCalcExpressions produces "Orders"."Amount" references
    // The stage should strip "Orders". prefix
    const calc: CalcStage = {
      alias: 'AmountPlus10',
      mode: 'math',
      math: {
        steps: [
          { type: 'column', value: 'Amount' },
          { type: 'number', value: '10', op: '+' },
        ],
      },
      enabled: true,
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, calculatedColumns: [calc] },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeCalcStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_2');
    const rows = readStage2();
    // ORD-001 has Amount=150, so AmountPlus10 should be 160
    const row = rows.find(r => r['OrderId'] === 'ORD-001');
    expect(row!['AmountPlus10']).toBe(160);
  });

  it('should handle multiple calc expressions', () => {
    createPrevTable();
    const calcs: CalcStage[] = [
      {
        alias: 'Label',
        mode: 'text',
        text: {
          operation: 'combine',
          parts: [
            { type: 'column', value: 'Company' },
            { type: 'text', value: '/' },
            { type: 'column', value: 'Region' },
          ],
        },
        enabled: true,
      },
      {
        alias: 'AmountX2',
        mode: 'math',
        math: {
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '2', op: '*' },
          ],
        },
        enabled: true,
      },
    ];
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, calculatedColumns: calcs },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeCalcStage(ctx);
    expect(result.outputColumns).toContain('Label');
    expect(result.outputColumns).toContain('AmountX2');
    const rows = readStage2();
    const row = rows.find(r => r['OrderId'] === 'ORD-001');
    expect(row!['Label']).toBe('Acme Corp/North');
    expect(row!['AmountX2']).toBe(300);
  });

  it('should append new aliases to outputColumns', () => {
    createPrevTable();
    const calc: CalcStage = {
      alias: 'NewCol',
      mode: 'text',
      text: { operation: 'combine', parts: [{ type: 'text', value: 'hello' }] },
      enabled: true,
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, calculatedColumns: [calc] },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeCalcStage(ctx);
    expect(result.outputColumns).toEqual([...ctx.outputColumns, 'NewCol']);
  });

  it('should create temp table named _pipeline_stage_2', () => {
    createPrevTable();
    const calc: CalcStage = {
      alias: 'Test',
      mode: 'text',
      text: { operation: 'combine', parts: [{ type: 'text', value: 'x' }] },
      enabled: true,
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, calculatedColumns: [calc] },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeCalcStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_2');
  });

  it('should handle calc alias with special characters via quoteId', () => {
    createPrevTable();
    const calc: CalcStage = {
      alias: 'Has "Quotes"',
      mode: 'text',
      text: { operation: 'combine', parts: [{ type: 'text', value: 'safe' }] },
      enabled: true,
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, calculatedColumns: [calc] },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeCalcStage(ctx);
    expect(result.outputColumns).toContain('Has "Quotes"');
    const rows = readStage2();
    expect(rows[0]['Has "Quotes"']).toBe('safe');
  });
});
