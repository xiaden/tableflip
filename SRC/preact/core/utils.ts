import type { AppState, ColSourceEntry } from '../types.js';
import { getStore } from './store.js';
import { buildColSourceMap } from '../catalog/column-catalog.js';
import { _renameProjectedAliasRefs } from '../query/alias-ref-updater.js';

export function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stripExt(fn: string): string { return fn.replace(/\.[^.]+$/, ''); }

export function dl(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function getToastContainer(): HTMLElement {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

export function toast(msg: string, type?: string): void {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  getToastContainer().appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

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
  btn.textContent = '\u2715';
  btn.className = 'toast-close';
  btn.onclick = () => el.remove();
  el.appendChild(btn);
  getToastContainer().appendChild(el);
}

export function toggleSidebar(): void {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sidebarToggle');
  if (!sb || !btn) return;
  const collapsed = sb.classList.toggle('collapsed');
  btn.innerHTML = collapsed ? '\u276F' : '\u276E';
}

const TABLE_PALETTE = [
  '#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377',
  '#EE7733', '#0077BB', '#33BBEE', '#EE3377', '#CC3311', '#009988',
  '#882255', '#117733', '#999933', '#44AA99',
];

export { TABLE_PALETTE };

export function getTableColor(tid: string): string {
  const state = getStore().getState();
  if (state.tableColors[tid]) return state.tableColors[tid];
  const used = new Set(Object.values(state.tableColors));
  const idx = TABLE_PALETTE.findIndex(c => !used.has(c));
  const col = idx >= 0 ? TABLE_PALETTE[idx] : TABLE_PALETTE[Object.keys(state.tableColors).length % TABLE_PALETTE.length];
  getStore().update({ tableColors: { ...state.tableColors, [tid]: col } });
  return col;
}

export function getTableColorClass(tid: string): string {
  const state = getStore().getState();
  const color = state.tableColors[tid] || getTableColor(tid);
  const idx = TABLE_PALETTE.indexOf(color);
  return `chip-c${idx >= 0 ? idx : 0}`;
}

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

export function tableShortName(tid: string): string {
  const state = getStore().getState();
  const name = state.tables[tid]?.name || tid;
  return name.length > 14 ? name.slice(0, 12) + '\u2026' : name;
}

export function colUserLabel(tid: string, physCol: string): string {
  const state = getStore().getState();
  return state.columnLabels?.[tid]?.[physCol] ?? physCol;
}

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
  getStore().update({ columnLabels });
}

export function renameProjectedColumn(alias: string): boolean {
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
    calc.alias = renamed;
    if (typeof _renameProjectedAliasRefs === 'function') _renameProjectedAliasRefs(current, renamed);
    return true;
  }

  const current = getStore().getState().columnLabels?.[src.tid]?.[src.col] || '';
  const next = window.prompt('Rename column (blank to reset):', current);
  if (next === null) return false;
  setColLabel(src.tid, src.col, next.trim());
  return true;
}

export function colDisplayLabel(alias: string, map?: Map<string, ColSourceEntry>): string {
  const src = (map || buildColSourceMap()).get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') {
    const calc = getStore().getState().calcStages?.[src.idx];
    return (calc?.alias || '').trim() || alias;
  }
  return tableShortName(src.tid) + ' \u2192 ' + colUserLabel(src.tid, src.col);
}

export function colExportLabel(alias: string, map?: Map<string, ColSourceEntry>): string {
  const src = (map || buildColSourceMap()).get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') {
    const calc = getStore().getState().calcStages?.[src.idx];
    return (calc?.alias || '').trim() || alias;
  }
  return colUserLabel(src.tid, src.col);
}

export function buildExportHeaderMap(cols: string[], map?: Map<string, ColSourceEntry>): Record<string, string> {
  map = map || buildColSourceMap();
  const seen = new Map<string, number>();
  const result: Record<string, string> = {};
  for (const alias of cols) {
    const base = colExportLabel(alias, map);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    result[alias] = n === 0 ? base : base + ' ' + (n + 1);
  }
  return result;
}

export function smartDefaultFn(colName: string): string {
  const n = String(colName).toLowerCase();
  if (/\bdate\b|time\b|\bdt\b|shipped|arrival|delivery|due\b|created/.test(n)) return 'DATE RANGE';
  if (/amount|total|value|price|cost|\bqty\b|quantity|\bnum\b|number|units|sales|revenue|weight|volume/.test(n)) return 'SUM';
  return 'FIRST';
}

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
