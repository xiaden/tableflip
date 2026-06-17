/**
 * Aggregation pipeline stage — applies grouping, totals, subtotals,
 * or pass-through (detail) to the current pipeline temp table.
 *
 * Reads from ctx.prevTableName (the flat temp table) — no FROM/JOIN/WHERE
 * composition needed since all data is already in the temp table.
 *
 * Uses quoteId(alias) for all column references, never resolveRef().
 */

import type { StageContext, StageResult } from './base';
import { quoteId, execQuery } from '../../core/sqldb';
import { renderAggregateExpr } from '../../query/sql-aggregates';
import { defaultAggAlias } from '../../core/utils';

// ── Detail mode ───────────────────────────────────────────────────────────────

/**
 * Detail mode ('none') — pass-through. No aggregation applied.
 */
function executeDetailMode(ctx: StageContext): StageResult {
  return { outputTableName: ctx.prevTableName, outputColumns: ctx.outputColumns };
}

// ── Grouped mode ──────────────────────────────────────────────────────────────

/**
 * Grouped mode ('group') — SELECT groupRefs, aggExprs FROM prev GROUP BY groupRefs.
 *
 * Creates `_pipeline_stage_5` with grouped + aggregated rows.
 */
function executeGroupedAggregation(ctx: StageContext): StageResult {
  const { reportSpec, prevTableName, outputColumns } = ctx;
  const agg = reportSpec.aggregation;

  const groupBy = agg.groupBy ?? [];
  const aggregates = (agg.aggregates ?? []).filter(a => a.enabled !== false);

  // Group-by column references
  const groupRefs = groupBy.map(a => quoteId(a));

  // Aggregate expressions
  const aggExprs = aggregates.map(agg_spec => {
    const colLabel = agg_spec.col && agg_spec.col !== '*' ? agg_spec.col : 'all rows';
    const outName = agg_spec.alias?.trim() || defaultAggAlias(agg_spec.fn, colLabel);
    const colRef = agg_spec.col && agg_spec.col !== '*' ? quoteId(agg_spec.col) : '*';
    return `${renderAggregateExpr(agg_spec.fn, colRef)} AS ${quoteId(outName)}`;
  });

  // Build SELECT parts
  const selectParts = [...groupRefs, ...aggExprs];
  if (selectParts.length === 0) {
    // No group-by and no aggregates — pass-through
    return { outputTableName: prevTableName, outputColumns };
  }

  const groupByClause = groupRefs.length > 0 ? ` GROUP BY ${groupRefs.join(', ')}` : '';

  const outputTableName = '_pipeline_stage_5';
  const sql = `CREATE TEMP TABLE ${quoteId(outputTableName)} AS SELECT ${selectParts.join(', ')} FROM ${quoteId(prevTableName)}${groupByClause}`;
  execQuery(sql);

  // Output columns: group-by aliases + aggregate output names
  const aggOutputNames = aggregates.map(a => {
    const colLabel = a.col && a.col !== '*' ? a.col : 'all rows';
    return a.alias?.trim() || defaultAggAlias(a.fn, colLabel);
  });

  return {
    outputTableName,
    outputColumns: [...groupBy, ...aggOutputNames],
  };
}

// ── Totals mode ───────────────────────────────────────────────────────────────

/**
 * Totals mode ('totals') — UNION ALL of detail rows + a single totals row.
 *
 * Detail rows get `0 AS "_row_type"`, totals row gets `1 AS "_row_type"`.
 * Columns with a configured aggregate function get aggregated in the totals
 * branch; other columns get NULL.
 *
 * Creates `_pipeline_stage_5`.
 */
