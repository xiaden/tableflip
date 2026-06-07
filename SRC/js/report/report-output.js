// ── Report Output ─────────────────────────────────────────────────────────────
// Defines what a published report produces and how it becomes a source table
// for downstream reports in a multi-report workspace.
//
// Published output shape:
//   {
//     reportId:    string,
//     outputId:    string,    // reportId + '_output'
//     name:        string,
//     columns:     string[],
//     rows:        object[],
//     source:      'report',
//     publishedAt: number,
//   }

// Extract detail rows from a ResultSet (strips subtotal/spacer/grand-total rows).
function createResultTable(resultSet) {
  const cols = (resultSet.metadata && resultSet.metadata.displayCols) || resultSet.columns;
  const rows = (resultSet.rows || []).filter(r => {
    const t = r['_row_type'];
    return t == null || t === 0;
  });
  return { columns: cols, rows };
}

// Build a published output entry from a report spec + ResultSet.
export function publishReportOutput(reportSpec, resultSet) {
  const table = createResultTable(resultSet);
  return {
    reportId:    reportSpec.id   || 'default',
    outputId:    (reportSpec.id  || 'default') + '_output',
    name:        (reportSpec.name || 'Report') + ' (output)',
    columns:     table.columns,
    rows:        table.rows,
    source:      'report',
    publishedAt: Date.now(),
  };
}

// Build a map of outputId → PublishedOutput for all reports that have results
// and have publish.enabled === true.
// workspaceState: { reports: [...] }
// resultCache:    Map<reportId, ResultSet>
export function buildPublishedOutputCatalog(workspaceState, resultCache) {
  const catalog = new Map();
  const reports = (workspaceState && workspaceState.reports) || [];
  for (const report of reports) {
    if (!report.publish || !report.publish.enabled) continue;
    const resultSet = resultCache && resultCache.get(report.id);
    if (!resultSet) continue;
    const output = publishReportOutput(report, resultSet);
    catalog.set(output.outputId, output);
  }
  return catalog;
}
