'use strict';

// HTML-escape a value for use in attribute values and text content
function h(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripExt(fn) { return fn.replace(/\.[^.]+$/, ''); }

function dl(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function getToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  getToastContainer().appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Persistent toast — must be dismissed. Optional onAccept callback adds an "Accept" button.
function stickyToast(msg, type, onAccept, acceptLabel) {
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

function toggleSidebar() {
  const sb  = document.getElementById('sidebar');
  const btn = document.getElementById('sidebarToggle');
  const collapsed = sb.classList.toggle('collapsed');
  btn.innerHTML = collapsed ? '&#x276F;' : '&#x276E;';
}

// ── Color palette (Paul Tol, colorblind-safe, 16 colors) ─────────────────────
const TABLE_PALETTE = [
  '#4477AA','#EE6677','#228833','#CCBB44','#66CCEE','#AA3377',
  '#EE7733','#0077BB','#33BBEE','#EE3377','#CC3311','#009988',
  '#882255','#117733','#999933','#44AA99',
];

function getTableColor(tid) {
  if (db.tableColors[tid]) return db.tableColors[tid];
  const used = new Set(Object.values(db.tableColors));
  const idx  = TABLE_PALETTE.findIndex(c => !used.has(c));
  const col  = idx >= 0 ? TABLE_PALETTE[idx] : TABLE_PALETTE[Object.keys(db.tableColors).length % TABLE_PALETTE.length];
  db.tableColors[tid] = col;
  return col;
}

// Returns the CSS class name for a table's palette color (e.g. 'chip-c3')
function getTableColorClass(tid) {
  const color = getTableColor(tid);
  const idx   = TABLE_PALETTE.indexOf(color);
  return `chip-c${idx >= 0 ? idx : 0}`;
}

// Choose readable foreground text color for a given hex background.
// Returns dark text for light backgrounds and white text for dark backgrounds.
function chipFgColor(bg) {
  if (!bg || typeof bg !== 'string') return '#111';
  const m = bg.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#111';
  const hex = m[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Perceived luminance (sRGB approximation)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111' : '#fff';
}

// Truncated sheet name for display prefix (max 14 chars)
function tableShortName(tid) {
  const name = db.tables[tid]?.name || tid;
  return name.length > 14 ? name.slice(0, 12) + '\u2026' : name;
}

// User-visible label for a physical column in a specific table
function colUserLabel(tid, physCol) {
  return db.columnLabels?.[tid]?.[physCol] ?? physCol;
}

// Set (or clear) a column label; pass physCol as label to clear
function setColLabel(tid, physCol, label) {
  if (!db.columnLabels[tid]) db.columnLabels[tid] = {};
  if (!label || label === physCol) {
    delete db.columnLabels[tid][physCol];
    if (!Object.keys(db.columnLabels[tid]).length) delete db.columnLabels[tid];
  } else {
    db.columnLabels[tid][physCol] = label;
  }
}

// Full display label for an alias: "ShortName → UserLabel"
function colDisplayLabel(alias, map) {
  const src = (map || buildColSourceMap()).get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') return src.alias || alias;
  return tableShortName(src.tid) + ' \u2192 ' + colUserLabel(src.tid, src.col);
}

// Export label for a single alias: strip prefix, use user label only
function colExportLabel(alias, map) {
  const src = (map || buildColSourceMap()).get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') return src.alias || alias;
  return colUserLabel(src.tid, src.col);
}

// Build { alias → exportHeader } with dedup (space-2, space-3 …)
function buildExportHeaderMap(cols, map) {
  map = map || buildColSourceMap();
  const seen   = new Map();
  const result = {};
  for (const alias of cols) {
    const base = colExportLabel(alias, map);
    const n    = seen.get(base) || 0;
    seen.set(base, n + 1);
    result[alias] = n === 0 ? base : base + ' ' + (n + 1);
  }
  return result;
}

// ── Aggregate helpers (shared between aggregation.js and engine.js) ───────────

// Smart default aggregate type based on column name heuristics
function smartDefaultFn(colName) {
  const n = String(colName).toLowerCase();
  if (/\bdate\b|time\b|\bdt\b|shipped|arrival|delivery|due\b|created/.test(n)) return 'DATE RANGE';
  if (/amount|total|value|price|cost|\bqty\b|quantity|\bnum\b|number|units|sales|revenue|weight|volume/.test(n)) return 'SUM';
  return 'FIRST';
}

// Human-readable default alias for a given aggregate function + column label
function defaultAggAlias(fn, colLabel) {
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
