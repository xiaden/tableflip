import { describe, it, expect } from 'vitest';

function setupDb(overrides: Record<string, unknown> = {}) {
  const db = (globalThis as any).db;
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
    mergedCols: [],
  }, overrides);
  invalidateValidation();
  return db;
}

function getValidation() {
  return (globalThis as any).getValidation();
}

describe('Validation — healthy baseline', () => {
  it('should be healthy with default Orders base', () => {
    setupDb();
    const v = getValidation();
    expect(v).toBeTruthy();
    expect(v.reportStatus).toBe('healthy');
  });

  it('should have a pipeline card that is healthy', () => {
    setupDb();
    const v = getValidation();
    expect(v.cards['pipeline']).toBeTruthy();
    expect(v.cards['pipeline'].status).toBe('healthy');
  });
});

describe('Validation — missing base table', () => {
  it('should block when base table does not exist', () => {
    setupDb({ base: 'NonExistent' });
    const v = getValidation();
    expect(v.reportStatus).toBe('blocked');
    expect(v.items['base'].blocking).toBe(true);
    expect(v.items['base'].issues[0].id).toBe('base_missing');
  });

  it('should block when base is empty string', () => {
    setupDb({ base: '' });
    const v = getValidation();
    expect(v.reportStatus).toBe('blocked');
    expect(v.items['base'].blocking).toBe(true);
  });
});

describe('Validation — missing lookup table', () => {
  it('should block when lookup references a missing table', () => {
    setupDb({
      lookups: [
        { rightId: 'Ghost', keyPairs: [{ left: 'Company', right: 'Company' }], enabled: true },
      ],
    });
    const v = getValidation();
    expect(v.reportStatus).toBe('blocked');
    expect(v.items['lookup_0'].blocking).toBe(true);
    expect(v.items['lookup_0'].issues.some((i: any) => i.id === 'lookup_0_missing_table')).toBe(true);
  });

  it('should not block when lookup is disabled even if table is missing', () => {
    setupDb({
      lookups: [
        { rightId: 'Ghost', keyPairs: [{ left: 'Company', right: 'Company' }], enabled: false },
      ],
    });
    const v = getValidation();
    expect(v.items['lookup_0'].blocking).toBe(false);
  });

  it('should block when lookup right column does not exist', () => {
    setupDb({
      lookups: [
        { rightId: 'Contacts', keyPairs: [{ left: 'Company', right: 'NoSuchCol' }], enabled: true },
      ],
    });
    const v = getValidation();
    expect(v.items['lookup_0'].resolved).toBe(false);
    expect(v.items['lookup_0'].issues.some((i: any) => i.id.includes('kp0_right'))).toBe(true);
  });

  it('should block when lookup has no complete key pairs', () => {
    setupDb({
      lookups: [
        { rightId: 'Contacts', keyPairs: [{ left: '', right: '' }], enabled: true },
      ],
    });
    const v = getValidation();
    expect(v.items['lookup_0'].resolved).toBe(false);
    expect(v.items['lookup_0'].issues.some((i: any) => i.id === 'lookup_0_no_key_pairs')).toBe(true);
  });
});

describe('Validation — invalid calc stages', () => {
  it('should block when calc has no alias', () => {
    setupDb({
      calcStages: [{ alias: '', mode: 'math', math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }] } }],
    });
    const v = getValidation();
    expect(v.items['calc_0'].resolved).toBe(false);
    expect(v.items['calc_0'].issues.some((i: any) => i.id === 'calc_0_no_alias')).toBe(true);
  });

  it('should block when calc has invalid mode', () => {
    setupDb({
      calcStages: [{ alias: 'X', mode: 'bogus' }],
    });
    const v = getValidation();
    expect(v.items['calc_0'].issues.some((i: any) => i.id === 'calc_0_expr_error')).toBe(true);
  });

  it('should block when math calc references unavailable column', () => {
    setupDb({
      calcStages: [{
        alias: 'Bad',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'NoSuchColumn' },
            { op: '+', type: 'number', value: '1' },
          ],
        },
      }],
    });
    const v = getValidation();
    expect(v.items['calc_0'].resolved).toBe(false);
  });
});

