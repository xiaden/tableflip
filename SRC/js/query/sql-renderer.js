'use strict';

// ── SQL Renderer Facade ─────────────────────────────────────────────────────────
// SQL rendering has been split into concern-specific modules loaded in this order:
//
//   sql-where.js          renderWhereClause, buildWhere
//   sql-aggregates.js     renderAggregateExpr
//   sql-calcs.js          _renderCalcExpr
//   sql-joins.js          renderFromJoinWhere
//   sql-detail.js         renderDetailSql
//   sql-grouped.js        renderGroupedSql
//   sql-totals.js         renderTotalsSql
//   sql-subtotals.js      renderSubtotalsSql
//
// This file remains as a documentation hub and API reference.
// All functions are defined globally by the individual modules.
//
// Public API:
//   renderWhereClause(colRef, op, val, params, opts?)
//   renderAggregateExpr(fn, colRef)
//   renderFromJoinWhere(plan)  → { fromClause, joinClauses, whereParts, params, ref }
//   renderDetailSql(plan)      → { sql, params, cols }
//   renderGroupedSql(plan)     → { sql, params, cols }
//   renderTotalsSql(plan, detailCols)   → { sql, params, cols } | null
//   renderSubtotalsSql(plan)   → { sql, params, cols, displayCols } | null
//   buildWhere === renderWhereClause  (backward-compat alias)
