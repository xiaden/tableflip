import { db } from '../../core/state.js';
import { h, colDisplayLabel } from '../../core/utils.js';
import { buildColSourceMap, projectedCols, PhysicalColEntry } from '../../catalog/column-catalog.js';
import { execQuery, quoteId } from '../../core/sqldb.js';
import { getValidation, invalidateValidation } from '../../report/validation.js';

const FILTER_OPS: string[] = [
  'contains', 'equals', 'not equals',
  '>', '<', '>=', '<=',
  'starts with', 'ends with',
  'is empty', 'not empty',
];
const NO_VAL_OPS: Set<string> = new Set(['is empty', 'not empty']);

function _populateFilterDatalist(i: number, alias: string): void {
  const dl = document.getElementById('fdl_' + i);
  if (!dl || !alias) { if (dl) dl.innerHTML = ''; return; }
  const src = buildColSourceMap().get(alias);
  if (!src || src.kind === 'calc') return;
  try {
    const rows = execQuery(
      `SELECT DISTINCT ${quoteId(src.col)} FROM ${quoteId(src.tid)}
       WHERE ${quoteId(src.col)} IS NOT NULL
       ORDER BY ${quoteId(src.col)} LIMIT 100`
    );
    dl.innerHTML = rows.map(r => {
      const v = String(Object.values(r)[0]).trim();
      return v ? `<option value="${h(v)}">` : '';
    }).join('');
  } catch (_: unknown) {}
}

export function addFilter(): void {
  db.filters.push({ col: '', op: 'contains', val: '', vals: [''], enabled: true });
  renderFilters();
}
if (typeof window !== 'undefined') window.addFilter = addFilter;

function removeFilter(i: number): void {
  db.filters.splice(i, 1);
  renderFilters();
}

