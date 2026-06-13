import { describe, it, expect } from 'vitest';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import type { DbTable } from '../../types';

describe('Source Catalog', () => {
  describe('buildSourceCatalog()', () => {
    it('should return empty Map for empty tables', () => {
      const catalog = buildSourceCatalog({});
      expect(catalog.size).toBe(0);
    });

    it('should build catalog from a single table', () => {
      const table: DbTable = {
        id: 'Orders',
        name: 'Orders',
        cols: ['OrderId', 'Company', 'Amount'],
        rowCount: 8,
      };
      const catalog = buildSourceCatalog({ Orders: table });
      expect(catalog.size).toBe(1);

      const entry = catalog.get('Orders')!;
      expect(entry.id).toBe('Orders');
      expect(entry.name).toBe('Orders');
      expect(entry.cols).toEqual(['OrderId', 'Company', 'Amount']);
      expect(entry.kind).toBe('imported');
      expect(entry.source).toBe(table);
    });

    it('should build catalog from multiple tables', () => {
      const orders: DbTable = {
        id: 'Orders',
        name: 'Orders',
        cols: ['OrderId', 'Company'],
        rowCount: 8,
      };
      const contacts: DbTable = {
        id: 'Contacts',
        name: 'Contacts',
        cols: ['ContactId', 'Name', 'Email'],
        rowCount: 5,
      };
      const catalog = buildSourceCatalog({ Orders: orders, Contacts: contacts });
      expect(catalog.size).toBe(2);
      expect(catalog.has('Orders')).toBe(true);
      expect(catalog.has('Contacts')).toBe(true);
      expect(catalog.get('Orders')!.cols).toEqual(['OrderId', 'Company']);
      expect(catalog.get('Contacts')!.cols).toEqual(['ContactId', 'Name', 'Email']);
    });

    it('should default name to tid if name is empty', () => {
      const table: DbTable = {
        id: 'T1',
        name: '',
        cols: ['A'],
        rowCount: 0,
      };
      const catalog = buildSourceCatalog({ T1: table });
      expect(catalog.get('T1')!.name).toBe('T1');
    });

    it('should default cols to empty array if cols is missing', () => {
      const table = { id: 'T2', name: 'T2', rowCount: 0 } as unknown as DbTable;
      const catalog = buildSourceCatalog({ T2: table });
      expect(catalog.get('T2')!.cols).toEqual([]);
    });
  });
});
