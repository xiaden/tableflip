import { describe, it, expect } from 'vitest';
import { buildBandQuery } from '../../query/sql-detail-bands';
import type { DetailBandSpec } from '../../types';
import type { ColMapEntry } from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import { normalizeSql } from './helpers';

// ── Test Fixtures ───────────────────────────────────────────────────────────────

function itemsSourceCatalog(): Map<string, SourceTableEntry> {
  return new Map<string, SourceTableEntry>([
    ['Orders', {
      id: 'Orders',
      name: 'Orders',
      cols: ['OrderID', 'Customer', 'Date'],
      kind: 'imported',
      source: { id: 'Orders', name: 'Orders', cols: ['OrderID', 'Customer', 'Date'], rowCount: 100 },
    }],
    ['Items', {
      id: 'Items',
      name: 'Line Items',
      cols: ['ItemID', 'OrderID', 'Product', 'Qty', 'Price'],
      kind: 'imported',
      source: { id: 'Items', name: 'Line Items', cols: ['ItemID', 'OrderID', 'Product', 'Qty', 'Price'], rowCount: 500 },
    }],
  ]);
}

function makeBand(overrides: Partial<DetailBandSpec> = {}): DetailBandSpec {
  return {
    id: 'band_0',
    rightId: 'Items',
    keyPairs: [{ left: 'OrderID', right: 'OrderID' }],
    cols: ['Product', 'Qty'],
    enabled: true,
    sorts: [],
    label: 'Line Items',
    ...overrides,
  };
}

