import { useRef, useCallback, useState } from 'preact/hooks';
import { render } from 'preact/compat';
import { db } from '../../core/state.js';
import { projectedCols, buildColSourceMap, type ColMapEntry, type PhysicalColEntry } from '../../catalog/column-catalog.js';
import { colDisplayLabel, getTableColorClass, smartDefaultFn } from '../../core/utils.js';
import { renderSubtotalsSection, renderAggregation } from '../aggregation.js';
import { renderQueryBuilder } from './query-builder.js';
import { renderResults } from '../grid.js';
import { ContextMenu, type CtxMenuItem } from '../components/context-menu.js';
import { resolveRenameTarget, RenameModal, type RenameTarget } from '../components/rename-modal.js';
import { Chip } from '../components/chip.js';
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

function _chipAtPoint(el: HTMLElement, x: number, y: number, dragCol: string | null): Element | null {
  const chips = [...el.querySelectorAll('[data-col]')]
    .filter((c: Element) => (c as HTMLElement).dataset.col !== dragCol);
  if (!chips.length) return null;

  const direct = document.elementFromPoint(x, y)?.closest('[data-col]');
  if (direct && (direct as HTMLElement).dataset.col !== dragCol) return direct;

  const sameRow = chips.filter(c => {
    const r = c.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });

  const pool = sameRow.length ? sameRow : chips;
  let best = null, bestDist = Infinity;
  for (const chip of pool) {
    const r  = chip.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const d  = sameRow.length ? Math.abs(x - cx) : Math.hypot(x - cx, y - cy);
    if (d < bestDist) { bestDist = d; best = chip; }
  }
  return best;
}

function handleDblClick(col: string) {
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
    if (idx >= 0) { sb.splice(idx, 1); delete db.subtotalFns![col]; }
    else { sb.push(col); }
    _syncSubtotalByToLayout();
    renderAggregation();
  } else {
    if (!db.selCols) db.selCols = new Set(projectedCols());
    const s = db.selCols;
    if (s.has(col)) s.delete(col);
    renderQueryBuilder();
  }
}

