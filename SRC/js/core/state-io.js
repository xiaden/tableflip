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
      enabled:  l.enabled !== false,
      duplicatePolicy: l.duplicatePolicy ? { ...l.duplicatePolicy } : { mode: 'block' },
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
      enabled:  c.enabled !== false,
    })),
    selCols:      db.selCols ? [...db.selCols] : null,
    colOrder:     db.colOrder ? [...db.colOrder] : null,
    filters:      db.filters.map(f => ({
      col:     f.col  || '',
      op:      f.op   || 'contains',
      vals:    Array.isArray(f.vals) ? [...f.vals] : [''],
      enabled: f.enabled !== false,
    })),
    sorts:        db.sorts.map(s => ({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC', enabled: s.enabled !== false })),
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

    // Build state into `next` without touching db.
    // Missing source tables/columns are preserved as-authored.
    // After load, a summary warning is shown if broken refs exist.
    const next = {};
    const brokenRefs = []; // collect descriptions of unresolved refs

    // Use engine helpers with next as context — avoids duplicating projection logic.
    // Adds all calc aliases unconditionally so cross-calc broken-ref detection works
    // even when a calc formula is invalid (a valid formula isn't required to be "available").
    const nextAvailableCols = () => {
      const cols   = projectedColsUpToLookup((next.lookups || []).length, next);
      const colSet = new Set(cols);
      for (const c of (next.calcStages || [])) {
        if (c.alias) colSet.add(c.alias);
      }
      return colSet;
    };

    // ── Base table ────────────────────────────────────────────────────────────
    const savedBase = payload.base || '';
    next.base = savedBase;
    const baseLoaded = !!(savedBase && db.tables[savedBase]);
    if (!baseLoaded) {
      brokenRefs.push(`Primary sheet "${savedBase || '(none)'}" is not loaded`);
    }

    // ── Base column selection ─────────────────────────────────────────────────
    if (Array.isArray(payload.baseCols) && baseLoaded) {
      const valid = payload.baseCols.filter(c => db.tables[savedBase].cols.includes(c));
      next.baseCols = valid.length === db.tables[savedBase].cols.length ? null : (valid.length ? valid : null);
    } else if (Array.isArray(payload.baseCols)) {
      next.baseCols = [...payload.baseCols]; // preserve as-authored when base isn't loaded
    } else {
      next.baseCols = null;
    }

    // ── Stacks ────────────────────────────────────────────────────────────────
    next.stacks = [];
    for (const id of (payload.stacks || [])) {
      if (!db.tables[id]) {
        brokenRefs.push(`Stacked sheet "${id}" is not loaded`);
        next.stacks.push(id); // preserve reference even if broken
        continue;
      }
      if (!next.stacks.includes(id)) next.stacks.push(id);
    }

    // ── Lookups ───────────────────────────────────────────────────────────────
    next.lookups = [];
    for (const lk of (payload.lookups || [])) {
      const rt = lk.rightId && db.tables[lk.rightId];
      if (!lk.rightId || !rt) {
        brokenRefs.push(`Lookup sheet "${lk.rightId || '(none)'}" is not loaded`);
        // Preserve the lookup as-authored so user can see and fix it
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
        // Skip nameless calc stages — no way to reference them
        continue;
      }
      if (!op) {
        brokenRefs.push(`Calculated column "${alias}" has an unsupported operator "${c.op}"`);
        // Preserve with default op so user can see and fix it
        next.calcStages.push({ alias, left, op: '-', right, conditions: [], compareMode: 'AND', customTF: false, trueVal: '', falseVal: '', window: 7, explicitOrder: false, orderCol: '', orderDir: 'ASC', enabled: c.enabled !== false });
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
          op:  ['=', '!=', '>', '>=', '<', '<='].includes(cond.op) ? cond.op : '=',
          val: String(cond.val ?? ''),
        })) : [];
        // Warn about broken condition columns but keep all conditions
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
      next.calcStages.push({ alias, left, op, right, conditions, compareMode, customTF, trueVal, falseVal, window, explicitOrder, orderCol, orderDir, enabled: c.enabled !== false });
    }

    // ── Available columns after stacks/lookups/calcs ──────────────────────────
    const available = nextAvailableCols();

    // ── Selected columns + column order ──────────────────────────────────────
    if (payload.selCols === null) {
      next.selCols = null;
    } else if (Array.isArray(payload.selCols)) {
      // Preserve all authored refs — broken refs will surface in validation as unresolved items.
      const dropped = baseLoaded ? payload.selCols.filter(c => !available.has(c)) : [];
      if (dropped.length) brokenRefs.push(`Selected columns not available: ${dropped.join(', ')}`);
      next.selCols = new Set(payload.selCols);
    } else {
      next.selCols = null;
    }
    // Preserve authored col order — validation marks stale entries as unresolved.
    next.colOrder = Array.isArray(payload.colOrder) ? [...payload.colOrder] : null;

    // ── Filters ───────────────────────────────────────────────────────────────
    next.filters = [];
    for (const f of (payload.filters || [])) {
      if (f.col && baseLoaded && !available.has(f.col)) {
        brokenRefs.push(`Filter on column "${f.col}" is not available`);
      }
      if (!Array.isArray(f.vals)) {
        continue; // skip structurally invalid filter
      }
      const vals = f.vals.filter(v => typeof v === 'string');
      next.filters.push({ col: f.col || '', op: f.op || 'contains', vals: vals.length ? vals : [''], enabled: f.enabled !== false });
    }

    // ── Group By ──────────────────────────────────────────────────────────────
    // Preserve all authored refs — validation marks unavailable ones as unresolved.
    const gbDropped = baseLoaded ? (payload.groupBy || []).filter(c => !available.has(c)) : [];
    if (gbDropped.length) brokenRefs.push(`Group By columns not available: ${gbDropped.join(', ')}`);
    next.groupBy = [...(payload.groupBy || [])];

    // ── Aggregates ────────────────────────────────────────────────────────────
    next.aggregates = [];
    for (const a of (payload.aggregates || [])) {
      if (a.col && a.col !== '*' && baseLoaded && !available.has(a.col)) {
        brokenRefs.push(`Aggregate "${a.alias || a.fn}" on column "${a.col}" is not available`);
      }
      next.aggregates.push({ fn: a.fn || 'SUM', col: a.col || '*', alias: a.alias || '' });
    }

    // ── Sorts ─────────────────────────────────────────────────────────────────
    next.sorts = [];
    for (const s of (payload.sorts || [])) {
      if (s.col && baseLoaded && !available.has(s.col)) {
        brokenRefs.push(`Sort on column "${s.col}" is not available`);
      }
      next.sorts.push({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC', enabled: s.enabled !== false });
    }

    // ── Agg mode ──────────────────────────────────────────────────────────────
    next.aggMode = ['group', 'totals', 'subtotals', 'none'].includes(payload.aggMode) ? payload.aggMode : 'none';

    // ── Col Totals ────────────────────────────────────────────────────────────
    next.colTotals = {};
    const VALID_TOTAL_FNS = new Set([
      'SUM', 'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
      'AVG', 'MIN', 'MAX', 'LIST',
    ]);
    // Preserve all authored refs — validation marks unavailable/invalid ones as unresolved.
    for (const [col, fn] of Object.entries(payload.colTotals || {})) {
      if (baseLoaded && !available.has(col)) brokenRefs.push(`Totals column "${col}" not available`);
      next.colTotals[col] = fn;
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
    // Preserve all authored refs — validation marks unavailable/invalid ones as unresolved.
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

    // ── Per-mode layout state ─────────────────────────────────────────────────
    // Preserve as-authored without filtering by column availability.
    // Stale column refs in per-mode state are ignored at render time;
    // validation derives unresolved items for user-facing feedback.
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
        } : null,
      };
    }

    // ── Merged cols ───────────────────────────────────────────────────────────
    next.mergedCols = (payload.mergedCols || []).filter(c => typeof c === 'string');
    next.mergeGroupUnderline = !!payload.mergeGroupUnderline;
    next.colState   = Array.isArray(payload.colState) ? payload.colState : null;

    // ── Excluded rows ─────────────────────────────────────────────────────────
    // Preserve for unloaded tables too — if the same file is uploaded again the
    // exclusions will apply correctly (same file → same _rowno values).
    const nextExcludedRows = {};
    if (payload.excludedRows && typeof payload.excludedRows === 'object') {
      for (const [tid, arr] of Object.entries(payload.excludedRows)) {
        if (Array.isArray(arr) && arr.length) {
          nextExcludedRows[tid] = new Set(arr);
        }
      }
    }

    // ── Table colors ──────────────────────────────────────────────────────────
    // Preserve colors for unloaded tables so they restore when the sheet is re-uploaded.
    next.tableColors = {};
    for (const [tid, color] of Object.entries(payload.tableColors || {})) {
      if (typeof color === 'string' && color.startsWith('#')) {
        next.tableColors[tid] = color;
      }
    }

    // ── Column labels ─────────────────────────────────────────────────────────
    // Preserve labels for unloaded tables so they restore when the sheet is re-uploaded.
    next.columnLabels = {};
    for (const [tid, labels] of Object.entries(payload.columnLabels || {})) {
      if (!labels || typeof labels !== 'object') continue;
      const kept = {};
      for (const [col, label] of Object.entries(labels)) {
        if (label && label !== col) kept[col] = label;
      }
      if (Object.keys(kept).length) next.columnLabels[tid] = kept;
    }

    // ── Apply validated state atomically ──────────────────────────────────────
    Object.assign(db, next);
    // Merge excluded rows into existing (do not wipe rows for unrelated sheets)
    for (const [tid, set] of Object.entries(nextExcludedRows)) {
      db.excludedRows[tid] = set;
    }
    // Clear validation cache so next render derives fresh state.
    if (typeof invalidateValidation === 'function') invalidateValidation();

    // ── Re-render everything ──────────────────────────────────────────────────
    if (typeof loadAggModeState === 'function') loadAggModeState(db.aggMode || 'none');
    renderQueryBuilder();
    // Ensure merge-duplicate toggles are populated immediately after loading
    // a setup file, without requiring a report run first.
    if (db.base && typeof renderMergeToggles === 'function') {
      try { renderMergeToggles(projectedCols()); } catch (_) {}
    }
    if (brokenRefs.length) {
      const summary = brokenRefs.length === 1
        ? `1 item needs attention: ${brokenRefs[0]}.`
        : `${brokenRefs.length} items need attention — missing sheets or columns. Run the report to see full details.`;
      toast(`Report setup loaded with issues — ${summary}`, 'warn');
    } else {
      toast('Report setup loaded.', 'ok');
    }
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
