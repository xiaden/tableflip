import type { AppState, WorkspaceState, ReportSpec, LookupSpec, FilterSpec, SortSpec, OutputColumnSpec, AggregateSpec, CalcStage } from '../types.js';

export function createAppState(overrides?: Partial<AppState>): AppState {
  return Object.assign({
    tables: {},
    excludedRows: {},
    tableColors: {},
    columnLabels: {},
    base: '',
    baseCols: null,
    stacks: [],
    lookups: [],
    calcStages: [],
    selCols: null,
    colOrder: null,
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
  }, overrides || {});
}

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

export function createReportSpec(overrides?: Partial<ReportSpec>): ReportSpec {
  return Object.assign({
    id: null,
    name: 'New Report',
    enabled: true,
    pipeline: {
      base: '',
      baseCols: null,
      stacks: [],
      lookups: [],
      calculatedColumns: [],
    },
    outputColumns: null,
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
  }, overrides || {});
}

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

export function createFilterSpec(overrides?: Partial<FilterSpec>): FilterSpec {
  return Object.assign({
    col: '',
    op: 'contains',
    val: '',
    vals: null,
    enabled: true,
  }, overrides || {});
}

export function createSortSpec(overrides?: Partial<SortSpec>): SortSpec {
  return Object.assign({
    col: '',
    dir: 'ASC',
    enabled: true,
  }, overrides || {});
}

export function createOutputColumnSpec(overrides?: Partial<OutputColumnSpec>): OutputColumnSpec {
  return Object.assign({
    alias: '',
    label: '',
    visible: true,
    width: null,
  }, overrides || {});
}
