import { db } from '../core/state.js';
import { h, colDisplayLabel, getTableColor, setColLabel, renameProjectedColumn } from '../core/utils.js';
import { buildColSourceMap } from '../catalog/column-catalog.js';
import { execQuery, quoteId } from '../core/sqldb.js';
import { renderQueryBuilder } from '../query/query-builder.js';
import { renderMergeToggles } from '../query/output-card.js';
import { getValidation } from '../report/validation.js';

let gridResult  = null;
let gridPreview = null;

export function refreshResultGridLayout() {
  if (!gridResult) return;
  try { gridResult.resetRowHeights?.(); } catch (_) {}
  try { gridResult.refreshCells?.({ force: true }); } catch (_) {}
  try { gridResult.redrawRows?.(); } catch (_) {}
}

export function refreshPreviewGridLayout() {
  if (!gridPreview) return;
  try { gridPreview.resetRowHeights?.(); } catch (_) {}
  try { gridPreview.refreshCells?.({ force: true }); } catch (_) {}
  try { gridPreview.redrawRows?.(); } catch (_) {}
}

export function renderResults(result) {
  const wrap    = document.getElementById('resultsWrap');
  const meta    = document.getElementById('resultsMeta');
  const btnXlsx = document.getElementById('btnExpXlsx');
  const btnCsv  = document.getElementById('btnExpCsv');

  const { rows, totalsRow, cols } = result;
  const hasData = rows.length > 0 || totalsRow !== null;

  btnXlsx.style.display = hasData ? '' : 'none';
  btnCsv.style.display  = hasData ? '' : 'none';

  if (gridResult) { gridResult.destroy(); gridResult = null; }

  if (!hasData) {
    meta.textContent = '0 rows matched';
    wrap.innerHTML   = '<div class="empty"><div class="empty-icon">🔍</div><div>No rows matched your query</div></div>';
    return;
  }

  if (totalsRow) {
    meta.textContent = rows.length.toLocaleString() + ' rows + 1 totals row · ' + cols.length + ' columns';
  } else {
    meta.textContent = rows.length.toLocaleString() + ' rows · ' + cols.length + ' columns';
  }

  wrap.innerHTML = '<div id="resGrid" class="ag-theme-balham-dark" style="height:100%;width:100%"></div>';

  const tableData = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : rows;

  const colDefs = makeResultCols(cols);

  const options = {
    rowData:           tableData,
    columnDefs:        colDefs,
    defaultColDef: {
      sortable:       true,
      resizable:      true,
      filter:         true,
      floatingFilter: true,
      minWidth:       80,
      cellRenderer:   params => {
        const v = params.value;
        return v == null ? '' : String(v);
      },
    },
    pagination:                true,
    paginationPageSize:        500,
    paginationPageSizeSelector:[100, 250, 500, 1000, 5000],
    multiSortKey:              'ctrl',
    onColumnMoved:   () => _saveResultColState(),
    onColumnResized: () => _saveResultColState(),
    onColumnVisible: () => _saveResultColState(),
  };

  const el = document.getElementById('resGrid');
  gridResult = agGrid.createGrid(el, options);

  requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));

  if (db.colState) {
    gridResult.applyColumnState({ state: db.colState, applyOrder: true });
  }

  renderMergeToggles(cols);
}
window.renderResults = renderResults;

function _saveResultColState() {
  if (gridResult) db.colState = gridResult.getColumnState();
}

export function renderPreviewDropdown() {
  const sel  = document.getElementById('previewSel');
  const prev = sel.value;
  const ids  = Object.keys(db.tables);
  sel.innerHTML = '<option value="">— select a table to preview —</option>' +
    ids.map(id => `<option value="${id}">${h(db.tables[id].name)}</option>`).join('');
  if (db.tables[prev]) sel.value = prev;
}

