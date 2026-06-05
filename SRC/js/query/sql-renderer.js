'use strict';

// ── SQL Renderer ──────────────────────────────────────────────────────────────
// Pure SQL string construction.  Receives a QueryPlan (from query-plan.js) and
// produces SQL strings + params arrays.  Does NOT execute queries — that is
// engine.js's responsibility.  May read db.tables for table schema (column
// lists), but never reads db config fields directly.
//
// Exports:
//   renderWhereClause(colRef, op, val, params, opts?)
//   renderAggregateExpr(fn, colRef)
//   renderFromJoinWhere(plan)  → { fromClause, joinClauses, whereParts, params, ref }
//   renderDetailSql(plan)      → { sql, params, cols }
//   renderGroupedSql(plan)     → { sql, params, cols }
//   renderTotalsSql(plan, detailCols)   → { sql, params, cols } | null
//   renderSubtotalsSql(plan)   → { sql, params, cols, displayCols } | null
//
// Backward-compat alias: buildWhere === renderWhereClause

// ── Pure helpers ──────────────────────────────────────────────────────────────

function renderWhereClause(colRef, op, val, params, opts) {
  const likeEsc      = v => v.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const txt          = `CAST(${colRef} AS TEXT)`;
  const num          = `CAST(${colRef} AS REAL)`;
  const numericHint  = !!(opts && opts.numericHint);
  const normVal      = String(val ?? '').trim();
  const numVal       = Number(normVal.replace(/,/g, ''));
  const hasNumericVal = normVal !== '' && Number.isFinite(numVal);

  switch (op) {
    case 'contains':
      params.push('%' + likeEsc(val) + '%');
      return `${txt} LIKE ? ESCAPE '\\'`;
    case 'equals':
      if (numericHint && hasNumericVal) { params.push(numVal); return `${num} = ?`; }
      params.push(val); return `${txt} = ?`;
    case 'not equals':
      if (numericHint && hasNumericVal) { params.push(numVal); return `${num} != ?`; }
      params.push(val); return `${txt} != ?`;
    case '>':   params.push(+val || 0); return `${num} > ?`;
    case '<':   params.push(+val || 0); return `${num} < ?`;
    case '>=':  params.push(+val || 0); return `${num} >= ?`;
    case '<=':  params.push(+val || 0); return `${num} <= ?`;
    case 'starts with': params.push(likeEsc(val) + '%'); return `${txt} LIKE ? ESCAPE '\\'`;
    case 'ends with':   params.push('%' + likeEsc(val)); return `${txt} LIKE ? ESCAPE '\\'`;
    case 'is empty':  return `(${colRef} IS NULL OR ${txt} = '')`;
    case 'not empty': return `(${colRef} IS NOT NULL AND ${txt} != '')`;
    default: return null;
  }
}

// Backward-compat alias (engine.js calls buildWhere).
const buildWhere = renderWhereClause;

// SQL aggregate expression for a given function name and column reference.
function renderAggregateExpr(fn, colRef) {
  switch (fn) {
    case 'SUM':             return `SUM(${colRef})`;
    case 'AVG':             return `AVG(${colRef})`;
    case 'MIN':             return `MIN(${colRef})`;
    case 'MAX':             return `MAX(${colRef})`;
    case 'COUNT ROWS':      return 'COUNT(*)';
    case 'COUNT NON-EMPTY': return `COUNT(${colRef})`;
    case 'COUNT DISTINCT':  return `COUNT(DISTINCT ${colRef})`;
    case 'FIRST':           return `MIN(${colRef})`;
    case 'LAST':            return `MAX(${colRef})`;
    case 'DATE RANGE':      return `MIN(${colRef}) || ' \u2014 ' || MAX(${colRef})`;
    case 'DATE SPAN':       return `CAST(julianday(MAX(${colRef})) - julianday(MIN(${colRef})) AS INTEGER)`;
    case 'NUMERIC RANGE':   return `MIN(${colRef}) || ' \u2013 ' || MAX(${colRef})`;
    case 'NUMERIC SPAN':    return `MAX(${colRef}) - MIN(${colRef})`;
    case 'LIST':            return `GROUP_CONCAT(DISTINCT ${colRef})`;
    default:                return `COUNT(${colRef})`;
  }
}

