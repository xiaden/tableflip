import { describe, it, expect } from 'vitest';
import { buildWhere } from '../../query/sql-where';
import type { FilterSpec } from '../../types';
import type { ColMapEntry } from '../../catalog/column-catalog';
import { ordersColMap } from './helpers';

describe('sql-where', () => {
  const colMap = ordersColMap();

  describe('buildWhere()', () => {
    it('should return empty where for empty filters', () => {
      const result = buildWhere([], colMap);
      expect(result.where).toBe('');
      expect(result.params).toEqual([]);
    });

    it('should return empty where for null/undefined filters', () => {
      const result = buildWhere(null as unknown as FilterSpec[], colMap);
      expect(result.where).toBe('');
      expect(result.params).toEqual([]);
    });

    it('should handle single filter with = operator', () => {
      const filters: FilterSpec[] = [
        { col: 'OrderId', op: '=', val: 'ORD-001', vals: ['ORD-001'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('=');
      expect(result.where).toContain('"Orders"."OrderId"');
      expect(result.params).toEqual(['ORD-001']);
    });

    it('should handle contains operator', () => {
      const filters: FilterSpec[] = [
        { col: 'Company', op: 'contains', val: 'Acme', vals: ['Acme'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('LIKE');
      expect(result.params).toEqual(['%Acme%']);
    });

    it('should handle starts_with operator', () => {
      const filters: FilterSpec[] = [
        { col: 'Company', op: 'starts_with', val: 'A', vals: ['A'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('LIKE');
      expect(result.params).toEqual(['A%']);
    });

    it('should handle ends_with operator', () => {
      const filters: FilterSpec[] = [
        { col: 'Company', op: 'ends_with', val: 'Inc', vals: ['Inc'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('LIKE');
      expect(result.params).toEqual(['%Inc']);
    });

    it('should handle > operator (numeric)', () => {
      const filters: FilterSpec[] = [
        { col: 'Amount', op: '>', val: '100', vals: ['100'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('>');
      expect(result.where).toContain('CAST');
      expect(result.params).toEqual([100]);
    });

    it('should handle < operator (numeric)', () => {
      const filters: FilterSpec[] = [
        { col: 'Amount', op: '<', val: '50', vals: ['50'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('<');
      expect(result.params).toEqual([50]);
    });

    it('should handle >= operator', () => {
      const filters: FilterSpec[] = [
        { col: 'Amount', op: '>=', val: '100', vals: ['100'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('>=');
      expect(result.params).toEqual([100]);
    });

    it('should handle <= operator', () => {
      const filters: FilterSpec[] = [
        { col: 'Amount', op: '<=', val: '500', vals: ['500'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('<=');
      expect(result.params).toEqual([500]);
    });

    it('should handle in operator (comma-separated values)', () => {
      const filters: FilterSpec[] = [
        { col: 'Status', op: 'in', val: 'Open,Closed', vals: ['Open,Closed'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('IN');
      expect(result.params).toEqual(['Open', 'Closed']);
    });

    it('should handle not_in operator', () => {
      const filters: FilterSpec[] = [
        { col: 'Status', op: 'not_in', val: 'Cancelled', vals: ['Cancelled'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('NOT IN');
      expect(result.params).toEqual(['Cancelled']);
    });

    it('should handle is_null operator', () => {
      const filters: FilterSpec[] = [
        { col: 'Contact', op: 'is_null', val: '', vals: [''] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('IS NULL');
      expect(result.where).toContain("= ''");
      expect(result.params).toEqual([]);
    });

    it('should handle is_not_null operator', () => {
      const filters: FilterSpec[] = [
        { col: 'Contact', op: 'is_not_null', val: '', vals: [''] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('IS NOT NULL');
      expect(result.where).toContain("!= ''");
      expect(result.params).toEqual([]);
    });

    it('should handle operator "equals"', () => {
      const filters: FilterSpec[] = [
        { col: 'OrderId', op: 'equals', val: 'X', vals: ['X'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('=');
      expect(result.params).toEqual(['X']);
    });

    it('should handle operator "not equals"', () => {
      const filters: FilterSpec[] = [
        { col: 'OrderId', op: 'not equals', val: 'X', vals: ['X'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('!=');
      expect(result.params).toEqual(['X']);
    });

    it('should handle operator "starts with"', () => {
      const filters: FilterSpec[] = [
        { col: 'Company', op: 'starts with', val: 'A', vals: ['A'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('LIKE');
      expect(result.params).toEqual(['A%']);
    });

    it('should handle operator "ends with"', () => {
      const filters: FilterSpec[] = [
        { col: 'Company', op: 'ends with', val: 'c', vals: ['c'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('LIKE');
      expect(result.params).toEqual(['%c']);
    });

    it('should handle operator "is empty"', () => {
      const filters: FilterSpec[] = [
        { col: 'Contact', op: 'is empty', val: '', vals: [''] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('IS NULL');
      expect(result.params).toEqual([]);
    });

    it('should handle operator "not empty"', () => {
      const filters: FilterSpec[] = [
        { col: 'Contact', op: 'not empty', val: '', vals: [''] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('IS NOT NULL');
      expect(result.params).toEqual([]);
    });

    it('should AND multiple filters together', () => {
      const filters: FilterSpec[] = [
        { col: 'Status', op: '=', val: 'Open', vals: ['Open'] },
        { col: 'Region', op: '=', val: 'North', vals: ['North'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('AND');
      expect(result.params).toEqual(['Open', 'North']);
    });

    it('should OR multiple vals within a single filter', () => {
      const filters: FilterSpec[] = [
        { col: 'Status', op: '=', vals: ['Open', 'Closed'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('OR');
      expect(result.where).toContain('(');
      expect(result.params).toEqual(['Open', 'Closed']);
    });

    it('should skip disabled filters', () => {
      const filters: FilterSpec[] = [
        { col: 'Status', op: '=', val: 'Open', vals: ['Open'], enabled: false },
        { col: 'Region', op: '=', val: 'North', vals: ['North'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).not.toContain('Status');
      expect(result.where).toContain('Region');
      expect(result.params).toEqual(['North']);
    });

    it('should use REAL cast for calc columns with math mode', () => {
      const calcColMap = new Map<string, ColMapEntry>([
        ['Total', { kind: 'calc', idx: 0, mode: 'math' }],
        ['OrderId', { tid: 'Orders', col: 'OrderId' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Total', op: '=', val: '42', vals: ['42'] },
      ];
      const result = buildWhere(filters, calcColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('REAL');
      expect(result.params).toEqual([42]);
    });

    it('should handle IN with REAL cast for calc math columns', () => {
      const calcColMap = new Map<string, ColMapEntry>([
        ['Total', { kind: 'calc', idx: 0, mode: 'math' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Total', op: 'in', val: '1,2,3', vals: ['1,2,3'] },
      ];
      const result = buildWhere(filters, calcColMap);
      expect(result.where).toContain('IN');
      expect(result.where).toContain('REAL');
      expect(result.params).toEqual([1, 2, 3]);
    });

    // ── Numeric column type tests ──────────────────────────────────────────────

    it('should use REAL cast for equals on number column', () => {
      const numColMap = new Map<string, ColMapEntry>([
        ['Amount', { tid: 'Orders', col: 'Amount', colType: 'number' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Amount', op: '=', val: '42', vals: ['42'] },
      ];
      const result = buildWhere(filters, numColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('REAL');
      expect(result.params).toEqual([42]);
    });

    it('should use REAL cast for not-equals on number column', () => {
      const numColMap = new Map<string, ColMapEntry>([
        ['Amount', { tid: 'Orders', col: 'Amount', colType: 'number' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Amount', op: '!=', val: '99', vals: ['99'] },
      ];
      const result = buildWhere(filters, numColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('REAL');
      expect(result.where).toContain('!=');
      expect(result.params).toEqual([99]);
    });

    it('should use REAL cast for greater-than on number column', () => {
      const numColMap = new Map<string, ColMapEntry>([
        ['Amount', { tid: 'Orders', col: 'Amount', colType: 'number' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Amount', op: '>', val: '100', vals: ['100'] },
      ];
      const result = buildWhere(filters, numColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('REAL');
      expect(result.where).toContain('>');
      expect(result.params).toEqual([100]);
    });

    it('should use REAL cast for IN on number column', () => {
      const numColMap = new Map<string, ColMapEntry>([
        ['Amount', { tid: 'Orders', col: 'Amount', colType: 'number' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Amount', op: 'in', val: '1,2,3', vals: ['1,2,3'] },
      ];
      const result = buildWhere(filters, numColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('REAL');
      expect(result.where).toContain('IN');
      expect(result.params).toEqual([1, 2, 3]);
    });

    it('should use REAL cast for NOT IN on number column', () => {
      const numColMap = new Map<string, ColMapEntry>([
        ['Amount', { tid: 'Orders', col: 'Amount', colType: 'number' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Amount', op: 'not_in', val: '10,20', vals: ['10,20'] },
      ];
      const result = buildWhere(filters, numColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('REAL');
      expect(result.where).toContain('NOT IN');
      expect(result.params).toEqual([10, 20]);
    });

    it('should use raw ref for IN on number column with mixed non-numeric values', () => {
      const numColMap = new Map<string, ColMapEntry>([
        ['Amount', { tid: 'Orders', col: 'Amount', colType: 'number' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Amount', op: 'in', val: '1,abc,3', vals: ['1,abc,3'] },
      ];
      const result = buildWhere(filters, numColMap);
      expect(result.where).not.toContain('CAST');
      expect(result.where).toContain('IN');
      expect(result.params).toEqual(['1', 'abc', '3']);
    });

    it('should use raw ref for NOT IN on number column with mixed non-numeric values', () => {
      const numColMap = new Map<string, ColMapEntry>([
        ['Amount', { tid: 'Orders', col: 'Amount', colType: 'number' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'Amount', op: 'not_in', val: '10,xyz', vals: ['10,xyz'] },
      ];
      const result = buildWhere(filters, numColMap);
      expect(result.where).not.toContain('CAST');
      expect(result.where).toContain('NOT IN');
      expect(result.params).toEqual(['10', 'xyz']);
    });

    // ── String and date column type tests ──────────────────────────────────────

    it('should use TEXT cast for equals on string column', () => {
      const strColMap = new Map<string, ColMapEntry>([
        ['Company', { tid: 'Orders', col: 'Company' }], // no colType → defaults to 'string'
      ]);
      const filters: FilterSpec[] = [
        { col: 'Company', op: '=', val: 'Acme', vals: ['Acme'] },
      ];
      const result = buildWhere(filters, strColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.params).toEqual(['Acme']);
    });

    it('should use TEXT cast for greater-than on string column (bug fix)', () => {
      const strColMap = new Map<string, ColMapEntry>([
        ['ZipCode', { tid: 'Orders', col: 'ZipCode' }], // no colType → defaults to 'string'
      ]);
      const filters: FilterSpec[] = [
        { col: 'ZipCode', op: '>', val: '02134', vals: ['02134'] },
      ];
      const result = buildWhere(filters, strColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.where).not.toContain('REAL');
      expect(result.params).toEqual(['02134']);
    });

    it('should use raw ref for IN on string column', () => {
      const strColMap = new Map<string, ColMapEntry>([
        ['Status', { tid: 'Orders', col: 'Status' }], // no colType → defaults to 'string'
      ]);
      const filters: FilterSpec[] = [
        { col: 'Status', op: 'in', val: 'Open,Closed', vals: ['Open,Closed'] },
      ];
      const result = buildWhere(filters, strColMap);
      expect(result.where).not.toContain('CAST');
      expect(result.where).toContain('IN');
      expect(result.params).toEqual(['Open', 'Closed']);
    });

    it('should use TEXT cast for equals on date column', () => {
      const dateColMap = new Map<string, ColMapEntry>([
        ['OrderDate', { tid: 'Orders', col: 'OrderDate', colType: 'date' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'OrderDate', op: '=', val: '2024-01-15', vals: ['2024-01-15'] },
      ];
      const result = buildWhere(filters, dateColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.where).toContain('=');
      expect(result.params).toEqual(['2024-01-15']);
    });

    it('should use TEXT cast for greater-than on date column', () => {
      const dateColMap = new Map<string, ColMapEntry>([
        ['OrderDate', { tid: 'Orders', col: 'OrderDate', colType: 'date' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'OrderDate', op: '>', val: '2024-01-01', vals: ['2024-01-01'] },
      ];
      const result = buildWhere(filters, dateColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.where).toContain('>');
      expect(result.where).not.toContain('REAL');
      expect(result.params).toEqual(['2024-01-01']);
    });

    it('should use TEXT cast for IN on date column', () => {
      const dateColMap = new Map<string, ColMapEntry>([
        ['OrderDate', { tid: 'Orders', col: 'OrderDate', colType: 'date' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'OrderDate', op: 'in', val: '2024-01-01,2024-06-15', vals: ['2024-01-01,2024-06-15'] },
      ];
      const result = buildWhere(filters, dateColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.where).not.toContain('REAL');
      expect(result.where).toContain('IN');
      expect(result.params).toEqual(['2024-01-01', '2024-06-15']);
    });

    it('should use TEXT cast for NOT IN on date column', () => {
      const dateColMap = new Map<string, ColMapEntry>([
        ['OrderDate', { tid: 'Orders', col: 'OrderDate', colType: 'date' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'OrderDate', op: 'not_in', val: '2024-01-01,2024-12-31', vals: ['2024-01-01,2024-12-31'] },
      ];
      const result = buildWhere(filters, dateColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.where).not.toContain('REAL');
      expect(result.where).toContain('NOT IN');
      expect(result.params).toEqual(['2024-01-01', '2024-12-31']);
    });

    // ── Type derivation and edge case tests ────────────────────────────────────

    it('should derive date type from calc column with date mode', () => {
      const calcColMap = new Map<string, ColMapEntry>([
        ['OrderYear', { kind: 'calc', idx: 0, mode: 'date' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'OrderYear', op: '=', val: '2024', vals: ['2024'] },
      ];
      const result = buildWhere(filters, calcColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.params).toEqual(['2024']);
    });

    it('should derive string type from calc column with text mode', () => {
      const calcColMap = new Map<string, ColMapEntry>([
        ['FullName', { kind: 'calc', idx: 0, mode: 'text' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'FullName', op: '=', val: 'John Doe', vals: ['John Doe'] },
      ];
      const result = buildWhere(filters, calcColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.params).toEqual(['John Doe']);
    });

    it('should derive string type from calc column with compare mode', () => {
      const calcColMap = new Map<string, ColMapEntry>([
        ['StatusLabel', { kind: 'calc', idx: 0, mode: 'compare' }],
      ]);
      const filters: FilterSpec[] = [
        { col: 'StatusLabel', op: '=', val: 'Active', vals: ['Active'] },
      ];
      const result = buildWhere(filters, calcColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.params).toEqual(['Active']);
    });

    it('should use REAL cast for _rowno column', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['_rowno', { tid: 'Orders', col: '_rowno' }],
      ]);
      const filters: FilterSpec[] = [
        { col: '_rowno', op: '>', val: '10', vals: ['10'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('REAL');
      expect(result.params).toEqual([10]);
    });

    it('should default to TEXT for unknown alias not in colMap', () => {
      const emptyColMap = new Map<string, ColMapEntry>();
      const filters: FilterSpec[] = [
        { col: 'UnknownCol', op: '=', val: 'test', vals: ['test'] },
      ];
      const result = buildWhere(filters, emptyColMap);
      expect(result.where).toContain('CAST');
      expect(result.where).toContain('TEXT');
      expect(result.params).toEqual(['test']);
    });

    it('should return empty where if all filters are disabled', () => {
      const filters: FilterSpec[] = [
        { col: 'Status', op: '=', val: 'Open', vals: ['Open'], enabled: false },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toBe('');
      expect(result.params).toEqual([]);
    });

    it('should handle unknown operator by returning null (skipped)', () => {
      const filters: FilterSpec[] = [
        { col: 'Status', op: 'unknown_op', val: 'X', vals: ['X'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toBe('');
      expect(result.params).toEqual([]);
    });

    it('should handle filter with empty col by returning null', () => {
      const filters: FilterSpec[] = [
        { col: '', op: '=', val: 'X', vals: ['X'] },
      ];
      const result = buildWhere(filters, colMap);
      expect(result.where).toBe('');
      expect(result.params).toEqual([]);
    });
  });
});
