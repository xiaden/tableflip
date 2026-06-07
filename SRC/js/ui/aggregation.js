import { db } from '../core/state.js';
import { h, colDisplayLabel, defaultAggAlias } from '../core/utils.js';
import { buildColSourceMap, projectedCols } from '../catalog/column-catalog.js';
import { renderColChips } from '../query/output-card.js';

const AGG_FNS = [
  'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
  'FIRST', 'LAST',
  'DATE RANGE', 'DATE SPAN',
  'NUMERIC RANGE', 'NUMERIC SPAN',
  'LIST',
];

const AGG_LABELS = {
  'SUM':             'Sum',
  'AVG':             'Average',
  'MIN':             'Min value',
  'MAX':             'Max value',
  'COUNT ROWS':      'Count rows',
  'COUNT NON-EMPTY': 'Count non-empty',
  'COUNT DISTINCT':  'Count distinct',
  'FIRST':           'First value',
  'LAST':            'Last value',
  'DATE RANGE':      'Date range  (earliest — latest)',
  'DATE SPAN':       'Date span  (days between)',
  'NUMERIC RANGE':   'Numeric range  (min – max)',
  'NUMERIC SPAN':    'Numeric span  (max − min)',
  'LIST':            'List  (all values joined)',
};

const AGG_NEEDS_COL = fn => fn !== 'COUNT ROWS';

const TOTAL_FNS = [
  'skip', 'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT', 'LIST',
];
const TOTAL_LABELS = {
  skip:              'Skip (leave blank)',
  SUM:               'Sum',
  AVG:               'Average',
  MIN:               'Min',
  MAX:               'Max',
  'COUNT ROWS':      'Count rows',
  'COUNT NON-EMPTY': 'Count non-empty',
  'COUNT DISTINCT':  'Count distinct',
  LIST:              'List (all values)',
};

const SUBTOTAL_FNS = [
  'skip',
  'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
  'FIRST', 'LAST',
  'DATE RANGE', 'DATE SPAN',
  'NUMERIC RANGE', 'NUMERIC SPAN',
  'LIST',
];
const SUBTOTAL_LABELS = {
  skip:              'Skip (leave blank)',
  SUM:               'Sum',
  AVG:               'Average',
  MIN:               'Min',
  MAX:               'Max',
  'COUNT ROWS':      'Count rows',
  'COUNT NON-EMPTY': 'Count non-empty',
  'COUNT DISTINCT':  'Count distinct',
  FIRST:             'First value',
  LAST:              'Last value',
  'DATE RANGE':      'Date range  (earliest — latest)',
  'DATE SPAN':       'Date span  (days between)',
  'NUMERIC RANGE':   'Numeric range  (min – max)',
  'NUMERIC SPAN':    'Numeric span  (max − min)',
  LIST:              'List (all values)',
};

const _AGG_MODES = ['none', 'group', 'totals', 'subtotals'];

function getAggregateLabel(fn) {
  return AGG_LABELS[fn] || fn;
}

function getTotalLabel(fn) {
  return TOTAL_LABELS[fn] || fn;
}

function getSubtotalLabel(fn) {
  return SUBTOTAL_LABELS[fn] || fn;
}

export function isValidAggregateFn(fn) {
  return AGG_FNS.includes(fn);
}

export function isValidTotalFn(fn) {
  return TOTAL_FNS.includes(fn);
}

export function isValidSubtotalFn(fn) {
  return SUBTOTAL_FNS.includes(fn);
}

export function aggregateNeedsColumn(fn) {
  return AGG_NEEDS_COL(fn);
}

function renderAggregateExpression(fn, colLabel) {
  const label = getAggregateLabel(fn);
  if (!aggregateNeedsColumn(fn)) return label;
  return `${label} of ${colLabel}`;
}

function _selColsToArray(selCols) {
  return selCols instanceof Set ? [...selCols] : null;
}

