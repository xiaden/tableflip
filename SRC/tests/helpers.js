'use strict';

const assert = require('node:assert/strict');

// ── SQL normalisation ───────────────────────────────────────────────────────
function normalizeSql(sql) {
  if (!sql) return '';
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .replace(/\s*([=<>!])\s*/g, '$1')
    .replace(/"/g, '')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sqlContains(sql, fragment) {
  return normalizeSql(sql).includes(normalizeSql(fragment));
}

// ── Pipeline runner ─────────────────────────────────────────────────────────
function runReportPipeline(config) {
  applyConfig(config);
  if (typeof invalidateValidation === 'function') invalidateValidation();
  const validation = typeof getValidation === 'function' ? getValidation() : null;
  const plan = typeof buildQueryPlan === 'function' ? buildQueryPlan() : null;

  // Render SQL separately so we can inspect it regardless of execution
  let sql = null;
  let rendered = null;
  if (plan) {
    rendered = renderPlanSql(plan);
    sql = rendered ? rendered.sql : null;
  }

  // Execute (only if not blocked)
  let result = null;
  let error = null;
  if (plan && validation && validation.reportStatus !== 'blocked') {
    try {
      result = typeof executeReport === 'function' ? executeReport() : null;
    } catch (e) {
      error = e.message;
    }
  }

  return { validation, plan, sql, result, error };
}

function renderPlanSql(plan) {
  if (!plan) return null;
  const mode = plan.aggMode || 'none';
  if (mode === 'group') {
    return typeof renderGroupedSql === 'function' ? renderGroupedSql(plan) : null;
  }
  if (mode === 'totals') {
    const detail = typeof renderDetailSql === 'function' ? renderDetailSql(plan) : null;
    const totals = typeof renderTotalsSql === 'function' ? renderTotalsSql(plan, detail ? detail.cols : []) : null;
    return { sql: detail ? detail.sql : null, params: detail ? detail.params : [], cols: totals ? totals.cols : (detail ? detail.cols : []), detail, totals };
  }
  if (mode === 'subtotals') {
    return typeof renderSubtotalsSql === 'function' ? renderSubtotalsSql(plan) : null;
  }
  return typeof renderDetailSql === 'function' ? renderDetailSql(plan) : null;
}

function applyConfig(config) {
  if (!config) return;
  for (const [key, value] of Object.entries(config)) {
    if (key === 'excludedRows') {
      const out = {};
      for (const [tid, rows] of Object.entries(value)) {
        out[tid] = new Set(rows);
      }
      db.excludedRows = out;
    } else if (key === 'lookups') {
      db.lookups = value.map(lk => Object.assign({}, lk));
    } else if (key === 'calcStages') {
      db.calcStages = value.map(c => Object.assign({}, c));
    } else if (key === 'filters') {
      db.filters = value.map(f => Object.assign({}, f));
    } else if (key === 'sorts') {
      db.sorts = value.map(s => Object.assign({}, s));
    } else if (key === 'aggregates') {
      db.aggregates = value.map(a => Object.assign({}, a));
    } else if (key === 'subtotalFns') {
      db.subtotalFns = Object.assign({}, value);
    } else if (key === 'colTotals') {
      db.colTotals = Object.assign({}, value);
    } else {
      db[key] = value;
    }
  }
}

// ── Assertion helpers ───────────────────────────────────────────────────────
function expectReportHealthy(validation) {
  assert.ok(validation, 'validation result should exist');
  assert.equal(validation.reportStatus, 'healthy',
    `Expected healthy report, got "${validation.reportStatus}". Issues: ${JSON.stringify(getBlockingIssues(validation))}`);
}

function expectReportBlocked(validation) {
  assert.ok(validation, 'validation result should exist');
  assert.equal(validation.reportStatus, 'blocked',
    `Expected blocked report, got "${validation.reportStatus}"`);
}

function getBlockingIssues(validation) {
  const out = [];
  if (validation && validation.items) {
    for (const [id, item] of Object.entries(validation.items)) {
      if (item.blocking) out.push(...item.issues);
    }
  }
  return out;
}

function expectItemBlocked(validation, itemId) {
  const item = validation && validation.items && validation.items[itemId];
  assert.ok(item, `Item "${itemId}" should exist in validation result`);
  assert.ok(item.blocking, `Item "${itemId}" should be blocking`);
}

function expectItemHealthy(validation, itemId) {
  const item = validation && validation.items && validation.items[itemId];
  assert.ok(item, `Item "${itemId}" should exist in validation result`);
  assert.ok(!item.blocking, `Item "${itemId}" should not be blocking`);
}

function expectRowsEqual(actual, expected) {
  assert.equal(actual.length, expected.length,
    `Row count mismatch: got ${actual.length}, expected ${expected.length}`);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i];
    const e = expected[i];
    for (const key of Object.keys(e)) {
      assert.equal(a[key], e[key],
        `Row ${i}, col "${key}": expected ${JSON.stringify(e[key])}, got ${JSON.stringify(a[key])}`);
    }
  }
}

