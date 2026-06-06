'use strict';

// ── Query Plan ─────────────────────────────────────────────────────────────────
// Intermediate representation between a ReportSpec (window.db config) and SQL.
// buildQueryPlan() reads config state, strips disabled/unresolvable items, and
// returns a clean plan that sql-renderer.js can render without touching db config.
//
// Plan shape:
//   {
//     source: { base, stacks, baseCols, excludedRows, tablesById },
//     joins:  [{ rightId, keyPairs, required, excludedRows, rightColumns, rightTableName }],
//     calculatedColumns: [...],
//     filters:           [...],
//     selectedColumns:   string[],
//     groupBy:           string[],
//     aggregates:        [...],
//     sorts:             [...],
//     colTotals:         { alias: fn },
//     subtotalBy:        string[],
//     subtotalFns:       { alias: fn },
//     subtotalGrandTotal: boolean,
//     subtotalSpacer:     boolean,
//     subtotalOnTop:      boolean,
//     aggMode:           string,
//     colMap:            Map,
//     validation:        object | null,
//   }

function buildQueryPlan(reportSpec, columnCatalog, validation, sourceCatalog) {
  reportSpec    = reportSpec    || db;
  sourceCatalog = sourceCatalog || (typeof buildSourceCatalog === 'function' ? buildSourceCatalog() : null);
  columnCatalog = columnCatalog || buildColumnCatalog(reportSpec, sourceCatalog);
  validation    = validation    || (typeof getValidation === 'function' ? getValidation() : null);

  const colMap = columnCatalog.colMap;

  // Build tablesById from sourceCatalog
  const tablesById = new Map();
  if (sourceCatalog instanceof Map) {
    for (const [tid, entry] of sourceCatalog) {
      tablesById.set(tid, { cols: entry.cols, name: entry.name });
    }
  }

  // Source
  const source = {
    base:        reportSpec.base || '',
    stacks:      (reportSpec.stacks || []).filter(id => tablesById.has(id)),
    baseCols:    reportSpec.baseCols || (tablesById.has(reportSpec.base) ? tablesById.get(reportSpec.base).cols : null),
    excludedRows: reportSpec.excludedRows || {},
    tablesById,
  };

  // Joins — enabled lookups with complete key pairs and loaded right table
  const joins = (reportSpec.lookups || [])
    .filter(lk => lk.enabled !== false && lk.rightId && tablesById.has(lk.rightId))
    .map(lk => {
      const rtMeta = tablesById.get(lk.rightId);
      return {
        rightId:     lk.rightId,
        rightColumns: rtMeta ? rtMeta.cols : [],
        rightTableName: rtMeta ? rtMeta.name : lk.rightId,
        keyPairs:    (lk.keyPairs || []).filter(p => p.left && p.right),
        required:    !!lk.required,
        duplicatePolicy: lk.duplicatePolicy || { mode: 'block' },
        excludedRows: (reportSpec.excludedRows || {})[lk.rightId] || null,
      };
    })
    .filter(j => j.keyPairs.length > 0);

  // Calculated columns from colMap (kind === 'calc')
  const calculatedColumns = [...colMap.values()].filter(e => e.kind === 'calc');

  // Filters — enabled only
  const filters = (reportSpec.filters || []).filter(f => f.enabled !== false && f.col);

  // Selected columns in colOrder, filtered by selCols when set
  const orderedAliases = reportSpec.colOrder
    ? reportSpec.colOrder.filter(a => colMap.has(a))
    : [...colMap.keys()];
  const selCols = reportSpec.selCols instanceof Set ? reportSpec.selCols : null;
  const selectedColumns = selCols
    ? orderedAliases.filter(a => selCols.has(a))
    : orderedAliases;

  // Sorts — enabled only
  const sorts = (reportSpec.sorts || []).filter(s => s.enabled !== false && s.col && colMap.has(s.col));

  return {
    source,
    joins,
    calculatedColumns,
    filters,
    selectedColumns,
    groupBy:            reportSpec.groupBy         || [],
    aggregates:         reportSpec.aggregates       || [],
    sorts,
    colTotals:          reportSpec.colTotals         || {},
    subtotalBy:         reportSpec.subtotalBy        || [],
    subtotalFns:        reportSpec.subtotalFns        || {},
    subtotalGrandTotal: reportSpec.subtotalGrandTotal !== false,
    subtotalSpacer:     !!reportSpec.subtotalSpacer,
    subtotalOnTop:      !!reportSpec.subtotalOnTop,
    aggMode:            reportSpec.aggMode           || 'none',
    colMap,
    validation,
  };
}
