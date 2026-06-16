import { describe, it, expect, beforeAll } from 'vitest';
import { runReport } from '../../report/engine';
import type { ReportSpec, DbTable, DetailBandSpec } from '../../types';
import { makeReportSpec } from '../query/helpers';

describe('engine detail bands', () => {
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
      OrderNotes: {
        id: 'OrderNotes', name: 'Order Notes',
        cols: ['NoteId', 'OrderId', 'NoteText', 'NoteDate'],
        rowCount: 4,
      },
    };
  }

  // ── Setup: create child tables in the shared SQLite DB ──────────────────

  beforeAll(() => {
    const db = (globalThis as any).sqlDb;

    db.run(`CREATE TABLE IF NOT EXISTS "LineItems" (
      "ItemId" TEXT, "OrderId" TEXT, "Product" TEXT, "Qty" INTEGER
    )`);

    // Clear any prior data (tables persist across test files)
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

    db.run(`CREATE TABLE IF NOT EXISTS "OrderNotes" (
      "NoteId" TEXT, "OrderId" TEXT, "NoteText" TEXT, "NoteDate" TEXT
    )`);
    db.run(`DELETE FROM "OrderNotes"`);

    const notes = [
      ['N-01', 'ORD-001', 'Rush order', '2025-01-14'],
      ['N-02', 'ORD-001', 'Customer called', '2025-01-15'],
      ['N-03', 'ORD-003', 'Discount applied', '2025-03-09'],
      ['N-04', 'ORD-007', 'VIP customer', '2025-05-11'],
    ];
    const nstmt = db.prepare(
      `INSERT INTO "OrderNotes" ("NoteId","OrderId","NoteText","NoteDate") VALUES (?,?,?,?)`
    );
    for (const row of notes) {
      nstmt.run(row);
    }
    nstmt.free();
  });

  // ── runReport() with detail bands ──────────────────────────────────────

  describe('runReport() with single band', () => {
    it('should produce ResultSet with bandResult populated', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band()],
        },
        outputColumns: ['OrderId', 'Company'],
      });
      const result = runReport(s, tablesWithBands());

      // Metadata
      expect(result.metadata.aggMode).toBe('none');
      expect(result.metadata.bandCount).toBe(1);
      expect(result.metadata.bandIds).toEqual(['band_0']);
      expect(result.metadata.bandLabels).toEqual({ band_0: 'Line Items' });

      // Columns contain only parent data
      expect(result.columns).toContain('OrderId');
      expect(result.columns).toContain('Company');
      expect(result.columns).not.toContain('_band_id');

      // Rows contain only parent rows (8 orders)
      expect(result.rows.length).toBe(8);

      // bandResult is populated
      expect(result.bandResult).toBeDefined();
      expect(result.bandResult!.parentRows.length).toBe(8);
      expect(result.bandResult!.parentCols).toContain('OrderId');
      expect(result.bandResult!.parentCols).toContain('Company');
      expect(result.bandResult!.bandResults.length).toBe(1);
      expect(result.bandResult!.bandLabels).toEqual({ band_0: 'Line Items' });

      // Band result has correct structure
      const br = result.bandResult!.bandResults[0];
      expect(br.band.id).toBe('band_0');
      expect(br.rows.length).toBe(9); // 9 line items total
      expect(br.cols).toContain('_band_0_Product');
      expect(br.cols).toContain('_band_0_Qty');
      expect(br.parentKeyAliases).toEqual(['OrderId']);
      expect(br.childKeyCols).toEqual(['OrderId']);
    });

    it('should have parent-only columns in result.columns', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band()],
        },
        outputColumns: ['OrderId', 'Company'],
      });
      const result = runReport(s, tablesWithBands());

      // result.columns should not contain band columns or _band_id
      expect(result.columns).not.toContain('_band_0_Product');
      expect(result.columns).not.toContain('_band_0_Qty');
      expect(result.columns).not.toContain('_band_id');
    });

    it('should have parent-only rows in result.rows', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band()],
        },
        outputColumns: ['OrderId', 'Company'],
      });
      const result = runReport(s, tablesWithBands());

      // All rows should be parent rows with parent data
      expect(result.rows.length).toBe(8);
      for (const row of result.rows) {
        expect(row['OrderId']).toBeTruthy();
        expect(row['Company']).toBeTruthy();
      }
    });

    it('should handle parent with no matching children', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band()],
        },
        outputColumns: ['OrderId', 'Company'],
        filters: [{ col: 'OrderId', op: '=', val: 'ORD-004', vals: ['ORD-004'], enabled: true }],
      });
      const result = runReport(s, tablesWithBands());

      // ORD-004 has no line items — only 1 parent row
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]['OrderId']).toBe('ORD-004');

      // bandResult still populated, but band has 0 matching rows
      expect(result.bandResult).toBeDefined();
      expect(result.bandResult!.parentRows.length).toBe(1);
      expect(result.bandResult!.bandResults[0].rows.length).toBe(0);
    });
  });

  describe('runReport() with multi-band', () => {
    it('should populate bandResult with multiple band results', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Company'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [
            band({ id: 'band_0' }),
            band({
              id: 'band_1',
              rightId: 'OrderNotes',
              keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
              cols: ['NoteText'],
              label: 'Notes',
            }),
          ],
        },
        outputColumns: ['OrderId', 'Company'],
      });
      const result = runReport(s, tablesWithBands());

      // Metadata
      expect(result.metadata.bandCount).toBe(2);
      expect(result.metadata.bandIds).toEqual(['band_0', 'band_1']);

      // Columns contain only parent data
      expect(result.columns).not.toContain('_band_id');
      expect(result.columns).not.toContain('_band_0_Product');
      expect(result.columns).not.toContain('_band_1_NoteText');

      // Rows contain only parent rows
      expect(result.rows.length).toBe(8);

      // bandResult has both bands
      expect(result.bandResult).toBeDefined();
      expect(result.bandResult!.bandResults.length).toBe(2);
      expect(result.bandResult!.bandResults[0].band.id).toBe('band_0');
      expect(result.bandResult!.bandResults[1].band.id).toBe('band_1');
      expect(result.bandResult!.bandLabels).toEqual({ band_0: 'Line Items', band_1: 'Notes' });

      // band_0 has 9 rows (line items), band_1 has 4 rows (notes)
      expect(result.bandResult!.bandResults[0].rows.length).toBe(9);
      expect(result.bandResult!.bandResults[1].rows.length).toBe(4);
    });
  });

  describe('runReport() dispatch', () => {
    it('should fall through to detail mode when no bands are enabled', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band({ enabled: false })],
        },
      });
      const result = runReport(s, tablesWithBands());
      // Should use normal detail mode — no band metadata
      expect(result.metadata.bandCount).toBeUndefined();
      expect(result.rows.length).toBe(8); // 8 orders, no interleaving
    });

    it('should fall through to detail mode with empty detailBands', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [],
        },
      });
      const result = runReport(s, tablesWithBands());
      expect(result.metadata.bandCount).toBeUndefined();
      expect(result.rows.length).toBe(8);
    });

    it('should not use bands mode for non-none aggMode', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId', 'Amount'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band()],
        },
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
      const result = runReport(s, tablesWithBands());
      // Should use totals mode, not bands mode
      expect(result.metadata.aggMode).toBe('totals');
      expect(result.metadata.bandCount).toBeUndefined();
    });
  });

  describe('runReport() band query execution', () => {
    it('should sort band rows by band sort specification', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band({
            sorts: [{ col: 'Product', dir: 'DESC', enabled: true }],
          })],
        },
        outputColumns: ['OrderId'],
        filters: [{ col: 'OrderId', op: '=', val: 'ORD-001', vals: ['ORD-001'], enabled: true }],
      });
      const result = runReport(s, tablesWithBands());

      // bandResult should have sorted band rows
      expect(result.bandResult).toBeDefined();
      const br = result.bandResult!.bandResults[0];
      // ORD-001 has Widget and Gadget — DESC order: Widget first, then Gadget
      expect(br.rows.length).toBe(2);
      expect(br.rows[0]['_band_0_Product']).toBe('Widget');
      expect(br.rows[1]['_band_0_Product']).toBe('Gadget');
    });

    it('should skip bands with empty rightId', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band({ rightId: '' })],
        },
      });
      const result = runReport(s, tablesWithBands());
      // Band with empty rightId is filtered out — falls through to detail mode
      expect(result.metadata.bandCount).toBeUndefined();
      expect(result.rows.length).toBe(8);
    });
  });

});
