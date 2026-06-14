/**
 * Aggregation mode management — state save/load and mode switching.
 *
 * Manages switching between aggregation modes (none/group/totals/subtotals),
 * saving and restoring per-mode UI state, and providing helper functions
 * for aggregation-related UI operations.
 *
 * Ported from SRC/js/ui/aggregation.ts. Key differences:
 * - No direct DOM manipulation — rendering is handled by Preact components
 * - No window assignments
 * - State mutations go through store.update() instead of direct db mutation
 * - renderAggregation/renderSubtotalsSection replaced by store-driven reactivity
 */

import { getStore } from '../core/store';
import { AGG_MODES } from '../report/aggregation-constants';
import type { AggMode, AggregateSpec } from '../types';

// ── Internal helpers ──────────────────────────────────────────────────────────

function _selColsToArray(selCols: unknown): string[] {
  if (selCols instanceof Set) return [...selCols];
  if (Array.isArray(selCols)) return [...selCols];
  return [];
}

export function _readAggModeState(mode: string): Record<string, unknown> {
  const state = getStore().getState();
  if (mode === 'group') {
    return {
      selCols:    _selColsToArray(state.selCols),
      groupBy:    [...(state.groupBy || [])],
      aggregates: (state.aggregates || []).map((a: AggregateSpec) => ({ ...a })),
    };
  }
  if (mode === 'totals') {
    return {
      selCols:   _selColsToArray(state.selCols),
      colTotals: { ...(state.colTotals || {}) },
    };
  }
  if (mode === 'subtotals') {
    return {
      selCols:            _selColsToArray(state.selCols),
      subtotalBy:         [...(state.subtotalBy || [])],
      subtotalFns:        { ...(state.subtotalFns || {}) },
      subtotalGrandTotal: state.subtotalGrandTotal !== false,
      subtotalSpacer:     !!state.subtotalSpacer,
      subtotalOnTop:      !!state.subtotalOnTop,
      subtotalStrategy:   state.subtotalStrategy || 'combined',
    };
  }
  return {
    selCols: _selColsToArray(state.selCols),
  };
}

export function _defaultAggModeState(mode: string): Record<string, unknown> {
  if (mode === 'group') {
    return { groupBy: [], aggregates: [] };
  }
  if (mode === 'totals') {
    return { colTotals: {} };
  }
  if (mode === 'subtotals') {
    return {
      subtotalBy:         [],
      subtotalFns:        {},
      subtotalGrandTotal: true,
      subtotalSpacer:     false,
      subtotalOnTop:      false,
      subtotalStrategy:   'combined',
    };
  }
  return {};
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Ensure aggModeState exists and has entries for all modes. */
export function ensureAggModeState(): void {
  getStore().update(draft => {
    if (!draft.aggModeState || typeof draft.aggModeState !== 'object') draft.aggModeState = {};
    for (const mode of AGG_MODES) {
      if (!draft.aggModeState[mode] || typeof draft.aggModeState[mode] !== 'object') {
        draft.aggModeState[mode] = _defaultAggModeState(mode);
      }
    }
  });
}

/** Save the current active aggregation mode's UI state to aggModeState. */
export function saveActiveAggModeState(): void {
  ensureAggModeState();
  const state = getStore().getState();
  const mode = state.aggMode || 'none';
  const modeState = _readAggModeState(mode);
  getStore().update(draft => {
    if (!draft.aggModeState) draft.aggModeState = {};
    draft.aggModeState[mode] = modeState;
  });
}

/**
 * Load a saved aggregation mode's UI state into the active state fields.
 * Clears previous mode's fields before applying the new mode's saved state.
 * @param mode - The aggregation mode to load ('none', 'group', 'totals', 'subtotals')
 */
export function loadAggModeState(mode: string): void {
  ensureAggModeState();
  const state = getStore().getState();
  const savedState = (state.aggModeState?.[mode] || _defaultAggModeState(mode)) as Record<string, unknown>;

  getStore().update(draft => {
    // Clear all mode-specific fields
    draft.groupBy    = [];
    draft.aggregates = [];
    draft.colTotals  = {};
    draft.subtotalBy = [];
    draft.subtotalFns = {};

    if (mode === 'group') {
      if ('selCols' in savedState) {
        draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols as string[]) : new Set();
      }
      draft.groupBy = Array.isArray(savedState.groupBy) ? [...savedState.groupBy as string[]] : [];
      draft.aggregates = Array.isArray(savedState.aggregates) ? (savedState.aggregates as AggregateSpec[]).map(a => ({ ...a })) : [];
      return;
    }
    if (mode === 'totals') {
      if ('selCols' in savedState) {
        draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols as string[]) : new Set();
      }
      draft.colTotals = savedState.colTotals && typeof savedState.colTotals === 'object' ? { ...savedState.colTotals as Record<string, string> } : {};
      return;
    }
    if (mode === 'subtotals') {
      if ('selCols' in savedState) {
        draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols as string[]) : new Set();
      }
      draft.subtotalBy = Array.isArray(savedState.subtotalBy) ? [...savedState.subtotalBy as string[]] : [];
      draft.subtotalFns = savedState.subtotalFns && typeof savedState.subtotalFns === 'object' ? { ...savedState.subtotalFns as Record<string, string> } : {};
      draft.subtotalGrandTotal = savedState.subtotalGrandTotal !== false;
      draft.subtotalSpacer = !!savedState.subtotalSpacer;
      draft.subtotalOnTop = !!savedState.subtotalOnTop;
      draft.subtotalStrategy = savedState.subtotalStrategy === 'nested' ? 'nested' : 'combined';
      return;
    }
    // 'none' mode
    if ('selCols' in savedState) {
      draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols as string[]) : new Set();
    }
  });
}

