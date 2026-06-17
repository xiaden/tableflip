import { describe, it, expect } from 'vitest';
import { buildQueryPlan } from '../../query/query-plan';
import { makeReportSpec, standardTables } from './helpers';

describe('query-plan', () => {
  const tables = standardTables();

  describe('buildQueryPlan()', () => {
    it('should build a detail mode plan (aggMode=none)', () => {
      const spec = makeReportSpec();
      const plan = buildQueryPlan(spec, tables);
      expect(plan.aggMode).toBe('none');
      expect(plan.source.base).toBe('Orders');
      expect(plan.colMap).toBeInstanceOf(Map);
      expect(plan.colMap.size).toBeGreaterThan(0);
      expect(plan.selectedColumns.length).toBeGreaterThan(0);
      expect(plan.sourceCatalog).toBeInstanceOf(Map);
    });

    it('should build a group mode plan', () => {
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
      const plan = buildQueryPlan(spec, tables);
      expect(plan.aggMode).toBe('group');
      expect(plan.groupBy).toContain('Company');
      expect(plan.selectedColumns).toContain('Company');
      expect(plan.selectedColumns).toContain('Total');
      expect(plan.aggregates.length).toBe(1);
    });

    it('should build a totals mode plan', () => {
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
      const plan = buildQueryPlan(spec, tables);
      expect(plan.aggMode).toBe('totals');
      expect(plan.colTotals).toEqual({ Amount: 'SUM' });
    });

    it('should build a subtotals mode plan', () => {
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
      const plan = buildQueryPlan(spec, tables);
      expect(plan.aggMode).toBe('subtotals');
      expect(plan.subtotalBy).toEqual(['Company']);
      expect(plan.subtotalFns).toEqual({ Amount: 'SUM' });
    });

    it('should include source plan with base and stacks', () => {
      const spec = makeReportSpec();
      const plan = buildQueryPlan(spec, tables);
      expect(plan.source.base).toBe('Orders');
      expect(plan.source.stacks).toEqual([]);
      expect(plan.source.tablesById).toBeInstanceOf(Map);
      expect(plan.source.tablesById.has('Orders')).toBe(true);
    });

    it('should include join plans when lookups are present', () => {
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
          detailBands: [],
        },
      });
      const plan = buildQueryPlan(spec, tables);
      expect(plan.joins.length).toBe(1);
      expect(plan.joins[0].rightId).toBe('Contacts');
      expect(plan.joins[0].required).toBe(false);
    });

    it('should include calculated columns', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: [],
          lookups: [],
          calculatedColumns: [{
            alias: 'DoubleAmount',
            mode: 'math',
            math: {
              strategy: 'stepChain',
              steps: [
                { type: 'column', value: 'Amount' },
                { type: 'number', value: '2', op: '*' },
              ],
            },
            enabled: true,
          }],
          detailBands: [],
        },
      });
      const plan = buildQueryPlan(spec, tables);
      expect(plan.calculatedColumns.length).toBe(1);
      expect(plan.calculatedColumns[0].alias).toBe('DoubleAmount');
    });

    it('should include enabled filters', () => {
      const spec = makeReportSpec({
        filters: [
          { col: 'Status', op: '=', val: 'Open', vals: ['Open'] },
          { col: 'Region', op: '=', val: 'North', vals: ['North'], enabled: false },
        ],
      });
      const plan = buildQueryPlan(spec, tables);
      expect(plan.filters.length).toBe(1);
      expect(plan.filters[0].col).toBe('Status');
    });

    it('should include selectedColumns', () => {
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Company', 'Amount'],
      });
      const plan = buildQueryPlan(spec, tables);
      expect(plan.selectedColumns).toContain('OrderId');
      expect(plan.selectedColumns).toContain('Company');
      expect(plan.selectedColumns).toContain('Amount');
    });

    it('should include sorts', () => {
      const spec = makeReportSpec({
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      const plan = buildQueryPlan(spec, tables);
      expect(plan.sorts.length).toBe(1);
      expect(plan.sorts[0].col).toBe('Amount');
    });

    it('should include colTotals, subtotalBy, subtotalFns', () => {
      const spec = makeReportSpec({
        aggregation: {
          mode: 'totals',
          groupBy: [],
          aggregates: [],
          colTotals: { Amount: 'SUM' },
          subtotalBy: ['Company'],
          subtotalFns: { Amount: 'SUM' },
          subtotalGrandTotal: true,
          subtotalSpacer: true,
          subtotalOnTop: true,
          subtotalStrategy: 'nested',
        },
      });
      const plan = buildQueryPlan(spec, tables);
      expect(plan.colTotals).toEqual({ Amount: 'SUM' });
      expect(plan.subtotalBy).toEqual(['Company']);
      expect(plan.subtotalFns).toEqual({ Amount: 'SUM' });
      expect(plan.subtotalGrandTotal).toBe(true);
      expect(plan.subtotalSpacer).toBe(true);
      expect(plan.subtotalOnTop).toBe(true);
      expect(plan.subtotalStrategy).toBe('nested');
    });

    it('should throw if no base table', () => {
      const spec = makeReportSpec({
        pipeline: { base: '', baseCols: [], stacks: [], lookups: [], calculatedColumns: [], detailBands: [] },
      });
      expect(() => buildQueryPlan(spec, tables)).toThrow();
    });

    it('should filter stacks to known tables', () => {
      const spec = makeReportSpec({
        pipeline: {
          base: 'Orders',
          baseCols: [],
          stacks: ['NonExistent', 'Contacts'],
          lookups: [],
          calculatedColumns: [],
          detailBands: [],
        },
      });
      const plan = buildQueryPlan(spec, tables);
      expect(plan.source.stacks).toEqual(['Contacts']);
    });

    it('should include sourceCatalog', () => {
      const spec = makeReportSpec();
      const plan = buildQueryPlan(spec, tables);
      expect(plan.sourceCatalog).toBeInstanceOf(Map);
      expect(plan.sourceCatalog.has('Orders')).toBe(true);
    });
  });
});
