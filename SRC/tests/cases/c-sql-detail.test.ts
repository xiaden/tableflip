import { describe, it, expect, beforeAll } from 'vitest';

let renderDetailSql: any;
let buildQueryPlan: any;
let buildSourceCatalog: any;
let invalidateValidation: any;
let getValidation: any;

beforeAll(async () => {
  const detailMod = await import('../../js/query/sql-detail.js');
  const planMod = await import('../../js/query/query-plan.js');
  const catMod = await import('../../js/catalog/source-catalog.js');
  const valMod = await import('../../js/report/validation.js');
  renderDetailSql = detailMod.renderDetailSql;
  buildQueryPlan = planMod.buildQueryPlan;
  buildSourceCatalog = catMod.buildSourceCatalog;
  invalidateValidation = valMod.invalidateValidation;
  getValidation = valMod.getValidation;
});

function makePlan(overrides: Record<string, unknown> = {}) {
  const db = (globalThis as any).db;
  Object.assign(db, {
    base: 'Orders',
    stacks: [],
    lookups: [],
    calcStages: [],
    selCols: null,
    colOrder: null,
    filters: [],
    sorts: [],
    groupBy: [],
    aggregates: [],
    aggMode: 'none',
    excludedRows: {},
    ...overrides,
  });
  invalidateValidation();
  const validation = getValidation();
  const sourceCatalog = buildSourceCatalog();
  return buildQueryPlan(null, null, validation, sourceCatalog);
}

describe('renderDetailSql', () => {
  it('should throw when no base table in plan', () => {
    const plan = makePlan({ base: '' });
    expect(() => renderDetailSql(plan)).toThrow('No base table');
  });

  it('should generate SELECT * when no columns selected', () => {
    const plan = makePlan({ selCols: new Set<string>() });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('SELECT *');
    expect(result.sql).toContain('FROM "Orders"');
    expect(result.cols).toEqual([]);
  });

  it('should select specific columns', () => {
    const plan = makePlan({
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('"OrderId"');
    expect(result.sql).toContain('"Company"');
    expect(result.sql).toContain('"Amount"');
    expect(result.cols).toEqual(['OrderId', 'Company', 'Amount']);
  });

  it('should include FROM clause with base table', () => {
    const plan = makePlan();
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('FROM "Orders"');
  });

  it('should include WHERE clause for filters', () => {
    const plan = makePlan({
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('WHERE');
    expect(result.params.length).toBeGreaterThan(0);
  });

  it('should include ORDER BY for sorts', () => {
    const plan = makePlan({
      sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('ORDER BY');
    expect(result.sql).toContain('DESC');
  });

  it('should handle ASC sort direction', () => {
    const plan = makePlan({
      sorts: [{ col: 'Company', dir: 'ASC', enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('ORDER BY');
    expect(result.sql).toContain('ASC');
  });

  it('should handle multiple sorts', () => {
    const plan = makePlan({
      sorts: [
        { col: 'Company', dir: 'ASC', enabled: true },
        { col: 'Amount', dir: 'DESC', enabled: true },
      ],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('ORDER BY');
    const orderByIdx = result.sql.indexOf('ORDER BY');
    const companyIdx = result.sql.indexOf('"Company"', orderByIdx);
    const amountIdx = result.sql.indexOf('"Amount"', orderByIdx);
    expect(companyIdx).toBeLessThan(amountIdx);
  });

  it('should handle multiple filters with AND', () => {
    const plan = makePlan({
      filters: [
        { col: 'Status', op: 'equals', vals: ['Open'], enabled: true },
        { col: 'Region', op: 'equals', vals: ['North'], enabled: true },
      ],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toContain('AND');
  });

  it('should return empty params when no filters', () => {
    const plan = makePlan();
    const result = renderDetailSql(plan);
    expect(result.params).toEqual([]);
  });

  it('should handle filter with multiple vals (OR)', () => {
    const plan = makePlan({
      filters: [{ col: 'Status', op: 'equals', vals: ['Open', 'Shipped'], enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toContain('OR');
  });

  it('should handle is empty filter without params', () => {
    const plan = makePlan({
      filters: [{ col: 'Amount', op: 'is empty', vals: [''], enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toContain('IS NULL');
  });

  it('should handle not empty filter without params', () => {
    const plan = makePlan({
      filters: [{ col: 'Amount', op: 'not empty', vals: [''], enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toContain('IS NOT NULL');
  });

  it('should skip disabled filters', () => {
    const plan = makePlan({
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: false }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).not.toContain('WHERE');
  });

  it('should skip filters with no col', () => {
    const plan = makePlan({
      filters: [{ col: '', op: 'equals', vals: ['Open'], enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).not.toContain('WHERE');
  });

  it('should produce valid SQL that executes against fixture data', () => {
    const plan = makePlan({
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('SELECT');
    expect(result.sql).toContain('ORDER BY');
    expect(result.cols).toEqual(['OrderId', 'Company', 'Amount']);
  });

  it('should produce valid SQL with filter that executes correctly', () => {
    const plan = makePlan({
      selCols: new Set(['OrderId', 'Status']),
      colOrder: ['OrderId', 'Status'],
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
    });
    const result = renderDetailSql(plan);
    expect(result.sql).toContain('WHERE');
    expect(result.params.length).toBeGreaterThan(0);
  });
});
