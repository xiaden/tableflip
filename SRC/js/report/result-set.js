import { db } from '../core/state.js';

// ── Result Set ────────────────────────────────────────────────────────────────
// Stable abstraction for query results.  export.js, grid.js, and report-output.js
// should consume ResultSets rather than reading db.result directly.
//
// Shape:
//   {
//     columns:  string[],
//     rows:     object[],
//     metadata: {
//       rowCount:    number,
//       generatedAt: number,   // Date.now()
//       aggMode:     string,   // 'none'|'group'|'totals'|'subtotals'
//       displayCols: string[]|null,  // set for subtotals mode; cols without sort helpers
//     }
//   }
//
// Row type convention (_row_type column from subtotals queries):
//   0 or absent → detail
//   1           → subtotal
//   2           → spacer
//   3           → grand-total

export function buildResultSet(columns, rows, metadata) {
  const r = Array.isArray(rows) ? rows : [];
  return {
    columns:  Array.isArray(columns) ? columns : [],
    rows:     r,
    metadata: Object.assign({
      rowCount:    r.length,
      generatedAt: Date.now(),
      aggMode:     'none',
      displayCols: null,
    }, metadata || {}),
  };
}

// Returns display columns (displayCols takes precedence for subtotals mode).
function getDisplayColumns(resultSet) {
  return (resultSet.metadata && resultSet.metadata.displayCols) || resultSet.columns;
}

// Returns the logical row type for a row object.
function getRowType(resultSet, row) {
  const t = row['_row_type'];
  if (t === 0 || t == null) return 'detail';
  if (t === 1) return 'subtotal';
  if (t === 2) return 'spacer';
  if (t === 3) return 'grand-total';
  return 'detail';
}

function getResultSchema(resultSet) {
  return {
    columns:  resultSet.columns,
    rowCount: resultSet.metadata.rowCount,
    metadata: resultSet.metadata,
  };
}

// Convenience: build a ResultSet from the current db.result shape.
function resultSetFromDb() {
  if (!db || !db.result) return buildResultSet([], [], {});
  return buildResultSet(
    db.result.cols || [],
    db.result.rows || [],
    {
      aggMode:     db.aggMode     || 'none',
      displayCols: db.result.displayCols || null,
    }
  );
}
