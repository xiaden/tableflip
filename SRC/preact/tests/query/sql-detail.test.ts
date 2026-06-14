import { describe, it, expect } from 'vitest';
import { buildDetailQuery } from '../../query/sql-detail';
import { ordersColMap, standardSourceCatalog, makeReportSpec, normalizeSql } from './helpers';

describe('sql-detail', () => {
  const colMap = ordersColMap();
  const sourceCatalog = standardSourceCatalog();

  describe('buildDetailQuery()', () => {
    it('should build a basic detail query with base table', () => {
      const spec = makeReportSpec();
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      expect(result.sql).toBeTruthy();
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('SELECT');
      expect(norm).toContain('FROM "Orders"');
      expect(result.cols.length).toBeGreaterThan(0);
      expect(result.params).toEqual([]);
    });

    it('should include all colMap columns in SELECT', () => {
      const spec = makeReportSpec();
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      for (const alias of colMap.keys()) {
        expect(result.cols).toContain(alias);
        expect(result.sql).toContain(`"${alias}"`);
      }
    });

    it('should add WHERE clause when filters are present', () => {
      const spec = makeReportSpec({
        filters: [{ col: 'Status', op: '=', val: 'Open', vals: ['Open'] }],
      });
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('WHERE');
      expect(result.params).toEqual(['Open']);
    });

    it('should add ORDER BY clause when sorts are present', () => {
      const spec = makeReportSpec({
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('ORDER BY');
      expect(norm).toContain('DESC');
    });

    it('should use ASC as default sort direction', () => {
      const spec = makeReportSpec({
        sorts: [{ col: 'Company', dir: 'ASC', enabled: true }],
      });
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('ORDER BY');
      expect(norm).toContain('ASC');
    });

    it('should add JOIN clause when lookups are present', () => {
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
      });
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('JOIN');
      expect(norm).toContain('"Contacts"');
    });

    it('should filter SELECT to outputColumns when set', () => {
      const spec = makeReportSpec({
        outputColumns: ['OrderId', 'Company'],
      });
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      expect(result.cols).toEqual(['OrderId', 'Company']);
      // Should NOT contain other columns
      expect(result.sql).not.toContain('"Amount" AS');
    });

    it('should throw if no base table', () => {
      const spec = makeReportSpec({
        pipeline: { base: '', baseCols: [], stacks: [], lookups: [], calculatedColumns: [] },
      });
      expect(() => buildDetailQuery(spec, colMap, sourceCatalog)).toThrow('No base table');
    });

    it('should use * when no projected columns match', () => {
      const emptyColMap = new Map();
      const spec = makeReportSpec({
        outputColumns: ['NonExistent'],
      });
      const result = buildDetailQuery(spec, emptyColMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      expect(norm).toContain('SELECT *');
    });

    it('should combine JOIN and WHERE params correctly', () => {
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
        filters: [{ col: 'Status', op: '=', val: 'Open', vals: ['Open'] }],
      });
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      // JOIN params come first (currently empty), then WHERE params
      expect(result.params).toEqual(['Open']);
    });

    it('should skip disabled sorts', () => {
      const spec = makeReportSpec({
        sorts: [
          { col: 'Amount', dir: 'DESC', enabled: false },
          { col: 'Company', dir: 'ASC', enabled: true },
        ],
      });
      const result = buildDetailQuery(spec, colMap, sourceCatalog);
      const norm = normalizeSql(result.sql);
      // Should contain Company sort but not Amount sort
      expect(norm).toContain('"Orders"."Company" ASC');
      expect(norm).not.toContain('DESC');
    });
  });
});