export function loadPreview() {
  const id   = document.getElementById('previewSel').value;
  const wrap = document.getElementById('previewWrap');
  const meta = document.getElementById('previewMeta');

  if (gridPreview) { gridPreview.destroy(); gridPreview = null; }

  if (!id || !db.tables[id]) {
    meta.textContent = '';
    wrap.innerHTML   = '<div class="empty"><div class="empty-icon">👆</div><div>Select a table above</div></div>';
    return;
  }

  const t   = db.tables[id];
  const cap = 10000;
  const excluded = db.excludedRows[id] || new Set();

  let rows;
  try {
    rows = execQuery(`SELECT "_rowno", ${t.cols.map(c => quoteId(c)).join(', ')} FROM ${quoteId(id)} LIMIT ${cap}`);
  } catch (ex) {
    meta.textContent = 'Error loading preview';
    wrap.innerHTML   = '<div class="empty"><div class="empty-icon">❌</div><div>' + h(ex.message) + '</div></div>';
    return;
  }

  const excCount = excluded.size;
  meta.textContent = t.rowCount.toLocaleString() + ' rows · ' + t.cols.length + ' cols' +
    (excCount ? ' · ' + excCount + ' excluded' : '') +
    (t.rowCount > cap ? ' (preview: first ' + cap.toLocaleString() + ')' : '');
  let bannerHtml = '';
  if (excCount) {
    bannerHtml = `<div id="previewExclBanner" style="padding:4px 10px;font-size:12px;background:rgba(255,170,0,0.12);border-bottom:1px solid rgba(255,170,0,0.3);color:#c9a020;display:flex;align-items:center;gap:8px;">
      <span>⚠ ${excCount} row${excCount > 1 ? 's' : ''} excluded from reports</span>
      <button onclick="clearExclusions('${id}')" style="font-size:11px;padding:1px 7px;border-radius:3px;border:1px solid #c9a020;background:transparent;color:#c9a020;cursor:pointer">Clear all</button>
    </div>`;
  }

  wrap.innerHTML = bannerHtml + '<div id="prevGrid" class="ag-theme-balham-dark" style="height:calc(100% - ' + (excCount ? 30 : 0) + 'px);width:100%"></div>';

  const excludeColDef = {
    headerName:  '',
    field:       '_rowno',
    width:       44,
    minWidth:    44,
    maxWidth:    44,
    resizable:   false,
    sortable:    false,
    filter:      false,
    floatingFilter: false,
    cellRenderer: params => {
      const rowno  = params.value;
      const isExcl = excluded.has(rowno);
      const btn    = document.createElement('button');
      const rowData = params.data;
      const preview = t.cols
        .filter(c => c !== '_rowno')
        .map(c => rowData[c] == null ? '' : String(rowData[c]))
        .filter(v => v !== '')
        .slice(0, 6)
        .join(' · ');
      const action = isExcl ? 'Restore row to reports' : 'Exclude row from reports';
      btn.title    = `${action}\n→ ${preview}`;
      btn.style.cssText = 'background:transparent;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1';
      btn.textContent   = isExcl ? '🚫' : '✅';
      btn.addEventListener('click', () => toggleRowExclusion(id, rowno));
      return btn;
    },
  };

  const el = document.getElementById('prevGrid');
  gridPreview = agGrid.createGrid(el, {
    rowData:        rows,
    columnDefs:     [excludeColDef, ...makePreviewCols(id, t.cols)],
    defaultColDef: {
      sortable:       true,
      resizable:      true,
      filter:         true,
      floatingFilter: true,
      minWidth:       80,
      cellRenderer:   params => {
        const v = params.value;
        return v == null ? '' : String(v);
      },
    },
    pagination:          true,
    paginationPageSize:  200,
    paginationPageSizeSelector: [100, 200, 500, 1000],
    multiSortKey:        'ctrl',
    getRowStyle: params => {
      const rowno = params.data && params.data._rowno;
      if (excluded.has(rowno)) {
        return {
          color:          '#c0392b',
          textDecoration: 'line-through',
          background:     'rgba(220,50,50,0.08)',
        };
      }
    },
  });

  requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
}
window.loadPreview = loadPreview;

function toggleRowExclusion(tableId, rowno) {
  if (!db.excludedRows[tableId]) db.excludedRows[tableId] = new Set();
  const set = db.excludedRows[tableId];
  if (set.has(rowno)) set.delete(rowno); else set.add(rowno);
  renderQueryBuilder();
  loadPreview();
}

