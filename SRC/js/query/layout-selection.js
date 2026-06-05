'use strict';

// ── Column Layout / Selection ────────────────────────────────────────────────
// Controls which columns are visible in the output (selCols) and manages
// visibility toggles from source-table add/remove and lookup add/remove.

let _seenCols = new Set();
let _previewOpen = new Set();

function _sampleTipFor(tid, col, extra = []) {
  const tbl  = db.tables?.[tid];
  const vals = (tbl?.samples?.[col] || []).slice(0, 3).map(v => String(v));
  const lines = [
    `From sheet: ${tbl?.name || tid}`,
    vals.length ? `Sample values: ${vals.join(' \u00B7 ')}` : 'Sample values: (none found)',
    ...extra,
  ];
  return `data-tip="${lines.map(line => h(line)).join('&#10;')}"`;
}

function _isSourceVisibleInLayout(tid, col, colMap, mode) {
  if (!(db.selCols instanceof Set)) return true;
  let seen = false;
  for (const [alias, src] of colMap.entries()) {
    if (src?.tid !== tid || src?.col !== col) continue;
    seen = true;
    if (db.selCols.has(alias)) return true;
  }
  return !seen;
}

function _setLayoutAliasesForSourceVisibility(tid, col = null, isVisible = true) {
  const mode = db.aggMode || 'none';
  if (!tid) return;
  const aliases = projectedCols();
  if (!(db.selCols instanceof Set)) db.selCols = new Set(aliases);
  const colMap = buildColSourceMap();
  for (const alias of aliases) {
    const src = colMap.get(alias);
    if (src?.tid !== tid) continue;
    if (col !== null && src?.col !== col) continue;
    if (isVisible) db.selCols.add(alias);
    else db.selCols.delete(alias);
  }
}

function _showLayoutAliasesForSource(tid, col = null) {
  _setLayoutAliasesForSourceVisibility(tid, col, true);
}

function _hideLayoutAliasesForSource(tid, col = null) {
  _setLayoutAliasesForSourceVisibility(tid, col, false);
}

function _lookupColumnUsedElsewhere(tid, col, excludeLookupIndex = -1) {
  const lookups = Array.isArray(db.lookups) ? db.lookups : [];
  for (let i = 0; i < lookups.length; i++) {
    if (i === excludeLookupIndex) continue;
    const lk = lookups[i];
    if (!lk || lk.rightId !== tid) continue;
    if (Array.isArray(lk.cols) && lk.cols.includes(col)) return true;
  }
  return false;
}

function _hideLookupLayoutAliasesSafely(tid, col = null, excludeLookupIndex = -1) {
  const rt = tid ? db.tables?.[tid] : null;
  if (!rt || !Array.isArray(rt.cols)) return;
  const cols = col === null ? rt.cols : [col];
  for (const c of cols) {
    if (_lookupColumnUsedElsewhere(tid, c, excludeLookupIndex)) continue;
    _hideLayoutAliasesForSource(tid, c);
  }
}

function _isAliasVisibleInLayout(alias, mode) {
  if (!alias) return true;
  if (!(db.selCols instanceof Set)) return true;
  return db.selCols.has(alias);
}

function _syncSubtotalByToLayout() {
  if (!Array.isArray(db.subtotalBy) || !db.subtotalBy.length) return;
  const order = Array.isArray(db.colOrder) ? db.colOrder : projectedCols();
  const orderIdx = new Map(order.map((c, i) => [c, i]));
  const seen = new Set();
  db.subtotalBy = db.subtotalBy
    .filter(c => orderIdx.has(c) && !seen.has(c) && (seen.add(c), true))
    .sort((a, b) => (orderIdx.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b) ?? Number.MAX_SAFE_INTEGER));
}

function _afterCombineChange() {
  _checkAllLookups();
  _checkAllCalcs();
  const nowCols = projectedCols();
  if (db.selCols) {
    nowCols.forEach(c => { if (!_seenCols.has(c)) { db.selCols.add(c); _seenCols.add(c); } });
    const nowSet = new Set(nowCols);
    for (const c of [...db.selCols]) { if (!nowSet.has(c)) db.selCols.delete(c); }
  }
  if (!db.colOrder) {
    db.colOrder = [...nowCols];
  } else {
    const nowSet = new Set(nowCols);
    db.colOrder = [
      ...db.colOrder.filter(c => nowSet.has(c)),
      ...nowCols.filter(c => !db.colOrder.includes(c)),
    ];
  }
  _syncSubtotalByToLayout();
  renderQueryBuilder();
}
