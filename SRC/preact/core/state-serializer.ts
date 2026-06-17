/**
 * State Serializer — serializes the current report configuration to a .rcjson payload
 * and triggers a browser download.
 *
 * Ported from `SRC/js/core/state-serializer.ts`. Key differences:
 * - No global `db` import — reads from `getStore().getState()`
 * - Payload building is separated into `buildPayload()` for testability
 * - `saveState()` handles the UI flow (prompt for name, trigger download)
 * - Calls `saveActiveAggModeState()` and `ensureAggModeState()` to sync agg mode state
 */

import { getStore } from './store';
import { toast, dl } from './utils';
import { STATE_VERSION } from './state-schema';
import { saveActiveAggModeState, ensureAggModeState } from '../ui/aggregation';
import type { AppState } from '../types';

/**
 * Build a serializable payload from the current app state.
 * Pure function — no side effects, no DOM access.
 * Handles Set→array conversion for selCols and excludedRows.
 * @param state - The current app state to serialize
 * @returns A plain object ready for JSON.stringify
 */
export function buildPayload(state: AppState): Record<string, unknown> {
  const excludedRowsSerial: Record<string, number[]> = {};
  for (const [tid, set] of Object.entries(state.excludedRows)) {
    if (set && set.size) excludedRowsSerial[tid] = [...set];
  }

  return {
    v:            STATE_VERSION,
    base:         state.base,
    baseCols:     [...state.baseCols],
    stacks:       [...(state.stacks || [])],
    lookups:      (state.lookups || []).map(l => ({
      rightId:  l.rightId,
      keyPairs: (l.keyPairs || []).map(p => ({ left: p.left, right: p.right })),
      cols:     [...(l.cols || [])],
      required: !!l.required,
      enabled:  l.enabled !== false,
      duplicatePolicy: l.duplicatePolicy ? { ...l.duplicatePolicy } : { mode: 'block' },
    })),
    calcStages:   (state.calcStages || []).map(c => ({
      alias: (c.alias || '').trim(),
      mode: c.mode,
      enabled: c.enabled !== false,
      ...(c.math ? { math: JSON.parse(JSON.stringify(c.math)) } : {}),
      ...(c.compare ? { compare: JSON.parse(JSON.stringify(c.compare)) } : {}),
      ...(c.text ? { text: JSON.parse(JSON.stringify(c.text)) } : {}),
      ...(c.date ? { date: JSON.parse(JSON.stringify(c.date)) } : {}),
    })),
    selCols:      [...state.selCols],
    colOrder:     [...state.colOrder],
    filters:      state.filters.map(f => ({
      col:     f.col  || '',
      op:      f.op   || 'contains',
      vals:    Array.isArray(f.vals) ? [...f.vals] : [''],
      enabled: f.enabled !== false,
    })),
    sorts:        state.sorts.map(s => ({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC', enabled: s.enabled !== false })),
    groupBy:      [...state.groupBy],
    aggregates:   state.aggregates.map(a => ({ ...a })),
    aggMode:            state.aggMode || 'none',
    aggModeState:       JSON.parse(JSON.stringify(state.aggModeState || {})),
    colTotals:          { ...(state.colTotals || {}) },
    subtotalBy:         [...(state.subtotalBy || [])],
    subtotalFns:        { ...(state.subtotalFns || {}) },
    subtotalGrandTotal: state.subtotalGrandTotal !== false,
    subtotalSpacer:     !!state.subtotalSpacer,
    subtotalOnTop:      !!state.subtotalOnTop,
    subtotalStrategy:   state.subtotalStrategy || 'combined',
    mergedCols:         [...(state.mergedCols || [])],
    mergeGroupUnderline: !!state.mergeGroupUnderline,
    colState:           state.colState || null,
    excludedRows: excludedRowsSerial,
    tableColors:  { ...(state.tableColors || {}) },
    columnLabels: JSON.parse(JSON.stringify(state.columnLabels || {})),
    detailBands:  (state.detailBands || []).map(b => ({
      id:        b.id || '',
      rightId:   b.rightId || '',
      keyPairs:  (b.keyPairs || []).map(p => ({ left: p.left || '', right: p.right || '' })),
      cols:      [...b.cols],
      enabled:   b.enabled !== false,
      sorts:     (b.sorts || []).map(s => ({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC', enabled: s.enabled !== false })),
      label:     typeof b.label === 'string' ? b.label : '',
    })),
    columnTypeOverrides: JSON.parse(JSON.stringify(state.columnTypeOverrides || {})),
    includeSourceColumn: !!state.includeSourceColumn,
    sourceColumnName: state.sourceColumnName || 'Source Sheet',
    stackAliases: { ...(state.stackAliases || {}) },
  };
}

/**
 * Serialize the current report configuration and trigger a browser download.
 * Prompts the user for a filename, builds the payload, and downloads it as .rcjson.
 * Shows a toast if no base table is configured.
 * Requires a DOM environment (window.prompt, document.createElement).
 */
export function saveState(): void {
  const state = getStore().getState();
  if (!state.base) { toast('Nothing to save — load a data file first.', 'err'); return; }

  saveActiveAggModeState();
  ensureAggModeState();

  const raw = typeof window !== 'undefined' ? window.prompt('Save query as:', 'my-query') : null;
  if (raw === null) return;
  const name = (raw.trim() || 'my-query').replace(/\.rcjson$/i, '');

  const currentState = getStore().getState();
  const payload = buildPayload(currentState);

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  dl(blob, name + '.rcjson');
}
