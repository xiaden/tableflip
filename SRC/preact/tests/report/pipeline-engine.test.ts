/**
 * Tests for PipelineEngine — invalidateFromStage, stage caching,
 * getTempTableColumns, and cleanup.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getPipelineEngine, getTempTableColumns } from '../../report/pipeline-engine';
import { runReport } from '../../report/engine';
import { execQuery } from '../../core/sqldb';
import { makeReportSpec, standardTables } from '../query/helpers';
import type { ReportSpec } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function tableExists(name: string): boolean {
  try {
    const rows = execQuery(`SELECT COUNT(*) as cnt FROM "${name}"`);
    return (rows[0]['cnt'] as number) >= 0;
  } catch {
    return false;
  }
}

function runPipeline(spec?: ReportSpec) {
  const engine = getPipelineEngine();
  engine.cleanup();
  const reportSpec = spec ?? makeReportSpec();
  const tables = standardTables();
  return runReport(reportSpec, tables);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PipelineEngine', () => {
  afterEach(() => {
    getPipelineEngine().cleanup();
  });

  // ── invalidateFromStage ──────────────────────────────────────────────────

  describe('invalidateFromStage()', () => {
    it('should drop temp tables for stages after the given index', () => {
      runPipeline();
      const engine = getPipelineEngine();
      const state = engine.getState();

      // All 6 stages should have been executed
      expect(state.validUpToStage).toBe(5);

      // Invalidate from stage 3 → stages 4 and 5 should be dropped
      engine.invalidateFromStage(3);

      const stateAfter = engine.getState();
      expect(stateAfter.validUpToStage).toBe(3);

      // Stages 0-3 temp tables should still exist
      // (Note: some stages share temp table names via pass-through)
      // Stage 4 and 5 entries should be cleared
      expect(stateAfter.tempTableNames[4]).toBe('');
      expect(stateAfter.tempTableNames[5]).toBe('');
    });

    it('should keep stages 0-3 intact when invalidating from stage 3', () => {
      // Use filters + sorts so stages 3 and 4 create distinct tables
      const spec = makeReportSpec({
        filters: [{ col: 'Company', op: 'equals', val: 'Acme Corp', vals: ['Acme Corp'], enabled: true }],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      runPipeline(spec);
      const engine = getPipelineEngine();
      const stateBefore = engine.getState();

      // Capture the temp table names for stages 0-3
      const tablesBefore = stateBefore.tempTableNames.slice(0, 4);

      engine.invalidateFromStage(3);
      const stateAfter = engine.getState();

      // Stages 0-3 temp table names should be unchanged
      for (let i = 0; i <= 3; i++) {
        expect(stateAfter.tempTableNames[i]).toBe(tablesBefore[i]);
      }
    });

    it('should correctly reduce validUpToStage after invalidation', () => {
      runPipeline();
      const engine = getPipelineEngine();

      // Invalidate from stage 2 → validUpToStage should be min(5, 2) = 2
      engine.invalidateFromStage(2);
      expect(engine.getState().validUpToStage).toBe(2);

      // Invalidate from stage 0 → validUpToStage should be min(2, 0) = 0
      engine.invalidateFromStage(0);
      expect(engine.getState().validUpToStage).toBe(0);
    });

    it('should re-execute correctly after invalidation with distinct stage tables', () => {
      // Use lookups + calcs + filters + sorts so each stage creates its own temp table
      // (without these, stages pass-through and share _pipeline_stage_0)
      execQuery('DROP TABLE IF EXISTS "Contacts"');
      execQuery(`CREATE TABLE "Contacts" ("ContactId" TEXT, "Name" TEXT, "Email" TEXT)`);
      execQuery(`INSERT INTO "Contacts" VALUES ('Alice', 'Alice', 'alice@test.com')`);

      const tablesWithContacts = {
        ...standardTables(),
        Contacts: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email'], rowCount: 1 },
      };

      const spec = makeReportSpec({
        pipeline: {
          ...makeReportSpec().pipeline,
          lookups: [{
            rightId: 'Contacts',
            keyPairs: [{ left: 'Contact', right: 'ContactId' }],
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
      });

      // First execution
      const engine = getPipelineEngine();
      engine.cleanup();
      engine.execute(spec, tablesWithContacts);
      // Stages 0-2 should have distinct tables
      const stateBefore = engine.getState();
      expect(stateBefore.tempTableNames[0]).toBe('_pipeline_stage_0');
      expect(stateBefore.tempTableNames[1]).toBe('_pipeline_stage_1');
      expect(stateBefore.tempTableNames[2]).toBe('_pipeline_stage_2');

      // Invalidate from stage 2 — stages 3+ are dropped, 0-2 survive
      engine.invalidateFromStage(2);
      expect(engine.getState().validUpToStage).toBe(2);
      // Stage 0 table should still exist
      expect(tableExists('_pipeline_stage_0')).toBe(true);

      // Re-execute — stages 0-2 cached, stages 3-5 re-created
      const result = engine.execute(spec, tablesWithContacts);

      expect(engine.getState().validUpToStage).toBe(5);
      expect(result.rows.length).toBeGreaterThan(0);

      // Cleanup contacts table
      execQuery('DROP TABLE IF EXISTS "Contacts"');
    });
  });

  // ── Stage caching (validUpToStage) ────────────────────────────────────────

  describe('stage caching', () => {
    it('should have validUpToStage=5 after full pipeline execution', () => {
      runPipeline();
      const engine = getPipelineEngine();
      const state = engine.getState();

      expect(state.validUpToStage).toBe(5);
      // Should have 6 temp table name entries (stages 0-5)
      expect(state.tempTableNames.length).toBe(6);
      // At least some should be non-empty
      const nonEmpty = state.tempTableNames.filter(n => n !== '');
      expect(nonEmpty.length).toBeGreaterThan(0);
    });

    it('should skip stages on re-execution without cleanup (cached)', () => {
      const spec = makeReportSpec();
      const tables = standardTables();

      // First execution
      runPipeline(spec);
      const engine = getPipelineEngine();
      const state1 = engine.getState();
      const tempTables1 = [...state1.tempTableNames];

      // Second execution WITHOUT cleanup — stages should be cached
      const result2 = engine.execute(spec, tables);
      const state2 = engine.getState();

      // Temp table names should be identical (no new tables created)
      expect(state2.tempTableNames).toEqual(tempTables1);
      expect(state2.validUpToStage).toBe(5);

      // Result should be the same
      expect(result2.rows.length).toBeGreaterThan(0);
    });

    it('should re-create stages 3-5 after invalidateFromStage(2) and re-execute', () => {
      const spec = makeReportSpec({
        filters: [{ col: 'Region', op: 'equals', val: 'North', vals: ['North'], enabled: true }],
        sorts: [{ col: 'Amount', dir: 'ASC', enabled: true }],
      });
      const tables = standardTables();

      // First execution
      runPipeline(spec);
      const engine = getPipelineEngine();

      // Invalidate from stage 2
      engine.invalidateFromStage(2);
      expect(engine.getState().validUpToStage).toBe(2);

      // Re-execute — stages 0-2 should be cached, stages 3-5 re-created
      const result = engine.execute(spec, tables);

      expect(engine.getState().validUpToStage).toBe(5);
      expect(result.rows.length).toBeGreaterThan(0);

      // Verify filtered data is correct (North region only)
      for (const row of result.rows) {
        expect(row['Region']).toBe('North');
      }
    });
  });

  // ── getTempTableColumns ──────────────────────────────────────────────────

  describe('getTempTableColumns()', () => {
    it('should return column names from an existing temp table', () => {
      // Create a temp table manually
      execQuery('DROP TABLE IF EXISTS "_test_temp_cols"');
      execQuery('CREATE TEMP TABLE "_test_temp_cols" ("ColA" TEXT, "ColB" INTEGER, "ColC" REAL)');

      const cols = getTempTableColumns('_test_temp_cols');
      expect(cols).toContain('ColA');
      expect(cols).toContain('ColB');
      expect(cols).toContain('ColC');
      expect(cols.length).toBe(3);

      // Cleanup
      execQuery('DROP TABLE IF EXISTS "_test_temp_cols"');
    });

    it('should return columns from a pipeline temp table', () => {
      runPipeline();
      const engine = getPipelineEngine();
      const state = engine.getState();

      // Stage 0 (base) should have the Orders columns
      const baseTableName = state.tempTableNames[0];
      expect(baseTableName).toBeTruthy();

      const cols = getTempTableColumns(baseTableName);
      expect(cols).toContain('OrderId');
      expect(cols).toContain('Company');
      expect(cols).toContain('Amount');
    });

    it('should return empty array for a non-existent table', () => {
      const cols = getTempTableColumns('_this_table_does_not_exist');
      expect(cols).toEqual([]);
    });
  });

  // ── cleanup ──────────────────────────────────────────────────────────────

  describe('cleanup()', () => {
    it('should reset state to initial values', () => {
      runPipeline();
      const engine = getPipelineEngine();

      // Verify state is populated
      expect(engine.getState().validUpToStage).toBe(5);
      expect(engine.getState().tempTableNames.length).toBe(6);

      // Cleanup
      engine.cleanup();

      const state = engine.getState();
      expect(state.validUpToStage).toBe(-1);
      expect(state.tempTableNames).toEqual([]);
    });

    it('should drop all pipeline temp tables', () => {
      const spec = makeReportSpec({
        filters: [{ col: 'Status', op: 'equals', val: 'Open', vals: ['Open'], enabled: true }],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      runPipeline(spec);
      const engine = getPipelineEngine();
      const state = engine.getState();

      // Capture temp table names before cleanup
      const tableNames = state.tempTableNames.filter(n => n !== '');
      expect(tableNames.length).toBeGreaterThan(0);

      // Verify they exist
      for (const name of tableNames) {
        expect(tableExists(name)).toBe(true);
      }

      // Cleanup
      engine.cleanup();

      // All temp tables should be dropped
      for (const name of tableNames) {
        expect(tableExists(name)).toBe(false);
      }
    });

    it('should allow re-execution after cleanup', () => {
      runPipeline();
      const engine = getPipelineEngine();
      engine.cleanup();

      // Re-execute from scratch
      const spec = makeReportSpec();
      const tables = standardTables();
      const result = engine.execute(spec, tables);

      expect(engine.getState().validUpToStage).toBe(5);
      expect(result.rows.length).toBe(8); // All 8 Orders rows
    });
  });
});
