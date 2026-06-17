/**
 * Tests for buildQueryPlan() band column handling (Phase 2).
 *
 * Verifies that when detailBands are in the catalogCtx:
 * 1. Band columns appear in plan.colMap (available for UI column picker)
 * 2. Band columns do NOT appear in plan.selectedColumns (projected output list)
 * 3. This works across all aggregation modes (detail, totals, subtotals, grouped)
 */
import { describe, it, expect } from 'vitest';
import { buildQueryPlan } from '../../query/query-plan';
import type { DetailBandSpec } from '../../types';
import { makeReportSpec, standardTables } from './helpers';

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
          baseCols: [],
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
          baseCols: [],
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

  // ── Band columns NOT in selectedColumns ──────────────────────────────────

  describe('band columns excluded from selectedColumns', () => {
    it('should NOT project band columns in detail mode', () => {
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
      expect(plan.aggMode).toBe('none');
      // selectedColumns should NOT include band columns
      expect(plan.selectedColumns).not.toContain('_band_0_Product');
      expect(plan.selectedColumns).not.toContain('_band_0_Qty');
    });

    it('should NOT project band columns in totals mode', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
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
      expect(plan.selectedColumns).not.toContain('_band_0_Product');
    });

    it('should NOT project band columns in subtotals mode', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Amount'],
        pipeline: {
          base: 'Orders',
          baseCols: [],
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
      expect(plan.selectedColumns).not.toContain('_band_0_Product');
    });

    it('should NOT project band columns in grouped mode', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
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
      expect(plan.selectedColumns).not.toContain('_band_0_Product');
    });
  });

  // ── Base columns still projected ──────────────────────────────────────────

  describe('base columns still projected', () => {
    it('should still project base columns when bands are configured', () => {
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
      // Base columns should be in selectedColumns
      expect(plan.selectedColumns).toContain('OrderId');
      expect(plan.selectedColumns).toContain('Company');
      expect(plan.selectedColumns).toContain('Amount');
      // Source base table should be Orders
      expect(plan.source.base).toBe('Orders');
    });
  });

  // ── Disabled bands don't contribute ───────────────────────────────────────

  describe('disabled bands', () => {
    it('should not add band columns when band is disabled', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
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
    it('should include sort config for band columns (filtered at stage level)', () => {
      const spec = makeReportSpec({
        sorts: [
          { col: 'Amount', dir: 'ASC', enabled: true },
          { col: '_band_0_Product', dir: 'DESC', enabled: true },
        ],
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
      // Both sorts are in config since both cols are in colMap
      // Band column sort filtering happens at the pipeline stage level, not config level
      expect(plan.sorts.length).toBe(2);
      expect(plan.sorts[0].col).toBe('Amount');
      expect(plan.sorts[1].col).toBe('_band_0_Product');
    });
  });
});
