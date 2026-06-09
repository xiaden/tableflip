import { useState, useEffect } from 'preact/hooks';
import { render } from 'preact/compat';
import { db } from '../../core/state.js';
import { colDisplayLabel } from '../../core/utils.js';
import { buildColSourceMap, projectedCols } from '../../catalog/column-catalog.js';
import { execQuery, quoteId } from '../../core/sqldb.js';
import { getValidation, invalidateValidation } from '../../report/validation.js';

const FILTER_OPS: string[] = [
  'contains', 'equals', 'not equals',
  '>', '<', '>=', '<=',
  'starts with', 'ends with',
  'is empty', 'not empty',
];
const NO_VAL_OPS: Set<string> = new Set(['is empty', 'not empty']);

function useDistinctValues(alias: string): string[] {
  const [values, setValues] = useState<string[]>([]);
  useEffect(() => {
    if (!alias) { setValues([]); return; }
    const src = buildColSourceMap().get(alias);
    if (!src || src.kind === 'calc') { setValues([]); return; }
    try {
      const rows = execQuery(
        `SELECT DISTINCT ${quoteId(src.col)} FROM ${quoteId(src.tid)}
         WHERE ${quoteId(src.col)} IS NOT NULL
         ORDER BY ${quoteId(src.col)} LIMIT 100`
      );
      setValues(rows.map(r => String(Object.values(r)[0]).trim()).filter(Boolean));
    } catch { setValues([]); }
  }, [alias]);
  return values;
}

