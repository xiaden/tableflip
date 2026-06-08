import { describe, it, expect } from 'vitest';

describe('Core State', () => {
  it('should have db global initialized', () => {
    const db = (globalThis as any).db;
    expect(db).toBeTruthy();
    expect(db.tables).toBeTruthy();
    expect(typeof db.base).toBe('string');
  });

  it('should have Orders table registered', () => {
    const db = (globalThis as any).db;
    expect(db.tables['Orders']).toBeTruthy();
    expect(db.tables['Orders'].name).toBe('Orders');
    expect(db.tables['Orders'].cols).toContain('OrderId');
    expect(db.tables['Orders'].cols).toContain('Company');
    expect(db.tables['Orders'].cols).toContain('Amount');
  });

  it('should have Contacts table registered', () => {
    const db = (globalThis as any).db;
    expect(db.tables['Contacts']).toBeTruthy();
    expect(db.tables['Contacts'].name).toBe('Contacts');
    expect(db.tables['Contacts'].cols).toContain('Company');
    expect(db.tables['Contacts'].cols).toContain('Email');
  });

  it('should have Orders as base table', () => {
    const db = (globalThis as any).db;
    expect(db.base).toBe('Orders');
  });

  it('should have default aggMode as none', () => {
    const db = (globalThis as any).db;
    expect(db.aggMode).toBe('none');
  });

  it('should have empty arrays for collections', () => {
    const db = (globalThis as any).db;
    expect(db.stacks).toEqual([]);
    expect(db.lookups).toEqual([]);
    expect(db.calcStages).toEqual([]);
    expect(db.filters).toEqual([]);
    expect(db.sorts).toEqual([]);
    expect(db.groupBy).toEqual([]);
    expect(db.aggregates).toEqual([]);
  });

  it('should have null for optional fields', () => {
    const db = (globalThis as any).db;
    expect(db.selCols).toBeNull();
    expect(db.colOrder).toBeNull();
    expect(db.baseCols).toBeNull();
    expect(db.result).toBeNull();
  });
});
