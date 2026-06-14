/** Calculation mode for computed columns. */
export type CalcMode = 'math' | 'text' | 'compare' | 'date';

/** Column data type for type-aware SQL WHERE generation. Detected at import or set via user override. */
export type ColumnType = 'string' | 'number' | 'date' | 'boolean';

/** Aggregation mode determining how results are grouped. */
export type AggMode = 'none' | 'totals' | 'subtotals' | 'group';

/**
 * Represents a loaded database table with its metadata.
 * @property id - Unique table identifier
 * @property name - Human-readable display name
 * @property cols - Column names in physical order
 * @property rowCount - Number of data rows
 * @property colTypes - Per-column type metadata detected at import (keyed by column name)
 */
export interface DbTable {
  id: string;
  name: string;
  cols: string[];
  rowCount: number;
  samples?: Record<string, string[]>;
  colTypes?: Record<string, ColumnType>;
}

/**
 * Defines a table-to-table lookup (join) specification.
 * @property rightId - The table ID to join with
 * @property keyPairs - Left/right column pairs to match on
 * @property cols - Columns to include from the right table
 * @property required - If true, only matching rows are kept (inner join)
 * @property enabled - Whether this lookup is active in the pipeline
 * @property duplicatePolicy - How to handle duplicate key matches
 */
export interface LookupSpec {
  rightId: string;
  keyPairs: Array<{ left: string; right: string }>;
  cols: string[];
  required: boolean;
  enabled: boolean;
  duplicatePolicy: { mode: string; combine?: { separator?: string; unique?: boolean; includeBlank?: boolean; sort?: boolean } };
  [key: string]: unknown;
}

/**
 * Defines a detail band — a 1:N child table that produces sub-rows
 * under each parent row. Modeled on LookupSpec but produces vertical
 * fan-out instead of horizontal column extension.
 * @property id - Unique band identifier (generated on creation, e.g. "band_0")
 * @property rightId - Child table ID
 * @property keyPairs - Parent→child column mappings (left=parent alias, right=child column)
 * @property cols - Columns to include from the child table. Empty array = no columns selected; populated with full child table column list when table is assigned.
 * @property enabled - Whether this band is active in the pipeline
 * @property sorts - Sort specifications for child rows within each band
 * @property label - User-visible band label for section headers (defaults to table name)
 */
export interface DetailBandSpec {
  id: string;
  rightId: string;
  keyPairs: Array<{ left: string; right: string }>;
  cols: string[];
  enabled: boolean;
  sorts: Array<{ col: string; dir: 'ASC' | 'DESC'; enabled: boolean }>;
  label: string;
}

/**
 * A single calculated column stage in the pipeline.
 * @property alias - The output column name for this calculation
 * @property mode - The type of calculation (math, text, compare, date)
 * @property math - Math mode configuration (mode-specific shape)
 * @property compare - Compare mode configuration
 * @property text - Text mode configuration
 * @property date - Date mode configuration
 * @property enabled - Whether this calculation is active
 */
