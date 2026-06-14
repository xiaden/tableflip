/* ── Global vendor library declarations ────────────────────────── */

/** sql.js WASM runtime (loaded via CDN or local wasm bundle) */
declare function initSqlJs(config: { locateFile?: (file: string) => string; wasmBinary?: ArrayBuffer }): Promise<SqlJsStatic>;

interface SqlJsStatic {
  Database: new () => SqlJsDatabase;
}
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): SqlJsStatement;
  close(): void;
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
    encode_cell(cell: { r: number; c: number }): string;
    book_new(): XLSXWorkbook;
    book_append_sheet(wb: XLSXWorkbook, ws: XLSXSheet, name: string): void;
  };
  write(ws: XLSXWorkbook, opts?: Record<string, unknown>): ArrayBuffer;
  writeFile(wb: XLSXWorkbook, filename: string): void;
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
  '!cols'?: Array<{ wch: number; MDW?: number; customWidth?: number }>;
  '!rows'?: Array<Record<string, unknown>>;
  '!freeze'?: Record<string, unknown>;
  '!autofilter'?: { ref: string };
  '!data'?: unknown[][];  /** Dense worksheet array (array of rows, each row is an array of cell objects from SheetJS). */
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

/* ── Window interface extensions ────────────────────────────────── */

interface Window {
  // Vendor libs
  XLSX: typeof XLSX;
  agGrid: typeof agGrid;
  initSqlJs: typeof initSqlJs;

  // SQLite database instance
  sqlDb: SqlJsDatabase | null;
}
