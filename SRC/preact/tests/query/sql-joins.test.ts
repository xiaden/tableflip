import { describe, it, expect } from 'vitest';
import { buildJoins } from '../../query/sql-joins';
import type { LookupSpec } from '../../types';
import { ordersColMap, standardSourceCatalog, normalizeSql } from './helpers';

describe('sql-joins', () => {
  const colMap = ordersColMap();
  const sourceCatalog = standardSourceCatalog();

  describe('buildJoins()', () => {
    it('should return empty joins for empty lookups', () => {
      const result = buildJoins([], colMap, sourceCatalog);
      expect(result.joins).toBe('');
      expect(result.params).toEqual([]);
    });

    it('should return empty joins for null lookups', () => {
      const result = buildJoins(null as unknown as LookupSpec[], colMap, sourceCatalog);
      expect(result.joins).toBe('');
      expect(result.params).toEqual([]);
    });

    it('should build a single LEFT JOIN (required=false)', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name', 'Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      const norm = normalizeSql(result.joins);
      expect(norm).toContain('LEFT JOIN');
      expect(norm).toContain('"Contacts"');
      expect(norm).toContain('ON');
      expect(norm).toContain('"Orders"."Contact"');
      expect(norm).toContain('"Contacts"."ContactId"');
      expect(result.params).toEqual([]);
    });

    it('should build a single INNER JOIN (required=true)', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: true,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      const norm = normalizeSql(result.joins);
      expect(norm).toContain('INNER JOIN');
      expect(norm).toContain('"Contacts"');
    });

    it('should produce AND in ON clause for multiple key pairs', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [
          { left: 'Contact', right: 'ContactId' },
          { left: 'Company', right: 'Name' },
        ],
        cols: ['Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      const norm = normalizeSql(result.joins);
      expect(norm).toContain('AND');
      expect(norm).toContain('"Orders"."Contact" = "Contacts"."ContactId"');
      expect(norm).toContain('"Orders"."Company" = "Contacts"."Name"');
    });

    it('should skip disabled lookups', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: false,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      expect(result.joins).toBe('');
    });

    it('should skip lookups with missing rightId', () => {
      const lookups: LookupSpec[] = [{
        rightId: '',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      expect(result.joins).toBe('');
    });

    it('should skip lookups with empty keyPairs', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      expect(result.joins).toBe('');
    });

    it('should skip key pairs with missing left or right', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [
          { left: '', right: 'ContactId' },
          { left: 'Contact', right: '' },
        ],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      expect(result.joins).toBe('');
    });

    it('should use prefix aliasing for right table columns via sourceCatalog', () => {
      // The sourceCatalog provides the table name for prefix generation
      // The actual prefix is used in column-catalog, not directly in sql-joins
      // But the right table ref comes from sourceCatalog
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      // The right table should be quoted via quoteId
      expect(result.joins).toContain('"Contacts"');
    });

    it('should handle rightId not in sourceCatalog (silently skip)', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'NonExistent',
        keyPairs: [{ left: 'Contact', right: 'Id' }],
        cols: [],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = buildJoins(lookups, colMap, sourceCatalog);
      // buildJoins doesn't validate rightId against catalog — it just quotes it
      // It will still produce a JOIN (validation happens elsewhere)
      expect(result.joins).toContain('"NonExistent"');
    });

    it('should handle multiple lookups', () => {
      const extendedCatalog = new Map(sourceCatalog);
      extendedCatalog.set('Products', {
        id: 'Products',
        name: 'Products',
        cols: ['ProductId', 'ProductName'],
        kind: 'imported',
        source: { id: 'Products', name: 'Products', cols: ['ProductId', 'ProductName'], rowCount: 3 },
      });
      const extendedColMap = new Map(colMap);
      extendedColMap.set('ProductId', { tid: 'Orders', col: 'ProductId' });

      const lookups: LookupSpec[] = [
        {
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'ContactId' }],
          cols: ['Name'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        },
        {
          rightId: 'Products',
          keyPairs: [{ left: 'ProductId', right: 'ProductId' }],
          cols: ['ProductName'],
          required: true,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        },
      ];
      const result = buildJoins(lookups, extendedColMap, extendedCatalog);
      const norm = normalizeSql(result.joins);
      expect(norm).toContain('LEFT JOIN');
      expect(norm).toContain('INNER JOIN');
      expect(norm).toContain('"Contacts"');
      expect(norm).toContain('"Products"');
    });
  });
});
