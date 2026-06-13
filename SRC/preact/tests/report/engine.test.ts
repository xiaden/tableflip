import { describe, it, expect } from 'vitest';
import { runReport } from '../../report/engine';
import type { ReportSpec, DbTable } from '../../types';
import { makeReportSpec } from '../query/helpers';

describe('engine', () => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  const ordersCols = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];

  function ordersTables(): Record<string, DbTable> {
    return {
      Orders: { id: 'Orders', name: 'Orders', cols: ordersCols, rowCount: 8 },
    };
  }

  function spec(overrides: Partial<ReportSpec> = {}): ReportSpec {
    return makeReportSpec(overrides);
  }

  // ── runReport ────────────────────────────────────────────────────────────

  describe('runReport()', () => {
    it('should run detail mode and return columns and rows', () => {
      const result = runReport(spec(), ordersTables());
      expect(result.columns.length).toBeGreaterThan(0);
      expect(result.rows.length).toBe(8);
      expect(result.metadata.aggMode).toBe('none');
      expect(result.metadata.rowCount).toBe(8);
    });

    it('should filter by Company=Acme Corp and return 3 rows', () => {
      const s = spec({
        filters: [
          { col: 'Company', op: '=', val: 'Acme Corp', vals: ['Acme Corp'], enabled: true },
        ],
      });
      const result = runReport(s, ordersTables());
      expect(result.rows.length).toBe(3);
      for (const row of result.rows) {
        expect(row['Company']).toBe('Acme Corp');
      }
    });

    it('should sort by Amount DESC and return correct order', () => {
      const s = spec({
        outputColumns: ['OrderId', 'Amount'],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      const result = runReport(s, ordersTables());
      expect(result.rows.length).toBe(8);

      // Check descending order (nulls go to end in SQLite DESC)
      const amounts = result.rows.map(r => r['Amount'] as number | null);
      for (let i = 0; i < amounts.length - 2; i++) {
        // Non-null values should be in descending order
        if (amounts[i] !== null && amounts[i + 1] !== null) {
          expect(amounts[i]! as number).toBeGreaterThanOrEqual(amounts[i + 1]! as number);
        }
      }
      // First value should be the max (820)
      expect(amounts[0]).toBe(820);
    });

    it('should group by Company with COUNT and return grouped results', () => {
      const s = spec({
        aggregation: {
          mode: 'group',
          groupBy: ['Company'],
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
      });
      const result = runReport(s, ordersTables());
      expect(result.metadata.aggMode).toBe('group');
      expect(result.rows.length).toBe(5); // 5 unique companies
      // Each row should have Company and Count columns
      for (const row of result.rows) {
        expect(row).toHaveProperty('Company');
        expect(row).toHaveProperty('Count');
        expect(typeof row['Count']).toBe('number');
      }
      // Acme Corp should have count 3
      const acme = result.rows.find(r => r['Company'] === 'Acme Corp');
      expect(acme).toBeTruthy();
      expect(acme!['Count']).toBe(3);
    });

    it('should run totals mode and return totalsRow in metadata', () => {
      const s = spec({
        outputColumns: ['OrderId', 'Amount'],
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
      const result = runReport(s, ordersTables());
      expect(result.metadata.aggMode).toBe('totals');
      expect(result.metadata.totalsRow).toBeTruthy();
      // SUM of non-null amounts: 150 + 275 + 99.5 + 500 + 0 + 820 + 310 = 2154.5
      expect(result.metadata.totalsRow!['Amount']).toBeCloseTo(2154.5, 1);
    });

    it('should throw if no base table', () => {
      const s = spec({
        pipeline: { base: '', baseCols: null, stacks: [], lookups: [], calculatedColumns: [], detailBands: [] },
      });
      expect(() => runReport(s, ordersTables())).toThrow();
    });
  });
});
