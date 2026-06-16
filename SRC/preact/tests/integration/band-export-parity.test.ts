/**
 * Integration tests — export parity for the overlay descriptor pipeline.
 * Verifies that buildExportFromDescriptors produces correct parent-column-aligned
 * layout, resolves band column aliases to display labels, and generates the
 * expected row kind sequence for grouped parent data with bands.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runReport } from '../../report/engine';
import { buildOverlayDescriptors } from '../../report/overlay-grouping';
import { buildExportFromDescriptors } from '../../ui/export';
import type { ReportSpec, DbTable, DetailBandSpec, OverlayDescriptor, BandResultSet } from '../../types';
import { makeReportSpec } from '../query/helpers';

describe('Integration — Band Export Parity', () => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  function spec(overrides: Partial<ReportSpec> = {}): ReportSpec {
    return makeReportSpec(overrides);
  }

  function band(overrides: Partial<DetailBandSpec> = {}): DetailBandSpec {
    return {
      id: 'band_0',
      rightId: 'LineItems',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['Product', 'Qty'],
      enabled: true,
      sorts: [],
      label: 'Line Items',
      ...overrides,
    };
  }

  function tablesWithBands(): Record<string, DbTable> {
    return {
      Orders: {
        id: 'Orders', name: 'Orders',
        cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
        rowCount: 8,
      },
      LineItems: {
        id: 'LineItems', name: 'Line Items',
        cols: ['ItemId', 'OrderId', 'Product', 'Qty'],
        rowCount: 9,
      },
    };
  }

  /**
   * Build a hdrMap that maps parent column aliases and band-prefixed aliases
   * to display labels. This simulates what buildExportHeaderMap() would produce
   * for the column catalog.
   */
  function makeHdrMap(parentCols: string[], bandResults: BandResultSet['bandResults']): Record<string, string> {
    const hdrMap: Record<string, string> = {};
    for (const col of parentCols) {
      hdrMap[col] = col;
    }
    for (const br of bandResults) {
      for (const col of br.cols) {
        // Strip the _{bandId}_ prefix to get the display label
        const stripped = col.replace(/^_band_\d+_/, '');
        hdrMap[col] = stripped;
      }
    }
    return hdrMap;
  }

  /**
   * Run the full pipeline: engine → descriptors → export.
   */
  function runExportPipeline(
    reportSpec: ReportSpec,
    tables: Record<string, DbTable>,
    detailBands: DetailBandSpec[],
    hdrMap?: Record<string, string>,
  ): {
    descriptors: OverlayDescriptor[];
    bandResult: BandResultSet;
    exportResult: ReturnType<typeof buildExportFromDescriptors>;
  } {
    const result = runReport(reportSpec, tables);
    expect(result.bandResult).toBeDefined();
    const bandResult = result.bandResult!;

    const descriptors = buildOverlayDescriptors(bandResult, detailBands);

    const resolvedHdrMap = hdrMap || makeHdrMap(bandResult.parentCols, bandResult.bandResults);
    const exportResult = buildExportFromDescriptors(descriptors, bandResult.parentCols, resolvedHdrMap);

    return { descriptors, bandResult, exportResult };
  }

  // ── Setup: create child tables in the shared SQLite DB ──────────────────

  beforeAll(() => {
    const db = (globalThis as any).sqlDb;

    db.run(`CREATE TABLE IF NOT EXISTS "LineItems" (
      "ItemId" TEXT, "OrderId" TEXT, "Product" TEXT, "Qty" INTEGER
    )`);
    db.run(`DELETE FROM "LineItems"`);

    const items = [
      ['LI-01', 'ORD-001', 'Widget', 10],
      ['LI-02', 'ORD-001', 'Gadget', 5],
      ['LI-03', 'ORD-002', 'Gizmo', 3],
      ['LI-04', 'ORD-003', 'Widget', 7],
      ['LI-05', 'ORD-003', 'Widget', 2],
      ['LI-06', 'ORD-003', 'Gadget', 1],
      ['LI-07', 'ORD-005', 'Doohickey', 20],
      ['LI-08', 'ORD-007', 'Widget', 4],
      ['LI-09', 'ORD-007', 'Thingamajig', 8],
    ];
    const stmt = db.prepare(
      `INSERT INTO "LineItems" ("ItemId","OrderId","Product","Qty") VALUES (?,?,?,?)`
    );
    for (const row of items) {
      stmt.run(row);
    }
    stmt.free();
  });

  // ── P5-S7: Parent-column-aligned layout ─────────────────────────────────

  describe('Parent-column-aligned layout', () => {
    it('should pass parent rows through with all columns populated', () => {
      const detailBands = [band()];
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
      });

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands);

      // Parent rows (kind 5) should have all parent columns populated
      for (let i = 0; i < exportResult.cleanRows.length; i++) {
        if (exportResult.rowKinds[i] === 5) {
          const row = exportResult.cleanRows[i];
          // Every header position that corresponds to a parent column should be non-empty
          const parentHeaders = exportResult.headers.slice(0, 2); // OrderId, Company
          for (const h of parentHeaders) {
            expect(row[h]).toBeTruthy();
          }
        }
      }
    });

    it('should place match value in col 0 and band display names in remaining positions for section headers', () => {
      const detailBands = [band()];
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
      });

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands);

      // Section headers (kind 4): match value in col 0, band display labels in positions 1+
      for (let i = 0; i < exportResult.cleanRows.length; i++) {
        if (exportResult.rowKinds[i] === 4) {
          const row = exportResult.cleanRows[i];
          const firstHeader = exportResult.headers[0];

          // Position 0: match value (an OrderId)
          expect(row[firstHeader]).toBeTruthy();
          expect(String(row[firstHeader])).toMatch(/^ORD-/);

          // Position 1+: band column display labels (not raw data values)
          // These should be human-readable labels, not prefixed aliases
          for (let h = 1; h < exportResult.headers.length; h++) {
            const val = row[exportResult.headers[h]];
            if (val !== '') {
              // Should not contain _band_ prefix
              expect(String(val)).not.toMatch(/_band_\d+_/);
            }
          }
        }
      }
    });

    it('should have empty col 0 and band values in parent column positions for band data rows', () => {
      const detailBands = [band()];
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
      });

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands);

      // Band data rows (kind 0): empty col 0, band values in parent column positions
      for (let i = 0; i < exportResult.cleanRows.length; i++) {
        if (exportResult.rowKinds[i] === 0) {
          const row = exportResult.cleanRows[i];
          const firstHeader = exportResult.headers[0];

          // Position 0: empty
          expect(row[firstHeader]).toBe('');

          // At least one remaining position should have a band value
          const hasBandValue = exportResult.headers.slice(1).some(h => {
            const v = row[h];
            return v !== '' && v != null;
          });
          expect(hasBandValue).toBe(true);
        }
      }
    });
  });

  // ── P5-S8: Export label correctness ─────────────────────────────────────

  describe('Export label correctness', () => {
    it('should resolve band column aliases to display labels via hdrMap', () => {
      const detailBands = [band()];
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
      });

      // Use explicit hdrMap with custom display labels
      const hdrMap: Record<string, string> = {
        'OrderId': 'Order ID',
        'Company': 'Company Name',
        '_band_0_Product': 'Product Name',
        '_band_0_Qty': 'Quantity',
      };

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands, hdrMap);

      // Headers should use display labels, not raw aliases
      expect(exportResult.headers).toContain('Order ID');
      expect(exportResult.headers).toContain('Company Name');

      // No raw internal aliases should appear in headers
      for (const h of exportResult.headers) {
        expect(h).not.toMatch(/^_band_\d+_/);
        expect(h).not.toBe('_band_0_Product');
        expect(h).not.toBe('_band_0_Qty');
      }
    });

    it('should strip _band_ prefix from labels so no internal prefix leaks', () => {
      const detailBands = [band()];
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
      });

      // hdrMap with prefixed keys that have _band_ prefix in the label
      const hdrMap: Record<string, string> = {
        'OrderId': 'OrderId',
        'Company': 'Company',
        '_band_0_Product': '_band_0_Product',
        '_band_0_Qty': '_band_0_Qty',
      };

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands, hdrMap);

      // Even when hdrMap returns the raw alias, the prefix should be stripped
      // in section header display labels
      for (let i = 0; i < exportResult.cleanRows.length; i++) {
        if (exportResult.rowKinds[i] === 4) {
          const row = exportResult.cleanRows[i];
          for (const h of exportResult.headers) {
            const val = row[h];
            if (typeof val === 'string' && val !== '') {
              expect(val).not.toMatch(/^_band_\d+_/);
            }
          }
        }
      }

      // Extra headers (from band width expansion) should also have prefix stripped
      for (const h of exportResult.headers) {
        expect(h).not.toMatch(/^_band_\d+_/);
      }
    });

    it('should not have raw internal aliases in exported headers', () => {
      const detailBands = [band()];
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
      });

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands);

      // None of the exported headers should be raw internal aliases
      for (const h of exportResult.headers) {
        expect(h).not.toMatch(/^_/);
      }
    });
  });

  // ── P5-S9: Export row kind sequence ─────────────────────────────────────

  describe('Export row kind sequence', () => {
    it('should follow [5, 4, 0, 0, 5, 4, 0, ...] pattern for grouped parent data with bands', () => {
      const detailBands = [band()];
      // Filter to ORD-001 (2 children) and ORD-002 (1 child)
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
        filters: [
          { col: 'OrderId', op: 'in', val: '', vals: ['ORD-001', 'ORD-002'], enabled: true },
        ],
      });

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands);

      // Expected sequence:
      // ORD-001: parent(5), section(4), band-row(0), band-row(0)
      // ORD-002: parent(5), section(4), band-row(0)
      expect(exportResult.rowKinds).toEqual([5, 4, 0, 0, 5, 4, 0]);
    });

    it('should produce [5, 4, 5, 4] pattern for parents with no matching children', () => {
      const detailBands = [band()];
      // Filter to ORD-004 and ORD-006 (both have no line items)
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
        filters: [
          { col: 'OrderId', op: 'in', val: '', vals: ['ORD-004', 'ORD-006'], enabled: true },
        ],
      });

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands);

      // Expected sequence:
      // ORD-004: parent(5), section(4) [no children]
      // ORD-006: parent(5), section(4) [no children]
      expect(exportResult.rowKinds).toEqual([5, 4, 5, 4]);
    });

    it('should produce correct sequence for mixed groups (with and without children)', () => {
      const detailBands = [band()];
      // Filter to ORD-001 (2 children), ORD-004 (no children), ORD-002 (1 child)
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['OrderId', 'Company'],
        filters: [
          { col: 'OrderId', op: 'in', val: '', vals: ['ORD-001', 'ORD-002', 'ORD-004'], enabled: true },
        ],
      });

      const { exportResult } = runExportPipeline(s, tablesWithBands(), detailBands);

      // Expected sequence (orders sorted by OrderId):
      // ORD-001: parent(5), section(4), band-row(0), band-row(0)
      // ORD-002: parent(5), section(4), band-row(0)
      // ORD-004: parent(5), section(4) [no children]
      expect(exportResult.rowKinds).toEqual([5, 4, 0, 0, 5, 4, 0, 5, 4]);
    });
  });
});
