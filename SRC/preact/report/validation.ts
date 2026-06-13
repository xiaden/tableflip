/**
 * Report validation — validates the full report configuration.
 *
 * Checks every stage of the report pipeline for missing tables, missing
 * columns, invalid function references, and structural errors.
 *
 * Ported from SRC/js/report/validation.ts — zero imports from SRC/js/.
 * `deriveValidation` takes explicit parameters for testability;
 * `getValidation` reads from the store and caches the result.
 */

import type { AppState } from '../types';
import { getStore } from '../core/store';
import type { SourceTableEntry } from '../catalog/source-catalog';
import { buildSourceCatalog } from '../catalog/source-catalog';
import type { ColMapEntry } from '../catalog/column-catalog';
import { buildColSourceMap, projectedCols, projectedColsUpToLookup } from '../catalog/column-catalog';
import { validateLookupSpec } from '../query/lookup-resolver';
import { checkCalcError } from './calc-validator';
import {
  aggregateNeedsColumn,
  isValidAggregateFn,
  isValidTotalFn,
  isValidSubtotalFn,
} from './aggregation-constants';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single validation issue attached to a specific item.
 * @property id - Unique identifier for this issue
 * @property severity - Issue severity level (e.g. 'blocked')
 * @property area - Functional area the issue belongs to (e.g. 'base', 'lookup', 'filter')
 * @property cardId - ID of the UI card this issue is displayed on
 * @property itemId - ID of the pipeline item this issue is attached to
 * @property message - Human-readable error description
 * @property missingTableId - Table ID that is missing or unloaded (if applicable)
 * @property missingColumn - Column alias that is missing or unresolved (if applicable)
 * @property repairHint - Suggested action to resolve the issue
 * @property lookupIndex - Index of the lookup that triggered this issue (if applicable)
 * @property calcIndex - Index of the calc stage that triggered this issue (if applicable)
 */
