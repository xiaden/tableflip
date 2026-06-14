/**
 * Query plan builder — orchestrates all query modules into a complete query plan.
 *
 * This is the top-level entry point for SQL query generation. It:
 *   1. Builds a source catalog from the raw table definitions
 *   2. Builds a column catalog from the report spec + source catalog
 *   3. Expands and validates lookups via the lookup resolver
 *   4. Generates calculated column SQL expressions
 *   5. Generates WHERE, JOINs, and aggregate SELECT expressions
 *   6. Dispatches to the appropriate query builder (detail, grouped, totals,
 *      or subtotals) based on the aggregation mode
 *   7. Returns a complete BuiltQueryPlan with the final SQL, params, and
 *      projected column list
 *
 * All functions are pure — no global state dependency.
 */

import type { ReportSpec, DbTable, AggMode } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import { buildSourceCatalog } from '../catalog/source-catalog';
import { buildColumnCatalog } from '../catalog/column-catalog';
import { buildCalcExpressions } from './sql-calcs';
import { buildDetailQuery } from './sql-detail';
import { buildGroupedQuery } from './sql-grouped';
import { buildTotalsQuery } from './sql-totals';
import { buildSubtotalsQuery } from './sql-subtotals';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Source table plan — base table, stacks, and table metadata. */
export interface SourcePlan {
  /** Base table ID. */
  base: string;
  /** Stacked (union) table IDs. */
  stacks: string[];
  /** Base column aliases, or null to use all base columns. */
  baseCols: string[] | null;
  /** Excluded row indices per table (currently unused in plan). */
  excludedRows: Record<string, Set<number>>;
  /** Table metadata keyed by table ID. */
  tablesById: Map<string, { cols: string[]; name: string }>;
}

/** A single join plan describing how to join a right table to the base. */
export interface JoinPlan {
  /** Right table ID to join. */
  rightId: string;
  /** Validated key pairs (left alias → right column). */
  keyPairs: Array<{ left: string; right: string }>;
  /** Whether the join is INNER (required) or LEFT (optional). */
  required: boolean;
  /** Policy for handling duplicate key combinations in the right table. */
  duplicatePolicy: { mode: string; combine?: { separator?: string; unique?: boolean; includeBlank?: boolean; sort?: boolean } };
  /** Excluded row indices (currently null, reserved for future use). */
  excludedRows: Set<number> | null;
  /** Column names of the right table. */
  rightColumns: string[];
  /** Display name of the right table. */
  rightTableName: string;
}

/**
 * Complete query plan — all intermediate data plus the final SQL query.
 *
 * Contains the source plan, join plans, calculated columns, filters,
 * aggregates, sorts, subtotal config, and the assembled SQL with params.
 */
export interface BuiltQueryPlan {
  /** Source table plan (base, stacks, table metadata). */
  source: SourcePlan;
  /** Join plans for enabled lookups. */
  joins: JoinPlan[];
  /** Calculated column SQL expressions with aliases. */
  calculatedColumns: Array<{ alias: string; sql: string }>;
  /** Enabled filter specifications. */
  filters: ReportSpec['filters'];
  /** Ordered list of projected column aliases. */
  selectedColumns: string[];
  /** GROUP BY column aliases (for group mode). */
  groupBy: string[];
  /** Aggregate specifications from the report. */
  aggregates: ReportSpec['aggregation']['aggregates'];
  /** Enabled sort specifications. */
  sorts: ReportSpec['sorts'];
  /** Per-column aggregate functions for totals mode. */
  colTotals: Record<string, string>;
  /** Columns to subtotal by. */
  subtotalBy: string[];
  /** Per-column aggregate functions for subtotal branches. */
  subtotalFns: Record<string, string>;
  /** Whether to include a grand total row in subtotals. */
  subtotalGrandTotal: boolean;
  /** Whether to include spacer rows between subtotal groups. */
  subtotalSpacer: boolean;
  /** Whether subtotals appear above detail rows. */
  subtotalOnTop: boolean;
  /** Subtotal strategy: 'nested' (one branch per depth) or 'combined'. */
  subtotalStrategy: string;
  /** Aggregation mode: 'none', 'group', 'totals', or 'subtotals'. */
  aggMode: string;
  /** Column alias → source mapping. */
  colMap: Map<string, ColMapEntry>;
  /** The final SQL query string */
  sql: string;
  /** Parameterized values in order of appearance */
  params: unknown[];
  /** Ordered list of projected column aliases */
  cols: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────



// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build a complete query plan from a report specification and table definitions.
 *
 * This is the main orchestrator that ties together all query modules:
 * source catalog, column catalog, lookup resolver, calc expressions,
 * WHERE/JOINs/aggregates, and the appropriate query builder dispatch.
 *
 * @param reportSpec - The typed report specification defining the full report
 *                     pipeline (base table, lookups, calc stages, filters,
 *                     sorts, aggregation config, and output columns).
 * @param tables     - Raw table definitions keyed by table ID. Each entry
 *                     contains id, name, cols, and rowCount.
 * @returns A complete BuiltQueryPlan containing the intermediate plan data,
 *          the final SQL query, parameterized values, and projected column list.
 * @throws If the reportSpec has no base table defined.
 */
export function buildQueryPlan(
  reportSpec: ReportSpec,
  tables: Record<string, DbTable>,
): BuiltQueryPlan {
  // ── 1. Build source catalog from tables ────────────────────────────────────
  const sourceCatalog = buildSourceCatalog(tables);

  // ── 2. Build column catalog from reportSpec + sourceCatalog ────────────────
  // buildColumnCatalog expects a Record<string, unknown> context — extract the
  // pipeline fields from the typed ReportSpec into a plain object.
  const catalogCtx: Record<string, unknown> = {
    base: reportSpec.pipeline.base,
    baseCols: reportSpec.pipeline.baseCols,
    stacks: reportSpec.pipeline.stacks,
    lookups: reportSpec.pipeline.lookups,
    calcStages: reportSpec.pipeline.calculatedColumns,
    detailBands: reportSpec.pipeline.detailBands || [],
  };
  const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);

