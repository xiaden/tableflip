import { describe, it, expect } from 'vitest';
import {
  createAppState,
  createWorkspaceState,
  createReportSpec,
  createLookupSpec,
  createDetailBandSpec,
  createFilterSpec,
  createSortSpec,
  createOutputColumnSpec,
  buildReportSpecFromState,
} from '../../core/state';

describe('State Constructors', () => {
  describe('createAppState()', () => {
    it('should return a complete AppState with defaults', () => {
      const state = createAppState();
      expect(state.tables).toEqual({});
      expect(state.excludedRows).toEqual({});
      expect(state.tableColors).toEqual({});
      expect(state.columnLabels).toEqual({});
      expect(state.base).toBe('');
      expect(state.baseCols).toEqual([]);
      expect(state.stacks).toEqual([]);
      expect(state.lookups).toEqual([]);
      expect(state.calcStages).toEqual([]);
      expect(state.selCols).toEqual(new Set());
      expect(state.colOrder).toEqual([]);
      expect(state.filters).toEqual([]);
      expect(state.groupBy).toEqual([]);
      expect(state.aggregates).toEqual([]);
      expect(state.aggMode).toBe('none');
      expect(state.aggModeState).toBeNull();
      expect(state.colTotals).toEqual({});
      expect(state.subtotalBy).toEqual([]);
      expect(state.subtotalFns).toEqual({});
      expect(state.subtotalGrandTotal).toBe(true);
      expect(state.subtotalSpacer).toBe(false);
      expect(state.subtotalOnTop).toBe(false);
      expect(state.subtotalStrategy).toBe('combined');
      expect(state.mergedCols).toEqual([]);
      expect(state.mergeGroupUnderline).toBe(false);
      expect(state.colState).toBeNull();
      expect(state.sorts).toEqual([]);
      expect(state.result).toBeNull();
      expect(state.detailBands).toEqual([]);
      expect(state.detailBandMode).toBe('separate');
    });

    it('should apply overrides', () => {
      const state = createAppState({
        base: 'Orders',
        aggMode: 'group',
        stacks: ['Contacts'],
        filters: [{ col: 'Status', op: 'equals', val: 'Open', vals: null, enabled: true }],
      });
      expect(state.base).toBe('Orders');
      expect(state.aggMode).toBe('group');
      expect(state.stacks).toEqual(['Contacts']);
      expect(state.filters).toHaveLength(1);
      expect(state.filters[0].col).toBe('Status');
    });

    it('should not share state between calls', () => {
      const s1 = createAppState();
      const s2 = createAppState();
      s1.base = 'Modified';
      expect(s2.base).toBe('');
    });
  });

  describe('createWorkspaceState()', () => {
    it('should return a complete WorkspaceState with defaults', () => {
      const ws = createWorkspaceState();
      expect(ws.version).toBe(1);
      expect(ws.sourceTables).toEqual({});
      expect(ws.reports).toEqual([]);
      expect(ws.activeReportId).toBeNull();
      expect(ws.runtime.resultsByReportId).toEqual({});
      expect(ws.runtime.validationByReportId).toEqual({});
      expect(ws.runtime.activeGridState).toEqual({});
    });

    it('should apply overrides', () => {
      const ws = createWorkspaceState({ version: 2, activeReportId: 'rpt-1' });
      expect(ws.version).toBe(2);
      expect(ws.activeReportId).toBe('rpt-1');
    });
  });

  describe('createReportSpec()', () => {
    it('should return a complete ReportSpec with defaults', () => {
      const rpt = createReportSpec();
      expect(rpt.id).toBeNull();
      expect(rpt.name).toBe('New Report');
      expect(rpt.enabled).toBe(true);
      expect(rpt.pipeline.base).toBe('');
      expect(rpt.pipeline.baseCols).toEqual([]);
      expect(rpt.pipeline.stacks).toEqual([]);
      expect(rpt.pipeline.lookups).toEqual([]);
      expect(rpt.pipeline.calculatedColumns).toEqual([]);
      expect(rpt.pipeline.detailBands).toEqual([]);
      expect(rpt.outputColumns).toEqual([]);
      expect(rpt.filters).toEqual([]);
      expect(rpt.sorts).toEqual([]);
      expect(rpt.aggregation.mode).toBe('none');
      expect(rpt.aggregation.groupBy).toEqual([]);
      expect(rpt.aggregation.aggregates).toEqual([]);
      expect(rpt.mergeDisplay.mergedCols).toEqual([]);
      expect(rpt.mergeDisplay.mergeGroupUnderline).toBe(false);
      expect(rpt.publish.enabled).toBe(false);
      expect(rpt.detailBandMode).toBe('separate');
    });

    it('should apply overrides', () => {
      const rpt = createReportSpec({ name: 'Sales Report', id: 'rpt-42' });
      expect(rpt.name).toBe('Sales Report');
      expect(rpt.id).toBe('rpt-42');
    });
  });

  describe('createLookupSpec()', () => {
    it('should return a complete LookupSpec with defaults', () => {
      const lookup = createLookupSpec();
      expect(lookup.rightId).toBe('');
      expect(lookup.keyPairs).toEqual([]);
      expect(lookup.cols).toEqual([]);
      expect(lookup.required).toBe(false);
      expect(lookup.enabled).toBe(true);
      expect(lookup.duplicatePolicy).toEqual({ mode: 'block' });
    });

    it('should apply overrides', () => {
      const lookup = createLookupSpec({
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        required: true,
      });
      expect(lookup.rightId).toBe('Contacts');
      expect(lookup.keyPairs).toHaveLength(1);
      expect(lookup.required).toBe(true);
    });
  });

  describe('createDetailBandSpec()', () => {
    it('should return a complete DetailBandSpec with defaults', () => {
      const band = createDetailBandSpec();
      expect(band.id).toBeTruthy();
      expect(band.id).toMatch(/^band_/);
      expect(band.rightId).toBe('');
      expect(band.keyPairs).toEqual([{ left: '', right: '' }]);
      expect(band.cols).toEqual([]);
      expect(band.enabled).toBe(true);
      expect(band.sorts).toEqual([]);
      expect(band.label).toBe('');
    });

    it('should apply overrides', () => {
      const band = createDetailBandSpec({
        rightId: 'LineItems',
        keyPairs: [{ left: 'OrderID', right: 'OrderID' }],
        cols: ['Product', 'Qty'],
        label: 'Items',
      });
      expect(band.rightId).toBe('LineItems');
      expect(band.keyPairs).toHaveLength(1);
      expect(band.cols).toEqual(['Product', 'Qty']);
      expect(band.label).toBe('Items');
    });
  });

  describe('createFilterSpec()', () => {
    it('should return a complete FilterSpec with defaults', () => {
      const filter = createFilterSpec();
      expect(filter.col).toBe('');
      expect(filter.op).toBe('contains');
      expect(filter.val).toBe('');
      expect(filter.vals).toBeNull();
      expect(filter.enabled).toBe(true);
    });

    it('should apply overrides', () => {
      const filter = createFilterSpec({ col: 'Status', op: 'equals', val: 'Open' });
      expect(filter.col).toBe('Status');
      expect(filter.op).toBe('equals');
      expect(filter.val).toBe('Open');
    });
  });

  describe('createSortSpec()', () => {
    it('should return a complete SortSpec with defaults', () => {
      const sort = createSortSpec();
      expect(sort.col).toBe('');
      expect(sort.dir).toBe('ASC');
      expect(sort.enabled).toBe(true);
    });

    it('should apply overrides', () => {
      const sort = createSortSpec({ col: 'Amount', dir: 'DESC' });
      expect(sort.col).toBe('Amount');
      expect(sort.dir).toBe('DESC');
    });
  });

  describe('createOutputColumnSpec()', () => {
    it('should return a complete OutputColumnSpec with defaults', () => {
      const col = createOutputColumnSpec();
      expect(col.alias).toBe('');
      expect(col.label).toBe('');
      expect(col.visible).toBe(true);
      expect(col.width).toBeNull();
    });

    it('should apply overrides', () => {
      const col = createOutputColumnSpec({ alias: 'Amount', label: 'Total', visible: false, width: 120 });
      expect(col.alias).toBe('Amount');
      expect(col.label).toBe('Total');
      expect(col.visible).toBe(false);
      expect(col.width).toBe(120);
    });
  });

  describe('buildReportSpecFromState()', () => {
    it('should include all 6 fields from a full AppState', () => {
      const state = createAppState({
        base: 'Orders',
        baseCols: ['OrderID', 'Customer'],
        stacks: ['Contacts'],
        lookups: [createLookupSpec({ rightId: 'Contacts' })],
        calcStages: [{ alias: 'calc1', mode: 'math', expression: '1+1', enabled: true }],
        detailBands: [createDetailBandSpec({ rightId: 'LineItems' })],
      });
      const spec = buildReportSpecFromState(state);
      expect(Object.keys(spec).sort()).toEqual([
        'base', 'baseCols', 'calcStages', 'detailBands', 'lookups', 'stacks',
      ]);
    });

    it('should pass through each field value correctly', () => {
      const lookups = [createLookupSpec({ rightId: 'Contacts' })];
      const detailBands = [createDetailBandSpec({ rightId: 'LineItems' })];
      const state = createAppState({
        base: 'Orders',
        baseCols: ['OrderID', 'Customer'],
        stacks: ['Contacts'],
        lookups,
        calcStages: [{ alias: 'calc1', mode: 'math', expression: '1+1', enabled: true }],
        detailBands,
      });
      const spec = buildReportSpecFromState(state);
      expect(spec.base).toBe('Orders');
      expect(spec.baseCols).toEqual(['OrderID', 'Customer']);
      expect(spec.stacks).toEqual(['Contacts']);
      expect(spec.lookups).toBe(lookups);
      expect(spec.calcStages).toBe(state.calcStages);
      expect(spec.detailBands).toBe(detailBands);
    });

    it('should default detailBands to [] when state.detailBands is undefined', () => {
      const state = createAppState();
      // Simulate missing detailBands (e.g. older state shape)
      (state as unknown as Record<string, unknown>).detailBands = undefined;
      const spec = buildReportSpecFromState(state);
      expect(spec.detailBands).toEqual([]);
    });

    it('should default detailBands to [] when state.detailBands is null', () => {
      const state = createAppState();
      (state as unknown as Record<string, unknown>).detailBands = null;
      const spec = buildReportSpecFromState(state);
      expect(spec.detailBands).toEqual([]);
    });

    it('should not share top-level object reference with input state', () => {
      const state = createAppState({ base: 'Orders' });
      const spec = buildReportSpecFromState(state);
      // Mutating the returned object must not affect the input state
      (spec as Record<string, unknown>).base = 'Modified';
      expect(state.base).toBe('Orders');
    });
  });
});