// ── Recursive calculated-column SQL renderer ─────────────────────────────────
// Generates the SQL expression for a projected column alias.
// Mirrors the calcExpr inner-function in engine.js._buildCombineSQL.

function _renderCalcExpr(alias, colMap, plan, baseTid, _trail) {
  if (!_trail) _trail = new Set();
  if (_trail.has(alias)) return 'NULL';   // cycle guard

  const s = colMap.get(alias);
  if (!s) return quoteId(alias);          // unknown alias — fall back to quoted id

  if (s.kind !== 'calc') {
    // Physical column: route through the correct table alias
    const tid = s.tid === plan.source.base ? baseTid : s.tid;
    return `${tid === '_base' ? '_base' : quoteId(tid)}.${quoteId(s.col)}`;
  }

  const trail = new Set(_trail);
  trail.add(alias);

  const toNum = expr =>
    `CAST(COALESCE(NULLIF(TRIM(CAST(${expr} AS TEXT)), ''), '0') AS REAL)`;

  const leftExpr = _renderCalcExpr(s.left, colMap, plan, baseTid, trail);
  const l        = toNum(leftExpr);

  // Partition clause for window functions
  const partAliases = (
    plan.aggMode === 'subtotals' && (plan.subtotalBy || []).length > 0
      ? plan.subtotalBy
      : plan.aggMode === 'group' && (plan.groupBy || []).length > 0
        ? plan.groupBy
        : []
  ).filter(a => colMap.has(a));

  const partParts   = partAliases.map(a => _renderCalcExpr(a, colMap, plan, baseTid, trail));
  const partClause  = partParts.length ? `PARTITION BY ${partParts.join(', ')}` : '';

  // ORDER BY clause for window functions
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

// ── FROM / JOIN / WHERE ───────────────────────────────────────────────────────
// Builds the structural SQL clauses shared by all query types.
// Returns { fromClause, joinClauses, whereParts, params, ref }.
//   ref(alias) → SQL expression for the alias (physical or calc).

function renderFromJoinWhere(plan) {
  const colMap    = plan.colMap;
  const src       = plan.source;
  const base      = src.base;
  const hasStacks = src.stacks && src.stacks.length > 0;
  const baseTid   = hasStacks ? '_base' : base;

  // Resolve alias to a SQL reference string.
  function ref(alias) {
    const s = colMap.get(alias);
    if (!s) return quoteId(alias);
    if (s.kind === 'calc') return _renderCalcExpr(alias, colMap, plan, baseTid);
    const tid = s.tid === base ? baseTid : s.tid;
    return `${tid === '_base' ? '_base' : quoteId(tid)}.${quoteId(s.col)}`;
  }

  // FROM clause
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

  // JOIN clauses
  const joinClauses = [];
  for (const join of (plan.joins || [])) {
    const jType    = join.required ? 'INNER' : 'LEFT';
    const dupPolicy = join.duplicatePolicy || { mode: 'block' };
    const rightCols = join.rightColumns || [];
    const keyRightCols = new Set(join.keyPairs.map(p => p.right));

    let rightSource;
    if (dupPolicy.mode === 'combine' && rightCols.length > 0) {
      // Combine mode: pre-aggregate value columns with GROUP_CONCAT.
      // Note: SQLite does not support GROUP_CONCAT(DISTINCT col, separator).
      // For unique mode, use a DISTINCT subquery then GROUP_CONCAT with separator.
      const combine = Object.assign({ separator: '; ', unique: true }, dupPolicy.combine || {});
      const aggSeparator = combine.separator === '; ' ? '\"; \"' : `'${combine.separator.replace(/'/g, "''")}'`;
      const valCols = rightCols.filter(c => !keyRightCols.has(c));
      const whereClause = join.keyPairs
        .map(p => `${quoteId(p.right)} IS NOT NULL AND TRIM(${quoteId(p.right)}) != ''`)
        .join(' AND ');
      const groupParts = join.keyPairs.map(p => quoteId(p.right));

      const valExprs = valCols.map(c =>
        `GROUP_CONCAT(${quoteId(c)}, ${aggSeparator}) AS ${quoteId(c)}`
      );
      const keyExprs = join.keyPairs.map(p =>
        `${quoteId(p.right)} AS ${quoteId(p.right)}`
      );

      if (combine.unique) {
        // Deduplicate rows first via DISTINCT subquery, then GROUP_CONCAT
        const allCols = [...join.keyPairs.map(p => quoteId(p.right)), ...valCols.map(c => quoteId(c))];
        const inner = `SELECT DISTINCT ${allCols.join(', ')} FROM ${quoteId(join.rightId)} WHERE ${whereClause}`;
        const outer = `SELECT ${keyExprs.join(', ')}, ${valExprs.join(', ')} FROM (${inner}) GROUP BY ${groupParts.join(', ')}`;
        rightSource = `(${outer}) AS ${quoteId(join.rightId)}`;
      } else {
        const selectParts = [...keyExprs, ...valExprs];
        const subSql = `SELECT ${selectParts.join(', ')} FROM ${quoteId(join.rightId)} WHERE ${whereClause} GROUP BY ${groupParts.join(', ')}`;
        rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
      }
    } else {
      rightSource = quoteId(join.rightId);
    }

    const onParts  = join.keyPairs.map(p => `${ref(p.left)} = ${quoteId(join.rightId)}.${quoteId(p.right)}`);
    if (join.excludedRows && join.excludedRows.size) {
      onParts.push(`${quoteId(join.rightId)}."_rowno" NOT IN (${[...join.excludedRows].join(',')})`);
    }
    joinClauses.push(`${jType} JOIN ${rightSource} ON ${onParts.join(' AND ')}`);
  }

  // WHERE clause parts
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
    // Window functions can't be in WHERE — skip silently
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

// ── renderDetailSql ───────────────────────────────────────────────────────────

function renderDetailSql(plan) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);

  const selParts   = [];
  const colAliases = [];

  for (const alias of plan.selectedColumns) {
    selParts.push(`${ref(alias)} AS ${quoteId(alias)}`);
    colAliases.push(alias);
  }
  if (!selParts.length) selParts.push('*');

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');

  const sortParts = (plan.sorts || []).map(s => `${ref(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`);
  if (sortParts.length) sql += '\nORDER BY ' + sortParts.join(', ');

  return { sql, params, cols: colAliases };
}

