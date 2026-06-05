'use strict';
// ── Source Catalog ─────────────────────────────────────────────────────────────
// Single source of truth for table/column existence checks.
// All modules that need to know whether a table or column is currently loaded
// should call through here rather than accessing db.tables directly.
//
// Backward-compat API (reads from db.tables directly):
//   tableExists(tid), columnExists(tid, col), tableById(tid), columnsByTable(tid)
//
// New clean API (accepts an explicit catalog object):
//   buildSourceCatalog(workspaceState?, upstreamOutputs?)
//   getTable(catalog, tid)
//   getTableColumns(catalog, tid)
//   getTableLabel(catalog, tid)
//   getColumn(catalog, tid, col)
//   resolveSourceTableRef(catalog, ref)
//   resolveSourceColumnRef(catalog, ref)
//
// Source kinds supported by the catalog:
//   'imported' — file loaded directly into db.tables
//   'report'   — published output from another report (multi-report workspace)

// ── Backward-compat functions ─────────────────────────────────────────────────

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

// ── New clean API ──────────────────────────────────────────────────────────────

// Build a SourceCatalog from the current workspace state.
// workspaceState: optional override; defaults to { tables: db.tables }.
// upstreamOutputs: optional Map<outputId, PublishedOutput> from report-output.js.
// Returns a catalog Map<tid, CatalogEntry> where CatalogEntry is:
//   { id, name, cols, kind: 'imported'|'report', source: object }
function buildSourceCatalog(workspaceState, upstreamOutputs) {
  const catalog = new Map();

  // Imported tables from db.tables (or workspaceState.tables)
  const tables = (workspaceState && workspaceState.tables) || (db && db.tables) || {};
  for (const [tid, table] of Object.entries(tables)) {
    catalog.set(tid, {
      id:     tid,
      name:   table.name  || tid,
      cols:   table.cols  || [],
      rows:   table.rows  || [],
      kind:   'imported',
      source: table,
    });
  }

  // Published report output tables (multi-report workspace)
  if (upstreamOutputs) {
    for (const [outputId, output] of upstreamOutputs.entries()) {
      catalog.set(outputId, {
        id:     outputId,
        name:   output.name    || outputId,
        cols:   output.columns || [],
        rows:   output.rows    || [],
        kind:   'report',
        source: output,
      });
    }
  }

  return catalog;
}

// Retrieve a CatalogEntry by table id.
function getTable(catalog, tid) {
  return (catalog instanceof Map ? catalog.get(tid) : null) || null;
}

// Return column list for a table id.
function getTableColumns(catalog, tid) {
  const entry = getTable(catalog, tid);
  return entry ? entry.cols : [];
}

// Return the human-readable table name.
function getTableLabel(catalog, tid) {
  const entry = getTable(catalog, tid);
  return entry ? entry.name : tid;
}

// Return column metadata (currently just { col }) for a specific column.
function getColumn(catalog, tid, col) {
  const cols = getTableColumns(catalog, tid);
  return cols.includes(col) ? { col, tid } : null;
}

// Resolve a table reference (id) to a CatalogEntry, or null.
function resolveSourceTableRef(catalog, ref) {
  return getTable(catalog, ref);
}

// Resolve a column reference { tid, col } to a column entry, or null.
function resolveSourceColumnRef(catalog, ref) {
  if (!ref || !ref.tid || !ref.col) return null;
  return getColumn(catalog, ref.tid, ref.col);
}
