import { db } from './state.js';
import { STATE_VERSION, RECOGNIZABLE_KEYS } from './state-schema.js';
import { colUserLabel } from './utils.js';
import { buildSourceCatalog } from '../catalog/source-catalog.js';
import { applyState } from './state-applier.js';
import { projectedColsUpToLookup } from '../catalog/column-catalog.js';

// ── State Hydrator ───────────────────────────────────────────────────────────
// Takes a raw JSON payload from a saved .rcjson file and produces a hydrated
// `next` state object plus a list of broken references (missing tables/columns).

export function hydrateState(payload) {
  const next = {};
  const brokenRefs = [];

  const nextAvailableCols = () => {
    const cols   = projectedColsUpToLookup((next.lookups || []).length, next);
    const colSet = new Set(cols);
    for (const c of (next.calcStages || [])) {
      if (c.alias) colSet.add(c.alias);
    }
    return colSet;
  };

  const savedBase = payload.base || '';
  next.base = savedBase;
  const baseLoaded = !!(savedBase && db.tables[savedBase]);
  if (!baseLoaded) {
    brokenRefs.push(`Primary sheet "${savedBase || '(none)'}" is not loaded`);
  }

  if (Array.isArray(payload.baseCols)) {
    const dropped = baseLoaded ? payload.baseCols.filter(c => !db.tables[savedBase].cols.includes(c)) : [];
    if (dropped.length) brokenRefs.push(`Base columns not available: ${dropped.join(', ')}`);
    next.baseCols = [...payload.baseCols];
  } else {
    next.baseCols = null;
  }

  next.stacks = [];
  for (const id of (payload.stacks || [])) {
    if (!db.tables[id]) {
      brokenRefs.push(`Stacked sheet "${id}" is not loaded`);
      next.stacks.push(id);
      continue;
    }
    if (!next.stacks.includes(id)) next.stacks.push(id);
  }

  next.lookups = [];
  for (const lk of (payload.lookups || [])) {
    const rt = lk.rightId && db.tables[lk.rightId];
    if (!lk.rightId || !rt) {
      brokenRefs.push(`Lookup sheet "${lk.rightId || '(none)'}" is not loaded`);
      next.lookups.push({
        rightId:  lk.rightId || '',
        keyPairs: Array.isArray(lk.keyPairs) ? lk.keyPairs.map(p => ({ left: p.left || '', right: p.right || '' })) : [{ left: '', right: '' }],
        cols:     Array.isArray(lk.cols) ? [...lk.cols] : [],
        required: !!lk.required,
        enabled:  lk.enabled !== false,
        duplicatePolicy: lk.duplicatePolicy && lk.duplicatePolicy.mode ? { ...lk.duplicatePolicy } : { mode: 'block' },
      });
      continue;
    }
    const leftAvail = baseLoaded ? projectedColsUpToLookup(next.lookups.length, next) : [];
    const keyPairs = (Array.isArray(lk.keyPairs) ? lk.keyPairs : []).map(p => {
      const leftOk  = !baseLoaded || leftAvail.includes(p.left);
      const rightOk = rt.cols.includes(p.right);
      if (!leftOk && p.left) brokenRefs.push(`Match column "${p.left}" not found (left side of lookup from "${rt.name}")`);
      if (!rightOk && p.right) brokenRefs.push(`Match column "${p.right}" not found in "${rt.name}"`);
      return { left: p.left || '', right: p.right || '' };
    });
    const cols = Array.isArray(lk.cols) ? lk.cols : [...rt.cols];
    next.lookups.push({ rightId: lk.rightId, keyPairs, cols, required: !!lk.required, enabled: lk.enabled !== false, duplicatePolicy: lk.duplicatePolicy && lk.duplicatePolicy.mode ? { ...lk.duplicatePolicy } : { mode: 'block' } });
  }

  const VALID_CALC_OPS = new Set(['+', '-', '*', '/', 'ROLLAVG', 'PCTTOTAL', 'COMPARE']);
  const VALID_CALC_MODES = new Set(['math', 'compare', 'text']);

  function _collectTypedColRefs(val) {
    if (val && typeof val === 'object' && val.type === 'column') return [val.value];
    return [];
  }
  function _collectTypedArrayColRefs(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const item of arr) {
      if (item && typeof item.type === 'string') out.push(..._collectTypedColRefs(item));
    }
    return out;
  }
  function _checkColRef(colName, baseLoaded, availNow, alias, brokenRefs) {
    if (colName && baseLoaded && availNow.size && !availNow.has(colName)) {
      brokenRefs.push(`Calculated column "${alias}" references unavailable column "${colName}"`);
    }
  }

  next.calcStages = [];
  for (const c of (payload.calcStages || [])) {
    const alias = (c.alias || '').trim();
    const enabled = c.enabled !== false;

    // ── New mode-based format ──────────────────────────────────────────────
    if (c.mode && VALID_CALC_MODES.has(c.mode)) {
      if (!alias) {
        brokenRefs.push('Calculated stage has no alias');
        next.calcStages.push({ ...c, alias, enabled });
        continue;
      }
      const availNow = nextAvailableCols();

      if (c.mode === 'math') {
        const math = c.math;
        if (math && Array.isArray(math.steps)) {
          for (const step of math.steps) {
            _checkColRef(step.type === 'column' ? step.value : null, baseLoaded, availNow, alias, brokenRefs);
          }
        }
      }

      if (c.mode === 'compare') {
        const compare = c.compare;
        if (compare && Array.isArray(compare.conditions)) {
          for (const cond of compare.conditions) {
            _checkColRef(cond.col, baseLoaded, availNow, alias, brokenRefs);
          }
        }
        if (compare && compare.trueValue) {
          _checkColRef(compare.trueValue.type === 'column' ? compare.trueValue.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
        if (compare && compare.falseValue) {
          _checkColRef(compare.falseValue.type === 'column' ? compare.falseValue.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
      }

      if (c.mode === 'text') {
        const text = c.text;
        if (text) {
          if (text.operation === 'combine' && Array.isArray(text.parts)) {
            for (const part of text.parts) {
              _checkColRef(part.type === 'column' ? part.value : null, baseLoaded, availNow, alias, brokenRefs);
            }
          }
          if (text.source) {
            _checkColRef(text.source.type === 'column' ? text.source.value : null, baseLoaded, availNow, alias, brokenRefs);
          }
        }
      }

      next.calcStages.push({ ...c, alias, enabled });
      continue;
    }

    // ── Old op-based format ────────────────────────────────────────────────
    const left  = c.left || '';
    const right = c.right || '';
    const isArithmetic = ['+', '-', '*', '/'].includes(c.op);
    const op = VALID_CALC_OPS.has(c.op) ? c.op : null;

    if (!alias) {
      brokenRefs.push(`Calculated stage has no alias`);
      next.calcStages.push({ alias, left, op, right, conditions: [], compareMode: 'AND', customTF: false, trueVal: '', falseVal: '', window: 7, explicitOrder: false, orderCol: '', orderDir: 'ASC', enabled });
      continue;
    }
    if (!op) {
      brokenRefs.push(`Calculated column "${alias}" has an unsupported operator "${c.op}"`);
      next.calcStages.push({ alias, left, op: c.op, right, conditions: [], compareMode: 'AND', customTF: false, trueVal: '', falseVal: '', window: 7, explicitOrder: false, orderCol: '', orderDir: 'ASC', enabled });
      continue;
    }

    const availNow = nextAvailableCols();
    if (op !== 'COMPARE') {
      if (left && baseLoaded && !availNow.has(left)) brokenRefs.push(`Calculated column "${alias}" references unavailable column "${left}"`);
      if (isArithmetic && right && baseLoaded && !availNow.has(right)) brokenRefs.push(`Calculated column "${alias}" references unavailable column "${right}"`);
    }

    let conditions = [];
    if (op === 'COMPARE') {
      conditions = Array.isArray(c.conditions) ? c.conditions.map(cond => ({
        col: cond.col || '',
        op:  typeof cond.op === 'string' ? cond.op : '=',
        val: String(cond.val ?? ''),
      })) : [];
      for (const cond of conditions) {
        if (cond.col && availNow.size && !availNow.has(cond.col)) {
          brokenRefs.push(`Calculated column "${alias}" condition references unavailable column "${cond.col}"`);
        }
      }
    }
    if (op === 'ROLLAVG' && c.explicitOrder && c.orderCol && availNow.size && !availNow.has(c.orderCol)) {
      brokenRefs.push(`Calculated column "${alias}" explicit order column "${c.orderCol}" is unavailable`);
    }

    const window = Math.max(1, parseInt(c.window, 10) || 7);
    const explicitOrder = !!c.explicitOrder;
    const orderCol = c.orderCol || '';
    const orderDir = c.orderDir === 'DESC' ? 'DESC' : 'ASC';
    const compareMode = c.compareMode === 'OR' ? 'OR' : 'AND';
    const customTF = !!c.customTF;
    const trueVal = c.trueVal ?? '';
    const falseVal = c.falseVal ?? '';
    next.calcStages.push({ alias, left, op, right, conditions, compareMode, customTF, trueVal, falseVal, window, explicitOrder, orderCol, orderDir, enabled });
  }

  const available = nextAvailableCols();

  if (payload.selCols === null) {
    next.selCols = null;
  } else if (Array.isArray(payload.selCols)) {
    const dropped = baseLoaded ? payload.selCols.filter(c => !available.has(c)) : [];
    if (dropped.length) brokenRefs.push(`Selected columns not available: ${dropped.join(', ')}`);
    next.selCols = new Set(payload.selCols);
  } else {
    next.selCols = null;
  }
  next.colOrder = Array.isArray(payload.colOrder) ? [...payload.colOrder] : null;

  next.filters = [];
  for (const f of (payload.filters || [])) {
    if (f.col && baseLoaded && !available.has(f.col)) {
      brokenRefs.push(`Filter on column "${f.col}" is not available`);
    }
    const vals = Array.isArray(f.vals) ? [...f.vals] : f.vals;
    next.filters.push({ col: f.col || '', op: f.op || 'contains', vals, enabled: f.enabled !== false });
  }

  const gbDropped = baseLoaded ? (payload.groupBy || []).filter(c => !available.has(c)) : [];
  if (gbDropped.length) brokenRefs.push(`Group By columns not available: ${gbDropped.join(', ')}`);
  next.groupBy = [...(payload.groupBy || [])];

  next.aggregates = [];
  for (const a of (payload.aggregates || [])) {
    if (a.col && a.col !== '*' && baseLoaded && !available.has(a.col)) {
      brokenRefs.push(`Aggregate "${a.alias || a.fn}" on column "${a.col}" is not available`);
    }
    next.aggregates.push({ fn: a.fn || 'SUM', col: a.col || '*', alias: a.alias || '' });
  }

  next.sorts = [];
  for (const s of (payload.sorts || [])) {
    if (s.col && baseLoaded && !available.has(s.col)) {
      brokenRefs.push(`Sort on column "${s.col}" is not available`);
    }
    next.sorts.push({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC', enabled: s.enabled !== false });
  }

  next.aggMode = typeof payload.aggMode === 'string' ? payload.aggMode : 'none';

  next.colTotals = {};
  for (const [col, fn] of Object.entries(payload.colTotals || {})) {
    if (baseLoaded && !available.has(col)) brokenRefs.push(`Totals column "${col}" not available`);
    next.colTotals[col] = fn;
  }

  const sbDropped = baseLoaded ? (payload.subtotalBy || []).filter(c => !available.has(c)) : [];
  if (sbDropped.length) brokenRefs.push(`Subtotal By columns not available: ${sbDropped.join(', ')}`);
  next.subtotalBy = [...(payload.subtotalBy || [])];
  next.subtotalFns = {};
  for (const [col, fn] of Object.entries(payload.subtotalFns || {})) {
    if (baseLoaded && !available.has(col)) brokenRefs.push(`Subtotal function column "${col}" not available`);
    next.subtotalFns[col] = fn;
  }
  next.subtotalGrandTotal = payload.subtotalGrandTotal !== false;
  next.subtotalSpacer     = !!payload.subtotalSpacer;
  next.subtotalOnTop      = !!payload.subtotalOnTop;
  next.subtotalStrategy   = payload.subtotalStrategy === 'nested' ? 'nested' : 'combined';

  if (!payload.aggModeState || typeof payload.aggModeState !== 'object') {
    next.aggModeState = null;
  } else {
    const raw = payload.aggModeState;
    const rawNone      = raw.none      && typeof raw.none      === 'object' ? raw.none      : null;
    const rawGroup     = raw.group     && typeof raw.group     === 'object' ? raw.group     : null;
    const rawTotals    = raw.totals    && typeof raw.totals    === 'object' ? raw.totals    : null;
    const rawSubtotals = raw.subtotals && typeof raw.subtotals === 'object' ? raw.subtotals : null;
    next.aggModeState = {
      none: rawNone ? {
        selCols: Array.isArray(rawNone.selCols) ? [...rawNone.selCols] : null,
      } : null,
      group: rawGroup ? {
        groupBy:    Array.isArray(rawGroup.groupBy) ? [...rawGroup.groupBy] : [],
        aggregates: Array.isArray(rawGroup.aggregates)
          ? rawGroup.aggregates.map(a => ({ fn: a.fn || 'SUM', col: a.col || '*', alias: a.alias || '', auto: !!a.auto }))
          : [],
      } : null,
      totals: rawTotals ? {
        selCols:   Array.isArray(rawTotals.selCols) ? [...rawTotals.selCols] : null,
        colTotals: rawTotals.colTotals && typeof rawTotals.colTotals === 'object' ? { ...rawTotals.colTotals } : {},
      } : null,
      subtotals: rawSubtotals ? {
        selCols:          Array.isArray(rawSubtotals.selCols) ? [...rawSubtotals.selCols] : null,
        subtotalBy:       Array.isArray(rawSubtotals.subtotalBy) ? [...rawSubtotals.subtotalBy] : [],
        subtotalFns:      rawSubtotals.subtotalFns && typeof rawSubtotals.subtotalFns === 'object' ? { ...rawSubtotals.subtotalFns } : {},
        subtotalGrandTotal: rawSubtotals.subtotalGrandTotal !== false,
        subtotalSpacer:     !!rawSubtotals.subtotalSpacer,
        subtotalOnTop:      !!rawSubtotals.subtotalOnTop,
        subtotalStrategy:   rawSubtotals.subtotalStrategy === 'nested' ? 'nested' : 'combined',
      } : null,
    };
  }

  next.mergedCols = (payload.mergedCols || []).filter(c => typeof c === 'string');
  next.mergeGroupUnderline = !!payload.mergeGroupUnderline;
  next.colState   = Array.isArray(payload.colState) ? payload.colState : null;

  const nextExcludedRows = {};
  if (payload.excludedRows && typeof payload.excludedRows === 'object') {
    for (const [tid, arr] of Object.entries(payload.excludedRows)) {
      if (Array.isArray(arr) && arr.length) {
        nextExcludedRows[tid] = new Set(arr);
      }
    }
  }

  next.tableColors = {};
  for (const [tid, color] of Object.entries(payload.tableColors || {})) {
    if (typeof color === 'string' && color.startsWith('#')) {
      next.tableColors[tid] = color;
    }
  }

  next.columnLabels = {};
  for (const [tid, labels] of Object.entries(payload.columnLabels || {})) {
    if (!labels || typeof labels !== 'object') continue;
    const kept = {};
    for (const [col, label] of Object.entries(labels)) {
      if (label && label !== col) kept[col] = label;
    }
    if (Object.keys(kept).length) next.columnLabels[tid] = kept;
  }

  return { next, brokenRefs, nextExcludedRows };
}

export { applyState };
window.applyState = applyState;
