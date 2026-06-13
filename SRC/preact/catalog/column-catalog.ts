/**
 * Column catalog — maps column aliases to their physical sources.
 *
 * Provides two APIs:
 * - Store-based (`buildColSourceMap`): reads from global AppState via getStore()
 * - Catalog-based (`buildColumnCatalog`): pure function using explicit sourceCatalog
 *
 * The column catalog is the backbone of the query builder — every SQL generator
 * resolves column aliases through its colMap to produce physical references.
 */

import type { CalcStage, DetailBandSpec, LookupSpec } from '../types';
import type { SourceTableEntry } from './source-catalog';
import { getStore } from '../core/store';

// ── Types ───────────────────────────────────────────────────────────────────────

/** A physical column — maps an alias to a table ID and column name. */
export interface PhysicalColEntry {
  kind?: undefined;
  tid: string;
  col: string;
}

/** A calculated column — maps an alias to a calc stage index and its mode. */
export interface CalcColEntry {
  kind: 'calc';
  idx: number;
  mode?: string;
  alias?: string;
  calc?: unknown;
}

/** A detail band column — maps a prefixed alias to a child table's physical column.
 *  Tagged with kind: 'band' so query builders can skip it in main SELECT projection
 *  while resolveRef() still returns a safe quoted alias reference. */
export interface BandColEntry {
  kind: 'band';
  tid: string;
  col: string;
}

/** Union type for column map entries — physical, calculated, or band. */
export type ColMapEntry = PhysicalColEntry | CalcColEntry | BandColEntry;

