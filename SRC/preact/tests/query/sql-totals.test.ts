import { describe, it, expect } from 'vitest';
import { buildTotalsQuery } from '../../query/sql-totals';
import { ordersColMap, standardSourceCatalog, makeReportSpec, normalizeSql } from './helpers';

describe('sql-totals', () => {
  const colMap = ordersColMap();
  const sourceCatalog = standardSourceCatalog();

  describe('buildTotalsQuery()', () => {
    it('should return null when no columns have totals configured', () => {
      const spec = makeReportSpec({
        aggregation: {
          mode: 'totals',
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
      const result = buildTotalsQuery(spec, colMap, sourceCatalog);
      expect(result).toBeNull();
    });

    it('should return null when all totals are skip', () => {
      const spec = makeReportSpec({
        aggregation: {
          mode: 'totals',
          groupBy: [],
          aggregates: [],
          colTotals: { OrderId: 'skip', Company: 'skip', Amount: 'skip' },
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildTotalsQuery(spec, colMap, sourceCatalog);
      expect(result).toBeNull();
    });

    it('should generate totals query with SUM', () => {
      const spec = makeReportSpec({
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
      const result = buildTotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('SUM');
      expect(norm).toContain('FROM "Orders"');
    });

    it('should generate totals query with AVG', () => {
      const spec = makeReportSpec({
        aggregation: {
          mode: 'totals',
          groupBy: [],
          aggregates: [],
          colTotals: { Amount: 'AVG' },
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = buildTotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      expect(normalizeSql(result!.sql)).toContain('AVG');
    });

    it('should set columns without totals to NULL', () => {
      const spec = makeReportSpec({
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
      const result = buildTotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('NULL AS "OrderId"');
      expect(norm).toContain('SUM');
    });

    it('should throw if no base table', () => {
      const spec = makeReportSpec({
        pipeline: { base: '', baseCols: [], stacks: [], lookups: [], calculatedColumns: [] },
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
      expect(() => buildTotalsQuery(spec, colMap, sourceCatalog)).toThrow('No base table');
    });

    it('should include WHERE clause when filters are present', () => {
      const spec = makeReportSpec({
        filters: [{ col: 'Status', op: '=', val: 'Open', vals: ['Open'] }],
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
      const result = buildTotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('WHERE');
      expect(result!.params).toEqual(['Open']);
    });

    it('should include JOIN clause when lookups are present', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [{
            rightId: 'Contacts',
            keyPairs: [{ left: 'Contact', right: 'ContactId' }],
            cols: ['Name'],
            required: false,
            enabled: true,
            duplicatePolicy: { mode: 'block' },
          }],
          calculatedColumns: [],
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
      const result = buildTotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      const norm = normalizeSql(result!.sql);
      expect(norm).toContain('JOIN');
    });

    it('should return correct cols array', () => {
      const spec = makeReportSpec({
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
      const result = buildTotalsQuery(spec, colMap, sourceCatalog);
      expect(result).not.toBeNull();
      expect(result!.cols).toEqual(['OrderId', 'Amount']);
    });
  });
});
