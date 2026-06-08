// Card component for UI sections

import { h } from '../../core/utils.js';

export interface CardOptions {
  id?: string;
  title?: string;
  tooltip?: string;
  className?: string;
  content?: string;
  collapsible?: boolean;
  collapsed?: boolean;
}

/**
 * Render a card container
 */
export function renderCard(options: CardOptions): string {
  const {
    id = '',
    title = '',
    tooltip = '',
    className = '',
    content = '',
    collapsible = false,
    collapsed = false,
  } = options;

  const idAttr = id ? `id="${h(id)}"` : '';
  const classes = ['qb-card', className, collapsed ? 'collapsed' : ''].filter(Boolean).join(' ');
  const tooltipAttr = tooltip ? `data-tip="${h(tooltip)}"` : '';

  const titleHtml = title
    ? `<div class="qb-title" ${tooltipAttr}>
        ${h(title)}
        ${collapsible ? '<span class="qb-collapse-toggle">▼</span>' : ''}
       </div>`
    : '';

  return `<div class="${classes}" ${idAttr}>
    ${titleHtml}
    <div class="qb-card-content">${content}</div>
  </div>`;
}

/**
 * Render a card header with title and optional controls
 */
export function renderCardHeader(
  title: string,
  options: {
    tooltip?: string;
    hint?: string;
    controls?: string;
  } = {}
): string {
  const { tooltip = '', hint = '', controls = '' } = options;

  const tooltipAttr = tooltip ? `data-tip="${h(tooltip)}"` : '';
  const hintHtml = hint ? `<span class="qb-card-hint">${h(hint)}</span>` : '';

  return `<div class="qb-card-header">
    <div class="qb-title" ${tooltipAttr}>${h(title)}</div>
    ${hintHtml}
    ${controls ? `<div class="qb-card-controls">${controls}</div>` : ''}
  </div>`;
}

/**
 * Render a card section (sub-section within a card)
 */
export function renderCardSection(
  title: string,
  content: string,
  options: {
    id?: string;
    tooltip?: string;
    collapsible?: boolean;
    collapsed?: boolean;
  } = {}
): string {
  const {
    id = '',
    tooltip = '',
    collapsible = false,
    collapsed = false,
  } = options;

  const idAttr = id ? `id="${h(id)}"` : '';
  const tooltipAttr = tooltip ? `data-tip="${h(tooltip)}"` : '';
  const classes = ['qb-section', collapsed ? 'collapsed' : ''].filter(Boolean).join(' ');

  const titleHtml = title
    ? `<div class="qb-section-title" ${tooltipAttr}>
        ${h(title)}
        ${collapsible ? '<span class="qb-collapse-toggle">▼</span>' : ''}
       </div>`
    : '';

  return `<div class="${classes}" ${idAttr}>
    ${titleHtml}
    <div class="qb-section-content">${content}</div>
  </div>`;
}

/**
 * Render an empty state message for a card
 */
export function renderEmptyState(message: string, options: { icon?: string } = {}): string {
  const { icon = '📋' } = options;
  return `<div class="qb-empty-state">
    <div class="qb-empty-icon">${icon}</div>
    <div class="qb-empty-message">${h(message)}</div>
  </div>`;
}

/**
 * Find the closest card element from an event target
 */
export function findCard(target: HTMLElement): HTMLElement | null {
  return target.closest('.qb-card') as HTMLElement | null;
}

/**
 * Find the closest section element from an event target
 */
export function findSection(target: HTMLElement): HTMLElement | null {
  return target.closest('.qb-section') as HTMLElement | null;
}