function executeTotalsAggregation(ctx: StageContext): StageResult {
  const { reportSpec, prevTableName, outputColumns } = ctx;
  const colTotals = reportSpec.aggregation.colTotals ?? {};

  // Detail branch: all output columns + 0 AS "_row_type"
  const detailParts = outputColumns.map(c => `${quoteId(c)} AS ${quoteId(c)}`);
  detailParts.push('0 AS "_row_type"');

  // Totals branch: aggregate or NULL per column + 1 AS "_row_type"
  const totalsParts = outputColumns.map(c => {
    const fn = colTotals[c];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(c)}`;
    return `${renderAggregateExpr(fn, quoteId(c))} AS ${quoteId(c)}`;
  });
  totalsParts.push('1 AS "_row_type"');

  const outputTableName = '_pipeline_stage_5';
  const sql = `CREATE TEMP TABLE ${quoteId(outputTableName)} AS ` +
    `SELECT ${detailParts.join(', ')} FROM ${quoteId(prevTableName)} ` +
    `UNION ALL ` +
    `SELECT ${totalsParts.join(', ')} FROM ${quoteId(prevTableName)}`;
  execQuery(sql);

  return {
    outputTableName,
    outputColumns: [...outputColumns, '_row_type'],
  };
}

// ── Subtotals mode ────────────────────────────────────────────────────────────

/**
 * Subtotals mode ('subtotals') — detail rows interleaved with subtotal,
 * spacer, and grand-total rows via UNION ALL.
 *
 * Adapted from query/sql-subtotals.ts but reads from ctx.prevTableName
 * instead of composing FROM/JOIN/WHERE. Uses quoteId(alias) for all
 * column references.
 *
 * Internal marker columns:
 * - `_row_type`: 0=detail, 1=subtotal, 2=spacer, 3=grand total
 * - `_sort_row_type`: controls detail-vs-subtotal ordering within groups
 * - `_sort_group_N`: per-subtotalBy-column sort keys for hierarchical ordering
 *
 * Creates `_pipeline_stage_5`.
 */
function executeSubtotalsAggregation(ctx: StageContext): StageResult {
  const { reportSpec, prevTableName, outputColumns } = ctx;
  const agg = reportSpec.aggregation;

  const subtotalBy = agg.subtotalBy ?? [];
  const subtotalFns = agg.subtotalFns ?? {};
  const includeGrand = agg.subtotalGrandTotal !== false;
  const includeSpacer = !!agg.subtotalSpacer;
  const subtotalOnTop = !!agg.subtotalOnTop;
  const isNested = agg.subtotalStrategy === 'nested';

  // If no subtotalBy columns, pass-through (detail mode)
  if (subtotalBy.length === 0) {
    return executeDetailMode(ctx);
  }

  // Output columns from the pipeline context (already projected)
  const toShow = outputColumns;
  if (toShow.length === 0) {
    return executeDetailMode(ctx);
  }

  const n = subtotalBy.length;
  const subtotalBySet = new Set(subtotalBy);

  // Internal sort marker column names
  const sortGroupKeys = subtotalBy.map((_, i) => `_sort_group_${i}`);
  const detailSortType = subtotalOnTop ? 1 : 0;
  const subtotalSortType = subtotalOnTop ? 0 : 1;

  // Reference helper — just quoteId for flat temp table
  const ref = (a: string): string => quoteId(a);

  // Aggregate expression for a subtotal column
  const subAggExpr = (a: string): string => {
    const fn = subtotalFns[a];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(a)}`;
    return `${renderAggregateExpr(fn, ref(a))} AS ${quoteId(a)}`;
  };

  // ── Detail SELECT (row_type = 0) ──────────────────────────────────────
  const detailSel = [
    ...toShow.map(a => `${ref(a)} AS ${quoteId(a)}`),
    '0 AS "_row_type"',
    `${detailSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(', ');

  // ── Subtotal SELECT builder (row_type = 1) ────────────────────────────
  function makeSubSel(depth: number): string {
    const groupCols = subtotalBy.slice(0, depth + 1);
    const groupSet = new Set(groupCols);
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
    ].join(', ');
  }

  // ── Grand total SELECT (row_type = 3) ─────────────────────────────────
  const grandSel = [
    ...toShow.map(a => subtotalBySet.has(a) ? `NULL AS ${quoteId(a)}` : subAggExpr(a)),
    '3 AS "_row_type"',
    '3 AS "_sort_row_type"',
    ...subtotalBy.map((_, i) => `NULL AS ${quoteId(sortGroupKeys[i])}`),
  ].join(', ');

  // ── Spacer SELECT (row_type = 2) ──────────────────────────────────────
  const spacerSel = [
    ...toShow.map(a => `NULL AS ${quoteId(a)}`),
    '2 AS "_row_type"',
    '2 AS "_sort_row_type"',
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(', ');

  // ── Null filter for subtotal branches ─────────────────────────────────
  // Exclude rows where ALL subtotalBy columns are NULL
  const nullFilter = subtotalBy.map(a => `${ref(a)} IS NOT NULL`).join(' OR ');

  const fromRef = quoteId(prevTableName);

  // ── Assemble UNION ALL branches ───────────────────────────────────────
  const branches: string[] = [
    `SELECT ${detailSel} FROM ${fromRef}`,
  ];

  if (isNested) {
    // Nested subtotals: one branch per prefix depth
    for (let d = 0; d < n; d++) {
      const groupClause = subtotalBy.slice(0, d + 1)
        .map(a => ref(a))
        .join(', ');
      branches.push(
        `SELECT ${makeSubSel(d)} FROM ${fromRef} WHERE ${nullFilter} GROUP BY ${groupClause}`,
      );
    }
  } else {
    // Combined subtotals: single GROUP BY with all subtotalBy columns
    const groupClause = subtotalBy.map(a => ref(a)).join(', ');
    branches.push(
      `SELECT ${makeSubSel(n - 1)} FROM ${fromRef} WHERE ${nullFilter} GROUP BY ${groupClause}`,
    );
  }

  if (includeSpacer) {
    const groupClause = subtotalBy.map(a => ref(a)).join(', ');
    branches.push(
      `SELECT ${spacerSel} FROM ${fromRef} WHERE ${nullFilter} GROUP BY ${groupClause}`,
    );
  }

  if (includeGrand) {
    // Skip grand total if every non-subtotalBy column's fn is "skip" (or absent)
    const hasGrandValue = toShow.some(
      a => !subtotalBySet.has(a) && subtotalFns[a] && subtotalFns[a] !== 'skip',
    );
    if (hasGrandValue) {
      branches.push(`SELECT ${grandSel} FROM ${fromRef}`);
    }
  }

  // ── ORDER BY ──────────────────────────────────────────────────────────
  const orderParts = [
    ...sortGroupKeys.map((k, i) => {
      if (isNested && i > 0 && subtotalOnTop) return `${quoteId(k)} ASC NULLS FIRST`;
      return `${quoteId(k)} ASC NULLS LAST`;
    }),
    '"_sort_row_type" ASC',
  ];

  const outputTableName = '_pipeline_stage_5';
  const sql = `CREATE TEMP TABLE ${quoteId(outputTableName)} AS ${branches.join(' UNION ALL ')} ORDER BY ${orderParts.join(', ')}`;
  execQuery(sql);

  return {
    outputTableName,
    outputColumns: [...toShow, '_row_type'],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute the aggregation stage — dispatch to mode-specific handler.
 *
 * Reads `reportSpec.aggregation.mode` (default 'none') and routes to:
 * - 'none' → detail pass-through
 * - 'group' → grouped aggregation with GROUP BY
 * - 'totals' → UNION ALL of detail + totals row
 * - 'subtotals' → UNION ALL of detail + subtotal + spacer + grand total
 *
 * Creates `_pipeline_stage_5` for non-detail modes.
 */
export function executeAggregationStage(ctx: StageContext): StageResult {
  const mode = ctx.reportSpec.aggregation?.mode ?? 'none';

  switch (mode) {
    case 'group':
      return executeGroupedAggregation(ctx);
    case 'totals':
      return executeTotalsAggregation(ctx);
    case 'subtotals':
      return executeSubtotalsAggregation(ctx);
    case 'none':
    default:
      return executeDetailMode(ctx);
  }
}
