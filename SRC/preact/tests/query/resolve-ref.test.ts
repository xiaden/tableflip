import { describe, it, expect } from 'vitest';
import { resolveRef } from '../../query/resolve-ref';
import type { ColMapEntry } from '../../catalog/column-catalog';

describe('resolve-ref', () => {
  describe('resolveRef()', () => {
    it('should resolve physical column to "tid"."col" format', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['OrderId', { tid: 'Orders', col: 'OrderId' }],
      ]);
      expect(resolveRef('OrderId', colMap)).toBe('"Orders"."OrderId"');
    });

    it('should resolve physical column with different table and column names', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['ContactName', { tid: 'Contacts', col: 'Name' }],
      ]);
      expect(resolveRef('ContactName', colMap)).toBe('"Contacts"."Name"');
    });

    it('should resolve calc column to quoted alias', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['TotalAmount', { kind: 'calc', idx: 0 }],
      ]);
      expect(resolveRef('TotalAmount', colMap)).toBe('"TotalAmount"');
    });

    it('should resolve calc column with idx and alias properties', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['MyCalc', { kind: 'calc', idx: 2, alias: 'MyCalc' }],
      ]);
      expect(resolveRef('MyCalc', colMap)).toBe('"MyCalc"');
    });

    it('should fall back to quoted alias when alias is missing from colMap', () => {
      const colMap = new Map<string, ColMapEntry>();
      expect(resolveRef('UnknownCol', colMap)).toBe('"UnknownCol"');
    });

    it('should resolve multiple physical columns from different tables', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['OrderId', { tid: 'Orders', col: 'OrderId' }],
        ['ContactName', { tid: 'Contacts', col: 'Name' }],
        ['ProductName', { tid: 'Products', col: 'Name' }],
      ]);
      expect(resolveRef('OrderId', colMap)).toBe('"Orders"."OrderId"');
      expect(resolveRef('ContactName', colMap)).toBe('"Contacts"."Name"');
      expect(resolveRef('ProductName', colMap)).toBe('"Products"."Name"');
    });

    it('should handle column names with special characters via quoting', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['Weird Col', { tid: 'My Table', col: 'Weird Col' }],
      ]);
      expect(resolveRef('Weird Col', colMap)).toBe('"My Table"."Weird Col"');
    });

    it('should escape double quotes in column/table names', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['Col"Name', { tid: 'Table"1', col: 'Col"Name' }],
      ]);
      // quoteId escapes " to ""
      expect(resolveRef('Col"Name', colMap)).toBe('"Table""1"."Col""Name"');
    });

    it('should resolve mixed physical and calc columns correctly', () => {
      const colMap = new Map<string, ColMapEntry>([
        ['Amount', { tid: 'Orders', col: 'Amount' }],
        ['Tax', { kind: 'calc', idx: 0 }],
        ['Total', { kind: 'calc', idx: 1 }],
      ]);
      expect(resolveRef('Amount', colMap)).toBe('"Orders"."Amount"');
      expect(resolveRef('Tax', colMap)).toBe('"Tax"');
      expect(resolveRef('Total', colMap)).toBe('"Total"');
    });
  });
});
