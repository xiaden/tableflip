/**
 * Report output publishing.
 *
 * Builds a published output from a report specification and its result set,
 * and aggregates all published outputs from a workspace into a catalog.
 *
 * Ported from SRC/js/report/report-output.ts — zero imports from SRC/js/.
 * All functions are pure: they accept explicit parameters and return new
 * objects rather than mutating inputs.
 */

import type { ReportSpec, WorkspaceState, BandResultSet } from '../types';
import type { ResultSet } from './result-set';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A published report output ready for display or export.
 * @property reportId - ID of the source report
 * @property outputId - Unique output identifier (reportId + '_output')
 * @property name - Human-readable output name
 * @property columns - Column names in display order
 * @property rows - Data rows (excluding subtotal/spacer rows)
 * @property source - Origin marker ('report')
 * @property publishedAt - Timestamp (ms) when the output was published
 */
export interface PublishedOutput {
  reportId: string;
  outputId: string;
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  source: string;
  publishedAt: number;
  /**
   * Present when detail bands are active. Contains flat parent rows + separate
   * band result sets. When present, columns and rows contain only parent data.
   */
  bandResult?: BandResultSet;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extract displayable columns and data rows from a result set.
 * Uses displayCols from metadata when available, otherwise falls back to columns.
 * Filters out subtotal/spacer rows (rows where _row_type is non-null and non-zero).
 *
 * Under the overlay model, ResultSet.columns contains only parent columns
 * (no _band_id, no band columns). Band data lives in resultSet.bandResult.bandResults[].
 *
 * @param resultSet - The result set to extract from
 * @returns Object with columns and filtered rows
 */
function createResultTable(resultSet: ResultSet): { columns: string[]; rows: Record<string, unknown>[] } {
  const cols = (resultSet.metadata && resultSet.metadata.displayCols.length > 0)
    ? resultSet.metadata.displayCols
    : resultSet.columns;
  const rows = (resultSet.rows || []).filter((r: Record<string, unknown>) => {
    const t = r['_row_type'];
    return t == null || t === 0;
  });
  return { columns: cols, rows };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Publish a single report output from a report spec and its result set.
 * Pure — does not mutate inputs.
 * @param reportSpec - The report specification
 * @param resultSet - The query result set
 * @returns A {@link PublishedOutput} containing the filtered result data
 */
export function publishReportOutput(reportSpec: ReportSpec, resultSet: ResultSet): PublishedOutput {
  const table = createResultTable(resultSet);
  return {
    reportId:    reportSpec.id || 'default',
    outputId:    (reportSpec.id || 'default') + '_output',
    name:        (reportSpec.name || 'Report') + ' (output)',
    columns:     table.columns,
    rows:        table.rows,
    source:      'report',
    publishedAt: Date.now(),
    ...(resultSet.bandResult ? { bandResult: resultSet.bandResult } : {}),
  };
}

/**
 * Build a catalog of all published report outputs from a workspace.
 * Iterates all reports, checks publish.enabled, and looks up each report's
 * result set from the cache. Pure — does not mutate inputs.
 * @param workspaceState - The workspace containing report definitions
 * @param resultCache - Map of reportId → ResultSet for completed queries
 * @returns Map of outputId → PublishedOutput for all enabled, cached reports
 */
export function buildPublishedOutputCatalog(
  workspaceState: WorkspaceState,
  resultCache: Map<string, ResultSet>,
): Map<string, PublishedOutput> {
  const catalog = new Map<string, PublishedOutput>();
  const reports = (workspaceState && workspaceState.reports) || [];
  for (const report of reports) {
    if (!report.publish || !report.publish.enabled) continue;
    const resultSet = report.id && resultCache.get(report.id);
    if (!resultSet) continue;
    const output = publishReportOutput(report, resultSet);
    catalog.set(output.outputId, output);
  }
  return catalog;
}
