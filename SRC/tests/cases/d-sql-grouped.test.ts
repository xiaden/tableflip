import { describe, it, expect, beforeAll } from 'vitest';

let renderGroupedSql: any;
let buildQueryPlan: any;
let buildSourceCatalog: any;
let invalidateValidation: any;
let getValidation: any;

beforeAll(async () => {
  const mod = await import('../../js/query/sql-grouped.js');
  const planMod = await import('../../js/query/query-plan.js');
  const catMod = await import('../../js/catalog/source-catalog.js');
  const valMod = await import('../../js/report/validation.js');
  renderGroupedSql = mod.renderGroupedSql;
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
    colOrder: [],
    filters: [],
    sorts: [],
    groupBy: [],
    aggregates: [],
    aggMode: 'group',
    excludedRows: {},
    ...overrides,
  });
  invalidateValidation();
  const validation = getValidation();
  const sourceCatalog = buildSourceCatalog();
  return buildQueryPlan(null, null, validation, sourceCatalog);
}

describe('renderGroupedSql', () => {
  it('should throw when no base table in plan', () => {
    const plan = makePlan({ base: '' });
    expect(() => renderGroupedSql(plan)).toThrow('No base table');
  });

  it('should generate GROUP BY clause', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('GROUP BY');
    expect(result.sql).toContain('"Region"');
  });

  it('should include aggregate expressions in SELECT', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('SUM(');
    expect(result.sql).toContain('"Total Amount"');
  });

  it('should include group-by columns in SELECT', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('"Region"');
    expect(result.cols).toContain('Region');
  });

  it('should handle multiple group-by columns', () => {
    const plan = makePlan({
      groupBy: ['Region', 'Status'],
      aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('GROUP BY');
    expect(result.cols).toContain('Region');
    expect(result.cols).toContain('Status');
  });

  it('should handle multiple aggregates', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [
        { col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true },
        { col: 'Amount', fn: 'AVG', alias: 'Avg Amount', enabled: true },
        { col: 'OrderId', fn: 'COUNT ROWS', alias: 'Row Count', enabled: true },
      ],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('SUM(');
    expect(result.sql).toContain('AVG(');
    expect(result.sql).toContain('COUNT(*)');
    expect(result.cols).toContain('Total Amount');
    expect(result.cols).toContain('Avg Amount');
    expect(result.cols).toContain('Row Count');
  });

  it('should handle COUNT ROWS aggregate', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: '*', fn: 'COUNT ROWS', alias: 'Count', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('COUNT(*)');
  });

  it('should handle COUNT NON-EMPTY aggregate', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'COUNT NON-EMPTY', alias: 'Non-Empty', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('COUNT(');
  });

  it('should handle COUNT DISTINCT aggregate', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Company', fn: 'COUNT DISTINCT', alias: 'Unique Companies', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('COUNT(DISTINCT');
  });

  it('should handle MIN and MAX aggregates', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [
        { col: 'Amount', fn: 'MIN', alias: 'Min Amount', enabled: true },
        { col: 'Amount', fn: 'MAX', alias: 'Max Amount', enabled: true },
      ],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('MIN(');
    expect(result.sql).toContain('MAX(');
  });

  it('should include ORDER BY for sorts', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true }],
      sorts: [{ col: 'Region', dir: 'ASC', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('ORDER BY');
    expect(result.sql).toContain('ASC');
  });

  it('should include WHERE clause for filters', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true }],
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('WHERE');
    expect(result.params.length).toBeGreaterThan(0);
  });

  it('should fall back to detail-like when no groupBy and no aggregates', () => {
    const plan = makePlan({
      groupBy: [],
      aggregates: [],
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).not.toContain('GROUP BY');
    expect(result.cols).toEqual(['OrderId', 'Company']);
  });

  it('should produce valid grouped SQL structure', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [
        { col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true },
        { col: 'OrderId', fn: 'COUNT ROWS', alias: 'Count', enabled: true },
      ],
      sorts: [{ col: 'Region', dir: 'ASC', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('SELECT');
    expect(result.sql).toContain('FROM');
    expect(result.sql).toContain('GROUP BY');
    expect(result.sql).toContain('ORDER BY');
    expect(result.cols).toContain('Region');
    expect(result.cols).toContain('Total Amount');
    expect(result.cols).toContain('Count');
  });

  it('should handle aggregate with no alias using default alias', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'SUM', alias: '', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('SUM(');
    expect(result.cols.length).toBeGreaterThan(1);
  });

  it('should handle LIST aggregate', () => {
    const plan = makePlan({
      groupBy: ['Region'],
      aggregates: [{ col: 'Company', fn: 'LIST', alias: 'Companies', enabled: true }],
    });
    const result = renderGroupedSql(plan);
    expect(result.sql).toContain('GROUP_CONCAT(DISTINCT');
  });

  it('should filter group-by columns by selCols when set', () => {
    const plan = makePlan({
      groupBy: ['Region', 'Status'],
      aggregates: [
        { col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true },
      ],
      selCols: new Set(['Region']),
      colOrder: ['Region', 'Status'],
    });
    const result = renderGroupedSql(plan);
    expect(result.cols).toContain('Region');
    expect(result.cols).not.toContain('Status');
  });
});
