import { describe, it, expect, afterEach } from 'vitest';
import { executeBaseStage } from '../../../report/pipeline-stages/base';
import type { StageContext } from '../../../report/pipeline-stages/base';
import type { DbTable } from '../../../types';
import { execQuery } from '../../../core/sqldb';
import { ordersColMap, standardSourceCatalog, standardTables, makeReportSpec } from '../../query/helpers';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    reportSpec: makeReportSpec(),
    tables: standardTables(),
    colMap: ordersColMap(),
    sourceCatalog: standardSourceCatalog(),
    prevTableName: '',
    stageIndex: 0,
    outputColumns: [],
    ...overrides,
  };
}

function dropTemp() {
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"'); } catch { /* ignore */ }
}

function readTemp(): Record<string, unknown>[] {
  return execQuery('SELECT * FROM "_pipeline_stage_0"');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('executeBaseStage', () => {
  afterEach(() => { dropTemp(); });

  it('should create _pipeline_stage_0 with all base table columns', () => {
    const ctx = makeCtx();
    const result = executeBaseStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
    expect(result.outputColumns).toEqual([
      'OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region',
    ]);
    const rows = readTemp();
    expect(rows.length).toBe(8);
  });

  it('should project only explicit baseCols when provided', () => {
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, baseCols: ['Company', 'Amount'] },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeBaseStage(ctx);
    expect(result.outputColumns).toEqual(['Company', 'Amount']);
    const rows = readTemp();
    expect(Object.keys(rows[0])).toEqual(['Company', 'Amount']);
    expect(rows.length).toBe(8);
  });

  it('should combine stacked tables via UNION ALL', () => {
    // Create a second table with same schema
    execQuery('DROP TABLE IF EXISTS "Orders2"');
    execQuery(`CREATE TABLE "Orders2" (
      "OrderId" TEXT, "Company" TEXT, "Contact" TEXT, "Status" TEXT,
      "Amount" REAL, "OrderDate" TEXT, "Region" TEXT
    )`);
    execQuery(`INSERT INTO "Orders2" VALUES ('ORD-100', 'Zeta Corp', 'Zack', 'Open', 42, '2025-07-01', 'North')`);

    const tables: Record<string, DbTable> = {
      ...standardTables(),
      Orders2: { id: 'Orders2', name: 'Orders2', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 1 },
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, stacks: ['Orders2'] },
    });
    const ctx = makeCtx({ reportSpec: spec, tables });
    executeBaseStage(ctx);
    const rows = readTemp();
    expect(rows.length).toBe(9); // 8 from Orders + 1 from Orders2
    execQuery('DROP TABLE IF EXISTS "Orders2"');
  });

  it('should include source column when includeSourceColumn is true', () => {
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, includeSourceColumn: true },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeBaseStage(ctx);
    expect(result.outputColumns).toContain('Source Sheet');
    const rows = readTemp();
    expect(rows[0]['Source Sheet']).toBe('Orders');
  });

  it('should use custom sourceColumnName', () => {
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, includeSourceColumn: true, sourceColumnName: 'Origin' },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeBaseStage(ctx);
    expect(result.outputColumns).toContain('Origin');
    const rows = readTemp();
    expect(rows[0]['Origin']).toBe('Orders');
  });

  it('should use stack aliases for source column values', () => {
    execQuery('DROP TABLE IF EXISTS "Orders2"');
    execQuery(`CREATE TABLE "Orders2" (
      "OrderId" TEXT, "Company" TEXT, "Contact" TEXT, "Status" TEXT,
      "Amount" REAL, "OrderDate" TEXT, "Region" TEXT
    )`);
    execQuery(`INSERT INTO "Orders2" VALUES ('ORD-100', 'Zeta', 'Z', 'Open', 1, '2025-01-01', 'West')`);

    const tables: Record<string, DbTable> = {
      ...standardTables(),
      Orders2: { id: 'Orders2', name: 'Orders2', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 1 },
    };
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        stacks: ['Orders2'],
        includeSourceColumn: true,
        stackAliases: { Orders2: 'My Alias' },
      },
    });
    const ctx = makeCtx({ reportSpec: spec, tables });
    executeBaseStage(ctx);
    const rows = readTemp();
    const sources = rows.map(r => r['Source Sheet']);
    expect(sources).toContain('Orders');
    expect(sources).toContain('My Alias');
    execQuery('DROP TABLE IF EXISTS "Orders2"');
  });

  it('should project NULL for missing columns in stack tables', () => {
    execQuery('DROP TABLE IF EXISTS "SmallTable"');
    execQuery(`CREATE TABLE "SmallTable" ("OrderId" TEXT, "Company" TEXT)`);
    execQuery(`INSERT INTO "SmallTable" VALUES ('ORD-200', 'Tiny Inc')`);

    const tables: Record<string, DbTable> = {
      ...standardTables(),
      SmallTable: { id: 'SmallTable', name: 'SmallTable', cols: ['OrderId', 'Company'], rowCount: 1 },
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, stacks: ['SmallTable'], baseCols: ['OrderId', 'Company', 'Amount'] },
    });
    const ctx = makeCtx({ reportSpec: spec, tables });
    executeBaseStage(ctx);
    const rows = readTemp();
    // Find the row from SmallTable
    const smallRow = rows.find(r => r['OrderId'] === 'ORD-200');
    expect(smallRow).toBeDefined();
    expect(smallRow!['Amount']).toBeNull();
    execQuery('DROP TABLE IF EXISTS "SmallTable"');
  });

  it('should throw when no valid base table', () => {
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, base: 'NonExistent' },
    });
    const ctx = makeCtx({ reportSpec: spec });
    expect(() => executeBaseStage(ctx)).toThrow('no valid base table');
  });

  it('should throw when base table is empty string', () => {
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, base: '' },
    });
    const ctx = makeCtx({ reportSpec: spec });
    expect(() => executeBaseStage(ctx)).toThrow('no valid base table');
  });

  it('should throw when projected columns are empty', () => {
    // baseCols is empty AND base table has no cols
    const tables: Record<string, DbTable> = {
      Empty: { id: 'Empty', name: 'Empty', cols: [], rowCount: 0 },
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, base: 'Empty', baseCols: [] },
    });
    const ctx = makeCtx({ reportSpec: spec, tables });
    expect(() => executeBaseStage(ctx)).toThrow('no columns to project');
  });

  it('should not include UNION ALL when no stacks', () => {
    const ctx = makeCtx();
    executeBaseStage(ctx);
    // Just verify it works without stacks — 8 rows from base only
    const rows = readTemp();
    expect(rows.length).toBe(8);
  });

  it('should handle column names with special characters', () => {
    execQuery('DROP TABLE IF EXISTS "SpecialCols"');
    execQuery(`CREATE TABLE "SpecialCols" ("Order""Id" TEXT, "Has Space" TEXT)`);
    execQuery(`INSERT INTO "SpecialCols" VALUES ('X1', 'hello world')`);

    const tables: Record<string, DbTable> = {
      SpecialCols: { id: 'SpecialCols', name: 'SpecialCols', cols: ['Order"Id', 'Has Space'], rowCount: 1 },
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, base: 'SpecialCols' },
    });
    const ctx = makeCtx({ reportSpec: spec, tables });
    const result = executeBaseStage(ctx);
    expect(result.outputColumns).toEqual(['Order"Id', 'Has Space']);
    const rows = readTemp();
    expect(rows.length).toBe(1);
    expect(rows[0]['Has Space']).toBe('hello world');
    execQuery('DROP TABLE IF EXISTS "SpecialCols"');
  });

  it('should handle column names with SQL injection attempts via quoteId', () => {
    // Use a column name with embedded double quotes — quoteId escapes them
    execQuery('DROP TABLE IF EXISTS "Inject"');
    execQuery(`CREATE TABLE "Inject" ("col""name" TEXT)`);
    execQuery(`INSERT INTO "Inject" VALUES ('safe')`);

    const tables: Record<string, DbTable> = {
      Inject: { id: 'Inject', name: 'Inject', cols: ['col"name'], rowCount: 1 },
    };
    const spec = makeReportSpec({
      pipeline: { ...makeReportSpec().pipeline, base: 'Inject' },
    });
    const ctx = makeCtx({ reportSpec: spec, tables });
    // quoteId escapes internal quotes, so this should be safe
    const result = executeBaseStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
    const rows = readTemp();
    expect(rows.length).toBe(1);
    expect(rows[0]['col"name']).toBe('safe');
    execQuery('DROP TABLE IF EXISTS "Inject"');
  });
});
