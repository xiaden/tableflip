'use strict';

// ── engine.js — Query execution facade ───────────────────────────────────────
// All SQL generation moved to query-plan.js + sql-renderer.js.
// This module orchestrates: Validation → QueryPlan → SQL → ResultSet.

// ── Key-pair helpers ─────────────────────────────────────────────────────────
// Returns the array of {left,right} pairs for a lookup.
function _lkKeyPairs(lk) {
  return Array.isArray(lk.keyPairs) ? lk.keyPairs.filter(p => p.left && p.right) : [];
}

// ── Execution facade ──────────────────────────────────────────────────────────
// executeReport: high-level entry point for running a report.
// Pipeline: Validation → SourceCatalog → ColumnCatalog → QueryPlan → SQL → ResultSet.
// Returns a ResultSet (see result-set.js: { columns, rows, metadata }).
function executeReport(reportSpec) {
  reportSpec = reportSpec || db;

  // 1. Check validation — throws if blocked.
  const validation = typeof getValidation === 'function' ? getValidation() : null;
  if (validation && validation.reportStatus === 'blocked') {
    const blockingIssues = [];
    if (validation.items) {
      for (const item of Object.values(validation.items)) {
        if (item.blocking) blockingIssues.push(...item.issues);
      }
    }
    const firstMsg = blockingIssues[0] ? blockingIssues[0].message : 'fix blocking issues';
    throw new Error('Report is blocked: ' + firstMsg);
  }

  // 2. Build source catalog — includes imported sheets and published upstream reports.
  const sourceCatalog = typeof buildSourceCatalog === 'function'
    ? buildSourceCatalog()
    : null;

  // 3. Build column catalog using the source catalog.
  const columnCatalog = typeof buildColumnCatalog === 'function'
    ? buildColumnCatalog(reportSpec, sourceCatalog)
    : null;

  // 4. Build query plan (intermediate representation between ReportSpec and SQL).
  const plan = buildQueryPlan(reportSpec, columnCatalog, validation, sourceCatalog);

  const mode = plan.aggMode;

  // 5. Render SQL, execute, and return a ResultSet.
  if (mode === 'totals') {
    const detail     = renderDetailSql(plan);
    const detailRows = execQuery(detail.sql, detail.params);
    const totals     = renderTotalsSql(plan, detail.cols);

    if (!totals) {
      // No aggregates defined: just return sorted detail rows with no totals row.
      return createResultSet(detail.cols, detailRows, { mode });
    }

    const totalsRows = execQuery(totals.sql, totals.params);
    // Pad detail rows with null for new aggregate-only columns so schema matches totals row.
    const newAggCols = totals.cols.slice(detail.cols.length);
    const paddedRows = newAggCols.length
      ? detailRows.map(r => {
          const row = Object.assign({}, r);
          newAggCols.forEach(c => { row[c] = null; });
          return row;
        })
      : detailRows;
    return createResultSet(totals.cols, paddedRows, { mode, totalsRow: totalsRows[0] || null });
  }

  if (mode === 'subtotals') {
    const result = renderSubtotalsSql(plan);
    if (!result) throw new Error('No output columns configured for subtotals view.');
    const rows = execQuery(result.sql, result.params);
    return createResultSet(result.displayCols, rows, {
      mode,
      hasSubtotals: true,
      allCols: result.cols,
    });
  }

  if (mode === 'group') {
    const { sql, params, cols } = renderGroupedSql(plan);
    const rows = execQuery(sql, params);
    return createResultSet(cols, rows, { mode });
  }

  // Default: plain detail (mode === 'none' or unknown).
  const { sql, params, cols } = renderDetailSql(plan);
  const rows = execQuery(sql, params);
  return createResultSet(cols, rows, { mode: 'none' });
}
