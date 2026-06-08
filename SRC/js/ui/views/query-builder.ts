import { db } from '../../core/state.js';
import { h, toast, colDisplayLabel } from '../../core/utils.js';
import { quoteId, execQuery } from '../../core/sqldb.js';
import { buildColSourceMap, buildColumnCatalog, projectedCols } from '../../catalog/column-catalog.js';
import { buildSourceCatalog } from '../../catalog/source-catalog.js';
import { buildQueryPlan } from '../../query/query-plan.js';
import { renderDetailSql } from '../../query/sql-detail.js';
import { renderPipeline } from './pipeline-card.js';
import { renderAggregation } from '../aggregation.js';
import { renderMergeToggles, renderColChips } from './output-card.js';
import { renderFilters, renderSorts } from './filter-sort-card.js';
import { $ } from '../utils/dom.js';
import {
  _afterCombineChange, _showLayoutAliasesForSource,
  _hideLookupLayoutAliasesSafely, _seenCols, _previewOpen,
  _disabledCardCols,
} from '../../query/layout-selection.js';
import { invalidateValidation, getValidation } from '../../report/validation.js';
import { runReport as executeReport } from '../../report/engine.js';
import { switchTab } from '../tabs.js';
import { renderResults } from '../grid.js';

export function renderQueryBuilder(): void {
  invalidateValidation();

  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));

  const qEmpty = $('qEmpty');
  const qBuilder = $('qBuilder');
  if (qEmpty) qEmpty.style.display = ids.length ? 'none' : '';
  if (qBuilder) qBuilder.style.display = ids.length ? 'grid' : 'none';

  if (!ids.length) return;

  const hasBase = !!db.base && !!db.tables[db.base];
  const hasBaseConfigured = !!db.base;

  ['colCard', 'filterSortCard'].forEach(id => {
    const el = $(id);
    if (el) el.style.display = hasBase ? '' : 'none';
  });

  const runRowEl = $('runRow');
  if (runRowEl) runRowEl.style.display = hasBaseConfigured ? '' : 'none';

  if (hasBaseConfigured) {
    const v         = getValidation()!;
    const blocked   = v.reportStatus === 'blocked';
    const items = Object.values(v.items) as Array<{ blocking?: boolean; issues?: Array<{ message?: string }> }>;
    const issueCount = items.filter(it => it.blocking).length;

    const pill    = $('reportStatusPill');
    const runBtn  = $('runBtn');

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
    if (runBtn) (runBtn as HTMLButtonElement).disabled = blocked;
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

export function onBaseChange(val: string): void {
  db.base     = val;
  db.baseCols = null;
  db.stacks   = [];
  db.selCols  = null;
  db.colOrder = null;
  _seenCols.clear();
  _previewOpen.clear();
  _disabledCardCols.clear();
  renderQueryBuilder();
}

export function togglePreview(key: string): void {
  if (_previewOpen.has(key)) {
    _previewOpen.delete(key);
  } else {
    _previewOpen.add(key);
  }
  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
  renderPipeline(ids);
}

function _buildPreviewSQL(key: string): { sql: string; params: unknown[] } | null {
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
      const depth = +calcMatch![1];
      spec.calcStages = (db.calcStages || []).slice(0, depth + 1);
    }
  }

  const srcCatalog = typeof buildSourceCatalog === 'function' ? buildSourceCatalog() : null;
  if (!srcCatalog) return null;
  const colCatalog = buildColumnCatalog(spec, srcCatalog);
  const plan = buildQueryPlan(spec, colCatalog, null, srcCatalog);
  const result = renderDetailSql(plan);
  if (!result) return null;
  result.sql = result.sql.replace(/\s*(?:(?<!\()ORDER BY[^;]+)?$/, ' LIMIT 5');
  return result;
}

export function _buildPreviewHTML(key: string): string {
  try {
    let sql: string, params: unknown[];
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
  } catch (ex: unknown) {
    return `<em style="color:var(--red);font-size:0.72rem">Error: ${h((ex as Error).message)}</em>`;
  }
}

export function addStack(id: string): void {
  if (!id || !db.tables[id] || id === db.base) return;
  if (!db.stacks.includes(id)) db.stacks.push(id);
  _afterCombineChange();
}
export function removeStack(id: string): void {
  db.stacks = db.stacks.filter(s => s !== id);
  _afterCombineChange();
}
export function addLookup(): void {
  if (!db.base) return;
  if (!db.lookups) db.lookups = [];
  db.lookups.push({ rightId: '', keyPairs: [{ left: '', right: '' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } });
  _afterCombineChange();
}

export function addCalcStage(): void {
  if (!db.base) return;
  if (!db.calcStages) db.calcStages = [];
  db.calcStages.push({
    alias: '',
    mode: 'math',
    math: { strategy: 'stepChain', steps: [{ type: 'column', value: '' }, { type: 'column', value: '', op: '+' }] },
    enabled: true,
  });
  _afterCombineChange();
}

export function removeCalcStage(i: number): void {
  if (!Array.isArray(db.calcStages)) db.calcStages = [];
  db.calcStages.splice(i, 1);
  _afterCombineChange();
}

export function removeLookup(i: number): void {
  db.lookups.splice(i, 1);
  _afterCombineChange();
}
export function selectAllLookupCols(i: number): void {
  const lk = db.lookups[i];
  const rt = lk.rightId && db.tables[lk.rightId];
  if (rt) {
    _showLayoutAliasesForSource(lk.rightId);
    _afterCombineChange();
  }
}
export function selectNoneLookupCols(i: number): void {
  const lk = db.lookups[i];
  _hideLookupLayoutAliasesSafely(lk.rightId, null, i);
  _afterCombineChange();
}

export function runQuery(): void {
  if (!db.base || !db.tables[db.base]) return;

  invalidateValidation();

  const v = getValidation()!;
  if (v.reportStatus === 'blocked') {
    const blockingItems = (Object.values(v.items) as Array<{ blocking?: boolean; issues?: Array<{ message?: string }> }>).filter(item => item.blocking);
    const firstMsg = blockingItems[0]?.issues?.[0]?.message || 'missing source data';
    toast(`Can't run \u2014 fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ''}).`, 'err');
    return;
  }

  const _hasAgg = db.aggMode === 'group' && (db.groupBy.length > 0 || db.aggregates.length > 0);
  if (!_hasAgg && !['totals', 'subtotals'].includes(db.aggMode) && db.selCols && db.selCols.size === 0) {
    toast('No output columns selected \u2014 click All or pick at least one column.', 'err');
    return;
  }

  const status = $('runStatus')!;
  status.textContent = 'Running\u2026';

  setTimeout(() => {
    try {
      const resultSet = executeReport(db);
      if (!resultSet) throw new Error('No result set returned');

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
    } catch (ex: unknown) {
      status.textContent = 'Error';
      toast('Query error: ' + (ex as Error).message, 'err');
      console.error((ex as Error).message);
    }
  }, 20);
}

// HTML onclick / onchange compatibility
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).onBaseChange = onBaseChange;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).addStack = addStack;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).addLookup = addLookup;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).addCalcStage = addCalcStage;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).runQuery = runQuery;
