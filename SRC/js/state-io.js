'use strict';

const STATE_VERSION = 1;

// ── Save ──────────────────────────────────────────────────────────────────────
function saveState() {
  if (!db.base) { toast('Nothing to save — load a data file first.', 'err'); return; }
  if (typeof saveActiveAggModeState === 'function') saveActiveAggModeState();
  if (typeof ensureAggModeState === 'function') ensureAggModeState();

  const raw = window.prompt('Save query as:', 'my-query');
  if (raw === null) return;                         // user cancelled
  const name = (raw.trim() || 'my-query').replace(/\.rcjson$/i, '');

  // Serialize excludedRows: Set → Array (not JSON-serializable as-is).
  const excludedRowsSerial = {};
  for (const [tid, set] of Object.entries(db.excludedRows)) {
    if (set && set.size) excludedRowsSerial[tid] = [...set];
  }

  const payload = {
    v:            STATE_VERSION,
    base:         db.base,
    baseCols:     db.baseCols ? [...db.baseCols] : null,
    stacks:       [...(db.stacks || [])],
    lookups:      (db.lookups || []).map(l => ({
      rightId:  l.rightId,
      keyPairs: (l.keyPairs || []).map(p => ({ left: p.left, right: p.right })),
      cols:     [...(l.cols || [])],
      required: !!l.required,
    })),
    calcStages:   (db.calcStages || []).map(c => ({
      alias: (c.alias || '').trim(),
      left:  c.left || '',
      op:    c.op || '-',
      right: c.right || '',
      conditions: (c.conditions || []).map(cond => ({
        col: cond.col || '',
        op:  cond.op  || '=',
        val: cond.val ?? '',
      })),
      compareMode: c.compareMode === 'OR' ? 'OR' : 'AND',
      window: Math.max(1, parseInt(c.window, 10) || 7),
      explicitOrder: !!c.explicitOrder,
      orderCol: c.orderCol || '',
      orderDir: c.orderDir === 'DESC' ? 'DESC' : 'ASC',
    })),
    selCols:      db.selCols ? [...db.selCols] : null,
    colOrder:     db.colOrder ? [...db.colOrder] : null,
    filters:      db.filters.map(f => ({
      col:  f.col  || '',
      op:   f.op   || 'contains',
      vals: Array.isArray(f.vals) ? [...f.vals] : [''],
    })),
    sorts:        db.sorts.map(s => ({ ...s })),
    groupBy:      [...db.groupBy],
    aggregates:   db.aggregates.map(a => ({ ...a })),
    aggMode:            db.aggMode || 'none',
    aggModeState:       JSON.parse(JSON.stringify(db.aggModeState || {})),
    colTotals:          { ...(db.colTotals || {}) },
    subtotalBy:         [...(db.subtotalBy || [])],
    subtotalFns:        { ...(db.subtotalFns || {}) },
    subtotalGrandTotal: db.subtotalGrandTotal !== false,
    subtotalSpacer:     !!db.subtotalSpacer,
    subtotalOnTop:      !!db.subtotalOnTop,
    mergedCols:         [...(db.mergedCols || [])],
    mergeGroupUnderline: !!db.mergeGroupUnderline,
    colState:           db.colState || null,
    excludedRows: excludedRowsSerial,
    tableColors:  { ...(db.tableColors || {}) },
    columnLabels: JSON.parse(JSON.stringify(db.columnLabels || {})),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  dl(blob, name + '.rcjson');
}

// ── Load ──────────────────────────────────────────────────────────────────────
function loadState(file) {
  const reader = new FileReader();
  reader.onload = e => {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch {
      toast('Could not parse state file — is it a valid .rcjson file?', 'err');
      return;
    }

    if (!payload || typeof payload !== 'object') {
      toast('Invalid state file.', 'err');
      return;
    }

    // ── Schema version check ──────────────────────────────────────────────────
    if (payload.v !== STATE_VERSION) {
      toast(`Unsupported project file version (got ${JSON.stringify(payload.v)}, expected ${STATE_VERSION}). Load aborted.`, 'err');
      return;
    }

    // Build validated state into `next` without touching db.
    // db is only updated at the end once all validation passes.
    const next = {};

    // Local helper: projected cols available to lookup[upTo] from the next state being built.
    const nextProjectedUpToLookup = (upTo) => {
      const baseId = next.base;
      if (!baseId || !db.tables[baseId]) return [];
      const cols   = [...db.tables[baseId].cols];
      const colSet = new Set(cols);
      for (let i = 0; i < upTo; i++) {
        const lk = (next.lookups || [])[i];
        if (!lk || !lk.rightId || !db.tables[lk.rightId]) continue;
        const rt     = db.tables[lk.rightId];
        const prefix = tablePrefix(rt.name);
        rt.cols.forEach(c => {
          const alias = colSet.has(c) ? prefix + c : c;
          if (!colSet.has(alias)) { cols.push(alias); colSet.add(alias); }
        });
      }
      return cols;
    };

    // Local helper: full projected col set from next state (base + lookups + calcs so far).
    const nextAvailableCols = () => {
      const cols   = nextProjectedUpToLookup((next.lookups || []).length);
      const colSet = new Set(cols);
      for (const c of (next.calcStages || [])) {
        if (c.alias) colSet.add(c.alias);
      }
      return colSet;
    };

    // ── Base table ────────────────────────────────────────────────────────────
    const savedBase = payload.base || '';
    if (!savedBase || !db.tables[savedBase]) {
      toast(`Primary sheet "${savedBase}" is not loaded — load the original file first.`, 'err');
      return;
    }
    next.base = savedBase;

    // ── Base column selection ─────────────────────────────────────────────────
    if (Array.isArray(payload.baseCols)) {
      const valid = payload.baseCols.filter(c => db.tables[savedBase].cols.includes(c));
      next.baseCols = valid.length === db.tables[savedBase].cols.length ? null : (valid.length ? valid : null);
    } else {
      next.baseCols = null;
    }

    // ── Stacks ────────────────────────────────────────────────────────────────
    next.stacks = [];
    for (const id of (payload.stacks || [])) {
      if (!db.tables[id]) {
        toast(`Stacked sheet "${id}" is not loaded — load the original file first.`, 'err');
        return;
      }
      if (!next.stacks.includes(id)) next.stacks.push(id);
    }

    // ── Lookups ───────────────────────────────────────────────────────────────
    next.lookups = [];
    for (const lk of (payload.lookups || [])) {
      if (!lk.rightId || !db.tables[lk.rightId]) {
        toast(`Lookup sheet "${lk.rightId}" is not loaded — load the original file first.`, 'err');
        return;
      }
      const rt       = db.tables[lk.rightId];
      const leftAvail = nextProjectedUpToLookup(next.lookups.length);
      if (!Array.isArray(lk.keyPairs) || !lk.keyPairs.length) {
        toast(`Lookup from sheet "${rt.name}" has no key pairs. Load aborted.`, 'err');
        return;
      }
      const keyPairs = [];
      for (const p of lk.keyPairs) {
        if (!leftAvail.includes(p.left)) {
          toast(`Match column "${p.left}" not found — lookup from "${rt.name}". Load aborted.`, 'err');
          return;
        }
        if (!rt.cols.includes(p.right)) {
          toast(`Match column "${p.right}" not found in "${rt.name}". Load aborted.`, 'err');
          return;
        }
        keyPairs.push({ left: p.left, right: p.right });
      }
      const cols = Array.isArray(lk.cols) ? lk.cols.filter(c => rt.cols.includes(c)) : [...rt.cols];
      next.lookups.push({ rightId: lk.rightId, keyPairs, cols, required: !!lk.required });
    }

    // ── Calculated stages ─────────────────────────────────────────────────────
    const VALID_CALC_OPS = new Set(['+', '-', '*', '/', 'ROLLAVG', 'PCTTOTAL', 'COMPARE']);
    next.calcStages = [];
    for (const c of (payload.calcStages || [])) {
      const alias = (c.alias || '').trim();
      const left  = c.left || '';
      const right = c.right || '';
      const isArithmetic = ['+', '-', '*', '/'].includes(c.op);
      const op = VALID_CALC_OPS.has(c.op) ? c.op : null;

      if (!alias) {
        toast('A calculated column with no label was found. Load aborted.', 'err');
        return;
      }
      if (!op) {
        toast(`Calculated column "${alias}" has an unsupported operator "${c.op}". Load aborted.`, 'err');
        return;
      }

      const availNow = nextAvailableCols();
      if (op !== 'COMPARE' && (!availNow.has(left) || (isArithmetic && !availNow.has(right)))) {
        toast(`Calculated column "${alias}" references unavailable column(s). Load aborted.`, 'err');
        return;
      }
      let conditions = [];
      if (op === 'COMPARE') {
        conditions = Array.isArray(c.conditions) ? c.conditions.map(cond => ({
          col: cond.col || '',
          op:  ['=', '!=', '>', '>=', '<', '<='].includes(cond.op) ? cond.op : '=',
          val: String(cond.val ?? ''),
        })) : [];
        const validConds = conditions.filter(cond => cond.col && availNow.has(cond.col) && String(cond.val ?? '').trim());
        if (!validConds.length) {
          toast(`Calculated column "${alias}" has no valid comparison conditions. Load aborted.`, 'err');
          return;
        }
        conditions = validConds;
      }
      if (op === 'ROLLAVG' && c.explicitOrder && c.orderCol && !availNow.has(c.orderCol)) {
        toast(`Calculated column "${alias}" explicit order column is unavailable. Load aborted.`, 'err');
        return;
      }
      if (availNow.has(alias)) {
        toast(`Calculated column "${alias}" conflicts with an existing column. Load aborted.`, 'err');
        return;
      }

      const window = Math.max(1, parseInt(c.window, 10) || 7);
      const explicitOrder = !!c.explicitOrder;
      const orderCol = c.orderCol || '';
      const orderDir = c.orderDir === 'DESC' ? 'DESC' : 'ASC';
      const compareMode = c.compareMode === 'OR' ? 'OR' : 'AND';
      const customTF = !!c.customTF;
      const trueVal = c.trueVal ?? '';
      const falseVal = c.falseVal ?? '';
      next.calcStages.push({ alias, left, op, right, conditions, compareMode, customTF, trueVal, falseVal, window, explicitOrder, orderCol, orderDir });
    }

    // ── Available columns after stacks/lookups/calcs ──────────────────────────
    const available = nextAvailableCols();

    // ── Selected columns + column order ──────────────────────────────────────
    if (payload.selCols === null) {
      next.selCols = null;
    } else if (Array.isArray(payload.selCols)) {
      const kept    = payload.selCols.filter(c => available.has(c));
      const dropped = payload.selCols.filter(c => !available.has(c));
      if (dropped.length) {
        toast(`Selected columns not found: ${dropped.join(', ')}. Load aborted.`, 'err');
        return;
      }
      next.selCols = kept.length ? new Set(kept) : null;
    } else {
      next.selCols = null;
    }
    next.colOrder = Array.isArray(payload.colOrder)
      ? payload.colOrder.filter(c => available.has(c))
      : null;

    // ── Filters ───────────────────────────────────────────────────────────────
    next.filters = [];
    for (const f of (payload.filters || [])) {
      if (f.col && !available.has(f.col)) {
        toast(`Filter on column "${f.col}" is not available. Load aborted.`, 'err');
        return;
      }
      if (!Array.isArray(f.vals)) {
        toast(`Filter on column "${f.col || '(unknown)'}" has invalid values format (expected an array). Load aborted.`, 'err');
        return;
      }
      const vals = f.vals.filter(v => typeof v === 'string');
      next.filters.push({ col: f.col || '', op: f.op || 'contains', vals: vals.length ? vals : [''] });
    }

    // ── Group By ──────────────────────────────────────────────────────────────
    const gbDropped = (payload.groupBy || []).filter(c => !available.has(c));
    if (gbDropped.length) {
      toast(`Group By columns not found: ${gbDropped.join(', ')}. Load aborted.`, 'err');
      return;
    }
    next.groupBy = (payload.groupBy || []).filter(c => available.has(c));

    // ── Aggregates ────────────────────────────────────────────────────────────
    next.aggregates = [];
    for (const a of (payload.aggregates || [])) {
      if (a.col && a.col !== '*' && !available.has(a.col)) {
        toast(`Aggregate "${a.alias || a.fn}" on column "${a.col}" is not available. Load aborted.`, 'err');
        return;
      }
      next.aggregates.push({ fn: a.fn || 'SUM', col: a.col || '*', alias: a.alias || '' });
    }

    // ── Sorts ─────────────────────────────────────────────────────────────────
    next.sorts = [];
    for (const s of (payload.sorts || [])) {
      if (s.col && !available.has(s.col)) {
        toast(`Sort on column "${s.col}" is not available. Load aborted.`, 'err');
        return;
      }
      next.sorts.push({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC' });
    }

    // ── Agg mode ──────────────────────────────────────────────────────────────
    next.aggMode = ['group', 'totals', 'subtotals', 'none'].includes(payload.aggMode) ? payload.aggMode : 'none';

    // ── Col Totals ────────────────────────────────────────────────────────────
    next.colTotals = {};
    const VALID_TOTAL_FNS = new Set([
      'SUM', 'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
      'AVG', 'MIN', 'MAX', 'LIST',
    ]);
    for (const [col, fn] of Object.entries(payload.colTotals || {})) {
      if (available.has(col) && VALID_TOTAL_FNS.has(fn)) next.colTotals[col] = fn;
    }

    // ── Subtotals ─────────────────────────────────────────────────────────────
    const VALID_SUBTOTAL_FNS = new Set([
      'skip',
      'SUM', 'AVG', 'MIN', 'MAX',
      'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
      'FIRST', 'LAST',
      'DATE RANGE', 'DATE SPAN',
      'NUMERIC RANGE', 'NUMERIC SPAN',
      'LIST',
    ]);
    next.subtotalBy = (payload.subtotalBy || []).filter(c => available.has(c));
    next.subtotalFns = {};
    for (const [col, fn] of Object.entries(payload.subtotalFns || {})) {
      if (available.has(col) && VALID_SUBTOTAL_FNS.has(fn)) next.subtotalFns[col] = fn;
    }
    next.subtotalGrandTotal = payload.subtotalGrandTotal !== false;
    next.subtotalSpacer     = !!payload.subtotalSpacer;
    next.subtotalOnTop      = !!payload.subtotalOnTop;

    // ── Per-mode layout state ─────────────────────────────────────────────────
    const sanitizeSelCols = (sel) => {
      if (!Array.isArray(sel)) return null;
      return sel.filter(c => available.has(c));
    };
    const sanitizeAggregates = (list) => {
      if (!Array.isArray(list)) return [];
      return list
        .filter(a => a && typeof a === 'object' && (!a.col || a.col === '*' || available.has(a.col)))
        .map(a => ({ fn: a.fn || 'SUM', col: a.col || '*', alias: a.alias || '', auto: !!a.auto }));
    };
    const sanitizeColFns = (obj, validFns) => {
      const out = {};
      for (const [col, fn] of Object.entries(obj || {})) {
        if (available.has(col) && validFns.has(fn)) out[col] = fn;
      }
      return out;
    };
    const sanitizeModeState = payload.aggModeState && typeof payload.aggModeState === 'object'
      ? payload.aggModeState
      : {};
    const modeSubtotals = sanitizeModeState.subtotals && typeof sanitizeModeState.subtotals === 'object'
      ? sanitizeModeState.subtotals
      : null;
    const totalsSel = sanitizeSelCols(sanitizeModeState.totals?.selCols ?? payload.selCols);
    const noneSel = sanitizeSelCols(sanitizeModeState.none?.selCols ?? payload.selCols);
    const subtotalsSel = sanitizeSelCols(sanitizeModeState.subtotals?.selCols ?? payload.selCols);
    const groupByState = Array.isArray(sanitizeModeState.group?.groupBy)
      ? sanitizeModeState.group.groupBy.filter(c => available.has(c))
      : [...next.groupBy];
    const subtotalByState = Array.isArray(sanitizeModeState.subtotals?.subtotalBy)
      ? sanitizeModeState.subtotals.subtotalBy.filter(c => available.has(c))
      : [...next.subtotalBy];

    next.aggModeState = {
      none: {
        selCols: noneSel,
      },
      group: {
        groupBy: groupByState,
        aggregates: sanitizeAggregates(sanitizeModeState.group?.aggregates ?? next.aggregates),
      },
      totals: {
        selCols: totalsSel,
        colTotals: sanitizeColFns(sanitizeModeState.totals?.colTotals ?? next.colTotals, VALID_TOTAL_FNS),
      },
      subtotals: {
        selCols: subtotalsSel,
        subtotalBy: subtotalByState,
        subtotalFns: sanitizeColFns(modeSubtotals?.subtotalFns ?? next.subtotalFns, VALID_SUBTOTAL_FNS),
        subtotalGrandTotal: modeSubtotals && Object.prototype.hasOwnProperty.call(modeSubtotals, 'subtotalGrandTotal')
          ? modeSubtotals.subtotalGrandTotal !== false
          : next.subtotalGrandTotal !== false,
        subtotalSpacer: modeSubtotals && Object.prototype.hasOwnProperty.call(modeSubtotals, 'subtotalSpacer')
          ? !!modeSubtotals.subtotalSpacer
          : !!next.subtotalSpacer,
        subtotalOnTop: modeSubtotals && Object.prototype.hasOwnProperty.call(modeSubtotals, 'subtotalOnTop')
          ? !!modeSubtotals.subtotalOnTop
          : !!next.subtotalOnTop,
      },
    };

    // ── Merged cols ───────────────────────────────────────────────────────────
    next.mergedCols = (payload.mergedCols || []).filter(c => typeof c === 'string');
    next.mergeGroupUnderline = !!payload.mergeGroupUnderline;
    next.colState   = Array.isArray(payload.colState) ? payload.colState : null;

    // ── Excluded rows ─────────────────────────────────────────────────────────
    const nextExcludedRows = {};
    if (payload.excludedRows && typeof payload.excludedRows === 'object') {
      for (const [tid, arr] of Object.entries(payload.excludedRows)) {
        if (!db.tables[tid]) {
          toast(`Excluded rows for sheet "${tid}" is not loaded — load the original file first.`, 'err');
          return;
        }
        if (Array.isArray(arr) && arr.length) {
          nextExcludedRows[tid] = new Set(arr);
        }
      }
    }

    // ── Table colors ──────────────────────────────────────────────────────────
    next.tableColors = {};
    for (const [tid, color] of Object.entries(payload.tableColors || {})) {
      if (db.tables[tid] && typeof color === 'string' && color.startsWith('#')) {
        next.tableColors[tid] = color;
      }
    }

    // ── Column labels ─────────────────────────────────────────────────────────
    next.columnLabels = {};
    for (const [tid, labels] of Object.entries(payload.columnLabels || {})) {
      if (!db.tables[tid]) continue;
      const validCols = new Set(db.tables[tid].cols);
      const kept = {};
      for (const [col, label] of Object.entries(labels)) {
        if (validCols.has(col) && label && label !== col) kept[col] = label;
      }
      if (Object.keys(kept).length) next.columnLabels[tid] = kept;
    }

    // ── Apply validated state atomically ──────────────────────────────────────
    Object.assign(db, next);
    // Merge excluded rows into existing (do not wipe rows for unrelated sheets)
    for (const [tid, set] of Object.entries(nextExcludedRows)) {
      db.excludedRows[tid] = set;
    }

    // ── Re-render everything ──────────────────────────────────────────────────
    if (typeof loadAggModeState === 'function') loadAggModeState(db.aggMode || 'none');
    renderQueryBuilder();
    // Ensure merge-duplicate toggles are populated immediately after loading
    // a setup file, without requiring a report run first.
    if (db.base && typeof renderMergeToggles === 'function') {
      try { renderMergeToggles(projectedCols()); } catch (_) {}
    }
    toast('Report setup loaded.', 'ok');
  };

  reader.onerror = () => toast('Failed to read file.', 'err');
  reader.readAsText(file);
}


// ── Hidden file input for loading ────────────────────────────────────────────
(function () {
  const inp = document.createElement('input');
  inp.type   = 'file';
  inp.accept = '.rcjson';
  inp.hidden = true;
  inp.id     = 'qbsInput';
  inp.addEventListener('change', () => {
    if (inp.files[0]) loadState(inp.files[0]);
    inp.value = ''; // reset so same file can be re-loaded
  });
  document.body.appendChild(inp);
})();
