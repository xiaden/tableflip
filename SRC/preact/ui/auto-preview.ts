/**
 * Auto-preview module — debounced report execution triggered by store state changes.
 *
 * Subscribes to the global store and, on every meaningful state change (excluding
 * transient _ui-only mutations), schedules a report re-execution after a 400ms
 * debounce window. Includes a reentry guard so overlapping executions are queued
 * rather than interleaved, and a content-hash check to skip execution when the
 * pipeline-affecting state has not materially changed.
 *
 * This module is NOT a React component — it is a module-level singleton with
 * lifecycle functions (init / destroy) and a manual trigger (schedulePreview).
 */

import { getStore } from '../core/store';
import { runReport } from '../report/engine';
import { createReportSpec } from '../core/state';
import { refreshResultGridLayout } from './grid';
import type { AppState, ReportSpec } from '../types';

// ── Module-level state (NOT exported) ──────────────────────────────────────────

let _timer: ReturnType<typeof setTimeout> | null = null;
let _running = false;
let _queued = false;
let _lastHash: string | null = null;
let _unsubscribe: (() => void) | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Produce a JSON-serializable snapshot of state with the transient _ui key removed.
 * Used to detect whether a store change was purely a UI-only mutation (sidebar
 * collapse, column widths) that should NOT trigger a report re-execution.
 */
function stateFingerprint(s: AppState): string {
  const { _ui: _ignored, ...rest } = s;
  void _ignored;
  return JSON.stringify(rest, (_key, value) =>
    value instanceof Set ? [...value].sort() : value
  );
}

/**
 * Build a full ReportSpec from the current AppState, using createReportSpec()
 * as the structural base and overwriting every pipeline-affecting field.
 */
function buildReportSpecFromAppState(state: AppState): ReportSpec {
  const spec = createReportSpec();

  // Pipeline
  spec.pipeline.base = state.base;
  spec.pipeline.baseCols = state.baseCols;
  spec.pipeline.stacks = state.stacks;
  spec.pipeline.lookups = state.lookups;
  spec.pipeline.calculatedColumns = state.calcStages;
  spec.pipeline.detailBands = state.detailBands || [];
  spec.pipeline.includeSourceColumn = state.includeSourceColumn;
  spec.pipeline.sourceColumnName = state.sourceColumnName;
  spec.pipeline.stackAliases = state.stackAliases || {};

  // Output columns
  spec.outputColumns = state.colOrder;

  // Filters & sorts
  spec.filters = state.filters;
  spec.sorts = state.sorts;

  // Aggregation
  spec.aggregation.mode = state.aggMode;
  spec.aggregation.groupBy = state.groupBy;
  spec.aggregation.aggregates = state.aggregates;
  spec.aggregation.colTotals = state.colTotals;
  spec.aggregation.subtotalBy = state.subtotalBy;
  spec.aggregation.subtotalFns = state.subtotalFns;
  spec.aggregation.subtotalGrandTotal = state.subtotalGrandTotal;
  spec.aggregation.subtotalSpacer = state.subtotalSpacer;
  spec.aggregation.subtotalOnTop = state.subtotalOnTop;
  spec.aggregation.subtotalStrategy = state.subtotalStrategy;

  // Merge display
  spec.mergeDisplay.mergedCols = state.mergedCols;
  spec.mergeDisplay.mergeGroupUnderline = state.mergeGroupUnderline;

  return spec;
}

// ── Internal execution ─────────────────────────────────────────────────────────

/**
 * Execute a preview run against the current store state.
 *
 * Reentry guard: if an execution is already in flight (_running), sets _queued
 * so that a follow-up execution fires when the current one completes. This
 * prevents overlapping runReport calls while ensuring the latest state is
 * always eventually executed.
 *
 * Hash check: computes JSON.stringify(buildReportSpecFromAppState(state)) and
 * skips execution when the hash matches _lastHash (no material change since
 * the last successful run).
 */
function executePreview(): void {
  if (_running) {
    _queued = true;
    return;
  }
  _running = true;

  try {
    const state = getStore().getState();

    // Skip if no base table is configured
    if (!state.base || !state.tables[state.base]) {
      return;
    }

    // Content hash — all report-affecting fields (buildReportSpecFromAppState
    // covers pipeline, filters, sorts, aggregation, output columns, and merge)
    const reportSpec = buildReportSpecFromAppState(state);
    const hash = JSON.stringify(reportSpec);
    if (hash === _lastHash) {
      return;
    }

    // Run the report
    const result = runReport(reportSpec, state.tables);

    // Store the result and update the hash
    getStore().set('result', result as unknown as Record<string, unknown>);
    _lastHash = hash;

    // Refresh the AG Grid to reflect the new result
    refreshResultGridLayout();
  } catch (err) {
    // Log but don't crash — the next state change will retry
    console.error('[auto-preview] Report execution failed:', err);
  } finally {
    _running = false;
    if (_queued) {
      _queued = false;
      executePreview();
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to store changes and start the auto-preview debounce loop.
 *
 * On every store change, compares the new state against the previous state
 * (excluding the transient _ui key). If any pipeline-affecting field changed,
 * schedules a debounced preview execution.
 *
 * Guarded against double initialization — calling initAutoPreview() when
 * already subscribed is a no-op.
 */
export function initAutoPreview(): void {
  if (_unsubscribe) return; // Already initialized

  let prevFingerprint = stateFingerprint(getStore().getState());

  _unsubscribe = getStore().subscribe((state: AppState) => {
    const nextFingerprint = stateFingerprint(state);
    if (nextFingerprint === prevFingerprint) {
      // Only _ui changed — skip scheduling
      return;
    }
    prevFingerprint = nextFingerprint;
    schedulePreview();
  });
}

/**
 * Unsubscribe from store changes, clear any pending debounce timer,
 * and reset internal execution state. Safe to call multiple times.
 */
export function destroyAutoPreview(): void {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  if (_timer !== null) {
    clearTimeout(_timer);
    _timer = null;
  }
  _running = false;
  _queued = false;
}

/**
 * Manually trigger a debounced preview check.
 *
 * Resets the 400ms debounce timer — if called again before the timer fires,
 * the previous timer is cleared and a new one starts. When the timer fires,
 * it calls executePreview() which performs the hash check and runs the report.
 *
 * Exported for cases where store subscription alone is not sufficient (e.g.,
 * after programmatic state loads that bypass the normal subscription path).
 */
export function schedulePreview(): void {
  if (_timer !== null) {
    clearTimeout(_timer);
  }
  _timer = setTimeout(() => {
    _timer = null;
    executePreview();
  }, 400);
}
