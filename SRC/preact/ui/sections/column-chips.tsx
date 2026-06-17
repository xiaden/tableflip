/**
 * Column chips — draggable column chips for layout ordering.
 *
 * Renders projected columns as draggable, reorderable chips.
 * Supports double-click to toggle visibility (or group/subtotals behavior),
 * right-click context menu for rename, and drag-and-drop reordering.
 *
 * Ported from SRC/js/ui/views/output-card.tsx (ColChips component).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getStore } from '../../core/store';
import { useStore } from '../useStore';
import { buildReportSpecFromState } from '../../core/state';
import {
  colLabel,
  getTableColorClass,
  smartDefaultFn,
} from '../../core/utils';
import { buildColSourceMap, projectedCols } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import {
  _syncSubtotalByToLayout,
  _afterCombineChange,
} from '../../query/layout-selection';
import { Chip } from '../components/chip';
import { ContextMenu, type CtxMenuItem } from '../components/context-menu';
import { resolveRenameTarget, RenameModal, type RenameTarget } from '../components/rename-modal';
import type { ColMapEntry } from '../../catalog/column-catalog';
import type { AppState, AggregateSpec } from '../../types';

/** Build tooltip string for a column chip. */
function _buildTooltip(c: string, src: ColMapEntry | undefined, state: AppState): string {
  if (src?.kind === 'calc') {
    const calc = state.calcStages?.[src.idx];
    const mode = calc?.mode || 'unknown';
    if (mode === 'math') {
      const math = calc?.math as { steps?: Array<{ type?: string }> } | undefined;
      const steps = math?.steps?.length || 0;
      return `Calculated column: Math (${steps} step${steps !== 1 ? 's' : ''})`;
    } else if (mode === 'compare') {
      const compare = calc?.compare as { conditions?: unknown[]; compareMode?: string } | undefined;
      const condCount = compare?.conditions?.length || 0;
      const glue = compare?.compareMode || 'AND';
      return `Calculated column: Compare (${condCount} condition${condCount !== 1 ? 's' : ''}, ${glue})`;
    } else if (mode === 'text') {
      const text = calc?.text as { operation?: string } | undefined;
      return `Calculated column: Text (${text?.operation || 'unknown'})`;
    }
    return `Calculated column: ${mode}`;
  }
  if (src) {
    const tbl = state.tables[src.tid];
    const tblAny = tbl as unknown as Record<string, unknown>;
    const samples = tblAny?.samples as Record<string, string[]> | undefined;
    const vals = (samples?.[src.col] || []).slice(0, 3);
    const from = `From sheet: ${tbl?.name ?? src.tid}`;
    return vals.length
      ? `${from}\nSample values: ${vals.map(v => String(v)).join(' · ')}`
      : `${from}\n(no sample values available)`;
  }
  return '';
}

/** Find the nearest chip element to a point, excluding the dragged chip. */
function _chipAtPoint(el: HTMLElement, x: number, y: number, dragCol: string | null): Element | null {
  const chips = [...el.querySelectorAll('[data-col]')]
    .filter(c => (c as HTMLElement).dataset.col !== dragCol);
  if (!chips.length) return null;

  const direct = document.elementFromPoint(x, y)?.closest('[data-col]');
  if (direct && (direct as HTMLElement).dataset.col !== dragCol) return direct;

  const sameRow = chips.filter(c => {
    const r = c.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });

  const pool = sameRow.length ? sameRow : chips;
  let best: Element | null = null;
  let bestDist = Infinity;
  for (const chip of pool) {
    const r = chip.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const d = sameRow.length ? Math.abs(x - cx) : Math.hypot(x - cx, y - cy);
    if (d < bestDist) { bestDist = d; best = chip; }
  }
  return best;
}

