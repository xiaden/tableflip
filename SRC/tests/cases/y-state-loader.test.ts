import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STATE_VERSION } from '../../js/core/state-schema.js';
import * as utils from '../../js/core/utils.js';

vi.mock('../../js/core/utils.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    toast: vi.fn(),
  };
});

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

describe('State Loader', () => {
  let db: any;
  let loadState: any;

  beforeEach(async () => {
    db = (globalThis as any).db;
    const mod = await import('../../js/core/state-loader.js');
    loadState = mod.loadState;
    (utils.toast as any).mockClear();
  });

  function makeFile(payload: unknown): File {
    return new File([JSON.stringify(payload)], 'test.rcjson', { type: 'application/json' });
  }

  function waitForLoad(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('should load a valid state file and apply it', async () => {
    const payload = {
      v: STATE_VERSION,
      base: 'Orders',
      baseCols: ['OrderId', 'Company'],
      aggMode: 'none',
      filters: [],
      sorts: [],
      colOrder: ['OrderId', 'Company'],
      selCols: ['OrderId', 'Company'],
    };
    const file = makeFile(payload);
    loadState(file);
    await waitForLoad();
    expect(db.base).toBe('Orders');
    expect(db.baseCols).toEqual(['OrderId', 'Company']);
    expect(db.aggMode).toBe('none');
  });

  it('should toast error for invalid JSON', async () => {
    const file = new File(['not valid json{{{'], 'bad.rcjson', { type: 'application/json' });
    loadState(file);
    await waitForLoad();
    expect((utils.toast as any)).toHaveBeenCalledWith(expect.stringContaining('Could not parse'), 'err');
  });

  it('should toast error for non-object JSON', async () => {
    const file = makeFile([1, 2, 3]);
    loadState(file);
    await waitForLoad();
    expect((utils.toast as any)).toHaveBeenCalledWith(expect.stringContaining('Invalid state file'), 'err');
  });

  it('should toast error for non-recognizable config', async () => {
    const file = makeFile({ foo: 'bar', baz: 123 });
    loadState(file);
    await waitForLoad();
    expect((utils.toast as any)).toHaveBeenCalledWith(expect.stringContaining('does not appear'), 'err');
  });

  it('should apply all state fields from payload', async () => {
    const payload = {
      v: STATE_VERSION,
      base: 'Orders',
      baseCols: null,
      stacks: [],
      lookups: [],
      calcStages: [],
      selCols: null,
      colOrder: null,
      filters: [{ col: 'Amount', op: 'gt', vals: ['100'], enabled: true }],
      sorts: [{ col: 'OrderId', dir: 'DESC', enabled: true }],
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
    const file = makeFile(payload);
    loadState(file);
    await waitForLoad();
    expect(db.base).toBe('Orders');
    expect(db.filters).toHaveLength(1);
    expect(db.filters[0].col).toBe('Amount');
    expect(db.sorts).toHaveLength(1);
    expect(db.sorts[0].dir).toBe('DESC');
  });

  it('should warn on version mismatch', async () => {
    const payload = {
      v: 999,
      base: 'Orders',
      aggMode: 'none',
      filters: [],
      sorts: [],
    };
    const file = makeFile(payload);
    loadState(file);
    await waitForLoad();
    expect((utils.toast as any)).toHaveBeenCalledWith(expect.stringContaining('Version mismatch'), 'warn');
  });

  it('should load state successfully for valid config', async () => {
    const payload = {
      v: STATE_VERSION,
      base: 'Orders',
      aggMode: 'none',
      filters: [],
      sorts: [],
    };
    const file = makeFile(payload);
    loadState(file);
    await waitForLoad();
    expect(db.base).toBe('Orders');
    expect(db.aggMode).toBe('none');
    const toastCalls = (utils.toast as any).mock.calls;
    const hasOkOrWarn = toastCalls.some((c: any[]) => c[1] === 'ok' || c[1] === 'warn');
    expect(hasOkOrWarn).toBe(true);
  });

  it('should apply excludedRows from payload', async () => {
    const payload = {
      v: STATE_VERSION,
      base: 'Orders',
      aggMode: 'none',
      excludedRows: { Orders: [0, 2, 4] },
      filters: [],
      sorts: [],
    };
    const file = makeFile(payload);
    loadState(file);
    await waitForLoad();
    expect(db.excludedRows['Orders']).toBeInstanceOf(Set);
    expect(db.excludedRows['Orders'].has(0)).toBe(true);
    expect(db.excludedRows['Orders'].has(2)).toBe(true);
    expect(db.excludedRows['Orders'].has(4)).toBe(true);
  });
});
