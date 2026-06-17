/**
 * Pipeline engine — orchestrates sequential stage execution with temp tables.
 *
 * Runs the six pipeline stages (base → lookups → calcs → filters → sorts →
 * aggregation) in order, each creating a temp table from the previous stage's
 * output. Supports stage caching: stages already executed are reused without
 * re-running.
 *
 * Module-level singleton accessed via getPipelineEngine() / getPipelineState().
 */

import type { ReportSpec, DbTable } from '../types';
import type { StageContext, StageResult } from './pipeline-stages/base';
import { executeBaseStage } from './pipeline-stages/base';
import { executeLookupStage } from './pipeline-stages/lookups';
import { executeCalcStage } from './pipeline-stages/calcs';
import { executeFilterStage } from './pipeline-stages/filters';
import { executeSortStage } from './pipeline-stages/sorts';
import { executeAggregationStage } from './pipeline-stages/aggregation';
import { execQuery, quoteId, dropTable } from '../core/sqldb';
import { buildQueryPlan } from '../query/query-plan';
import type { QueryPlanConfigs } from '../query/query-plan';
import { buildResultSet } from './result-set';
import type { ResultSet } from './result-set';
import { invalidateValidation } from './validation';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Transient pipeline execution state (not serialized to .rcjson). */
export interface PipelineState {
  /** Index of the last successfully executed stage (-1 = none). */
  validUpToStage: number;
  /** Temp table names per stage index. */
  tempTableNames: string[];
}

// ── Stage registry ─────────────────────────────────────────────────────────────

/** Ordered list of stage functions — index matches stage index. */
const STAGE_FUNCTIONS = [
  executeBaseStage,
  executeLookupStage,
  executeCalcStage,
  executeFilterStage,
  executeSortStage,
  executeAggregationStage,
] as const;

// ── PipelineEngine ─────────────────────────────────────────────────────────────

export class PipelineEngine {
  private state: PipelineState = { validUpToStage: -1, tempTableNames: [] };

  /** Per-stage output columns (internal — not exposed via PipelineState). */
  private _stageOutputColumns: string[][] = [];

  /**
   * Execute the full pipeline and return a ResultSet.
   *
   * @param reportSpec     - The typed report specification.
   * @param tables         - Raw table definitions keyed by table ID.
   * @param prebuiltConfigs - Optional pre-built query plan configs (avoids
   *                          rebuilding catalogs when caller already has them).
   * @returns A ResultSet with columns, rows, and metadata.
   */
  execute(
    reportSpec: ReportSpec,
    tables: Record<string, DbTable>,
    prebuiltConfigs?: QueryPlanConfigs,
  ): ResultSet {
    const configs = prebuiltConfigs ?? buildQueryPlan(reportSpec, tables);

    let prevTableName = '';
    let outputColumns: string[] = [];
    let stagesExecuted = false;

    for (let i = 0; i < STAGE_FUNCTIONS.length; i++) {
      // Stage caching: reuse existing temp table if already executed
      if (i <= this.state.validUpToStage && this.state.tempTableNames[i]) {
        prevTableName = this.state.tempTableNames[i];
        outputColumns = this._stageOutputColumns[i] ?? [];
        continue;
      }

      // Build context for this stage
      const ctx: StageContext = {
        reportSpec,
        tables,
        colMap: configs.colMap,
        sourceCatalog: configs.sourceCatalog,
        prevTableName,
        stageIndex: i,
        outputColumns,
      };

      // Execute the stage
      const result: StageResult = STAGE_FUNCTIONS[i](ctx);

      // Update state
      this.state.tempTableNames[i] = result.outputTableName;
      this._stageOutputColumns[i] = result.outputColumns;
      this.state.validUpToStage = i;
      stagesExecuted = true;

      // Advance to next stage
      prevTableName = result.outputTableName;
      outputColumns = result.outputColumns;
    }

    // Invalidate validation cache after stage execution
    if (stagesExecuted) {
      invalidateValidation();
    }

    // Fetch rows from the final temp table
    const finalTableName = prevTableName;
    const aggMode = configs.aggMode;

    // Determine display columns (exclude internal marker columns)
    const displayCols = outputColumns.filter(
      c => !c.startsWith('_row_type') && !c.startsWith('_sort_'),
    );

    // Mode-specific post-processing
    if (aggMode === 'totals') {
      return this.buildTotalsResult(finalTableName, displayCols, outputColumns);
    }

    if (aggMode === 'subtotals') {
      const rows = execQuery(`SELECT * FROM ${quoteId(finalTableName)}`);
      return buildResultSet(displayCols, rows, {
        aggMode: 'subtotals',
        hasSubtotals: true,
        allCols: outputColumns,
      });
    }

    if (aggMode === 'group') {
      const rows = execQuery(`SELECT * FROM ${quoteId(finalTableName)}`);
      return buildResultSet(displayCols, rows, { aggMode: 'group' });
    }

    // Detail mode ('none')
    const rows = execQuery(`SELECT * FROM ${quoteId(finalTableName)}`);
    return buildResultSet(displayCols, rows, { aggMode: 'none' });
  }

  /**
   * Build a ResultSet for totals mode — separate detail rows from totals row.
   */
  private buildTotalsResult(
    tableName: string,
    displayCols: string[],
    _allOutputColumns: string[],
  ): ResultSet {
    const allRows = execQuery(`SELECT * FROM ${quoteId(tableName)}`);

    // Separate detail rows (_row_type=0) from totals row (_row_type=1)
    const detailRows: Record<string, unknown>[] = [];
    let totalsRow: Record<string, unknown> | null = null;

    for (const row of allRows) {
      if (row['_row_type'] === 1) {
        totalsRow = row;
      } else {
        detailRows.push(row);
      }
    }

    return buildResultSet(displayCols, detailRows, {
      aggMode: 'totals',
      totalsRow,
    });
  }

  /**
   * Invalidate all stages after the given index.
   * Drops downstream temp tables and updates validUpToStage.
   */
  invalidateFromStage(stageIndex: number): void {
    for (let i = stageIndex + 1; i < this.state.tempTableNames.length; i++) {
      const name = this.state.tempTableNames[i];
      if (name) {
        dropTable(name);
        this.state.tempTableNames[i] = '';
        this._stageOutputColumns[i] = [];
      }
    }
    this.state.validUpToStage = Math.min(this.state.validUpToStage, stageIndex);
  }

  /**
   * Drop all pipeline temp tables and reset state.
   */
  cleanup(): void {
    for (const name of this.state.tempTableNames) {
      if (name) dropTable(name);
    }
    this.state = { validUpToStage: -1, tempTableNames: [] };
    this._stageOutputColumns = [];
  }

  /**
   * Returns the current pipeline state.
   */
  getState(): PipelineState {
    return this.state;
  }
}

// ── Module-level singleton ─────────────────────────────────────────────────────

const _engine = new PipelineEngine();

/** Returns the module-level pipeline state (for preview builder and detail bands). */
export function getPipelineState(): PipelineState {
  return _engine.getState();
}

/** Returns the module-level pipeline engine singleton. */
export function getPipelineEngine(): PipelineEngine {
  return _engine;
}

/**
 * Read actual column names from a temp table via PRAGMA table_info.
 * Returns an empty array if the table doesn't exist.
 */
export function getTempTableColumns(tableName: string): string[] {
  try {
    const rows = execQuery(`PRAGMA table_info(${quoteId(tableName)})`);
    return rows.map(r => r['name'] as string).filter(Boolean);
  } catch {
    return [];
  }
}
