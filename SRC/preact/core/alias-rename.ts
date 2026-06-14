/**
 * Column alias rename propagation — replaces all references to a calc column's
 * old alias throughout the application state when the alias is changed.
 *
 * Two-layer design:
 * - `renameCalcAlias(idx, newAlias)` — public orchestrator (call sites use this)
 * - `renameAliasRefsInternal(draft, oldAlias, newAlias)` — pure draft helper (exported for testing/batch use)
 */

import type { AppState } from '../types';
import { getStore } from './store';
import { _afterCombineChange } from '../query/layout-selection';

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Rename a calculated column's alias and propagate the change to all
 * referencing fields in the application state.
 *
 * Opens a single store.update() transaction, reads the old alias,
 * writes the new alias, delegates to renameAliasRefsInternal for
 * propagation, then calls _afterCombineChange() for layout reconciliation.
 *
 * @param idx - Index of the calc stage in AppState.calcStages
 * @param newAlias - The new alias string (will be trimmed)
 */
export function renameCalcAlias(idx: number, newAlias: string): void {
  const trimmed = newAlias.trim();
  if (!trimmed) return;

  getStore().update(draft => {
    const calc = draft.calcStages[idx];
    if (!calc) return;
    const oldAlias = (calc.alias || '').trim();
    if (!oldAlias || oldAlias === trimmed) return;
    calc.alias = trimmed;
    renameAliasRefsInternal(draft, oldAlias, trimmed);
  });

  _afterCombineChange();
}

/**
 * Pure draft helper: walk all alias-bearing fields in an AppState draft
 * and replace exact matches of oldAlias with newAlias.
 *
 * Does NOT access the store, DOM, or any global state.
 * Does NOT update selCols or colOrder (handled by _afterCombineChange).
 *
 * @param draft - Mutable AppState draft
 * @param oldAlias - The alias to find (exact match)
 * @param newAlias - The replacement alias
 */
export function renameAliasRefsInternal(
  draft: AppState,
  oldAlias: string,
  newAlias: string,
): void {
  // A. Simple string fields
  for (const f of draft.filters ?? []) {
    if (f.col === oldAlias) f.col = newAlias;
  }
  for (const s of draft.sorts ?? []) {
    if (s.col === oldAlias) s.col = newAlias;
  }
  for (const a of draft.aggregates ?? []) {
    if (a.col === oldAlias) a.col = newAlias;
  }

  // B. String array fields
  replaceInArray(draft.groupBy, oldAlias, newAlias);
  replaceInArray(draft.subtotalBy, oldAlias, newAlias);
  replaceInArray(draft.mergedCols, oldAlias, newAlias);

  // C. KeyPair left fields + detail band sorts
  for (const band of draft.detailBands ?? []) {
    for (const kp of band.keyPairs ?? []) {
      if (kp.left === oldAlias) kp.left = newAlias;
    }
    for (const s of band.sorts ?? []) {
      if (s.col === oldAlias) s.col = newAlias;
    }
  }
  for (const lu of draft.lookups ?? []) {
    for (const kp of lu.keyPairs ?? []) {
      if (kp.left === oldAlias) kp.left = newAlias;
    }
  }

  // D + E. Calc-internal references (all calc stages, not just the renamed one)
  for (const calc of draft.calcStages ?? []) {
    // D. Compare conditions
    const compare = calc.compare as { conditions?: Array<{ col?: string }> } | undefined;
    if (compare?.conditions) {
      for (const cond of compare.conditions) {
        if (cond.col === oldAlias) cond.col = newAlias;
      }
    }

    // E. Typed-value references
    renameMathTypedRefs(calc.math, oldAlias, newAlias);
    renameCompareTypedValues(calc.compare, oldAlias, newAlias);
    renameTextTypedRefs(calc.text, oldAlias, newAlias);
    renameDateTypedRefs(calc.date, oldAlias, newAlias);
  }

  // G. Record-key fields (key = column alias)
  migrateRecordKey(draft.colTotals, oldAlias, newAlias);
  migrateRecordKey(draft.subtotalFns, oldAlias, newAlias);

  // H. aggModeState — nested alias-bearing fields across all modes
  if (draft.aggModeState && typeof draft.aggModeState === 'object') {
    // none mode: selCols
    const noneMode = draft.aggModeState.none as { selCols?: string[] | null } | null | undefined;
    if (noneMode?.selCols) replaceInArray(noneMode.selCols, oldAlias, newAlias);

    // group mode: selCols, groupBy, aggregates[].col
    const groupMode = draft.aggModeState.group as {
      selCols?: string[] | null; groupBy?: string[];
      aggregates?: Array<{ col?: string }>;
    } | null | undefined;
    if (groupMode) {
      if (groupMode.selCols) replaceInArray(groupMode.selCols, oldAlias, newAlias);
      replaceInArray(groupMode.groupBy, oldAlias, newAlias);
      if (groupMode.aggregates) {
        for (const ag of groupMode.aggregates) {
          if (ag.col === oldAlias) ag.col = newAlias;
        }
      }
    }

    // totals mode: selCols, colTotals (Record keys)
    const totalsMode = draft.aggModeState.totals as {
      selCols?: string[] | null; colTotals?: Record<string, string>;
    } | null | undefined;
    if (totalsMode) {
      if (totalsMode.selCols) replaceInArray(totalsMode.selCols, oldAlias, newAlias);
      migrateRecordKey(totalsMode.colTotals, oldAlias, newAlias);
    }

    // subtotals mode: selCols, subtotalBy, subtotalFns (Record keys)
    const subtotalsMode = draft.aggModeState.subtotals as {
      selCols?: string[] | null; subtotalBy?: string[];
      subtotalFns?: Record<string, string>;
    } | null | undefined;
    if (subtotalsMode) {
      if (subtotalsMode.selCols) replaceInArray(subtotalsMode.selCols, oldAlias, newAlias);
      replaceInArray(subtotalsMode.subtotalBy, oldAlias, newAlias);
      migrateRecordKey(subtotalsMode.subtotalFns, oldAlias, newAlias);
    }
  }
}

