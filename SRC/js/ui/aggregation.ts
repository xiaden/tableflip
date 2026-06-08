import { db } from '../core/state.js';
import { h, colDisplayLabel, defaultAggAlias } from '../core/utils.js';
import { buildColSourceMap, projectedCols } from '../catalog/column-catalog.js';
import { renderColChips } from './views/output-card.js';
import {
  AGG_FNS, AGG_LABELS, AGG_NEEDS_COL,
  TOTAL_FNS, TOTAL_LABELS,
  SUBTOTAL_FNS, SUBTOTAL_LABELS,
  AGG_MODES,
  getAggregateLabel, getTotalLabel, getSubtotalLabel,
  isValidAggregateFn, isValidTotalFn, isValidSubtotalFn,
  aggregateNeedsColumn,
} from './components/aggregation-constants.js';

function renderAggregateExpression(fn: string, colLabel: string): string {
  const label = getAggregateLabel(fn);
  if (!aggregateNeedsColumn(fn)) return label;
  return `${label} of ${colLabel}`;
}

function _selColsToArray(selCols: unknown): string[] | null {
  if (selCols instanceof Set) return [...selCols];
  if (Array.isArray(selCols)) return [...selCols];
  return null;
}

function _readAggModeState(mode: string): Record<string, unknown> {
  if (mode === 'group') {
    return {
      selCols:    _selColsToArray(db.selCols),
      groupBy:    [...(db.groupBy || [])],
      aggregates: (db.aggregates || []).map((a: AggregateSpec) => ({ ...a })),
    };
  }
  if (mode === 'totals') {
    return {
      selCols:   _selColsToArray(db.selCols),
      colTotals: { ...(db.colTotals || {}) },
    };
  }
  if (mode === 'subtotals') {
    return {
      selCols:            _selColsToArray(db.selCols),
      subtotalBy:         [...(db.subtotalBy || [])],
      subtotalFns:        { ...(db.subtotalFns || {}) },
      subtotalGrandTotal: db.subtotalGrandTotal !== false,
      subtotalSpacer:     !!db.subtotalSpacer,
      subtotalOnTop:      !!db.subtotalOnTop,
      subtotalStrategy:   db.subtotalStrategy || 'combined',
    };
  }
  return {
    selCols: _selColsToArray(db.selCols),
  };
}

function _defaultAggModeState(mode: string): Record<string, unknown> {
  if (mode === 'group') {
    return { groupBy: [], aggregates: [] };
  }
  if (mode === 'totals') {
    return { colTotals: {} };
  }
  if (mode === 'subtotals') {
    return {
      subtotalBy:         [],
      subtotalFns:        {},
      subtotalGrandTotal: true,
      subtotalSpacer:     false,
      subtotalOnTop:      false,
      subtotalStrategy:   'combined',
    };
  }
  return {};
}

export function ensureAggModeState(): void {
  if (!db.aggModeState || typeof db.aggModeState !== 'object') db.aggModeState = {};
  for (const mode of AGG_MODES) {
    if (!db.aggModeState[mode] || typeof db.aggModeState[mode] !== 'object') {
      db.aggModeState[mode] = _defaultAggModeState(mode);
    }
  }
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).ensureAggModeState = ensureAggModeState;

export function saveActiveAggModeState(): void {
  ensureAggModeState();
  db.aggModeState![db.aggMode || 'none'] = _readAggModeState(db.aggMode || 'none');
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).saveActiveAggModeState = saveActiveAggModeState;

export function loadAggModeState(mode: string): void {
  ensureAggModeState();
  const state = (db.aggModeState![mode] || _defaultAggModeState(mode)) as Record<string, unknown>;

  db.groupBy    = [];
  db.aggregates = [];
  db.colTotals  = {};
  db.subtotalBy = [];
  db.subtotalFns = {};

  if (mode === 'group') {
    if ('selCols' in state) {
      db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols as string[]) : null;
    }
    db.groupBy = Array.isArray(state.groupBy) ? [...state.groupBy as string[]] : [];
    db.aggregates = Array.isArray(state.aggregates) ? (state.aggregates as AggregateSpec[]).map((a: AggregateSpec) => ({ ...a })) : [];
    return;
  }
  if (mode === 'totals') {
    if ('selCols' in state) {
      db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols as string[]) : null;
    }
    db.colTotals = state.colTotals && typeof state.colTotals === 'object' ? { ...state.colTotals as Record<string, string> } : {};
    return;
  }
  if (mode === 'subtotals') {
    if ('selCols' in state) {
      db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols as string[]) : null;
    }
    db.subtotalBy = Array.isArray(state.subtotalBy) ? [...state.subtotalBy as string[]] : [];
    db.subtotalFns = state.subtotalFns && typeof state.subtotalFns === 'object' ? { ...state.subtotalFns as Record<string, string> } : {};
    db.subtotalGrandTotal = state.subtotalGrandTotal !== false;
    db.subtotalSpacer = !!state.subtotalSpacer;
    db.subtotalOnTop = !!state.subtotalOnTop;
    db.subtotalStrategy = state.subtotalStrategy === 'nested' ? 'nested' : 'combined';
    return;
  }
  if ('selCols' in state) {
    db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols as string[]) : null;
  }
}

