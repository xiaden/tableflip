'use strict';

let gridResult  = null;  // AG Grid API for results
let gridPreview = null;  // AG Grid API for preview

// ── Results grid ──────────────────────────────────────────────────────────────
function renderResults(result) {
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

  // Append totals row with a local sentinel for row styling — never stored in db.result
  const tableData = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : rows;

  const mergedSet = new Set(db.mergedCols || []);

  // Precompute span extents for merged columns to avoid O(n²) per cell
  const spanCache = _buildSpanCache(tableData, cols, mergedSet);
  const underlineStartByRow = _buildMergeUnderlineStartMap(tableData, cols, mergedSet, spanCache);

  const colDefs = makeResultCols(cols, mergedSet, spanCache, underlineStartByRow);

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
    suppressRowTransform:      true,  // required for rowSpan to work
    pagination:                true,
    paginationPageSize:        500,
    paginationPageSizeSelector:[100, 250, 500, 1000, 5000],
    multiSortKey:              'ctrl',
    getRowStyle: params => {
      const d = params.data;
      if (!d) return;
      const rowType = Number.isFinite(Number(d._row_type)) ? Number(d._row_type) : 0;
      if (d._isTotalsRow || rowType === 3) {
        return {
          fontWeight:  '700',
          background:  'rgba(88,166,255,0.10)',
        };
      }
      if (rowType === 1) {
        return {
          fontWeight: '600',
          fontStyle:  'italic',
          background: 'rgba(160,160,160,0.09)',
        };
      }
      if (rowType === 2) {
        return {
          background: 'transparent',
          borderTop:  'none',
          pointerEvents: 'none',
        };
      }
    },
    rowClassRules: {
      'row-spacer': params => {
        if (!params.data) return false;
        const t = Number(params.data._row_type);
        return Number.isFinite(t) && t === 2;
      },
      'row-summary-subtotal': params => {
        if (!params.data) return false;
        const t = Number(params.data._row_type);
        return Number.isFinite(t) && t === 1;
      },
      'row-summary-grand': params => {
        if (!params.data) return false;
        const t = Number(params.data._row_type);
        return params.data._isTotalsRow || (Number.isFinite(t) && t === 3);
      },
    },
    onColumnMoved:   () => _saveResultColState(),
    onColumnResized: () => _saveResultColState(),
    onColumnVisible: () => _saveResultColState(),
  };

  const el = document.getElementById('resGrid');
  gridResult = agGrid.createGrid(el, options);

  // Restore saved column state (order + widths) if available
  if (db.colState) {
    gridResult.applyColumnState({ state: db.colState, applyOrder: true });
  }

  // Populate merge duplicates toggles in Sort & Filter card
  renderMergeToggles(cols);
}

function _saveResultColState() {
  if (gridResult) db.colState = gridResult.getColumnState();
}

// Build a cache: { colField → { rowIndex → spanLength } }
// spanLength > 1 = first cell of merged run; 0 = hidden (covered) cell
function _buildSpanCache(rows, cols, mergedSet) {
  const normRowType = row => {
    if (!row || row._row_type == null || row._row_type === '') return 0;
    const n = Number(row._row_type);
    return Number.isFinite(n) ? n : 0;
  };

  const cache = {};
  for (let colIdx = 0; colIdx < cols.length; colIdx++) {
    const col = cols[colIdx];
    if (col === '_rowno' || col === '_row_type' || !mergedSet.has(col)) continue;
    const leftGateCols = cols
      .slice(0, colIdx)
      .filter(lc => lc !== '_rowno' && lc !== '_row_type' && mergedSet.has(lc));
    const gateByLeft = leftGateCols.length > 0;
    const spans = {};
    let i = 0;
    while (i < rows.length) {
      // Don't merge across special rows
      if (normRowType(rows[i]) !== 0) { i++; continue; }
      let j = i + 1;
      while (
        j < rows.length &&
        normRowType(rows[j]) === 0 &&
        rows[j][col] === rows[i][col]
      ) {
        // Respect left-side group boundaries for hierarchical merges.
        // A run cannot cross a boundary in any merge-enabled column to the left.
        if (gateByLeft && leftGateCols.some(leftCol => rows[j][leftCol] !== rows[j - 1][leftCol])) break;
        j++;
      }
      const span = j - i;
      if (span > 1) {
        spans[i] = span;
        for (let k = i + 1; k < j; k++) spans[k] = 0;  // covered cells
      }
      i = j;
    }
    cache[col] = spans;
  }
  return cache;
}

