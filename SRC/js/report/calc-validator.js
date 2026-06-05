'use strict';

// ── Calc Validator ──────────────────────────────────────────────────────────────
// Validates a single calculated-column stage config.
// Returns a human-readable error string, or null if the calc is valid.

function checkCalcError(calc, i) {
  const alias = (calc.alias || '').trim();
  if (!alias) return 'Provide a label for this calculated column.';
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
