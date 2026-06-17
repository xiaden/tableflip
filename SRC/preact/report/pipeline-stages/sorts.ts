/**
 * Sort pipeline stage — applies ORDER BY to the current pipeline temp table.
 *
 * Builds ORDER BY clause using quoteId(alias) for flat temp table column
 * references. No resolveRef import — that would produce source-qualified
 * "tid"."col" refs that fail against the temp table.
 */

import type { StageContext, StageResult } from './base';
import { quoteId, execQuery } from '../../core/sqldb';

/**
 * Execute the sort stage — apply ORDER BY to the previous pipeline temp table.
 *
 * Pass-through when no sorts are enabled. Otherwise creates
 * `_pipeline_stage_4` via SELECT * FROM prevTable ORDER BY ...
 *
 * Each enabled sort maps to `quoteId(col) ASC|DESC`, joined with `, `.
 */
export function executeSortStage(ctx: StageContext): StageResult {
  const { reportSpec, prevTableName, outputColumns } = ctx;
  const sorts = reportSpec.sorts ?? [];

  // Filter to enabled sorts with a column
  const enabledSorts = sorts.filter(s => s.enabled !== false && s.col);

  // Pass-through when no enabled sorts
  if (enabledSorts.length === 0) {
    return { outputTableName: prevTableName, outputColumns };
  }

  // Build ORDER BY clause
  const sortParts = enabledSorts.map(s =>
    `${quoteId(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`,
  );

  const outputTableName = '_pipeline_stage_4';
  const sql = `CREATE TEMP TABLE ${quoteId(outputTableName)} AS SELECT * FROM ${quoteId(prevTableName)} ORDER BY ${sortParts.join(', ')}`;
  execQuery(sql);

  return { outputTableName, outputColumns };
}
