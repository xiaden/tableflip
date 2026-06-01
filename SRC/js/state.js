'use strict';

window.db = {
  tables:       {},    // id → { id, name, cols, rowCount }
  excludedRows: {},    // id → Set<rowno>
  tableColors:  {},    // id → hex color from palette
  columnLabels: {},    // id → { physCol → customLabel }
  base:         '',
  baseCols:     null,  // null = all columns; array = selected subset from base sheet
  stacks:       [],    // tableIds to UNION ALL with base (same structure)
  lookups:      [],    // [{ rightId, leftKey, rightKey, cols:[], required:false }]
  calcStages:   [],    // [{ alias, left, op, right, conditions, compareMode, window, explicitOrder, orderCol, orderDir }]
  joins:        [],    // legacy — kept for backward compat with saved .rcjson files
  selCols:      null,
  colOrder:     null,
  filters:      [],
  groupBy:      [],
  aggregates:   [],
  aggMode:            'none',
  aggModeState:       null,  // per-mode layout settings snapshot
  colTotals:          {},
  subtotalBy:         [],
  subtotalFns:        {},
  subtotalGrandTotal: true,
  subtotalSpacer:     false,
  subtotalOnTop:      false,
  mergedCols:         [],
  mergeGroupUnderline:false,
  colState:           null,
  sorts:              [],
  result:             null,
};
