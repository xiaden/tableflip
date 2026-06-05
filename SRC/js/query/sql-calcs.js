'use strict';

function _renderCalcExpr(alias, colMap, plan, baseTid, _trail) {
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

  const toNum = expr =>
    `CAST(COALESCE(NULLIF(TRIM(CAST(${expr} AS TEXT)), ''), '0') AS REAL)`;

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
        const compOp  = ['=', '!=', '>', '>=', '<', '<='].includes(cond.op) ? cond.op : '=';
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
    default: return 'NULL';
  }
}
