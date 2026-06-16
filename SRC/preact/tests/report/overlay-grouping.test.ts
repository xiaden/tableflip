/**
 * Unit tests for report/overlay-grouping.ts — buildOverlayDescriptors() and GroupBoundaryDetector.
 *
 * Covers group boundary detection (match key transitions), descriptor emission
 * (parent / band-section / band-row), multi-band ordering, match key resolution,
 * edge cases (empty bands, disabled bands, no matching children), and
 * property-based descriptor structure invariants.
 */
import { describe, it, expect } from 'vitest';
import { buildOverlayDescriptors } from '../../report/overlay-grouping';
import type {
  BandResultSet,
  DetailBandSpec,
  OverlayDescriptor,
} from '../../types';

describe('overlay-grouping', () => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  function makeBand(overrides: Partial<DetailBandSpec> = {}): DetailBandSpec {
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

  function makeBandResultSet(
    parentRows: Record<string, unknown>[],
    parentCols: string[],
    bandResults: BandResultSet['bandResults'] = [],
    bandLabels: Record<string, string> = {},
  ): BandResultSet {
    return { parentRows, parentCols, bandResults, bandLabels };
  }

  /** Shorthand: extract descriptor types from result */
  function types(descs: OverlayDescriptor[]): string[] {
    return descs.map(d =>
      d.type === 'band-section' ? `band-section(${d.bandId})` :
      d.type === 'band-row'     ? `band-row(${d.bandId})` :
      'parent',
    );
  }

  // ── GroupBoundaryDetector state machine (tested via buildOverlayDescriptors) ─

  describe('GroupBoundaryDetector state machine', () => {
    it('first row always starts a new group', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Name: 'A' }],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [{ OrderId: 'ORD-001', Product: 'Widget', Qty: 1 }],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      // First row → parent, then flush final group → band-section + band-row
      expect(types(result)).toEqual(['parent', 'band-section(band_0)', 'band-row(band_0)']);
    });

    it('same key value does not start a new group', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-001', Name: 'B' },
        ],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [
            { OrderId: 'ORD-001', Product: 'Widget', Qty: 1 },
            { OrderId: 'ORD-001', Product: 'Gadget', Qty: 2 },
          ],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      // Both parents emitted, then ONE group flush at end
      expect(types(result)).toEqual([
        'parent', 'parent',
        'band-section(band_0)', 'band-row(band_0)', 'band-row(band_0)',
      ]);
    });

    it('different key value starts a new group', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-002', Name: 'B' },
        ],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [
            { OrderId: 'ORD-001', Product: 'Widget', Qty: 1 },
            { OrderId: 'ORD-002', Product: 'Gizmo', Qty: 3 },
          ],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      // parent(ORD-001), then boundary at ORD-002 → flush group 1, parent(ORD-002), flush group 2
      expect(types(result)).toEqual([
        'parent',
        'band-section(band_0)', 'band-row(band_0)',
        'parent',
        'band-section(band_0)', 'band-row(band_0)',
      ]);
    });
  });

  // ── buildOverlayDescriptors() edge cases ─────────────────────────────────

  describe('buildOverlayDescriptors() edge cases', () => {
    it('empty parent rows returns empty array', () => {
      const brs = makeBandResultSet([], ['OrderId']);
      const result = buildOverlayDescriptors(brs, []);
      expect(result).toEqual([]);
    });

    it('empty bands array returns ParentDescriptor array only', () => {
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-002', Name: 'B' },
        ],
        ['OrderId', 'Name'],
      );

      const result = buildOverlayDescriptors(brs, []);
      expect(result).toHaveLength(2);
      expect(result.every(d => d.type === 'parent')).toBe(true);
      expect(result[0]).toEqual({
        type: 'parent',
        data: { OrderId: 'ORD-001', Name: 'A' },
        columns: ['OrderId', 'Name'],
      });
    });

    it('single group: all same key → parents then one section with all children', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-001', Name: 'B' },
          { OrderId: 'ORD-001', Name: 'C' },
        ],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [
            { OrderId: 'ORD-001', Product: 'Widget', Qty: 1 },
            { OrderId: 'ORD-001', Product: 'Gadget', Qty: 2 },
            { OrderId: 'ORD-001', Product: 'Gizmo', Qty: 3 },
          ],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      // 3 parents, then 1 section + 3 band rows
      expect(types(result)).toEqual([
        'parent', 'parent', 'parent',
        'band-section(band_0)', 'band-row(band_0)', 'band-row(band_0)', 'band-row(band_0)',
      ]);

      // Verify section header properties
      const section = result.find(d => d.type === 'band-section')!;
      expect(section.type === 'band-section' && section.matchValue).toBe('ORD-001');
      expect(section.type === 'band-section' && section.bandLabel).toBe('Line Items');
      expect(section.type === 'band-section' && section.bandColumns).toEqual(['Product', 'Qty']);
    });

    it('unique key per row → alternating parent/section pattern', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-002', Name: 'B' },
          { OrderId: 'ORD-003', Name: 'C' },
        ],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [
            { OrderId: 'ORD-001', Product: 'Widget', Qty: 1 },
            { OrderId: 'ORD-002', Product: 'Gadget', Qty: 2 },
            { OrderId: 'ORD-003', Product: 'Gizmo', Qty: 3 },
          ],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      // Each row is its own group: parent → flush(section + row) for each
      expect(types(result)).toEqual([
        'parent',
        'band-section(band_0)', 'band-row(band_0)',
        'parent',
        'band-section(band_0)', 'band-row(band_0)',
        'parent',
        'band-section(band_0)', 'band-row(band_0)',
      ]);
    });

    it('multi-band with 2+ bands → each band gets its own section descriptors', () => {
      const band0 = makeBand({ id: 'band_0', label: 'Line Items' });
      const band1 = makeBand({
        id: 'band_1',
        rightId: 'OrderNotes',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['NoteText'],
        label: 'Order Notes',
      });

      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-002', Name: 'B' },
        ],
        ['OrderId', 'Name'],
        [
          {
            band: band0,
            rows: [{ OrderId: 'ORD-001', Product: 'Widget', Qty: 1 }],
            cols: ['Product', 'Qty'],
            parentKeyAliases: ['OrderId'],
            childKeyCols: ['OrderId'],
          },
          {
            band: band1,
            rows: [{ OrderId: 'ORD-001', NoteText: 'Rush order' }],
            cols: ['NoteText'],
            parentKeyAliases: ['OrderId'],
            childKeyCols: ['OrderId'],
          },
        ],
        { band_0: 'Line Items', band_1: 'Order Notes' },
      );

      const result = buildOverlayDescriptors(brs, [band0, band1]);
      // Group 1 (ORD-001): parent, then section(band_0)+row, section(band_1)+row
      // Group 2 (ORD-002): parent, then section(band_0) (no children), section(band_1) (no children)
      expect(types(result)).toEqual([
        'parent',
        'band-section(band_0)', 'band-row(band_0)',
        'band-section(band_1)', 'band-row(band_1)',
        'parent',
        'band-section(band_0)',
        'band-section(band_1)',
      ]);

      // Verify band labels
      const sections = result.filter(d => d.type === 'band-section');
      expect(sections[0].type === 'band-section' && sections[0].bandLabel).toBe('Line Items');
      expect(sections[1].type === 'band-section' && sections[1].bandLabel).toBe('Order Notes');
    });

    it('band with no matching children → section header but no row descriptors', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-999', Name: 'NoItems' }],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [],  // No child rows match ORD-999
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      expect(types(result)).toEqual([
        'parent',
        'band-section(band_0)',
        // No band-row entries
      ]);

      const section = result.find(d => d.type === 'band-section')!;
      expect(section.type === 'band-section' && section.matchValue).toBe('ORD-999');
    });

    it('disabled band is excluded from output', () => {
      const enabledBand = makeBand({ id: 'band_0', label: 'Items' });
      const disabledBand = makeBand({
        id: 'band_1',
        rightId: 'OrderNotes',
        enabled: false,
        label: 'Notes',
      });

      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Name: 'A' }],
        ['OrderId', 'Name'],
        [{
          band: enabledBand,
          rows: [{ OrderId: 'ORD-001', Product: 'Widget', Qty: 1 }],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        // band_1 has no bandResult (it's disabled, engine wouldn't query it)
        { band_0: 'Items' },
      );

      const result = buildOverlayDescriptors(brs, [enabledBand, disabledBand]);
      // Only band_0 should appear in output
      const bandIds = result
        .filter(d => d.type === 'band-section' || d.type === 'band-row')
        .map(d => (d as { bandId: string }).bandId);
      expect(bandIds.every(id => id === 'band_0')).toBe(true);
      expect(bandIds).not.toContain('band_1');
    });

    it('band enabled but no results in bandResult.bandResults is excluded', () => {
      const band0 = makeBand({ id: 'band_0', label: 'Items' });
      const band1 = makeBand({
        id: 'band_1',
        rightId: 'OrderNotes',
        label: 'Notes',
      });

      // bandResult only has results for band_0, not band_1
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Name: 'A' }],
        ['OrderId', 'Name'],
        [{
          band: band0,
          rows: [{ OrderId: 'ORD-001', Product: 'Widget', Qty: 1 }],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Items' },
      );

      // Both bands are enabled, but band_1 has no bandResult entry
      const result = buildOverlayDescriptors(brs, [band0, band1]);
      const bandIds = result
        .filter(d => d.type === 'band-section' || d.type === 'band-row')
        .map(d => (d as { bandId: string }).bandId);
      expect(bandIds.every(id => id === 'band_0')).toBe(true);
      expect(bandIds).not.toContain('band_1');
    });

    it('parent descriptor carries correct columns from parentCols', () => {
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Name: 'A', Region: 'East' }],
        ['OrderId', 'Name', 'Region'],
      );

      const result = buildOverlayDescriptors(brs, []);
      expect(result[0].type === 'parent' && result[0].columns).toEqual(['OrderId', 'Name', 'Region']);
    });

    it('band section uses band label from bandLabels, falls back to band id', () => {
      const band = makeBand({ id: 'band_0', label: 'My Label' });
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Name: 'A' }],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        {}, // No bandLabels entry
      );

      const result = buildOverlayDescriptors(brs, [band]);
      const section = result.find(d => d.type === 'band-section')!;
      // Falls back to band.id when bandLabels has no entry
      expect(section.type === 'band-section' && section.bandLabel).toBe('band_0');
    });

    it('multi-group with multiple parents per group', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-001', Name: 'B' },
          { OrderId: 'ORD-002', Name: 'C' },
          { OrderId: 'ORD-002', Name: 'D' },
          { OrderId: 'ORD-003', Name: 'E' },
        ],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [
            { OrderId: 'ORD-001', Product: 'W1', Qty: 1 },
            { OrderId: 'ORD-001', Product: 'W2', Qty: 2 },
            { OrderId: 'ORD-002', Product: 'G1', Qty: 3 },
            { OrderId: 'ORD-003', Product: 'Z1', Qty: 4 },
          ],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      expect(types(result)).toEqual([
        // Group 1: ORD-001 (2 parents)
        'parent', 'parent',
        // Flush group 1
        'band-section(band_0)', 'band-row(band_0)', 'band-row(band_0)',
        // Group 2: ORD-002 (2 parents)
        'parent', 'parent',
        // Flush group 2
        'band-section(band_0)', 'band-row(band_0)',
        // Group 3: ORD-003 (1 parent)
        'parent',
        // Flush final group
        'band-section(band_0)', 'band-row(band_0)',
      ]);
    });
  });

  // ── P1-S3: first descriptor is always 'parent' with band that has no matching children ─

  describe('buildOverlayDescriptors — basic structure', () => {
    it('with parent rows + band with no matching children, first descriptor is always parent', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-002', Name: 'B' },
        ],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [],  // No children match any parent
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      expect(result.length).toBeGreaterThan(0);
      // The key invariant: the VERY FIRST descriptor is always 'parent'
      expect(result[0].type).toBe('parent');
      // Both parent rows are present
      const parentDescriptors = result.filter(d => d.type === 'parent');
      expect(parentDescriptors.length).toBe(2);
    });
  });

  // ── P1-S4: GroupBoundaryDetector — composite match keys ─────────────────

  describe('GroupBoundaryDetector — composite match keys', () => {
    it('parent row with different composite key value starts new group even when individual components differ', () => {
      // Use two key columns: OrderId + Region
      const band = makeBand({
        keyPairs: [
          { left: 'OrderId', right: 'OrderId' },
          { left: 'Region', right: 'Region' },
        ],
      });

      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Region: 'East', Name: 'A' },
          { OrderId: 'ORD-001', Region: 'East', Name: 'B' },  // Same composite key → same group
          { OrderId: 'ORD-001', Region: 'West', Name: 'C' },  // Different composite key → new group
          { OrderId: 'ORD-002', Region: 'East', Name: 'D' },  // Different composite key → new group
        ],
        ['OrderId', 'Region', 'Name'],
        [{
          band,
          rows: [
            { OrderId: 'ORD-001', Region: 'East', Product: 'W1', Qty: 1 },
            { OrderId: 'ORD-001', Region: 'West', Product: 'W2', Qty: 2 },
            { OrderId: 'ORD-002', Region: 'East', Product: 'W3', Qty: 3 },
          ],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId', 'Region'],
          childKeyCols: ['OrderId', 'Region'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      // Group 1: ORD-001|||East (2 parents), flush → section + 1 child
      // Group 2: ORD-001|||West (1 parent), flush → section + 1 child
      // Group 3: ORD-002|||East (1 parent), flush → section + 1 child
      expect(types(result)).toEqual([
        'parent', 'parent',  // Group 1: 2 parents
        'band-section(band_0)', 'band-row(band_0)',  // Flush group 1
        'parent',             // Group 2: 1 parent
        'band-section(band_0)', 'band-row(band_0)',  // Flush group 2
        'parent',             // Group 3: 1 parent
        'band-section(band_0)', 'band-row(band_0)',  // Flush group 3
      ]);

      // Verify composite match values
      const sections = result.filter(d => d.type === 'band-section');
      expect(sections[0].type === 'band-section' && sections[0].matchValue).toBe('ORD-001|||East');
      expect(sections[1].type === 'band-section' && sections[1].matchValue).toBe('ORD-001|||West');
      expect(sections[2].type === 'band-section' && sections[2].matchValue).toBe('ORD-002|||East');
    });
  });

  // ── P1-S5: band-section and band-row field verification ─────────────────

  describe('buildOverlayDescriptors — single band field verification', () => {
    it('band-section contains correct bandId, bandLabel, bandColumns, matchValue, depth: 0', () => {
      const band = makeBand({ id: 'band_0', label: 'Line Items', cols: ['Product', 'Qty'] });
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Name: 'A' }],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [{ OrderId: 'ORD-001', Product: 'Widget', Qty: 5 }],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      const section = result.find(d => d.type === 'band-section')!;
      expect(section).toBeDefined();
      expect(section.type).toBe('band-section');
      if (section.type === 'band-section') {
        expect(section.bandId).toBe('band_0');
        expect(section.bandLabel).toBe('Line Items');
        expect(section.bandColumns).toEqual(['Product', 'Qty']);
        expect(section.matchValue).toBe('ORD-001');
        expect(section.depth).toBe(0);
      }
    });

    it('band-row contains correct bandId, data, columns, depth: 0', () => {
      const band = makeBand({ id: 'band_0', cols: ['Product', 'Qty'] });
      const childRow = { OrderId: 'ORD-001', Product: 'Widget', Qty: 5 };
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Name: 'A' }],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [childRow],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      const bandRow = result.find(d => d.type === 'band-row')!;
      expect(bandRow).toBeDefined();
      expect(bandRow.type).toBe('band-row');
      if (bandRow.type === 'band-row') {
        expect(bandRow.bandId).toBe('band_0');
        expect(bandRow.data).toEqual(childRow);
        expect(bandRow.columns).toEqual(['Product', 'Qty']);
        expect(bandRow.depth).toBe(0);
      }
    });

  });

  // ── P1-S8: match key resolution ─────────────────────────────────────────

  describe('buildOverlayDescriptors — match key resolution', () => {
    it('match column NOT in parentCols still populates matchValue', () => {
      // parentCols only has 'Name' and 'Region', but the match key uses 'OrderId'
      // which exists in the parent row data but not in parentCols
      const band = makeBand();
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A', Region: 'East' },
        ],
        ['Name', 'Region'],  // OrderId NOT in parentCols
        [{
          band,
          rows: [{ OrderId: 'ORD-001', Product: 'Widget', Qty: 1 }],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      const section = result.find(d => d.type === 'band-section')!;
      expect(section).toBeDefined();
      // matchValue should still be populated from the row data even though OrderId is not in parentCols
      expect(section.type === 'band-section' && section.matchValue).toBe('ORD-001');

      // Parent descriptor should only list parentCols
      const parentDesc = result.find(d => d.type === 'parent')!;
      expect(parentDesc.type === 'parent' && parentDesc.columns).toEqual(['Name', 'Region']);
    });

    it('composite keys (multiple keyPairs) produce concatenated matchValue', () => {
      const band = makeBand({
        keyPairs: [
          { left: 'OrderId', right: 'OrderId' },
          { left: 'Region', right: 'Region' },
        ],
      });
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Region: 'East', Name: 'A' }],
        ['OrderId', 'Region', 'Name'],
        [{
          band,
          rows: [{ OrderId: 'ORD-001', Region: 'East', Product: 'Widget', Qty: 1 }],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId', 'Region'],
          childKeyCols: ['OrderId', 'Region'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      const section = result.find(d => d.type === 'band-section')!;
      expect(section).toBeDefined();
      // Composite key should be concatenated with ||| separator
      expect(section.type === 'band-section' && section.matchValue).toBe('ORD-001|||East');
    });
  });

  // ── P1-S9: edge cases ───────────────────────────────────────────────────

  describe('buildOverlayDescriptors — additional edge cases', () => {
    it('band with empty rows array emits section but no band-rows', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [
          { OrderId: 'ORD-001', Name: 'A' },
          { OrderId: 'ORD-002', Name: 'B' },
        ],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [],  // bandResults entry exists but rows array is empty
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      // Should have 2 parents + 2 band-sections (one per group) but 0 band-rows
      const parents = result.filter(d => d.type === 'parent');
      const sections = result.filter(d => d.type === 'band-section');
      const bandRows = result.filter(d => d.type === 'band-row');

      expect(parents.length).toBe(2);
      expect(sections.length).toBe(2);  // One section per group boundary
      expect(bandRows.length).toBe(0);  // No child rows to emit
    });

    it('single-row parent dataset produces one parent + one group', () => {
      const band = makeBand();
      const brs = makeBandResultSet(
        [{ OrderId: 'ORD-001', Name: 'Only' }],
        ['OrderId', 'Name'],
        [{
          band,
          rows: [
            { OrderId: 'ORD-001', Product: 'Widget', Qty: 1 },
            { OrderId: 'ORD-001', Product: 'Gadget', Qty: 2 },
          ],
          cols: ['Product', 'Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        { band_0: 'Line Items' },
      );

      const result = buildOverlayDescriptors(brs, [band]);
      expect(types(result)).toEqual([
        'parent',
        'band-section(band_0)', 'band-row(band_0)', 'band-row(band_0)',
      ]);

      // Verify single parent descriptor
      const parents = result.filter(d => d.type === 'parent');
      expect(parents.length).toBe(1);
      expect(parents[0].type === 'parent' && parents[0].data).toEqual({ OrderId: 'ORD-001', Name: 'Only' });
    });
  });

  // ── P1-S10: Property-based descriptor structure invariant ────────────────

  describe('Property: descriptor structure invariant', () => {
    /** Helper to build a randomized BandResultSet fixture */
    function makeRandomFixture(seed: number): {
      brs: BandResultSet;
      bands: DetailBandSpec[];
      parentCount: number;
      bandCount: number;
    } {
      // Simple deterministic pseudo-random from seed
      const rng = (n: number): number => ((seed * 9301 + 49297 + n * 233) % 233280) / 233280;

      const parentCount = Math.max(1, Math.floor(rng(1) * 100) + 1);  // 1–100
      const bandCount = Math.max(1, Math.floor(rng(2) * 5) + 1);      // 1–5

      // Generate parent rows with varying match keys
      const parentRows: Record<string, unknown>[] = [];
      const uniqueKeys = Math.max(1, Math.floor(rng(3) * Math.min(parentCount, 20)) + 1);
      for (let i = 0; i < parentCount; i++) {
        const keyIdx = Math.floor(rng(10 + i) * uniqueKeys);
        parentRows.push({
          OrderId: `ORD-${String(keyIdx).padStart(3, '0')}`,
          Name: `Parent-${i}`,
        });
      }

      // Generate bands and their results
      const bands: DetailBandSpec[] = [];
      const bandResults: BandResultSet['bandResults'] = [];
      const bandLabels: Record<string, string> = {};

      for (let b = 0; b < bandCount; b++) {
        const bandId = `band_${b}`;
        const band: DetailBandSpec = {
          id: bandId,
          rightId: `Table_${b}`,
          keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
          cols: [`Col_${b}_A`, `Col_${b}_B`],
          enabled: rng(20 + b) > 0.2,  // 80% chance enabled
          sorts: [],
          label: `Band ${b}`,
        };
        bands.push(band);
        bandLabels[bandId] = `Band ${b}`;

        if (band.enabled) {
          // Generate 0–5 children per unique key
          const rows: Record<string, unknown>[] = [];
          for (let k = 0; k < uniqueKeys; k++) {
            const childCount = Math.floor(rng(100 + b * 10 + k) * 6);  // 0–5
            for (let c = 0; c < childCount; c++) {
              rows.push({
                OrderId: `ORD-${String(k).padStart(3, '0')}`,
                [`Col_${b}_A`]: `val_${b}_${k}_${c}_a`,
                [`Col_${b}_B`]: `val_${b}_${k}_${c}_b`,
              });
            }
          }
          bandResults.push({
            band,
            rows,
            cols: [`Col_${b}_A`, `Col_${b}_B`],
            parentKeyAliases: ['OrderId'],
            childKeyCols: ['OrderId'],
          });
        }
      }

      const brs = makeBandResultSet(parentRows, ['OrderId', 'Name'], bandResults, bandLabels);
      return { brs, bands, parentCount, bandCount };
    }

    const VALID_TYPES = new Set(['parent', 'band-section', 'band-row']);

    for (let seed = 1; seed <= 20; seed++) {
      it(`randomized fixture seed=${seed}: every descriptor is one of three valid types`, () => {
        const { brs, bands } = makeRandomFixture(seed);
        const result = buildOverlayDescriptors(brs, bands);

        for (const desc of result) {
          expect(VALID_TYPES.has(desc.type)).toBe(true);
        }
      });

      it(`randomized fixture seed=${seed}: first descriptor is always 'parent' when parentRows non-empty`, () => {
        const { brs, bands } = makeRandomFixture(seed);
        if (brs.parentRows.length === 0) return;  // Skip empty case

        const result = buildOverlayDescriptors(brs, bands);
        if (result.length === 0) return;  // Shouldn't happen with non-empty parents

        expect(result[0].type).toBe('parent');
      });

      it(`randomized fixture seed=${seed}: every band-section is preceded by at least one parent`, () => {
        const { brs, bands } = makeRandomFixture(seed);
        const result = buildOverlayDescriptors(brs, bands);

        let seenParent = false;
        for (const desc of result) {
          if (desc.type === 'parent') seenParent = true;
          if (desc.type === 'band-section') {
            expect(seenParent).toBe(true);
          }
        }
      });

      it(`randomized fixture seed=${seed}: every band-row is preceded by a band-section for same bandId`, () => {
        const { brs, bands } = makeRandomFixture(seed);
        const result = buildOverlayDescriptors(brs, bands);

        const activeSections = new Set<string>();
        for (const desc of result) {
          if (desc.type === 'band-section') {
            activeSections.add(desc.bandId);
          }
          if (desc.type === 'band-row') {
            expect(activeSections.has(desc.bandId)).toBe(true);
          }
        }
      });
    }
  });
});
