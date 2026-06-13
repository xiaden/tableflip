import { describe, it, expect } from 'vitest';
import { buildSubtotalsQuery } from '../../query/sql-subtotals';
import { ordersColMap, standardSourceCatalog, makeReportSpec, normalizeSql } from './helpers';

describe('sql-subtotals', () => {
  const colMap = ordersColMap();
  const sourceCatalog = standardSourceCatalog();

  describe('buildSubtotalsQuery()', () => {
    it('should return null when no subtotalBy columns', () => {
      const spec = makeReportSpec({
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).toBeNull();
    });

    it('should return null when toShow is empty', () => {
      const emptyColMap = new Map();
      const spec = makeReportSpec({
        outputColumns: ['NonExistent'],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company'],
          subtotalFns: { Company: 'skip' },
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildSubtotalsQuery(spec, emptyColMap, sourceCatalog);
      expect(result).toBeNull();
    });

    it('should generate subtotals with nested strategy', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Region', 'Amount'],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company', 'Region'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: false,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'nested',
        },
      });
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('UNION ALL');
      // Nested produces multiple subtotal branches
      expect(norm).toContain('GROUP BY');
    });

    it('should generate subtotals with combined strategy', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Region', 'Amount'],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company', 'Region'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: false,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('UNION ALL');
      expect(norm).toContain('GROUP BY');
    });

    it('should include spacer rows when configured', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Region', 'Amount'],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: false,
          subtotalSpacer: true,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      // Spacer rows have _row_type = 2
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('2 AS "_row_type"');
    });

    it('should include grand total when configured', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Region', 'Amount'],
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
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      // Grand total has _row_type = 3
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('3 AS "_row_type"');
    });

    it('should handle subtotalOnTop affecting sort order', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Region', 'Amount'],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: false,
          subtotalSpacer: false,
          subtotalOnTop: true,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('ORDER BY');
    });

    it('should throw if no base table', () => {
      const spec = makeReportSpec({
        pipeline: { base: '', baseCols: null, stacks: [], lookups: [], calculatedColumns: [] },
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
      expect(() => buildSubtotalsQuery(spec, colMap, sourceCatalog)).toThrow('No base table');
    });

    it('should return correct cols array', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Region', 'Amount'],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: false,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      expect(result!.cols).toEqual(['Company', 'Region', 'Amount']);
    });

    it('should include WHERE clause when filters are present', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Amount'],
        filters: [{ col: 'Status', op: '=', val: 'Open', vals: ['Open'] }],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: false,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('WHERE');
    });

    it('should not include grand total if all subtotal fns are skip', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Amount'],
        aggregation: {
          mode: 'subtotals',
          groupBy: [],
          aggregates: [],
          colTotals: {},
          subtotalBy: ['Company'],
          subtotalFns: { Amount: 'skip', Company: 'skip' },
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildSubtotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      // Grand total should not be included since all non-subtotalBy fns are skip
      const norm = normalizeSql(result!.sql);
      expect(norm).not.toContain('3 AS "_row_type"');
    });
  });
});
