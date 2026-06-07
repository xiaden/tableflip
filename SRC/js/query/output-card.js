import { db } from '../core/state.js';
import { projectedCols, buildColSourceMap } from '../catalog/column-catalog.js';
import { h, colDisplayLabel, getTableColorClass, smartDefaultFn, renameProjectedColumn } from '../core/utils.js';
import { renderSubtotalsSection, renderAggregateItems, renderAggregation } from '../ui/aggregation.js';
import { renderQueryBuilder } from './query-builder.js';
import { renderResults } from '../ui/grid.js';
import { _syncSubtotalByToLayout, _seenCols } from './layout-selection.js';

export function renderColChips() {
  if (!db.base) return;
  const cols   = projectedCols();
  const colMap = buildColSourceMap();
  const mode   = db.aggMode || 'none';

  if (!db.selCols) {
    db.selCols = new Set(cols);
    _seenCols.clear();
    cols.forEach(c => _seenCols.add(c));
  }

  if (!db.colOrder) {
    db.colOrder = [...cols];
  } else {
    const colSet = new Set(cols);
    db.colOrder = [
      ...db.colOrder.filter(c => colSet.has(c)),
      ...cols.filter(c => !db.colOrder.includes(c)),
    ];
  }
  _syncSubtotalByToLayout();

  const groupSet   = new Set(db.groupBy);
  const showBadges = mode === 'group' && groupSet.size > 0;

  document.getElementById('colChips').innerHTML = db.colOrder.map(c => {
    const src      = colMap.get(c);
    const colorCls = src ? getTableColorClass(src.tid) : '';
    const label    = h(colDisplayLabel(c, colMap));

    if (db.selCols instanceof Set && !db.selCols.has(c)) return '';

    let tip = '';
    if (src?.kind === 'calc') {
      const leftLabel  = colDisplayLabel(src.left, colMap);
      const rightLabel = src.right ? colDisplayLabel(src.right, colMap) : '';
      if (src.op === 'ROLLAVG') {
        const mode = src.explicitOrder ? `explicit order: ${src.orderCol || '(none)'} ${src.orderDir || 'ASC'}` : 'report sort order';
        tip = `data-tip="Calculated: rolling average of ${h(leftLabel)}&#10;Window: ${h(String(src.window || 7))}&#10;Order: ${h(mode)}"`;
      } else if (src.op === 'PCTTOTAL') {
        tip = `data-tip="Calculated: ${h(leftLabel)} as % of total&#10;Scope: current filtered set${(db.aggMode || 'none') === 'subtotals' && (db.subtotalBy || []).length ? ' (per subtotal group)' : ''}"`;
      } else {
        tip = `data-tip="Calculated: ${h(leftLabel)} ${h(src.op)} ${h(rightLabel)}"`;
      }
    } else if (src) {
      const tbl  = db.tables[src.tid];
      const vals = (tbl?.samples?.[src.col] || []).slice(0, 3);
      const from = `From: ${h(tbl?.name ?? src.tid)}`;
      tip = vals.length
        ? `data-tip="${from}&#10;Sample: ${vals.map(v => h(String(v))).join(' \u00B7 ')}"`
        : `data-tip="${from}&#10;(no sample values)"`;
    }

    if (mode === 'group') {
      const isOn     = groupSet.has(c);
      const hasAgg   = db.aggregates.some(a => a.col === c);
      const isOrphan = showBadges && !isOn && !hasAgg;
      const badge    = isOrphan
        ? ` <span class="chip-warn-badge" data-autowarn="${h(c)}" title="No calculation for this column \u2014 it will be dropped from results. Click \u26A0 to add one automatically.">\u26A0</span>`
        : '';
      return `<span class="chip ${isOn ? 'on' : ''} ${isOrphan ? 'chip-orphan' : ''} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}${badge}</span>`;
    } else if (mode === 'subtotals') {
      const isOn = (db.subtotalBy || []).includes(c);
      return `<span class="chip ${isOn ? 'on' : ''} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}</span>`;
    } else {
      const isOn = db.selCols.has(c);
      return `<span class="chip ${isOn ? 'on' : ''} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}</span>`;
    }
  }).join('');

  const btnRow = document.getElementById('colBtnRow');
  if (btnRow) btnRow.style.display = (mode === 'group' || mode === 'subtotals') ? 'none' : '';

  const hint = document.getElementById('colCardHint');
  if (hint) {
    if (mode === 'group') {
      hint.textContent = '\u2014 double-click to group by \u00B7 drag to reorder';
    } else if (mode === 'subtotals') {
      hint.textContent = '\u2014 double-click to group rows \u00B7 drag to reorder';
    } else {
      hint.textContent = '\u2014 double-click to show/hide \u00B7 drag to reorder';
    }
  }
}

