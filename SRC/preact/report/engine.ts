/**
 * Report execution engine.
 *
 * Orchestrates: build query plan configs → pipeline engine execution → build result set.
 *
 * The pipeline engine (pipeline-engine.ts) runs six sequential stage functions
 * that each create a temp table. This module handles:
 * - Detail bands: parent rows from pipeline + per-band queries + BandResultSet
 * - Delegating all aggregation modes to the pipeline engine
 */

import type { ReportSpec, DbTable, BandResult, BandResultSet } from '../types';
export type { BandResult } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { QueryPlanConfigs } from '../query/query-plan';
import { buildQueryPlan } from '../query/query-plan';
import { buildBandQuery } from '../query/sql-detail-bands';
import type { BandQueryResult } from '../query/sql-detail-bands';
import { execQuery, quoteId } from '../core/sqldb';
import { buildResultSet } from './result-set';
import type { ResultSet } from './result-set';
import { getPipelineEngine } from './pipeline-engine';
import type { PipelineState } from './pipeline-engine';

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
 * Reads parent rows from the pipeline's final temp table (stage 4 — sort output,
 * which is the final output for detail mode since aggregation is pass-through).
 * For each enabled band, extracts parent key values and runs a batched WHERE IN
 * query to fetch all child rows at once. Returns a {@link ResultSet} with
 * `bandResult` populated — columns and rows contain only parent data; band data
 * is in `bandResult.bandResults`.
 *
 * @param pipelineState  - Pipeline state with temp table names from execution.
 * @param configs        - Query plan configs (colMap, sourceCatalog).
 * @param reportSpec     - The typed report specification (contains detailBands, pipeline).
 * @param tables         - Raw table definitions keyed by table ID.
 * @returns A {@link ResultSet} with parent-only columns/rows and `bandResult` populated.
 */
export function runDetailBandsMode(
  pipelineState: PipelineState,
  configs: QueryPlanConfigs,
  reportSpec: ReportSpec,
  _tables: Record<string, DbTable>,
): ResultSet {
  // 1. Read parent rows from pipeline's sort stage output (stage 4)
  // For detail mode, aggregation is pass-through, so stage 4 (sorts) is the
  // final meaningful output. Stage 5 (aggregation) returns the same table.
  const finalStageTable = pipelineState.tempTableNames[4] || pipelineState.tempTableNames[5];
  const parentRows = execQuery('SELECT * FROM ' + quoteId(finalStageTable));

  // 2. Use configs directly (no catalog rebuilding needed)
  const { colMap, sourceCatalog } = configs;

  // 3. Determine parent columns from actual row data (defensive — selectedColumns
  //    may include band columns that the parent pipeline does not SELECT)
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
 * Orchestrates: build query plan configs → pipeline engine execution → result set.
 * For detail bands (aggMode=none with enabled bands), the pipeline result is
 * augmented with band query results.
 *
 * @param reportSpec     - The typed report specification defining the full
 *                         report pipeline (base table, lookups, calc stages,
 *                         filters, sorts, aggregation config, and output columns).
 * @param tables         - Raw table definitions keyed by table ID. Each entry
 *                         contains id, name, cols, and rowCount.
 * @returns A {@link ResultSet} with columns, rows, and metadata.
 * @throws If the reportSpec has no base table defined.
 */
export function runReport(
  reportSpec: ReportSpec,
  tables: Record<string, DbTable>,
): ResultSet {
  const configs = buildQueryPlan(reportSpec, tables);
  const engine = getPipelineEngine();

  // Fresh run — drop any previous temp tables
  engine.cleanup();

  // Detail bands dispatch: when enabled bands exist and aggMode is 'none',
  // use the detail bands mode (returns ResultSet with bandResult populated).
  const enabledBands = (reportSpec.pipeline.detailBands || []).filter(b => b.enabled !== false && b.rightId);
  if (enabledBands.length > 0 && configs.aggMode === 'none') {
    engine.execute(reportSpec, tables, configs);
    return runDetailBandsMode(engine.getState(), configs, reportSpec, tables);
  }

  // All other modes — pipeline engine handles aggregation
  return engine.execute(reportSpec, tables, configs);
}
