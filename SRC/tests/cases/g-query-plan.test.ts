import { describe, it, expect } from 'vitest';

function plan(overrides: Record<string, unknown> = {}) {
  const db = (globalThis as any).db;
  const buildQueryPlan = (globalThis as any).buildQueryPlan;
  const buildSourceCatalog = (globalThis as any).buildSourceCatalog;
  const invalidateValidation = (globalThis as any).invalidateValidation;
  Object.assign(db, {
    base: 'Orders',
    baseCols: null,
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
    colTotals: {},
    subtotalBy: [],
    subtotalFns: {},
    subtotalGrandTotal: true,
    subtotalSpacer: false,
    subtotalOnTop: false,
    subtotalStrategy: 'combined',
  }, overrides);
  invalidateValidation();
  const sourceCatalog = buildSourceCatalog();
  return buildQueryPlan(null, null, null, sourceCatalog);
}

describe('Query Plan — detail mode', () => {
  it('should build a plan with base table and default columns', () => {
    const p = plan();
    expect(p.source.base).toBe('Orders');
    expect(p.source.baseCols).toEqual(
      expect.arrayContaining(['OrderId', 'Company', 'Amount'])
    );
    expect(p.aggMode).toBe('none');
    expect(p.joins).toEqual([]);
    expect(p.calculatedColumns).toEqual([]);
    expect(p.filters).toEqual([]);
    expect(p.sorts).toEqual([]);
    expect(p.groupBy).toEqual([]);
    expect(p.aggregates).toEqual([]);
  });

  it('should include all base columns in selectedColumns when no selCols', () => {
    const p = plan();
    expect(p.selectedColumns).toEqual(
      expect.arrayContaining(['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'])
    );
  });

  it('should filter selectedColumns by selCols when set', () => {
    const p = plan({ selCols: new Set(['OrderId', 'Amount']) });
    expect(p.selectedColumns).toEqual(['OrderId', 'Amount']);
  });

  it('should respect colOrder for selectedColumns ordering', () => {
    const p = plan({ colOrder: ['Amount', 'OrderId', 'Company'] });
    expect(p.selectedColumns).toEqual(['Amount', 'OrderId', 'Company']);
  });
});

describe('Query Plan — filters and sorts', () => {
  it('should include enabled filters', () => {
    const p = plan({
      filters: [
        { col: 'Status', op: '=', val: 'Open', vals: ['Open'], enabled: true },
        { col: 'Region', op: '=', val: 'North', vals: ['North'], enabled: false },
      ],
    });
    expect(p.filters).toHaveLength(1);
    expect(p.filters[0].col).toBe('Status');
  });

  it('should skip filters with no col', () => {
    const p = plan({
      filters: [{ col: '', op: '=', val: '', vals: [], enabled: true }],
    });
    expect(p.filters).toHaveLength(0);
  });

  it('should include enabled sorts referencing valid columns', () => {
    const p = plan({
      sorts: [
        { col: 'Amount', dir: 'DESC', enabled: true },
        { col: 'FakeCol', dir: 'ASC', enabled: true },
        { col: 'OrderId', dir: 'ASC', enabled: false },
      ],
    });
    expect(p.sorts).toHaveLength(1);
    expect(p.sorts[0].col).toBe('Amount');
  });
});

describe('Query Plan — grouped mode', () => {
  it('should include groupBy and aggregates', () => {
    const p = plan({
      aggMode: 'group',
      groupBy: ['Region'],
      aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'Total Amount' }],
    });
    expect(p.aggMode).toBe('group');
    expect(p.groupBy).toEqual(['Region']);
    expect(p.aggregates).toHaveLength(1);
    expect(p.aggregates[0].fn).toBe('SUM');
  });
});

describe('Query Plan — totals mode', () => {
  it('should include colTotals', () => {
    const p = plan({
      aggMode: 'totals',
      colTotals: { Amount: 'SUM', OrderId: 'COUNT ROWS' },
    });
    expect(p.aggMode).toBe('totals');
    expect(p.colTotals).toEqual({ Amount: 'SUM', OrderId: 'COUNT ROWS' });
  });
});

