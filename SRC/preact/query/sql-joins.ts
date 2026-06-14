/**
 * SQL JOIN clause generation from lookup specifications.
 *
 * Handles INNER/LEFT joins, key pair conditions, multi-pair AND logic,
 * and prefix-based aliasing. Each lookup becomes a JOIN clause.
 */

import type { LookupSpec } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { SourceTableEntry } from '../catalog/source-catalog';
import { quoteId } from '../core/sqldb';
import { resolveRef } from './resolve-ref';

// ── Types ───────────────────────────────────────────────────────────────────────

/** Result of JOIN clause generation. */
export interface JoinResult {
  /** JOIN clauses concatenated with newlines, empty string if no lookups. */
  joins: string;
  /** Parameterized values (currently empty, reserved for future use). */
  params: unknown[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────



// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build SQL JOIN clauses from lookup specifications.
 *
 * @param lookups       - Array of LookupSpec objects. Enabled lookups with valid key
 *                        pairs produce JOIN clauses. Disabled lookups or those without
 *                        key pairs are skipped.
 * @param colMap        - Column alias → source mapping (from buildColumnCatalog).
 *                        Used to resolve left-side column aliases to physical references.
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog).
 *                        Used to resolve table IDs to names for prefix generation.
 * @returns `{ joins, params }` — the JOIN clauses concatenated with newlines, and
 *          parameterized values (currently empty, reserved for future use).
 */
export function buildJoins(
  lookups: LookupSpec[],
  colMap: Map<string, ColMapEntry>,
  _sourceCatalog: Map<string, SourceTableEntry>,
): JoinResult {
  if (!lookups || lookups.length === 0) return { joins: '', params: [] };

  const params: unknown[] = [];
  const joinClauses: string[] = [];

  for (const lk of lookups) {
    // Skip disabled lookups or those without a right table
    if (lk.enabled === false || !lk.rightId) continue;

    // Filter to valid key pairs (both sides must be specified)
    const pairs = Array.isArray(lk.keyPairs)
      ? lk.keyPairs.filter(p => p.left && p.right)
      : [];
    if (pairs.length === 0) continue;

    // Determine join type: INNER if required, LEFT otherwise
    const jType = lk.required ? 'INNER' : 'LEFT';

    // Build the right table reference
    const rightTableRef = quoteId(lk.rightId);

    // Build ON conditions from key pairs
    const onParts: string[] = [];
    for (const p of pairs) {
      const leftRef = resolveRef(p.left, colMap);
      const rightRef = `${rightTableRef}.${quoteId(p.right)}`;
      onParts.push(`${leftRef} = ${rightRef}`);
    }

    if (onParts.length === 0) continue;

    // Assemble the JOIN clause
    const joinClause = `${jType} JOIN ${rightTableRef} ON ${onParts.join(' AND ')}`;
    joinClauses.push(joinClause);
  }

  return {
    joins: joinClauses.join('\n'),
    params,
  };
}
