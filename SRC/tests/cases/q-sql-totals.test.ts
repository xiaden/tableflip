import { describe, it, expect, beforeAll } from 'vitest';

let renderTotalsSql: any;
let buildQueryPlan: any;
let buildSourceCatalog: any;
let invalidateValidation: any;
let getValidation: any;

beforeAll(async () => {
  const mod = await import('../../js/query/sql-totals.js');
  const planMod = await import('../../js/query/query-plan.js');
  const catMod = await import('../../js/catalog/source-catalog.js');
  const valMod = await import('../../js/report/validation.js');
  renderTotalsSql = mod.renderTotalsSql;
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
    aggMode: 'totals',
    colTotals: {},
    excludedRows: {},
    ...overrides,
  });
  invalidateValidation();
  const validation = getValidation();
  const sourceCatalog = buildSourceCatalog();
  return buildQueryPlan(null, null, validation, sourceCatalog);
}

describe('renderTotalsSql', () => {
  it('should throw when no base table in plan', () => {
    const plan = makePlan({ base: '' });
    expect(() => renderTotalsSql(plan, ['Amount'])).toThrow('No base table');
  });

  it('should return null when colTotals is empty', () => {
    const plan = makePlan({ colTotals: {} });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).toBeNull();
  });

  it('should return null when all colTotals are skip', () => {
    const plan = makePlan({ colTotals: { OrderId: 'skip', Amount: 'skip' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).toBeNull();
  });

  it('should return null when detailCols have no matching colTotals', () => {
    const plan = makePlan({ colTotals: { Region: 'SUM' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).toBeNull();
  });

  it('should generate SUM aggregate for a column', () => {
    const plan = makePlan({ colTotals: { Amount: 'SUM' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('SUM(');
    expect(result.sql).toContain('"Amount"');
    expect(result.cols).toEqual(['OrderId', 'Amount']);
  });

  it('should generate AVG aggregate for a column', () => {
    const plan = makePlan({ colTotals: { Amount: 'AVG' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('AVG(');
  });

  it('should generate COUNT ROWS aggregate', () => {
    const plan = makePlan({ colTotals: { OrderId: 'COUNT ROWS' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('COUNT(*)');
  });

  it('should generate COUNT NON-EMPTY aggregate', () => {
    const plan = makePlan({ colTotals: { Amount: 'COUNT NON-EMPTY' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('COUNT(');
    expect(result.sql).not.toContain('COUNT(*)');
  });

  it('should generate COUNT DISTINCT aggregate', () => {
    const plan = makePlan({ colTotals: { Company: 'COUNT DISTINCT' } });
    const result = renderTotalsSql(plan, ['Company', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('COUNT(DISTINCT');
  });

  it('should generate MIN aggregate', () => {
    const plan = makePlan({ colTotals: { Amount: 'MIN' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('MIN(');
  });

  it('should generate MAX aggregate', () => {
    const plan = makePlan({ colTotals: { Amount: 'MAX' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('MAX(');
  });

  it('should render NULL for columns with skip total fn', () => {
    const plan = makePlan({ colTotals: { OrderId: 'skip', Amount: 'SUM' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('NULL AS');
    expect(result.sql).toContain('SUM(');
  });

  it('should render NULL for columns not in colTotals', () => {
    const plan = makePlan({ colTotals: { Amount: 'SUM' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('NULL AS "OrderId"');
  });

  it('should handle multiple columns with different total functions', () => {
    const plan = makePlan({
      colTotals: { OrderId: 'COUNT ROWS', Amount: 'SUM', Company: 'COUNT DISTINCT' },
    });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount', 'Company']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('COUNT(*)');
    expect(result.sql).toContain('SUM(');
    expect(result.sql).toContain('COUNT(DISTINCT');
    expect(result.cols).toEqual(['OrderId', 'Amount', 'Company']);
  });

  it('should include FROM clause with base table', () => {
    const plan = makePlan({ colTotals: { Amount: 'SUM' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('FROM "Orders"');
  });

  it('should include WHERE clause for filters', () => {
    const plan = makePlan({
      colTotals: { Amount: 'SUM' },
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
    });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('WHERE');
    expect(result.params.length).toBeGreaterThan(0);
  });

  it('should return params array', () => {
    const plan = makePlan({
      colTotals: { Amount: 'SUM' },
      filters: [{ col: 'Region', op: 'equals', vals: ['North'], enabled: true }],
    });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(Array.isArray(result.params)).toBe(true);
    expect(result.params).toContain('North');
  });

  it('should return empty params when no filters', () => {
    const plan = makePlan({ colTotals: { Amount: 'SUM' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.params).toEqual([]);
  });

  it('should produce SELECT statement', () => {
    const plan = makePlan({ colTotals: { Amount: 'SUM' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('SELECT');
  });

  it('should handle LIST aggregate', () => {
    const plan = makePlan({ colTotals: { Region: 'LIST' } });
    const result = renderTotalsSql(plan, ['Region', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('GROUP_CONCAT(DISTINCT');
  });

  it('should handle DATE RANGE aggregate', () => {
    const plan = makePlan({ colTotals: { OrderDate: 'DATE RANGE' } });
    const result = renderTotalsSql(plan, ['OrderDate', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('MIN(');
    expect(result.sql).toContain('MAX(');
  });

  it('should handle NUMERIC SPAN aggregate', () => {
    const plan = makePlan({ colTotals: { Amount: 'NUMERIC SPAN' } });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('MAX(');
    expect(result.sql).toContain('MIN(');
  });

  it('should only process detailCols passed in', () => {
    const plan = makePlan({ colTotals: { Amount: 'SUM', Region: 'COUNT DISTINCT' } });
    const result = renderTotalsSql(plan, ['Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('SUM(');
    expect(result.sql).not.toContain('COUNT(DISTINCT');
    expect(result.cols).toEqual(['Amount']);
  });

  it('should handle single detailCol with total', () => {
    const plan = makePlan({ colTotals: { Amount: 'SUM' } });
    const result = renderTotalsSql(plan, ['Amount']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('SUM(');
    expect(result.cols).toEqual(['Amount']);
  });

  it('should include join clauses when lookups are configured', () => {
    const plan = makePlan({
      colTotals: { Amount: 'SUM' },
      lookups: [{
        rightId: 'Contacts',
        enabled: true,
        keyPairs: [{ left: 'Company', right: 'Company' }],
        required: false,
        duplicatePolicy: { mode: 'block' },
      }],
      selCols: new Set(['OrderId', 'Amount', 'Email']),
      colOrder: ['OrderId', 'Amount', 'Email'],
    });
    const result = renderTotalsSql(plan, ['OrderId', 'Amount', 'Email']);
    expect(result).not.toBeNull();
    expect(result.sql).toContain('JOIN');
  });
});
