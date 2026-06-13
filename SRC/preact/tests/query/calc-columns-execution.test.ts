/**
 * Tests for calc column execution in query builders.
 *
 * Verifies that calculated columns produce correct SQL and execute
 * correctly against the test database — not just plan structure.
 */
import { describe, it, expect } from 'vitest';
import { buildDetailQuery } from '../../query/sql-detail';
import { buildTotalsQuery } from '../../query/sql-totals';
import { buildSubtotalsQuery } from '../../query/sql-subtotals';
import { buildGroupedQuery } from '../../query/sql-grouped';
import { buildCalcExpressions } from '../../query/sql-calcs';
import { execQuery } from '../../core/sqldb';
import type { CalcStage } from '../../types';
import type { ColMapEntry } from '../../catalog/column-catalog';
import { ordersColMap, standardSourceCatalog, makeReportSpec, sqlContains } from './helpers';

describe('calc column execution in query builders', () => {
  const colMap = ordersColMap();
  const sourceCatalog = standardSourceCatalog();

  // ── Calc stage fixtures ──────────────────────────────────────────────────

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

  /** Build calcExprs map from calc stages + colMap */
  function buildCalcExprsMap(calcs: CalcStage[]): Map<string, string> {
    const exprs = buildCalcExpressions(calcs, colMap);
    const map = new Map<string, string>();
    for (const e of exprs) map.set(e.alias, e.sql);
    return map;
  }

  /** Add a calc entry to the colMap */
  function colMapWithCalc(alias: string, idx: number): Map<string, ColMapEntry> {
    const m = new Map(colMap);
    m.set(alias, { kind: 'calc', idx, mode: 'math', alias });
    return m;
  }

  // ── buildDetailQuery ──────────────────────────────────────────────────────

  describe('buildDetailQuery()', () => {
    it('should include calc expression in SELECT instead of bare alias', () => {
      const calcColMap = colMapWithCalc('DoubledAmount', 0);
      const calcExprs = buildCalcExprsMap(doubledAmountCalc());
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Amount', 'DoubledAmount'],
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = buildDetailQuery(spec, calcColMap, sourceCatalog, calcExprs);

      // SQL should contain the calc expression (CAST...AS REAL)*2 not just "DoubledAmount"
      expect(sqlContains(result.sql, 'AS "DoubledAmount"')).toBe(true);
      // Should NOT contain bare "DoubledAmount" as a column reference
      expect(result.sql).not.toMatch(/"Orders"\."DoubledAmount"/);
      expect(result.cols).toContain('DoubledAmount');
    });

    it('should execute correctly and produce computed values', () => {
      const calcColMap = colMapWithCalc('DoubledAmount', 0);
      const calcExprs = buildCalcExprsMap(doubledAmountCalc());
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Amount', 'DoubledAmount'],
        sorts: [{ col: 'OrderId', dir: 'ASC', enabled: true }],
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = buildDetailQuery(spec, calcColMap, sourceCatalog, calcExprs);
      const rows = execQuery(result.sql, result.params);

      expect(rows.length).toBe(8);
      // ORD-001 has Amount=150, DoubledAmount should be 300
      const ord001 = rows.find(r => r['OrderId'] === 'ORD-001');
      expect(ord001).toBeTruthy();
      expect(ord001!['DoubledAmount']).toBeCloseTo(300, 1);

      // ORD-007 has Amount=820, DoubledAmount should be 1640
      const ord007 = rows.find(r => r['OrderId'] === 'ORD-007');
      expect(ord007).toBeTruthy();
      expect(ord007!['DoubledAmount']).toBeCloseTo(1640, 1);
    });

    it('should handle compare calc producing text values', () => {
      const calcColMap = new Map(colMap);
      calcColMap.set('AmountLevel', { kind: 'calc', idx: 0, mode: 'compare', alias: 'AmountLevel' });
      const calcExprs = buildCalcExprsMap(compareCalc());
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Amount', 'AmountLevel'],
        sorts: [{ col: 'OrderId', dir: 'ASC', enabled: true }],
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: compareCalc(),
          detailBands: [],
        },
      });

      const result = buildDetailQuery(spec, calcColMap, sourceCatalog, calcExprs);
      const rows = execQuery(result.sql, result.params);

      // ORD-001 Amount=150 → 'Low'
      expect(rows.find(r => r['OrderId'] === 'ORD-001')!['AmountLevel']).toBe('Low');
      // ORD-002 Amount=275 → 'High'
      expect(rows.find(r => r['OrderId'] === 'ORD-002')!['AmountLevel']).toBe('High');
      // ORD-004 Amount=500 → 'High'
      expect(rows.find(r => r['OrderId'] === 'ORD-004')!['AmountLevel']).toBe('High');
      // ORD-005 Amount=0 → 'Low'
      expect(rows.find(r => r['OrderId'] === 'ORD-005')!['AmountLevel']).toBe('Low');
    });

    it('should work with empty calcExprs (backward compat)', () => {
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Amount'],
      });
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      expect(result.cols).toEqual(['OrderId', 'Amount']);
      const rows = execQuery(result.sql, result.params);
      expect(rows.length).toBe(8);
    });
  });

  // ── buildTotalsQuery ──────────────────────────────────────────────────────

  describe('buildTotalsQuery()', () => {
    it('should wrap calc expression inside aggregate function', () => {
      const calcColMap = colMapWithCalc('DoubledAmount', 0);
      const calcExprs = buildCalcExprsMap(doubledAmountCalc());
      const spec = makeReportSpec({
        outputColumns: ['DoubledAmount'],
        aggregation: {
          mode: 'totals',
          groupBy: [],
          aggregates: [],
          colTotals: { DoubledAmount: 'SUM' },
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = buildTotalsQuery(spec, calcColMap, sourceCatalog, calcExprs);
      expect(result).not.toBeNull();
      // SQL should contain SUM(<calc_expr>) not SUM("DoubledAmount")
      expect(result!.sql).toContain('SUM(');
      expect(result!.sql).toContain('AS "DoubledAmount"');
    });

    it('should execute and produce correct aggregate of calc values', () => {
      const calcColMap = colMapWithCalc('DoubledAmount', 0);
      const calcExprs = buildCalcExprsMap(doubledAmountCalc());
      const spec = makeReportSpec({
        outputColumns: ['DoubledAmount'],
        aggregation: {
          mode: 'totals',
          groupBy: [],
          aggregates: [],
          colTotals: { DoubledAmount: 'SUM' },
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = buildTotalsQuery(spec, calcColMap, sourceCatalog, calcExprs);
      const rows = execQuery(result!.sql, result!.params);

      expect(rows.length).toBe(1);
      // SUM of DoubledAmount = 2 * SUM(Amount) = 2 * 2154.5 = 4309
      // Non-null amounts: 150 + 275 + 99.5 + 500 + 0 + 820 + 310 = 2154.5
      // (ORD-006 has null Amount, so it contributes NULL to the calc → excluded from SUM)
      expect(rows[0]['DoubledAmount']).toBeCloseTo(4309, 0);
    });
  });

  // ── buildGroupedQuery ─────────────────────────────────────────────────────

  describe('buildGroupedQuery()', () => {
    it('should use calc expression as group column reference', () => {
      const calcColMap = colMapWithCalc('AmountLevel', 0);
      const calcExprs = buildCalcExprsMap(compareCalc());
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
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: compareCalc(),
          detailBands: [],
        },
      });

      const result = buildGroupedQuery(spec, calcColMap, sourceCatalog, calcExprs);
      const rows = execQuery(result.sql, result.params);

      // Should have 2 groups: 'High' and 'Low'
      expect(rows.length).toBe(2);
      const high = rows.find(r => r['AmountLevel'] === 'High');
      const low = rows.find(r => r['AmountLevel'] === 'Low');
      expect(high).toBeTruthy();
      expect(low).toBeTruthy();
      // High: Amount > 200 → ORD-002(275), ORD-004(500), ORD-007(820), ORD-008(310) = 4
      expect(high!['Count']).toBe(4);
      // Low: Amount <= 200 → ORD-001(150), ORD-003(99.5), ORD-005(0), ORD-006(null→0) = 4
      expect(low!['Count']).toBe(4);
    });

    it('should use calc expression as inner ref for aggregate', () => {
      const calcColMap = colMapWithCalc('DoubledAmount', 0);
      const calcExprs = buildCalcExprsMap(doubledAmountCalc());
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
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = buildGroupedQuery(spec, calcColMap, sourceCatalog, calcExprs);
      const rows = execQuery(result.sql, result.params);

      const acme = rows.find(r => r['Company'] === 'Acme Corp');
      expect(acme).toBeTruthy();
      // Acme amounts: 150 + 99.5 + 310 = 559.5, doubled = 1119
      expect(acme!['SumDoubled']).toBeCloseTo(1119, 0);
    });
  });

  // ── buildSubtotalsQuery ───────────────────────────────────────────────────

  describe('buildSubtotalsQuery()', () => {
    it('should include calc expression in detail branch SELECT', () => {
      const calcColMap = colMapWithCalc('DoubledAmount', 0);
      const calcExprs = buildCalcExprsMap(doubledAmountCalc());
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Region', 'Amount', 'DoubledAmount'],
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
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: doubledAmountCalc(),
          detailBands: [],
        },
      });

      const result = buildSubtotalsQuery(spec, calcColMap, sourceCatalog, calcExprs);
      expect(result).not.toBeNull();

      const rows = execQuery(result!.sql, result!.params);
      expect(rows.length).toBeGreaterThan(8); // detail rows + subtotal rows + grand total

      // Check that detail rows have correct DoubledAmount
      const detailRows = rows.filter(r => r['_row_type'] === 0);
      expect(detailRows.length).toBe(8);
      const ord001 = detailRows.find(r => r['OrderId'] === 'ORD-001');
      expect(ord001!['DoubledAmount']).toBeCloseTo(300, 1);

      // Check grand total row has correct SUM of DoubledAmount
      const grandTotal = rows.find(r => r['_row_type'] === 3);
      expect(grandTotal).toBeTruthy();
      expect(grandTotal!['DoubledAmount']).toBeCloseTo(4309, 0);
    });
  });
});
