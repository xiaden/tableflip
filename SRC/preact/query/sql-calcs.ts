/**
 * SQL calculated column expression generation.
 *
 * Generates SQL expressions for calculated columns based on calc stage
 * definitions. Supports math, compare, text, and date modes.
 *
 * Ported from SRC/js/query/sql-calcs.ts — rewritten as a pure function
 * with explicit parameters (no global state dependency).
 */

import type { CalcStage } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import { quoteId } from '../core/sqldb';
import { normalizeDateExpr, getDateInputFormat } from '../core/date-format';
import type { DateInputFormat } from '../types';
import { resolveRef } from './resolve-ref';

// ── Types ───────────────────────────────────────────────────────────────────────

interface CalcMathStep {
  type?: string;
  value?: string;
  op?: string;
}

interface CalcModeMath {
  strategy?: string;
  steps: CalcMathStep[];
}

interface CalcModeCompare {
  compareMode?: string;
  conditions: Array<{ col: string; op: string; val: string }>;
  trueValue: { type: string; value: string };
  falseValue: { type: string; value: string };
}

interface CalcModeText {
  operation: string;
  parts?: Array<{ type: string; value: string }>;
  source?: { type: string; value: string };
  count?: number;
  start?: number;
  length?: number;
}

interface CalcModeDate {
  operation: string;
  source?: { type: string; value: string };
  part?: string;
  output?: string;
  inputFormat?: DateInputFormat;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * Cast an expression to REAL, defaulting to 0 for empty/null/whitespace values.
 */
function toNum(expr: string): string {
  return `CAST(COALESCE(NULLIF(TRIM(CAST(${expr} AS TEXT)), ''), '0') AS REAL)`;
}



/**
 * Find the base table ID by scanning the colMap for the first physical column
 * whose table has a "_rowno" column. Falls back to the first physical entry's
 * table ID.
 */
function findBaseTid(colMap: Map<string, ColMapEntry>): string {
  for (const entry of colMap.values()) {
    if (!entry || (entry as { kind?: string }).kind === 'calc') continue;
    const physical = entry as { tid: string; col: string };
    if (physical.col === '_rowno') return physical.tid;
  }
  // Fallback: first physical entry's table
  for (const entry of colMap.values()) {
    if (!entry || (entry as { kind?: string }).kind === 'calc') continue;
    return (entry as { tid: string }).tid;
  }
  return '_base';
}

// ── Core render function ────────────────────────────────────────────────────────

/**
 * Render a single calc stage to a SQL expression string.
 */
function renderCalcExpr(
  calc: CalcStage,
  alias: string,
  colMap: Map<string, ColMapEntry>,
  trail: Set<string>,
): string {
  if (trail.has(alias)) return 'NULL';
  trail.add(alias);

  if (calc.mode === 'math') {
    return renderModeMath(calc, alias, colMap, trail);
  }
  if (calc.mode === 'compare') {
    return renderModeCompare(calc, alias, colMap, trail);
  }
  if (calc.mode === 'text') {
    return renderModeText(calc, alias, colMap, trail);
  }
  if (calc.mode === 'date') {
    return renderModeDate(calc, alias, colMap, trail);
  }
  throw new Error(`Unknown calc mode "${calc.mode}" for "${alias}"`);
}

// ── Mode-based calc rendering helpers ───────────────────────────────────────────

function renderModeMath(
  calc: CalcStage,
  alias: string,
  colMap: Map<string, ColMapEntry>,
  trail: Set<string>,
): string {
  const math = calc.math as CalcModeMath | undefined;
  const steps = math!.steps;

  const renderStepVal = (step: CalcMathStep, t: Set<string>): string => {
    if (step.type === 'number') {
      const n = parseFloat(step.value || '');
      return Number.isFinite(n) ? String(n) : '0';
    }
    if (step.type === 'column') {
      const expr = resolveRef(step.value || '', colMap);
      // If the column references another calc, render it inline
      const refEntry = colMap.get(step.value || '');
      if (refEntry && (refEntry as { kind?: string }).kind === 'calc') {
        const refCalc = (refEntry as { kind: 'calc'; calc?: CalcStage }).calc;
        if (refCalc) {
          return toNum(renderCalcExpr(refCalc, step.value || '', colMap, t));
        }
      }
      return toNum(expr);
    }
    if (step.type === 'text') {
      return `'${String(step.value || '').replace(/'/g, "''")}'`;
    }
    throw new Error(`Unsupported math step type "${step.type}" in calc "${alias}"`);
  };

  const ext = calc as unknown as Record<string, unknown>;
  const mathOp = ext.mathOp as string | undefined;
  const colExpr = renderStepVal(steps[0], trail);
  const baseTid = findBaseTid(colMap);
  const rownoRef = `${quoteId(baseTid)}.${quoteId('_rowno')}`;

  if (mathOp === 'ROLLAVG') {
    const window = Math.max(1, parseInt(String(ext.window || '7'), 10) || 7);
    return `AVG(${colExpr}) OVER (ORDER BY ${rownoRef} ROWS BETWEEN ${window - 1} PRECEDING AND CURRENT ROW)`;
  }

  if (mathOp === 'PCTTOTAL') {
    return `${colExpr} * 100.0 / NULLIF(SUM(${colExpr}) OVER (), 0)`;
  }

  let expr = colExpr;
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    const r = renderStepVal(step, trail);
    switch (step.op) {
      case '+': expr = `(${expr} + ${r})`; break;
      case '-': expr = `(${expr} - ${r})`; break;
      case '*': expr = `(${expr} * ${r})`; break;
      case '/': expr = `(CASE WHEN ${r} = 0 THEN NULL ELSE ${expr} / ${r} END)`; break;
      case '%': expr = `(CASE WHEN ${r} = 0 THEN NULL ELSE ${expr} % ${r} END)`; break;
      default: throw new Error(`Unsupported math operator "${step.op}" in calc "${alias}"`);
    }
  }
  return expr;
}

