// Select/Dropdown component

import { h } from '../../core/utils.js';

export interface SelectOption {
  value: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  group?: string;
}

export interface SelectOptions {
  id?: string;
  name?: string;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  required?: boolean;
  multiple?: boolean;
  onChange?: (value: string) => void;
}

/**
 * Render a select element
 */
export function renderSelect(options: SelectOptions): string {
  const {
    id = '',
    name = '',
    options: selectOptions,
    placeholder = '',
    className = '',
    required = false,
    multiple = false,
  } = options;

  const idAttr = id ? `id="${h(id)}"` : '';
  const nameAttr = name ? `name="${h(name)}"` : '';
  const classes = ['select', className].filter(Boolean).join(' ');
  const requiredAttr = required ? 'required' : '';
  const multipleAttr = multiple ? 'multiple' : '';

  // Group options by group name
  const grouped = new Map<string, SelectOption[]>();
  const ungrouped: SelectOption[] = [];

  for (const opt of selectOptions) {
    if (opt.group) {
      if (!grouped.has(opt.group)) {
        grouped.set(opt.group, []);
      }
      grouped.get(opt.group)!.push(opt);
    } else {
      ungrouped.push(opt);
    }
  }

  // Render placeholder
  const placeholderHtml = placeholder
    ? `<option value="" disabled selected>${h(placeholder)}</option>`
    : '';

  // Render ungrouped options
  const ungroupedHtml = ungrouped.map(renderOption).join('');

  // Render grouped options
  const groupedHtml = Array.from(grouped.entries()).map(([group, opts]) => {
    const optionsHtml = opts.map(renderOption).join('');
    return `<optgroup label="${h(group)}">${optionsHtml}</optgroup>`;
  }).join('');

  return `<select class="${classes}" ${idAttr} ${nameAttr} ${requiredAttr} ${multipleAttr}>
    ${placeholderHtml}
    ${ungroupedHtml}
    ${groupedHtml}
  </select>`;
}

/**
 * Render a single option element
 */
function renderOption(opt: SelectOption): string {
  const { value, label, selected = false, disabled = false } = opt;
  const valueAttr = `value="${h(value)}"`;
  const selectedAttr = selected ? 'selected' : '';
  const disabledAttr = disabled ? 'disabled' : '';

  return `<option ${valueAttr} ${selectedAttr} ${disabledAttr}>${h(label)}</option>`;
}

/**
 * Render a simple dropdown with label
 */
export function renderLabeledSelect(
  label: string,
  options: SelectOptions,
  labelOptions: {
    tooltip?: string;
    className?: string;
  } = {}
): string {
  const { tooltip = '', className = '' } = labelOptions;
  const tooltipAttr = tooltip ? `data-tip="${h(tooltip)}"` : '';
  const classes = ['labeled-select', className].filter(Boolean).join(' ');

  return `<div class="${classes}">
    <label ${tooltipAttr}>${h(label)}</label>
    ${renderSelect(options)}
  </div>`;
}

/**
 * Get the value of a select element
 */
export function getSelectValue(select: HTMLSelectElement): string {
  return select.value;
}

/**
 * Set the value of a select element
 */
export function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
}

/**
 * Get all selected values from a multi-select
 */
export function getMultiSelectValues(select: HTMLSelectElement): string[] {
  return Array.from(select.selectedOptions).map(opt => opt.value);
}

/**
 * Set selected values for a multi-select
 */
export function setMultiSelectValues(select: HTMLSelectElement, values: string[]): void {
  const valueSet = new Set(values);
  for (const option of select.options) {
    option.selected = valueSet.has(option.value);
  }
}

/**
 * Find the closest select element from an event target
 */
export function findSelect(target: HTMLElement): HTMLSelectElement | null {
  return target.closest('select') as HTMLSelectElement | null;
}

/**
 * Create options array from a simple string array
 */
export function optionsFromStrings(values: string[]): SelectOption[] {
  return values.map(value => ({ value, label: value }));
}

/**
 * Create options array from key-value pairs
 */
export function optionsFromObject(obj: Record<string, string>): SelectOption[] {
  return Object.entries(obj).map(([value, label]) => ({ value, label }));
}
