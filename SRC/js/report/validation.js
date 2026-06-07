import { db } from '../core/state.js';
import { projectedCols, projectedColsUpToLookup } from '../catalog/column-catalog.js';
import { checkLookupDuplicates } from '../query/lookup-resolver.js';
import { checkCalcError } from './calc-validator.js';
import {
  aggregateNeedsColumn,
  isValidAggregateFn,
  isValidTotalFn,
  isValidSubtotalFn,
} from '../ui/aggregation.js';

// ── Validation / Applicability Layer ─────────────────────────────────────────
// Derives whether each config item is currently resolved — i.e., its source
// tables and columns are loaded and available. This is SOURCE APPLICABILITY
// only; config consistency (alias uniqueness, op validity, etc.) is handled by
// lookup-resolver.js (checkLookupDuplicates) and calc-validator.js (checkCalcError).
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
  const baseOk = !!(db.base && db.tables && db.tables[db.base]);
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

  // ── Report mode ────────────────────────────────────────────────────────────
  if (!['none', 'group', 'totals', 'subtotals'].includes(db.aggMode)) {
    mkItem('aggMode', true, false, [
      mkIssue(
        'aggMode_invalid', 'reportMode', 'pipeline', 'aggMode',
        `Unknown report mode "${db.aggMode}"`
      ),
    ]);
  }

  // ── Stacks ─────────────────────────────────────────────────────────────────
  for (let i = 0; i < (db.stacks || []).length; i++) {
    const id = db.stacks[i];
    const ok = !!(id && db.tables && db.tables[id]);
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

    // No complete key pair → unresolved/blocking (enabled lookups only block)
    const hasCompleteKeyPair = (lk.keyPairs || []).some(p => p && p.left && p.right);
    if (rt && !hasCompleteKeyPair) {
      resolved = false;
      issues.push(mkIssue(
        `lookup_${i}_no_key_pairs`, 'lookup', `lookup_${i}`, `lookup_${i}`,
        `Lookup "${rt.name}" has no complete match column pair`
      ));
    }

    // Check duplicate keys directly via lookup-resolver
    const dupErr = checkLookupDuplicates(lk);
    if (dupErr) {
      resolved = false;
      issues.push(mkIssue(
        `lookup_${i}_dup_keys`, 'duplicateKeys', 'pipeline', `lookup_${i}`,
        dupErr, { lookupIndex: i }
      ));
    }

    mkItem(`lookup_${i}`, enabled, resolved, issues);
  }

  // ── Calculated stages ────────────────────────────────────────────────────────
  for (let i = 0; i < (db.calcStages || []).length; i++) {
    const c = db.calcStages[i];
    const enabled = c.enabled !== false;
    const alias = (c.alias || '').trim();
    let resolved = true;
    const issues = [];
    if (!alias) {
      resolved = false;
      issues.push(mkIssue(
        `calc_${i}_no_alias`, 'calculatedColumn', `calc_${i}`, `calc_${i}`,
        `Calculated column has no alias`
      ));
    } else if (!projected.has(alias)) {
      resolved = false;
      issues.push(mkIssue(
        `calc_${i}_unresolved`, 'calculatedColumn', `calc_${i}`, `calc_${i}`,
        `Calculated column "${alias}" — one or more source columns are not available`
      ));
    }
    // Check expression error directly via calc-validator
    const calcErr = checkCalcError(c, i);
    if (calcErr) {
      resolved = false;
      issues.push(mkIssue(
        `calc_${i}_expr_error`, 'calcError', 'pipeline', `calc_${i}`,
        calcErr, { calcIndex: i }
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
    if (!Array.isArray(f.vals)) {
      resolved = false;
      issues.push(mkIssue(
        `filter_${i}_bad_vals`, 'filter', 'filterSort', `filter_${i}`,
        `Filter "${f.col || '(no column)'}" has malformed values`
      ));
    } else if (f.vals.some(v => typeof v !== 'string')) {
      resolved = false;
      issues.push(mkIssue(
        `filter_${i}_bad_vals`, 'filter', 'filterSort', `filter_${i}`,
        `Filter "${f.col || '(no column)'}" has malformed values`
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

  // ── Group-by columns ───────────────────────────────────────────────────────
  if (db.aggMode === 'group') {
    for (let i = 0; i < (db.groupBy || []).length; i++) {
      const col = db.groupBy[i];
      const resolved = projected.has(col);
      const issues = [];
      if (!resolved) {
        issues.push(mkIssue(
          `groupby_${i}_missing_col`, 'groupBy', 'aggregation', `groupby_${i}`,
          `Group-by column "${col}" is not available`,
          { missingColumn: col }
        ));
      }
      mkItem(`groupby_${i}`, true, resolved, issues);
    }

    // ── Aggregates ──────────────────────────────────────────────────────────
    for (let i = 0; i < (db.aggregates || []).length; i++) {
      const agg = db.aggregates[i];
      const issues = [];
      let resolved = true;
      const needsCol = aggregateNeedsColumn(agg.fn);
      if (needsCol && agg.col && agg.col !== '*' && !projected.has(agg.col)) {
        resolved = false;
        issues.push(mkIssue(
          `agg_${i}_missing_col`, 'aggregate', 'aggregation', `agg_${i}`,
          `Aggregate column "${agg.col}" is not available`,
          { missingColumn: agg.col }
        ));
      }
      if (!isValidAggregateFn(agg.fn)) {
        resolved = false;
        issues.push(mkIssue(
          `agg_${i}_invalid_fn`, 'aggregate', 'aggregation', `agg_${i}`,
          `Unknown aggregate function "${agg.fn}"`
        ));
      }
      mkItem(`agg_${i}`, true, resolved, issues);
    }
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  if (db.aggMode === 'totals') {
    for (const [col, fn] of Object.entries(db.colTotals || {})) {
      if (!fn || fn === 'skip') continue;
      let resolved = projected.has(col);
      const issues = [];
      if (!resolved) {
        issues.push(mkIssue(
          `totals_${col}_missing_col`, 'totals', 'aggregation', `totals_${col}`,
          `Totals column "${col}" is not available`,
          { missingColumn: col }
        ));
      }
      if (!isValidTotalFn(fn)) {
        resolved = false;
        issues.push(mkIssue(
          `totals_${col}_invalid_fn`, 'totals', 'aggregation', `totals_${col}`,
          `Unknown totals function "${fn}" for column "${col}"`
        ));
      }
      mkItem(`totals_${col}`, true, resolved, issues);
    }
  }

  // ── Subtotals ──────────────────────────────────────────────────────────────
  if (db.aggMode === 'subtotals') {
    const strat = db.subtotalStrategy;
    if (strat !== undefined && strat !== 'combined' && strat !== 'nested') {
      mkItem('subtotalStrategy', true, false, [
        mkIssue(
          'subtotalStrategy_invalid', 'subtotalStrategy', 'aggregation', 'subtotalStrategy',
          `Unknown subtotal strategy "${strat}"`
        ),
      ]);
    }

    for (let i = 0; i < (db.subtotalBy || []).length; i++) {
      const col = db.subtotalBy[i];
      const resolved = projected.has(col);
      const issues = [];
      if (!resolved) {
        issues.push(mkIssue(
          `subtotalby_${i}_missing_col`, 'subtotalBy', 'aggregation', `subtotalby_${i}`,
          `Subtotal group column "${col}" is not available`,
          { missingColumn: col }
        ));
      }
      mkItem(`subtotalby_${i}`, true, resolved, issues);
    }

    for (const [col, fn] of Object.entries(db.subtotalFns || {})) {
      if (!fn || fn === 'skip') continue;
      let resolved = projected.has(col);
      const issues = [];
      if (!resolved) {
        issues.push(mkIssue(
          `subtotalfns_${col}_missing_col`, 'subtotalFns', 'aggregation', `subtotalfns_${col}`,
          `Subtotal column "${col}" is not available`,
          { missingColumn: col }
        ));
      }
      if (!isValidSubtotalFn(fn)) {
        resolved = false;
        issues.push(mkIssue(
          `subtotalfns_${col}_invalid_fn`, 'subtotalFns', 'aggregation', `subtotalfns_${col}`,
          `Unknown subtotals function "${fn}" for column "${col}"`
        ));
      }
      mkItem(`subtotalfns_${col}`, true, resolved, issues);
    }
  }

  // ── Output columns ─────────────────────────────────────────────────────────
  // colOrder defines which projected columns are in the output (and their order).
  // selCols (Set) optionally further restricts visibility.
  // Columns in colOrder that are no longer in projected are unresolved.
  const colOrderItems = (db.colOrder || []).filter(a => !projected.has(a));
  for (let i = 0; i < colOrderItems.length; i++) {
    const col = colOrderItems[i];
    const issues = [mkIssue(
      `colorder_${i}_stale`, 'outputColumn', 'outputColumns', `colorder_${col}`,
      `Output column "${col}" is no longer available`,
      { missingColumn: col }
    )];
    // Stale output columns are unresolved but only blocking if selCols references them
    const inSelCols = db.selCols instanceof Set ? db.selCols.has(col) : true;
    mkItem(`colorder_${col}`, inSelCols, false, issues);
  }

  // ── Merge display ──────────────────────────────────────────────────────────
  // mergedCols: string[] of aliases that have merge-style display enabled.
  // Each must be in projected (and ideally in colOrder).
  for (const col of (db.mergedCols || [])) {
    if (!projected.has(col)) {
      const issues = [mkIssue(
        `merge_${col}_missing`, 'mergeDisplay', 'outputColumns', `merge_${col}`,
        `Merge-display column "${col}" is not available`,
        { missingColumn: col }
      )];
      mkItem(`merge_${col}`, true, true, issues);
    }
  }

  // ── Cards ──────────────────────────────────────────────────────────────────
  function cardFor(itemId) {
    if (itemId === 'base' || itemId === 'aggMode' || itemId.startsWith('stack_') ||
        itemId.startsWith('lookup_') || itemId.startsWith('calc_')) return 'pipeline';
    if (itemId.startsWith('filter_') || itemId.startsWith('sort_')) return 'filterSort';
    if (itemId.startsWith('groupby_') || itemId.startsWith('agg_') ||
        itemId.startsWith('totals_') || itemId.startsWith('subtotalby_') ||
        itemId.startsWith('subtotalfns_')) return 'aggregation';
    if (itemId.startsWith('colorder_') || itemId.startsWith('merge_')) return 'outputColumns';
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

export { getValidation, invalidateValidation };
window.getValidation = getValidation;
window.invalidateValidation = invalidateValidation;