function makeBandColMap(entries: Array<[string, ColMapEntry]>): Map<string, ColMapEntry> {
  return new Map<string, ColMapEntry>(entries);
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('sql-detail-bands', () => {
  const sourceCatalog = itemsSourceCatalog();

  describe('buildBandQuery() — single key', () => {
    it('generates WHERE IN with parent key values', () => {
      const band = makeBand();
      const keys = new Set([1, 2, 3]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
        ['_band_0_Qty', { tid: 'Items', col: 'Qty' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('SELECT');
      expect(norm).toContain('"Items"."Product" AS "_band_0_Product"');
      expect(norm).toContain('"Items"."Qty" AS "_band_0_Qty"');
      expect(norm).toContain('FROM "Items"');
      expect(norm).toContain('"Items"."OrderID" IN (?, ?, ?)');
      expect(result.params).toEqual([1, 2, 3]);
    });

    it('includes child key column in SELECT for JS-side matching', () => {
      const band = makeBand();
      const keys = new Set([10]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Items"."OrderID" AS "OrderID"');
    });

    it('returns correct cols array (band aliases only, not key cols)', () => {
      const band = makeBand();
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
        ['_band_0_Qty', { tid: 'Items', col: 'Qty' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      expect(result.cols).toEqual(['_band_0_Product', '_band_0_Qty']);
    });

    it('returns parentKeyAliases and childKeyCols as arrays', () => {
      const band = makeBand();
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      expect(result.parentKeyAliases).toEqual(['OrderID']);
      expect(result.childKeyCols).toEqual(['OrderID']);
    });

    it('does not duplicate key column if already in band cols', () => {
      // If the key column (OrderID) is also selected as a band column,
      // it should appear once as the band alias and once as the raw key
      const band = makeBand();
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_OrderID', { tid: 'Items', col: 'OrderID' }],
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      // Band alias version
      expect(norm).toContain('"Items"."OrderID" AS "_band_0_OrderID"');
      // Raw key version for JS matching
      expect(norm).toContain('"Items"."OrderID" AS "OrderID"');
      // Count occurrences of "OrderID" — should be exactly 2 (alias + key)
      const matches = norm.match(/"OrderID"/g);
      expect(matches).toHaveLength(4); // 2 in SELECT (AS "_band_0_OrderID", AS "OrderID") + 1 in WHERE + the tid reference
    });
  });

  describe('buildBandQuery() — multi-key', () => {
    it('generates concatenation with ||| separator for 2 key pairs', () => {
      const band = makeBand({
        keyPairs: [
          { left: 'OrderID', right: 'OrderID' },
          { left: 'Customer', right: 'Product' },
        ],
      });
      const keys = new Set(['1|||Widget', '2|||Gadget']);
      const bandColMap = makeBandColMap([
        ['_band_0_Qty', { tid: 'Items', col: 'Qty' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      // Should contain concatenation expression
      expect(norm).toContain('"Items"."OrderID"');
      expect(norm).toContain("'|||'");
      expect(norm).toContain('"Items"."Product"');
      // Should use IN with placeholders
      expect(norm).toContain('IN (?, ?)');
      expect(result.params).toEqual(['1|||Widget', '2|||Gadget']);
    });

    it('returns all key columns in childKeyCols and parentKeyAliases', () => {
      const band = makeBand({
        keyPairs: [
          { left: 'OrderID', right: 'OrderID' },
          { left: 'Customer', right: 'Product' },
        ],
      });
      const keys = new Set(['1|||A']);
      const bandColMap = makeBandColMap([
        ['_band_0_Qty', { tid: 'Items', col: 'Qty' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      expect(result.parentKeyAliases).toEqual(['OrderID', 'Customer']);
      expect(result.childKeyCols).toEqual(['OrderID', 'Product']);
    });

    it('selects all child key columns for multi-key', () => {
      const band = makeBand({
        keyPairs: [
          { left: 'OrderID', right: 'OrderID' },
          { left: 'Customer', right: 'Product' },
        ],
      });
      const keys = new Set(['1|||A']);
      const bandColMap = makeBandColMap([
        ['_band_0_Qty', { tid: 'Items', col: 'Qty' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Items"."OrderID" AS "OrderID"');
      expect(norm).toContain('"Items"."Product" AS "Product"');
    });

    it('deduplicates child key columns when same column used twice', () => {
      const band = makeBand({
        keyPairs: [
          { left: 'OrderID', right: 'OrderID' },
          { left: 'OtherAlias', right: 'OrderID' },  // same child col
        ],
      });
      const keys = new Set(['1|||1']);
      const bandColMap = makeBandColMap([
        ['_band_0_Qty', { tid: 'Items', col: 'Qty' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      // "OrderID" AS "OrderID" should appear only once
      const matches = norm.match(/"OrderID" AS "OrderID"/g);
      expect(matches).toHaveLength(1);
      // But both parent key aliases and child key cols are preserved
      expect(result.parentKeyAliases).toEqual(['OrderID', 'OtherAlias']);
      expect(result.childKeyCols).toEqual(['OrderID', 'OrderID']);
    });
  });

  describe('buildBandQuery() — empty keys', () => {
    it('returns guard query when parentKeyValues is empty', () => {
      const band = makeBand();
      const keys = new Set<unknown>();
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('1 = 0');
      expect(result.params).toEqual([]);
    });

    it('returns guard query when keyPairs are empty', () => {
      const band = makeBand({ keyPairs: [] });
      const keys = new Set([1, 2]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('1 = 0');
      expect(result.params).toEqual([]);
    });

    it('returns guard query when keyPairs have empty left/right', () => {
      const band = makeBand({ keyPairs: [{ left: '', right: '' }] });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('1 = 0');
      expect(result.params).toEqual([]);
    });
  });

  describe('buildBandQuery() — sort', () => {
    it('adds ORDER BY for enabled sorts', () => {
      const band = makeBand({
        sorts: [
          { col: 'Product', dir: 'ASC', enabled: true },
          { col: 'Qty', dir: 'DESC', enabled: true },
        ],
      });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
        ['_band_0_Qty', { tid: 'Items', col: 'Qty' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('ORDER BY');
      expect(norm).toContain('"Items"."Product" ASC');
      expect(norm).toContain('"Items"."Qty" DESC');
    });

    it('skips disabled sorts', () => {
      const band = makeBand({
        sorts: [
          { col: 'Product', dir: 'ASC', enabled: true },
          { col: 'Qty', dir: 'DESC', enabled: false },
        ],
      });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Items"."Product" ASC');
      expect(norm).not.toContain('"Items"."Qty"');
    });

    it('skips sorts with empty col', () => {
      const band = makeBand({
        sorts: [
          { col: '', dir: 'ASC', enabled: true },
        ],
      });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      expect(normalizeSql(result.sql)).not.toContain('ORDER BY');
    });

    it('defaults to ASC when dir is neither ASC nor DESC', () => {
      const band = makeBand({
        sorts: [
          { col: 'Product', dir: 'UNKNOWN' as 'ASC', enabled: true },
        ],
      });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Items"."Product" ASC');
    });

    it('omits ORDER BY when sorts array is empty', () => {
      const band = makeBand({ sorts: [] });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      expect(normalizeSql(result.sql)).not.toContain('ORDER BY');
    });

    it('omits ORDER BY when all sort entries are disabled', () => {
      const band = makeBand({
        sorts: [
          { col: 'Product', dir: 'ASC', enabled: false },
          { col: 'Qty', dir: 'DESC', enabled: false },
        ],
      });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      expect(normalizeSql(result.sql)).not.toContain('ORDER BY');
    });

    it('preserves sort order (first entry is primary, second is secondary)', () => {
      const band = makeBand({
        sorts: [
          { col: 'Qty', dir: 'DESC', enabled: true },
          { col: 'Product', dir: 'ASC', enabled: true },
          { col: 'Price', dir: 'ASC', enabled: true },
        ],
      });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      const orderByIdx = norm.indexOf('ORDER BY');
      const qtyIdx = norm.indexOf('"Items"."Qty" DESC');
      const productIdx = norm.indexOf('"Items"."Product" ASC');
      const priceIdx = norm.indexOf('"Items"."Price" ASC');
      // All three should appear after ORDER BY
      expect(qtyIdx).toBeGreaterThan(orderByIdx);
      expect(productIdx).toBeGreaterThan(qtyIdx);
      expect(priceIdx).toBeGreaterThan(productIdx);
    });

    it('includes only entries with valid col, skipping empty-col entries among valid ones', () => {
      const band = makeBand({
        sorts: [
          { col: 'Product', dir: 'ASC', enabled: true },
          { col: '', dir: 'DESC', enabled: true },
          { col: 'Qty', dir: 'DESC', enabled: true },
        ],
      });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Items"."Product" ASC');
      expect(norm).toContain('"Items"."Qty" DESC');
      // The empty-col entry should be skipped, so only 2 sort parts
      const orderByClause = norm.substring(norm.indexOf('ORDER BY'));
      expect(orderByClause).toContain('"Items"."Product" ASC, "Items"."Qty" DESC');
    });
  });

  describe('buildBandQuery() — calc column skipping', () => {
    it('skips calc columns in bandColMap', () => {
      const band = makeBand();
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
        ['_band_0_Calc', { kind: 'calc', idx: 0, mode: 'math' }],
        ['_band_0_Qty', { tid: 'Items', col: 'Qty' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Items"."Product"');
      expect(norm).toContain('"Items"."Qty"');
      expect(norm).not.toContain('_band_0_Calc');
      expect(result.cols).toEqual(['_band_0_Product', '_band_0_Qty']);
    });

    it('produces valid query when all bandColMap entries are calc', () => {
      const band = makeBand();
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Calc1', { kind: 'calc', idx: 0, mode: 'math' }],
        ['_band_0_Calc2', { kind: 'calc', idx: 1, mode: 'text' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      // Should still select the key column
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Items"."OrderID" AS "OrderID"');
      expect(result.cols).toEqual([]);
    });
  });

  describe('buildBandQuery() — empty bandColMap', () => {
    it('produces query selecting only key columns when bandColMap is empty', () => {
      const band = makeBand();
      const keys = new Set([1, 2]);
      const bandColMap = makeBandColMap([]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Items"."OrderID" AS "OrderID"');
      expect(norm).toContain('IN (?, ?)');
      expect(result.cols).toEqual([]);
    });
  });

  describe('buildBandQuery() — quoteId safety', () => {
    it('quotes table names with special characters', () => {
      const band = makeBand({ rightId: 'Line Items (2024)' });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Line Items (2024)', col: 'Product' }],
      ]);
      const catalog = new Map<string, SourceTableEntry>([
        ['Line Items (2024)', {
          id: 'Line Items (2024)',
          name: 'Line Items (2024)',
          cols: ['Product', 'Qty'],
          kind: 'imported',
          source: { id: 'Line Items (2024)', name: 'Line Items (2024)', cols: ['Product', 'Qty'], rowCount: 50 },
        }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, catalog);

      const norm = normalizeSql(result.sql);
      expect(norm).toContain('"Line Items (2024)"');
      expect(norm).toContain('"Product"');
    });

    it('quotes column names with double quotes', () => {
      const band = makeBand();
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_weird"col', { tid: 'Items', col: 'weird"col' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const norm = normalizeSql(result.sql);
      // quoteId escapes double quotes by doubling them
      expect(norm).toContain('"weird""col"');
    });
  });

  describe('buildBandQuery() — SQL structure', () => {
    it('produces correct SQL structure (SELECT, FROM, WHERE)', () => {
      const band = makeBand();
      const keys = new Set([42]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      // Verify SQL sections appear in correct order
      const selectIdx = result.sql.indexOf('SELECT');
      const fromIdx = result.sql.indexOf('FROM');
      const whereIdx = result.sql.indexOf('WHERE');
      expect(selectIdx).toBeLessThan(fromIdx);
      expect(fromIdx).toBeLessThan(whereIdx);
    });

    it('places ORDER BY after WHERE', () => {
      const band = makeBand({
        sorts: [{ col: 'Product', dir: 'ASC', enabled: true }],
      });
      const keys = new Set([1]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      const whereIdx = result.sql.indexOf('WHERE');
      const orderIdx = result.sql.indexOf('ORDER BY');
      expect(orderIdx).toBeGreaterThan(whereIdx);
    });

    it('handles string key values', () => {
      const band = makeBand();
      const keys = new Set(['ABC', 'DEF', 'GHI']);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      expect(result.params).toEqual(['ABC', 'DEF', 'GHI']);
      expect(normalizeSql(result.sql)).toContain('IN (?, ?, ?)');
    });

    it('handles mixed-type key values', () => {
      const band = makeBand();
      const keys = new Set([1, 'two', 3]);
      const bandColMap = makeBandColMap([
        ['_band_0_Product', { tid: 'Items', col: 'Product' }],
      ]);

      const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);

      expect(result.params).toEqual([1, 'two', 3]);
    });
  });
});
