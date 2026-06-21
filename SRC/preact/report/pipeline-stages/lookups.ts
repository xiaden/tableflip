/**
 * Lookup pipeline stage — joins lookup tables to the current pipeline temp table.
 *
 * Builds manual JOIN clauses (no buildJoins import) because the left side
 * must reference the flat temp table, not the original source tables.
 */

import type { StageContext, StageResult } from './base';
import { quoteId, execQuery } from '../../core/sqldb';

/**
 * Execute the lookup stage — join enabled lookup tables to the previous
 * pipeline temp table.
 *
 * Pass-through when no lookups are enabled. Otherwise creates
 * `_pipeline_stage_1` via SELECT * FROM prevTable JOINs.
 *
 * Uses LEFT JOIN for non-required lookups, INNER JOIN for required.
 * JOIN conditions reference the temp table columns unqualified on the
 * left side, and the right table on the right side.
 */
export function executeLookupStage(ctx: StageContext): StageResult {
  const { reportSpec, sourceCatalog, prevTableName, outputColumns } = ctx;
  const lookups = reportSpec.pipeline.lookups ?? [];

  // Filter to enabled lookups with valid rightId
  const enabledLookups = lookups.filter(
    lk => lk.enabled !== false && lk.rightId,
  );

  // Pass-through when no enabled lookups
  if (enabledLookups.length === 0) {
    return { outputTableName: prevTableName, outputColumns };
  }

  // Build JOIN clauses manually
  const joinClauses: string[] = [];
  const newColNames: string[] = [];

  for (const lk of enabledLookups) {
    const rightEntry = sourceCatalog.get(lk.rightId);
    if (!rightEntry) continue;

    const validPairs = (lk.keyPairs ?? []).filter(p => p.left && p.right);
    if (validPairs.length === 0) continue;

    // LEFT JOIN for non-required, INNER JOIN for required
    const joinType = lk.required ? 'INNER' : 'LEFT';
    const rightTableQuoted = quoteId(lk.rightId);

    // ON conditions: left side is temp table column (qualified),
    // right side is the lookup table column
    const onConditions = validPairs.map(p =>
      `${quoteId(prevTableName)}.${quoteId(p.left)} = ${rightTableQuoted}.${quoteId(p.right)}`,
    );

    joinClauses.push(
      `${joinType} JOIN ${rightTableQuoted} ON ${onConditions.join(' AND ')}`,
    );

    // Track new columns from the right table
    for (const col of rightEntry.cols) {
      if (!newColNames.includes(col) && !outputColumns.includes(col)) {
        newColNames.push(col);
      }
    }
  }

  // If no valid joins were built, pass-through
  if (joinClauses.length === 0) {
    return { outputTableName: prevTableName, outputColumns };
  }

  const outputTableName = '_pipeline_stage_1';
  const sql = `CREATE TEMP TABLE ${quoteId(outputTableName)} AS SELECT * FROM ${quoteId(prevTableName)} ${joinClauses.join(' ')}`;
  execQuery(sql);

  return {
    outputTableName,
    outputColumns: [...outputColumns, ...newColNames],
  };
}
