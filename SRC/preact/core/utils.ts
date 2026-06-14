import type { ColSourceEntry } from '../types';
import { getStore } from './store';

// Dynamic imports for Phase 2 modules — deferred to avoid hard dependency from Phase A.
// TODO: resolve in Phase 2 — these will become direct imports once the catalog/query
// layers are stable and Phase A no longer needs to compile independently.
async function loadColSourceMap() {
  const mod = await import('../catalog/column-catalog.js');
  return mod.buildColSourceMap;
}
async function loadRenameProjectedAliasRefs() {
  const mod = await import('../query/alias-ref-updater.js');
  return mod._renameProjectedAliasRefs;
}

/**
 * Escapes HTML special characters to prevent XSS in innerHTML usage.
 * Converts &, <, >, " to their HTML entity equivalents.
 * @param s - The value to escape (coerced to string if not already)
 * @returns HTML-safe string
 */
export function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Strips the file extension from a filename.
 * @param fn - Filename with extension (e.g., "data.xlsx")
 * @returns Filename without extension (e.g., "data")
 */
export function stripExt(fn: string): string { return fn.replace(/\.[^.]+$/, ''); }

/**
 * Triggers a browser file download for a Blob.
 * Creates a temporary anchor element, clicks it, then revokes the object URL.
 * Requires a DOM environment (browser).
 * @param blob - The file content to download
 * @param name - The suggested filename for the download
 */
