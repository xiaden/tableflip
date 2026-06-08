import { db } from '../../core/state.js';
import { projectedCols, buildColSourceMap, type ColMapEntry, type PhysicalColEntry, type CalcColEntry } from '../../catalog/column-catalog.js';
import { h, colDisplayLabel, getTableColorClass, smartDefaultFn, renameProjectedColumn } from '../../core/utils.js';
import { renderSubtotalsSection, renderAggregateItems, renderAggregation } from '../aggregation.js';
import { renderQueryBuilder } from './query-builder.js';
import { renderResults } from '../grid.js';
import { _syncSubtotalByToLayout, _seenCols } from '../../query/layout-selection.js';

export function renderColChips(): void {
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
      ...cols.filter(c => !db.colOrder!.includes(c)),
    ];
  }
  _syncSubtotalByToLayout();

  const groupSet   = new Set(db.groupBy);
  const showBadges = mode === 'group' && groupSet.size > 0;

  const colOrder = db.colOrder!;

  document.getElementById('colChips')!.innerHTML = colOrder.map(c => {
    const src      = colMap.get(c);
    const colorCls = src ? getTableColorClass((src as unknown as Record<string, string>).tid) : '';
    const label    = h(colDisplayLabel(c, colMap));

    const selSet = db.selCols as unknown as Set<string> | null;
    if (selSet && !selSet.has(c)) return '';

    let tip = '';
    if (src?.kind === 'calc') {
      const calc = db.calcStages?.[src.idx];
      const mode = calc?.mode || 'unknown';
      if (mode === 'math') {
        const math = calc.math as { steps?: Array<{ type?: string }> } | undefined;
        const steps = math?.steps?.length || 0;
        tip = `data-tip="Calculated: Math (${steps} step${steps !== 1 ? 's' : ''})"`;
      } else if (mode === 'compare') {
        const compare = calc.compare as { conditions?: unknown[]; compareMode?: string } | undefined;
        const condCount = compare?.conditions?.length || 0;
        const glue = compare?.compareMode || 'AND';
        tip = `data-tip="Calculated: Compare (${condCount} condition${condCount !== 1 ? 's' : ''}, ${glue})"`;
      } else if (mode === 'text') {
        const text = calc.text as { operation?: string } | undefined;
        tip = `data-tip="Calculated: Text (${text?.operation || 'unknown'})"`;
      } else {
        tip = `data-tip="Calculated: ${h(mode)}"`;
      }
    } else if (src && src.kind !== 'calc') {
      const tbl  = db.tables[src.tid];
      const tblAny = tbl as unknown as Record<string, unknown>;
      const samples = tblAny.samples as Record<string, string[]> | undefined;
      const vals = (samples?.[src.col] || []).slice(0, 3);
      const from = `From: ${h(tbl?.name ?? src.tid)}`;
      tip = vals.length
        ? `data-tip="${from}&#10;Sample: ${vals.map((v: unknown) => h(String(v))).join(' \u00B7 ')}"`
        : `data-tip="${from}&#10;(no sample values)"`;
    }

    if (mode === 'group') {
      const isOn     = groupSet.has(c);
      const hasAgg   = db.aggregates.some((a: AggregateSpec) => a.col === c);
      const isOrphan = showBadges && !isOn && !hasAgg;
      const badge    = isOrphan
        ? ` <span class="chip-warn-badge" data-autowarn="${h(c)}" title="No calculation for this column \u2014 it will be dropped from results. Click \u26A0 to add one automatically.">\u26A0</span>`
        : '';
      return `<span class="chip ${isOn ? 'on' : ''} ${isOrphan ? 'chip-orphan' : ''} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}${badge}</span>`;
    } else if (mode === 'subtotals') {
      const isOn = (db.subtotalBy || []).includes(c);
      return `<span class="chip ${isOn ? 'on' : ''} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}</span>`;
    } else {
      const isOn = selSet ? selSet.has(c) : false;
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

if (typeof document !== 'undefined') {
  let _dragCol: string | null = null;

  function _chipAtPoint(container: HTMLElement, x: number, y: number): Element | null {
    const chips = [...container.querySelectorAll('[data-col]')]
      .filter((c: Element) => (c as HTMLElement).dataset.col !== _dragCol);
    if (!chips.length) return null;

    const direct = document.elementFromPoint(x, y)?.closest('[data-col]');
    if (direct && (direct as HTMLElement).dataset.col !== _dragCol) return direct;

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

  document.getElementById('colChips')!.addEventListener('click', (e: Event) => {
    const badge = (e.target as HTMLElement).closest('[data-autowarn]') as HTMLElement | null;
    if (badge) {
      e.stopPropagation();
      const col = badge.dataset.autowarn!;
      if (!db.aggregates.some((a: AggregateSpec) => a.col === col)) {
        db.aggregates.push({ fn: smartDefaultFn(col), col, alias: '', auto: true } as AggregateSpec & { auto: boolean });
      }
      renderColChips();
      renderAggregateItems(projectedCols());
    }
  });

  document.getElementById('colChips')!.addEventListener('dblclick', (e: Event) => {
    const chip = (e.target as HTMLElement).closest('.chip[data-col]') as HTMLElement | null;
    if (!chip) return;
    const col  = chip.dataset.col!;
    const mode = db.aggMode || 'none';

    if (mode === 'group') {
      const idx = db.groupBy.indexOf(col);
      if (idx >= 0) {
        db.groupBy.splice(idx, 1);
        if (db.groupBy.length === 0) {
          db.aggregates = db.aggregates.filter((a: AggregateSpec) => !(a as AggregateSpec & { auto: boolean }).auto);
        } else if (!db.aggregates.some((a: AggregateSpec) => a.col === col)) {
          db.aggregates.push({ fn: smartDefaultFn(col), col, alias: '', auto: true } as AggregateSpec & { auto: boolean });
        }
      } else {
        db.groupBy.push(col);
        db.aggregates = db.aggregates.filter((a: AggregateSpec) => !((a as AggregateSpec & { auto: boolean }).auto && a.col === col));
        const allCols = projectedCols();
        for (const c of allCols) {
          if (!db.groupBy.includes(c) && !db.aggregates.some((a: AggregateSpec) => a.col === c)) {
            db.aggregates.push({ fn: smartDefaultFn(c), col: c, alias: '', auto: true } as AggregateSpec & { auto: boolean });
          }
        }
      }
      renderAggregation();
    } else if (mode === 'subtotals') {
      const sb  = db.subtotalBy || (db.subtotalBy = []);
      const idx = sb.indexOf(col);
      if (idx >= 0) {
        sb.splice(idx, 1);
        delete db.subtotalFns![col];
      } else {
        sb.push(col);
      }
      _syncSubtotalByToLayout();
      renderAggregation();
    } else {
      if (!db.selCols) db.selCols = new Set(projectedCols());
      const s = db.selCols;
      if (s.has(col)) s.delete(col);
      renderQueryBuilder();
    }
  });

  document.getElementById('colChips')!.addEventListener('contextmenu', (e: Event) => {
    const chip = (e.target as HTMLElement).closest('.chip[data-col]') as HTMLElement | null;
    if (!chip) return;
    e.preventDefault();
    const alias = chip.dataset.col!;
    if (!renameProjectedColumn(alias)) return;
    renderQueryBuilder();
    if (db.result) renderResults(db.result);
  });

  document.getElementById('colChips')!.addEventListener('dragstart', (e: DragEvent) => {
    const chip = (e.target as HTMLElement).closest('[data-col]') as HTMLElement | null;
    if (!chip) return;
    _dragCol = chip.dataset.col!;
    chip.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  document.getElementById('colChips')!.addEventListener('dragend', () => {
    _dragCol = null;
    document.querySelectorAll('#colChips .chip').forEach((c: Element) => c.classList.remove('dragging', 'drag-over'));
  });
  document.getElementById('colChips')!.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const nearest = _chipAtPoint(e.currentTarget as HTMLElement, e.clientX, e.clientY);
    document.querySelectorAll('#colChips .chip').forEach((c: Element) => c.classList.remove('drag-over'));
    if (nearest) nearest.classList.add('drag-over');
  });
  document.getElementById('colChips')!.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    const nearest = _chipAtPoint(e.currentTarget as HTMLElement, e.clientX, e.clientY);
    if (!nearest || !_dragCol || (nearest as HTMLElement).dataset.col === _dragCol) return;
    if (!db.colOrder) db.colOrder = projectedCols();
    const from = db.colOrder!.indexOf(_dragCol);
    const to   = db.colOrder!.indexOf((nearest as HTMLElement).dataset.col!);
    if (from < 0 || to < 0) return;
    db.colOrder!.splice(from, 1);
    db.colOrder!.splice(to, 0, _dragCol);
    _syncSubtotalByToLayout();
    renderColChips();
    if ((db.aggMode || 'none') === 'subtotals') {
      const projected = projectedCols();
      const ordered = Array.isArray(db.colOrder)
        ? db.colOrder!.filter(c => projected.includes(c))
        : projected;
      renderSubtotalsSection(ordered);
    }
  });
}

export function selectAllCols(): void  { db.selCols = new Set(projectedCols()); renderColChips(); }
if (typeof window !== 'undefined') window.selectAllCols = selectAllCols;
export function selectNoneCols(): void { db.selCols = new Set();                 renderColChips(); }
if (typeof window !== 'undefined') window.selectNoneCols = selectNoneCols;

export function renderMergeToggles(cols: string[]): void {
  const wrap = document.getElementById('mergeToggles');
  if (!wrap) return;

  const ulChk = document.getElementById('chkMergeGroupUnderline') as HTMLInputElement | null;
  if (ulChk) ulChk.checked = !!db.mergeGroupUnderline;

  const baseDisplayCols = (cols || []).filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow');
  const visibleDisplayCols = (db.selCols as unknown as Set<string> | null)?.has
    ? baseDisplayCols.filter(c => (db.selCols as unknown as Set<string>).has(c))
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

export function setMergeGroupUnderline(checked: boolean): void {
  db.mergeGroupUnderline = !!checked;
  if (db.result) renderResults(db.result);
}
if (typeof window !== 'undefined') window.setMergeGroupUnderline = setMergeGroupUnderline;
