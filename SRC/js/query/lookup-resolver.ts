import { db } from '../core/state.js';
import { projectedColsUpToLookup } from '../catalog/column-catalog.js';
import { quoteId, execQuery } from '../core/sqldb.js';
import { colUserLabel } from '../core/utils.js';

interface ValidationIssue {
  code: string;
  message: string;
  missingTableId?: string;
  missingColumn?: string;
}

interface LookupJoinPlan {
  rightId: string;
  keyPairs: Array<{ left: string; right: string }>;
  required: boolean;
  duplicatePolicy: { mode: string };
}

interface DuplicateResult {
  hasDuplicates: boolean;
  duplicateCount: number;
  duplicateKeys: string[];
}

// ── Lookup Resolver ────────────────────────────────────────────────────────────
// Validates lookup specs and resolves duplicate-key policies.
//
// duplicatePolicy shape (extension of lookup spec):
//   {
//     mode:    'block' | 'combine',
//     combine: {
//       separator:    '; ',
//       unique:       true,
//       includeBlank: false,
//       sort:         true,
//     }
//   }
//
// Rules:
//   mode=block (default) → lookup is unresolved/blocking if duplicates exist
//   mode=combine         → pre-aggregate duplicate keys on right side before join
//
// API:
//   validateLookupSpec(lookupSpec, lookupIndex) → issues[]
//   buildLookupPlan(lookupSpec)                 → LookupJoinPlan
//   checkLookupDuplicates(lookupSpec)           → errorString | null
//   detectDuplicateLookupKeys(rightRows, keyPairs) → { hasDuplicates, duplicateCount }
//   applyDuplicatePolicy(rightRows, keyPairs, policy) → row[]

export function validateLookupSpec(lookupSpec: LookupSpec, lookupIndex: number): ValidationIssue[] {
  const issues = [];
  if (!lookupSpec.rightId) {
    issues.push({ code: 'MISSING_RIGHT_TABLE', message: 'Lookup has no right-side table.' });
    return issues;
  }

  if (!(lookupSpec.rightId && db.tables && db.tables[lookupSpec.rightId])) {
    issues.push({
      code:          'RIGHT_TABLE_NOT_FOUND',
      message:       `Lookup table "${lookupSpec.rightId}" is not loaded.`,
      missingTableId: lookupSpec.rightId,
    });
    return issues;
  }

  const keyPairs = Array.isArray(lookupSpec.keyPairs) ? lookupSpec.keyPairs : [];
  const complete = keyPairs.filter(p => p.left && p.right);
  if (!complete.length) {
    issues.push({ code: 'NO_KEY_PAIRS', message: 'Lookup has no complete key pairs.' });
  }

  // Check left column availability
  const leftAvail = projectedColsUpToLookup(lookupIndex);
  for (const pair of complete) {
    if (!leftAvail.includes(pair.left)) {
      issues.push({
        code:          'LEFT_COLUMN_UNAVAILABLE',
        message:       `Left key "${pair.left}" is not available at this join position.`,
        missingColumn:  pair.left,
      });
    }
    if (!(lookupSpec.rightId && pair.right && db.tables && db.tables[lookupSpec.rightId] && db.tables[lookupSpec.rightId].cols.includes(pair.right))) {
      issues.push({
        code:          'RIGHT_COLUMN_NOT_FOUND',
        message:       `Right key "${pair.right}" not found in lookup table.`,
        missingColumn:  pair.right,
      });
    }
  }

  return issues;
}

export function buildLookupPlan(lookupSpec: LookupSpec): LookupJoinPlan {
  const pairs = Array.isArray(lookupSpec.keyPairs)
    ? lookupSpec.keyPairs.filter(p => p.left && p.right)
    : [];
  return {
    rightId:         lookupSpec.rightId,
    keyPairs:        pairs,
    required:        !!lookupSpec.required,
    duplicatePolicy: lookupSpec.duplicatePolicy || { mode: 'block' },
  };
}

