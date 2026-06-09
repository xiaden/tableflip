import { useEffect } from 'preact/hooks';
import { render } from 'preact/compat';
import { db } from '../../core/state.js';
import { toast, colDisplayLabel } from '../../core/utils.js';
import { quoteId, execQuery } from '../../core/sqldb.js';
import { buildColSourceMap, buildColumnCatalog } from '../../catalog/column-catalog.js';
import { buildSourceCatalog } from '../../catalog/source-catalog.js';
import { buildQueryPlan } from '../../query/query-plan.js';
import { renderDetailSql } from '../../query/sql-detail.js';
import { Pipeline } from './pipeline-card.js';
import { renderAggregation, setAggMode } from '../aggregation.js';
import { ColChips, MergeToggles, selectAllCols, selectNoneCols } from './output-card.js';
import { Filters, Sorts, addSort, addFilter } from './filter-sort-card.js';
import {
  _afterCombineChange, _showLayoutAliasesForSource,
  _hideLookupLayoutAliasesSafely, _seenCols, _previewOpen,
  _disabledCardCols,
} from '../../query/layout-selection.js';
import { invalidateValidation, getValidation } from '../../report/validation.js';
import { runReport as executeReport } from '../../report/engine.js';
import { switchTab } from '../tabs.js';
import { renderResults } from '../grid.js';

export function QueryBuilder() {
  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
  const hasBase = !!db.base && !!db.tables[db.base];
  const hasBaseConfigured = !!db.base;

  useEffect(() => {
    if (hasBase) {
      renderAggregation();
    }
  });

  if (!ids.length) {
    return (
      <div id="qEmpty">
        <div class="empty"><div class="empty-icon">📂</div><div>Load a spreadsheet to get started</div></div>
      </div>
    );
  }

  let statusPill = null;
  let runDisabled = false;

  if (hasBaseConfigured) {
    const v = getValidation()!;
    const blocked = v.reportStatus === 'blocked';
    const items = Object.values(v.items) as Array<{ blocking?: boolean; issues?: Array<{ message?: string }> }>;
    const issueCount = items.filter(it => it.blocking).length;

    if (blocked) {
      statusPill = { text: `\u26A0 Blocked (${issueCount} issue${issueCount !== 1 ? 's' : ''})`, bg: 'rgba(200,60,60,0.18)', color: '#e07070', border: '1px solid rgba(200,60,60,0.35)' };
    } else {
      statusPill = { text: '\u2713 Healthy', bg: 'rgba(50,180,100,0.15)', color: '#6ec87e', border: '1px solid rgba(50,180,100,0.3)' };
    }
    runDisabled = blocked;
  }

  return (
    <>
      <Pipeline />

      {hasBase && (
        <div id="colCard" class="qb-card">
          <div class="qb-title" style="margin-bottom:6px">
            Report Layout
            <span class="tip" id="colCardTip" data-tip="Choose which columns appear in your report and how they are summarized. Drag chips to reorder columns. Double-click a chip to hide/show it.">?</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <div class="tab-row">
              <label class="tab-opt">
                <input type="radio" name="aggMode" value="none" checked={db.aggMode === 'none' || !db.aggMode} onChange={() => setAggMode('none')} />
                <span data-tip="Show every row as-is. Click chips to include/exclude columns.">No summary</span>
              </label>
              <label class="tab-opt">
                <input type="radio" name="aggMode" value="group" checked={db.aggMode === 'group'} onChange={() => setAggMode('group')} />
                <span data-tip="Roll rows up into groups. Click a chip to make it a group key — remaining chips get auto calculations.">Summarize</span>
              </label>
              <label class="tab-opt">
                <input type="radio" name="aggMode" value="totals" checked={db.aggMode === 'totals'} onChange={() => setAggMode('totals')} />
                <span data-tip="Keeps every row, then adds a grand totals row at the bottom.">Keep all rows + totals</span>
              </label>
              <label class="tab-opt">
                <input type="radio" name="aggMode" value="subtotals" checked={db.aggMode === 'subtotals'} onChange={() => setAggMode('subtotals')} />
                <span data-tip="Keeps all detail rows, grouped together. Adds a configurable subtotal row after each group, and optionally a grand total at the bottom.">Group rows + subtotals</span>
              </label>
            </div>
            <span class="tip" data-tip="Choose how your data is grouped and summarized. Each mode preserves your column layout.">?</span>
          </div>
          <ColChips />
          <div class="btn-row" style="margin-top:8px" id="colBtnRow">
            <button class="btn btn-ghost" onClick={selectAllCols}>All</button>
            <button class="btn btn-ghost" onClick={selectNoneCols}>None</button>
          </div>
          <div id="aggSection" />
          <div id="totalsSection" />
          <div id="subtotalsSection" />
          <div id="aggHint" style="margin-top:8px;font-size:0.72rem;color:var(--muted);display:none" />
        </div>
      )}

      {hasBase && (
        <div id="filterSortCard" class="qb-card">
          <div class="qb-title" style="margin-bottom:6px">Sort & Filter</div>
          <div style="margin-bottom:8px">
            <div style="font-size:0.76rem;margin-bottom:4px">Sort By</div>
            <Sorts />
            <button class="btn btn-ghost" style="font-size:0.72rem;margin-top:4px" onClick={addSort}>+ Add sort</button>
          </div>
          <div style="margin-bottom:8px">
            <div style="font-size:0.76rem;margin-bottom:4px">Filters</div>
            <Filters />
            <button class="btn btn-ghost" style="font-size:0.72rem;margin-top:4px" onClick={addFilter}>+ Add filter</button>
          </div>
          <div>
            <div style="font-size:0.76rem;margin-bottom:4px">Merge duplicate cells</div>
            <MergeToggles />
          </div>
        </div>
      )}

      {hasBaseConfigured && (
        <div id="runRow" style="display:flex;align-items:center;gap:8px;padding:8px 0">
          <span id="reportStatusPill" style={{
            display: '',
            background: statusPill?.bg || '',
            color: statusPill?.color || '',
            border: statusPill?.border || '',
            fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px',
          }}>
            {statusPill?.text || ''}
          </span>
          <button id="runBtn" class="btn btn-primary" disabled={runDisabled} onClick={runQuery}>Run Report</button>
          <span id="runStatus" style="font-size:0.72rem;color:var(--muted)" />
        </div>
      )}
    </>
  );
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
  if (_previewOpen.has(key)) _previewOpen.delete(key);
  else _previewOpen.add(key);
  renderQueryBuilder();
}

