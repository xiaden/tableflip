import { describe, it, expect, beforeEach } from 'vitest';

describe('State Hydrator', () => {
  let hydrateState: any;

  beforeEach(async () => {
    const module = await import('../../js/core/state-hydrator.js');
    hydrateState = module.hydrateState;
    const db = (globalThis as any).db;
    db.tables = {
      Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 8 },
      Contacts: { id: 'Contacts', name: 'Contacts', cols: ['Company', 'Contact', 'Email', 'Phone'], rowCount: 9 },
    };
    db.base = 'Orders';
    db.stacks = [];
    db.lookups = [];
    db.calcStages = [];
    db.selCols = null;
    db.colOrder = null;
    db.filters = [];
    db.groupBy = [];
    db.aggregates = [];
    db.aggMode = 'none';
    db.aggModeState = null;
    db.sorts = [];
    db.result = null;
    db.excludedRows = {};
  });

  it('should hydrate with valid payload', () => {
    const payload = {
      base: 'Orders',
      baseCols: ['OrderId', 'Company', 'Amount'],
      stacks: [],
      lookups: [],
      calcStages: [],
      selCols: ['OrderId', 'Company'],
      colOrder: ['OrderId', 'Company', 'Amount'],
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
    const { next, brokenRefs, nextExcludedRows } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
    expect(next.base).toBe('Orders');
    expect(next.baseCols).toEqual(['OrderId', 'Company', 'Amount']);
    expect(next.selCols).toBeInstanceOf(Set);
    expect(next.selCols.has('OrderId')).toBe(true);
    expect(next.selCols.has('Company')).toBe(true);
    expect(next.colOrder).toEqual(['OrderId', 'Company', 'Amount']);
    expect(nextExcludedRows).toEqual({});
  });

  it('should preserve all fields', () => {
    const payload = {
      base: 'Orders',
      baseCols: null,
      stacks: ['Contacts'],
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email', 'Phone'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }],
      calcStages: [],
      selCols: null,
      colOrder: null,
      filters: [{ col: 'Amount', op: 'gt', vals: ['100'], enabled: true }],
      sorts: [{ col: 'OrderId', dir: 'DESC', enabled: true }],
      groupBy: ['Company'],
      aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'TotalAmount' }],
      aggMode: 'group',
      colTotals: { Amount: 'SUM' },
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalGrandTotal: true,
      subtotalSpacer: true,
      subtotalOnTop: true,
      subtotalStrategy: 'nested',
      mergedCols: ['Company'],
      mergeGroupUnderline: true,
    };
    const { next, brokenRefs } = hydrateState(payload);
    expect(next.stacks).toEqual(['Contacts']);
    expect(next.lookups).toHaveLength(1);
    expect(next.lookups[0].rightId).toBe('Contacts');
    expect(next.lookups[0].keyPairs).toEqual([{ left: 'Company', right: 'Company' }]);
    expect(next.filters).toHaveLength(1);
    expect(next.filters[0].col).toBe('Amount');
    expect(next.sorts).toHaveLength(1);
    expect(next.sorts[0].dir).toBe('DESC');
    expect(next.groupBy).toEqual(['Company']);
    expect(next.aggregates).toHaveLength(1);
    expect(next.aggMode).toBe('group');
    expect(next.colTotals).toEqual({ Amount: 'SUM' });
    expect(next.subtotalBy).toEqual(['Region']);
    expect(next.subtotalFns).toEqual({ Amount: 'SUM' });
    expect(next.subtotalGrandTotal).toBe(true);
    expect(next.subtotalSpacer).toBe(true);
    expect(next.subtotalOnTop).toBe(true);
    expect(next.subtotalStrategy).toBe('nested');
    expect(next.mergedCols).toEqual(['Company']);
    expect(next.mergeGroupUnderline).toBe(true);
  });

  it('should handle missing optional fields', () => {
    const payload = { base: 'Orders' };
    const { next, brokenRefs } = hydrateState(payload);
    expect(next.base).toBe('Orders');
    expect(next.baseCols).toBeNull();
    expect(next.stacks).toEqual([]);
    expect(next.lookups).toEqual([]);
    expect(next.calcStages).toEqual([]);
    expect(next.selCols).toBeNull();
    expect(next.colOrder).toBeNull();
    expect(next.filters).toEqual([]);
    expect(next.sorts).toEqual([]);
    expect(next.groupBy).toEqual([]);
    expect(next.aggregates).toEqual([]);
    expect(next.aggMode).toBe('none');
    expect(next.mergedCols).toEqual([]);
    expect(next.mergeGroupUnderline).toBe(false);
  });

  it('should hydrate with aggModeState', () => {
    const payload = {
      base: 'Orders',
      aggModeState: {
        none: { selCols: ['OrderId', 'Company'] },
        group: { groupBy: ['Company'], aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'Total', auto: true }] },
        totals: { selCols: ['OrderId', 'Amount'], colTotals: { Amount: 'SUM' } },
        subtotals: { selCols: ['OrderId', 'Company'], subtotalBy: ['Region'], subtotalFns: { Amount: 'SUM' }, subtotalGrandTotal: true, subtotalSpacer: false, subtotalOnTop: false, subtotalStrategy: 'combined' },
      },
    };
    const { next } = hydrateState(payload);
    expect(next.aggModeState).toBeTruthy();
    expect(next.aggModeState.none.selCols).toEqual(['OrderId', 'Company']);
    expect(next.aggModeState.group.groupBy).toEqual(['Company']);
    expect(next.aggModeState.group.aggregates).toHaveLength(1);
    expect(next.aggModeState.totals.selCols).toEqual(['OrderId', 'Amount']);
    expect(next.aggModeState.subtotals.subtotalBy).toEqual(['Region']);
  });

  it('should hydrate with excludedRows', () => {
    const payload = {
      base: 'Orders',
      excludedRows: { Orders: [0, 2, 5] },
    };
    const { nextExcludedRows } = hydrateState(payload);
    expect(nextExcludedRows).toBeTruthy();
    expect(nextExcludedRows.Orders).toBeInstanceOf(Set);
    expect(nextExcludedRows.Orders.has(0)).toBe(true);
    expect(nextExcludedRows.Orders.has(2)).toBe(true);
    expect(nextExcludedRows.Orders.has(5)).toBe(true);
    expect(nextExcludedRows.Orders.size).toBe(3);
  });

  it('should not crash with invalid data', () => {
    expect(() => hydrateState({} as any)).not.toThrow();
    expect(() => hydrateState({ base: 123 } as any)).not.toThrow();
    expect(() => hydrateState({ base: '', lookups: 'invalid' } as any)).not.toThrow();
  });

  it('should report broken refs for missing base table', () => {
    const payload = { base: 'NonExistent' };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.length).toBeGreaterThan(0);
    expect(brokenRefs[0]).toContain('NonExistent');
  });

  it('should handle selCols as null', () => {
    const payload = { base: 'Orders', selCols: null };
    const { next } = hydrateState(payload);
    expect(next.selCols).toBeNull();
  });

  it('should handle tableColors', () => {
    const payload = { base: 'Orders', tableColors: { Orders: '#FF0000', Contacts: '#00FF00' } };
    const { next } = hydrateState(payload);
    expect(next.tableColors).toEqual({ Orders: '#FF0000', Contacts: '#00FF00' });
  });

  it('should handle columnLabels', () => {
    const payload = { base: 'Orders', columnLabels: { Orders: { OrderId: 'Order ID' } } };
    const { next } = hydrateState(payload);
    expect(next.columnLabels).toEqual({ Orders: { OrderId: 'Order ID' } });
  });

  it('should report broken refs for dropped baseCols', () => {
    const payload = { base: 'Orders', baseCols: ['OrderId', 'FakeCol'] };
    const { brokenRefs } = hydrateState(payload) as { brokenRefs: string[] };
    expect(brokenRefs.some((r: string) => r.includes('Base columns not available'))).toBe(true);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
  });

  it('should report broken refs for missing stacked sheets', () => {
    const payload = { base: 'Orders', stacks: ['MissingSheet'] };
    const { brokenRefs, next } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('MissingSheet'))).toBe(true);
    expect(next.stacks).toContain('MissingSheet');
  });

  it('should not duplicate stacks', () => {
    const payload = { base: 'Orders', stacks: ['Contacts', 'Contacts'] };
    const { next } = hydrateState(payload);
    expect(next.stacks).toEqual(['Contacts']);
  });

  it('should handle lookups with missing right table', () => {
    const payload = {
      base: 'Orders',
      lookups: [{
        rightId: 'MissingTable',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
        required: true,
        enabled: true,
        duplicatePolicy: { mode: 'overwrite' },
      }],
    };
    const { brokenRefs, next } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('MissingTable'))).toBe(true);
    expect(next.lookups).toHaveLength(1);
    expect(next.lookups[0].rightId).toBe('MissingTable');
    expect(next.lookups[0].duplicatePolicy).toEqual({ mode: 'overwrite' });
  });

  it('should handle lookups with no rightId', () => {
    const payload = {
      base: 'Orders',
      lookups: [{ keyPairs: [{ left: 'A', right: 'B' }] }],
    };
    const { brokenRefs, next } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('(none)'))).toBe(true);
    expect(next.lookups[0].rightId).toBe('');
  });

  it('should handle lookups with invalid keyPairs and cols', () => {
    const payload = {
      base: 'Orders',
      lookups: [{ rightId: 'MissingTable', keyPairs: 'invalid', cols: 'invalid' }],
    };
    const { next } = hydrateState(payload);
    expect(next.lookups[0].keyPairs).toEqual([{ left: '', right: '' }]);
    expect(next.lookups[0].cols).toEqual([]);
  });

  it('should report broken refs for lookup key pairs with unavailable columns', () => {
    const payload = {
      base: 'Orders',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'FakeLeft', right: 'FakeRight' }],
        cols: ['Email'],
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeLeft'))).toBe(true);
    expect(brokenRefs.some((r: string) => r.includes('FakeRight'))).toBe(true);
  });

  it('should handle calcStages with invalid mode', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'invalid' }],
    };
    const { brokenRefs, next } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('unsupported or missing mode'))).toBe(true);
    expect(next.calcStages).toHaveLength(1);
  });

  it('should handle calcStages with missing mode', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1' }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('unsupported or missing mode'))).toBe(true);
  });

  it('should handle calcStages with no alias', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ mode: 'math' }],
    };
    const { brokenRefs, next } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('no alias'))).toBe(true);
    expect(next.calcStages[0].alias).toBe('');
  });

  it('should report broken refs for math calcStage referencing unavailable column', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{
        alias: 'Calc1',
        mode: 'math',
        math: { steps: [{ type: 'column', value: 'FakeCol' }] },
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
  });

  it('should handle math calcStage with non-column steps', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{
        alias: 'Calc1',
        mode: 'math',
        math: { steps: [{ type: 'number', value: '42' }] },
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should report broken refs for compare calcStage conditions', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{
        alias: 'Calc1',
        mode: 'compare',
        compare: {
          conditions: [{ col: 'FakeCol' }],
          trueValue: { type: 'column', value: 'FakeTrue' },
          falseValue: { type: 'column', value: 'FakeFalse' },
        },
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
    expect(brokenRefs.some((r: string) => r.includes('FakeTrue'))).toBe(true);
    expect(brokenRefs.some((r: string) => r.includes('FakeFalse'))).toBe(true);
  });

  it('should handle compare calcStage with non-column values', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{
        alias: 'Calc1',
        mode: 'compare',
        compare: {
          conditions: [{ col: 'Amount' }],
          trueValue: { type: 'literal', value: 'Yes' },
          falseValue: { type: 'literal', value: 'No' },
        },
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should report broken refs for text calcStage combine parts', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{
        alias: 'Calc1',
        mode: 'text',
        text: {
          operation: 'combine',
          parts: [{ type: 'column', value: 'FakeCol' }],
          source: { type: 'column', value: 'FakeSource' },
        },
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
    expect(brokenRefs.some((r: string) => r.includes('FakeSource'))).toBe(true);
  });

  it('should handle text calcStage with non-column parts', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{
        alias: 'Calc1',
        mode: 'text',
        text: {
          operation: 'combine',
          parts: [{ type: 'literal', value: 'hello' }],
          source: { type: 'literal', value: 'world' },
        },
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should report broken refs for date calcStage extract', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{
        alias: 'Calc1',
        mode: 'date',
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'FakeDate' },
        },
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeDate'))).toBe(true);
  });

  it('should handle date calcStage with non-column source', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{
        alias: 'Calc1',
        mode: 'date',
        date: {
          operation: 'extract',
          source: { type: 'literal', value: '2024-01-01' },
        },
      }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should handle calcStage with enabled false', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'math', enabled: false }],
    };
    const { next } = hydrateState(payload);
    expect(next.calcStages[0].enabled).toBe(false);
  });

  it('should report broken refs for selCols with unavailable columns', () => {
    const payload = { base: 'Orders', selCols: ['OrderId', 'FakeCol'] };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('Selected columns not available'))).toBe(true);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
  });

  it('should report broken refs for filters on unavailable columns', () => {
    const payload = {
      base: 'Orders',
      filters: [{ col: 'FakeCol', op: 'contains', vals: ['x'] }],
    };
    const { brokenRefs, next } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
    expect(next.filters[0].col).toBe('FakeCol');
  });

  it('should handle filters with defaults', () => {
    const payload = {
      base: 'Orders',
      filters: [{ enabled: false }],
    };
    const { next } = hydrateState(payload);
    expect(next.filters[0].col).toBe('');
    expect(next.filters[0].op).toBe('contains');
    expect(next.filters[0].enabled).toBe(false);
  });

  it('should report broken refs for groupBy with unavailable columns', () => {
    const payload = { base: 'Orders', groupBy: ['FakeGroup'] };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('Group By columns not available'))).toBe(true);
  });

  it('should report broken refs for aggregates on unavailable columns', () => {
    const payload = {
      base: 'Orders',
      aggregates: [{ fn: 'SUM', col: 'FakeCol', alias: 'Total' }],
    };
    const { brokenRefs, next } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
    expect(next.aggregates[0]).toEqual({ fn: 'SUM', col: 'FakeCol', alias: 'Total' });
  });

  it('should handle aggregates with defaults', () => {
    const payload = {
      base: 'Orders',
      aggregates: [{}],
    };
    const { next } = hydrateState(payload);
    expect(next.aggregates[0]).toEqual({ fn: 'SUM', col: '*', alias: '' });
  });

  it('should not report broken refs for aggregate on * column', () => {
    const payload = {
      base: 'Orders',
      aggregates: [{ fn: 'COUNT', col: '*' }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.filter((r: string) => r.includes('*'))).toEqual([]);
  });

  it('should report broken refs for sorts on unavailable columns', () => {
    const payload = {
      base: 'Orders',
      sorts: [{ col: 'FakeCol', dir: 'ASC' }],
    };
    const { brokenRefs, next } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
    expect(next.sorts[0].dir).toBe('ASC');
  });

  it('should handle sorts with defaults', () => {
    const payload = {
      base: 'Orders',
      sorts: [{ enabled: false }],
    };
    const { next } = hydrateState(payload);
    expect(next.sorts[0].col).toBe('');
    expect(next.sorts[0].dir).toBe('ASC');
    expect(next.sorts[0].enabled).toBe(false);
  });

  it('should report broken refs for colTotals on unavailable columns', () => {
    const payload = { base: 'Orders', colTotals: { FakeCol: 'SUM' } };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
  });

  it('should report broken refs for subtotalBy with unavailable columns', () => {
    const payload = { base: 'Orders', subtotalBy: ['FakeSub'] };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('Subtotal By columns not available'))).toBe(true);
  });

  it('should report broken refs for subtotalFns on unavailable columns', () => {
    const payload = { base: 'Orders', subtotalFns: { FakeCol: 'SUM' } };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs.some((r: string) => r.includes('FakeCol'))).toBe(true);
  });

  it('should handle subtotalGrandTotal default', () => {
    const payload = { base: 'Orders' };
    const { next } = hydrateState(payload);
    expect(next.subtotalGrandTotal).toBe(true);
  });

  it('should handle subtotalStrategy default', () => {
    const payload = { base: 'Orders', subtotalStrategy: 'other' };
    const { next } = hydrateState(payload);
    expect(next.subtotalStrategy).toBe('combined');
  });

  it('should handle aggModeState as non-object', () => {
    const payload = { base: 'Orders', aggModeState: 'invalid' };
    const { next } = hydrateState(payload);
    expect(next.aggModeState).toBeNull();
  });

  it('should handle aggModeState with null sub-objects', () => {
    const payload = {
      base: 'Orders',
      aggModeState: { none: null, group: null, totals: null, subtotals: null },
    };
    const { next } = hydrateState(payload);
    expect(next.aggModeState.none).toBeNull();
    expect(next.aggModeState.group).toBeNull();
    expect(next.aggModeState.totals).toBeNull();
    expect(next.aggModeState.subtotals).toBeNull();
  });

  it('should handle aggModeState group with defaults', () => {
    const payload = {
      base: 'Orders',
      aggModeState: {
        group: { groupBy: 'invalid', aggregates: 'invalid' },
      },
    };
    const { next } = hydrateState(payload);
    expect(next.aggModeState.group.groupBy).toEqual([]);
    expect(next.aggModeState.group.aggregates).toEqual([]);
  });

  it('should handle aggModeState totals with defaults', () => {
    const payload = {
      base: 'Orders',
      aggModeState: {
        totals: { selCols: 'invalid', colTotals: 'invalid' },
      },
    };
    const { next } = hydrateState(payload);
    expect(next.aggModeState.totals.selCols).toBeNull();
    expect(next.aggModeState.totals.colTotals).toEqual({});
  });

  it('should handle aggModeState subtotals with defaults', () => {
    const payload = {
      base: 'Orders',
      aggModeState: {
        subtotals: {
          selCols: 'invalid',
          subtotalBy: 'invalid',
          subtotalFns: 'invalid',
          subtotalGrandTotal: false,
          subtotalSpacer: true,
          subtotalOnTop: true,
          subtotalStrategy: 'nested',
        },
      },
    };
    const { next } = hydrateState(payload);
    expect(next.aggModeState.subtotals.selCols).toBeNull();
    expect(next.aggModeState.subtotals.subtotalBy).toEqual([]);
    expect(next.aggModeState.subtotals.subtotalFns).toEqual({});
    expect(next.aggModeState.subtotals.subtotalGrandTotal).toBe(false);
    expect(next.aggModeState.subtotals.subtotalSpacer).toBe(true);
    expect(next.aggModeState.subtotals.subtotalOnTop).toBe(true);
    expect(next.aggModeState.subtotals.subtotalStrategy).toBe('nested');
  });

  it('should handle colState', () => {
    const payload = { base: 'Orders', colState: [{ col: 'OrderId', width: 100 }] };
    const { next } = hydrateState(payload);
    expect(next.colState).toEqual([{ col: 'OrderId', width: 100 }]);
  });

  it('should handle colState as non-array', () => {
    const payload = { base: 'Orders', colState: 'invalid' };
    const { next } = hydrateState(payload);
    expect(next.colState).toBeNull();
  });

  it('should filter non-string mergedCols', () => {
    const payload = { base: 'Orders', mergedCols: ['Company', 123, null, 'Region'] };
    const { next } = hydrateState(payload);
    expect(next.mergedCols).toEqual(['Company', 'Region']);
  });

  it('should handle excludedRows with empty arrays', () => {
    const payload = { base: 'Orders', excludedRows: { Orders: [] } };
    const { nextExcludedRows } = hydrateState(payload);
    expect(nextExcludedRows.Orders).toBeUndefined();
  });

  it('should ignore invalid tableColors', () => {
    const payload = { base: 'Orders', tableColors: { Orders: 'red', Contacts: '#00FF00' } };
    const { next } = hydrateState(payload);
    expect(next.tableColors).toEqual({ Contacts: '#00FF00' });
  });

  it('should ignore columnLabels where label equals col', () => {
    const payload = { base: 'Orders', columnLabels: { Orders: { OrderId: 'Order ID', Amount: 'Amount' } } };
    const { next } = hydrateState(payload);
    expect(next.columnLabels.Orders).toEqual({ OrderId: 'Order ID' });
  });

  it('should skip columnLabels entries that are not objects', () => {
    const payload = { base: 'Orders', columnLabels: { Orders: 'invalid' } };
    const { next } = hydrateState(payload);
    expect(next.columnLabels.Orders).toBeUndefined();
  });

  it('should handle lookup with default duplicatePolicy', () => {
    const payload = {
      base: 'Orders',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
      }],
    };
    const { next } = hydrateState(payload);
    expect(next.lookups[0].duplicatePolicy).toEqual({ mode: 'block' });
  });

  it('should handle lookup with enabled false', () => {
    const payload = {
      base: 'Orders',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
        enabled: false,
      }],
    };
    const { next } = hydrateState(payload);
    expect(next.lookups[0].enabled).toBe(false);
  });

  it('should handle lookup cols defaulting to right table cols', () => {
    const payload = {
      base: 'Orders',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
      }],
    };
    const { next } = hydrateState(payload);
    expect(next.lookups[0].cols).toEqual(['Company', 'Contact', 'Email', 'Phone']);
  });

  it('should handle aggMode as non-string', () => {
    const payload = { base: 'Orders', aggMode: 123 };
    const { next } = hydrateState(payload);
    expect(next.aggMode).toBe('none');
  });

  it('should handle calcStage math with no steps array', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'math', math: {} }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should handle calcStage compare with no conditions array', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'compare', compare: {} }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should handle calcStage text with no parts array', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'text', text: { operation: 'combine' } }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should handle calcStage date with no source', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'date', date: { operation: 'extract' } }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should handle calcStage date with non-extract operation', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'date', date: { operation: 'diff' } }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should handle calcStage text with no text object', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'text' }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should handle calcStage compare with no compare object', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'compare' }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });

  it('should handle calcStage math with no math object', () => {
    const payload = {
      base: 'Orders',
      calcStages: [{ alias: 'Calc1', mode: 'math' }],
    };
    const { brokenRefs } = hydrateState(payload);
    expect(brokenRefs).toEqual([]);
  });
});
