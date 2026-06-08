import { db } from '../core/state.js';
import { projectedCols, projectedColsUpToLookup, buildColSourceMap } from '../catalog/column-catalog.js';
import { checkLookupDuplicates } from '../query/lookup-resolver.js';
import { checkCalcError } from './calc-validator.js';
import {
  aggregateNeedsColumn,
  isValidAggregateFn,
  isValidTotalFn,
  isValidSubtotalFn,
} from '../ui/components/aggregation-constants.js';

interface ValidationIssue {
  id: string;
  severity: string;
  area: string;
  cardId: string;
  itemId: string;
  message: string;
  missingTableId?: string | null;
  missingColumn?: string;
  repairHint?: string;
  lookupIndex?: number;
  calcIndex?: number;
}

interface ValidationItem {
  enabled: boolean;
  resolved: boolean;
  blocking: boolean;
  issues: ValidationIssue[];
}

interface ValidationCard {
  status: string;
  issues: ValidationIssue[];
}

interface ValidationResult {
  reportStatus: 'healthy' | 'blocked';
  cards: Record<string, ValidationCard>;
  items: Record<string, ValidationItem>;
}

let _validationCache: ValidationResult | null = null;

function invalidateValidation(): void {
  _validationCache = null;
}

function getValidation(): ValidationResult | null {
  if (!_validationCache) _validationCache = deriveValidation();
  return _validationCache;
}

