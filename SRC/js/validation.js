'use strict';
// ── Validation / Applicability Layer ─────────────────────────────────────────
// Derives whether each config item is currently resolved — i.e., its source
// tables and columns are loaded and available. This is SOURCE APPLICABILITY
// only; config consistency (alias uniqueness, op validity, etc.) remains in
// query-builder.js's _calcStageError / _checkAllLookups helpers.
//
// Exposes:
//   deriveValidation()     → { reportStatus, cards, items }
//   invalidateValidation() → clears cached result (call before each render)
//   getValidation()        → returns cached (or freshly computed) result
//
// Item shape:
//   { enabled: bool, resolved: bool, blocking: bool, issues: Issue[] }
//   blocking = enabled && !resolved
//
// Issue shape:
//   { id, severity:'blocked', area, cardId, itemId, message,
//     missingTableId?, missingColumn?, repairHint? }
//
// Card shape:
//   { status: 'healthy'|'blocked', issues: Issue[] }
//
// reportStatus is 'blocked' when any item is blocking.

let _validationCache = null;

function invalidateValidation() {
  _validationCache = null;
}

function getValidation() {
  if (!_validationCache) _validationCache = deriveValidation();
  return _validationCache;
}

function deriveValidation() {
  const items = {};

  function mkIssue(id, area, cardId, itemId, message, extra) {
    return Object.assign({ id, severity: 'blocked', area, cardId, itemId, message }, extra || {});
  }

  function mkItem(itemId, enabled, resolved, issues) {
    const e = enabled !== false;
    items[itemId] = { enabled: e, resolved, blocking: e && !resolved, issues: issues || [] };
    return items[itemId];
  }

  // ── Projected columns (engine.js already skips unresolved/disabled sources) ──
  const baseOk = tableExists(db.base);
  const projected = new Set(baseOk ? projectedCols() : []);

  // ── Base ───────────────────────────────────────────────────────────────────
  {
    const issues = [];
    if (!baseOk) {
      issues.push(mkIssue(
        'base_missing', 'base', 'pipeline', 'base',
        `Primary sheet "${db.base || '(none)'}" is not loaded`,
        { missingTableId: db.base || null, repairHint: 'Load the file containing this sheet.' }
      ));
    }
    mkItem('base', true, baseOk, issues);
  }

  // ── Stacks ─────────────────────────────────────────────────────────────────
  for (let i = 0; i < (db.stacks || []).length; i++) {
    const id = db.stacks[i];
    const ok = tableExists(id);
    const issues = [];
    if (!ok) {
      issues.push(mkIssue(
        `stack_${i}_missing`, 'stack', 'pipeline', `stack_${i}`,
        `Stacked sheet "${id}" is not loaded`,
        { missingTableId: id, repairHint: 'Load the file containing this sheet.' }
      ));
    }
    mkItem(`stack_${i}`, true, ok, issues);
  }

  // ── Lookups ────────────────────────────────────────────────────────────────
  for (let i = 0; i < (db.lookups || []).length; i++) {
    const lk = db.lookups[i];
    const enabled = lk.enabled !== false;
    const issues = [];
    let resolved = true;

    const rt = lk.rightId && db.tables[lk.rightId];
    if (!rt) {
      resolved = false;
      issues.push(mkIssue(
        `lookup_${i}_missing_table`, 'lookup', `lookup_${i}`, `lookup_${i}`,
        `Lookup sheet "${lk.rightId || '(none)'}" is not loaded`,
        { missingTableId: lk.rightId || null, repairHint: 'Load the file containing this sheet.' }
      ));
    } else if (baseOk) {
      // Check key pair column availability only when base is loaded
      const leftCols = projectedColsUpToLookup(i);
      const leftSet = new Set(leftCols);
      for (let pi = 0; pi < (lk.keyPairs || []).length; pi++) {
        const p = lk.keyPairs[pi];
        if (p.left && !leftSet.has(p.left)) {
          resolved = false;
          issues.push(mkIssue(
            `lookup_${i}_kp${pi}_left`, 'lookup', `lookup_${i}`, `lookup_${i}`,
            `Match column "${p.left}" is not available`,
            { missingColumn: p.left }
          ));
        }
        if (p.right && !rt.cols.includes(p.right)) {
          resolved = false;
          issues.push(mkIssue(
            `lookup_${i}_kp${pi}_right`, 'lookup', `lookup_${i}`, `lookup_${i}`,
            `Match column "${p.right}" not found in "${rt.name}"`,
            { missingColumn: p.right }
          ));
        }
      }
    }

    mkItem(`lookup_${i}`, enabled, resolved, issues);
  }

  // ── Calculated stages ──────────────────────────────────────────────────────
  // A calc stage is resolved if its alias ends up in projectedCols().
  // buildColSourceMap (used by projectedCols) skips calcs with missing column
  // refs, so absence from projected means a source reference is broken.
  for (let i = 0; i < (db.calcStages || []).length; i++) {
    const c = db.calcStages[i];
    const enabled = c.enabled !== false;
    const alias = (c.alias || '').trim();
    // Unset alias is an incomplete-config issue, not a source-applicability issue
    const resolved = !alias || projected.has(alias);
    const issues = [];
    if (alias && !resolved) {
      issues.push(mkIssue(
        `calc_${i}_unresolved`, 'calculatedColumn', `calc_${i}`, `calc_${i}`,
        `Calculated column "${alias}" — one or more source columns are not available`
      ));
    }
    mkItem(`calc_${i}`, enabled, resolved, issues);
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  for (let i = 0; i < (db.filters || []).length; i++) {
    const f = db.filters[i];
    const enabled = f.enabled !== false;
    let resolved = true;
    const issues = [];
    if (f.col && !projected.has(f.col)) {
      resolved = false;
      issues.push(mkIssue(
        `filter_${i}_missing_col`, 'filter', 'filterSort', `filter_${i}`,
        `Filter column "${f.col}" is not available`,
        { missingColumn: f.col }
      ));
    }
    mkItem(`filter_${i}`, enabled, resolved, issues);
  }

  // ── Sorts ──────────────────────────────────────────────────────────────────
  for (let i = 0; i < (db.sorts || []).length; i++) {
    const s = db.sorts[i];
    const enabled = s.enabled !== false;
    let resolved = true;
    const issues = [];
    if (s.col && !projected.has(s.col)) {
      resolved = false;
      issues.push(mkIssue(
        `sort_${i}_missing_col`, 'sort', 'filterSort', `sort_${i}`,
        `Sort column "${s.col}" is not available`,
        { missingColumn: s.col }
      ));
    }
    mkItem(`sort_${i}`, enabled, resolved, issues);
  }

  // ── Cards ──────────────────────────────────────────────────────────────────
  function cardFor(itemId) {
    if (itemId === 'base' || itemId.startsWith('stack_') ||
        itemId.startsWith('lookup_') || itemId.startsWith('calc_')) return 'pipeline';
    if (itemId.startsWith('filter_') || itemId.startsWith('sort_')) return 'filterSort';
    return 'other';
  }

  const cards = {};
  for (const [itemId, item] of Object.entries(items)) {
    const cid = cardFor(itemId);
    if (!cards[cid]) cards[cid] = { status: 'healthy', issues: [] };
    if (item.blocking) cards[cid].status = 'blocked';
    cards[cid].issues.push(...item.issues);
  }

  // ── Report status ──────────────────────────────────────────────────────────
  const reportBlocked = Object.values(items).some(i => i.blocking);

  return {
    reportStatus: reportBlocked ? 'blocked' : 'healthy',
    cards,
    items,
  };
}
