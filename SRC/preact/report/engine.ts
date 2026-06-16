/**
 * Report execution engine.
 *
 * Orchestrates: build query plan → execute SQL → build result set.
 * Ported from SRC/js/report/engine.ts — zero imports from SRC/js/.
 * Pure function — no global state dependency.
 *
 * Dispatches to mode-specific handlers based on aggregation mode:
 * - **detail bands** (none + enabled bands): parent query + per-band queries + BandResultSet
 * - **detail** (none): simple SELECT with WHERE, JOINs, ORDER BY
 * - **totals**: detail rows + a single aggregate totals row
 * - **subtotals**: detail rows interleaved with subtotal/spacing/grand-total rows
 * - **group**: GROUP BY with aggregate expressions
 */

import type { ReportSpec, DbTable, AggMode, BandResult, BandResultSet } from '../types';
export type { BandResult } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { BuiltQueryPlan } from '../query/query-plan';
import { buildQueryPlan } from '../query/query-plan';
import { buildSourceCatalog } from '../catalog/source-catalog';
import { buildColumnCatalog } from '../catalog/column-catalog';
import { buildDetailQuery } from '../query/sql-detail';
import { buildBandQuery } from '../query/sql-detail-bands';
import type { BandQueryResult } from '../query/sql-detail-bands';
import { buildCalcExpressions } from '../query/sql-calcs';
import { execQuery } from '../core/sqldb';
import { buildResultSet } from './result-set';
import type { ResultSet } from './result-set';

// ── Mode Dispatchers ─────────────────────────────────────────────────────────

/**
 * Detail mode — no aggregation.
 * Executes the plan's SQL directly and returns the result set.
 */
function runDetailMode(plan: BuiltQueryPlan): ResultSet {
  const rows = execQuery(plan.sql, plan.params);
  return buildResultSet(plan.cols, rows, { aggMode: 'none' });
}

/**
 * Totals mode — detail rows plus a single aggregate totals row.
 *
 * Builds a separate detail query for the raw data rows, executes the
 * totals query from the plan, and combines them: the detail rows form
 * the body, and the single totals row is attached as metadata.
 * New aggregate columns (not present in the detail query) are padded
 * with null so both result sets have the same column shape.
 */
function runTotalsMode(
  plan: BuiltQueryPlan,
  reportSpec: ReportSpec,
  tables: Record<string, DbTable>,
): ResultSet {
  // Rebuild source catalog + column catalog for the detail query.
  // (buildQueryPlan already does this internally, but does not expose
  // the intermediate catalog objects — so we rebuild here.)
  const sourceCatalog = buildSourceCatalog(tables);
  const catalogCtx: Record<string, unknown> = {
    base: reportSpec.pipeline.base,
    baseCols: reportSpec.pipeline.baseCols,
    stacks: reportSpec.pipeline.stacks,
    lookups: reportSpec.pipeline.lookups,
    calcStages: reportSpec.pipeline.calculatedColumns,
    detailBands: reportSpec.pipeline.detailBands || [],
  };
  const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);

  // Build calcExprs map for the detail query
  const calcStages = reportSpec.pipeline.calculatedColumns || [];
  const calculatedColumns = buildCalcExpressions(calcStages, colMap);
  const calcExprs = new Map<string, string>();
  for (const col of calculatedColumns) {
    calcExprs.set(col.alias, col.sql);
  }

  // Build and execute the detail query (all data rows, no aggregation)
  const detail = buildDetailQuery(reportSpec, colMap, sourceCatalog, calcExprs);
  const detailRows = execQuery(detail.sql, detail.params);

  // Execute the totals query (from the plan — a single aggregated row)
  const totalsRows = execQuery(plan.sql, plan.params);

  // Pad detail rows for aggregate columns not present in the detail result.
  // The totals query may introduce extra columns (e.g. SUM, AVG) that the
  // detail query does not select — these need null placeholders.
  const newAggCols = plan.cols.slice(detail.cols.length);
  const paddedRows = newAggCols.length
    ? detailRows.map(r => {
        const row = { ...r };
        for (const c of newAggCols) row[c] = null;
        return row;
      })
    : detailRows;

  return buildResultSet(plan.cols, paddedRows, {
    aggMode: 'totals',
    totalsRow: totalsRows[0] || null,
  });
}

/**
 * Subtotals mode — detail rows interleaved with subtotal, spacer,
 * and grand-total rows via UNION ALL.
 *
 * The plan's SQL already contains the complete UNION ALL query with
 * internal marker columns for hierarchical ordering. We just execute
 * it and attach subtotal metadata.
 */