// Mode handler configuration
interface AggModeHandler {
  showSections: { agg: boolean; totals: boolean; subtotals: boolean; hint: boolean };
  render: (cols: string[]) => void;
  getHint: (cols: string[]) => string | null;
}

const AGG_MODE_HANDLERS: Record<AggMode, AggModeHandler> = {
  none: {
    showSections: { agg: false, totals: false, subtotals: false, hint: false },
    render: () => {},
    getHint: () => null,
  },
  group: {
    showSections: { agg: true, totals: false, subtotals: false, hint: true },
    render: (cols) => {
      const aggAddRow = document.getElementById('aggAddRow');
      const hasGroups = db.groupBy.length > 0;
      if (aggAddRow) aggAddRow.style.display = hasGroups ? '' : 'none';
      renderAggregateItems(cols);
    },
    getHint: () => 'ⓘ Results show one row per unique group. Columns marked ⚠ will be dropped — click ⚠ to add a calculation for them.',
  },
  totals: {
    showSections: { agg: false, totals: true, subtotals: false, hint: true },
    render: (cols) => renderTotalsSection(cols),
    getHint: () => 'ⓘ All rows are shown. The totals row shows only the columns you set a calculation for.',
  },
  subtotals: {
    showSections: { agg: false, totals: false, subtotals: true, hint: true },
    render: (cols) => {
      const chk = document.getElementById('chkGrandTotal') as HTMLInputElement | null;
      if (chk) chk.checked = db.subtotalGrandTotal !== false;
      const chkSpacer = document.getElementById('chkSubtotalSpacer') as HTMLInputElement | null;
      if (chkSpacer) chkSpacer.checked = !!db.subtotalSpacer;
      const chkOnTop = document.getElementById('chkSubtotalOnTop') as HTMLInputElement | null;
      if (chkOnTop) chkOnTop.checked = !!db.subtotalOnTop;
      const strat = db.subtotalStrategy || 'combined';
      document.querySelectorAll('input[name="subtotalStrategy"]').forEach((r: Element) => {
        (r as HTMLInputElement).checked = (r as HTMLInputElement).value === strat;
      });
      renderSubtotalsSection(cols);
    },
    getHint: () => {
      const hasGroups = (db.subtotalBy || []).length > 0;
      const strategyName = db.subtotalStrategy === 'nested' ? 'nested' : 'combined';
      return hasGroups
        ? `ⓘ All rows shown, grouped by the highlighted columns (${strategyName} grouping).`
        : 'ⓘ Click columns above to choose which ones to group rows by.';
    },
  },
};

export function renderAggregation(): void {
  if (!db.base || !db.tables[db.base]) return;

  const projected  = projectedCols();
  const allCols    = db.colOrder
    ? db.colOrder.filter((c: string) => projected.includes(c))
    : projected;
  const selSet = db.selCols;
  const cols = selSet ? allCols.filter((c: string) => selSet.has(c)) : allCols;
  const mode       = db.aggMode || 'none';
  const aggSection = document.getElementById('aggSection');
  const totSec     = document.getElementById('totalsSection');
  const subSec     = document.getElementById('subtotalsSection');
  const hint       = document.getElementById('aggHint');

  document.querySelectorAll('input[name="aggMode"]').forEach((r: Element) => {
    (r as HTMLInputElement).checked = (r as HTMLInputElement).value === mode;
  });

  // Exhaustive handler lookup
  const handler = AGG_MODE_HANDLERS[mode as AggMode];
  const { showSections } = handler;

  if (aggSection) aggSection.style.display = showSections.agg ? '' : 'none';
  if (totSec)     totSec.style.display     = showSections.totals ? '' : 'none';
  if (subSec)     subSec.style.display     = showSections.subtotals ? '' : 'none';

  handler.render(cols);

  if (hint) {
    const hintText = handler.getHint(cols);
    if (hintText) {
      hint.style.display = '';
      hint.textContent = hintText;
    } else {
      hint.style.display = 'none';
    }
  }

  renderColChips();
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).renderAggregation = renderAggregation;

