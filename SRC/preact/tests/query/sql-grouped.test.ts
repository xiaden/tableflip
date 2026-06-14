import { describe, it, expect } from 'vitest';
import { buildGroupedQuery } from '../../query/sql-grouped';
import { ordersColMap, standardSourceCatalog, makeReportSpec, normalizeSql } from './helpers';

describe('sql-grouped', () => {
  const colMap = ordersColMap();
  const sourceCatalog = standardSourceCatalog();

  describe('buildGroupedQuery()', () => {
    it('should build grouped query with groupBy + aggregates', () => {
      const spec = makeReportSpec({
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
      const result = buildGroupedQuery(spec, colMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('SELECT');
      expect(norm).toContain('FROM "Orders"');
      expect(norm).toContain('GROUP BY');
      expect(norm).toContain('SUM');
      expect(result.cols).toContain('Company');
      expect(result.cols).toContain('Total');
    });

    it('should include filters and sorts', () => {
      const spec = makeReportSpec({
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
        filters: [{ col: 'Status', op: '=', val: 'Open', vals: ['Open'] }],
        sorts: [{ col: 'Company', dir: 'ASC', enabled: true }],
      });
      const result = buildGroupedQuery(spec, colMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('WHERE');
      expect(norm).toContain('ORDER BY');
      expect(result.params).toContain('Open');
    });

    it('should project all columns when no aggregation is configured', () => {
      const spec = makeReportSpec({
        aggregation: {
          mode: 'group',
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
      const result = buildGroupedQuery(spec, colMap, sourceCatalog);
      // Without aggregation, all colMap columns are projected
      expect(result.cols.length).toBe(colMap.size);
      const norm = normalizeSql(result.sql);
      expect(norm).not.toContain('GROUP BY');
    });

    it('should throw if no base table', () => {
      const spec = makeReportSpec({
        pipeline: { base: '', baseCols: [], stacks: [], lookups: [], calculatedColumns: [] },
      });
      expect(() => buildGroupedQuery(spec, colMap, sourceCatalog)).toThrow('No base table');
    });

    it('should handle multiple groupBy columns', () => {
      const spec = makeReportSpec({
        aggregation: {
          mode: 'group',
          groupBy: ['Company', 'Region'],
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
      const result = buildGroupedQuery(spec, colMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('GROUP BY');
      expect(norm).toContain('"Orders"."Company"');
      expect(norm).toContain('"Orders"."Region"');
      expect(result.cols).toContain('Company');
      expect(result.cols).toContain('Region');
      expect(result.cols).toContain('Total');
    });

    it('should handle multiple aggregates', () => {
      const spec = makeReportSpec({
        aggregation: {
          mode: 'group',
          groupBy: ['Company'],
          aggregates: [
            { col: 'Amount', fn: 'SUM', alias: 'Total', enabled: true },
            { col: 'Amount', fn: 'AVG', alias: 'Average', enabled: true },
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
      const result = buildGroupedQuery(spec, colMap, sourceCatalog);
      expect(result.cols).toContain('Total');
      expect(result.cols).toContain('Average');
      expect(result.cols).toContain('Count');
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('SUM');
      expect(norm).toContain('AVG');
      expect(norm).toContain('COUNT(*)');
    });

    it('should filter by outputColumns', () => {
      const spec = makeReportSpec({
        outputColumns: ['Company', 'Total'],
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
      const result = buildGroupedQuery(spec, colMap, sourceCatalog);
      expect(result.cols).toEqual(['Company', 'Total']);
    });

    it('should use * when selParts is empty', () => {
      const emptyColMap = new Map();
      const spec = makeReportSpec({
        outputColumns: ['NonExistent'],
        aggregation: {
          mode: 'group',
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
      const result = buildGroupedQuery(spec, emptyColMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('SELECT *');
    });
  });
});
