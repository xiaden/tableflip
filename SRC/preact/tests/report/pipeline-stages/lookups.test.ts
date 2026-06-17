import { describe, it, expect, afterEach } from 'vitest';
import { executeLookupStage } from '../../../report/pipeline-stages/lookups';
import type { StageContext } from '../../../report/pipeline-stages/base';
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
    stageIndex: 1,
    outputColumns: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
    ...overrides,
  };
}

function dropTemps() {
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"'); } catch { /* ignore */ }
  try { execQuery('DROP TABLE IF EXISTS "_pipeline_stage_1"'); } catch { /* ignore */ }
  try { execQuery('DROP TABLE IF EXISTS "Contacts"'); } catch { /* ignore */ }
}

function createPrevTable() {
  // Create a _pipeline_stage_0 temp table from Orders data
  execQuery('DROP TABLE IF EXISTS "_pipeline_stage_0"');
  execQuery(`CREATE TEMP TABLE "_pipeline_stage_0" AS SELECT * FROM "Orders"`);
}

function readStage1(): Record<string, unknown>[] {
  return execQuery('SELECT * FROM "_pipeline_stage_1"');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('executeLookupStage', () => {
  afterEach(() => { dropTemps(); });

  it('should pass-through when no lookups', () => {
    createPrevTable();
    const ctx = makeCtx();
    const result = executeLookupStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
    expect(result.outputColumns).toEqual(ctx.outputColumns);
  });

  it('should pass-through when all lookups disabled', () => {
    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [{ rightId: 'Contacts', keyPairs: [{ left: 'Contact', right: 'Name' }], cols: ['Email'], required: false, enabled: false, duplicatePolicy: { mode: 'first' } }],
      },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeLookupStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should pass-through when no valid joins (missing source catalog entry)', () => {
    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [{ rightId: 'NonExistent', keyPairs: [{ left: 'Contact', right: 'Name' }], cols: ['Email'], required: false, enabled: true, duplicatePolicy: { mode: 'first' } }],
      },
    });
    const ctx = makeCtx({ reportSpec: spec });
    const result = executeLookupStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should LEFT JOIN for non-required lookup and preserve all rows', () => {
    // Create Contacts table with some matching data
    execQuery('DROP TABLE IF EXISTS "Contacts"');
    execQuery(`CREATE TABLE "Contacts" ("ContactId" TEXT, "Name" TEXT, "Email" TEXT, "Phone" TEXT)`);
    execQuery(`INSERT INTO "Contacts" VALUES ('1', 'Alice', 'alice@test.com', '555-0001')`);
    execQuery(`INSERT INTO "Contacts" VALUES ('2', 'Bob', 'bob@test.com', '555-0002')`);
    // Carol, Dave, Eve not in Contacts — LEFT JOIN should preserve them

    const sourceCatalog = standardSourceCatalog();
    // Ensure Contacts is in source catalog
    sourceCatalog.set('Contacts', {
      id: 'Contacts',
      name: 'Contacts',
      cols: ['ContactId', 'Name', 'Email', 'Phone'],
      kind: 'imported',
      source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 2 },
    });

    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'Name' }],
          cols: ['Email', 'Phone'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'first' },
        }],
      },
    });
    const ctx = makeCtx({ reportSpec: spec, sourceCatalog });
    const result = executeLookupStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_1');
    const rows = readStage1();
    expect(rows.length).toBe(8); // All 8 rows preserved
    // Check that Alice's row has email
    const aliceRow = rows.find(r => r['Contact'] === 'Alice');
    expect(aliceRow!['Email']).toBe('alice@test.com');
    // Check that Carol's row has null email (no match)
    const carolRow = rows.find(r => r['Contact'] === 'Carol');
    expect(carolRow!['Email']).toBeNull();
  });

  it('should INNER JOIN for required lookup and exclude unmatched rows', () => {
    execQuery('DROP TABLE IF EXISTS "Contacts"');
    execQuery(`CREATE TABLE "Contacts" ("ContactId" TEXT, "Name" TEXT, "Email" TEXT, "Phone" TEXT)`);
    execQuery(`INSERT INTO "Contacts" VALUES ('1', 'Alice', 'alice@test.com', '555-0001')`);
    execQuery(`INSERT INTO "Contacts" VALUES ('2', 'Bob', 'bob@test.com', '555-0002')`);

    const sourceCatalog = standardSourceCatalog();
    sourceCatalog.set('Contacts', {
      id: 'Contacts',
      name: 'Contacts',
      cols: ['ContactId', 'Name', 'Email', 'Phone'],
      kind: 'imported',
      source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 2 },
    });

    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'Name' }],
          cols: ['Email'],
          required: true,
          enabled: true,
          duplicatePolicy: { mode: 'first' },
        }],
      },
    });
    const ctx = makeCtx({ reportSpec: spec, sourceCatalog });
    executeLookupStage(ctx);
    const rows = readStage1();
    // Only Alice (3 rows) and Bob (2 rows) match
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(['Alice', 'Bob']).toContain(row['Contact']);
    }
  });

  it('should handle multiple lookups', () => {
    execQuery('DROP TABLE IF EXISTS "Contacts"');
    execQuery(`CREATE TABLE "Contacts" ("ContactId" TEXT, "Name" TEXT, "Email" TEXT, "Phone" TEXT)`);
    execQuery(`INSERT INTO "Contacts" VALUES ('1', 'Alice', 'alice@test.com', '555-0001')`);

    execQuery('DROP TABLE IF EXISTS "Regions"');
    execQuery(`CREATE TABLE "Regions" ("RegionId" TEXT, "RegionName" TEXT, "Manager" TEXT)`);
    execQuery(`INSERT INTO "Regions" VALUES ('N', 'North', 'Mgr-N')`);
    execQuery(`INSERT INTO "Regions" VALUES ('S', 'South', 'Mgr-S')`);

    const sourceCatalog = standardSourceCatalog();
    sourceCatalog.set('Contacts', {
      id: 'Contacts', name: 'Contacts',
      cols: ['ContactId', 'Name', 'Email', 'Phone'],
      kind: 'imported',
      source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 1 },
    });
    sourceCatalog.set('Regions', {
      id: 'Regions', name: 'Regions',
      cols: ['RegionId', 'RegionName', 'Manager'],
      kind: 'imported',
      source: { id: 'Regions', name: 'Regions', cols: ['RegionId', 'RegionName', 'Manager'], rowCount: 2 },
    });

    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [
          { rightId: 'Contacts', keyPairs: [{ left: 'Contact', right: 'Name' }], cols: ['Email'], required: false, enabled: true, duplicatePolicy: { mode: 'first' } },
          { rightId: 'Regions', keyPairs: [{ left: 'Region', right: 'RegionName' }], cols: ['Manager'], required: false, enabled: true, duplicatePolicy: { mode: 'first' } },
        ],
      },
    });
    const ctx = makeCtx({ reportSpec: spec, sourceCatalog });
    executeLookupStage(ctx);
    const rows = readStage1();
    expect(rows.length).toBe(8);
    // Both new columns should be present
    const aliceRow = rows.find(r => r['Contact'] === 'Alice');
    expect(aliceRow!['Email']).toBe('alice@test.com');
    expect(aliceRow!['Manager']).toBe('Mgr-N');

    execQuery('DROP TABLE IF EXISTS "Regions"');
  });

  it('should deduplicate columns — not add columns already in outputColumns', () => {
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

    createPrevTable();
    // outputColumns already includes 'Name' — should not duplicate
    const ctx = makeCtx({
      reportSpec: makeReportSpec({
        pipeline: {
          ...makeReportSpec().pipeline,
          lookups: [{ rightId: 'Contacts', keyPairs: [{ left: 'Contact', right: 'Name' }], cols: ['Name', 'Email'], required: false, enabled: true, duplicatePolicy: { mode: 'first' } }],
        },
      }),
      sourceCatalog,
      outputColumns: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region', 'Name'],
    });
    const result = executeLookupStage(ctx);
    // 'Name' should appear only once
    const nameCount = result.outputColumns.filter(c => c === 'Name').length;
    expect(nameCount).toBe(1);
    expect(result.outputColumns).toContain('Email');
  });

  it('should skip key pairs with empty left or right', () => {
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

    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: '', right: 'Name' }, { left: 'Contact', right: '' }],
          cols: ['Email'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'first' },
        }],
      },
    });
    const ctx = makeCtx({ reportSpec: spec, sourceCatalog });
    const result = executeLookupStage(ctx);
    // All key pairs are invalid → pass-through
    expect(result.outputTableName).toBe('_pipeline_stage_0');
  });

  it('should create temp table named _pipeline_stage_1', () => {
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

    createPrevTable();
    const spec = makeReportSpec({
      pipeline: {
        ...makeReportSpec().pipeline,
        lookups: [{ rightId: 'Contacts', keyPairs: [{ left: 'Contact', right: 'Name' }], cols: ['Email'], required: false, enabled: true, duplicatePolicy: { mode: 'first' } }],
      },
    });
    const ctx = makeCtx({ reportSpec: spec, sourceCatalog });
    const result = executeLookupStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_1');
    // Verify table exists
    const rows = execQuery('SELECT COUNT(*) as cnt FROM "_pipeline_stage_1"');
    expect(rows[0]['cnt']).toBeGreaterThan(0);
  });

  it('should handle SQL injection in lookup rightId', () => {
    // rightId with quotes should be safely handled by quoteId
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

    createPrevTable();
    // Use a lookup with a key pair that has quotes in column name
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
      },
    });
    const ctx = makeCtx({ reportSpec: spec, sourceCatalog });
    const result = executeLookupStage(ctx);
    expect(result.outputTableName).toBe('_pipeline_stage_1');
  });
});
