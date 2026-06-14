/**
 * SQL detail (non-aggregated) query generation.
 *
 * Generates a full SELECT query for detail mode — all projected columns
 * with aliases, WHERE clauses, JOINs, ORDER BY, and LIMIT/OFFSET combined
 * into a complete SQL statement.
 *
 * Ported from SRC/js/query/sql-detail.ts — rewritten as a pure function
 * with explicit parameters (no global state dependency).
 */

import type { ReportSpec } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { SourceTableEntry } from '../catalog/source-catalog';
import { quoteId } from '../core/sqldb';
import { buildWhere } from './sql-where';
import { buildJoins } from './sql-joins';
import { resolveRef } from './resolve-ref';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Result of detail (non-aggregated) query generation. */
export interface DetailQueryResult {
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
 * Build a full detail (non-aggregated) SQL query from a report specification.
 *
 * Generates a complete SELECT statement with:
 * - All projected columns with table-qualified references and AS aliases
 * - FROM clause for the base table
 * - JOIN clauses from lookup specifications
 * - WHERE clause from filter specifications
 * - ORDER BY clause from sort specifications
 *
 * @param reportSpec    - The report specification defining base table, lookups,
 *                         filters, sorts, and output columns.
 * @param colMap        - Column alias → source mapping (from buildColumnCatalog).
 *                         Used to resolve column aliases to physical SQL references.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 *                         Used by buildJoins to resolve table references.
 * @param calcExprs     - Map of column alias → calculated SQL expression. When an alias
 *                         is found in this map, the calc expression is used directly in
 *                         the SELECT clause instead of resolving to a physical reference.
 *                         Defaults to an empty Map.
 * @returns `{ sql, params, cols }` — the complete SQL query, parameterized values,
 *           and ordered list of projected column aliases.
 */
export function buildDetailQuery(
  reportSpec: ReportSpec,
  colMap: Map<string, ColMapEntry>,
  sourceCatalog: Map<string, SourceTableEntry>,
  calcExprs: Map<string, string> = new Map(),
): DetailQueryResult {
  if (!reportSpec.pipeline.base) throw new Error('No base table in reportSpec');

  // ── Determine projected columns ────────────────────────────────────────────
  // Use outputColumns if set (and non-empty), otherwise project all colMap keys.
  const outputCols = reportSpec.outputColumns;
  const projected: string[] = (outputCols.length > 0)
    ? outputCols.filter(alias => colMap.has(alias))
    : [...colMap.keys()];

  // Skip band columns — they have no JOIN in the parent FROM clause
  const filteredProjected = projected.filter(alias => {
    const entry = colMap.get(alias);
    return !entry || entry.kind !== 'band';
  });

  // ── SELECT clause ──────────────────────────────────────────────────────────
  const selParts: string[] = [];
  const cols: string[] = [];
  for (const alias of filteredProjected) {
    const calcExpr = calcExprs.get(alias);
    if (calcExpr) {
      selParts.push(`${calcExpr} AS ${quoteId(alias)}`);
    } else {
      selParts.push(`${resolveRef(alias, colMap)} AS ${quoteId(alias)}`);
    }
    cols.push(alias);
  }
  if (!selParts.length) selParts.push('*');

  // ── FROM clause ────────────────────────────────────────────────────────────
  const fromClause = quoteId(reportSpec.pipeline.base);

  // ── JOIN clause ────────────────────────────────────────────────────────────
  const lookups = reportSpec.pipeline.lookups || [];
  const { joins: joinClause, params: joinParams } = buildJoins(lookups, colMap, sourceCatalog);

  // ── WHERE clause ───────────────────────────────────────────────────────────
  const filters = reportSpec.filters || [];
  const { where: whereClause, params: whereParams } = buildWhere(filters, colMap);

  // ── ORDER BY clause ────────────────────────────────────────────────────────
  const sorts = reportSpec.sorts || [];
  const sortParts = sorts
    .filter(s => s.enabled !== false)
    .filter(s => {
      // Skip sorts on band columns — not in the parent FROM clause
      const entry = colMap.get(s.col);
      return !entry || entry.kind !== 'band';
    })
    .map(s => {
      const calcExpr = calcExprs.get(s.col);
      const sortRef = calcExpr ?? resolveRef(s.col, colMap);
      return `${sortRef} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`;
    });

  // ── Assemble query ─────────────────────────────────────────────────────────
  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClause) sql += '\n' + joinClause;
  if (whereClause) sql += '\nWHERE ' + whereClause;
  if (sortParts.length) sql += '\nORDER BY ' + sortParts.join(', ');

  // Merge params: JOIN params come first, then WHERE params
  const params = [...joinParams, ...whereParams];

  return { sql, params, cols };
}
