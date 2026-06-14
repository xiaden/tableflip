/**
 * SQL WHERE clause generation from filter specifications.
 *
 * Supports all filter operators and AND/OR logic:
 * - Filters in the array are ANDed together
 * - Multiple values within a single filter (vals) are ORed
 * - Column aliases are resolved via colMap
 * - Column-type-aware filter SQL generation via getColumnType()
 */

import type { FilterSpec, ColumnType } from '../types';
import type { ColMapEntry, PhysicalColEntry } from '../catalog/column-catalog';
import { resolveRef } from './resolve-ref';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Result of WHERE clause generation. */
export interface WhereResult {
  /** The WHERE clause body (without the WHERE keyword), empty string if no filters. */
  where: string;
  /** Parameterized values in order of appearance. */
  params: unknown[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Escape LIKE wildcards for safe pattern matching. */
function likeEsc(v: string): string {
  return v.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Return text and numeric column reference expressions. */
function columnRefs(alias: string, colMap: Map<string, ColMapEntry>): { txt: string; num: string } {
  const ref = resolveRef(alias, colMap);
  const txt = `CAST(${ref} AS TEXT)`;
  const num = `CAST(${ref} AS REAL)`;
  return { txt, num };
}

/** Check if a filter is disabled. */
function isDisabled(f: FilterSpec): boolean {
  return f.enabled === false;
}

/**
 * Derive ColumnType for a column alias from the colMap.
 *
 * Resolution priority:
 * 1. `_rowno` / `_ROWNO` → `'number'` (synthetic internal column)
 * 2. Alias not found in colMap → `'string'` (safe default)
 * 3. Calc entry (kind === 'calc') → derived from mode:
 *    - `'math'` → `'number'`
 *    - `'date'` → `'date'`
 *    - `'text'` / `'compare'` → `'string'`
 * 4. Physical or band entry → returns `entry.colType` if present, else `'string'`
 */
function getColumnType(alias: string, colMap: Map<string, ColMapEntry>): ColumnType {
  if (alias === '_rowno' || alias === '_ROWNO') return 'number';
  const entry = colMap.get(alias);
  if (!entry) return 'string';
  if (entry.kind === 'calc') {
    if (entry.mode === 'math') return 'number';
    if (entry.mode === 'date') return 'date';
    return 'string';
  }
  // Physical or band entry — use colType metadata if present
  const colType = (entry as PhysicalColEntry).colType;
  return colType ?? 'string';
}

// ── Single-clause rendering ─────────────────────────────────────────────────────

/**
 * Render a single filter operator clause.
 *
 * Uses `colType` (replaces the old `numericHint`) to select the correct
 * CAST expression for each operator:
 * - `'number'` / `'boolean'` → CAST(ref AS REAL) with numeric params
 * - `'date'` → CAST(ref AS TEXT) with string params
 * - `'string'` → CAST(ref AS TEXT) for comparisons, raw ref for IN/NOT IN
 *
 * @param colType - Column type driving CAST expression selection.
 *   Replaces the pre-feature `numericHint: boolean` parameter.
 */
function renderClause(
  op: string,
  txt: string,
  num: string,
  val: string,
  params: unknown[],
  colType: ColumnType,
  alias: string,
  colMap: Map<string, ColMapEntry>,
): string | null {
  const normVal = String(val ?? '').trim();
  const numVal = Number(normVal.replace(/,/g, ''));
  const hasNumericVal = normVal !== '' && Number.isFinite(numVal);

  // Translate operator names to SQL forms
  const normalizedOp = op === 'equals' ? '='
    : op === 'not equals' ? '!='
    : op === 'starts with' ? 'starts_with'
    : op === 'ends with' ? 'ends_with'
    : op === 'is empty' ? 'is_null'
    : op === 'not empty' ? 'is_not_null'
    : op;

  switch (normalizedOp) {
    case '=':
      if ((colType === 'number' || colType === 'boolean') && hasNumericVal) { params.push(numVal); return `${num} = ?`; }
      params.push(val); return `${txt} = ?`;
    case '!=':
      if ((colType === 'number' || colType === 'boolean') && hasNumericVal) { params.push(numVal); return `${num} != ?`; }
      params.push(val); return `${txt} != ?`;
    case '>':
      if (colType === 'number' || colType === 'boolean') {
        params.push(+normVal || 0);
        return `${num} > ?`;
      }
      params.push(normVal);
      return `${txt} > ?`;
    case '<':
      if (colType === 'number' || colType === 'boolean') {
        params.push(+normVal || 0);
        return `${num} < ?`;
      }
      params.push(normVal);
      return `${txt} < ?`;
    case '>=':
      if (colType === 'number' || colType === 'boolean') {
        params.push(+normVal || 0);
        return `${num} >= ?`;
      }
      params.push(normVal);
      return `${txt} >= ?`;
    case '<=':
      if (colType === 'number' || colType === 'boolean') {
        params.push(+normVal || 0);
        return `${num} <= ?`;
      }
      params.push(normVal);
      return `${txt} <= ?`;
    case 'contains':
      params.push('%' + likeEsc(val) + '%');
      return `${txt} LIKE ? ESCAPE '\\'`;
    case 'starts_with':
      params.push(likeEsc(val) + '%');
      return `${txt} LIKE ? ESCAPE '\\'`;
    case 'ends_with':
      params.push('%' + likeEsc(val));
      return `${txt} LIKE ? ESCAPE '\\'`;
    case 'in': {
      if (!normVal) return null;
      const vals = normVal.split(',').map(v => v.trim()).filter(Boolean);
      if (!vals.length) return null;
      const ref = resolveRef(alias, colMap);
      if (colType === 'number' || colType === 'boolean') {
        const allNumeric = vals.every(v => {
          const n = Number(v.replace(/,/g, ''));
          return v !== '' && Number.isFinite(n);
        });
        if (allNumeric) {
          const numVals = vals.map(v => Number(v.replace(/,/g, '')));
          params.push(...numVals);
          const placeholders = numVals.map(() => '?').join(', ');
          return `CAST(${ref} AS REAL) IN (${placeholders})`;
        }
        params.push(...vals);
        const placeholders = vals.map(() => '?').join(', ');
        return `${ref} IN (${placeholders})`;
      }
      if (colType === 'date') {
        params.push(...vals);
        const placeholders = vals.map(() => '?').join(', ');
        return `CAST(${ref} AS TEXT) IN (${placeholders})`;
      }
      // string (default)
      params.push(...vals);
      const placeholders = vals.map(() => '?').join(', ');
      return `${ref} IN (${placeholders})`;
    }
    case 'not_in': {
      if (!normVal) return null;
      const vals = normVal.split(',').map(v => v.trim()).filter(Boolean);
      if (!vals.length) return null;
      const ref = resolveRef(alias, colMap);
      if (colType === 'number' || colType === 'boolean') {
        const allNumeric = vals.every(v => {
          const n = Number(v.replace(/,/g, ''));
          return v !== '' && Number.isFinite(n);
        });
        if (allNumeric) {
          const numVals = vals.map(v => Number(v.replace(/,/g, '')));
          params.push(...numVals);
          const placeholders = numVals.map(() => '?').join(', ');
          return `CAST(${ref} AS REAL) NOT IN (${placeholders})`;
        }
        params.push(...vals);
        const placeholders = vals.map(() => '?').join(', ');
        return `${ref} NOT IN (${placeholders})`;
      }
      if (colType === 'date') {
        params.push(...vals);
        const placeholders = vals.map(() => '?').join(', ');
        return `CAST(${ref} AS TEXT) NOT IN (${placeholders})`;
      }
      // string (default)
      params.push(...vals);
      const placeholders = vals.map(() => '?').join(', ');
      return `${ref} NOT IN (${placeholders})`;
    }
    case 'is_null':
      return `(${txt} IS NULL OR ${txt} = '')`;
    case 'is_not_null':
      return `(${txt} IS NOT NULL AND ${txt} != '')`;
    default:
      return null;
  }
}

// ── Single filter rendering ─────────────────────────────────────────────────────

/**
 * Render a single filter into SQL expression(s).
 * Multiple values in vals produce OR-connected sub-expressions.
 * Returns null if the filter produces no valid SQL.
 */
function renderFilter(
  f: FilterSpec,
  colMap: Map<string, ColMapEntry>,
  params: unknown[],
): string | null {
  if (!f.col) return null;

  const colType = getColumnType(f.col, colMap);
  const { txt, num } = columnRefs(f.col, colMap);
  const filterVals = Array.isArray(f.vals) && f.vals.length > 0 ? f.vals : [''];

  const orParts: string[] = [];
  for (const v of filterVals) {
    const clause = renderClause(f.op, txt, num, String(v ?? ''), params, colType, f.col, colMap);
    if (clause) orParts.push(clause);
  }

  if (!orParts.length) return null;
  return orParts.length > 1 ? `(${orParts.join(' OR ')})` : orParts[0];
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build a SQL WHERE clause from filter specifications.
 *
 * @param filters - Array of FilterSpec objects. All enabled filters are ANDed together.
 *   Within each filter, multiple values in `vals` are ORed.
 * @param colMap  - Column alias → source mapping (from buildColumnCatalog or buildColSourceMap).
 * @returns `{ where, params }` — the WHERE clause body (without the WHERE keyword) and
 *   parameterized values.
 */
export function buildWhere(
  filters: FilterSpec[],
  colMap: Map<string, ColMapEntry>,
): WhereResult {
  if (!filters || filters.length === 0) return { where: '', params: [] };

  const params: unknown[] = [];
  const parts: string[] = [];

  for (const f of filters) {
    if (isDisabled(f)) continue;
    const clause = renderFilter(f, colMap, params);
    if (clause) parts.push(clause);
  }

  return {
    where: parts.join(' AND '),
    params,
  };
}
