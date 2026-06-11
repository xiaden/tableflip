/* ── Global vendor library declarations ────────────────────────── */

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

/* ── Application-level globals ────────────────────────────────── */

interface Window {
  sqlDb: SqlJsDatabase | null;
  initSqlJs: typeof initSqlJs;
}
