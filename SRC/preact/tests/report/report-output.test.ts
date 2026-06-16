import { describe, it, expect } from 'vitest';
import {
  publishReportOutput,
  buildPublishedOutputCatalog,
} from '../../report/report-output';
import type { ResultSet } from '../../report/result-set';
import type { WorkspaceState, BandResultSet } from '../../types';
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
      displayCols: [],
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
          displayCols: [],
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

  // ── Published output with detail bands (overlay model) ────────────────

  describe('publishReportOutput() with detail bands', () => {
    function makeBandResultSet(): BandResultSet {
      return {
        parentRows: [
          { OrderID: 1, Customer: 'Alice' },
          { OrderID: 2, Customer: 'Bob' },
        ],
        parentCols: ['OrderID', 'Customer'],
        bandResults: [
          {
            band: {
              id: 'band_0',
              rightId: 'products',
              keyPairs: [{ left: 'OrderID', right: 'OrderID' }],
              cols: ['Product', 'Qty'],
              enabled: true,
              sorts: [],
              label: 'Products',
            },
            rows: [
              { OrderID: 1, Product: 'Widget', Qty: 5 },
              { OrderID: 1, Product: 'Gadget', Qty: 3 },
              { OrderID: 2, Product: 'Doohickey', Qty: 1 },
            ],
            cols: ['OrderID', 'Product', 'Qty'],
            parentKeyAliases: ['OrderID'],
            childKeyCols: ['OrderID'],
          },
        ],
        bandLabels: { band_0: 'Products' },
      };
    }

    it('should include bandResult when ResultSet has bandResult', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const bandResult = makeBandResultSet();
      const resultSet = makeResultSet({
        columns: ['OrderID', 'Customer'],
        rows: bandResult.parentRows,
      });
      resultSet.bandResult = bandResult;

      const output = publishReportOutput(spec, resultSet);
      expect(output.bandResult).toBeDefined();
      expect(output.bandResult).toBe(bandResult);
    });

    it('should not include bandResult when ResultSet has no bandResult', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const resultSet = makeResultSet();
      const output = publishReportOutput(spec, resultSet);
      expect(output.bandResult).toBeUndefined();
    });

    it('should contain only parent columns (no _band_id injection)', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const bandResult = makeBandResultSet();
      const resultSet = makeResultSet({
        columns: ['OrderID', 'Customer'],
        rows: bandResult.parentRows,
      });
      resultSet.bandResult = bandResult;

      const output = publishReportOutput(spec, resultSet);
      expect(output.columns).toEqual(['OrderID', 'Customer']);
      expect(output.columns).not.toContain('_band_id');
    });

    it('should contain only parent rows (no interleaved band rows)', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const bandResult = makeBandResultSet();
      const resultSet = makeResultSet({
        columns: ['OrderID', 'Customer'],
        rows: bandResult.parentRows,
      });
      resultSet.bandResult = bandResult;

      const output = publishReportOutput(spec, resultSet);
      expect(output.rows).toHaveLength(2);
      expect(output.rows[0]).toEqual({ OrderID: 1, Customer: 'Alice' });
      expect(output.rows[1]).toEqual({ OrderID: 2, Customer: 'Bob' });
    });

    it('should preserve bandResult structure (parentRows, parentCols, bandResults, bandLabels)', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const bandResult = makeBandResultSet();
      const resultSet = makeResultSet({
        columns: bandResult.parentCols,
        rows: bandResult.parentRows,
      });
      resultSet.bandResult = bandResult;

      const output = publishReportOutput(spec, resultSet);
      const br = output.bandResult!;
      expect(br.parentRows).toEqual(bandResult.parentRows);
      expect(br.parentCols).toEqual(bandResult.parentCols);
      expect(br.bandResults).toHaveLength(1);
      expect(br.bandResults[0].band.id).toBe('band_0');
      expect(br.bandResults[0].rows).toHaveLength(3);
      expect(br.bandLabels).toEqual({ band_0: 'Products' });
    });

    it('should still filter _row_type for parent rows when bandResult is present', () => {
      const spec = createReportSpec({ id: 'r1', name: 'Report' });
      const bandResult = makeBandResultSet();
      const resultSet = makeResultSet({
        columns: ['OrderID', 'Customer'],
        rows: [
          { OrderID: 1, Customer: 'Alice', _row_type: null },
          { OrderID: 'TOTAL', Customer: '', _row_type: 1 },     // subtotal — exclude
          { OrderID: 2, Customer: 'Bob', _row_type: 0 },        // parent — keep
          { OrderID: 'SUB', Customer: '', _row_type: 2 },       // spacer — exclude
        ],
      });
      resultSet.bandResult = bandResult;

      const output = publishReportOutput(spec, resultSet);
      expect(output.rows).toHaveLength(2);
      expect(output.rows[0].OrderID).toBe(1);
      expect(output.rows[1].OrderID).toBe(2);
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
      const bandResult: BandResultSet = {
        parentRows: [
          { OrderID: 1, Customer: 'Alice' },
          { OrderID: 2, Customer: 'Bob' },
        ],
        parentCols: ['OrderID', 'Customer'],
        bandResults: [
          {
            band: {
              id: 'band_0',
              rightId: 'products',
              keyPairs: [{ left: 'OrderID', right: 'OrderID' }],
              cols: ['Product', 'Qty'],
              enabled: true,
              sorts: [],
              label: 'Products',
            },
            rows: [
              { OrderID: 1, Product: 'Widget', Qty: 5 },
            ],
            cols: ['OrderID', 'Product', 'Qty'],
            parentKeyAliases: ['OrderID'],
            childKeyCols: ['OrderID'],
          },
        ],
        bandLabels: { band_0: 'Products' },
      };
      const rs = makeResultSet({
        columns: ['OrderID', 'Customer'],
        rows: bandResult.parentRows,
      });
      rs.bandResult = bandResult;
      cache.set('r1', rs);

      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(1);
      const output = catalog.get('r1_output')!;
      expect(output.columns).toEqual(['OrderID', 'Customer']);
      expect(output.columns).not.toContain('_band_id');
      expect(output.rows).toHaveLength(2);
      expect(output.bandResult).toBeDefined();
      expect(output.bandResult!.parentRows).toEqual(bandResult.parentRows);
      expect(output.bandResult!.parentCols).toEqual(bandResult.parentCols);
      expect(output.bandResult!.bandResults).toHaveLength(1);
      expect(output.bandResult!.bandLabels).toEqual({ band_0: 'Products' });
    });
  });
});
