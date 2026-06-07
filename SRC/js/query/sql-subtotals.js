import { quoteId } from '../core/sqldb.js';
import { renderFromJoinWhere } from './sql-joins.js';
import { renderAggregateExpr } from './sql-aggregates.js';

export function renderSubtotalsSql(plan) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const colMap = plan.colMap;
  const { fromClause, joinClauses, whereParts, params: filterParams, ref } = renderFromJoinWhere(plan);

  const toShow = plan.selectedColumns;
  if (!toShow.length) return null;

  const subtotalFns   = plan.subtotalFns || {};
  const includeGrand  = plan.subtotalGrandTotal !== false;
  const includeSpacer = !!plan.subtotalSpacer;
  const subtotalOnTop = !!plan.subtotalOnTop;
  const isNested      = plan.subtotalStrategy === 'nested';

  const orderIdx = new Map(toShow.map((a, i) => [a, i]));
  const seenSub  = new Set();
  const subtotalBy = (plan.subtotalBy || [])
    .filter(a => orderIdx.has(a) && !seenSub.has(a) && (seenSub.add(a), true))
    .sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity));

  const n                = subtotalBy.length;
  const sortGroupKeys    = subtotalBy.map((_, i) => `_sort_group_${i}`);
  const detailSortType   = subtotalOnTop ? 1 : 0;
  const subtotalSortType = subtotalOnTop ? 0 : 1;

  const subAggExpr = a => {
    const fn  = subtotalFns[a];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(a)}`;
    const src = colMap.get(a);
    if (src?.kind === 'calc' && (src.op === 'ROLLAVG' || src.op === 'PCTTOTAL')) return `NULL AS ${quoteId(a)}`;
    return `${renderAggregateExpr(fn, ref(a))} AS ${quoteId(a)}`;
  };

  const subtotalBySet = new Set(subtotalBy);

  const fromPart  = `FROM ${fromClause}`;
  const joinPart  = joinClauses.length ? '\n' + joinClauses.join('\n') : '';
  const wherePart = whereParts.length  ? '\nWHERE ' + whereParts.join('\n  AND ') : '';

  // For subtotal/spacer branches, exclude rows where ALL subtotalBy columns are NULL
  // (those don't form a meaningful group — they're just unmatched LEFT JOIN rows).
  const nullFilter = n ? subtotalBy.map(a => `${ref(a)} IS NOT NULL`).join(' OR ') : '';
  const subWherePart = nullFilter
    ? (whereParts.length
        ? `\nWHERE ${whereParts.join('\n  AND ')}\n  AND (${nullFilter})`
        : `\nWHERE (${nullFilter})`)
    : wherePart;

  const detailSel = [
    ...toShow.map(a => `${ref(a)} AS ${quoteId(a)}`),
    '0 AS "_row_type"',
    `${detailSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  // Build a subtotal SELECT for a given prefix depth.
  // Columns not in the GROUP BY prefix are NULL rather than aggregated.
  function makeSubSel(depth) {
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

  const grandSel = [
    ...toShow.map(a => subtotalBySet.has(a) ? `NULL AS ${quoteId(a)}` : subAggExpr(a)),
    '3 AS "_row_type"',
    '3 AS "_sort_row_type"',
    ...subtotalBy.map((_, i) => `NULL AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  const spacerSel = [
    ...toShow.map(a => `NULL AS ${quoteId(a)}`),
    '2 AS "_row_type"',
    '2 AS "_sort_row_type"',
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  // ORDER BY: sort_group_X controls hierarchical ordering.
  // For nested on-top, shallower levels (NULL on deeper sort_group_X) sort first
  // via NULLS FIRST; the deepest sort_group_0 always uses NULLS LAST so the
  // grand total (all-NULL sort keys) sinks to the bottom.
  const orderParts = [
    ...sortGroupKeys.map((k, i) => {
      if (isNested && i > 0 && subtotalOnTop) return `${quoteId(k)} ASC NULLS FIRST`;
      return `${quoteId(k)} ASC NULLS LAST`;
    }),
    '"_sort_row_type" ASC',
    ...(plan.sorts || [])
      .filter(s => toShow.includes(s.col) && !subtotalBySet.has(s.col))
      .map(s => `${quoteId(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`),
  ];

  const branches = [`SELECT ${detailSel}\n${fromPart}${joinPart}${wherePart}`];

  if (n > 0) {
    if (isNested && n > 1) {
      // Nested subtotals: one branch per prefix depth
      for (let d = 0; d < n; d++) {
        const groupClause = subtotalBy.slice(0, d + 1).map(a => ref(a)).join(', ');
        branches.push(`SELECT ${makeSubSel(d)}\n${fromPart}${joinPart}${subWherePart}\nGROUP BY ${groupClause}`);
      }
    } else {
      // Combined subtotals: single GROUP BY with all subtotalBy columns
      const groupClause = subtotalBy.map(a => ref(a)).join(', ');
      branches.push(`SELECT ${makeSubSel(n - 1)}\n${fromPart}${joinPart}${subWherePart}\nGROUP BY ${groupClause}`);
    }

    if (includeSpacer) {
      const groupClause = subtotalBy.map(a => ref(a)).join(', ');
      branches.push(`SELECT ${spacerSel}\n${fromPart}${joinPart}${subWherePart}\nGROUP BY ${groupClause}`);
    }
  }

  if (includeGrand) {
    // Skip the grand total if every non-subtotalBy column's fn is "skip"
    // (or absent) — the row would be all-NULL and pointless.
    const hasGrandValue = toShow.some(
      a => !subtotalBySet.has(a) && subtotalFns[a] && subtotalFns[a] !== 'skip');
    if (hasGrandValue) {
      branches.push(`SELECT ${grandSel}\n${fromPart}${joinPart}${wherePart}`);
    }
  }

  const params = Array.from({ length: branches.length }, () => [...filterParams]).flat();

  const sql = branches.join('\nUNION ALL\n') + '\nORDER BY ' + orderParts.join(', ');

  return {
    sql,
    params,
    cols:        [...toShow, '_row_type', '_sort_row_type', ...sortGroupKeys],
    displayCols: toShow,
  };
}
