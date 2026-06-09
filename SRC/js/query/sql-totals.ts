import { quoteId } from '../core/sqldb.js';
import { renderFromJoinWhere } from './sql-joins.js';
import { renderAggregateExpr } from './sql-aggregates.js';
import { QueryPlan } from './query-plan.js';
import { ColMapEntry } from '../catalog/column-catalog.js';

interface TotalsResult {
  sql: string;
  params: unknown[];
  cols: string[];
}

export function renderTotalsSql(plan: QueryPlan, detailCols: string[]): TotalsResult | null {
  if (!plan.source.base) throw new Error('No base table in plan');
  const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
  const colTotals = plan.colTotals || {};
  const hasAny    = detailCols.some(c => colTotals[c] && colTotals[c] !== 'skip');
  if (!hasAny) return null;

  const colMap = plan.colMap;
  const selParts = detailCols.map(col => {
    const fn = colTotals[col];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(col)}`;
    let tid: string | undefined;
    let physCol: string | undefined;
    const entry = colMap?.get(col);
    if (entry && entry.kind !== 'calc') { tid = entry.tid; physCol = entry.col; }
    return `${renderAggregateExpr(fn, ref(col), tid, physCol)} AS ${quoteId(col)}`;
  });

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');

  return { sql, params, cols: detailCols };
}