// ── renderGroupedSql ──────────────────────────────────────────────────────────

function renderGroupedSql(plan) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
  const hasAgg    = (plan.groupBy || []).length > 0 || (plan.aggregates || []).length > 0;
  const selColSet = plan.selectedColumns.length > 0 ? new Set(plan.selectedColumns) : null;

  const selParts   = [];
  const colAliases = [];
  const groupRefs  = [];

  if (hasAgg) {
    for (const alias of (plan.groupBy || [])) {
      if (selColSet && !selColSet.has(alias)) continue;
      const r = ref(alias);
      selParts.push(`${r} AS ${quoteId(alias)}`);
      groupRefs.push(r);
      colAliases.push(alias);
    }
    for (const agg of (plan.aggregates || [])) {
      const outName = (agg.alias || '').trim() ||
        (typeof defaultAggAlias === 'function'
          ? defaultAggAlias(agg.fn, agg.col && agg.col !== '*' ? agg.col : 'all rows')
          : `${agg.fn}(${agg.col || '*'})`);
      if (selColSet && !selColSet.has(outName)) continue;
      const colRef = agg.col && agg.col !== '*' ? ref(agg.col) : null;
      const expr   = renderAggregateExpr(agg.fn, colRef || '*');
      selParts.push(`${expr} AS ${quoteId(outName)}`);
      colAliases.push(outName);
    }
  } else {
    for (const alias of plan.selectedColumns) {
      selParts.push(`${ref(alias)} AS ${quoteId(alias)}`);
      colAliases.push(alias);
    }
  }

  if (!selParts.length) selParts.push('*');

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');
  if (groupRefs.length)   sql += '\nGROUP BY ' + groupRefs.join(', ');

  const sortParts = (plan.sorts || []).map(s => `${ref(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`);
  if (sortParts.length) sql += '\nORDER BY ' + sortParts.join(', ');

  return { sql, params, cols: colAliases };
}

// ── renderTotalsSql ───────────────────────────────────────────────────────────