document.getElementById('colChips').addEventListener('click', e => {
  const badge = e.target.closest('[data-autowarn]');
  if (badge) {
    e.stopPropagation();
    const col = badge.dataset.autowarn;
    if (!db.aggregates.some(a => a.col === col)) {
      db.aggregates.push({ fn: smartDefaultFn(col), col, alias: '', auto: true });
    }
    renderColChips();
    renderAggregateItems(projectedCols());
  }
});

document.getElementById('colChips').addEventListener('dblclick', e => {
  const chip = e.target.closest('.chip[data-col]');
  if (!chip) return;
  const col  = chip.dataset.col;
  const mode = db.aggMode || 'none';

  if (mode === 'group') {
    const idx = db.groupBy.indexOf(col);
    if (idx >= 0) {
      db.groupBy.splice(idx, 1);
      if (db.groupBy.length === 0) {
        db.aggregates = db.aggregates.filter(a => !a.auto);
      } else if (!db.aggregates.some(a => a.col === col)) {
        db.aggregates.push({ fn: smartDefaultFn(col), col, alias: '', auto: true });
      }
    } else {
      db.groupBy.push(col);
      db.aggregates = db.aggregates.filter(a => !(a.col === col && a.auto));
      const allCols = projectedCols();
      for (const c of allCols) {
        if (!db.groupBy.includes(c) && !db.aggregates.some(a => a.col === c)) {
          db.aggregates.push({ fn: smartDefaultFn(c), col: c, alias: '', auto: true });
        }
      }
    }
    renderAggregation();
  } else if (mode === 'subtotals') {
    const sb  = db.subtotalBy || (db.subtotalBy = []);
    const idx = sb.indexOf(col);
    if (idx >= 0) {
      sb.splice(idx, 1);
      delete db.subtotalFns[col];
    } else {
      sb.push(col);
    }
    _syncSubtotalByToLayout();
    renderAggregation();
  } else {
    if (!db.selCols) db.selCols = new Set(projectedCols());
    if (db.selCols.has(col)) db.selCols.delete(col);
    renderQueryBuilder();
  }
});

document.getElementById('colChips').addEventListener('contextmenu', e => {
  const chip = e.target.closest('.chip[data-col]');
  if (!chip) return;
  e.preventDefault();
  const alias = chip.dataset.col;
  if (!renameProjectedColumn(alias)) return;
  renderQueryBuilder();
  if (db.result) renderResults(db.result);
});

let _dragCol = null;

function _chipAtPoint(container, x, y) {
  const chips = [...container.querySelectorAll('[data-col]')]
    .filter(c => c.dataset.col !== _dragCol);
  if (!chips.length) return null;

  const direct = document.elementFromPoint(x, y)?.closest('[data-col]');
  if (direct && direct.dataset.col !== _dragCol) return direct;

  const sameRow = chips.filter(c => {
    const r = c.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });

  const pool = sameRow.length ? sameRow : chips;
  let best = null, bestDist = Infinity;
  for (const chip of pool) {
    const r  = chip.getBoundingClientRect();
    const cx = (r.left + r.right)  / 2;
    const cy = (r.top  + r.bottom) / 2;
    const d  = sameRow.length ? Math.abs(x - cx) : Math.hypot(x - cx, y - cy);
    if (d < bestDist) { bestDist = d; best = chip; }
  }
  return best;
}