function _readAggModeState(mode) {
  if (mode === 'group') {
    return {
      selCols:    _selColsToArray(db.selCols),
      groupBy:    [...(db.groupBy || [])],
      aggregates: (db.aggregates || []).map(a => ({ ...a })),
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

function _defaultAggModeState(mode) {
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

export function ensureAggModeState() {
  if (!db.aggModeState || typeof db.aggModeState !== 'object') db.aggModeState = {};
  for (const mode of _AGG_MODES) {
    if (!db.aggModeState[mode] || typeof db.aggModeState[mode] !== 'object') {
      db.aggModeState[mode] = _defaultAggModeState(mode);
    }
  }
}
window.ensureAggModeState = ensureAggModeState;

export function saveActiveAggModeState() {
  ensureAggModeState();
  db.aggModeState[db.aggMode || 'none'] = _readAggModeState(db.aggMode || 'none');
}
window.saveActiveAggModeState = saveActiveAggModeState;

export function loadAggModeState(mode) {
  ensureAggModeState();
  const state = db.aggModeState[mode] || _defaultAggModeState(mode);

  db.groupBy    = [];
  db.aggregates = [];
  db.colTotals  = {};
  db.subtotalBy = [];
  db.subtotalFns = {};

  if (mode === 'group') {
    if ('selCols' in state) {
      db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols) : null;
    }
    db.groupBy = Array.isArray(state.groupBy) ? [...state.groupBy] : [];
    db.aggregates = Array.isArray(state.aggregates) ? state.aggregates.map(a => ({ ...a })) : [];
    return;
  }
  if (mode === 'totals') {
    if ('selCols' in state) {
      db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols) : null;
    }
    db.colTotals = state.colTotals && typeof state.colTotals === 'object' ? { ...state.colTotals } : {};
    return;
  }
  if (mode === 'subtotals') {
    if ('selCols' in state) {
      db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols) : null;
    }
    db.subtotalBy = Array.isArray(state.subtotalBy) ? [...state.subtotalBy] : [];
    db.subtotalFns = state.subtotalFns && typeof state.subtotalFns === 'object' ? { ...state.subtotalFns } : {};
    db.subtotalGrandTotal = state.subtotalGrandTotal !== false;
    db.subtotalSpacer = !!state.subtotalSpacer;
    db.subtotalOnTop = !!state.subtotalOnTop;
    db.subtotalStrategy = state.subtotalStrategy === 'nested' ? 'nested' : 'combined';
    return;
  }
  if ('selCols' in state) {
    db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols) : null;
  }
}