export function setAggMode(mode: string): void {
  if (!AGG_MODES.includes(mode)) mode = 'none';
  const aggMode = mode as AggMode;
  const prev = db.aggMode || 'none';
  if (prev === aggMode) {
    renderAggregation();
    return;
  }
  saveActiveAggModeState();
  db.aggMode = aggMode;
  loadAggModeState(aggMode);
  renderAggregation();
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).setAggMode = setAggMode;

function renderTotalsSection(cols: string[]): void {
  const wrap   = document.getElementById('totalsItems')!;
  const colMap = buildColSourceMap();
  if (!wrap) return;

  const selSet2 = db.selCols;
  const visibleCols = cols.filter((c: string) => !selSet2 || selSet2.has(c));

  wrap.innerHTML = visibleCols.map((col: string) => {
    const cur   = db.colTotals[col] || 'skip';
    const label = colDisplayLabel(col, colMap);
    return `
    <div class="totals-row">
      <span class="totals-col-name" title="${h(col)}">${h(label)}</span>
      <select class="totals-fn-sel" data-tcol="${h(col)}">
        ${TOTAL_FNS.map((f: string) =>
          `<option value="${f}" ${cur === f ? 'selected' : ''}>${TOTAL_LABELS[f]}</option>`
        ).join('')}
      </select>
    </div>`;
  }).join('');
}

if (typeof document !== 'undefined') {
  document.getElementById('totalsItems')!.addEventListener('change', (e: Event) => {
    const sel = (e.target as HTMLElement).closest('[data-tcol]') as HTMLSelectElement | null;
    if (!sel) return;
    const col = sel.dataset.tcol!;
    if (sel.value === 'skip') delete db.colTotals[col];
    else db.colTotals[col] = sel.value;
  });
}

export function renderSubtotalsSection(cols: string[]): void {
  const wrap       = document.getElementById('subtotalsItems')!;
  const colMap     = buildColSourceMap();
  const subtotalBy = db.subtotalBy || [];
  if (!wrap) return;

  if (subtotalBy.length === 0) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">Click columns above to choose group keys — then configure subtotal rows here.</span>';
    return;
  }

  const selSet3 = db.selCols;
  const visibleCols = cols
    .filter((c: string) => (!selSet3 || selSet3.has(c)) && !subtotalBy.includes(c));

  if (!visibleCols.length) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">All columns are group keys.</span>';
    return;
  }

  wrap.innerHTML = visibleCols.map((col: string) => {
    const src = colMap.get(col);
    const isCalc = src?.kind === 'calc';
    const isAdvancedCalc = isCalc && (() => {
      const calcObj = (src as { calc?: Record<string, unknown> }).calc;
      const op = calcObj?.mathOp;
      return op === 'ROLLAVG' || op === 'PCTTOTAL';
    })();
    if (isCalc && !db.subtotalFns[col]) db.subtotalFns[col] = isAdvancedCalc ? 'skip' : 'SUM';
    const cur   = db.subtotalFns[col] || 'skip';
    const label = colDisplayLabel(col, colMap);
    const fnList = isAdvancedCalc ? ['skip'] : SUBTOTAL_FNS;
    return `
    <div class="totals-row">
      <span class="totals-col-name" title="${h(col)}">${h(label)}</span>
      <select class="totals-fn-sel" data-stcol="${h(col)}">
        ${fnList.map((f: string) =>
          `<option value="${f}" ${cur === f ? 'selected' : ''}>${SUBTOTAL_LABELS[f]}</option>`
        ).join('')}
      </select>
    </div>`;
  }).join('');
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).renderSubtotalsSection = renderSubtotalsSection;

if (typeof document !== 'undefined') {
  document.getElementById('subtotalsItems')!.addEventListener('change', (e: Event) => {
    const sel = (e.target as HTMLElement).closest('[data-stcol]') as HTMLSelectElement | null;
    if (!sel) return;
    const col = sel.dataset.stcol!;
    if (sel.value === 'skip') delete db.subtotalFns[col];
    else db.subtotalFns[col] = sel.value;
  });
}

