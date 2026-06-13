/**
 * Tests for BandColEntry kind tagging (Phase 2).
 *
 * Verifies that band entries in the colMap are tagged with kind: 'band',
 * making them distinguishable from physical (lookup/base) entries and
 * calc entries. Also verifies resolveRef() handles band entries correctly.
 */
import { describe, it, expect } from 'vitest';
import { buildColumnCatalog } from '../../catalog/column-catalog';
import type { BandColEntry, ColMapEntry, PhysicalColEntry } from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import type { DetailBandSpec } from '../../types';
import { resolveRef } from '../../query/resolve-ref';

describe('BandColEntry kind tagging', () => {
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

  const contactsSource: SourceTableEntry = {
    id: 'Contacts',
    name: 'Contacts',
    cols: ['ContactId', 'Name', 'Email'],
    kind: 'imported',
    source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email'], rowCount: 5 },
  };

  const sourceCatalog = new Map<string, SourceTableEntry>([
    ['Orders', ordersSource],
    ['Items', itemsSource],
    ['Contacts', contactsSource],
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

  // ── kind: 'band' tagging ─────────────────────────────────────────────────

  describe('kind tagging', () => {
    it('should tag band entries with kind: \'band\'', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const { colMap } = buildColumnCatalog(spec, sourceCatalog);
      const entry = colMap.get('_band_0_Product');
      expect(entry).toBeDefined();
      expect(entry!.kind).toBe('band');
    });

    it('should tag all band column entries with kind: \'band\'', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const { colMap } = buildColumnCatalog(spec, sourceCatalog);
      const product = colMap.get('_band_0_Product')!;
      const qty = colMap.get('_band_0_Qty')!;
      expect(product.kind).toBe('band');
      expect(qty.kind).toBe('band');
    });

    it('should have correct tid and col on band entries', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const { colMap } = buildColumnCatalog(spec, sourceCatalog);
      const entry = colMap.get('_band_0_Product') as BandColEntry;
      expect(entry.kind).toBe('band');
      expect(entry.tid).toBe('Items');
      expect(entry.col).toBe('Product');
    });
  });

  // ── Distinguishable from lookup/base entries ─────────────────────────────

  describe('distinguishable from physical entries', () => {
    it('should differ from base entries by kind field', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const { colMap } = buildColumnCatalog(spec, sourceCatalog);
      const baseEntry = colMap.get('OrderId') as PhysicalColEntry;
      const bandEntry = colMap.get('_band_0_Product') as BandColEntry;
      // Base entries have kind undefined
      expect(baseEntry.kind).toBeUndefined();
      // Band entries have kind 'band'
      expect(bandEntry.kind).toBe('band');
    });

    it('should differ from lookup entries by kind field', () => {
      const spec = {
        base: 'Orders',
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Customer', right: 'Name' }],
          cols: [],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
        calcStages: [],
        detailBands: [makeBand({ cols: ['Product'] })],
      };
      const { colMap } = buildColumnCatalog(spec, sourceCatalog);
      // Lookup entries have kind undefined (PhysicalColEntry)
      const lookupEntry = colMap.get('Name');
      expect(lookupEntry).toBeDefined();
      expect(lookupEntry!.kind).toBeUndefined();
      // Band entries have kind 'band'
      const bandEntry = colMap.get('_band_0_Product');
      expect(bandEntry).toBeDefined();
      expect(bandEntry!.kind).toBe('band');
    });

    it('should differ from calc entries by kind value', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [{
          alias: 'DoubledAmount',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { type: 'number', value: '2', op: '*' },
            ],
          },
          enabled: true,
        }],
        detailBands: [makeBand({ cols: ['Product'] })],
      };
      const { colMap } = buildColumnCatalog(spec, sourceCatalog);
      const calcEntry = colMap.get('DoubledAmount');
      const bandEntry = colMap.get('_band_0_Product');
      expect(calcEntry).toBeDefined();
      expect(calcEntry!.kind).toBe('calc');
      expect(bandEntry).toBeDefined();
      expect(bandEntry!.kind).toBe('band');
    });
  });

  // ── resolveRef() handles band entries ────────────────────────────────────

  describe('resolveRef() with band entries', () => {
    it('should return quoted alias for band entries (not physical ref)', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['OrderId', { tid: 'Orders', col: 'OrderId' }],
        ['_band_0_Product', { kind: 'band', tid: 'Items', col: 'Product' }],
      ]);
      // Physical entries resolve to "tid"."col"
      expect(resolveRef('OrderId', colMap)).toBe('"Orders"."OrderId"');
      // Band entries resolve to just the quoted alias (like calc entries)
      expect(resolveRef('_band_0_Product', colMap)).toBe('"_band_0_Product"');
    });

    it('should not produce table-qualified references for band entries', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['_band_0_Qty', { kind: 'band', tid: 'Items', col: 'Qty' }],
      ]);
      const ref = resolveRef('_band_0_Qty', colMap);
      // Should NOT contain "Items" — band columns are not resolved physically
      expect(ref).not.toContain('Items');
      expect(ref).toBe('"_band_0_Qty"');
    });
  });

  // ── Multiple bands all tagged correctly ──────────────────────────────────

  describe('multiple bands tagging', () => {
    it('should tag entries from multiple bands with kind: \'band\'', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [
          makeBand({ id: 'items_band', cols: ['Product', 'Qty'] }),
          makeBand({ id: 'items_band2', rightId: 'Contacts', cols: ['Name'] }),
        ],
      };
      const { colMap } = buildColumnCatalog(spec, sourceCatalog);
      expect(colMap.get('_items_band_Product')!.kind).toBe('band');
      expect(colMap.get('_items_band_Qty')!.kind).toBe('band');
      expect(colMap.get('_items_band2_Name')!.kind).toBe('band');
    });

    it('should not tag base or lookup entries as band', () => {
      const spec = {
        base: 'Orders',
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Customer', right: 'Name' }],
          cols: [],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
        calcStages: [],
        detailBands: [makeBand({ cols: ['Product'] })],
      };
      const { colMap } = buildColumnCatalog(spec, sourceCatalog);
      // Count entries by kind
      let bandCount = 0;
      let physicalCount = 0;
      for (const entry of colMap.values()) {
        if (entry.kind === 'band') bandCount++;
        else if (!entry.kind) physicalCount++;
      }
      // 1 band column (_band_0_Product)
      expect(bandCount).toBe(1);
      // 3 base + 3 lookup (ContactId, Name, Email) = 6 physical
      expect(physicalCount).toBe(6);
    });
  });
});
