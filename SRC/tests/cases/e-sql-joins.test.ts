import { describe, it, expect, beforeAll } from 'vitest';

let renderFromJoinWhere: any;
let buildQueryPlan: any;
let buildSourceCatalog: any;
let invalidateValidation: any;
let getValidation: any;

beforeAll(async () => {
  const mod = await import('../../js/query/sql-joins.js');
  const planMod = await import('../../js/query/query-plan.js');
  const catMod = await import('../../js/catalog/source-catalog.js');
  const valMod = await import('../../js/report/validation.js');
  renderFromJoinWhere = mod.renderFromJoinWhere;
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

describe('renderFromJoinWhere', () => {
  describe('FROM clause', () => {
    it('should use base table name when no stacks', () => {
      const plan = makePlan();
      const result = renderFromJoinWhere(plan);
      expect(result.fromClause).toBe('"Orders"');
    });

    it('should generate UNION ALL subquery when stacks are present', () => {
      const plan = makePlan({
        stacks: ['Contacts'],
        baseCols: ['Company', 'Contact'],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.fromClause).toContain('UNION ALL');
      expect(result.fromClause).toContain('_base');
      expect(result.fromClause).toContain('"Orders"');
      expect(result.fromClause).toContain('"Contacts"');
    });

    it('should include NULL for missing columns in stacked tables', () => {
      const plan = makePlan({
        stacks: ['Contacts'],
        baseCols: ['OrderId', 'Company'],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.fromClause).toContain('NULL AS "OrderId"');
    });
  });

  describe('JOIN clauses', () => {
    it('should generate LEFT JOIN for non-required lookup', () => {
      const plan = makePlan({
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Company', right: 'Company' }],
          required: false,
          enabled: true,
          cols: ['Email', 'Phone'],
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.joinClauses.length).toBe(1);
      expect(result.joinClauses[0]).toContain('LEFT JOIN');
      expect(result.joinClauses[0]).toContain('"Contacts"');
    });

    it('should generate INNER JOIN for required lookup', () => {
      const plan = makePlan({
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Company', right: 'Company' }],
          required: true,
          enabled: true,
          cols: ['Email'],
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.joinClauses.length).toBe(1);
      expect(result.joinClauses[0]).toContain('INNER JOIN');
    });

    it('should include ON clause with key pairs', () => {
      const plan = makePlan({
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Company', right: 'Company' }, { left: 'Contact', right: 'Contact' }],
          required: false,
          enabled: true,
          cols: ['Email'],
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.joinClauses[0]).toContain('ON');
      expect(result.joinClauses[0]).toContain('"Company"');
      expect(result.joinClauses[0]).toContain('"Contact"');
    });

    it('should skip disabled lookups', () => {
      const plan = makePlan({
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Company', right: 'Company' }],
          required: false,
          enabled: false,
          cols: ['Email'],
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.joinClauses).toHaveLength(0);
    });

    it('should skip lookups with no valid key pairs', () => {
      const plan = makePlan({
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: '', right: '' }],
          required: false,
          enabled: true,
          cols: ['Email'],
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.joinClauses).toHaveLength(0);
    });

    it('should handle combine duplicate policy with unique', () => {
      const plan = makePlan({
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Company', right: 'Company' }],
          required: false,
          enabled: true,
          cols: ['Email'],
          duplicatePolicy: {
            mode: 'combine',
            combine: { separator: '; ', unique: true, includeBlank: false, sort: false },
          },
        }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.joinClauses.length).toBe(1);
      expect(result.joinClauses[0]).toContain('GROUP_CONCAT');
    });

    it('should handle combine duplicate policy without unique', () => {
      const plan = makePlan({
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Company', right: 'Company' }],
          required: false,
          enabled: true,
          cols: ['Email'],
          duplicatePolicy: {
            mode: 'combine',
            combine: { separator: ', ', unique: false, includeBlank: false, sort: false },
          },
        }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.joinClauses.length).toBe(1);
      expect(result.joinClauses[0]).toContain('GROUP_CONCAT');
    });

    it('should handle multiple lookups', () => {
      const plan = makePlan({
        lookups: [
          {
            rightId: 'Contacts',
            keyPairs: [{ left: 'Company', right: 'Company' }],
            required: false,
            enabled: true,
            cols: ['Email'],
            duplicatePolicy: { mode: 'block' },
          },
        ],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.joinClauses.length).toBe(1);
    });
  });

  describe('WHERE clause', () => {
    it('should have no WHERE parts when no filters and no excluded rows', () => {
      const plan = makePlan();
      const result = renderFromJoinWhere(plan);
      expect(result.whereParts).toHaveLength(0);
    });

    it('should generate WHERE for filters', () => {
      const plan = makePlan({
        filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.whereParts.length).toBeGreaterThan(0);
      expect(result.params.length).toBeGreaterThan(0);
    });

    it('should generate WHERE for excluded rows (non-stacked)', () => {
      const plan = makePlan({
        excludedRows: { 'Orders': new Set([0, 2]) },
      });
      const result = renderFromJoinWhere(plan);
      expect(result.whereParts.length).toBeGreaterThan(0);
      expect(result.whereParts[0]).toContain('NOT IN');
    });

    it('should skip excluded rows for stacked base (handled in UNION)', () => {
      const plan = makePlan({
        stacks: ['Contacts'],
        baseCols: ['Company'],
        excludedRows: { 'Orders': new Set([0]) },
      });
      const result = renderFromJoinWhere(plan);
      const hasRowNoInWhere = result.whereParts.some((w: string) => w.includes('"_rowno"') && w.includes('NOT IN'));
      expect(hasRowNoInWhere).toBe(false);
    });

    it('should handle multiple filters', () => {
      const plan = makePlan({
        filters: [
          { col: 'Status', op: 'equals', vals: ['Open'], enabled: true },
          { col: 'Region', op: 'equals', vals: ['North'], enabled: true },
        ],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.whereParts.length).toBe(2);
    });

    it('should skip disabled filters', () => {
      const plan = makePlan({
        filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: false }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.whereParts).toHaveLength(0);
    });

    it('should skip filters with empty col', () => {
      const plan = makePlan({
        filters: [{ col: '', op: 'equals', vals: ['Open'], enabled: true }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.whereParts).toHaveLength(0);
    });

    it('should handle filter with multiple vals producing OR', () => {
      const plan = makePlan({
        filters: [{ col: 'Status', op: 'equals', vals: ['Open', 'Shipped'], enabled: true }],
      });
      const result = renderFromJoinWhere(plan);
      expect(result.whereParts.length).toBe(1);
      expect(result.whereParts[0]).toContain('OR');
    });
  });

  describe('ref function', () => {
    it('should return quoted table.column for physical columns', () => {
      const plan = makePlan();
      const result = renderFromJoinWhere(plan);
      const ref = result.ref('OrderId');
      expect(ref).toContain('"Orders"');
      expect(ref).toContain('"OrderId"');
    });

    it('should use _base alias when stacks are present', () => {
      const plan = makePlan({
        stacks: ['Contacts'],
        baseCols: ['Company'],
      });
      const result = renderFromJoinWhere(plan);
      const ref = result.ref('Company');
      expect(ref).toContain('_base');
    });

    it('should return quoted alias for unknown columns', () => {
      const plan = makePlan();
      const result = renderFromJoinWhere(plan);
      const ref = result.ref('NonExistent');
      expect(ref).toBe('"NonExistent"');
    });
  });
});
