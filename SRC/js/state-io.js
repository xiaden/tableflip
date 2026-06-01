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
    joins:        (db.joins || []).map(j => ({ ...j })),
    selCols:      db.selCols ? [...db.selCols] : null,
    colOrder:     db.colOrder ? [...db.colOrder] : null,
    filters:      db.filters.map(f => ({
      col:  f.col  || '',
      op:   f.op   || 'contains',
      vals: Array.isArray(f.vals) ? [...f.vals] : [f.val ?? ''],
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
      toast('Could not parse state file — is it a valid .qbs file?', 'err');
      return;
    }

    if (!payload || typeof payload !== 'object') {
      toast('Invalid state file.', 'err');
      return;
    }

    const warnings = [];

    // ── Base table ────────────────────────────────────────────────────────────
    const savedBase = payload.base || '';
    if (!savedBase || !db.tables[savedBase]) {
      warnings.push(`Primary sheet "${savedBase}" is not loaded — load the original file first.`);
      // Cannot restore anything meaningful without a valid base
      if (warnings.length) _showWarnings(warnings);
      return;
    }
    db.base = savedBase;

    // ── Base column selection ─────────────────────────────────────────────────
    if (Array.isArray(payload.baseCols)) {
      const valid = payload.baseCols.filter(c => db.tables[savedBase].cols.includes(c));
      db.baseCols = valid.length === db.tables[savedBase].cols.length ? null : (valid.length ? valid : null);
    } else {
      db.baseCols = null;
    }

    // ── Stacks ────────────────────────────────────────────────────────────────
    db.stacks = [];
    for (const id of (payload.stacks || [])) {
      if (!db.tables[id]) { warnings.push(`Stacked sheet "${id}" skipped — sheet not loaded.`); continue; }
      if (!db.stacks.includes(id)) db.stacks.push(id);
    }

    // ── Lookups ───────────────────────────────────────────────────────────────
    db.lookups = [];
    for (const lk of (payload.lookups || [])) {
      if (!lk.rightId || !db.tables[lk.rightId]) {
        warnings.push(`Lookup sheet "${lk.rightId}" skipped — sheet not loaded.`);
        continue;
      }
      const rt        = db.tables[lk.rightId];
      const leftAvail = projectedColsUpToLookup(db.lookups.length);
      const keyPairs  = (Array.isArray(lk.keyPairs) ? lk.keyPairs : []).map(p => {
        const left  = leftAvail.includes(p.left)  ? p.left  : '';
        const right = rt.cols.includes(p.right)   ? p.right : '';
        if (p.left  && !left)  warnings.push(`Match column "${p.left}" not found — cleared on lookup from "${rt.name}".`);
        if (p.right && !right) warnings.push(`Match column "${p.right}" not found — cleared on lookup from "${rt.name}".`);
        return { left, right };
      });
      const cols = Array.isArray(lk.cols) ? lk.cols.filter(c => rt.cols.includes(c)) : [...rt.cols];
      db.lookups.push({ rightId: lk.rightId, keyPairs, cols, required: !!lk.required });
    }
    db.joins = [];

    // ── Calculated stages ───────────────────────────────────────────────────
    const LEGACY_COMPARISON_OPS = new Set(['>', '<', '=', '!=', '>=', '<=']);
    const VALID_CALC_OPS = new Set(['+', '-', '*', '/', 'ROLLAVG', 'PCTTOTAL', 'COMPARE']);
    db.calcStages = [];
    for (const c of (payload.calcStages || [])) {
      const alias = (c.alias || '').trim();
      const left  = c.left || '';
      const right = c.right || '';
      const isArithmetic = ['+', '-', '*', '/'].includes(c.op);

      // Convert legacy comparison ops to COMPARE with a single condition
      let op, conditions;
      if (LEGACY_COMPARISON_OPS.has(c.op)) {
        op = 'COMPARE';
        const legacyVal = c.compVal ?? '';
        conditions = [{ col: left, op: c.op, val: String(legacyVal) }];
      } else {
        op = VALID_CALC_OPS.has(c.op) ? c.op : '-';
        conditions = [];
        if (op === 'COMPARE') {
          conditions = Array.isArray(c.conditions) ? c.conditions.map(cond => ({
            col: cond.col || '',
            op:  ['=', '!=', '>', '>=', '<', '<='].includes(cond.op) ? cond.op : '=',
            val: String(cond.val ?? ''),
          })) : [];
        }
      }

      const window = Math.max(1, parseInt(c.window, 10) || 7);
      const explicitOrder = !!c.explicitOrder;
      const orderCol = c.orderCol || '';
      const orderDir = c.orderDir === 'DESC' ? 'DESC' : 'ASC';
      const compareMode = c.compareMode === 'OR' ? 'OR' : 'AND';

      if (!alias) {
        warnings.push('A calculated column with no label was skipped.');
        continue;
      }

      const availNow = new Set(projectedCols());
      if (op !== 'COMPARE' && (!availNow.has(left) || (isArithmetic && !availNow.has(right)))) {
        warnings.push(`Calculated column "${alias}" skipped — one or more source columns are unavailable.`);
        continue;
      }
      if (op === 'COMPARE') {
        const validConds = conditions.filter(cond => cond.col && availNow.has(cond.col) && String(cond.val ?? '').trim());
        if (!validConds.length) {
          warnings.push(`Calculated column "${alias}" skipped — no valid comparison conditions.`);
          continue;
        }
        conditions = validConds;
      }
      if (op === 'ROLLAVG' && explicitOrder && orderCol && !availNow.has(orderCol)) {
        warnings.push(`Calculated column "${alias}" skipped — explicit order column is unavailable.`);
        continue;
      }
      if (availNow.has(alias)) {
        warnings.push(`Calculated column "${alias}" skipped — label conflicts with an existing column.`);
        continue;
      }
      db.calcStages.push({ alias, left, op, right, conditions, compareMode, window, explicitOrder, orderCol, orderDir });
    }

    // ── Derive available columns now that stacks/lookups are set ─────────────
    const available = new Set(projectedCols());

    // ── Selected columns + column order ────────────────────────────────────────────────────
    if (payload.selCols === null) {
      db.selCols = null;
    } else if (Array.isArray(payload.selCols)) {
      const kept    = payload.selCols.filter(c => available.has(c));
      const dropped = payload.selCols.filter(c => !available.has(c));
      if (dropped.length) warnings.push(`Selected columns not found and deselected: ${dropped.join(', ')}`);
      db.selCols = kept.length ? new Set(kept) : null;
    }
    db.colOrder = Array.isArray(payload.colOrder)
      ? payload.colOrder.filter(c => available.has(c))
      : null;

    // ── Filters ───────────────────────────────────────────────────────────────
    db.filters = [];
    for (const f of (payload.filters || [])) {
      if (f.col && !available.has(f.col)) {
        warnings.push(`Filter on column "${f.col}" skipped — column not available.`);
        continue;
      }
      // Backward compat: old files use `val` string, new files use `vals` array
      const vals = Array.isArray(f.vals)
        ? f.vals.filter(v => typeof v === 'string')
        : [typeof f.val === 'string' ? f.val : ''];
      db.filters.push({ col: f.col || '', op: f.op || 'contains', vals: vals.length ? vals : [''] });
    }

    // ── Group By ──────────────────────────────────────────────────────────────
    const groupBy   = (payload.groupBy || []).filter(c => available.has(c));
    const gbDropped = (payload.groupBy || []).filter(c => !available.has(c));
    if (gbDropped.length) warnings.push(`Group By columns not found and removed: ${gbDropped.join(', ')}`);
    db.groupBy = groupBy;

    // ── Aggregates ────────────────────────────────────────────────────────────
    db.aggregates = [];
    for (const a of (payload.aggregates || [])) {
      if (a.col && a.col !== '*' && !available.has(a.col)) {
        warnings.push(`Aggregate "${a.alias || a.fn}" on column "${a.col}" skipped — column not available.`);
        continue;
      }
      db.aggregates.push({ fn: a.fn || 'SUM', col: a.col || '*', alias: a.alias || '' });
    }

    // ── Sorts ─────────────────────────────────────────────────────────────────
    db.sorts = [];
    for (const s of (payload.sorts || [])) {
      if (s.col && !available.has(s.col)) {
        warnings.push(`Sort on column "${s.col}" skipped — column not available.`);
        continue;
      }
      db.sorts.push({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC' });
    }

    // ── Agg mode ──────────────────────────────────────────────────────────────
    db.aggMode = ['group', 'totals', 'subtotals', 'none'].includes(payload.aggMode) ? payload.aggMode : 'none';

    // ── Col Totals ────────────────────────────────────────────────────────────
    db.colTotals = {};
    const VALID_TOTAL_FNS = new Set([
      'SUM', 'COUNT', 'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
      'AVG', 'MIN', 'MAX', 'LIST',
    ]);
    for (const [col, fn] of Object.entries(payload.colTotals || {})) {
      if (available.has(col) && VALID_TOTAL_FNS.has(fn)) db.colTotals[col] = fn;
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
    db.subtotalBy = (payload.subtotalBy || []).filter(c => available.has(c));
    db.subtotalFns = {};
    for (const [col, fn] of Object.entries(payload.subtotalFns || {})) {
      if (available.has(col) && VALID_SUBTOTAL_FNS.has(fn)) db.subtotalFns[col] = fn;
    }
    db.subtotalGrandTotal = payload.subtotalGrandTotal !== false;
    db.subtotalSpacer     = !!payload.subtotalSpacer;
    db.subtotalOnTop      = !!payload.subtotalOnTop;

    // ── Per-mode layout state ───────────────────────────────────────────────
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
      : [...db.groupBy];
    const subtotalByState = Array.isArray(sanitizeModeState.subtotals?.subtotalBy)
      ? sanitizeModeState.subtotals.subtotalBy.filter(c => available.has(c))
      : [...db.subtotalBy];

    db.aggModeState = {
      none: {
        selCols: noneSel,
      },
      group: {
        groupBy: groupByState,
        aggregates: sanitizeAggregates(sanitizeModeState.group?.aggregates ?? db.aggregates),
      },
      totals: {
        selCols: totalsSel,
        colTotals: sanitizeColFns(sanitizeModeState.totals?.colTotals ?? db.colTotals, VALID_TOTAL_FNS),
      },
      subtotals: {
        selCols: subtotalsSel,
        subtotalBy: subtotalByState,
        subtotalFns: sanitizeColFns(modeSubtotals?.subtotalFns ?? db.subtotalFns, VALID_SUBTOTAL_FNS),
        subtotalGrandTotal: modeSubtotals && Object.prototype.hasOwnProperty.call(modeSubtotals, 'subtotalGrandTotal')
          ? modeSubtotals.subtotalGrandTotal !== false
          : db.subtotalGrandTotal !== false,
        subtotalSpacer: modeSubtotals && Object.prototype.hasOwnProperty.call(modeSubtotals, 'subtotalSpacer')
          ? !!modeSubtotals.subtotalSpacer
          : !!db.subtotalSpacer,
        subtotalOnTop: modeSubtotals && Object.prototype.hasOwnProperty.call(modeSubtotals, 'subtotalOnTop')
          ? !!modeSubtotals.subtotalOnTop
          : !!db.subtotalOnTop,
      },
    };
    if (typeof loadAggModeState === 'function') loadAggModeState(db.aggMode || 'none');

    // ── Merged cols ─────────────────────────────────────────────────────────────
    db.mergedCols = (payload.mergedCols || []).filter(c => typeof c === 'string');
    db.mergeGroupUnderline = !!payload.mergeGroupUnderline;
    db.colState   = Array.isArray(payload.colState) ? payload.colState : null;
    if (payload.excludedRows && typeof payload.excludedRows === 'object') {
      for (const [tid, arr] of Object.entries(payload.excludedRows)) {
        if (!db.tables[tid]) {
          warnings.push(`Excluded rows for sheet "${tid}" skipped — sheet not loaded.`);
          continue;
        }
        if (Array.isArray(arr) && arr.length) {
          db.excludedRows[tid] = new Set(arr);
        }
      }
    }

    // ── Table colors ──────────────────────────────────────────────────────────
    db.tableColors = {};
    for (const [tid, color] of Object.entries(payload.tableColors || {})) {
      if (db.tables[tid] && typeof color === 'string' && color.startsWith('#')) {
        db.tableColors[tid] = color;
      }
    }

    // ── Column labels ─────────────────────────────────────────────────────────
    db.columnLabels = {};
    for (const [tid, labels] of Object.entries(payload.columnLabels || {})) {
      if (!db.tables[tid]) continue;
      const validCols = new Set(db.tables[tid].cols);
      const kept = {};
      for (const [col, label] of Object.entries(labels)) {
        if (validCols.has(col) && label && label !== col) kept[col] = label;
      }
      if (Object.keys(kept).length) db.columnLabels[tid] = kept;
    }

    // ── Re-render everything ──────────────────────────────────────────────────
    renderQueryBuilder();
    // Ensure merge-duplicate toggles are populated immediately after loading
    // a setup file, without requiring a report run first.
    if (db.base && typeof renderMergeToggles === 'function') {
      try { renderMergeToggles(projectedCols()); } catch (_) {}
    }
    toast('Report setup loaded.', 'ok');
    if (warnings.length) _showWarnings(warnings);
  };

  reader.onerror = () => toast('Failed to read file.', 'err');
  reader.readAsText(file);
}

function _showWarnings(warnings) {
  stickyToast(
    'Some items could not be restored:\n\n' + warnings.map(w => '• ' + w).join('\n'),
    'warn'
  );
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
