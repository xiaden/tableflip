// ── sql.js wrapper ────────────────────────────────────────────────────────────
// All table data lives in the SQLite WASM heap, not V8.
// After ingestion the raw JS arrays are released so the GC can reclaim them.

const _SQLJS_VERSION = '1.12.0';

// Guard against non-browser environments (test env sets global.window later).
if (typeof window !== 'undefined') window.sqlDb = null;

// Reference the global/window.sqlDb so both the app and test env see the same DB.
export async function initDb(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@${_SQLJS_VERSION}/dist/${file}`,
  });
  window.sqlDb = new SQL.Database();
}

function _sqlDb(): SqlJsDatabase { return window.sqlDb!; }

// Quote an identifier so any character (spaces, Chinese, slashes) is safe.
export function quoteId(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// Coerce a SheetJS raw value to something sql.js accepts.
function coerceForSQL(v: unknown): string | number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const n = Number(s);
  if (s !== '' && !isNaN(n)) return n;
  return s || null;
}

export function createTable(sqlName: string, cols: string[]): void {
  const defs = cols.map(c => quoteId(c)).join(', ');
  _sqlDb().run(`CREATE TABLE IF NOT EXISTS ${quoteId(sqlName)} (${defs})`);
}

// Insert all rows in a single transaction — fastest for bulk loads.
export function insertRows(sqlName: string, cols: string[], data: Array<Record<string, unknown>>): void {
  if (!data.length) return;
  const ph  = cols.map(() => '?').join(', ');
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
    try { _sqlDb().run('ROLLBACK'); } catch {}
    throw e;
  }
}

// Run a SELECT and return an array of plain objects.
// `params` is an optional array of positional ? values.
export function execQuery(sql: string, params?: unknown[]): Record<string, unknown>[] {
  try {
    const stmt = _sqlDb().prepare(sql);
    if (params && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    throw new Error((e as Error).message + '\n\nQuery:\n' + sql);
  }
}

export function dropTable(sqlName: string): void {
  try { _sqlDb().run(`DROP TABLE IF EXISTS ${quoteId(sqlName)}`); } catch {}
}

export function tableRowCount(sqlName: string): number {
  try {
    const r = _sqlDb().exec(`SELECT COUNT(*) FROM ${quoteId(sqlName)}`);
    return (r[0]?.values[0]?.[0] ?? 0) as number;
  } catch { return 0; }
}
