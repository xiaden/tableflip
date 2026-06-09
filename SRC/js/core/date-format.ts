import { db } from './state.js';

export type DateFormat = 'mdy' | 'dmy' | 'dmmy';

// ── Format detection ─────────────────────────────────────────────────────────

const RE_MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const RE_DMMY = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;

function _parseMDY(s: string): { m: number; d: number; y: number } | null {
  const m = s.match(RE_MDY);
  if (!m) return null;
  return { m: +m[1], d: +m[2], y: +m[3] };
}

function _parseDMY(s: string): { m: number; d: number; y: number } | null {
  const m = s.match(RE_MDY);
  if (!m) return null;
  return { m: +m[2], d: +m[1], y: +m[3] };
}

function _isValid(d: { m: number; d: number; y: number }): boolean {
  return d.m >= 1 && d.m <= 12 && d.d >= 1 && d.d <= 31 && d.y >= 1;
}

export function detectDateFormat(values: string[]): DateFormat | null {
  const mdy: string[] = [];
  const dmy: string[] = [];
  const dmmy: string[] = [];

  for (const v of values) {
    const s = v.trim();
    if (!s) continue;
    if (RE_MDY.test(s)) { mdy.push(s); dmy.push(s); }
    else if (RE_DMMY.test(s)) { dmmy.push(s); }
  }

  // DD MMM YYYY is unambiguous
  if (dmmy.length > 0) return 'dmmy';

  // MM/DD/YYYY vs DD/MM/YYYY
  if (mdy.length === 0) return null;

  let mdyValid = 0, dmyValid = 0, ambiguous = 0;
  for (const s of mdy) {
    const a = _parseMDY(s)!;
    const b = _parseDMY(s)!;
    const aOk = _isValid(a);
    const bOk = _isValid(b);
    if (aOk && !bOk) mdyValid++;
    else if (!aOk && bOk) dmyValid++;
    else if (aOk && bOk) {
      if (a.m !== b.d) mdyValid++; // month ≠ day → unambiguous
      else ambiguous++;
    }
  }

  // If only one interpretation is valid, use that
  if (mdyValid > 0 && dmyValid === 0) return 'mdy';
  if (dmyValid > 0 && mdyValid === 0) return 'dmy';

  // Mixed validity — use majority
  if (mdyValid > dmyValid) return 'mdy';
  if (dmyValid > mdyValid) return 'dmy';

  // Fully ambiguous (e.g., 01/02/2023) — default to mdy
  return 'mdy';
}

// ── Samples accessor ─────────────────────────────────────────────────────────

export function getColumnSamples(tid: string, col: string): string[] {
  const tbl = db.tables?.[tid] as unknown as Record<string, unknown> | undefined;
  const samples = tbl?.samples as Record<string, string[]> | undefined;
  return samples?.[col] || [];
}

// ── SQL expression generation ────────────────────────────────────────────────

/**
 * Wraps a SQL column expression in a date normalization expression.
 * Returns the original expression unchanged if no conversion is needed.
 */
export function normalizeDateExpr(colExpr: string, format: DateFormat | null): string {
  if (!format) return colExpr;

  // MM/DD/YYYY → YYYY-MM-DD
  if (format === 'mdy') {
    return `CASE WHEN length(${colExpr}) = 10 AND substr(${colExpr},3,1) = '/' AND substr(${colExpr},6,1) = '/'
      THEN substr(${colExpr},7,4) || '-' || substr(${colExpr},1,2) || '-' || substr(${colExpr},4,2)
      ELSE ${colExpr} END`;
  }

  // DD/MM/YYYY → YYYY-MM-DD
  if (format === 'dmy') {
    return `CASE WHEN length(${colExpr}) = 10 AND substr(${colExpr},3,1) = '/' AND substr(${colExpr},6,1) = '/'
      THEN substr(${colExpr},7,4) || '-' || substr(${colExpr},4,2) || '-' || substr(${colExpr},1,2)
      ELSE ${colExpr} END`;
  }

  // DD MMM YYYY → YYYY-MM-DD
  if (format === 'dmmy') {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const whenParts = months.map((name, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return `WHEN '-${name}-' THEN '${mm}'`;
    }).join(' ');
    return `CASE WHEN ${colExpr} GLOB '[0-9]*-???-????'
      THEN substr(${colExpr},8,4) || '-' ||
           (CASE substr(${colExpr}, instr(${colExpr},'-')+1, 3) ${whenParts} END) || '-' ||
           printf('%02d', CAST(substr(${colExpr}, 1, instr(${colExpr},'-')-1) AS INTEGER))
      ELSE ${colExpr} END`;
  }

  return colExpr;
}