export function renderFilters(): void {
  const colMap = buildColSourceMap();
  const cols   = projectedCols();
  const wrap   = document.getElementById('filterItems')!;

  if (!db.filters.length) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No filters \u2014 all rows returned</span>';
    return;
  }

  wrap.innerHTML = db.filters.map((f, i) => {
    const noVal = NO_VAL_OPS.has(f.op);
    const vals = Array.isArray(f.vals) ? f.vals : [''];
    const fEnabled = f.enabled !== false;
    const fV = getValidation()!.items[`filter_${i}`];
    const fBlocked = fV && fV.blocking;
    const fUnresolved = fV && !fV.resolved;
    const fIssueMsg = fUnresolved && fV.issues[0] ? fV.issues[0].message : null;
    const orValInputs = vals.map((v, j) => `
      ${j > 0 ? '<span style="font-size:0.7rem;color:var(--muted);padding:0 1px;flex-shrink:0">OR</span>' : ''}
      <input type="text" list="fdl_${i}" placeholder="value" value="${h(v)}"
             data-fi="${i}" data-vi="${j}" data-fp="val" style="width:120px">
      ${j > 0 ? `<button class="btn btn-danger" style="padding:2px 5px;font-size:0.75rem;flex-shrink:0" data-rmval="${j}" data-fi="${i}" title="Remove this OR value">\u2715</button>` : ''}
    `).join('');
    return `
    <div class="filter-row${fBlocked ? ' pl-lookup-stage--invalid' : fUnresolved && !fEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!fEnabled ? 'pl-stage-disabled' : ''}">
      ${fIssueMsg ? `<div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">${fBlocked ? '\u26D4' : '\u26A0'} ${h(fIssueMsg)}</div>` : ''}
      <label class="pl-enable-toggle" style="margin-left:auto;order:99" title="${fEnabled ? 'Disable filter' : 'Enable filter'}"><input type="checkbox" data-fi="${i}" data-fp="enabled" ${fEnabled ? 'checked' : ''}><span class="pl-enable-label">${fEnabled ? '' : 'Off'}</span></label>
      <select data-fi="${i}" data-fp="col">
        <option value="">Column\u2026</option>
        ${cols.map(c => `<option value="${h(c)}" ${f.col === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`).join('')}
      </select>
      <select class="fop" data-fi="${i}" data-fp="op">
        ${FILTER_OPS.map(op => `<option value="${op}" ${f.op === op ? 'selected' : ''}>${op}</option>`).join('')}
      </select>
      <span class="filter-or-wrap" style="display:${noVal ? 'none' : 'flex'};gap:4px;align-items:center;flex-wrap:wrap">
        ${orValInputs}
        <button class="btn btn-ghost" style="padding:2px 7px;font-size:0.76rem;flex-shrink:0" data-addorval="${i}" title="Add OR value">\uFF0B</button>
        <datalist id="fdl_${i}"></datalist>
      </span>
      <button class="btn btn-danger" data-rmf="${i}">\u2715</button>
    </div>`;
  }).join('');

  db.filters.forEach((f, i) => { if (f.col) _populateFilterDatalist(i, f.col); });
}

if (typeof document !== 'undefined') {
  document.getElementById('filterItems')!.addEventListener('change', (e: Event) => {
    const el = e.target as HTMLInputElement;
    const { fi, fp } = el.dataset;
    if (fi === undefined || !fp) return;
    const f = db.filters[+fi];
    if (!f) return;
    if (fp === 'enabled') {
      f.enabled = el.checked;
      invalidateValidation();
      renderFilters();
      return;
    }
    const i = +fi;
    if (fp === 'col') {
      f.col = el.value;
      f.vals = [''];
      renderFilters();
      if (f.col) _populateFilterDatalist(i, f.col);
    } else if (fp === 'op') {
      f.op = el.value;
      const orWrap = el.closest('.filter-row')!.querySelector('.filter-or-wrap') as HTMLElement | null;
      if (orWrap) orWrap.style.display = NO_VAL_OPS.has(el.value) ? 'none' : 'flex';
    }
  });
  document.getElementById('filterItems')!.addEventListener('input', (e: Event) => {
    const el = e.target as HTMLInputElement;
    const { fi, vi, fp } = el.dataset;
    if (fi !== undefined && fp === 'val' && vi !== undefined) {
      const f = db.filters[+fi];
      if (f) {
        if (!Array.isArray(f.vals)) f.vals = [''];
        f.vals[+vi] = el.value;
      }
    }
  });
  document.getElementById('filterItems')!.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const rmf = target.closest('[data-rmf]') as HTMLElement | null;
    if (rmf) { removeFilter(+rmf.dataset.rmf!); return; }

    const addOrBtn = target.closest('[data-addorval]') as HTMLElement | null;
    if (addOrBtn) {
      const i = +addOrBtn.dataset.addorval!;
      const f = db.filters[i];
      if (!f) return;
      if (!Array.isArray(f.vals)) f.vals = [''];
      f.vals.push('');
      renderFilters();
      if (f.col) _populateFilterDatalist(i, f.col);
      return;
    }

    const rmVal = target.closest('[data-rmval]') as HTMLElement | null;
    if (rmVal) {
      const i = +rmVal.dataset.fi!;
      const j = +rmVal.dataset.rmval!;
      const f = db.filters[i];
      if (!f) return;
      if (!Array.isArray(f.vals)) f.vals = [''];
      if (f.vals.length <= 1) return;
      f.vals.splice(j, 1);
      renderFilters();
      if (f.col) _populateFilterDatalist(i, f.col);
      return;
    }
  });
}

export function renderSorts(): void {
  const cols   = projectedCols();
  const colMap = buildColSourceMap();
  const wrap   = document.getElementById('sortItems');
  if (!wrap) return;
  if (!db.sorts.length) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No sort \u2014 rows returned in natural order</span>';
    return;
  }
  wrap.innerHTML = db.sorts.map((s, i) => {
    const sEnabled = s.enabled !== false;
    const sV = getValidation()!.items[`sort_${i}`];
    const sBlocked = sV && sV.blocking;
    const sUnresolved = sV && !sV.resolved;
    const sIssueMsg = sUnresolved && sV.issues[0] ? sV.issues[0].message : null;
    return `
    <div class="sort-row${sBlocked ? ' pl-lookup-stage--invalid' : sUnresolved && !sEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!sEnabled ? 'pl-stage-disabled' : ''}">
      ${sIssueMsg ? `<div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">${sBlocked ? '\u26D4' : '\u26A0'} ${h(sIssueMsg)}</div>` : ''}
      <span class="sort-level">${i + 1}.</span>
      <select data-si="${i}" data-sp="col" style="flex:1;min-width:0">
        <option value="">\u2014 column \u2014</option>
        ${cols.map(c => `<option value="${h(c)}" ${s.col === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`).join('')}
      </select>
      <select data-si="${i}" data-sp="dir" style="width:95px;flex-shrink:0">
        <option value="ASC"  ${s.dir === 'ASC'  ? 'selected' : ''}>\u2191 A \u2192 Z</option>
        <option value="DESC" ${s.dir === 'DESC' ? 'selected' : ''}>\u2193 Z \u2192 A</option>
      </select>
      <label class="pl-enable-toggle" title="${sEnabled ? 'Disable sort' : 'Enable sort'}"><input type="checkbox" data-si="${i}" data-sp="enabled" ${sEnabled ? 'checked' : ''}><span class="pl-enable-label">${sEnabled ? '' : 'Off'}</span></label>
      <button class="btn btn-danger" data-rmsort="${i}">\u2715</button>
    </div>`;
  }).join('');
}

export function addSort(): void {
  db.sorts.push({ col: '', dir: 'ASC', enabled: true });
  renderSorts();
}
if (typeof window !== 'undefined') window.addSort = addSort;

function removeSort(i: number): void {
  db.sorts.splice(i, 1);
  renderSorts();
}

if (typeof document !== 'undefined') {
  document.getElementById('sortItems')!.addEventListener('change', (e: Event) => {
    const el = e.target as HTMLInputElement;
    const { si, sp } = el.dataset;
    if (si !== undefined && sp === 'enabled') {
      db.sorts[+si].enabled = el.checked;
      invalidateValidation();
      renderSorts();
      return;
    }
    if (si !== undefined && sp) (db.sorts[+si] as unknown as Record<string, string>)[sp] = el.value;
  });
  document.getElementById('sortItems')!.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-rmsort]') as HTMLElement | null;
    if (btn) removeSort(+btn.dataset.rmsort!);
  });
}
