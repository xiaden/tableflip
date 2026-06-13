/**
 * Aggregation function constants and validators.
 *
 * Defines the supported aggregate functions (SUM, AVG, COUNT, etc.),
 * total/subtotal function sets, aggregation modes, and lookup helpers.
 *
 * Ported from SRC/js/ui/components/aggregation-constants.ts — zero imports from SRC/js/.
 */

import type { AggMode } from '../types';

// ── Aggregate functions ─────────────────────────────────────────────────────────

/** Aggregate function names available for column aggregation. */
export const AGG_FNS = [
  'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
  'FIRST', 'LAST',
  'DATE RANGE', 'DATE SPAN',
  'NUMERIC RANGE', 'NUMERIC SPAN',
  'LIST',
] as const;

/** Display labels for each aggregate function. */
export const AGG_LABELS: Record<string, string> = {
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

/**
 * Check whether an aggregate function requires a column reference.
 * `COUNT ROWS` operates on `*` and does not need a specific column.
 * @param fn - Aggregate function name
 * @returns `true` if the function needs a column, `false` for COUNT ROWS
 */
export const AGG_NEEDS_COL = (fn: string): boolean => fn !== 'COUNT ROWS';

// ── Total functions ─────────────────────────────────────────────────────────────

/** Function names available for column totals (includes 'skip'). */
export const TOTAL_FNS = [
  'skip', 'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT', 'LIST',
] as const;

/** Display labels for each total function. */
export const TOTAL_LABELS: Record<string, string> = {
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

// ── Subtotal functions ──────────────────────────────────────────────────────────

/** Function names available for subtotals (includes 'skip'). */
export const SUBTOTAL_FNS = [
  'skip',
  'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
  'FIRST', 'LAST',
  'DATE RANGE', 'DATE SPAN',
  'NUMERIC RANGE', 'NUMERIC SPAN',
  'LIST',
] as const;

/** Display labels for each subtotal function. */
export const SUBTOTAL_LABELS: Record<string, string> = {
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

// ── Aggregation modes ───────────────────────────────────────────────────────────

/**
 * All supported aggregation modes, matching the {@link AggMode} type.
 * Controls how the query engine groups and aggregates results.
 */
export const AGG_MODES: readonly AggMode[] = ['none', 'group', 'totals', 'subtotals'] as const;

// ── Label lookup helpers ────────────────────────────────────────────────────────

/**
 * Get the display label for an aggregate function.
 * Falls back to the raw function name if no label is found.
 * @param fn - Aggregate function name
 * @returns Human-readable label
 */
export function getAggregateLabel(fn: string): string {
  return AGG_LABELS[fn] || fn;
}

/**
 * Get the display label for a total function.
 * Falls back to the raw function name if no label is found.
 * @param fn - Total function name
 * @returns Human-readable label
 */
export function getTotalLabel(fn: string): string {
  return TOTAL_LABELS[fn] || fn;
}

/**
 * Get the display label for a subtotal function.
 * Falls back to the raw function name if no label is found.
 * @param fn - Subtotal function name
 * @returns Human-readable label
 */
export function getSubtotalLabel(fn: string): string {
  return SUBTOTAL_LABELS[fn] || fn;
}

// ── Validation helpers ──────────────────────────────────────────────────────────

/**
 * Check whether a string is a valid aggregate function name.
 * @param fn - Function name to validate
 * @returns `true` if fn is in {@link AGG_FNS}
 */
export function isValidAggregateFn(fn: string): boolean {
  return (AGG_FNS as readonly string[]).includes(fn);
}

/**
 * Check whether a string is a valid total function name.
 * @param fn - Function name to validate
 * @returns `true` if fn is in {@link TOTAL_FNS}
 */
export function isValidTotalFn(fn: string): boolean {
  return (TOTAL_FNS as readonly string[]).includes(fn);
}

/**
 * Check whether a string is a valid subtotal function name.
 * @param fn - Function name to validate
 * @returns `true` if fn is in {@link SUBTOTAL_FNS}
 */
export function isValidSubtotalFn(fn: string): boolean {
  return (SUBTOTAL_FNS as readonly string[]).includes(fn);
}

/**
 * Check whether an aggregate function requires a column reference.
 * Delegates to {@link AGG_NEEDS_COL}.
 * @param fn - Aggregate function name
 * @returns `true` if the function needs a column, `false` for COUNT ROWS
 */
export function aggregateNeedsColumn(fn: string): boolean {
  return AGG_NEEDS_COL(fn);
}