document.getElementById('colChips').addEventListener('dragstart', e => {
  const chip = e.target.closest('[data-col]');
  if (!chip) return;
  _dragCol = chip.dataset.col;
  chip.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
document.getElementById('colChips').addEventListener('dragend', () => {
  _dragCol = null;
  document.querySelectorAll('#colChips .chip').forEach(c => c.classList.remove('dragging', 'drag-over'));
});
document.getElementById('colChips').addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const nearest = _chipAtPoint(e.currentTarget, e.clientX, e.clientY);
  document.querySelectorAll('#colChips .chip').forEach(c => c.classList.remove('drag-over'));
  if (nearest) nearest.classList.add('drag-over');
});
document.getElementById('colChips').addEventListener('drop', e => {
  e.preventDefault();
  const nearest = _chipAtPoint(e.currentTarget, e.clientX, e.clientY);
  if (!nearest || !_dragCol || nearest.dataset.col === _dragCol) return;
  if (!db.colOrder) db.colOrder = projectedCols();
  const from = db.colOrder.indexOf(_dragCol);
  const to   = db.colOrder.indexOf(nearest.dataset.col);
  if (from < 0 || to < 0) return;
  db.colOrder.splice(from, 1);
  db.colOrder.splice(to, 0, _dragCol);
  _syncSubtotalByToLayout();
  renderColChips();
  if ((db.aggMode || 'none') === 'subtotals') {
    const projected = projectedCols();
    const ordered = Array.isArray(db.colOrder)
      ? db.colOrder.filter(c => projected.includes(c))
      : projected;
    renderSubtotalsSection(ordered);
  }
});

export function selectAllCols()  { db.selCols = new Set(projectedCols()); renderColChips(); }
window.selectAllCols = selectAllCols;
export function selectNoneCols() { db.selCols = new Set();                 renderColChips(); }
window.selectNoneCols = selectNoneCols;

export function renderMergeToggles(cols) {
  const wrap = document.getElementById('mergeToggles');
  if (!wrap) return;

  const ulChk = document.getElementById('chkMergeGroupUnderline');
  if (ulChk) ulChk.checked = !!db.mergeGroupUnderline;

  const baseDisplayCols = (cols || []).filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow');
  const visibleDisplayCols = (db.selCols instanceof Set)
    ? baseDisplayCols.filter(c => db.selCols.has(c))
    : baseDisplayCols;
  const orderedFromLayout = Array.isArray(db.colOrder)
    ? db.colOrder.filter(c => visibleDisplayCols.includes(c))
    : [];
  const displayCols = [
    ...orderedFromLayout,
    ...visibleDisplayCols.filter(c => !orderedFromLayout.includes(c)),
  ];
  if (!displayCols.length) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No result columns</span>';
    return;
  }

  if (!db.mergedCols) db.mergedCols = [];
  const mergedSet = new Set(db.mergedCols);
  const colMap = buildColSourceMap();

  wrap.innerHTML = '';
  for (const c of displayCols) {
    const label = colDisplayLabel(c, colMap);
    const checked = mergedSet.has(c);

    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;font-weight:normal;margin-top:4px';

    const chk = document.createElement('input');
    chk.type    = 'checkbox';
    chk.checked = checked;
    chk.addEventListener('change', () => {
      if (chk.checked) {
        if (!db.mergedCols.includes(c)) db.mergedCols.push(c);
      } else {
        db.mergedCols = db.mergedCols.filter(x => x !== c);
      }
      if (db.result) renderResults(db.result);
    });

    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode(label));
    wrap.appendChild(lbl);
  }
}

export function setMergeGroupUnderline(checked) {
  db.mergeGroupUnderline = !!checked;
  if (db.result) renderResults(db.result);
}
window.setMergeGroupUnderline = setMergeGroupUnderline;
