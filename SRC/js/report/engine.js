'use strict';

// ── engine.js — Query execution facade ───────────────────────────────────────
// tablePrefix, buildColSourceMap, projectedCols, projectedColsUpToLookup
//   → moved to column-catalog.js (still globally available; load order preserved).
// buildWhere / renderWhereClause
//   → moved to sql-renderer.js (still globally available as buildWhere).

// ── Key-pair helpers ─────────────────────────────────────────────────────────
// Returns the array of {left,right} pairs for a lookup.
function _lkKeyPairs(lk) {
  return Array.isArray(lk.keyPairs) ? lk.keyPairs.filter(p => p.left && p.right) : [];
}

// ── Shared FROM/JOIN/WHERE builder ────────────────────────────────────────────
// Returns { fromClause, joinClauses, whereParts, ref, map }
function _buildCombineSQL(params) {
  const hasStacks  = db.stacks  && db.stacks.some(id => db.tables[id]);
  const hasLookups = db.lookups && db.lookups.some(l => l.rightId && db.tables[l.rightId]);

  const map     = buildColSourceMap();
  const baseTid = hasStacks ? '_base' : db.base;

  const toNum = expr => `CAST(COALESCE(NULLIF(TRIM(CAST(${expr} AS TEXT)), ''), '0') AS REAL)`;

  const calcExpr = (alias, trail = new Set()) => {
    if (trail.has(alias)) return 'NULL';
    const s = map.get(alias);
    if (!s) return quoteId(alias);
    if (s.kind !== 'calc') {
      const tid = s.tid === db.base ? baseTid : s.tid;
      return `${tid === '_base' ? '_base' : quoteId(tid)}.${quoteId(s.col)}`;
    }
    trail.add(alias);
    const leftExpr  = calcExpr(s.left, new Set(trail));
    const l = toNum(leftExpr);

    const partitionAliases = (
      db.aggMode === 'subtotals' && Array.isArray(db.subtotalBy) && db.subtotalBy.length
        ? db.subtotalBy
        : db.aggMode === 'group' && Array.isArray(db.groupBy) && db.groupBy.length
          ? db.groupBy
          : []
    ).filter(a => map.has(a));
    const partitionParts = partitionAliases.map(a => calcExpr(a, new Set(trail)));
    const partitionClause = partitionParts.length ? `PARTITION BY ${partitionParts.join(', ')}` : '';

    const resolvedSortParts = [];
    if (s.explicitOrder && s.orderCol && map.has(s.orderCol)) {
      resolvedSortParts.push(`${calcExpr(s.orderCol, new Set(trail))} ${s.orderDir === 'DESC' ? 'DESC' : 'ASC'}`);
    } else {
      for (const sort of (db.sorts || [])) {
        if (sort.enabled === false || !sort.col || !map.has(sort.col)) continue;
        resolvedSortParts.push(`${calcExpr(sort.col, new Set(trail))} ${sort.dir === 'DESC' ? 'DESC' : 'ASC'}`);
      }
    }
    if (!resolvedSortParts.length) {
      if (baseTid === '_base') resolvedSortParts.push('1');
      else resolvedSortParts.push(`${quoteId(db.base)}."_rowno" ASC`);
    }
    const orderClause = resolvedSortParts.join(', ');

    switch (s.op) {
      case '+': {
        const r = toNum(calcExpr(s.right, new Set(trail)));
        return `(${l} + ${r})`;
      }
      case '-': {
        const r = toNum(calcExpr(s.right, new Set(trail)));
        return `(${l} - ${r})`;
      }
      case '*': {
        const r = toNum(calcExpr(s.right, new Set(trail)));
        return `(${l} * ${r})`;
      }
      case '/': {
        const r = toNum(calcExpr(s.right, new Set(trail)));
        return `(CASE WHEN ${r} = 0 THEN NULL ELSE ${l} / ${r} END)`;
      }
      case 'ROLLAVG': {
        const w = Math.max(1, parseInt(s.window, 10) || 1);
        const overParts = [partitionClause, `ORDER BY ${orderClause}`, `ROWS BETWEEN ${w - 1} PRECEDING AND CURRENT ROW`].filter(Boolean);
        return `AVG(${l}) OVER (${overParts.join(' ')})`;
      }
      case 'PCTTOTAL': {
        const overParts = [partitionClause].filter(Boolean);
        const denom = `SUM(${l}) OVER (${overParts.join(' ')})`;
        return `(CASE WHEN ${denom} = 0 THEN NULL ELSE (${l} / ${denom}) * 100 END)`;
      }
      case 'COMPARE': {
        // Multi-condition compare builder: each condition is { col, op, val }
        const conds = (s.conditions || []).filter(c => c?.col && String(c?.val ?? '').trim());
        if (!conds.length) return 'NULL';
        const glue = s.compareMode === 'OR' ? ' OR ' : ' AND ';
        const parts = conds.map(cond => {
          const colExpr = calcExpr(cond.col, new Set(trail));
          const cNum    = toNum(colExpr);
          const cTxt    = `CAST(${colExpr} AS TEXT)`;
          const compOp  = ['=', '!=', '>', '>=', '<', '<='].includes(cond.op) ? cond.op : '=';
          const cv      = String(cond.val ?? '').trim();
          const cvStripped = cv.replace(/,/g, '');
          const n       = parseFloat(cvStripped);
          if (['>', '>=', '<', '<='].includes(compOp)) {
            return `${cNum} ${compOp} ${Number.isFinite(n) ? n : 0}`;
          }
          // = or !=: numeric if possible, else text
          if (cv !== '' && Number.isFinite(n)) return `${cNum} ${compOp} ${n}`;
          return `${cTxt} ${compOp === '=' ? '=' : '!='} '${cv.replace(/'/g, "''")}'`;
        });
        const sqlLiteral = v => {
          const s = String(v).trim();
          const stripped = s.replace(/,/g, '');
          return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(stripped) ? stripped : `'${s.replace(/'/g, "''")}'`;
        };
        const thenVal = s.customTF && String(s.trueVal ?? '').trim() !== '' ? sqlLiteral(s.trueVal) : '1';
        const elseVal = s.customTF && String(s.falseVal ?? '').trim() !== '' ? sqlLiteral(s.falseVal) : '0';
        return `(CASE WHEN ${parts.join(glue)} THEN ${thenVal} ELSE ${elseVal} END)`;
      }
      default:  return 'NULL';
    }
  };

  const ref = alias => {
    const s = map.get(alias);
    if (!s) return quoteId(alias);
    if (s.kind === 'calc') return calcExpr(alias);
    const tid = s.tid === db.base ? baseTid : s.tid;
    return `${tid === '_base' ? '_base' : quoteId(tid)}.${quoteId(s.col)}`;
  };

  // FROM clause — subquery for stacked tables, plain table otherwise
  let fromClause;
  if (hasStacks) {
    const baseCols = db.baseCols || db.tables[db.base].cols;
    const unionParts = [db.base, ...db.stacks.filter(id => db.tables[id])].map(tid => {
      const tCols  = db.tables[tid].cols;
      const selStr = baseCols.map(c => tCols.includes(c) ? quoteId(c) : `NULL AS ${quoteId(c)}`).join(', ');
      const excl   = db.excludedRows[tid];
      let q = `SELECT ${selStr} FROM ${quoteId(tid)}`;
      if (excl && excl.size) q += ` WHERE "_rowno" NOT IN (${[...excl].join(',')})`;
      return q;
    });
    fromClause = `(\n  ${unionParts.join('\n  UNION ALL\n  ')}\n) AS _base`;
  } else {
    fromClause = quoteId(db.base);
  }

  // JOIN clauses
  const joinClauses = [];
  if (hasLookups) {
    for (const lk of db.lookups) {
      if (lk.enabled === false) continue;
      if (!lk.rightId || !db.tables[lk.rightId]) continue;
      const pairs = _lkKeyPairs(lk);
      if (!pairs.length) continue; // no complete pairs — skip
      const jType = lk.required ? 'INNER' : 'LEFT';
      const onParts = pairs
        .map(p => `${ref(p.left)} = ${quoteId(lk.rightId)}.${quoteId(p.right)}`)
      const excl = db.excludedRows[lk.rightId];
      if (excl && excl.size) {
        onParts.push(`${quoteId(lk.rightId)}."_rowno" NOT IN (${[...excl].join(',')})`);
      }
      const onClause = onParts.join(' AND ');
      joinClauses.push(`${jType} JOIN ${quoteId(lk.rightId)} ON ${onClause}`);
    }
  }

  // WHERE: excluded rows + user filters
  const whereParts = [];
  if (!hasStacks) {
    const excl = db.excludedRows[db.base];
    if (excl && excl.size) whereParts.push(`${quoteId(db.base)}."_rowno" NOT IN (${[...excl].join(',')})`);
  }
  // Side-table exclusions are applied in JOIN ... ON clauses to preserve LEFT JOIN behavior.
  for (const f of db.filters) {
    if (f.enabled === false) continue;
    if (!f.col) continue;
    const fs = map.get(f.col);
    if (fs?.kind === 'calc' && (fs.op === 'ROLLAVG' || fs.op === 'PCTTOTAL')) continue;
    const isNumericCalc = fs?.kind === 'calc' && ['+', '-', '*', '/', 'ROLLAVG', 'PCTTOTAL'].includes(fs.op);
    const filterVals = Array.isArray(f.vals) ? f.vals : [''];
    const orParts = filterVals
      .map(v => buildWhere(ref(f.col), f.op, String(v ?? ''), params, { numericHint: isNumericCalc }))
      .filter(Boolean);
    if (!orParts.length) continue;
    const part = orParts.length > 1 ? `(${orParts.join(' OR ')})` : orParts[0];
    whereParts.push(part);
  }

  return { fromClause, joinClauses, whereParts, ref, map };
}

