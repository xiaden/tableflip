/**
 * Integration tests for band columns in the catalog → query pipeline (Phase 2).
 *
 * Verifies end-to-end that:
 * 1. Band columns appear in colMap (available for UI column picker)
 * 2. Main query SQL is valid and does not reference band columns
 * 3. Band columns can be extracted for band-specific queries via buildBandQuery()
 * 4. The full pipeline works: buildQueryPlan → colMap → buildBandQuery
 */
import { describe, it, expect } from 'vitest';
import { buildQueryPlan } from '../../query/query-plan';
import { buildColumnCatalog } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import { buildBandQuery } from '../../query/sql-detail-bands';
import { execQuery } from '../../core/sqldb';
import { projectedCols } from '../../catalog/column-catalog';
import type { DetailBandSpec, DbTable } from '../../types';
import { makeReportSpec, sqlContains } from '../query/helpers';

describe('Integration — Band Columns in Catalog → Query Pipeline', () => {
  // ── Fixtures ──────────────────────────────────────────────────────────────

  function tablesWithItems(): Record<string, DbTable> {
    return {
      Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 8 },
      Contacts: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 5 },
      Items: { id: 'Items', name: 'Line Items', cols: ['ItemId', 'OrderId', 'Product', 'Qty', 'Price'], rowCount: 50 },
    };
  }

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

  // ── Band columns in projectedCols (UI column picker) ─────────────────────

  describe('band columns in projectedCols', () => {
    it('should include band columns in projectedCols for UI column picker', () => {
      const tables = tablesWithItems();
      const sourceCatalog = buildSourceCatalog(tables);
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const cols = projectedCols(spec, sourceCatalog);
      // Base columns
      expect(cols).toContain('OrderId');
      expect(cols).toContain('Company');
      expect(cols).toContain('Amount');
      // Band columns should be present for the UI column picker
      expect(cols).toContain('_band_0_Product');
      expect(cols).toContain('_band_0_Qty');
    });
  });

  // ── Main query SQL is valid without band columns ─────────────────────────

  describe('main query SQL validity', () => {
    it('should produce valid SQL that does not reference band columns', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      // SQL should not contain band column aliases
      expect(sqlContains(plan.sql, '_band_0_Product')).toBe(false);
      expect(sqlContains(plan.sql, '_band_0_Qty')).toBe(false);
      // SQL should contain base table reference
      expect(sqlContains(plan.sql, '"Orders"')).toBe(true);
    });

    it('should execute main query SQL without errors', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      // The SQL should be executable — no references to non-existent band columns
      const rows = execQuery(plan.sql, plan.params);
      expect(Array.isArray(rows)).toBe(true);
      // Rows should have base columns but NOT band columns
      if (rows.length > 0) {
        expect(rows[0]).toHaveProperty('OrderId');
        expect(rows[0]).not.toHaveProperty('_band_0_Product');
      }
    });
  });

  // ── Band colMap extraction for buildBandQuery ────────────────────────────

  describe('band colMap extraction for band queries', () => {
    it('should extract band entries from colMap for buildBandQuery', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      const band = makeBand();
      const prefix = `_${band.id}_`;

      // Extract band entries (same logic as runDetailBandsMode)
      const bandColMap = new Map<string, typeof plan.colMap extends Map<string, infer V> ? V : never>();
      for (const [alias, entry] of plan.colMap) {
        if (alias.startsWith(prefix) && entry.kind === 'band') {
          bandColMap.set(alias, entry);
        }
      }

      expect(bandColMap.size).toBe(2);
      expect(bandColMap.has('_band_0_Product')).toBe(true);
      expect(bandColMap.has('_band_0_Qty')).toBe(true);

      // All extracted entries should be kind: 'band'
      for (const entry of bandColMap.values()) {
        expect(entry.kind).toBe('band');
      }
    });

    it('should build valid band query from extracted colMap entries', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      const band = makeBand();
      const prefix = `_${band.id}_`;

      // Extract band entries
      const bandColMap = new Map<string, typeof plan.colMap extends Map<string, infer V> ? V : never>();
      for (const [alias, entry] of plan.colMap) {
        if (alias.startsWith(prefix) && entry.kind === 'band') {
          bandColMap.set(alias, entry);
        }
      }

      const tables = tablesWithItems();
      const sourceCatalog = buildSourceCatalog(tables);
      const keyValues = new Set<unknown>(['1', '2', '3']);

      const bandQuery = buildBandQuery(band, keyValues, bandColMap, sourceCatalog);

      // Band query SQL should reference the child table
      expect(sqlContains(bandQuery.sql, '"Items"')).toBe(true);
      // Band query should SELECT band columns with aliases
      expect(sqlContains(bandQuery.sql, '_band_0_Product')).toBe(true);
      expect(sqlContains(bandQuery.sql, '_band_0_Qty')).toBe(true);
      // Band query should have WHERE IN clause
      expect(bandQuery.sql).toContain('IN (?, ?, ?)');
      expect(bandQuery.params).toEqual(['1', '2', '3']);
    });
  });

  // ── Full pipeline: colMap → main query + band query ──────────────────────

  describe('full pipeline: main query + band query', () => {
    it('should produce a valid main query and a valid band query from the same colMap', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const tables = tablesWithItems();
      const plan = buildQueryPlan(spec, tables);
      const sourceCatalog = buildSourceCatalog(tables);
      const band = makeBand();

      // 1. Main query: no band columns
      expect(plan.cols).not.toContain('_band_0_Product');
      expect(sqlContains(plan.sql, '_band_0_Product')).toBe(false);

      // 2. Band columns are in colMap
      expect(plan.colMap.has('_band_0_Product')).toBe(true);
      expect(plan.colMap.get('_band_0_Product')!.kind).toBe('band');

      // 3. Extract band colMap and build band query
      const prefix = `_${band.id}_`;
      const bandColMap = new Map<string, typeof plan.colMap extends Map<string, infer V> ? V : never>();
      for (const [alias, entry] of plan.colMap) {
        if (alias.startsWith(prefix) && entry.kind === 'band') {
          bandColMap.set(alias, entry);
        }
      }

      const keyValues = new Set<unknown>([1, 2, 3]);
      const bandQuery = buildBandQuery(band, keyValues, bandColMap, sourceCatalog);

      // 4. Band query: has band columns
      expect(bandQuery.cols).toContain('_band_0_Product');
      expect(bandQuery.cols).toContain('_band_0_Qty');
      expect(sqlContains(bandQuery.sql, '"Items"')).toBe(true);

      // 5. Main query executes successfully (Orders table exists in test DB)
      const mainRows = execQuery(plan.sql, plan.params);
      expect(Array.isArray(mainRows)).toBe(true);

      // 6. Band query SQL is structurally valid (Items table may not exist in test DB,
      //    so we verify SQL structure rather than executing)
      expect(bandQuery.sql).toContain('SELECT');
      expect(bandQuery.sql).toContain('FROM');
      expect(bandQuery.sql).toContain('WHERE');
      expect(bandQuery.params).toEqual([1, 2, 3]);
    });
  });

  // ── buildColumnCatalog directly (not via buildQueryPlan) ─────────────────

  describe('buildColumnCatalog with detailBands', () => {
    it('should include band columns when detailBands is in reportSpec context', () => {
      const tables = tablesWithItems();
      const sourceCatalog = buildSourceCatalog(tables);
      const catalogCtx = {
        base: 'Orders',
        baseCols: [],
        stacks: [],
        lookups: [],
        calcStages: [],
        detailBands: [makeBand()],
      };
      const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);
      expect(colMap.has('_band_0_Product')).toBe(true);
      expect(colMap.has('_band_0_Qty')).toBe(true);
      expect(colMap.get('_band_0_Product')!.kind).toBe('band');
    });

    it('should not include band columns when detailBands is empty', () => {
      const tables = tablesWithItems();
      const sourceCatalog = buildSourceCatalog(tables);
      const catalogCtx = {
        base: 'Orders',
        baseCols: [],
        stacks: [],
        lookups: [],
        calcStages: [],
        detailBands: [],
      };
      const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);
      for (const alias of colMap.keys()) {
        expect(alias).not.toMatch(/^_band_/);
      }
    });
  });
});
