/**
 * Column layout / selection — controls which columns are visible in the output.
 *
 * Manages visibility toggles for source-table add/remove and lookup add/remove.
 * Uses the reactive store (getStore()) instead of the old global `db` object.
 *
 * Ported from `SRC/js/query/layout-selection.ts`.
 */

import { getStore } from '../core/store';
import type { ColMapEntry } from '../catalog/column-catalog';
import { buildColSourceMap } from '../catalog/column-catalog';
import { invalidateValidation } from '../report/validation';

// ── Column Layout / Selection ────────────────────────────────────────────────
// Controls which columns are visible in the output (selCols) and manages
// visibility toggles from source-table add/remove and lookup add/remove.

/** Tracks columns that have been seen during combine changes (for auto-add logic). */
export const _seenCols: Set<string> = new Set();

/** Tracks columns whose preview panels are currently open. */
export const _previewOpen: Set<string> = new Set();

/** Tracks columns that are disabled in cards (kept visible even when removed from selCols). */
export const _disabledCardCols: Set<string> = new Set();

/** Resets all layout selection globals. Call when loading new state. */
export function resetLayoutSelection(): void {
  _seenCols.clear();
  _previewOpen.clear();
  _disabledCardCols.clear();
}

/**
 * Build a tooltip string with sample values for a column.
 *
 * Reads sample data from the table's `samples` property (not part of the
 * typed `DbTable` interface, so accessed via cast).
 *
 * @param tid - Table ID containing the column.
 * @param col - Column name to show samples for.
 * @param extra - Additional lines to append to the tooltip.
 * @returns Multi-line tooltip string.
 */
export function _sampleTipFor(tid: string, col: string, extra: string[] = []): string {
  const store = getStore();
  const tbl  = (store.getState().tables?.[tid] as unknown as Record<string, unknown> | undefined);
  const vals = ((tbl?.samples as Record<string, unknown[]> | undefined)?.[col] || []).slice(0, 3).map((v: unknown) => String(v));
  return [
    `From sheet: ${tbl?.name || tid}`,
    vals.length ? `Sample values: ${vals.join(' · ')}` : 'Sample values: (none found)',
    ...extra,
  ].join('\n');
}

/**
 * Check whether a source column is visible in the current layout.
 *
 * Iterates the column map to find all aliases mapping to the given (tid, col).
 * Returns true if any such alias is in selCols, or if selCols is not a Set
 * (meaning all columns are visible).
 *
 * @param tid - Table ID of the source.
 * @param col - Column name in the source table.
 * @param colMap - Column alias → source mapping.
 * @param _mode - Layout mode hint (currently unused, reserved for future use).
 * @returns True if the source column has at least one visible alias.
 */
export function _isSourceVisibleInLayout(tid: string, col: string, colMap: Map<string, ColMapEntry>, _mode: string): boolean {
  const store = getStore();
  const selCols = store.getState().selCols;
  if (!(selCols instanceof Set)) return true;
  let seen = false;
  for (const [alias, src] of colMap.entries()) {
    if (!src || src.kind === 'calc') continue;
    if (src.tid !== tid || src.col !== col) continue;
    seen = true;
    if (selCols.has(alias)) return true;
  }
  return !seen;
}

/**
 * Internal helper to show or hide all layout aliases for a source column.
 *
 * If selCols is not yet a Set, initializes it from the full column map.
 * Uses store.update() to mutate selCols.
 *
 * @param tid - Table ID of the source.
 * @param col - Column name to target, or null for all columns from the table.
 * @param isVisible - True to add aliases to selCols, false to remove them.
 */
function _setLayoutAliasesForSourceVisibility(tid: string, col: string | null = null, isVisible: boolean = true): void {
  if (!tid) return;
  const store = getStore();
  const colMap = buildColSourceMap();
  const aliases = [...colMap.keys()];
  store.update(draft => {
    let selCols = draft.selCols as unknown as Set<string>;
    if (!(selCols instanceof Set)) {
      selCols = new Set(aliases);
      draft.selCols = selCols as unknown as typeof draft.selCols;
    }
    for (const alias of aliases) {
      const src = colMap.get(alias);
      if (!src || src.kind === 'calc') continue;
      if (src.tid !== tid) continue;
      if (col !== null && src.col !== col) continue;
      if (isVisible) selCols.add(alias);
      else selCols.delete(alias);
    }
  });
}

/**
 * Show all layout aliases for a source table column.
 *
 * Adds all column aliases that map to the given (tid, col) into selCols,
 * making them visible in the output.
 *
 * @param tid - Table ID of the source.
 * @param col - Column name to show, or null for all columns from the table.
 */
