'use strict';

const _lookupDupErrorCache = new Map();
const _calcErrorCache       = new Map();
function getLookupDupErrors() { return _lookupDupErrorCache; }
function getCalcErrors()      { return _calcErrorCache; }

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

function renderQueryBuilder() {
  invalidateValidation();

  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));

  const qEmpty = document.getElementById('qEmpty');
  const qBuilder = document.getElementById('qBuilder');
  if (qEmpty) qEmpty.style.display = ids.length ? 'none' : '';
  if (qBuilder) qBuilder.style.display = ids.length ? 'grid' : 'none';

  if (!ids.length) return;

  _checkAllLookups();
  _checkAllCalcs();

  const hasBase = !!db.base && !!db.tables[db.base];
  const hasBaseConfigured = !!db.base;

  ['colCard', 'filterSortCard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = hasBase ? '' : 'none';
  });

  const runRowEl = document.getElementById('runRow');
  if (runRowEl) runRowEl.style.display = hasBaseConfigured ? '' : 'none';

  if (hasBaseConfigured) {
    const v         = getValidation();
    const blocked   = v.reportStatus === 'blocked';
    const issueCount = Object.values(v.items).filter(it => it.blocking).length;

    const pill    = document.getElementById('reportStatusPill');
    const runBtn  = document.getElementById('runBtn');

    if (pill) {
      pill.style.display = '';
      if (blocked) {
        pill.textContent   = `\u26A0 Blocked (${issueCount} issue${issueCount !== 1 ? 's' : ''})`;
        pill.style.background  = 'rgba(200,60,60,0.18)';
        pill.style.color       = '#e07070';
        pill.style.border      = '1px solid rgba(200,60,60,0.35)';
      } else {
        pill.textContent   = '\u2713 Healthy';
        pill.style.background  = 'rgba(50,180,100,0.15)';
        pill.style.color       = '#6ec87e';
        pill.style.border      = '1px solid rgba(50,180,100,0.3)';
      }
    }
    if (runBtn) runBtn.disabled = blocked;
  }

  renderPipeline(ids);

  if (!hasBase) return;
  renderColChips();
  renderFilters();
  renderSorts();
  renderAggregation();

  try {
    renderMergeToggles(projectedCols());
  } catch (_) {}
}

function onBaseChange(val) {
  db.base       = val;
  db.baseCols   = null;
  db.stacks     = [];
  db.lookups    = [];
  db.calcStages = [];
  db.selCols    = null;
  db.colOrder   = null;
  db.groupBy    = [];
  db.aggregates = [];
  db.aggMode    = 'none';
  db.aggModeState = null;
  db.colTotals  = {};
  db.sorts      = [];
  db.filters    = [];
  _seenCols     = new Set();
  _previewOpen  = new Set();
  renderQueryBuilder();
}

function togglePreview(key) {
  if (_previewOpen.has(key)) {
    _previewOpen.delete(key);
  } else {
    _previewOpen.add(key);
  }
  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
  renderPipeline(ids);
}

function _buildPreviewSQL(key) {
  const spec = {
    base:        db.base,
    baseCols:    db.baseCols,
    stacks:      db.stacks,
    excludedRows: db.excludedRows,
    lookups:     db.lookups,
    calcStages:  db.calcStages,
    selCols:     db.selCols,
    colOrder:    db.colOrder,
    filters:     [],
    sorts:       [],
    groupBy:     [],
    aggregates:  [],
    aggMode:     'none',
    colTotals:   {},
    subtotalBy:  [],
    subtotalFns: {},
  };

  if (key !== 'base') {
    const lkMatch   = key.match(/^lk(\d+)$/);
    const calcMatch = key.match(/^calc(\d+)$/);
    if (!lkMatch && !calcMatch) return null;
    if (lkMatch) {
      const depth = +lkMatch[1];
      spec.lookups    = (db.lookups || []).slice(0, depth + 1);
      spec.calcStages = [];
    } else {
      const depth = +calcMatch[1];
      spec.calcStages = (db.calcStages || []).slice(0, depth + 1);
    }
  }

  const colCatalog = buildColumnCatalog(spec);
  const plan = buildQueryPlan(spec, colCatalog);
  const result = renderDetailSql(plan);
  if (!result) return null;
  result.sql = result.sql.replace(/\s*(?:ORDER BY[^;]+)?$/, ' LIMIT 5');
  return result;
}

