/**
 * Lookup resolver — validates and enriches lookup specifications.
 *
 * Resolves lookup references against a source catalog, validates key pairs,
 * and provides duplicate detection / aggregation utilities.
 *
 * All functions are pure — no global state dependency.
 */

import type { LookupSpec } from '../types';
import type { SourceTableEntry } from '../catalog/source-catalog';

// ── Types ───────────────────────────────────────────────────────────────────────

/** A lookup specification enriched with resolved table metadata and valid key pairs. */
export interface ResolvedLookup {
  /** The original lookup specification. */
  lookup: LookupSpec;
  /** Resolved right-table entry and validated key pairs. */
  resolved: {
    rightTable: SourceTableEntry;
    pairs: Array<{ left: string; right: string }>;
  };
}

/** Result of duplicate key detection on right-side lookup rows. */
export interface DuplicateResult {
  /** Whether any duplicate key combinations were found. */
  hasDuplicates: boolean;
  /** Number of distinct duplicate key combinations. */
  duplicateCount: number;
  /** The duplicate key values (null-byte delimited). */
  duplicateKeys: string[];
}

// ── Validation ──────────────────────────────────────────────────────────────────

/** A validation problem found in a lookup specification. */
export interface ValidationIssue {
  /** Machine-readable error code (e.g. 'MISSING_RIGHT_TABLE'). */
  code: string;
  /** Human-readable description of the issue. */
  message: string;
  /** Table ID that was referenced but not found (if applicable). */
  missingTableId?: string;
  /** Column name that was referenced but not found (if applicable). */
  missingColumn?: string;
}

/**
 * Validate a single lookup spec against the source catalog.
 *
 * Checks:
 * - rightId is present and exists in sourceCatalog
 * - keyPairs is a non-empty array with complete left/right values
 * - right column exists in the referenced table
 *
 * @param lookupSpec  - The lookup to validate
 * @param lookupIndex - Position in the lookups array (for diagnostics)
 * @param sourceCatalog - Table metadata catalog
 * @returns Array of validation issues (empty if valid)
 */
export function validateLookupSpec(
  lookupSpec: LookupSpec,
  lookupIndex: number,
  sourceCatalog: Map<string, SourceTableEntry>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!lookupSpec.rightId) {
    issues.push({ code: 'MISSING_RIGHT_TABLE', message: 'Lookup has no right-side table.' });
    return issues;
  }

  if (!sourceCatalog.has(lookupSpec.rightId)) {
    issues.push({
      code: 'RIGHT_TABLE_NOT_FOUND',
      message: `Lookup table "${lookupSpec.rightId}" is not loaded.`,
      missingTableId: lookupSpec.rightId,
    });
    return issues;
  }

  const keyPairs = Array.isArray(lookupSpec.keyPairs) ? lookupSpec.keyPairs : [];
  const complete = keyPairs.filter(p => p.left && p.right);
  if (!complete.length) {
    issues.push({ code: 'NO_KEY_PAIRS', message: 'Lookup has no complete key pairs.' });
    return issues;
  }

  const rightTable = sourceCatalog.get(lookupSpec.rightId)!;
  for (const pair of complete) {
    if (!rightTable.cols.includes(pair.right)) {
      issues.push({
        code: 'RIGHT_COLUMN_NOT_FOUND',
        message: `Right key "${pair.right}" not found in lookup table "${rightTable.name}".`,
        missingColumn: pair.right,
      });
    }
  }

  return issues;
}

// ── Expand Lookups ──────────────────────────────────────────────────────────────

/**
 * Resolve and validate an array of lookup specifications against a source catalog.
 *
 * For each lookup:
 * - Validates the rightId exists in the catalog
 * - Filters key pairs to complete (left + right) pairs
 * - Validates right-side columns exist in the referenced table
 * - Skips invalid lookups (missing table, no valid key pairs)
 *
 * @param lookups       - Array of LookupSpec objects to resolve
 * @param sourceCatalog - Table metadata catalog (from buildSourceCatalog)
 * @returns Array of resolved lookups with enriched metadata
 */
