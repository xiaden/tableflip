/**
 * Unit tests — alias rename propagation.
 *
 * Tests that renameAliasRefsInternal (pure draft helper) correctly walks
 * all alias-bearing AppState fields, and that renameCalcAlias (orchestrator)
 * integrates with the store and _afterCombineChange.
 */
import { describe, it, expect } from 'vitest';
import { renameAliasRefsInternal, renameCalcAlias } from '../../core/alias-rename';
import { createAppState } from '../../core/state';
import { initStore, getStore } from '../../core/store';
import type { AppState } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal AppState draft for pure function tests. */
function draft(overrides?: Partial<AppState>): AppState {
  return {
    tables: {},
    excludedRows: {},
    tableColors: {},
    columnLabels: {},
    base: 'TestTable',
    baseCols: [],
    stacks: [],
    lookups: [],
    calcStages: [],
    selCols: null,
    colOrder: null,
    filters: [],
    groupBy: [],
    aggregates: [],
    aggMode: 'none',
    aggModeState: null,
    colTotals: {},
    subtotalBy: [],
    subtotalFns: {},
    subtotalGrandTotal: true,
    subtotalSpacer: false,
    subtotalOnTop: false,
    subtotalStrategy: 'combined',
    mergedCols: [],
    mergeGroupUnderline: false,
    colState: null,
    sorts: [],
    result: null,
    activeTab: 'pipeline',
    previewTableId: null,
    ...overrides,
  } as AppState;
}

// ── Pure Function Tests ─────────────────────────────────────────────────────