  // ── 3. Build source plan ───────────────────────────────────────────────────
  const tablesById = new Map<string, { cols: string[]; name: string }>();
  for (const [tid, entry] of sourceCatalog) {
    tablesById.set(tid, { cols: entry.cols, name: entry.name });
  }

  const source: SourcePlan = {
    base: reportSpec.pipeline.base || '',
    stacks: (reportSpec.pipeline.stacks || []).filter(
      (id: string) => tablesById.has(id),
    ),
    baseCols: reportSpec.pipeline.baseCols ?? (tablesById.has(reportSpec.pipeline.base)
      ? tablesById.get(reportSpec.pipeline.base)!.cols
      : null),
    excludedRows: {},
    tablesById,
  };

  // ── 5. Build join plans ────────────────────────────────────────────────────
  const lookups = reportSpec.pipeline.lookups || [];
  const joins: JoinPlan[] = lookups
    .filter(lk => lk.enabled !== false && lk.rightId && tablesById.has(lk.rightId))
    .map(lk => {
      const rtMeta = tablesById.get(lk.rightId);
      return {
        rightId: lk.rightId,
        rightColumns: rtMeta ? rtMeta.cols : [],
        rightTableName: rtMeta ? rtMeta.name : lk.rightId,
        keyPairs: (lk.keyPairs || []).filter(p => p.left && p.right),
        required: !!lk.required,
        duplicatePolicy: lk.duplicatePolicy || { mode: 'block' },
        excludedRows: null,
      };
    })
    .filter(j => j.keyPairs.length > 0);

  // ── 6. Calculated columns ─────────────────────────────────────────────────
  const calcStages = reportSpec.pipeline.calculatedColumns || [];
  const calculatedColumns = buildCalcExpressions(calcStages, colMap);

  // Build calcExprs map for query builders: alias → SQL expression
  const calcExprs = new Map<string, string>();
  for (const col of calculatedColumns) {
    calcExprs.set(col.alias, col.sql);
  }

  // ── 7. Filters ─────────────────────────────────────────────────────────────
  const filters = (reportSpec.filters || []).filter(f => f.enabled !== false && f.col);

  // ── 8. Selected columns ────────────────────────────────────────────────────
  const aggMode: AggMode = (reportSpec.aggregation.mode as AggMode) || 'none';
  const aggregates = reportSpec.aggregation.aggregates || [];
  const aggAliases = aggMode === 'group'
    ? aggregates.map(a => a.alias).filter(Boolean)
    : [];
  const colOrder = reportSpec.outputColumns;
  const orderedAliases = colOrder && colOrder.length > 0
    ? colOrder.filter(a => colMap.has(a) || aggAliases.includes(a))
    : [...colMap.keys(), ...aggAliases];
  const selectedColumns = orderedAliases;

  // ── 9. Sorts ───────────────────────────────────────────────────────────────
  const sorts = (reportSpec.sorts || []).filter(
    s => s.enabled !== false && s.col && colMap.has(s.col),
  );

  // ── 10. Dispatch to the appropriate query builder ──────────────────────────
  let sql: string;
  let params: unknown[];
  let cols: string[];

  switch (aggMode) {
    case 'group': {
      const result = buildGroupedQuery(reportSpec, colMap, sourceCatalog, calcExprs);
      sql = result.sql;
      params = result.params;
      cols = result.cols;
      break;
    }
    case 'totals': {
      const result = buildTotalsQuery(reportSpec, colMap, sourceCatalog, calcExprs);
      if (!result) throw new Error('buildQueryPlan: no totals to build');
      sql = result.sql;
      params = result.params;
      cols = result.cols;
      break;
    }
    case 'subtotals': {
      const result = buildSubtotalsQuery(reportSpec, colMap, sourceCatalog, calcExprs);
      if (!result) throw new Error('buildQueryPlan: no subtotals to build');
      sql = result.sql;
      params = result.params;
      cols = result.cols;
      break;
    }
    default: {
      const result = buildDetailQuery(reportSpec, colMap, sourceCatalog, calcExprs);
      sql = result.sql;
      params = result.params;
      cols = result.cols;
      break;
    }
  }

  // ── 11. Return complete query plan ─────────────────────────────────────────
  return {
    source,
    joins,
    calculatedColumns,
    filters,
    selectedColumns,
    groupBy: reportSpec.aggregation.groupBy || [],
    aggregates,
    sorts,
    colTotals: reportSpec.aggregation.colTotals || {},
    subtotalBy: reportSpec.aggregation.subtotalBy || [],
    subtotalFns: reportSpec.aggregation.subtotalFns || {},
    subtotalGrandTotal: reportSpec.aggregation.subtotalGrandTotal !== false,
    subtotalSpacer: !!reportSpec.aggregation.subtotalSpacer,
    subtotalOnTop: !!reportSpec.aggregation.subtotalOnTop,
    subtotalStrategy: reportSpec.aggregation.subtotalStrategy || 'combined',
    aggMode: reportSpec.aggregation.mode || 'none',
    colMap,
    sql,
    params,
    cols,
  };
}
