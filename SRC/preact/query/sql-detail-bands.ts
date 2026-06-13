/**
 * SQL detail band query generation.
 *
 * Generates per-band SQL queries that fetch all child rows for a batch of
 * parent key values at once (WHERE IN), rather than one query per parent row.
 * Supports single-key and multi-key (composite) join columns.
 *
 * New module for the detail bands feature (TASK-subreport-detail-rows).
 */

import type { DetailBandSpec } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { SourceTableEntry } from '../catalog/source-catalog';
import { quoteId } from '../core/sqldb';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Result of band query generation. */
export interface BandQueryResult {
  /** The complete SQL query string. */
  sql: string;
  /** Parameterized values for the WHERE IN clause. */
  params: unknown[];
  /** Band column aliases (with _{bandId}_ prefix) — excludes key columns. */
  cols: string[];
  /** Parent-side key aliases (left side of each keyPair). */
  parentKeyAliases: string[];
  /** Child-side key column names (right side of each keyPair). */
  childKeyCols: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build a batched query for a single detail band.
 *
 * Generates: SELECT child_cols, child_key_cols FROM child_table
 *            WHERE child_key IN (?, ?, ...)
 *            [ORDER BY sort_cols]
 *
 * For multi-key bands, the WHERE clause uses concatenation with the `|||`
 * separator (following the sql-joins.ts pattern for multi-pair conditions):
 *   WHERE (child_key1 || '|||' || child_key2) IN ('val1|||val2', ...)
 *
 * Calc columns in the bandColMap are skipped (not supported in v1).
 *
 * @param band - The detail band specification.
 * @param parentKeyValues - Deduplicated set of parent key values.
 *   For multi-key bands, each value must already be the concatenation of
 *   component values joined with `|||` (the engine is responsible for this).
 * @param bandColMap - Column map entries for this band's columns (from
 *   buildColumnCatalog). Keys are aliases with _{bandId}_ prefix.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 * @returns BandQueryResult with SQL, params, column metadata, and key info.
 */
export function buildBandQuery(
  band: DetailBandSpec,
  parentKeyValues: Set<unknown>,
  bandColMap: Map<string, ColMapEntry>,
  _sourceCatalog: Map<string, SourceTableEntry>,
): BandQueryResult {
  const childTable = quoteId(band.rightId);

  // ── Filter to valid key pairs (both sides must be specified) ──────────────
  const pairs = (band.keyPairs || []).filter(p => p.left && p.right);
  const parentKeyAliases = pairs.map(p => p.left);
  const childKeyCols = pairs.map(p => p.right);

  // ── SELECT clause — band columns with their aliases ───────────────────────
  const selParts: string[] = [];
  const cols: string[] = [];
  for (const [alias, entry] of bandColMap) {
    if (entry.kind === 'calc') continue;  // No calc support in v1
    selParts.push(`${childTable}.${quoteId(entry.col)} AS ${quoteId(alias)}`);
    cols.push(alias);
  }

  // Also select child key columns (for JS-side parent matching).
  // Deduplicate to avoid selecting the same column twice.
  const seenKeyCols = new Set<string>();
  for (const ck of childKeyCols) {
    if (seenKeyCols.has(ck)) continue;
    seenKeyCols.add(ck);
    selParts.push(`${childTable}.${quoteId(ck)} AS ${quoteId(ck)}`);
  }

  // ── WHERE clause — batched IN ─────────────────────────────────────────────
  const keyValuesArr = Array.from(parentKeyValues);

  let whereClause: string;
  let params: unknown[];

  if (pairs.length === 0 || keyValuesArr.length === 0) {
    // No valid key pairs or no parent keys — produce a query that returns nothing
    whereClause = '1 = 0';
    params = [];
  } else if (pairs.length === 1) {
    // Single key — simple IN clause
    const placeholders = keyValuesArr.map(() => '?').join(', ');
    whereClause = `${childTable}.${quoteId(childKeyCols[0])} IN (${placeholders})`;
    params = keyValuesArr;
  } else {
    // Multi-key — concatenation with ||| separator
    // WHERE ("table"."key1" || '|||' || "table"."key2") IN (?, ?, ...)
    // Separator: space || '|||' || (SQL string literal with three pipes)
    const sep = ' || ' + String.fromCharCode(39) + '|||' + String.fromCharCode(39) + ' || ';
    const concatLeft = childKeyCols
      .map(ck => `${childTable}.${quoteId(ck)}`)
      .join(sep);
    const placeholders = keyValuesArr.map(() => '?').join(', ');
    whereClause = `(${concatLeft}) IN (${placeholders})`;
    // Params are pre-concatenated by the engine (e.g. 'val1|||val2')
    params = keyValuesArr;
  }

  // ── ORDER BY clause ───────────────────────────────────────────────────────
  const sortParts = (band.sorts || [])
    .filter(s => s.enabled !== false && s.col)
    .map(s => `${childTable}.${quoteId(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`);

  // ── Assemble query ────────────────────────────────────────────────────────
  let sql = `SELECT ${selParts.join(', ')}\nFROM ${childTable}\nWHERE ${whereClause}`;
  if (sortParts.length) sql += `\nORDER BY ${sortParts.join(', ')}`;

  return {
    sql,
    params,
    cols,
    parentKeyAliases,
    childKeyCols,
  };
}
