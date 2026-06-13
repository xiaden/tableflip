/**
 * Calc validator — validates a single CalcStage's configuration.
 *
 * Pure function: takes explicit projectedCols parameter instead of reading
 * global state. Structural validity checks only (alias not empty, mode valid,
 * mode-specific field validation, column references exist).
 *
 * Alias-conflict-with-physical-column and alias-uniqueness-across-calcs
 * checks are deferred to deriveValidation() in validation.ts, which has
 * access to colMap and sourceCatalog.
 */

import type { CalcStage, CalcMode } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalcValidatorCtx {
  calc: CalcStage;
  i: number;
  cols: Set<string>;
  alias: string;
}

// ── Mode Validators ──────────────────────────────────────────────────────────

function validateMathMode(ctx: CalcValidatorCtx): string | null {
  const { calc, alias, cols } = ctx;
  const math = calc.math as Record<string, unknown> | undefined;
  if (!math || typeof math !== 'object') return 'Math mode requires a math configuration object.';
  if (math.strategy !== 'stepChain') return 'Math mode requires strategy "stepChain".';
  if (!Array.isArray(math.steps) || (math.steps as unknown[]).length === 0) return 'Math mode requires at least one step.';
  for (let si = 0; si < (math.steps as unknown[]).length; si++) {
    const step = (math.steps as unknown[])[si] as Record<string, unknown>;
    if (!step || typeof step !== 'object') return `Step ${si + 1} is invalid.`;
    if (si === 0 && step.op) return 'The first math step must not have an operator.';
    if (si > 0 && (!step.op || !['+', '-', '*', '/', '%'].includes(step.op as string))) return `Step ${si + 1} has an invalid operator "${step.op}".`;
    if (!['column', 'number', 'text'].includes(step.type as string)) return `Step ${si + 1} has an invalid type "${step.type}".`;
    if (step.type === 'number' && step.value !== '' && isNaN(Number(step.value))) return `Step ${si + 1} has a non-numeric value "${step.value}".`;
    if (step.type === 'column' && step.value && !cols.has(step.value as string)) return `Step ${si + 1} references unavailable column "${step.value}".`;
  }
  if (alias) {
    for (const step of (math.steps as unknown[]) as Array<Record<string, unknown>>) {
      if (step.type === 'column' && step.value === alias) return 'A column cannot reference itself.';
    }
  }
  return null;
}

function validateCompareMode(ctx: CalcValidatorCtx): string | null {
  const { calc, alias, cols } = ctx;
  const compare = calc.compare as Record<string, unknown> | undefined;
  if (!compare || typeof compare !== 'object') return 'Compare mode requires a compare configuration object.';
  if (!['AND', 'OR'].includes(compare.compareMode as string)) return 'Compare mode must use AND or OR.';
  if (!Array.isArray(compare.conditions) || (compare.conditions as unknown[]).length === 0) return 'Compare mode requires at least one condition.';
  for (let ci = 0; ci < (compare.conditions as unknown[]).length; ci++) {
    const cond = (compare.conditions as unknown[])[ci] as Record<string, unknown>;
    if (!cond || typeof cond !== 'object') return `Condition ${ci + 1} is invalid.`;
    if (!cond.col) return `Pick a column for condition ${ci + 1}.`;
    if (!['=', '!=', '>', '>=', '<', '<='].includes(cond.op as string)) return `Pick a valid operator for condition ${ci + 1}.`;
    if (!cols.has(cond.col as string)) return `Column for condition ${ci + 1} is no longer available.`;
    if (!String(cond.val ?? '').trim()) return `Enter a value for condition ${ci + 1}.`;
    if (cond.col === alias) return 'A condition column cannot reference the output column itself.';
  }
  for (const key of ['trueValue', 'falseValue']) {
    const tv = compare[key] as Record<string, unknown> | undefined;
    if (!tv || typeof tv !== 'object') return `Compare ${key} is required.`;
    if (!['column', 'number', 'text'].includes(tv.type as string)) return `Compare ${key} has invalid type "${tv.type}".`;
    if (tv.type === 'column' && tv.value && !cols.has(tv.value as string)) return `Compare ${key} column "${tv.value}" is not available.`;
  }
  return null;
}