export function ColumnChips() {
  const state = useStore(s => s);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragColRef = useRef<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  useEffect(() => {
    _afterCombineChange();
  }, [state.base, state.lookups.length, state.calcStages.length]);

  const base = state.base;
  if (!base) return null;

  const colMap = buildColSourceMap();
  const mode = state.aggMode || 'none';

  const groupSet = new Set(state.groupBy);
  const showBadges = mode === 'group' && groupSet.size > 0;
  const selSet = state.selCols;
  const colOrder = state.colOrder;

  const handleDblClick = useCallback((col: string) => {
    const currentMode = getStore().getState().aggMode || 'none';

    if (currentMode === 'group') {
      getStore().update(draft => {
        const idx = draft.groupBy.indexOf(col);
        if (idx >= 0) {
          draft.groupBy.splice(idx, 1);
          if (draft.groupBy.length === 0) {
            draft.aggregates = draft.aggregates.filter(a => !(a as AggregateSpec & { auto?: boolean }).auto);
          } else if (!draft.aggregates.some(a => a.col === col)) {
            draft.aggregates.push({ fn: smartDefaultFn(col), col, alias: '', auto: true } as AggregateSpec);
          }
        } else {
          draft.groupBy.push(col);
          draft.aggregates = draft.aggregates.filter(a => !((a as AggregateSpec & { auto?: boolean }).auto && a.col === col));
          const allCols = projectedCols(
            buildReportSpecFromState(draft),
            buildSourceCatalog(draft.tables),
          );
          for (const c of allCols) {
            if (!draft.groupBy.includes(c) && !draft.aggregates.some(a => a.col === c)) {
              draft.aggregates.push({ fn: smartDefaultFn(c), col: c, alias: '', auto: true } as AggregateSpec);
            }
          }
        }
      });
    } else if (currentMode === 'subtotals') {
      getStore().update(draft => {
        const sb = draft.subtotalBy || (draft.subtotalBy = []);
        const idx = sb.indexOf(col);
        if (idx >= 0) { sb.splice(idx, 1); delete draft.subtotalFns[col]; }
        else { sb.push(col); }
      });
      _syncSubtotalByToLayout();
    } else {
      getStore().update(draft => {
        const s = draft.selCols;
        if (s.has(col)) s.delete(col);
        else s.add(col);
      });
    }
    _afterCombineChange();
  }, []);

  const onDragStart = useCallback((col: string, e: React.DragEvent) => {
    dragColRef.current = col;
    (e.target as HTMLElement).classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDragEnd = useCallback(() => {
    dragColRef.current = null;
    containerRef.current?.querySelectorAll('.chip').forEach(c => c.classList.remove('dragging', 'drag-over'));
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const el = containerRef.current;
    if (!el) return;
    const nearest = _chipAtPoint(el, e.clientX, e.clientY, dragColRef.current);
    el.querySelectorAll('.chip').forEach(c => c.classList.remove('drag-over'));
    if (nearest) nearest.classList.add('drag-over');
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const nearest = _chipAtPoint(el, e.clientX, e.clientY, dragColRef.current);
    const dragCol = dragColRef.current;
    if (!nearest || !dragCol || (nearest as HTMLElement).dataset.col === dragCol) return;

    getStore().update(draft => {
      const from = draft.colOrder.indexOf(dragCol);
      const to = draft.colOrder.indexOf((nearest as HTMLElement).dataset.col!);
      if (from < 0 || to < 0) return;
      draft.colOrder.splice(from, 1);
      draft.colOrder.splice(to, 0, dragCol);
    });
    _syncSubtotalByToLayout();
    _afterCombineChange();
  }, []);

  const hint = mode === 'group'
    ? '— double-click to group by · drag to reorder · right-click to rename'
    : mode === 'subtotals'
      ? '— double-click to group rows · drag to reorder · right-click to rename'
      : '— double-click to show/hide · drag to reorder · right-click to rename';

  return (
    <div>
      <div
        ref={containerRef}
        id="colChips"
        className="chips"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {colOrder.map(c => {
          const src = colMap.get(c);
          const colorCls = src && src.kind !== 'calc' ? getTableColorClass(src.tid) : '';
          const label = src && src.kind !== 'calc' ? colLabel(src.tid, src.col) : c;

          if (selSet && !selSet.has(c)) return null;

          const tip = _buildTooltip(c, src, state);

          if (mode === 'group') {
            const isOn = groupSet.has(c);
            const hasAgg = state.aggregates.some(a => a.col === c);
            const isOrphan = showBadges && !isOn && !hasAgg;
            const badge = isOrphan ? '⚠' : '';
            const badgeTip = isOrphan ? 'This column has no calculation — it will be left out of the report. Click the ⚠ to add a calculation automatically.' : '';
            return (
              <Chip
                key={c} col={c} label={label} colorClass={colorCls} selected={isOn}
                draggable={true} tooltip={tip} badge={badge} badgeTooltip={badgeTip}
                inlineStyle={isOrphan ? 'opacity:0.65' : undefined}
                onDblClick={() => handleDblClick(c)}
                onContextMenu={e => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(c)) }] });
                }}
                onDragStart={e => onDragStart(c, e)}
                onDragEnd={onDragEnd}
              />
            );
          } else if (mode === 'subtotals') {
            const isOn = (state.subtotalBy || []).includes(c);
            return (
              <Chip
                key={c} col={c} label={label} colorClass={colorCls} selected={isOn}
                draggable={true} tooltip={tip}
                onDblClick={() => handleDblClick(c)}
                onContextMenu={e => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(c)) }] });
                }}
                onDragStart={e => onDragStart(c, e)}
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
              onContextMenu={e => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(c)) }] });
              }}
              onDragStart={e => onDragStart(c, e)}
              onDragEnd={onDragEnd}
            />
          );
        })}
      </div>
      <div id="colCardHint" style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 4 }}>{hint}</div>
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />
      )}
      {renameTarget && (
        <RenameModal target={renameTarget} onDone={() => _afterCombineChange()} onClose={() => setRenameTarget(null)} />
      )}
    </div>
  );
}

/** Select all projected columns. */
export function selectAllCols(): void {
  const state = getStore().getState();
  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(state.tables);
  getStore().update(draft => {
    draft.selCols = new Set(projectedCols(reportSpec, sourceCatalog));
  });
  _afterCombineChange();
}

/** Deselect all projected columns. */
export function selectNoneCols(): void {
  getStore().update(draft => { draft.selCols = new Set(); });
  _afterCombineChange();
}
