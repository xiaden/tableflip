/**
 * SQL subtotals query generation.
 *
 * Generates a SQL query that produces detail rows interleaved with subtotal
 * rows, spacer rows, and an optional grand total row — all combined via
 * UNION ALL. Each branch selects the same output columns, distinguished by
 * internal marker columns (_row_type, _sort_row_type) used for sorting.
 *
 * Ported from SRC/js/query/sql-subtotals.ts — rewritten as a pure function
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

/** Strategy for generating subtotal branches — one per prefix depth or a single combined GROUP BY. */
export type SubtotalStrategy = 'nested' | 'combined';

/** Result of subtotals query generation. */
export interface SubtotalsQueryResult {
  /** The complete SQL query string (UNION ALL of detail + subtotal branches) */
  sql: string;
  /** Parameterized values in order of appearance */
  params: unknown[];
  /** Ordered list of projected column aliases (without internal sort markers) */
  cols: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────



// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build a subtotals query from a report specification.
 *
 * Generates a UNION ALL of:
 *   1. Detail rows (unaggregated, row_type = 0)
 *   2. Subtotal rows (grouped, row_type = 1) — one branch per prefix depth
 *      in nested mode, or a single branch in combined mode
 *   3. Optional spacer rows (row_type = 2) — one per group
 *   4. Optional grand total row (row_type = 3) — aggregate over everything
 *
 * The query includes internal marker columns (_row_type, _sort_row_type, and
 * _sort_group_N) for hierarchical ordering. The consumer is responsible for
 * stripping these from the final display.
 *
 * @param reportSpec    - The report specification defining base table, lookups,
 *                         filters, output columns, and subtotal configuration.
 * @param colMap        - Column alias → source mapping (from buildColumnCatalog).
 *                         Used to resolve column aliases to physical SQL references.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 *                         Used by buildJoins to resolve table references.
 * @param calcExprs     - Map of column alias → calculated SQL expression. When an alias
 *                         is found in this map, the calc expression is used directly
 *                         instead of resolving to a physical reference. Applies to all
 *                         SELECT branches (detail, subtotal, grand total) and GROUP BY
 *                         clauses. Defaults to an empty Map.
 * @returns `{ sql, params, cols }` — the complete SQL query, parameterized values,
 *           and ordered list of projected column aliases (without sort markers).
 *           Returns `null` if no subtotalBy columns are configured.
 */
export function buildSubtotalsQuery(
  reportSpec: ReportSpec,
  colMap: Map<string, ColMapEntry>,
  sourceCatalog: Map<string, SourceTableEntry>,
  calcExprs: Map<string, string> = new Map(),
): SubtotalsQueryResult | null {
  if (!reportSpec.pipeline.base) throw new Error('No base table in reportSpec');

  const agg = reportSpec.aggregation;

  // ── Determine projected columns ──────────────────────────────────────────
  const outputCols = reportSpec.outputColumns;
  const rawToShow: string[] = (outputCols && outputCols.length > 0)
    ? outputCols.filter(alias => colMap.has(alias))
    : [...colMap.keys()];

  // Skip band columns — they have no JOIN in the parent FROM clause
  const toShow: string[] = rawToShow.filter(alias => {
    const entry = colMap.get(alias);
    return !entry || entry.kind !== 'band';
  });

  if (!toShow.length) return null;

  const subtotalFns   = agg.subtotalFns || {};
  const includeGrand  = agg.subtotalGrandTotal !== false;
  const includeSpacer = !!agg.subtotalSpacer;
  const subtotalOnTop = !!agg.subtotalOnTop;
  const isNested      = agg.subtotalStrategy === 'nested';

  // ── Determine subtotalBy columns (preserving output-column order) ────────
  const orderIdx = new Map(toShow.map((a, i) => [a, i]));
  const seenSub  = new Set<string>();
  const subtotalBy = (agg.subtotalBy || [])
    .filter(a => orderIdx.has(a) && !seenSub.has(a) && (seenSub.add(a), true))
    .sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity));

  const n = subtotalBy.length;

  // If no subtotalBy columns are configured, subtotals are a no-op
  if (n === 0) return null;

  // ── Internal sort helpers ────────────────────────────────────────────────
  const sortGroupKeys  = subtotalBy.map((_, i) => `_sort_group_${i}`);
  const detailSortType   = subtotalOnTop ? 1 : 0;
  const subtotalSortType = subtotalOnTop ? 0 : 1;

  const subtotalBySet = new Set(subtotalBy);

  // ── Aggregate expression for a subtotal column ───────────────────────────
  const subAggExpr = (a: string): string => {
    const fn = subtotalFns[a];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(a)}`;
    const calcExpr = calcExprs.get(a);
    const innerRef = calcExpr ?? resolveRef(a, colMap);
    return `${renderAggregateExpr(fn, innerRef)} AS ${quoteId(a)}`;
  };

  // ── Resolve alias to calc expression or physical reference ──────────────
  const ref = (a: string): string => calcExprs.get(a) ?? resolveRef(a, colMap);

  // ── FROM / JOIN / WHERE ──────────────────────────────────────────────────
  const fromClause = quoteId(reportSpec.pipeline.base);

  const lookups = reportSpec.pipeline.lookups || [];
  const { joins: joinClause, params: joinParams } = buildJoins(lookups, colMap, sourceCatalog);

  const filters = reportSpec.filters || [];
  const { where: whereClause, params: whereParams } = buildWhere(filters, colMap);

  const joinPart  = joinClause ? '\n' + joinClause : '';
  const wherePart = whereClause ? '\nWHERE ' + whereClause : '';

  // ── Null filter for subtotal branches ────────────────────────────────────
  // Exclude rows where ALL subtotalBy columns are NULL — these don't form a
  // meaningful group and are just unmatched LEFT JOIN rows.
  const nullFilter = subtotalBy.map(a => `${ref(a)} IS NOT NULL`).join(' OR ');
  const subWherePart = whereClause
    ? `\nWHERE ${whereClause}\n  AND (${nullFilter})`
    : `\nWHERE (${nullFilter})`;

  // ── Detail SELECT (row_type = 0) ────────────────────────────────────────
  const detailSel = [
    ...toShow.map(a => `${ref(a)} AS ${quoteId(a)}`),
    '0 AS "_row_type"',
    `${detailSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  // ── Subtotal SELECT builder (row_type = 1) ──────────────────────────────
  // For a given prefix depth, columns in the GROUP BY prefix are projected
  // directly; other subtotalBy columns are NULL; non-subtotal columns use
  // aggregate expressions.
  function makeSubSel(depth: number): string {
    const groupCols = subtotalBy.slice(0, depth + 1);
    const groupSet  = new Set(groupCols);
    return [
      ...toShow.map(a => {
        if (groupSet.has(a)) return `${ref(a)} AS ${quoteId(a)}`;
        if (subtotalBySet.has(a)) return `NULL AS ${quoteId(a)}`;
        return subAggExpr(a);
      }),
      '1 AS "_row_type"',
      `${subtotalSortType} AS "_sort_row_type"`,
      ...subtotalBy.map((a, i) =>
        i <= depth
          ? `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`
          : `NULL AS ${quoteId(sortGroupKeys[i])}`),
    ].join(',\n       ');
  }

  // ── Grand total SELECT (row_type = 3) ───────────────────────────────────
  const grandSel = [
    ...toShow.map(a => subtotalBySet.has(a) ? `NULL AS ${quoteId(a)}` : subAggExpr(a)),
    '3 AS "_row_type"',
    '3 AS "_sort_row_type"',
    ...subtotalBy.map((_, i) => `NULL AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  // ── Spacer SELECT (row_type = 2) ────────────────────────────────────────
  const spacerSel = [
    ...toShow.map(a => `NULL AS ${quoteId(a)}`),
    '2 AS "_row_type"',
    '2 AS "_sort_row_type"',
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  // ── ORDER BY ─────────────────────────────────────────────────────────────
  // sort_group_X controls hierarchical ordering. For nested on-top, shallower
  // levels sort first via NULLS FIRST; the deepest sort_group_0 always uses
  // NULLS LAST so the grand total (all-NULL sort keys) sinks to the bottom.
  const orderParts = [
    ...sortGroupKeys.map((k, i) => {
      if (isNested && i > 0 && subtotalOnTop) return `${quoteId(k)} ASC NULLS FIRST`;
      return `${quoteId(k)} ASC NULLS LAST`;
    }),
    '"_sort_row_type" ASC',
    ...(reportSpec.sorts || [])
      .filter(s => s.enabled !== false && toShow.includes(s.col) && !subtotalBySet.has(s.col))
      .map(s => `${quoteId(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`),
  ];

  // ── Assemble UNION ALL branches ──────────────────────────────────────────
  const branches: string[] = [
    `SELECT ${detailSel}\nFROM ${fromClause}${joinPart}${wherePart}`,
  ];

  if (isNested) {
    // Nested subtotals: one branch per prefix depth
    for (let d = 0; d < n; d++) {
      const groupClause = subtotalBy.slice(0, d + 1)
        .map(a => ref(a))
        .join(', ');
      branches.push(
        `SELECT ${makeSubSel(d)}\nFROM ${fromClause}${joinPart}${subWherePart}\nGROUP BY ${groupClause}`,
      );
    }
  } else {
    // Combined subtotals: single GROUP BY with all subtotalBy columns
    const groupClause = subtotalBy.map(a => ref(a)).join(', ');
    branches.push(
      `SELECT ${makeSubSel(n - 1)}\nFROM ${fromClause}${joinPart}${subWherePart}\nGROUP BY ${groupClause}`,
    );
  }

  if (includeSpacer) {
    const groupClause = subtotalBy.map(a => ref(a)).join(', ');
    branches.push(
      `SELECT ${spacerSel}\nFROM ${fromClause}${joinPart}${subWherePart}\nGROUP BY ${groupClause}`,
    );
  }

  if (includeGrand) {
    // Skip the grand total if every non-subtotalBy column's fn is "skip"
    // (or absent) — the row would be all-NULL and pointless.
    const hasGrandValue = toShow.some(
      a => !subtotalBySet.has(a) && subtotalFns[a] && subtotalFns[a] !== 'skip',
    );
    if (hasGrandValue) {
      branches.push(`SELECT ${grandSel}\nFROM ${fromClause}${joinPart}${wherePart}`);
    }
  }

  // ── Params: each UNION ALL branch gets the same filter params ────────────
  const filterParams = [...joinParams, ...whereParams];
  const params = branches.flatMap(() => [...filterParams]);

  // ── Combine ──────────────────────────────────────────────────────────────
  const sql = branches.join('\nUNION ALL\n') + '\nORDER BY ' + orderParts.join(', ');

  return {
    sql,
    params,
    cols: [...toShow],
  };
}
