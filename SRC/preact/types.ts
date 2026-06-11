export type CalcMode = 'math' | 'text' | 'compare' | 'date';
export type AggMode = 'none' | 'totals' | 'subtotals' | 'group';

export interface DbTable {
  id: string;
  name: string;
  cols: string[];
  rowCount: number;
}

export interface LookupSpec {
  rightId: string;
  keyPairs: Array<{ left: string; right: string }>;
  cols: string[];
  required: boolean;
  enabled: boolean;
  duplicatePolicy: { mode: string; combine?: { separator?: string; unique?: boolean; includeBlank?: boolean; sort?: boolean } };
}

export interface CalcStage {
  alias: string;
  mode: CalcMode;
  math?: unknown;
  compare?: unknown;
  text?: unknown;
  date?: unknown;
  enabled?: boolean;
}

export interface FilterSpec {
  col: string;
  op: string;
  val?: string;
  vals: string[] | null;
  enabled?: boolean;
}

export interface SortSpec {
  col: string;
  dir: string;
  enabled: boolean;
}

export interface AggregateSpec {
  col: string;
  fn: string;
  alias: string;
  enabled?: boolean;
}

export interface AppState {
  tables: Record<string, DbTable>;
  excludedRows: Record<string, Set<number>>;
  tableColors: Record<string, string>;
  columnLabels: Record<string, Record<string, string>>;
  base: string;
  baseCols: string[] | null;
  stacks: string[];
  lookups: LookupSpec[];
  calcStages: CalcStage[];
  selCols: Set<string> | null;
  colOrder: string[] | null;
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
}

export interface ReportSpec {
  id: string | null;
  name: string;
  enabled: boolean;
  pipeline: {
    base: string;
    baseCols: string[] | null;
    stacks: string[];
    lookups: LookupSpec[];
    calculatedColumns: CalcStage[];
  };
  outputColumns: string[] | null;
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
}

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

export interface OutputColumnSpec {
  alias: string;
  label: string;
  visible: boolean;
  width: number | null;
}

export type DateComponent = 'D' | 'DD' | 'M' | 'MM' | 'MMM' | 'YY' | 'YYYY';

export interface DateInputFormat {
  first: DateComponent;
  second: DateComponent;
  third: DateComponent;
}

export type ColSourceEntry =
  | { kind?: never; tid: string; col: string }
  | { kind: 'calc'; idx: number; alias?: string };