export function expandLookups(
  lookups: LookupSpec[],
  sourceCatalog: Map<string, SourceTableEntry>,
): ResolvedLookup[] {
  if (!lookups || lookups.length === 0) return [];

  const results: ResolvedLookup[] = [];

  for (const lookup of lookups) {
    // Skip disabled lookups
    if (lookup.enabled === false) continue;

    // Validate right table exists
    if (!lookup.rightId || !sourceCatalog.has(lookup.rightId)) continue;

    const rightTable = sourceCatalog.get(lookup.rightId)!;

    // Filter to valid key pairs (both sides specified)
    const pairs = Array.isArray(lookup.keyPairs)
      ? lookup.keyPairs.filter(p => p.left && p.right)
      : [];

    if (pairs.length === 0) continue;

    // Filter to pairs where the right column actually exists in the table
    const validPairs = pairs.filter(p => rightTable.cols.includes(p.right));
    if (validPairs.length === 0) continue;

    results.push({
      lookup,
      resolved: {
        rightTable,
        pairs: validPairs,
      },
    });
  }

  return results;
}

// ── Duplicate Detection ─────────────────────────────────────────────────────────

/**
 * Inspect a rows array for duplicate key values.
 *
 * Groups rows by the concatenated right-side key column values and reports
 * which key combinations appear more than once.
 *
 * @param rightRows - Array of row objects from the right-side table
 * @param keyPairs  - Key pairs with at least `right` column names
 * @returns Duplicate detection result
 */
export function detectDuplicateLookupKeys(
  rightRows: Record<string, unknown>[],
  keyPairs: Array<{ right: string }>,
): DuplicateResult {
  const seen = new Map<string, number>();
  const dupes: string[] = [];

  for (const row of (rightRows || [])) {
    const key = keyPairs.map(p => String(row[p.right] ?? '')).join('\x00');
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count === 2) dupes.push(key);
  }

  return {
    hasDuplicates: dupes.length > 0,
    duplicateCount: dupes.length,
    duplicateKeys: dupes,
  };
}

// ── Duplicate Policy ────────────────────────────────────────────────────────────

/** Policy for handling duplicate key combinations in lookup right-side tables. */
export interface DuplicatePolicy {
  /** Handling mode: 'combine' merges duplicates, 'block' rejects them. */
  mode?: string;
  /** Options when mode is 'combine'. */
  combine?: {
    /** Separator string for concatenated values (default '; '). */
    separator?: string;
    /** Deduplicate values before joining (default true). */
    unique?: boolean;
    /** Include empty-string values in the merge (default false). */
    includeBlank?: boolean;
    /** Sort values alphabetically before joining (default true). */
    sort?: boolean;
  };
}

/**
 * Pre-aggregate duplicate keys according to policy (mode=combine).
 *
 * When mode is 'combine', rows sharing the same key column values are merged:
 * - Non-key column values are concatenated with the configured separator
 * - Optionally deduplicated and sorted
 * - Key columns keep their value from the first-seen row
 *
 * If policy is mode=block or missing, returns the original rows unchanged.
 *
 * @param rightRows - Array of row objects from the right-side table
 * @param keyPairs  - Key pairs with at least `right` column names
 * @param policy    - Duplicate handling policy
 * @returns New rows array with duplicates resolved (or original if no combine)
 */
export function applyDuplicatePolicy(
  rightRows: Record<string, unknown>[],
  keyPairs: Array<{ right: string }>,
  policy: DuplicatePolicy,
): Record<string, unknown>[] {
  if (!policy || policy.mode !== 'combine') return rightRows;

  const combine = {
    separator: '; ',
    unique: true,
    includeBlank: false,
    sort: true,
    ...policy.combine,
  };

  const keyFn = (row: Record<string, unknown>): string =>
    keyPairs.map(p => String(row[p.right] ?? '')).join('\x00');

  const groups = new Map<string, { keyRow: Record<string, unknown>; valueGroups: Map<string, string[]> }>();
  const order: string[] = [];

  for (const row of (rightRows || [])) {
    const key = keyFn(row);
    if (!groups.has(key)) {
      groups.set(key, { keyRow: row, valueGroups: new Map() });
      order.push(key);
    }
    const grp = groups.get(key)!;
    for (const [col, val] of Object.entries(row)) {
      if (!grp.valueGroups.has(col)) grp.valueGroups.set(col, []);
      const v = String(val ?? '');
      if (!combine.includeBlank && v === '') continue;
      grp.valueGroups.get(col)!.push(v);
    }
  }

  return order.map(key => {
    const { keyRow, valueGroups } = groups.get(key)!;
    const merged: Record<string, unknown> = {};
    for (const [col, vals] of valueGroups.entries()) {
      let list: string[] = combine.unique ? [...new Set(vals)] : vals;
      if (combine.sort) list = list.slice().sort();
      merged[col] = list.join(combine.separator);
    }
    // Key columns keep their exact value from the first-seen row
    for (const p of keyPairs) merged[p.right] = keyRow[p.right];
    return merged;
  });
}
