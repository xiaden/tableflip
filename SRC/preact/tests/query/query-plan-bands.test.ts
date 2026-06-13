/**
 * Tests for buildQueryPlan() band column handling (Phase 2).
 *
 * Verifies that when detailBands are in the catalogCtx:
 * 1. Band columns appear in plan.colMap (available for UI column picker)
 * 2. Band columns do NOT appear in plan.sql SELECT (no JOIN in FROM clause)
 * 3. Band columns do NOT appear in plan.cols (projected output list)
 * 4. This works across all aggregation modes (detail, totals, subtotals, grouped)
 */
import { describe, it, expect } from 'vitest';
import { buildQueryPlan } from '../../query/query-plan';
import type { DetailBandSpec } from '../../types';
import { makeReportSpec, standardTables, sqlContains } from './helpers';

describe('Query Plan — Band Column Handling', () => {
  // ── Extended fixtures (need a child table for bands) ──────────────────────

  function tablesWithItems(): Record<string, { id: string; name: string; cols: string[]; rowCount: number }> {
    return {
      ...standardTables(),
      Items: { id: 'Items', name: 'Line Items', cols: ['ItemId', 'OrderId', 'Product', 'Qty'], rowCount: 50 },
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

  // ── Band columns in colMap ────────────────────────────────────────────────

  describe('band columns in colMap', () => {
    it('should include band columns in plan.colMap when detailBands are configured', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      expect(plan.colMap.has('_band_0_Product')).toBe(true);
      expect(plan.colMap.has('_band_0_Qty')).toBe(true);
    });

    it('should tag band colMap entries with kind: \'band\'', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      const entry = plan.colMap.get('_band_0_Product')!;
      expect(entry.kind).toBe('band');
    });

    it('should not include band columns in colMap when no detailBands', () => {
      const spec = makeReportSpec();
      const plan = buildQueryPlan(spec, tablesWithItems());
      // No band prefix entries
      for (const alias of plan.colMap.keys()) {
        expect(alias).not.toMatch(/^_band_/);
      }
    });
  });

  // ── Band columns NOT in SQL SELECT ────────────────────────────────────────

  describe('band columns excluded from SQL', () => {
    it('should NOT project band columns in detail mode SQL', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      expect(plan.aggMode).toBe('none');
      // SQL should NOT contain band column aliases
      expect(sqlContains(plan.sql, '_band_0_Product')).toBe(false);
      expect(sqlContains(plan.sql, '_band_0_Qty')).toBe(false);
      // plan.cols should NOT include band columns
      expect(plan.cols).not.toContain('_band_0_Product');
      expect(plan.cols).not.toContain('_band_0_Qty');
    });

    it('should NOT project band columns in totals mode SQL', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
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
      const plan = buildQueryPlan(spec, tablesWithItems());
      expect(plan.aggMode).toBe('totals');
      expect(sqlContains(plan.sql, '_band_0_Product')).toBe(false);
      expect(plan.cols).not.toContain('_band_0_Product');
    });

    it('should NOT project band columns in subtotals mode SQL', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Amount'],
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      expect(plan.aggMode).toBe('subtotals');
      expect(sqlContains(plan.sql, '_band_0_Product')).toBe(false);
      expect(plan.cols).not.toContain('_band_0_Product');
    });

    it('should NOT project band columns in grouped mode SQL', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
        aggregation: {
          mode: 'group',
          groupBy: ['Company'],
          aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'Total', enabled: true }],
          colTotals: {},
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      expect(plan.aggMode).toBe('group');
      expect(sqlContains(plan.sql, '_band_0_Product')).toBe(false);
      expect(plan.cols).not.toContain('_band_0_Product');
    });
  });

  // ── Base columns still projected ──────────────────────────────────────────

  describe('base columns still projected', () => {
    it('should still project base columns when bands are configured', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      // Base columns should be in SQL and cols
      expect(plan.cols).toContain('OrderId');
      expect(plan.cols).toContain('Company');
      expect(plan.cols).toContain('Amount');
      expect(sqlContains(plan.sql, '"Orders"')).toBe(true);
    });
  });

  // ── Disabled bands don't contribute ───────────────────────────────────────

  describe('disabled bands', () => {
    it('should not add band columns when band is disabled', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand({ enabled: false })],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      expect(plan.colMap.has('_band_0_Product')).toBe(false);
    });
  });

  // ── Sort on band column is skipped ────────────────────────────────────────

  describe('sort on band column', () => {
    it('should not include band column sorts in SQL ORDER BY', () => {
      const spec = makeReportSpec({
        sorts: [
          { col: 'Amount', dir: 'ASC', enabled: true },
          { col: '_band_0_Product', dir: 'DESC', enabled: true },
        ],
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
          detailBands: [makeBand()],
        },
      });
      const plan = buildQueryPlan(spec, tablesWithItems());
      // Should contain Amount sort
      expect(sqlContains(plan.sql, '"Amount" ASC')).toBe(true);
      // Should NOT contain band column sort
      expect(sqlContains(plan.sql, '_band_0_Product')).toBe(false);
    });
  });
});
