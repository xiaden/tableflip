import { quoteId } from '../core/sqldb.js';
import { renderFromJoinWhere } from './sql-joins.js';

export function renderDetailSql(plan) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);

  const selParts   = [];
  const colAliases = [];

  for (const alias of plan.selectedColumns) {
    selParts.push(`${ref(alias)} AS ${quoteId(alias)}`);
    colAliases.push(alias);
  }
  if (!selParts.length) selParts.push('*');

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');

  const sortParts = (plan.sorts || []).map(s => `${ref(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`);
  if (sortParts.length) sql += '\nORDER BY ' + sortParts.join(', ');

  return { sql, params, cols: colAliases };
}
