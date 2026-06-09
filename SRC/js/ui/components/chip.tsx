import type { ComponentChildren } from 'preact';
import { getTableColorClass, colDisplayLabel } from '../../core/utils.js';
import { type ColMapEntry } from '../../catalog/column-catalog.js';

export interface ChipProps {
  col: string;
  label: string;
  colorClass?: string;
  selected?: boolean;
  draggable?: boolean;
  tooltip?: string;
  badge?: string;
  badgeTooltip?: string;
  className?: string;
  chipClass?: string;
  dataAttrs?: Record<string, string>;
  inlineStyle?: string;
  onContextMenu?: (e: MouseEvent) => void;
  onDblClick?: (e: MouseEvent) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  children?: ComponentChildren;
}

export function Chip({
  col,
  label,
  colorClass = '',
  selected = false,
  draggable = true,
  tooltip = '',
  badge = '',
  badgeTooltip = '',
  className = '',
  chipClass = 'chip',
  dataAttrs,
  inlineStyle,
  onContextMenu,
  onDblClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ChipProps) {
  const classes = [
    chipClass,
    selected ? 'on' : '',
    colorClass,
    className,
  ].filter(Boolean).join(' ');

  const extraAttrs: Record<string, string> = { ...dataAttrs };

  return (
    <span
      class={classes}
      draggable={draggable}
      data-col={col}
      data-tip={tooltip || undefined}
      style={inlineStyle || undefined}
      {...extraAttrs}
      onContextMenu={onContextMenu}
      onDblClick={onDblClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {label}
      {badge && (
        <span
          class="chip-warn-badge"
          data-autowarn={col}
          title={badgeTooltip}
        >
          {badge}
        </span>
      )}
    </span>
  );
}

// ── Legacy HTML string helpers (temporary bridge until views migrate) ──

export interface ChipOptions {
  col: string;
  label: string;
  colorClass?: string;
  selected?: boolean;
  draggable?: boolean;
  tooltip?: string;
  badge?: string;
  badgeTooltip?: string;
  className?: string;
  chipClass?: string;
  dataAttrs?: Record<string, string>;
  inlineStyle?: string;
}

export function renderChip(options: ChipOptions): string {
  const {
    col, label, colorClass = '', selected = false, draggable = true,
    tooltip = '', badge = '', badgeTooltip = '', className = '',
    chipClass = 'chip', dataAttrs, inlineStyle,
  } = options;

  const classes = [chipClass, selected ? 'on' : '', colorClass, className].filter(Boolean).join(' ');
  const badgeHtml = badge
    ? ` <span class="chip-warn-badge" data-autowarn="${col}" title="${badgeTooltip}">${badge}</span>`
    : '';
  const draggableAttr = draggable ? 'draggable="true"' : '';
  const tooltipAttr = tooltip ? `data-tip="${tooltip}"` : '';
  const styleAttr = inlineStyle ? `style="${inlineStyle}"` : '';
  const extraAttrs = dataAttrs
    ? Object.entries(dataAttrs).map(([k, v]) => `${k}="${v}"`).join(' ')
    : '';

  return `<span class="${classes}" ${draggableAttr} data-col="${col}" ${extraAttrs} ${tooltipAttr} ${styleAttr}>${label}${badgeHtml}</span>`;
}

export function renderChips(
  columns: string[],
  colMap: Map<string, ColMapEntry>,
  options: {
    selectedCols?: Set<string>;
    mode?: 'detail' | 'group' | 'subtotals';
    groupBy?: string[];
    subtotalBy?: string[];
    getTooltip?: (col: string) => string;
    getBadge?: (col: string) => { badge: string; tooltip: string } | null;
  } = {}
): string {
  const {
    selectedCols, mode = 'detail', groupBy = [], subtotalBy = [],
    getTooltip = () => '', getBadge = () => null,
  } = options;

  return columns.map(col => {
    const src = colMap.get(col);
    const colorClass = src ? getTableColorClass((src as any).tid) : '';
    const label = colDisplayLabel(col, colMap);
    let selected = false;
    if (mode === 'group') selected = groupBy.includes(col);
    else if (mode === 'subtotals') selected = subtotalBy.includes(col);
    else selected = selectedCols?.has(col) ?? true;
    const badgeInfo = getBadge(col);
    return renderChip({
      col, label, colorClass, selected, draggable: true,
      tooltip: getTooltip(col), badge: badgeInfo?.badge || '', badgeTooltip: badgeInfo?.tooltip || '',
    });
  }).join('');
}

export function findChip(target: HTMLElement): HTMLElement | null {
  return target.closest('.chip[data-col]') as HTMLElement | null;
}

export function findChipBy(target: HTMLElement, selector: string): HTMLElement | null {
  return target.closest(selector) as HTMLElement | null;
}

export function getChipCol(chip: HTMLElement): string | null {
  return chip.dataset.col || null;
}

export function isChipSelected(chip: HTMLElement): boolean {
  return chip.classList.contains('on');
}

export function toggleChipSelected(chip: HTMLElement): boolean {
  chip.classList.toggle('on');
  return isChipSelected(chip);
}
