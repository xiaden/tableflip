// Chip component for column selection and display

import { h, getTableColorClass, colDisplayLabel } from '../../core/utils.js';
import { type ColMapEntry } from '../../catalog/column-catalog.js';

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
}

/**
 * Render a single chip element
 */
export function renderChip(options: ChipOptions): string {
  const {
    col,
    label,
    colorClass = '',
    selected = false,
    draggable = true,
    tooltip = '',
    badge = '',
    badgeTooltip = '',
    className = '',
  } = options;

  const classes = [
    'chip',
    selected ? 'on' : '',
    colorClass,
    className,
  ].filter(Boolean).join(' ');

  const badgeHtml = badge
    ? ` <span class="chip-warn-badge" data-autowarn="${h(col)}" title="${h(badgeTooltip)}">${badge}</span>`
    : '';

  const draggableAttr = draggable ? 'draggable="true"' : '';
  const tooltipAttr = tooltip ? `data-tip="${h(tooltip)}"` : '';

  return `<span class="${classes}" ${draggableAttr} data-col="${h(col)}" ${tooltipAttr}>${h(label)}${badgeHtml}</span>`;
}

/**
 * Render multiple chips from column data
 */
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
    selectedCols,
    mode = 'detail',
    groupBy = [],
    subtotalBy = [],
    getTooltip = () => '',
    getBadge = () => null,
  } = options;

  return columns.map(col => {
    const src = colMap.get(col);
    const colorClass = src ? getTableColorClass((src as any).tid) : '';
    const label = colDisplayLabel(col, colMap);

    let selected = false;
    if (mode === 'group') {
      selected = groupBy.includes(col);
    } else if (mode === 'subtotals') {
      selected = subtotalBy.includes(col);
    } else {
      selected = selectedCols?.has(col) ?? true;
    }

    const badgeInfo = getBadge(col);
    const badge = badgeInfo?.badge || '';
    const badgeTooltip = badgeInfo?.tooltip || '';

    return renderChip({
      col,
      label,
      colorClass,
      selected,
      draggable: true,
      tooltip: getTooltip(col),
      badge,
      badgeTooltip,
    });
  }).join('');
}

/**
 * Find the closest chip element from an event target
 */
export function findChip(target: HTMLElement): HTMLElement | null {
  return target.closest('.chip[data-col]') as HTMLElement | null;
}

/**
 * Get the column name from a chip element
 */
export function getChipCol(chip: HTMLElement): string | null {
  return chip.dataset.col || null;
}

/**
 * Check if a chip is selected
 */
export function isChipSelected(chip: HTMLElement): boolean {
  return chip.classList.contains('on');
}

/**
 * Toggle chip selection state
 */
export function toggleChipSelected(chip: HTMLElement): boolean {
  chip.classList.toggle('on');
  return isChipSelected(chip);
}