function expectResultColumns(result, expectedCols) {
  assert.ok(result, 'Result should exist');
  if (!result) return;
  const actual = result.columns || [];
  assert.equal(actual.length, expectedCols.length,
    `Column count mismatch: got [${actual}], expected [${expectedCols}]`);
  for (let i = 0; i < expectedCols.length; i++) {
    assert.equal(actual[i], expectedCols[i],
      `Column ${i}: expected "${expectedCols[i]}", got "${actual[i]}"`);
  }
}

function expectResultRowCount(result, n) {
  assert.ok(result, 'Result should exist');
  assert.equal(result.rows.length, n,
    `Row count: expected ${n}, got ${result.rows.length}`);
}

function findRow(rows, matcher) {
  for (const row of rows) {
    let allMatch = true;
    for (const [k, v] of Object.entries(matcher)) {
      if (row[k] !== v) { allMatch = false; break; }
    }
    if (allMatch) return row;
  }
  return null;
}

// ── Excel fixture loader ─────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const FIXTURE_DIR = path.resolve(__dirname, 'testfixtures');

function getFixtureFiles() {
  return fs.readdirSync(FIXTURE_DIR).filter(f => /\.xlsx?$/i.test(f));
}

function loadExcelSheet(filePath, sheetName) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: true });
  const target = sheetName || wb.SheetNames[0];
  const ws = wb.Sheets[target];
  if (!ws) throw new Error(`Sheet "${target}" not found in ${path.basename(filePath)}`);
  const json = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: false });
  return { workbook: wb, sheetName: target, worksheet: ws, rows: json };
}

function createTableFromSheet(db, tableName, rows) {
  if (!rows || rows.length === 0) throw new Error('No data rows to create table');
  const cols = Object.keys(rows[0]);
  const quoted = cols.map(c => `"${c}"`);
  const colDefs = quoted.map((c, i) => `${c} TEXT`);
  db.run(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs.join(', ')})`);
  for (const row of rows) {
    const vals = cols.map(c => {
      const v = row[c];
      if (v == null) return 'NULL';
      if (typeof v === 'number') return v;
      if (v instanceof Date) return `'${v.toISOString().slice(0, 10)}'`;
      return `'${String(v).replace(/'/g, "''")}'`;
    });
    db.run(`INSERT INTO "${tableName}" (${quoted.join(', ')}) VALUES (${vals.join(', ')})`);
  }
  return cols;
}

function snapshotTable(db, tableName) {
  const rows = db.exec(`SELECT * FROM "${tableName}" ORDER BY rowid`);
  const cols = db.exec(`PRAGMA table_info("${tableName}")`);
  return {
    rowCount: rows[0] ? rows[0].values.length : 0,
    columns: cols[0] ? cols[0].values.map(r => r[1]) : [],
    rows: rows[0] ? rows[0].values : [],
  };
}

// ── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  normalizeSql,
  sqlContains,
  runReportPipeline,
  applyConfig,
  renderPlanSql,
  expectReportHealthy,
  expectReportBlocked,
  expectItemBlocked,
  expectItemHealthy,
  expectRowsEqual,
  expectResultColumns,
  expectResultRowCount,
  getBlockingIssues,
  findRow,
  getFixtureFiles,
  loadExcelSheet,
  createTableFromSheet,
  snapshotTable,
};
