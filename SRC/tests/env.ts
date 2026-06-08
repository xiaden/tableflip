export function resetDbState(): void {
  const db = (globalThis as any).db;
  const invalidateValidation = (globalThis as any).invalidateValidation;
  
  Object.assign(db, {
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
    mergedCols: [],
    mergeGroupUnderline: false,
    colState: null,
    sorts: [],
    result: null,
  });
  invalidateValidation();
}
