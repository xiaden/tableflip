import { quoteId } from '../core/sqldb.js';
import { renderFromJoinWhere } from './sql-joins.js';
import { renderAggregateExpr } from './sql-aggregates.js';
import { defaultAggAlias } from '../core/utils.js';

export function renderGroupedSql(plan) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
  const hasAgg    = (plan.groupBy || []).length > 0 || (plan.aggregates || []).length > 0;
  const selColSet = plan.selectedColumns.length > 0 ? new Set(plan.selectedColumns) : null;

  const selParts   = [];
  const colAliases = [];
  const groupRefs  = [];

  if (hasAgg) {
    for (const alias of (plan.groupBy || [])) {
      if (selColSet && !selColSet.has(alias)) continue;
      const r = ref(alias);
      selParts.push(`${r} AS ${quoteId(alias)}`);
      groupRefs.push(r);
      colAliases.push(alias);
    }
    for (const agg of (plan.aggregates || [])) {
      const outName = (agg.alias || '').trim() ||
        (typeof defaultAggAlias === 'function'
          ? defaultAggAlias(agg.fn, agg.col && agg.col !== '*' ? agg.col : 'all rows')
          : `${agg.fn}(${agg.col || '*'})`);
      if (selColSet && !selColSet.has(outName)) continue;
      const colRef = agg.col && agg.col !== '*' ? ref(agg.col) : null;
      const expr   = renderAggregateExpr(agg.fn, colRef || '*');
      selParts.push(`${expr} AS ${quoteId(outName)}`);
      colAliases.push(outName);
    }
  } else {
    for (const alias of plan.selectedColumns) {
      selParts.push(`${ref(alias)} AS ${quoteId(alias)}`);
      colAliases.push(alias);
    }
  }

  if (!selParts.length) selParts.push('*');

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');
  if (groupRefs.length)   sql += '\nGROUP BY ' + groupRefs.join(', ');

  const sortParts = (plan.sorts || []).map(s => `${ref(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`);
  if (sortParts.length) sql += '\nORDER BY ' + sortParts.join(', ');

  return { sql, params, cols: colAliases };
}
