/**
 * State Applier — applies hydrated report configuration to the reactive store.
 *
 * Takes a hydrated `next` state object (from `hydrateState`) and merges it
 * into the store via `store.update()`, then applies excluded rows and
 * invalidates the validation cache.
 *
 * Ported from SRC/js/core/state-applier.ts — zero imports from SRC/js/.
 * The old code also called UI rendering functions (loadAggModeState,
 * renderQueryBuilder, renderMergeToggles) and assigned `window.applyState`.
 * Those are omitted here: the Preact architecture handles UI updates
 * reactively via store subscriptions.
 */

import { getStore } from './store';
import { invalidateValidation } from '../report/validation';
import { resetLayoutSelection } from '../query/layout-selection';

/**
 * Apply hydrated state to the reactive store and invalidate validation.
 *
 * Merges all properties from `next` into the store's draft state, then
 * applies excluded rows from `nextExcludedRows` (keyed by table ID).
 * Finally invalidates the validation cache so the next `getValidation()`
 * call recomputes from the updated state.
 *
 * @param next - Hydrated state properties to merge (from `hydrateState`)
 * @param nextExcludedRows - Excluded row sets keyed by table ID
 */
export function applyState(next: Record<string, unknown>, nextExcludedRows: Record<string, Set<number>>): void {
  getStore().update(draft => {
    Object.assign(draft, next);
    for (const [tid, set] of Object.entries(nextExcludedRows)) {
      draft.excludedRows[tid] = set;
    }
  });
  invalidateValidation();
  resetLayoutSelection();
}