function renderTotalsSql(plan, detailCols) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
  const colTotals = plan.colTotals || {};
  const hasAny    = detailCols.some(c => colTotals[c] && colTotals[c] !== 'skip');
  if (!hasAny) return null;

  const selParts = detailCols.map(col => {
    const fn = colTotals[col];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(col)}`;
    return `${renderAggregateExpr(fn, ref(col))} AS ${quoteId(col)}`;
  });

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');

  return { sql, params, cols: detailCols };
}

// ── renderSubtotalsSql ────────────────────────────────────────────────────────

function renderSubtotalsSql(plan) {
  if (!plan.source.base) throw new Error('No base table in plan');
  const colMap = plan.colMap;
  const { fromClause, joinClauses, whereParts, params: filterParams, ref } = renderFromJoinWhere(plan);

  const toShow = plan.selectedColumns;
  if (!toShow.length) return null;

  const subtotalFns   = plan.subtotalFns || {};
  const includeGrand  = plan.subtotalGrandTotal !== false;
  const includeSpacer = !!plan.subtotalSpacer;
  const subtotalOnTop = !!plan.subtotalOnTop;

  // Build canonical subtotalBy: dedup + sort by column order
  const orderIdx = new Map(toShow.map((a, i) => [a, i]));
  const seenSub  = new Set();
  const subtotalBy = (plan.subtotalBy || [])
    .filter(a => orderIdx.has(a) && !seenSub.has(a) && (seenSub.add(a), true))
    .sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity));

  const sortGroupKeys    = subtotalBy.map((_, i) => `_sort_group_${i}`);
  const detailSortType   = subtotalOnTop ? 1 : 0;
  const subtotalSortType = subtotalOnTop ? 0 : 1;

  const subAggExpr = a => {
    const fn  = subtotalFns[a];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(a)}`;
    const src = colMap.get(a);
    if (src?.kind === 'calc' && (src.op === 'ROLLAVG' || src.op === 'PCTTOTAL')) return `NULL AS ${quoteId(a)}`;
    return `${renderAggregateExpr(fn, ref(a))} AS ${quoteId(a)}`;
  };

  const fromPart  = `FROM ${fromClause}`;
  const joinPart  = joinClauses.length ? '\n' + joinClauses.join('\n') : '';
  const wherePart = whereParts.length  ? '\nWHERE ' + whereParts.join('\n  AND ') : '';

  const detailSel = [
    ...toShow.map(a => `${ref(a)} AS ${quoteId(a)}`),
    '0 AS "_row_type"',
    `${detailSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  const subSel = [
    ...toShow.map(a => subtotalBy.includes(a) ? `${ref(a)} AS ${quoteId(a)}` : subAggExpr(a)),
    '1 AS "_row_type"',
    `${subtotalSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');
  const subGroupClause = subtotalBy.map(a => ref(a)).join(', ');

  const grandSel = [
    ...toShow.map(a => subtotalBy.includes(a) ? `NULL AS ${quoteId(a)}` : subAggExpr(a)),
    '3 AS "_row_type"',
    '3 AS "_sort_row_type"',
    ...subtotalBy.map((_, i) => `NULL AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  const spacerSel = [
    ...toShow.map(a => `NULL AS ${quoteId(a)}`),
    '2 AS "_row_type"',
    '2 AS "_sort_row_type"',
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  const orderParts = [
    ...sortGroupKeys.map(k => `${quoteId(k)} ASC NULLS LAST`),
    '"_sort_row_type" ASC',
    ...(plan.sorts || [])
      .filter(s => toShow.includes(s.col) && !subtotalBy.includes(s.col))
      .map(s => `${quoteId(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`),
  ];

  const branches = [`SELECT ${detailSel}\n${fromPart}${joinPart}${wherePart}`];
  if (subtotalBy.length > 0) {
    branches.push(`SELECT ${subSel}\n${fromPart}${joinPart}${wherePart}\nGROUP BY ${subGroupClause}`);
    if (includeSpacer) {
      branches.push(`SELECT ${spacerSel}\n${fromPart}${joinPart}${wherePart}\nGROUP BY ${subGroupClause}`);
    }
  }
  if (includeGrand) {
    branches.push(`SELECT ${grandSel}\n${fromPart}${joinPart}${wherePart}`);
  }

  // Each branch shares the same WHERE params
  const params = Array.from({ length: branches.length }, () => [...filterParams]).flat();

  const sql = branches.join('\nUNION ALL\n') + '\nORDER BY ' + orderParts.join(', ');

  return {
    sql,
    params,
    cols:        [...toShow, '_row_type', '_sort_row_type', ...sortGroupKeys],
    displayCols: toShow,
  };
}
