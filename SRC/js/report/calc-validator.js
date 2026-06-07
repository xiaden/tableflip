import { db } from '../core/state.js';
import { projectedCols, buildColSourceMap } from '../catalog/column-catalog.js';

// ── Calc Validator ──────────────────────────────────────────────────────────────
// Validates a single calculated-column stage config.
// Returns a human-readable error string, or null if the calc is valid.

export function checkCalcError(calc, i) {
  const alias = (calc.alias || '').trim();
  if (!alias) return 'Provide a label for this calculated column.';

  // ── New mode-based format ──────────────────────────────────────────────
  if (calc.mode && ['math', 'compare', 'text'].includes(calc.mode)) {
    return _checkNewModeCalcError(calc, alias, i);
  }

  // ── Old op-based format ────────────────────────────────────────────────
  const op = calc.op;
  const isArithmetic = ['+', '-', '*', '/'].includes(op);
  const isRolling    = op === 'ROLLAVG';
  const isPctTotal   = op === 'PCTTOTAL';
  const isCompare    = op === 'COMPARE';
  if (!isArithmetic && !isRolling && !isPctTotal && !isCompare) return 'Pick a valid operator.';
  if ((isRolling || isPctTotal) && (db.aggMode || 'none') === 'group') {
    return 'Rolling Avg and % of Total are available in detail/totals/subtotals modes (not summarize mode).';
  }

  if (isCompare) {
    const conditions = Array.isArray(calc.conditions) ? calc.conditions : [];
    if (!conditions.length) return 'Add at least one comparison condition.';
    const cols = new Set(projectedCols());
    for (let ci = 0; ci < conditions.length; ci++) {
      const cond = conditions[ci];
      if (!cond.col) return `Pick a column for condition ${ci + 1}.`;
      if (!cols.has(cond.col)) return `Column for condition ${ci + 1} is no longer available.`;
      if (!['=', '!=', '>', '>=', '<', '<='].includes(cond.op)) return `Pick a valid operator for condition ${ci + 1}.`;
      if (!String(cond.val ?? '').trim()) return `Enter a value for condition ${ci + 1}.`;
      if (cond.col === alias) return 'A condition column cannot reference the output column itself.';
    }
  } else {
    if (!calc.left) return 'Pick a source column.';
    if (isArithmetic && !calc.right) return 'Pick the second source column.';
    if (isRolling) {
      const w = Math.max(1, parseInt(calc.window, 10) || 0);
      if (!Number.isFinite(w) || w < 1) return 'Rolling average window must be 1 or greater.';
      if (calc.explicitOrder && !calc.orderCol) return 'Pick an order-by column for explicit order mode.';
    }

    const cols = new Set(projectedCols());
    if (!cols.has(calc.left) || (isArithmetic && !cols.has(calc.right))) {
      return 'One or more source columns are no longer available (sheet removed or stage changed).';
    }
    if (isRolling && calc.explicitOrder && calc.orderCol && !cols.has(calc.orderCol)) {
      return 'Order-by column is no longer available.';
    }
    if (calc.left === alias || (isArithmetic && calc.right === alias) || (isRolling && calc.orderCol === alias)) {
      return 'A column cannot reference itself.';
    }
  }

  // Alias conflicts with existing non-calc columns or duplicates another calc alias.
  const map = buildColSourceMap();
  const src = map.get(alias);
  if (src && src.kind !== 'calc') {
    return 'Label conflicts with an existing column name.';
  }
  const duplicates = (db.calcStages || []).filter((c, idx) => idx !== i && (c.alias || '').trim() === alias);
  if (duplicates.length) return 'Label must be unique across calculated columns.';

  return null;
}

