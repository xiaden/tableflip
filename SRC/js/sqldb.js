'use strict';

// ── sql.js wrapper ────────────────────────────────────────────────────────────
// All table data lives in the SQLite WASM heap, not V8.
// After ingestion the raw JS arrays are released so the GC can reclaim them.

window.sqlDb = null;

async function initDb() {
  const SQL = await initSqlJs({
    locateFile: file => (
      window.assetUrl ? window.assetUrl(`js/${file}`) : `js/${file}`
    ),
  });
  window.sqlDb = new SQL.Database();
}

// Quote an identifier so any character (spaces, Chinese, slashes) is safe.
function quoteId(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// Coerce a SheetJS raw value to something sql.js accepts.
function coerceForSQL(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  // Store numeric-looking strings as REAL so SUM/AVG work correctly.
  const n = Number(s);
  if (s !== '' && !isNaN(n)) return n;
  return s || null;
}

function createTable(sqlName, cols) {
  const defs = cols.map(c => quoteId(c)).join(', ');
  sqlDb.run(`CREATE TABLE IF NOT EXISTS ${quoteId(sqlName)} (${defs})`);
}

// Insert all rows in a single transaction — fastest for bulk loads.
function insertRows(sqlName, cols, data) {
  if (!data.length) return;
  const ph  = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${quoteId(sqlName)} VALUES (${ph})`;
  sqlDb.run('BEGIN');
  try {
    const stmt = sqlDb.prepare(sql);
    for (const row of data) {
      stmt.run(cols.map(c => coerceForSQL(row[c])));
    }
    stmt.free();
    sqlDb.run('COMMIT');
  } catch (e) {
    try { sqlDb.run('ROLLBACK'); } catch (_) {}
    throw e;
  }
}

// Run a SELECT and return an array of plain objects.
// `params` is an optional array of positional ? values.
function execQuery(sql, params) {
  try {
    const stmt = sqlDb.prepare(sql);
    if (params && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    throw new Error(e.message + '\n\nQuery:\n' + sql);
  }
}

function dropTable(sqlName) {
  try { sqlDb.run(`DROP TABLE IF EXISTS ${quoteId(sqlName)}`); } catch (_) {}
}

function tableRowCount(sqlName) {
  try {
    const r = sqlDb.exec(`SELECT COUNT(*) FROM ${quoteId(sqlName)}`);
    return r[0]?.values[0]?.[0] ?? 0;
  } catch (_) { return 0; }
}
