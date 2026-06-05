'use strict';

function renderFromJoinWhere(plan) {
  const colMap    = plan.colMap;
  const src       = plan.source;
  const base      = src.base;
  const hasStacks = src.stacks && src.stacks.length > 0;
  const baseTid   = hasStacks ? '_base' : base;

  function ref(alias) {
    const s = colMap.get(alias);
    if (!s) return quoteId(alias);
    if (s.kind === 'calc') return _renderCalcExpr(alias, colMap, plan, baseTid);
    const tid = s.tid === base ? baseTid : s.tid;
    return `${tid === '_base' ? '_base' : quoteId(tid)}.${quoteId(s.col)}`;
  }

  let fromClause;
  if (hasStacks) {
    const baseCols = src.baseCols || (src.tablesById && src.tablesById.has(base) ? src.tablesById.get(base).cols : []);
    const allTids  = [base, ...src.stacks];
    const unionParts = allTids
      .filter(tid => src.tablesById && src.tablesById.has(tid))
      .map(tid => {
        const tCols  = src.tablesById.get(tid).cols;
        const selStr = baseCols
          .map(c => tCols.includes(c) ? quoteId(c) : `NULL AS ${quoteId(c)}`)
          .join(', ');
        const excl = src.excludedRows ? src.excludedRows[tid] : null;
        let q = `SELECT ${selStr} FROM ${quoteId(tid)}`;
        if (excl && excl.size) q += ` WHERE "_rowno" NOT IN (${[...excl].join(',')})`;
        return q;
      });
    fromClause = `(\n  ${unionParts.join('\n  UNION ALL\n  ')}\n) AS _base`;
  } else {
    fromClause = quoteId(base);
  }

  const joinClauses = [];
  for (const join of (plan.joins || [])) {
    const jType    = join.required ? 'INNER' : 'LEFT';
    const dupPolicy = join.duplicatePolicy || { mode: 'block' };
    const rightCols = join.rightColumns || [];
    const keyRightCols = new Set(join.keyPairs.map(p => p.right));

    let rightSource;
    let exclInSubquery = false;
    if (dupPolicy.mode === 'combine' && rightCols.length > 0) {
      const combine = Object.assign({ separator: '; ', unique: true, includeBlank: false, sort: false }, dupPolicy.combine || {});
      const aggSeparator = combine.separator === '; ' ? '\"; \"' : `'${combine.separator.replace(/'/g, "''")}'`;
      const valCols = rightCols.filter(c => !keyRightCols.has(c));
      const keyColQuoted = join.keyPairs.map(p => quoteId(p.right));
      const keyColSelects = join.keyPairs.map(p => `${quoteId(p.right)} AS ${quoteId(p.right)}`);
      const whereClause = join.keyPairs
        .map(p => `${quoteId(p.right)} IS NOT NULL AND TRIM(${quoteId(p.right)}) != ''`)
        .join(' AND ');
      const exclClause = join.excludedRows && join.excludedRows.size
        ? ` AND "_rowno" NOT IN (${[...join.excludedRows].join(',')})`
        : '';
      const fullWhere = whereClause + exclClause;

      if (combine.unique) {
        const valSubExprs = valCols.map(c => {
          let colExpr = quoteId(c);
          if (!combine.includeBlank) colExpr = `NULLIF(${colExpr}, '')`;
          const orderClause = combine.sort ? ` ORDER BY ${colExpr}` : '';
          const innerSub = `(SELECT DISTINCT ${keyColQuoted.join(', ')}, ${colExpr} AS ${quoteId(c)} FROM ${quoteId(join.rightId)} WHERE ${fullWhere})`;
          const corrCond = keyColQuoted.map(k => `_inner.${k} = _keys.${k}`).join(' AND ');
          return `(SELECT GROUP_CONCAT(${quoteId(c)}, ${aggSeparator}${orderClause}) FROM ${innerSub} AS _inner WHERE ${corrCond}) AS ${quoteId(c)}`;
        });
        const keyDistinctSub = `(SELECT DISTINCT ${keyColQuoted.join(', ')} FROM ${quoteId(join.rightId)} WHERE ${fullWhere})`;
        const subSql = `SELECT ${keyColSelects.join(', ')}, ${valSubExprs.join(', ')} FROM ${keyDistinctSub} AS _keys`;
        rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
        exclInSubquery = true;
      } else {
        const valExprs = valCols.map(c => {
          let colExpr = quoteId(c);
          if (!combine.includeBlank) colExpr = `NULLIF(${colExpr}, '')`;
          const orderClause = combine.sort ? ` ORDER BY ${quoteId(c)}` : '';
          return `GROUP_CONCAT(${colExpr}, ${aggSeparator}${orderClause}) AS ${quoteId(c)}`;
        });
        const selectParts = [...keyColSelects, ...valExprs];
        const subSql = `SELECT ${selectParts.join(', ')} FROM ${quoteId(join.rightId)} WHERE ${fullWhere} GROUP BY ${keyColQuoted.join(', ')}`;
        rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
        exclInSubquery = true;
      }
    } else {
      rightSource = quoteId(join.rightId);
    }

    const onParts  = join.keyPairs.map(p => `${ref(p.left)} = ${quoteId(join.rightId)}.${quoteId(p.right)}`);
    if (!exclInSubquery && join.excludedRows && join.excludedRows.size) {
      onParts.push(`${quoteId(join.rightId)}."_rowno" NOT IN (${[...join.excludedRows].join(',')})`);
    }
    joinClauses.push(`${jType} JOIN ${rightSource} ON ${onParts.join(' AND ')}`);
  }

  const params     = [];
  const whereParts = [];

  if (!hasStacks && src.excludedRows) {
    const excl = src.excludedRows[base];
    if (excl && excl.size) {
      whereParts.push(`${quoteId(base)}."_rowno" NOT IN (${[...excl].join(',')})`);
    }
  }

  for (const f of (plan.filters || [])) {
    if (!f.col) continue;
    const fs              = colMap.get(f.col);
    const isNumericCalc   = fs?.kind === 'calc' && ['+', '-', '*', '/', 'ROLLAVG', 'PCTTOTAL'].includes(fs.op);
    const isWindowCalc    = fs?.kind === 'calc' && (fs.op === 'ROLLAVG' || fs.op === 'PCTTOTAL');
    if (isWindowCalc) continue;

    const filterVals = Array.isArray(f.vals) ? f.vals : [''];
    const orParts = filterVals
      .map(v => renderWhereClause(ref(f.col), f.op, String(v ?? ''), params, { numericHint: isNumericCalc }))
      .filter(Boolean);
    if (!orParts.length) continue;
    whereParts.push(orParts.length > 1 ? `(${orParts.join(' OR ')})` : orParts[0]);
  }

  return { fromClause, joinClauses, whereParts, params, ref };
}