describe('Validation — missing columns in filters/sorts', () => {
  it('should block when filter references unavailable column', () => {
    setupDb({
      filters: [{ col: 'GhostCol', op: '=', val: 'x', vals: ['x'], enabled: true }],
    });
    const v = getValidation();
    expect(v.items['filter_0'].resolved).toBe(false);
    expect(v.items['filter_0'].issues.some((i: any) => i.id === 'filter_0_missing_col')).toBe(true);
  });

  it('should block when filter vals is not an array', () => {
    setupDb({
      filters: [{ col: 'Status', op: '=', val: 'Open', vals: 'not-array', enabled: true }],
    });
    const v = getValidation();
    expect(v.items['filter_0'].resolved).toBe(false);
    expect(v.items['filter_0'].issues.some((i: any) => i.id === 'filter_0_bad_vals')).toBe(true);
  });

  it('should block when sort references unavailable column', () => {
    setupDb({
      sorts: [{ col: 'FakeCol', dir: 'ASC', enabled: true }],
    });
    const v = getValidation();
    expect(v.items['sort_0'].resolved).toBe(false);
    expect(v.items['sort_0'].issues.some((i: any) => i.id === 'sort_0_missing_col')).toBe(true);
  });

  it('should not block on disabled filter with missing column', () => {
    setupDb({
      filters: [{ col: 'GhostCol', op: '=', val: 'x', vals: ['x'], enabled: false }],
    });
    const v = getValidation();
    expect(v.items['filter_0'].blocking).toBe(false);
  });
});

describe('Validation — invalid aggMode', () => {
  it('should block on unknown aggMode', () => {
    setupDb({ aggMode: 'banana' });
    const v = getValidation();
    expect(v.items['aggMode'].blocking).toBe(true);
    expect(v.items['aggMode'].issues[0].id).toBe('aggMode_invalid');
  });
});

describe('Validation — group mode issues', () => {
  it('should block when groupBy references unavailable column', () => {
    setupDb({
      aggMode: 'group',
      groupBy: ['NonExistent'],
      aggregates: [],
    });
    const v = getValidation();
    expect(v.items['groupby_0'].resolved).toBe(false);
  });

  it('should block when aggregate has invalid function', () => {
    setupDb({
      aggMode: 'group',
      groupBy: ['Region'],
      aggregates: [{ fn: 'BOGUS', col: 'Amount', alias: 'Bad' }],
    });
    const v = getValidation();
    expect(v.items['agg_0'].resolved).toBe(false);
    expect(v.items['agg_0'].issues.some((i: any) => i.id === 'agg_0_invalid_fn')).toBe(true);
  });
});

describe('Validation — totals mode issues', () => {
  it('should block when totals column is unavailable', () => {
    setupDb({
      aggMode: 'totals',
      colTotals: { GhostCol: 'SUM' },
    });
    const v = getValidation();
    expect(v.items['totals_GhostCol'].resolved).toBe(false);
  });

  it('should block when totals function is invalid', () => {
    setupDb({
      aggMode: 'totals',
      colTotals: { Amount: 'BOGUS' },
    });
    const v = getValidation();
    expect(v.items['totals_Amount'].resolved).toBe(false);
    expect(v.items['totals_Amount'].issues.some((i: any) => i.id === 'totals_Amount_invalid_fn')).toBe(true);
  });
});

describe('Validation — subtotals mode issues', () => {
  it('should block when subtotalBy references unavailable column', () => {
    setupDb({
      aggMode: 'subtotals',
      subtotalBy: ['FakeCol'],
      subtotalFns: {},
    });
    const v = getValidation();
    expect(v.items['subtotalby_0'].resolved).toBe(false);
  });

  it('should block when subtotal function is invalid', () => {
    setupDb({
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'BOGUS' },
    });
    const v = getValidation();
    expect(v.items['subtotalfns_Amount'].resolved).toBe(false);
    expect(v.items['subtotalfns_Amount'].issues.some((i: any) => i.id === 'subtotalfns_Amount_invalid_fn')).toBe(true);
  });

  it('should block on unknown subtotal strategy', () => {
    setupDb({
      aggMode: 'subtotals',
      subtotalStrategy: 'weird',
    });
    const v = getValidation();
    expect(v.items['subtotalStrategy'].blocking).toBe(true);
  });
});

describe('Validation — cache invalidation', () => {
  it('should return cached result on consecutive calls', () => {
    setupDb();
    const v1 = getValidation();
    const v2 = getValidation();
    expect(v1).toBe(v2);
  });

  it('should recompute after invalidateValidation', () => {
    setupDb();
    const v1 = getValidation();
    expect(v1.reportStatus).toBe('healthy');

    const db = (globalThis as any).db;
    db.base = 'NonExistent';
    const invalidateValidation = (globalThis as any).invalidateValidation;
    invalidateValidation();
    const v2 = getValidation();
    expect(v2.reportStatus).toBe('blocked');
    expect(v1).not.toBe(v2);
  });
});

describe('Validation — missing stack table', () => {
  it('should block when a stacked sheet is missing', () => {
    setupDb({ stacks: ['Ghost'] });
    const v = getValidation();
    expect(v.items['stack_0'].blocking).toBe(true);
    expect(v.items['stack_0'].issues[0].id).toBe('stack_0_missing');
  });
});
