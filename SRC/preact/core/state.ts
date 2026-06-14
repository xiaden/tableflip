import type { AppState, WorkspaceState, ReportSpec, LookupSpec, FilterSpec, SortSpec, OutputColumnSpec, DetailBandSpec } from '../types';

/**
 * Creates a default AppState with sensible defaults, then applies optional overrides.
 * Defaults include empty tables, no base table, no filters/sorts, and aggMode 'none'.
 * @param overrides - Partial state to merge over defaults
 * @returns Complete AppState object
 */
export function createAppState(overrides?: Partial<AppState>): AppState {
  return Object.assign({
    tables: {},
    excludedRows: {},
    tableColors: {},
    columnLabels: {},
    base: '',
    baseCols: [],
    stacks: [],
    lookups: [],
    calcStages: [],
    selCols: new Set(),
    colOrder: [],
    filters: [],
    groupBy: [],
    aggregates: [],
    aggMode: 'none',
    aggModeState: null,
    colTotals: {},
    subtotalBy: [],
    subtotalFns: {},
    subtotalGrandTotal: true,
    subtotalSpacer: false,
    subtotalOnTop: false,
    subtotalStrategy: 'combined',
    mergedCols: [],
    mergeGroupUnderline: false,
    colState: null,
    sorts: [],
    result: null,
    activeTab: 'query',
    previewTableId: null,
    detailBands: [],
    detailBandMode: 'separate',
    columnTypeOverrides: {},
  }, overrides || {});
}

/**
 * Creates a default WorkspaceState with an empty report list and runtime.
 * @param overrides - Partial workspace state to merge over defaults
 * @returns Complete WorkspaceState object
 */
export function createWorkspaceState(overrides?: Partial<WorkspaceState>): WorkspaceState {
  return Object.assign({
    version: 1,
    sourceTables: {},
    reports: [],
    activeReportId: null,
    runtime: {
      resultsByReportId: {},
      validationByReportId: {},
      activeGridState: {},
    },
  }, overrides || {});
}

/**
 * Creates a default ReportSpec for a new report.
 * Defaults: name "New Report", enabled, no base table, aggMode 'none'.
 * @param overrides - Partial report spec to merge over defaults
 * @returns Complete ReportSpec object
 */
export function createReportSpec(overrides?: Partial<ReportSpec>): ReportSpec {
  return Object.assign({
    id: null,
    name: 'New Report',
    enabled: true,
    pipeline: {
      base: '',
      baseCols: [],
      stacks: [],
      lookups: [],
      calculatedColumns: [],
      detailBands: [],
    },
    outputColumns: [],
    filters: [],
    sorts: [],
    aggregation: {
      mode: 'none',
      groupBy: [],
      aggregates: [],
      colTotals: {},
      subtotalBy: [],
      subtotalFns: {},
      subtotalGrandTotal: true,
      subtotalSpacer: false,
      subtotalOnTop: false,
      subtotalStrategy: 'combined',
    },
    mergeDisplay: {
      mergedCols: [],
      mergeGroupUnderline: false,
    },
    outputDefinition: null,
    publish: {
      enabled: false,
      tableName: '',
    },
    detailBandMode: 'separate',
  }, overrides || {});
}

/**
 * Creates a default LookupSpec for a new table join.
 * Defaults: empty key pairs, no required match, enabled.
 * @param overrides - Partial lookup spec to merge over defaults
 * @returns Complete LookupSpec object
 */
export function createLookupSpec(overrides?: Partial<LookupSpec>): LookupSpec {
  return Object.assign({
    rightId: '',
    keyPairs: [],
    cols: [],
    required: false,
    enabled: true,
    duplicatePolicy: { mode: 'block' },
  }, overrides || {});
}

/**
 * Creates a default DetailBandSpec for a new detail band.
 * Called when the user adds a new detail band in the UI.
 * Defaults: empty right table, one empty key pair, enabled, no sorts.
 * @param overrides - Partial detail band spec to merge over defaults
 * @returns Complete DetailBandSpec object
 */
export function createDetailBandSpec(overrides?: Partial<DetailBandSpec>): DetailBandSpec {
  return Object.assign({
    id: `band_${Date.now()}`,
    rightId: '',
    keyPairs: [{ left: '', right: '' }],
    cols: [],
    enabled: true,
    sorts: [],
    label: '',
  }, overrides || {});
}

/**
 * Builds a ReportSpec-shaped object suitable for projectedCols() and
 * buildColumnCatalog() from the current AppState.
 *
 * Consolidates the 13 inline `{ base, lookups, calcStages }` constructions
 * scattered across the UI layer into a single helper, ensuring detailBands
 * is always included so band columns appear in the catalog.
 *
 * @param state - The current AppState (or a mutable draft thereof)
 * @returns Flat object with base, lookups, calcStages, and detailBands
 */
export function buildReportSpecFromState(state: AppState): Record<string, unknown> {
  return {
    base: state.base,
    baseCols: state.baseCols,
    stacks: state.stacks,
    lookups: state.lookups,
    calcStages: state.calcStages,
    detailBands: state.detailBands || [],
  };
}

/**
 * Creates a default FilterSpec for a new filter.
 * Defaults: empty column, 'contains' operator, enabled.
 * @param overrides - Partial filter spec to merge over defaults
 * @returns Complete FilterSpec object
 */
export function createFilterSpec(overrides?: Partial<FilterSpec>): FilterSpec {
  return Object.assign({
    col: '',
    op: 'contains',
    val: '',
    vals: null,
    enabled: true,
  }, overrides || {});
}

/**
 * Creates a default SortSpec for a new sort column.
 * Defaults: empty column, 'ASC' direction, enabled.
 * @param overrides - Partial sort spec to merge over defaults
 * @returns Complete SortSpec object
 */
export function createSortSpec(overrides?: Partial<SortSpec>): SortSpec {
  return Object.assign({
    col: '',
    dir: 'ASC',
    enabled: true,
  }, overrides || {});
}

/**
 * Creates a default OutputColumnSpec for a new output column.
 * Defaults: empty alias/label, visible, auto width.
 * @param overrides - Partial output column spec to merge over defaults
 * @returns Complete OutputColumnSpec object
 */
export function createOutputColumnSpec(overrides?: Partial<OutputColumnSpec>): OutputColumnSpec {
  return Object.assign({
    alias: '',
    label: '',
    visible: true,
    width: null,
  }, overrides || {});
}