describe('Query Plan — subtotals mode', () => {
  it('should include subtotal configuration', () => {
    const p = plan({
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalGrandTotal: true,
      subtotalSpacer: true,
      subtotalOnTop: true,
      subtotalStrategy: 'nested',
    });
    expect(p.aggMode).toBe('subtotals');
    expect(p.subtotalBy).toEqual(['Region']);
    expect(p.subtotalFns).toEqual({ Amount: 'SUM' });
    expect(p.subtotalGrandTotal).toBe(true);
    expect(p.subtotalSpacer).toBe(true);
    expect(p.subtotalOnTop).toBe(true);
    expect(p.subtotalStrategy).toBe('nested');
  });

  it('should default subtotalGrandTotal to true when not set', () => {
    const p = plan({ aggMode: 'subtotals' });
    expect(p.subtotalGrandTotal).toBe(true);
  });
});

describe('Query Plan — lookups / joins', () => {
  it('should include enabled lookups with complete key pairs as joins', () => {
    const p = plan({
      lookups: [
        {
          rightId: 'Contacts',
          keyPairs: [{ left: 'Company', right: 'Company' }],
          enabled: true,
          required: false,
          duplicatePolicy: { mode: 'combine' },
        },
      ],
    });
    expect(p.joins).toHaveLength(1);
    expect(p.joins[0].rightId).toBe('Contacts');
    expect(p.joins[0].rightTableName).toBe('Contacts');
    expect(p.joins[0].keyPairs).toEqual([{ left: 'Company', right: 'Company' }]);
    expect(p.joins[0].required).toBe(false);
    expect(p.joins[0].duplicatePolicy.mode).toBe('combine');
  });

  it('should exclude disabled lookups', () => {
    const p = plan({
      lookups: [
        {
          rightId: 'Contacts',
          keyPairs: [{ left: 'Company', right: 'Company' }],
          enabled: false,
        },
      ],
    });
    expect(p.joins).toHaveLength(0);
  });

  it('should exclude lookups with no complete key pairs', () => {
    const p = plan({
      lookups: [
        { rightId: 'Contacts', keyPairs: [{ left: '', right: 'Company' }], enabled: true },
      ],
    });
    expect(p.joins).toHaveLength(0);
  });

  it('should exclude lookups referencing missing tables', () => {
    const p = plan({
      lookups: [
        { rightId: 'NonExistent', keyPairs: [{ left: 'Company', right: 'Company' }], enabled: true },
      ],
    });
    expect(p.joins).toHaveLength(0);
  });
});

describe('Query Plan — calculated columns', () => {
  it('should include valid calc entries in calculatedColumns', () => {
    const p = plan({
      calcStages: [
        {
          alias: 'Doubled',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { op: '*', type: 'number', value: '2' },
            ],
          },
        },
      ],
    });
    expect(p.calculatedColumns).toHaveLength(1);
    expect(p.calculatedColumns[0].kind).toBe('calc');
  });

  it('should not include invalid calc stages in calculatedColumns', () => {
    const p = plan({
      calcStages: [
        { alias: 'Bad', mode: 'math', math: {} },
      ],
    });
    expect(p.calculatedColumns).toHaveLength(0);
  });
});

describe('Query Plan — source structure', () => {
  it('should populate tablesById from sourceCatalog', () => {
    const p = plan();
    expect(p.source.tablesById.has('Orders')).toBe(true);
    expect(p.source.tablesById.has('Contacts')).toBe(true);
    expect(p.source.tablesById.get('Orders')!.cols).toContain('OrderId');
  });

  it('should filter stacks to only include known tables', () => {
    const p = plan({ stacks: ['Orders', 'Ghost'] });
    expect(p.source.stacks).toEqual(['Orders']);
  });

  it('should throw when sourceCatalog is not a Map', () => {
    const buildQueryPlan = (globalThis as any).buildQueryPlan;
    expect(() => buildQueryPlan(null, null, null, null)).toThrow('sourceCatalog');
  });
});

describe('Query Plan — validation attachment', () => {
  it('should include validation result in plan', () => {
    const p = plan();
    expect(p.validation).toBeTruthy();
    expect(p.validation.reportStatus).toBe('healthy');
  });
});
