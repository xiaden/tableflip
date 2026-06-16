/**
 * Integration tests — end-to-end from engine through grouping to grid rows
 * and export rows. Verifies the full overlay descriptor pipeline:
 *   runReport() → BandResultSet → buildOverlayDescriptors() →
 *   descriptorsToGridRows() / buildExportFromDescriptors()
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runReport } from '../../report/engine';
import { buildOverlayDescriptors } from '../../report/overlay-grouping';
import { descriptorsToGridRows } from '../../ui/grid';
import { buildExportFromDescriptors } from '../../ui/export';
import type { ReportSpec, DbTable, DetailBandSpec } from '../../types';
import { makeReportSpec } from '../query/helpers';

describe('Integration — Band Overlay E2E', () => {
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

  // ── P5-S2: Engine → Grouping → Grid rows ────────────────────────────────

  describe('Engine → Grouping → Grid rows', () => {
    it('should produce correct grid rows from engine bandResult', () => {
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
      const result = runReport(s, tablesWithBands());

      // bandResult must be populated
      expect(result.bandResult).toBeDefined();
      const bandResult = result.bandResult!;
      expect(bandResult.parentRows.length).toBe(8);
      expect(bandResult.bandResults.length).toBe(1);

      // Build descriptors
      const descriptors = buildOverlayDescriptors(bandResult, detailBands);
      expect(descriptors.length).toBeGreaterThan(0);
      expect(descriptors[0].type).toBe('parent');

      // Build bandColSets from bandResults (prefixed column names)
      const bandColSets: Record<string, string[]> = {};
      for (const br of bandResult.bandResults) {
        bandColSets[br.band.id] = br.cols;
      }

      // Build grid rows
      const gridRows = descriptorsToGridRows(descriptors, bandResult.parentCols, bandColSets);

      // Grid row count must match descriptor count
      expect(gridRows.length).toBe(descriptors.length);

      // Count descriptor types
      const parentDescs = descriptors.filter(d => d.type === 'parent');
      const sectionDescs = descriptors.filter(d => d.type === 'band-section');
      const rowDescs = descriptors.filter(d => d.type === 'band-row');

      // 8 parent rows (one per order)
      expect(parentDescs.length).toBe(8);
      // 8 band sections (one per unique OrderId group — each OrderId is unique)
      expect(sectionDescs.length).toBe(8);
      // 9 band rows (total line items)
      expect(rowDescs.length).toBe(9);

      // Verify parent grid rows: parent values populated, band columns empty
      const parentGridRows = gridRows.filter(r => !r._isBandHeader && !r._band_id);
      expect(parentGridRows.length).toBe(8);
      for (const row of parentGridRows) {
        expect(row['OrderId']).toBeTruthy();
        expect(row['Company']).toBeTruthy();
        // Band columns (prefixed) should be empty string
        for (const bc of bandColSets['band_0']) {
          expect(row[bc]).toBe('');
        }
      }

      // Verify band header rows: _isBandHeader marker
      const bandHeaders = gridRows.filter(r => r._isBandHeader === true);
      expect(bandHeaders.length).toBe(8);
      for (const row of bandHeaders) {
        expect(row['_band_id']).toBe('band_0');
        expect(row['_bandLabel']).toBe('Line Items');
        expect(typeof row['_bandTintIndex']).toBe('number');
      }

      // Verify band data rows: band values populated, parent-only columns empty
      // Note: child key columns (e.g. OrderId) are included in band row data
      // by buildBandQuery for matching purposes — they are NOT empty.
      // Only parent-only columns (those not in the child key) should be empty.
      const childKeyCols = new Set(bandResult.bandResults[0].childKeyCols);
      const parentOnlyCols = bandResult.parentCols.filter(pc => !childKeyCols.has(pc));
      const bandDataRows = gridRows.filter(r => typeof r._band_id === 'string' && !r._isBandHeader);
      expect(bandDataRows.length).toBe(9);
      for (const row of bandDataRows) {
        expect(row['_band_id']).toBe('band_0');
        // Parent-only columns (not child keys) should be empty string
        for (const pc of parentOnlyCols) {
          expect(row[pc]).toBe('');
        }
        // Band data should have at least one non-empty band column
        const hasBandData = bandColSets['band_0'].some(bc => row[bc] !== '' && row[bc] != null);
        expect(hasBandData).toBe(true);
      }
    });
  });

  // ── P5-S3: Engine → Grouping → Export rows ──────────────────────────────

  describe('Engine → Grouping → Export rows', () => {
    it('should produce correct export rows from engine bandResult', () => {
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
      const result = runReport(s, tablesWithBands());
      const bandResult = result.bandResult!;

      const descriptors = buildOverlayDescriptors(bandResult, detailBands);

      // Build hdrMap: alias → display label
      const hdrMap: Record<string, string> = {
        'OrderId': 'Order ID',
        'Company': 'Company',
        '_band_0_Product': 'Product',
        '_band_0_Qty': 'Qty',
      };

      const exportResult = buildExportFromDescriptors(
        descriptors,
        bandResult.parentCols,
        hdrMap,
      );

      // Verify headers contain resolved parent labels
      expect(exportResult.headers).toContain('Order ID');
      expect(exportResult.headers).toContain('Company');

      // Verify row kind counts
      // 8 parent rows → kind 5
      expect(exportResult.rowKinds.filter(k => k === 5).length).toBe(8);
      // 8 section headers → kind 4
      expect(exportResult.rowKinds.filter(k => k === 4).length).toBe(8);
      // 9 band data rows → kind 0
      expect(exportResult.rowKinds.filter(k => k === 0).length).toBe(9);

      // Total rows = 8 + 8 + 9 = 25
      expect(exportResult.cleanRows.length).toBe(25);
      expect(exportResult.rowKinds.length).toBe(25);

      // Verify section header structure: match value in first header position
      for (let i = 0; i < exportResult.cleanRows.length; i++) {
        if (exportResult.rowKinds[i] === 4) {
          const row = exportResult.cleanRows[i];
          const firstHeader = exportResult.headers[0];
          // Match value should be a non-empty OrderId
          expect(row[firstHeader]).toBeTruthy();
          expect(String(row[firstHeader])).toMatch(/^ORD-/);
        }
      }

      // Verify band data rows: empty first header position
      for (let i = 0; i < exportResult.cleanRows.length; i++) {
        if (exportResult.rowKinds[i] === 0) {
          const row = exportResult.cleanRows[i];
          const firstHeader = exportResult.headers[0];
          expect(row[firstHeader]).toBe('');
        }
      }

      // Verify parent rows: all parent columns populated
      for (let i = 0; i < exportResult.cleanRows.length; i++) {
        if (exportResult.rowKinds[i] === 5) {
          const row = exportResult.cleanRows[i];
          expect(row['Order ID']).toBeTruthy();
          expect(row['Company']).toBeTruthy();
        }
      }
    });
  });

  // ── P5-S4: Multi-band end-to-end ────────────────────────────────────────

  describe('Multi-band end-to-end', () => {
    it('should interleave descriptors for multiple bands at group boundaries', () => {
      const detailBands = [
        band({ id: 'band_0' }),
        band({
          id: 'band_1',
          rightId: 'OrderNotes',
          keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
          cols: ['NoteText'],
          label: 'Notes',
        }),
      ];
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
      const result = runReport(s, tablesWithBands());
      const bandResult = result.bandResult!;

      expect(bandResult.bandResults.length).toBe(2);
      expect(bandResult.bandLabels).toEqual({ band_0: 'Line Items', band_1: 'Notes' });

      const descriptors = buildOverlayDescriptors(bandResult, detailBands);

      // Verify interleaved descriptor sequence at each group boundary.
      // At a group boundary where both bands have children, the pattern is:
      //   band-section(band_0), band-row*(band_0), band-section(band_1), band-row*(band_1)
      // Find the first group where both bands have data (ORD-001):
      let foundBand0Section = false;
      for (let i = 0; i < descriptors.length; i++) {
        const d = descriptors[i];
        if (d.type === 'band-section' && d.bandId === 'band_0' && !foundBand0Section) {
          foundBand0Section = true;

          // After band_0 section, expect band_0 rows
          let j = i + 1;
          while (j < descriptors.length && descriptors[j].type === 'band-row' && (descriptors[j] as any).bandId === 'band_0') {
            j++;
          }
          // Should have at least one band_0 row (ORD-001 has 2 line items)
          expect(j).toBeGreaterThan(i + 1);

          // Next should be band_1 section
          expect(descriptors[j].type).toBe('band-section');
          expect((descriptors[j] as any).bandId).toBe('band_1');

          // After band_1 section, expect band_1 rows
          let k = j + 1;
          while (k < descriptors.length && descriptors[k].type === 'band-row' && (descriptors[k] as any).bandId === 'band_1') {
            k++;
          }
          // ORD-001 has 2 notes
          expect(k).toBeGreaterThan(j + 1);
          break;
        }
      }
      expect(foundBand0Section).toBe(true);

      // Verify grid rows for multi-band
      const bandColSets: Record<string, string[]> = {};
      for (const br of bandResult.bandResults) {
        bandColSets[br.band.id] = br.cols;
      }
      const gridRows = descriptorsToGridRows(descriptors, bandResult.parentCols, bandColSets);
      expect(gridRows.length).toBe(descriptors.length);

      // Should have band headers for both bands
      const bandHeaders = gridRows.filter(r => r._isBandHeader === true);
      const band0Headers = bandHeaders.filter(r => r._band_id === 'band_0');
      const band1Headers = bandHeaders.filter(r => r._band_id === 'band_1');
      expect(band0Headers.length).toBeGreaterThan(0);
      expect(band1Headers.length).toBeGreaterThan(0);

      // Verify export rows for multi-band
      const hdrMap: Record<string, string> = {
        'OrderId': 'Order ID',
        'Company': 'Company',
        '_band_0_Product': 'Product',
        '_band_0_Qty': 'Qty',
        '_band_1_NoteText': 'Note Text',
      };
      const exportResult = buildExportFromDescriptors(descriptors, bandResult.parentCols, hdrMap);
      expect(exportResult.cleanRows.length).toBe(descriptors.length);

      // bandIds should track both bands
      const uniqueBandIds = new Set(exportResult.bandIds.filter(b => b !== ''));
      expect(uniqueBandIds.has('band_0')).toBe(true);
      expect(uniqueBandIds.has('band_1')).toBe(true);
    });
  });

  // ── P5-S5: Group boundary correctness ───────────────────────────────────

  describe('Group boundary correctness', () => {
    beforeAll(() => {
      const db = (globalThis as any).sqlDb;

      db.run(`CREATE TABLE IF NOT EXISTS "GroupParents" (
        "ParentId" TEXT, "GroupKey" TEXT, "Value" TEXT
      )`);
      db.run(`DELETE FROM "GroupParents"`);

      const parents = [
        ['P1', 'GroupA', 'val1'],
        ['P2', 'GroupA', 'val2'],
        ['P3', 'GroupB', 'val3'],
      ];
      const stmt = db.prepare(
        `INSERT INTO "GroupParents" ("ParentId","GroupKey","Value") VALUES (?,?,?)`
      );
      for (const row of parents) {
        stmt.run(row);
      }
      stmt.free();

      db.run(`CREATE TABLE IF NOT EXISTS "GroupChildren" (
        "ChildId" TEXT, "GroupKey" TEXT, "ChildVal" TEXT
      )`);
      db.run(`DELETE FROM "GroupChildren"`);

      const children = [
        ['C1', 'GroupA', 'child1'],
        ['C2', 'GroupA', 'child2'],
        ['C3', 'GroupB', 'child3'],
      ];
      const cstmt = db.prepare(
        `INSERT INTO "GroupChildren" ("ChildId","GroupKey","ChildVal") VALUES (?,?,?)`
      );
      for (const row of children) {
        cstmt.run(row);
      }
      cstmt.free();
    });

    it('should group parents with same match key into one band section', () => {
      const detailBands: DetailBandSpec[] = [{
        id: 'band_0',
        rightId: 'GroupChildren',
        keyPairs: [{ left: 'GroupKey', right: 'GroupKey' }],
        cols: ['ChildVal'],
        enabled: true,
        sorts: [],
        label: 'Children',
      }];

      const tables: Record<string, DbTable> = {
        GroupParents: {
          id: 'GroupParents', name: 'Group Parents',
          cols: ['ParentId', 'GroupKey', 'Value'],
          rowCount: 3,
        },
        GroupChildren: {
          id: 'GroupChildren', name: 'Group Children',
          cols: ['ChildId', 'GroupKey', 'ChildVal'],
          rowCount: 3,
        },
      };

      const s = spec({
        pipeline: {
          base: 'GroupParents',
          baseCols: ['ParentId', 'GroupKey', 'Value'],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands,
        },
        outputColumns: ['ParentId', 'GroupKey', 'Value'],
      });

      const result = runReport(s, tables);
      expect(result.bandResult).toBeDefined();
      const bandResult = result.bandResult!;

      const descriptors = buildOverlayDescriptors(bandResult, detailBands);

      // Expected sequence:
      //   parent(P1), parent(P2),                   ← same group (GroupA)
      //   band-section(GroupA), band-row(C1), band-row(C2),  ← flushed at boundary
      //   parent(P3),                               ← new group (GroupB)
      //   band-section(GroupB), band-row(C3)         ← flushed at end
      expect(descriptors.length).toBe(8);

      // First two: parent descriptors for GroupA
      expect(descriptors[0].type).toBe('parent');
      expect(descriptors[1].type).toBe('parent');
      expect((descriptors[0] as any).data['ParentId']).toBe('P1');
      expect((descriptors[1] as any).data['ParentId']).toBe('P2');

      // Band section for GroupA (flushed when P3 triggers boundary)
      expect(descriptors[2].type).toBe('band-section');
      expect((descriptors[2] as any).matchValue).toBe('GroupA');
      expect((descriptors[2] as any).bandId).toBe('band_0');

      // Two band rows for GroupA
      expect(descriptors[3].type).toBe('band-row');
      expect(descriptors[4].type).toBe('band-row');

      // Parent for GroupB
      expect(descriptors[5].type).toBe('parent');
      expect((descriptors[5] as any).data['ParentId']).toBe('P3');

      // Band section for GroupB (flushed at end of data)
      expect(descriptors[6].type).toBe('band-section');
      expect((descriptors[6] as any).matchValue).toBe('GroupB');

      // One band row for GroupB
      expect(descriptors[7].type).toBe('band-row');

      // Verify grid rows: parents with same match key share one section
      const bandColSets: Record<string, string[]> = {};
      for (const br of bandResult.bandResults) {
        bandColSets[br.band.id] = br.cols;
      }
      const gridRows = descriptorsToGridRows(descriptors, bandResult.parentCols, bandColSets);

      // Should have exactly 2 band headers (one per group, not one per parent)
      const bandHeaders = gridRows.filter(r => r._isBandHeader === true);
      expect(bandHeaders.length).toBe(2);

      // P1 and P2 should appear before the first band header
      const firstHeaderIdx = gridRows.findIndex(r => r._isBandHeader === true);
      expect(gridRows[0]['ParentId']).toBe('P1');
      expect(gridRows[1]['ParentId']).toBe('P2');
      expect(firstHeaderIdx).toBe(2);
    });
  });
});
