import { db } from '../core/state.js';

// ── Alias Reference Updater ──────────────────────────────────────────────────
// When a column alias is renamed, updates every config reference
// (colOrder, selCols, groupBy, subtotalBy, mergedCols, aggregates, filters,
//  sorts, calcStages, colTotals, subtotalFns, aggModeState) to use the new name.

export function _renameProjectedAliasRefs(oldAlias: string, newAlias: string): void {
  if (!oldAlias || !newAlias || oldAlias === newAlias) return;

  if (Array.isArray(db.colOrder)) {
    const idx = db.colOrder.indexOf(oldAlias);
    if (idx >= 0) {
      if (!db.colOrder.includes(newAlias)) db.colOrder[idx] = newAlias;
      else db.colOrder.splice(idx, 1);
    }
  }

  const selCols = db.selCols as Set<string> | null;
  if (selCols instanceof Set && selCols.has(oldAlias)) {
    selCols.delete(oldAlias);
    selCols.add(newAlias);
  }

  const replaceInArray = (arr: string[]): void => {
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
    if (c.mode === 'math' && c.math && typeof c.math === 'object') {
      const math = c.math as { steps?: Array<{ type?: string; value?: string }> };
      if (Array.isArray(math.steps)) {
        for (const step of math.steps) {
          if (step.type === 'column' && step.value === oldAlias) step.value = newAlias;
        }
      }
    }
    if (c.mode === 'compare' && c.compare && typeof c.compare === 'object') {
      const compare = c.compare as { conditions?: Array<{ col?: string }>; trueValue?: { type?: string; value?: string }; falseValue?: { type?: string; value?: string } };
      if (Array.isArray(compare.conditions)) {
        for (const cond of compare.conditions) {
          if (cond.col === oldAlias) cond.col = newAlias;
        }
      }
      if (compare.trueValue?.type === 'column' && compare.trueValue.value === oldAlias) {
        compare.trueValue.value = newAlias;
      }
      if (compare.falseValue?.type === 'column' && compare.falseValue.value === oldAlias) {
        compare.falseValue.value = newAlias;
      }
    }
    if (c.mode === 'text' && c.text && typeof c.text === 'object') {
      const text = c.text as { parts?: Array<{ type?: string; value?: string }>; source?: { type?: string; value?: string } };
      if (Array.isArray(text.parts)) {
        for (const part of text.parts) {
          if (part.type === 'column' && part.value === oldAlias) part.value = newAlias;
        }
      }
      if (text.source?.type === 'column' && text.source.value === oldAlias) {
        text.source.value = newAlias;
      }
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

  const as = db.aggModeState as Record<string, unknown> | null;
  if (as && typeof as === 'object') {
    const replaceInSel = (state: unknown): void => {
      if (!state || !Array.isArray((state as Record<string, unknown>).selCols)) return;
      const sel = (state as Record<string, string[]>).selCols;
      for (let i = 0; i < sel.length; i++) {
        if (sel[i] === oldAlias) sel[i] = newAlias;
      }
    };
    replaceInSel(as.none);
    replaceInSel(as.totals);
    replaceInSel(as.subtotals);
    const groupState = as.group as Record<string, unknown> | undefined;
    if (groupState && Array.isArray(groupState.groupBy as string[])) {
      const gb = groupState.groupBy as string[];
      for (let i = 0; i < gb.length; i++) {
        if (gb[i] === oldAlias) gb[i] = newAlias;
      }
    }
    if (groupState && Array.isArray(groupState.aggregates as Array<Record<string, unknown>>)) {
      for (const a of (groupState.aggregates as Array<Record<string, string>>)) {
        if (a && a.col === oldAlias) a.col = newAlias;
      }
    }
    const totalsState = as.totals as Record<string, unknown> | undefined;
    if (totalsState?.colTotals && typeof totalsState.colTotals === 'object') {
      const ct = totalsState.colTotals as Record<string, string>;
      if (Object.prototype.hasOwnProperty.call(ct, oldAlias)) {
        if (!Object.prototype.hasOwnProperty.call(ct, newAlias)) {
          ct[newAlias] = ct[oldAlias];
        }
        delete ct[oldAlias];
      }
    }
    const subtotalsState = as.subtotals as Record<string, unknown> | undefined;
    if (subtotalsState && Array.isArray(subtotalsState.subtotalBy as string[])) {
      const sb = subtotalsState.subtotalBy as string[];
      for (let i = 0; i < sb.length; i++) {
        if (sb[i] === oldAlias) sb[i] = newAlias;
      }
    }
    if (subtotalsState?.subtotalFns && typeof subtotalsState.subtotalFns === 'object') {
      const sf = subtotalsState.subtotalFns as Record<string, string>;
      if (Object.prototype.hasOwnProperty.call(sf, oldAlias)) {
        if (!Object.prototype.hasOwnProperty.call(sf, newAlias)) {
          sf[newAlias] = sf[oldAlias];
        }
        delete sf[oldAlias];
      }
    }
  }
}