export function _showLayoutAliasesForSource(tid: string, col: string | null = null): void {
  _setLayoutAliasesForSourceVisibility(tid, col, true);
}

/**
 * Hide all layout aliases for a source table column.
 *
 * Removes all column aliases that map to the given (tid, col) from selCols,
 * hiding them from the output.
 *
 * @param tid - Table ID of the source.
 * @param col - Column name to hide, or null for all columns from the table.
 */
export function _hideLayoutAliasesForSource(tid: string, col: string | null = null): void {
  _setLayoutAliasesForSourceVisibility(tid, col, false);
}

/**
 * Check whether a lookup column is used by another lookup (besides the excluded one).
 *
 * @param tid - Table ID of the right table.
 * @param col - Column name to check.
 * @param excludeLookupIndex - Index of the lookup to exclude from the check.
 * @returns True if the column is referenced by another lookup's cols array.
 */
function _lookupColumnUsedElsewhere(tid: string, col: string, excludeLookupIndex: number = -1): boolean {
  const store = getStore();
  const lookups = store.getState().lookups;
  for (let i = 0; i < lookups.length; i++) {
    if (i === excludeLookupIndex) continue;
    const lk = lookups[i];
    if (!lk || lk.rightId !== tid) continue;
    if (Array.isArray(lk.cols) && lk.cols.includes(col)) return true;
  }
  return false;
}

/**
 * Safely hide lookup layout aliases, skipping columns still used by other lookups.
 *
 * For each column in the right table (or just the specified column), checks
 * whether it is referenced by another lookup. If not, hides its aliases.
 *
 * @param tid - Table ID of the right table.
 * @param col - Specific column to hide, or null for all columns from the table.
 * @param excludeLookupIndex - Index of the lookup being removed (to skip in the check).
 */
export function _hideLookupLayoutAliasesSafely(tid: string, col: string | null = null, excludeLookupIndex: number = -1): void {
  const store = getStore();
  const rt = tid ? store.getState().tables?.[tid] : null;
  if (!rt || !Array.isArray(rt.cols)) return;
  const cols = col === null ? rt.cols : [col];
  for (const c of cols) {
    if (_lookupColumnUsedElsewhere(tid, c, excludeLookupIndex)) continue;
    _hideLayoutAliasesForSource(tid, c);
  }
}

/**
 * Check whether a specific column alias is visible in the layout.
 *
 * @param alias - The column alias to check.
 * @param _mode - Layout mode hint (currently unused, reserved for future use).
 * @returns True if the alias is in selCols, or if selCols is not a Set (all visible).
 */
export function _isAliasVisibleInLayout(alias: string, _mode: string): boolean {
  if (!alias) return true;
  const store = getStore();
  const selCols = store.getState().selCols;
  if (!(selCols instanceof Set)) return true;
  return selCols.has(alias);
}

/**
 * Sync subtotal-by columns to match the current column order.
 *
 * Filters out subtotalBy entries that no longer exist in colOrder, removes
 * duplicates, and sorts by their position in colOrder.
 */
export function _syncSubtotalByToLayout(): void {
  const store = getStore();
  const state = store.getState();
  if (!Array.isArray(state.subtotalBy) || !state.subtotalBy.length) return;
  const colMap = buildColSourceMap();
  const order = Array.isArray(state.colOrder) ? state.colOrder : [...colMap.keys()];
  const orderIdx = new Map(order.map((c, i) => [c, i]));
  const seen = new Set<string>();
  store.update(draft => {
    draft.subtotalBy = draft.subtotalBy
      .filter(c => orderIdx.has(c) && !seen.has(c) && (seen.add(c), true))
      .sort((a, b) => (orderIdx.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b) ?? Number.MAX_SAFE_INTEGER));
  });
}

/**
 * Handle post-combine state cleanup after column set changes.
 *
 * Updates selCols to include newly appeared columns and remove stale ones
 * (unless they are in _disabledCardCols). Updates colOrder to match the
 * current projected columns. Syncs subtotalBy. Invalidates validation.
 */
export function _afterCombineChange(): void {
  invalidateValidation();
  const store = getStore();
  const colMap = buildColSourceMap();
  const nowCols = [...colMap.keys()];
  store.update(draft => {
    const selCols = draft.selCols as unknown as Set<string>;
    if (selCols instanceof Set) {
      const nowSet = new Set(nowCols);
      for (const c of [...selCols]) { if (!nowSet.has(c) && !_disabledCardCols.has(c)) selCols.delete(c); }
    }
    if (!draft.colOrder) {
      draft.colOrder = [];
    } else {
      const nowSet = new Set(nowCols);
      draft.colOrder = draft.colOrder.filter(c => nowSet.has(c));
    }
  });
  _syncSubtotalByToLayout();
}
