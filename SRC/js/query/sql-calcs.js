import { db } from '../core/state.js';
import { quoteId } from '../core/sqldb.js';

var _toNum = expr =>
  `CAST(COALESCE(NULLIF(TRIM(CAST(${expr} AS TEXT)), ''), '0') AS REAL)`;

export function _renderCalcExpr(alias, colMap, plan, baseTid, _trail) {
  if (!_trail) _trail = new Set();
  if (_trail.has(alias)) return 'NULL';

  const s = colMap.get(alias);
  if (!s) return quoteId(alias);

  if (s.kind !== 'calc') {
    const tid = s.tid === plan.source.base ? baseTid : s.tid;
    return `${tid === '_base' ? '_base' : quoteId(tid)}.${quoteId(s.col)}`;
  }

  const trail = new Set(_trail);
  trail.add(alias);

  // ── New mode-based format ─────────────────────────────────────────────
  if (s.mode) {
    const calc = s.calc || (db.calcStages || [])[s.idx];
    if (!calc) throw new Error(`Cannot render calc "${alias}": calc config not found`);

    if (s.mode === 'math') {
      return _renderModeMath(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s.mode === 'compare') {
      return _renderModeCompare(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s.mode === 'text') {
      return _renderModeText(calc, alias, colMap, plan, baseTid, trail);
    }
    throw new Error(`Unknown calc mode "${s.mode}" for "${alias}"`);
  }

  // ── Old op-based format ───────────────────────────────────────────────
  const toNum = _toNum;

  const leftExpr = _renderCalcExpr(s.left, colMap, plan, baseTid, trail);
  const l        = toNum(leftExpr);

  const partAliases = (
    plan.aggMode === 'subtotals' && (plan.subtotalBy || []).length > 0
      ? plan.subtotalBy
      : plan.aggMode === 'group' && (plan.groupBy || []).length > 0
        ? plan.groupBy
        : []
  ).filter(a => colMap.has(a));

  const partParts   = partAliases.map(a => _renderCalcExpr(a, colMap, plan, baseTid, trail));
  const partClause  = partParts.length ? `PARTITION BY ${partParts.join(', ')}` : '';

  const sortParts = [];
  if (s.explicitOrder && s.orderCol && colMap.has(s.orderCol)) {
    sortParts.push(
      `${_renderCalcExpr(s.orderCol, colMap, plan, baseTid, trail)} ${s.orderDir === 'DESC' ? 'DESC' : 'ASC'}`
    );
  } else {
    for (const sort of (plan.sorts || [])) {
      if (!sort.col || !colMap.has(sort.col)) continue;
      sortParts.push(
        `${_renderCalcExpr(sort.col, colMap, plan, baseTid, trail)} ${sort.dir === 'DESC' ? 'DESC' : 'ASC'}`
      );
    }
  }
  if (!sortParts.length) {
    sortParts.push(
      baseTid === '_base'
        ? '1'
        : `${quoteId(plan.source.base)}."_rowno" ASC`
    );
  }
  const orderClause = sortParts.join(', ');

  switch (s.op) {
    case '+': {
      const r = toNum(_renderCalcExpr(s.right, colMap, plan, baseTid, trail));
      return `(${l} + ${r})`;
    }
    case '-': {
      const r = toNum(_renderCalcExpr(s.right, colMap, plan, baseTid, trail));
      return `(${l} - ${r})`;
    }
    case '*': {
      const r = toNum(_renderCalcExpr(s.right, colMap, plan, baseTid, trail));
      return `(${l} * ${r})`;
    }
    case '/': {
      const r = toNum(_renderCalcExpr(s.right, colMap, plan, baseTid, trail));
      return `(CASE WHEN ${r} = 0 THEN NULL ELSE ${l} / ${r} END)`;
    }
    case 'ROLLAVG': {
      const w = Math.max(1, s.window || 1);
      const overParts = [partClause, `ORDER BY ${orderClause}`, `ROWS BETWEEN ${w - 1} PRECEDING AND CURRENT ROW`].filter(Boolean);
      return `AVG(${l}) OVER (${overParts.join(' ')})`;
    }
    case 'PCTTOTAL': {
      const denom = `SUM(${l}) OVER (${partClause || ''})`;
      return `(CASE WHEN ${denom} = 0 THEN NULL ELSE (${l} / ${denom}) * 100 END)`;
    }
    case 'COMPARE': {
      const conds = (s.conditions || []).filter(c => c?.col && String(c?.val ?? '').trim());
      if (!conds.length) return 'NULL';
      const glue  = s.compareMode === 'OR' ? ' OR ' : ' AND ';
      const parts = conds.map(cond => {
        const colExpr = _renderCalcExpr(cond.col, colMap, plan, baseTid, trail);
        const cNum    = toNum(colExpr);
        const cTxt    = `CAST(${colExpr} AS TEXT)`;
        const compOp  = cond.op;
        if (!['=', '!=', '>', '>=', '<', '<='].includes(compOp)) throw new Error(`Invalid comparison operator "${compOp}" in calculated column`);
        const cv      = String(cond.val ?? '').trim();
        const n       = parseFloat(cv.replace(/,/g, ''));
        if (['>', '>=', '<', '<='].includes(compOp)) return `${cNum} ${compOp} ${Number.isFinite(n) ? n : 0}`;
        if (cv !== '' && Number.isFinite(n)) return `${cNum} ${compOp} ${n}`;
        return `${cTxt} ${compOp === '=' ? '=' : '!='} '${cv.replace(/'/g, "''")}'`;
      });
      const sqlLiteral = v => {
        const s2  = String(v).trim();
        const s2n = s2.replace(/,/g, '');
        return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s2n) ? s2n : `'${s2.replace(/'/g, "''")}'`;
      };
      const thenVal = s.customTF && String(s.trueVal  ?? '').trim() !== '' ? sqlLiteral(s.trueVal)  : '1';
      const elseVal = s.customTF && String(s.falseVal ?? '').trim() !== '' ? sqlLiteral(s.falseVal) : '0';
      return `(CASE WHEN ${parts.join(glue)} THEN ${thenVal} ELSE ${elseVal} END)`;
    }
    default: throw new Error(`Unknown calc operator "${s.op}" for "${alias}"`);
  }
}

// ── Mode-based calc rendering helpers ─────────────────────────────────────────

function _renderModeMath(calc, alias, colMap, plan, baseTid, trail) {
  const math  = calc.math;
  const steps = math.steps;
  const toNum = _toNum;

  const renderStepVal = (step, t) => {
    if (step.type === 'number') {
      const n = parseFloat(step.value);
      return Number.isFinite(n) ? String(n) : '0';
    }
    if (step.type === 'column') {
      const expr = _renderCalcExpr(step.value, colMap, plan, baseTid, t);
      return toNum(expr);
    }
    throw new Error(`Unsupported math step type "${step.type}" in calc "${alias}"`);
  };

  let expr = renderStepVal(steps[0], trail);
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    const r    = renderStepVal(step, trail);
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

function _renderModeCompare(calc, alias, colMap, plan, baseTid, trail) {
  const compare = calc.compare;
  const glue    = compare.compareMode === 'OR' ? ' OR ' : ' AND ';
  const toNum   = _toNum;

  const condParts = compare.conditions.map(cond => {
    const colExpr = _renderCalcExpr(cond.col, colMap, plan, baseTid, trail);
    const op      = cond.op;
    if (!['=', '!=', '>', '>=', '<', '<='].includes(op)) {
      throw new Error(`Invalid comparison operator "${op}" in calc "${alias}"`);
    }
    const cv  = String(cond.val ?? '').trim();
    const n   = parseFloat(cv.replace(/,/g, ''));
    const cNum = toNum(colExpr);
    const cTxt = `CAST(${colExpr} AS TEXT)`;
    if (['>', '>=', '<', '<='].includes(op)) return `${cNum} ${op} ${Number.isFinite(n) ? n : 0}`;
    if (cv !== '' && Number.isFinite(n)) return `${cNum} ${op} ${n}`;
    return `${cTxt} ${op === '=' ? '=' : '!='} '${cv.replace(/'/g, "''")}'`;
  });

  const thenExpr = _renderTypedValue(compare.trueValue, colMap, plan, baseTid, trail);
  const elseExpr = _renderTypedValue(compare.falseValue, colMap, plan, baseTid, trail);
  return `(CASE WHEN ${condParts.join(glue)} THEN ${thenExpr} ELSE ${elseExpr} END)`;
}

function _renderModeText(calc, alias, colMap, plan, baseTid, trail) {
  const text = calc.text;
  const op   = text.operation;

  if (op === 'combine') {
    const parts = text.parts.map(p => _renderTextPart(p, colMap, plan, baseTid, trail));
    return parts.join(' || ');
  }
  if (op === 'left') {
    const src = _renderTextSource(text.source, colMap, plan, baseTid, trail);
    return `SUBSTR(${src}, 1, ${text.count})`;
  }
  if (op === 'right') {
    const src = _renderTextSource(text.source, colMap, plan, baseTid, trail);
    return `SUBSTR(${src}, -${text.count})`;
  }
  if (op === 'substring') {
    const src = _renderTextSource(text.source, colMap, plan, baseTid, trail);
    return `SUBSTR(${src}, ${text.start}, ${text.length})`;
  }
  throw new Error(`Unknown text operation "${op}" in calc "${alias}"`);
}

function _renderTypedValue(tv, colMap, plan, baseTid, trail) {
  if (tv.type === 'text') return `'${String(tv.value).replace(/'/g, "''")}'`;
  if (tv.type === 'number') return String(Number(tv.value));
  if (tv.type === 'column') return _renderCalcExpr(tv.value, colMap, plan, baseTid, trail);
  throw new Error(`Unsupported typed-value type "${tv.type}"`);
}

function _renderTextPart(part, colMap, plan, baseTid, trail) {
  if (part.type === 'text') return `'${String(part.value).replace(/'/g, "''")}'`;
  if (part.type === 'number') return `CAST(${Number(part.value)} AS TEXT)`;
  if (part.type === 'column') {
    const expr = _renderCalcExpr(part.value, colMap, plan, baseTid, trail);
    return `COALESCE(CAST(${expr} AS TEXT), '')`;
  }
  throw new Error(`Unsupported text part type "${part.type}"`);
}

function _renderTextSource(source, colMap, plan, baseTid, trail) {
  if (source.type === 'text') return `'${String(source.value).replace(/'/g, "''")}'`;
  if (source.type === 'column') return _renderCalcExpr(source.value, colMap, plan, baseTid, trail);
  throw new Error(`Unsupported text source type "${source.type}"`);
}