function renderModeCompare(
  calc: CalcStage,
  alias: string,
  colMap: Map<string, ColMapEntry>,
  trail: Set<string>,
): string {
  const compare = calc.compare as CalcModeCompare | undefined;
  const glue = compare!.compareMode === 'OR' ? ' OR ' : ' AND ';

  const condParts = compare!.conditions.map((cond: { col: string; op: string; val: string }) => {
    const colExpr = resolveRef(cond.col, colMap);
    const op = cond.op;
    if (!['=', '!=', '>', '>=', '<', '<='].includes(op)) {
      throw new Error(`Invalid comparison operator "${op}" in calc "${alias}"`);
    }
    const cv = String(cond.val ?? '').trim();
    const n = parseFloat(cv.replace(/,/g, ''));
    const cNum = toNum(colExpr);
    const cTxt = `CAST(${colExpr} AS TEXT)`;
    if (['>', '>=', '<', '<='].includes(op)) return `${cNum} ${op} ${Number.isFinite(n) ? n : 0}`;
    if (cv !== '' && Number.isFinite(n)) return `${cNum} ${op} ${n}`;
    return `${cTxt} ${op === '=' ? '=' : '!='} '${cv.replace(/'/g, "''")}'`;
  });

  const thenExpr = renderTypedValue(compare!.trueValue, colMap, trail);
  const elseExpr = renderTypedValue(compare!.falseValue, colMap, trail);
  return `(CASE WHEN ${condParts.join(glue)} THEN ${thenExpr} ELSE ${elseExpr} END)`;
}

function renderModeText(
  calc: CalcStage,
  alias: string,
  colMap: Map<string, ColMapEntry>,
  trail: Set<string>,
): string {
  const text = calc.text as CalcModeText | undefined;
  const op = text!.operation;

  if (op === 'combine') {
    const parts = text!.parts!.map((p: { type: string; value: string }) =>
      renderTextPart(p, colMap, trail),
    );
    return parts.join(' || ');
  }
  if (op === 'left') {
    const src = renderTextSource(text!.source!, colMap, trail);
    return `SUBSTR(${src}, 1, ${text!.count})`;
  }
  if (op === 'right') {
    const src = renderTextSource(text!.source!, colMap, trail);
    return `SUBSTR(${src}, -${text!.count})`;
  }
  if (op === 'substring') {
    const src = renderTextSource(text!.source!, colMap, trail);
    return `SUBSTR(${src}, ${text!.start}, ${text!.length})`;
  }
  throw new Error(`Unknown text operation "${op}" in calc "${alias}"`);
}