/**
 * Switch to a new aggregation mode.
 * Saves the current mode's state, switches mode, and loads the new mode's state.
 * @param mode - Target aggregation mode
 */
export function setAggMode(mode: string): void {
  if (!(AGG_MODES as readonly string[]).includes(mode)) mode = 'none';
  const aggMode = mode as AggMode;
  const state = getStore().getState();
  const prev = state.aggMode || 'none';
  if (prev === aggMode) return; // Already in this mode

  // Save current mode's state before switching
  saveActiveAggModeState();

  // Switch mode and load new state
  getStore().update(draft => { draft.aggMode = aggMode; });
  loadAggModeState(aggMode);
}

// ── Subtotal helpers ──────────────────────────────────────────────────────────

export function setSubtotalGrandTotal(checked: boolean): void {
  getStore().update(draft => { draft.subtotalGrandTotal = !!checked; });
}

export function setSubtotalSpacer(checked: boolean): void {
  getStore().update(draft => { draft.subtotalSpacer = !!checked; });
}

export function setSubtotalOnTop(checked: boolean): void {
  getStore().update(draft => { draft.subtotalOnTop = !!checked; });
}

export function setSubtotalStrategy(value: string): void {
  getStore().update(draft => { draft.subtotalStrategy = value === 'nested' ? 'nested' : 'combined'; });
}

// ── Aggregate item helpers ────────────────────────────────────────────────────

/** Add a new aggregate row to the current report. */
export function addAggregate(): void {
  getStore().update(draft => {
    // Find a column not already in groupBy
    const allCols = draft.colOrder || [];
    const col = allCols.find(c => !draft.groupBy.includes(c)) || allCols[0] || '';
    (draft.aggregates as Array<AggregateSpec & { auto: boolean }>).push({
      fn: 'SUM', col, alias: '', auto: false,
    });
  });
}

/** Remove an aggregate row by index. */
export function removeAggregate(i: number): void {
  getStore().update(draft => {
    draft.aggregates.splice(i, 1);
  });
}

/** Mark an aggregate row as manually edited (no longer auto). */
export function touchAggregate(i: number): void {
  getStore().update(draft => {
    if (draft.aggregates[i]) {
      (draft.aggregates[i] as AggregateSpec & { auto?: boolean }).auto = false;
    }
  });
}
