import { db } from '../core/state.js';
import { h, toast, colDisplayLabel } from '../core/utils.js';
import { quoteId, execQuery } from '../core/sqldb.js';
import { buildColSourceMap, buildColumnCatalog, projectedCols } from '../catalog/column-catalog.js';
import { buildSourceCatalog } from '../catalog/source-catalog.js';
import { buildQueryPlan } from './query-plan.js';
import { renderDetailSql } from './sql-detail.js';
import { renderPipeline } from './pipeline-card.js';
import { renderAggregation } from '../ui/aggregation.js';
import { renderMergeToggles, renderColChips } from './output-card.js';
import { renderFilters, renderSorts } from './filter-sort-card.js';
import {
  _afterCombineChange, _showLayoutAliasesForSource,
  _hideLookupLayoutAliasesSafely, _seenCols, _previewOpen,
} from './layout-selection.js';
import { invalidateValidation, getValidation } from '../report/validation.js';
import { runReport as executeReport } from '../report/engine.js';
import { switchTab } from '../ui/tabs.js';
import { renderResults } from '../ui/grid.js';

export function renderQueryBuilder() {
  invalidateValidation();

  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));

  const qEmpty = document.getElementById('qEmpty');
  const qBuilder = document.getElementById('qBuilder');
  if (qEmpty) qEmpty.style.display = ids.length ? 'none' : '';
  if (qBuilder) qBuilder.style.display = ids.length ? 'grid' : 'none';

  if (!ids.length) return;

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

export function onBaseChange(val) {
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
  _seenCols.clear();
  _previewOpen.clear();
  renderQueryBuilder();
}

export function togglePreview(key) {
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

  const srcCatalog = typeof buildSourceCatalog === 'function' ? buildSourceCatalog() : null;
  if (!srcCatalog) return null;
  const colCatalog = buildColumnCatalog(spec, srcCatalog);
  const plan = buildQueryPlan(spec, colCatalog, null, srcCatalog);
  const result = renderDetailSql(plan);
  if (!result) return null;
  result.sql = result.sql.replace(/\s*(?:ORDER BY[^;]+)?$/, ' LIMIT 5');
  return result;
}

export function _buildPreviewHTML(key) {
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

export function addStack(id) {
  if (!id || !db.tables[id] || id === db.base) return;
  if (!db.stacks.includes(id)) db.stacks.push(id);
  _afterCombineChange();
}
export function removeStack(id) {
  db.stacks = db.stacks.filter(s => s !== id);
  _afterCombineChange();
}
export function addLookup() {
  if (!db.base) return;
  if (!db.lookups) db.lookups = [];
  db.lookups.push({ rightId: '', keyPairs: [{ left: '', right: '' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } });
  _afterCombineChange();
}

export function addCalcStage() {
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

export function removeCalcStage(i) {
  if (!Array.isArray(db.calcStages)) db.calcStages = [];
  db.calcStages.splice(i, 1);
  _afterCombineChange();
}

export function removeLookup(i) {
  db.lookups.splice(i, 1);
  _afterCombineChange();
}
export function selectAllLookupCols(i) {
  const lk = db.lookups[i];
  const rt = lk.rightId && db.tables[lk.rightId];
  if (rt) {
    _showLayoutAliasesForSource(lk.rightId);
    _afterCombineChange();
  }
}
export function selectNoneLookupCols(i) {
  const lk = db.lookups[i];
  _hideLookupLayoutAliasesSafely(lk.rightId, null, i);
  _afterCombineChange();
}

export function runQuery() {
  if (!db.base || !db.tables[db.base]) return;

  invalidateValidation();

  const v = getValidation();
  if (v.reportStatus === 'blocked') {
    const blockingItems = Object.values(v.items).filter(item => item.blocking);
    const firstMsg = blockingItems[0]?.issues[0]?.message || 'missing source data';
    toast(`Can't run \u2014 fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ''}).`, 'err');
    return;
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

// HTML onclick / onchange compatibility
window.onBaseChange = onBaseChange;
window.addStack = addStack;
window.addLookup = addLookup;
window.addCalcStage = addCalcStage;
window.runQuery = runQuery;
