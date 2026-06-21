/**
 * Aggregation helpers — subtotal toggles and aggregate item management.
 *
 * Provides store-mutating helpers for aggregation-related UI operations:
 * subtotal grand total, spacer, on-top, strategy toggles, and
 * add/remove/touch for aggregate rows.
 *
 * Ported from SRC/js/ui/aggregation.ts. Key differences:
 * - No direct DOM manipulation — rendering is handled by React/MUI components
 * - No window assignments
 * - State mutations go through store.update() instead of direct db mutation
 * - renderAggregation/renderSubtotalsSection replaced by store-driven reactivity
 */

import { getStore } from '../core/store';
import type { AggregateSpec } from '../types';

// ── Subtotal helpers ──────────────────────────────────────────────────────────

export function setSubtotalGrandTotal(checked: boolean): void {
  getStore().update(draft => { draft.subtotalGrandTotal = !!checked; });
}

export function setSubtotalSpacer(checked: boolean): void {
  getStore().update(draft => { draft.subtotalSpacer = !!checked; });
}

export function setSubtotalOnTop(checked: boolean): void {
  getStore().update(draft => { draft.subtotalOnTop = !!checked; });
}

export function setSubtotalStrategy(value: string): void {
  getStore().update(draft => { draft.subtotalStrategy = value === 'nested' ? 'nested' : 'combined'; });
}

// ── Aggregate item helpers ────────────────────────────────────────────────────

/** Add a new aggregate row to the current report. */
export function addAggregate(): void {
  getStore().update(draft => {
    // Find a column not already in groupBy
    const allCols = draft.colOrder || [];
    const col = allCols.find(c => !draft.groupBy.includes(c)) || allCols[0] || '';
    (draft.aggregates as Array<AggregateSpec & { auto: boolean }>).push({
      fn: 'SUM', col, alias: '', auto: false,
    });
  });
}

/** Remove an aggregate row by index. */
export function removeAggregate(i: number): void {
  getStore().update(draft => {
    draft.aggregates.splice(i, 1);
  });
}

/** Mark an aggregate row as manually edited (no longer auto). */
export function touchAggregate(i: number): void {
  getStore().update(draft => {
    if (draft.aggregates[i]) {
      (draft.aggregates[i] as AggregateSpec & { auto?: boolean }).auto = false;
    }
  });
}
