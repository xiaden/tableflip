/**
 * Report execution engine.
 *
 * Orchestrates: build query plan → execute SQL → build result set.
 * Ported from SRC/js/report/engine.ts — zero imports from SRC/js/.
 * Pure function — no global state dependency.
 *
 * Dispatches to mode-specific handlers based on aggregation mode:
 * - **detail bands** (none + enabled bands): parent query + per-band queries + JS stitching
 * - **detail** (none): simple SELECT with WHERE, JOINs, ORDER BY
 * - **totals**: detail rows + a single aggregate totals row
 * - **subtotals**: detail rows interleaved with subtotal/spacing/grand-total rows
 * - **group**: GROUP BY with aggregate expressions
 */

import type { ReportSpec, DbTable, AggMode, DetailBandSpec } from '../types';
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

// ── Stacking Mode Constants & Error ─────────────────────────────────────────────

/** Hard limit on rows produced by stacking mode cross-product. */
export const STACK_ROW_LIMIT = 10_000;

/**
 * Error thrown when stacking mode cross-product exceeds STACK_ROW_LIMIT.
 * Carries the projected row count and the limit that was exceeded.
 */
export class RowExplosionError extends Error {
  /** The projected number of rows that would be produced. */
  readonly projectedCount: number;
  /** The limit that was exceeded. */
  readonly limit: number;

  constructor(projectedCount: number, limit: number) {
    super(
      `Detail band cross-product would produce ${projectedCount} rows, exceeding limit of ${limit}.`,
    );
    this.name = 'RowExplosionError';
    this.projectedCount = projectedCount;
    this.limit = limit;
  }
}

// ── Detail Bands Helpers ────────────────────────────────────────────────────────

/**
 * Intermediate result for a single detail band query.
 *
 * @property band             - The detail band specification this result belongs to.
 * @property rows             - Child rows returned by the band query.
 * @property cols             - Column names in the band query result.
 * @property parentKeyAliases - Parent-side key column aliases used for matching.
 * @property childKeyCols     - Child-side key column names used for matching.
 */
export interface BandResult {
  band: DetailBandSpec;
  rows: Record<string, unknown>[];
  cols: string[];
  parentKeyAliases: string[];
  childKeyCols: string[];
}

/**
 * Compute the superset column list: union of parent columns and all band
 * columns, plus the internal _band_id tagging column.
 */
export function computeSupersetCols(
  parentCols: string[],
  bandResults: Array<{ cols: string[] }>,
): string[] {
  const superset = [...parentCols];
  const seen = new Set(parentCols);
  for (const br of bandResults) {
    for (const col of br.cols) {
      if (!seen.has(col)) {
        superset.push(col);
        seen.add(col);
      }
    }
  }
  if (!seen.has('_band_id')) superset.push('_band_id');
  return superset;
}

/**
 * Null-pad a parent row for all band columns and set _band_id = null.
 */
export function padParentRow(
  row: Record<string, unknown>,
  supersetCols: string[],
): Record<string, unknown> {
  const padded = { ...row };
  for (const col of supersetCols) {
    if (!(col in padded)) padded[col] = null;
  }
  padded._band_id = null;
  return padded;
}

/**
 * Null-pad a band row for all parent/other-band columns and set _band_id.
 */
export function padBandRow(
  row: Record<string, unknown>,
  supersetCols: string[],
  bandId: string,
): Record<string, unknown> {
  const padded: Record<string, unknown> = {};
  for (const col of supersetCols) {
    padded[col] = col in row ? row[col] : null;
  }
  padded._band_id = bandId;
  return padded;
}

/**
 * Interleave parent rows with their matching child rows from each band.
 *
 * For each parent row, inserts matching child rows from each band immediately
 * after it. Uses a Map-based index for O(1) lookup of child rows by key value.
 */
