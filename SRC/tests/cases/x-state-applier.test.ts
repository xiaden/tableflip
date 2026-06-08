import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

vi.mock('../../js/ui/views/query-builder.js', () => ({
  renderQueryBuilder: vi.fn(),
}));
vi.mock('../../js/ui/views/output-card.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    renderMergeToggles: vi.fn(),
  };
});
vi.mock('../../js/ui/aggregation.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    loadAggModeState: vi.fn(),
  };
});

let applyState: any;
let invalidateValidation: any;
let getValidation: any;

beforeAll(async () => {
  const applierMod = await import('../../js/core/state-applier.js');
  const valMod = await import('../../js/report/validation.js');
  applyState = applierMod.applyState;
  invalidateValidation = valMod.invalidateValidation;
  getValidation = valMod.getValidation;
});

describe('State Applier', () => {
  let db: any;

  beforeEach(() => {
    db = (globalThis as any).db;
    invalidateValidation();
  });

  it('should apply state fields to db', () => {
    const next = {
      base: 'Orders',
      aggMode: 'group',
      groupBy: ['Region'],
      aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'TotalAmt' }],
    };
    applyState(next, {});
    expect(db.base).toBe('Orders');
    expect(db.aggMode).toBe('group');
    expect(db.groupBy).toEqual(['Region']);
    expect(db.aggregates).toHaveLength(1);
    expect(db.aggregates[0].fn).toBe('SUM');
  });

  it('should apply excludedRows', () => {
    const next = { base: 'Orders' };
    const excludedRows = { Orders: new Set([0, 2, 4]) };
    applyState(next, excludedRows);
    expect(db.excludedRows['Orders']).toBeInstanceOf(Set);
    expect(db.excludedRows['Orders'].has(0)).toBe(true);
    expect(db.excludedRows['Orders'].has(2)).toBe(true);
    expect(db.excludedRows['Orders'].has(4)).toBe(true);
    expect(db.excludedRows['Orders'].size).toBe(3);
  });

  it('should apply partial state without overwriting unrelated fields', () => {
    db.base = 'Orders';
    db.filters = [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }];
    db.sorts = [{ col: 'Amount', dir: 'DESC', enabled: true }];

    const next = { aggMode: 'totals', colTotals: { Amount: 'SUM' } };
    applyState(next, {});

    expect(db.aggMode).toBe('totals');
    expect(db.colTotals).toEqual({ Amount: 'SUM' });
    expect(db.filters).toHaveLength(1);
    expect(db.sorts).toHaveLength(1);
  });

  it('should invalidate validation after applying state', () => {
    getValidation();
    const next = { aggMode: 'group', groupBy: ['Region'], aggregates: [] };
    applyState(next, {});
    const v = getValidation();
    expect(v).toBeTruthy();
  });

  it('should apply all major state fields', () => {
    const next = {
      base: 'Orders',
      baseCols: ['OrderId', 'Company'],
      stacks: [],
      lookups: [],
      calcStages: [],
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
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
      mergeGroupUnderline: false,
    };
    applyState(next, {});

    expect(db.base).toBe('Orders');
    expect(db.baseCols).toEqual(['OrderId', 'Company']);
    expect(db.selCols).toBeInstanceOf(Set);
    expect(db.selCols.has('OrderId')).toBe(true);
    expect(db.colOrder).toEqual(['OrderId', 'Company']);
    expect(db.aggMode).toBe('none');
    expect(db.subtotalGrandTotal).toBe(true);
  });

  it('should apply multiple excludedRows entries', () => {
    const next = { base: 'Orders' };
    const excludedRows = {
      Orders: new Set([1, 3]),
      Contacts: new Set([0]),
    };
    applyState(next, excludedRows);
    expect(db.excludedRows['Orders']).toBeInstanceOf(Set);
    expect(db.excludedRows['Orders'].size).toBe(2);
    expect(db.excludedRows['Contacts']).toBeInstanceOf(Set);
    expect(db.excludedRows['Contacts'].size).toBe(1);
  });

  it('should handle empty state and empty excludedRows', () => {
    db.aggMode = 'group';
    applyState({}, {});
    expect(db.aggMode).toBe('group');
  });
});
