/**
 * Tests for aggregation helper functions — pure store-mutating helpers
 * for subtotal toggles and aggregate item management.
 *
 * Covers: addAggregate, removeAggregate, touchAggregate,
 * setSubtotalGrandTotal, setSubtotalSpacer, setSubtotalOnTop, setSubtotalStrategy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { initStore, getStore } from '../../core/store';
import {
  addAggregate,
  removeAggregate,
  touchAggregate,
  setSubtotalGrandTotal,
  setSubtotalSpacer,
  setSubtotalOnTop,
  setSubtotalStrategy,
} from '../../ui/aggregation';
import type { DbTable } from '../../types';

function makeTable(id: string, name: string, cols: string[] = ['A', 'B']): DbTable {
  return { id, name, cols, rowCount: 10 };
}

beforeEach(() => {
  initStore({
    tables: {
      t1: makeTable('t1', 'Orders', ['Amount', 'Tax', 'Region']),
    },
    colOrder: ['Amount', 'Tax', 'Region'],
    groupBy: ['Region'],
    aggregates: [],
    subtotalGrandTotal: false,
    subtotalSpacer: false,
    subtotalOnTop: false,
    subtotalStrategy: 'combined',
  });
});

describe('setSubtotalGrandTotal', () => {
  it('sets subtotalGrandTotal to true', () => {
    setSubtotalGrandTotal(true);
    expect(getStore().getState().subtotalGrandTotal).toBe(true);
  });

  it('sets subtotalGrandTotal to false', () => {
    setSubtotalGrandTotal(true);
    setSubtotalGrandTotal(false);
    expect(getStore().getState().subtotalGrandTotal).toBe(false);
  });

  it('coerces truthy values to true', () => {
    setSubtotalGrandTotal(1 as unknown as boolean);
    expect(getStore().getState().subtotalGrandTotal).toBe(true);
  });

  it('coerces falsy values to false', () => {
    setSubtotalGrandTotal(0 as unknown as boolean);
    expect(getStore().getState().subtotalGrandTotal).toBe(false);
  });
});

describe('setSubtotalSpacer', () => {
  it('sets subtotalSpacer to true', () => {
    setSubtotalSpacer(true);
    expect(getStore().getState().subtotalSpacer).toBe(true);
  });

  it('sets subtotalSpacer to false', () => {
    setSubtotalSpacer(true);
    setSubtotalSpacer(false);
    expect(getStore().getState().subtotalSpacer).toBe(false);
  });

  it('coerces falsy values to false', () => {
    setSubtotalSpacer('' as unknown as boolean);
    expect(getStore().getState().subtotalSpacer).toBe(false);
  });
});

describe('setSubtotalOnTop', () => {
  it('sets subtotalOnTop to true', () => {
    setSubtotalOnTop(true);
    expect(getStore().getState().subtotalOnTop).toBe(true);
  });

  it('sets subtotalOnTop to false', () => {
    setSubtotalOnTop(true);
    setSubtotalOnTop(false);
    expect(getStore().getState().subtotalOnTop).toBe(false);
  });

  it('coerces truthy values to true', () => {
    setSubtotalOnTop('yes' as unknown as boolean);
    expect(getStore().getState().subtotalOnTop).toBe(true);
  });
});

describe('setSubtotalStrategy', () => {
  it('sets strategy to "nested"', () => {
    setSubtotalStrategy('nested');
    expect(getStore().getState().subtotalStrategy).toBe('nested');
  });

  it('sets strategy to "combined"', () => {
    setSubtotalStrategy('nested');
    setSubtotalStrategy('combined');
    expect(getStore().getState().subtotalStrategy).toBe('combined');
  });

  it('falls back to "combined" for unknown values', () => {
    setSubtotalStrategy('unknown');
    expect(getStore().getState().subtotalStrategy).toBe('combined');
  });

  it('falls back to "combined" for empty string', () => {
    setSubtotalStrategy('');
    expect(getStore().getState().subtotalStrategy).toBe('combined');
  });
});

describe('addAggregate', () => {
  it('pushes a new aggregate spec to the aggregates array', () => {
    addAggregate();
    const aggs = getStore().getState().aggregates;
    expect(aggs.length).toBe(1);
    expect(aggs[0].fn).toBe('SUM');
    expect(aggs[0].alias).toBe('');
  });

  it('picks a column not already in groupBy', () => {
    // groupBy is ['Region'], so addAggregate should pick 'Amount' or 'Tax'
    addAggregate();
    const aggs = getStore().getState().aggregates;
    expect(aggs[0].col).not.toBe('Region');
    expect(['Amount', 'Tax']).toContain(aggs[0].col);
  });

  it('adds multiple aggregates', () => {
    addAggregate();
    addAggregate();
    addAggregate();
    expect(getStore().getState().aggregates.length).toBe(3);
  });

  it('falls back to first colOrder column when all are in groupBy', () => {
    initStore({
      tables: { t1: makeTable('t1', 'Orders', ['A']) },
      colOrder: ['A'],
      groupBy: ['A'],
      aggregates: [],
    });
    addAggregate();
    const aggs = getStore().getState().aggregates;
    expect(aggs[0].col).toBe('A');
  });

  it('uses empty string when colOrder is empty', () => {
    initStore({
      tables: {},
      colOrder: [],
      groupBy: [],
      aggregates: [],
    });
    addAggregate();
    const aggs = getStore().getState().aggregates;
    expect(aggs[0].col).toBe('');
  });
});

describe('removeAggregate', () => {
  it('removes the aggregate at the given index', () => {
    initStore({
      tables: { t1: makeTable('t1', 'Orders') },
      colOrder: ['Amount', 'Tax'],
      groupBy: [],
      aggregates: [
        { fn: 'SUM', col: 'Amount', alias: '' },
        { fn: 'AVG', col: 'Tax', alias: '' },
        { fn: 'MAX', col: 'Amount', alias: '' },
      ],
    });

    removeAggregate(1);
    const aggs = getStore().getState().aggregates;
    expect(aggs.length).toBe(2);
    expect(aggs[0].fn).toBe('SUM');
    expect(aggs[1].fn).toBe('MAX');
  });

  it('removes the first aggregate', () => {
    initStore({
      tables: { t1: makeTable('t1', 'Orders') },
      aggregates: [
        { fn: 'SUM', col: 'Amount', alias: '' },
        { fn: 'AVG', col: 'Tax', alias: '' },
      ],
    });

    removeAggregate(0);
    const aggs = getStore().getState().aggregates;
    expect(aggs.length).toBe(1);
    expect(aggs[0].fn).toBe('AVG');
  });

  it('removes the last aggregate', () => {
    initStore({
      tables: { t1: makeTable('t1', 'Orders') },
      aggregates: [
        { fn: 'SUM', col: 'Amount', alias: '' },
      ],
    });

    removeAggregate(0);
    expect(getStore().getState().aggregates.length).toBe(0);
  });
});

describe('touchAggregate', () => {
  it('sets auto=false on the aggregate at the given index', () => {
    initStore({
      tables: { t1: makeTable('t1', 'Orders') },
      aggregates: [
        { fn: 'SUM', col: 'Amount', alias: '', auto: true },
        { fn: 'AVG', col: 'Tax', alias: '', auto: true },
      ],
    });

    touchAggregate(0);
    const aggs = getStore().getState().aggregates;
    expect((aggs[0] as any).auto).toBe(false);
    // Second one should be untouched
    expect((aggs[1] as any).auto).toBe(true);
  });

  it('does nothing for out-of-bounds index', () => {
    initStore({
      tables: { t1: makeTable('t1', 'Orders') },
      aggregates: [
        { fn: 'SUM', col: 'Amount', alias: '', auto: true },
      ],
    });

    expect(() => touchAggregate(5)).not.toThrow();
    expect((getStore().getState().aggregates[0] as any).auto).toBe(true);
  });

  it('does nothing for negative index', () => {
    initStore({
      tables: { t1: makeTable('t1', 'Orders') },
      aggregates: [
        { fn: 'SUM', col: 'Amount', alias: '', auto: true },
      ],
    });

    expect(() => touchAggregate(-1)).not.toThrow();
    expect((getStore().getState().aggregates[0] as any).auto).toBe(true);
  });
});
