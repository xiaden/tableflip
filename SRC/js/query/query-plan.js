'use strict';

// ── Query Plan ─────────────────────────────────────────────────────────────────
// Intermediate representation between a ReportSpec (window.db config) and SQL.
// buildQueryPlan() reads config state, strips disabled/unresolvable items, and
// returns a clean plan that sql-renderer.js can render without touching db config.
//
// Plan shape:
//   {
//     source: { base, stacks, baseCols, excludedRows },
//     joins:  [{ rightId, keyPairs, required, excludedRows }],
//     calculatedColumns: [...],   // colMap entries for calc cols
//     filters:           [...],   // enabled filter specs
//     selectedColumns:   string[],
//     groupBy:           string[],
//     aggregates:        [...],
//     sorts:             [...],   // enabled sort specs
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

function buildQueryPlan(reportSpec, columnCatalog, validation) {
  reportSpec    = reportSpec    || db;
  columnCatalog = columnCatalog || buildColumnCatalog(reportSpec);
  validation    = validation    || (typeof getValidation === 'function' ? getValidation() : null);

  const colMap = columnCatalog.colMap;

  // Source
  const source = {
    base:        reportSpec.base || '',
    stacks:      (reportSpec.stacks || []).filter(id => db.tables && db.tables[id]),
    baseCols:    reportSpec.baseCols || (reportSpec.base && db.tables[reportSpec.base] ? db.tables[reportSpec.base].cols : null),
    excludedRows: reportSpec.excludedRows || {},
  };

  // Joins — enabled lookups with complete key pairs and loaded right table
  const joins = (reportSpec.lookups || [])
    .filter(lk => lk.enabled !== false && lk.rightId && db.tables && db.tables[lk.rightId])
    .map(lk => ({
      rightId:     lk.rightId,
      keyPairs:    (lk.keyPairs || []).filter(p => p.left && p.right),
      required:    !!lk.required,
      excludedRows: (reportSpec.excludedRows || {})[lk.rightId] || null,
    }))
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
