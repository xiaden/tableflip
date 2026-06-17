/**
 * Filter pipeline stage — applies WHERE conditions to the current
 * pipeline temp table.
 *
 * Builds WHERE clause manually (no buildWhere import) because column
 * references must use quoteId(alias) for the flat temp table context,
 * not the source-qualified "tid"."col" refs that resolveRef produces.
 */

import type { StageContext, StageResult } from './base';
import { quoteId, execQuery } from '../../core/sqldb';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Escape LIKE wildcards for safe pattern matching. */
function likeEsc(v: string): string {
  return v.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Render a single filter operator as a SQL clause fragment.
 *
 * @param op - Operator name from FilterSpec
 * @param colRef - Quoted column reference (e.g. `"col"`)
 * @param val - Single comparison value
 * @param params - Mutable params array to push bound values into
 * @returns SQL clause string, or null if the operator is unrecognized
 */
function renderClause(
  op: string,
  colRef: string,
  val: string,
  params: unknown[],
): string | null {
  const txt = `CAST(${colRef} AS TEXT)`;

  switch (op) {
    case '=':
    case 'equals':
    case 'in':
      params.push(val);
      return `${txt} = ?`;
    case '!=':
    case '<>':
    case 'not equals':
    case 'not in':
      params.push(val);
      return `${txt} != ?`;
    case 'contains':
      params.push('%' + likeEsc(val) + '%');
      return `${txt} LIKE ? ESCAPE '\\'`;
    case 'not contains':
      params.push('%' + likeEsc(val) + '%');
      return `${txt} NOT LIKE ? ESCAPE '\\'`;
    case 'starts with':
      params.push(likeEsc(val) + '%');
      return `${txt} LIKE ? ESCAPE '\\'`;
    case 'ends with':
      params.push('%' + likeEsc(val));
      return `${txt} LIKE ? ESCAPE '\\'`;
    case '>':
    case 'greater than':
      params.push(val);
      return `${txt} > ?`;
    case '<':
    case 'less than':
      params.push(val);
      return `${txt} < ?`;
    case '>=':
    case 'greater than or equal':
      params.push(val);
      return `${txt} >= ?`;
    case '<=':
    case 'less than or equal':
      params.push(val);
      return `${txt} <= ?`;
    case 'is empty':
      return `(${txt} IS NULL OR ${txt} = '')`;
    case 'is not empty':
      return `(${txt} IS NOT NULL AND ${txt} != '')`;
    default:
      return null;
  }
}

/**
 * Render a single filter spec into a SQL expression.
 * Multiple values in vals produce OR-connected sub-expressions.
 * Returns null if the filter produces no valid SQL.
 */
function renderFilter(
  col: string,
  op: string,
  vals: string[],
  params: unknown[],
): string | null {
  const colRef = quoteId(col);
  const filterVals = vals.length > 0 ? vals : [''];

  const orParts: string[] = [];
  for (const v of filterVals) {
    const clause = renderClause(op, colRef, String(v ?? ''), params);
    if (clause) orParts.push(clause);
  }

  if (orParts.length === 0) return null;
  return orParts.length > 1 ? `(${orParts.join(' OR ')})` : orParts[0];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute the filter stage — apply WHERE conditions to the previous
 * pipeline temp table.
 *
 * Pass-through when no filters are enabled. Otherwise creates
 * `_pipeline_stage_3` via SELECT * FROM prevTable WHERE ...
 *
 * Filters are ANDed together. Multiple values within a single filter
 * (vals array) are ORed. All comparisons use CAST(col AS TEXT).
 */
export function executeFilterStage(ctx: StageContext): StageResult {
  const { reportSpec, prevTableName, outputColumns } = ctx;
  const filters = reportSpec.filters ?? [];

  // Filter to enabled filters with a column
  const enabledFilters = filters.filter(
    f => f.enabled !== false && f.col,
  );

  // Pass-through when no enabled filters
  if (enabledFilters.length === 0) {
    return { outputTableName: prevTableName, outputColumns };
  }

  // Build WHERE clause
  const params: unknown[] = [];
  const andParts: string[] = [];

  for (const f of enabledFilters) {
    const vals = Array.isArray(f.vals) && f.vals.length > 0 ? f.vals : [f.val ?? ''];
    const clause = renderFilter(f.col, f.op, vals as string[], params);
    if (clause) andParts.push(clause);
  }

  // If no valid clauses were built, pass-through
  if (andParts.length === 0) {
    return { outputTableName: prevTableName, outputColumns };
  }

  const whereClause = andParts.join(' AND ');
  const outputTableName = '_pipeline_stage_3';
  const sql = `CREATE TEMP TABLE ${quoteId(outputTableName)} AS SELECT * FROM ${quoteId(prevTableName)} WHERE ${whereClause}`;
  execQuery(sql, params);

  return { outputTableName, outputColumns };
}