export function renderAggregation() {
  if (!db.base || !db.tables[db.base]) return;

  const projected  = projectedCols();
  const allCols    = db.colOrder
    ? db.colOrder.filter(c => projected.includes(c))
    : projected;
  const cols = (db.selCols instanceof Set) ? allCols.filter(c => db.selCols.has(c)) : allCols;
  const mode       = db.aggMode || 'none';
  const aggSection = document.getElementById('aggSection');
  const totSec     = document.getElementById('totalsSection');
  const subSec     = document.getElementById('subtotalsSection');
  const aggAddRow  = document.getElementById('aggAddRow');
  const hint       = document.getElementById('aggHint');

  document.querySelectorAll('input[name="aggMode"]').forEach(r => {
    r.checked = r.value === mode;
  });

  if (mode === 'group') {
    if (aggSection) aggSection.style.display = '';
    if (totSec)     totSec.style.display     = 'none';
    if (subSec)     subSec.style.display     = 'none';
    const hasGroups = db.groupBy.length > 0;
    if (aggAddRow)  aggAddRow.style.display  = hasGroups ? '' : 'none';
    renderAggregateItems(cols);
    if (hint) {
      if (hasGroups) {
        hint.style.display = '';
        hint.textContent   = 'ⓘ Results show one row per unique group. Columns marked ⚠ will be dropped — click ⚠ to add a calculation for them.';
      } else {
        hint.style.display = '';
        hint.textContent   = 'ⓘ Click columns above to choose what to group by. The remaining columns will get auto calculations.';
      }
    }
  } else if (mode === 'totals') {
    if (aggSection) aggSection.style.display = 'none';
    if (totSec)     totSec.style.display     = '';
    if (subSec)     subSec.style.display     = 'none';
    renderTotalsSection(cols);
    if (hint) {
      hint.style.display = '';
      hint.textContent   = 'ⓘ All rows are shown. The totals row shows only the columns you set a calculation for.';
    }
  } else if (mode === 'subtotals') {
    if (aggSection) aggSection.style.display = 'none';
    if (totSec)     totSec.style.display     = 'none';
    if (subSec)     subSec.style.display     = '';
    const chk = document.getElementById('chkGrandTotal');
    if (chk) chk.checked = db.subtotalGrandTotal !== false;
    const chkSpacer = document.getElementById('chkSubtotalSpacer');
    if (chkSpacer) chkSpacer.checked = !!db.subtotalSpacer;
    const chkOnTop = document.getElementById('chkSubtotalOnTop');
    if (chkOnTop) chkOnTop.checked = !!db.subtotalOnTop;
    const strat = db.subtotalStrategy || 'combined';
    document.querySelectorAll('input[name="subtotalStrategy"]').forEach(r => {
      r.checked = r.value === strat;
    });
    renderSubtotalsSection(cols);
    const hasGroups = (db.subtotalBy || []).length > 0;
    if (hint) {
      hint.style.display = '';
      const strategyName = db.subtotalStrategy === 'nested' ? 'nested' : 'combined';
      hint.textContent   = hasGroups
        ? `ⓘ All rows shown, grouped by the highlighted columns (${strategyName} grouping).`
        : 'ⓘ Click columns above to choose which ones to group rows by.';
    }
  } else {
    if (aggSection) aggSection.style.display = 'none';
    if (totSec)     totSec.style.display     = 'none';
    if (subSec)     subSec.style.display     = 'none';
    if (hint)       hint.style.display       = 'none';
  }

  renderColChips();
}
window.renderAggregation = renderAggregation;

export function setAggMode(mode) {
  if (!_AGG_MODES.includes(mode)) mode = 'none';
  const prev = db.aggMode || 'none';
  if (prev === mode) {
    renderAggregation();
    return;
  }
  saveActiveAggModeState();
  db.aggMode = mode;
  loadAggModeState(mode);
  renderAggregation();
}
window.setAggMode = setAggMode;

function renderTotalsSection(cols) {
  const wrap   = document.getElementById('totalsItems');
  const colMap = buildColSourceMap();
  if (!wrap) return;

  const visibleCols = cols.filter(c => !db.selCols || db.selCols.has(c));

  wrap.innerHTML = visibleCols.map(col => {
    const cur   = db.colTotals[col] || 'skip';
    const label = colDisplayLabel(col, colMap);
    return `
    <div class="totals-row">
      <span class="totals-col-name" title="${h(col)}">${h(label)}</span>
      <select class="totals-fn-sel" data-tcol="${h(col)}">
        ${TOTAL_FNS.map(f =>
          `<option value="${f}" ${cur === f ? 'selected' : ''}>${TOTAL_LABELS[f]}</option>`
        ).join('')}
      </select>
    </div>`;
  }).join('');
}

document.getElementById('totalsItems').addEventListener('change', e => {
  const sel = e.target.closest('[data-tcol]');
  if (!sel) return;
  const col = sel.dataset.tcol;
  if (sel.value === 'skip') delete db.colTotals[col];
  else db.colTotals[col] = sel.value;
});

