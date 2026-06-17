/**
 * Tests for deriveValidation() with pipelineState parameter.
 *
 * Verifies that when pipelineState is provided, column validation for
 * filters, sorts, and group-by uses actual temp table columns (via PRAGMA)
 * instead of only the projected column set.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { deriveValidation } from '../../report/validation';
import { getPipelineEngine } from '../../report/pipeline-engine';
import { runReport } from '../../report/engine';
import { createAppState } from '../../core/state';
import { projectedCols } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import { buildColSourceMap } from '../../catalog/column-catalog';
import type { AppState, ReportSpec } from '../../types';
import type { DbTable } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

const ORDERS_COLS = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];

function tables(): Record<string, DbTable> {
  return {
    Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
  };
}

function st(overrides: Partial<AppState> = {}): AppState {
  return createAppState({
    tables: tables(),
    base: 'Orders',
    ...overrides,
  });
}

function toReportSpec(state: AppState): ReportSpec {
  return {
    id: null,
    name: 'test',
    enabled: true,
    pipeline: {
      base: state.base,
      baseCols: state.baseCols,
      stacks: state.stacks || [],
      lookups: state.lookups || [],
      calculatedColumns: state.calcStages || [],
      detailBands: state.detailBands || [],
    },
    outputColumns: state.colOrder || [],
    filters: state.filters || [],
    sorts: state.sorts || [],
    aggregation: {
      mode: state.aggMode,
      groupBy: state.groupBy || [],
      aggregates: state.aggregates || [],
      colTotals: state.colTotals || {},
      subtotalBy: state.subtotalBy || [],
      subtotalFns: state.subtotalFns || {},
      subtotalGrandTotal: state.subtotalGrandTotal,
      subtotalSpacer: state.subtotalSpacer,
      subtotalOnTop: state.subtotalOnTop,
      subtotalStrategy: state.subtotalStrategy || 'combined',
    },
    mergeDisplay: { mergedCols: state.mergedCols || [], mergeGroupUnderline: state.mergeGroupUnderline },
    outputDefinition: null,
    publish: { enabled: false, tableName: '' },
  };
}

function runPipeline(state: AppState) {
  const engine = getPipelineEngine();
  engine.cleanup();
  const spec = toReportSpec(state);
  return runReport(spec, state.tables);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('deriveValidation with pipelineState', () => {
  afterEach(() => {
    getPipelineEngine().cleanup();
  });

  // ── Filter validation with pipeline state ────────────────────────────────

  describe('filter column validation', () => {
    it('should pass validation for a valid filter column with pipeline state', () => {
      const state = st({
        filters: [{ col: 'Company', op: 'equals', val: 'Acme Corp', vals: ['Acme Corp'], enabled: true }],
      });
      runPipeline(state);

      const sourceCatalog = buildSourceCatalog(state.tables);
      const reportSpec = {
        base: state.base,
        baseCols: state.baseCols,
        lookups: state.lookups,
        calcStages: state.calcStages,
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      const colMap = buildColSourceMap();
      const pipelineState = getPipelineEngine().getState();

      const result = deriveValidation(state, proj, colMap, sourceCatalog, pipelineState);

      // Filter on 'Company' — a real column in the temp table — should pass
      expect(result.items['filter_0']).toBeDefined();
      expect(result.items['filter_0'].blocking).toBe(false);
      expect(result.items['filter_0'].resolved).toBe(true);
    });

    it('should block validation for an invalid filter column with pipeline state', () => {
      const state = st({
        filters: [{ col: 'NonExistentColumn', op: 'equals', val: 'X', vals: ['X'], enabled: true }],
      });
      runPipeline(state);

      const sourceCatalog = buildSourceCatalog(state.tables);
      const reportSpec = {
        base: state.base,
        baseCols: state.baseCols,
        lookups: state.lookups,
        calcStages: state.calcStages,
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      const colMap = buildColSourceMap();
      const pipelineState = getPipelineEngine().getState();

      const result = deriveValidation(state, proj, colMap, sourceCatalog, pipelineState);

      // Filter on a column that doesn't exist in the temp table should block
      expect(result.items['filter_0']).toBeDefined();
      expect(result.items['filter_0'].blocking).toBe(true);
      expect(result.items['filter_0'].resolved).toBe(false);
    });
  });

  // ── Sort validation with pipeline state ──────────────────────────────────

  describe('sort column validation', () => {
    it('should pass validation for a valid sort column with pipeline state', () => {
      const state = st({
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      runPipeline(state);

      const sourceCatalog = buildSourceCatalog(state.tables);
      const reportSpec = {
        base: state.base,
        baseCols: state.baseCols,
        lookups: state.lookups,
        calcStages: state.calcStages,
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      const colMap = buildColSourceMap();
      const pipelineState = getPipelineEngine().getState();

      const result = deriveValidation(state, proj, colMap, sourceCatalog, pipelineState);

      expect(result.items['sort_0']).toBeDefined();
      expect(result.items['sort_0'].blocking).toBe(false);
    });

    it('should block validation for an invalid sort column with pipeline state', () => {
      const state = st({
        sorts: [{ col: 'FakeColumn', dir: 'ASC', enabled: true }],
      });
      runPipeline(state);

      const sourceCatalog = buildSourceCatalog(state.tables);
      const reportSpec = {
        base: state.base,
        baseCols: state.baseCols,
        lookups: state.lookups,
        calcStages: state.calcStages,
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      const colMap = buildColSourceMap();
      const pipelineState = getPipelineEngine().getState();

      const result = deriveValidation(state, proj, colMap, sourceCatalog, pipelineState);

      expect(result.items['sort_0']).toBeDefined();
      expect(result.items['sort_0'].blocking).toBe(true);
    });
  });

  // ── Group-by validation with pipeline state ──────────────────────────────

  describe('group-by column validation', () => {
    it('should pass validation for a valid group-by column with pipeline state', () => {
      const state = st({
        aggMode: 'group',
        groupBy: ['Company'],
        aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'TotalAmount', enabled: true }],
      });
      runPipeline(state);

      const sourceCatalog = buildSourceCatalog(state.tables);
      const reportSpec = {
        base: state.base,
        baseCols: state.baseCols,
        lookups: state.lookups,
        calcStages: state.calcStages,
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      const colMap = buildColSourceMap();
      const pipelineState = getPipelineEngine().getState();

      const result = deriveValidation(state, proj, colMap, sourceCatalog, pipelineState);

      expect(result.items['groupby_0']).toBeDefined();
      expect(result.items['groupby_0'].blocking).toBe(false);
    });

    it('should block validation for an invalid group-by column with pipeline state', () => {
      const state = st({
        aggMode: 'group',
        groupBy: ['NonExistentGroupCol'],
        aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'TotalAmount', enabled: true }],
      });
      runPipeline(state);

      const sourceCatalog = buildSourceCatalog(state.tables);
      const reportSpec = {
        base: state.base,
        baseCols: state.baseCols,
        lookups: state.lookups,
        calcStages: state.calcStages,
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      const colMap = buildColSourceMap();
      const pipelineState = getPipelineEngine().getState();

      const result = deriveValidation(state, proj, colMap, sourceCatalog, pipelineState);

      expect(result.items['groupby_0']).toBeDefined();
      expect(result.items['groupby_0'].blocking).toBe(true);
    });
  });

  // ── Consistency: with vs without pipelineState ───────────────────────────

  describe('consistency with and without pipelineState', () => {
    it('should produce same result for valid columns with or without pipelineState', () => {
      const state = st({
        filters: [{ col: 'Company', op: 'equals', val: 'Acme Corp', vals: ['Acme Corp'], enabled: true }],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      runPipeline(state);

      const sourceCatalog = buildSourceCatalog(state.tables);
      const reportSpec = {
        base: state.base,
        baseCols: state.baseCols,
        lookups: state.lookups,
        calcStages: state.calcStages,
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      const colMap = buildColSourceMap();
      const pipelineState = getPipelineEngine().getState();

      // With pipelineState
      const withPipeline = deriveValidation(state, proj, colMap, sourceCatalog, pipelineState);
      // Without pipelineState
      const withoutPipeline = deriveValidation(state, proj, colMap, sourceCatalog);

      // Both should be healthy for valid columns
      expect(withPipeline.reportStatus).toBe('healthy');
      expect(withoutPipeline.reportStatus).toBe('healthy');
    });

    it('should produce same result for invalid columns with or without pipelineState', () => {
      const state = st({
        filters: [{ col: 'FakeCol', op: 'equals', val: 'X', vals: ['X'], enabled: true }],
      });
      runPipeline(state);

      const sourceCatalog = buildSourceCatalog(state.tables);
      const reportSpec = {
        base: state.base,
        baseCols: state.baseCols,
        lookups: state.lookups,
        calcStages: state.calcStages,
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      const colMap = buildColSourceMap();
      const pipelineState = getPipelineEngine().getState();

      // With pipelineState
      const withPipeline = deriveValidation(state, proj, colMap, sourceCatalog, pipelineState);
      // Without pipelineState
      const withoutPipeline = deriveValidation(state, proj, colMap, sourceCatalog);

      // Both should block for invalid columns
      expect(withPipeline.reportStatus).toBe('blocked');
      expect(withoutPipeline.reportStatus).toBe('blocked');
      expect(withPipeline.items['filter_0'].blocking).toBe(true);
      expect(withoutPipeline.items['filter_0'].blocking).toBe(true);
    });
  });
});