export function interleaveRows(
  parentRows: Record<string, unknown>[],
  bandResults: BandResult[],
  supersetCols: string[],
): Record<string, unknown>[] {
  // Build per-band index: bandId → Map<keyValue, rows[]>
  const bandIndex = new Map<string, Map<string, Record<string, unknown>[]>>();
  for (const br of bandResults) {
    const idx = new Map<string, Record<string, unknown>[]>();
    for (const row of br.rows) {
      const key = makeKeyValue(row, br.childKeyCols);
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key)!.push(row);
    }
    bandIndex.set(br.band.id, idx);
  }

  const result: Record<string, unknown>[] = [];
  for (const parentRow of parentRows) {
    result.push(padParentRow(parentRow, supersetCols));
    for (const br of bandResults) {
      const key = makeKeyValue(parentRow, br.parentKeyAliases);
      const children = bandIndex.get(br.band.id)?.get(key) || [];
      for (const child of children) {
        result.push(padBandRow(child, supersetCols, br.band.id));
      }
    }
  }
  return result;
}

/**
 * Build a composite key string from a row using the given key columns.
 * For single-key, returns the raw value (as string). For multi-key,
 * concatenates values with the ||| separator (matching sql-joins.ts pattern).
 */
function makeKeyValue(row: Record<string, unknown>, keyCols: string[]): string {
  if (keyCols.length === 1) return String(row[keyCols[0]] ?? '');
  return keyCols.map(k => String(row[k] ?? '')).join('|||');
}

/**
 * Pre-built index for O(1) child row lookup by key value.
 * Maps bandId → Map<compositeKeyValue, matchingRows[]>.
 *
 * Built once per set of band results and reused across all parent rows,
 * eliminating the O(n) filter() per parent per band in crossProductRows().
 */
export type BandChildIndex = Map<string, Map<string, Record<string, unknown>[]>>;

/**
 * Build a Map-based index of band rows keyed by their child key values.
 *
 * This is the same indexing strategy used by interleaveRows() internally,
 * but extracted so it can be shared with crossProductRows() for stacking mode.
 * Building the index is O(totalBandRows); each subsequent lookup is O(1).
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

/**
 * Compute the Cartesian cross-product of a single parent row with matching
 * child rows from all enabled bands.
 *
 * For each band, finds child rows whose key matches the parent row's key,
 * then computes the Cartesian product across all bands. Each output row
 * merges parent data with one child row per band, with _band_id set to
 * the last band that contributed children.
 *
 * When a pre-built BandChildIndex is provided, child lookup is O(1) per band
 * instead of O(bandRows). The index should be built once via buildBandChildIndex()
 * and reused across all parent rows in a stacking-mode run.
 *
 * Throws RowExplosionError if the product for this parent exceeds the limit.
 * Rows are null-padded for all superset columns.
 *
 * @param parentRow    - A single parent row to compute cross-product for.
 * @param bandResults  - Array of band query results (each with rows, key columns, and band metadata).
 * @param supersetCols - Union of all column names across parent and bands (used for null-padding).
 * @param limit        - Maximum rows allowed before throwing RowExplosionError (default: STACK_ROW_LIMIT).
 * @param childIndex   - Optional pre-built index for O(1) child lookup. When omitted, falls back to O(n) filter.
 * @returns Array of cross-product rows, null-padded for superset columns.
 * @throws {RowExplosionError} If the cross-product for this parent exceeds the limit.
 */
export function crossProductRows(
  parentRow: Record<string, unknown>,
  bandResults: BandResult[],
  supersetCols: string[],
  limit: number = STACK_ROW_LIMIT,
  childIndex?: BandChildIndex,
): Record<string, unknown>[] {
  let combinations: Record<string, unknown>[] = [parentRow];

  for (const br of bandResults) {
    const parentKey = makeKeyValue(parentRow, br.parentKeyAliases);

    // O(1) lookup from pre-built index, or O(n) filter fallback
    let children: Record<string, unknown>[];
    if (childIndex) {
      children = childIndex.get(br.band.id)?.get(parentKey) || [];
    } else {
      children = br.rows.filter(
        r => makeKeyValue(r, br.childKeyCols) === parentKey,
      );
    }
    if (children.length === 0) continue;

    const next: Record<string, unknown>[] = [];
    for (const combo of combinations) {
      for (const child of children) {
        next.push({ ...combo, ...child, _band_id: br.band.id });
      }
    }
    if (next.length > limit) {
      throw new RowExplosionError(next.length, limit);
    }
    combinations = next;
  }

  // Null-pad each combination row for superset columns
  return combinations.map(row => {
    const padded: Record<string, unknown> = {};
    for (const col of supersetCols) {
      padded[col] = col in row ? row[col] : null;
    }
    return padded;
  });
}

