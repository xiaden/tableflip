'use strict';

// ── Column Catalog ─────────────────────────────────────────────────────────────
// Single source of truth for projected-column resolution.
//
// Absorbs from engine.js: tablePrefix, buildColSourceMap, projectedCols,
// projectedColsUpToLookup.  Those names remain as global backward-compat
// wrappers so every existing caller continues to work unchanged.
//
// New API (accepts explicit parameters — no window.db reads):
//   buildColumnCatalog(reportSpec, upstreamOutputs?)  → ColumnCatalog
//   getProjectedColumns(catalog)                       → string[]
//   resolveOutputAlias(catalog, alias)                 → entry | null
//   resolvePhysicalColumn(catalog, alias)              → { tid, col } | null
//   getColumnsAvailableBeforeLookup(catalog, idx)      → string[]
//   getColumnsAvailableForFilter(catalog)              → string[]
//   getColumnsAvailableForSort(catalog)                → string[]
//   getColumnsAvailableForOutput(catalog)              → string[]

// ── Backward-compat primitives (moved verbatim from engine.js) ────────────────

function tablePrefix(name) {
  return name.split('—').pop().trim().replace(/[^A-Za-z0-9_]/g, '_') + '__';
}

// Returns Map<alias → entry> where entry is { tid, col } | { kind:'calc', … }.
// Accepts optional ctx with { base, lookups, calcStages }; defaults to db.
// db.tables is always the global table registry.
function buildColSourceMap(ctx) {
  ctx = ctx || db;
  const base       = ctx.base;
  const lookups    = ctx.lookups;
  const calcStages = ctx.calcStages;
  const map = new Map();
  if (!base || !db.tables[base]) return map;

  db.tables[base].cols.forEach(c => map.set(c, { tid: base, col: c }));

  for (const lk of (lookups || [])) {
    if (lk.enabled === false) continue;
    if (!lk.rightId || !db.tables[lk.rightId]) continue;
    const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter(p => p.left && p.right) : [];
    if (!pairs.length) continue;
    const rt     = db.tables[lk.rightId];
    const prefix = tablePrefix(rt.name);
    rt.cols.forEach(c => {
      const alias = map.has(c) ? prefix + c : c;
      if (!map.has(alias)) map.set(alias, { tid: lk.rightId, col: c });
    });
  }

  for (const [i, calc] of (calcStages || []).entries()) {
    if (calc?.enabled === false) continue;
    const alias = (calc?.alias || '').trim();
    const left  = calc?.left  || '';
    const right = calc?.right || '';
    const op    = calc?.op    || '';
    const isArithmetic = ['+', '-', '*', '/'].includes(op);
    const isRolling    = op === 'ROLLAVG';
    const isPctTotal   = op === 'PCTTOTAL';
    const isCompare    = op === 'COMPARE';
    if (!alias) continue;
    if (!isArithmetic && !isRolling && !isPctTotal && !isCompare) continue;
    if (isCompare) {
      const conditions = calc?.conditions || [];
      const hasValid = conditions.some(cond => cond?.col && map.has(cond.col) && String(cond?.val ?? '').trim());
      if (!hasValid) continue;
    } else {
      if (!left || !map.has(left)) continue;
      if (isArithmetic && (!right || !map.has(right))) continue;
    }
    if (map.has(alias)) continue;
    map.set(alias, {
      kind: 'calc', alias, left, op, right, idx: i,
      window:        Math.max(1, parseInt(calc?.window, 10) || 7),
      explicitOrder: !!calc?.explicitOrder,
      orderCol:      calc?.orderCol || '',
      orderDir:      calc?.orderDir === 'DESC' ? 'DESC' : 'ASC',
      compareMode:   calc?.compareMode === 'OR' ? 'OR' : 'AND',
      conditions:    Array.isArray(calc?.conditions) ? calc.conditions : [],
      customTF:      !!calc?.customTF,
      trueVal:       calc?.trueVal ?? '',
      falseVal:      calc?.falseVal ?? '',
    });
  }

  return map;
}

function projectedCols(ctx) {
  return [...buildColSourceMap(ctx).keys()];
}

// Projected cols available as left-key for lookup[upTo].
// Uses ALL right-table cols (not just lk.cols) so the user can join on any
// prior-lookup column even if it is not brought into the output.
function projectedColsUpToLookup(upTo, ctx) {
  ctx = ctx || db;
  const base    = ctx.base;
  const lookups = ctx.lookups;
  if (!base || !db.tables[base]) return [];
  const cols   = [...db.tables[base].cols];
  const colSet = new Set(cols);
  for (let i = 0; i < upTo; i++) {
    const lk = (lookups || [])[i];
    if (!lk || lk.enabled === false || !lk.rightId || !db.tables[lk.rightId]) continue;
    const rt     = db.tables[lk.rightId];
    const prefix = tablePrefix(rt.name);
    rt.cols.forEach(c => {
      const alias = colSet.has(c) ? prefix + c : c;
      if (!colSet.has(alias)) { cols.push(alias); colSet.add(alias); }
    });
  }
  return cols;
}

