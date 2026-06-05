'use strict';
// ── Source Catalog ─────────────────────────────────────────────────────────────
// Single source of truth for table/column existence checks.
// All modules that need to know whether a table or column is currently loaded
// should call through here rather than accessing db.tables directly.

function tableExists(tid) {
  return !!(tid && db.tables && db.tables[tid]);
}

function columnExists(tid, col) {
  return !!(tid && col && db.tables && db.tables[tid] && db.tables[tid].cols.includes(col));
}

function tableById(tid) {
  return (tid && db.tables && db.tables[tid]) || null;
}

function columnsByTable(tid) {
  return (tid && db.tables && db.tables[tid] && db.tables[tid].cols) || [];
}