// ── Main query builder ────────────────────────────────────────────────────────
function buildQuery({ mode = 'group' } = {}) {
  if (!db.base || !db.tables[db.base]) throw new Error('No base table selected');

  const params = [];
  const { fromClause, joinClauses, whereParts, ref, map } = _buildCombineSQL(params);

  const hasAgg     = mode === 'group' && (db.groupBy.length > 0 || db.aggregates.length > 0);
  const selParts   = [];
  const colAliases = [];
  const groupRefs  = [];

  if (hasAgg) {
    const selColsSet = db.selCols instanceof Set ? db.selCols : null;
    for (const alias of db.groupBy) {
      if (selColsSet && !selColsSet.has(alias)) continue;
      const r = ref(alias);
      selParts.push(`${r} AS ${quoteId(alias)}`);
      groupRefs.push(r);
      colAliases.push(alias);
    }
    for (const agg of db.aggregates) {
      const outName0 = agg.alias.trim() || defaultAggAlias(agg.fn, (agg.col && agg.col !== '*') ? colDisplayLabel(agg.col, map) : 'all rows');
      if (selColsSet && !selColsSet.has(outName0)) continue;
      const colLabel = (agg.col && agg.col !== '*') ? colDisplayLabel(agg.col, map) : 'all rows';
      const outName  = agg.alias.trim() || defaultAggAlias(agg.fn, colLabel);
      let expr;
      if (agg.fn === 'COUNT ROWS') {
        expr = 'COUNT(*)';
      } else {
        const r = ref(agg.col);
        switch (agg.fn) {
          case 'SUM':             expr = `SUM(${r})`;                                                              break;
          case 'AVG':             expr = `AVG(${r})`;                                                              break;
          case 'MIN':             expr = `MIN(${r})`;                                                              break;
          case 'MAX':             expr = `MAX(${r})`;                                                              break;
          case 'COUNT NON-EMPTY': expr = `COUNT(${r})`;                                                            break;
          case 'COUNT DISTINCT':  expr = `COUNT(DISTINCT ${r})`;                                                   break;
          case 'FIRST':           expr = `MIN(${r})`;                                                              break;
          case 'LAST':            expr = `MAX(${r})`;                                                              break;
          case 'DATE RANGE':      expr = `MIN(${r}) || ' \u2014 ' || MAX(${r})`;                                 break;
          case 'DATE SPAN':       expr = `CAST(julianday(MAX(${r})) - julianday(MIN(${r})) AS INTEGER)`;          break;
          case 'NUMERIC RANGE':   expr = `MIN(${r}) || ' \u2013 ' || MAX(${r})`;                                 break;
          case 'NUMERIC SPAN':    expr = `MAX(${r}) - MIN(${r})`;                                                  break;
          case 'LIST':            expr = `GROUP_CONCAT(DISTINCT ${r})`;                                            break;
          default:                expr = `COUNT(${r})`;                                                            break;
        }
      }
      selParts.push(`${expr} AS ${quoteId(outName)}`);
      colAliases.push(outName);
    }
  } else {
    const orderedAliases = db.colOrder
      ? db.colOrder.filter(a => map.has(a))
      : [...map.keys()];
    const toShow = db.selCols ? orderedAliases.filter(a => db.selCols.has(a)) : orderedAliases;
    for (const alias of toShow) {
      selParts.push(`${ref(alias)} AS ${quoteId(alias)}`);
      colAliases.push(alias);
    }
  }

  if (!selParts.length) selParts.push('*');

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');
  if (groupRefs.length)   sql += '\nGROUP BY ' + groupRefs.join(', ');

  const sortParts = (db.sorts || [])
    .filter(s => s.enabled !== false && s.col && map.has(s.col))
    .map(s => `${ref(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`);
  if (sortParts.length) sql += '\nORDER BY ' + sortParts.join(', ');

  return { sql, params, cols: colAliases };
}

