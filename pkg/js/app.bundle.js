"use strict";
(() => {
  // js/core/state.ts
  var db = {
    tables: {},
    // id → { id, name, cols, rowCount }
    excludedRows: {},
    // id → Set<rowno>
    tableColors: {},
    // id → hex color from palette
    columnLabels: {},
    // id → { physCol → customLabel }
    base: "",
    baseCols: null,
    // null = all columns; array = selected subset from base sheet
    stacks: [],
    // tableIds to UNION ALL with base (same structure)
    lookups: [],
    // [{ rightId, keyPairs:[{left,right}], cols:[], required:false }]
    calcStages: [],
    // [{ alias, left, op, right, conditions, compareMode, window, explicitOrder, orderCol, orderDir }]
    selCols: null,
    colOrder: null,
    filters: [],
    groupBy: [],
    aggregates: [],
    aggMode: "none",
    aggModeState: null,
    // per-mode layout settings snapshot
    colTotals: {},
    subtotalBy: [],
    subtotalFns: {},
    subtotalGrandTotal: true,
    subtotalSpacer: false,
    subtotalOnTop: false,
    subtotalStrategy: "combined",
    mergedCols: [],
    mergeGroupUnderline: false,
    colState: null,
    sorts: [],
    result: null
  };
  if (typeof window !== "undefined") window.db = db;

  // js/catalog/column-catalog.ts
  function tablePrefix(name) {
    return name.split("\u2014").pop().trim().replace(/[^A-Za-z0-9_]/g, "_") + "__";
  }
  function buildColSourceMap(ctx) {
    ctx = ctx || db;
    const base = ctx.base;
    const lookups = ctx.lookups;
    const calcStages = ctx.calcStages;
    const map = /* @__PURE__ */ new Map();
    if (!base || !db.tables[base]) return map;
    db.tables[base].cols.forEach((c2) => map.set(c2, { tid: base, col: c2 }));
    for (const lk of lookups || []) {
      if (lk.enabled === false) continue;
      if (!lk.rightId || !db.tables[lk.rightId]) continue;
      const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p2) => p2.left && p2.right) : [];
      if (!pairs.length) continue;
      const rt = db.tables[lk.rightId];
      const prefix = tablePrefix(rt.name);
      rt.cols.forEach((c2) => {
        const alias = map.has(c2) ? prefix + c2 : c2;
        if (!map.has(alias)) map.set(alias, { tid: lk.rightId, col: c2 });
      });
    }
    for (const [i2, calc] of (calcStages || []).entries()) {
      if (calc?.enabled === false) continue;
      const alias = (calc?.alias || "").trim();
      if (!alias) continue;
      if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) continue;
      let valid = false;
      if (calc.mode === "math") {
        const m2 = calc.math;
        const steps = m2 && Array.isArray(m2.steps) ? m2.steps : [];
        const structValid = !!(m2 && m2.strategy === "stepChain" && steps.length > 0 && !steps[0].op && steps.every((s2) => s2 && ["column", "number", "text"].includes(s2.type)) && steps.slice(1).every((s2) => s2.op && ["+", "-", "*", "/", "%"].includes(s2.op)));
        const colsExist = structValid && steps.filter((s2) => s2.type === "column" && s2.value).every((s2) => map.has(s2.value));
        valid = structValid && colsExist;
      } else if (calc.mode === "compare") {
        const c2 = calc.compare;
        const conds = Array.isArray(c2?.conditions) ? c2.conditions : [];
        valid = !!(c2 && conds.length > 0 && c2.trueValue && c2.falseValue && conds.every((cond) => cond.col && ["=", "!=", ">", ">=", "<", "<="].includes(cond.op)) && conds.some((cond) => map.has(cond.col)) && ["column", "number", "text"].includes(c2.trueValue.type) && ["column", "number", "text"].includes(c2.falseValue.type));
      } else if (calc.mode === "text") {
        const t2 = calc.text;
        if (t2 && ["combine", "left", "right", "substring"].includes(t2.operation)) {
          if (t2.operation === "combine") {
            const parts = Array.isArray(t2.parts) ? t2.parts : [];
            const structValid = parts.length > 0 && parts.every((p2) => p2 && ["column", "number", "text"].includes(p2.type));
            const colsExist = structValid && parts.filter((p2) => p2.type === "column" && p2.value).every((p2) => map.has(p2.value));
            valid = structValid && colsExist;
          } else {
            const src = t2.source;
            const structValid = !!(src && ["column", "text"].includes(src.type));
            const colExists = structValid && src.type !== "column" ? true : map.has(src.value);
            valid = structValid && colExists;
          }
        }
      } else if (calc.mode === "date") {
        const d2 = calc.date;
        if (d2 && d2.operation === "extract") {
          const src = d2.source;
          const structValid = !!(src && src.type === "column");
          const colExists = structValid && map.has(src.value);
          valid = structValid && colExists && ["year", "month", "day", "dow", "week", "quarter", "julian"].includes(d2.part);
        }
      }
      if (!valid) continue;
      if (map.has(alias)) continue;
      map.set(alias, { kind: "calc", mode: calc.mode, idx: i2, calc });
    }
    return map;
  }
  function projectedCols(ctx) {
    return [...buildColSourceMap(ctx).keys()];
  }
  function projectedColsUpToLookup(upTo, ctx) {
    ctx = ctx || db;
    const base = ctx.base;
    const lookups = ctx.lookups;
    if (!base || !db.tables[base]) return [];
    const cols = [...db.tables[base].cols];
    const colSet = new Set(cols);
    for (let i2 = 0; i2 < upTo; i2++) {
      const lk = (lookups || [])[i2];
      if (!lk || lk.enabled === false || !lk.rightId || !db.tables[lk.rightId]) continue;
      const rt = db.tables[lk.rightId];
      const prefix = tablePrefix(rt.name);
      rt.cols.forEach((c2) => {
        const alias = colSet.has(c2) ? prefix + c2 : c2;
        if (!colSet.has(alias)) {
          cols.push(alias);
          colSet.add(alias);
        }
      });
    }
    return cols;
  }
  function buildColumnCatalog(reportSpec, sourceCatalog) {
    reportSpec = reportSpec || db;
    if (!(sourceCatalog instanceof Map)) {
      throw new Error("buildColumnCatalog: sourceCatalog (Map) is required");
    }
    const base = reportSpec.base;
    const lookups = reportSpec.lookups || [];
    const calcStages = reportSpec.calcStages || [];
    function tableColumns(tid) {
      const entry = sourceCatalog.get(tid);
      return entry ? entry.cols ?? null : null;
    }
    function tableName(tid) {
      const entry = sourceCatalog.get(tid);
      return entry ? entry.name ?? tid : tid;
    }
    const colMap = /* @__PURE__ */ new Map();
    const baseCols = base ? tableColumns(base) : null;
    if (baseCols) {
      baseCols.forEach((c2) => colMap.set(c2, { tid: base, col: c2 }));
    }
    const lookupBoundaries = [new Map(colMap)];
    for (const lk of lookups) {
      if (lk.enabled === false || !lk.rightId) {
        lookupBoundaries.push(new Map(colMap));
        continue;
      }
      const rtCols = tableColumns(lk.rightId);
      if (!rtCols) {
        lookupBoundaries.push(new Map(colMap));
        continue;
      }
      const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p2) => p2.left && p2.right) : [];
      if (!pairs.length) {
        lookupBoundaries.push(new Map(colMap));
        continue;
      }
      const rName = tableName(lk.rightId);
      const prefix = tablePrefix(rName);
      rtCols.forEach((c2) => {
        const alias = colMap.has(c2) ? prefix + c2 : c2;
        if (!colMap.has(alias)) colMap.set(alias, { tid: lk.rightId, col: c2 });
      });
      lookupBoundaries.push(new Map(colMap));
    }
    for (const [i2, calc] of calcStages.entries()) {
      if (calc?.enabled === false) continue;
      const alias = (calc?.alias || "").trim();
      if (!alias) continue;
      if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) continue;
      let valid = false;
      if (calc.mode === "math") {
        const m2 = calc.math;
        const steps = m2 && Array.isArray(m2.steps) ? m2.steps : [];
        const structValid = !!(m2 && m2.strategy === "stepChain" && steps.length > 0 && !steps[0].op && steps.every((s2) => s2 && ["column", "number", "text"].includes(s2.type)) && steps.slice(1).every((s2) => s2.op && ["+", "-", "*", "/", "%"].includes(s2.op)));
        const colsExist = structValid && steps.filter((s2) => s2.type === "column" && s2.value).every((s2) => colMap.has(s2.value));
        valid = structValid && colsExist;
      } else if (calc.mode === "compare") {
        const c2 = calc.compare;
        const conds = Array.isArray(c2?.conditions) ? c2.conditions : [];
        valid = !!(c2 && conds.length > 0 && c2.trueValue && c2.falseValue && conds.every((cond) => cond.col && ["=", "!=", ">", ">=", "<", "<="].includes(cond.op)) && conds.some((cond) => colMap.has(cond.col)) && ["column", "number", "text"].includes(c2.trueValue.type) && ["column", "number", "text"].includes(c2.falseValue.type));
      } else if (calc.mode === "text") {
        const t2 = calc.text;
        if (t2 && ["combine", "left", "right", "substring"].includes(t2.operation)) {
          if (t2.operation === "combine") {
            const parts = Array.isArray(t2.parts) ? t2.parts : [];
            const structValid = parts.length > 0 && parts.every((p2) => p2 && ["column", "number", "text"].includes(p2.type));
            const colsExist = structValid && parts.filter((p2) => p2.type === "column" && p2.value).every((p2) => colMap.has(p2.value));
            valid = structValid && colsExist;
          } else {
            const src = t2.source;
            const structValid = !!(src && ["column", "text"].includes(src.type));
            const colExists = structValid && src.type !== "column" ? true : colMap.has(src.value);
            valid = structValid && colExists;
          }
        }
      } else if (calc.mode === "date") {
        const d2 = calc.date;
        if (d2 && d2.operation === "extract") {
          const src = d2.source;
          const structValid = !!(src && src.type === "column");
          const colExists = structValid && colMap.has(src.value);
          valid = structValid && colExists && ["year", "month", "day", "dow", "week", "quarter", "julian"].includes(d2.part);
        }
      }
      if (!valid) continue;
      if (colMap.has(alias)) continue;
      colMap.set(alias, { kind: "calc", mode: calc.mode, idx: i2, calc });
    }
    return { colMap, lookupBoundaries, reportSpec };
  }

  // js/query/alias-ref-updater.ts
  function _renameProjectedAliasRefs(oldAlias, newAlias) {
    if (!oldAlias || !newAlias || oldAlias === newAlias) return;
    if (Array.isArray(db.colOrder)) {
      const idx = db.colOrder.indexOf(oldAlias);
      if (idx >= 0) {
        if (!db.colOrder.includes(newAlias)) db.colOrder[idx] = newAlias;
        else db.colOrder.splice(idx, 1);
      }
    }
    const selCols = db.selCols;
    if (selCols instanceof Set && selCols.has(oldAlias)) {
      selCols.delete(oldAlias);
      selCols.add(newAlias);
    }
    const replaceInArray = (arr) => {
      if (!Array.isArray(arr)) return;
      for (let i2 = 0; i2 < arr.length; i2++) {
        if (arr[i2] === oldAlias) arr[i2] = newAlias;
      }
    };
    replaceInArray(db.groupBy);
    replaceInArray(db.subtotalBy);
    replaceInArray(db.mergedCols);
    for (const a2 of db.aggregates || []) {
      if (a2.col === oldAlias) a2.col = newAlias;
    }
    for (const f2 of db.filters || []) {
      if (f2.col === oldAlias) f2.col = newAlias;
    }
    for (const s2 of db.sorts || []) {
      if (s2.col === oldAlias) s2.col = newAlias;
    }
    for (const c2 of db.calcStages || []) {
      if (c2.mode === "math" && c2.math && typeof c2.math === "object") {
        const math = c2.math;
        if (Array.isArray(math.steps)) {
          for (const step of math.steps) {
            if (step.type === "column" && step.value === oldAlias) step.value = newAlias;
          }
        }
      }
      if (c2.mode === "compare" && c2.compare && typeof c2.compare === "object") {
        const compare = c2.compare;
        if (Array.isArray(compare.conditions)) {
          for (const cond of compare.conditions) {
            if (cond.col === oldAlias) cond.col = newAlias;
          }
        }
        if (compare.trueValue?.type === "column" && compare.trueValue.value === oldAlias) {
          compare.trueValue.value = newAlias;
        }
        if (compare.falseValue?.type === "column" && compare.falseValue.value === oldAlias) {
          compare.falseValue.value = newAlias;
        }
      }
      if (c2.mode === "text" && c2.text && typeof c2.text === "object") {
        const text = c2.text;
        if (Array.isArray(text.parts)) {
          for (const part of text.parts) {
            if (part.type === "column" && part.value === oldAlias) part.value = newAlias;
          }
        }
        if (text.source?.type === "column" && text.source.value === oldAlias) {
          text.source.value = newAlias;
        }
      }
    }
    if (db.colTotals && Object.prototype.hasOwnProperty.call(db.colTotals, oldAlias)) {
      if (!Object.prototype.hasOwnProperty.call(db.colTotals, newAlias)) {
        db.colTotals[newAlias] = db.colTotals[oldAlias];
      }
      delete db.colTotals[oldAlias];
    }
    if (db.subtotalFns && Object.prototype.hasOwnProperty.call(db.subtotalFns, oldAlias)) {
      if (!Object.prototype.hasOwnProperty.call(db.subtotalFns, newAlias)) {
        db.subtotalFns[newAlias] = db.subtotalFns[oldAlias];
      }
      delete db.subtotalFns[oldAlias];
    }
    const as = db.aggModeState;
    if (as && typeof as === "object") {
      const replaceInSel = (state) => {
        if (!state || !Array.isArray(state.selCols)) return;
        const sel = state.selCols;
        for (let i2 = 0; i2 < sel.length; i2++) {
          if (sel[i2] === oldAlias) sel[i2] = newAlias;
        }
      };
      replaceInSel(as.none);
      replaceInSel(as.totals);
      replaceInSel(as.subtotals);
      const groupState = as.group;
      if (groupState && Array.isArray(groupState.groupBy)) {
        const gb = groupState.groupBy;
        for (let i2 = 0; i2 < gb.length; i2++) {
          if (gb[i2] === oldAlias) gb[i2] = newAlias;
        }
      }
      if (groupState && Array.isArray(groupState.aggregates)) {
        for (const a2 of groupState.aggregates) {
          if (a2 && a2.col === oldAlias) a2.col = newAlias;
        }
      }
      const totalsState = as.totals;
      if (totalsState?.colTotals && typeof totalsState.colTotals === "object") {
        const ct = totalsState.colTotals;
        if (Object.prototype.hasOwnProperty.call(ct, oldAlias)) {
          if (!Object.prototype.hasOwnProperty.call(ct, newAlias)) {
            ct[newAlias] = ct[oldAlias];
          }
          delete ct[oldAlias];
        }
      }
      const subtotalsState = as.subtotals;
      if (subtotalsState && Array.isArray(subtotalsState.subtotalBy)) {
        const sb = subtotalsState.subtotalBy;
        for (let i2 = 0; i2 < sb.length; i2++) {
          if (sb[i2] === oldAlias) sb[i2] = newAlias;
        }
      }
      if (subtotalsState?.subtotalFns && typeof subtotalsState.subtotalFns === "object") {
        const sf = subtotalsState.subtotalFns;
        if (Object.prototype.hasOwnProperty.call(sf, oldAlias)) {
          if (!Object.prototype.hasOwnProperty.call(sf, newAlias)) {
            sf[newAlias] = sf[oldAlias];
          }
          delete sf[oldAlias];
        }
      }
    }
  }

  // js/core/utils.ts
  function h(s2) {
    return String(s2 ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function stripExt(fn) {
    return fn.replace(/\.[^.]+$/, "");
  }
  function dl(blob, name) {
    const url = URL.createObjectURL(blob);
    const a2 = Object.assign(document.createElement("a"), { href: url, download: name });
    a2.click();
    URL.revokeObjectURL(url);
  }
  function getToastContainer() {
    let c2 = document.getElementById("toast-container");
    if (!c2) {
      c2 = document.createElement("div");
      c2.id = "toast-container";
      document.body.appendChild(c2);
    }
    return c2;
  }
  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    getToastContainer().appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  function stickyToast(msg, type, onAccept, acceptLabel) {
    const el = document.createElement("div");
    el.className = "toast toast-sticky " + (type || "warn");
    const txt = document.createElement("span");
    txt.textContent = msg;
    el.appendChild(txt);
    if (onAccept) {
      const accept = document.createElement("button");
      accept.textContent = acceptLabel || "Exclude them";
      accept.className = "toast-close";
      accept.style.cssText = "color:var(--accent);margin-right:4px";
      accept.onclick = () => {
        el.remove();
        onAccept();
      };
      el.appendChild(accept);
    }
    const btn = document.createElement("button");
    btn.textContent = "\u2715";
    btn.className = "toast-close";
    btn.onclick = () => el.remove();
    el.appendChild(btn);
    getToastContainer().appendChild(el);
  }
  function toggleSidebar() {
    const sb = document.getElementById("sidebar");
    const btn = document.getElementById("sidebarToggle");
    const collapsed = sb.classList.toggle("collapsed");
    btn.innerHTML = collapsed ? "&#x276F;" : "&#x276E;";
  }
  if (typeof window !== "undefined") window.toggleSidebar = toggleSidebar;
  var TABLE_PALETTE = [
    "#4477AA",
    "#EE6677",
    "#228833",
    "#CCBB44",
    "#66CCEE",
    "#AA3377",
    "#EE7733",
    "#0077BB",
    "#33BBEE",
    "#EE3377",
    "#CC3311",
    "#009988",
    "#882255",
    "#117733",
    "#999933",
    "#44AA99"
  ];
  function getTableColor(tid) {
    if (db.tableColors[tid]) return db.tableColors[tid];
    const used = new Set(Object.values(db.tableColors));
    const idx = TABLE_PALETTE.findIndex((c2) => !used.has(c2));
    const col = idx >= 0 ? TABLE_PALETTE[idx] : TABLE_PALETTE[Object.keys(db.tableColors).length % TABLE_PALETTE.length];
    db.tableColors[tid] = col;
    return col;
  }
  function getTableColorClass(tid) {
    const color = getTableColor(tid);
    const idx = TABLE_PALETTE.indexOf(color);
    return `chip-c${idx >= 0 ? idx : 0}`;
  }
  function chipFgColor(bg) {
    if (!bg || typeof bg !== "string") return "#111";
    const m2 = bg.trim().match(/^#([0-9a-f]{6})$/i);
    if (!m2) return "#111";
    const hex = m2[1];
    const r2 = parseInt(hex.slice(0, 2), 16);
    const g2 = parseInt(hex.slice(2, 4), 16);
    const b2 = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r2 + 0.587 * g2 + 0.114 * b2) / 255;
    return luminance > 0.6 ? "#111" : "#fff";
  }
  function tableShortName(tid) {
    const name = db.tables[tid]?.name || tid;
    return name.length > 14 ? name.slice(0, 12) + "\u2026" : name;
  }
  function colUserLabel(tid, physCol) {
    return db.columnLabels?.[tid]?.[physCol] ?? physCol;
  }
  function setColLabel(tid, physCol, label) {
    if (!db.columnLabels[tid]) db.columnLabels[tid] = {};
    if (!label || label === physCol) {
      delete db.columnLabels[tid][physCol];
      if (!Object.keys(db.columnLabels[tid]).length) delete db.columnLabels[tid];
    } else {
      db.columnLabels[tid][physCol] = label;
    }
  }
  function colDisplayLabel(alias, map) {
    const src = (map || buildColSourceMap()).get(alias);
    if (!src) return alias;
    if (src.kind === "calc") {
      const calc = db.calcStages?.[src.idx];
      return (calc?.alias || "").trim() || alias;
    }
    return tableShortName(src.tid) + " \u2192 " + colUserLabel(src.tid, src.col);
  }
  function colExportLabel(alias, map) {
    const src = (map || buildColSourceMap()).get(alias);
    if (!src) return alias;
    if (src.kind === "calc") {
      const calc = db.calcStages?.[src.idx];
      return (calc?.alias || "").trim() || alias;
    }
    return colUserLabel(src.tid, src.col);
  }
  function buildExportHeaderMap(cols, map) {
    map = map || buildColSourceMap();
    const seen = /* @__PURE__ */ new Map();
    const result = {};
    for (const alias of cols) {
      const base = colExportLabel(alias, map);
      const n2 = seen.get(base) || 0;
      seen.set(base, n2 + 1);
      result[alias] = n2 === 0 ? base : base + " " + (n2 + 1);
    }
    return result;
  }
  function smartDefaultFn(colName) {
    const n2 = String(colName).toLowerCase();
    if (/\bdate\b|time\b|\bdt\b|shipped|arrival|delivery|due\b|created/.test(n2)) return "DATE RANGE";
    if (/amount|total|value|price|cost|\bqty\b|quantity|\bnum\b|number|units|sales|revenue|weight|volume/.test(n2)) return "SUM";
    return "FIRST";
  }
  function defaultAggAlias(fn, colLabel) {
    switch (fn) {
      case "SUM":
        return `Total ${colLabel}`;
      case "AVG":
        return `Avg ${colLabel}`;
      case "COUNT ROWS":
        return "Row Count";
      case "COUNT NON-EMPTY":
        return `# ${colLabel}`;
      case "COUNT DISTINCT":
        return `Unique ${colLabel}`;
      case "MIN":
        return `Min ${colLabel}`;
      case "MAX":
        return `Max ${colLabel}`;
      case "FIRST":
        return `${colLabel} (first)`;
      case "LAST":
        return `${colLabel} (last)`;
      case "DATE RANGE":
        return `${colLabel} Range`;
      case "DATE SPAN":
        return `${colLabel} Span (days)`;
      case "NUMERIC RANGE":
        return `${colLabel} Range`;
      case "NUMERIC SPAN":
        return `${colLabel} Span`;
      case "LIST":
        return `${colLabel} (list)`;
      default:
        return `${fn}(${colLabel})`;
    }
  }

  // js/core/sqldb.ts
  var _SQLJS_VERSION = "1.12.0";
  if (typeof window !== "undefined") window.sqlDb = null;
  async function initDb() {
    const SQL = await initSqlJs({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/sql.js@${_SQLJS_VERSION}/dist/${file}`
    });
    window.sqlDb = new SQL.Database();
  }
  function _sqlDb() {
    return window.sqlDb;
  }
  function quoteId(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }
  function coerceForSQL(v2) {
    if (v2 == null) return null;
    if (v2 instanceof Date) return v2.toISOString().slice(0, 19);
    if (typeof v2 === "boolean") return v2 ? 1 : 0;
    if (typeof v2 === "number") return v2;
    const s2 = String(v2).trim();
    const n2 = Number(s2);
    if (s2 !== "" && !isNaN(n2)) return n2;
    return s2 || null;
  }
  function createTable(sqlName, cols) {
    const defs = cols.map((c2) => quoteId(c2)).join(", ");
    _sqlDb().run(`CREATE TABLE IF NOT EXISTS ${quoteId(sqlName)} (${defs})`);
  }
  function insertRows(sqlName, cols, data) {
    if (!data.length) return;
    const ph = cols.map(() => "?").join(", ");
    const sql = `INSERT INTO ${quoteId(sqlName)} VALUES (${ph})`;
    _sqlDb().run("BEGIN");
    try {
      const stmt = _sqlDb().prepare(sql);
      for (const row of data) {
        stmt.run(cols.map((c2) => coerceForSQL(row[c2])));
      }
      stmt.free();
      _sqlDb().run("COMMIT");
    } catch (e2) {
      try {
        _sqlDb().run("ROLLBACK");
      } catch (_2) {
      }
      throw e2;
    }
  }
  function execQuery(sql, params) {
    try {
      const stmt = _sqlDb().prepare(sql);
      if (params && params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    } catch (e2) {
      throw new Error(e2.message + "\n\nQuery:\n" + sql);
    }
  }
  function dropTable(sqlName) {
    try {
      _sqlDb().run(`DROP TABLE IF EXISTS ${quoteId(sqlName)}`);
    } catch (_2) {
    }
  }
  function tableRowCount(sqlName) {
    try {
      const r2 = _sqlDb().exec(`SELECT COUNT(*) FROM ${quoteId(sqlName)}`);
      return r2[0]?.values[0]?.[0] ?? 0;
    } catch (_2) {
      return 0;
    }
  }

  // js/catalog/source-catalog.ts
  function buildSourceCatalog(workspaceState, upstreamOutputs) {
    const catalog = /* @__PURE__ */ new Map();
    const tables = workspaceState && workspaceState.tables || db && db.tables || {};
    for (const [tid, table] of Object.entries(tables)) {
      catalog.set(tid, {
        id: tid,
        name: table.name || tid,
        cols: table.cols || [],
        rows: table.rows || [],
        kind: "imported",
        source: table
      });
    }
    if (upstreamOutputs) {
      for (const [outputId, output] of upstreamOutputs.entries()) {
        catalog.set(outputId, {
          id: outputId,
          name: output.name || outputId,
          cols: output.columns || [],
          rows: output.rows || [],
          kind: "report",
          source: output
        });
      }
    }
    return catalog;
  }

  // js/report/result-set.ts
  function buildResultSet(columns, rows, metadata) {
    const r2 = Array.isArray(rows) ? rows : [];
    return {
      columns: Array.isArray(columns) ? columns : [],
      rows: r2,
      metadata: Object.assign({
        rowCount: r2.length,
        generatedAt: Date.now(),
        aggMode: "none",
        displayCols: null
      }, metadata || {})
    };
  }

  // js/query/sql-where.ts
  function renderWhereClause(colRef, op, val, params, opts) {
    const likeEsc = (v2) => v2.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const txt = `CAST(${colRef} AS TEXT)`;
    const num = `CAST(${colRef} AS REAL)`;
    const numericHint = !!(opts && opts.numericHint);
    const normVal = String(val ?? "").trim();
    const numVal = Number(normVal.replace(/,/g, ""));
    const hasNumericVal = normVal !== "" && Number.isFinite(numVal);
    switch (op) {
      case "contains":
        params.push("%" + likeEsc(val) + "%");
        return `${txt} LIKE ? ESCAPE '\\'`;
      case "equals":
        if (numericHint && hasNumericVal) {
          params.push(numVal);
          return `${num} = ?`;
        }
        params.push(val);
        return `${txt} = ?`;
      case "not equals":
        if (numericHint && hasNumericVal) {
          params.push(numVal);
          return `${num} != ?`;
        }
        params.push(val);
        return `${txt} != ?`;
      case ">":
        params.push(+val || 0);
        return `${num} > ?`;
      case "<":
        params.push(+val || 0);
        return `${num} < ?`;
      case ">=":
        params.push(+val || 0);
        return `${num} >= ?`;
      case "<=":
        params.push(+val || 0);
        return `${num} <= ?`;
      case "starts with":
        params.push(likeEsc(val) + "%");
        return `${txt} LIKE ? ESCAPE '\\'`;
      case "ends with":
        params.push("%" + likeEsc(val));
        return `${txt} LIKE ? ESCAPE '\\'`;
      case "is empty":
        return `(${colRef} IS NULL OR ${txt} = '')`;
      case "not empty":
        return `(${colRef} IS NOT NULL AND ${txt} != '')`;
      default:
        return null;
    }
  }

  // js/query/sql-aggregates.ts
  function renderAggregateExpr(fn, colRef) {
    switch (fn) {
      case "SUM":
        return `SUM(${colRef})`;
      case "AVG":
        return `AVG(${colRef})`;
      case "MIN":
        return `MIN(${colRef})`;
      case "MAX":
        return `MAX(${colRef})`;
      case "COUNT ROWS":
        return "COUNT(*)";
      case "COUNT NON-EMPTY":
        return `COUNT(${colRef})`;
      case "COUNT DISTINCT":
        return `COUNT(DISTINCT ${colRef})`;
      case "FIRST":
        return `MIN(${colRef})`;
      case "LAST":
        return `MAX(${colRef})`;
      case "DATE RANGE":
        return `MIN(${colRef}) || ' \u2014 ' || MAX(${colRef})`;
      case "DATE SPAN":
        return `CAST(julianday(MAX(${colRef})) - julianday(MIN(${colRef})) AS INTEGER)`;
      case "NUMERIC RANGE":
        return `MIN(${colRef}) || ' \u2013 ' || MAX(${colRef})`;
      case "NUMERIC SPAN":
        return `MAX(${colRef}) - MIN(${colRef})`;
      case "LIST":
        return `GROUP_CONCAT(DISTINCT ${colRef})`;
      default:
        return `COUNT(${colRef})`;
    }
  }

  // js/query/sql-calcs.ts
  var _toNum = (expr) => `CAST(COALESCE(NULLIF(TRIM(CAST(${expr} AS TEXT)), ''), '0') AS REAL)`;
  function _renderCalcExpr(alias, colMap, plan, baseTid, _trail) {
    if (!_trail) _trail = /* @__PURE__ */ new Set();
    if (_trail.has(alias)) return "NULL";
    const s2 = colMap.get(alias);
    if (!s2) return quoteId(alias);
    if (s2.kind !== "calc") {
      const tid = s2.tid === plan.source.base ? baseTid : s2.tid;
      return `${tid === "_base" ? "_base" : quoteId(tid)}.${quoteId(s2.col)}`;
    }
    const trail = new Set(_trail);
    trail.add(alias);
    const calc = s2.calc || (db.calcStages || [])[s2.idx];
    if (!calc) throw new Error(`Cannot render calc "${alias}": calc config not found`);
    if (s2.mode === "math") {
      return _renderModeMath(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s2.mode === "compare") {
      return _renderModeCompare(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s2.mode === "text") {
      return _renderModeText(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s2.mode === "date") {
      return _renderModeDate(calc, alias, colMap, plan, baseTid, trail);
    }
    throw new Error(`Unknown calc mode "${s2.mode}" for "${alias}"`);
  }
  function _renderModeMath(calc, alias, colMap, plan, baseTid, trail) {
    const math = calc.math;
    const steps = math.steps;
    const toNum = _toNum;
    const renderStepVal = (step, t2) => {
      if (step.type === "number") {
        const n2 = parseFloat(step.value || "");
        return Number.isFinite(n2) ? String(n2) : "0";
      }
      if (step.type === "column") {
        const expr2 = _renderCalcExpr(step.value || "", colMap, plan, baseTid, t2);
        return toNum(expr2);
      }
      throw new Error(`Unsupported math step type "${step.type}" in calc "${alias}"`);
    };
    const mathOp = calc.mathOp;
    const colExpr = renderStepVal(steps[0], trail);
    const rownoRef = baseTid === "_base" ? '"_base"."_rowno"' : `${quoteId(baseTid)}."_rowno"`;
    if (mathOp === "ROLLAVG") {
      const window2 = Math.max(1, parseInt(String(calc.window || "7"), 10) || 7);
      return `AVG(${colExpr}) OVER (ORDER BY ${rownoRef} ROWS BETWEEN ${window2 - 1} PRECEDING AND CURRENT ROW)`;
    }
    if (mathOp === "PCTTOTAL") {
      return `${colExpr} * 100.0 / NULLIF(SUM(${colExpr}) OVER (), 0)`;
    }
    let expr = colExpr;
    for (let i2 = 1; i2 < steps.length; i2++) {
      const step = steps[i2];
      const r2 = renderStepVal(step, trail);
      switch (step.op) {
        case "+":
          expr = `(${expr} + ${r2})`;
          break;
        case "-":
          expr = `(${expr} - ${r2})`;
          break;
        case "*":
          expr = `(${expr} * ${r2})`;
          break;
        case "/":
          expr = `(CASE WHEN ${r2} = 0 THEN NULL ELSE ${expr} / ${r2} END)`;
          break;
        case "%":
          expr = `(CASE WHEN ${r2} = 0 THEN NULL ELSE ${expr} % ${r2} END)`;
          break;
        default:
          throw new Error(`Unsupported math operator "${step.op}" in calc "${alias}"`);
      }
    }
    return expr;
  }
  function _renderModeCompare(calc, alias, colMap, plan, baseTid, trail) {
    const compare = calc.compare;
    const glue = compare.compareMode === "OR" ? " OR " : " AND ";
    const toNum = _toNum;
    const condParts = compare.conditions.map((cond) => {
      const colExpr = _renderCalcExpr(cond.col, colMap, plan, baseTid, trail);
      const op = cond.op;
      if (!["=", "!=", ">", ">=", "<", "<="].includes(op)) {
        throw new Error(`Invalid comparison operator "${op}" in calc "${alias}"`);
      }
      const cv = String(cond.val ?? "").trim();
      const n2 = parseFloat(cv.replace(/,/g, ""));
      const cNum = toNum(colExpr);
      const cTxt = `CAST(${colExpr} AS TEXT)`;
      if ([">", ">=", "<", "<="].includes(op)) return `${cNum} ${op} ${Number.isFinite(n2) ? n2 : 0}`;
      if (cv !== "" && Number.isFinite(n2)) return `${cNum} ${op} ${n2}`;
      return `${cTxt} ${op === "=" ? "=" : "!="} '${cv.replace(/'/g, "''")}'`;
    });
    const thenExpr = _renderTypedValue(compare.trueValue, colMap, plan, baseTid, trail);
    const elseExpr = _renderTypedValue(compare.falseValue, colMap, plan, baseTid, trail);
    return `(CASE WHEN ${condParts.join(glue)} THEN ${thenExpr} ELSE ${elseExpr} END)`;
  }
  function _renderModeText(calc, alias, colMap, plan, baseTid, trail) {
    const text = calc.text;
    const op = text.operation;
    if (op === "combine") {
      const parts = text.parts.map((p2) => _renderTextPart(p2, colMap, plan, baseTid, trail));
      return parts.join(" || ");
    }
    if (op === "left") {
      const src = _renderTextSource(text.source, colMap, plan, baseTid, trail);
      return `SUBSTR(${src}, 1, ${text.count})`;
    }
    if (op === "right") {
      const src = _renderTextSource(text.source, colMap, plan, baseTid, trail);
      return `SUBSTR(${src}, -${text.count})`;
    }
    if (op === "substring") {
      const src = _renderTextSource(text.source, colMap, plan, baseTid, trail);
      return `SUBSTR(${src}, ${text.start}, ${text.length})`;
    }
    throw new Error(`Unknown text operation "${op}" in calc "${alias}"`);
  }
  function _renderModeDate(calc, alias, colMap, plan, baseTid, trail) {
    const date = calc.date;
    const op = date.operation;
    if (op === "extract") {
      const src = _renderDateSource(date.source, colMap, plan, baseTid, trail);
      const part = date.part || "year";
      const output = date.output || "text";
      const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const monthCase = (names) => {
        const branches = names.map((n2, j2) => `WHEN ${j2 + 1} THEN '${n2}'`).join(" ");
        return `(CASE CAST(strftime('%m', ${src}) AS INTEGER) ${branches} END)`;
      };
      const dowCase = (names) => {
        const branches = names.map((n2, j2) => `WHEN ${j2} THEN '${n2}'`).join(" ");
        return `(CASE CAST(strftime('%w', ${src}) AS INTEGER) ${branches} END)`;
      };
      if (part === "quarter") {
        if (output === "short") {
          const branches = [1, 2, 3, 4].map((q2) => `WHEN ${q2} THEN 'Q${q2}'`).join(" ");
          return `(CASE ((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1) ${branches} END)`;
        }
        if (output === "text") {
          const branches = [1, 2, 3, 4].map((q2) => `WHEN ${q2} THEN 'Quarter ${q2}'`).join(" ");
          return `(CASE ((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1) ${branches} END)`;
        }
        return `((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1)`;
      }
      if (part === "julian") {
        return `CAST(julianday(${src}) AS INTEGER)`;
      }
      if (part === "month") {
        if (output === "short") return monthCase(MONTH_SHORT);
        if (output === "text") return monthCase(MONTH_FULL);
        return `CAST(strftime('%m', ${src}) AS INTEGER)`;
      }
      if (part === "dow") {
        if (output === "short") return dowCase(DOW_SHORT);
        if (output === "text") return dowCase(DOW_FULL);
        return `CAST(strftime('%w', ${src}) AS INTEGER)`;
      }
      const partFormat = {
        "year": "%Y",
        "day": "%d",
        "week": "%W"
      };
      return `CAST(strftime('${partFormat[part]}', ${src}) AS INTEGER)`;
    }
    throw new Error(`Unknown date operation "${op}" in calc "${alias}"`);
  }
  function _renderDateSource(source, colMap, plan, baseTid, trail) {
    if (source.type === "column") return _renderCalcExpr(source.value, colMap, plan, baseTid, trail);
    throw new Error(`Unsupported date source type "${source.type}"`);
  }
  function _renderTypedValue(tv, colMap, plan, baseTid, trail) {
    if (tv.type === "text") return `'${String(tv.value).replace(/'/g, "''")}'`;
    if (tv.type === "number") return String(Number(tv.value));
    if (tv.type === "column") return _renderCalcExpr(tv.value, colMap, plan, baseTid, trail);
    throw new Error(`Unsupported typed-value type "${tv.type}"`);
  }
  function _renderTextPart(part, colMap, plan, baseTid, trail) {
    if (part.type === "text") return `'${String(part.value).replace(/'/g, "''")}'`;
    if (part.type === "number") return `CAST(${Number(part.value)} AS TEXT)`;
    if (part.type === "column") {
      const expr = _renderCalcExpr(part.value, colMap, plan, baseTid, trail);
      return `COALESCE(CAST(${expr} AS TEXT), '')`;
    }
    throw new Error(`Unsupported text part type "${part.type}"`);
  }
  function _renderTextSource(source, colMap, plan, baseTid, trail) {
    if (source.type === "text") return `'${String(source.value).replace(/'/g, "''")}'`;
    if (source.type === "column") return _renderCalcExpr(source.value, colMap, plan, baseTid, trail);
    throw new Error(`Unsupported text source type "${source.type}"`);
  }

  // js/query/sql-joins.ts
  function renderFromJoinWhere(plan) {
    const colMap = plan.colMap;
    const src = plan.source;
    const base = src.base;
    const hasStacks = src.stacks && src.stacks.length > 0;
    const baseTid = hasStacks ? "_base" : base;
    function ref(alias) {
      const s2 = colMap.get(alias);
      if (!s2) return quoteId(alias);
      if (s2.kind === "calc") return _renderCalcExpr(alias, colMap, plan, baseTid);
      const tid = s2.tid === base ? baseTid : s2.tid;
      return `${tid === "_base" ? "_base" : quoteId(tid)}.${quoteId(s2.col)}`;
    }
    let fromClause;
    if (hasStacks) {
      const baseCols = src.baseCols || (src.tablesById && src.tablesById.has(base) ? src.tablesById.get(base).cols : []);
      const allTids = [base, ...src.stacks];
      const unionParts = allTids.filter((tid) => src.tablesById && src.tablesById.has(tid)).map((tid) => {
        const tCols = src.tablesById.get(tid).cols;
        const selStr = [`"_rowno"`, ...baseCols.map((c2) => tCols.includes(c2) ? quoteId(c2) : `NULL AS ${quoteId(c2)}`)].join(", ");
        const excl = src.excludedRows ? src.excludedRows[tid] : null;
        let q2 = `SELECT ${selStr} FROM ${quoteId(tid)}`;
        if (excl && excl.size) q2 += ` WHERE "_rowno" NOT IN (${[...excl].join(",")})`;
        return q2;
      });
      fromClause = `(
  ${unionParts.join("\n  UNION ALL\n  ")}
) AS _base`;
    } else {
      fromClause = quoteId(base);
    }
    const joinClauses = [];
    for (const join of plan.joins || []) {
      const jType = join.required ? "INNER" : "LEFT";
      const dupPolicy = join.duplicatePolicy || { mode: "block" };
      const rightCols = join.rightColumns || [];
      const keyRightCols = new Set(join.keyPairs.map((p2) => p2.right));
      let rightSource;
      let exclInSubquery = false;
      if (dupPolicy.mode === "combine" && rightCols.length > 0) {
        const combine = Object.assign({ separator: "; ", unique: true, includeBlank: false, sort: false }, dupPolicy.combine || {});
        const aggSeparator = combine.separator === "; " ? '"; "' : `'${combine.separator.replace(/'/g, "''")}'`;
        const valCols = rightCols.filter((c2) => !keyRightCols.has(c2));
        const keyColQuoted = join.keyPairs.map((p2) => quoteId(p2.right));
        const keyColSelects = join.keyPairs.map((p2) => `${quoteId(p2.right)} AS ${quoteId(p2.right)}`);
        const whereClause = join.keyPairs.map((p2) => `${quoteId(p2.right)} IS NOT NULL AND TRIM(${quoteId(p2.right)}) != ''`).join(" AND ");
        const exclClause = join.excludedRows && join.excludedRows.size ? ` AND "_rowno" NOT IN (${[...join.excludedRows].join(",")})` : "";
        const fullWhere = whereClause + exclClause;
        if (combine.unique) {
          const valSubExprs = valCols.map((c2) => {
            let colExpr = quoteId(c2);
            if (!combine.includeBlank) colExpr = `NULLIF(${colExpr}, '')`;
            const orderClause = combine.sort ? ` ORDER BY ${colExpr}` : "";
            const innerSub = `(SELECT DISTINCT ${keyColQuoted.join(", ")}, ${colExpr} AS ${quoteId(c2)} FROM ${quoteId(join.rightId)} WHERE ${fullWhere})`;
            const corrCond = keyColQuoted.map((k) => `_inner.${k} = _keys.${k}`).join(" AND ");
            return `(SELECT GROUP_CONCAT(${quoteId(c2)}, ${aggSeparator}${orderClause}) FROM ${innerSub} AS _inner WHERE ${corrCond}) AS ${quoteId(c2)}`;
          });
          const keyDistinctSub = `(SELECT DISTINCT ${keyColQuoted.join(", ")} FROM ${quoteId(join.rightId)} WHERE ${fullWhere})`;
          const subSql = `SELECT ${keyColSelects.join(", ")}, ${valSubExprs.join(", ")} FROM ${keyDistinctSub} AS _keys`;
          rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
          exclInSubquery = true;
        } else {
          const valExprs = valCols.map((c2) => {
            let colExpr = quoteId(c2);
            if (!combine.includeBlank) colExpr = `NULLIF(${colExpr}, '')`;
            const orderClause = combine.sort ? ` ORDER BY ${quoteId(c2)}` : "";
            return `GROUP_CONCAT(${colExpr}, ${aggSeparator}${orderClause}) AS ${quoteId(c2)}`;
          });
          const selectParts = [...keyColSelects, ...valExprs];
          const subSql = `SELECT ${selectParts.join(", ")} FROM ${quoteId(join.rightId)} WHERE ${fullWhere} GROUP BY ${keyColQuoted.join(", ")}`;
          rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
          exclInSubquery = true;
        }
      } else {
        rightSource = quoteId(join.rightId);
      }
      const onParts = join.keyPairs.map((p2) => `${ref(p2.left)} = ${quoteId(join.rightId)}.${quoteId(p2.right)}`);
      if (!exclInSubquery && join.excludedRows && join.excludedRows.size) {
        onParts.push(`${quoteId(join.rightId)}."_rowno" NOT IN (${[...join.excludedRows].join(",")})`);
      }
      joinClauses.push(`${jType} JOIN ${rightSource} ON ${onParts.join(" AND ")}`);
    }
    const params = [];
    const whereParts = [];
    if (!hasStacks && src.excludedRows) {
      const excl = src.excludedRows[base];
      if (excl && excl.size) {
        whereParts.push(`${quoteId(base)}."_rowno" NOT IN (${[...excl].join(",")})`);
      }
    }
    for (const f2 of plan.filters || []) {
      if (!f2.col) continue;
      const fs = colMap.get(f2.col);
      const isNumericCalc = fs?.kind === "calc" && fs.mode === "math";
      const filterVals = Array.isArray(f2.vals) ? f2.vals : [""];
      const orParts = filterVals.map((v2) => renderWhereClause(ref(f2.col), f2.op, String(v2 ?? ""), params, { numericHint: isNumericCalc })).filter(Boolean);
      if (!orParts.length) continue;
      whereParts.push(orParts.length > 1 ? `(${orParts.join(" OR ")})` : orParts[0]);
    }
    return { fromClause, joinClauses, whereParts, params, ref };
  }

  // js/query/sql-detail.ts
  function renderDetailSql(plan) {
    if (!plan.source.base) throw new Error("No base table in plan");
    const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
    const selParts = [];
    const colAliases = [];
    for (const alias of plan.selectedColumns) {
      selParts.push(`${ref(alias)} AS ${quoteId(alias)}`);
      colAliases.push(alias);
    }
    if (!selParts.length) selParts.push("*");
    let sql = `SELECT ${selParts.join(",\n       ")}
FROM ${fromClause}`;
    if (joinClauses.length) sql += "\n" + joinClauses.join("\n");
    if (whereParts.length) sql += "\nWHERE " + whereParts.join("\n  AND ");
    const sortParts = (plan.sorts || []).map((s2) => `${ref(s2.col)} ${s2.dir === "DESC" ? "DESC" : "ASC"}`);
    if (sortParts.length) sql += "\nORDER BY " + sortParts.join(", ");
    return { sql, params, cols: colAliases };
  }

  // js/query/sql-grouped.ts
  function renderGroupedSql(plan) {
    if (!plan.source.base) throw new Error("No base table in plan");
    const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
    const hasAgg = (plan.groupBy || []).length > 0 || (plan.aggregates || []).length > 0;
    const selColSet = plan.selectedColumns.length > 0 ? new Set(plan.selectedColumns) : null;
    const selParts = [];
    const colAliases = [];
    const groupRefs = [];
    if (hasAgg) {
      for (const alias of plan.groupBy || []) {
        if (selColSet && !selColSet.has(alias)) continue;
        const r2 = ref(alias);
        selParts.push(`${r2} AS ${quoteId(alias)}`);
        groupRefs.push(r2);
        colAliases.push(alias);
      }
      for (const agg of plan.aggregates || []) {
        const outName = (agg.alias || "").trim() || (typeof defaultAggAlias === "function" ? defaultAggAlias(agg.fn, agg.col && agg.col !== "*" ? agg.col : "all rows") : `${agg.fn}(${agg.col || "*"})`);
        if (selColSet && !selColSet.has(outName)) continue;
        const colRef = agg.col && agg.col !== "*" ? ref(agg.col) : null;
        const expr = renderAggregateExpr(agg.fn, colRef || "*");
        selParts.push(`${expr} AS ${quoteId(outName)}`);
        colAliases.push(outName);
      }
    } else {
      for (const alias of plan.selectedColumns) {
        selParts.push(`${ref(alias)} AS ${quoteId(alias)}`);
        colAliases.push(alias);
      }
    }
    if (!selParts.length) selParts.push("*");
    let sql = `SELECT ${selParts.join(",\n       ")}
FROM ${fromClause}`;
    if (joinClauses.length) sql += "\n" + joinClauses.join("\n");
    if (whereParts.length) sql += "\nWHERE " + whereParts.join("\n  AND ");
    if (groupRefs.length) sql += "\nGROUP BY " + groupRefs.join(", ");
    const sortParts = (plan.sorts || []).map((s2) => `${ref(s2.col)} ${s2.dir === "DESC" ? "DESC" : "ASC"}`);
    if (sortParts.length) sql += "\nORDER BY " + sortParts.join(", ");
    return { sql, params, cols: colAliases };
  }

  // js/query/sql-totals.ts
  function renderTotalsSql(plan, detailCols) {
    if (!plan.source.base) throw new Error("No base table in plan");
    const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
    const colTotals = plan.colTotals || {};
    const hasAny = detailCols.some((c2) => colTotals[c2] && colTotals[c2] !== "skip");
    if (!hasAny) return null;
    const selParts = detailCols.map((col) => {
      const fn = colTotals[col];
      if (!fn || fn === "skip") return `NULL AS ${quoteId(col)}`;
      return `${renderAggregateExpr(fn, ref(col))} AS ${quoteId(col)}`;
    });
    let sql = `SELECT ${selParts.join(",\n       ")}
FROM ${fromClause}`;
    if (joinClauses.length) sql += "\n" + joinClauses.join("\n");
    if (whereParts.length) sql += "\nWHERE " + whereParts.join("\n  AND ");
    return { sql, params, cols: detailCols };
  }

  // js/query/sql-subtotals.ts
  function renderSubtotalsSql(plan) {
    if (!plan.source.base) throw new Error("No base table in plan");
    const colMap = plan.colMap;
    const { fromClause, joinClauses, whereParts, params: filterParams, ref } = renderFromJoinWhere(plan);
    const toShow = plan.selectedColumns;
    if (!toShow.length) return null;
    const subtotalFns = plan.subtotalFns || {};
    const includeGrand = plan.subtotalGrandTotal !== false;
    const includeSpacer = !!plan.subtotalSpacer;
    const subtotalOnTop = !!plan.subtotalOnTop;
    const isNested = plan.subtotalStrategy === "nested";
    const orderIdx = new Map(toShow.map((a2, i2) => [a2, i2]));
    const seenSub = /* @__PURE__ */ new Set();
    const subtotalBy = (plan.subtotalBy || []).filter((a2) => orderIdx.has(a2) && !seenSub.has(a2) && (seenSub.add(a2), true)).sort((a2, b2) => (orderIdx.get(a2) ?? Infinity) - (orderIdx.get(b2) ?? Infinity));
    const n2 = subtotalBy.length;
    const sortGroupKeys = subtotalBy.map((_2, i2) => `_sort_group_${i2}`);
    const detailSortType = subtotalOnTop ? 1 : 0;
    const subtotalSortType = subtotalOnTop ? 0 : 1;
    const subAggExpr = (a2) => {
      const fn = subtotalFns[a2];
      if (!fn || fn === "skip") return `NULL AS ${quoteId(a2)}`;
      return `${renderAggregateExpr(fn, ref(a2))} AS ${quoteId(a2)}`;
    };
    const subtotalBySet = new Set(subtotalBy);
    const fromPart = `FROM ${fromClause}`;
    const joinPart = joinClauses.length ? "\n" + joinClauses.join("\n") : "";
    const wherePart = whereParts.length ? "\nWHERE " + whereParts.join("\n  AND ") : "";
    const nullFilter = n2 ? subtotalBy.map((a2) => `${ref(a2)} IS NOT NULL`).join(" OR ") : "";
    const subWherePart = nullFilter ? whereParts.length ? `
WHERE ${whereParts.join("\n  AND ")}
  AND (${nullFilter})` : `
WHERE (${nullFilter})` : wherePart;
    const detailSel = [
      ...toShow.map((a2) => `${ref(a2)} AS ${quoteId(a2)}`),
      '0 AS "_row_type"',
      `${detailSortType} AS "_sort_row_type"`,
      ...subtotalBy.map((a2, i2) => `${ref(a2)} AS ${quoteId(sortGroupKeys[i2])}`)
    ].join(",\n       ");
    function makeSubSel(depth) {
      const groupCols = subtotalBy.slice(0, depth + 1);
      const groupSet = new Set(groupCols);
      return [
        ...toShow.map((a2) => {
          if (groupSet.has(a2)) return `${ref(a2)} AS ${quoteId(a2)}`;
          if (subtotalBySet.has(a2)) return `NULL AS ${quoteId(a2)}`;
          return subAggExpr(a2);
        }),
        '1 AS "_row_type"',
        `${subtotalSortType} AS "_sort_row_type"`,
        ...subtotalBy.map((a2, i2) => i2 <= depth ? `${ref(a2)} AS ${quoteId(sortGroupKeys[i2])}` : `NULL AS ${quoteId(sortGroupKeys[i2])}`)
      ].join(",\n       ");
    }
    const grandSel = [
      ...toShow.map((a2) => subtotalBySet.has(a2) ? `NULL AS ${quoteId(a2)}` : subAggExpr(a2)),
      '3 AS "_row_type"',
      '3 AS "_sort_row_type"',
      ...subtotalBy.map((_2, i2) => `NULL AS ${quoteId(sortGroupKeys[i2])}`)
    ].join(",\n       ");
    const spacerSel = [
      ...toShow.map((a2) => `NULL AS ${quoteId(a2)}`),
      '2 AS "_row_type"',
      '2 AS "_sort_row_type"',
      ...subtotalBy.map((a2, i2) => `${ref(a2)} AS ${quoteId(sortGroupKeys[i2])}`)
    ].join(",\n       ");
    const orderParts = [
      ...sortGroupKeys.map((k, i2) => {
        if (isNested && i2 > 0 && subtotalOnTop) return `${quoteId(k)} ASC NULLS FIRST`;
        return `${quoteId(k)} ASC NULLS LAST`;
      }),
      '"_sort_row_type" ASC',
      ...(plan.sorts || []).filter((s2) => toShow.includes(s2.col) && !subtotalBySet.has(s2.col)).map((s2) => `${quoteId(s2.col)} ${s2.dir === "DESC" ? "DESC" : "ASC"}`)
    ];
    const branches = [`SELECT ${detailSel}
${fromPart}${joinPart}${wherePart}`];
    if (n2 > 0) {
      if (isNested && n2 > 1) {
        for (let d2 = 0; d2 < n2; d2++) {
          const groupClause = subtotalBy.slice(0, d2 + 1).map((a2) => ref(a2)).join(", ");
          branches.push(`SELECT ${makeSubSel(d2)}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
        }
      } else {
        const groupClause = subtotalBy.map((a2) => ref(a2)).join(", ");
        branches.push(`SELECT ${makeSubSel(n2 - 1)}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
      }
      if (includeSpacer) {
        const groupClause = subtotalBy.map((a2) => ref(a2)).join(", ");
        branches.push(`SELECT ${spacerSel}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
      }
    }
    if (includeGrand) {
      const hasGrandValue = toShow.some(
        (a2) => !subtotalBySet.has(a2) && subtotalFns[a2] && subtotalFns[a2] !== "skip"
      );
      if (hasGrandValue) {
        branches.push(`SELECT ${grandSel}
${fromPart}${joinPart}${wherePart}`);
      }
    }
    const params = Array.from({ length: branches.length }, () => [...filterParams]).flat();
    const sql = branches.join("\nUNION ALL\n") + "\nORDER BY " + orderParts.join(", ");
    return {
      sql,
      params,
      cols: [...toShow, "_row_type", "_sort_row_type", ...sortGroupKeys],
      displayCols: toShow
    };
  }

  // js/query/lookup-resolver.ts
  function checkLookupDuplicates(lk) {
    if (!lk.rightId || !db.tables[lk.rightId]) return null;
    if (lk.duplicatePolicy && lk.duplicatePolicy.mode === "combine") return null;
    const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p2) => p2.left && p2.right) : [];
    if (!pairs.length) return null;
    try {
      const table = quoteId(lk.rightId);
      const tname = db.tables[lk.rightId].name;
      const rightCols = pairs.map((p2) => p2.right);
      const whereParts = rightCols.map((c2) => `${quoteId(c2)} IS NOT NULL AND TRIM(${quoteId(c2)}) != ''`);
      const excl = db.excludedRows?.[lk.rightId];
      if (excl && excl.size) {
        whereParts.push(`"_rowno" NOT IN (${[...excl].join(",")})`);
      }
      const whereNonNull = whereParts.join(" AND ");
      const concatExpr = rightCols.length === 1 ? quoteId(rightCols[0]) : rightCols.map((c2) => quoteId(c2)).join(` || CHAR(0) || `);
      const sql = `
      SELECT COUNT(*) AS total, COUNT(DISTINCT ${concatExpr}) AS uniq
      FROM ${table}
      WHERE ${whereNonNull}
    `;
      const rows = execQuery(sql);
      if (!rows.length) return null;
      const { total, uniq } = rows[0];
      if (total > uniq) {
        const dupes = total - uniq;
        const keyLabels = rightCols.map((c2) => colUserLabel(lk.rightId, c2) || c2);
        const keyDesc = keyLabels.length === 1 ? `"${keyLabels[0]}"` : keyLabels.map((c2) => `"${c2}"`).join(" + ");
        return `${keyDesc} in "${tname}" has ${dupes.toLocaleString()} duplicate combination${dupes === 1 ? "" : "s"} \u2014 it's unclear which row's data applies when there are multiple matches. Choose columns that together form a unique key.`;
      }
      return null;
    } catch {
      return null;
    }
  }

  // js/report/calc-validator.ts
  function validateMathMode(ctx) {
    const { calc, alias, cols } = ctx;
    const math = calc.math;
    if (!math || typeof math !== "object") return "Math mode requires a math configuration object.";
    if (math.strategy !== "stepChain") return 'Math mode requires strategy "stepChain".';
    if (!Array.isArray(math.steps) || math.steps.length === 0) return "Math mode requires at least one step.";
    for (let si = 0; si < math.steps.length; si++) {
      const step = math.steps[si];
      if (!step || typeof step !== "object") return `Step ${si + 1} is invalid.`;
      if (si === 0 && step.op) return "The first math step must not have an operator.";
      if (si > 0 && (!step.op || !["+", "-", "*", "/", "%"].includes(step.op))) return `Step ${si + 1} has an invalid operator "${step.op}".`;
      if (!["column", "number", "text"].includes(step.type)) return `Step ${si + 1} has an invalid type "${step.type}".`;
      if (step.type === "number" && step.value !== "" && isNaN(Number(step.value))) return `Step ${si + 1} has a non-numeric value "${step.value}".`;
      if (step.type === "column" && step.value && !cols.has(step.value)) return `Step ${si + 1} references unavailable column "${step.value}".`;
    }
    if (alias) {
      for (const step of math.steps) {
        if (step.type === "column" && step.value === alias) return "A column cannot reference itself.";
      }
    }
    return null;
  }
  function validateCompareMode(ctx) {
    const { calc, alias, cols } = ctx;
    const compare = calc.compare;
    if (!compare || typeof compare !== "object") return "Compare mode requires a compare configuration object.";
    if (!["AND", "OR"].includes(compare.compareMode)) return "Compare mode must use AND or OR.";
    if (!Array.isArray(compare.conditions) || compare.conditions.length === 0) return "Compare mode requires at least one condition.";
    for (let ci = 0; ci < compare.conditions.length; ci++) {
      const cond = compare.conditions[ci];
      if (!cond || typeof cond !== "object") return `Condition ${ci + 1} is invalid.`;
      if (!cond.col) return `Pick a column for condition ${ci + 1}.`;
      if (!["=", "!=", ">", ">=", "<", "<="].includes(cond.op)) return `Pick a valid operator for condition ${ci + 1}.`;
      if (!cols.has(cond.col)) return `Column for condition ${ci + 1} is no longer available.`;
      if (!String(cond.val ?? "").trim()) return `Enter a value for condition ${ci + 1}.`;
      if (cond.col === alias) return "A condition column cannot reference the output column itself.";
    }
    for (const key of ["trueValue", "falseValue"]) {
      const tv = compare[key];
      if (!tv || typeof tv !== "object") return `Compare ${key} is required.`;
      if (!["column", "number", "text"].includes(tv.type)) return `Compare ${key} has invalid type "${tv.type}".`;
      if (tv.type === "column" && tv.value && !cols.has(tv.value)) return `Compare ${key} column "${tv.value}" is not available.`;
    }
    return null;
  }
  function validateTextMode(ctx) {
    const { calc, cols } = ctx;
    const text = calc.text;
    if (!text || typeof text !== "object") return "Text mode requires a text configuration object.";
    if (!["combine", "left", "right", "substring"].includes(text.operation)) return `Unknown text operation "${text.operation}".`;
    if (text.operation === "combine") {
      if (!Array.isArray(text.parts) || text.parts.length === 0) return "Combine requires at least one part.";
      for (let pi = 0; pi < text.parts.length; pi++) {
        const part = text.parts[pi];
        if (!part || typeof part !== "object") return `Combine part ${pi + 1} is invalid.`;
        if (!["column", "number", "text"].includes(part.type)) return `Combine part ${pi + 1} has invalid type "${part.type}".`;
        if (part.type === "column" && part.value && !cols.has(part.value)) return `Combine part ${pi + 1} references unavailable column "${part.value}".`;
      }
    }
    if (["left", "right"].includes(text.operation)) {
      const source = text.source;
      if (!source || typeof source !== "object") return `${text.operation} requires a source.`;
      if (!["column", "text"].includes(source.type)) return `${text.operation} source has invalid type "${source.type}".`;
      if (source.type === "column" && source.value && !cols.has(source.value)) return `${text.operation} source column "${source.value}" is not available.`;
      if (typeof text.count !== "number" || text.count < 1 || !Number.isFinite(text.count)) return `${text.operation} requires a positive count.`;
    }
    if (text.operation === "substring") {
      const source = text.source;
      if (!source || typeof source !== "object") return "Substring requires a source.";
      if (!["column", "text"].includes(source.type)) return `Substring source has invalid type "${source.type}".`;
      if (source.type === "column" && source.value && !cols.has(source.value)) return `Substring source column "${source.value}" is not available.`;
      if (typeof text.start !== "number" || text.start < 1 || !Number.isFinite(text.start)) return "Substring requires a positive start position.";
      if (typeof text.length !== "number" || text.length < 1 || !Number.isFinite(text.length)) return "Substring requires a positive length.";
    }
    return null;
  }
  function validateDateMode(_ctx) {
    return null;
  }
  var calcModeValidators = {
    math: validateMathMode,
    compare: validateCompareMode,
    text: validateTextMode,
    date: validateDateMode
  };
  function checkCalcError(calc, i2) {
    const alias = (calc.alias || "").trim();
    if (!alias) return "Provide a label for this calculated column.";
    if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) {
      return "Pick a valid calculation type.";
    }
    const cols = new Set(projectedCols());
    const ctx = { calc, i: i2, cols, alias };
    const modeError = calcModeValidators[calc.mode](ctx);
    if (modeError) return modeError;
    const map = buildColSourceMap();
    const src = map.get(alias);
    if (src && src.kind !== "calc") return "Label conflicts with an existing column name.";
    const duplicates = (db.calcStages || []).filter((c2, idx) => idx !== i2 && (c2.alias || "").trim() === alias);
    if (duplicates.length) return "Label must be unique across calculated columns.";
    return null;
  }

  // js/ui/components/aggregation-constants.ts
  var AGG_FNS = [
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "COUNT ROWS",
    "COUNT NON-EMPTY",
    "COUNT DISTINCT",
    "FIRST",
    "LAST",
    "DATE RANGE",
    "DATE SPAN",
    "NUMERIC RANGE",
    "NUMERIC SPAN",
    "LIST"
  ];
  var AGG_LABELS = {
    "SUM": "Sum",
    "AVG": "Average",
    "MIN": "Min value",
    "MAX": "Max value",
    "COUNT ROWS": "Count rows",
    "COUNT NON-EMPTY": "Count non-empty",
    "COUNT DISTINCT": "Count distinct",
    "FIRST": "First value",
    "LAST": "Last value",
    "DATE RANGE": "Date range  (earliest \u2014 latest)",
    "DATE SPAN": "Date span  (days between)",
    "NUMERIC RANGE": "Numeric range  (min \u2013 max)",
    "NUMERIC SPAN": "Numeric span  (max \u2212 min)",
    "LIST": "List  (all values joined)"
  };
  var AGG_NEEDS_COL = (fn) => fn !== "COUNT ROWS";
  var TOTAL_FNS = [
    "skip",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "COUNT ROWS",
    "COUNT NON-EMPTY",
    "COUNT DISTINCT",
    "LIST"
  ];
  var TOTAL_LABELS = {
    skip: "Skip (leave blank)",
    SUM: "Sum",
    AVG: "Average",
    MIN: "Min",
    MAX: "Max",
    "COUNT ROWS": "Count rows",
    "COUNT NON-EMPTY": "Count non-empty",
    "COUNT DISTINCT": "Count distinct",
    LIST: "List (all values)"
  };
  var SUBTOTAL_FNS = [
    "skip",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "COUNT ROWS",
    "COUNT NON-EMPTY",
    "COUNT DISTINCT",
    "FIRST",
    "LAST",
    "DATE RANGE",
    "DATE SPAN",
    "NUMERIC RANGE",
    "NUMERIC SPAN",
    "LIST"
  ];
  var SUBTOTAL_LABELS = {
    skip: "Skip (leave blank)",
    SUM: "Sum",
    AVG: "Average",
    MIN: "Min",
    MAX: "Max",
    "COUNT ROWS": "Count rows",
    "COUNT NON-EMPTY": "Count non-empty",
    "COUNT DISTINCT": "Count distinct",
    FIRST: "First value",
    LAST: "Last value",
    "DATE RANGE": "Date range  (earliest \u2014 latest)",
    "DATE SPAN": "Date span  (days between)",
    "NUMERIC RANGE": "Numeric range  (min \u2013 max)",
    "NUMERIC SPAN": "Numeric span  (max \u2212 min)",
    LIST: "List (all values)"
  };
  var AGG_MODES = ["none", "group", "totals", "subtotals"];
  function isValidAggregateFn(fn) {
    return AGG_FNS.includes(fn);
  }
  function isValidTotalFn(fn) {
    return TOTAL_FNS.includes(fn);
  }
  function isValidSubtotalFn(fn) {
    return SUBTOTAL_FNS.includes(fn);
  }
  function aggregateNeedsColumn(fn) {
    return AGG_NEEDS_COL(fn);
  }

  // js/report/validation.ts
  var _validationCache = null;
  function invalidateValidation() {
    _validationCache = null;
  }
  function getValidation() {
    if (!_validationCache) _validationCache = deriveValidation();
    return _validationCache;
  }
  function deriveValidation() {
    const items = {};
    function mkIssue(id, area, cardId, itemId, message, extra) {
      return Object.assign({ id, severity: "blocked", area, cardId, itemId, message }, extra || {});
    }
    function mkItem(itemId, enabled, resolved, issues) {
      const e2 = enabled !== false;
      items[itemId] = { enabled: e2, resolved, blocking: e2 && !resolved, issues: issues || [] };
      return items[itemId];
    }
    const baseOk = !!(db.base && db.tables && db.tables[db.base]);
    const projected = new Set(baseOk ? projectedCols() : []);
    {
      const issues = [];
      if (!baseOk) {
        issues.push(mkIssue(
          "base_missing",
          "base",
          "pipeline",
          "base",
          `Primary sheet "${db.base || "(none)"}" is not loaded`,
          { missingTableId: db.base || null, repairHint: "Load the file containing this sheet." }
        ));
      }
      mkItem("base", true, baseOk, issues);
    }
    if (!["none", "group", "totals", "subtotals"].includes(db.aggMode)) {
      mkItem("aggMode", true, false, [
        mkIssue(
          "aggMode_invalid",
          "reportMode",
          "pipeline",
          "aggMode",
          `Unknown report mode "${db.aggMode}"`
        )
      ]);
    }
    for (let i2 = 0; i2 < (db.stacks || []).length; i2++) {
      const id = db.stacks[i2];
      const ok = !!(id && db.tables && db.tables[id]);
      const issues = [];
      if (!ok) {
        issues.push(mkIssue(
          `stack_${i2}_missing`,
          "stack",
          "pipeline",
          `stack_${i2}`,
          `Stacked sheet "${id}" is not loaded`,
          { missingTableId: id, repairHint: "Load the file containing this sheet." }
        ));
      }
      mkItem(`stack_${i2}`, true, ok, issues);
    }
    for (let i2 = 0; i2 < (db.lookups || []).length; i2++) {
      const lk = db.lookups[i2];
      const enabled = lk.enabled !== false;
      const issues = [];
      let resolved = true;
      const rt = lk.rightId && db.tables[lk.rightId];
      if (!rt) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i2}_missing_table`,
          "lookup",
          `lookup_${i2}`,
          `lookup_${i2}`,
          `Lookup sheet "${lk.rightId || "(none)"}" is not loaded`,
          { missingTableId: lk.rightId || null, repairHint: "Load the file containing this sheet." }
        ));
      } else if (baseOk) {
        const leftCols = projectedColsUpToLookup(i2);
        const leftSet = new Set(leftCols);
        for (let pi = 0; pi < (lk.keyPairs || []).length; pi++) {
          const p2 = lk.keyPairs[pi];
          if (p2.left && !leftSet.has(p2.left)) {
            resolved = false;
            issues.push(mkIssue(
              `lookup_${i2}_kp${pi}_left`,
              "lookup",
              `lookup_${i2}`,
              `lookup_${i2}`,
              `Match column "${p2.left}" is not available`,
              { missingColumn: p2.left }
            ));
          }
          if (p2.right && !rt.cols.includes(p2.right)) {
            resolved = false;
            issues.push(mkIssue(
              `lookup_${i2}_kp${pi}_right`,
              "lookup",
              `lookup_${i2}`,
              `lookup_${i2}`,
              `Match column "${p2.right}" not found in "${rt.name}"`,
              { missingColumn: p2.right }
            ));
          }
        }
      }
      const hasCompleteKeyPair = (lk.keyPairs || []).some((p2) => p2 && p2.left && p2.right);
      if (rt && !hasCompleteKeyPair) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i2}_no_key_pairs`,
          "lookup",
          `lookup_${i2}`,
          `lookup_${i2}`,
          `Lookup "${rt.name}" has no complete match column pair`
        ));
      }
      const dupErr = checkLookupDuplicates(lk);
      if (dupErr) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i2}_dup_keys`,
          "duplicateKeys",
          "pipeline",
          `lookup_${i2}`,
          dupErr,
          { lookupIndex: i2 }
        ));
      }
      mkItem(`lookup_${i2}`, enabled, resolved, issues);
    }
    for (let i2 = 0; i2 < (db.calcStages || []).length; i2++) {
      const c2 = db.calcStages[i2];
      const enabled = c2.enabled !== false;
      const alias = (c2.alias || "").trim();
      let resolved = true;
      const issues = [];
      if (!alias) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i2}_no_alias`,
          "calculatedColumn",
          `calc_${i2}`,
          `calc_${i2}`,
          `Calculated column has no alias`
        ));
      } else if (!projected.has(alias)) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i2}_unresolved`,
          "calculatedColumn",
          `calc_${i2}`,
          `calc_${i2}`,
          `Calculated column "${alias}" \u2014 one or more source columns are not available`
        ));
      }
      const calcErr = checkCalcError(c2, i2);
      if (calcErr) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i2}_expr_error`,
          "calcError",
          "pipeline",
          `calc_${i2}`,
          calcErr,
          { calcIndex: i2 }
        ));
      }
      mkItem(`calc_${i2}`, enabled, resolved, issues);
    }
    for (let i2 = 0; i2 < (db.filters || []).length; i2++) {
      const f2 = db.filters[i2];
      const enabled = f2.enabled !== false;
      let resolved = true;
      const issues = [];
      if (f2.col && !projected.has(f2.col)) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i2}_missing_col`,
          "filter",
          "filterSort",
          `filter_${i2}`,
          `Filter column "${f2.col}" is not available`,
          { missingColumn: f2.col }
        ));
      }
      if (!Array.isArray(f2.vals)) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i2}_bad_vals`,
          "filter",
          "filterSort",
          `filter_${i2}`,
          `Filter "${f2.col || "(no column)"}" has malformed values`
        ));
      } else if (f2.vals.some((v2) => typeof v2 !== "string")) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i2}_bad_vals`,
          "filter",
          "filterSort",
          `filter_${i2}`,
          `Filter "${f2.col || "(no column)"}" has malformed values`
        ));
      }
      mkItem(`filter_${i2}`, enabled, resolved, issues);
    }
    for (let i2 = 0; i2 < (db.sorts || []).length; i2++) {
      const s2 = db.sorts[i2];
      const enabled = s2.enabled !== false;
      let resolved = true;
      const issues = [];
      if (s2.col && !projected.has(s2.col)) {
        resolved = false;
        issues.push(mkIssue(
          `sort_${i2}_missing_col`,
          "sort",
          "filterSort",
          `sort_${i2}`,
          `Sort column "${s2.col}" is not available`,
          { missingColumn: s2.col }
        ));
      }
      mkItem(`sort_${i2}`, enabled, resolved, issues);
    }
    if (db.aggMode === "group") {
      for (let i2 = 0; i2 < (db.groupBy || []).length; i2++) {
        const col = db.groupBy[i2];
        const resolved = projected.has(col);
        const issues = [];
        if (!resolved) {
          issues.push(mkIssue(
            `groupby_${i2}_missing_col`,
            "groupBy",
            "aggregation",
            `groupby_${i2}`,
            `Group-by column "${col}" is not available`,
            { missingColumn: col }
          ));
        }
        mkItem(`groupby_${i2}`, true, resolved, issues);
      }
      for (let i2 = 0; i2 < (db.aggregates || []).length; i2++) {
        const agg = db.aggregates[i2];
        const issues = [];
        let resolved = true;
        const needsCol = aggregateNeedsColumn(agg.fn);
        if (needsCol && agg.col && agg.col !== "*" && !projected.has(agg.col)) {
          resolved = false;
          issues.push(mkIssue(
            `agg_${i2}_missing_col`,
            "aggregate",
            "aggregation",
            `agg_${i2}`,
            `Aggregate column "${agg.col}" is not available`,
            { missingColumn: agg.col }
          ));
        }
        if (!isValidAggregateFn(agg.fn)) {
          resolved = false;
          issues.push(mkIssue(
            `agg_${i2}_invalid_fn`,
            "aggregate",
            "aggregation",
            `agg_${i2}`,
            `Unknown aggregate function "${agg.fn}"`
          ));
        }
        mkItem(`agg_${i2}`, true, resolved, issues);
      }
    }
    if (db.aggMode === "totals") {
      const colMap = buildColSourceMap();
      for (const [col, fn] of Object.entries(db.colTotals || {})) {
        if (!fn || fn === "skip") continue;
        let resolved = projected.has(col);
        const issues = [];
        if (!resolved) {
          issues.push(mkIssue(
            `totals_${col}_missing_col`,
            "totals",
            "aggregation",
            `totals_${col}`,
            `Totals column "${col}" is not available`,
            { missingColumn: col }
          ));
        }
        if (!isValidTotalFn(fn)) {
          resolved = false;
          issues.push(mkIssue(
            `totals_${col}_invalid_fn`,
            "totals",
            "aggregation",
            `totals_${col}`,
            `Unknown totals function "${fn}" for column "${col}"`
          ));
        }
        const src = colMap.get(col);
        if (src?.kind === "calc") {
          const calcObj = src.calc;
          const mathOp = calcObj?.mathOp;
          if (mathOp === "PCTTOTAL" || mathOp === "ROLLAVG") {
            issues.push(mkIssue(
              `totals_${col}_advanced_calc`,
              "totals",
              "aggregation",
              `totals_${col}`,
              `"${col}" is a ${mathOp === "PCTTOTAL" ? "% of Total" : "Rolling Average"} calculated column \u2014 set its total function to "Skip" to avoid incorrect results`
            ));
          }
        }
        mkItem(`totals_${col}`, true, resolved, issues);
      }
    }
    if (db.aggMode === "subtotals") {
      const strat = db.subtotalStrategy;
      if (strat !== void 0 && strat !== "combined" && strat !== "nested") {
        mkItem("subtotalStrategy", true, false, [
          mkIssue(
            "subtotalStrategy_invalid",
            "subtotalStrategy",
            "aggregation",
            "subtotalStrategy",
            `Unknown subtotal strategy "${strat}"`
          )
        ]);
      }
      for (let i2 = 0; i2 < (db.subtotalBy || []).length; i2++) {
        const col = db.subtotalBy[i2];
        const resolved = projected.has(col);
        const issues = [];
        if (!resolved) {
          issues.push(mkIssue(
            `subtotalby_${i2}_missing_col`,
            "subtotalBy",
            "aggregation",
            `subtotalby_${i2}`,
            `Subtotal group column "${col}" is not available`,
            { missingColumn: col }
          ));
        }
        mkItem(`subtotalby_${i2}`, true, resolved, issues);
      }
      const subColMap = buildColSourceMap();
      for (const [col, fn] of Object.entries(db.subtotalFns || {})) {
        if (!fn || fn === "skip") continue;
        let resolved = projected.has(col);
        const issues = [];
        if (!resolved) {
          issues.push(mkIssue(
            `subtotalfns_${col}_missing_col`,
            "subtotalFns",
            "aggregation",
            `subtotalfns_${col}`,
            `Subtotal column "${col}" is not available`,
            { missingColumn: col }
          ));
        }
        if (!isValidSubtotalFn(fn)) {
          resolved = false;
          issues.push(mkIssue(
            `subtotalfns_${col}_invalid_fn`,
            "subtotalFns",
            "aggregation",
            `subtotalfns_${col}`,
            `Unknown subtotals function "${fn}" for column "${col}"`
          ));
        }
        const src = subColMap.get(col);
        if (src?.kind === "calc") {
          const calcObj = src.calc;
          const mathOp = calcObj?.mathOp;
          if (mathOp === "PCTTOTAL" || mathOp === "ROLLAVG") {
            issues.push(mkIssue(
              `subtotalfns_${col}_advanced_calc`,
              "subtotalFns",
              "aggregation",
              `subtotalfns_${col}`,
              `"${col}" is a ${mathOp === "PCTTOTAL" ? "% of Total" : "Rolling Average"} calculated column \u2014 set its subtotal function to "Skip" to avoid incorrect results`
            ));
          }
        }
        mkItem(`subtotalfns_${col}`, true, resolved, issues);
      }
    }
    const outputAliases = /* @__PURE__ */ new Set();
    if (db.aggMode === "group") {
      for (const agg of db.aggregates || []) {
        if (agg.alias) outputAliases.add(agg.alias);
      }
    }
    for (const calc of db.calcStages || []) {
      if (calc.alias) outputAliases.add(calc.alias);
    }
    const colOrderItems = (db.colOrder || []).filter((a2) => !projected.has(a2) && !outputAliases.has(a2));
    for (let i2 = 0; i2 < colOrderItems.length; i2++) {
      const col = colOrderItems[i2];
      const issues = [mkIssue(
        `colorder_${i2}_stale`,
        "outputColumn",
        "outputColumns",
        `colorder_${col}`,
        `Output column "${col}" is no longer available`,
        { missingColumn: col }
      )];
      const inSelCols = db.selCols instanceof Set ? db.selCols.has(col) : true;
      mkItem(`colorder_${col}`, inSelCols, false, issues);
    }
    for (const col of db.mergedCols || []) {
      if (!projected.has(col)) {
        const issues = [mkIssue(
          `merge_${col}_missing`,
          "mergeDisplay",
          "outputColumns",
          `merge_${col}`,
          `Merge-display column "${col}" is not available`,
          { missingColumn: col }
        )];
        mkItem(`merge_${col}`, true, true, issues);
      }
    }
    function cardFor(itemId) {
      if (itemId === "base" || itemId === "aggMode" || itemId.startsWith("stack_") || itemId.startsWith("lookup_") || itemId.startsWith("calc_")) return "pipeline";
      if (itemId.startsWith("filter_") || itemId.startsWith("sort_")) return "filterSort";
      if (itemId.startsWith("groupby_") || itemId.startsWith("agg_") || itemId.startsWith("totals_") || itemId.startsWith("subtotalby_") || itemId.startsWith("subtotalfns_")) return "aggregation";
      if (itemId.startsWith("colorder_") || itemId.startsWith("merge_")) return "outputColumns";
      return "other";
    }
    const cards = {};
    for (const [itemId, item] of Object.entries(items)) {
      const cid = cardFor(itemId);
      if (!cards[cid]) cards[cid] = { status: "healthy", issues: [] };
      if (item.blocking) cards[cid].status = "blocked";
      cards[cid].issues.push(...item.issues);
    }
    const reportBlocked = Object.values(items).some((i2) => i2.blocking);
    return {
      reportStatus: reportBlocked ? "blocked" : "healthy",
      cards,
      items
    };
  }
  if (typeof window !== "undefined") window.getValidation = getValidation;
  if (typeof window !== "undefined") window.invalidateValidation = invalidateValidation;

  // js/query/query-plan.ts
  function buildQueryPlan(reportSpec, columnCatalog, validation, sourceCatalog) {
    if (!(sourceCatalog instanceof Map)) throw new Error("buildQueryPlan: sourceCatalog (Map) is required");
    const ctx = reportSpec || db;
    columnCatalog = columnCatalog || buildColumnCatalog(ctx, sourceCatalog);
    validation = validation || (typeof getValidation === "function" ? getValidation() : null);
    const colMap = columnCatalog.colMap;
    const tablesById = /* @__PURE__ */ new Map();
    if (sourceCatalog instanceof Map) {
      for (const [tid, entry] of sourceCatalog) {
        tablesById.set(tid, { cols: entry.cols || [], name: entry.name || tid });
      }
    }
    const base = ctx.base || "";
    const stacks = (ctx.stacks || []).filter((id) => tablesById.has(id));
    const baseCols = ctx.baseCols || (tablesById.has(base) ? tablesById.get(base).cols : null);
    const source = {
      base,
      stacks,
      baseCols,
      excludedRows: ctx.excludedRows || {},
      tablesById
    };
    const lookups = ctx.lookups || [];
    const joins = lookups.filter((lk) => lk.enabled !== false && lk.rightId && tablesById.has(lk.rightId)).map((lk) => {
      const rtMeta = tablesById.get(lk.rightId);
      return {
        rightId: lk.rightId,
        rightColumns: rtMeta ? rtMeta.cols : [],
        rightTableName: rtMeta ? rtMeta.name : lk.rightId,
        keyPairs: (lk.keyPairs || []).filter((p2) => p2.left && p2.right),
        required: !!lk.required,
        duplicatePolicy: lk.duplicatePolicy || { mode: "block" },
        excludedRows: (ctx.excludedRows || {})[lk.rightId] || null
      };
    }).filter((j2) => j2.keyPairs.length > 0);
    const calculatedColumns = [...colMap.values()].filter((e2) => e2.kind === "calc");
    const filters = (ctx.filters || []).filter((f2) => f2.enabled !== false && f2.col);
    const colOrder = ctx.colOrder;
    const aggMode = ctx.aggMode || "none";
    const aggregates = ctx.aggregates || [];
    const aggAliases = aggMode === "group" ? aggregates.map((a2) => a2.alias).filter((a2) => a2) : [];
    const orderedAliases = colOrder ? colOrder.filter((a2) => colMap.has(a2) || aggAliases.includes(a2)) : [...colMap.keys(), ...aggAliases];
    const rawSelCols = ctx.selCols;
    const selCols = rawSelCols instanceof Set ? rawSelCols : null;
    const selectedColumns = selCols ? orderedAliases.filter((a2) => selCols.has(a2)) : orderedAliases;
    const sorts = (ctx.sorts || []).filter((s2) => s2.enabled !== false && s2.col && colMap.has(s2.col));
    return {
      source,
      joins,
      calculatedColumns,
      filters,
      selectedColumns,
      groupBy: ctx.groupBy || [],
      aggregates: ctx.aggregates || [],
      sorts,
      colTotals: ctx.colTotals || {},
      subtotalBy: ctx.subtotalBy || [],
      subtotalFns: ctx.subtotalFns || {},
      subtotalGrandTotal: ctx.subtotalGrandTotal !== false,
      subtotalSpacer: !!ctx.subtotalSpacer,
      subtotalOnTop: !!ctx.subtotalOnTop,
      subtotalStrategy: ctx.subtotalStrategy || "combined",
      aggMode: ctx.aggMode || "none",
      colMap,
      validation
    };
  }

  // js/report/engine.ts
  function runDetailMode(plan) {
    const { sql, params, cols } = renderDetailSql(plan);
    const rows = execQuery(sql, params);
    return buildResultSet(cols, rows, { aggMode: "none" });
  }
  function runTotalsMode(plan) {
    const detail = renderDetailSql(plan);
    const detailRows = execQuery(detail.sql, detail.params);
    const totals = renderTotalsSql(plan, detail.cols);
    if (!totals) {
      return buildResultSet(detail.cols, detailRows, { aggMode: "totals" });
    }
    const totalsRows = execQuery(totals.sql, totals.params);
    const newAggCols = totals.cols.slice(detail.cols.length);
    const paddedRows = newAggCols.length ? detailRows.map((r2) => {
      const row = Object.assign({}, r2);
      newAggCols.forEach((c2) => {
        row[c2] = null;
      });
      return row;
    }) : detailRows;
    return buildResultSet(totals.cols, paddedRows, { aggMode: "totals", totalsRow: totalsRows[0] || null });
  }
  function runSubtotalsMode(plan) {
    const result = renderSubtotalsSql(plan);
    if (!result) throw new Error("No output columns configured for subtotals view.");
    const rows = execQuery(result.sql, result.params);
    return buildResultSet(result.displayCols, rows, {
      aggMode: "subtotals",
      hasSubtotals: true,
      allCols: result.cols
    });
  }
  function runGroupedMode(plan) {
    const { sql, params, cols } = renderGroupedSql(plan);
    const rows = execQuery(sql, params);
    return buildResultSet(cols, rows, { aggMode: "group" });
  }
  var modeRunners = {
    none: runDetailMode,
    totals: runTotalsMode,
    subtotals: runSubtotalsMode,
    group: runGroupedMode
  };
  function runReport(reportSpec) {
    reportSpec = reportSpec || db;
    const validation = getValidation();
    if (validation && validation.reportStatus === "blocked") {
      return null;
    }
    const sourceCatalog = buildSourceCatalog();
    const columnCatalog = buildColumnCatalog(reportSpec, sourceCatalog);
    const plan = buildQueryPlan(reportSpec, columnCatalog, validation, sourceCatalog);
    return modeRunners[plan.aggMode](plan);
  }
  if (typeof window !== "undefined") window.runReport = runReport;
  if (typeof window !== "undefined") window.executeReport = runReport;

  // js/ui/components/modal.ts
  var activeModal = null;
  function showModal(options) {
    const {
      id = "modal-" + Date.now(),
      title = "",
      content = "",
      buttons = [],
      onClose,
      closeOnBackdrop = true,
      className = ""
    } = options;
    if (activeModal) {
      closeModal();
    }
    const modal = document.createElement("div");
    modal.id = id;
    modal.className = `modal ${className}`;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const titleHtml = title ? `<div class="modal-title">${h(title)}</div>` : "";
    const buttonsHtml = buttons.length ? `<div class="modal-buttons">
        ${buttons.map((btn, i2) => {
      const classes = ["btn", btn.primary ? "btn-primary" : "btn-ghost", btn.className || ""].filter(Boolean).join(" ");
      return `<button class="${classes}" data-btn-index="${i2}">${h(btn.label)}</button>`;
    }).join("")}
       </div>` : "";
    modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      ${titleHtml}
      <div class="modal-body">${content}</div>
      ${buttonsHtml}
    </div>
  `;
    document.body.appendChild(modal);
    activeModal = modal;
    const backdrop = modal.querySelector(".modal-backdrop");
    if (closeOnBackdrop && backdrop) {
      backdrop.addEventListener("click", () => {
        closeModal();
        onClose?.();
      });
    }
    buttons.forEach((btn, i2) => {
      const button = modal.querySelector(`[data-btn-index="${i2}"]`);
      if (button) {
        button.addEventListener("click", () => {
          btn.action();
        });
      }
    });
    const firstButton = modal.querySelector("button");
    if (firstButton) {
      firstButton.focus();
    } else {
      modal.focus();
    }
    const handleEscape = (e2) => {
      if (e2.key === "Escape") {
        closeModal();
        onClose?.();
        document.removeEventListener("keydown", handleEscape);
      }
    };
    document.addEventListener("keydown", handleEscape);
  }
  function closeModal() {
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
  }

  // js/ui/components/rename-modal.ts
  function resolveRenameTarget(alias) {
    const colMap = buildColSourceMap();
    const src = colMap.get(alias);
    if (!src) return null;
    if (src.kind === "calc") {
      return { alias, calcIdx: src.idx };
    }
    return { alias, tid: src.tid, col: src.col };
  }
  function renameSourceCol(tid, col, onDone) {
    const colMap = buildColSourceMap();
    for (const [alias, src] of colMap.entries()) {
      if (src.kind !== "calc" && src.tid === tid && src.col === col) {
        showRenameModal({ alias, tid, col }, onDone);
        return;
      }
    }
  }
  function showRenameModal(target, onDone) {
    const isCalc = target.calcIdx != null;
    let current;
    if (isCalc) {
      const calc = Array.isArray(db.calcStages) ? db.calcStages[target.calcIdx] : null;
      current = (calc?.alias || "").trim() || target.alias;
    } else {
      current = db.columnLabels?.[target.tid]?.[target.col] || "";
    }
    const inputId = "renameInput-" + Date.now();
    showModal({
      title: "Rename column",
      content: `<label for="${inputId}" style="font-size:0.78rem;color:var(--muted)">Current name</label>
      <input type="text" id="${inputId}" class="rename-modal-input" value="${h(current || target.alias)}">`,
      buttons: [
        {
          label: "Cancel",
          action: () => closeModal()
        },
        {
          label: "Rename",
          primary: true,
          action: () => {
            const inp = document.getElementById(inputId);
            if (!inp) {
              closeModal();
              return;
            }
            const newName = inp.value.trim();
            if (isCalc) {
              if (newName && newName !== current) {
                const calc = Array.isArray(db.calcStages) ? db.calcStages[target.calcIdx] : null;
                if (calc) {
                  calc.alias = newName;
                  _renameProjectedAliasRefs(current, newName);
                }
              }
            } else {
              setColLabel(target.tid, target.col, newName);
            }
            closeModal();
            onDone?.();
          }
        }
      ],
      closeOnBackdrop: true,
      onClose: () => {
      }
    });
    requestAnimationFrame(() => {
      const inp = document.getElementById(inputId);
      if (inp) {
        inp.focus();
        inp.select();
        inp.addEventListener("keydown", (e2) => {
          if (e2.key === "Enter") {
            e2.preventDefault();
            const btn = inp.closest(".modal-content")?.querySelector(".btn-primary");
            btn?.click();
          }
        });
      }
    });
  }

  // js/ui/utils/dom.ts
  var elementCache = /* @__PURE__ */ new Map();
  function $(id) {
    if (!elementCache.has(id)) {
      elementCache.set(id, document.getElementById(id));
    }
    return elementCache.get(id) || null;
  }

  // js/ui/components/context-menu.ts
  var activeCtxMenu = null;
  function _hideTooltip() {
    const tipBox = document.querySelector('[style*="z-index: 9500"]');
    if (tipBox) tipBox.style.display = "none";
  }
  function isContextMenuOpen() {
    return activeCtxMenu !== null;
  }
  function showContextMenu(x2, y2, items) {
    closeContextMenu();
    _hideTooltip();
    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.style.left = x2 + "px";
    menu.style.top = y2 + "px";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "ctx-menu-item";
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        closeContextMenu();
        item.action();
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    activeCtxMenu = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = x2 - rect.width + "px";
    if (rect.bottom > window.innerHeight) menu.style.top = y2 - rect.height + "px";
    const close = (e2) => {
      if (!menu.isConnected) return;
      if (!menu.contains(e2.target)) {
        menu.remove();
        if (activeCtxMenu === menu) activeCtxMenu = null;
      }
    };
    setTimeout(() => {
      document.addEventListener("click", close, { once: true });
      document.addEventListener("contextmenu", close, { once: true });
    }, 0);
  }
  function closeContextMenu() {
    if (activeCtxMenu) {
      activeCtxMenu.remove();
      activeCtxMenu = null;
    }
  }

  // node_modules/preact/dist/preact.module.js
  var n;
  var l;
  var u;
  var t;
  var i;
  var r;
  var o;
  var e;
  var f;
  var c;
  var a;
  var s;
  var h2;
  var p;
  var v;
  var y;
  var d = {};
  var w = [];
  var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
  var g = Array.isArray;
  function m(n2, l2) {
    for (var u3 in l2) n2[u3] = l2[u3];
    return n2;
  }
  function b(n2) {
    n2 && n2.parentNode && n2.parentNode.removeChild(n2);
  }
  function x(n2, t2, i2, r2, o2) {
    var e2 = { type: n2, props: t2, key: i2, ref: r2, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o2 ? ++u : o2, __i: -1, __u: 0 };
    return null == o2 && null != l.vnode && l.vnode(e2), e2;
  }
  function S(n2) {
    return n2.children;
  }
  function C(n2, l2) {
    this.props = n2, this.context = l2;
  }
  function $2(n2, l2) {
    if (null == l2) return n2.__ ? $2(n2.__, n2.__i + 1) : null;
    for (var u3; l2 < n2.__k.length; l2++) if (null != (u3 = n2.__k[l2]) && null != u3.__e) return u3.__e;
    return "function" == typeof n2.type ? $2(n2) : null;
  }
  function I(n2) {
    if (n2.__P && n2.__d) {
      var u3 = n2.__v, t2 = u3.__e, i2 = [], r2 = [], o2 = m({}, u3);
      o2.__v = u3.__v + 1, l.vnode && l.vnode(o2), q(n2.__P, o2, u3, n2.__n, n2.__P.namespaceURI, 32 & u3.__u ? [t2] : null, i2, null == t2 ? $2(u3) : t2, !!(32 & u3.__u), r2), o2.__v = u3.__v, o2.__.__k[o2.__i] = o2, D(i2, o2, r2), u3.__e = u3.__ = null, o2.__e != t2 && P(o2);
    }
  }
  function P(n2) {
    if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l2) {
      if (null != l2 && null != l2.__e) return n2.__e = n2.__c.base = l2.__e;
    }), P(n2);
  }
  function A(n2) {
    (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
  }
  function H() {
    try {
      for (var n2, l2 = 1; i.length; ) i.length > l2 && i.sort(e), n2 = i.shift(), l2 = i.length, I(n2);
    } finally {
      i.length = H.__r = 0;
    }
  }
  function L(n2, l2, u3, t2, i2, r2, o2, e2, f2, c2, a2) {
    var s2, h4, p2, v2, y2, _2, g2, m2 = t2 && t2.__k || w, b2 = l2.length;
    for (f2 = T(u3, l2, m2, f2, b2), s2 = 0; s2 < b2; s2++) null != (p2 = u3.__k[s2]) && (h4 = -1 != p2.__i && m2[p2.__i] || d, p2.__i = s2, _2 = q(n2, p2, h4, i2, r2, o2, e2, f2, c2, a2), v2 = p2.__e, p2.ref && h4.ref != p2.ref && (h4.ref && J(h4.ref, null, p2), a2.push(p2.ref, p2.__c || v2, p2)), null == y2 && null != v2 && (y2 = v2), (g2 = !!(4 & p2.__u)) || h4.__k === p2.__k ? (f2 = j(p2, f2, n2, g2), g2 && h4.__e && (h4.__e = null)) : "function" == typeof p2.type && void 0 !== _2 ? f2 = _2 : v2 && (f2 = v2.nextSibling), p2.__u &= -7);
    return u3.__e = y2, f2;
  }
  function T(n2, l2, u3, t2, i2) {
    var r2, o2, e2, f2, c2, a2 = u3.length, s2 = a2, h4 = 0;
    for (n2.__k = new Array(i2), r2 = 0; r2 < i2; r2++) null != (o2 = l2[r2]) && "boolean" != typeof o2 && "function" != typeof o2 ? ("string" == typeof o2 || "number" == typeof o2 || "bigint" == typeof o2 || o2.constructor == String ? o2 = n2.__k[r2] = x(null, o2, null, null, null) : g(o2) ? o2 = n2.__k[r2] = x(S, { children: o2 }, null, null, null) : void 0 === o2.constructor && o2.__b > 0 ? o2 = n2.__k[r2] = x(o2.type, o2.props, o2.key, o2.ref ? o2.ref : null, o2.__v) : n2.__k[r2] = o2, f2 = r2 + h4, o2.__ = n2, o2.__b = n2.__b + 1, e2 = null, -1 != (c2 = o2.__i = O(o2, u3, f2, s2)) && (s2--, (e2 = u3[c2]) && (e2.__u |= 2)), null == e2 || null == e2.__v ? (-1 == c2 && (i2 > a2 ? h4-- : i2 < a2 && h4++), "function" != typeof o2.type && (o2.__u |= 4)) : c2 != f2 && (c2 == f2 - 1 ? h4-- : c2 == f2 + 1 ? h4++ : (c2 > f2 ? h4-- : h4++, o2.__u |= 4))) : n2.__k[r2] = null;
    if (s2) for (r2 = 0; r2 < a2; r2++) null != (e2 = u3[r2]) && 0 == (2 & e2.__u) && (e2.__e == t2 && (t2 = $2(e2)), K(e2, e2));
    return t2;
  }
  function j(n2, l2, u3, t2) {
    var i2, r2;
    if ("function" == typeof n2.type) {
      for (i2 = n2.__k, r2 = 0; i2 && r2 < i2.length; r2++) i2[r2] && (i2[r2].__ = n2, l2 = j(i2[r2], l2, u3, t2));
      return l2;
    }
    n2.__e != l2 && (t2 && (l2 && n2.type && !l2.parentNode && (l2 = $2(n2)), u3.insertBefore(n2.__e, l2 || null)), l2 = n2.__e);
    do {
      l2 = l2 && l2.nextSibling;
    } while (null != l2 && 8 == l2.nodeType);
    return l2;
  }
  function O(n2, l2, u3, t2) {
    var i2, r2, o2, e2 = n2.key, f2 = n2.type, c2 = l2[u3], a2 = null != c2 && 0 == (2 & c2.__u);
    if (null === c2 && null == e2 || a2 && e2 == c2.key && f2 == c2.type) return u3;
    if (t2 > (a2 ? 1 : 0)) {
      for (i2 = u3 - 1, r2 = u3 + 1; i2 >= 0 || r2 < l2.length; ) if (null != (c2 = l2[o2 = i2 >= 0 ? i2-- : r2++]) && 0 == (2 & c2.__u) && e2 == c2.key && f2 == c2.type) return o2;
    }
    return -1;
  }
  function z(n2, l2, u3) {
    "-" == l2[0] ? n2.setProperty(l2, null == u3 ? "" : u3) : n2[l2] = null == u3 ? "" : "number" != typeof u3 || _.test(l2) ? u3 : u3 + "px";
  }
  function N(n2, l2, u3, t2, i2) {
    var r2, o2;
    n: if ("style" == l2) if ("string" == typeof u3) n2.style.cssText = u3;
    else {
      if ("string" == typeof t2 && (n2.style.cssText = t2 = ""), t2) for (l2 in t2) u3 && l2 in u3 || z(n2.style, l2, "");
      if (u3) for (l2 in u3) t2 && u3[l2] == t2[l2] || z(n2.style, l2, u3[l2]);
    }
    else if ("o" == l2[0] && "n" == l2[1]) r2 = l2 != (l2 = l2.replace(s, "$1")), o2 = l2.toLowerCase(), l2 = o2 in n2 || "onFocusOut" == l2 || "onFocusIn" == l2 ? o2.slice(2) : l2.slice(2), n2.l || (n2.l = {}), n2.l[l2 + r2] = u3, u3 ? t2 ? u3[a] = t2[a] : (u3[a] = h2, n2.addEventListener(l2, r2 ? v : p, r2)) : n2.removeEventListener(l2, r2 ? v : p, r2);
    else {
      if ("http://www.w3.org/2000/svg" == i2) l2 = l2.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if ("width" != l2 && "height" != l2 && "href" != l2 && "list" != l2 && "form" != l2 && "tabIndex" != l2 && "download" != l2 && "rowSpan" != l2 && "colSpan" != l2 && "role" != l2 && "popover" != l2 && l2 in n2) try {
        n2[l2] = null == u3 ? "" : u3;
        break n;
      } catch (n3) {
      }
      "function" == typeof u3 || (null == u3 || false === u3 && "-" != l2[4] ? n2.removeAttribute(l2) : n2.setAttribute(l2, "popover" == l2 && 1 == u3 ? "" : u3));
    }
  }
  function V(n2) {
    return function(u3) {
      if (this.l) {
        var t2 = this.l[u3.type + n2];
        if (null == u3[c]) u3[c] = h2++;
        else if (u3[c] < t2[a]) return;
        return t2(l.event ? l.event(u3) : u3);
      }
    };
  }
  function q(n2, u3, t2, i2, r2, o2, e2, f2, c2, a2) {
    var s2, h4, p2, v2, y2, d2, _2, k, x2, M, $3, I2, P2, A2, H2, T2 = u3.type;
    if (void 0 !== u3.constructor) return null;
    128 & t2.__u && (c2 = !!(32 & t2.__u), o2 = [f2 = u3.__e = t2.__e]), (s2 = l.__b) && s2(u3);
    n: if ("function" == typeof T2) try {
      if (k = u3.props, x2 = T2.prototype && T2.prototype.render, M = (s2 = T2.contextType) && i2[s2.__c], $3 = s2 ? M ? M.props.value : s2.__ : i2, t2.__c ? _2 = (h4 = u3.__c = t2.__c).__ = h4.__E : (x2 ? u3.__c = h4 = new T2(k, $3) : (u3.__c = h4 = new C(k, $3), h4.constructor = T2, h4.render = Q), M && M.sub(h4), h4.state || (h4.state = {}), h4.__n = i2, p2 = h4.__d = true, h4.__h = [], h4._sb = []), x2 && null == h4.__s && (h4.__s = h4.state), x2 && null != T2.getDerivedStateFromProps && (h4.__s == h4.state && (h4.__s = m({}, h4.__s)), m(h4.__s, T2.getDerivedStateFromProps(k, h4.__s))), v2 = h4.props, y2 = h4.state, h4.__v = u3, p2) x2 && null == T2.getDerivedStateFromProps && null != h4.componentWillMount && h4.componentWillMount(), x2 && null != h4.componentDidMount && h4.__h.push(h4.componentDidMount);
      else {
        if (x2 && null == T2.getDerivedStateFromProps && k !== v2 && null != h4.componentWillReceiveProps && h4.componentWillReceiveProps(k, $3), u3.__v == t2.__v || !h4.__e && null != h4.shouldComponentUpdate && false === h4.shouldComponentUpdate(k, h4.__s, $3)) {
          u3.__v != t2.__v && (h4.props = k, h4.state = h4.__s, h4.__d = false), u3.__e = t2.__e, u3.__k = t2.__k, u3.__k.some(function(n3) {
            n3 && (n3.__ = u3);
          }), w.push.apply(h4.__h, h4._sb), h4._sb = [], h4.__h.length && e2.push(h4);
          break n;
        }
        null != h4.componentWillUpdate && h4.componentWillUpdate(k, h4.__s, $3), x2 && null != h4.componentDidUpdate && h4.__h.push(function() {
          h4.componentDidUpdate(v2, y2, d2);
        });
      }
      if (h4.context = $3, h4.props = k, h4.__P = n2, h4.__e = false, I2 = l.__r, P2 = 0, x2) h4.state = h4.__s, h4.__d = false, I2 && I2(u3), s2 = h4.render(h4.props, h4.state, h4.context), w.push.apply(h4.__h, h4._sb), h4._sb = [];
      else do {
        h4.__d = false, I2 && I2(u3), s2 = h4.render(h4.props, h4.state, h4.context), h4.state = h4.__s;
      } while (h4.__d && ++P2 < 25);
      h4.state = h4.__s, null != h4.getChildContext && (i2 = m(m({}, i2), h4.getChildContext())), x2 && !p2 && null != h4.getSnapshotBeforeUpdate && (d2 = h4.getSnapshotBeforeUpdate(v2, y2)), A2 = null != s2 && s2.type === S && null == s2.key ? E(s2.props.children) : s2, f2 = L(n2, g(A2) ? A2 : [A2], u3, t2, i2, r2, o2, e2, f2, c2, a2), h4.base = u3.__e, u3.__u &= -161, h4.__h.length && e2.push(h4), _2 && (h4.__E = h4.__ = null);
    } catch (n3) {
      if (u3.__v = null, c2 || null != o2) if (n3.then) {
        for (u3.__u |= c2 ? 160 : 128; f2 && 8 == f2.nodeType && f2.nextSibling; ) f2 = f2.nextSibling;
        o2[o2.indexOf(f2)] = null, u3.__e = f2;
      } else {
        for (H2 = o2.length; H2--; ) b(o2[H2]);
        B(u3);
      }
      else u3.__e = t2.__e, u3.__k = t2.__k, n3.then || B(u3);
      l.__e(n3, u3, t2);
    }
    else null == o2 && u3.__v == t2.__v ? (u3.__k = t2.__k, u3.__e = t2.__e) : f2 = u3.__e = G(t2.__e, u3, t2, i2, r2, o2, e2, c2, a2);
    return (s2 = l.diffed) && s2(u3), 128 & u3.__u ? void 0 : f2;
  }
  function B(n2) {
    n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
  }
  function D(n2, u3, t2) {
    for (var i2 = 0; i2 < t2.length; i2++) J(t2[i2], t2[++i2], t2[++i2]);
    l.__c && l.__c(u3, n2), n2.some(function(u4) {
      try {
        n2 = u4.__h, u4.__h = [], n2.some(function(n3) {
          n3.call(u4);
        });
      } catch (n3) {
        l.__e(n3, u4.__v);
      }
    });
  }
  function E(n2) {
    return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : void 0 !== n2.constructor ? null : m({}, n2);
  }
  function G(u3, t2, i2, r2, o2, e2, f2, c2, a2) {
    var s2, h4, p2, v2, y2, w2, _2, m2 = i2.props || d, k = t2.props, x2 = t2.type;
    if ("svg" == x2 ? o2 = "http://www.w3.org/2000/svg" : "math" == x2 ? o2 = "http://www.w3.org/1998/Math/MathML" : o2 || (o2 = "http://www.w3.org/1999/xhtml"), null != e2) {
      for (s2 = 0; s2 < e2.length; s2++) if ((y2 = e2[s2]) && "setAttribute" in y2 == !!x2 && (x2 ? y2.localName == x2 : 3 == y2.nodeType)) {
        u3 = y2, e2[s2] = null;
        break;
      }
    }
    if (null == u3) {
      if (null == x2) return document.createTextNode(k);
      u3 = document.createElementNS(o2, x2, k.is && k), c2 && (l.__m && l.__m(t2, e2), c2 = false), e2 = null;
    }
    if (null == x2) m2 === k || c2 && u3.data == k || (u3.data = k);
    else {
      if (e2 = "textarea" == x2 && null != k.defaultValue ? null : e2 && n.call(u3.childNodes), !c2 && null != e2) for (m2 = {}, s2 = 0; s2 < u3.attributes.length; s2++) m2[(y2 = u3.attributes[s2]).name] = y2.value;
      for (s2 in m2) y2 = m2[s2], "dangerouslySetInnerHTML" == s2 ? p2 = y2 : "children" == s2 || s2 in k || "value" == s2 && "defaultValue" in k || "checked" == s2 && "defaultChecked" in k || N(u3, s2, null, y2, o2);
      for (s2 in k) y2 = k[s2], "children" == s2 ? v2 = y2 : "dangerouslySetInnerHTML" == s2 ? h4 = y2 : "value" == s2 ? w2 = y2 : "checked" == s2 ? _2 = y2 : c2 && "function" != typeof y2 || m2[s2] === y2 || N(u3, s2, y2, m2[s2], o2);
      if (h4) c2 || p2 && (h4.__html == p2.__html || h4.__html == u3.innerHTML) || (u3.innerHTML = h4.__html), t2.__k = [];
      else if (p2 && (u3.innerHTML = ""), L("template" == t2.type ? u3.content : u3, g(v2) ? v2 : [v2], t2, i2, r2, "foreignObject" == x2 ? "http://www.w3.org/1999/xhtml" : o2, e2, f2, e2 ? e2[0] : i2.__k && $2(i2, 0), c2, a2), null != e2) for (s2 = e2.length; s2--; ) b(e2[s2]);
      c2 && "textarea" != x2 || (s2 = "value", "progress" == x2 && null == w2 ? u3.removeAttribute("value") : null != w2 && (w2 !== u3[s2] || "progress" == x2 && !w2 || "option" == x2 && w2 != m2[s2]) && N(u3, s2, w2, m2[s2], o2), s2 = "checked", null != _2 && _2 != u3[s2] && N(u3, s2, _2, m2[s2], o2));
    }
    return u3;
  }
  function J(n2, u3, t2) {
    try {
      if ("function" == typeof n2) {
        var i2 = "function" == typeof n2.__u;
        i2 && n2.__u(), i2 && null == u3 || (n2.__u = n2(u3));
      } else n2.current = u3;
    } catch (n3) {
      l.__e(n3, t2);
    }
  }
  function K(n2, u3, t2) {
    var i2, r2;
    if (l.unmount && l.unmount(n2), (i2 = n2.ref) && (i2.current && i2.current != n2.__e || J(i2, null, u3)), null != (i2 = n2.__c)) {
      if (i2.componentWillUnmount) try {
        i2.componentWillUnmount();
      } catch (n3) {
        l.__e(n3, u3);
      }
      i2.base = i2.__P = null;
    }
    if (i2 = n2.__k) for (r2 = 0; r2 < i2.length; r2++) i2[r2] && K(i2[r2], u3, t2 || "function" != typeof n2.type);
    t2 || b(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
  }
  function Q(n2, l2, u3) {
    return this.constructor(n2, u3);
  }
  n = w.slice, l = { __e: function(n2, l2, u3, t2) {
    for (var i2, r2, o2; l2 = l2.__; ) if ((i2 = l2.__c) && !i2.__) try {
      if ((r2 = i2.constructor) && null != r2.getDerivedStateFromError && (i2.setState(r2.getDerivedStateFromError(n2)), o2 = i2.__d), null != i2.componentDidCatch && (i2.componentDidCatch(n2, t2 || {}), o2 = i2.__d), o2) return i2.__E = i2;
    } catch (l3) {
      n2 = l3;
    }
    throw n2;
  } }, u = 0, t = function(n2) {
    return null != n2 && void 0 === n2.constructor;
  }, C.prototype.setState = function(n2, l2) {
    var u3;
    u3 = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state), "function" == typeof n2 && (n2 = n2(m({}, u3), this.props)), n2 && m(u3, n2), null != n2 && this.__v && (l2 && this._sb.push(l2), A(this));
  }, C.prototype.forceUpdate = function(n2) {
    this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
  }, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l2) {
    return n2.__v.__b - l2.__v.__b;
  }, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, a = "__a" + f, s = /(PointerCapture)$|Capture$/i, h2 = 0, p = V(false), v = V(true), y = 0;

  // js/ui/components/chip.tsx
  function renderChip(options) {
    const {
      col,
      label,
      colorClass = "",
      selected = false,
      draggable = true,
      tooltip = "",
      badge = "",
      badgeTooltip = "",
      className = "",
      chipClass = "chip",
      dataAttrs,
      inlineStyle
    } = options;
    const classes = [chipClass, selected ? "on" : "", colorClass, className].filter(Boolean).join(" ");
    const badgeHtml = badge ? ` <span class="chip-warn-badge" data-autowarn="${col}" title="${badgeTooltip}">${badge}</span>` : "";
    const draggableAttr = draggable ? 'draggable="true"' : "";
    const tooltipAttr = tooltip ? `data-tip="${tooltip}"` : "";
    const styleAttr = inlineStyle ? `style="${inlineStyle}"` : "";
    const extraAttrs = dataAttrs ? Object.entries(dataAttrs).map(([k, v2]) => `${k}="${v2}"`).join(" ") : "";
    return `<span class="${classes}" ${draggableAttr} data-col="${col}" ${extraAttrs} ${tooltipAttr} ${styleAttr}>${label}${badgeHtml}</span>`;
  }
  function getChipCol(chip) {
    return chip.dataset.col || null;
  }

  // js/ui/components/tip.tsx
  function renderTip(text) {
    return `<span class="tip" data-tip="${text}">?</span>`;
  }

  // js/ui/utils/events.ts
  function delegate(parent, selector, event, handler) {
    parent.addEventListener(event, ((e2) => {
      const target = e2.target.closest(selector);
      if (target && parent.contains(target)) {
        handler(target, e2);
      }
    }));
  }

  // js/query/layout-selection.ts
  var _seenCols = /* @__PURE__ */ new Set();
  var _previewOpen = /* @__PURE__ */ new Set();
  var _disabledCardCols = /* @__PURE__ */ new Set();
  function _sampleTipFor(tid, col, extra = []) {
    const tbl = db.tables?.[tid];
    const vals = (tbl?.samples?.[col] || []).slice(0, 3).map((v2) => String(v2));
    return [
      `From sheet: ${tbl?.name || tid}`,
      vals.length ? `Sample values: ${vals.join(" \xB7 ")}` : "Sample values: (none found)",
      ...extra
    ].join("\n");
  }
  function _isSourceVisibleInLayout(tid, col, colMap, mode) {
    const selCols = db.selCols;
    if (!(selCols instanceof Set)) return true;
    let seen = false;
    for (const [alias, src] of colMap.entries()) {
      if (!src || src.kind === "calc") continue;
      if (src.tid !== tid || src.col !== col) continue;
      seen = true;
      if (selCols.has(alias)) return true;
    }
    return !seen;
  }
  function _setLayoutAliasesForSourceVisibility(tid, col = null, isVisible = true) {
    if (!tid) return;
    const aliases = projectedCols();
    let selCols = db.selCols;
    if (!(selCols instanceof Set)) {
      selCols = new Set(aliases);
      db.selCols = selCols;
    }
    const colMap = buildColSourceMap();
    for (const alias of aliases) {
      const src = colMap.get(alias);
      if (!src || src.kind === "calc") continue;
      if (src.tid !== tid) continue;
      if (col !== null && src.col !== col) continue;
      if (isVisible) selCols.add(alias);
      else selCols.delete(alias);
    }
  }
  function _showLayoutAliasesForSource(tid, col = null) {
    _setLayoutAliasesForSourceVisibility(tid, col, true);
  }
  function _hideLayoutAliasesForSource(tid, col = null) {
    _setLayoutAliasesForSourceVisibility(tid, col, false);
  }
  function _lookupColumnUsedElsewhere(tid, col, excludeLookupIndex = -1) {
    const lookups = Array.isArray(db.lookups) ? db.lookups : [];
    for (let i2 = 0; i2 < lookups.length; i2++) {
      if (i2 === excludeLookupIndex) continue;
      const lk = lookups[i2];
      if (!lk || lk.rightId !== tid) continue;
      if (Array.isArray(lk.cols) && lk.cols.includes(col)) return true;
    }
    return false;
  }
  function _hideLookupLayoutAliasesSafely(tid, col = null, excludeLookupIndex = -1) {
    const rt = tid ? db.tables?.[tid] : null;
    if (!rt || !Array.isArray(rt.cols)) return;
    const cols = col === null ? rt.cols : [col];
    for (const c2 of cols) {
      if (_lookupColumnUsedElsewhere(tid, c2, excludeLookupIndex)) continue;
      _hideLayoutAliasesForSource(tid, c2);
    }
  }
  function _isAliasVisibleInLayout(alias, mode) {
    if (!alias) return true;
    const selCols = db.selCols;
    if (!(selCols instanceof Set)) return true;
    return selCols.has(alias);
  }
  function _syncSubtotalByToLayout() {
    if (!Array.isArray(db.subtotalBy) || !db.subtotalBy.length) return;
    const order = Array.isArray(db.colOrder) ? db.colOrder : projectedCols();
    const orderIdx = new Map(order.map((c2, i2) => [c2, i2]));
    const seen = /* @__PURE__ */ new Set();
    db.subtotalBy = db.subtotalBy.filter((c2) => orderIdx.has(c2) && !seen.has(c2) && (seen.add(c2), true)).sort((a2, b2) => (orderIdx.get(a2) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b2) ?? Number.MAX_SAFE_INTEGER));
  }
  function _afterCombineChange() {
    invalidateValidation();
    const nowCols = projectedCols();
    const selCols = db.selCols;
    if (selCols) {
      nowCols.forEach((c2) => {
        if (!_seenCols.has(c2)) {
          selCols.add(c2);
          _seenCols.add(c2);
        }
      });
      const nowSet = new Set(nowCols);
      for (const c2 of [...selCols]) {
        if (!nowSet.has(c2) && !_disabledCardCols.has(c2)) selCols.delete(c2);
      }
    }
    const colOrder = db.colOrder;
    if (!colOrder) {
      db.colOrder = [...nowCols];
    } else {
      const nowSet = new Set(nowCols);
      db.colOrder = [
        ...colOrder.filter((c2) => nowSet.has(c2)),
        ...nowCols.filter((c2) => !colOrder.includes(c2))
      ];
    }
    _syncSubtotalByToLayout();
    renderQueryBuilder();
  }

  // js/ui/components/calc-builder.ts
  function renderMathBuilder(ctx) {
    const { calc, i: i2, colOptsFor } = ctx;
    const math = calc.math;
    const steps = math?.steps || [];
    const firstStep = steps[0] || {};
    const hasOperators = steps.length > 1;
    const mathOp = hasOperators ? steps[1]?.op || "+" : "+";
    const leftCol = firstStep.type === "column" ? firstStep.value || "" : "";
    const rightCol = hasOperators && steps[1]?.type === "column" ? steps[1].value || "" : "";
    const isRollingAvg = calc.mathOp === "ROLLAVG";
    const isPctTotal = calc.mathOp === "PCTTOTAL";
    const windowVal = Math.max(1, parseInt(calc.window || "7", 10) || 7);
    return `
    <div class="pl-key-pair" style="margin-top:8px">
      <span class="pl-key-pair-label">Type</span>
      <select data-ci="${i2}" data-cp="mathOp" style="width:140px;flex-shrink:0">
        <option value="ARITH" ${!isRollingAvg && !isPctTotal ? "selected" : ""}>Arithmetic</option>
        <option value="ROLLAVG" ${isRollingAvg ? "selected" : ""}>Rolling Avg</option>
        <option value="PCTTOTAL" ${isPctTotal ? "selected" : ""}>% of Total</option>
      </select>
    </div>
    ${!isRollingAvg && !isPctTotal ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <select data-ci="${i2}" data-cp="leftCol" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
      <select data-ci="${i2}" data-cp="mathOperator" style="width:70px;flex-shrink:0">
        <option value="+" ${mathOp === "+" ? "selected" : ""}>+</option>
        <option value="-" ${mathOp === "-" ? "selected" : ""}>\u2212</option>
        <option value="*" ${mathOp === "*" ? "selected" : ""}>\xD7</option>
        <option value="/" ${mathOp === "/" ? "selected" : ""}>\xF7</option>
      </select>
      <select data-ci="${i2}" data-cp="rightCol" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(rightCol)}
      </select>
    </div>` : ""}
    ${isRollingAvg ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i2}" data-cp="leftCol" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
      <span class="pl-key-pair-label" style="margin-left:6px">Window</span>
      <input type="number" min="1" step="1" value="${windowVal}" data-ci="${i2}" data-cp="window" style="width:80px;flex-shrink:0">
    </div>` : ""}
    ${isPctTotal ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i2}" data-cp="leftCol" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
    </div>` : ""}`;
  }
  function renderTextBuilder(ctx) {
    const { calc, i: i2, colOptsFor } = ctx;
    const text = calc.text;
    const op = text?.operation || "combine";
    if (op === "combine") {
      const parts = text?.parts || [];
      return `
      <div style="margin-top:8px;font-size:0.76rem;color:var(--muted)">Combine parts: ${parts.length} part(s)</div>
      <div style="margin-top:4px;font-size:0.7rem;color:var(--muted)">Edit via report setup file for complex combinations.</div>`;
    }
    if (op === "left" || op === "right") {
      const src = text?.source;
      const srcCol = src?.type === "column" ? src.value || "" : "";
      const count = text?.count || 1;
      return `
      <div class="pl-key-pair" style="margin-top:8px">
        <span class="pl-key-pair-label">Source</span>
        <select data-ci="${i2}" data-cp="textSource" style="min-width:190px">
          <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
        </select>
        <span class="pl-key-pair-label" style="margin-left:6px">Count</span>
        <input type="number" min="1" step="1" value="${count}" data-ci="${i2}" data-cp="textCount" style="width:80px;flex-shrink:0">
      </div>`;
    }
    if (op === "substring") {
      const src = text?.source;
      const srcCol = src?.type === "column" ? src.value || "" : "";
      const start = text?.start || 1;
      const length = text?.length || 1;
      return `
      <div class="pl-key-pair" style="margin-top:8px">
        <span class="pl-key-pair-label">Source</span>
        <select data-ci="${i2}" data-cp="textSource" style="min-width:190px">
          <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
        </select>
      </div>
      <div class="pl-key-pair" style="margin-top:4px">
        <span class="pl-key-pair-label">Start</span>
        <input type="number" min="1" step="1" value="${start}" data-ci="${i2}" data-cp="textStart" style="width:80px;flex-shrink:0">
        <span class="pl-key-pair-label" style="margin-left:6px">Length</span>
        <input type="number" min="1" step="1" value="${length}" data-ci="${i2}" data-cp="textLength" style="width:80px;flex-shrink:0">
      </div>`;
    }
    return "";
  }
  function renderCompareBuilder(ctx) {
    const { calc, i: i2, colOptsFor } = ctx;
    const compare = calc.compare;
    const glue = compare?.compareMode || "AND";
    const conditions = compare?.conditions || [];
    const trueVal = compare?.trueValue;
    const falseVal = compare?.falseValue;
    const COND_OPS = ["=", "!=", ">", ">=", "<", "<="];
    const condOptsFor = (selOp) => COND_OPS.map((o2) => `<option value="${h(o2)}" ${selOp === o2 ? "selected" : ""}>${h(o2)}</option>`).join("");
    const conditionsHtml = conditions.map((cond, j2) => `
    <div class="pl-key-pair" style="margin-top:${j2 === 0 ? "6px" : "4px"}">
      <span class="pl-key-pair-label">${j2 === 0 ? "Where" : glue}</span>
      <select data-ci="${i2}" data-cond="${j2}" data-cp="col" style="min-width:140px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(cond.col || "")}
      </select>
      <select data-ci="${i2}" data-cond="${j2}" data-cp="op" style="width:62px;flex-shrink:0">
        ${condOptsFor(cond.op || "=")}
      </select>
      <input type="text" data-ci="${i2}" data-cond="${j2}" data-cp="val" placeholder="value" value="${h(cond.val || "")}" style="min-width:100px">
    </div>`).join("");
    return `
    <div class="pl-key-pair" style="margin-top:8px">
      <span class="pl-key-pair-label">Match</span>
      <select data-ci="${i2}" data-cp="compareMode" style="width:80px;flex-shrink:0">
        <option value="AND" ${glue === "AND" ? "selected" : ""}>ALL</option>
        <option value="OR" ${glue === "OR" ? "selected" : ""}>ANY</option>
      </select>
      <span style="font-size:0.72rem;color:var(--muted)">of these conditions:</span>
    </div>
    ${conditionsHtml}
    <div style="margin-top:6px;font-size:0.72rem;color:var(--muted)">
      Returns: ${trueVal?.type === "text" ? `"${h(trueVal.value || "")}"` : trueVal?.value || "1"} if match, ${falseVal?.type === "text" ? `"${h(falseVal.value || "")}"` : falseVal?.value || "0"} if not
    </div>`;
  }
  function renderDateBuilder(ctx) {
    const { calc, i: i2, colOptsFor } = ctx;
    const date = calc.date;
    const src = date?.source;
    const srcCol = src?.type === "column" ? src.value || "" : "";
    const part = date?.part || "year";
    const output = date?.output || "text";
    const textOnly = part === "year" || part === "week";
    const shortDisabled = textOnly ? " disabled" : "";
    const fullDisabled = textOnly ? " disabled" : "";
    return `
    <div class="pl-key-pair" style="margin-top:8px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i2}" data-cp="dateSource" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
      </select>
    </div>
    <div class="pl-key-pair" style="margin-top:4px">
      <span class="pl-key-pair-label">Extract</span>
      <select data-ci="${i2}" data-cp="datePart" style="width:140px;flex-shrink:0">
        <option value="year" ${part === "year" ? "selected" : ""}>Year</option>
        <option value="month" ${part === "month" ? "selected" : ""}>Month</option>
        <option value="day" ${part === "day" ? "selected" : ""}>Day</option>
        <option value="dow" ${part === "dow" ? "selected" : ""}>Day of Week</option>
        <option value="week" ${part === "week" ? "selected" : ""}>Week</option>
        <option value="quarter" ${part === "quarter" ? "selected" : ""}>Quarter</option>
        <option value="julian" ${part === "julian" ? "selected" : ""}>Julian Date</option>
      </select>
    </div>
    <div class="pl-key-pair" style="margin-top:4px">
      <span class="pl-key-pair-label">Format</span>
      <div class="tab-row" style="margin-left:0">
        <label class="tab-opt"><input type="radio" name="dateOutput_${i2}" value="number" ${output === "number" ? "checked" : ""} data-ci="${i2}" data-cp="dateOutput"><span>Number</span></label>
        <label class="tab-opt${textOnly ? " tab-opt--disabled" : ""}"><input type="radio" name="dateOutput_${i2}" value="short" ${output === "short" ? "checked" : ""}${shortDisabled} data-ci="${i2}" data-cp="dateOutput"><span>Short</span></label>
        <label class="tab-opt${textOnly ? " tab-opt--disabled" : ""}"><input type="radio" name="dateOutput_${i2}" value="text" ${output === "text" && !textOnly ? "checked" : ""}${fullDisabled} data-ci="${i2}" data-cp="dateOutput"><span>Full</span></label>
      </div>
    </div>`;
  }
  var calcModeRenderers = {
    math: renderMathBuilder,
    text: renderTextBuilder,
    compare: renderCompareBuilder,
    date: renderDateBuilder
  };

  // js/ui/views/pipeline-card.ts
  var lookupPropHandlers = {
    enabled: (lk, inp) => {
      const wasEnabled = lk.enabled !== false;
      const nowEnabled = inp.checked;
      lk.enabled = nowEnabled;
      if (wasEnabled && !nowEnabled) {
        const rt = lk.rightId && db.tables[lk.rightId];
        if (rt && db.selCols instanceof Set) {
          const colMap = buildColSourceMap();
          const savedAliases = /* @__PURE__ */ new Set();
          for (const col of rt.cols) {
            if (_isSourceVisibleInLayout(lk.rightId, col, colMap, db.aggMode || "none")) {
              for (const [alias, src] of colMap.entries()) {
                if (src && src.kind !== "calc" && src.tid === lk.rightId && src.col === col) {
                  savedAliases.add(alias);
                }
              }
            }
          }
          lk._prevSelState = savedAliases;
          for (const alias of savedAliases) _disabledCardCols.add(alias);
        }
      } else if (!wasEnabled && nowEnabled) {
        const saved = lk._prevSelState;
        if (saved && db.selCols instanceof Set) {
          for (const alias of saved) {
            db.selCols.add(alias);
            _disabledCardCols.delete(alias);
          }
        }
        delete lk._prevSelState;
      }
    },
    rightId: (lk, inp, i2) => {
      const prevRightId = lk.rightId;
      lk.rightId = inp.value;
      lk.keyPairs = [{ left: "", right: "" }];
      const rt = lk.rightId && db.tables[lk.rightId];
      lk.cols = rt ? [...rt.cols] : [];
      if (prevRightId && prevRightId !== lk.rightId) _hideLookupLayoutAliasesSafely(prevRightId, null, i2);
      if (lk.rightId) _showLayoutAliasesForSource(lk.rightId);
    },
    required: (lk, inp) => {
      lk.required = inp.value === "1";
    },
    dupMode: (lk, inp) => {
      if (!lk.duplicatePolicy) lk.duplicatePolicy = { mode: "block" };
      lk.duplicatePolicy.mode = inp.value;
    },
    kpLeft: (lk, inp) => {
      const pi = +inp.dataset.lkp;
      if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [{ left: "", right: "" }];
      if (!lk.keyPairs[pi]) lk.keyPairs[pi] = { left: "", right: "" };
      lk.keyPairs[pi].left = inp.value;
    },
    kpRight: (lk, inp) => {
      const pi = +inp.dataset.lkp;
      if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [{ left: "", right: "" }];
      if (!lk.keyPairs[pi]) lk.keyPairs[pi] = { left: "", right: "" };
      lk.keyPairs[pi].right = inp.value;
    }
  };
  var calcPropHandlers = {
    enabled: (c2, inp) => {
      const wasEnabled = c2.enabled !== false;
      const nowEnabled = inp.checked;
      c2.enabled = nowEnabled;
      const alias = (c2.alias || "").trim();
      if (!alias) return;
      if (wasEnabled && !nowEnabled) {
        if (db.selCols instanceof Set && _isAliasVisibleInLayout(alias, db.aggMode || "none")) {
          c2._prevSelState = true;
          _disabledCardCols.add(alias);
        } else {
          c2._prevSelState = false;
        }
      } else if (!wasEnabled && nowEnabled) {
        if (c2._prevSelState && db.selCols instanceof Set) {
          db.selCols.add(alias);
          _disabledCardCols.delete(alias);
        }
        delete c2._prevSelState;
      }
    },
    alias: (c2, inp) => {
      const oldAlias = (c2.alias || "").trim();
      c2.alias = inp.value;
      const newAlias = (c2.alias || "").trim();
      _renameProjectedAliasRefs(oldAlias, newAlias);
    },
    mode: (c2, inp) => {
      const newMode = inp.value;
      c2.mode = newMode;
      delete c2.math;
      delete c2.compare;
      delete c2.text;
      delete c2.date;
      const modeDefaults = {
        math: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] }),
        text: () => ({ operation: "combine", parts: [{ type: "column", value: "" }] }),
        compare: () => ({ compareMode: "AND", conditions: [{ col: "", op: "=", val: "" }], trueValue: { type: "number", value: "1" }, falseValue: { type: "number", value: "0" } }),
        date: () => ({ operation: "extract", source: { type: "column", value: "" }, part: "year", output: "number" })
      };
      c2[newMode] = modeDefaults[newMode]();
    },
    mathOp: (c2, inp) => {
      const mathOp = inp.value;
      c2.mathOp = mathOp;
      const mathOpDefaults = {
        ARITH: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] }),
        ROLLAVG: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }] }),
        PCTTOTAL: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }] })
      };
      c2.math = mathOpDefaults[mathOp]?.();
    },
    mathOperator: (c2, inp) => {
      const math = c2.math;
      if (math?.steps) {
        if (math.steps.length < 2) {
          math.steps.push({ type: "column", value: "", op: inp.value });
        } else {
          math.steps[1].op = inp.value;
        }
      }
    },
    leftCol: (c2, inp) => {
      const math = c2.math;
      if (math?.steps && math.steps.length > 0) {
        math.steps[0] = { type: "column", value: inp.value };
      }
    },
    rightCol: (c2, inp) => {
      const math = c2.math;
      if (math?.steps) {
        if (math.steps.length < 2) {
          math.steps.push({ type: "column", value: "", op: "+" });
        }
        math.steps[1] = { ...math.steps[1], type: "column", value: inp.value };
      }
    },
    window: (c2, inp) => {
      c2.window = String(Math.max(1, parseInt(inp.value, 10) || 7));
    },
    textSource: (c2, inp) => {
      const text = c2.text;
      if (text) {
        text.source = { type: "column", value: inp.value };
      }
    },
    textCount: (c2, inp) => {
      const text = c2.text;
      if (text) {
        text.count = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    textStart: (c2, inp) => {
      const text = c2.text;
      if (text) {
        text.start = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    textLength: (c2, inp) => {
      const text = c2.text;
      if (text) {
        text.length = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    compareMode: (c2, inp) => {
      const compare = c2.compare;
      if (compare) {
        compare.compareMode = inp.value;
      }
    },
    dateSource: (c2, inp) => {
      const date = c2.date;
      if (date) {
        date.source = { type: "column", value: inp.value };
      }
    },
    datePart: (c2, inp) => {
      const date = c2.date;
      if (date) {
        date.part = inp.value;
        if ((inp.value === "year" || inp.value === "week") && date.output !== "number") {
          date.output = "number";
        }
      }
    },
    dateOutput: (c2, inp) => {
      const date = c2.date;
      if (date) {
        date.output = inp.value;
      }
    }
  };
  var condPropHandlers = {
    col: (cond, inp) => {
      cond.col = inp.value;
    },
    op: (cond, inp) => {
      cond.op = inp.value;
    },
    val: (cond, inp) => {
      cond.val = inp.value;
    }
  };
  function renderPipeline(ids) {
    const pl = document.getElementById("pipeline");
    const sortedIds = ids.sort((a2, b2) => db.tables[a2].name.localeCompare(db.tables[b2].name));
    const usedAsLookup = new Set((db.lookups || []).map((l2) => l2.rightId).filter(Boolean));
    const usedAsStack = new Set(db.stacks || []);
    const layoutColMap = db.base && db.tables[db.base] ? buildColSourceMap() : /* @__PURE__ */ new Map();
    const layoutMode = db.aggMode || "none";
    const stackAvail = sortedIds.filter((id) => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));
    const lookupAvail = sortedIds.filter((id) => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));
    let html = "";
    const stackSheetsHtml = db.base && db.tables[db.base] ? `
    <div class="pl-stack-sheets" id="plStackSheets">
      ${(db.stacks || []).filter((id) => db.tables[id]).map((id) => `
        <span class="pl-stack-chip" style="border-left:3px solid ${getTableColor(id)}">
          ${h(db.tables[id].name)}
          <span class="rm" data-rmstack="${id}">\xD7</span>
        </span>`).join("")}
      ${stackAvail.length ? `
        <div class="pl-add-btn" id="plStackAddBtn">\uFF0B Include</div>
        <select class="pl-add-select" id="plStackSel" onchange="addStack(this.value)">
          <option value="">pick a sheet\u2026</option>
          ${stackAvail.map((id) => `<option value="${id}">${h(db.tables[id].name)}</option>`).join("")}
        </select>` : ""}
    </div>` : '<span style="font-size:0.76rem;color:var(--muted)">\u2190 Pick a sheet first</span>';
    const baseColChipsHtml = db.base && db.tables[db.base] ? (() => {
      const allCols = db.tables[db.base].cols;
      return `<div class="pl-lookup-cols" style="margin-top:6px">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Columns:</span>
      ${renderTip("Right-click any chip to rename it.")}
      ${allCols.map((c2) => {
        const isLayoutVisible = _isSourceVisibleInLayout(db.base, c2, layoutColMap, layoutMode);
        const color = getTableColor(db.base);
        const chipStyle = `background:${color};border-color:${color};color:${chipFgColor(color)}`;
        return renderChip({
          col: c2,
          label: colUserLabel(db.base, c2),
          selected: true,
          draggable: false,
          chipClass: "pl-col-chip",
          className: isLayoutVisible ? "" : "pl-col-chip-layout-hidden",
          tooltip: _sampleTipFor(db.base, c2, ["Click to show/hide this column in the report layout."]),
          dataAttrs: { "data-bcc": c2 },
          inlineStyle: chipStyle
        });
      }).join("")}
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-bc-all="1">All</button>
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-bc-none="1">None</button>
    </div>`;
    })() : "";
    html += `<div class="pl-top-pair">
    <div class="pl-stage">
      <div class="pl-stage-label">Start from</div>
      <div class="pl-base-row">
        <select id="baseSelect" onchange="onBaseChange(this.value)">
          <option value="">\u2014 select a sheet \u2014</option>
          ${sortedIds.map((id) => `<option value="${id}" ${db.base === id ? "selected" : ""}>${h(db.tables[id].name)}</option>`).join("")}
        </select>
      </div>
      ${baseColChipsHtml}
    </div>
    <div class="pl-h-arrow"><div class="pl-h-line"></div><div class="pl-h-head"></div></div>
    <div class="pl-stage">
      <div class="pl-stage-label">Include rows from ${renderTip("Add sheets with the same columns to get more rows. Like stacking spreadsheets on top of each other.")}</div>
      ${stackSheetsHtml}
    </div>
  </div>`;
    if (!db.base || !db.tables[db.base]) {
      pl.innerHTML = html;
      return;
    }
    html += _plArrow("base");
    (db.lookups || []).forEach((lk, i2) => {
      html += _plLookupStage(lk, i2, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode);
      html += _plArrow(`lk${i2}`);
    });
    (db.calcStages || []).forEach((calc, i2) => {
      html += _plCalcStage(calc, i2);
      html += _plArrow(`calc${i2}`);
    });
    html += `<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px">
    <div class="pl-add-btn" onclick="addLookup()">\uFF0B Look up columns from another sheet</div>
    <div class="pl-add-btn" onclick="addCalcStage()">\uFF0B Add a calculated column from existing sheets</div>
  </div>`;
    pl.innerHTML = html;
    const qs = (sel) => pl.querySelectorAll(sel);
    const addBtn = pl.querySelector("#plStackAddBtn");
    const addSel = pl.querySelector("#plStackSel");
    if (addBtn && addSel) {
      addBtn.addEventListener("click", () => {
        addSel.style.cssText = "position:absolute;opacity:1;pointer-events:auto;width:auto;height:auto";
        const r2 = addBtn.getBoundingClientRect();
        addSel.style.top = r2.bottom + window.scrollY + 2 + "px";
        addSel.style.left = r2.left + "px";
        document.body.appendChild(addSel);
        addSel.focus();
        addSel.addEventListener("blur", () => {
          addSel.style.cssText = "position:absolute;opacity:0;pointer-events:none;width:0;height:0";
          pl.querySelector("#plStackSheets")?.appendChild(addSel);
        }, { once: true });
      });
    }
    qs("[data-rmstack]").forEach((el) => {
      el.addEventListener("click", () => removeStack(el.dataset.rmstack));
    });
    qs("[data-rmlookup]").forEach((el) => {
      el.addEventListener("click", () => removeLookup(+el.dataset.rmlookup));
    });
    qs("[data-rmcalc]").forEach((el) => {
      el.addEventListener("click", () => removeCalcStage(+el.dataset.rmcalc));
    });
    qs("[data-rmlkp]").forEach((el) => {
      el.addEventListener("click", () => {
        const lk = db.lookups[+el.dataset.li];
        if (!lk || !Array.isArray(lk.keyPairs) || lk.keyPairs.length <= 1) return;
        lk.keyPairs.splice(+el.dataset.lkp, 1);
        _afterCombineChange();
      });
    });
    qs("[data-addlkp]").forEach((el) => {
      el.addEventListener("click", () => {
        const lk = db.lookups[+el.dataset.addlkp];
        if (!lk) return;
        if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [];
        lk.keyPairs.push({ left: "", right: "" });
        _afterCombineChange();
      });
    });
    qs("[data-li]").forEach((el) => {
      el.addEventListener("change", (e2) => {
        const t2 = e2.target;
        const i2 = +t2.dataset.li;
        const lp = t2.dataset.lp;
        if (!lp) return;
        const lk = db.lookups[i2];
        const inp = t2;
        const handler = lookupPropHandlers[lp];
        if (handler) {
          handler(lk, inp, i2, el);
          _afterCombineChange();
        }
      });
    });
    qs("[data-ci]").forEach((el) => {
      el.addEventListener("change", (e2) => {
        const t2 = e2.target;
        const i2 = +t2.dataset.ci;
        const cp = t2.dataset.cp;
        if (!cp) return;
        const c2 = db.calcStages?.[i2];
        if (!c2) return;
        const inp = t2;
        const handler = calcPropHandlers[cp];
        if (handler) {
          handler(c2, inp, i2);
          _afterCombineChange();
        }
      });
    });
    qs("[data-cond]").forEach((el) => {
      el.addEventListener("change", (e2) => {
        const t2 = e2.target;
        const i2 = +t2.dataset.ci;
        const j2 = +t2.dataset.cond;
        const cp = t2.dataset.cp;
        if (!cp) return;
        const c2 = db.calcStages?.[i2];
        if (!c2 || c2.mode !== "compare") return;
        const compare = c2.compare;
        if (!compare?.conditions?.[j2]) return;
        const inp = t2;
        const handler = condPropHandlers[cp];
        if (handler) {
          handler(compare.conditions[j2], inp);
          _afterCombineChange();
        }
      });
    });
    qs("[data-lcc]").forEach((el) => {
      el.addEventListener("click", () => {
        const i2 = +el.dataset.li;
        const col = el.dataset.lcc;
        const lk = db.lookups[i2];
        const colMap = buildColSourceMap();
        const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, col, colMap, db.aggMode || "none");
        if (isLayoutVisible) _hideLookupLayoutAliasesSafely(lk.rightId, col, i2);
        else _showLayoutAliasesForSource(lk.rightId, col);
        _afterCombineChange();
      });
    });
    qs("[data-bcc]").forEach((el) => {
      el.addEventListener("click", () => {
        const col = el.dataset.bcc;
        const colMap = buildColSourceMap();
        const isLayoutVisible = _isSourceVisibleInLayout(db.base, col, colMap, db.aggMode || "none");
        if (isLayoutVisible) _hideLayoutAliasesForSource(db.base, col);
        else _showLayoutAliasesForSource(db.base, col);
        _afterCombineChange();
      });
    });
    qs("[data-ccc]").forEach((el) => {
      el.addEventListener("click", () => {
        const i2 = +el.dataset.ci;
        const c2 = db.calcStages?.[i2];
        const alias = (c2?.alias || "").trim();
        if (!alias) return;
        if (!db.selCols) db.selCols = new Set(projectedCols());
        const s2 = db.selCols;
        if (s2.has(alias)) s2.delete(alias);
        else s2.add(alias);
        _afterCombineChange();
      });
    });
    delegate(pl, "[data-bcc]", "contextmenu", (el, e2) => {
      e2.preventDefault();
      showContextMenu(e2.clientX, e2.clientY, [
        { label: "Rename", action: () => renameSourceCol(db.base, el.dataset.bcc, () => _afterCombineChange()) }
      ]);
    });
    delegate(pl, "[data-lcc]", "contextmenu", (el, e2) => {
      e2.preventDefault();
      const lk = db.lookups[+el.dataset.li];
      if (!lk?.rightId) return;
      showContextMenu(e2.clientX, e2.clientY, [
        { label: "Rename", action: () => renameSourceCol(lk.rightId, el.dataset.lcc, () => _afterCombineChange()) }
      ]);
    });
    delegate(pl, "[data-ccc]", "contextmenu", (el, e2) => {
      e2.preventDefault();
      const c2 = db.calcStages?.[+el.dataset.ci];
      const alias = (c2?.alias || "").trim();
      if (!alias) return;
      showContextMenu(e2.clientX, e2.clientY, [
        { label: "Rename", action: () => {
          const target = resolveRenameTarget(alias);
          if (!target) return;
          showRenameModal(target, () => _afterCombineChange());
        } }
      ]);
    });
    pl.querySelector("[data-bc-all]")?.addEventListener("click", () => {
      _showLayoutAliasesForSource(db.base);
      _afterCombineChange();
    });
    pl.querySelector("[data-bc-none]")?.addEventListener("click", () => {
      _hideLayoutAliasesForSource(db.base);
      _afterCombineChange();
    });
    qs("[data-lk-all]").forEach((el) => {
      el.addEventListener("click", () => selectAllLookupCols(+el.dataset.lkAll));
    });
    qs("[data-lk-none]").forEach((el) => {
      el.addEventListener("click", () => selectNoneLookupCols(+el.dataset.lkNone));
    });
    qs("[data-preview]").forEach((el) => {
      el.addEventListener("click", () => togglePreview(el.dataset.preview));
    });
  }
  function _plArrow(key) {
    const isOpen = _previewOpen.has(key);
    return `<div class="pl-arrow">
    <div class="pl-arrow-line"></div>
    <div class="pl-arrow-meta">
      <button class="pl-preview-btn" data-preview="${key}">${isOpen ? "\u25B2 Hide preview" : "\u25BC Preview"}</button>
    </div>
    <div class="pl-arrow-line"></div>
    <div class="pl-arrow-head"></div>
    ${isOpen ? `<div class="pl-mini-preview" id="preview_${key}">${_buildPreviewHTML(key)}</div>` : ""}
  </div>`;
  }
  function _plLookupStage(lk, i2, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode) {
    const rt = lk.rightId && db.tables[lk.rightId];
    const leftCols = projectedColsUpToLookup(i2);
    const rightCols = rt ? rt.cols : [];
    if (!Array.isArray(lk.keyPairs) || !lk.keyPairs.length) lk.keyPairs = [{ left: "", right: "" }];
    const pairs = lk.keyPairs;
    const sheetOpts = sortedIds.filter((id) => id !== db.base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id)).map((id) => `<option value="${id}" ${lk.rightId === id ? "selected" : ""}>${h(db.tables[id].name)}</option>`).join("");
    const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : "";
    const lkColMap = buildColSourceMap();
    const leftOptsFor = (val) => leftCols.map((c2) => `<option value="${h(c2)}" ${val === c2 ? "selected" : ""}>${h(colDisplayLabel(c2, lkColMap))}</option>`).join("");
    const rightOptsFor = (val) => rightCols.map((c2) => `<option value="${h(c2)}" ${val === c2 ? "selected" : ""}>${h(`${db.tables[lk.rightId]?.name || lk.rightId} \u2192 ${colUserLabel(lk.rightId, c2)}`)}</option>`).join("");
    const keyPairsHTML = pairs.map((pair, pi) => `
    <div class="pl-key-pair">
      <span class="pl-key-pair-label">${pi === 0 ? "Where" : "AND"}</span>
      <select data-li="${i2}" data-lkp="${pi}" data-lp="kpLeft">
        <option value="">\u2014 column \u2014</option>${leftOptsFor(pair.left)}
      </select>
      <span class="pl-lookup-eq">=</span>
      <select data-li="${i2}" data-lkp="${pi}" data-lp="kpRight">
        <option value="">\u2014 column \u2014</option>${rightOptsFor(pair.right)}
      </select>
      ${pairs.length > 1 ? `<button class="pl-rm-kp" data-rmlkp="1" data-li="${i2}" data-lkp="${pi}" title="Remove this condition">\u2715</button>` : ""}
    </div>`).join("");
    const colChips = rt ? rt.cols.map((c2) => {
      const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c2, layoutColMap, layoutMode);
      return renderChip({
        col: c2,
        label: colUserLabel(lk.rightId, c2),
        selected: true,
        draggable: false,
        chipClass: "pl-col-chip",
        colorClass: lkColorCls,
        className: isLayoutVisible ? "" : "pl-col-chip-layout-hidden",
        tooltip: _sampleTipFor(lk.rightId, c2, ["Click to show/hide this lookup column in the report layout."]),
        dataAttrs: { "data-li": String(i2), "data-lcc": c2 }
      });
    }).join("") : "";
    const lkEnabled = lk.enabled !== false;
    const lkV = getValidation().items[`lookup_${i2}`];
    const lkVBlocked = lkV && lkV.blocking;
    const lkVUnresolved = lkV && !lkV.resolved;
    const lkVMsg = lkVUnresolved && lkV.issues[0] ? lkV.issues[0].message : null;
    return `<div class="pl-lookup-stage${lkVBlocked ? " pl-lookup-stage--invalid" : lkVUnresolved && !lkEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!lkEnabled ? "pl-stage-disabled" : ""}">
    <div class="pl-stage-label">Look up columns from ${renderTip("Pull columns from another sheet by matching a shared value \u2014 like VLOOKUP. Use '+ AND' to match on multiple columns at once.")}
      <label class="pl-enable-toggle" title="${lkEnabled ? "Disable this lookup (won't block report)" : "Enable this lookup"}"><input type="checkbox" data-li="${i2}" data-lp="enabled" ${lkEnabled ? "checked" : ""}><span class="pl-enable-label">${lkEnabled ? "Enabled" : "Disabled"}</span></label>
    </div>
    ${lkVMsg ? `<div class="pl-lookup-error">${lkVBlocked ? "\u26D4" : "\u26A0"} ${h(lkVMsg)}</div>` : ""}
    <div class="pl-lookup-header">
      <select data-li="${i2}" data-lp="rightId">
        <option value="">\u2014 pick a sheet \u2014</option>
        ${sheetOpts}
      </select>
      <button class="btn btn-danger" style="flex-shrink:0" data-rmlookup="${i2}">\u2715</button>
    </div>
    ${rt ? `
    <div class="pl-lookup-keys">
      ${keyPairsHTML}
      <button class="btn btn-ghost pl-add-kp" data-addlkp="${i2}">\uFF0B AND \u2026</button>
    </div>
    <div class="pl-lookup-required">
      <span style="flex-shrink:0">If no match:</span>
      <label><input type="radio" name="lkreq_${i2}" data-li="${i2}" data-lp="required" value="0" ${!lk.required ? "checked" : ""}> Leave blank</label>
      <label><input type="radio" name="lkreq_${i2}" data-li="${i2}" data-lp="required" value="1" ${lk.required ? "checked" : ""}> Skip row</label>
      ${renderTip("Leave blank: keep all rows even if no match.\nSkip row: only keep rows that match.")}
    </div>
    <div class="pl-lookup-required">
      <span style="flex-shrink:0">Duplicate keys:</span>
      <label><input type="radio" name="lkdup_${i2}" data-li="${i2}" data-lp="dupMode" value="block" ${(lk.duplicatePolicy && lk.duplicatePolicy.mode) !== "combine" ? "checked" : ""}> Block (error)</label>
      <label><input type="radio" name="lkdup_${i2}" data-li="${i2}" data-lp="dupMode" value="combine" ${(lk.duplicatePolicy && lk.duplicatePolicy.mode) === "combine" ? "checked" : ""}> Combine values</label>
      ${renderTip("Block: the report cannot run if the same key appears more than once in the lookup sheet.\nCombine: concatenate matching values into a single cell, e.g. 'Tag1; Tag2'.")}
    </div>
    <div class="pl-lookup-cols">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Bring in:</span>
      ${renderTip("Right-click any chip to rename it.")}
      ${colChips}
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-lk-all="${i2}">All</button>
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-lk-none="${i2}">None</button>
    </div>` : ""}
  </div>`;
  }
  function _plCalcStage(calc, i2) {
    const cols = projectedCols();
    const colMap = buildColSourceMap();
    const alias = (calc.alias || "").trim();
    const mode = calc.mode || "math";
    const calcEnabled = calc.enabled !== false;
    const calcV = getValidation().items[`calc_${i2}`];
    const calcVBlocked = calcV && calcV.blocking;
    const calcVUnresolved = calcV && !calcV.resolved;
    const calcVMsg = calcVUnresolved && calcV.issues[0] ? calcV.issues[0].message : null;
    const colOptsFor = (sel) => cols.filter((c2) => c2 !== alias).map((c2) => `<option value="${h(c2)}" ${sel === c2 ? "selected" : ""}>${h(colDisplayLabel(c2, colMap))}</option>`).join("");
    const builderCtx = { calc, i: i2, cols, colOptsFor };
    const builderHtml = calcModeRenderers[mode](builderCtx);
    return `<div class="pl-lookup-stage${calcVBlocked ? " pl-lookup-stage--invalid" : calcVUnresolved && !calcEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!calcEnabled ? "pl-stage-disabled" : ""}">
    <div class="pl-stage-label">Calculated column ${renderTip("Create a virtual column from existing columns.\nMath: arithmetic, rolling averages, percentages.\nText: string operations.\nCompare: conditional logic.\nDate: extract date parts.")}
      <label class="pl-enable-toggle" title="${calcEnabled ? "Disable this calculated column" : "Enable this calculated column"}"><input type="checkbox" data-ci="${i2}" data-cp="enabled" ${calcEnabled ? "checked" : ""}><span class="pl-enable-label">${calcEnabled ? "Enabled" : "Disabled"}</span></label>
    </div>
    ${calcVMsg ? `<div class="pl-lookup-error">${calcVBlocked ? "\u26D4" : "\u26A0"} ${h(calcVMsg)}</div>` : ""}
    <div class="pl-lookup-header" style="gap:8px;flex-wrap:wrap">
      <input type="text" data-ci="${i2}" data-cp="alias" placeholder="Output column name" value="${h(calc.alias || "")}" style="flex:1;min-width:180px">
      <button class="btn btn-danger" style="flex-shrink:0" data-rmcalc="${i2}">\u2715</button>
    </div>
    <div class="tab-row" style="margin-top:8px">
      <label class="tab-opt"><input type="radio" name="calcMode_${i2}" value="math" ${mode === "math" ? "checked" : ""} data-ci="${i2}" data-cp="mode"><span>Math</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i2}" value="text" ${mode === "text" ? "checked" : ""} data-ci="${i2}" data-cp="mode"><span>Text</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i2}" value="compare" ${mode === "compare" ? "checked" : ""} data-ci="${i2}" data-cp="mode"><span>Compare</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i2}" value="date" ${mode === "date" ? "checked" : ""} data-ci="${i2}" data-cp="mode"><span>Date</span></label>
    </div>
    ${builderHtml}
    ${alias ? `<div class="pl-lookup-cols" style="margin-top:8px">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Output:</span>
      ${renderTip("Right-click the chip to rename this column. The alias input above will update.")}
      ${renderChip({
      col: alias,
      label: colDisplayLabel(alias, colMap),
      selected: _isAliasVisibleInLayout(alias, db.aggMode || "none"),
      draggable: false,
      chipClass: "pl-col-chip",
      dataAttrs: { "data-ci": String(i2), "data-ccc": alias }
    })}
    </div>` : ""}
  </div>`;
  }

  // js/ui/views/output-card.ts
  function _buildTooltip(c2, src) {
    if (src?.kind === "calc") {
      const calc = db.calcStages?.[src.idx];
      const mode = calc?.mode || "unknown";
      if (mode === "math") {
        const math = calc.math;
        const steps = math?.steps?.length || 0;
        return `Calculated: Math (${steps} step${steps !== 1 ? "s" : ""})`;
      } else if (mode === "compare") {
        const compare = calc.compare;
        const condCount = compare?.conditions?.length || 0;
        const glue = compare?.compareMode || "AND";
        return `Calculated: Compare (${condCount} condition${condCount !== 1 ? "s" : ""}, ${glue})`;
      } else if (mode === "text") {
        const text = calc.text;
        return `Calculated: Text (${text?.operation || "unknown"})`;
      }
      return `Calculated: ${mode}`;
    }
    if (src && src.kind !== "calc") {
      const phys = src;
      const tbl = db.tables[phys.tid];
      const tblAny = tbl;
      const samples = tblAny.samples;
      const vals = (samples?.[phys.col] || []).slice(0, 3);
      const from = `From: ${tbl?.name ?? phys.tid}`;
      return vals.length ? `${from}
Sample: ${vals.map((v2) => String(v2)).join(" \xB7 ")}` : `${from}
(no sample values)`;
    }
    return "";
  }
  function renderColChips() {
    if (!db.base) return;
    const cols = projectedCols();
    const colMap = buildColSourceMap();
    const mode = db.aggMode || "none";
    if (!db.selCols) {
      db.selCols = new Set(cols);
      _seenCols.clear();
      cols.forEach((c2) => _seenCols.add(c2));
    }
    if (!db.colOrder) {
      db.colOrder = [...cols];
    } else {
      const colSet = new Set(cols);
      db.colOrder = [
        ...db.colOrder.filter((c2) => colSet.has(c2)),
        ...cols.filter((c2) => !db.colOrder.includes(c2))
      ];
    }
    _syncSubtotalByToLayout();
    const groupSet = new Set(db.groupBy);
    const showBadges = mode === "group" && groupSet.size > 0;
    const selSet = db.selCols;
    const colOrder = db.colOrder;
    $("colChips").innerHTML = colOrder.map((c2) => {
      const src = colMap.get(c2);
      const colorCls = src ? getTableColorClass(src.tid) : "";
      const label = colDisplayLabel(c2, colMap);
      if (selSet && !selSet.has(c2)) return "";
      const tip = _buildTooltip(c2, src);
      if (mode === "group") {
        const isOn2 = groupSet.has(c2);
        const hasAgg = db.aggregates.some((a2) => a2.col === c2);
        const isOrphan = showBadges && !isOn2 && !hasAgg;
        const badge = isOrphan ? "\u26A0" : "";
        const badgeTip = isOrphan ? "No calculation for this column \u2014 it will be dropped from results. Click \u26A0 to add one automatically." : "";
        return renderChip({
          col: c2,
          label,
          colorClass: colorCls,
          selected: isOn2,
          draggable: true,
          tooltip: tip,
          badge,
          badgeTooltip: badgeTip,
          className: isOrphan ? "chip-orphan" : ""
        });
      } else if (mode === "subtotals") {
        const isOn2 = (db.subtotalBy || []).includes(c2);
        return renderChip({ col: c2, label, colorClass: colorCls, selected: isOn2, draggable: true, tooltip: tip });
      }
      const isOn = selSet ? selSet.has(c2) : false;
      return renderChip({ col: c2, label, colorClass: colorCls, selected: isOn, draggable: true, tooltip: tip });
    }).join("");
    const btnRow = $("colBtnRow");
    if (btnRow) btnRow.style.display = mode === "group" || mode === "subtotals" ? "none" : "";
    const hint = $("colCardHint");
    if (hint) {
      if (mode === "group") {
        hint.textContent = "\u2014 double-click to group by \xB7 drag to reorder \xB7 right-click to rename";
      } else if (mode === "subtotals") {
        hint.textContent = "\u2014 double-click to group rows \xB7 drag to reorder \xB7 right-click to rename";
      } else {
        hint.textContent = "\u2014 double-click to show/hide \xB7 drag to reorder \xB7 right-click to rename";
      }
    }
  }
  if (typeof document !== "undefined") {
    let _chipAtPoint = function(el, x2, y2) {
      const chips = [...el.querySelectorAll("[data-col]")].filter((c2) => c2.dataset.col !== _dragCol);
      if (!chips.length) return null;
      const direct = document.elementFromPoint(x2, y2)?.closest("[data-col]");
      if (direct && direct.dataset.col !== _dragCol) return direct;
      const sameRow = chips.filter((c2) => {
        const r2 = c2.getBoundingClientRect();
        return y2 >= r2.top && y2 <= r2.bottom;
      });
      const pool = sameRow.length ? sameRow : chips;
      let best = null, bestDist = Infinity;
      for (const chip of pool) {
        const r2 = chip.getBoundingClientRect();
        const cx = (r2.left + r2.right) / 2;
        const cy = (r2.top + r2.bottom) / 2;
        const d2 = sameRow.length ? Math.abs(x2 - cx) : Math.hypot(x2 - cx, y2 - cy);
        if (d2 < bestDist) {
          bestDist = d2;
          best = chip;
        }
      }
      return best;
    };
    _chipAtPoint2 = _chipAtPoint;
    const container = () => $("colChips");
    let _dragCol = null;
    delegate(container(), "[data-autowarn]", "click", (badge, e2) => {
      e2.stopPropagation();
      const col = badge.dataset.autowarn;
      if (!db.aggregates.some((a2) => a2.col === col)) {
        db.aggregates.push({ fn: smartDefaultFn(col), col, alias: "", auto: true });
      }
      renderColChips();
      renderAggregateItems(projectedCols());
    });
    delegate(container(), ".chip[data-col]", "dblclick", (chip) => {
      const col = getChipCol(chip);
      const mode = db.aggMode || "none";
      if (mode === "group") {
        const idx = db.groupBy.indexOf(col);
        if (idx >= 0) {
          db.groupBy.splice(idx, 1);
          if (db.groupBy.length === 0) {
            db.aggregates = db.aggregates.filter((a2) => !a2.auto);
          } else if (!db.aggregates.some((a2) => a2.col === col)) {
            db.aggregates.push({ fn: smartDefaultFn(col), col, alias: "", auto: true });
          }
        } else {
          db.groupBy.push(col);
          db.aggregates = db.aggregates.filter((a2) => !(a2.auto && a2.col === col));
          const allCols = projectedCols();
          for (const c2 of allCols) {
            if (!db.groupBy.includes(c2) && !db.aggregates.some((a2) => a2.col === c2)) {
              db.aggregates.push({ fn: smartDefaultFn(c2), col: c2, alias: "", auto: true });
            }
          }
        }
        renderAggregation();
      } else if (mode === "subtotals") {
        const sb = db.subtotalBy || (db.subtotalBy = []);
        const idx = sb.indexOf(col);
        if (idx >= 0) {
          sb.splice(idx, 1);
          delete db.subtotalFns[col];
        } else {
          sb.push(col);
        }
        _syncSubtotalByToLayout();
        renderAggregation();
      } else {
        if (!db.selCols) db.selCols = new Set(projectedCols());
        const s2 = db.selCols;
        if (s2.has(col)) s2.delete(col);
        renderQueryBuilder();
      }
    });
    delegate(container(), ".chip[data-col]", "contextmenu", (chip, e2) => {
      e2.preventDefault();
      const alias = getChipCol(chip);
      showContextMenu(e2.clientX, e2.clientY, [
        {
          label: "Rename",
          action: () => {
            const target = resolveRenameTarget(alias);
            if (!target) return;
            showRenameModal(target, () => {
              renderQueryBuilder();
              if (db.result) renderResults(db.result);
            });
          }
        }
      ]);
    });
    delegate(container(), "[data-col]", "dragstart", (chip, e2) => {
      _dragCol = chip.dataset.col;
      chip.classList.add("dragging");
      if (e2.dataTransfer) e2.dataTransfer.effectAllowed = "move";
    });
    delegate(container(), "[data-col]", "dragend", () => {
      _dragCol = null;
      container().querySelectorAll(".chip").forEach((c2) => c2.classList.remove("dragging", "drag-over"));
    });
    delegate(container(), "[data-col]", "dragover", (_chip, e2) => {
      e2.preventDefault();
      if (e2.dataTransfer) e2.dataTransfer.dropEffect = "move";
      const nearest = _chipAtPoint(container(), e2.clientX, e2.clientY);
      container().querySelectorAll(".chip").forEach((c2) => c2.classList.remove("drag-over"));
      if (nearest) nearest.classList.add("drag-over");
    });
    delegate(container(), "[data-col]", "drop", (_chip, e2) => {
      e2.preventDefault();
      const nearest = _chipAtPoint(container(), e2.clientX, e2.clientY);
      if (!nearest || !_dragCol || nearest.dataset.col === _dragCol) return;
      if (!db.colOrder) db.colOrder = projectedCols();
      const from = db.colOrder.indexOf(_dragCol);
      const to = db.colOrder.indexOf(nearest.dataset.col);
      if (from < 0 || to < 0) return;
      db.colOrder.splice(from, 1);
      db.colOrder.splice(to, 0, _dragCol);
      _syncSubtotalByToLayout();
      renderQueryBuilder();
      if ((db.aggMode || "none") === "subtotals") {
        const projected = projectedCols();
        const ordered = Array.isArray(db.colOrder) ? db.colOrder.filter((c2) => projected.includes(c2)) : projected;
        renderSubtotalsSection(ordered);
      }
    });
  }
  var _chipAtPoint2;
  function selectAllCols() {
    db.selCols = new Set(projectedCols());
    renderColChips();
  }
  if (typeof window !== "undefined") window.selectAllCols = selectAllCols;
  function selectNoneCols() {
    db.selCols = /* @__PURE__ */ new Set();
    renderColChips();
  }
  if (typeof window !== "undefined") window.selectNoneCols = selectNoneCols;
  function renderMergeToggles(cols) {
    const wrap = $("mergeToggles");
    if (!wrap) return;
    const ulChk = $("chkMergeGroupUnderline");
    if (ulChk) ulChk.checked = !!db.mergeGroupUnderline;
    const baseDisplayCols = (cols || []).filter((c2) => c2 !== "_rowno" && c2 !== "_row_type" && c2 !== "_isTotalsRow");
    const visibleDisplayCols = db.selCols?.has ? baseDisplayCols.filter((c2) => db.selCols.has(c2)) : baseDisplayCols;
    const orderedFromLayout = Array.isArray(db.colOrder) ? db.colOrder.filter((c2) => visibleDisplayCols.includes(c2)) : [];
    const displayCols = [
      ...orderedFromLayout,
      ...visibleDisplayCols.filter((c2) => !orderedFromLayout.includes(c2))
    ];
    if (!displayCols.length) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No result columns</span>';
      return;
    }
    if (!db.mergedCols) db.mergedCols = [];
    const mergedSet = new Set(db.mergedCols);
    const colMap = buildColSourceMap();
    wrap.innerHTML = "";
    for (const c2 of displayCols) {
      const label = colDisplayLabel(c2, colMap);
      const checked = mergedSet.has(c2);
      const lbl = document.createElement("label");
      lbl.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;font-weight:normal;margin-top:4px";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = checked;
      chk.addEventListener("change", () => {
        if (chk.checked) {
          if (!db.mergedCols.includes(c2)) db.mergedCols.push(c2);
        } else {
          db.mergedCols = db.mergedCols.filter((x2) => x2 !== c2);
        }
        if (db.result) renderResults(db.result);
      });
      lbl.appendChild(chk);
      lbl.appendChild(document.createTextNode(label));
      wrap.appendChild(lbl);
    }
  }
  function setMergeGroupUnderline(checked) {
    db.mergeGroupUnderline = !!checked;
    if (db.result) renderResults(db.result);
  }
  if (typeof window !== "undefined") window.setMergeGroupUnderline = setMergeGroupUnderline;

  // js/ui/aggregation.ts
  function _selColsToArray(selCols) {
    if (selCols instanceof Set) return [...selCols];
    if (Array.isArray(selCols)) return [...selCols];
    return null;
  }
  function _readAggModeState(mode) {
    if (mode === "group") {
      return {
        selCols: _selColsToArray(db.selCols),
        groupBy: [...db.groupBy || []],
        aggregates: (db.aggregates || []).map((a2) => ({ ...a2 }))
      };
    }
    if (mode === "totals") {
      return {
        selCols: _selColsToArray(db.selCols),
        colTotals: { ...db.colTotals || {} }
      };
    }
    if (mode === "subtotals") {
      return {
        selCols: _selColsToArray(db.selCols),
        subtotalBy: [...db.subtotalBy || []],
        subtotalFns: { ...db.subtotalFns || {} },
        subtotalGrandTotal: db.subtotalGrandTotal !== false,
        subtotalSpacer: !!db.subtotalSpacer,
        subtotalOnTop: !!db.subtotalOnTop,
        subtotalStrategy: db.subtotalStrategy || "combined"
      };
    }
    return {
      selCols: _selColsToArray(db.selCols)
    };
  }
  function _defaultAggModeState(mode) {
    if (mode === "group") {
      return { groupBy: [], aggregates: [] };
    }
    if (mode === "totals") {
      return { colTotals: {} };
    }
    if (mode === "subtotals") {
      return {
        subtotalBy: [],
        subtotalFns: {},
        subtotalGrandTotal: true,
        subtotalSpacer: false,
        subtotalOnTop: false,
        subtotalStrategy: "combined"
      };
    }
    return {};
  }
  function ensureAggModeState() {
    if (!db.aggModeState || typeof db.aggModeState !== "object") db.aggModeState = {};
    for (const mode of AGG_MODES) {
      if (!db.aggModeState[mode] || typeof db.aggModeState[mode] !== "object") {
        db.aggModeState[mode] = _defaultAggModeState(mode);
      }
    }
  }
  if (typeof window !== "undefined") window.ensureAggModeState = ensureAggModeState;
  function saveActiveAggModeState() {
    ensureAggModeState();
    db.aggModeState[db.aggMode || "none"] = _readAggModeState(db.aggMode || "none");
  }
  if (typeof window !== "undefined") window.saveActiveAggModeState = saveActiveAggModeState;
  function loadAggModeState(mode) {
    ensureAggModeState();
    const state = db.aggModeState[mode] || _defaultAggModeState(mode);
    db.groupBy = [];
    db.aggregates = [];
    db.colTotals = {};
    db.subtotalBy = [];
    db.subtotalFns = {};
    if (mode === "group") {
      if ("selCols" in state) {
        db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols) : null;
      }
      db.groupBy = Array.isArray(state.groupBy) ? [...state.groupBy] : [];
      db.aggregates = Array.isArray(state.aggregates) ? state.aggregates.map((a2) => ({ ...a2 })) : [];
      return;
    }
    if (mode === "totals") {
      if ("selCols" in state) {
        db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols) : null;
      }
      db.colTotals = state.colTotals && typeof state.colTotals === "object" ? { ...state.colTotals } : {};
      return;
    }
    if (mode === "subtotals") {
      if ("selCols" in state) {
        db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols) : null;
      }
      db.subtotalBy = Array.isArray(state.subtotalBy) ? [...state.subtotalBy] : [];
      db.subtotalFns = state.subtotalFns && typeof state.subtotalFns === "object" ? { ...state.subtotalFns } : {};
      db.subtotalGrandTotal = state.subtotalGrandTotal !== false;
      db.subtotalSpacer = !!state.subtotalSpacer;
      db.subtotalOnTop = !!state.subtotalOnTop;
      db.subtotalStrategy = state.subtotalStrategy === "nested" ? "nested" : "combined";
      return;
    }
    if ("selCols" in state) {
      db.selCols = Array.isArray(state.selCols) ? new Set(state.selCols) : null;
    }
  }
  var AGG_MODE_HANDLERS = {
    none: {
      showSections: { agg: false, totals: false, subtotals: false, hint: false },
      render: () => {
      },
      getHint: () => null
    },
    group: {
      showSections: { agg: true, totals: false, subtotals: false, hint: true },
      render: (cols) => {
        const aggAddRow = document.getElementById("aggAddRow");
        const hasGroups = db.groupBy.length > 0;
        if (aggAddRow) aggAddRow.style.display = hasGroups ? "" : "none";
        renderAggregateItems(cols);
      },
      getHint: () => "\u24D8 Results show one row per unique group. Columns marked \u26A0 will be dropped \u2014 click \u26A0 to add a calculation for them."
    },
    totals: {
      showSections: { agg: false, totals: true, subtotals: false, hint: true },
      render: (cols) => renderTotalsSection(cols),
      getHint: () => "\u24D8 All rows are shown. The totals row shows only the columns you set a calculation for."
    },
    subtotals: {
      showSections: { agg: false, totals: false, subtotals: true, hint: true },
      render: (cols) => {
        const chk = document.getElementById("chkGrandTotal");
        if (chk) chk.checked = db.subtotalGrandTotal !== false;
        const chkSpacer = document.getElementById("chkSubtotalSpacer");
        if (chkSpacer) chkSpacer.checked = !!db.subtotalSpacer;
        const chkOnTop = document.getElementById("chkSubtotalOnTop");
        if (chkOnTop) chkOnTop.checked = !!db.subtotalOnTop;
        const strat = db.subtotalStrategy || "combined";
        document.querySelectorAll('input[name="subtotalStrategy"]').forEach((r2) => {
          r2.checked = r2.value === strat;
        });
        renderSubtotalsSection(cols);
      },
      getHint: () => {
        const hasGroups = (db.subtotalBy || []).length > 0;
        const strategyName = db.subtotalStrategy === "nested" ? "nested" : "combined";
        return hasGroups ? `\u24D8 All rows shown, grouped by the highlighted columns (${strategyName} grouping).` : "\u24D8 Click columns above to choose which ones to group rows by.";
      }
    }
  };
  function renderAggregation() {
    if (!db.base || !db.tables[db.base]) return;
    const projected = projectedCols();
    const allCols = db.colOrder ? db.colOrder.filter((c2) => projected.includes(c2)) : projected;
    const selSet = db.selCols;
    const cols = selSet ? allCols.filter((c2) => selSet.has(c2)) : allCols;
    const mode = db.aggMode || "none";
    const aggSection = document.getElementById("aggSection");
    const totSec = document.getElementById("totalsSection");
    const subSec = document.getElementById("subtotalsSection");
    const hint = document.getElementById("aggHint");
    document.querySelectorAll('input[name="aggMode"]').forEach((r2) => {
      r2.checked = r2.value === mode;
    });
    const handler = AGG_MODE_HANDLERS[mode];
    const { showSections } = handler;
    if (aggSection) aggSection.style.display = showSections.agg ? "" : "none";
    if (totSec) totSec.style.display = showSections.totals ? "" : "none";
    if (subSec) subSec.style.display = showSections.subtotals ? "" : "none";
    handler.render(cols);
    if (hint) {
      const hintText = handler.getHint(cols);
      if (hintText) {
        hint.style.display = "";
        hint.textContent = hintText;
      } else {
        hint.style.display = "none";
      }
    }
    renderColChips();
  }
  if (typeof window !== "undefined") window.renderAggregation = renderAggregation;
  function setAggMode(mode) {
    if (!AGG_MODES.includes(mode)) mode = "none";
    const aggMode = mode;
    const prev = db.aggMode || "none";
    if (prev === aggMode) {
      renderAggregation();
      return;
    }
    saveActiveAggModeState();
    db.aggMode = aggMode;
    loadAggModeState(aggMode);
    renderAggregation();
  }
  if (typeof window !== "undefined") window.setAggMode = setAggMode;
  function renderTotalsSection(cols) {
    const wrap = document.getElementById("totalsItems");
    const colMap = buildColSourceMap();
    if (!wrap) return;
    const selSet2 = db.selCols;
    const visibleCols = cols.filter((c2) => !selSet2 || selSet2.has(c2));
    wrap.innerHTML = visibleCols.map((col) => {
      const cur = db.colTotals[col] || "skip";
      const label = colDisplayLabel(col, colMap);
      return `
    <div class="totals-row">
      <span class="totals-col-name" title="${h(col)}">${h(label)}</span>
      <select class="totals-fn-sel" data-tcol="${h(col)}">
        ${TOTAL_FNS.map(
        (f2) => `<option value="${f2}" ${cur === f2 ? "selected" : ""}>${TOTAL_LABELS[f2]}</option>`
      ).join("")}
      </select>
    </div>`;
    }).join("");
  }
  if (typeof document !== "undefined") {
    document.getElementById("totalsItems").addEventListener("change", (e2) => {
      const sel = e2.target.closest("[data-tcol]");
      if (!sel) return;
      const col = sel.dataset.tcol;
      if (sel.value === "skip") delete db.colTotals[col];
      else db.colTotals[col] = sel.value;
    });
  }
  function renderSubtotalsSection(cols) {
    const wrap = document.getElementById("subtotalsItems");
    const colMap = buildColSourceMap();
    const subtotalBy = db.subtotalBy || [];
    if (!wrap) return;
    if (subtotalBy.length === 0) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">Click columns above to choose group keys \u2014 then configure subtotal rows here.</span>';
      return;
    }
    const selSet3 = db.selCols;
    const visibleCols = cols.filter((c2) => (!selSet3 || selSet3.has(c2)) && !subtotalBy.includes(c2));
    if (!visibleCols.length) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">All columns are group keys.</span>';
      return;
    }
    wrap.innerHTML = visibleCols.map((col) => {
      const src = colMap.get(col);
      const isCalc = src?.kind === "calc";
      const isAdvancedCalc = isCalc && (() => {
        const calcObj = src.calc;
        const op = calcObj?.mathOp;
        return op === "ROLLAVG" || op === "PCTTOTAL";
      })();
      if (isCalc && !db.subtotalFns[col]) db.subtotalFns[col] = isAdvancedCalc ? "skip" : "SUM";
      const cur = db.subtotalFns[col] || "skip";
      const label = colDisplayLabel(col, colMap);
      const fnList = isAdvancedCalc ? ["skip"] : SUBTOTAL_FNS;
      return `
    <div class="totals-row">
      <span class="totals-col-name" title="${h(col)}">${h(label)}</span>
      <select class="totals-fn-sel" data-stcol="${h(col)}">
        ${fnList.map(
        (f2) => `<option value="${f2}" ${cur === f2 ? "selected" : ""}>${SUBTOTAL_LABELS[f2]}</option>`
      ).join("")}
      </select>
    </div>`;
    }).join("");
  }
  if (typeof window !== "undefined") window.renderSubtotalsSection = renderSubtotalsSection;
  if (typeof document !== "undefined") {
    document.getElementById("subtotalsItems").addEventListener("change", (e2) => {
      const sel = e2.target.closest("[data-stcol]");
      if (!sel) return;
      const col = sel.dataset.stcol;
      if (sel.value === "skip") delete db.subtotalFns[col];
      else db.subtotalFns[col] = sel.value;
    });
  }
  function setSubtotalGrandTotal(checked) {
    db.subtotalGrandTotal = !!checked;
  }
  if (typeof window !== "undefined") window.setSubtotalGrandTotal = setSubtotalGrandTotal;
  function setSubtotalSpacer(checked) {
    db.subtotalSpacer = !!checked;
  }
  if (typeof window !== "undefined") window.setSubtotalSpacer = setSubtotalSpacer;
  function setSubtotalOnTop(checked) {
    db.subtotalOnTop = !!checked;
  }
  if (typeof window !== "undefined") window.setSubtotalOnTop = setSubtotalOnTop;
  function setSubtotalStrategy(value) {
    db.subtotalStrategy = value === "nested" ? "nested" : "combined";
  }
  if (typeof window !== "undefined") window.setSubtotalStrategy = setSubtotalStrategy;
  function renderAggregateItems(cols) {
    const wrap = document.getElementById("aggItems");
    const colMap = buildColSourceMap();
    const selSet4 = db.selCols;
    cols = selSet4 instanceof Set ? cols.filter((c2) => selSet4.has(c2)) : cols;
    if (!db.aggregates.length) {
      if (db.groupBy.length > 0) {
        wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No calculations \u2014 add one below or click ungrouped chips above</span>';
      } else {
        wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">Click a column above to start grouping</span>';
      }
      return;
    }
    wrap.innerHTML = db.aggregates.map((agg, i2) => {
      const needsCol = AGG_NEEDS_COL(agg.fn);
      const colLabel = needsCol ? agg.col ? colDisplayLabel(agg.col, colMap) : "" : "all rows";
      const ph = h(defaultAggAlias(agg.fn, colLabel));
      const autoMark = agg.auto ? `<span class="agg-auto-badge" title="Auto-added \u2014 edit or delete to customize.">auto</span>` : "";
      const colPicker = needsCol ? `<span class="agg-eq">of</span>
         <select data-ai="${i2}" data-ap="col">
           ${cols.map(
        (c2) => `<option value="${h(c2)}" ${agg.col === c2 ? "selected" : ""}>${h(colDisplayLabel(c2, colMap))}</option>`
      ).join("")}
         </select>` : "";
      return `
    <div class="agg-row${agg.auto ? " agg-row-auto" : ""}">
      ${autoMark}
      <input type="text" class="agg-alias" placeholder="${ph}" value="${h(agg.alias)}"
             data-ai="${i2}" data-ap="alias">
      <span class="agg-eq">=</span>
      <select data-ai="${i2}" data-ap="fn">
        ${AGG_FNS.map((f2) => `<option value="${f2}" ${agg.fn === f2 ? "selected" : ""}>${AGG_LABELS[f2]}</option>`).join("")}
      </select>
      ${colPicker}
      <button class="btn btn-danger" data-rmagg="${i2}">\u2715</button>
    </div>`;
    }).join("");
  }
  if (typeof window !== "undefined") window.renderAggregateItems = renderAggregateItems;
  function addAggregate() {
    const cols = projectedCols();
    const col = cols.find((c2) => !db.groupBy.includes(c2)) || cols[0] || "";
    db.aggregates.push({ fn: "SUM", col, alias: "", auto: false });
    renderAggregateItems(cols);
  }
  if (typeof window !== "undefined") window.addAggregate = addAggregate;
  function removeAggregate(i2) {
    db.aggregates.splice(i2, 1);
    renderAggregation();
  }
  function touchAggregate(i2) {
    if (db.aggregates[i2]) db.aggregates[i2].auto = false;
  }
  if (typeof document !== "undefined") {
    document.getElementById("aggItems").addEventListener("change", (e2) => {
      const target = e2.target;
      const { ai, ap } = target.dataset;
      if (ai === void 0 || !ap) return;
      db.aggregates[+ai][ap] = target.value;
      touchAggregate(+ai);
      if (ap === "fn") renderAggregateItems(projectedCols());
    });
    document.getElementById("aggItems").addEventListener("input", (e2) => {
      const target = e2.target;
      const { ai, ap } = target.dataset;
      if (ai !== void 0 && ap === "alias") {
        db.aggregates[+ai].alias = target.value;
        touchAggregate(+ai);
      }
    });
    document.getElementById("aggItems").addEventListener("click", (e2) => {
      const btn = e2.target.closest("[data-rmagg]");
      if (btn) removeAggregate(+btn.dataset.rmagg);
    });
  }

  // js/ui/views/filter-sort-card.ts
  var FILTER_OPS = [
    "contains",
    "equals",
    "not equals",
    ">",
    "<",
    ">=",
    "<=",
    "starts with",
    "ends with",
    "is empty",
    "not empty"
  ];
  var NO_VAL_OPS = /* @__PURE__ */ new Set(["is empty", "not empty"]);
  function _populateFilterDatalist(i2, alias) {
    const dl2 = $("fdl_" + i2);
    if (!dl2 || !alias) {
      if (dl2) dl2.innerHTML = "";
      return;
    }
    const src = buildColSourceMap().get(alias);
    if (!src || src.kind === "calc") return;
    try {
      const rows = execQuery(
        `SELECT DISTINCT ${quoteId(src.col)} FROM ${quoteId(src.tid)}
       WHERE ${quoteId(src.col)} IS NOT NULL
       ORDER BY ${quoteId(src.col)} LIMIT 100`
      );
      dl2.innerHTML = rows.map((r2) => {
        const v2 = String(Object.values(r2)[0]).trim();
        return v2 ? `<option value="${h(v2)}">` : "";
      }).join("");
    } catch (_2) {
    }
  }
  function addFilter() {
    db.filters.push({ col: "", op: "contains", val: "", vals: [""], enabled: true });
    renderFilters();
  }
  if (typeof window !== "undefined") window.addFilter = addFilter;
  function removeFilter(i2) {
    db.filters.splice(i2, 1);
    renderFilters();
  }
  function renderFilters() {
    const colMap = buildColSourceMap();
    const cols = projectedCols();
    const wrap = $("filterItems");
    if (!db.filters.length) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No filters \u2014 all rows returned</span>';
      return;
    }
    wrap.innerHTML = db.filters.map((f2, i2) => {
      const noVal = NO_VAL_OPS.has(f2.op);
      const vals = Array.isArray(f2.vals) ? f2.vals : [""];
      const fEnabled = f2.enabled !== false;
      const fV = getValidation().items[`filter_${i2}`];
      const fBlocked = fV && fV.blocking;
      const fUnresolved = fV && !fV.resolved;
      const fIssueMsg = fUnresolved && fV.issues[0] ? fV.issues[0].message : null;
      const orValInputs = vals.map((v2, j2) => `
      ${j2 > 0 ? '<span style="font-size:0.7rem;color:var(--muted);padding:0 1px;flex-shrink:0">OR</span>' : ""}
      <input type="text" list="fdl_${i2}" placeholder="value" value="${h(v2)}"
             data-fi="${i2}" data-vi="${j2}" data-fp="val" style="width:120px">
      ${j2 > 0 ? `<button class="btn btn-danger" style="padding:2px 5px;font-size:0.75rem;flex-shrink:0" data-rmval="${j2}" data-fi="${i2}" title="Remove this OR value">\u2715</button>` : ""}
    `).join("");
      return `
    <div class="filter-row${fBlocked ? " pl-lookup-stage--invalid" : fUnresolved && !fEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!fEnabled ? "pl-stage-disabled" : ""}">
      ${fIssueMsg ? `<div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">${fBlocked ? "\u26D4" : "\u26A0"} ${h(fIssueMsg)}</div>` : ""}
      <label class="pl-enable-toggle" style="margin-left:auto;order:99" title="${fEnabled ? "Disable filter" : "Enable filter"}"><input type="checkbox" data-fi="${i2}" data-fp="enabled" ${fEnabled ? "checked" : ""}><span class="pl-enable-label">${fEnabled ? "" : "Off"}</span></label>
      <select data-fi="${i2}" data-fp="col">
        <option value="">Column\u2026</option>
        ${cols.map((c2) => `<option value="${h(c2)}" ${f2.col === c2 ? "selected" : ""}>${h(colDisplayLabel(c2, colMap))}</option>`).join("")}
      </select>
      <select class="fop" data-fi="${i2}" data-fp="op">
        ${FILTER_OPS.map((op) => `<option value="${op}" ${f2.op === op ? "selected" : ""}>${op}</option>`).join("")}
      </select>
      <span class="filter-or-wrap" style="display:${noVal ? "none" : "flex"};gap:4px;align-items:center;flex-wrap:wrap">
        ${orValInputs}
        <button class="btn btn-ghost" style="padding:2px 7px;font-size:0.76rem;flex-shrink:0" data-addorval="${i2}" title="Add OR value">\uFF0B</button>
        <datalist id="fdl_${i2}"></datalist>
      </span>
      <button class="btn btn-danger" data-rmf="${i2}">\u2715</button>
    </div>`;
    }).join("");
    db.filters.forEach((f2, i2) => {
      if (f2.col) _populateFilterDatalist(i2, f2.col);
    });
  }
  if (typeof document !== "undefined") {
    delegate($("filterItems"), "[data-fi]", "change", (el) => {
      const { fi, fp } = el.dataset;
      if (fi === void 0 || !fp) return;
      const f2 = db.filters[+fi];
      if (!f2) return;
      if (fp === "enabled") {
        f2.enabled = el.checked;
        invalidateValidation();
        renderFilters();
        return;
      }
      const i2 = +fi;
      if (fp === "col") {
        f2.col = el.value;
        f2.vals = [""];
        renderFilters();
        if (f2.col) _populateFilterDatalist(i2, f2.col);
      } else if (fp === "op") {
        f2.op = el.value;
        const orWrap = el.closest(".filter-row").querySelector(".filter-or-wrap");
        if (orWrap) orWrap.style.display = NO_VAL_OPS.has(el.value) ? "none" : "flex";
      }
    });
    delegate($("filterItems"), "[data-fi][data-vi]", "input", (el) => {
      const { fi, vi, fp } = el.dataset;
      if (fi !== void 0 && fp === "val" && vi !== void 0) {
        const f2 = db.filters[+fi];
        if (f2) {
          if (!Array.isArray(f2.vals)) f2.vals = [""];
          f2.vals[+vi] = el.value;
        }
      }
    });
    delegate($("filterItems"), "[data-rmf]", "click", (el) => {
      removeFilter(+el.dataset.rmf);
    });
    delegate($("filterItems"), "[data-addorval]", "click", (el) => {
      const i2 = +el.dataset.addorval;
      const f2 = db.filters[i2];
      if (!f2) return;
      if (!Array.isArray(f2.vals)) f2.vals = [""];
      f2.vals.push("");
      renderFilters();
      if (f2.col) _populateFilterDatalist(i2, f2.col);
    });
    delegate($("filterItems"), "[data-rmval]", "click", (el) => {
      const i2 = +el.dataset.fi;
      const j2 = +el.dataset.rmval;
      const f2 = db.filters[i2];
      if (!f2) return;
      if (!Array.isArray(f2.vals)) f2.vals = [""];
      if (f2.vals.length <= 1) return;
      f2.vals.splice(j2, 1);
      renderFilters();
      if (f2.col) _populateFilterDatalist(i2, f2.col);
    });
  }
  function renderSorts() {
    const selCols = db.selCols;
    const colOrder = db.colOrder || projectedCols();
    const cols = colOrder.filter((c2) => !selCols || selCols.has(c2));
    const colMap = buildColSourceMap();
    const wrap = $("sortItems");
    if (!wrap) return;
    if (!db.sorts.length) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No sort \u2014 rows returned in natural order</span>';
      return;
    }
    wrap.innerHTML = db.sorts.map((s2, i2) => {
      const sEnabled = s2.enabled !== false;
      const sV = getValidation().items[`sort_${i2}`];
      const sBlocked = sV && sV.blocking;
      const sUnresolved = sV && !sV.resolved;
      const sIssueMsg = sUnresolved && sV.issues[0] ? sV.issues[0].message : null;
      return `
    <div class="sort-row${sBlocked ? " pl-lookup-stage--invalid" : sUnresolved && !sEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!sEnabled ? "pl-stage-disabled" : ""}">
      ${sIssueMsg ? `<div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">${sBlocked ? "\u26D4" : "\u26A0"} ${h(sIssueMsg)}</div>` : ""}
      <span class="sort-level">${i2 + 1}.</span>
      <select data-si="${i2}" data-sp="col" style="flex:1;min-width:0">
        <option value="">\u2014 column \u2014</option>
        ${cols.map((c2) => `<option value="${h(c2)}" ${s2.col === c2 ? "selected" : ""}>${h(colDisplayLabel(c2, colMap))}</option>`).join("")}
      </select>
      <select data-si="${i2}" data-sp="dir" style="width:95px;flex-shrink:0">
        <option value="ASC"  ${s2.dir === "ASC" ? "selected" : ""}>\u2191 A \u2192 Z</option>
        <option value="DESC" ${s2.dir === "DESC" ? "selected" : ""}>\u2193 Z \u2192 A</option>
      </select>
      <label class="pl-enable-toggle" title="${sEnabled ? "Disable sort" : "Enable sort"}"><input type="checkbox" data-si="${i2}" data-sp="enabled" ${sEnabled ? "checked" : ""}><span class="pl-enable-label">${sEnabled ? "" : "Off"}</span></label>
      <button class="btn btn-danger" data-rmsort="${i2}">\u2715</button>
    </div>`;
    }).join("");
  }
  function addSort() {
    db.sorts.push({ col: "", dir: "ASC", enabled: true });
    renderSorts();
  }
  if (typeof window !== "undefined") window.addSort = addSort;
  function removeSort(i2) {
    db.sorts.splice(i2, 1);
    renderSorts();
  }
  if (typeof document !== "undefined") {
    delegate($("sortItems"), "[data-si]", "change", (el) => {
      const { si, sp } = el.dataset;
      if (si !== void 0 && sp === "enabled") {
        db.sorts[+si].enabled = el.checked;
        invalidateValidation();
        renderSorts();
        return;
      }
      if (si !== void 0 && sp) db.sorts[+si][sp] = el.value;
    });
    delegate($("sortItems"), "[data-rmsort]", "click", (el) => {
      removeSort(+el.dataset.rmsort);
    });
  }

  // js/ui/views/query-builder.ts
  function renderQueryBuilder() {
    invalidateValidation();
    const ids = Object.keys(db.tables).sort((a2, b2) => db.tables[a2].name.localeCompare(db.tables[b2].name));
    const qEmpty = $("qEmpty");
    const qBuilder = $("qBuilder");
    if (qEmpty) qEmpty.style.display = ids.length ? "none" : "";
    if (qBuilder) qBuilder.style.display = ids.length ? "grid" : "none";
    if (!ids.length) return;
    const hasBase = !!db.base && !!db.tables[db.base];
    const hasBaseConfigured = !!db.base;
    ["colCard", "filterSortCard"].forEach((id) => {
      const el = $(id);
      if (el) el.style.display = hasBase ? "" : "none";
    });
    const runRowEl = $("runRow");
    if (runRowEl) runRowEl.style.display = hasBaseConfigured ? "" : "none";
    if (hasBaseConfigured) {
      const v2 = getValidation();
      const blocked = v2.reportStatus === "blocked";
      const items = Object.values(v2.items);
      const issueCount = items.filter((it) => it.blocking).length;
      const pill = $("reportStatusPill");
      const runBtn = $("runBtn");
      if (pill) {
        pill.style.display = "";
        if (blocked) {
          pill.textContent = `\u26A0 Blocked (${issueCount} issue${issueCount !== 1 ? "s" : ""})`;
          pill.style.background = "rgba(200,60,60,0.18)";
          pill.style.color = "#e07070";
          pill.style.border = "1px solid rgba(200,60,60,0.35)";
        } else {
          pill.textContent = "\u2713 Healthy";
          pill.style.background = "rgba(50,180,100,0.15)";
          pill.style.color = "#6ec87e";
          pill.style.border = "1px solid rgba(50,180,100,0.3)";
        }
      }
      if (runBtn) runBtn.disabled = blocked;
    }
    renderPipeline(ids);
    if (!hasBase) return;
    renderColChips();
    renderFilters();
    renderSorts();
    renderAggregation();
    try {
      renderMergeToggles(projectedCols());
    } catch (_2) {
    }
  }
  function onBaseChange2(val) {
    db.base = val;
    db.baseCols = null;
    db.stacks = [];
    db.selCols = null;
    db.colOrder = null;
    _seenCols.clear();
    _previewOpen.clear();
    _disabledCardCols.clear();
    renderQueryBuilder();
  }
  function togglePreview(key) {
    if (_previewOpen.has(key)) {
      _previewOpen.delete(key);
    } else {
      _previewOpen.add(key);
    }
    const ids = Object.keys(db.tables).sort((a2, b2) => db.tables[a2].name.localeCompare(db.tables[b2].name));
    renderPipeline(ids);
  }
  function _buildPreviewSQL(key) {
    const spec = {
      base: db.base,
      baseCols: db.baseCols,
      stacks: db.stacks,
      excludedRows: db.excludedRows,
      lookups: db.lookups,
      calcStages: db.calcStages,
      selCols: db.selCols,
      colOrder: db.colOrder,
      filters: [],
      sorts: [],
      groupBy: [],
      aggregates: [],
      aggMode: "none",
      colTotals: {},
      subtotalBy: [],
      subtotalFns: {}
    };
    if (key !== "base") {
      const lkMatch = key.match(/^lk(\d+)$/);
      const calcMatch = key.match(/^calc(\d+)$/);
      if (!lkMatch && !calcMatch) return null;
      if (lkMatch) {
        const depth = +lkMatch[1];
        spec.lookups = (db.lookups || []).slice(0, depth + 1);
        spec.calcStages = [];
      } else {
        const depth = +calcMatch[1];
        spec.calcStages = (db.calcStages || []).slice(0, depth + 1);
      }
    }
    const srcCatalog = typeof buildSourceCatalog === "function" ? buildSourceCatalog() : null;
    if (!srcCatalog) return null;
    const colCatalog = buildColumnCatalog(spec, srcCatalog);
    const plan = buildQueryPlan(spec, colCatalog, null, srcCatalog);
    const result = renderDetailSql(plan);
    if (!result) return null;
    result.sql = result.sql.replace(/\s*(?:(?<!\()ORDER BY[^;]+)?$/, " LIMIT 5");
    return result;
  }
  function _buildPreviewHTML(key) {
    try {
      let sql, params;
      if (key === "base") {
        const ids = [db.base, ...(db.stacks || []).filter((id) => db.tables[id])];
        if (!ids.every((id) => db.tables[id])) return "<em>Not ready</em>";
        const baseCols = db.tables[db.base].cols;
        sql = ids.map((id) => {
          const tCols = db.tables[id].cols;
          const sel = baseCols.map((c2) => tCols.includes(c2) ? quoteId(c2) : "NULL").join(", ");
          return `SELECT ${sel} FROM ${quoteId(id)}`;
        }).join(" UNION ALL ");
        sql = `SELECT * FROM (${sql}) LIMIT 5`;
        params = [];
      } else {
        const result = _buildPreviewSQL(key);
        if (!result) return "<em>Unknown stage</em>";
        sql = result.sql;
        params = result.params;
      }
      const rows = execQuery(sql, params);
      if (!rows.length) return '<em style="font-size:0.72rem;color:var(--muted)">No rows</em>';
      const cols = Object.keys(rows[0]);
      const pvMap = buildColSourceMap();
      return `<table>
      <thead><tr>${cols.map((c2) => `<th title="${h(c2)}">${h(colDisplayLabel(c2, pvMap))}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(
        (r2) => `<tr>${cols.map((c2) => `<td title="${h(String(r2[c2] ?? ""))}">${h(String(r2[c2] ?? ""))}</td>`).join("")}</tr>`
      ).join("")}</tbody>
    </table>`;
    } catch (ex) {
      return `<em style="color:var(--red);font-size:0.72rem">Error: ${h(ex.message)}</em>`;
    }
  }
  function addStack2(id) {
    if (!id || !db.tables[id] || id === db.base) return;
    if (!db.stacks.includes(id)) db.stacks.push(id);
    _afterCombineChange();
  }
  function removeStack(id) {
    db.stacks = db.stacks.filter((s2) => s2 !== id);
    _afterCombineChange();
  }
  function addLookup2() {
    if (!db.base) return;
    if (!db.lookups) db.lookups = [];
    db.lookups.push({ rightId: "", keyPairs: [{ left: "", right: "" }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: "block" } });
    _afterCombineChange();
  }
  function addCalcStage2() {
    if (!db.base) return;
    if (!db.calcStages) db.calcStages = [];
    db.calcStages.push({
      alias: "",
      mode: "math",
      math: { strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] },
      enabled: true
    });
    _afterCombineChange();
  }
  function removeCalcStage(i2) {
    if (!Array.isArray(db.calcStages)) db.calcStages = [];
    db.calcStages.splice(i2, 1);
    _afterCombineChange();
  }
  function removeLookup(i2) {
    db.lookups.splice(i2, 1);
    _afterCombineChange();
  }
  function selectAllLookupCols(i2) {
    const lk = db.lookups[i2];
    const rt = lk.rightId && db.tables[lk.rightId];
    if (rt) {
      _showLayoutAliasesForSource(lk.rightId);
      _afterCombineChange();
    }
  }
  function selectNoneLookupCols(i2) {
    const lk = db.lookups[i2];
    _hideLookupLayoutAliasesSafely(lk.rightId, null, i2);
    _afterCombineChange();
  }
  function runQuery() {
    if (!db.base || !db.tables[db.base]) return;
    invalidateValidation();
    const v2 = getValidation();
    if (v2.reportStatus === "blocked") {
      const blockingItems = Object.values(v2.items).filter((item) => item.blocking);
      const firstMsg = blockingItems[0]?.issues?.[0]?.message || "missing source data";
      toast(`Can't run \u2014 fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ""}).`, "err");
      return;
    }
    const _hasAgg = db.aggMode === "group" && (db.groupBy.length > 0 || db.aggregates.length > 0);
    if (!_hasAgg && !["totals", "subtotals"].includes(db.aggMode) && db.selCols && db.selCols.size === 0) {
      toast("No output columns selected \u2014 click All or pick at least one column.", "err");
      return;
    }
    const status = $("runStatus");
    status.textContent = "Running\u2026";
    setTimeout(() => {
      try {
        const resultSet = runReport(db);
        if (!resultSet) throw new Error("No result set returned");
        const displayRows = resultSet.rows.filter((r2) => !r2._row_type);
        const hasTotals = !!resultSet.metadata.totalsRow;
        const hasSubs = !!resultSet.metadata.hasSubtotals;
        db.result = {
          rows: resultSet.rows,
          totalsRow: resultSet.metadata.totalsRow || null,
          cols: resultSet.columns,
          hasSubtotals: hasSubs
        };
        let statusText = displayRows.length.toLocaleString() + " rows";
        if (hasTotals) statusText += " + grand total";
        if (hasSubs) statusText += " (subtotals)";
        status.textContent = statusText;
        switchTab("results");
        renderResults(db.result);
      } catch (ex) {
        status.textContent = "Error";
        toast("Query error: " + ex.message, "err");
        console.error(ex.message);
      }
    }, 20);
  }
  if (typeof window !== "undefined") window.onBaseChange = onBaseChange2;
  if (typeof window !== "undefined") window.addStack = addStack2;
  if (typeof window !== "undefined") window.addLookup = addLookup2;
  if (typeof window !== "undefined") window.addCalcStage = addCalcStage2;
  if (typeof window !== "undefined") window.runQuery = runQuery;

  // js/ui/grid.ts
  var gridResult = null;
  var gridPreview = null;
  function refreshResultGridLayout() {
    if (!gridResult) return;
    try {
      gridResult.resetRowHeights?.();
    } catch (_2) {
    }
    try {
      gridResult.refreshCells?.({ force: true });
    } catch (_2) {
    }
    try {
      gridResult.redrawRows?.();
    } catch (_2) {
    }
  }
  function refreshPreviewGridLayout() {
    if (!gridPreview) return;
    try {
      gridPreview.resetRowHeights?.();
    } catch (_2) {
    }
    try {
      gridPreview.refreshCells?.({ force: true });
    } catch (_2) {
    }
    try {
      gridPreview.redrawRows?.();
    } catch (_2) {
    }
  }
  function renderResults(result) {
    const wrap = $("resultsWrap");
    const meta = $("resultsMeta");
    const btnXlsx = $("btnExpXlsx");
    const btnCsv = $("btnExpCsv");
    const { rows, totalsRow, cols } = result;
    const hasData = rows.length > 0 || totalsRow !== null;
    btnXlsx.style.display = hasData ? "" : "none";
    btnCsv.style.display = hasData ? "" : "none";
    if (gridResult) {
      gridResult.destroy();
      gridResult = null;
    }
    if (!hasData) {
      meta.textContent = "0 rows matched";
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">\u{1F50D}</div><div>No rows matched your query</div></div>';
      return;
    }
    if (totalsRow) {
      meta.textContent = rows.length.toLocaleString() + " rows + 1 totals row \xB7 " + cols.length + " columns";
    } else {
      meta.textContent = rows.length.toLocaleString() + " rows \xB7 " + cols.length + " columns";
    }
    wrap.innerHTML = '<div id="resGrid" class="ag-theme-balham-dark" style="height:100%;width:100%"></div>';
    const tableData = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : rows;
    const colDefs = makeResultCols(cols);
    const options = {
      rowData: tableData,
      columnDefs: colDefs,
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
        floatingFilter: true,
        minWidth: 80,
        cellRenderer: (params) => {
          const v2 = params.value;
          return v2 == null ? "" : String(v2);
        }
      },
      pagination: true,
      paginationPageSize: 500,
      paginationPageSizeSelector: [100, 250, 500, 1e3, 5e3],
      multiSortKey: "ctrl",
      onColumnMoved: () => _saveResultColState(),
      onColumnResized: () => _saveResultColState(),
      onColumnVisible: () => _saveResultColState()
    };
    const el = $("resGrid");
    gridResult = agGrid.createGrid(el, options);
    requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
    if (db.colState) {
      gridResult.applyColumnState(db.colState);
    }
    renderMergeToggles(cols);
  }
  if (typeof window !== "undefined") window.renderResults = renderResults;
  function _saveResultColState() {
    if (gridResult) db.colState = gridResult.getColumnState();
  }
  function renderPreviewDropdown() {
    const sel = $("previewSel");
    if (!sel) return;
    const prev = sel.value;
    const ids = Object.keys(db.tables);
    sel.innerHTML = '<option value="">\u2014 select a table to preview \u2014</option>' + ids.map((id) => `<option value="${id}">${h(db.tables[id].name)}</option>`).join("");
    if (db.tables[prev]) sel.value = prev;
  }
  function loadPreview() {
    const id = $("previewSel").value;
    const wrap = $("previewWrap");
    const meta = $("previewMeta");
    if (gridPreview) {
      gridPreview.destroy();
      gridPreview = null;
    }
    if (!id || !db.tables[id]) {
      meta.textContent = "";
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">\u{1F446}</div><div>Select a table above</div></div>';
      return;
    }
    const t2 = db.tables[id];
    const cap = 1e4;
    const excluded = db.excludedRows[id] || /* @__PURE__ */ new Set();
    let rows;
    try {
      rows = execQuery(`SELECT "_rowno", ${t2.cols.map((c2) => quoteId(c2)).join(", ")} FROM ${quoteId(id)} LIMIT ${cap}`);
    } catch (ex) {
      meta.textContent = "Error loading preview";
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">\u274C</div><div>' + h(ex.message) + "</div></div>";
      return;
    }
    const excCount = excluded.size;
    meta.textContent = t2.rowCount.toLocaleString() + " rows \xB7 " + t2.cols.length + " cols" + (excCount ? " \xB7 " + excCount + " excluded" : "") + (t2.rowCount > cap ? " (preview: first " + cap.toLocaleString() + ")" : "");
    let bannerHtml = "";
    if (excCount) {
      bannerHtml = `<div id="previewExclBanner" style="padding:4px 10px;font-size:12px;background:rgba(255,170,0,0.12);border-bottom:1px solid rgba(255,170,0,0.3);color:#c9a020;display:flex;align-items:center;gap:8px;">
      <span>\u26A0 ${excCount} row${excCount > 1 ? "s" : ""} excluded from reports</span>
      <button onclick="clearExclusions('${id}')" style="font-size:11px;padding:1px 7px;border-radius:3px;border:1px solid #c9a020;background:transparent;color:#c9a020;cursor:pointer">Clear all</button>
    </div>`;
    }
    wrap.innerHTML = bannerHtml + '<div id="prevGrid" class="ag-theme-balham-dark" style="height:calc(100% - ' + (excCount ? 30 : 0) + 'px);width:100%"></div>';
    const excludeColDef = {
      headerName: "",
      field: "_rowno",
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      resizable: false,
      sortable: false,
      filter: false,
      floatingFilter: false,
      cellRenderer: (params) => {
        const rowno = params.value;
        const isExcl = excluded.has(rowno);
        const btn = document.createElement("button");
        const rowData = params.data;
        const preview = t2.cols.filter((c2) => c2 !== "_rowno").map((c2) => rowData[c2] == null ? "" : String(rowData[c2])).filter((v2) => v2 !== "").slice(0, 6).join(" \xB7 ");
        const action = isExcl ? "Restore row to reports" : "Exclude row from reports";
        btn.title = `${action}
\u2192 ${preview}`;
        btn.style.cssText = "background:transparent;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1";
        btn.textContent = isExcl ? "\u{1F6AB}" : "\u2705";
        btn.addEventListener("click", () => toggleRowExclusion(id, rowno));
        return btn;
      }
    };
    const el = $("prevGrid");
    gridPreview = agGrid.createGrid(el, {
      rowData: rows,
      columnDefs: [excludeColDef, ...makePreviewCols(id, t2.cols)],
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
        floatingFilter: true,
        minWidth: 80,
        cellRenderer: (params) => {
          const v2 = params.value;
          return v2 == null ? "" : String(v2);
        }
      },
      pagination: true,
      paginationPageSize: 200,
      paginationPageSizeSelector: [100, 200, 500, 1e3],
      multiSortKey: "ctrl",
      getRowStyle: (params) => {
        const rowno = params.data && params.data._rowno;
        if (excluded.has(rowno)) {
          return {
            color: "#c0392b",
            textDecoration: "line-through",
            background: "rgba(220,50,50,0.08)"
          };
        }
      }
    });
    requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
  }
  if (typeof window !== "undefined") window.loadPreview = loadPreview;
  function toggleRowExclusion(tableId, rowno) {
    if (!db.excludedRows[tableId]) db.excludedRows[tableId] = /* @__PURE__ */ new Set();
    const set = db.excludedRows[tableId];
    if (set.has(rowno)) set.delete(rowno);
    else set.add(rowno);
    renderQueryBuilder();
    loadPreview();
  }
  function clearExclusions(tableId) {
    db.excludedRows[tableId] = /* @__PURE__ */ new Set();
    renderQueryBuilder();
    loadPreview();
  }
  if (typeof window !== "undefined") window.clearExclusions = clearExclusions;
  function makeResultCols(cols) {
    const colMap = buildColSourceMap();
    const dataCols = cols.filter((c2) => c2 !== "_rowno" && c2 !== "_row_type" && c2 !== "_isTotalsRow");
    return dataCols.map((c2) => {
      const src = colMap.get(c2);
      const dispLabel = colDisplayLabel(c2, colMap);
      const srcPhys = src;
      const renamed = src && src.kind !== "calc" ? db.columnLabels?.[srcPhys.tid]?.[srcPhys.col] : void 0;
      const color = src ? getTableColor(srcPhys?.tid || "") : null;
      const doRename = () => {
        const target = resolveRenameTarget(c2);
        if (!target) return;
        showRenameModal(target, () => {
          renderQueryBuilder();
          if (db.result) renderResults(db.result);
        });
      };
      return {
        field: c2,
        headerName: dispLabel,
        tooltipField: c2,
        minWidth: 110,
        filter: "agTextColumnFilter",
        floatingFilter: true,
        sortable: true,
        resizable: true,
        headerComponent: _makeHeaderComponent(
          dispLabel,
          color,
          renamed,
          src && src.kind !== "calc" ? src.col : null,
          doRename,
          src && src.kind !== "calc" && renamed ? () => {
            setColLabel(src.tid, src.col, src.col);
            renderQueryBuilder();
            if (db.result) renderResults(db.result);
          } : null
        ),
        cellRenderer: (params) => {
          const v2 = params.value;
          return v2 == null ? "" : String(v2);
        }
      };
    });
  }
  function makePreviewCols(tid, physCols) {
    const color = getTableColor(tid);
    return physCols.filter((c2) => c2 !== "_rowno").map((c2) => {
      const renamed = db.columnLabels?.[tid]?.[c2];
      const label = renamed || c2;
      const doRename = () => {
        renameSourceCol(tid, c2, () => {
          renderQueryBuilder();
          if (db.result) renderResults(db.result);
          loadPreview();
        });
      };
      const doClear = renamed ? () => {
        setColLabel(tid, c2, c2);
        renderQueryBuilder();
        if (db.result) renderResults(db.result);
        loadPreview();
      } : null;
      return {
        field: c2,
        headerName: label,
        minWidth: 110,
        filter: "agTextColumnFilter",
        floatingFilter: true,
        sortable: true,
        resizable: true,
        headerComponent: _makeHeaderComponent(label, color, renamed, c2, doRename, doClear),
        cellRenderer: (params) => {
          const v2 = params.value;
          return v2 == null ? "" : String(v2);
        }
      };
    });
  }
  function _makeHeaderComponent(label, color, renamed, origCol, onRename, onClear) {
    return class {
      _params;
      _gui;
      init(params) {
        this._params = params;
        this._gui = document.createElement("div");
        this._gui.style.cssText = "display:flex;align-items:center;gap:3px;width:100%;overflow:hidden";
        if (color) {
          const stripe = document.createElement("span");
          stripe.style.cssText = `width:3px;flex-shrink:0;align-self:stretch;background:${color};border-radius:1px;margin-right:2px`;
          this._gui.appendChild(stripe);
        }
        const txt = document.createElement("span");
        txt.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer";
        txt.textContent = label;
        if (origCol) txt.title = renamed ? `Original: ${origCol}` : origCol;
        txt.addEventListener("click", (e2) => params.progressSort(e2.shiftKey));
        this._gui.appendChild(txt);
        if (onRename) {
          const more = document.createElement("button");
          more.textContent = "\u22EF";
          more.title = "Rename column";
          more.style.cssText = "background:none;border:none;cursor:pointer;font-size:13px;padding:0 2px;color:#aaa;flex-shrink:0;line-height:1";
          more.addEventListener("click", (e2) => {
            e2.stopPropagation();
            onRename();
          });
          this._gui.appendChild(more);
        }
        if (onClear) {
          const clr = document.createElement("button");
          clr.textContent = "\xD7";
          clr.title = `Clear rename (original: ${origCol})`;
          clr.style.cssText = "background:none;border:none;cursor:pointer;font-size:10px;padding:0 1px;color:#aaa;flex-shrink:0;line-height:1";
          clr.addEventListener("click", (e2) => {
            e2.stopPropagation();
            onClear();
          });
          this._gui.appendChild(clr);
        }
      }
      getGui() {
        return this._gui;
      }
      destroy() {
      }
      refresh() {
        return false;
      }
    };
  }

  // js/ui/tabs.ts
  function switchTab(name) {
    document.querySelectorAll(".tab-btn").forEach((b2) => b2.classList.toggle("active", b2.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p2) => p2.classList.toggle("active", p2.id === "tab-" + name));
    if (name === "results") {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
    }
    if (name === "preview") {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
    }
  }
  if (typeof window !== "undefined") window.switchTab = switchTab;
  if (typeof document !== "undefined") {
    document.querySelectorAll(".tab-btn").forEach((b2) => b2.addEventListener("click", () => switchTab(b2.dataset.tab)));
  }

  // js/ui/export.ts
  function exportAs(fmt) {
    if (!db.result || !db.result.rows) return;
    const v2 = getValidation();
    if (v2.reportStatus === "blocked") {
      const blockingItems = Object.values(v2.items).filter((item) => item.blocking);
      const firstMsg = blockingItems[0]?.issues?.[0]?.message || "missing source data";
      toast(`Can't export \u2014 fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ""}).`, "err");
      return;
    }
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fn = "report-" + ts;
    const result = db.result;
    const { rows, totalsRow, cols } = result;
    const colMap = buildColSourceMap();
    const hdrMap = buildExportHeaderMap(cols || [], colMap);
    const exportCols = (cols || []).filter(
      (c2) => c2 !== "_rowno" && c2 !== "_row_type" && c2 !== "_isTotalsRow" && c2 !== "_sort_row_type" && !String(c2).startsWith("_sort_group_")
    );
    const exportHeaders = exportCols.map((c2) => hdrMap?.[c2] || c2);
    const mergeHeaderSet = new Set(
      exportCols.filter((c2) => (db.mergedCols || []).includes(c2)).map((c2) => hdrMap?.[c2] || c2)
    );
    const remap = (row) => {
      const out = {};
      for (const c2 of exportCols) {
        const header = hdrMap?.[c2];
        out[header || c2] = row[c2];
      }
      return out;
    };
    const dataRows = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : [...rows];
    const rowKinds = dataRows.map((r2) => {
      if (r2._isTotalsRow) return 3;
      const t2 = Number(r2._row_type);
      return Number.isFinite(t2) ? t2 : 0;
    });
    const clean = dataRows.map(remap);
    if (fmt === "csv") {
      const ws = XLSX.utils.json_to_sheet(clean, { header: exportHeaders, skipHeader: false });
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      dl(blob, fn + ".csv");
    } else {
      const xlsxUtils = XLSX.utils;
      const wb = xlsxUtils.book_new();
      const ws = xlsxUtils.json_to_sheet(clean, { header: exportHeaders, skipHeader: false });
      applyExportMerges(ws, clean, rowKinds, exportHeaders, mergeHeaderSet);
      styleExportSheet(ws, clean, rowKinds, mergeHeaderSet);
      xlsxUtils.book_append_sheet(wb, ws, "Results");
      XLSX.writeFile(wb, fn + ".xlsx");
    }
    toast("Exported " + clean.length.toLocaleString() + " rows as " + fmt.toUpperCase(), "ok");
  }
  if (typeof window !== "undefined") window.exportAs = exportAs;
  function applyExportMerges(ws, cleanRows, rowKinds, headers, mergeHeaderSet) {
    if (!ws || !Array.isArray(cleanRows) || !cleanRows.length) return;
    if (!headers || !headers.length || !mergeHeaderSet || mergeHeaderSet.size === 0) return;
    const xlsxUtils = XLSX.utils;
    const merges = [];
    headers.forEach((h4, cIdx) => {
      if (!mergeHeaderSet.has(h4)) return;
      const leftGateHeaders = headers.slice(0, cIdx).filter((lh) => mergeHeaderSet.has(lh));
      const gateByLeft = leftGateHeaders.length > 0;
      let i2 = 0;
      while (i2 < cleanRows.length) {
        if ((rowKinds[i2] ?? 0) !== 0) {
          i2++;
          continue;
        }
        const v2 = cleanRows[i2]?.[h4];
        if (v2 == null || String(v2) === "") {
          i2++;
          continue;
        }
        let j2 = i2 + 1;
        while (j2 < cleanRows.length && (rowKinds[j2] ?? 0) === 0 && cleanRows[j2]?.[h4] === v2) {
          if (gateByLeft && leftGateHeaders.some((lh) => cleanRows[j2]?.[lh] !== cleanRows[j2 - 1]?.[lh])) {
            break;
          }
          j2++;
        }
        const span = j2 - i2;
        if (span > 1) {
          const s2 = { r: i2 + 1, c: cIdx };
          const e2 = { r: j2, c: cIdx };
          merges.push({ s: s2, e: e2 });
          for (let rr = s2.r + 1; rr <= e2.r; rr++) {
            const addr = xlsxUtils.encode_cell({ r: rr, c: cIdx });
            ws[addr] = { t: "z", v: void 0 };
          }
        }
        i2 = j2;
      }
    });
    if (merges.length) ws["!merges"] = merges;
  }
  function styleExportSheet(ws, cleanRows, rowKinds, mergeHeaderSet = /* @__PURE__ */ new Set()) {
    const ref = ws["!ref"];
    if (!ref) return;
    const xlsxUtils = XLSX.utils;
    const range = xlsxUtils.decode_range(ref);
    const borderColor = { rgb: "FF6B7280" };
    const grandBorderColor = { rgb: "FF4B5563" };
    const fontBase = { name: "Aptos", sz: 11, color: { rgb: "FF111827" } };
    const MIN_COL_WCH = 10;
    const MAX_COL_WCH = 40;
    const WIDTH_SAMPLE_ROWS = 300;
    const BODY_ROW_HPT = 18;
    const headers = cleanRows[0] ? Object.keys(cleanRows[0]) : [];
    const mergeStartSet = new Set((ws["!merges"] || []).map((m2) => `${m2.s.r}:${m2.s.c}`));
    const underlineMergedGroups = !!db?.mergeGroupUnderline;
    const mergeUnderlineStartByRow = /* @__PURE__ */ new Map();
    if (underlineMergedGroups) {
      const mergeParticipation = /* @__PURE__ */ new Map();
      const addUnderline = (bodyRowIdx, colIdx) => {
        const sheetRow = bodyRowIdx + 1;
        if (sheetRow < 1) return;
        const prev = mergeUnderlineStartByRow.get(sheetRow);
        mergeUnderlineStartByRow.set(sheetRow, prev == null ? colIdx : Math.min(prev, colIdx));
      };
      headers.forEach((h4, cIdx) => {
        if (!mergeHeaderSet.has(h4)) return;
        const leftGateHeaders = headers.slice(0, cIdx).filter((lh) => mergeHeaderSet.has(lh));
        let i2 = 0;
        while (i2 < cleanRows.length) {
          if ((rowKinds[i2] ?? 0) !== 0) {
            i2++;
            continue;
          }
          const v2 = cleanRows[i2]?.[h4];
          if (v2 == null || String(v2) === "") {
            i2++;
            continue;
          }
          let j2 = i2 + 1;
          while (j2 < cleanRows.length && (rowKinds[j2] ?? 0) === 0 && cleanRows[j2]?.[h4] === v2) {
            if (leftGateHeaders.some((lh) => cleanRows[j2]?.[lh] !== cleanRows[j2 - 1]?.[lh])) break;
            j2++;
          }
          const span = j2 - i2;
          if (span > 1) {
            let p2 = mergeParticipation.get(h4);
            if (!p2) {
              p2 = /* @__PURE__ */ new Set();
              mergeParticipation.set(h4, p2);
            }
            for (let r2 = i2; r2 < j2; r2++) p2.add(r2);
            addUnderline(j2 - 1, cIdx);
          } else {
            const hasLeftMergeContext = leftGateHeaders.some((lh) => mergeParticipation.get(lh)?.has(i2));
            if (hasLeftMergeContext) addUnderline(i2, cIdx);
          }
          i2 = j2;
        }
      });
    }
    const ensureRowUnderlineSet = /* @__PURE__ */ new Set();
    if (underlineMergedGroups) {
      for (const [r2, cStart] of mergeUnderlineStartByRow.entries()) {
        for (let c2 = cStart; c2 <= range.e.c; c2++) ensureRowUnderlineSet.add(`${r2}:${c2}`);
      }
    }
    for (let c2 = range.s.c; c2 <= range.e.c; c2++) {
      const addr = xlsxUtils.encode_cell({ r: 0, c: c2 });
      const cell = ws[addr];
      if (!cell) continue;
      cell.s = {
        font: { ...fontBase, bold: true, color: { rgb: "FFF9FAFB" } },
        fill: { fgColor: { rgb: "FF334155" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: {
          top: { style: "thin", color: borderColor },
          bottom: { style: "thin", color: borderColor }
        }
      };
    }
    for (let r2 = 1; r2 <= range.e.r; r2++) {
      const rowType = rowKinds[r2 - 1] ?? 0;
      const isSubtotal = rowType === 1;
      const isGrand = rowType === 3;
      const isSpacer = rowType === 2;
      const isSummary = isSubtotal || isGrand;
      const summaryBorder = {
        style: isGrand ? "thick" : "medium",
        color: isGrand ? grandBorderColor : borderColor
      };
      const rowObj = cleanRows[r2 - 1] || {};
      let lastDataColIdx = range.s.c;
      if (isSummary) {
        lastDataColIdx = range.e.c;
      } else {
        for (let i2 = headers.length - 1; i2 >= 0; i2--) {
          const v2 = rowObj[headers[i2]];
          if (v2 != null && String(v2) !== "") {
            lastDataColIdx = range.s.c + i2;
            break;
          }
        }
      }
      const rowUnderlineStart = mergeUnderlineStartByRow.get(r2);
      const hasRowUnderline = rowUnderlineStart != null;
      for (let c2 = range.s.c; c2 <= range.e.c; c2++) {
        const addr = xlsxUtils.encode_cell({ r: r2, c: c2 });
        let cell = ws[addr];
        const shouldPersistBlank = isSummary || !isSummary && ensureRowUnderlineSet.has(`${r2}:${c2}`);
        const isStubOrUndefined = !!cell && (cell.t === "z" || cell.v === void 0);
        if (shouldPersistBlank && (!cell || isStubOrUndefined)) {
          cell = { t: "s", v: "" };
          ws[addr] = cell;
        }
        if (!cell) continue;
        if (isSpacer) {
          cell.s = {
            font: { ...fontBase, color: { rgb: "FF6B7280" } },
            alignment: { horizontal: "left", vertical: "center" }
          };
          continue;
        }
        const isNumeric = cell.t === "n";
        if (isNumeric && !cell.z) {
          cell.z = Number.isInteger(cell.v) ? "#,##0" : "#,##0.00########";
        }
        const isMergedAnchor = mergeStartSet.has(`${r2}:${c2}`);
        const border = {};
        if (isSummary) {
          border.top = summaryBorder;
          border.bottom = summaryBorder;
          if (c2 === range.s.c) border.left = summaryBorder;
          if (c2 === lastDataColIdx) border.right = summaryBorder;
        }
        if (!isSummary && hasRowUnderline && c2 >= rowUnderlineStart) {
          border.bottom = { style: "thin", color: borderColor };
        }
        const style = {
          font: { ...fontBase, bold: isSummary },
          alignment: {
            horizontal: isNumeric ? "right" : "left",
            vertical: isMergedAnchor ? "top" : "center",
            wrapText: isMergedAnchor
          },
          border
        };
        if (isGrand) style.fill = { fgColor: { rgb: "FFE2E8F0" } };
        else if (isSubtotal) style.fill = { fgColor: { rgb: "FFF1F5F9" } };
        cell.s = style;
      }
    }
    ws["!autofilter"] = { ref };
    ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
    ws["!cols"] = headers.map((h4) => {
      let maxLen = String(h4 || "").length;
      const sample = Math.min(cleanRows.length, WIDTH_SAMPLE_ROWS);
      for (let i2 = 0; i2 < sample; i2++) {
        const v2 = cleanRows[i2]?.[h4];
        if (v2 == null) continue;
        maxLen = Math.max(maxLen, String(v2).length);
      }
      return { wch: Math.min(MAX_COL_WCH, Math.max(MIN_COL_WCH, maxLen + 2)), MDW: 6, customWidth: 1 };
    });
    ws["!rows"] = ws["!rows"] || [];
    ws["!rows"][0] = { ...ws["!rows"][0] || {}, hpt: 24 };
    for (let r2 = 1; r2 <= range.e.r; r2++) {
      ws["!rows"][r2] = { ...ws["!rows"][r2] || {}, hpt: BODY_ROW_HPT };
    }
  }

  // js/core/state-schema.ts
  var STATE_VERSION = 1;
  var RECOGNIZABLE_KEYS = ["base", "baseCols", "stacks", "lookups", "calcStages", "filters", "sorts", "colOrder", "selCols", "aggMode", "aggregates", "colTotals", "subtotalBy", "subtotalFns", "subtotalStrategy"];
  function isRecognizableConfig(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    let matches = 0;
    for (const key of RECOGNIZABLE_KEYS) {
      if (key in payload) matches++;
    }
    return matches >= 2;
  }

  // js/core/state-serializer.ts
  function saveState() {
    if (!db.base) {
      toast("Nothing to save \u2014 load a data file first.", "err");
      return;
    }
    if (typeof saveActiveAggModeState === "function") saveActiveAggModeState();
    if (typeof ensureAggModeState === "function") ensureAggModeState();
    const raw = window.prompt("Save query as:", "my-query");
    if (raw === null) return;
    const name = (raw.trim() || "my-query").replace(/\.rcjson$/i, "");
    const excludedRowsSerial = {};
    for (const [tid, set] of Object.entries(db.excludedRows)) {
      if (set && set.size) excludedRowsSerial[tid] = [...set];
    }
    const payload = {
      v: STATE_VERSION,
      base: db.base,
      baseCols: db.baseCols ? [...db.baseCols] : null,
      stacks: [...db.stacks || []],
      lookups: (db.lookups || []).map((l2) => ({
        rightId: l2.rightId,
        keyPairs: (l2.keyPairs || []).map((p2) => ({ left: p2.left, right: p2.right })),
        cols: [...l2.cols || []],
        required: !!l2.required,
        enabled: l2.enabled !== false,
        duplicatePolicy: l2.duplicatePolicy ? { ...l2.duplicatePolicy } : { mode: "block" }
      })),
      calcStages: (db.calcStages || []).map((c2) => ({
        alias: (c2.alias || "").trim(),
        mode: c2.mode,
        enabled: c2.enabled !== false,
        ...c2.math ? { math: JSON.parse(JSON.stringify(c2.math)) } : {},
        ...c2.compare ? { compare: JSON.parse(JSON.stringify(c2.compare)) } : {},
        ...c2.text ? { text: JSON.parse(JSON.stringify(c2.text)) } : {}
      })),
      selCols: db.selCols ? [...db.selCols] : null,
      colOrder: db.colOrder ? [...db.colOrder] : null,
      filters: db.filters.map((f2) => ({
        col: f2.col || "",
        op: f2.op || "contains",
        vals: Array.isArray(f2.vals) ? [...f2.vals] : [""],
        enabled: f2.enabled !== false
      })),
      sorts: db.sorts.map((s2) => ({ col: s2.col || "", dir: s2.dir === "DESC" ? "DESC" : "ASC", enabled: s2.enabled !== false })),
      groupBy: [...db.groupBy],
      aggregates: db.aggregates.map((a2) => ({ ...a2 })),
      aggMode: db.aggMode || "none",
      aggModeState: JSON.parse(JSON.stringify(db.aggModeState || {})),
      colTotals: { ...db.colTotals || {} },
      subtotalBy: [...db.subtotalBy || []],
      subtotalFns: { ...db.subtotalFns || {} },
      subtotalGrandTotal: db.subtotalGrandTotal !== false,
      subtotalSpacer: !!db.subtotalSpacer,
      subtotalOnTop: !!db.subtotalOnTop,
      subtotalStrategy: db.subtotalStrategy || "combined",
      mergedCols: [...db.mergedCols || []],
      mergeGroupUnderline: !!db.mergeGroupUnderline,
      colState: db.colState || null,
      excludedRows: excludedRowsSerial,
      tableColors: { ...db.tableColors || {} },
      columnLabels: JSON.parse(JSON.stringify(db.columnLabels || {}))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    dl(blob, name + ".rcjson");
  }
  if (typeof window !== "undefined") window.saveState = saveState;

  // js/core/state-applier.ts
  function applyState(next, nextExcludedRows) {
    Object.assign(db, next);
    for (const [tid, set] of Object.entries(nextExcludedRows)) {
      db.excludedRows[tid] = set;
    }
    invalidateValidation();
    loadAggModeState(db.aggMode || "none");
    renderQueryBuilder();
    if (db.base) {
      try {
        renderMergeToggles(projectedCols());
      } catch (_2) {
      }
    }
  }
  if (typeof window !== "undefined") window.applyState = applyState;

  // js/core/state-hydrator.ts
  function hydrateState(payload) {
    const next = {};
    const brokenRefs = [];
    const nextAvailableCols = () => {
      const cols = projectedColsUpToLookup((next.lookups || []).length, next);
      const colSet = new Set(cols);
      for (const c2 of next.calcStages || []) {
        if (c2.alias) colSet.add(c2.alias);
      }
      return colSet;
    };
    const savedBase = payload.base || "";
    next.base = savedBase;
    const baseLoaded = !!(savedBase && db.tables[savedBase]);
    if (!baseLoaded) {
      brokenRefs.push(`Primary sheet "${savedBase || "(none)"}" is not loaded`);
    }
    if (Array.isArray(payload.baseCols)) {
      const dropped = baseLoaded ? payload.baseCols.filter((c2) => !db.tables[savedBase].cols.includes(c2)) : [];
      if (dropped.length) brokenRefs.push(`Base columns not available: ${dropped.join(", ")}`);
      next.baseCols = [...payload.baseCols];
    } else {
      next.baseCols = null;
    }
    next.stacks = [];
    for (const id of payload.stacks || []) {
      if (!db.tables[id]) {
        brokenRefs.push(`Stacked sheet "${id}" is not loaded`);
        next.stacks.push(id);
        continue;
      }
      if (!next.stacks.includes(id)) next.stacks.push(id);
    }
    next.lookups = [];
    for (const lk of payload.lookups || []) {
      const rt = lk.rightId && db.tables[lk.rightId];
      if (!lk.rightId || !rt) {
        brokenRefs.push(`Lookup sheet "${lk.rightId || "(none)"}" is not loaded`);
        next.lookups.push({
          rightId: lk.rightId || "",
          keyPairs: Array.isArray(lk.keyPairs) ? lk.keyPairs.map((p2) => ({ left: p2.left || "", right: p2.right || "" })) : [{ left: "", right: "" }],
          cols: Array.isArray(lk.cols) ? [...lk.cols] : [],
          required: !!lk.required,
          enabled: lk.enabled !== false,
          duplicatePolicy: lk.duplicatePolicy && lk.duplicatePolicy.mode ? { ...lk.duplicatePolicy } : { mode: "block" }
        });
        continue;
      }
      const leftAvail = baseLoaded ? projectedColsUpToLookup(next.lookups.length, next) : [];
      const keyPairs = (Array.isArray(lk.keyPairs) ? lk.keyPairs : []).map((p2) => {
        const leftOk = !baseLoaded || leftAvail.includes(p2.left);
        const rightOk = rt.cols.includes(p2.right);
        if (!leftOk && p2.left) brokenRefs.push(`Match column "${p2.left}" not found (left side of lookup from "${rt.name}")`);
        if (!rightOk && p2.right) brokenRefs.push(`Match column "${p2.right}" not found in "${rt.name}"`);
        return { left: p2.left || "", right: p2.right || "" };
      });
      const cols = Array.isArray(lk.cols) ? lk.cols : [...rt.cols];
      next.lookups.push({ rightId: lk.rightId, keyPairs, cols, required: !!lk.required, enabled: lk.enabled !== false, duplicatePolicy: lk.duplicatePolicy && lk.duplicatePolicy.mode ? { ...lk.duplicatePolicy } : { mode: "block" } });
    }
    const VALID_CALC_MODES = /* @__PURE__ */ new Set(["math", "compare", "text", "date"]);
    function _checkColRef(colName, baseLoaded2, availNow, alias, brokenRefs2) {
      if (colName && baseLoaded2 && availNow.size && !availNow.has(colName)) {
        brokenRefs2.push(`Calculated column "${alias}" references unavailable column "${colName}"`);
      }
    }
    next.calcStages = [];
    for (const c2 of payload.calcStages || []) {
      const alias = (c2.alias || "").trim();
      const enabled = c2.enabled !== false;
      if (!c2.mode || !VALID_CALC_MODES.has(c2.mode)) {
        brokenRefs.push(`Calculated column "${alias}" has an unsupported or missing mode`);
        next.calcStages.push({ ...c2, alias, enabled });
        continue;
      }
      if (!alias) {
        brokenRefs.push("Calculated stage has no alias");
        next.calcStages.push({ ...c2, alias, enabled });
        continue;
      }
      const availNow = nextAvailableCols();
      if (c2.mode === "math") {
        const math = c2.math;
        if (math && Array.isArray(math.steps)) {
          for (const step of math.steps) {
            _checkColRef(step.type === "column" ? step.value : null, baseLoaded, availNow, alias, brokenRefs);
          }
        }
      }
      if (c2.mode === "compare") {
        const compare = c2.compare;
        if (compare && Array.isArray(compare.conditions)) {
          for (const cond of compare.conditions) {
            _checkColRef(cond.col, baseLoaded, availNow, alias, brokenRefs);
          }
        }
        if (compare && compare.trueValue) {
          _checkColRef(compare.trueValue.type === "column" ? compare.trueValue.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
        if (compare && compare.falseValue) {
          _checkColRef(compare.falseValue.type === "column" ? compare.falseValue.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
      }
      if (c2.mode === "text") {
        const text = c2.text;
        if (text) {
          if (text.operation === "combine" && Array.isArray(text.parts)) {
            for (const part of text.parts) {
              _checkColRef(part.type === "column" ? part.value : null, baseLoaded, availNow, alias, brokenRefs);
            }
          }
          if (text.source) {
            _checkColRef(text.source.type === "column" ? text.source.value : null, baseLoaded, availNow, alias, brokenRefs);
          }
        }
      }
      if (c2.mode === "date") {
        const date = c2.date;
        if (date && date.operation === "extract" && date.source) {
          _checkColRef(date.source.type === "column" ? date.source.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
      }
      next.calcStages.push({ ...c2, alias, enabled });
    }
    const available = nextAvailableCols();
    if (payload.selCols === null) {
      next.selCols = null;
    } else if (Array.isArray(payload.selCols)) {
      const dropped = baseLoaded ? payload.selCols.filter((c2) => !available.has(c2)) : [];
      if (dropped.length) brokenRefs.push(`Selected columns not available: ${dropped.join(", ")}`);
      next.selCols = new Set(payload.selCols);
    } else {
      next.selCols = null;
    }
    next.colOrder = Array.isArray(payload.colOrder) ? [...payload.colOrder] : null;
    next.filters = [];
    for (const f2 of payload.filters || []) {
      if (f2.col && baseLoaded && !available.has(f2.col)) {
        brokenRefs.push(`Filter on column "${f2.col}" is not available`);
      }
      const vals = Array.isArray(f2.vals) ? [...f2.vals] : f2.vals;
      next.filters.push({ col: f2.col || "", op: f2.op || "contains", vals, enabled: f2.enabled !== false });
    }
    const gbDropped = baseLoaded ? (payload.groupBy || []).filter((c2) => !available.has(c2)) : [];
    if (gbDropped.length) brokenRefs.push(`Group By columns not available: ${gbDropped.join(", ")}`);
    next.groupBy = [...payload.groupBy || []];
    next.aggregates = [];
    for (const a2 of payload.aggregates || []) {
      if (a2.col && a2.col !== "*" && baseLoaded && !available.has(a2.col)) {
        brokenRefs.push(`Aggregate "${a2.alias || a2.fn}" on column "${a2.col}" is not available`);
      }
      next.aggregates.push({ fn: a2.fn || "SUM", col: a2.col || "*", alias: a2.alias || "" });
    }
    next.sorts = [];
    for (const s2 of payload.sorts || []) {
      if (s2.col && baseLoaded && !available.has(s2.col)) {
        brokenRefs.push(`Sort on column "${s2.col}" is not available`);
      }
      next.sorts.push({ col: s2.col || "", dir: s2.dir === "DESC" ? "DESC" : "ASC", enabled: s2.enabled !== false });
    }
    next.aggMode = typeof payload.aggMode === "string" ? payload.aggMode : "none";
    next.colTotals = {};
    for (const [col, fn] of Object.entries(payload.colTotals || {})) {
      if (baseLoaded && !available.has(col)) brokenRefs.push(`Totals column "${col}" not available`);
      next.colTotals[col] = fn;
    }
    const sbDropped = baseLoaded ? (payload.subtotalBy || []).filter((c2) => !available.has(c2)) : [];
    if (sbDropped.length) brokenRefs.push(`Subtotal By columns not available: ${sbDropped.join(", ")}`);
    next.subtotalBy = [...payload.subtotalBy || []];
    next.subtotalFns = {};
    for (const [col, fn] of Object.entries(payload.subtotalFns || {})) {
      if (baseLoaded && !available.has(col)) brokenRefs.push(`Subtotal function column "${col}" not available`);
      next.subtotalFns[col] = fn;
    }
    next.subtotalGrandTotal = payload.subtotalGrandTotal !== false;
    next.subtotalSpacer = !!payload.subtotalSpacer;
    next.subtotalOnTop = !!payload.subtotalOnTop;
    next.subtotalStrategy = payload.subtotalStrategy === "nested" ? "nested" : "combined";
    if (!payload.aggModeState || typeof payload.aggModeState !== "object") {
      next.aggModeState = null;
    } else {
      const raw = payload.aggModeState;
      const rawNone = raw.none && typeof raw.none === "object" ? raw.none : null;
      const rawGroup = raw.group && typeof raw.group === "object" ? raw.group : null;
      const rawTotals = raw.totals && typeof raw.totals === "object" ? raw.totals : null;
      const rawSubtotals = raw.subtotals && typeof raw.subtotals === "object" ? raw.subtotals : null;
      next.aggModeState = {
        none: rawNone ? {
          selCols: Array.isArray(rawNone.selCols) ? [...rawNone.selCols] : null
        } : null,
        group: rawGroup ? {
          groupBy: Array.isArray(rawGroup.groupBy) ? [...rawGroup.groupBy] : [],
          aggregates: Array.isArray(rawGroup.aggregates) ? rawGroup.aggregates.map((a2) => ({ fn: a2.fn || "SUM", col: a2.col || "*", alias: a2.alias || "", auto: !!a2.auto })) : []
        } : null,
        totals: rawTotals ? {
          selCols: Array.isArray(rawTotals.selCols) ? [...rawTotals.selCols] : null,
          colTotals: rawTotals.colTotals && typeof rawTotals.colTotals === "object" ? { ...rawTotals.colTotals } : {}
        } : null,
        subtotals: rawSubtotals ? {
          selCols: Array.isArray(rawSubtotals.selCols) ? [...rawSubtotals.selCols] : null,
          subtotalBy: Array.isArray(rawSubtotals.subtotalBy) ? [...rawSubtotals.subtotalBy] : [],
          subtotalFns: rawSubtotals.subtotalFns && typeof rawSubtotals.subtotalFns === "object" ? { ...rawSubtotals.subtotalFns } : {},
          subtotalGrandTotal: rawSubtotals.subtotalGrandTotal !== false,
          subtotalSpacer: !!rawSubtotals.subtotalSpacer,
          subtotalOnTop: !!rawSubtotals.subtotalOnTop,
          subtotalStrategy: rawSubtotals.subtotalStrategy === "nested" ? "nested" : "combined"
        } : null
      };
    }
    next.mergedCols = (payload.mergedCols || []).filter((c2) => typeof c2 === "string");
    next.mergeGroupUnderline = !!payload.mergeGroupUnderline;
    next.colState = Array.isArray(payload.colState) ? payload.colState : null;
    const nextExcludedRows = {};
    if (payload.excludedRows && typeof payload.excludedRows === "object") {
      for (const [tid, arr] of Object.entries(payload.excludedRows)) {
        if (Array.isArray(arr) && arr.length) {
          nextExcludedRows[tid] = new Set(arr);
        }
      }
    }
    next.tableColors = {};
    for (const [tid, color] of Object.entries(payload.tableColors || {})) {
      if (typeof color === "string" && color.startsWith("#")) {
        next.tableColors[tid] = color;
      }
    }
    next.columnLabels = {};
    for (const [tid, labels] of Object.entries(payload.columnLabels || {})) {
      if (!labels || typeof labels !== "object") continue;
      const kept = {};
      for (const [col, label] of Object.entries(labels)) {
        if (label && label !== col) kept[col] = label;
      }
      if (Object.keys(kept).length) next.columnLabels[tid] = kept;
    }
    return { next, brokenRefs, nextExcludedRows };
  }
  if (typeof window !== "undefined") window.applyState = applyState;

  // js/core/state-loader.ts
  function loadState(file) {
    const reader = new FileReader();
    reader.onload = (e2) => {
      let payload = {};
      try {
        payload = JSON.parse(e2.target.result);
      } catch {
        toast("Could not parse state file \u2014 is it a valid .rcjson file?", "err");
        return;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        toast("Invalid state file.", "err");
        return;
      }
      if (!isRecognizableConfig(payload)) {
        toast("File does not appear to be a TableFlip report configuration.", "err");
        return;
      }
      if (payload.v !== STATE_VERSION) {
        toast(`Version mismatch (saved: ${JSON.stringify(payload.v)}, app: ${STATE_VERSION}). Loaded with best-effort \u2014 check items for issues.`, "warn");
      }
      const { next, brokenRefs, nextExcludedRows } = hydrateState(payload);
      applyState(next, nextExcludedRows);
      if (brokenRefs.length) {
        const summary = brokenRefs.length === 1 ? `1 item needs attention: ${brokenRefs[0]}.` : `${brokenRefs.length} items need attention \u2014 missing sheets or columns. Run the report to see full details.`;
        toast(`Report setup loaded with issues \u2014 ${summary}`, "warn");
      } else {
        toast("Report setup loaded.", "ok");
      }
    };
    reader.onerror = () => toast("Failed to read file.", "err");
    reader.readAsText(file);
  }
  if (typeof window !== "undefined") window.loadState = loadState;
  (function() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".rcjson";
    inp.hidden = true;
    inp.id = "qbsInput";
    inp.addEventListener("change", () => {
      if (inp.files?.[0]) loadState(inp.files[0]);
      inp.value = "";
    });
    document.body.appendChild(inp);
  })();

  // js/ui/sidebar.ts
  function renderSidebar() {
    const ids = Object.keys(db.tables).sort((a2, b2) => db.tables[a2].name.localeCompare(db.tables[b2].name));
    document.getElementById("tableCount").textContent = String(ids.length);
    const list = document.getElementById("tablesList");
    if (!ids.length) {
      list.innerHTML = '<div class="empty" style="flex:none;padding:16px"><div class="empty-icon">\u{1F4CB}</div><div>No tables loaded</div></div>';
      return;
    }
    list.innerHTML = ids.map((id) => {
      const t2 = db.tables[id];
      return `<div class="tcard" data-tid="${id}" style="border-left:3px solid ${getTableColor(id)}">
      <div class="tcard-rm" data-rm="${id}">\u2715</div>
      <div class="tcard-name" title="${h(t2.name)}">${h(t2.name)}</div>
      <div class="tcard-meta">${t2.rowCount.toLocaleString()} rows &middot; ${t2.cols.length} cols</div>
    </div>`;
    }).join("");
  }
  if (typeof document !== "undefined") {
    document.getElementById("tablesList").addEventListener("click", (e2) => {
      const rm = e2.target.closest("[data-rm]");
      const card = e2.target.closest("[data-tid]");
      if (rm) removeTable(rm.dataset.rm);
      else if (card) previewTable(card.dataset.tid);
    });
  }
  function removeTable(id) {
    dropTable(id);
    delete db.tables[id];
    if (db.base === id) {
      Object.assign(db, { base: "", selCols: null, groupBy: [], aggregates: [], filters: [] });
    }
    renderSidebar();
    renderQueryBuilder();
    renderPreviewDropdown();
  }
  function previewTable(id) {
    document.getElementById("previewSel").value = id;
    switchTab("preview");
    loadPreview();
  }

  // js/ui/loader.ts
  var _pendingLoads = 0;
  var _sheetsLoaded = 0;
  function _loadOverlay() {
    return document.getElementById("loadOverlay");
  }
  function _startLoad() {
    _pendingLoads++;
    _loadOverlay().classList.add("active");
  }
  function _endLoad() {
    _pendingLoads = Math.max(0, _pendingLoads - 1);
    if (_pendingLoads === 0) {
      _loadOverlay().classList.remove("active");
      const n2 = _sheetsLoaded;
      _sheetsLoaded = 0;
      toast(`Loaded ${n2} sheet${n2 !== 1 ? "s" : ""}`, "ok");
    }
  }
  function _countSheet() {
    _sheetsLoaded++;
  }
  var _modalQueue = [];
  var _modalOpen = false;
  function _enqueueModal(wb, filename, sheets) {
    _modalQueue.push({ wb, filename, sheets });
    if (!_modalOpen) _showNextModal();
  }
  function _showNextModal() {
    if (!_modalQueue.length) {
      _modalOpen = false;
      return;
    }
    _modalOpen = true;
    const { wb, filename, sheets } = _modalQueue[0];
    document.getElementById("modalFile").textContent = filename;
    const container = document.getElementById("modalSheets");
    container.innerHTML = "";
    sheets.forEach((name) => {
      const ws = wb.Sheets[name];
      let rows = "?", cols = "?";
      try {
        const r2 = XLSX.utils.decode_range(ws["!ref"]);
        rows = (r2.e.r - r2.s.r).toLocaleString();
        cols = r2.e.c - r2.s.c + 1;
      } catch (_2) {
      }
      const id = "chk_" + Math.random().toString(36).slice(2);
      const row = document.createElement("div");
      row.className = "sheet-opt";
      row.innerHTML = `
      <label style="display:flex;align-items:center;gap:10px;flex:1;cursor:pointer">
        <input type="checkbox" id="${h(id)}" value="${h(name)}" checked style="width:14px;height:14px;flex-shrink:0">
        <div>
          <div class="sheet-opt-name">${h(name)}</div>
          <div class="sheet-opt-meta">~${rows} rows &middot; ${cols} cols</div>
        </div>
      </label>`;
      container.appendChild(row);
    });
    document.getElementById("sheetModal").style.display = "flex";
  }
  function confirmModal() {
    if (!_modalQueue.length) return;
    const { wb, filename, sheets } = _modalQueue.shift();
    const checked = [...document.querySelectorAll("#modalSheets input[type=checkbox]:checked")].map((cb) => cb.value);
    document.getElementById("sheetModal").style.display = "none";
    if (checked.length) {
      _startLoad();
      for (const name of checked) {
        const label = sheets.length === 1 ? stripExt(filename) : stripExt(filename) + " \u2014 " + name;
        ingestSheet(wb, name, label);
        _countSheet();
      }
      _endLoad();
    }
    _showNextModal();
  }
  if (typeof window !== "undefined") window.confirmModal = confirmModal;
  function closeModal2() {
    if (!_modalQueue.length) return;
    _modalQueue.shift();
    document.getElementById("sheetModal").style.display = "none";
    _showNextModal();
  }
  if (typeof window !== "undefined") window.closeModal = closeModal2;
  (function() {
    const overlay = document.getElementById("dropOverlay");
    let dragDepth = 0;
    document.addEventListener("dragenter", (e2) => {
      if (!e2.dataTransfer.types.includes("Files")) return;
      dragDepth++;
      overlay.classList.add("active");
    });
    document.addEventListener("dragleave", () => {
      dragDepth--;
      if (dragDepth <= 0) {
        dragDepth = 0;
        overlay.classList.remove("active");
      }
    });
    document.addEventListener("dragover", (e2) => {
      e2.preventDefault();
    });
    document.addEventListener("drop", (e2) => {
      dragDepth = 0;
      overlay.classList.remove("active");
      if (e2.defaultPrevented) return;
      e2.preventDefault();
      [...e2.dataTransfer.files].forEach(loadFile);
    });
  })();
  var fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", (e2) => {
    const target = e2.target;
    [...target.files].forEach(loadFile);
    fileInput.value = "";
  });
  function loadFile(file) {
    if (!window.sqlDb) {
      toast("Database not ready yet", "err");
      return;
    }
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "rcjson") {
      loadState(file);
      return;
    }
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      toast(`Unsupported file type ".${ext}" \u2014 drop xlsx, xls, csv, or rcjson files.`, "err");
      return;
    }
    const reader = new FileReader();
    if (ext === "csv") {
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "string", dense: true });
          ingestSheet(wb, wb.SheetNames[0], stripExt(file.name));
          _countSheet();
        } catch (ex) {
          toast("Could not parse " + file.name + ": " + ex.message, "err");
        }
        _endLoad();
      };
      reader.onerror = () => {
        toast("Could not read " + file.name, "err");
        _endLoad();
      };
      _startLoad();
      reader.readAsText(file);
    } else {
      reader.onload = (ev) => {
        try {
          let wb = XLSX.read(ev.target.result, { type: "array", cellDates: true, dense: true });
          const usable = wb.SheetNames.filter((n2) => wb.Sheets[n2] && wb.Sheets[n2]["!ref"]);
          if (!usable.length) {
            toast("No data found in " + file.name, "err");
            _endLoad();
            return;
          }
          if (usable.length === 1) {
            ingestSheet(wb, usable[0], stripExt(file.name));
            _countSheet();
          } else {
            _enqueueModal(wb, file.name, usable);
          }
          wb = null;
        } catch (ex) {
          toast("Could not parse " + file.name + ": " + ex.message, "err");
        }
        _endLoad();
      };
      reader.onerror = () => {
        toast("Could not read " + file.name, "err");
        _endLoad();
      };
      _startLoad();
      reader.readAsArrayBuffer(file);
    }
  }
  function expandMerges(ws) {
    const merges = ws["!merges"];
    if (!merges || !merges.length) return;
    const dense = Array.isArray(ws["!data"]) ? ws["!data"] : Array.isArray(ws) ? ws : null;
    if (dense) {
      merges.forEach(({ s: s2, e: e2 }) => {
        const srcCell = (dense[s2.r] || [])[s2.c];
        if (!srcCell) return;
        for (let r2 = s2.r; r2 <= e2.r; r2++) {
          if (!dense[r2]) dense[r2] = [];
          for (let c2 = s2.c; c2 <= e2.c; c2++) {
            if (r2 === s2.r && c2 === s2.c) continue;
            const tgt = dense[r2][c2];
            if (!tgt || tgt.v == null || tgt.t === "z") {
              dense[r2][c2] = { ...srcCell };
            }
          }
        }
      });
      return;
    }
    merges.forEach(({ s: s2, e: e2 }) => {
      const srcAddr = XLSX.utils.encode_cell({ r: s2.r, c: s2.c });
      const srcCell = ws[srcAddr];
      if (!srcCell) return;
      for (let r2 = s2.r; r2 <= e2.r; r2++) {
        for (let c2 = s2.c; c2 <= e2.c; c2++) {
          if (r2 === s2.r && c2 === s2.c) continue;
          const addr = XLSX.utils.encode_cell({ r: r2, c: c2 });
          const tgt = ws[addr];
          if (!tgt || tgt.v == null || tgt.t === "z") {
            ws[addr] = { ...srcCell };
          }
        }
      }
    });
  }
  function ingestSheet(wb, sheetName, label) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) {
      toast("Empty sheet: " + sheetName, "err");
      return;
    }
    expandMerges(ws);
    let rawData;
    try {
      rawData = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: false });
    } catch (ex) {
      toast("Parse error: " + ex.message, "err");
      return;
    }
    if (!rawData.length) {
      toast("No rows found in " + sheetName, "err");
      return;
    }
    const _ROWNO = "_rowno";
    rawData.forEach((row, i2) => {
      row[_ROWNO] = i2 + 1;
    });
    const cols = Object.keys(rawData[0]).filter((c2) => c2 !== _ROWNO);
    const allCols = [_ROWNO, ...cols];
    const id = "t_" + label.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
    if (db.tables[id]) {
      dropTable(id);
      delete db.excludedRows[id];
    }
    try {
      createTable(id, allCols);
      insertRows(id, allCols, rawData);
    } catch (ex) {
      dropTable(id);
      toast("DB insert error: " + ex.message, "err");
      return;
    }
    const TOTAL_RE = /^\s*(grand\s+)?total[s]?\s*[:：]?|subtotal[s]?\s*[:：]?/i;
    const suggested = /* @__PURE__ */ new Set();
    const suggestedPreviews = /* @__PURE__ */ new Map();
    for (const row of rawData) {
      for (const c2 of cols) {
        const v2 = row[c2];
        if (v2 == null) continue;
        if (TOTAL_RE.test(String(v2))) {
          suggested.add(row[_ROWNO]);
          const snippets = cols.map((col) => row[col]).filter((val) => val != null && String(val).trim() !== "").slice(0, 5).map((val) => String(val).trim());
          suggestedPreviews.set(row[_ROWNO], snippets.join(" \xB7 "));
          break;
        }
      }
    }
    const samples = {};
    for (const col of cols) {
      const seen = /* @__PURE__ */ new Set();
      const vals = [];
      for (const row of rawData) {
        const v2 = row[col];
        if (v2 == null) continue;
        const s2 = String(v2).trim();
        if (!s2 || seen.has(s2)) continue;
        seen.add(s2);
        vals.push(s2);
        if (vals.length >= 3) break;
      }
      samples[col] = vals;
    }
    rawData = null;
    db.excludedRows[id] = /* @__PURE__ */ new Set();
    const rowCount = tableRowCount(id);
    db.tables[id] = { id, name: label, cols, rowCount, samples };
    getTableColor(id);
    if (!db.base) db.base = id;
    renderSidebar();
    renderQueryBuilder();
    renderPreviewDropdown();
    if (suggested.size) {
      const previews = [...suggestedPreviews.values()];
      const previewStr = previews.length === 1 ? `"${previews[0]}"` : previews.map((p2) => `"${p2}"`).join(", ");
      const noun = suggested.size === 1 ? "row" : "rows";
      const btnLabel = suggested.size === 1 ? "Exclude it" : "Exclude them";
      stickyToast(
        `"${label}": ${suggested.size} ${noun} may be a totals ${noun}
Row contents \u2192 ${previewStr}`,
        "warn",
        () => {
          db.excludedRows[id] = new Set(suggested);
          if (document.getElementById("previewSel").value === id) loadPreview();
        },
        btnLabel
      );
    }
  }

  // js/app.ts
  if (typeof window !== "undefined") window.initDb = initDb;
  initDb().then(() => {
    document.getElementById("loadingOverlay").style.display = "none";
  }).catch((err) => {
    document.getElementById("loadingOverlay").innerHTML = `
      <div style="font-size:2rem">\u274C</div>
      <div style="font-size:1rem;font-weight:600">Failed to load database engine</div>
      <div style="font-size:0.8rem;color:var(--muted)">${err.message}</div>
      <div style="font-size:0.8rem;color:var(--muted);margin-top:6px">Check your internet connection \u2014 the SQLite WASM runtime is fetched from cdn.jsdelivr.net.</div>
    `;
  });
  if (!window.XLSX) {
    console.error("[xlsx] runtime missing");
  } else if (window.XLSX.style_version !== "1.3.0") {
    console.warn("[xlsx] expected xlsx-js-style 1.3.0, got", window.XLSX.style_version || window.XLSX.version);
  }
  if (typeof document !== "undefined") {
    const tipBox = document.createElement("div");
    Object.assign(tipBox.style, {
      position: "fixed",
      zIndex: "9500",
      display: "none",
      background: "var(--bg2)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      padding: "9px 13px",
      fontSize: "0.76rem",
      lineHeight: "1.6",
      color: "var(--text)",
      whiteSpace: "pre-wrap",
      maxWidth: "300px",
      pointerEvents: "none",
      boxShadow: "0 4px 20px rgba(0,0,0,0.55)"
    });
    document.body.appendChild(tipBox);
    document.addEventListener("mouseover", (e2) => {
      if (isContextMenuOpen()) return;
      const src = e2.target.closest("[data-tip]");
      if (!src) return;
      tipBox.textContent = src.dataset.tip;
      tipBox.style.display = "block";
      const r2 = src.getBoundingClientRect();
      const bw = 304;
      let left = r2.left + r2.width / 2 - bw / 2;
      left = Math.max(6, Math.min(left, window.innerWidth - bw - 6));
      const top = r2.top - tipBox.offsetHeight - 8;
      tipBox.style.left = left + "px";
      tipBox.style.top = (top < 6 ? r2.bottom + 8 : top) + "px";
    });
    document.addEventListener("mouseout", (e2) => {
      if (e2.target.closest("[data-tip]")) tipBox.style.display = "none";
    });
  }
})();