export function setSubtotalGrandTotal(checked: boolean): void {
  db.subtotalGrandTotal = !!checked;
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).setSubtotalGrandTotal = setSubtotalGrandTotal;

export function setSubtotalSpacer(checked: boolean): void {
  db.subtotalSpacer = !!checked;
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).setSubtotalSpacer = setSubtotalSpacer;

export function setSubtotalOnTop(checked: boolean): void {
  db.subtotalOnTop = !!checked;
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).setSubtotalOnTop = setSubtotalOnTop;

export function setSubtotalStrategy(value: string): void {
  db.subtotalStrategy = value === 'nested' ? 'nested' : 'combined';
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).setSubtotalStrategy = setSubtotalStrategy;

export function renderAggregateItems(cols: string[]): void {
  const wrap   = document.getElementById('aggItems')!;
  const colMap = buildColSourceMap();
  const selSet4 = db.selCols;
  cols = (selSet4 instanceof Set) ? cols.filter((c: string) => selSet4!.has(c)) : cols;

  if (!db.aggregates.length) {
    if (db.groupBy.length > 0) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No calculations — add one below or click ungrouped chips above</span>';
    } else {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">Click a column above to start grouping</span>';
    }
    return;
  }

  wrap.innerHTML = db.aggregates.map((agg: AggregateSpec & { auto?: boolean }, i: number) => {
    const needsCol = AGG_NEEDS_COL(agg.fn);
    const colLabel = needsCol
      ? (agg.col ? colDisplayLabel(agg.col, colMap) : '')
      : 'all rows';
    const ph = h(defaultAggAlias(agg.fn, colLabel));
    const autoMark = agg.auto
      ? `<span class="agg-auto-badge" title="Auto-added — edit or delete to customize.">auto</span>`
      : '';

    const colPicker = needsCol
      ? `<span class="agg-eq">of</span>
         <select data-ai="${i}" data-ap="col">
           ${cols.map((c: string) =>
             `<option value="${h(c)}" ${agg.col === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`
           ).join('')}
         </select>`
      : '';

    return `
    <div class="agg-row${agg.auto ? ' agg-row-auto' : ''}">
      ${autoMark}
      <input type="text" class="agg-alias" placeholder="${ph}" value="${h(agg.alias)}"
             data-ai="${i}" data-ap="alias">
      <span class="agg-eq">=</span>
      <select data-ai="${i}" data-ap="fn">
        ${AGG_FNS.map((f: string) => `<option value="${f}" ${agg.fn === f ? 'selected' : ''}>${AGG_LABELS[f]}</option>`).join('')}
      </select>
      ${colPicker}
      <button class="btn btn-danger" data-rmagg="${i}">✕</button>
    </div>`;
  }).join('');
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).renderAggregateItems = renderAggregateItems;

export function addAggregate(): void {
  const cols = projectedCols();
  const col  = cols.find((c: string) => !db.groupBy.includes(c)) || cols[0] || '';
  (db.aggregates as Array<AggregateSpec & { auto: boolean }>).push({ fn: 'SUM', col, alias: '', auto: false });
  renderAggregateItems(cols);
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).addAggregate = addAggregate;

function removeAggregate(i: number): void {
  db.aggregates.splice(i, 1);
  renderAggregation();
}

function touchAggregate(i: number): void {
  if (db.aggregates[i]) (db.aggregates[i] as AggregateSpec & { auto?: boolean }).auto = false;
}

if (typeof document !== 'undefined') {
  document.getElementById('aggItems')!.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLElement;
    const { ai, ap } = target.dataset;
    if (ai === undefined || !ap) return;
    (db.aggregates[+ai] as unknown as Record<string, unknown>)[ap] = (target as HTMLInputElement | HTMLSelectElement).value;
    touchAggregate(+ai);
    if (ap === 'fn') renderAggregateItems(projectedCols());
  });
  document.getElementById('aggItems')!.addEventListener('input', (e: Event) => {
    const target = e.target as HTMLElement;
    const { ai, ap } = target.dataset;
    if (ai !== undefined && ap === 'alias') {
      (db.aggregates[+ai] as unknown as Record<string, unknown>).alias = (target as HTMLInputElement).value;
      touchAggregate(+ai);
    }
  });
  document.getElementById('aggItems')!.addEventListener('click', (e: Event) => {
    const btn = (e.target as HTMLElement).closest('[data-rmagg]') as HTMLElement | null;
    if (btn) removeAggregate(+btn.dataset.rmagg!);
  });
}
