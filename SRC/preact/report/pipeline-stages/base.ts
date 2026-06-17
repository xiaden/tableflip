/**
 * Base pipeline stage — creates the initial temp table from base + stacked tables.
 *
 * Also exports the shared types used by all pipeline stage modules:
 * StageContext, StageResult, and StageFunction.
 */

import type { ReportSpec, DbTable } from '../../types';
import type { ColMapEntry } from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import { quoteId, execQuery } from '../../core/sqldb';

// ── Shared Stage Types ────────────────────────────────────────────────────────

/** Context passed to every pipeline stage function. */
export interface StageContext {
  reportSpec: ReportSpec;
  tables: Record<string, DbTable>;
  colMap: Map<string, ColMapEntry>;
  sourceCatalog: Map<string, SourceTableEntry>;
  prevTableName: string;
  stageIndex: number;
  outputColumns: string[];
}

/** Result returned by every pipeline stage function. */
export interface StageResult {
  outputTableName: string;
  outputColumns: string[];
}

/** A pipeline stage function — pure function from context to result. */
export type StageFunction = (ctx: StageContext) => StageResult;

// ── Base Stage ────────────────────────────────────────────────────────────────

/**
 * Execute the base stage — create `_pipeline_stage_0` via UNION ALL
 * across the base table and all stacked tables.
 *
 * Projects `reportSpec.pipeline.baseCols` (if non-empty) or all base table
 * columns. Missing columns per stack branch get NULL. When
 * `reportSpec.pipeline.includeSourceColumn` is true, appends a source sheet
 * name literal column to each branch.
 *
 * Always creates a temp table — no pass-through for the base stage.
 */
export function executeBaseStage(ctx: StageContext): StageResult {
  const { reportSpec, tables } = ctx;
  const pipeline = reportSpec.pipeline;

  const baseTid = pipeline.base;
  const baseTable = tables[baseTid];
  if (!baseTid || !baseTable) {
    throw new Error('executeBaseStage: no valid base table');
  }

  // Determine projected columns: explicit baseCols or all base table columns
  const explicitBaseCols = pipeline.baseCols ?? [];
  const projectedCols = explicitBaseCols.length > 0
    ? explicitBaseCols
    : baseTable.cols;

  if (projectedCols.length === 0) {
    throw new Error('executeBaseStage: no columns to project');
  }

  // Collect table IDs: base + valid stacks
  const stackTids = (pipeline.stacks ?? []).filter(tid => tables[tid]);
  const allTids = [baseTid, ...stackTids];

  // Source column configuration
  const includeSource = pipeline.includeSourceColumn === true;
  const sourceColName = pipeline.sourceColumnName || 'Source Sheet';

  // Build UNION ALL branches
  const branches: string[] = [];
  for (const tid of allTids) {
    const table = tables[tid];

    // Project each column: physical name if table has it, else NULL
    const colExprs = projectedCols.map(c =>
      table.cols.includes(c) ? quoteId(c) : 'NULL',
    );

    // Append source column literal when enabled
    if (includeSource) {
      const alias = pipeline.stackAliases?.[tid] ?? table.name;
      colExprs.push(`${JSON.stringify(alias)} AS ${quoteId(sourceColName)}`);
    }

    branches.push(`SELECT ${colExprs.join(', ')} FROM ${quoteId(tid)}`);
  }

  const sql = `CREATE TEMP TABLE ${quoteId('_pipeline_stage_0')} AS ${branches.join(' UNION ALL ')}`;
  execQuery(sql);

  // Compute output columns
  const outputColumns = [...projectedCols];
  if (includeSource) {
    outputColumns.push(sourceColName);
  }

  return {
    outputTableName: '_pipeline_stage_0',
    outputColumns,
  };
}
