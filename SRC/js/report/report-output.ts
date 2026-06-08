import { ResultSet } from './result-set.js';

interface PublishedOutput {
  reportId: string;
  outputId: string;
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  source: string;
  publishedAt: number;
}

function createResultTable(resultSet: ResultSet): { columns: string[]; rows: Record<string, unknown>[] } {
  const cols = (resultSet.metadata && resultSet.metadata.displayCols) || resultSet.columns;
  const rows = (resultSet.rows || []).filter((r: Record<string, unknown>) => {
    const t = r['_row_type'];
    return t == null || t === 0;
  });
  return { columns: cols, rows };
}

export function publishReportOutput(reportSpec: Record<string, unknown>, resultSet: ResultSet): PublishedOutput {
  const table = createResultTable(resultSet);
  return {
    reportId:    (reportSpec.id as string)   || 'default',
    outputId:    ((reportSpec.id as string)  || 'default') + '_output',
    name:        ((reportSpec.name as string) || 'Report') + ' (output)',
    columns:     table.columns,
    rows:        table.rows,
    source:      'report',
    publishedAt: Date.now(),
  };
}

export function buildPublishedOutputCatalog(workspaceState: Record<string, unknown>, resultCache: Map<string, ResultSet>): Map<string, PublishedOutput> {
  const catalog = new Map<string, PublishedOutput>();
  const reports = (workspaceState && (workspaceState.reports as Record<string, unknown>[])) || [];
  for (const report of reports) {
    const publish = report.publish as Record<string, unknown> | undefined;
    if (!publish || !publish.enabled) continue;
    const resultSet = resultCache && resultCache.get(report.id as string);
    if (!resultSet) continue;
    const output = publishReportOutput(report, resultSet);
    catalog.set(output.outputId, output);
  }
  return catalog;
}
