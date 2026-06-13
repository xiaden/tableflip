/**
 * SQL grouped (aggregated) query generation.
 *
 * Generates a full SELECT query for group-by mode — group columns plus
 * aggregate expressions, WHERE, JOINs, GROUP BY, HAVING, and ORDER BY
 * combined into a complete SQL statement.
 *
 * Ported from SRC/js/query/sql-grouped.ts — rewritten as a pure function
 * with explicit parameters (no global state dependency).
 */

import type { ReportSpec } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { SourceTableEntry } from '../catalog/source-catalog';
import { quoteId } from '../core/sqldb';
import { renderAggregateExpr } from './sql-aggregates';
import { defaultAggAlias } from '../core/utils';
import { buildWhere } from './sql-where';
import { buildJoins } from './sql-joins';
import { resolveRef } from './resolve-ref';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Result of grouped (aggregated) query generation. */
export interface GroupedQueryResult {
  /** The complete SQL query string */
  sql: string;
  /** Parameterized values in order of appearance */
  params: unknown[];
  /** Ordered list of projected column aliases */
  cols: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────



// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build a full grouped (aggregated) SQL query from a report specification.
 *
 * Generates a complete SELECT statement with:
 * - Group columns with table-qualified references and AS aliases
 * - Aggregate expressions (SUM, COUNT, AVG, etc.) with AS aliases
 * - FROM clause for the base table
 * - JOIN clauses from lookup specifications
 * - WHERE clause from filter specifications
 * - GROUP BY clause from group-by columns
 * - HAVING clause (currently unused, reserved for future)
 * - ORDER BY clause from sort specifications
 *
 * @param reportSpec    - The report specification defining base table, lookups,
 *                         filters, sorts, output columns, and aggregation config.
 * @param colMap        - Column alias → source mapping (from buildColumnCatalog).
 *                         Used to resolve column aliases to physical SQL references.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 *                         Used by buildJoins to resolve table references.
 * @param calcExprs     - Map of column alias → calculated SQL expression. When an alias
 *                         is found in this map, the calc expression is used directly in
 *                         group columns and as the inner reference for aggregate expressions
 *                         instead of resolving to a physical reference. Defaults to an empty Map.
 * @returns `{ sql, params, cols }` — the complete SQL query, parameterized values,
 *           and ordered list of projected column aliases.
 */
export function buildGroupedQuery(
  reportSpec: ReportSpec,
  colMap: Map<string, ColMapEntry>,
  sourceCatalog: Map<string, SourceTableEntry>,
  calcExprs: Map<string, string> = new Map(),
): GroupedQueryResult {
  if (!reportSpec.pipeline.base) throw new Error('No base table in reportSpec');

  const groupByAliases = reportSpec.aggregation.groupBy || [];
  const aggregates = reportSpec.aggregation.aggregates || [];
  const hasAgg = groupByAliases.length > 0 || aggregates.length > 0;

  // Filter to selected output columns (null means all)
  const outputCols = reportSpec.outputColumns;
  const selColSet = (outputCols && outputCols.length > 0)
    ? new Set(outputCols)
    : null;

  // Helper: check if an alias is a band column (skip in main query SELECT)
  const isBand = (alias: string): boolean => {
    const entry = colMap.get(alias);
    return !!entry && entry.kind === 'band';
  };

  // ── SELECT clause ──────────────────────────────────────────────────────
  const selParts: string[] = [];
  const colAliases: string[] = [];
  const groupRefs: string[] = [];

  if (hasAgg) {
    // Group columns: only include if they pass the outputColumns filter
    for (const alias of groupByAliases) {
      if (selColSet && !selColSet.has(alias)) continue;
      if (isBand(alias)) continue;
      const calcExpr = calcExprs.get(alias);
      const ref = calcExpr ?? resolveRef(alias, colMap);
      selParts.push(`${ref} AS ${quoteId(alias)}`);
      groupRefs.push(ref);
      colAliases.push(alias);
    }
    // Aggregate expressions
    for (const agg of aggregates) {
      const colLabel = agg.col && agg.col !== '*' ? agg.col : 'all rows';
      const outName = agg.alias?.trim() || defaultAggAlias(agg.fn, colLabel);
      if (selColSet && !selColSet.has(outName)) continue;
      if (isBand(outName)) continue;
      const calcExpr = agg.col ? calcExprs.get(agg.col) : undefined;
      const colRef = agg.col && agg.col !== '*'
        ? (calcExpr ?? resolveRef(agg.col, colMap))
        : null;
      const expr = renderAggregateExpr(agg.fn, colRef || '*');
      selParts.push(`${expr} AS ${quoteId(outName)}`);
      colAliases.push(outName);
    }
  } else {
    // No aggregation — project all output columns
    const projected = selColSet
      ? [...colMap.keys()].filter(a => selColSet.has(a))
      : [...colMap.keys()];
    for (const alias of projected) {
      if (isBand(alias)) continue;
      const calcExpr = calcExprs.get(alias);
      if (calcExpr) {
        selParts.push(`${calcExpr} AS ${quoteId(alias)}`);
      } else {
        selParts.push(`${resolveRef(alias, colMap)} AS ${quoteId(alias)}`);
      }
      colAliases.push(alias);
    }
  }

  if (!selParts.length) selParts.push('*');

  // ── FROM clause ────────────────────────────────────────────────────────
  const fromClause = quoteId(reportSpec.pipeline.base);

  // ── JOIN clause ────────────────────────────────────────────────────────
  const lookups = reportSpec.pipeline.lookups || [];
  const { joins: joinClause, params: joinParams } = buildJoins(lookups, colMap, sourceCatalog);

  // ── WHERE clause ───────────────────────────────────────────────────────
  const filters = reportSpec.filters || [];
  const { where: whereClause, params: whereParams } = buildWhere(filters, colMap);

  // ── GROUP BY clause ────────────────────────────────────────────────────
  const groupByClause = groupRefs.length
    ? '\nGROUP BY ' + groupRefs.join(', ')
    : '';

  // ── ORDER BY clause ────────────────────────────────────────────────────
  const sorts = reportSpec.sorts || [];
  const sortParts = sorts
    .filter(s => s.enabled !== false)
    .filter(s => !isBand(s.col))
    .map(s => {
      const calcExpr = calcExprs.get(s.col);
      const sortRef = calcExpr ?? resolveRef(s.col, colMap);
      return `${sortRef} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`;
    });

  // ── Assemble query ─────────────────────────────────────────────────────
  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClause) sql += '\n' + joinClause;
  if (whereClause) sql += '\nWHERE ' + whereClause;
  if (groupByClause) sql += groupByClause;
  if (sortParts.length) sql += '\nORDER BY ' + sortParts.join(', ');

  // Merge params: JOIN params come first, then WHERE params
  const params = [...joinParams, ...whereParams];

  return { sql, params, cols: colAliases };
}