function _buildMergeUnderlineStartMap(rows, cols, mergedSet, spanCache) {
  const normRowType = row => {
    if (!row || row._row_type == null || row._row_type === '') return 0;
    const n = Number(row._row_type);
    return Number.isFinite(n) ? n : 0;
  };

  const hasActiveMergeAtRow = (spans, rowIdx) => {
    if (!spans) return false;
    const v = spans[rowIdx];
    return v === 0 || (Number.isFinite(v) && v > 1);
  };

  const starts = new Map(); // rowIndex -> startColIndex
  for (let colIdx = 0; colIdx < cols.length; colIdx++) {
    const col = cols[colIdx];
    if (col === '_rowno' || col === '_row_type' || !mergedSet.has(col)) continue;
    const leftGateCols = cols
      .slice(0, colIdx)
      .filter(lc => lc !== '_rowno' && lc !== '_row_type' && mergedSet.has(lc));

    let i = 0;
    while (i < rows.length) {
      if (normRowType(rows[i]) !== 0) { i++; continue; }

      let j = i + 1;
      while (
        j < rows.length &&
        normRowType(rows[j]) === 0 &&
        rows[j][col] === rows[i][col]
      ) {
        if (leftGateCols.some(leftCol => rows[j][leftCol] !== rows[j - 1][leftCol])) break;
        j++;
      }

      const span = j - i;
      const endRow = j - 1;
      let shouldUnderline = span > 1;

      // For singleton runs, only underline when any merge-enabled left column
      // has an active multi-row merge context on this row.
      if (!shouldUnderline && span === 1 && leftGateCols.length) {
        shouldUnderline = leftGateCols.some(leftCol => hasActiveMergeAtRow(spanCache[leftCol], i));
      }

      if (shouldUnderline) {
        const prev = starts.get(endRow);
        starts.set(endRow, prev == null ? colIdx : Math.min(prev, colIdx));
      }

      i = j;
    }
  }
  return starts;
}

function _isSummaryRowData(row) {
  if (!row) return false;
  const t = Number(row._row_type);
  return !!row._isTotalsRow || (Number.isFinite(t) && (t === 1 || t === 3));
}

function _lastSummaryDataField(row, dataCols) {
  if (!Array.isArray(dataCols) || !dataCols.length) return null;
  for (let i = dataCols.length - 1; i >= 0; i--) {
    const f = dataCols[i];
    const v = row?.[f];
    if (v != null && String(v) !== '') return f;
  }
  return dataCols[0];
}

// ── Preview grid ──────────────────────────────────────────────────────────────
function renderPreviewDropdown() {
  const sel  = document.getElementById('previewSel');
  const prev = sel.value;
  const ids  = Object.keys(db.tables);
  sel.innerHTML = '<option value="">— select a table to preview —</option>' +
    ids.map(id => `<option value="${id}">${h(db.tables[id].name)}</option>`).join('');
  if (db.tables[prev]) sel.value = prev;
}

function loadPreview() {
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

  // Build the banner showing excluded count + "Clear all" link.
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
}

function toggleRowExclusion(tableId, rowno) {
  if (!db.excludedRows[tableId]) db.excludedRows[tableId] = new Set();
  const set = db.excludedRows[tableId];
  if (set.has(rowno)) set.delete(rowno); else set.add(rowno);
  // Re-render to refresh styling/banner and any lookup duplicate warnings.
  renderQueryBuilder();
  loadPreview();
}

function clearExclusions(tableId) {
  db.excludedRows[tableId] = new Set();
  renderQueryBuilder();
  loadPreview();
}

// ── Column def builders ───────────────────────────────────────────────────────

function makeResultCols(cols, mergedSet, spanCache, underlineStartByRow = new Map()) {
  const colMap = buildColSourceMap();
  const dataCols = cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow');
  const firstDataCol = dataCols[0] || null;
  return dataCols.map((c, cIdx) => {
    const src       = colMap.get(c);
    const dispLabel = colDisplayLabel(c, colMap);
    const renamed   = (src && src.kind !== 'calc') ? db.columnLabels?.[src.tid]?.[src.col] : undefined;
    const color     = src ? getTableColor(src.tid) : null;

    const doRename = () => {
      if (!renameProjectedColumn(c)) return;
      renderQueryBuilder();
      if (db.result) renderResults(db.result);
    };

    const colDef = {
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
      cellClassRules: {
        'summary-box-h': params => _isSummaryRowData(params.data),
        'summary-box-left': params => _isSummaryRowData(params.data) && c === firstDataCol,
        'summary-box-right': params => _isSummaryRowData(params.data) && c === _lastSummaryDataField(params.data, dataCols),
        'merge-group-underline': params => {
          if (!db.mergeGroupUnderline) return false;
          const rowIdx = params.node && params.node.rowIndex;
          if (rowIdx == null) return false;
          const start = underlineStartByRow.get(rowIdx);
          return start != null && cIdx >= start;
        },
      },
    };

    // Apply rowSpan for merged duplicate cells
    if (mergedSet.has(c) && spanCache[c]) {
      const colSpans = spanCache[c];
      colDef.rowSpan = params => {
        const idx = params.node && params.node.rowIndex;
        if (idx == null) return 1;
        const s = colSpans[idx];
        return s == null ? 1 : (s === 0 ? 1 : s);
      };
      colDef.cellClassRules = {
        ...colDef.cellClassRules,
        'cell-span-hidden': params => {
          const idx = params.node && params.node.rowIndex;
          return idx != null && colSpans[idx] === 0;
        },
        'cell-span-top': params => {
          const idx = params.node && params.node.rowIndex;
          return idx != null && (colSpans[idx] ?? 1) > 1;
        },
      };
    }

    return colDef;
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

// ── Custom header component factory ──────────────────────────────────────────
// Returns a plain object satisfying AG Grid's IHeaderComponent interface.
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
      // Allow clicking text area to trigger column sort (AG Grid default behaviour is blocked by custom component)
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