function validateTextMode(ctx: CalcValidatorCtx): string | null {
  const { calc, cols } = ctx;
  const text = calc.text as Record<string, unknown> | undefined;
  if (!text || typeof text !== 'object') return 'Text mode requires a text configuration object.';
  if (!['combine', 'left', 'right', 'substring'].includes(text.operation as string)) return `Unknown text operation "${text.operation}".`;

  if (text.operation === 'combine') {
    if (!Array.isArray(text.parts) || (text.parts as unknown[]).length === 0) return 'Combine requires at least one part.';
    for (let pi = 0; pi < (text.parts as unknown[]).length; pi++) {
      const part = (text.parts as unknown[])[pi] as Record<string, unknown>;
      if (!part || typeof part !== 'object') return `Combine part ${pi + 1} is invalid.`;
      if (!['column', 'number', 'text'].includes(part.type as string)) return `Combine part ${pi + 1} has invalid type "${part.type}".`;
      if (part.type === 'column' && part.value && !cols.has(part.value as string)) return `Combine part ${pi + 1} references unavailable column "${part.value}".`;
    }
  }

  if (['left', 'right'].includes(text.operation as string)) {
    const source = text.source as Record<string, unknown> | undefined;
    if (!source || typeof source !== 'object') return `${text.operation} requires a source.`;
    if (!['column', 'text'].includes(source.type as string)) return `${text.operation} source has invalid type "${source.type}".`;
    if (source.type === 'column' && source.value && !cols.has(source.value as string)) return `${text.operation} source column "${source.value}" is not available.`;
    if (typeof text.count !== 'number' || text.count < 1 || !Number.isFinite(text.count)) return `${text.operation} requires a positive count.`;
  }

  if (text.operation === 'substring') {
    const source = text.source as Record<string, unknown> | undefined;
    if (!source || typeof source !== 'object') return 'Substring requires a source.';
    if (!['column', 'text'].includes(source.type as string)) return `Substring source has invalid type "${source.type}".`;
    if (source.type === 'column' && source.value && !cols.has(source.value as string)) return `Substring source column "${source.value}" is not available.`;
    if (typeof text.start !== 'number' || text.start < 1 || !Number.isFinite(text.start)) return 'Substring requires a positive start position.';
    if (typeof text.length !== 'number' || text.length < 1 || !Number.isFinite(text.length)) return 'Substring requires a positive length.';
  }

  return null;
}

function validateDateMode(ctx: CalcValidatorCtx): string | null {
  const { calc, cols } = ctx;
  const date = calc.date as Record<string, unknown> | undefined;
  if (!date || typeof date !== 'object') return 'Date mode requires a date configuration object.';
  if (date.operation !== 'extract') return `Unknown date operation "${date.operation}".`;

  const source = date.source as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') return 'Date extract requires a source.';
  if (source.type !== 'column') return `Date source has invalid type "${source.type}".`;
  if (!source.value) return 'Date source column is required.';
  if (!cols.has(source.value as string)) return `Date source column "${source.value}" is not available.`;

  const validParts = ['year', 'month', 'day', 'dow', 'week', 'quarter', 'julian'];
  if (!date.part || !validParts.includes(date.part as string)) return `Unknown date part "${date.part}".`;

  return null;
}

const calcModeValidators: Record<CalcMode, (ctx: CalcValidatorCtx) => string | null> = {
  math:    validateMathMode,
  compare: validateCompareMode,
  text:    validateTextMode,
  date:    validateDateMode,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a single calc stage's configuration.
 *
 * Checks structural validity: alias not empty, mode valid, mode-specific
 * fields present and correct, column references exist in projectedCols.
 *
 * @param calc - The calc stage to validate.
 * @param i - Index of this calc stage (used for future error context).
 * @param projectedCols - Column aliases available for reference (base + lookup + prior calcs).
 * @returns Error message string, or null if valid.
 */
export function checkCalcError(calc: CalcStage, i: number, projectedCols: string[]): string | null {
  const alias = (calc.alias || '').trim();
  if (!alias) return 'Provide a label for this calculated column.';

  if (!calc.mode || !['math', 'compare', 'text', 'date'].includes(calc.mode)) {
    return 'Pick a valid calculation type.';
  }

  const cols = new Set(projectedCols);
  const ctx: CalcValidatorCtx = { calc, i, cols, alias };
  return calcModeValidators[calc.mode](ctx);
}
