'use strict';

function renderTotalsSql(plan, detailCols) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
  const colTotals = plan.colTotals || {};
  const hasAny    = detailCols.some(c => colTotals[c] && colTotals[c] !== 'skip');
  if (!hasAny) return null;

  const selParts = detailCols.map(col => {
    const fn = colTotals[col];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(col)}`;
    return `${renderAggregateExpr(fn, ref(col))} AS ${quoteId(col)}`;
  });

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');

  return { sql, params, cols: detailCols };
}