function renderModeDate(
  calc: CalcStage,
  alias: string,
  colMap: Map<string, ColMapEntry>,
  trail: Set<string>,
): string {
  const date = calc.date as CalcModeDate | undefined;
  const op = date!.operation;

  if (op === 'extract') {
    const inputFormat = getDateInputFormat(date);
    const src = renderDateSource(date!.source!, colMap, trail, inputFormat);
    const part = date!.part || 'year';
    const output = date!.output || 'text';

    const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const monthCase = (names: string[]) => {
      const branches = names.map((n, j) => `WHEN ${j + 1} THEN '${n}'`).join(' ');
      return `(CASE CAST(strftime('%m', ${src}) AS INTEGER) ${branches} END)`;
    };

    const dowCase = (names: string[]) => {
      const branches = names.map((n, j) => `WHEN ${j} THEN '${n}'`).join(' ');
      return `(CASE CAST(strftime('%w', ${src}) AS INTEGER) ${branches} END)`;
    };

    if (part === 'quarter') {
      if (output === 'short') {
        const branches = [1, 2, 3, 4].map(q => `WHEN ${q} THEN 'Q${q}'`).join(' ');
        return `(CASE ((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1) ${branches} END)`;
      }
      if (output === 'text') {
        const branches = [1, 2, 3, 4].map(q => `WHEN ${q} THEN 'Quarter ${q}'`).join(' ');
        return `(CASE ((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1) ${branches} END)`;
      }
      return `((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1)`;
    }

    if (part === 'julian') {
      return `CAST(julianday(${src}) AS INTEGER)`;
    }

    if (part === 'month') {
      if (output === 'short') return monthCase(MONTH_SHORT);
      if (output === 'text') return monthCase(MONTH_FULL);
      return `CAST(strftime('%m', ${src}) AS INTEGER)`;
    }

    if (part === 'dow') {
      if (output === 'short') return dowCase(DOW_SHORT);
      if (output === 'text') return dowCase(DOW_FULL);
      return `CAST(strftime('%w', ${src}) AS INTEGER)`;
    }

    // year, week, day — numeric only
    const partFormat: Record<string, string> = {
      'year': '%Y',
      'day': '%d',
      'week': '%W',
    };
    return `CAST(strftime('${partFormat[part]}', ${src}) AS INTEGER)`;
  }
  throw new Error(`Unknown date operation "${op}" in calc "${alias}"`);
}

// ── Sub-renderers ───────────────────────────────────────────────────────────────

function renderDateSource(
  source: { type: string; value: string },
  colMap: Map<string, ColMapEntry>,
  trail: Set<string>,
  format?: DateInputFormat | null,
): string {
  if (source.type === 'column') {
    const expr = resolveRef(source.value, colMap);
    return normalizeDateExpr(expr, format ?? null);
  }
  throw new Error(`Unsupported date source type "${source.type}"`);
}

function renderTypedValue(
  tv: { type: string; value: string },
  colMap: Map<string, ColMapEntry>,
  trail: Set<string>,
): string {
  if (tv.type === 'text') return `'${String(tv.value).replace(/'/g, "''")}'`;
  if (tv.type === 'number') return String(Number(tv.value));
  if (tv.type === 'column') return resolveRef(tv.value, colMap);
  throw new Error(`Unsupported typed-value type "${tv.type}"`);
}

function renderTextPart(
  part: { type: string; value: string },
  colMap: Map<string, ColMapEntry>,
  _trail: Set<string>,
): string {
  if (part.type === 'text') return `'${String(part.value).replace(/'/g, "''")}'`;
  if (part.type === 'number') return `CAST(${Number(part.value)} AS TEXT)`;
  if (part.type === 'column') {
    const expr = resolveRef(part.value, colMap);
    return `COALESCE(CAST(${expr} AS TEXT), '')`;
  }
  throw new Error(`Unsupported text part type "${part.type}"`);
}

function renderTextSource(
  source: { type: string; value: string },
  colMap: Map<string, ColMapEntry>,
  _trail: Set<string>,
): string {
  if (source.type === 'text') return `'${String(source.value).replace(/'/g, "''")}'`;
  if (source.type === 'column') return resolveRef(source.value, colMap);
  throw new Error(`Unsupported text source type "${source.type}"`);
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build SQL expressions for all enabled calculated columns.
 *
 * Each valid calc stage produces one SQL expression with an alias.
 * Disabled stages, stages without an alias, or stages with invalid
 * configurations are silently skipped.
 *
 * @param calcStages - Array of CalcStage definitions from the report pipeline.
 * @param colMap     - Column alias → source mapping (from buildColumnCatalog).
 *                     Used to resolve column references to physical SQL identifiers.
 * @returns Array of `{ alias, sql }` objects, one per valid calc stage.
 */
export function buildCalcExpressions(
  calcStages: CalcStage[],
  colMap: Map<string, ColMapEntry>,
): Array<{ alias: string; sql: string }> {
  const results: Array<{ alias: string; sql: string }> = [];

  for (let i = 0; i < calcStages.length; i++) {
    const calc = calcStages[i];
    if (!calc || calc.enabled === false) continue;

    const alias = (calc.alias || '').trim();
    if (!alias) continue;

    if (!calc.mode || !['math', 'compare', 'text', 'date'].includes(calc.mode as string)) continue;

    try {
      const trail = new Set<string>();
      const sql = renderCalcExpr(calc, alias, colMap, trail);
      results.push({ alias, sql });
    } catch {
      // Skip calc stages that fail to render (e.g. missing references)
    }
  }

  return results;
}
