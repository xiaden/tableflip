'use strict';

function renderSubtotalsSql(plan) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const colMap = plan.colMap;
  const { fromClause, joinClauses, whereParts, params: filterParams, ref } = renderFromJoinWhere(plan);

  const toShow = plan.selectedColumns;
  if (!toShow.length) return null;

  const subtotalFns   = plan.subtotalFns || {};
  const includeGrand  = plan.subtotalGrandTotal !== false;
  const includeSpacer = !!plan.subtotalSpacer;
  const subtotalOnTop = !!plan.subtotalOnTop;

  const orderIdx = new Map(toShow.map((a, i) => [a, i]));
  const seenSub  = new Set();
  const subtotalBy = (plan.subtotalBy || [])
    .filter(a => orderIdx.has(a) && !seenSub.has(a) && (seenSub.add(a), true))
    .sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity));

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

  const fromPart  = `FROM ${fromClause}`;
  const joinPart  = joinClauses.length ? '\n' + joinClauses.join('\n') : '';
  const wherePart = whereParts.length  ? '\nWHERE ' + whereParts.join('\n  AND ') : '';

  const detailSel = [
    ...toShow.map(a => `${ref(a)} AS ${quoteId(a)}`),
    '0 AS "_row_type"',
    `${detailSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  const subSel = [
    ...toShow.map(a => subtotalBy.includes(a) ? `${ref(a)} AS ${quoteId(a)}` : subAggExpr(a)),
    '1 AS "_row_type"',
    `${subtotalSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');
  const subGroupClause = subtotalBy.map(a => ref(a)).join(', ');

  const grandSel = [
    ...toShow.map(a => subtotalBy.includes(a) ? `NULL AS ${quoteId(a)}` : subAggExpr(a)),
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

  const orderParts = [
    ...sortGroupKeys.map(k => `${quoteId(k)} ASC NULLS LAST`),
    '"_sort_row_type" ASC',
    ...(plan.sorts || [])
      .filter(s => toShow.includes(s.col) && !subtotalBy.includes(s.col))
      .map(s => `${quoteId(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`),
  ];

  const branches = [`SELECT ${detailSel}\n${fromPart}${joinPart}${wherePart}`];
  if (subtotalBy.length > 0) {
    branches.push(`SELECT ${subSel}\n${fromPart}${joinPart}${wherePart}\nGROUP BY ${subGroupClause}`);
    if (includeSpacer) {
      branches.push(`SELECT ${spacerSel}\n${fromPart}${joinPart}${wherePart}\nGROUP BY ${subGroupClause}`);
    }
  }
  if (includeGrand) {
    branches.push(`SELECT ${grandSel}\n${fromPart}${joinPart}${wherePart}`);
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