function FilterRow({ f, i, cols, colMap }: { f: FilterSpec; i: number; cols: string[]; colMap: Map<string, import('../../catalog/column-catalog.js').ColMapEntry> }) {
  const noVal = NO_VAL_OPS.has(f.op);
  const vals = Array.isArray(f.vals) ? f.vals : [''];
  const fEnabled = f.enabled !== false;
  const fV = getValidation()!.items[`filter_${i}`];
  const fBlocked = fV && fV.blocking;
  const fUnresolved = fV && !fV.resolved;
  const fIssueMsg = fUnresolved && fV.issues[0] ? fV.issues[0].message : null;

  const distinct = useDistinctValues(f.col);
  const datalistId = 'fdl_' + i;

  const update = (prop: string, value: unknown) => {
    (f as unknown as Record<string, unknown>)[prop] = value;
    invalidateValidation();
    renderFilters();
  };

  return (
    <div class={`filter-row${fBlocked ? ' pl-lookup-stage--invalid' : fUnresolved && !fEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!fEnabled ? 'pl-stage-disabled' : ''}`}>
      {fIssueMsg && (
        <div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">
          {fBlocked ? '\u26D4' : '\u26A0'} {fIssueMsg}
        </div>
      )}
      <label class="pl-enable-toggle" style="margin-left:auto;order:99" title={fEnabled ? 'Disable filter' : 'Enable filter'}>
        <input type="checkbox" checked={fEnabled} onChange={(e) => update('enabled', (e.target as HTMLInputElement).checked)} />
        <span class="pl-enable-label">{fEnabled ? '' : 'Off'}</span>
      </label>
      <select value={f.col} onChange={(e) => { f.col = (e.target as HTMLSelectElement).value; f.vals = ['']; renderFilters(); }}>
        <option value="">Column…</option>
        {cols.map(c => <option key={c} value={c}>{colDisplayLabel(c, colMap)}</option>)}
      </select>
      <select class="fop" value={f.op} onChange={(e) => update('op', (e.target as HTMLSelectElement).value)}>
        {FILTER_OPS.map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <span class="filter-or-wrap" style={{ display: noVal ? 'none' : 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
        {vals.map((v, j) => (
          <span key={j} style="display:contents">
            {j > 0 && <span style="font-size:0.7rem;color:var(--muted);padding:0 1px;flex-shrink:0">OR</span>}
            <input
              type="text"
              list={datalistId}
              placeholder="value"
              value={v}
              style="width:120px"
              onInput={(e) => {
                if (!Array.isArray(f.vals)) f.vals = [''];
                f.vals[j] = (e.target as HTMLInputElement).value;
              }}
            />
            {j > 0 && (
              <button class="btn btn-danger" style="padding:2px 5px;font-size:0.75rem;flex-shrink:0" title="Remove this OR value"
                onClick={() => { if (f.vals!.length > 1) { f.vals!.splice(j, 1); renderFilters(); } }}>
                ✕
              </button>
            )}
          </span>
        ))}
        <button class="btn btn-ghost" style="padding:2px 7px;font-size:0.76rem;flex-shrink:0" title="Add OR value"
          onClick={() => { if (!Array.isArray(f.vals)) f.vals = ['']; f.vals.push(''); renderFilters(); }}>
          ＋
        </button>
        <datalist id={datalistId}>
          {distinct.map(v => <option key={v} value={v} />)}
        </datalist>
      </span>
      <button class="btn btn-danger" onClick={() => { db.filters.splice(i, 1); renderFilters(); }}>✕</button>
    </div>
  );
}

export function Filters() {
  const colMap = buildColSourceMap();
  const cols = projectedCols();

  if (!db.filters.length) {
    return <span style="font-size:0.76rem;color:var(--muted)">No filters — all rows returned</span>;
  }

  return (
    <>
      {db.filters.map((f, i) => (
        <FilterRow key={i} f={f} i={i} cols={cols} colMap={colMap} />
      ))}
    </>
  );
}

export function addFilter(): void {
  db.filters.push({ col: '', op: 'contains', val: '', vals: [''], enabled: true });
  renderFilters();
}
if (typeof window !== 'undefined') window.addFilter = addFilter;

function SortRow({ s, i, cols, colMap }: { s: SortSpec; i: number; cols: string[]; colMap: Map<string, import('../../catalog/column-catalog.js').ColMapEntry> }) {
  const sEnabled = s.enabled !== false;
  const sV = getValidation()!.items[`sort_${i}`];
  const sBlocked = sV && sV.blocking;
  const sUnresolved = sV && !sV.resolved;
  const sIssueMsg = sUnresolved && sV.issues[0] ? sV.issues[0].message : null;

  const update = (prop: string, value: unknown) => {
    (s as unknown as Record<string, unknown>)[prop] = value;
    invalidateValidation();
    renderSorts();
  };

  return (
    <div class={`sort-row${sBlocked ? ' pl-lookup-stage--invalid' : sUnresolved && !sEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!sEnabled ? 'pl-stage-disabled' : ''}`}>
      {sIssueMsg && (
        <div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">
          {sBlocked ? '\u26D4' : '\u26A0'} {sIssueMsg}
        </div>
      )}
      <span class="sort-level">{i + 1}.</span>
      <select value={s.col} style="flex:1;min-width:0" onChange={(e) => update('col', (e.target as HTMLSelectElement).value)}>
        <option value="">— column —</option>
        {cols.map(c => <option key={c} value={c}>{colDisplayLabel(c, colMap)}</option>)}
      </select>
      <select value={s.dir} style="width:95px;flex-shrink:0" onChange={(e) => update('dir', (e.target as HTMLSelectElement).value)}>
        <option value="ASC">↑ A → Z</option>
        <option value="DESC">↓ Z → A</option>
      </select>
      <label class="pl-enable-toggle" title={sEnabled ? 'Disable sort' : 'Enable sort'}>
        <input type="checkbox" checked={sEnabled} onChange={(e) => update('enabled', (e.target as HTMLInputElement).checked)} />
        <span class="pl-enable-label">{sEnabled ? '' : 'Off'}</span>
      </label>
      <button class="btn btn-danger" onClick={() => { db.sorts.splice(i, 1); renderSorts(); }}>✕</button>
    </div>
  );
}

export function Sorts() {
  const selCols = db.selCols;
  const colOrder = db.colOrder || projectedCols();
  const cols = colOrder.filter(c => !selCols || selCols.has(c));
  const colMap = buildColSourceMap();

  if (!db.sorts.length) {
    return <span style="font-size:0.76rem;color:var(--muted)">No sort — rows returned in natural order</span>;
  }

  return (
    <>
      {db.sorts.map((s, i) => (
        <SortRow key={i} s={s} i={i} cols={cols} colMap={colMap} />
      ))}
    </>
  );
}

export function addSort(): void {
  db.sorts.push({ col: '', dir: 'ASC', enabled: true });
  renderSorts();
}
if (typeof window !== 'undefined') window.addSort = addSort;

// Legacy render functions — use render() to mount Preact components
let _filtersRoot: HTMLElement | null = null;
let _sortsRoot: HTMLElement | null = null;

export function renderFilters(): void {
  const el = document.getElementById('filterItems');
  if (!el) return;
  if (!_filtersRoot) _filtersRoot = el;
  render(<Filters />, _filtersRoot);
}

export function renderSorts(): void {
  const el = document.getElementById('sortItems');
  if (!el) return;
  if (!_sortsRoot) _sortsRoot = el;
  render(<Sorts />, _sortsRoot);
}