export interface ValidationIssue {
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

/**
 * Validation status for a single pipeline item (base, stack, lookup, etc.).
 * @property enabled - Whether the pipeline item is active in the configuration
 * @property resolved - Whether all references in this item are valid and available
 * @property blocking - True if enabled and not resolved (prevents report execution)
 * @property issues - Array of validation issues attached to this item
 */
export interface ValidationItem {
  enabled: boolean;
  resolved: boolean;
  blocking: boolean;
  issues: ValidationIssue[];
}

/**
 * Aggregated validation status for a UI card (pipeline, filterSort, etc.).
 * @property status - Overall card status ('healthy' or 'blocked')
 * @property issues - All validation issues from items attached to this card
 */
export interface ValidationCard {
  status: string;
  issues: ValidationIssue[];
}

/**
 * Complete validation result with per-card and per-item breakdowns.
 * @property reportStatus - Overall report health ('healthy' if all items resolved, 'blocked' otherwise)
 * @property cards - Validation status grouped by UI card ID
 * @property items - Validation status per pipeline item ID
 */
export interface ValidationResult {
  reportStatus: 'healthy' | 'blocked';
  cards: Record<string, ValidationCard>;
  items: Record<string, ValidationItem>;
}

// ── Validation Cache ─────────────────────────────────────────────────────────

let _validationCache: ValidationResult | null = null;
let _validationCacheState: AppState | null = null;

/**
 * Invalidate the validation cache so the next call to `getValidation`
 * recomputes from scratch. Call after any state mutation.
 */
export function invalidateValidation(): void {
  _validationCache = null;
  _validationCacheState = null;
}

/**
 * Get the cached validation result, recomputing if necessary.
 *
 * Reads the current state from the store, builds the source catalog and
 * column map, then delegates to `deriveValidation`.
 *
 * Automatically recomputes when the store state has changed since the
 * last computation, so callers always get fresh results.
 *
 * @returns The validation result with per-card and per-item status.
 */
export function getValidation(): ValidationResult {
  const currentState = getStore().getState();
  if (!_validationCache || _validationCacheState !== currentState) {
    const sourceCatalog = buildSourceCatalog(currentState.tables);
    const colMap = buildColSourceMap();
    const reportSpec = {
      base: currentState.base,
      baseCols: currentState.baseCols,
      lookups: currentState.lookups,
      calcStages: currentState.calcStages,
    };
    const proj = projectedCols(reportSpec, sourceCatalog);
    _validationCache = deriveValidation(currentState, proj, colMap, sourceCatalog);
    _validationCacheState = currentState;
  }
  return _validationCache;
}

// ── Core Validation Logic ────────────────────────────────────────────────────

/**
 * Derive the full validation result for a report configuration.
 *
 * Pure function: takes explicit parameters instead of reading global state.
 * Validates base table, stacks, lookups, calc stages, filters, sorts,
 * group-by, aggregates, totals, subtotals, column order, and merged columns.
 *
 * @param state          - The full application state.
 * @param projectedColsList - Column aliases available in the report pipeline.
 * @param colMap         - Column alias → source mapping.
 * @param sourceCatalog  - Table ID → table metadata mapping.
 * @returns A ValidationResult with per-card and per-item status.
 */
export function deriveValidation(
  state: AppState,
  projectedColsList: string[],
  colMap: Map<string, ColMapEntry>,
  sourceCatalog: Map<string, SourceTableEntry>,
): ValidationResult {
  const items: Record<string, ValidationItem> = {};

  // ── Helpers ──────────────────────────────────────────────────────────────

  function mkIssue(
    id: string,
    area: string,
    cardId: string,
    itemId: string,
    message: string,
    extra?: Record<string, unknown>,
  ): ValidationIssue {
    return Object.assign(
      { id, severity: 'blocked', area, cardId, itemId, message },
      extra || {},
    ) as ValidationIssue;
  }

  function mkItem(
    itemId: string,
    enabled: boolean,
    resolved: boolean,
    issues: ValidationIssue[],
  ): ValidationItem {
    const e = enabled !== false;
    items[itemId] = { enabled: e, resolved, blocking: e && !resolved, issues: issues || [] };
    return items[itemId];
  }

  const projected = new Set(projectedColsList);

  // ── Base Table ───────────────────────────────────────────────────────────

  const baseOk = !!(state.base && state.tables && state.tables[state.base]);
  {
    const issues: ValidationIssue[] = [];
    if (!baseOk) {
      issues.push(mkIssue(
        'base_missing', 'base', 'pipeline', 'base',
        `Primary sheet "${state.base || '(none)'}" is not loaded`,
        { missingTableId: state.base || null, repairHint: 'Load the file containing this sheet.' },
      ));
    }
    mkItem('base', true, baseOk, issues);
  }

  // ── Aggregation Mode ─────────────────────────────────────────────────────

  if (!['none', 'group', 'totals', 'subtotals'].includes(state.aggMode)) {
    mkItem('aggMode', true, false, [
      mkIssue(
        'aggMode_invalid', 'reportMode', 'pipeline', 'aggMode',
        `Unknown report mode "${state.aggMode}"`,
      ),
    ]);
  }

  // ── Stacks ───────────────────────────────────────────────────────────────

  for (let i = 0; i < (state.stacks || []).length; i++) {
    const id = state.stacks[i];
    const ok = !!(id && state.tables && state.tables[id]);
    const issues: ValidationIssue[] = [];
    if (!ok) {
      issues.push(mkIssue(
        `stack_${i}_missing`, 'stack', 'pipeline', `stack_${i}`,
        `Stacked sheet "${id}" is not loaded`,
        { missingTableId: id, repairHint: 'Load the file containing this sheet.' },
      ));
    }
    mkItem(`stack_${i}`, true, ok, issues);
  }

  // ── Lookups ──────────────────────────────────────────────────────────────

  const reportSpec = {
    base: state.base,
    baseCols: state.baseCols,
    lookups: state.lookups,
    calcStages: state.calcStages,
  };

  for (let i = 0; i < (state.lookups || []).length; i++) {
    const lk = state.lookups[i];
    const enabled = lk.enabled !== false;
    const issues: ValidationIssue[] = [];
    let resolved = true;

    // Validate right table exists
    const rt = lk.rightId && state.tables[lk.rightId];
    if (!rt) {
      resolved = false;
      issues.push(mkIssue(
        `lookup_${i}_missing_table`, 'lookup', `lookup_${i}`, `lookup_${i}`,
        `Lookup sheet "${lk.rightId || '(none)'}" is not loaded`,
        { missingTableId: lk.rightId || null, repairHint: 'Load the file containing this sheet.' },
      ));
    } else if (baseOk) {
      // Validate key pair columns against projected columns up to this lookup
      const leftCols = projectedColsUpToLookup(i, reportSpec, sourceCatalog);
      const leftSet = new Set(leftCols);
      for (let pi = 0; pi < (lk.keyPairs || []).length; pi++) {
        const p = lk.keyPairs[pi];
        if (p.left && !leftSet.has(p.left)) {
          resolved = false;
          issues.push(mkIssue(
            `lookup_${i}_kp${pi}_left`, 'lookup', `lookup_${i}`, `lookup_${i}`,
            `Match column "${p.left}" is not available`,
            { missingColumn: p.left },
          ));
        }
        if (p.right && !rt!.cols.includes(p.right)) {
          resolved = false;
          issues.push(mkIssue(
            `lookup_${i}_kp${pi}_right`, 'lookup', `lookup_${i}`, `lookup_${i}`,
            `Match column "${p.right}" not found in "${rt!.name}"`,
            { missingColumn: p.right },
          ));
        }
      }
    }

    // Validate at least one complete key pair exists
    const hasCompleteKeyPair = (lk.keyPairs || []).some(p => p && p.left && p.right);
    if (rt && !hasCompleteKeyPair) {
      resolved = false;
      issues.push(mkIssue(
        `lookup_${i}_no_key_pairs`, 'lookup', `lookup_${i}`, `lookup_${i}`,
        `Lookup "${rt.name}" has no complete match column pair`,
      ));
    }

    // Validate lookup spec structure (replaces old checkLookupDuplicates)
    const lookupIssues = validateLookupSpec(lk, i, sourceCatalog);
    if (lookupIssues.length) {
      resolved = false;
      for (const li of lookupIssues) {
        issues.push(mkIssue(
          `lookup_${i}_dup_keys`, 'duplicateKeys', 'pipeline', `lookup_${i}`,
          li.message, { lookupIndex: i },
        ));
      }
    }

    mkItem(`lookup_${i}`, enabled, resolved, issues);
  }

  // ── Detail Bands ─────────────────────────────────────────────────────────

  for (let i = 0; i < (state.detailBands || []).length; i++) {
    const band = state.detailBands[i];
    const enabled = band.enabled !== false;
    const issues: ValidationIssue[] = [];
    let resolved = true;

    const ct = band.rightId && state.tables[band.rightId];
    // Use band label for display when available, falling back to table name
    const displayName = (band.label && band.label.trim()) || (ct ? ct.name : '') || band.rightId || '(none)';
    if (!ct) {
      resolved = false;
      issues.push(mkIssue(
        `detailband_${i}_missing_table`, 'detailBand', 'pipeline', `detailband_${i}`,
        `Related details sheet "${displayName}" is not loaded`,
        { missingTableId: band.rightId || null, repairHint: 'Load the file containing this sheet.' },
      ));
    } else if (baseOk) {
      // Validate key pairs
      for (let pi = 0; pi < (band.keyPairs || []).length; pi++) {
        const p = band.keyPairs[pi];
        if (p.left && !projected.has(p.left)) {
          resolved = false;
          issues.push(mkIssue(
            `detailband_${i}_kp${pi}_left`, 'detailBand', 'pipeline', `detailband_${i}`,
            `Match column "${p.left}" is not available`,
            { missingColumn: p.left },
          ));
        }
        if (p.right && !ct.cols.includes(p.right)) {
          resolved = false;
          issues.push(mkIssue(
            `detailband_${i}_kp${pi}_right`, 'detailBand', 'pipeline', `detailband_${i}`,
            `Match column "${p.right}" not found in "${displayName}"`,
            { missingColumn: p.right },
          ));
        }
      }
      const hasCompleteKeyPair = (band.keyPairs || []).some(p => p && p.left && p.right);
      if (!hasCompleteKeyPair) {
        resolved = false;
        issues.push(mkIssue(
          `detailband_${i}_no_key_pairs`, 'detailBand', 'pipeline', `detailband_${i}`,
          `Related details "${displayName}" has no complete match column pair`,
        ));
      }

      // Validate sort columns (warning severity — does not block execution)
      for (let si = 0; si < (band.sorts || []).length; si++) {
        const s = band.sorts[si];
        if (s.enabled !== false && s.col && !ct.cols.includes(s.col)) {
          issues.push(mkIssue(
            `detailband_${i}_sort_${si}_missing`, 'detailBand', 'pipeline', `detailband_${i}`,
            `Sort column "${s.col}" not found in "${displayName}"`,
            { severity: 'warning', missingColumn: s.col },
          ));
        }
      }
    }

    mkItem(`detailband_${i}`, enabled, resolved, issues);
  }

  // ── Calc Stages ──────────────────────────────────────────────────────────

  for (let i = 0; i < (state.calcStages || []).length; i++) {
    const c = state.calcStages[i];
    const enabled = c.enabled !== false;
    const alias = (c.alias || '').trim();
    let resolved = true;
    const issues: ValidationIssue[] = [];

    // Validate alias exists and resolves to a projected column
    if (!alias) {
      resolved = false;
      issues.push(mkIssue(
        `calc_${i}_no_alias`, 'calculatedColumn', `calc_${i}`, `calc_${i}`,
        'Calculated column has no alias',
      ));
    } else if (!projected.has(alias)) {
      resolved = false;
      issues.push(mkIssue(
        `calc_${i}_unresolved`, 'calculatedColumn', `calc_${i}`, `calc_${i}`,
        `Calculated column "${alias}" — one or more source columns are not available`,
      ));
    }

    // Validate calc expression (math/compare/text/date modes)
    const calcErr = checkCalcError(c, i, projectedColsList);
    if (calcErr) {
      resolved = false;
      issues.push(mkIssue(
        `calc_${i}_expr_error`, 'calcError', 'pipeline', `calc_${i}`,
        calcErr, { calcIndex: i },
      ));
    }

    mkItem(`calc_${i}`, enabled, resolved, issues);
  }

  // ── Filters ──────────────────────────────────────────────────────────────

  for (let i = 0; i < (state.filters || []).length; i++) {
    const f = state.filters[i];
    const enabled = f.enabled !== false;
    let resolved = true;
    const issues: ValidationIssue[] = [];

    if (f.col && !projected.has(f.col)) {
      resolved = false;
      issues.push(mkIssue(
        `filter_${i}_missing_col`, 'filter', 'filterSort', `filter_${i}`,
        `Filter column "${f.col}" is not available`,
        { missingColumn: f.col },
      ));
    }

    // Validate vals is an array of strings
    if (!Array.isArray(f.vals)) {
      resolved = false;
      issues.push(mkIssue(
        `filter_${i}_bad_vals`, 'filter', 'filterSort', `filter_${i}`,
        `Filter "${f.col || '(no column)'}" has malformed values`,
      ));
    } else if (f.vals.some((v: string) => typeof v !== 'string')) {
      resolved = false;
      issues.push(mkIssue(
        `filter_${i}_bad_vals`, 'filter', 'filterSort', `filter_${i}`,
        `Filter "${f.col || '(no column)'}" has malformed values`,
      ));
    }

    mkItem(`filter_${i}`, enabled, resolved, issues);
  }

  // ── Sorts ────────────────────────────────────────────────────────────────

  for (let i = 0; i < (state.sorts || []).length; i++) {
    const s = state.sorts[i];
    const enabled = s.enabled !== false;
    let resolved = true;
    const issues: ValidationIssue[] = [];

    if (s.col && !projected.has(s.col)) {
      resolved = false;
      issues.push(mkIssue(
        `sort_${i}_missing_col`, 'sort', 'filterSort', `sort_${i}`,
        `Sort column "${s.col}" is not available`,
        { missingColumn: s.col },
      ));
    }

    mkItem(`sort_${i}`, enabled, resolved, issues);
  }

  // ── Group By (group mode only) ───────────────────────────────────────────

  if (state.aggMode === 'group') {
    for (let i = 0; i < (state.groupBy || []).length; i++) {
      const col = state.groupBy[i];
      const resolved = projected.has(col);
      const issues: ValidationIssue[] = [];
      if (!resolved) {
        issues.push(mkIssue(
          `groupby_${i}_missing_col`, 'groupBy', 'aggregation', `groupby_${i}`,
          `Group-by column "${col}" is not available`,
          { missingColumn: col },
        ));
      }
      mkItem(`groupby_${i}`, true, resolved, issues);
    }

    // Validate aggregates
    for (let i = 0; i < (state.aggregates || []).length; i++) {
      const agg = state.aggregates[i];
      const issues: ValidationIssue[] = [];
      let resolved = true;
      const needsCol = aggregateNeedsColumn(agg.fn);
      if (needsCol && agg.col && agg.col !== '*' && !projected.has(agg.col)) {
        resolved = false;
        issues.push(mkIssue(
          `agg_${i}_missing_col`, 'aggregate', 'aggregation', `agg_${i}`,
          `Aggregate column "${agg.col}" is not available`,
          { missingColumn: agg.col },
        ));
      }
      if (!isValidAggregateFn(agg.fn)) {
        resolved = false;
        issues.push(mkIssue(
          `agg_${i}_invalid_fn`, 'aggregate', 'aggregation', `agg_${i}`,
          `Unknown aggregate function "${agg.fn}"`,
        ));
      }
      mkItem(`agg_${i}`, true, resolved, issues);
    }
  }

  // ── Totals (totals mode only) ────────────────────────────────────────────

  if (state.aggMode === 'totals') {
    for (const [col, fn] of Object.entries(state.colTotals || {})) {
      if (!fn || fn === 'skip') continue;
      let resolved = projected.has(col);
      const issues: ValidationIssue[] = [];
      if (!resolved) {
        issues.push(mkIssue(
          `totals_${col}_missing_col`, 'totals', 'aggregation', `totals_${col}`,
          `Totals column "${col}" is not available`,
          { missingColumn: col },
        ));
      }
      if (!isValidTotalFn(fn)) {
        resolved = false;
        issues.push(mkIssue(
          `totals_${col}_invalid_fn`, 'totals', 'aggregation', `totals_${col}`,
          `Unknown totals function "${fn}" for column "${col}"`,
        ));
      }
      // Warn about advanced calc columns that produce incorrect totals
      const src = colMap.get(col);
      if (src?.kind === 'calc') {
        const calcObj = (src as { calc?: Record<string, unknown> }).calc;
        const mathOp = calcObj?.mathOp as string | undefined;
        if (mathOp === 'PCTTOTAL' || mathOp === 'ROLLAVG') {
          issues.push(mkIssue(
            `totals_${col}_advanced_calc`, 'totals', 'aggregation', `totals_${col}`,
            `"${col}" is a ${mathOp === 'PCTTOTAL' ? '% of Total' : 'Rolling Average'} calculated column — set its total function to "Skip" to avoid incorrect results`,
          ));
        }
      }
      mkItem(`totals_${col}`, true, resolved, issues);
    }
  }

  // ── Subtotals (subtotals mode only) ──────────────────────────────────────

  if (state.aggMode === 'subtotals') {
    // Validate subtotal strategy
    const strat = state.subtotalStrategy;
    if (strat !== undefined && strat !== 'combined' && strat !== 'nested') {
      mkItem('subtotalStrategy', true, false, [
        mkIssue(
          'subtotalStrategy_invalid', 'subtotalStrategy', 'aggregation', 'subtotalStrategy',
          `Unknown subtotal strategy "${strat}"`,
        ),
      ]);
    }

    // Validate subtotal-by columns
    for (let i = 0; i < (state.subtotalBy || []).length; i++) {
      const col = state.subtotalBy[i];
      const resolved = projected.has(col);
      const issues: ValidationIssue[] = [];
      if (!resolved) {
        issues.push(mkIssue(
          `subtotalby_${i}_missing_col`, 'subtotalBy', 'aggregation', `subtotalby_${i}`,
          `Subtotal group column "${col}" is not available`,
          { missingColumn: col },
        ));
      }
      mkItem(`subtotalby_${i}`, true, resolved, issues);
    }

    // Validate subtotal functions per column
    for (const [col, fn] of Object.entries(state.subtotalFns || {})) {
      if (!fn || fn === 'skip') continue;
      let resolved = projected.has(col);
      const issues: ValidationIssue[] = [];
      if (!resolved) {
        issues.push(mkIssue(
          `subtotalfns_${col}_missing_col`, 'subtotalFns', 'aggregation', `subtotalfns_${col}`,
          `Subtotal column "${col}" is not available`,
          { missingColumn: col },
        ));
      }
      if (!isValidSubtotalFn(fn)) {
        resolved = false;
        issues.push(mkIssue(
          `subtotalfns_${col}_invalid_fn`, 'subtotalFns', 'aggregation', `subtotalfns_${col}`,
          `Unknown subtotals function "${fn}" for column "${col}"`,
        ));
      }
      // Warn about advanced calc columns that produce incorrect subtotals
      const src = colMap.get(col);
      if (src?.kind === 'calc') {
        const calcObj = (src as { calc?: Record<string, unknown> }).calc;
        const mathOp = calcObj?.mathOp as string | undefined;
        if (mathOp === 'PCTTOTAL' || mathOp === 'ROLLAVG') {
          issues.push(mkIssue(
            `subtotalfns_${col}_advanced_calc`, 'subtotalFns', 'aggregation', `subtotalfns_${col}`,
            `"${col}" is a ${mathOp === 'PCTTOTAL' ? '% of Total' : 'Rolling Average'} calculated column — set its subtotal function to "Skip" to avoid incorrect results`,
          ));
        }
      }
      mkItem(`subtotalfns_${col}`, true, resolved, issues);
    }
  }

  // ── Column Order (stale output columns) ──────────────────────────────────

  const outputAliases = new Set<string>();
  if (state.aggMode === 'group') {
    for (const agg of (state.aggregates || [])) {
      if (agg.alias) outputAliases.add(agg.alias);
    }
  }
  for (const calc of (state.calcStages || [])) {
    if (calc.alias) outputAliases.add(calc.alias);
  }

  const colOrderItems = (state.colOrder || []).filter(
    (a: string) => !projected.has(a) && !outputAliases.has(a),
  );
  for (let i = 0; i < colOrderItems.length; i++) {
    const col = colOrderItems[i];
    const issues: ValidationIssue[] = [mkIssue(
      `colorder_${i}_stale`, 'outputColumn', 'outputColumns', `colorder_${col}`,
      `Output column "${col}" is no longer available`,
      { missingColumn: col },
    )];
    const inSelCols = state.selCols instanceof Set ? state.selCols.has(col) : true;
    mkItem(`colorder_${col}`, inSelCols, false, issues);
  }

  // ── Merged Columns ───────────────────────────────────────────────────────

  for (const col of (state.mergedCols || [])) {
    if (!projected.has(col)) {
      const issues: ValidationIssue[] = [mkIssue(
        `merge_${col}_missing`, 'mergeDisplay', 'outputColumns', `merge_${col}`,
        `Merge-display column "${col}" is not available`,
        { missingColumn: col },
      )];
      mkItem(`merge_${col}`, true, true, issues);
    }
  }

  // ── Card Aggregation ─────────────────────────────────────────────────────

  function cardFor(itemId: string): string {
    if (itemId === 'base' || itemId === 'aggMode' || itemId.startsWith('stack_') ||
        itemId.startsWith('lookup_') || itemId.startsWith('detailband_') ||
        itemId.startsWith('calc_')) return 'pipeline';
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
