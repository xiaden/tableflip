import { describe, it, expect, afterEach } from 'vitest';
import {
  quoteId,
  createTable,
  insertRows,
  execQuery,
  dropTable,
  tableRowCount,
} from '../../js/core/sqldb.js';

function getSqlDb() { return (globalThis as any).sqlDb; }

const createdTables: string[] = [];

afterEach(() => {
  for (const t of createdTables) {
    try { dropTable(t); } catch (_) {}
  }
  createdTables.length = 0;
});

describe('sqldb', () => {
  describe('quoteId', () => {
    it('should wrap a simple name in double quotes', () => {
      expect(quoteId('foo')).toBe('"foo"');
    });

    it('should escape embedded double quotes by doubling them', () => {
      expect(quoteId('a"b')).toBe('"a""b"');
    });

    it('should handle names with spaces', () => {
      expect(quoteId('my column')).toBe('"my column"');
    });

    it('should handle unicode / CJK characters', () => {
      expect(quoteId('注文')).toBe('"注文"');
    });

    it('should handle empty string', () => {
      expect(quoteId('')).toBe('""');
    });

    it('should handle multiple double quotes', () => {
      expect(quoteId('a"b"c')).toBe('"a""b""c"');
    });

    it('should handle names with slashes', () => {
      expect(quoteId('path/to/col')).toBe('"path/to/col"');
    });
  });

  describe('createTable', () => {
    it('should create a table with the given columns', () => {
      createTable('TestCreate', ['id', 'name', 'value']);
      createdTables.push('TestCreate');

      const info = getSqlDb().exec('PRAGMA table_info("TestCreate")');
      expect(info).toBeTruthy();
      expect(info[0].values).toHaveLength(3);
      expect(info[0].values.map((r: any[]) => r[1])).toEqual(['id', 'name', 'value']);
    });

    it('should not throw if table already exists (IF NOT EXISTS)', () => {
      createTable('TestDup', ['a']);
      createdTables.push('TestDup');
      expect(() => createTable('TestDup', ['a'])).not.toThrow();
    });

    it('should handle column names with special characters', () => {
      createTable('TestSpecial', ['col with spaces', 'col"quote']);
      createdTables.push('TestSpecial');

      const info = getSqlDb().exec('PRAGMA table_info("TestSpecial")');
      expect(info[0].values).toHaveLength(2);
      expect(info[0].values[0][1]).toBe('col with spaces');
      expect(info[0].values[1][1]).toBe('col"quote');
    });
  });

  describe('insertRows', () => {
    it('should insert all rows correctly', () => {
      createTable('TestInsert', ['id', 'name']);
      createdTables.push('TestInsert');

      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Carol' },
      ];
      insertRows('TestInsert', ['id', 'name'], data);

      const rows = execQuery('SELECT * FROM "TestInsert" ORDER BY "id"');
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ id: 1, name: 'Alice' });
      expect(rows[1]).toEqual({ id: 2, name: 'Bob' });
      expect(rows[2]).toEqual({ id: 3, name: 'Carol' });
    });

    it('should handle empty data array without error', () => {
      createTable('TestEmpty', ['x']);
      createdTables.push('TestEmpty');

      expect(() => insertRows('TestEmpty', ['x'], [])).not.toThrow();
      expect(tableRowCount('TestEmpty')).toBe(0);
    });

    it('should coerce numeric strings to numbers', () => {
      createTable('TestCoerce', ['val']);
      createdTables.push('TestCoerce');

      insertRows('TestCoerce', ['val'], [{ val: '42' }, { val: '3.14' }]);
      const rows = execQuery('SELECT * FROM "TestCoerce"');
      expect(rows[0].val).toBe(42);
      expect(rows[1].val).toBe(3.14);
    });

    it('should coerce null and undefined to null', () => {
      createTable('TestNull', ['val']);
      createdTables.push('TestNull');

      insertRows('TestNull', ['val'], [{ val: null }, { val: undefined }]);
      const rows = execQuery('SELECT * FROM "TestNull"');
      expect(rows[0].val).toBeNull();
      expect(rows[1].val).toBeNull();
    });

    it('should coerce boolean values', () => {
      createTable('TestBool', ['val']);
      createdTables.push('TestBool');

      insertRows('TestBool', ['val'], [{ val: true }, { val: false }]);
      const rows = execQuery('SELECT * FROM "TestBool"');
      expect(rows[0].val).toBe(1);
      expect(rows[1].val).toBe(0);
    });
  });

  describe('execQuery', () => {
    it('should return array of objects for a SELECT', () => {
      const rows = execQuery('SELECT * FROM Orders ORDER BY OrderId LIMIT 2');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveProperty('OrderId');
      expect(rows[0]).toHaveProperty('Company');
      expect(rows[0]).toHaveProperty('Amount');
    });

    it('should handle parameterized queries', () => {
      const rows = execQuery('SELECT * FROM Orders WHERE Company = ?', ['Acme Corp']);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.Company).toBe('Acme Corp');
      }
    });

    it('should return empty array for no matches', () => {
      const rows = execQuery('SELECT * FROM Orders WHERE Company = ?', ['NonExistent']);
      expect(rows).toEqual([]);
    });

    it('should throw on invalid SQL', () => {
      expect(() => execQuery('SELECT * FROM NonExistentTable')).toThrow();
    });

    it('should include query text in error message', () => {
      try {
        execQuery('INVALID SQL HERE');
        expect.unreachable('should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('INVALID SQL HERE');
      }
    });
  });

  describe('dropTable', () => {
    it('should drop an existing table', () => {
      createTable('TestDrop', ['a']);
      expect(tableRowCount('TestDrop')).toBe(0);

      dropTable('TestDrop');
      expect(tableRowCount('TestDrop')).toBe(0);

      const tables = getSqlDb().exec("SELECT name FROM sqlite_master WHERE type='table' AND name='TestDrop'");
      expect(tables).toEqual([]);
    });

    it('should not throw for non-existent table (IF EXISTS)', () => {
      expect(() => dropTable('NoSuchTable')).not.toThrow();
    });
  });

  describe('tableRowCount', () => {
    it('should return correct count for populated table', () => {
      expect(tableRowCount('Orders')).toBe(8);
    });

    it('should return 0 for empty table', () => {
      createTable('TestCountEmpty', ['x']);
      createdTables.push('TestCountEmpty');
      expect(tableRowCount('TestCountEmpty')).toBe(0);
    });

    it('should return 0 for non-existent table', () => {
      expect(tableRowCount('NoSuchTable')).toBe(0);
    });

    it('should reflect inserted rows', () => {
      createTable('TestCountInsert', ['id']);
      createdTables.push('TestCountInsert');
      insertRows('TestCountInsert', ['id'], [{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(tableRowCount('TestCountInsert')).toBe(3);
    });
  });
});
