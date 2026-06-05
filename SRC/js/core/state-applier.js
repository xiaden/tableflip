'use strict';

// ── State Applier ────────────────────────────────────────────────────────────
// Takes a hydrated `next` state object and applies it to the global `db`
// object, then runs post-load hooks (validation invalidation, mode loading,
// UI re-render).

function applyState(next, nextExcludedRows) {
  Object.assign(db, next);
  for (const [tid, set] of Object.entries(nextExcludedRows)) {
    db.excludedRows[tid] = set;
  }
  if (typeof invalidateValidation === 'function') invalidateValidation();

  if (typeof loadAggModeState === 'function') loadAggModeState(db.aggMode || 'none');
  renderQueryBuilder();
  if (db.base && typeof renderMergeToggles === 'function') {
    try { renderMergeToggles(projectedCols()); } catch (_) {}
  }
}