export interface CalcStage {
  alias: string;
  mode: CalcMode;
  math?: unknown;
  compare?: unknown;
  text?: unknown;
  date?: unknown;
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * Filter specification for query WHERE clause.
 * @property col - Column alias to filter on
 * @property op - Operator (e.g., 'contains', 'equals', 'gt', 'lt')
 * @property val - Single comparison value (for single-value operators)
 * @property vals - Array of comparison values (for multi-value operators like IN)
 * @property enabled - Whether this filter is active
 */
export interface FilterSpec {
  col: string;
  op: string;
  val?: string;
  vals: string[] | null;
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * Sort specification for query ORDER BY clause.
 * @property col - Column alias to sort by
 * @property dir - Sort direction ('ASC' or 'DESC')
 * @property enabled - Whether this sort is active
 */
export interface SortSpec {
  col: string;
  dir: string;
  enabled: boolean;
  [key: string]: unknown;
}

/**
 * Aggregate function specification for grouped results.
 * @property col - Column alias to aggregate
 * @property fn - Aggregate function name (e.g., 'SUM', 'AVG', 'COUNT ROWS')
 * @property alias - Output column name for the aggregate result
 * @property enabled - Whether this aggregate is active
 */
export interface AggregateSpec {
  col: string;
  fn: string;
  alias: string;
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * Core application state for a single report.
 * Mirrors the shape of the old `DbState` interface field-for-field.
 * @property tables - Loaded database tables keyed by table ID
 * @property excludedRows - Rows excluded from results, keyed by table ID
 * @property tableColors - Color assignments per table for UI display
 * @property columnLabels - User-defined column display labels, keyed by table ID then column name
 * @property columnTypeOverrides - User overrides for column types keyed by table ID then column name. Takes precedence over auto-detected colTypes.
 * @property base - Base table ID for the report
 * @property baseCols - Columns to include from base table ([] = no base columns selected; populated lazily when base table is set)
 * @property stacks - Table IDs stacked (unions) with the base
 * @property lookups - Array of join specifications
 * @property calcStages - Array of calculated column stages
 * @property selCols - Selected columns for output (empty Set = nothing selected; populated lazily with all projected columns)
 * @property colOrder - User-defined column order ([] = use default ordering; populated lazily with natural column order)
 * @property filters - Array of filter specifications
 * @property groupBy - Column aliases to group by
 * @property aggregates - Array of aggregate specifications
 * @property aggMode - Current aggregation mode
 * @property aggModeState - Persisted UI state for the active agg mode
 * @property colTotals - Total display mode per column (e.g., 'sum', 'count')
 * @property subtotalBy - Columns to subtotal by
 * @property subtotalFns - Aggregate function per subtotal column
 * @property subtotalGrandTotal - Whether to include a grand total row
 * @property subtotalSpacer - Whether to add spacer rows between subtotals
 * @property subtotalOnTop - Whether subtotal headers appear above groups
 * @property subtotalStrategy - How subtotals are combined ('combined' or 'separate')
 * @property mergedCols - Columns with merged display in results
 * @property mergeGroupUnderline - Whether merged groups have underlines
 * @property colState - Per-column UI state (selection, expansion, etc.)
 * @property sorts - Array of sort specifications
 * @property result - Last query result set (null if not yet run)
 * @property detailBands - Array of detail band specifications for 1:N child row fan-out
 * @property detailBandMode - How detail band rows are rendered ('separate' = interleaved, 'stack' = stacked)
 */
export interface AppState {
  tables: Record<string, DbTable>;
  excludedRows: Record<string, Set<number>>;
  tableColors: Record<string, string>;
  columnLabels: Record<string, Record<string, string>>;
  base: string;
  baseCols: string[];
  stacks: string[];
  lookups: LookupSpec[];
  calcStages: CalcStage[];
  selCols: Set<string>;
  colOrder: string[];
  filters: FilterSpec[];
  groupBy: string[];
  aggregates: AggregateSpec[];
  aggMode: AggMode;
  aggModeState: Record<string, unknown> | null;
  colTotals: Record<string, string>;
  subtotalBy: string[];
  subtotalFns: Record<string, string>;
  subtotalGrandTotal: boolean;
  subtotalSpacer: boolean;
  subtotalOnTop: boolean;
  subtotalStrategy: string;
  mergedCols: string[];
  mergeGroupUnderline: boolean;
  colState: Record<string, unknown> | null;
  sorts: SortSpec[];
  result: Record<string, unknown> | null;
  activeTab: string;
  previewTableId: string | null;
  detailBands: DetailBandSpec[];
  detailBandMode: 'separate' | 'stack';
  columnTypeOverrides: Record<string, Record<string, ColumnType>>;
}

/**
 * Complete report specification including pipeline, output, and aggregation config.
 * @property id - Unique report identifier (null for new reports)
 * @property name - User-visible report name
 * @property enabled - Whether this report is active
 * @property pipeline - Pipeline configuration (base table, stacks, lookups, calcs)
 * @property outputColumns - Explicit output column order ([] = project nothing; populated lazily with all projected aliases)
 * @property filters - Filter specifications
 * @property sorts - Sort specifications
 * @property aggregation - Aggregation configuration (mode, groupBy, aggregates, etc.)
 * @property mergeDisplay - Merged column display configuration
 * @property outputDefinition - Full output column definitions (null = auto)
 * @property publish - Publish settings for table export
 * @property pipeline.detailBands - Optional detail band specifications for 1:N child row fan-out
 * @property detailBandMode - How detail band rows are rendered ('separate' = interleaved, 'stack' = stacked)
 */
export interface ReportSpec {
  id: string | null;
  name: string;
  enabled: boolean;
  pipeline: {
    base: string;
    baseCols: string[];
    stacks: string[];
    lookups: LookupSpec[];
    calculatedColumns: CalcStage[];
    detailBands?: DetailBandSpec[];
  };
  outputColumns: string[];
  filters: FilterSpec[];
  sorts: SortSpec[];
  aggregation: {
    mode: string;
    groupBy: string[];
    aggregates: AggregateSpec[];
    colTotals: Record<string, string>;
    subtotalBy: string[];
    subtotalFns: Record<string, string>;
    subtotalGrandTotal: boolean;
    subtotalSpacer: boolean;
    subtotalOnTop: boolean;
    subtotalStrategy: string;
  };
  mergeDisplay: {
    mergedCols: string[];
    mergeGroupUnderline: boolean;
  };
  outputDefinition: Record<string, unknown> | null;
  publish: {
    enabled: boolean;
    tableName: string;
  };
  detailBandMode?: 'separate' | 'stack';
}

/**
 * Top-level workspace state containing all reports and runtime data.
 * @property version - Schema version
 * @property sourceTables - All loaded tables keyed by table ID
 * @property reports - Array of report specifications
 * @property activeReportId - Currently selected report ID (null if none)
 * @property runtime - Transient runtime state (results, validation, grid)
 */
export interface WorkspaceState {
  version: number;
  sourceTables: Record<string, DbTable>;
  reports: ReportSpec[];
  activeReportId: string | null;
  runtime: {
    resultsByReportId: Record<string, unknown>;
    validationByReportId: Record<string, unknown>;
    activeGridState: Record<string, unknown>;
  };
}

/**
 * Output column definition for results display.
 * @property alias - Internal column alias
 * @property label - User-visible column header text
 * @property visible - Whether the column is shown in results
 * @property width - Fixed column width in pixels (null = auto)
 */
export interface OutputColumnSpec {
  alias: string;
  label: string;
  visible: boolean;
  width: number | null;
}

/** Date component token for format parsing (D, DD, M, MM, MMM, YY, YYYY). */
export type DateComponent = 'D' | 'DD' | 'M' | 'MM' | 'MMM' | 'YY' | 'YYYY';

/**
 * Date input format specifying the order of date components.
 * Used to parse non-ISO date strings (e.g., "MM/DD/YYYY").
 * @property first - First component in the date string
 * @property second - Second component
 * @property third - Third component
 */
export interface DateInputFormat {
  first: DateComponent;
  second: DateComponent;
  third: DateComponent;
}

/**
 * Column source mapping entry — identifies where a projected column originates.
 * Can be a physical table column, a calculated column, or a detail band column.
 */
export type ColSourceEntry =
  | { kind?: never; tid: string; col: string }
  | { kind: 'calc'; idx: number; alias?: string }
  | { kind: 'band'; tid: string; col: string };
