import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STATE_VERSION } from '../../js/core/state-schema.js';
import * as utils from '../../js/core/utils.js';

vi.mock('../../js/core/utils.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    dl: vi.fn(),
    toast: vi.fn(),
  };
});

describe('State Serializer', () => {
  let saveState: any;
  let capturedBlob: Blob | null = null;
  let capturedName: string | null = null;

  beforeEach(async () => {
    const module = await import('../../js/core/state-serializer.js');
    saveState = module.saveState;
    const db = (globalThis as any).db;
    db.tables = {
      Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 8 },
      Contacts: { id: 'Contacts', name: 'Contacts', cols: ['Company', 'Contact', 'Email', 'Phone'], rowCount: 9 },
    };
    db.base = 'Orders';
    db.baseCols = null;
    db.stacks = [];
    db.lookups = [];
    db.calcStages = [];
    db.selCols = null;
    db.colOrder = null;
    db.filters = [];
    db.sorts = [];
    db.groupBy = [];
    db.aggregates = [];
    db.aggMode = 'none';
    db.aggModeState = null;
    db.colTotals = {};
    db.subtotalBy = [];
    db.subtotalFns = {};
    db.subtotalGrandTotal = true;
    db.subtotalSpacer = false;
    db.subtotalOnTop = false;
    db.subtotalStrategy = 'combined';
    db.mergedCols = [];
    db.mergeGroupUnderline = false;
    db.colState = null;
    db.excludedRows = {};
    db.tableColors = {};
    db.columnLabels = {};
    db.result = null;

    capturedBlob = null;
    capturedName = null;
  });

  function captureSave(): Record<string, any> {
    vi.spyOn(window, 'prompt').mockReturnValue('test-query');
    (utils.dl as any).mockImplementation((blob: Blob, name: string) => {
      capturedBlob = blob;
      capturedName = name;
    });
    try {
      saveState();
    } finally {
      vi.restoreAllMocks();
    }
    return {};
  }

  async function getPayload(): Promise<Record<string, any>> {
    captureSave();
    if (!capturedBlob) throw new Error('No blob captured');
    const text = await capturedBlob.text();
    return JSON.parse(text);
  }

  it('should produce valid JSON', async () => {
    const payload = await getPayload();
    expect(payload).toBeTruthy();
    expect(typeof payload).toBe('object');
  });

  it('should include version field', async () => {
    const payload = await getPayload();
    expect(payload.v).toBe(STATE_VERSION);
  });

  it('should include all required fields', async () => {
    const payload = await getPayload();
    const requiredKeys = [
      'v', 'base', 'baseCols', 'stacks', 'lookups', 'calcStages',
      'selCols', 'colOrder', 'filters', 'sorts', 'groupBy', 'aggregates',
      'aggMode', 'aggModeState', 'colTotals', 'subtotalBy', 'subtotalFns',
      'subtotalGrandTotal', 'subtotalSpacer', 'subtotalOnTop', 'subtotalStrategy',
      'mergedCols', 'mergeGroupUnderline', 'colState', 'excludedRows',
      'tableColors', 'columnLabels',
    ];
    for (const key of requiredKeys) {
      expect(key in payload, `Missing key: ${key}`).toBe(true);
    }
  });

  it('should exclude runtime-only fields', async () => {
    const db = (globalThis as any).db;
    db.result = { columns: ['a'], rows: [{ a: 1 }] };
    const payload = await getPayload();
    expect('result' in payload).toBe(false);
    expect('tables' in payload).toBe(false);
  });

  it('should handle empty state', async () => {
    const payload = await getPayload();
    expect(payload.base).toBe('Orders');
    expect(payload.baseCols).toBeNull();
    expect(payload.stacks).toEqual([]);
    expect(payload.lookups).toEqual([]);
    expect(payload.calcStages).toEqual([]);
    expect(payload.selCols).toBeNull();
    expect(payload.colOrder).toBeNull();
    expect(payload.filters).toEqual([]);
    expect(payload.sorts).toEqual([]);
    expect(payload.groupBy).toEqual([]);
    expect(payload.aggregates).toEqual([]);
    expect(payload.aggMode).toBe('none');
    expect(payload.mergedCols).toEqual([]);
    expect(payload.mergeGroupUnderline).toBe(false);
    expect(payload.excludedRows).toEqual({});
  });

  it('should handle complex state with lookups, calcs, etc.', async () => {
    const db = (globalThis as any).db;
    db.baseCols = ['OrderId', 'Company', 'Amount'];
    db.selCols = new Set(['OrderId', 'Company']);
    db.colOrder = ['OrderId', 'Company', 'Amount'];
    db.lookups = [{
      rightId: 'Contacts',
      keyPairs: [{ left: 'Company', right: 'Company' }],
      cols: ['Email'],
      required: false,
      enabled: true,
      duplicatePolicy: { mode: 'block' },
    }];
    db.calcStages = [{ alias: 'DoubleAmt', mode: 'math', enabled: true, math: { steps: [] } }];
    db.filters = [{ col: 'Amount', op: 'gt', vals: ['100'], enabled: true }];
    db.sorts = [{ col: 'OrderId', dir: 'DESC', enabled: true }];
    db.groupBy = ['Company'];
    db.aggregates = [{ fn: 'SUM', col: 'Amount', alias: 'TotalAmt' }];
    db.aggMode = 'group';
    db.colTotals = { Amount: 'SUM' };
    db.subtotalBy = ['Region'];
    db.subtotalFns = { Amount: 'AVG' };
    db.excludedRows = { Orders: new Set([1, 3]) };
    db.tableColors = { Orders: '#FF0000' };
    db.columnLabels = { Orders: { OrderId: 'Order #' } };

    const payload = await getPayload();
    expect(payload.base).toBe('Orders');
    expect(payload.baseCols).toEqual(['OrderId', 'Company', 'Amount']);
    expect(payload.selCols).toEqual(['OrderId', 'Company']);
    expect(payload.colOrder).toEqual(['OrderId', 'Company', 'Amount']);
    expect(payload.lookups).toHaveLength(1);
    expect(payload.lookups[0].rightId).toBe('Contacts');
    expect(payload.calcStages).toHaveLength(1);
    expect(payload.calcStages[0].alias).toBe('DoubleAmt');
    expect(payload.filters).toHaveLength(1);
    expect(payload.sorts).toHaveLength(1);
    expect(payload.sorts[0].dir).toBe('DESC');
    expect(payload.groupBy).toEqual(['Company']);
    expect(payload.aggregates).toHaveLength(1);
    expect(payload.aggMode).toBe('group');
    expect(payload.colTotals).toEqual({ Amount: 'SUM' });
    expect(payload.subtotalBy).toEqual(['Region']);
    expect(payload.subtotalFns).toEqual({ Amount: 'AVG' });
    expect(payload.excludedRows).toEqual({ Orders: [1, 3] });
    expect(payload.tableColors).toEqual({ Orders: '#FF0000' });
    expect(payload.columnLabels).toEqual({ Orders: { OrderId: 'Order #' } });
  });

  it('should serialize excludedRows Sets as arrays', async () => {
    const db = (globalThis as any).db;
    db.excludedRows = { Orders: new Set([0, 2, 4]) };
    const payload = await getPayload();
    expect(payload.excludedRows.Orders).toEqual([0, 2, 4]);
  });

  it('should not save when prompt returns null', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    let dlCalled = false;
    const origDl = (globalThis as any).dl;
    (globalThis as any).dl = () => { dlCalled = true; };
    try {
      saveState();
    } finally {
      (globalThis as any).dl = origDl;
      vi.restoreAllMocks();
    }
    expect(dlCalled).toBe(false);
  });
});