export function clearExclusions(tableId) {
  db.excludedRows[tableId] = new Set();
  renderQueryBuilder();
  loadPreview();
}
window.clearExclusions = clearExclusions;

function makeResultCols(cols) {
  const colMap = buildColSourceMap();
  const dataCols = cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow');
  return dataCols.map(c => {
    const src       = colMap.get(c);
    const dispLabel = colDisplayLabel(c, colMap);
    const renamed   = (src && src.kind !== 'calc') ? db.columnLabels?.[src.tid]?.[src.col] : undefined;
    const color     = src ? getTableColor(src.tid) : null;

    const doRename = () => {
      if (!renameProjectedColumn(c)) return;
      renderQueryBuilder();
      if (db.result) renderResults(db.result);
    };

    return {
      field:       c,
      headerName:  dispLabel,
      tooltipField: c,
      minWidth:    110,
      filter:      'agTextColumnFilter',
      floatingFilter: true,
      sortable:    true,
      resizable:   true,
      headerComponent: _makeHeaderComponent(dispLabel, color, renamed, (src && src.kind !== 'calc') ? src.col : null, doRename,
        (src && src.kind !== 'calc' && renamed) ? () => { setColLabel(src.tid, src.col, src.col); renderQueryBuilder(); if (db.result) renderResults(db.result); } : null),
      cellRenderer: params => {
        const v = params.value;
        return v == null ? '' : String(v);
      },
    };
  });
}

function makePreviewCols(tid, physCols) {
  const color = getTableColor(tid);
  return physCols.filter(c => c !== '_rowno').map(c => {
    const renamed = db.columnLabels?.[tid]?.[c];
    const label   = renamed || c;

    const doRename = () => {
      const newLabel = window.prompt('New label (blank to reset):', renamed || '');
      if (newLabel === null) return;
      setColLabel(tid, c, newLabel.trim());
      renderQueryBuilder();
      if (db.result) renderResults(db.result);
      loadPreview();
    };

    const doClear = renamed
      ? () => {
          setColLabel(tid, c, c);
          renderQueryBuilder();
          if (db.result) renderResults(db.result);
          loadPreview();
        }
      : null;

    return {
      field:          c,
      headerName:     label,
      minWidth:       110,
      filter:         'agTextColumnFilter',
      floatingFilter: true,
      sortable:       true,
      resizable:      true,
      headerComponent: _makeHeaderComponent(label, color, renamed, c, doRename, doClear),
      cellRenderer:   params => {
        const v = params.value;
        return v == null ? '' : String(v);
      },
    };
  });
}

function _makeHeaderComponent(label, color, renamed, origCol, onRename, onClear) {
  return class {
    init(params) {
      this._params = params;
      this._gui = document.createElement('div');
      this._gui.style.cssText = 'display:flex;align-items:center;gap:3px;width:100%;overflow:hidden';

      if (color) {
        const stripe = document.createElement('span');
        stripe.style.cssText = `width:3px;flex-shrink:0;align-self:stretch;background:${color};border-radius:1px;margin-right:2px`;
        this._gui.appendChild(stripe);
      }

      const txt = document.createElement('span');
      txt.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer';
      txt.textContent = label;
      if (origCol) txt.title = renamed ? `Original: ${origCol}` : origCol;
      txt.addEventListener('click', e => params.progressSort(e.shiftKey));
      this._gui.appendChild(txt);

      if (onRename) {
        const more = document.createElement('button');
        more.textContent = '\u22ef';
        more.title = 'Rename column';
        more.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:0 2px;color:#aaa;flex-shrink:0;line-height:1';
        more.addEventListener('click', e => { e.stopPropagation(); onRename(); });
        this._gui.appendChild(more);
      }

      if (onClear) {
        const clr = document.createElement('button');
        clr.textContent = '\u00d7';
        clr.title = `Clear rename (original: ${origCol})`;
        clr.style.cssText = 'background:none;border:none;cursor:pointer;font-size:10px;padding:0 1px;color:#aaa;flex-shrink:0;line-height:1';
        clr.addEventListener('click', e => { e.stopPropagation(); onClear(); });
        this._gui.appendChild(clr);
      }
    }

    getGui() { return this._gui; }
    destroy() {}
    refresh() { return false; }
  };
}
