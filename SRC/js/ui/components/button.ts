// Button component

import { h } from '../../core/utils.js';

export interface ButtonOptions {
  label: string;
  onClick?: () => void;
  className?: string;
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  tooltip?: string;
  icon?: string;
  iconPosition?: 'left' | 'right';
  type?: 'button' | 'submit' | 'reset';
}

/**
 * Render a button element
 */
export function renderButton(options: ButtonOptions): string {
  const {
    label,
    className = '',
    variant = 'default',
    size = 'medium',
    disabled = false,
    tooltip = '',
    icon = '',
    iconPosition = 'left',
    type = 'button',
  } = options;

  const classes = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    icon ? 'btn-has-icon' : '',
    className,
  ].filter(Boolean).join(' ');

  const disabledAttr = disabled ? 'disabled' : '';
  const tooltipAttr = tooltip ? `data-tip="${h(tooltip)}"` : '';
  const typeAttr = `type="${type}"`;

  const iconHtml = icon ? `<span class="btn-icon">${icon}</span>` : '';
  const labelHtml = `<span class="btn-label">${h(label)}</span>`;

  const content = iconPosition === 'left'
    ? `${iconHtml}${labelHtml}`
    : `${labelHtml}${iconHtml}`;

  return `<button class="${classes}" ${disabledAttr} ${tooltipAttr} ${typeAttr}>
    ${content}
  </button>`;
}

/**
 * Render a button group
 */
export function renderButtonGroup(
  buttons: ButtonOptions[],
  options: {
    className?: string;
    orientation?: 'horizontal' | 'vertical';
  } = {}
): string {
  const {
    className = '',
    orientation = 'horizontal',
  } = options;

  const classes = [
    'btn-group',
    `btn-group-${orientation}`,
    className,
  ].filter(Boolean).join(' ');

  const buttonsHtml = buttons.map(btn => renderButton(btn)).join('');

  return `<div class="${classes}">${buttonsHtml}</div>`;
}

/**
 * Render an icon button (button with only an icon)
 */
export function renderIconButton(options: {
  icon: string;
  label: string;
  onClick?: () => void;
  className?: string;
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  tooltip?: string;
}): string {
  const {
    icon,
    label,
    className = '',
    variant = 'default',
    size = 'medium',
    disabled = false,
    tooltip = label,
  } = options;

  const classes = [
    'btn',
    'btn-icon-only',
    `btn-${variant}`,
    `btn-${size}`,
    className,
  ].filter(Boolean).join(' ');

  const disabledAttr = disabled ? 'disabled' : '';
  const tooltipAttr = tooltip ? `data-tip="${h(tooltip)}"` : '';
  const ariaLabelAttr = `aria-label="${h(label)}"`;

  return `<button class="${classes}" ${disabledAttr} ${tooltipAttr} ${ariaLabelAttr}>
    <span class="btn-icon">${icon}</span>
  </button>`;
}

/**
 * Render a toggle button
 */
export function renderToggleButton(options: {
  label: string;
  pressed: boolean;
  onClick?: () => void;
  className?: string;
  tooltip?: string;
}): string {
  const {
    label,
    pressed,
    className = '',
    tooltip = '',
  } = options;

  const classes = [
    'btn',
    'btn-toggle',
    pressed ? 'btn-toggle-pressed' : '',
    className,
  ].filter(Boolean).join(' ');

  const pressedAttr = pressed ? 'aria-pressed="true"' : 'aria-pressed="false"';
  const tooltipAttr = tooltip ? `data-tip="${h(tooltip)}"` : '';

  return `<button class="${classes}" ${pressedAttr} ${tooltipAttr}>
    <span class="btn-label">${h(label)}</span>
  </button>`;
}

/**
 * Find the closest button element from an event target
 */
export function findButton(target: HTMLElement): HTMLElement | null {
  return target.closest('button') as HTMLElement | null;
}

/**
 * Check if a button is disabled
 */
export function isButtonDisabled(button: HTMLElement): boolean {
  return button.hasAttribute('disabled');
}

/**
 * Enable/disable a button
 */
export function setButtonDisabled(button: HTMLElement, disabled: boolean): void {
  if (disabled) {
    button.setAttribute('disabled', '');
  } else {
    button.removeAttribute('disabled');
  }
}