function _checkNewModeCalcError(calc, alias, i) {
  const cols = new Set(projectedCols());

  if (calc.mode === 'math') {
    const math = calc.math;
    if (!math || typeof math !== 'object') return 'Math mode requires a math configuration object.';
    if (math.strategy !== 'stepChain') return 'Math mode requires strategy "stepChain".';
    if (!Array.isArray(math.steps) || math.steps.length === 0) return 'Math mode requires at least one step.';
    for (let si = 0; si < math.steps.length; si++) {
      const step = math.steps[si];
      if (!step || typeof step !== 'object') return `Step ${si + 1} is invalid.`;
      if (si === 0 && step.op) return 'The first math step must not have an operator.';
      if (si > 0 && (!step.op || !['+', '-', '*', '/', '%'].includes(step.op))) return `Step ${si + 1} has an invalid operator "${step.op}".`;
      if (!['column', 'number', 'text'].includes(step.type)) return `Step ${si + 1} has an invalid type "${step.type}".`;
      if (step.type === 'number' && step.value !== '' && isNaN(Number(step.value))) return `Step ${si + 1} has a non-numeric value "${step.value}".`;
      if (step.type === 'column' && step.value && !cols.has(step.value)) return `Step ${si + 1} references unavailable column "${step.value}".`;
    }
    if (alias) {
      for (const step of math.steps) {
        if (step.type === 'column' && step.value === alias) return 'A column cannot reference itself.';
      }
    }
  }

  if (calc.mode === 'compare') {
    const compare = calc.compare;
    if (!compare || typeof compare !== 'object') return 'Compare mode requires a compare configuration object.';
    if (!['AND', 'OR'].includes(compare.compareMode)) return 'Compare mode must use AND or OR.';
    if (!Array.isArray(compare.conditions) || compare.conditions.length === 0) return 'Compare mode requires at least one condition.';
    for (let ci = 0; ci < compare.conditions.length; ci++) {
      const cond = compare.conditions[ci];
      if (!cond || typeof cond !== 'object') return `Condition ${ci + 1} is invalid.`;
      if (!cond.col) return `Pick a column for condition ${ci + 1}.`;
      if (!['=', '!=', '>', '>=', '<', '<='].includes(cond.op)) return `Pick a valid operator for condition ${ci + 1}.`;
      if (!cols.has(cond.col)) return `Column for condition ${ci + 1} is no longer available.`;
      if (!String(cond.val ?? '').trim()) return `Enter a value for condition ${ci + 1}.`;
      if (cond.col === alias) return 'A condition column cannot reference the output column itself.';
    }
    for (const key of ['trueValue', 'falseValue']) {
      const tv = compare[key];
      if (!tv || typeof tv !== 'object') return `Compare ${key} is required.`;
      if (!['column', 'number', 'text'].includes(tv.type)) return `Compare ${key} has invalid type "${tv.type}".`;
      if (tv.type === 'column' && tv.value && !cols.has(tv.value)) return `Compare ${key} column "${tv.value}" is not available.`;
    }
  }

  if (calc.mode === 'text') {
    const text = calc.text;
    if (!text || typeof text !== 'object') return 'Text mode requires a text configuration object.';
    if (!['combine', 'left', 'right', 'substring'].includes(text.operation)) return `Unknown text operation "${text.operation}".`;

    if (text.operation === 'combine') {
      if (!Array.isArray(text.parts) || text.parts.length === 0) return 'Combine requires at least one part.';
      for (let pi = 0; pi < text.parts.length; pi++) {
        const part = text.parts[pi];
        if (!part || typeof part !== 'object') return `Combine part ${pi + 1} is invalid.`;
        if (!['column', 'number', 'text'].includes(part.type)) return `Combine part ${pi + 1} has invalid type "${part.type}".`;
        if (part.type === 'column' && part.value && !cols.has(part.value)) return `Combine part ${pi + 1} references unavailable column "${part.value}".`;
      }
    }

    if (['left', 'right'].includes(text.operation)) {
      if (!text.source || typeof text.source !== 'object') return `${text.operation} requires a source.`;
      if (!['column', 'text'].includes(text.source.type)) return `${text.operation} source has invalid type "${text.source.type}".`;
      if (text.source.type === 'column' && text.source.value && !cols.has(text.source.value)) return `${text.operation} source column "${text.source.value}" is not available.`;
      if (typeof text.count !== 'number' || text.count < 1 || !Number.isFinite(text.count)) return `${text.operation} requires a positive count.`;
    }

    if (text.operation === 'substring') {
      if (!text.source || typeof text.source !== 'object') return 'Substring requires a source.';
      if (!['column', 'text'].includes(text.source.type)) return `Substring source has invalid type "${text.source.type}".`;
      if (text.source.type === 'column' && text.source.value && !cols.has(text.source.value)) return `Substring source column "${text.source.value}" is not available.`;
      if (typeof text.start !== 'number' || text.start < 1 || !Number.isFinite(text.start)) return 'Substring requires a positive start position.';
      if (typeof text.length !== 'number' || text.length < 1 || !Number.isFinite(text.length)) return 'Substring requires a positive length.';
    }
  }

  // Alias conflicts
  const map = buildColSourceMap();
  const src = map.get(alias);
  if (src && src.kind !== 'calc') return 'Label conflicts with an existing column name.';
  const duplicates = (db.calcStages || []).filter((c, idx) => idx !== i && (c.alias || '').trim() === alias);
  if (duplicates.length) return 'Label must be unique across calculated columns.';

  return null;
}
