import { describe, it, expect } from 'vitest';
import {
  publishReportOutput,
  buildPublishedOutputCatalog,
} from '../../report/report-output';
import type { ResultSet } from '../../report/result-set';
import type { WorkspaceState } from '../../types';
import { createReportSpec, createWorkspaceState } from '../../core/state';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResultSet(overrides: Partial<ResultSet> = {}): ResultSet {
  return {
    columns: ['A', 'B'],
    rows: [
      { A: 1, B: 'x' },
      { A: 2, B: 'y' },
    ],
    metadata: {
      rowCount: 2,
      generatedAt: Date.now(),
      aggMode: 'none',
      displayCols: null,
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('report-output', () => {
  // ── publishReportOutput ──────────────────────────────────────────────────

  describe('publishReportOutput()', () => {
    it('should create a PublishedOutput with correct fields', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Sales Report' });
      const resultSet = makeResultSet();
      const output = publishReportOutput(spec, resultSet);

      expect(output.reportId).toBe('r1');
      expect(output.outputId).toBe('r1_output');
      expect(output.name).toBe('Sales Report (output)');
      expect(output.columns).toEqual(['A', 'B']);
      expect(output.rows).toEqual(resultSet.rows);
      expect(output.source).toBe('report');
      expect(typeof output.publishedAt).toBe('number');
      expect(output.publishedAt).toBeGreaterThan(0);
    });

    it('should use displayCols from metadata when available', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['A', 'B', 'C'],
        metadata: {
          rowCount: 2,
          generatedAt: Date.now(),
          aggMode: 'none',
          displayCols: ['A', 'B'],
        },
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.columns).toEqual(['A', 'B']);
    });

    it('should fall back to columns when displayCols is null', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['X', 'Y'],
        metadata: {
          rowCount: 1,
          generatedAt: Date.now(),
          aggMode: 'none',
          displayCols: null,
        },
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.columns).toEqual(['X', 'Y']);
    });

    it('should filter out subtotal/spacer rows (_row_type non-null and non-zero)', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        rows: [
          { A: 1, B: 'data1', _row_type: null },
          { A: 2, B: 'subtotal', _row_type: 1 },
          { A: 3, B: 'data2', _row_type: 0 },
          { A: 4, B: 'spacer', _row_type: 2 },
          { A: 5, B: 'data3' }, // no _row_type field
        ],
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.rows).toHaveLength(3);
      expect(output.rows[0]).toEqual({ A: 1, B: 'data1', _row_type: null });
      expect(output.rows[1]).toEqual({ A: 3, B: 'data2', _row_type: 0 });
      expect(output.rows[2]).toEqual({ A: 5, B: 'data3' });
    });

    it('should default reportId to "default" when spec.id is null', () => {
      const spec = createReportSpec({ id: null, name: 'Report' });
      const resultSet = makeResultSet();
      const output = publishReportOutput(spec, resultSet);
      expect(output.reportId).toBe('default');
      expect(output.outputId).toBe('default_output');
    });

    it('should default name to "Report" when spec.name is empty', () => {
      const spec = createReportSpec({ id: 'r1', name: '' });
      const resultSet = makeResultSet();
      const output = publishReportOutput(spec, resultSet);
      expect(output.name).toBe('Report (output)');
    });

    it('should handle empty result set', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({ columns: [], rows: [] });
      const output = publishReportOutput(spec, resultSet);
      expect(output.columns).toEqual([]);
      expect(output.rows).toEqual([]);
    });
  });

  // ── Published output with detail band rows ─────────────────────────────

  describe('publishReportOutput() with detail bands', () => {
    it('should include band rows in published output (band rows have no _row_type)', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['OrderID', 'Customer', '_band_0_Product', '_band_0_Qty', '_band_id'],
        rows: [
          { OrderID: 1, Customer: 'Alice', _band_0_Product: null, _band_0_Qty: null, _band_id: null },
          { OrderID: null, Customer: null, _band_0_Product: 'Widget', _band_0_Qty: 5, _band_id: 'band_0' },
          { OrderID: null, Customer: null, _band_0_Product: 'Gadget', _band_0_Qty: 3, _band_id: 'band_0' },
          { OrderID: 2, Customer: 'Bob', _band_0_Product: null, _band_0_Qty: null, _band_id: null },
        ],
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.rows).toHaveLength(4);
      // Parent rows have _band_id = null
      expect(output.rows[0]._band_id).toBeNull();
      expect(output.rows[0].OrderID).toBe(1);
      // Band rows have _band_id set
      expect(output.rows[1]._band_id).toBe('band_0');
      expect(output.rows[1]._band_0_Product).toBe('Widget');
      expect(output.rows[2]._band_id).toBe('band_0');
      expect(output.rows[3]._band_id).toBeNull();
      expect(output.rows[3].OrderID).toBe(2);
    });

    it('should include _band_id in published columns when displayCols omits it', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      // displayCols typically excludes _band_id (it's filtered from grid display)
      const resultSet = makeResultSet({
        columns: ['OrderID', '_band_0_Product', '_band_id'],
        metadata: {
          rowCount: 2,
          generatedAt: Date.now(),
          aggMode: 'none',
          displayCols: ['OrderID', '_band_0_Product'],  // _band_id omitted
        },
      });
      const output = publishReportOutput(spec, resultSet);
      // _band_id should be appended for downstream consumers
      expect(output.columns).toEqual(['OrderID', '_band_0_Product', '_band_id']);
    });

    it('should not duplicate _band_id when already present in displayCols', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['OrderID', '_band_id'],
        metadata: {
          rowCount: 1,
          generatedAt: Date.now(),
          aggMode: 'none',
          displayCols: ['OrderID', '_band_id'],  // _band_id already present
        },
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.columns).toEqual(['OrderID', '_band_id']);
      // No duplicate
      expect(output.columns.filter(c => c === '_band_id')).toHaveLength(1);
    });

    it('should not add _band_id when result set has no band data', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['A', 'B'],
        metadata: {
          rowCount: 1,
          generatedAt: Date.now(),
          aggMode: 'none',
          displayCols: ['A', 'B'],
        },
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.columns).toEqual(['A', 'B']);
      expect(output.columns).not.toContain('_band_id');
    });

    it('should preserve _band_id when displayCols is null (falls back to columns)', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['OrderID', '_band_0_Product', '_band_id'],
        metadata: {
          rowCount: 1,
          generatedAt: Date.now(),
          aggMode: 'none',
          displayCols: null,  // falls back to columns
        },
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.columns).toContain('_band_id');
      expect(output.columns).toEqual(['OrderID', '_band_0_Product', '_band_id']);
    });

    it('should not exclude band rows via _row_type filter (band rows have _row_type undefined)', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['A', '_band_id'],
        rows: [
          { A: 1, _band_id: null },             // parent row, no _row_type
          { A: null, _band_id: 'band_0' },       // band row, no _row_type
          { A: 2, _band_id: null, _row_type: 0 }, // parent row, explicit _row_type=0
          { A: null, _band_id: 'band_1', _row_type: 0 }, // band row, explicit _row_type=0
        ],
      });
      const output = publishReportOutput(spec, resultSet);
      // All 4 rows should pass — none have _row_type > 0
      expect(output.rows).toHaveLength(4);
    });

    it('should still exclude subtotal rows when mixed with band rows', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['A', '_band_id'],
        rows: [
          { A: 1, _band_id: null, _row_type: null },     // parent — keep
          { A: null, _band_id: 'band_0', _row_type: undefined }, // band — keep
          { A: 'TOTAL', _band_id: null, _row_type: 1 },  // subtotal — exclude
          { A: 'SUB', _band_id: null, _row_type: 2 },    // spacer — exclude
          { A: 2, _band_id: null },                       // parent (no _row_type) — keep
        ],
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.rows).toHaveLength(3);
      expect(output.rows[0].A).toBe(1);
      expect(output.rows[1]._band_id).toBe('band_0');
      expect(output.rows[2].A).toBe(2);
    });

    it('should handle multiple bands with distinct _band_id values', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet({
        columns: ['OrderID', '_band_0_Product', '_band_1_Payment', '_band_id'],
        rows: [
          { OrderID: 1, _band_0_Product: null, _band_1_Payment: null, _band_id: null },
          { OrderID: null, _band_0_Product: 'Widget', _band_1_Payment: null, _band_id: 'band_0' },
          { OrderID: null, _band_0_Product: null, _band_1_Payment: '$100', _band_id: 'band_1' },
          { OrderID: 2, _band_0_Product: null, _band_1_Payment: null, _band_id: null },
        ],
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.rows).toHaveLength(4);
      expect(output.columns).toContain('_band_id');
      // Verify band identity is preserved
      const band0Rows = output.rows.filter(r => r._band_id === 'band_0');
      const band1Rows = output.rows.filter(r => r._band_id === 'band_1');
      const parentRows = output.rows.filter(r => r._band_id === null);
      expect(band0Rows).toHaveLength(1);
      expect(band1Rows).toHaveLength(1);
      expect(parentRows).toHaveLength(2);
    });

    it('should handle stacking mode rows where _band_id is last contributing band', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      // In stacking mode, cross-product rows have _band_id set to the last contributing band
      const resultSet = makeResultSet({
        columns: ['OrderID', '_band_0_Product', '_band_1_Payment', '_band_id'],
        rows: [
          { OrderID: 1, _band_0_Product: 'Widget', _band_1_Payment: '$100', _band_id: 'band_1' },
          { OrderID: 1, _band_0_Product: 'Gadget', _band_1_Payment: '$100', _band_id: 'band_1' },
          { OrderID: 1, _band_0_Product: 'Widget', _band_1_Payment: '$200', _band_id: 'band_1' },
        ],
      });
      const output = publishReportOutput(spec, resultSet);
      expect(output.rows).toHaveLength(3);
      // All rows are cross-product rows — all have _band_id set
      for (const row of output.rows) {
        expect(row._band_id).toBe('band_1');
        expect(row.OrderID).toBe(1);
      }
    });
  });

  // ── buildPublishedOutputCatalog ──────────────────────────────────────────

  describe('buildPublishedOutputCatalog()', () => {
    it('should build catalog from workspace with published reports', () => {
      const spec = createReportSpec({
        id: 'r1',
        name: 'Report 1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const ws = createWorkspaceState({ reports: [spec] });
      const cache = new Map<string, ResultSet>();
      cache.set('r1', makeResultSet());

      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(1);
      expect(catalog.has('r1_output')).toBe(true);
      expect(catalog.get('r1_output')!.reportId).toBe('r1');
    });

    it('should skip reports without cached results', () => {
      const spec = createReportSpec({
        id: 'r1',
        name: 'Report 1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const ws = createWorkspaceState({ reports: [spec] });
      const cache = new Map<string, ResultSet>();
      // No entry for 'r1'

      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(0);
    });

    it('should skip unpublished reports (publish.enabled=false)', () => {
      const spec = createReportSpec({
        id: 'r1',
        name: 'Report 1',
        publish: { enabled: false, tableName: '' },
      });
      const ws = createWorkspaceState({ reports: [spec] });
      const cache = new Map<string, ResultSet>();
      cache.set('r1', makeResultSet());

      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(0);
    });

    it('should skip reports with null id', () => {
      const spec = createReportSpec({
        id: null,
        name: 'New Report',
        publish: { enabled: true, tableName: '' },
      });
      const ws = createWorkspaceState({ reports: [spec] });
      const cache = new Map<string, ResultSet>();
      // can't set null key

      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(0);
    });

    it('should handle multiple reports — some published, some not', () => {
      const r1 = createReportSpec({
        id: 'r1',
        name: 'Report 1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = createReportSpec({
        id: 'r2',
        name: 'Report 2',
        publish: { enabled: false, tableName: '' },
      });
      const r3 = createReportSpec({
        id: 'r3',
        name: 'Report 3',
        publish: { enabled: true, tableName: 'r3_output' },
      });
      const ws = createWorkspaceState({ reports: [r1, r2, r3] });
      const cache = new Map<string, ResultSet>();
      cache.set('r1', makeResultSet());
      cache.set('r3', makeResultSet({ columns: ['X'], rows: [{ X: 42 }] }));

      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(2);
      expect(catalog.has('r1_output')).toBe(true);
      expect(catalog.has('r3_output')).toBe(true);
    });

    it('should handle null/undefined workspaceState gracefully', () => {
      const cache = new Map<string, ResultSet>();
      const catalog1 = buildPublishedOutputCatalog(null as unknown as WorkspaceState, cache);
      expect(catalog1.size).toBe(0);

      const catalog2 = buildPublishedOutputCatalog(undefined as unknown as WorkspaceState, cache);
      expect(catalog2.size).toBe(0);
    });

    it('should handle workspace with empty reports array', () => {
      const ws = createWorkspaceState({ reports: [] });
      const cache = new Map<string, ResultSet>();
      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(0);
    });

    it('should publish band data correctly through the catalog', () => {
      const spec = createReportSpec({
        id: 'r1',
        name: 'Orders with Details',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const ws = createWorkspaceState({ reports: [spec] });
      const cache = new Map<string, ResultSet>();
      cache.set('r1', makeResultSet({
        columns: ['OrderID', '_band_0_Product', '_band_id'],
        rows: [
          { OrderID: 1, _band_0_Product: null, _band_id: null },
          { OrderID: null, _band_0_Product: 'Widget', _band_id: 'band_0' },
        ],
      }));

      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(1);
      const output = catalog.get('r1_output')!;
      expect(output.rows).toHaveLength(2);
      expect(output.columns).toContain('_band_id');
      expect(output.rows[0]._band_id).toBeNull();
      expect(output.rows[1]._band_id).toBe('band_0');
    });
  });
});