describe('renameAliasRefsInternal', () => {
  // A. Simple string fields
  it('should update filter col references', () => {
    const d = draft({
      filters: [{ col: 'MyCalc', op: '=', vals: ['x'], enabled: true }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.filters[0].col).toBe('NewName');
  });

  it('should update sort col references', () => {
    const d = draft({
      sorts: [{ col: 'MyCalc', dir: 'ASC', enabled: true }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.sorts[0].col).toBe('NewName');
  });

  it('should update aggregate col references', () => {
    const d = draft({
      aggregates: [{ col: 'MyCalc', fn: 'SUM', alias: 'Total', enabled: true }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.aggregates[0].col).toBe('NewName');
  });

  // B. String array fields
  it('should update groupBy array', () => {
    const d = draft({ groupBy: ['MyCalc', 'Other'] });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.groupBy).toEqual(['NewName', 'Other']);
  });

  it('should update subtotalBy array', () => {
    const d = draft({ subtotalBy: ['MyCalc', 'Other'] });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.subtotalBy).toEqual(['NewName', 'Other']);
  });

  it('should update mergedCols array', () => {
    const d = draft({ mergedCols: ['MyCalc', 'Other'] });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.mergedCols).toEqual(['NewName', 'Other']);
  });

  // C. KeyPair left fields + detail band sorts
  it('should update detailBand keyPairs left references', () => {
    const d = draft({
      detailBands: [{
        id: 'b0', rightId: 'Items', enabled: true, label: '',
        keyPairs: [{ left: 'MyCalc', right: 'ItemId' }],
        cols: [], sorts: [],
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.detailBands![0].keyPairs[0].left).toBe('NewName');
  });

  it('should update detailBand sort col references', () => {
    const d = draft({
      detailBands: [{
        id: 'b0', rightId: 'Items', enabled: true, label: '',
        keyPairs: [],
        cols: [],
        sorts: [{ col: 'MyCalc', dir: 'ASC', enabled: true }],
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.detailBands![0].sorts[0].col).toBe('NewName');
  });

  it('should update lookup keyPairs left references', () => {
    const d = draft({
      lookups: [{
        rightId: 'Items',
        keyPairs: [{ left: 'MyCalc', right: 'ItemId' }],
        cols: [], enabled: true, required: false,
        duplicatePolicy: { mode: 'block' },
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.lookups[0].keyPairs[0].left).toBe('NewName');
  });

  // D. Compare conditions
  it('should update calc compare conditions col references', () => {
    const d = draft({
      calcStages: [{
        alias: 'OtherCalc', mode: 'compare', enabled: true,
        compare: { compareMode: 'AND', conditions: [{ col: 'MyCalc', op: '=', val: '5' }] },
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const conds = (d.calcStages[0].compare as { conditions: Array<{ col: string }> }).conditions;
    expect(conds[0].col).toBe('NewName');
  });

  // E. Typed-value references
  it('should update math step typed-value refs where type === column', () => {
    const d = draft({
      calcStages: [{
        alias: 'OtherCalc', mode: 'math', enabled: true,
        math: { strategy: 'stepChain', steps: [
          { type: 'column', value: 'MyCalc' },
          { type: 'number', value: '42' },
        ] },
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const steps = (d.calcStages[0].math as { steps: Array<{ type: string; value: string }> }).steps;
    expect(steps[0].value).toBe('NewName');
    expect(steps[1].value).toBe('42'); // non-column type unchanged
  });

  it('should update compare trueValue typed-value refs', () => {
    const d = draft({
      calcStages: [{
        alias: 'OtherCalc', mode: 'compare', enabled: true,
        compare: {
          compareMode: 'AND', conditions: [],
          trueValue: { type: 'column', value: 'MyCalc' },
          falseValue: { type: 'number', value: '0' },
        },
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const cmp = d.calcStages[0].compare as { trueValue: { value: string }; falseValue: { value: string } };
    expect(cmp.trueValue.value).toBe('NewName');
    expect(cmp.falseValue.value).toBe('0'); // non-column type unchanged
  });

  it('should update compare falseValue typed-value refs', () => {
    const d = draft({
      calcStages: [{
        alias: 'OtherCalc', mode: 'compare', enabled: true,
        compare: {
          compareMode: 'AND', conditions: [],
          trueValue: { type: 'number', value: '1' },
          falseValue: { type: 'column', value: 'MyCalc' },
        },
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const cmp = d.calcStages[0].compare as { trueValue: { value: string }; falseValue: { value: string } };
    expect(cmp.trueValue.value).toBe('1');
    expect(cmp.falseValue.value).toBe('NewName');
  });

  it('should update text parts typed-value refs', () => {
    const d = draft({
      calcStages: [{
        alias: 'OtherCalc', mode: 'text', enabled: true,
        text: {
          operation: 'combine',
          parts: [
            { type: 'column', value: 'MyCalc' },
            { type: 'literal', value: '-' },
          ],
        },
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const parts = (d.calcStages[0].text as { parts: Array<{ type: string; value: string }> }).parts;
    expect(parts[0].value).toBe('NewName');
    expect(parts[1].value).toBe('-');
  });

  it('should update text source typed-value refs', () => {
    const d = draft({
      calcStages: [{
        alias: 'OtherCalc', mode: 'text', enabled: true,
        text: {
          operation: 'extract',
          source: { type: 'column', value: 'MyCalc' },
        },
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const src = (d.calcStages[0].text as { source: { value: string } }).source;
    expect(src.value).toBe('NewName');
  });

  it('should update date source typed-value refs', () => {
    const d = draft({
      calcStages: [{
        alias: 'OtherCalc', mode: 'date', enabled: true,
        date: { operation: 'extract', source: { type: 'column', value: 'MyCalc' }, part: 'year', output: 'number' },
      }],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const src = (d.calcStages[0].date as { source: { value: string } }).source;
    expect(src.value).toBe('NewName');
  });

  // F. Exact match only (no substring)
  it('should not match substring aliases', () => {
    const d = draft({
      filters: [{ col: 'MyCalcTotal', op: '=', vals: ['x'], enabled: true }],
      groupBy: ['MyCalcTotal'],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.filters[0].col).toBe('MyCalcTotal');
    expect(d.groupBy[0]).toBe('MyCalcTotal');
  });

  // G. Record-key fields
  it('should migrate colTotals keys', () => {
    const d = draft({ colTotals: { MyCalc: 'SUM', OtherCol: 'AVG' } });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.colTotals).toEqual({ NewName: 'SUM', OtherCol: 'AVG' });
    expect('MyCalc' in d.colTotals).toBe(false);
  });

  it('should not modify colTotals when key absent', () => {
    const d = draft({ colTotals: { OtherCol: 'SUM' } });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.colTotals).toEqual({ OtherCol: 'SUM' });
  });

  it('should migrate subtotalFns keys', () => {
    const d = draft({ subtotalFns: { MyCalc: 'SUM' } });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.subtotalFns).toEqual({ NewName: 'SUM' });
  });

  // H. aggModeState
  it('should update aggModeState group mode fields', () => {
    const d = draft({
      aggModeState: {
        group: {
          selCols: ['MyCalc', 'Other'],
          groupBy: ['MyCalc'],
          aggregates: [{ fn: 'SUM', col: 'MyCalc' }],
        },
      },
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const g = d.aggModeState!.group as { selCols: string[]; groupBy: string[]; aggregates: Array<{ col: string }> };
    expect(g.selCols).toEqual(['NewName', 'Other']);
    expect(g.groupBy).toEqual(['NewName']);
    expect(g.aggregates[0].col).toBe('NewName');
  });

  it('should update aggModeState totals mode fields', () => {
    const d = draft({
      aggModeState: {
        totals: {
          selCols: ['MyCalc'],
          colTotals: { MyCalc: 'SUM' },
        },
      },
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const t = d.aggModeState!.totals as { selCols: string[]; colTotals: Record<string, string> };
    expect(t.selCols).toEqual(['NewName']);
    expect(t.colTotals).toEqual({ NewName: 'SUM' });
  });

  it('should update aggModeState subtotals mode fields', () => {
    const d = draft({
      aggModeState: {
        subtotals: {
          selCols: ['MyCalc'],
          subtotalBy: ['MyCalc'],
          subtotalFns: { MyCalc: 'AVG' },
        },
      },
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const s = d.aggModeState!.subtotals as { selCols: string[]; subtotalBy: string[]; subtotalFns: Record<string, string> };
    expect(s.selCols).toEqual(['NewName']);
    expect(s.subtotalBy).toEqual(['NewName']);
    expect(s.subtotalFns).toEqual({ NewName: 'AVG' });
  });

  it('should update aggModeState none mode selCols', () => {
    const d = draft({
      aggModeState: { none: { selCols: ['MyCalc', 'Other'] } },
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const n = d.aggModeState!.none as { selCols: string[] };
    expect(n.selCols).toEqual(['NewName', 'Other']);
  });

  // Null safety
  it('should not throw when all optional fields are null/undefined', () => {
    // Start with truly empty draft (all arrays/objects at defaults)
    const d = draft();
    expect(() => renameAliasRefsInternal(d, 'MyCalc', 'NewName')).not.toThrow();
  });

  it('should not throw when aggModeState is null', () => {
    const d = draft({ aggModeState: null });
    expect(() => renameAliasRefsInternal(d, 'MyCalc', 'NewName')).not.toThrow();
  });

  it('should not throw when aggModeState has partial modes', () => {
    const d = draft({
      aggModeState: {
        group: null,
        totals: { colTotals: { MyCalc: 'SUM' } },
      },
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    const t = d.aggModeState!.totals as { colTotals: Record<string, string> };
    expect(t.colTotals).toEqual({ NewName: 'SUM' });
  });

  // Multiple occurrences
  it('should update all occurrences across multiple fields', () => {
    const d = draft({
      filters: [{ col: 'MyCalc', op: '=', vals: ['x'], enabled: true }],
      sorts: [{ col: 'MyCalc', dir: 'ASC', enabled: true }],
      aggregates: [{ col: 'MyCalc', fn: 'SUM', alias: 'T', enabled: true }],
      groupBy: ['MyCalc'],
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.filters[0].col).toBe('NewName');
    expect(d.sorts[0].col).toBe('NewName');
    expect(d.aggregates[0].col).toBe('NewName');
    expect(d.groupBy[0]).toBe('NewName');
  });

  // Cross-mode aggModeState consistency
  it('should update aliases across live fields and all aggModeState snapshots', () => {
    const d = draft({
      groupBy: ['MyCalc'],
      aggModeState: {
        group: { groupBy: ['MyCalc'] },
        subtotals: { subtotalBy: ['MyCalc'] },
      },
    });
    renameAliasRefsInternal(d, 'MyCalc', 'NewName');
    expect(d.groupBy).toEqual(['NewName']);
    const g = d.aggModeState!.group as { groupBy: string[] };
    const s = d.aggModeState!.subtotals as { subtotalBy: string[] };
    expect(g.groupBy).toEqual(['NewName']);
    expect(s.subtotalBy).toEqual(['NewName']);
  });
});

// ── Integration Tests ───────────────────────────────────────────────────────

describe('renameCalcAlias', () => {
  it('should rename calc alias and propagate to filters', () => {
    initStore(createAppState({
      calcStages: [{ alias: 'MyCalc', mode: 'math', enabled: true }],
      filters: [{ col: 'MyCalc', op: '=', vals: ['x'], enabled: true }],
    }));

    renameCalcAlias(0, 'NewName');

    const state = getStore().getState();
    expect(state.calcStages[0].alias).toBe('NewName');
    expect(state.filters[0].col).toBe('NewName');
  });

  it('should be a no-op when oldAlias === newAlias', () => {
    initStore(createAppState({
      calcStages: [{ alias: 'MyCalc', mode: 'math', enabled: true }],
      filters: [{ col: 'MyCalc', op: '=', vals: ['x'], enabled: true }],
    }));

    renameCalcAlias(0, 'MyCalc');

    const state = getStore().getState();
    expect(state.calcStages[0].alias).toBe('MyCalc');
    expect(state.filters[0].col).toBe('MyCalc');
  });

  it('should be a no-op when newAlias is empty', () => {
    initStore(createAppState({
      calcStages: [{ alias: 'MyCalc', mode: 'math', enabled: true }],
    }));

    renameCalcAlias(0, '');

    const state = getStore().getState();
    expect(state.calcStages[0].alias).toBe('MyCalc');
  });

  it('should be a no-op for out-of-bounds calc index', () => {
    initStore(createAppState({
      calcStages: [{ alias: 'MyCalc', mode: 'math', enabled: true }],
    }));

    expect(() => renameCalcAlias(99, 'NewName')).not.toThrow();
  });

  it('should migrate colTotals keys', () => {
    initStore(createAppState({
      calcStages: [{ alias: 'MyCalc', mode: 'math', enabled: true }],
      colTotals: { MyCalc: 'SUM', Other: 'AVG' },
    }));

    renameCalcAlias(0, 'NewName');

    const state = getStore().getState();
    expect(state.colTotals).toEqual({ NewName: 'SUM', Other: 'AVG' });
  });

  it('should migrate subtotalFns keys', () => {
    initStore(createAppState({
      calcStages: [{ alias: 'MyCalc', mode: 'math', enabled: true }],
      subtotalFns: { MyCalc: 'AVG' },
    }));

    renameCalcAlias(0, 'NewName');

    const state = getStore().getState();
    expect(state.subtotalFns).toEqual({ NewName: 'AVG' });
  });

  it('should update aggModeState snapshots', () => {
    initStore(createAppState({
      calcStages: [{ alias: 'MyCalc', mode: 'math', enabled: true }],
      aggModeState: {
        group: { groupBy: ['MyCalc'], selCols: ['MyCalc'], aggregates: [] },
        totals: { colTotals: { MyCalc: 'SUM' }, selCols: ['MyCalc'] },
        subtotals: { subtotalBy: ['MyCalc'], subtotalFns: { MyCalc: 'AVG' }, selCols: ['MyCalc'] },
      },
    }));

    renameCalcAlias(0, 'NewName');

    const state = getStore().getState();
    const g = state.aggModeState!.group as { groupBy: string[] };
    const t = state.aggModeState!.totals as { colTotals: Record<string, string> };
    const s = state.aggModeState!.subtotals as { subtotalBy: string[]; subtotalFns: Record<string, string> };
    expect(g.groupBy).toEqual(['NewName']);
    expect(t.colTotals).toEqual({ NewName: 'SUM' });
    expect(s.subtotalBy).toEqual(['NewName']);
    expect(s.subtotalFns).toEqual({ NewName: 'AVG' });
  });
});