// ── Duplicate-key detection (SQL-level) ──────────────────────────────────────
// Check whether a lookup's key columns are unique in the right-side table.
// Returns a human-readable error string, or null if the lookup is clean.
export function checkLookupDuplicates(lk: LookupSpec): string | null {
  if (!lk.rightId || !db.tables[lk.rightId]) return null;
  // When policy is 'combine', duplicates are expected and handled at execution time.
  if (lk.duplicatePolicy && lk.duplicatePolicy.mode === 'combine') return null;
  const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p: { left: string; right: string }) => p.left && p.right) : [];
  if (!pairs.length) return null;
  try {
    const table = quoteId(lk.rightId);
    const tname = db.tables[lk.rightId].name;
    const rightCols = pairs.map((p: { left: string; right: string }) => p.right);
    const whereParts = rightCols
      .map((c: string) => `${quoteId(c)} IS NOT NULL AND TRIM(${quoteId(c)}) != ''`);
    const excl = db.excludedRows?.[lk.rightId];
    if (excl && excl.size) {
      whereParts.push(`"_rowno" NOT IN (${[...excl].join(',')})`);
    }
    const whereNonNull = whereParts.join(' AND ');
    const concatExpr = rightCols.length === 1
      ? quoteId(rightCols[0])
      : rightCols.map((c: string) => quoteId(c)).join(` || CHAR(0) || `);
    const sql = `
      SELECT COUNT(*) AS total, COUNT(DISTINCT ${concatExpr}) AS uniq
      FROM ${table}
      WHERE ${whereNonNull}
    `;
    const rows = execQuery(sql);
    if (!rows.length) return null;
    const { total, uniq } = rows[0] as { total: number; uniq: number };
    if (total > uniq) {
      const dupes = total - uniq;
      const keyLabels = rightCols.map((c: string) => colUserLabel(lk.rightId, c) || c);
      const keyDesc = keyLabels.length === 1
        ? `"${keyLabels[0]}"`
        : keyLabels.map((c: string) => `"${c}"`).join(' + ');
      return `${keyDesc} in "${tname}" has ${dupes.toLocaleString()} duplicate combination${dupes === 1 ? '' : 's'} — it's unclear which row's data applies when there are multiple matches. Choose columns that together form a unique key.`;
    }
    return null;
  } catch {
    return null;
  }
}

// Inspect a rows array for duplicate key values.
// rightRows: array of row objects; keyPairs: [{ right }]
export function detectDuplicateLookupKeys(rightRows: Record<string, unknown>[], keyPairs: Array<{ right: string }>): DuplicateResult {
  const seen   = new Map<string, number>();
  const dupes: string[] = [];
  for (const row of (rightRows || [])) {
    const key   = keyPairs.map((p: { right: string }) => String(row[p.right] ?? '')).join('\x00');
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count === 2) dupes.push(key);
  }
  return {
    hasDuplicates:  dupes.length > 0,
    duplicateCount: dupes.length,
    duplicateKeys:  dupes,
  };
}

// Pre-aggregate duplicate keys according to policy (mode=combine).
// Returns a new rows array with duplicates resolved.
// If policy is mode=block or missing, returns the original rows unchanged.
export function applyDuplicatePolicy(rightRows: Record<string, unknown>[], keyPairs: Array<{ right: string }>, policy: { mode?: string; combine?: { separator?: string; unique?: boolean; includeBlank?: boolean; sort?: boolean } }): Record<string, unknown>[] {
  if (!policy || policy.mode !== 'combine') return rightRows;

  const combine = Object.assign({
    separator:    '; ',
    unique:       true,
    includeBlank: false,
    sort:         true,
  }, policy.combine || {});

  const keyFn  = (row: Record<string, unknown>): string => keyPairs.map((p: { right: string }) => String(row[p.right] ?? '')).join('\x00');
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

  return order.map((key: string) => {
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