export function ColChips() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragColRef = useRef<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  if (!db.base) return null;

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

  const onDragStart = useCallback((col: string, e: DragEvent) => {
    dragColRef.current = col;
    (e.target as HTMLElement).classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDragEnd = useCallback(() => {
    dragColRef.current = null;
    containerRef.current?.querySelectorAll('.chip').forEach(c => c.classList.remove('dragging', 'drag-over'));
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const el = containerRef.current;
    if (!el) return;
    const nearest = _chipAtPoint(el, e.clientX, e.clientY, dragColRef.current);
    el.querySelectorAll('.chip').forEach(c => c.classList.remove('drag-over'));
    if (nearest) nearest.classList.add('drag-over');
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const nearest = _chipAtPoint(el, e.clientX, e.clientY, dragColRef.current);
    const dragCol = dragColRef.current;
    if (!nearest || !dragCol || (nearest as HTMLElement).dataset.col === dragCol) return;
    if (!db.colOrder) db.colOrder = projectedCols();
    const from = db.colOrder!.indexOf(dragCol);
    const to   = db.colOrder!.indexOf((nearest as HTMLElement).dataset.col!);
    if (from < 0 || to < 0) return;
    db.colOrder!.splice(from, 1);
    db.colOrder!.splice(to, 0, dragCol);
    _syncSubtotalByToLayout();
    renderQueryBuilder();
    if ((db.aggMode || 'none') === 'subtotals') {
      const projected = projectedCols();
      const ordered = Array.isArray(db.colOrder)
        ? db.colOrder!.filter(c => projected.includes(c))
        : projected;
      renderSubtotalsSection(ordered);
    }
  }, []);

  const hint = mode === 'group'
    ? '\u2014 double-click to group by \u00B7 drag to reorder \u00B7 right-click to rename'
    : mode === 'subtotals'
      ? '\u2014 double-click to group rows \u00B7 drag to reorder \u00B7 right-click to rename'
      : '\u2014 double-click to show/hide \u00B7 drag to reorder \u00B7 right-click to rename';

  return (
    <div>
      <div
        ref={containerRef}
        id="colChips"
        class="chips"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {colOrder.map(c => {
          const src      = colMap.get(c);
          const colorCls = src ? getTableColorClass((src as unknown as Record<string, string>).tid) : '';
          const label    = colDisplayLabel(c, colMap);

          if (selSet && !selSet.has(c)) return null;

          const tip = _buildTooltip(c, src);

          if (mode === 'group') {
            const isOn     = groupSet.has(c);
            const hasAgg   = db.aggregates.some((a: AggregateSpec) => a.col === c);
            const isOrphan = showBadges && !isOn && !hasAgg;
            const badge    = isOrphan ? '\u26A0' : '';
            const badgeTip = isOrphan ? 'No calculation for this column \u2014 it will be dropped from results. Click \u26A0 to add one automatically.' : '';
            return (
              <Chip
                key={c} col={c} label={label} colorClass={colorCls} selected={isOn}
                draggable={true} tooltip={tip} badge={badge} badgeTooltip={badgeTip}
                className={isOrphan ? 'chip-orphan' : ''}
                onDblClick={() => handleDblClick(c)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(c)) }] }); }}
                onDragStart={(e) => onDragStart(c, e)}
                onDragEnd={onDragEnd}
              />
            );
          } else if (mode === 'subtotals') {
            const isOn = (db.subtotalBy || []).includes(c);
            return (
              <Chip
                key={c} col={c} label={label} colorClass={colorCls} selected={isOn}
                draggable={true} tooltip={tip}
                onDblClick={() => handleDblClick(c)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(c)) }] }); }}
                onDragStart={(e) => onDragStart(c, e)}
                onDragEnd={onDragEnd}
              />
            );
          }
          const isOn = selSet ? selSet.has(c) : false;
          return (
            <Chip
              key={c} col={c} label={label} colorClass={colorCls} selected={isOn}
              draggable={true} tooltip={tip}
              onDblClick={() => handleDblClick(c)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(c)) }] }); }}
              onDragStart={(e) => onDragStart(c, e)}
              onDragEnd={onDragEnd}
            />
          );
        })}
      </div>
      <div id="colCardHint" style="font-size:0.72rem;color:var(--muted);margin-top:4px">{hint}</div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {renameTarget && (
        <RenameModal
          target={renameTarget}
          onDone={() => { renderQueryBuilder(); if (db.result) renderResults(db.result); }}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}

export function selectAllCols(): void  { db.selCols = new Set(projectedCols()); renderQueryBuilder(); }
if (typeof window !== 'undefined') window.selectAllCols = selectAllCols;
export function selectNoneCols(): void { db.selCols = new Set();                 renderQueryBuilder(); }
if (typeof window !== 'undefined') window.selectNoneCols = selectNoneCols;

export function MergeToggles() {
  const cols = (db.result?.cols as string[]) || projectedCols();
  if (!cols.length) return null;

  const baseDisplayCols = cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow');
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
    return <span style="font-size:0.76rem;color:var(--muted)">No result columns</span>;
  }

  if (!db.mergedCols) db.mergedCols = [];
  const mergedSet = new Set(db.mergedCols);
  const colMap = buildColSourceMap();

  const toggle = (c: string, checked: boolean) => {
    if (checked) { if (!db.mergedCols.includes(c)) db.mergedCols.push(c); }
    else { db.mergedCols = db.mergedCols.filter(x => x !== c); }
    if (db.result) renderResults(db.result);
  };

  return (
    <div id="mergeToggles">
      {displayCols.map(c => (
        <label key={c} style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;font-weight:normal;margin-top:4px">
          <input
            type="checkbox"
            checked={mergedSet.has(c)}
            onChange={(e) => toggle(c, (e.target as HTMLInputElement).checked)}
          />
          {colDisplayLabel(c, colMap)}
        </label>
      ))}
    </div>
  );
}

export function setMergeGroupUnderline(checked: boolean): void {
  db.mergeGroupUnderline = !!checked;
  if (db.result) renderResults(db.result);
}
if (typeof window !== 'undefined') window.setMergeGroupUnderline = setMergeGroupUnderline;

// Legacy render function — calls render() to mount Preact component
let _colChipsRoot: HTMLElement | null = null;
let _mergeTogglesRoot: HTMLElement | null = null;

export function renderColChips(): void {
  const el = document.getElementById('colChips');
  if (!el) return;
  if (!_colChipsRoot) {
    _colChipsRoot = el.parentElement!;
  }
  render(<ColChips />, _colChipsRoot);
}

export function renderMergeToggles(_cols: string[]): void {
  const el = document.getElementById('mergeToggles');
  if (!el) return;
  if (!_mergeTogglesRoot) {
    _mergeTogglesRoot = el;
  }
  render(<MergeToggles />, _mergeTogglesRoot);
}