function _buildPreviewHTML(key) {
  try {
    let sql, params;
    if (key === 'base') {
      const ids = [db.base, ...(db.stacks || []).filter(id => db.tables[id])];
      if (!ids.every(id => db.tables[id])) return '<em>Not ready</em>';
      const baseCols = db.tables[db.base].cols;
      sql = ids.map(id => {
        const tCols = db.tables[id].cols;
        const sel   = baseCols.map(c => tCols.includes(c) ? quoteId(c) : 'NULL').join(', ');
        return `SELECT ${sel} FROM ${quoteId(id)}`;
      }).join(' UNION ALL ');
      sql = `SELECT * FROM (${sql}) LIMIT 5`;
      params = [];
    } else {
      const result = _buildPreviewSQL(key);
      if (!result) return '<em>Unknown stage</em>';
      sql    = result.sql;
      params = result.params;
    }
    const rows = execQuery(sql, params);
    if (!rows.length) return '<em style="font-size:0.72rem;color:var(--muted)">No rows</em>';
    const cols  = Object.keys(rows[0]);
    const pvMap = buildColSourceMap();
    return `<table>
      <thead><tr>${cols.map(c => `<th title="${h(c)}">${h(colDisplayLabel(c, pvMap))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r =>
        `<tr>${cols.map(c => `<td title="${h(String(r[c] ?? ''))}">${h(String(r[c] ?? ''))}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table>`;
  } catch (ex) {
    return `<em style="color:var(--red);font-size:0.72rem">Error: ${h(ex.message)}</em>`;
  }
}

function addStack(id) {
  if (!id || !db.tables[id] || id === db.base) return;
  if (!db.stacks.includes(id)) db.stacks.push(id);
  _afterCombineChange();
}
function removeStack(id) {
  db.stacks = db.stacks.filter(s => s !== id);
  _afterCombineChange();
}
function addLookup() {
  if (!db.base) return;
  if (!db.lookups) db.lookups = [];
  db.lookups.push({ rightId: '', keyPairs: [{ left: '', right: '' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } });
  _afterCombineChange();
}

function addCalcStage() {
  if (!db.base) return;
  if (!db.calcStages) db.calcStages = [];
  db.calcStages.push({
    alias: '',
    left: '',
    op: '-',
    right: '',
    conditions: [],
    compareMode: 'AND',
    customTF: false,
    trueVal: '',
    falseVal: '',
    window: 7,
    explicitOrder: false,
    orderCol: '',
    orderDir: 'ASC',
    enabled: true,
  });
  _afterCombineChange();
}

function removeCalcStage(i) {
  if (!Array.isArray(db.calcStages)) db.calcStages = [];
  db.calcStages.splice(i, 1);
  _afterCombineChange();
}

function _renameProjectedAliasRefs(oldAlias, newAlias) {
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

function _calcStageError(calc, i) {
  return typeof window.checkCalcError === 'function'
    ? window.checkCalcError(calc, i)
    : null;
}

function _checkAllCalcs() {
  if (!Array.isArray(db.calcStages)) db.calcStages = [];
  _calcErrorCache.clear();
  for (let i = 0; i < db.calcStages.length; i++) {
    const err = _calcStageError(db.calcStages[i], i);
    if (err) _calcErrorCache.set(i, err);
  }
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

function _checkAllLookups() {
  _lookupDupErrorCache.clear();
  for (let i = 0; i < (db.lookups || []).length; i++) {
    const err = typeof window.checkLookupDuplicates === 'function'
      ? window.checkLookupDuplicates(db.lookups[i])
      : null;
    if (err) _lookupDupErrorCache.set(i, err);
  }
}
function removeLookup(i) {
  db.lookups.splice(i, 1);
  _afterCombineChange();
}
function selectAllLookupCols(i) {
  const lk = db.lookups[i];
  const rt = lk.rightId && db.tables[lk.rightId];
  if (rt) {
    _showLayoutAliasesForSource(lk.rightId);
    _afterCombineChange();
  }
}
function selectNoneLookupCols(i) {
  const lk = db.lookups[i];
  _hideLookupLayoutAliasesSafely(lk.rightId, null, i);
  _afterCombineChange();
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

function runQuery() {
  if (!db.base || !db.tables[db.base]) return;

  _checkAllLookups();
  _checkAllCalcs();

  const v = getValidation();
  if (v.reportStatus === 'blocked') {
    const blockingItems = Object.values(v.items).filter(item => item.blocking);
    const firstMsg = blockingItems[0]?.issues[0]?.message || 'missing source data';
    toast(`Can't run \u2014 fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ''}).`, 'err');
    return;
  }

  const skippedLookups = (db.lookups || []).filter(
    lk => lk.rightId && db.tables[lk.rightId] && !_lkKeyPairs(lk).length
  );
  if (skippedLookups.length) {
    const names = skippedLookups.map(lk => `"${db.tables[lk.rightId].name}"`).join(', ');
    toast(`Lookup${skippedLookups.length > 1 ? 's' : ''} skipped (match columns not set): ${names}`, 'warn');
  }

  const _hasAgg = db.aggMode === 'group' && (db.groupBy.length > 0 || db.aggregates.length > 0);
  if (!_hasAgg && !['totals', 'subtotals'].includes(db.aggMode) && db.selCols && db.selCols.size === 0) {
    toast('No output columns selected \u2014 click All or pick at least one column.', 'err');
    return;
  }

  const status = document.getElementById('runStatus');
  status.textContent = 'Running\u2026';

  setTimeout(() => {
    try {
      const resultSet = executeReport(db);

      const displayRows = resultSet.rows.filter(r => !r._row_type);
      const hasTotals   = !!resultSet.metadata.totalsRow;
      const hasSubs     = !!resultSet.metadata.hasSubtotals;

      db.result = {
        rows:         resultSet.rows,
        totalsRow:    resultSet.metadata.totalsRow || null,
        cols:         resultSet.columns,
        hasSubtotals: hasSubs,
      };

      let statusText = displayRows.length.toLocaleString() + ' rows';
      if (hasTotals) statusText += ' + grand total';
      if (hasSubs)   statusText += ' (subtotals)';
      status.textContent = statusText;

      switchTab('results');
      renderResults(db.result);
    } catch (ex) {
      status.textContent = 'Error';
      toast('Query error: ' + ex.message, 'err');
      console.error(ex.message);
    }
  }, 20);
}
