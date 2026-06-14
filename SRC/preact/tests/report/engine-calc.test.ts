/**
 * Tests for calc column execution through the report engine (runReport).
 *
 * Verifies that calculated columns work end-to-end through runReport()
 * for all aggregation modes: detail, totals, subtotals, and grouped.
 */
import { describe, it, expect } from 'vitest';
import { runReport } from '../../report/engine';
import type { CalcStage, DbTable } from '../../types';
import { makeReportSpec } from '../query/helpers';

describe('engine calc column execution', () => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  function ordersTables(): Record<string, DbTable> {
    return {
      Orders: {
        id: 'Orders', name: 'Orders',
        cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
        rowCount: 8,
      },
    };
  }

  /** Math calc: Amount * 2 */
  function doubledAmountCalc(): CalcStage[] {
    return [{
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
    }];
  }

  /** Compare calc: if Amount > 200 then 'High' else 'Low' */
  function compareCalc(): CalcStage[] {
    return [{
      alias: 'AmountLevel',
      mode: 'compare',
      compare: {
        compareMode: 'AND',
        conditions: [{ col: 'Amount', op: '>', val: '200' }],
        trueValue: { type: 'text', value: 'High' },
        falseValue: { type: 'text', value: 'Low' },
      },
      enabled: true,
    }];
  }

  // ── Detail mode ─────────────────────────────────────────────────────────

  describe('detail mode with calc columns', () => {
    it('should compute calc column values for each row', () => {
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Amount', 'DoubledAmount'],
        sorts: [{ col: 'OrderId', dir: 'ASC', enabled: true }],
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = runReport(spec, ordersTables());

      expect(result.columns).toContain('DoubledAmount');
      expect(result.rows.length).toBe(8);

      // ORD-001: Amount=150, DoubledAmount=300
      const ord001 = result.rows.find(r => r['OrderId'] === 'ORD-001');
      expect(ord001!['DoubledAmount']).toBeCloseTo(300, 1);

      // ORD-007: Amount=820, DoubledAmount=1640
      const ord007 = result.rows.find(r => r['OrderId'] === 'ORD-007');
      expect(ord007!['DoubledAmount']).toBeCloseTo(1640, 1);

      // ORD-006: Amount=null, DoubledAmount should be 0 (COALESCE to '0' in calc)
      const ord006 = result.rows.find(r => r['OrderId'] === 'ORD-006');
      expect(ord006!['DoubledAmount']).toBeCloseTo(0, 1);
    });

    it('should compute text calc column values', () => {
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Amount', 'AmountLevel'],
        sorts: [{ col: 'OrderId', dir: 'ASC', enabled: true }],
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: compareCalc(),
          detailBands: [],
        },
      });

      const result = runReport(spec, ordersTables());

      expect(result.columns).toContain('AmountLevel');
      // Amount > 200 → 'High': ORD-002(275), ORD-004(500), ORD-007(820), ORD-008(310)
      const highRows = result.rows.filter(r => r['AmountLevel'] === 'High');
      expect(highRows.length).toBe(4);

      // Amount <= 200 → 'Low': ORD-001(150), ORD-003(99.5), ORD-005(0), ORD-006(null)
      const lowRows = result.rows.filter(r => r['AmountLevel'] === 'Low');
      expect(lowRows.length).toBe(4);
    });
  });

  // ── Totals mode ─────────────────────────────────────────────────────────

  describe('totals mode with calc columns', () => {
    it('should compute aggregate of calc column in totals row', () => {
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Amount', 'DoubledAmount'],
        aggregation: {
          mode: 'totals',
          groupBy: [],
          aggregates: [],
          colTotals: { Amount: 'SUM', DoubledAmount: 'SUM' },
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = runReport(spec, ordersTables());

      expect(result.metadata.aggMode).toBe('totals');
      expect(result.metadata.totalsRow).toBeTruthy();

      // SUM(Amount) = 150 + 275 + 99.5 + 500 + 0 + 820 + 310 = 2154.5
      // (ORD-006 has null Amount, excluded from SUM)
      expect(result.metadata.totalsRow!['Amount']).toBeCloseTo(2154.5, 1);

      // SUM(DoubledAmount) = 2 * SUM(Amount for non-null) = 2 * 2154.5 = 4309
      expect(result.metadata.totalsRow!['DoubledAmount']).toBeCloseTo(4309, 0);

      // Detail rows should also have DoubledAmount
      expect(result.rows.length).toBe(8);
      expect(result.rows[0]).toHaveProperty('DoubledAmount');
    });
  });

  // ── Subtotals mode ──────────────────────────────────────────────────────

  describe('subtotals mode with calc columns', () => {
    it('should compute calc values in detail rows and subtotal aggregates', () => {
      const spec = makeReportSpec({
        outputColumns: ['Region', 'Amount', 'DoubledAmount'],
        sorts: [{ col: 'Region', dir: 'ASC', enabled: true }],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Region'],
          subtotalFns: { Amount: 'SUM', DoubledAmount: 'SUM' },
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = runReport(spec, ordersTables());

      expect(result.metadata.aggMode).toBe('subtotals');
      expect(result.metadata.hasSubtotals).toBe(true);
      expect(result.columns).toContain('DoubledAmount');

      // Should have detail rows (8) + subtotal rows (one per region) + grand total
      expect(result.rows.length).toBeGreaterThan(8);

      // Check detail rows have correct DoubledAmount
      const detailRows = result.rows.filter(r => r['_row_type'] === 0);
      expect(detailRows.length).toBe(8);
      for (const row of detailRows) {
        if (row['Amount'] !== null) {
          expect(row['DoubledAmount']).toBeCloseTo((row['Amount'] as number) * 2, 1);
        }
      }

      // Check grand total row has SUM of DoubledAmount
      const grandTotal = result.rows.filter(r => r['_row_type'] === 3);
      expect(grandTotal.length).toBe(1);
      expect(grandTotal[0]['DoubledAmount']).toBeCloseTo(4309, 0);
    });
  });

  // ── Grouped mode ────────────────────────────────────────────────────────

  describe('grouped mode with calc columns', () => {
    it('should group by a calc column', () => {
      const spec = makeReportSpec({
        outputColumns: ['AmountLevel', 'Count'],
        aggregation: {
          mode: 'group',
          groupBy: ['AmountLevel'],
          aggregates: [
            { col: '*', fn: 'COUNT ROWS', alias: 'Count', enabled: true },
          ],
          colTotals: {},
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: compareCalc(),
          detailBands: [],
        },
      });

      const result = runReport(spec, ordersTables());

      expect(result.metadata.aggMode).toBe('group');
      expect(result.rows.length).toBe(2); // 'High' and 'Low'
      expect(result.columns).toContain('AmountLevel');
      expect(result.columns).toContain('Count');

      const high = result.rows.find(r => r['AmountLevel'] === 'High');
      const low = result.rows.find(r => r['AmountLevel'] === 'Low');
      expect(high).toBeTruthy();
      expect(low).toBeTruthy();
      expect(high!['Count']).toBe(4);
      expect(low!['Count']).toBe(4);
    });

    it('should aggregate a calc column within groups', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'DoubledAmount', 'SumDoubled'],
        aggregation: {
          mode: 'group',
          groupBy: ['Company'],
          aggregates: [
            { col: 'DoubledAmount', fn: 'SUM', alias: 'SumDoubled', enabled: true },
          ],
          colTotals: {},
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = runReport(spec, ordersTables());

      expect(result.metadata.aggMode).toBe('group');
      expect(result.columns).toContain('SumDoubled');

      const acme = result.rows.find(r => r['Company'] === 'Acme Corp');
      expect(acme).toBeTruthy();
      // Acme: 150 + 99.5 + 310 = 559.5, doubled = 1119
      expect(acme!['SumDoubled']).toBeCloseTo(1119, 0);

      const beta = result.rows.find(r => r['Company'] === 'Beta Inc');
      expect(beta).toBeTruthy();
      // Beta: 275 + null = 275 (null excluded), doubled = 550
      expect(beta!['SumDoubled']).toBeCloseTo(550, 0);
    });
  });
});