function runSubtotalsMode(plan: BuiltQueryPlan): ResultSet {
  const rows = execQuery(plan.sql, plan.params);
  return buildResultSet(plan.cols, rows, {
    aggMode: 'subtotals',
    hasSubtotals: true,
    allCols: plan.cols,
  });
}

/**
 * Grouped mode — aggregated rows with GROUP BY.
 * Executes the plan's SQL directly and returns the result set.
 */
function runGroupedMode(plan: BuiltQueryPlan): ResultSet {
  const rows = execQuery(plan.sql, plan.params);
  return buildResultSet(plan.cols, rows, { aggMode: 'group' });
}

// ── Detail Bands Helpers ────────────────────────────────────────────────────────

/**
 * Build a composite key string from a row using the given key columns.
 * For single-key, returns the raw value (as string). For multi-key,
 * concatenates values with the ||| separator (matching sql-joins.ts pattern).
 */
export function makeKeyValue(row: Record<string, unknown>, keyCols: string[]): string {
  if (keyCols.length === 1) return String(row[keyCols[0]] ?? '');
  return keyCols.map(k => String(row[k] ?? '')).join('|||');
}

/**
 * Pre-built index for O(1) child row lookup by key value.
 * Maps bandId → Map<compositeKeyValue, matchingRows[]>.
 *
 * Built once per set of band results and reused across all parent rows
 * by the overlay grouping layer (Part B).
 */
export type BandChildIndex = Map<string, Map<string, Record<string, unknown>[]>>;

/**
 * Build a Map-based index of band rows keyed by their child key values.
 *
 * Building the index is O(totalBandRows); each subsequent lookup is O(1).
 * Reused by the overlay grouping layer (Part B) for efficient child row matching.
 *
 * @param bandResults - Array of band query results to index.
 * @returns A BandChildIndex for O(1) child row lookup by parent key value.
 */
export function buildBandChildIndex(bandResults: BandResult[]): BandChildIndex {
  const index: BandChildIndex = new Map();
  for (const br of bandResults) {
    const idx = new Map<string, Record<string, unknown>[]>();
    for (const row of br.rows) {
      const key = makeKeyValue(row, br.childKeyCols);
      let bucket = idx.get(key);
      if (!bucket) {
        bucket = [];
        idx.set(key, bucket);
      }
      bucket.push(row);
    }
    index.set(br.band.id, idx);
  }
  return index;
}

// ── Detail Bands Mode ───────────────────────────────────────────────────────────

/**
 * Detail bands mode — parent rows combined with child rows from detail bands.
 *
 * Executes the parent query (detail SQL), then for each enabled band, extracts
 * parent key values and runs a batched WHERE IN query to fetch all child rows
 * at once. Returns a {@link ResultSet} with `bandResult` populated — columns
 * and rows contain only parent data; band data is in `bandResult.bandResults`.
 *
 * @param plan           - The built query plan (contains parent SQL, params, and column list).
 * @param reportSpec     - The typed report specification (contains detailBands, pipeline).
 * @param tables         - Raw table definitions keyed by table ID.
 * @returns A {@link ResultSet} with parent-only columns/rows and `bandResult` populated.
 */
