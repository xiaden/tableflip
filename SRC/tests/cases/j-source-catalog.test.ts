import { describe, it, expect } from 'vitest';
import { buildSourceCatalog, getTable, getTableColumns, getTableLabel, getColumn, resolveSourceTableRef, resolveSourceColumnRef } from '../../js/catalog/source-catalog.js';

describe('Source Catalog', () => {
  it('should include all loaded tables', () => {
    const catalog = buildSourceCatalog();
    expect(catalog.has('Orders')).toBe(true);
    expect(catalog.has('Contacts')).toBe(true);
  });

  it('should have correct structure for each entry', () => {
    const catalog = buildSourceCatalog();
    const orders = catalog.get('Orders')!;
    expect(orders).toBeTruthy();
    expect(orders.id).toBe('Orders');
    expect(orders.name).toBe('Orders');
    expect(Array.isArray(orders.cols)).toBe(true);
    expect(orders.kind).toBe('imported');
    expect(orders.source).toBeTruthy();
  });

  it('should include correct columns for Orders', () => {
    const catalog = buildSourceCatalog();
    const orders = catalog.get('Orders')!;
    expect(orders.cols).toContain('OrderId');
    expect(orders.cols).toContain('Company');
    expect(orders.cols).toContain('Amount');
    expect(orders.cols).toContain('OrderDate');
    expect(orders.cols).toContain('Region');
  });

  it('should include correct columns for Contacts', () => {
    const catalog = buildSourceCatalog();
    const contacts = catalog.get('Contacts')!;
    expect(contacts.cols).toContain('Company');
    expect(contacts.cols).toContain('Contact');
    expect(contacts.cols).toContain('Email');
    expect(contacts.cols).toContain('Phone');
  });

  it('should return empty map with no tables', () => {
    const db = (globalThis as any).db;
    const savedTables = db.tables;
    db.tables = {};
    try {
      const catalog = buildSourceCatalog();
      expect(catalog.size).toBe(0);
    } finally {
      db.tables = savedTables;
    }
  });

  it('should handle multiple tables', () => {
    const catalog = buildSourceCatalog();
    expect(catalog.size).toBeGreaterThanOrEqual(2);
  });

  it('should include upstream outputs as report kind', () => {
    const upstream = new Map([
      ['report1', { name: 'Report One', columns: ['a', 'b'], rows: [] }],
    ]);
    const catalog = buildSourceCatalog(undefined, upstream);
    expect(catalog.has('report1')).toBe(true);
    const entry = catalog.get('report1')!;
    expect(entry.kind).toBe('report');
    expect(entry.name).toBe('Report One');
    expect(entry.cols).toEqual(['a', 'b']);
  });

  it('should use workspaceState tables when provided', () => {
    const ws = {
      tables: {
        custom: { name: 'Custom Table', cols: ['x', 'y'], rows: [] },
      },
    };
    const catalog = buildSourceCatalog(ws);
    expect(catalog.has('custom')).toBe(true);
    expect(catalog.get('custom')!.name).toBe('Custom Table');
  });

  it('should fallback to tid when name is missing', () => {
    const ws = {
      tables: {
        myTable: { cols: ['a'], rows: [] },
      },
    };
    const catalog = buildSourceCatalog(ws);
    expect(catalog.get('myTable')!.name).toBe('myTable');
  });

  it('getTable should return entry for existing table', () => {
    const catalog = buildSourceCatalog();
    const entry = getTable(catalog, 'Orders');
    expect(entry).toBeTruthy();
    expect(entry!.id).toBe('Orders');
    expect(entry!.kind).toBe('imported');
  });

  it('getTable should return null for missing table', () => {
    const catalog = buildSourceCatalog();
    expect(getTable(catalog, 'NonExistent')).toBeNull();
  });

  it('getTable should return null for non-Map input', () => {
    expect(getTable({} as any, 'Orders')).toBeNull();
  });

  it('getTableColumns should return columns for existing table', () => {
    const catalog = buildSourceCatalog();
    const cols = getTableColumns(catalog, 'Orders');
    expect(cols).toContain('OrderId');
    expect(cols).toContain('Amount');
  });

  it('getTableColumns should return empty array for missing table', () => {
    const catalog = buildSourceCatalog();
    expect(getTableColumns(catalog, 'NonExistent')).toEqual([]);
  });

  it('getTableLabel should return name for existing table', () => {
    const ws = {
      tables: {
        t1: { name: 'My Table', cols: [], rows: [] },
      },
    };
    const catalog = buildSourceCatalog(ws);
    expect(getTableLabel(catalog, 't1')).toBe('My Table');
  });

  it('getTableLabel should fallback to tid for missing table', () => {
    const catalog = buildSourceCatalog();
    expect(getTableLabel(catalog, 'Missing')).toBe('Missing');
  });

  it('getColumn should return ref when column exists', () => {
    const catalog = buildSourceCatalog();
    const ref = getColumn(catalog, 'Orders', 'Amount');
    expect(ref).toEqual({ col: 'Amount', tid: 'Orders' });
  });

  it('getColumn should return null when column does not exist', () => {
    const catalog = buildSourceCatalog();
    expect(getColumn(catalog, 'Orders', 'NonExistent')).toBeNull();
  });

  it('getColumn should return null when table does not exist', () => {
    const catalog = buildSourceCatalog();
    expect(getColumn(catalog, 'FakeTable', 'col')).toBeNull();
  });

  it('resolveSourceTableRef should return entry for valid ref', () => {
    const catalog = buildSourceCatalog();
    const entry = resolveSourceTableRef(catalog, 'Orders');
    expect(entry).toBeTruthy();
    expect(entry!.id).toBe('Orders');
  });

  it('resolveSourceTableRef should return null for invalid ref', () => {
    const catalog = buildSourceCatalog();
    expect(resolveSourceTableRef(catalog, 'Fake')).toBeNull();
  });

  it('resolveSourceColumnRef should return ref for valid column ref', () => {
    const catalog = buildSourceCatalog();
    const ref = resolveSourceColumnRef(catalog, { tid: 'Orders', col: 'Amount' });
    expect(ref).toEqual({ col: 'Amount', tid: 'Orders' });
  });

  it('resolveSourceColumnRef should return null for missing column', () => {
    const catalog = buildSourceCatalog();
    expect(resolveSourceColumnRef(catalog, { tid: 'Orders', col: 'Fake' })).toBeNull();
  });

  it('resolveSourceColumnRef should return null for missing tid', () => {
    const catalog = buildSourceCatalog();
    expect(resolveSourceColumnRef(catalog, { col: 'Amount' })).toBeNull();
  });

  it('resolveSourceColumnRef should return null for missing col', () => {
    const catalog = buildSourceCatalog();
    expect(resolveSourceColumnRef(catalog, { tid: 'Orders' })).toBeNull();
  });

  it('resolveSourceColumnRef should return null for null/undefined ref', () => {
    const catalog = buildSourceCatalog();
    expect(resolveSourceColumnRef(catalog, null as any)).toBeNull();
    expect(resolveSourceColumnRef(catalog, {} as any)).toBeNull();
  });

  it('should use outputId as fallback name for upstream outputs', () => {
    const upstream = new Map([
      ['rpt1', { columns: ['x'], rows: [] }],
    ]);
    const catalog = buildSourceCatalog(undefined, upstream);
    expect(catalog.get('rpt1')!.name).toBe('rpt1');
  });

  it('should handle upstream outputs with empty columns and rows', () => {
    const upstream = new Map([
      ['rpt2', { name: 'R2' }],
    ]);
    const catalog = buildSourceCatalog(undefined, upstream);
    const entry = catalog.get('rpt2')!;
    expect(entry.cols).toEqual([]);
    expect(entry.rows).toEqual([]);
  });
});
