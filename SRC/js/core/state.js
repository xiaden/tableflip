const db = {
  tables:       {},    // id → { id, name, cols, rowCount }
  excludedRows: {},    // id → Set<rowno>
  tableColors:  {},    // id → hex color from palette
  columnLabels: {},    // id → { physCol → customLabel }
  base:         '',
  baseCols:     null,  // null = all columns; array = selected subset from base sheet
  stacks:       [],    // tableIds to UNION ALL with base (same structure)
  lookups:      [],    // [{ rightId, keyPairs:[{left,right}], cols:[], required:false }]
  calcStages:   [],    // [{ alias, left, op, right, conditions, compareMode, window, explicitOrder, orderCol, orderDir }]
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
  subtotalStrategy:   'combined',
  mergedCols:         [],
  mergeGroupUnderline:false,
  colState:           null,
  sorts:              [],
  result:             null,
};

// Backward compat for HTML onclick handlers and test env.js
window.db = db;

export { db };

// ── Constructor functions ─────────────────────────────────────────────────────
// These produce clean default-state objects.  They do NOT read from window.db.
// Use them when building new workspace states, report specs, or config items.

// Produces a clean workspace state (multi-report shell).
// sourceTables mirrors the current db.tables schema.
export function createWorkspaceState(overrides) {
  return Object.assign({
    version:       1,
    sourceTables:  {},
    reports:       [],
    activeReportId: null,
    runtime: {
      resultsByReportId:    {},
      validationByReportId: {},
      activeGridState:      {},
    },
  }, overrides || {});
}

// Produces a clean single-report spec.
export function createReportSpec(overrides) {
  return Object.assign({
    id:          null,
    name:        'New Report',
    enabled:     true,
    pipeline: {
      base:             '',
      baseCols:         null,
      stacks:           [],
      lookups:          [],
      calculatedColumns:[],
    },
    outputColumns:  null,
    filters:        [],
    sorts:          [],
    aggregation: {
      mode:              'none',
      groupBy:           [],
      aggregates:        [],
      colTotals:         {},
      subtotalBy:        [],
      subtotalFns:       {},
      subtotalGrandTotal: true,
      subtotalSpacer:     false,
      subtotalOnTop:      false,
      subtotalStrategy:   'combined',
    },
    mergeDisplay: {
      mergedCols:          [],
      mergeGroupUnderline: false,
    },
    outputDefinition: null,
    publish: {
      enabled:   false,
      tableName: '',
    },
  }, overrides || {});
}

// Produces a clean lookup spec.
export function createLookupSpec(overrides) {
  return Object.assign({
    rightId:         '',
    keyPairs:        [],   // [{ left, right }]
    cols:            [],
    required:        false,
    enabled:         true,
    duplicatePolicy: { mode: 'block' },
  }, overrides || {});
}

// Produces a clean filter spec.
export function createFilterSpec(overrides) {
  return Object.assign({
    col:     '',
    op:      'contains',
    val:     '',
    vals:    null,
    enabled: true,
  }, overrides || {});
}

// Produces a clean sort spec.
export function createSortSpec(overrides) {
  return Object.assign({
    col:     '',
    dir:     'ASC',
    enabled: true,
  }, overrides || {});
}

// Produces a clean output-column spec.
export function createOutputColumnSpec(overrides) {
  return Object.assign({
    alias:       '',      // projected column alias
    label:       '',      // custom display label (empty = use alias)
    visible:     true,
    width:       null,    // null = auto
  }, overrides || {});
}