export function runDetailBandsMode(
  plan: BuiltQueryPlan,
  reportSpec: ReportSpec,
  tables: Record<string, DbTable>,
): ResultSet {
  // 1. Execute parent query (same as detail mode)
  const parentRows = execQuery(plan.sql, plan.params);

  // 2. Build catalogs for band query construction
  const sourceCatalog = buildSourceCatalog(tables);
  const catalogCtx: Record<string, unknown> = {
    base: reportSpec.pipeline.base,
    baseCols: reportSpec.pipeline.baseCols,
    stacks: reportSpec.pipeline.stacks,
    lookups: reportSpec.pipeline.lookups,
    calcStages: reportSpec.pipeline.calculatedColumns,
    detailBands: reportSpec.pipeline.detailBands || [],
  };
  const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);

  // 3. Determine parent columns from actual row data (defensive — plan.cols
  //    may include band columns that the parent SQL does not SELECT)
  const parentCols: string[] = [];
  if (parentRows.length > 0) {
    const seen = new Set<string>();
    for (const row of parentRows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          parentCols.push(key);
          seen.add(key);
        }
      }
    }
  }

  // 4. Process each enabled detail band
  const bands = (reportSpec.pipeline.detailBands || []).filter(b => b.enabled !== false && b.rightId);
  const bandResults: BandResult[] = [];

  for (const band of bands) {
    // Build band-specific colMap from the full colMap (entries with _{bandId}_ prefix
    // and kind: 'band' — these are the physical column references for the band query).
    const prefix = `_${band.id}_`;
    const bandColMap = new Map<string, ColMapEntry>();
    for (const [alias, entry] of colMap) {
      if (alias.startsWith(prefix) && entry.kind === 'band') {
        bandColMap.set(alias, entry);
      }
    }

    // Skip bands with no columns selected — nothing to display
    if (bandColMap.size === 0) continue;

    // Extract deduplicated parent key values
    const pairs = (band.keyPairs || []).filter(p => p.left && p.right);
    if (pairs.length === 0) continue;

    const parentKeyAliases = pairs.map(p => p.left);
    const keyValues = new Set<string>();
    for (const row of parentRows) {
      const kv = makeKeyValue(row, parentKeyAliases);
      if (kv !== undefined) keyValues.add(kv);
    }
    if (keyValues.size === 0) continue;

    // Build and execute band query
    const bandQuery: BandQueryResult = buildBandQuery(band, keyValues as Set<unknown>, bandColMap, sourceCatalog);
    const bandRows = execQuery(bandQuery.sql, bandQuery.params);

    // Tag each band row with _band_id
    for (const row of bandRows) {
      row._band_id = band.id;
    }

    bandResults.push({
      band,
      rows: bandRows,
      cols: bandQuery.cols,
      parentKeyAliases: bandQuery.parentKeyAliases,
      childKeyCols: bandQuery.childKeyCols,
    });
  }

  // 5. Build band labels map
  const bandLabels: Record<string, string> = {};
  for (const br of bandResults) {
    bandLabels[br.band.id] = br.band.label || br.band.id;
  }

  // 6. Build BandResultSet and attach to ResultSet
  const brs: BandResultSet = {
    parentRows,
    parentCols,
    bandResults,
    bandLabels,
  };

  const result = buildResultSet(parentCols, parentRows, {
    aggMode: 'none',
    bandCount: bandResults.length,
    bandIds: bandResults.map(br => br.band.id),
    bandLabels,
  });
  result.bandResult = brs;
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a preview query and return raw result rows.
 *
 * Thin wrapper around {@link execQuery} that keeps SQL execution inside
 * the engine module. Used by {@link buildPreview} for lightweight preview
 * queries that don't need full {@link ResultSet} construction.
 *
 * @param sql    - The SQL query string.
 * @param params - Optional positional parameters for the query.
 * @returns Array of row objects with column names as keys.
 */
export function runPreviewQuery(sql: string, params?: unknown[]): Record<string, unknown>[] {
  return execQuery(sql, params);
}

/**
 * Run a report — the main entry point for report execution.
 *
 * Orchestrates: build query plan → execute SQL → build result set.
 * Dispatches to the appropriate mode handler based on the report's
 * aggregation mode (none, totals, subtotals, group).
 *
 * @param reportSpec     - The typed report specification defining the full
 *                         report pipeline (base table, lookups, calc stages,
 *                         filters, sorts, aggregation config, and output columns).
 * @param tables         - Raw table definitions keyed by table ID. Each entry
 *                         contains id, name, cols, and rowCount.
 * @returns A {@link ResultSet} with columns, rows, and metadata.
 * @throws If the reportSpec has no base table defined or the aggregation
 *         mode produces no output.
 */
export function runReport(
  reportSpec: ReportSpec,
  tables: Record<string, DbTable>,
): ResultSet {
  const plan = buildQueryPlan(reportSpec, tables);

  // Detail bands dispatch: when enabled bands exist and aggMode is 'none',
  // use the detail bands mode (returns ResultSet with bandResult populated).
  const enabledBands = (reportSpec.pipeline.detailBands || []).filter(b => b.enabled !== false && b.rightId);
  if (enabledBands.length > 0 && plan.aggMode === 'none') {
    return runDetailBandsMode(plan, reportSpec, tables);
  }

  switch (plan.aggMode as AggMode) {
    case 'totals':
      return runTotalsMode(plan, reportSpec, tables);
    case 'subtotals':
      return runSubtotalsMode(plan);
    case 'group':
      return runGroupedMode(plan);
    default:
      return runDetailMode(plan);
  }
}
