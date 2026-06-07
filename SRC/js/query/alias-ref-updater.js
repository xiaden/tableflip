import { db } from '../core/state.js';

// ── Alias Reference Updater ──────────────────────────────────────────────────
// When a column alias is renamed, updates every config reference
// (colOrder, selCols, groupBy, subtotalBy, mergedCols, aggregates, filters,
//  sorts, calcStages, colTotals, subtotalFns, aggModeState) to use the new name.

export function _renameProjectedAliasRefs(oldAlias, newAlias) {
  if (!oldAlias || !newAlias || oldAlias === newAlias) return;

  if (Array.isArray(db.colOrder)) {
    const idx = db.colOrder.indexOf(oldAlias);
    if (idx >= 0) {
      if (!db.colOrder.includes(newAlias)) db.colOrder[idx] = newAlias;
      else db.colOrder.splice(idx, 1);
    }
  }

  if (db.selCols instanceof Set && db.selCols.has(oldAlias)) {
    db.selCols.delete(oldAlias);
    db.selCols.add(newAlias);
  }

  const replaceInArray = arr => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === oldAlias) arr[i] = newAlias;
    }
  };

  replaceInArray(db.groupBy);
  replaceInArray(db.subtotalBy);
  replaceInArray(db.mergedCols);

  for (const a of (db.aggregates || [])) {
    if (a.col === oldAlias) a.col = newAlias;
  }
  for (const f of (db.filters || [])) {
    if (f.col === oldAlias) f.col = newAlias;
  }
  for (const s of (db.sorts || [])) {
    if (s.col === oldAlias) s.col = newAlias;
  }
  for (const c of (db.calcStages || [])) {
    if (c.left === oldAlias) c.left = newAlias;
    if (c.right === oldAlias) c.right = newAlias;
    if (c.orderCol === oldAlias) c.orderCol = newAlias;
    for (const cond of (c.conditions || [])) {
      if (cond.col === oldAlias) cond.col = newAlias;
    }
  }

  if (db.colTotals && Object.prototype.hasOwnProperty.call(db.colTotals, oldAlias)) {
    if (!Object.prototype.hasOwnProperty.call(db.colTotals, newAlias)) {
      db.colTotals[newAlias] = db.colTotals[oldAlias];
    }
    delete db.colTotals[oldAlias];
  }
  if (db.subtotalFns && Object.prototype.hasOwnProperty.call(db.subtotalFns, oldAlias)) {
    if (!Object.prototype.hasOwnProperty.call(db.subtotalFns, newAlias)) {
      db.subtotalFns[newAlias] = db.subtotalFns[oldAlias];
    }
    delete db.subtotalFns[oldAlias];
  }

  if (db.aggModeState && typeof db.aggModeState === 'object') {
    const replaceInSel = state => {
      if (!state || !Array.isArray(state.selCols)) return;
      for (let i = 0; i < state.selCols.length; i++) {
        if (state.selCols[i] === oldAlias) state.selCols[i] = newAlias;
      }
    };
    replaceInSel(db.aggModeState.none);
    replaceInSel(db.aggModeState.totals);
    replaceInSel(db.aggModeState.subtotals);
    const groupState = db.aggModeState.group;
    if (groupState && Array.isArray(groupState.groupBy)) {
      for (let i = 0; i < groupState.groupBy.length; i++) {
        if (groupState.groupBy[i] === oldAlias) groupState.groupBy[i] = newAlias;
      }
    }
    if (groupState && Array.isArray(groupState.aggregates)) {
      for (const a of groupState.aggregates) {
        if (a && a.col === oldAlias) a.col = newAlias;
      }
    }
    const totalsState = db.aggModeState.totals;
    if (totalsState?.colTotals && Object.prototype.hasOwnProperty.call(totalsState.colTotals, oldAlias)) {
      if (!Object.prototype.hasOwnProperty.call(totalsState.colTotals, newAlias)) {
        totalsState.colTotals[newAlias] = totalsState.colTotals[oldAlias];
      }
      delete totalsState.colTotals[oldAlias];
    }
    const subtotalsState = db.aggModeState.subtotals;
    if (subtotalsState && Array.isArray(subtotalsState.subtotalBy)) {
      for (let i = 0; i < subtotalsState.subtotalBy.length; i++) {
        if (subtotalsState.subtotalBy[i] === oldAlias) subtotalsState.subtotalBy[i] = newAlias;
      }
    }
    if (subtotalsState?.subtotalFns && Object.prototype.hasOwnProperty.call(subtotalsState.subtotalFns, oldAlias)) {
      if (!Object.prototype.hasOwnProperty.call(subtotalsState.subtotalFns, newAlias)) {
        subtotalsState.subtotalFns[newAlias] = subtotalsState.subtotalFns[oldAlias];
      }
      delete subtotalsState.subtotalFns[oldAlias];
    }
  }
}