// ── New clean API ──────────────────────────────────────────────────────────────
// buildColumnCatalog builds from explicit reportSpec (no window.db config reads).
// sourceCatalog is a SourceCatalog Map<tid, { id, name, cols, kind, source }>
// produced by buildSourceCatalog() in source-catalog.js.
// If sourceCatalog is null/undefined, falls back to db.tables for backward compat.
function buildColumnCatalog(reportSpec, sourceCatalog) {
  reportSpec   = reportSpec   || db;
  const useSC  = sourceCatalog instanceof Map;

  const base       = reportSpec.base;
  const lookups    = reportSpec.lookups    || [];
  const calcStages = reportSpec.calcStages || [];

  // Table columns resolver — SourceCatalog first, then db.tables fallback
  function tableColumns(tid) {
    if (useSC) {
      const entry = sourceCatalog.get(tid);
      return entry ? entry.cols : null;
    }
    if (tid && db.tables && db.tables[tid]) return db.tables[tid].cols;
    return null;
  }

  function tableName(tid) {
    if (useSC) {
      const entry = sourceCatalog.get(tid);
      return entry ? entry.name : tid;
    }
    if (tid && db.tables && db.tables[tid]) return db.tables[tid].name;
    return tid;
  }

  // colMap: alias → entry
  const colMap = new Map();

  // Base columns
  const baseCols = base ? tableColumns(base) : null;
  if (baseCols) {
    baseCols.forEach(c => colMap.set(c, { tid: base, col: c }));
  }

  // Lookup boundary snapshots for getColumnsAvailableBeforeLookup
  // lookupBoundaries[i] = Map of aliases available just before lookups[i]
  const lookupBoundaries = [new Map(colMap)]; // snapshot before lookup[0]

  // Lookup columns
  for (const lk of lookups) {
    if (lk.enabled === false || !lk.rightId) {
      lookupBoundaries.push(new Map(colMap));
      continue;
    }
    const rtCols = tableColumns(lk.rightId);
    if (!rtCols) { lookupBoundaries.push(new Map(colMap)); continue; }
    const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter(p => p.left && p.right) : [];
    if (!pairs.length) { lookupBoundaries.push(new Map(colMap)); continue; }
    const rName  = tableName(lk.rightId);
    const prefix = tablePrefix(rName);
    rtCols.forEach(c => {
      const alias = colMap.has(c) ? prefix + c : c;
      if (!colMap.has(alias)) colMap.set(alias, { tid: lk.rightId, col: c });
    });
    lookupBoundaries.push(new Map(colMap)); // snapshot after this lookup
  }

  // Calculated columns
  for (const [i, calc] of calcStages.entries()) {
    if (calc?.enabled === false) continue;
    const alias = (calc?.alias || '').trim();
    const left  = calc?.left  || '';
    const right = calc?.right || '';
    const op    = calc?.op    || '';
    const isArithmetic = ['+', '-', '*', '/'].includes(op);
    const isRolling    = op === 'ROLLAVG';
    const isPctTotal   = op === 'PCTTOTAL';
    const isCompare    = op === 'COMPARE';
    if (!alias) continue;
    if (!isArithmetic && !isRolling && !isPctTotal && !isCompare) continue;
    if (isCompare) {
      const conditions = calc?.conditions || [];
      const hasValid = conditions.some(cond => cond?.col && colMap.has(cond.col) && String(cond?.val ?? '').trim());
      if (!hasValid) continue;
    } else {
      if (!left || !colMap.has(left)) continue;
      if (isArithmetic && (!right || !colMap.has(right))) continue;
    }
    if (colMap.has(alias)) continue;
    colMap.set(alias, {
      kind: 'calc', alias, left, op, right, idx: i,
      window:        Math.max(1, parseInt(calc?.window, 10) || 7),
      explicitOrder: !!calc?.explicitOrder,
      orderCol:      calc?.orderCol || '',
      orderDir:      calc?.orderDir === 'DESC' ? 'DESC' : 'ASC',
      compareMode:   calc?.compareMode === 'OR' ? 'OR' : 'AND',
      conditions:    Array.isArray(calc?.conditions) ? calc.conditions : [],
      customTF:      !!calc?.customTF,
      trueVal:       calc?.trueVal ?? '',
      falseVal:      calc?.falseVal ?? '',
    });
  }

  return { colMap, lookupBoundaries, reportSpec };
}

// Returns all projected aliases.
function getProjectedColumns(catalog) {
  return [...catalog.colMap.keys()];
}

// Returns the colMap entry for an alias, or null.
function resolveOutputAlias(catalog, alias) {
  return catalog.colMap.get(alias) || null;
}

// Returns { tid, col } for a non-calc alias, or null.
function resolvePhysicalColumn(catalog, alias) {
  const entry = catalog.colMap.get(alias);
  if (!entry || entry.kind === 'calc') return null;
  return { tid: entry.tid, col: entry.col };
}

// Aliases available as left-key candidates before lookup[lookupIndex].
function getColumnsAvailableBeforeLookup(catalog, lookupIndex) {
  const boundary = catalog.lookupBoundaries[lookupIndex];
  if (!boundary) return [];
  return [...boundary.keys()];
}

function getColumnsAvailableForFilter(catalog) {
  return getProjectedColumns(catalog);
}

function getColumnsAvailableForSort(catalog) {
  return getProjectedColumns(catalog);
}

function getColumnsAvailableForOutput(catalog) {
  return getProjectedColumns(catalog);
}
