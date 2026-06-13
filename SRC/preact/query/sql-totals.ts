/**
 * SQL totals query generation.
 *
 * Generates a SQL query that produces a single totals row — one aggregate row
 * over the entire filtered dataset. Each column with a configured aggregate
 * function gets an aggregate expression; other columns get NULL.
 *
 * Ported from SRC/js/query/sql-totals.ts — rewritten as a pure function
 * with explicit parameters (no global state dependency).
 */

import type { ReportSpec } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { SourceTableEntry } from '../catalog/source-catalog';
import { quoteId } from '../core/sqldb';
import { renderAggregateExpr } from './sql-aggregates';
import { buildWhere } from './sql-where';
import { buildJoins } from './sql-joins';
import { resolveRef } from './resolve-ref';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Result of totals query generation. */
export interface TotalsQueryResult {
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
 * Build a totals query from a report specification.
 *
 * Generates a SELECT statement that collapses all detail rows into a single
 * aggregate row. Columns with configured aggregate functions (from `colTotals`)
 * are aggregated; other columns are NULL.
 *
 * @param reportSpec    - The report specification defining base table, lookups,
 *                         filters, output columns, and aggregation config.
 * @param colMap        - Column alias → source mapping (from buildColumnCatalog).
 *                         Used to resolve column aliases to physical SQL references.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 *                         Used by buildJoins to resolve table references.
 * @param calcExprs     - Map of column alias → calculated SQL expression. When an alias
 *                         is found in this map, the calc expression is used as the inner
 *                         reference for aggregate expressions (e.g. SUM(<calc_expr>))
 *                         instead of resolving to a physical reference. Defaults to an empty Map.
 * @returns `{ sql, params, cols }` — the complete SQL query, parameterized values,
 *           and ordered list of projected column aliases. Returns `null` if no
 *           columns have configured totals (i.e. all are 'skip' or absent).
 */
export function buildTotalsQuery(
  reportSpec: ReportSpec,
  colMap: Map<string, ColMapEntry>,
  sourceCatalog: Map<string, SourceTableEntry>,
  calcExprs: Map<string, string> = new Map(),
): TotalsQueryResult | null {
  if (!reportSpec.pipeline.base) throw new Error('No base table in reportSpec');

  const colTotals = reportSpec.aggregation.colTotals || {};

  // ── Determine projected columns ──────────────────────────────────────────
  // Use outputColumns if set (and non-empty), otherwise project all colMap keys.
  const outputCols = reportSpec.outputColumns;
  const projected: string[] = (outputCols && outputCols.length > 0)
    ? outputCols.filter(alias => colMap.has(alias))
    : [...colMap.keys()];

  // Skip band columns — they have no JOIN in the parent FROM clause
  const filteredProjected = projected.filter(alias => {
    const entry = colMap.get(alias);
    return !entry || entry.kind !== 'band';
  });

  // Check if any column has a non-'skip' total configured
  const hasAny = filteredProjected.some(c => colTotals[c] && colTotals[c] !== 'skip');
  if (!hasAny) return null;

  // ── SELECT clause ────────────────────────────────────────────────────────
  const selParts: string[] = [];
  for (const alias of filteredProjected) {
    const fn = colTotals[alias];
    if (!fn || fn === 'skip') {
      selParts.push(`NULL AS ${quoteId(alias)}`);
    } else {
      const calcExpr = calcExprs.get(alias);
      const innerRef = calcExpr ?? resolveRef(alias, colMap);
      selParts.push(`${renderAggregateExpr(fn, innerRef)} AS ${quoteId(alias)}`);
    }
  }
  if (!selParts.length) selParts.push('*');

  // ── FROM clause ──────────────────────────────────────────────────────────
  const fromClause = quoteId(reportSpec.pipeline.base);

  // ── JOIN clause ──────────────────────────────────────────────────────────
  const lookups = reportSpec.pipeline.lookups || [];
  const { joins: joinClause, params: joinParams } = buildJoins(lookups, colMap, sourceCatalog);

  // ── WHERE clause ─────────────────────────────────────────────────────────
  const filters = reportSpec.filters || [];
  const { where: whereClause, params: whereParams } = buildWhere(filters, colMap);

  // ── Assemble query ───────────────────────────────────────────────────────
  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClause) sql += '\n' + joinClause;
  if (whereClause) sql += '\nWHERE ' + whereClause;

  // Merge params: JOIN params come first, then WHERE params
  const params = [...joinParams, ...whereParams];

  return { sql, params, cols: filteredProjected };
}