function _buildPreviewSQL(key: string): { sql: string; params: unknown[] } | null {
  const spec = {
    base: db.base, baseCols: db.baseCols, stacks: db.stacks, excludedRows: db.excludedRows,
    lookups: db.lookups, calcStages: db.calcStages, selCols: db.selCols, colOrder: db.colOrder,
    filters: [], sorts: [], groupBy: [], aggregates: [], aggMode: 'none',
    colTotals: {}, subtotalBy: [], subtotalFns: {},
  };
  if (key !== 'base') {
    const lkMatch = key.match(/^lk(\d+)$/);
    const calcMatch = key.match(/^calc(\d+)$/);
    if (!lkMatch && !calcMatch) return null;
    if (lkMatch) {
      const depth = +lkMatch[1];
      spec.lookups = (db.lookups || []).slice(0, depth + 1);
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
        const sel = baseCols.map(c => tCols.includes(c) ? quoteId(c) : 'NULL').join(', ');
        return `SELECT ${sel} FROM ${quoteId(id)}`;
      }).join(' UNION ALL ');
      sql = `SELECT * FROM (${sql}) LIMIT 5`;
      params = [];
    } else {
      const result = _buildPreviewSQL(key);
      if (!result) return '<em>Unknown stage</em>';
      sql = result.sql;
      params = result.params;
    }
    const rows = execQuery(sql, params);
    if (!rows.length) return '<em style="font-size:0.72rem;color:var(--muted)">No rows</em>';
    const cols = Object.keys(rows[0]);
    const pvMap = buildColSourceMap();
    return `<table>
      <thead><tr>${cols.map(c => `<th title="${c}">${colDisplayLabel(c, pvMap)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r =>
      `<tr>${cols.map(c => `<td title="${String(r[c] ?? '')}">${String(r[c] ?? '')}</td>`).join('')}</tr>`
    ).join('')}</tbody>
    </table>`;
  } catch (ex: unknown) {
    return `<em style="color:var(--red);font-size:0.72rem">Error: ${(ex as Error).message}</em>`;
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
    alias: '', mode: 'math',
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
  if (rt) { _showLayoutAliasesForSource(lk.rightId); _afterCombineChange(); }
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
  const status = document.getElementById('runStatus')!;
  status.textContent = 'Running\u2026';
  setTimeout(() => {
    try {
      const resultSet = executeReport(db);
      if (!resultSet) throw new Error('No result set returned');
      const displayRows = resultSet.rows.filter((r: Record<string, unknown>) => !r._row_type);
      const hasTotals = !!resultSet.metadata.totalsRow;
      const hasSubs = !!resultSet.metadata.hasSubtotals;
      db.result = { rows: resultSet.rows, totalsRow: resultSet.metadata.totalsRow || null, cols: resultSet.columns, hasSubtotals: hasSubs };
      let statusText = displayRows.length.toLocaleString() + ' rows';
      if (hasTotals) statusText += ' + grand total';
      if (hasSubs) statusText += ' (subtotals)';
      status.textContent = statusText;
      switchTab('results');
      renderResults(db.result);
    } catch (ex: unknown) {
      status.textContent = 'Error';
      toast('Query error: ' + (ex as Error).message, 'err');
    }
  }, 20);
}

// Render function — mounts Preact component into existing HTML containers
export function renderQueryBuilder(): void {
  invalidateValidation();

  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
  const qEmpty = document.getElementById('qEmpty');
  const qBuilder = document.getElementById('qBuilder');

  if (qEmpty) qEmpty.style.display = ids.length ? 'none' : '';
  if (qBuilder) qBuilder.style.display = ids.length ? 'grid' : 'none';

  if (!ids.length) {
    if (qBuilder) render(null, qBuilder);
    return;
  }

  if (qBuilder) render(<QueryBuilder />, qBuilder);
}

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).onBaseChange = onBaseChange;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).addStack = addStack;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).addLookup = addLookup;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).addCalcStage = addCalcStage;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).runQuery = runQuery;
