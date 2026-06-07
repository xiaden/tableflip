import { db } from './state.js';
import { invalidateValidation } from '../report/validation.js';
import { loadAggModeState } from '../ui/aggregation.js';
import { renderQueryBuilder } from '../query/query-builder.js';
import { renderMergeToggles } from '../query/output-card.js';
import { projectedCols } from '../catalog/column-catalog.js';

// ── State Applier ────────────────────────────────────────────────────────────
// Takes a hydrated `next` state object and applies it to the global `db`
// object, then runs post-load hooks (validation invalidation, mode loading,
// UI re-render).

export function applyState(next, nextExcludedRows) {
  Object.assign(db, next);
  for (const [tid, set] of Object.entries(nextExcludedRows)) {
    db.excludedRows[tid] = set;
  }
  invalidateValidation();

  loadAggModeState(db.aggMode || 'none');
  renderQueryBuilder();
  if (db.base) {
    try { renderMergeToggles(projectedCols()); } catch (_) {}
  }
}
window.applyState = applyState;