// ── Private helpers ────────────────────────────────────────────────────────────

/** Replace all occurrences of oldAlias with newAlias in a string array (in-place). */
function replaceInArray(arr: string[] | undefined | null, oldAlias: string, newAlias: string): void {
  if (!arr) return;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === oldAlias) arr[i] = newAlias;
  }
}

/** Migrate a Record key from oldAlias to newAlias, preserving the value. */
function migrateRecordKey(
  rec: Record<string, string> | undefined | null,
  oldAlias: string,
  newAlias: string,
): void {
  if (!rec || !(oldAlias in rec)) return;
  rec[newAlias] = rec[oldAlias];
  delete rec[oldAlias];
}

/** Replace in math steps where type === 'column' */
function renameMathTypedRefs(
  math: unknown,
  oldAlias: string,
  newAlias: string,
): void {
  const m = math as { steps?: Array<{ type?: string; value?: string }> } | undefined;
  if (!m?.steps) return;
  for (const step of m.steps) {
    if (step.type === 'column' && step.value === oldAlias) step.value = newAlias;
  }
}

/** Replace in compare trueValue/falseValue where type === 'column' */
function renameCompareTypedValues(
  compare: unknown,
  oldAlias: string,
  newAlias: string,
): void {
  const c = compare as {
    trueValue?: { type?: string; value?: string };
    falseValue?: { type?: string; value?: string };
  } | undefined;
  if (!c) return;
  if (c.trueValue?.type === 'column' && c.trueValue.value === oldAlias) c.trueValue.value = newAlias;
  if (c.falseValue?.type === 'column' && c.falseValue.value === oldAlias) c.falseValue.value = newAlias;
}

/** Replace in text parts[] and text.source where type === 'column' */
function renameTextTypedRefs(
  text: unknown,
  oldAlias: string,
  newAlias: string,
): void {
  const t = text as {
    parts?: Array<{ type?: string; value?: string }>;
    source?: { type?: string; value?: string };
  } | undefined;
  if (!t) return;
  if (t.parts) {
    for (const p of t.parts) {
      if (p.type === 'column' && p.value === oldAlias) p.value = newAlias;
    }
  }
  if (t.source?.type === 'column' && t.source.value === oldAlias) t.source.value = newAlias;
}

/** Replace in date.source where type === 'column' */
function renameDateTypedRefs(
  date: unknown,
  oldAlias: string,
  newAlias: string,
): void {
  const d = date as { source?: { type?: string; value?: string } } | undefined;
  if (!d?.source) return;
  if (d.source.type === 'column' && d.source.value === oldAlias) d.source.value = newAlias;
}
