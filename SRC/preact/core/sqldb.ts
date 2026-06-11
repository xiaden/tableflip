const _SQLJS_VERSION = '1.12.0';

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@${_SQLJS_VERSION}/dist/${file}`,
  });
  window.sqlDb = new SQL.Database();
}

function _sqlDb(): SqlJsDatabase {
  return window.sqlDb!;
}

export function quoteId(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

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

export function dropTable(sqlName: string): void {
  try { _sqlDb().run(`DROP TABLE IF EXISTS ${quoteId(sqlName)}`); } catch { /* ignore */ }
}

export function tableRowCount(sqlName: string): number {
  try {
    const r = _sqlDb().exec(`SELECT COUNT(*) FROM ${quoteId(sqlName)}`);
    return (r[0]?.values[0]?.[0] ?? 0) as number;
  } catch { return 0; }
}
