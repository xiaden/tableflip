import { describe, it, expect, beforeAll } from 'vitest';

let renderSubtotalsSql: any;
let buildQueryPlan: any;
let buildSourceCatalog: any;
let invalidateValidation: any;
let getValidation: any;

beforeAll(async () => {
  const mod = await import('../../js/query/sql-subtotals.js');
  const planMod = await import('../../js/query/query-plan.js');
  const catMod = await import('../../js/catalog/source-catalog.js');
  const valMod = await import('../../js/report/validation.js');
  renderSubtotalsSql = mod.renderSubtotalsSql;
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
    aggMode: 'subtotals',
    colTotals: {},
    subtotalBy: [],
    subtotalFns: {},
    subtotalGrandTotal: true,
    subtotalSpacer: false,
    subtotalOnTop: false,
    subtotalStrategy: 'combined',
    excludedRows: {},
    ...overrides,
  });
  invalidateValidation();
  const validation = getValidation();
  const sourceCatalog = buildSourceCatalog();
  return buildQueryPlan(null, null, validation, sourceCatalog);
}

describe('renderSubtotalsSql', () => {
  it('should throw when no base table in plan', () => {
    const plan = makePlan({ base: '' });
    expect(() => renderSubtotalsSql(plan)).toThrow('No base table');
  });

  it('should return null when no selected columns', () => {
    const plan = makePlan({ selCols: new Set<string>(), colOrder: [] });
    const result = renderSubtotalsSql(plan);
    expect(result).toBeNull();
  });

  it('should generate detail branch with _row_type 0', () => {
    const plan = makePlan({
      selCols: new Set(['OrderId', 'Amount']),
      colOrder: ['OrderId', 'Amount'],
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('0 AS "_row_type"');
  });

  it('should include FROM clause with base table', () => {
    const plan = makePlan({
      selCols: new Set(['OrderId', 'Amount']),
      colOrder: ['OrderId', 'Amount'],
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('FROM "Orders"');
  });

  it('should generate UNION ALL when subtotalBy is set', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('UNION ALL');
  });

  it('should include GROUP BY in subtotal branch', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('GROUP BY');
    expect(result.sql).toContain('"Region"');
  });

  it('should include subtotal _row_type 1', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('1 AS "_row_type"');
  });

  it('should include grand total row (_row_type 3) by default', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('3 AS "_row_type"');
  });

  it('should omit grand total when subtotalGrandTotal is false', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalGrandTotal: false,
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).not.toContain('3 AS "_row_type"');
  });

  it('should omit grand total when all non-subtotalBy columns have skip fn', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'skip' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).not.toContain('3 AS "_row_type"');
  });

  it('should include spacer rows when subtotalSpacer is true', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalSpacer: true,
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('2 AS "_row_type"');
  });

  it('should not include spacer rows by default', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalSpacer: false,
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).not.toContain('2 AS "_row_type"');
  });

  it('should use SUM aggregate in subtotal expression', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('SUM(');
  });

  it('should use AVG aggregate in subtotal expression', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'AVG' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('AVG(');
  });

  it('should render NULL for skip columns in subtotal', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount', 'OrderId']),
      colOrder: ['Region', 'Amount', 'OrderId'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM', OrderId: 'skip' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('NULL AS "OrderId"');
  });

  it('should handle combined strategy (default)', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Status', 'Amount']),
      colOrder: ['Region', 'Status', 'Amount'],
      subtotalBy: ['Region', 'Status'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'combined',
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    const groupByCount = (result.sql.match(/GROUP BY/g) || []).length;
    const unionCount = (result.sql.match(/UNION ALL/g) || []).length;
    expect(groupByCount).toBe(1);
    expect(unionCount).toBe(2);
  });

  it('should handle nested strategy with multiple subtotalBy columns', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Status', 'Amount']),
      colOrder: ['Region', 'Status', 'Amount'],
      subtotalBy: ['Region', 'Status'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    const groupByCount = (result.sql.match(/GROUP BY/g) || []).length;
    expect(groupByCount).toBe(2);
  });

  it('should handle nested strategy with single subtotalBy same as combined', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    const groupByCount = (result.sql.match(/GROUP BY/g) || []).length;
    expect(groupByCount).toBe(1);
  });

  it('should include ORDER BY clause', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('ORDER BY');
  });

  it('should include _sort_row_type in ORDER BY', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('"_sort_row_type"');
  });

  it('should include sort_group keys in output cols', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.cols).toContain('_sort_group_0');
    expect(result.cols).toContain('_row_type');
    expect(result.cols).toContain('_sort_row_type');
  });

  it('should set displayCols to selected columns', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount', 'OrderId']),
      colOrder: ['Region', 'Amount', 'OrderId'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.displayCols).toEqual(['Region', 'Amount', 'OrderId']);
  });

  it('should include WHERE clause for filters', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('WHERE');
    expect(result.params.length).toBeGreaterThan(0);
  });

  it('should add IS NOT NULL filter for subtotalBy columns in subtotal/spacer branches', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('IS NOT NULL');
  });

  it('should handle subtotalOnTop flag', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalOnTop: true,
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('1 AS "_sort_row_type"');
    expect(result.sql).toContain('0 AS "_sort_row_type"');
  });

  it('should handle multiple subtotalBy columns in combined strategy', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Status', 'Amount']),
      colOrder: ['Region', 'Status', 'Amount'],
      subtotalBy: ['Region', 'Status'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'combined',
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.cols).toContain('_sort_group_0');
    expect(result.cols).toContain('_sort_group_1');
  });

  it('should handle nested strategy with spacer rows', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Status', 'Amount']),
      colOrder: ['Region', 'Status', 'Amount'],
      subtotalBy: ['Region', 'Status'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalSpacer: true,
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('2 AS "_row_type"');
    expect(result.sql).toContain('UNION ALL');
  });

  it('should handle no subtotalBy with grand total only', () => {
    const plan = makePlan({
      selCols: new Set(['OrderId', 'Amount']),
      colOrder: ['OrderId', 'Amount'],
      subtotalBy: [],
      subtotalFns: { Amount: 'SUM' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('3 AS "_row_type"');
    expect(result.sql).toContain('SUM(');
    const unionCount = (result.sql.match(/UNION ALL/g) || []).length;
    expect(unionCount).toBe(1);
  });

  it('should handle COUNT ROWS in subtotalFns', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'OrderId']),
      colOrder: ['Region', 'OrderId'],
      subtotalBy: ['Region'],
      subtotalFns: { OrderId: 'COUNT ROWS' },
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('COUNT(*)');
  });

  it('should include additional sorts in ORDER BY', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('DESC');
  });

  it('should not include sorts for subtotalBy columns in ORDER BY', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      sorts: [{ col: 'Region', dir: 'DESC', enabled: true }],
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    const orderByIdx = result.sql.indexOf('ORDER BY');
    const afterOrder = result.sql.substring(orderByIdx);
    expect(afterOrder).not.toContain('"Region" DESC');
  });

  it('should produce correct number of params for multiple branches', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    const branchCount = (result.sql.match(/SELECT/g) || []).length;
    expect(result.params.length).toBe(branchCount);
  });

  it('should handle combined strategy with grand total disabled and spacer', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalGrandTotal: false,
      subtotalSpacer: true,
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).not.toContain('3 AS "_row_type"');
    expect(result.sql).toContain('2 AS "_row_type"');
  });

  it('should handle NULLS FIRST in nested on-top strategy', () => {
    const plan = makePlan({
      selCols: new Set(['Region', 'Status', 'Amount']),
      colOrder: ['Region', 'Status', 'Amount'],
      subtotalBy: ['Region', 'Status'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalOnTop: true,
    });
    const result = renderSubtotalsSql(plan);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('NULLS FIRST');
  });
});
