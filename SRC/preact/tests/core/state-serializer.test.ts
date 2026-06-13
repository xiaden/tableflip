/**
 * Unit tests — state serializer: buildPayload() pure function.
 *
 * Tests that the serializer correctly converts AppState to a serializable payload,
 * handles Set→array conversions, and produces output compatible with the hydrator.
 */
import { describe, it, expect } from 'vitest';
import { buildPayload } from '../../core/state-serializer';
import { createAppState } from '../../core/state';

describe('buildPayload', () => {
  it('should serialize a minimal state with defaults', () => {
    const state = createAppState({ base: 'Orders' });
    const payload = buildPayload(state);

    expect(payload.v).toBe(2);
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
    expect(payload.aggModeState).toEqual({});
    expect(payload.colTotals).toEqual({});
    expect(payload.subtotalBy).toEqual([]);
    expect(payload.subtotalFns).toEqual({});
    expect(payload.subtotalGrandTotal).toBe(true);
    expect(payload.subtotalSpacer).toBe(false);
    expect(payload.subtotalOnTop).toBe(false);
    expect(payload.subtotalStrategy).toBe('combined');
    expect(payload.mergedCols).toEqual([]);
    expect(payload.mergeGroupUnderline).toBe(false);
    expect(payload.colState).toBeNull();
    expect(payload.excludedRows).toEqual({});
    expect(payload.tableColors).toEqual({});
    expect(payload.columnLabels).toEqual({});
    expect(payload.detailBands).toEqual([]);
    expect(payload.detailBandMode).toBe('separate');
  });

  it('should convert selCols Set to array', () => {
    const state = createAppState({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company', 'Amount']),
    });
    const payload = buildPayload(state);

    expect(Array.isArray(payload.selCols)).toBe(true);
    expect(payload.selCols).toEqual(['OrderId', 'Company', 'Amount']);
  });

  it('should preserve null selCols', () => {
    const state = createAppState({ base: 'Orders', selCols: null });
    const payload = buildPayload(state);

    expect(payload.selCols).toBeNull();
  });

  it('should convert excludedRows Sets to arrays', () => {
    const state = createAppState({
      base: 'Orders',
      excludedRows: {
        Orders: new Set([0, 2, 4]),
        Contacts: new Set([1, 3]),
      },
    });
    const payload = buildPayload(state);

    expect(payload.excludedRows).toEqual({
      Orders: [0, 2, 4],
      Contacts: [1, 3],
    });
  });

  it('should omit empty excludedRows sets', () => {
    const state = createAppState({
      base: 'Orders',
      excludedRows: {
        Orders: new Set(),
        Contacts: new Set([1]),
      },
    });
    const payload = buildPayload(state);

    expect(payload.excludedRows).toEqual({ Contacts: [1] });
  });

  it('should serialize lookups with all fields', () => {
    const state = createAppState({
      base: 'Orders',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name', 'Email'],
        required: true,
        enabled: true,
        duplicatePolicy: { mode: 'combine', combine: { separator: ', ', unique: true } },
      }],
    });
    const payload = buildPayload(state);

    expect(payload.lookups).toEqual([{
      rightId: 'Contacts',
      keyPairs: [{ left: 'Contact', right: 'ContactId' }],
      cols: ['Name', 'Email'],
      required: true,
      enabled: true,
      duplicatePolicy: { mode: 'combine', combine: { separator: ', ', unique: true } },
    }]);
  });

  it('should serialize calcStages with mode-specific data', () => {
    const state = createAppState({
      base: 'Orders',
      calcStages: [{
        alias: 'Total',
        mode: 'math',
        enabled: true,
        math: { steps: [{ type: 'column', value: 'Amount' }] },
      }, {
        alias: 'Status',
        mode: 'compare',
        enabled: false,
        compare: { conditions: [{ col: 'Amount', op: '>', value: '100' }] },
      }],
    });
    const payload = buildPayload(state);

    expect(payload.calcStages).toEqual([{
      alias: 'Total',
      mode: 'math',
      enabled: true,
      math: { steps: [{ type: 'column', value: 'Amount' }] },
    }, {
      alias: 'Status',
      mode: 'compare',
      enabled: false,
      compare: { conditions: [{ col: 'Amount', op: '>', value: '100' }] },
    }]);
  });

  it('should serialize filters with all fields', () => {
    const state = createAppState({
      base: 'Orders',
      filters: [{
        col: 'Status',
        op: '=',
        vals: ['Open', 'Pending'],
        enabled: true,
      }],
    });
    const payload = buildPayload(state);

    expect(payload.filters).toEqual([{
      col: 'Status',
      op: '=',
      vals: ['Open', 'Pending'],
      enabled: true,
    }]);
  });

  it('should serialize sorts with direction normalization', () => {
    const state = createAppState({
      base: 'Orders',
      sorts: [
        { col: 'Amount', dir: 'DESC', enabled: true },
        { col: 'Company', dir: 'ASC', enabled: false },
      ],
    });
    const payload = buildPayload(state);

    expect(payload.sorts).toEqual([
      { col: 'Amount', dir: 'DESC', enabled: true },
      { col: 'Company', dir: 'ASC', enabled: false },
    ]);
  });

  it('should serialize group aggregation config', () => {
    const state = createAppState({
      base: 'Orders',
      aggMode: 'group',
      groupBy: ['Company'],
      aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'TotalAmount' }],
    });
    const payload = buildPayload(state);

    expect(payload.aggMode).toBe('group');
    expect(payload.groupBy).toEqual(['Company']);
    expect(payload.aggregates).toEqual([{ fn: 'SUM', col: 'Amount', alias: 'TotalAmount' }]);
  });

  it('should serialize subtotal config', () => {
    const state = createAppState({
      base: 'Orders',
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalGrandTotal: true,
      subtotalSpacer: true,
      subtotalOnTop: true,
      subtotalStrategy: 'nested',
    });
    const payload = buildPayload(state);

    expect(payload.aggMode).toBe('subtotals');
    expect(payload.subtotalBy).toEqual(['Region']);
    expect(payload.subtotalFns).toEqual({ Amount: 'SUM' });
    expect(payload.subtotalGrandTotal).toBe(true);
    expect(payload.subtotalSpacer).toBe(true);
    expect(payload.subtotalOnTop).toBe(true);
    expect(payload.subtotalStrategy).toBe('nested');
  });

  it('should serialize tableColors and columnLabels', () => {
    const state = createAppState({
      base: 'Orders',
      tableColors: { Orders: '#ff0000', Contacts: '#00ff00' },
      columnLabels: { Orders: { Amount: 'Total', Company: 'Client' } },
    });
    const payload = buildPayload(state);

    expect(payload.tableColors).toEqual({ Orders: '#ff0000', Contacts: '#00ff00' });
    expect(payload.columnLabels).toEqual({ Orders: { Amount: 'Total', Company: 'Client' } });
  });

  it('should serialize mergedCols and mergeGroupUnderline', () => {
    const state = createAppState({
      base: 'Orders',
      mergedCols: ['Company', 'Region'],
      mergeGroupUnderline: true,
    });
    const payload = buildPayload(state);

    expect(payload.mergedCols).toEqual(['Company', 'Region']);
    expect(payload.mergeGroupUnderline).toBe(true);
  });

  it('should deep clone nested objects to avoid reference sharing', () => {
    const state = createAppState({
      base: 'Orders',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }],
    });
    const payload = buildPayload(state);

    // Mutate the payload and verify the original state is unaffected
    (payload.lookups as Record<string, unknown>[])[0].keyPairs = [{ left: 'Modified', right: 'ContactId' }];
    expect(state.lookups[0].keyPairs[0].left).toBe('Contact');
  });

  it('should produce a payload that can be JSON stringified', () => {
    const state = createAppState({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company']),
      excludedRows: { Orders: new Set([0, 1, 2]) },
    });
    const payload = buildPayload(state);

    const json = JSON.stringify(payload, null, 2);
    expect(typeof json).toBe('string');
    expect(json.length).toBeGreaterThan(0);

    const parsed = JSON.parse(json);
    expect(parsed.base).toBe('Orders');
    expect(parsed.selCols).toEqual(['OrderId', 'Company']);
    expect(parsed.excludedRows).toEqual({ Orders: [0, 1, 2] });
  });
});
