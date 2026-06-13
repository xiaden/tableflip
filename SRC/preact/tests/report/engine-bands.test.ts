import { describe, it, expect, beforeAll } from 'vitest';
import { runReport } from '../../report/engine';
import {
  computeSupersetCols,
  padParentRow,
  padBandRow,
  interleaveRows,
  crossProductRows,
  RowExplosionError,
  STACK_ROW_LIMIT,
} from '../../report/engine';
import type { BandResult } from '../../report/engine';
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

  // ── computeSupersetCols ────────────────────────────────────────────────

  describe('computeSupersetCols()', () => {
    it('should union parent and band columns plus _band_id', () => {
      const result = computeSupersetCols(
        ['OrderId', 'Company'],
        [{ cols: ['_band_0_Product', '_band_0_Qty'] }],
      );
      expect(result).toEqual(['OrderId', 'Company', '_band_0_Product', '_band_0_Qty', '_band_id']);
    });

    it('should not duplicate columns shared between parent and band', () => {
      const result = computeSupersetCols(
        ['OrderId', 'Company'],
        [{ cols: ['OrderId', '_band_0_Product'] }],
      );
      expect(result).toEqual(['OrderId', 'Company', '_band_0_Product', '_band_id']);
    });

    it('should handle multiple bands', () => {
      const result = computeSupersetCols(
        ['OrderId'],
        [
          { cols: ['_band_0_Product'] },
          { cols: ['_band_1_NoteText'] },
        ],
      );
      expect(result).toContain('_band_0_Product');
      expect(result).toContain('_band_1_NoteText');
      expect(result).toContain('_band_id');
    });

    it('should handle no band results', () => {
      const result = computeSupersetCols(['OrderId', 'Company'], []);
      expect(result).toEqual(['OrderId', 'Company', '_band_id']);
    });

    it('should not add _band_id twice', () => {
      const result = computeSupersetCols(
        ['OrderId', '_band_id'],
        [{ cols: ['_band_0_Product'] }],
      );
      const bandIdCount = result.filter(c => c === '_band_id').length;
      expect(bandIdCount).toBe(1);
    });
  });

  // ── padParentRow ───────────────────────────────────────────────────────

  describe('padParentRow()', () => {
    it('should null-pad missing columns and set _band_id = null', () => {
      const row = { OrderId: 'ORD-001', Company: 'Acme' };
      const superset = ['OrderId', 'Company', '_band_0_Product', '_band_id'];
      const padded = padParentRow(row, superset);
      expect(padded['OrderId']).toBe('ORD-001');
      expect(padded['Company']).toBe('Acme');
      expect(padded['_band_0_Product']).toBeNull();
      expect(padded['_band_id']).toBeNull();
    });

    it('should not overwrite existing values', () => {
      const row = { OrderId: 'ORD-001', _band_0_Product: 'existing' };
      const padded = padParentRow(row, ['OrderId', '_band_0_Product', '_band_id']);
      expect(padded['_band_0_Product']).toBe('existing');
      expect(padded['_band_id']).toBeNull();
    });
  });

  // ── padBandRow ─────────────────────────────────────────────────────────

  describe('padBandRow()', () => {
    it('should null-pad parent columns and set _band_id', () => {
      const row = { _band_0_Product: 'Widget', _band_0_Qty: 10, OrderId: 'ORD-001' };
      const superset = ['OrderId', 'Company', '_band_0_Product', '_band_0_Qty', '_band_id'];
      const padded = padBandRow(row, superset, 'band_0');
      expect(padded['_band_0_Product']).toBe('Widget');
      expect(padded['_band_0_Qty']).toBe(10);
      expect(padded['OrderId']).toBe('ORD-001');
      expect(padded['Company']).toBeNull();
      expect(padded['_band_id']).toBe('band_0');
    });

    it('should null-pad other band columns', () => {
      const row = { _band_0_Product: 'Widget' };
      const superset = ['_band_0_Product', '_band_1_NoteText', '_band_id'];
      const padded = padBandRow(row, superset, 'band_0');
      expect(padded['_band_0_Product']).toBe('Widget');
      expect(padded['_band_1_NoteText']).toBeNull();
      expect(padded['_band_id']).toBe('band_0');
    });
  });

  // ── interleaveRows ─────────────────────────────────────────────────────

  describe('interleaveRows()', () => {
    it('should interleave parent and child rows', () => {
      const parentRows = [
        { OrderId: 'ORD-001', Company: 'Acme' },
        { OrderId: 'ORD-002', Company: 'Beta' },
      ];
      const bandResults = [{
        band: { id: 'band_0' } as DetailBandSpec,
        rows: [
          { OrderId: 'ORD-001', _band_0_Product: 'Widget' },
          { OrderId: 'ORD-001', _band_0_Product: 'Gadget' },
          { OrderId: 'ORD-002', _band_0_Product: 'Gizmo' },
        ],
        cols: ['_band_0_Product'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      }];
      const superset = ['OrderId', 'Company', '_band_0_Product', '_band_id'];
      const result = interleaveRows(parentRows, bandResults as any, superset);

      // ORD-001 parent + 2 children, ORD-002 parent + 1 child = 5 rows
      expect(result.length).toBe(5);
      expect(result[0]['OrderId']).toBe('ORD-001');
      expect(result[0]['_band_id']).toBeNull(); // parent
      expect(result[1]['_band_0_Product']).toBe('Widget');
      expect(result[1]['_band_id']).toBe('band_0');
      expect(result[2]['_band_0_Product']).toBe('Gadget');
      expect(result[2]['_band_id']).toBe('band_0');
      expect(result[3]['OrderId']).toBe('ORD-002');
      expect(result[3]['_band_id']).toBeNull(); // parent
      expect(result[4]['_band_0_Product']).toBe('Gizmo');
      expect(result[4]['_band_id']).toBe('band_0');
    });

    it('should handle parent with no matching children', () => {
      const parentRows = [{ OrderId: 'ORD-999' }];
      const bandResults = [{
        band: { id: 'band_0' } as DetailBandSpec,
        rows: [{ OrderId: 'ORD-001', _band_0_Product: 'Widget' }],
        cols: ['_band_0_Product'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      }];
      const superset = ['OrderId', '_band_0_Product', '_band_id'];
      const result = interleaveRows(parentRows, bandResults as any, superset);

      // Only the parent row — no matching children
      expect(result.length).toBe(1);
      expect(result[0]['OrderId']).toBe('ORD-999');
      expect(result[0]['_band_id']).toBeNull();
      expect(result[0]['_band_0_Product']).toBeNull();
    });

    it('should handle empty parent rows', () => {
      const result = interleaveRows(
        [],
        [{
          band: { id: 'band_0' } as DetailBandSpec,
          rows: [{ OrderId: 'ORD-001', _band_0_Product: 'Widget' }],
          cols: ['_band_0_Product'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        } as any],
        ['OrderId', '_band_0_Product', '_band_id'],
      );
      expect(result.length).toBe(0);
    });
  });

  // ── runReport() with detail bands ──────────────────────────────────────

  describe('runReport() with single band', () => {
    it('should produce interleaved result set with _band_id tagging', () => {
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

      // Columns include parent + band cols + _band_id
      expect(result.columns).toContain('OrderId');
      expect(result.columns).toContain('Company');
      expect(result.columns).toContain('_band_0_Product');
      expect(result.columns).toContain('_band_0_Qty');
      expect(result.columns).toContain('_band_id');

      // ORD-001 has 2 line items, ORD-002 has 1, ORD-003 has 3
      // ORD-004 has 0, ORD-005 has 1, ORD-006 has 0, ORD-007 has 2, ORD-008 has 0
      // Total: 8 parents + 9 children = 17 rows
      expect(result.rows.length).toBe(17);

      // Check first parent row (ORD-001)
      const firstParent = result.rows[0];
      expect(firstParent['OrderId']).toBe('ORD-001');
      expect(firstParent['_band_id']).toBeNull();
      expect(firstParent['_band_0_Product']).toBeNull();

      // Check first child row (ORD-001's first item)
      const firstChild = result.rows[1];
      expect(firstChild['_band_id']).toBe('band_0');
      expect(firstChild['_band_0_Product']).toBeTruthy();
      expect(firstChild['Company']).toBeNull(); // null-padded parent col
    });

    it('should null-pad parent rows for band columns', () => {
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

      // All parent rows should have null for band columns
      const parentRows = result.rows.filter(r => r['_band_id'] === null);
      expect(parentRows.length).toBe(8); // 8 orders
      for (const row of parentRows) {
        expect(row['_band_0_Product']).toBeNull();
        expect(row['_band_0_Qty']).toBeNull();
      }
    });

    it('should null-pad band rows for parent columns', () => {
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

      // All band rows should have null for parent-only columns
      const bandRows = result.rows.filter(r => r['_band_id'] !== null);
      expect(bandRows.length).toBe(9); // 9 line items
      for (const row of bandRows) {
        expect(row['Company']).toBeNull();
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
      expect(result.rows[0]['_band_id']).toBeNull();
    });
  });

  describe('runReport() with multi-band separate', () => {
    it('should interleave rows from multiple bands under each parent', () => {
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

      // Columns include both band prefixes
      expect(result.columns).toContain('_band_0_Product');
      expect(result.columns).toContain('_band_1_NoteText');
      expect(result.columns).toContain('_band_id');

      // ORD-001: 1 parent + 2 items + 2 notes = 5 rows
      // ORD-002: 1 parent + 1 item + 0 notes = 2 rows
      // ORD-003: 1 parent + 3 items + 1 note = 5 rows
      // ORD-004: 1 parent + 0 items + 0 notes = 1 row
      // ORD-005: 1 parent + 1 item + 0 notes = 2 rows
      // ORD-006: 1 parent + 0 items + 0 notes = 1 row
      // ORD-007: 1 parent + 2 items + 1 note = 4 rows
      // ORD-008: 1 parent + 0 items + 0 notes = 1 row
      // Total: 21 rows
      expect(result.rows.length).toBe(21);

      // Check ORD-001 section: parent, 2 items, 2 notes
      const ord1Rows = [];
      let i = 0;
      while (i < result.rows.length && !(i > 0 && result.rows[i]['OrderId'] === 'ORD-002' && result.rows[i]['_band_id'] === null)) {
        ord1Rows.push(result.rows[i]);
        i++;
      }
      // ORD-001 section: 1 parent + 2 band_0 + 2 band_1 = 5
      expect(ord1Rows.length).toBe(5);
      expect(ord1Rows[0]['_band_id']).toBeNull(); // parent
      expect(ord1Rows[0]['OrderId']).toBe('ORD-001');

      // Items come first (band_0), then notes (band_1)
      const itemRows = ord1Rows.filter(r => r['_band_id'] === 'band_0');
      const noteRows = ord1Rows.filter(r => r['_band_id'] === 'band_1');
      expect(itemRows.length).toBe(2);
      expect(noteRows.length).toBe(2);

      // Item rows should have null for note columns
      for (const row of itemRows) {
        expect(row['_band_1_NoteText']).toBeNull();
      }
      // Note rows should have null for item columns
      for (const row of noteRows) {
        expect(row['_band_0_Product']).toBeNull();
      }
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

      // ORD-001 has Widget and Gadget — DESC order: Widget first, then Gadget
      const bandRows = result.rows.filter(r => r['_band_id'] === 'band_0');
      expect(bandRows.length).toBe(2);
      expect(bandRows[0]['_band_0_Product']).toBe('Widget');
      expect(bandRows[1]['_band_0_Product']).toBe('Gadget');
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

  // ── crossProductRows ────────────────────────────────────────────────────

  describe('crossProductRows()', () => {
    const superset = ['OrderId', 'Company', '_band_0_Product', '_band_1_NoteText', '_band_id'];

    it('should compute Cartesian product of two bands', () => {
      const parentRow = { OrderId: 'ORD-001', Company: 'Acme' };
      const bandResults = [{
        band: { id: 'band_0' } as DetailBandSpec,
        rows: [
          { OrderId: 'ORD-001', _band_0_Product: 'Widget' },
          { OrderId: 'ORD-001', _band_0_Product: 'Gadget' },
        ],
        cols: ['_band_0_Product'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      }, {
        band: { id: 'band_1' } as DetailBandSpec,
        rows: [
          { OrderId: 'ORD-001', _band_1_NoteText: 'Rush order' },
          { OrderId: 'ORD-001', _band_1_NoteText: 'Customer called' },
        ],
        cols: ['_band_1_NoteText'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      }];

      const result = crossProductRows(parentRow, bandResults as BandResult[], superset);

      // 2 items × 2 notes = 4 rows
      expect(result.length).toBe(4);

      // All rows should have parent data
      for (const row of result) {
        expect(row['OrderId']).toBe('ORD-001');
      }

      // Check cross-product combinations
      const products = result.map(r => r['_band_0_Product']);
      const notes = result.map(r => r['_band_1_NoteText']);
      expect(products).toEqual(['Widget', 'Widget', 'Gadget', 'Gadget']);
      expect(notes).toEqual(['Rush order', 'Customer called', 'Rush order', 'Customer called']);

      // _band_id should be the last band that contributed (band_1)
      for (const row of result) {
        expect(row['_band_id']).toBe('band_1');
      }

      // Null padding: parent cols present, other band cols present
      for (const row of result) {
        expect(row['Company']).toBe('Acme');
      }
    });

    it('should return parent-only row when no bands have matching children', () => {
      const parentRow = { OrderId: 'ORD-999', Company: 'Ghost' };
      const bandResults = [{
        band: { id: 'band_0' } as DetailBandSpec,
        rows: [{ OrderId: 'ORD-001', _band_0_Product: 'Widget' }],
        cols: ['_band_0_Product'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      }];

      const result = crossProductRows(parentRow, bandResults as BandResult[], superset);

      // No matching children → just the parent row, null-padded
      expect(result.length).toBe(1);
      expect(result[0]['OrderId']).toBe('ORD-999');
      expect(result[0]['Company']).toBe('Ghost');
      expect(result[0]['_band_0_Product']).toBeNull();
      expect(result[0]['_band_1_NoteText']).toBeNull();
      expect(result[0]['_band_id']).toBeNull();
    });

    it('should skip bands with no matching children (partial match)', () => {
      const parentRow = { OrderId: 'ORD-001', Company: 'Acme' };
      const bandResults = [{
        band: { id: 'band_0' } as DetailBandSpec,
        rows: [
          { OrderId: 'ORD-001', _band_0_Product: 'Widget' },
          { OrderId: 'ORD-001', _band_0_Product: 'Gadget' },
        ],
        cols: ['_band_0_Product'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      }, {
        band: { id: 'band_1' } as DetailBandSpec,
        rows: [{ OrderId: 'ORD-999', _band_1_NoteText: 'No match' }],
        cols: ['_band_1_NoteText'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      }];

      const result = crossProductRows(parentRow, bandResults as BandResult[], superset);

      // band_1 has no matching children → skip it, product is just 2 rows from band_0
      expect(result.length).toBe(2);
      expect(result[0]['_band_0_Product']).toBe('Widget');
      expect(result[1]['_band_0_Product']).toBe('Gadget');
      // band_1 columns are null-padded
      for (const row of result) {
        expect(row['_band_1_NoteText']).toBeNull();
      }
      // _band_id is band_0 (the only band that contributed)
      for (const row of result) {
        expect(row['_band_id']).toBe('band_0');
      }
    });

    it('should handle single band (same as interleaved for 1 band)', () => {
      const parentRow = { OrderId: 'ORD-001', Company: 'Acme' };
      const bandResults = [{
        band: { id: 'band_0' } as DetailBandSpec,
        rows: [
          { OrderId: 'ORD-001', _band_0_Product: 'Widget' },
          { OrderId: 'ORD-001', _band_0_Product: 'Gadget' },
        ],
        cols: ['_band_0_Product'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      }];
      const singleSuperset = ['OrderId', 'Company', '_band_0_Product', '_band_id'];

      const result = crossProductRows(parentRow, bandResults as BandResult[], singleSuperset);

      // 1 band with 2 children → 2 rows
      expect(result.length).toBe(2);
      expect(result[0]['_band_0_Product']).toBe('Widget');
      expect(result[1]['_band_0_Product']).toBe('Gadget');
      // Parent data preserved
      expect(result[0]['OrderId']).toBe('ORD-001');
      expect(result[0]['Company']).toBe('Acme');
      expect(result[0]['_band_id']).toBe('band_0');
    });

    it('should handle empty band results (no bands at all)', () => {
      const parentRow = { OrderId: 'ORD-001', Company: 'Acme' };
      const result = crossProductRows(parentRow, [], superset);

      // No bands → just the parent row, null-padded
      expect(result.length).toBe(1);
      expect(result[0]['OrderId']).toBe('ORD-001');
      expect(result[0]['_band_0_Product']).toBeNull();
      expect(result[0]['_band_id']).toBeNull();
    });
  });

  // ── RowExplosionError ──────────────────────────────────────────────────

  describe('RowExplosionError', () => {
    it('should have projectedCount and limit properties', () => {
      const err = new RowExplosionError(15000, 10000);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(RowExplosionError);
      expect(err.name).toBe('RowExplosionError');
      expect(err.projectedCount).toBe(15000);
      expect(err.limit).toBe(10000);
    });

    it('should include counts in error message', () => {
      const err = new RowExplosionError(25000, 10000);
      expect(err.message).toContain('25000');
      expect(err.message).toContain('10000');
    });

    it('should be catchable as Error', () => {
      expect(() => {
        throw new RowExplosionError(100, 50);
      }).toThrow(Error);
    });
  });

  describe('crossProductRows() explosion limit', () => {
    it('should throw RowExplosionError when per-parent product exceeds limit', () => {
      const parentRow = { OrderId: 'ORD-001' };

      // Create two bands with many matching children each
      // 200 × 200 = 40,000 > STACK_ROW_LIMIT
      const makeChildren = (bandId: string, count: number) => ({
        band: { id: bandId } as DetailBandSpec,
        rows: Array.from({ length: count }, (_, i) => ({
          OrderId: 'ORD-001',
          [`_${bandId}_col`]: `val_${i}`,
        })),
        cols: [`_${bandId}_col`],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      });

      const bandResults = [
        makeChildren('band_0', 200),
        makeChildren('band_1', 200),
      ];
      const superset = ['OrderId', '_band_0_col', '_band_1_col', '_band_id'];

      expect(() => {
        crossProductRows(parentRow, bandResults as BandResult[], superset);
      }).toThrow(RowExplosionError);

      try {
        crossProductRows(parentRow, bandResults as BandResult[], superset);
      } catch (e) {
        const err = e as RowExplosionError;
        expect(err.projectedCount).toBe(40000);
        expect(err.limit).toBe(STACK_ROW_LIMIT);
      }
    });
  });

  // ── runReport() with stacking mode ──────────────────────────────────────

  describe('runReport() with stacking mode', () => {
    it('should compute cross-product for 2 bands', () => {
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
        detailBandMode: 'stack',
        filters: [{ col: 'OrderId', op: '=', val: 'ORD-001', vals: ['ORD-001'], enabled: true }],
      });
      const result = runReport(s, tablesWithBands());

      // ORD-001 has 2 line items and 2 notes → 2 × 2 = 4 cross-product rows
      expect(result.rows.length).toBe(4);

      // All rows should have parent data (OrderId)
      for (const row of result.rows) {
        expect(row['OrderId']).toBe('ORD-001');
      }

      // Check cross-product: each item × each note
      const products = result.rows.map(r => r['_band_0_Product']);
      const notes = result.rows.map(r => r['_band_1_NoteText']);
      // 2 items × 2 notes = 4 rows
      expect(products.filter(Boolean).length).toBe(4);
      expect(notes.filter(Boolean).length).toBe(4);

      // Columns include both band prefixes + _band_id
      expect(result.columns).toContain('_band_0_Product');
      expect(result.columns).toContain('_band_1_NoteText');
      expect(result.columns).toContain('_band_id');

      // Metadata
      expect(result.metadata.bandCount).toBe(2);
      expect(result.metadata.bandIds).toEqual(['band_0', 'band_1']);
    });

    it('should produce same result as separate mode for single band', () => {
      const sSeparate = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band()],
        },
        outputColumns: ['OrderId'],
        detailBandMode: 'separate',
        filters: [{ col: 'OrderId', op: '=', val: 'ORD-001', vals: ['ORD-001'], enabled: true }],
      });
      const sStack = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band()],
        },
        outputColumns: ['OrderId'],
        detailBandMode: 'stack',
        filters: [{ col: 'OrderId', op: '=', val: 'ORD-001', vals: ['ORD-001'], enabled: true }],
      });

      const resultSeparate = runReport(sSeparate, tablesWithBands());
      const resultStack = runReport(sStack, tablesWithBands());

      // With 1 band, stacking mode should produce same number of band rows
      // Separate: 1 parent + 2 children = 3 rows
      // Stack: 2 cross-product rows (parent × 2 children, but parent row not separate)
      // Actually, in stack mode the parent data is merged into each combo row
      // So: 2 rows (parent×child1, parent×child2) — no separate parent row
      const separateBandRows = resultSeparate.rows.filter(r => r['_band_id'] !== null);
      expect(resultStack.rows.length).toBe(separateBandRows.length);

      // Stack rows should have parent data merged in
      for (const row of resultStack.rows) {
        expect(row['OrderId']).toBe('ORD-001');
        expect(row['_band_id']).toBe('band_0');
      }
    });

    it('should produce parent-only rows when no children match', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [band()],
        },
        outputColumns: ['OrderId'],
        detailBandMode: 'stack',
        filters: [{ col: 'OrderId', op: '=', val: 'ORD-004', vals: ['ORD-004'], enabled: true }],
      });
      const result = runReport(s, tablesWithBands());

      // ORD-004 has no line items → 1 parent-only row
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]['OrderId']).toBe('ORD-004');
      expect(result.rows[0]['_band_id']).toBeNull();
      expect(result.rows[0]['_band_0_Product']).toBeNull();
    });

    it('should compute cross-product across multiple parent rows', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
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
        outputColumns: ['OrderId'],
        detailBandMode: 'stack',
      });
      const result = runReport(s, tablesWithBands());

      // Check specific orders in the result:
      // ORD-001: 2 items × 2 notes = 4 rows
      // ORD-003: 3 items × 1 note = 3 rows
      // ORD-007: 2 items × 1 note = 2 rows
      const ord1Rows = result.rows.filter(r => r['OrderId'] === 'ORD-001');
      const ord3Rows = result.rows.filter(r => r['OrderId'] === 'ORD-003');
      const ord7Rows = result.rows.filter(r => r['OrderId'] === 'ORD-007');

      expect(ord1Rows.length).toBe(4);
      expect(ord3Rows.length).toBe(3);
      expect(ord7Rows.length).toBe(2);

      // Orders with no children in both bands should have 1 parent-only row
      const ord4Rows = result.rows.filter(r => r['OrderId'] === 'ORD-004');
      expect(ord4Rows.length).toBe(1);
      expect(ord4Rows[0]['_band_id']).toBeNull();
    });

    it('should default to separate mode when detailBandMode is not set', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: ['OrderId'],
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
        outputColumns: ['OrderId'],
        // detailBandMode not set — should default to 'separate'
        filters: [{ col: 'OrderId', op: '=', val: 'ORD-001', vals: ['ORD-001'], enabled: true }],
      });
      // Remove detailBandMode to test default
      delete s.detailBandMode;
      const result = runReport(s, tablesWithBands());

      // Separate mode: 1 parent + 2 items + 2 notes = 5 rows (NOT 4 cross-product rows)
      expect(result.rows.length).toBe(5);
      // First row is parent
      expect(result.rows[0]['_band_id']).toBeNull();
    });
  });

  describe('STACK_ROW_LIMIT constant', () => {
    it('should be 10,000', () => {
      expect(STACK_ROW_LIMIT).toBe(10_000);
    });
  });
});