export function dl(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** Returns or creates the toast container element in the DOM. */
function getToastContainer(): HTMLElement {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

/**
 * Shows a temporary toast notification that auto-dismisses after 3.2 seconds.
 * Requires a DOM environment (browser).
 * @param msg - The message to display
 * @param type - Optional CSS class modifier (e.g., 'error', 'success')
 */
export function toast(msg: string, type?: string): void {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  getToastContainer().appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/**
 * Shows a persistent toast notification that requires user action to dismiss.
 * Includes an optional accept button with custom label and callback.
 * Requires a DOM environment (browser).
 * @param msg - The message to display
 * @param type - CSS class modifier (default: 'warn')
 * @param onAccept - Callback when accept button is clicked
 * @param acceptLabel - Text for the accept button (default: 'Exclude them')
 */
export function stickyToast(msg: string, type?: string, onAccept?: () => void, acceptLabel?: string): void {
  const el = document.createElement('div');
  el.className = 'toast toast-sticky ' + (type || 'warn');
  const txt = document.createElement('span');
  txt.textContent = msg;
  el.appendChild(txt);
  if (onAccept) {
    const accept = document.createElement('button');
    accept.textContent = acceptLabel || 'Exclude them';
    accept.className = 'toast-close';
    accept.style.cssText = 'color:var(--accent);margin-right:4px';
    accept.onclick = () => { el.remove(); onAccept(); };
    el.appendChild(accept);
  }
  const btn = document.createElement('button');
  btn.textContent = '✕';
  btn.className = 'toast-close';
  btn.onclick = () => el.remove();
  el.appendChild(btn);
  getToastContainer().appendChild(el);
}

/**
 * Toggles the sidebar between collapsed and expanded states.
 * Updates the toggle button icon to reflect the current state.
 * Requires DOM elements with IDs 'sidebar' and 'sidebarToggle'.
 */
export function toggleSidebar(): void {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sidebarToggle');
  if (!sb || !btn) return;
  const collapsed = sb.classList.toggle('collapsed');
  btn.classList.toggle('collapsed', collapsed);
  btn.textContent = collapsed ? '❯' : '❮';
}

/**
 * Color palette for table identification in the UI.
 * Colors are assigned to tables in order, cycling when exhausted.
 * Follows the TableFlip brand color scheme.
 */
const TABLE_PALETTE = [
  '#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377',
  '#EE7733', '#0077BB', '#33BBEE', '#EE3377', '#CC3311', '#009988',
  '#882255', '#117733', '#999933', '#44AA99',
];

export { TABLE_PALETTE };

/**
 * Returns the assigned color for a table, assigning a new one if needed.
 * Colors are picked from TABLE_PALETTE, avoiding already-used colors.
 * Persists the assignment to the store.
 * @param tid - Table ID to get/create color for
 * @returns Hex color string (e.g., '#4477AA')
 */
export function getTableColor(tid: string): string {
  const state = getStore().getState();
  if (state.tableColors[tid]) return state.tableColors[tid];
  const used = new Set(Object.values(state.tableColors));
  const idx = TABLE_PALETTE.findIndex(c => !used.has(c));
  const col = idx >= 0 ? TABLE_PALETTE[idx] : TABLE_PALETTE[Object.keys(state.tableColors).length % TABLE_PALETTE.length];
  getStore().update(draft => { draft.tableColors[tid] = col; });
  return col;
}

/**
 * Returns the CSS class name for a table's color chip.
 * Maps the table's color to its index in TABLE_PALETTE.
 * @param tid - Table ID
 * @returns CSS class string like 'chip-c0', 'chip-c1', etc.
 */
export function getTableColorClass(tid: string): string {
  const state = getStore().getState();
  const color = state.tableColors[tid] || getTableColor(tid);
  const idx = TABLE_PALETTE.indexOf(color);
  return `chip-c${idx >= 0 ? idx : 0}`;
}

/**
 * Determines the foreground text color (black or white) for a given background hex color.
 * Uses relative luminance calculation to ensure contrast ratio meets accessibility.
 * @param bg - Hex background color (e.g., '#4477AA')
 * @returns '#111' for light backgrounds, '#fff' for dark backgrounds
 */
export function chipFgColor(bg: string): string {
  if (!bg || typeof bg !== 'string') return '#111';
  const m = bg.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#111';
  const hex = m[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111' : '#fff';
}

/**
 * Returns a truncated display name for a table.
 * Long names (>14 chars) are truncated to 12 chars with an ellipsis.
 * @param tid - Table ID
 * @returns Shortened table name for display
 */
export function tableShortName(tid: string): string {
  const state = getStore().getState();
  const name = state.tables[tid]?.name || tid;
  return name.length > 14 ? name.slice(0, 12) + '…' : name;
}

/**
 * Returns the user-defined display label for a column, or the physical name if none set.
 * @param tid - Table ID
 * @param physCol - Physical column name
 * @returns Display label string
 */
export function colUserLabel(tid: string, physCol: string): string {
  const state = getStore().getState();
  return state.columnLabels?.[tid]?.[physCol] ?? physCol;
}

/**
 * Sets or clears a user-defined display label for a column.
 * If the label matches the physical name or is empty, the label is removed.
 * Persists the change to the store.
 * @param tid - Table ID
 * @param physCol - Physical column name
 * @param label - New display label (empty string to clear)
 */
export function setColLabel(tid: string, physCol: string, label: string): void {
  const state = getStore().getState();
  const columnLabels = { ...state.columnLabels };
  if (!columnLabels[tid]) columnLabels[tid] = {};
  if (!label || label === physCol) {
    delete columnLabels[tid][physCol];
    if (!Object.keys(columnLabels[tid]).length) delete columnLabels[tid];
  } else {
    columnLabels[tid][physCol] = label;
  }
  getStore().update(draft => { draft.columnLabels = columnLabels; });
}

/**
 * Prompts the user to rename a projected column and applies the change.
 * For physical columns, updates the column label in the store.
 * For calculated columns, updates the alias and propagates reference renames.
 * Requires a DOM environment (window.prompt).
 * @param alias - The column alias to rename
 * @returns true if the rename was applied, false if cancelled or not found
 */
export async function renameProjectedColumn(alias: string): Promise<boolean> {
  const buildColSourceMap = await loadColSourceMap();
  const colMap = buildColSourceMap();
  const src = colMap.get(alias);
  if (!src) return false;

  if (src.kind === 'calc') {
    const calc = Array.isArray(getStore().getState().calcStages) ? getStore().getState().calcStages[src.idx] : null;
    if (!calc) return false;
    const current = (calc.alias || '').trim() || alias;
    const next = window.prompt('Rename column:', current);
    if (next === null) return false;
    const renamed = next.trim();
    if (!renamed || renamed === current) return false;
    getStore().update(draft => {
      if (draft.calcStages[src.idx]) draft.calcStages[src.idx].alias = renamed;
    });
    const _renameProjectedAliasRefs = await loadRenameProjectedAliasRefs();
    if (typeof _renameProjectedAliasRefs === 'function') _renameProjectedAliasRefs(current, renamed);
    return true;
  }

  const current = getStore().getState().columnLabels?.[src.tid]?.[src.col] || '';
  const next = window.prompt('Rename column (blank to reset):', current);
  if (next === null) return false;
  setColLabel(src.tid, src.col, next.trim());
  return true;
}

/**
 * Returns the display label for a column alias.
 * For physical columns, formats as "TableName → ColumnLabel".
 * For calculated columns, returns the calc alias or falls back to the alias.
 * @param alias - The column alias
 * @param map - Optional pre-built column source map (avoids re-importing)
 * @returns Display label string
 */
export async function colDisplayLabel(alias: string, map?: Map<string, ColSourceEntry>): Promise<string> {
  const src = (map || (await loadColSourceMap())()).get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') {
    const calc = getStore().getState().calcStages?.[src.idx];
    return (calc?.alias || '').trim() || alias;
  }
  return tableShortName(src.tid) + ' → ' + colUserLabel(src.tid, src.col);
}

/**
 * Returns the export label for a column alias (used in CSV/XLSX headers).
 * For physical columns, returns just the user label without table prefix.
 * For calculated columns, returns the calc alias.
 * @param alias - The column alias
 * @param map - Optional pre-built column source map
 * @returns Export-safe label string
 */
export async function colExportLabel(alias: string, map?: Map<string, ColSourceEntry>): Promise<string> {
  const src = (map || (await loadColSourceMap())()).get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') {
    const calc = getStore().getState().calcStages?.[src.idx];
    return (calc?.alias || '').trim() || alias;
  }
  return colUserLabel(src.tid, src.col);
}

/**
 * Builds a mapping from column aliases to unique export header strings.
 * Appends a numeric suffix when duplicate base labels would collide.
 * @param cols - Array of column aliases to build headers for
 * @param map - Optional pre-built column source map
 * @returns Record mapping alias → unique header string
 */
export async function buildExportHeaderMap(cols: string[], map?: Map<string, ColSourceEntry>): Promise<Record<string, string>> {
  map = map || (await loadColSourceMap())();
  const seen = new Map<string, number>();
  const result: Record<string, string> = {};
  for (const alias of cols) {
    const base = await colExportLabel(alias, map);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    result[alias] = n === 0 ? base : base + ' ' + (n + 1);
  }
  return result;
}

/**
 * Suggests a default aggregate function based on the column name.
 * Matches common patterns: date columns → DATE RANGE, numeric → SUM, else → FIRST.
 * @param colName - The column name to analyze
 * @returns Suggested aggregate function name (e.g., 'SUM', 'DATE RANGE', 'FIRST')
 */
export function smartDefaultFn(colName: string): string {
  const n = String(colName).toLowerCase();
  if (/\bdate\b|time\b|\bdt\b|shipped|arrival|delivery|due\b|created/.test(n)) return 'DATE RANGE';
  if (/amount|total|value|price|cost|\bqty\b|quantity|\bnum\b|number|units|sales|revenue|weight|volume/.test(n)) return 'SUM';
  return 'FIRST';
}

/**
 * Generates a human-readable default alias for an aggregate function.
 * Maps function names to descriptive labels (e.g., 'SUM' → 'Total ColLabel').
 * Falls back to "Fn(Label)" format for unknown functions.
 * @param fn - Aggregate function name (e.g., 'SUM', 'AVG', 'COUNT ROWS')
 * @param colLabel - The column display label
 * @returns Generated alias string
 */
export function defaultAggAlias(fn: string, colLabel: string): string {
  switch (fn) {
    case 'SUM':             return `Total ${colLabel}`;
    case 'AVG':             return `Avg ${colLabel}`;
    case 'COUNT ROWS':      return 'Row Count';
    case 'COUNT NON-EMPTY': return `# ${colLabel}`;
    case 'COUNT DISTINCT':  return `Unique ${colLabel}`;
    case 'MIN':             return `Min ${colLabel}`;
    case 'MAX':             return `Max ${colLabel}`;
    case 'FIRST':           return `${colLabel} (first)`;
    case 'LAST':            return `${colLabel} (last)`;
    case 'DATE RANGE':      return `${colLabel} Range`;
    case 'DATE SPAN':       return `${colLabel} Span (days)`;
    case 'NUMERIC RANGE':   return `${colLabel} Range`;
    case 'NUMERIC SPAN':    return `${colLabel} Span`;
    case 'LIST':            return `${colLabel} (list)`;
    default:                return `${fn}(${colLabel})`;
  }
}
