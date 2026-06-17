/**
 * Calculated columns pipeline stage — appends computed columns to the
 * current pipeline temp table.
 *
 * Uses buildCalcExpressions from the query layer, then post-processes
 * the resulting SQL to strip `"tableName".` prefixes so column references
 * work against the flat temp table instead of the original source tables.
 */

import type { StageContext, StageResult } from './base';
import { quoteId, execQuery } from '../../core/sqldb';
import { buildCalcExpressions } from '../../query/sql-calcs';

/**
 * Execute the calculated columns stage — append computed expressions
 * to the previous pipeline temp table.
 *
 * Pass-through when no calculated columns are enabled or when
 * buildCalcExpressions produces no valid expressions. Otherwise creates
 * `_pipeline_stage_2` via SELECT *, <calc_exprs> FROM prevTable.
 *
 * IMPORTANT: buildCalcExpressions produces SQL with "tid"."col" references
 * (via resolveRef). These are post-processed to strip the "tid". prefix
 * since the flat temp table has unqualified column names.
 */
export function executeCalcStage(ctx: StageContext): StageResult {
  const { reportSpec, colMap, prevTableName, outputColumns } = ctx;
  const calcStages = reportSpec.pipeline.calculatedColumns ?? [];

  // Filter to enabled calc stages
  const enabledCalcs = calcStages.filter(c => c.enabled !== false);

  // Pass-through when no enabled calcs
  if (enabledCalcs.length === 0) {
    return { outputTableName: prevTableName, outputColumns };
  }

  // Build calc expressions using the existing query-layer function
  const calcExprs = buildCalcExpressions(enabledCalcs, colMap);

  // Pass-through when no valid expressions were generated
  if (calcExprs.length === 0) {
    return { outputTableName: prevTableName, outputColumns };
  }

  // Post-process: strip "tableName". prefixes from calc SQL.
  // buildCalcExpressions uses resolveRef which produces "tid"."col" refs,
  // but in the flat temp table context columns are unqualified.
  // Regex matches "quotedIdentifier". and removes it, leaving just "col".
  const stripTablePrefix = (sql: string): string =>
    sql.replace(/"(?:[^"]|"")*"\./g, '');

  const selectParts = calcExprs.map(
    ({ alias, sql }) => `${stripTablePrefix(sql)} AS ${quoteId(alias)}`,
  );

  const outputTableName = '_pipeline_stage_2';
  const sql = `CREATE TEMP TABLE ${quoteId(outputTableName)} AS SELECT *, ${selectParts.join(', ')} FROM ${quoteId(prevTableName)}`;
  execQuery(sql);

  // Output columns: existing + new calc aliases
  const newAliases = calcExprs.map(e => e.alias);
  return {
    outputTableName,
    outputColumns: [...outputColumns, ...newAliases],
  };
}
