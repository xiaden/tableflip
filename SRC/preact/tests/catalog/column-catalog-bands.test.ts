import { describe, it, expect } from 'vitest';
import { buildColumnCatalog, projectedCols } from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import type { DetailBandSpec } from '../../types';

/**
 * Tests for detail band column catalog extension (Phase 3).
 *
 * Band columns are added to the colMap with _{bandId}_ prefix after lookup
 * columns. They use PhysicalColEntry shape so resolveRef() works unchanged.
 */
describe('Column Catalog — Detail Band Extension', () => {
  // ── Shared fixtures ──────────────────────────────────────────────────────

  const ordersSource: SourceTableEntry = {
    id: 'Orders',
    name: 'Orders',
    cols: ['OrderId', 'Customer', 'Amount'],
    kind: 'imported',
    source: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Customer', 'Amount'], rowCount: 8 },
  };

  const itemsSource: SourceTableEntry = {
    id: 'Items',
    name: 'Line Items',
    cols: ['ItemId', 'OrderId', 'Product', 'Qty', 'Price'],
    kind: 'imported',
    source: { id: 'Items', name: 'Line Items', cols: ['ItemId', 'OrderId', 'Product', 'Qty', 'Price'], rowCount: 50 },
  };

  const notesSource: SourceTableEntry = {
    id: 'Notes',
    name: 'Notes',
    cols: ['NoteId', 'OrderId', 'Text', 'CreatedBy'],
    kind: 'imported',
    source: { id: 'Notes', name: 'Notes', cols: ['NoteId', 'OrderId', 'Text', 'CreatedBy'], rowCount: 20 },
  };

  const sourceCatalog = new Map<string, SourceTableEntry>([
    ['Orders', ordersSource],
    ['Items', itemsSource],
    ['Notes', notesSource],
  ]);

  function makeBand(overrides: Partial<DetailBandSpec> = {}): DetailBandSpec {
    return {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['Product', 'Qty'],
      enabled: true,
      sorts: [],
      label: 'Line Items',
      ...overrides,
    };
  }

  // ── Prefix generation ──────────────────────────────────────────────────────

  describe('prefix generation', () => {
    it('should add band columns with _{bandId}_ prefix', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('_band_0_Product')).toBe(true);
      expect(cat.colMap.has('_band_0_Qty')).toBe(true);
    });

    it('should map band entries to correct physical source', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      const entry = cat.colMap.get('_band_0_Product')!;
      expect(entry.kind).toBe('band');
      expect((entry as any).tid).toBe('Items');
      expect((entry as any).col).toBe('Product');
    });

    it('should use all child table cols when band.cols is empty', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ cols: [] })],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // All Items cols should be present with prefix
      for (const c of itemsSource.cols) {
        expect(cat.colMap.has(`_band_0_${c}`)).toBe(true);
      }
    });

    it('should use only selected cols when band.cols is non-empty', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ cols: ['Product'] })],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('_band_0_Product')).toBe(true);
      // Qty not selected → should not be in catalog
      expect(cat.colMap.has('_band_0_Qty')).toBe(false);
    });

    it('should preserve base columns unchanged', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // Base columns should still be present without prefix
      expect(cat.colMap.has('OrderId')).toBe(true);
      expect(cat.colMap.has('Customer')).toBe(true);
      expect(cat.colMap.has('Amount')).toBe(true);
    });
  });

  // ── Collision handling ─────────────────────────────────────────────────────

  describe('collision handling', () => {
    it('should not collide with base columns due to unique prefix', () => {
      // Band has a column named 'OrderId' (same as base) — prefix prevents collision
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ cols: ['OrderId', 'Product'] })],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // Base OrderId maps to Orders table
      const baseEntry = cat.colMap.get('OrderId')!;
      expect((baseEntry as any).tid).toBe('Orders');
      // Band OrderId maps to Items table with prefix
      const bandEntry = cat.colMap.get('_band_0_OrderId')!;
      expect((bandEntry as any).tid).toBe('Items');
    });

    it('should not collide between two bands with different ids', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [
          makeBand({ id: 'band_0', cols: ['Product'] }),
          makeBand({ id: 'band_1', rightId: 'Notes', cols: ['Text'] }),
        ],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('_band_0_Product')).toBe(true);
      expect(cat.colMap.has('_band_1_Text')).toBe(true);
      // Different prefixes → no collision
      expect((cat.colMap.get('_band_0_Product') as any).tid).toBe('Items');
      expect((cat.colMap.get('_band_1_Text') as any).tid).toBe('Notes');
    });

    it('should not overwrite existing alias if prefix+col already in colMap', () => {
      // Two bands with same id (unusual but possible) — first one wins
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [
          makeBand({ id: 'dup', cols: ['Product'] }),
          makeBand({ id: 'dup', rightId: 'Notes', cols: ['Product'] }),
        ],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // First band's entry should win (Items, not Notes)
      const entry = cat.colMap.get('_dup_Product')!;
      expect((entry as any).tid).toBe('Items');
    });

    it('should not collide with lookup columns', () => {
      const contactsSource: SourceTableEntry = {
        id: 'Contacts',
        name: 'Contacts',
        cols: ['ContactId', 'Name', 'Company'],
        kind: 'imported',
        source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Company'], rowCount: 5 },
      };
      const catWithContacts = new Map([...sourceCatalog, ['Contacts', contactsSource]]);

      const spec = {
        base: 'Orders',
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Customer', right: 'Company' }],
          cols: [],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
        calcStages: [],
        detailBands: [makeBand({ cols: ['Product'] })],
      };
      const cat = buildColumnCatalog(spec, catWithContacts);
      // Lookup columns present
      expect(cat.colMap.has('ContactId')).toBe(true);
      expect(cat.colMap.has('Name')).toBe(true);
      // Band columns present with band prefix
      expect(cat.colMap.has('_band_0_Product')).toBe(true);
    });
  });

  // ── Disabled / invalid band skipping ───────────────────────────────────────

  describe('disabled and invalid band skipping', () => {
    it('should skip disabled bands', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ enabled: false })],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('_band_0_Product')).toBe(false);
      expect(cat.colMap.has('_band_0_Qty')).toBe(false);
      // Only base columns
      expect(cat.colMap.size).toBe(3);
    });

    it('should skip bands with empty rightId', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ rightId: '' })],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.size).toBe(3); // Only base columns
    });

    it('should skip bands referencing tables not in sourceCatalog', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ rightId: 'NonExistent' })],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.size).toBe(3); // Only base columns
    });

    it('should skip bands with no cols and table not in catalog', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ rightId: 'NonExistent', cols: [] })],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.size).toBe(3);
    });

    it('should include enabled bands and skip disabled ones in same array', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [
          makeBand({ id: 'active', cols: ['Product'] }),
          makeBand({ id: 'disabled', rightId: 'Notes', cols: ['Text'], enabled: false }),
        ],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('_active_Product')).toBe(true);
      expect(cat.colMap.has('_disabled_Text')).toBe(false);
    });
  });

  // ── BandColEntry shape ─────────────────────────────────────────────────────

  describe('BandColEntry shape', () => {
    it('should produce entries with kind: \'band\' (BandColEntry)', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      const entry = cat.colMap.get('_band_0_Product')!;
      expect(entry.kind).toBe('band');
      expect('tid' in entry).toBe(true);
      expect('col' in entry).toBe(true);
    });

    it('should produce entries distinguishable from base column entries by kind', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ cols: ['Product'] })],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      const baseEntry = cat.colMap.get('OrderId')!;
      const bandEntry = cat.colMap.get('_band_0_Product')!;
      // Base entries have kind undefined, band entries have kind 'band'
      expect(baseEntry.kind).toBeUndefined();
      expect(bandEntry.kind).toBe('band');
      // Both still have tid and col
      expect('tid' in baseEntry).toBe(true);
      expect('col' in baseEntry).toBe(true);
      expect('tid' in bandEntry).toBe(true);
      expect('col' in bandEntry).toBe(true);
    });
  });

  // ── Multiple bands ─────────────────────────────────────────────────────────

  describe('multiple bands', () => {
    it('should add columns from multiple bands with distinct prefixes', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [
          makeBand({ id: 'items_band', cols: ['Product', 'Qty'] }),
          makeBand({ id: 'notes_band', rightId: 'Notes', cols: ['Text', 'CreatedBy'] }),
        ],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('_items_band_Product')).toBe(true);
      expect(cat.colMap.has('_items_band_Qty')).toBe(true);
      expect(cat.colMap.has('_notes_band_Text')).toBe(true);
      expect(cat.colMap.has('_notes_band_CreatedBy')).toBe(true);
    });

    it('should handle mix of valid and invalid bands', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [
          makeBand({ id: 'good', cols: ['Product'] }),
          makeBand({ id: 'no_table', rightId: 'Missing', cols: ['X'] }),
          makeBand({ id: 'disabled', rightId: 'Notes', cols: ['Text'], enabled: false }),
          makeBand({ id: 'no_rightid', rightId: '', cols: ['X'] }),
        ],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // Only the 'good' band should contribute columns
      expect(cat.colMap.has('_good_Product')).toBe(true);
      expect(cat.colMap.has('_no_table_X')).toBe(false);
      expect(cat.colMap.has('_disabled_Text')).toBe(false);
      expect(cat.colMap.has('_no_rightid_X')).toBe(false);
    });
  });

  // ── Integration with projectedCols ─────────────────────────────────────────

  describe('projectedCols integration', () => {
    it('should include band columns in projectedCols output', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ cols: ['Product', 'Qty'] })],
      };
      const cols = projectedCols(spec, sourceCatalog);
      expect(cols).toContain('OrderId');
      expect(cols).toContain('Customer');
      expect(cols).toContain('Amount');
      expect(cols).toContain('_band_0_Product');
      expect(cols).toContain('_band_0_Qty');
    });

    it('should not include disabled band columns in projectedCols', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand({ enabled: false })],
      };
      const cols = projectedCols(spec, sourceCatalog);
      expect(cols).toEqual(['OrderId', 'Customer', 'Amount']);
    });
  });

  // ── Backward compatibility ─────────────────────────────────────────────────

  describe('backward compatibility', () => {
    it('should work when detailBands is absent from reportSpec', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        // No detailBands field
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // Only base columns — no error
      expect(cat.colMap.size).toBe(3);
    });

    it('should work when detailBands is empty array', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.size).toBe(3);
    });
  });
});