function deriveValidation(): ValidationResult {
  const items: Record<string, ValidationItem> = {};

  function mkIssue(id: string, area: string, cardId: string, itemId: string, message: string, extra?: Record<string, unknown>): ValidationIssue {
    return Object.assign({ id, severity: 'blocked', area, cardId, itemId, message }, extra || {});
  }

  function mkItem(itemId: string, enabled: boolean, resolved: boolean, issues: ValidationIssue[]): ValidationItem {
    const e = enabled !== false;
    items[itemId] = { enabled: e, resolved, blocking: e && !resolved, issues: issues || [] };
    return items[itemId];
  }

  const baseOk = !!(db.base && db.tables && db.tables[db.base]);
  const projected = new Set(baseOk ? projectedCols() : []);

  {
    const issues: ValidationIssue[] = [];
    if (!baseOk) {
      issues.push(mkIssue(
        'base_missing', 'base', 'pipeline', 'base',
        `Primary sheet "${db.base || '(none)'}" is not loaded`,
        { missingTableId: db.base || null, repairHint: 'Load the file containing this sheet.' }
      ));
    }
    mkItem('base', true, baseOk, issues);
  }

  if (!['none', 'group', 'totals', 'subtotals'].includes(db.aggMode)) {
    mkItem('aggMode', true, false, [
      mkIssue(
        'aggMode_invalid', 'reportMode', 'pipeline', 'aggMode',
        `Unknown report mode "${db.aggMode}"`
      ),
    ]);
  }

  for (let i = 0; i < (db.stacks || []).length; i++) {
    const id = db.stacks[i];
    const ok = !!(id && db.tables && db.tables[id]);
    const issues: ValidationIssue[] = [];
    if (!ok) {
      issues.push(mkIssue(
        `stack_${i}_missing`, 'stack', 'pipeline', `stack_${i}`,
        `Stacked sheet "${id}" is not loaded`,
        { missingTableId: id, repairHint: 'Load the file containing this sheet.' }
      ));
    }
    mkItem(`stack_${i}`, true, ok, issues);
  }

  for (let i = 0; i < (db.lookups || []).length; i++) {
    const lk = db.lookups[i];
    const enabled = lk.enabled !== false;
    const issues: ValidationIssue[] = [];
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
        if (p.right && !rt!.cols.includes(p.right)) {
          resolved = false;
          issues.push(mkIssue(
            `lookup_${i}_kp${pi}_right`, 'lookup', `lookup_${i}`, `lookup_${i}`,
            `Match column "${p.right}" not found in "${rt!.name}"`,
            { missingColumn: p.right }
          ));
        }
      }
    }

    const hasCompleteKeyPair = (lk.keyPairs || []).some(p => p && p.left && p.right);
    if (rt && !hasCompleteKeyPair) {
      resolved = false;
      issues.push(mkIssue(
        `lookup_${i}_no_key_pairs`, 'lookup', `lookup_${i}`, `lookup_${i}`,
        `Lookup "${rt.name}" has no complete match column pair`
      ));
    }

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

  for (let i = 0; i < (db.calcStages || []).length; i++) {
    const c = db.calcStages[i];
    const enabled = c.enabled !== false;
    const alias = (c.alias || '').trim();
    let resolved = true;
    const issues: ValidationIssue[] = [];
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

  for (let i = 0; i < (db.filters || []).length; i++) {
    const f = db.filters[i];
    const enabled = f.enabled !== false;
    let resolved = true;
    const issues: ValidationIssue[] = [];
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
    } else if (f.vals.some((v: string) => typeof v !== 'string')) {
      resolved = false;
      issues.push(mkIssue(
        `filter_${i}_bad_vals`, 'filter', 'filterSort', `filter_${i}`,
        `Filter "${f.col || '(no column)'}" has malformed values`
      ));
    }
    mkItem(`filter_${i}`, enabled, resolved, issues);
  }

  for (let i = 0; i < (db.sorts || []).length; i++) {
    const s = db.sorts[i];
    const enabled = s.enabled !== false;
    let resolved = true;
    const issues: ValidationIssue[] = [];
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

  if (db.aggMode === 'group') {
    for (let i = 0; i < (db.groupBy || []).length; i++) {
      const col = db.groupBy[i];
      const resolved = projected.has(col);
      const issues: ValidationIssue[] = [];
      if (!resolved) {
        issues.push(mkIssue(
          `groupby_${i}_missing_col`, 'groupBy', 'aggregation', `groupby_${i}`,
          `Group-by column "${col}" is not available`,
          { missingColumn: col }
        ));
      }
      mkItem(`groupby_${i}`, true, resolved, issues);
    }

    for (let i = 0; i < (db.aggregates || []).length; i++) {
      const agg = db.aggregates[i];
      const issues: ValidationIssue[] = [];
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

  if (db.aggMode === 'totals') {
    const colMap = buildColSourceMap();
    for (const [col, fn] of Object.entries(db.colTotals || {})) {
      if (!fn || fn === 'skip') continue;
      let resolved = projected.has(col);
      const issues: ValidationIssue[] = [];
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
      const src = colMap.get(col);
      if (src?.kind === 'calc') {
        const calcObj = (src as { calc?: Record<string, unknown> }).calc;
        const mathOp = calcObj?.mathOp as string | undefined;
        if (mathOp === 'PCTTOTAL' || mathOp === 'ROLLAVG') {
          issues.push(mkIssue(
            `totals_${col}_advanced_calc`, 'totals', 'aggregation', `totals_${col}`,
            `"${col}" is a ${mathOp === 'PCTTOTAL' ? '% of Total' : 'Rolling Average'} calculated column — set its total function to "Skip" to avoid incorrect results`
          ));
        }
      }
      mkItem(`totals_${col}`, true, resolved, issues);
    }
  }

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
      const issues: ValidationIssue[] = [];
      if (!resolved) {
        issues.push(mkIssue(
          `subtotalby_${i}_missing_col`, 'subtotalBy', 'aggregation', `subtotalby_${i}`,
          `Subtotal group column "${col}" is not available`,
          { missingColumn: col }
        ));
      }
      mkItem(`subtotalby_${i}`, true, resolved, issues);
    }

    const subColMap = buildColSourceMap();
    for (const [col, fn] of Object.entries(db.subtotalFns || {})) {
      if (!fn || fn === 'skip') continue;
      let resolved = projected.has(col);
      const issues: ValidationIssue[] = [];
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
      const src = subColMap.get(col);
      if (src?.kind === 'calc') {
        const calcObj = (src as { calc?: Record<string, unknown> }).calc;
        const mathOp = calcObj?.mathOp as string | undefined;
        if (mathOp === 'PCTTOTAL' || mathOp === 'ROLLAVG') {
          issues.push(mkIssue(
            `subtotalfns_${col}_advanced_calc`, 'subtotalFns', 'aggregation', `subtotalfns_${col}`,
            `"${col}" is a ${mathOp === 'PCTTOTAL' ? '% of Total' : 'Rolling Average'} calculated column — set its subtotal function to "Skip" to avoid incorrect results`
          ));
        }
      }
      mkItem(`subtotalfns_${col}`, true, resolved, issues);
    }
  }

  const outputAliases = new Set<string>();
  if (db.aggMode === 'group') {
    for (const agg of (db.aggregates || [])) {
      if (agg.alias) outputAliases.add(agg.alias);
    }
  }
  for (const calc of (db.calcStages || [])) {
    if (calc.alias) outputAliases.add(calc.alias);
  }

  const colOrderItems = (db.colOrder || []).filter((a: string) => !projected.has(a) && !outputAliases.has(a));
  for (let i = 0; i < colOrderItems.length; i++) {
    const col = colOrderItems[i];
    const issues: ValidationIssue[] = [mkIssue(
      `colorder_${i}_stale`, 'outputColumn', 'outputColumns', `colorder_${col}`,
      `Output column "${col}" is no longer available`,
      { missingColumn: col }
    )];
    const inSelCols = db.selCols instanceof Set ? db.selCols.has(col) : true;
    mkItem(`colorder_${col}`, inSelCols, false, issues);
  }

  for (const col of (db.mergedCols || [])) {
    if (!projected.has(col)) {
      const issues: ValidationIssue[] = [mkIssue(
        `merge_${col}_missing`, 'mergeDisplay', 'outputColumns', `merge_${col}`,
        `Merge-display column "${col}" is not available`,
        { missingColumn: col }
      )];
      mkItem(`merge_${col}`, true, true, issues);
    }
  }

  function cardFor(itemId: string): string {
    if (itemId === 'base' || itemId === 'aggMode' || itemId.startsWith('stack_') ||
        itemId.startsWith('lookup_') || itemId.startsWith('calc_')) return 'pipeline';
    if (itemId.startsWith('filter_') || itemId.startsWith('sort_')) return 'filterSort';
    if (itemId.startsWith('groupby_') || itemId.startsWith('agg_') ||
        itemId.startsWith('totals_') || itemId.startsWith('subtotalby_') ||
        itemId.startsWith('subtotalfns_')) return 'aggregation';
    if (itemId.startsWith('colorder_') || itemId.startsWith('merge_')) return 'outputColumns';
    return 'other';
  }

  const cards: Record<string, ValidationCard> = {};
  for (const [itemId, item] of Object.entries(items)) {
    const cid = cardFor(itemId);
    if (!cards[cid]) cards[cid] = { status: 'healthy', issues: [] };
    if (item.blocking) cards[cid].status = 'blocked';
    cards[cid].issues.push(...item.issues);
  }

  const reportBlocked = Object.values(items).some(i => i.blocking);

  return {
    reportStatus: reportBlocked ? 'blocked' : 'healthy',
    cards,
    items,
  };
}

export { getValidation, invalidateValidation };
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).getValidation = getValidation;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).invalidateValidation = invalidateValidation;
