import { db } from '../../core/state.js';
import { projectedCols, buildColSourceMap, type ColMapEntry, type PhysicalColEntry, type CalcColEntry } from '../../catalog/column-catalog.js';
import { h, colDisplayLabel, getTableColorClass, smartDefaultFn } from '../../core/utils.js';
import { renderSubtotalsSection, renderAggregateItems, renderAggregation } from '../aggregation.js';
import { renderQueryBuilder } from './query-builder.js';
import { renderResults } from '../grid.js';
import { showContextMenu } from '../components/context-menu.js';
import { resolveRenameTarget, showRenameModal } from '../components/rename-modal.js';
import { renderChip, findChip, getChipCol } from '../components/chip.js';
import { $ } from '../utils/dom.js';
import { delegate } from '../utils/events.js';
import { _syncSubtotalByToLayout, _seenCols } from '../../query/layout-selection.js';

function _buildTooltip(c: string, src: ColMapEntry | undefined): string {
  if (src?.kind === 'calc') {
    const calc = db.calcStages?.[src.idx];
    const mode = calc?.mode || 'unknown';
    if (mode === 'math') {
      const math = calc.math as { steps?: Array<{ type?: string }> } | undefined;
      const steps = math?.steps?.length || 0;
      return `Calculated: Math (${steps} step${steps !== 1 ? 's' : ''})`;
    } else if (mode === 'compare') {
      const compare = calc.compare as { conditions?: unknown[]; compareMode?: string } | undefined;
      const condCount = compare?.conditions?.length || 0;
      const glue = compare?.compareMode || 'AND';
      return `Calculated: Compare (${condCount} condition${condCount !== 1 ? 's' : ''}, ${glue})`;
    } else if (mode === 'text') {
      const text = calc.text as { operation?: string } | undefined;
      return `Calculated: Text (${text?.operation || 'unknown'})`;
    }
    return `Calculated: ${mode}`;
  }
  if (src && src.kind !== 'calc') {
    const phys = src as PhysicalColEntry;
    const tbl  = db.tables[phys.tid];
    const tblAny = tbl as unknown as Record<string, unknown>;
    const samples = tblAny.samples as Record<string, string[]> | undefined;
    const vals = (samples?.[phys.col] || []).slice(0, 3);
    const from = `From: ${tbl?.name ?? phys.tid}`;
    return vals.length
      ? `${from}\nSample: ${vals.map((v: unknown) => String(v)).join(' \u00B7 ')}`
      : `${from}\n(no sample values)`;
  }
  return '';
}

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
  const selSet     = db.selCols as unknown as Set<string> | null;
  const colOrder   = db.colOrder!;

  $('colChips')!.innerHTML = colOrder.map(c => {
    const src      = colMap.get(c);
    const colorCls = src ? getTableColorClass((src as unknown as Record<string, string>).tid) : '';
    const label    = colDisplayLabel(c, colMap);

    if (selSet && !selSet.has(c)) return '';

    const tip = _buildTooltip(c, src);

    if (mode === 'group') {
      const isOn     = groupSet.has(c);
      const hasAgg   = db.aggregates.some((a: AggregateSpec) => a.col === c);
      const isOrphan = showBadges && !isOn && !hasAgg;
      const badge    = isOrphan ? '\u26A0' : '';
      const badgeTip = isOrphan ? 'No calculation for this column \u2014 it will be dropped from results. Click \u26A0 to add one automatically.' : '';
      return renderChip({ col: c, label, colorClass: colorCls, selected: isOn, draggable: true, tooltip: tip,
        badge, badgeTooltip: badgeTip, className: isOrphan ? 'chip-orphan' : '' });
    } else if (mode === 'subtotals') {
      const isOn = (db.subtotalBy || []).includes(c);
      return renderChip({ col: c, label, colorClass: colorCls, selected: isOn, draggable: true, tooltip: tip });
    }
    const isOn = selSet ? selSet.has(c) : false;
    return renderChip({ col: c, label, colorClass: colorCls, selected: isOn, draggable: true, tooltip: tip });
  }).join('');

  const btnRow = $('colBtnRow');
  if (btnRow) btnRow.style.display = (mode === 'group' || mode === 'subtotals') ? 'none' : '';

  const hint = $('colCardHint');
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
  const container = () => $('colChips')!;
  let _dragCol: string | null = null;

  function _chipAtPoint(el: HTMLElement, x: number, y: number): Element | null {
    const chips = [...el.querySelectorAll('[data-col]')]
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

  delegate(container(), '[data-autowarn]', 'click', (badge, e) => {
    e.stopPropagation();
    const col = badge.dataset.autowarn!;
    if (!db.aggregates.some((a: AggregateSpec) => a.col === col)) {
      db.aggregates.push({ fn: smartDefaultFn(col), col, alias: '', auto: true } as AggregateSpec & { auto: boolean });
    }
    renderColChips();
    renderAggregateItems(projectedCols());
  });

  delegate(container(), '.chip[data-col]', 'dblclick', (chip) => {
    const col  = getChipCol(chip)!;
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

  delegate(container(), '.chip[data-col]', 'contextmenu', (chip, e) => {
    e.preventDefault();
    const alias = getChipCol(chip)!;
    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'Rename',
        action: () => {
          const target = resolveRenameTarget(alias);
          if (!target) return;
          showRenameModal(target, () => {
            renderQueryBuilder();
            if (db.result) renderResults(db.result);
          });
        },
      },
    ]);
  });

  delegate(container(), '[data-col]', 'dragstart', (chip, e) => {
    _dragCol = chip.dataset.col!;
    chip.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  delegate(container(), '[data-col]', 'dragend', () => {
    _dragCol = null;
    container().querySelectorAll('.chip').forEach((c: Element) => c.classList.remove('dragging', 'drag-over'));
  });
  delegate(container(), '[data-col]', 'dragover', (_chip, e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const nearest = _chipAtPoint(container(), e.clientX, e.clientY);
    container().querySelectorAll('.chip').forEach((c: Element) => c.classList.remove('drag-over'));
    if (nearest) nearest.classList.add('drag-over');
  });
  delegate(container(), '[data-col]', 'drop', (_chip, e) => {
    e.preventDefault();
    const nearest = _chipAtPoint(container(), e.clientX, e.clientY);
    if (!nearest || !_dragCol || (nearest as HTMLElement).dataset.col === _dragCol) return;
    if (!db.colOrder) db.colOrder = projectedCols();
    const from = db.colOrder!.indexOf(_dragCol);
    const to   = db.colOrder!.indexOf((nearest as HTMLElement).dataset.col!);
    if (from < 0 || to < 0) return;
    db.colOrder!.splice(from, 1);
    db.colOrder!.splice(to, 0, _dragCol);
    _syncSubtotalByToLayout();
    renderQueryBuilder();
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
  const wrap = $('mergeToggles');
  if (!wrap) return;

  const ulChk = $('chkMergeGroupUnderline') as HTMLInputElement | null;
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
