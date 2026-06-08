import { db } from '../core/state.js';
import { execQuery } from '../core/sqldb.js';
import { buildSourceCatalog } from '../catalog/source-catalog.js';
import { buildColumnCatalog } from '../catalog/column-catalog.js';
import { buildQueryPlan, QueryPlan } from '../query/query-plan.js';
import { renderDetailSql } from '../query/sql-detail.js';
import { renderTotalsSql } from '../query/sql-totals.js';
import { renderSubtotalsSql } from '../query/sql-subtotals.js';
import { renderGroupedSql } from '../query/sql-grouped.js';
import { getValidation } from './validation.js';
import { buildResultSet, ResultSet } from './result-set.js';

function _lkKeyPairs(lk: LookupSpec): Array<{ left: string; right: string }> {
  return Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p: { left: string; right: string }) => p.left && p.right) : [];
}

function runDetailMode(plan: QueryPlan): ResultSet {
  const { sql, params, cols } = renderDetailSql(plan);
  const rows = execQuery(sql, params);
  return buildResultSet(cols, rows, { aggMode: 'none' });
}

function runTotalsMode(plan: QueryPlan): ResultSet {
  const detail = renderDetailSql(plan);
  const detailRows = execQuery(detail.sql, detail.params);
  const totals = renderTotalsSql(plan, detail.cols);

  if (!totals) {
    return buildResultSet(detail.cols, detailRows, { aggMode: 'totals' });
  }

  const totalsRows = execQuery(totals.sql, totals.params);
  const newAggCols = totals.cols.slice(detail.cols.length);
  const paddedRows = newAggCols.length
    ? detailRows.map((r: Record<string, unknown>) => {
        const row = Object.assign({}, r);
        newAggCols.forEach((c: string) => { row[c] = null; });
        return row;
      })
    : detailRows;
  return buildResultSet(totals.cols, paddedRows, { aggMode: 'totals', totalsRow: totalsRows[0] || null });
}

function runSubtotalsMode(plan: QueryPlan): ResultSet {
  const result = renderSubtotalsSql(plan);
  if (!result) throw new Error('No output columns configured for subtotals view.');
  const rows = execQuery(result.sql, result.params);
  return buildResultSet(result.displayCols, rows, {
    aggMode: 'subtotals',
    hasSubtotals: true,
    allCols: result.cols,
  });
}

function runGroupedMode(plan: QueryPlan): ResultSet {
  const { sql, params, cols } = renderGroupedSql(plan);
  const rows = execQuery(sql, params);
  return buildResultSet(cols, rows, { aggMode: 'group' });
}

const modeRunners: Record<AggMode, (plan: QueryPlan) => ResultSet> = {
  none:      runDetailMode,
  totals:    runTotalsMode,
  subtotals: runSubtotalsMode,
  group:     runGroupedMode,
};

function runReport(reportSpec?: Record<string, unknown> | DbState): ResultSet | null {
  reportSpec = reportSpec || db;

  const validation = getValidation();
  if (validation && validation.reportStatus === 'blocked') {
    return null;
  }

  const sourceCatalog = buildSourceCatalog();

  const columnCatalog = buildColumnCatalog(reportSpec as Record<string, unknown>, sourceCatalog);

  const plan = buildQueryPlan(reportSpec, columnCatalog, validation as Record<string, unknown> | null, sourceCatalog);

  return modeRunners[plan.aggMode as AggMode](plan);
}

export { runReport, _lkKeyPairs };
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).runReport = runReport;
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).executeReport = runReport;
