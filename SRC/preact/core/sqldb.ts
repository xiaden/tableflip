/** SQL.js version used for the WASM build. */
const _SQLJS_VERSION = '1.12.0';

/**
 * Initializes the SQLite WASM runtime and creates a global database instance.
 * Loads sql.js from the CDN and stores the database on window.sqlDb.
 * Must be called once before any other sqldb functions.
 * @returns Promise that resolves when the database is ready
 */
export async function initDb(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@${_SQLJS_VERSION}/dist/${file}`,
  });
  window.sqlDb = new SQL.Database();
}

/** Internal accessor for the global SQLite database instance. */
function _sqlDb(): SqlJsDatabase {
  return window.sqlDb!;
}

/**
 * Quotes a SQL identifier to prevent injection and handle special characters.
 * Always use this when referencing table or column names in SQL strings.
 * @param name - The raw identifier (table name, column name, etc.)
 * @returns Double-quoted identifier with internal quotes escaped
 */
export function quoteId(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/**
 * Coerces a JavaScript value to a SQLite-compatible string value.
 * All values stored as strings. Conversion rules:
 * - null/undefined → null
 * - Date → ISO string truncated to seconds (YYYY-MM-DDTHH:mm:ss)
 * - boolean → '1' / '0'
 * - number → String(v)
 * - string → trimmed; empty strings become null
 * Numeric strings stay as strings (no Number conversion).
 * @param v - The value to coerce
 * @returns A string value safe for SQLite parameter binding, or null
 */
function coerceForSQL(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  const s = String(v).trim();
  return s || null;
}

/**
 * Creates a table with the given columns if it doesn't already exist.
 * All column names are quoted via quoteId() for safety.
 * @param sqlName - Table name (will be quoted)
 * @param cols - Array of column names
 */
export function createTable(sqlName: string, cols: string[]): void {
  const defs = cols.map(c => quoteId(c)).join(', ');
  _sqlDb().run(`CREATE TABLE IF NOT EXISTS ${quoteId(sqlName)} (${defs})`);
}

/**
 * Inserts multiple rows into a table using a prepared statement.
 * Executes within a transaction (BEGIN/COMMIT/ROLLBACK).
 * Values are coerced via coerceForSQL() before binding.
 * @param sqlName - Target table name (will be quoted)
 * @param cols - Column names matching the data object keys
 * @param data - Array of row objects with column values
 */
export function insertRows(sqlName: string, cols: string[], data: Array<Record<string, unknown>>): void {
  if (!data.length) return;
  const ph = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${quoteId(sqlName)} VALUES (${ph})`;
  _sqlDb().run('BEGIN');
  try {
    const stmt = _sqlDb().prepare(sql);
    for (const row of data) {
      stmt.run(cols.map(c => coerceForSQL(row[c])));
    }
    stmt.free();
    _sqlDb().run('COMMIT');
  } catch (e) {
    try { _sqlDb().run('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Executes a SQL query and returns results as an array of row objects.
 * Uses a prepared statement with optional parameter binding.
 * On error, appends the SQL string to the error message for debugging.
 * @param sql - The SQL query string
 * @param params - Optional positional parameters for the query
 * @returns Array of row objects with column names as keys
 */
export function execQuery(sql: string, params?: unknown[]): Record<string, unknown>[] {
  try {
    const stmt = _sqlDb().prepare(sql);
    if (params && params.length) stmt.bind(params);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    throw new Error((e as Error).message + '\n\nQuery:\n' + sql);
  }
}

/**
 * Drops a table if it exists. Silently ignores errors (e.g., table doesn't exist).
 * @param sqlName - Table name to drop (will be quoted)
 */
export function dropTable(sqlName: string): void {
  try { _sqlDb().run(`DROP TABLE IF EXISTS ${quoteId(sqlName)}`); } catch { /* ignore */ }
}

/**
 * Returns the number of rows in a table.
 * Returns 0 if the table doesn't exist or an error occurs.
 * @param sqlName - Table name to count (will be quoted)
 * @returns Row count as a number
 */
export function tableRowCount(sqlName: string): number {
  try {
    const r = _sqlDb().exec(`SELECT COUNT(*) FROM ${quoteId(sqlName)}`);
    return (r[0]?.values[0]?.[0] ?? 0) as number;
  } catch { return 0; }
}
