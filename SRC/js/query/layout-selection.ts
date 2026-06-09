import { db } from '../core/state.js';
import { projectedCols, buildColSourceMap, ColMapEntry } from '../catalog/column-catalog.js';
import { invalidateValidation } from '../report/validation.js';
import { renderQueryBuilder } from '../ui/views/query-builder.js';

// ── Column Layout / Selection ────────────────────────────────────────────────
// Controls which columns are visible in the output (selCols) and manages
// visibility toggles from source-table add/remove and lookup add/remove.

export const _seenCols: Set<string> = new Set();
export const _previewOpen: Set<string> = new Set();
export const _disabledCardCols: Set<string> = new Set();

export function _sampleTipFor(tid: string, col: string, extra: string[] = []): string {
  const tbl  = (db.tables?.[tid] as unknown as Record<string, unknown> | undefined);
  const vals = ((tbl?.samples as Record<string, unknown[]> | undefined)?.[col] || []).slice(0, 3).map((v: unknown) => String(v));
  return [
    `From sheet: ${tbl?.name || tid}`,
    vals.length ? `Sample values: ${vals.join(' \u00B7 ')}` : 'Sample values: (none found)',
    ...extra,
  ].join('\n');
}

export function _isSourceVisibleInLayout(tid: string, col: string, colMap: Map<string, ColMapEntry>, _mode: string): boolean {
  const selCols = db.selCols as Set<string> | null;
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

function _setLayoutAliasesForSourceVisibility(tid: string, col: string | null = null, isVisible: boolean = true): void {
  if (!tid) return;
  const aliases = projectedCols();
  let selCols = db.selCols as Set<string> | null;
  if (!(selCols instanceof Set)) { selCols = new Set(aliases); db.selCols = selCols; }
  const colMap = buildColSourceMap();
  for (const alias of aliases) {
    const src = colMap.get(alias);
    if (!src || src.kind === 'calc') continue;
    if (src.tid !== tid) continue;
    if (col !== null && src.col !== col) continue;
    if (isVisible) selCols.add(alias);
    else selCols.delete(alias);
  }
}

export function _showLayoutAliasesForSource(tid: string, col: string | null = null): void {
  _setLayoutAliasesForSourceVisibility(tid, col, true);
}

export function _hideLayoutAliasesForSource(tid: string, col: string | null = null): void {
  _setLayoutAliasesForSourceVisibility(tid, col, false);
}

function _lookupColumnUsedElsewhere(tid: string, col: string, excludeLookupIndex: number = -1): boolean {
  const lookups = Array.isArray(db.lookups) ? db.lookups : [];
  for (let i = 0; i < lookups.length; i++) {
    if (i === excludeLookupIndex) continue;
    const lk = lookups[i];
    if (!lk || lk.rightId !== tid) continue;
    if (Array.isArray(lk.cols) && lk.cols.includes(col)) return true;
  }
  return false;
}

export function _hideLookupLayoutAliasesSafely(tid: string, col: string | null = null, excludeLookupIndex: number = -1): void {
  const rt = tid ? db.tables?.[tid] : null;
  if (!rt || !Array.isArray(rt.cols)) return;
  const cols = col === null ? rt.cols : [col];
  for (const c of cols) {
    if (_lookupColumnUsedElsewhere(tid, c, excludeLookupIndex)) continue;
    _hideLayoutAliasesForSource(tid, c);
  }
}

export function _isAliasVisibleInLayout(alias: string, _mode: string): boolean {
  if (!alias) return true;
  const selCols = db.selCols as Set<string> | null;
  if (!(selCols instanceof Set)) return true;
  return selCols.has(alias);
}

export function _syncSubtotalByToLayout(): void {
  if (!Array.isArray(db.subtotalBy) || !db.subtotalBy.length) return;
  const order = Array.isArray(db.colOrder) ? db.colOrder : projectedCols();
  const orderIdx = new Map(order.map((c, i) => [c, i]));
  const seen = new Set();
  db.subtotalBy = db.subtotalBy
    .filter(c => orderIdx.has(c) && !seen.has(c) && (seen.add(c), true))
    .sort((a, b) => (orderIdx.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b) ?? Number.MAX_SAFE_INTEGER));
}

export function _afterCombineChange(): void {
  invalidateValidation();
  const nowCols = projectedCols();
  const selCols = db.selCols as Set<string> | null;
  if (selCols) {
    nowCols.forEach(c => { if (!_seenCols.has(c)) { selCols.add(c); _seenCols.add(c); } });
    const nowSet = new Set(nowCols);
    for (const c of [...selCols]) { if (!nowSet.has(c) && !_disabledCardCols.has(c)) selCols.delete(c); }
  }
  const colOrder = db.colOrder;
  if (!colOrder) {
    db.colOrder = [...nowCols];
  } else {
    const nowSet = new Set(nowCols);
    db.colOrder = [
      ...colOrder.filter(c => nowSet.has(c)),
      ...nowCols.filter(c => !colOrder.includes(c)),
    ];
  }
  _syncSubtotalByToLayout();
  renderQueryBuilder();
}