// ── Totals-only query ─────────────────────────────────────────────────────────
function buildTotalsQuery(detailCols) {
  if (!db.base || !db.tables[db.base]) throw new Error('No base table selected');

  const colTotals = db.colTotals || {};
  const hasAny = detailCols.some(c => colTotals[c] && colTotals[c] !== 'skip');
  if (!hasAny) return null;

  const params = [];
  const { fromClause, joinClauses, whereParts, ref } = _buildCombineSQL(params);

  const selParts = detailCols.map(col => {
    const fn = colTotals[col];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(col)}`;
    const r = ref(col);
    switch (fn) {
      case 'SUM':             return `SUM(${r}) AS ${quoteId(col)}`;
      case 'AVG':             return `AVG(${r}) AS ${quoteId(col)}`;
      case 'MIN':             return `MIN(${r}) AS ${quoteId(col)}`;
      case 'MAX':             return `MAX(${r}) AS ${quoteId(col)}`;
      case 'COUNT ROWS':      return `COUNT(*) AS ${quoteId(col)}`;
      case 'COUNT NON-EMPTY': return `COUNT(${r}) AS ${quoteId(col)}`;
      case 'COUNT DISTINCT':  return `COUNT(DISTINCT ${r}) AS ${quoteId(col)}`;
      case 'LIST':            return `GROUP_CONCAT(DISTINCT ${r}) AS ${quoteId(col)}`;
      default:                return `NULL AS ${quoteId(col)}`;
    }
  });

  let sql = `SELECT ${selParts.join(',\n       ')}\nFROM ${fromClause}`;
  if (joinClauses.length) sql += '\n' + joinClauses.join('\n');
  if (whereParts.length)  sql += '\nWHERE ' + whereParts.join('\n  AND ');

  return { sql, params, cols: detailCols };
}

// ── Subtotals query (Group rows + subtotals mode) ──────────────────────────────
// Returns a UNION ALL query: detail rows ∪ subtotal-per-group rows ∪ grand total.
// Each row has a `_row_type` field: 0=detail, 1=subtotal, 2=grand total.
// `displayCols` is the output cols WITHOUT `_row_type` — pass to renderResults.
function buildSubtotalsQuery() {
  if (!db.base || !db.tables[db.base]) throw new Error('No base table selected');

  const subtotalByRaw     = db.subtotalBy        || [];
  const subtotalFns       = db.subtotalFns        || {};
  const includeGrandTotal = db.subtotalGrandTotal !== false;
  const includeSpacer     = !!db.subtotalSpacer;
  const subtotalOnTop     = !!db.subtotalOnTop;

  // Capture filter bind params for the shared WHERE clause
  const filterParams = [];
  const { fromClause, joinClauses, whereParts, ref, map } = _buildCombineSQL(filterParams);

  const orderedAliases = db.colOrder
    ? db.colOrder.filter(a => map.has(a))
    : [...map.keys()];
  const orderIdx = new Map(orderedAliases.map((a, i) => [a, i]));
  const seenSubtotal = new Set();
  const subtotalBy = subtotalByRaw
    .filter(a => orderIdx.has(a) && !seenSubtotal.has(a) && (seenSubtotal.add(a), true))
    .sort((a, b) => (orderIdx.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b) ?? Number.MAX_SAFE_INTEGER));

  const toShow = db.selCols ? orderedAliases.filter(a => db.selCols.has(a)) : orderedAliases;
  if (!toShow.length) return null;

  const fromPart  = `FROM ${fromClause}`;
  const joinPart  = joinClauses.length ? '\n' + joinClauses.join('\n') : '';
  const wherePart = whereParts.length  ? '\nWHERE ' + whereParts.join('\n  AND ') : '';
  const sortGroupKeys = subtotalBy.map((_, i) => `_sort_group_${i}`);

  // Helper: aggregate expression for a non-group column in subtotal/grand-total rows
  function subAggExpr(a) {
    const fn = subtotalFns[a];
    if (!fn || fn === 'skip') return `NULL AS ${quoteId(a)}`;
    const src = map.get(a);
    if (src?.kind === 'calc' && (src.op === 'ROLLAVG' || src.op === 'PCTTOTAL')) {
      return `NULL AS ${quoteId(a)}`;
    }
    const r = ref(a);
    switch (fn) {
      case 'SUM':             return `SUM(${r}) AS ${quoteId(a)}`;
      case 'AVG':             return `AVG(${r}) AS ${quoteId(a)}`;
      case 'MIN':             return `MIN(${r}) AS ${quoteId(a)}`;
      case 'MAX':             return `MAX(${r}) AS ${quoteId(a)}`;
      case 'COUNT ROWS':      return `COUNT(*) AS ${quoteId(a)}`;
      case 'COUNT NON-EMPTY': return `COUNT(${r}) AS ${quoteId(a)}`;
      case 'COUNT DISTINCT':  return `COUNT(DISTINCT ${r}) AS ${quoteId(a)}`;
      case 'FIRST':           return `MIN(${r}) AS ${quoteId(a)}`;
      case 'LAST':            return `MAX(${r}) AS ${quoteId(a)}`;
      case 'DATE RANGE':      return `MIN(${r}) || ' — ' || MAX(${r}) AS ${quoteId(a)}`;
      case 'DATE SPAN':       return `CAST(julianday(MAX(${r})) - julianday(MIN(${r})) AS INTEGER) AS ${quoteId(a)}`;
      case 'NUMERIC RANGE':   return `MIN(${r}) || ' – ' || MAX(${r}) AS ${quoteId(a)}`;
      case 'NUMERIC SPAN':    return `MAX(${r}) - MIN(${r}) AS ${quoteId(a)}`;
      case 'LIST':            return `GROUP_CONCAT(DISTINCT ${r}) AS ${quoteId(a)}`;
      default:                return `NULL AS ${quoteId(a)}`;
    }
  }

  const detailSortType = subtotalOnTop ? 1 : 0;
  const subtotalSortType = subtotalOnTop ? 0 : 1;

  // Detail rows — all columns, _row_type = 0
  const detailSel = [
    ...toShow.map(a => `${ref(a)} AS ${quoteId(a)}`),
    '0 AS "_row_type"',
    `${detailSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  // Subtotal rows — group keys keep value, others get aggregate, _row_type = 1
  const subSel = [
    ...toShow.map(a => subtotalBy.includes(a) ? `${ref(a)} AS ${quoteId(a)}` : subAggExpr(a)),
    '1 AS "_row_type"',
    `${subtotalSortType} AS "_sort_row_type"`,
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');
  const subGroupClause = subtotalBy.map(a => ref(a)).join(', ');

  // Grand total — group keys are NULL, others get aggregate, _row_type = 3
  const grandSel = [
    ...toShow.map(a => subtotalBy.includes(a) ? `NULL AS ${quoteId(a)}` : subAggExpr(a)),
    '3 AS "_row_type"',
    '3 AS "_sort_row_type"',
    ...subtotalBy.map((_, i) => `NULL AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  // Spacer row — all NULLs, _row_type = 2 (sorts between subtotal=1 and grand total=3)
  const spacerSel = [
    ...toShow.map(a => `NULL AS ${quoteId(a)}`),
    '2 AS "_row_type"',
    '2 AS "_sort_row_type"',
    ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`),
  ].join(',\n       ');

  // ORDER BY (UNION-safe): output columns only.
  // SQLite compound SELECT ORDER BY cannot use table-qualified refs or arbitrary expressions.
  const orderParts = [
    ...sortGroupKeys.map(k => `${quoteId(k)} ASC NULLS LAST`),
    '"_sort_row_type" ASC',
    ...(db.sorts || [])
      .filter(s => s.enabled !== false && s.col && toShow.includes(s.col) && !subtotalBy.includes(s.col))
      .map(s => `${quoteId(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`),
  ];

  // Build UNION ALL branches
  const branches = [`SELECT ${detailSel}\n${fromPart}${joinPart}${wherePart}`];
  if (subtotalBy.length > 0) {
    branches.push(`SELECT ${subSel}\n${fromPart}${joinPart}${wherePart}\nGROUP BY ${subGroupClause}`);
    if (includeSpacer) {
      branches.push(`SELECT ${spacerSel}\n${fromPart}${joinPart}${wherePart}\nGROUP BY ${subGroupClause}`);
    }
  }
  if (includeGrandTotal) {
    branches.push(`SELECT ${grandSel}\n${fromPart}${joinPart}${wherePart}`);
  }

  const sql = branches.join('\nUNION ALL\n') + '\nORDER BY ' + orderParts.join(', ');

  // Repeat filter params for each branch that has a WHERE clause
  const params = Array(branches.length).fill(null).flatMap(() => [...filterParams]);

  return { sql, params, cols: [...toShow, '_row_type', '_sort_row_type', ...sortGroupKeys], displayCols: toShow };
}
// buildWhere → moved to sql-renderer.js; available globally as buildWhere / renderWhereClause.

// ── Execution facade ──────────────────────────────────────────────────────────
// executeReport: high-level entry point for running a report.
// Pipeline: Validation → SourceCatalog → ColumnCatalog → QueryPlan → SQL → ResultSet.
// Returns a ResultSet (see result-set.js: { columns, rows, metadata }).
function executeReport(reportSpec) {
  reportSpec = reportSpec || db;

  // 1. Check validation — throws if blocked.
  const validation = typeof getValidation === 'function' ? getValidation() : null;
  if (validation && validation.reportStatus === 'blocked') {
    const blockingIssues = [];
    if (validation.items) {
      for (const item of Object.values(validation.items)) {
        if (item.blocking) blockingIssues.push(...item.issues);
      }
    }
    const firstMsg = blockingIssues[0] ? blockingIssues[0].message : 'fix blocking issues';
    throw new Error('Report is blocked: ' + firstMsg);
  }

  // 2. Build source catalog — includes imported sheets and published upstream reports.
  const sourceCatalog = typeof buildSourceCatalog === 'function'
    ? buildSourceCatalog()
    : null;

  // 3. Build column catalog using the source catalog.
  const columnCatalog = typeof buildColumnCatalog === 'function'
    ? buildColumnCatalog(reportSpec, sourceCatalog)
    : null;

  // 4. Build query plan (intermediate representation between ReportSpec and SQL).
  const plan = buildQueryPlan(reportSpec, columnCatalog, validation);

  const mode = plan.aggMode;

  // 5. Render SQL, execute, and return a ResultSet.
  if (mode === 'totals') {
    const detail     = renderDetailSql(plan);
    const detailRows = execQuery(detail.sql, detail.params);
    const totals     = renderTotalsSql(plan, detail.cols);

    if (!totals) {
      // No aggregates defined: just return sorted detail rows with no totals row.
      return createResultSet(detail.cols, detailRows, { mode });
    }

    const totalsRows = execQuery(totals.sql, totals.params);
    // Pad detail rows with null for new aggregate-only columns so schema matches totals row.
    const newAggCols = totals.cols.slice(detail.cols.length);
    const paddedRows = newAggCols.length
      ? detailRows.map(r => {
          const row = Object.assign({}, r);
          newAggCols.forEach(c => { row[c] = null; });
          return row;
        })
      : detailRows;
    return createResultSet(totals.cols, paddedRows, { mode, totalsRow: totalsRows[0] || null });
  }

  if (mode === 'subtotals') {
    const result = renderSubtotalsSql(plan);
    if (!result) throw new Error('No output columns configured for subtotals view.');
    const rows = execQuery(result.sql, result.params);
    return createResultSet(result.displayCols, rows, {
      mode,
      hasSubtotals: true,
      allCols: result.cols,
    });
  }

  if (mode === 'group') {
    const { sql, params, cols } = renderGroupedSql(plan);
    const rows = execQuery(sql, params);
    return createResultSet(cols, rows, { mode });
  }

  // Default: plain detail (mode === 'none' or unknown).
  const { sql, params, cols } = renderDetailSql(plan);
  const rows = execQuery(sql, params);
  return createResultSet(cols, rows, { mode: 'none' });
}
