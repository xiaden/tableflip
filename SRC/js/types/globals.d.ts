/* ── Global vendor library declarations ────────────────────────── */

/** sql.js WASM runtime (loaded via js/wasm/sql-wasm.js) */
declare function initSqlJs(config: { locateFile?: (file: string) => string; wasmBinary?: ArrayBuffer }): Promise<SqlJsStatic>;

interface SqlJsStatic {
  Database: new () => SqlJsDatabase;
}
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): SqlJsStatement;
}
interface SqlJsStatement {
  bind(params?: unknown[]): void;
  run(params?: unknown[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

/** SheetJS / xlsx-js-style runtime (loaded via js/vendor/xlsx.bundle.js) */
declare const XLSX: {
  read(data: ArrayBuffer | string, opts?: Record<string, unknown>): XLSXWorkbook;
  utils: {
    sheet_to_json<T = Record<string, unknown>>(sheet: XLSXSheet, opts?: Record<string, unknown>): T[];
    sheet_to_csv(sheet: XLSXSheet, opts?: Record<string, unknown>): string;
    json_to_sheet(data: Record<string, unknown>[], opts?: Record<string, unknown>): XLSXSheet;
    aoa_to_sheet(data: unknown[][]): XLSXSheet;
    sheet_add_aoa(sheet: XLSXSheet, data: unknown[][], opts?: Record<string, unknown>): XLSXSheet;
    decode_range(range: string): { s: { r: number; c: number }; e: { r: number; c: number } };
  };
  write(ws: XLSXWorkbook, opts?: Record<string, unknown>): ArrayBuffer;
  style_version?: string;
  version?: string;
};

interface XLSXWorkbook {
  SheetNames: string[];
  Sheets: Record<string, XLSXSheet>;
}
interface XLSXSheet {
  '!ref'?: string;
  '!merges'?: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  [cell: string]: unknown;
}

/** AG Grid Community runtime (loaded via js/vendor/ag-grid-community.min.js) */
declare const agGrid: {
  createGrid(el: HTMLElement, opts: Record<string, unknown>): AGridApi;
};

interface AGridApi {
  setGridOption(key: string, value: unknown): void;
  updateGridOption(key: string, value: unknown): void;
  setGridOptions(opts: Record<string, unknown>): void;
  getSelectedRows(): Record<string, unknown>[];
  forEachNode(fn: (node: { data: Record<string, unknown>; setSelected: (sel: boolean) => void }) => void): void;
  destroy(): void;
  refreshCells(opts?: Record<string, unknown>): void;
  applyColumnStateUtils(opts: Record<string, unknown>): void;
  getColumnState(): Array<Record<string, unknown>>;
  applyColumnState(state: Array<Record<string, unknown>>): void;
  showLoadingOverlay(): void;
  hideOverlay(): void;
  ensureIndexVisible(index: number): void;
}

/* ── Application-level globals ────────────────────────────────── */

type CalcMode = 'math' | 'text' | 'compare' | 'date';
type AggMode = 'none' | 'totals' | 'subtotals' | 'group';

interface DbTable {
  id: string;
  name: string;
  cols: string[];
  rowCount: number;
}

interface LookupSpec {
  rightId: string;
  keyPairs: Array<{ left: string; right: string }>;
  cols: string[];
  required: boolean;
  enabled: boolean;
  duplicatePolicy: { mode: string; combine?: { separator?: string; unique?: boolean; includeBlank?: boolean; sort?: boolean } };
  [key: string]: unknown;
}

interface CalcStage {
  alias: string;
  mode: CalcMode;
  math?: unknown;
  compare?: unknown;
  text?: unknown;
  date?: unknown;
  enabled?: boolean;
  [key: string]: unknown;
}

interface FilterSpec {
  col: string;
  op: string;
  val?: string;
  vals: string[] | null;
  enabled?: boolean;
  [key: string]: unknown;
}

interface SortSpec {
  col: string;
  dir: string;
  enabled: boolean;
  [key: string]: unknown;
}

interface AggregateSpec {
  col: string;
  fn: string;
  alias: string;
  enabled?: boolean;
  [key: string]: unknown;
}

interface DbState {
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

interface Window {
  // Vendor libs
  XLSX: typeof XLSX;
  agGrid: typeof agGrid;
  initSqlJs: typeof initSqlJs;

  // Application globals
  db: DbState;
  sqlDb: SqlJsDatabase | null;
  initDb: () => Promise<void>;
  assetUrl: (p: string) => string;
  __IS_LOCAL_DEV: boolean;
  __ASSET_VER: string;

  // HTML onclick handlers
  toggleSidebar: () => void;
  applyState: (next: Record<string, unknown>, nextExcludedRows: Record<string, Set<number>>) => void;
  runQuery: () => void;
  loadPreview: () => void;
  setAggMode: (mode: string) => void;
  addAggregate: () => void;
  selectAllCols: () => void;
  selectNoneCols: () => void;
  addSort: () => void;
  addFilter: () => void;
  loadState: (file: File) => void;
  saveState: () => void;
  exportAs: (format: string) => void;
  closeModal: () => void;
  confirmModal: () => void;
  setSubtotalStrategy: (strategy: string) => void;
  setSubtotalGrandTotal: (val: boolean) => void;
  setSubtotalSpacer: (val: boolean) => void;
  setSubtotalOnTop: (val: boolean) => void;
  setMergeGroupUnderline: (val: boolean) => void;
}