export function renderSubtotalsSection(cols) {
  const wrap       = document.getElementById('subtotalsItems');
  const colMap     = buildColSourceMap();
  const subtotalBy = db.subtotalBy || [];
  if (!wrap) return;

  if (subtotalBy.length === 0) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">Click columns above to choose group keys — then configure subtotal rows here.</span>';
    return;
  }

  const visibleCols = cols
    .filter(c => (!db.selCols || db.selCols.has(c)) && !subtotalBy.includes(c));

  if (!visibleCols.length) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">All columns are group keys.</span>';
    return;
  }

  wrap.innerHTML = visibleCols.map(col => {
    const src = colMap.get(col);
    const isCalc = src?.kind === 'calc';
    const isAdvancedCalc = isCalc && (src.op === 'ROLLAVG' || src.op === 'PCTTOTAL');
    if (isCalc && !db.subtotalFns[col]) db.subtotalFns[col] = isAdvancedCalc ? 'skip' : 'SUM';
    const cur   = db.subtotalFns[col] || 'skip';
    const label = colDisplayLabel(col, colMap);
    const fnList = isAdvancedCalc ? ['skip'] : SUBTOTAL_FNS;
    return `
    <div class="totals-row">
      <span class="totals-col-name" title="${h(col)}">${h(label)}</span>
      <select class="totals-fn-sel" data-stcol="${h(col)}">
        ${fnList.map(f =>
          `<option value="${f}" ${cur === f ? 'selected' : ''}>${SUBTOTAL_LABELS[f]}</option>`
        ).join('')}
      </select>
    </div>`;
  }).join('');
}
window.renderSubtotalsSection = renderSubtotalsSection;

document.getElementById('subtotalsItems').addEventListener('change', e => {
  const sel = e.target.closest('[data-stcol]');
  if (!sel) return;
  const col = sel.dataset.stcol;
  if (sel.value === 'skip') delete db.subtotalFns[col];
  else db.subtotalFns[col] = sel.value;
});

export function setSubtotalGrandTotal(checked) {
  db.subtotalGrandTotal = !!checked;
}
window.setSubtotalGrandTotal = setSubtotalGrandTotal;

export function setSubtotalSpacer(checked) {
  db.subtotalSpacer = !!checked;
}
window.setSubtotalSpacer = setSubtotalSpacer;

export function setSubtotalOnTop(checked) {
  db.subtotalOnTop = !!checked;
}
window.setSubtotalOnTop = setSubtotalOnTop;

export function setSubtotalStrategy(value) {
  db.subtotalStrategy = value === 'nested' ? 'nested' : 'combined';
}
window.setSubtotalStrategy = setSubtotalStrategy;

export function renderAggregateItems(cols) {
  const wrap   = document.getElementById('aggItems');
  const colMap = buildColSourceMap();
  cols = (db.selCols instanceof Set) ? cols.filter(c => db.selCols.has(c)) : cols;

  if (!db.aggregates.length) {
    if (db.groupBy.length > 0) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No calculations — add one below or click ungrouped chips above</span>';
    } else {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">Click a column above to start grouping</span>';
    }
    return;
  }

  wrap.innerHTML = db.aggregates.map((agg, i) => {
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
           ${cols.map(c =>
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
        ${AGG_FNS.map(f => `<option value="${f}" ${agg.fn === f ? 'selected' : ''}>${AGG_LABELS[f]}</option>`).join('')}
      </select>
      ${colPicker}
      <button class="btn btn-danger" data-rmagg="${i}">✕</button>
    </div>`;
  }).join('');
}
window.renderAggregateItems = renderAggregateItems;

export function addAggregate() {
  const cols = projectedCols();
  const col  = cols.find(c => !db.groupBy.includes(c)) || cols[0] || '';
  db.aggregates.push({ fn: 'SUM', col, alias: '', auto: false });
  renderAggregateItems(cols);
}
window.addAggregate = addAggregate;

function removeAggregate(i) {
  db.aggregates.splice(i, 1);
  renderAggregation();
}

function touchAggregate(i) {
  if (db.aggregates[i]) db.aggregates[i].auto = false;
}

document.getElementById('aggItems').addEventListener('change', e => {
  const { ai, ap } = e.target.dataset;
  if (ai === undefined || !ap) return;
  db.aggregates[+ai][ap] = e.target.value;
  touchAggregate(+ai);
  if (ap === 'fn') renderAggregateItems(projectedCols());
});
document.getElementById('aggItems').addEventListener('input', e => {
  const { ai, ap } = e.target.dataset;
  if (ai !== undefined && ap === 'alias') {
    db.aggregates[+ai].alias = e.target.value;
    touchAggregate(+ai);
  }
});
document.getElementById('aggItems').addEventListener('click', e => {
  const btn = e.target.closest('[data-rmagg]');
  if (btn) removeAggregate(+btn.dataset.rmagg);
});
