/**
 * SQL aggregate expression generation from aggregate specifications.
 *
 * Renders aggregate functions (SUM, COUNT, AVG, MIN, MAX, GROUP_CONCAT, etc.)
 * and determines GROUP BY columns based on aggregation mode.
 *
 * Ported from SRC/js/query/sql-aggregates.ts — all aggregate functions supported.
 */

import type { AggregateSpec, AggMode } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import { quoteId } from '../core/sqldb';
import { defaultAggAlias } from '../core/utils';
import { resolveRef } from './resolve-ref';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Result of aggregate expression generation. */
export interface AggregateResult {
  /** SQL SELECT expressions for aggregates (e.g. `SUM("t"."col") AS "Total"`) */
  selects: string[];
  /** GROUP BY column references (e.g. `\"t\".\"col\"`) */
  groupBy: string[];
  /** HAVING clause body (without the HAVING keyword), currently unused */
  having: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────



// ── Aggregate expression rendering ──────────────────────────────────────────────

/**
 * Render a single aggregate function call as a SQL expression.
 *
 * Supported functions:
 *   SUM, AVG, MIN, MAX — standard aggregates
 *   COUNT ROWS         → COUNT(*)
 *   COUNT NON-EMPTY    → COUNT(colRef)
 *   COUNT DISTINCT     → COUNT(DISTINCT colRef)
 *   FIRST              → MIN(colRef)
 *   LAST               → MAX(colRef)
 *   DATE RANGE         → MIN(colRef) || ' — ' || MAX(colRef)
 *   DATE SPAN          → CAST(julianday(MAX) - julianday(MIN) AS INTEGER)
 *   NUMERIC RANGE      → MIN(colRef) || ' – ' || MAX(colRef)
 *   NUMERIC SPAN       → MAX(colRef) - MIN(colRef)
 *   LIST               → GROUP_CONCAT(DISTINCT colRef)
 *   default            → COUNT(colRef)
 *
 * @param fn - The aggregate function name (e.g. 'SUM', 'COUNT ROWS').
 * @param colRef - The SQL column reference expression (e.g. `"t"."col"`),
 *   or `'*'` for COUNT(*).
 * @returns A SQL aggregate expression string.
 */
export function renderAggregateExpr(fn: string, colRef: string): string {
  switch (fn) {
    case 'SUM':             return `SUM(${colRef})`;
    case 'AVG':             return `AVG(${colRef})`;
    case 'MIN':             return `MIN(${colRef})`;
    case 'MAX':             return `MAX(${colRef})`;
    case 'COUNT ROWS':      return 'COUNT(*)';
    case 'COUNT NON-EMPTY': return `COUNT(${colRef})`;
    case 'COUNT DISTINCT':  return `COUNT(DISTINCT ${colRef})`;
    case 'FIRST':           return `MIN(${colRef})`;
    case 'LAST':            return `MAX(${colRef})`;
    case 'DATE RANGE':      return `MIN(${colRef}) || ' — ' || MAX(${colRef})`;
    case 'DATE SPAN':       return `CAST(julianday(MAX(${colRef})) - julianday(MIN(${colRef})) AS INTEGER)`;
    case 'NUMERIC RANGE':   return `MIN(${colRef}) || ' – ' || MAX(${colRef})`;
    case 'NUMERIC SPAN':    return `MAX(${colRef}) - MIN(${colRef})`;
    case 'LIST':            return `GROUP_CONCAT(DISTINCT ${colRef})`;
    default:                return `COUNT(${colRef})`;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build SQL aggregate SELECT expressions and GROUP BY columns from aggregate specs.
 *
 * @param aggregates - Array of AggregateSpec objects defining which columns to
 *                     aggregate and with which function.
 * @param aggMode    - Current aggregation mode. Only `'group'` mode produces
 *                     output; all other modes return empty arrays (aggregates
 *                     are handled by separate modules for totals/subtotals).
 * @param colMap     - Column alias → source mapping (from buildColumnCatalog).
 *                     Used to resolve aggregate column aliases to physical references.
 * @returns `{ selects, groupBy, having }` — aggregate SELECT expressions (with AS
 *          aliases), GROUP BY column references, and HAVING clause (currently empty).
 */
export function buildAggregates(
  aggregates: AggregateSpec[],
  aggMode: AggMode,
  colMap: Map<string, ColMapEntry>,
): AggregateResult {
  // Only 'group' mode uses aggregates in the main query.
  // 'totals', 'subtotals', and 'none' modes handle aggregation elsewhere.
  if (aggMode !== 'group') {
    return { selects: [], groupBy: [], having: '' };
  }

  const selects: string[] = [];

  for (const agg of aggregates) {
    // Compute the output column name: use explicit alias or generate a default
    const colLabel = agg.col && agg.col !== '*' ? agg.col : 'all rows';
    const outName = agg.alias?.trim() || defaultAggAlias(agg.fn, colLabel);

    // Resolve the source column reference via colMap
    const colRef = agg.col && agg.col !== '*' ? resolveRef(agg.col, colMap) : null;

    // Render the aggregate SQL expression
    const expr = renderAggregateExpr(agg.fn, colRef || '*');
    selects.push(`${expr} AS ${quoteId(outName)}`);
  }

  return { selects, groupBy: [], having: '' };
}
