/**
 * SQL WHERE clause generation from filter specifications.
 *
 * Supports all filter operators and AND/OR logic:
 * - Filters in the array are ANDed together
 * - Multiple values within a single filter (vals) are ORed
 * - Column aliases are resolved via colMap
 * - Numeric hint derived from colMap entry kind/mode
 */

import type { FilterSpec } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import { resolveRef } from './resolve-ref';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Result of WHERE clause generation. */
export interface WhereResult {
  /** The WHERE clause body (without the WHERE keyword), empty string if no filters. */
  where: string;
  /** Parameterized values in order of appearance. */
  params: unknown[];
}

/** Grid column metadata entry used for quoting hints. */
export interface ColStateEntry {
  type?: string;
  numericHint?: boolean;
  [key: string]: unknown;
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

/** Check if the column is a numeric calc column (math mode). */
function isNumericCalc(alias: string, colMap: Map<string, ColMapEntry>): boolean {
  const entry = colMap.get(alias);
  return entry?.kind === 'calc' && entry.mode === 'math';
}

// ── Single-clause rendering ─────────────────────────────────────────────────────

/**
 * Render a single filter operator clause.
 * Handles the operator-specific SQL generation logic.
 */
function renderClause(
  op: string,
  txt: string,
  num: string,
  val: string,
  params: unknown[],
  numericHint: boolean,
  alias: string,
  colMap: Map<string, ColMapEntry>,
): string | null {
  const normVal = String(val ?? '').trim();
  const numVal = Number(normVal.replace(/,/g, ''));
  const hasNumericVal = normVal !== '' && Number.isFinite(numVal);

  // Normalize legacy operator names to canonical forms
  const normalizedOp = op === 'equals' ? '='
    : op === 'not equals' ? '!='
    : op === 'starts with' ? 'starts_with'
    : op === 'ends with' ? 'ends_with'
    : op === 'is empty' ? 'is_null'
    : op === 'not empty' ? 'is_not_null'
    : op;

  switch (normalizedOp) {
    case '=':
      if (numericHint && hasNumericVal) { params.push(numVal); return `${num} = ?`; }
      params.push(val); return `${txt} = ?`;
    case '!=':
      if (numericHint && hasNumericVal) { params.push(numVal); return `${num} != ?`; }
      params.push(val); return `${txt} != ?`;
    case '>':   params.push(+val || 0); return `${num} > ?`;
    case '<':   params.push(+val || 0); return `${num} < ?`;
    case '>=':  params.push(+val || 0); return `${num} >= ?`;
    case '<=':  params.push(+val || 0); return `${num} <= ?`;
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
      const allNumeric = numericHint && vals.every(v => {
        const n = Number(v.replace(/,/g, ''));
        return v !== '' && Number.isFinite(n);
      });
      const ref = resolveRef(alias, colMap);
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
    case 'not_in': {
      if (!normVal) return null;
      const vals = normVal.split(',').map(v => v.trim()).filter(Boolean);
      if (!vals.length) return null;
      const allNumeric = numericHint && vals.every(v => {
        const n = Number(v.replace(/,/g, ''));
        return v !== '' && Number.isFinite(n);
      });
      const ref = resolveRef(alias, colMap);
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

  const numericHint = isNumericCalc(f.col, colMap);
  const { txt, num } = columnRefs(f.col, colMap);
  const filterVals = Array.isArray(f.vals) && f.vals.length > 0 ? f.vals : [''];

  const orParts: string[] = [];
  for (const v of filterVals) {
    const clause = renderClause(f.op, txt, num, String(v ?? ''), params, numericHint, f.col, colMap);
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
 * @param colState - Optional grid column metadata for type hints (currently unused but
 *   reserved for future column-type-aware SQL generation).
 * @returns `{ where, params }` — the WHERE clause body (without the WHERE keyword) and
 *   parameterized values.
 */
export function buildWhere(
  filters: FilterSpec[],
  colMap: Map<string, ColMapEntry>,
  _colState?: Record<string, ColStateEntry> | null,
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