interface ColumnCatalog {
  colMap: Map<string, ColMapEntry>;
  lookupBoundaries: Map<string, ColMapEntry>[];
  reportSpec: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * Derive a SQL-safe table prefix from a table name.
 *
 * Takes the portion after the last em-dash (—) separator, strips non-alphanumeric
 * characters, and appends double underscores. Used to alias right-table columns
 * when they conflict with base-table columns.
 *
 * @param name - The table name (may contain em-dash separators).
 * @returns A SQL-safe prefix string ending with `__`.
 */
export function tablePrefix(name: string): string {
  return name.split('—').pop()!.trim().replace(/[^A-Za-z0-9_]/g, '_') + '__';
}

// ── Simple API (store-based) ────────────────────────────────────────────────────

/**
 * Build a column-to-source map from the global store state.
 *
 * Reads tables and calc stages from AppState via getStore() and produces
 * a Map from column alias to its physical source (table ID + column name)
 * or calculated source (calc stage index).
 *
 * @returns A Map from column alias to ColMapEntry.
 */
export function buildColSourceMap(): Map<string, ColMapEntry> {
  const state = getStore().getState();
  const map = new Map<string, ColMapEntry>();

  for (const tid of Object.keys(state.tables)) {
    const cols = state.tables[tid]?.cols || [];
    for (const col of cols) {
      map.set(col, { tid, col });
    }
  }

  for (let i = 0; i < (state.calcStages || []).length; i++) {
    const calc = state.calcStages[i];
    if (calc?.alias) {
      map.set(calc.alias, { kind: 'calc', idx: i, alias: calc.alias });
    }
  }

  return map;
}

// ── Catalog-based API (pure, no global state) ───────────────────────────────────

/**
 * Build a column catalog from an explicit reportSpec and sourceCatalog.
 *
 * Constructs a column map by iterating through base columns, lookup-prefixed
 * columns, and validated calculated columns. Also captures lookup boundary
 * snapshots for `projectedColsUpToLookup`.
 *
 * @param reportSpec - Report specification containing base, lookups, and calcStages.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 * @returns `{ colMap, lookupBoundaries, reportSpec }` — the column alias map,
 *   ordered snapshots of the colMap at each lookup boundary, and the input spec.
 * @throws If sourceCatalog is not a Map.
 */
export function buildColumnCatalog(
  reportSpec: Record<string, unknown>,
  sourceCatalog: Map<string, SourceTableEntry>,
): ColumnCatalog {
  if (!(sourceCatalog instanceof Map)) {
    throw new Error('buildColumnCatalog: sourceCatalog (Map) is required');
  }

  const base       = reportSpec.base as string | undefined;
  const lookups    = (reportSpec.lookups || []) as LookupSpec[];
  const calcStages = (reportSpec.calcStages || []) as CalcStage[];

  function tableColumns(tid: string): string[] | null {
    const entry = sourceCatalog.get(tid);
    return entry ? (entry.cols ?? null) : null;
  }

  function tableName(tid: string): string {
    const entry = sourceCatalog.get(tid);
    return entry ? (entry.name ?? tid) : tid;
  }

  const colMap = new Map<string, ColMapEntry>();

  // Base columns
  const baseCols = base ? tableColumns(base) : null;
  if (baseCols) {
    baseCols.forEach(c => colMap.set(c, { tid: base!, col: c }));
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

  // Detail band columns — prefixed with _{bandId}_ to avoid collisions.
  // Tagged with kind: 'band' so main query builders skip them in SELECT
  // projection (band columns have no JOIN in the parent FROM clause).
  const detailBands = (reportSpec.detailBands || []) as DetailBandSpec[];
  for (const band of detailBands) {
    if (band.enabled === false || !band.rightId) continue;
    const rtCols = tableColumns(band.rightId);
    if (!rtCols) continue;
    const prefix = `_${band.id}_`;
    const bandCols = (band.cols && band.cols.length > 0) ? band.cols : rtCols;
    for (const c of bandCols) {
      const alias = prefix + c;
      if (!colMap.has(alias)) {
        colMap.set(alias, { kind: 'band', tid: band.rightId, col: c });
      }
    }
  }

  // Calculated columns
  for (const [i, calc] of calcStages.entries()) {
    if (calc?.enabled === false) continue;
    const alias = (calc?.alias || '').trim();
    if (!alias) continue;
    if (!calc.mode || !['math', 'compare', 'text', 'date'].includes(calc.mode as string)) continue;

    let valid = false;
    if (calc.mode === 'math') {
      const m = calc.math as Record<string, unknown> | undefined;
      const steps = (m && Array.isArray(m.steps) ? m.steps : []) as { op?: string; type?: string; value?: string }[];
      const structValid = !!(m && m.strategy === 'stepChain' && steps.length > 0 &&
              !steps[0].op && steps.every(s => s && ['column', 'number', 'text'].includes(s.type!)) &&
              steps.slice(1).every(s => s.op && ['+', '-', '*', '/', '%'].includes(s.op)));
      const colsExist = structValid && steps
        .filter(s => s.type === 'column' && s.value)
        .every(s => colMap.has(s.value!));
      valid = structValid && colsExist;
    } else if (calc.mode === 'compare') {
      const c = calc.compare as Record<string, unknown> | undefined;
      const conds = (Array.isArray(c?.conditions) ? c.conditions : []) as { col?: string; op?: string }[];
      valid = !!(c && conds.length > 0 && c.trueValue && c.falseValue &&
              conds.every(cond => cond.col && ['=', '!=', '>', '>=', '<', '<='].includes(cond.op!)) &&
              conds.some(cond => colMap.has(cond.col!)) &&
              ['column', 'number', 'text'].includes((c.trueValue as Record<string, unknown>).type as string) &&
              ['column', 'number', 'text'].includes((c.falseValue as Record<string, unknown>).type as string));
    } else if (calc.mode === 'text') {
      const t = calc.text as Record<string, unknown> | undefined;
      if (t && ['combine', 'left', 'right', 'substring'].includes(t.operation as string)) {
        if (t.operation === 'combine') {
          const parts = (Array.isArray(t.parts) ? t.parts : []) as { type?: string; value?: string }[];
          const structValid = parts.length > 0 && parts.every(p => p && ['column', 'number', 'text'].includes(p.type!));
          const colsExist = structValid && parts
            .filter(p => p.type === 'column' && p.value)
            .every(p => colMap.has(p.value!));
          valid = structValid && colsExist;
        } else {
          const src = t.source as Record<string, unknown> | undefined;
          const structValid = !!(src && ['column', 'text'].includes(src.type as string));
          const colExists = structValid && src!.type !== 'column' ? true : colMap.has(src!.value as string);
          valid = structValid && colExists;
        }
      }
    } else if (calc.mode === 'date') {
      const d = calc.date as Record<string, unknown> | undefined;
      if (d && d.operation === 'extract') {
        const src = d.source as Record<string, unknown> | undefined;
        const structValid = !!(src && src.type === 'column');
        const colExists = structValid && colMap.has(src!.value as string);
        valid = structValid && colExists && ['year', 'month', 'day', 'dow', 'week', 'quarter', 'julian'].includes(d.part as string);
      }
    }
    if (!valid) continue;
    if (colMap.has(alias)) continue;
    colMap.set(alias, { kind: 'calc', mode: calc.mode as string, idx: i, calc: calc });
  }

  return { colMap, lookupBoundaries, reportSpec };
}

/**
 * Returns array of all projected column aliases from a context.
 *
 * Convenience wrapper around buildColumnCatalog that returns just the
 * column alias keys.
 *
 * @param reportSpec - Report specification containing base, lookups, and calcStages.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 * @returns Array of column alias strings available in the catalog.
 */
export function projectedCols(
  reportSpec: Record<string, unknown>,
  sourceCatalog: Map<string, SourceTableEntry>,
): string[] {
  return [...buildColumnCatalog(reportSpec, sourceCatalog).colMap.keys()];
}

/**
 * Returns projected columns available as left-key for lookups[upTo].
 *
 * Builds the column list incrementally: starts with base columns, then adds
 * each lookup's right-table columns up to (but not including) index `upTo`.
 * Uses ALL right-table cols (not just lk.cols) so the user can join on any
 * prior-lookup column even if it is not brought into the output.
 *
 * @param upTo - Index of the lookup to stop before (exclusive).
 * @param reportSpec - Report specification containing base and lookups.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 * @returns Array of column alias strings available before the specified lookup.
 * @throws If sourceCatalog is not a Map.
 */
export function projectedColsUpToLookup(
  upTo: number,
  reportSpec: Record<string, unknown>,
  sourceCatalog: Map<string, SourceTableEntry>,
): string[] {
  if (!(sourceCatalog instanceof Map)) {
    throw new Error('projectedColsUpToLookup: sourceCatalog (Map) is required');
  }

  const base    = reportSpec.base as string | undefined;
  const lookups = (reportSpec.lookups || []) as LookupSpec[];

  if (!base) return [];
  const baseEntry = sourceCatalog.get(base);
  if (!baseEntry) return [];

  const cols   = [...baseEntry.cols];
  const colSet = new Set(cols);

  for (let i = 0; i < upTo; i++) {
    const lk = (lookups || [])[i];
    if (!lk || lk.enabled === false || !lk.rightId) continue;
    const rtEntry = sourceCatalog.get(lk.rightId);
    if (!rtEntry) continue;
    const prefix = tablePrefix(rtEntry.name);
    rtEntry.cols.forEach(c => {
      const alias = colSet.has(c) ? prefix + c : c;
      if (!colSet.has(alias)) { cols.push(alias); colSet.add(alias); }
    });
  }
  return cols;
}