// ── Detail Bands Mode ───────────────────────────────────────────────────────────

/**
 * Detail bands mode — parent rows combined with child rows from detail bands.
 *
 * Executes the parent query (detail SQL), then for each enabled band, extracts
 * parent key values and runs a batched WHERE IN query to fetch all child rows
 * at once. Rows are stitched in JavaScript based on detailBandMode:
 *
 * - **'separate'** (default): parent rows interleaved with matching child rows
 *   from each band. Each parent row is followed by its children.
 * - **'stack'**: Cartesian cross-product of matching child rows across all bands
 *   per parent row. Capped at STACK_ROW_LIMIT total rows.
 *
 * Parent rows are null-padded for band columns, band rows are null-padded for
 * parent/other-band columns. All rows carry a _band_id tag (null for parent
 * rows in separate mode; last contributing band in stack mode).
 *
 * @param plan           - The built query plan (contains parent SQL, params, and column list).
 * @param reportSpec     - The typed report specification (contains detailBands, detailBandMode, pipeline).
 * @param tables         - Raw table definitions keyed by table ID.
 * @param stackRowLimit  - Override for the maximum number of stacking-mode rows allowed
 *                         (defaults to STACK_ROW_LIMIT).
 * @returns A {@link ResultSet} with stitched parent+child rows and band metadata.
 * @throws {RowExplosionError} If stacking mode total rows exceed stackRowLimit.
 */
export function runDetailBandsMode(
  plan: BuiltQueryPlan,
  reportSpec: ReportSpec,
  tables: Record<string, DbTable>,
  stackRowLimit: number = STACK_ROW_LIMIT,
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

  // 5. Compute superset columns and stitch rows based on mode
  const supersetCols = computeSupersetCols(parentCols, bandResults);
  const mode = reportSpec.detailBandMode || 'separate';

  let resultRows: Record<string, unknown>[];
  if (mode === 'stack') {
    // Stacking mode: Cartesian cross-product per parent row.
    // Build the band index ONCE for O(1) child lookup per parent per band,
    // instead of O(bandRows) filter() per parent per band.
    const childIndex = buildBandChildIndex(bandResults);
    resultRows = [];
    for (const parentRow of parentRows) {
      const combos = crossProductRows(parentRow, bandResults, supersetCols, stackRowLimit, childIndex);
      resultRows.push(...combos);
      if (resultRows.length > stackRowLimit) {
        throw new RowExplosionError(resultRows.length, stackRowLimit);
      }
    }
  } else {
    // Separate mode: interleave parent rows with matching child rows
    resultRows = interleaveRows(parentRows, bandResults, supersetCols);
  }

  // 6. Build band labels map
  const bandLabels: Record<string, string> = {};
  for (const br of bandResults) {
    bandLabels[br.band.id] = br.band.label || br.band.id;
  }

  // 7. Build result set
  return buildResultSet(supersetCols, resultRows, {
    aggMode: 'none',
    bandCount: bandResults.length,
    bandIds: bandResults.map(br => br.band.id),
    bandLabels,
  });
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
 * @param stackRowLimit  - Optional override for the maximum number of rows allowed
 *                         in stacking-mode cross-product (defaults to STACK_ROW_LIMIT).
 * @returns A {@link ResultSet} with columns, rows, and metadata.
 * @throws If the reportSpec has no base table defined or the aggregation
 *         mode produces no output.
 * @throws {RowExplosionError} If stacking mode total rows exceed stackRowLimit.
 */
export function runReport(
  reportSpec: ReportSpec,
  tables: Record<string, DbTable>,
  stackRowLimit?: number,
): ResultSet {
  const plan = buildQueryPlan(reportSpec, tables);

  // Detail bands dispatch: when enabled bands exist and aggMode is 'none',
  // use the detail bands stitching mode (separate or stack, per detailBandMode).
  const enabledBands = (reportSpec.pipeline.detailBands || []).filter(b => b.enabled !== false && b.rightId);
  if (enabledBands.length > 0 && plan.aggMode === 'none') {
    return runDetailBandsMode(plan, reportSpec, tables, stackRowLimit);
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
