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
    db.tables[base].cols.forEach((c3) => map.set(c3, { tid: base, col: c3 }));
    for (const lk of lookups || []) {
      if (lk.enabled === false) continue;
      if (!lk.rightId || !db.tables[lk.rightId]) continue;
      const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p3) => p3.left && p3.right) : [];
      if (!pairs.length) continue;
      const rt = db.tables[lk.rightId];
      const prefix = tablePrefix(rt.name);
      rt.cols.forEach((c3) => {
        const alias = map.has(c3) ? prefix + c3 : c3;
        if (!map.has(alias)) map.set(alias, { tid: lk.rightId, col: c3 });
      });
    }
    for (const [i3, calc] of (calcStages || []).entries()) {
      if (calc?.enabled === false) continue;
      const alias = (calc?.alias || "").trim();
      if (!alias) continue;
      if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) continue;
      let valid = false;
      if (calc.mode === "math") {
        const m3 = calc.math;
        const steps = m3 && Array.isArray(m3.steps) ? m3.steps : [];
        const structValid = !!(m3 && m3.strategy === "stepChain" && steps.length > 0 && !steps[0].op && steps.every((s3) => s3 && ["column", "number", "text"].includes(s3.type)) && steps.slice(1).every((s3) => s3.op && ["+", "-", "*", "/", "%"].includes(s3.op)));
        const colsExist = structValid && steps.filter((s3) => s3.type === "column" && s3.value).every((s3) => map.has(s3.value));
        valid = structValid && colsExist;
      } else if (calc.mode === "compare") {
        const c3 = calc.compare;
        const conds = Array.isArray(c3?.conditions) ? c3.conditions : [];
        valid = !!(c3 && conds.length > 0 && c3.trueValue && c3.falseValue && conds.every((cond) => cond.col && ["=", "!=", ">", ">=", "<", "<="].includes(cond.op)) && conds.some((cond) => map.has(cond.col)) && ["column", "number", "text"].includes(c3.trueValue.type) && ["column", "number", "text"].includes(c3.falseValue.type));
      } else if (calc.mode === "text") {
        const t3 = calc.text;
        if (t3 && ["combine", "left", "right", "substring"].includes(t3.operation)) {
          if (t3.operation === "combine") {
            const parts = Array.isArray(t3.parts) ? t3.parts : [];
            const structValid = parts.length > 0 && parts.every((p3) => p3 && ["column", "number", "text"].includes(p3.type));
            const colsExist = structValid && parts.filter((p3) => p3.type === "column" && p3.value).every((p3) => map.has(p3.value));
            valid = structValid && colsExist;
          } else {
            const src = t3.source;
            const structValid = !!(src && ["column", "text"].includes(src.type));
            const colExists = structValid && src.type !== "column" ? true : map.has(src.value);
            valid = structValid && colExists;
          }
        }
      } else if (calc.mode === "date") {
        const d3 = calc.date;
        if (d3 && d3.operation === "extract") {
          const src = d3.source;
          const structValid = !!(src && src.type === "column");
          const colExists = structValid && map.has(src.value);
          valid = structValid && colExists && ["year", "month", "day", "dow", "week", "quarter", "julian"].includes(d3.part);
        }
      }
      if (!valid) continue;
      if (map.has(alias)) continue;
      map.set(alias, { kind: "calc", mode: calc.mode, idx: i3, calc });
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
    for (let i3 = 0; i3 < upTo; i3++) {
      const lk = (lookups || [])[i3];
      if (!lk || lk.enabled === false || !lk.rightId || !db.tables[lk.rightId]) continue;
      const rt = db.tables[lk.rightId];
      const prefix = tablePrefix(rt.name);
      rt.cols.forEach((c3) => {
        const alias = colSet.has(c3) ? prefix + c3 : c3;
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
      baseCols.forEach((c3) => colMap.set(c3, { tid: base, col: c3 }));
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
      const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p3) => p3.left && p3.right) : [];
      if (!pairs.length) {
        lookupBoundaries.push(new Map(colMap));
        continue;
      }
      const rName = tableName(lk.rightId);
      const prefix = tablePrefix(rName);
      rtCols.forEach((c3) => {
        const alias = colMap.has(c3) ? prefix + c3 : c3;
        if (!colMap.has(alias)) colMap.set(alias, { tid: lk.rightId, col: c3 });
      });
      lookupBoundaries.push(new Map(colMap));
    }
    for (const [i3, calc] of calcStages.entries()) {
      if (calc?.enabled === false) continue;
      const alias = (calc?.alias || "").trim();
      if (!alias) continue;
      if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) continue;
      let valid = false;
      if (calc.mode === "math") {
        const m3 = calc.math;
        const steps = m3 && Array.isArray(m3.steps) ? m3.steps : [];
        const structValid = !!(m3 && m3.strategy === "stepChain" && steps.length > 0 && !steps[0].op && steps.every((s3) => s3 && ["column", "number", "text"].includes(s3.type)) && steps.slice(1).every((s3) => s3.op && ["+", "-", "*", "/", "%"].includes(s3.op)));
        const colsExist = structValid && steps.filter((s3) => s3.type === "column" && s3.value).every((s3) => colMap.has(s3.value));
        valid = structValid && colsExist;
      } else if (calc.mode === "compare") {
        const c3 = calc.compare;
        const conds = Array.isArray(c3?.conditions) ? c3.conditions : [];
        valid = !!(c3 && conds.length > 0 && c3.trueValue && c3.falseValue && conds.every((cond) => cond.col && ["=", "!=", ">", ">=", "<", "<="].includes(cond.op)) && conds.some((cond) => colMap.has(cond.col)) && ["column", "number", "text"].includes(c3.trueValue.type) && ["column", "number", "text"].includes(c3.falseValue.type));
      } else if (calc.mode === "text") {
        const t3 = calc.text;
        if (t3 && ["combine", "left", "right", "substring"].includes(t3.operation)) {
          if (t3.operation === "combine") {
            const parts = Array.isArray(t3.parts) ? t3.parts : [];
            const structValid = parts.length > 0 && parts.every((p3) => p3 && ["column", "number", "text"].includes(p3.type));
            const colsExist = structValid && parts.filter((p3) => p3.type === "column" && p3.value).every((p3) => colMap.has(p3.value));
            valid = structValid && colsExist;
          } else {
            const src = t3.source;
            const structValid = !!(src && ["column", "text"].includes(src.type));
            const colExists = structValid && src.type !== "column" ? true : colMap.has(src.value);
            valid = structValid && colExists;
          }
        }
      } else if (calc.mode === "date") {
        const d3 = calc.date;
        if (d3 && d3.operation === "extract") {
          const src = d3.source;
          const structValid = !!(src && src.type === "column");
          const colExists = structValid && colMap.has(src.value);
          valid = structValid && colExists && ["year", "month", "day", "dow", "week", "quarter", "julian"].includes(d3.part);
        }
      }
      if (!valid) continue;
      if (colMap.has(alias)) continue;
      colMap.set(alias, { kind: "calc", mode: calc.mode, idx: i3, calc });
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
      for (let i3 = 0; i3 < arr.length; i3++) {
        if (arr[i3] === oldAlias) arr[i3] = newAlias;
      }
    };
    replaceInArray(db.groupBy);
    replaceInArray(db.subtotalBy);
    replaceInArray(db.mergedCols);
    for (const a3 of db.aggregates || []) {
      if (a3.col === oldAlias) a3.col = newAlias;
    }
    for (const f4 of db.filters || []) {
      if (f4.col === oldAlias) f4.col = newAlias;
    }
    for (const s3 of db.sorts || []) {
      if (s3.col === oldAlias) s3.col = newAlias;
    }
    for (const c3 of db.calcStages || []) {
      if (c3.mode === "math" && c3.math && typeof c3.math === "object") {
        const math = c3.math;
        if (Array.isArray(math.steps)) {
          for (const step of math.steps) {
            if (step.type === "column" && step.value === oldAlias) step.value = newAlias;
          }
        }
      }
      if (c3.mode === "compare" && c3.compare && typeof c3.compare === "object") {
        const compare = c3.compare;
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
      if (c3.mode === "text" && c3.text && typeof c3.text === "object") {
        const text = c3.text;
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
        for (let i3 = 0; i3 < sel.length; i3++) {
          if (sel[i3] === oldAlias) sel[i3] = newAlias;
        }
      };
      replaceInSel(as.none);
      replaceInSel(as.totals);
      replaceInSel(as.subtotals);
      const groupState = as.group;
      if (groupState && Array.isArray(groupState.groupBy)) {
        const gb = groupState.groupBy;
        for (let i3 = 0; i3 < gb.length; i3++) {
          if (gb[i3] === oldAlias) gb[i3] = newAlias;
        }
      }
      if (groupState && Array.isArray(groupState.aggregates)) {
        for (const a3 of groupState.aggregates) {
          if (a3 && a3.col === oldAlias) a3.col = newAlias;
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
        for (let i3 = 0; i3 < sb.length; i3++) {
          if (sb[i3] === oldAlias) sb[i3] = newAlias;
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
  function h(s3) {
    return String(s3 ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function stripExt(fn) {
    return fn.replace(/\.[^.]+$/, "");
  }
  function dl(blob, name) {
    const url = URL.createObjectURL(blob);
    const a3 = Object.assign(document.createElement("a"), { href: url, download: name });
    a3.click();
    URL.revokeObjectURL(url);
  }
  function getToastContainer() {
    let c3 = document.getElementById("toast-container");
    if (!c3) {
      c3 = document.createElement("div");
      c3.id = "toast-container";
      document.body.appendChild(c3);
    }
    return c3;
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
    const idx = TABLE_PALETTE.findIndex((c3) => !used.has(c3));
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
    const m3 = bg.trim().match(/^#([0-9a-f]{6})$/i);
    if (!m3) return "#111";
    const hex = m3[1];
    const r3 = parseInt(hex.slice(0, 2), 16);
    const g4 = parseInt(hex.slice(2, 4), 16);
    const b2 = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r3 + 0.587 * g4 + 0.114 * b2) / 255;
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
  function coerceForSQL(v3) {
    if (v3 == null) return null;
    if (v3 instanceof Date) return v3.toISOString().slice(0, 19);
    if (typeof v3 === "boolean") return v3 ? 1 : 0;
    if (typeof v3 === "number") return v3;
    const s3 = String(v3).trim();
    const n2 = Number(s3);
    if (s3 !== "" && !isNaN(n2)) return n2;
    return s3 || null;
  }
  function createTable(sqlName, cols) {
    const defs = cols.map((c3) => quoteId(c3)).join(", ");
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
        stmt.run(cols.map((c3) => coerceForSQL(row[c3])));
      }
      stmt.free();
      _sqlDb().run("COMMIT");
    } catch (e3) {
      try {
        _sqlDb().run("ROLLBACK");
      } catch (_3) {
      }
      throw e3;
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
    } catch (e3) {
      throw new Error(e3.message + "\n\nQuery:\n" + sql);
    }
  }
  function dropTable(sqlName) {
    try {
      _sqlDb().run(`DROP TABLE IF EXISTS ${quoteId(sqlName)}`);
    } catch (_3) {
    }
  }
  function tableRowCount(sqlName) {
    try {
      const r3 = _sqlDb().exec(`SELECT COUNT(*) FROM ${quoteId(sqlName)}`);
      return r3[0]?.values[0]?.[0] ?? 0;
    } catch (_3) {
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
    const r3 = Array.isArray(rows) ? rows : [];
    return {
      columns: Array.isArray(columns) ? columns : [],
      rows: r3,
      metadata: Object.assign({
        rowCount: r3.length,
        generatedAt: Date.now(),
        aggMode: "none",
        displayCols: null
      }, metadata || {})
    };
  }

  // js/query/sql-where.ts
  function renderWhereClause(colRef, op, val, params, opts) {
    const likeEsc = (v3) => v3.replace(/%/g, "\\%").replace(/_/g, "\\_");
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
    const s3 = colMap.get(alias);
    if (!s3) return quoteId(alias);
    if (s3.kind !== "calc") {
      const tid = s3.tid === plan.source.base ? baseTid : s3.tid;
      return `${tid === "_base" ? "_base" : quoteId(tid)}.${quoteId(s3.col)}`;
    }
    const trail = new Set(_trail);
    trail.add(alias);
    const calc = s3.calc || (db.calcStages || [])[s3.idx];
    if (!calc) throw new Error(`Cannot render calc "${alias}": calc config not found`);
    if (s3.mode === "math") {
      return _renderModeMath(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s3.mode === "compare") {
      return _renderModeCompare(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s3.mode === "text") {
      return _renderModeText(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s3.mode === "date") {
      return _renderModeDate(calc, alias, colMap, plan, baseTid, trail);
    }
    throw new Error(`Unknown calc mode "${s3.mode}" for "${alias}"`);
  }
  function _renderModeMath(calc, alias, colMap, plan, baseTid, trail) {
    const math = calc.math;
    const steps = math.steps;
    const toNum = _toNum;
    const renderStepVal = (step, t3) => {
      if (step.type === "number") {
        const n2 = parseFloat(step.value || "");
        return Number.isFinite(n2) ? String(n2) : "0";
      }
      if (step.type === "column") {
        const expr2 = _renderCalcExpr(step.value || "", colMap, plan, baseTid, t3);
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
    for (let i3 = 1; i3 < steps.length; i3++) {
      const step = steps[i3];
      const r3 = renderStepVal(step, trail);
      switch (step.op) {
        case "+":
          expr = `(${expr} + ${r3})`;
          break;
        case "-":
          expr = `(${expr} - ${r3})`;
          break;
        case "*":
          expr = `(${expr} * ${r3})`;
          break;
        case "/":
          expr = `(CASE WHEN ${r3} = 0 THEN NULL ELSE ${expr} / ${r3} END)`;
          break;
        case "%":
          expr = `(CASE WHEN ${r3} = 0 THEN NULL ELSE ${expr} % ${r3} END)`;
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
      const parts = text.parts.map((p3) => _renderTextPart(p3, colMap, plan, baseTid, trail));
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
        const branches = names.map((n2, j4) => `WHEN ${j4 + 1} THEN '${n2}'`).join(" ");
        return `(CASE CAST(strftime('%m', ${src}) AS INTEGER) ${branches} END)`;
      };
      const dowCase = (names) => {
        const branches = names.map((n2, j4) => `WHEN ${j4} THEN '${n2}'`).join(" ");
        return `(CASE CAST(strftime('%w', ${src}) AS INTEGER) ${branches} END)`;
      };
      if (part === "quarter") {
        if (output === "short") {
          const branches = [1, 2, 3, 4].map((q4) => `WHEN ${q4} THEN 'Q${q4}'`).join(" ");
          return `(CASE ((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1) ${branches} END)`;
        }
        if (output === "text") {
          const branches = [1, 2, 3, 4].map((q4) => `WHEN ${q4} THEN 'Quarter ${q4}'`).join(" ");
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
      const s3 = colMap.get(alias);
      if (!s3) return quoteId(alias);
      if (s3.kind === "calc") return _renderCalcExpr(alias, colMap, plan, baseTid);
      const tid = s3.tid === base ? baseTid : s3.tid;
      return `${tid === "_base" ? "_base" : quoteId(tid)}.${quoteId(s3.col)}`;
    }
    let fromClause;
    if (hasStacks) {
      const baseCols = src.baseCols || (src.tablesById && src.tablesById.has(base) ? src.tablesById.get(base).cols : []);
      const allTids = [base, ...src.stacks];
      const unionParts = allTids.filter((tid) => src.tablesById && src.tablesById.has(tid)).map((tid) => {
        const tCols = src.tablesById.get(tid).cols;
        const selStr = [`"_rowno"`, ...baseCols.map((c3) => tCols.includes(c3) ? quoteId(c3) : `NULL AS ${quoteId(c3)}`)].join(", ");
        const excl = src.excludedRows ? src.excludedRows[tid] : null;
        let q4 = `SELECT ${selStr} FROM ${quoteId(tid)}`;
        if (excl && excl.size) q4 += ` WHERE "_rowno" NOT IN (${[...excl].join(",")})`;
        return q4;
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
      const keyRightCols = new Set(join.keyPairs.map((p3) => p3.right));
      let rightSource;
      let exclInSubquery = false;
      if (dupPolicy.mode === "combine" && rightCols.length > 0) {
        const combine = Object.assign({ separator: "; ", unique: true, includeBlank: false, sort: false }, dupPolicy.combine || {});
        const aggSeparator = combine.separator === "; " ? '"; "' : `'${combine.separator.replace(/'/g, "''")}'`;
        const valCols = rightCols.filter((c3) => !keyRightCols.has(c3));
        const keyColQuoted = join.keyPairs.map((p3) => quoteId(p3.right));
        const keyColSelects = join.keyPairs.map((p3) => `${quoteId(p3.right)} AS ${quoteId(p3.right)}`);
        const whereClause = join.keyPairs.map((p3) => `${quoteId(p3.right)} IS NOT NULL AND TRIM(${quoteId(p3.right)}) != ''`).join(" AND ");
        const exclClause = join.excludedRows && join.excludedRows.size ? ` AND "_rowno" NOT IN (${[...join.excludedRows].join(",")})` : "";
        const fullWhere = whereClause + exclClause;
        if (combine.unique) {
          const valSubExprs = valCols.map((c3) => {
            let colExpr = quoteId(c3);
            if (!combine.includeBlank) colExpr = `NULLIF(${colExpr}, '')`;
            const orderClause = combine.sort ? ` ORDER BY ${colExpr}` : "";
            const innerSub = `(SELECT DISTINCT ${keyColQuoted.join(", ")}, ${colExpr} AS ${quoteId(c3)} FROM ${quoteId(join.rightId)} WHERE ${fullWhere})`;
            const corrCond = keyColQuoted.map((k3) => `_inner.${k3} = _keys.${k3}`).join(" AND ");
            return `(SELECT GROUP_CONCAT(${quoteId(c3)}, ${aggSeparator}${orderClause}) FROM ${innerSub} AS _inner WHERE ${corrCond}) AS ${quoteId(c3)}`;
          });
          const keyDistinctSub = `(SELECT DISTINCT ${keyColQuoted.join(", ")} FROM ${quoteId(join.rightId)} WHERE ${fullWhere})`;
          const subSql = `SELECT ${keyColSelects.join(", ")}, ${valSubExprs.join(", ")} FROM ${keyDistinctSub} AS _keys`;
          rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
          exclInSubquery = true;
        } else {
          const valExprs = valCols.map((c3) => {
            let colExpr = quoteId(c3);
            if (!combine.includeBlank) colExpr = `NULLIF(${colExpr}, '')`;
            const orderClause = combine.sort ? ` ORDER BY ${quoteId(c3)}` : "";
            return `GROUP_CONCAT(${colExpr}, ${aggSeparator}${orderClause}) AS ${quoteId(c3)}`;
          });
          const selectParts = [...keyColSelects, ...valExprs];
          const subSql = `SELECT ${selectParts.join(", ")} FROM ${quoteId(join.rightId)} WHERE ${fullWhere} GROUP BY ${keyColQuoted.join(", ")}`;
          rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
          exclInSubquery = true;
        }
      } else {
        rightSource = quoteId(join.rightId);
      }
      const onParts = join.keyPairs.map((p3) => `${ref(p3.left)} = ${quoteId(join.rightId)}.${quoteId(p3.right)}`);
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
    for (const f4 of plan.filters || []) {
      if (!f4.col) continue;
      const fs = colMap.get(f4.col);
      const isNumericCalc = fs?.kind === "calc" && fs.mode === "math";
      const filterVals = Array.isArray(f4.vals) ? f4.vals : [""];
      const orParts = filterVals.map((v3) => renderWhereClause(ref(f4.col), f4.op, String(v3 ?? ""), params, { numericHint: isNumericCalc })).filter(Boolean);
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
    const sortParts = (plan.sorts || []).map((s3) => `${ref(s3.col)} ${s3.dir === "DESC" ? "DESC" : "ASC"}`);
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
        const r3 = ref(alias);
        selParts.push(`${r3} AS ${quoteId(alias)}`);
        groupRefs.push(r3);
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
    const sortParts = (plan.sorts || []).map((s3) => `${ref(s3.col)} ${s3.dir === "DESC" ? "DESC" : "ASC"}`);
    if (sortParts.length) sql += "\nORDER BY " + sortParts.join(", ");
    return { sql, params, cols: colAliases };
  }

  // js/query/sql-totals.ts
  function renderTotalsSql(plan, detailCols) {
    if (!plan.source.base) throw new Error("No base table in plan");
    const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
    const colTotals = plan.colTotals || {};
    const hasAny = detailCols.some((c3) => colTotals[c3] && colTotals[c3] !== "skip");
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
    const orderIdx = new Map(toShow.map((a3, i3) => [a3, i3]));
    const seenSub = /* @__PURE__ */ new Set();
    const subtotalBy = (plan.subtotalBy || []).filter((a3) => orderIdx.has(a3) && !seenSub.has(a3) && (seenSub.add(a3), true)).sort((a3, b2) => (orderIdx.get(a3) ?? Infinity) - (orderIdx.get(b2) ?? Infinity));
    const n2 = subtotalBy.length;
    const sortGroupKeys = subtotalBy.map((_3, i3) => `_sort_group_${i3}`);
    const detailSortType = subtotalOnTop ? 1 : 0;
    const subtotalSortType = subtotalOnTop ? 0 : 1;
    const subAggExpr = (a3) => {
      const fn = subtotalFns[a3];
      if (!fn || fn === "skip") return `NULL AS ${quoteId(a3)}`;
      return `${renderAggregateExpr(fn, ref(a3))} AS ${quoteId(a3)}`;
    };
    const subtotalBySet = new Set(subtotalBy);
    const fromPart = `FROM ${fromClause}`;
    const joinPart = joinClauses.length ? "\n" + joinClauses.join("\n") : "";
    const wherePart = whereParts.length ? "\nWHERE " + whereParts.join("\n  AND ") : "";
    const nullFilter = n2 ? subtotalBy.map((a3) => `${ref(a3)} IS NOT NULL`).join(" OR ") : "";
    const subWherePart = nullFilter ? whereParts.length ? `
WHERE ${whereParts.join("\n  AND ")}
  AND (${nullFilter})` : `
WHERE (${nullFilter})` : wherePart;
    const detailSel = [
      ...toShow.map((a3) => `${ref(a3)} AS ${quoteId(a3)}`),
      '0 AS "_row_type"',
      `${detailSortType} AS "_sort_row_type"`,
      ...subtotalBy.map((a3, i3) => `${ref(a3)} AS ${quoteId(sortGroupKeys[i3])}`)
    ].join(",\n       ");
    function makeSubSel(depth) {
      const groupCols = subtotalBy.slice(0, depth + 1);
      const groupSet = new Set(groupCols);
      return [
        ...toShow.map((a3) => {
          if (groupSet.has(a3)) return `${ref(a3)} AS ${quoteId(a3)}`;
          if (subtotalBySet.has(a3)) return `NULL AS ${quoteId(a3)}`;
          return subAggExpr(a3);
        }),
        '1 AS "_row_type"',
        `${subtotalSortType} AS "_sort_row_type"`,
        ...subtotalBy.map((a3, i3) => i3 <= depth ? `${ref(a3)} AS ${quoteId(sortGroupKeys[i3])}` : `NULL AS ${quoteId(sortGroupKeys[i3])}`)
      ].join(",\n       ");
    }
    const grandSel = [
      ...toShow.map((a3) => subtotalBySet.has(a3) ? `NULL AS ${quoteId(a3)}` : subAggExpr(a3)),
      '3 AS "_row_type"',
      '3 AS "_sort_row_type"',
      ...subtotalBy.map((_3, i3) => `NULL AS ${quoteId(sortGroupKeys[i3])}`)
    ].join(",\n       ");
    const spacerSel = [
      ...toShow.map((a3) => `NULL AS ${quoteId(a3)}`),
      '2 AS "_row_type"',
      '2 AS "_sort_row_type"',
      ...subtotalBy.map((a3, i3) => `${ref(a3)} AS ${quoteId(sortGroupKeys[i3])}`)
    ].join(",\n       ");
    const orderParts = [
      ...sortGroupKeys.map((k3, i3) => {
        if (isNested && i3 > 0 && subtotalOnTop) return `${quoteId(k3)} ASC NULLS FIRST`;
        return `${quoteId(k3)} ASC NULLS LAST`;
      }),
      '"_sort_row_type" ASC',
      ...(plan.sorts || []).filter((s3) => toShow.includes(s3.col) && !subtotalBySet.has(s3.col)).map((s3) => `${quoteId(s3.col)} ${s3.dir === "DESC" ? "DESC" : "ASC"}`)
    ];
    const branches = [`SELECT ${detailSel}
${fromPart}${joinPart}${wherePart}`];
    if (n2 > 0) {
      if (isNested && n2 > 1) {
        for (let d3 = 0; d3 < n2; d3++) {
          const groupClause = subtotalBy.slice(0, d3 + 1).map((a3) => ref(a3)).join(", ");
          branches.push(`SELECT ${makeSubSel(d3)}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
        }
      } else {
        const groupClause = subtotalBy.map((a3) => ref(a3)).join(", ");
        branches.push(`SELECT ${makeSubSel(n2 - 1)}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
      }
      if (includeSpacer) {
        const groupClause = subtotalBy.map((a3) => ref(a3)).join(", ");
        branches.push(`SELECT ${spacerSel}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
      }
    }
    if (includeGrand) {
      const hasGrandValue = toShow.some(
        (a3) => !subtotalBySet.has(a3) && subtotalFns[a3] && subtotalFns[a3] !== "skip"
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
    const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p3) => p3.left && p3.right) : [];
    if (!pairs.length) return null;
    try {
      const table = quoteId(lk.rightId);
      const tname = db.tables[lk.rightId].name;
      const rightCols = pairs.map((p3) => p3.right);
      const whereParts = rightCols.map((c3) => `${quoteId(c3)} IS NOT NULL AND TRIM(${quoteId(c3)}) != ''`);
      const excl = db.excludedRows?.[lk.rightId];
      if (excl && excl.size) {
        whereParts.push(`"_rowno" NOT IN (${[...excl].join(",")})`);
      }
      const whereNonNull = whereParts.join(" AND ");
      const concatExpr = rightCols.length === 1 ? quoteId(rightCols[0]) : rightCols.map((c3) => quoteId(c3)).join(` || CHAR(0) || `);
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
        const keyLabels = rightCols.map((c3) => colUserLabel(lk.rightId, c3) || c3);
        const keyDesc = keyLabels.length === 1 ? `"${keyLabels[0]}"` : keyLabels.map((c3) => `"${c3}"`).join(" + ");
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
  function checkCalcError(calc, i3) {
    const alias = (calc.alias || "").trim();
    if (!alias) return "Provide a label for this calculated column.";
    if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) {
      return "Pick a valid calculation type.";
    }
    const cols = new Set(projectedCols());
    const ctx = { calc, i: i3, cols, alias };
    const modeError = calcModeValidators[calc.mode](ctx);
    if (modeError) return modeError;
    const map = buildColSourceMap();
    const src = map.get(alias);
    if (src && src.kind !== "calc") return "Label conflicts with an existing column name.";
    const duplicates = (db.calcStages || []).filter((c3, idx) => idx !== i3 && (c3.alias || "").trim() === alias);
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
      const e3 = enabled !== false;
      items[itemId] = { enabled: e3, resolved, blocking: e3 && !resolved, issues: issues || [] };
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
    for (let i3 = 0; i3 < (db.stacks || []).length; i3++) {
      const id = db.stacks[i3];
      const ok = !!(id && db.tables && db.tables[id]);
      const issues = [];
      if (!ok) {
        issues.push(mkIssue(
          `stack_${i3}_missing`,
          "stack",
          "pipeline",
          `stack_${i3}`,
          `Stacked sheet "${id}" is not loaded`,
          { missingTableId: id, repairHint: "Load the file containing this sheet." }
        ));
      }
      mkItem(`stack_${i3}`, true, ok, issues);
    }
    for (let i3 = 0; i3 < (db.lookups || []).length; i3++) {
      const lk = db.lookups[i3];
      const enabled = lk.enabled !== false;
      const issues = [];
      let resolved = true;
      const rt = lk.rightId && db.tables[lk.rightId];
      if (!rt) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i3}_missing_table`,
          "lookup",
          `lookup_${i3}`,
          `lookup_${i3}`,
          `Lookup sheet "${lk.rightId || "(none)"}" is not loaded`,
          { missingTableId: lk.rightId || null, repairHint: "Load the file containing this sheet." }
        ));
      } else if (baseOk) {
        const leftCols = projectedColsUpToLookup(i3);
        const leftSet = new Set(leftCols);
        for (let pi = 0; pi < (lk.keyPairs || []).length; pi++) {
          const p3 = lk.keyPairs[pi];
          if (p3.left && !leftSet.has(p3.left)) {
            resolved = false;
            issues.push(mkIssue(
              `lookup_${i3}_kp${pi}_left`,
              "lookup",
              `lookup_${i3}`,
              `lookup_${i3}`,
              `Match column "${p3.left}" is not available`,
              { missingColumn: p3.left }
            ));
          }
          if (p3.right && !rt.cols.includes(p3.right)) {
            resolved = false;
            issues.push(mkIssue(
              `lookup_${i3}_kp${pi}_right`,
              "lookup",
              `lookup_${i3}`,
              `lookup_${i3}`,
              `Match column "${p3.right}" not found in "${rt.name}"`,
              { missingColumn: p3.right }
            ));
          }
        }
      }
      const hasCompleteKeyPair = (lk.keyPairs || []).some((p3) => p3 && p3.left && p3.right);
      if (rt && !hasCompleteKeyPair) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i3}_no_key_pairs`,
          "lookup",
          `lookup_${i3}`,
          `lookup_${i3}`,
          `Lookup "${rt.name}" has no complete match column pair`
        ));
      }
      const dupErr = checkLookupDuplicates(lk);
      if (dupErr) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i3}_dup_keys`,
          "duplicateKeys",
          "pipeline",
          `lookup_${i3}`,
          dupErr,
          { lookupIndex: i3 }
        ));
      }
      mkItem(`lookup_${i3}`, enabled, resolved, issues);
    }
    for (let i3 = 0; i3 < (db.calcStages || []).length; i3++) {
      const c3 = db.calcStages[i3];
      const enabled = c3.enabled !== false;
      const alias = (c3.alias || "").trim();
      let resolved = true;
      const issues = [];
      if (!alias) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i3}_no_alias`,
          "calculatedColumn",
          `calc_${i3}`,
          `calc_${i3}`,
          `Calculated column has no alias`
        ));
      } else if (!projected.has(alias)) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i3}_unresolved`,
          "calculatedColumn",
          `calc_${i3}`,
          `calc_${i3}`,
          `Calculated column "${alias}" \u2014 one or more source columns are not available`
        ));
      }
      const calcErr = checkCalcError(c3, i3);
      if (calcErr) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i3}_expr_error`,
          "calcError",
          "pipeline",
          `calc_${i3}`,
          calcErr,
          { calcIndex: i3 }
        ));
      }
      mkItem(`calc_${i3}`, enabled, resolved, issues);
    }
    for (let i3 = 0; i3 < (db.filters || []).length; i3++) {
      const f4 = db.filters[i3];
      const enabled = f4.enabled !== false;
      let resolved = true;
      const issues = [];
      if (f4.col && !projected.has(f4.col)) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i3}_missing_col`,
          "filter",
          "filterSort",
          `filter_${i3}`,
          `Filter column "${f4.col}" is not available`,
          { missingColumn: f4.col }
        ));
      }
      if (!Array.isArray(f4.vals)) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i3}_bad_vals`,
          "filter",
          "filterSort",
          `filter_${i3}`,
          `Filter "${f4.col || "(no column)"}" has malformed values`
        ));
      } else if (f4.vals.some((v3) => typeof v3 !== "string")) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i3}_bad_vals`,
          "filter",
          "filterSort",
          `filter_${i3}`,
          `Filter "${f4.col || "(no column)"}" has malformed values`
        ));
      }
      mkItem(`filter_${i3}`, enabled, resolved, issues);
    }
    for (let i3 = 0; i3 < (db.sorts || []).length; i3++) {
      const s3 = db.sorts[i3];
      const enabled = s3.enabled !== false;
      let resolved = true;
      const issues = [];
      if (s3.col && !projected.has(s3.col)) {
        resolved = false;
        issues.push(mkIssue(
          `sort_${i3}_missing_col`,
          "sort",
          "filterSort",
          `sort_${i3}`,
          `Sort column "${s3.col}" is not available`,
          { missingColumn: s3.col }
        ));
      }
      mkItem(`sort_${i3}`, enabled, resolved, issues);
    }
    if (db.aggMode === "group") {
      for (let i3 = 0; i3 < (db.groupBy || []).length; i3++) {
        const col = db.groupBy[i3];
        const resolved = projected.has(col);
        const issues = [];
        if (!resolved) {
          issues.push(mkIssue(
            `groupby_${i3}_missing_col`,
            "groupBy",
            "aggregation",
            `groupby_${i3}`,
            `Group-by column "${col}" is not available`,
            { missingColumn: col }
          ));
        }
        mkItem(`groupby_${i3}`, true, resolved, issues);
      }
      for (let i3 = 0; i3 < (db.aggregates || []).length; i3++) {
        const agg = db.aggregates[i3];
        const issues = [];
        let resolved = true;
        const needsCol = aggregateNeedsColumn(agg.fn);
        if (needsCol && agg.col && agg.col !== "*" && !projected.has(agg.col)) {
          resolved = false;
          issues.push(mkIssue(
            `agg_${i3}_missing_col`,
            "aggregate",
            "aggregation",
            `agg_${i3}`,
            `Aggregate column "${agg.col}" is not available`,
            { missingColumn: agg.col }
          ));
        }
        if (!isValidAggregateFn(agg.fn)) {
          resolved = false;
          issues.push(mkIssue(
            `agg_${i3}_invalid_fn`,
            "aggregate",
            "aggregation",
            `agg_${i3}`,
            `Unknown aggregate function "${agg.fn}"`
          ));
        }
        mkItem(`agg_${i3}`, true, resolved, issues);
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
      for (let i3 = 0; i3 < (db.subtotalBy || []).length; i3++) {
        const col = db.subtotalBy[i3];
        const resolved = projected.has(col);
        const issues = [];
        if (!resolved) {
          issues.push(mkIssue(
            `subtotalby_${i3}_missing_col`,
            "subtotalBy",
            "aggregation",
            `subtotalby_${i3}`,
            `Subtotal group column "${col}" is not available`,
            { missingColumn: col }
          ));
        }
        mkItem(`subtotalby_${i3}`, true, resolved, issues);
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
    const colOrderItems = (db.colOrder || []).filter((a3) => !projected.has(a3) && !outputAliases.has(a3));
    for (let i3 = 0; i3 < colOrderItems.length; i3++) {
      const col = colOrderItems[i3];
      const issues = [mkIssue(
        `colorder_${i3}_stale`,
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
    const reportBlocked = Object.values(items).some((i3) => i3.blocking);
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
        keyPairs: (lk.keyPairs || []).filter((p3) => p3.left && p3.right),
        required: !!lk.required,
        duplicatePolicy: lk.duplicatePolicy || { mode: "block" },
        excludedRows: (ctx.excludedRows || {})[lk.rightId] || null
      };
    }).filter((j4) => j4.keyPairs.length > 0);
    const calculatedColumns = [...colMap.values()].filter((e3) => e3.kind === "calc");
    const filters = (ctx.filters || []).filter((f4) => f4.enabled !== false && f4.col);
    const colOrder = ctx.colOrder;
    const aggMode = ctx.aggMode || "none";
    const aggregates = ctx.aggregates || [];
    const aggAliases = aggMode === "group" ? aggregates.map((a3) => a3.alias).filter((a3) => a3) : [];
    const orderedAliases = colOrder ? colOrder.filter((a3) => colMap.has(a3) || aggAliases.includes(a3)) : [...colMap.keys(), ...aggAliases];
    const rawSelCols = ctx.selCols;
    const selCols = rawSelCols instanceof Set ? rawSelCols : null;
    const selectedColumns = selCols ? orderedAliases.filter((a3) => selCols.has(a3)) : orderedAliases;
    const sorts = (ctx.sorts || []).filter((s3) => s3.enabled !== false && s3.col && colMap.has(s3.col));
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
    const paddedRows = newAggCols.length ? detailRows.map((r3) => {
      const row = Object.assign({}, r3);
      newAggCols.forEach((c3) => {
        row[c3] = null;
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
  function m(n2, l3) {
    for (var u4 in l3) n2[u4] = l3[u4];
    return n2;
  }
  function b(n2) {
    n2 && n2.parentNode && n2.parentNode.removeChild(n2);
  }
  function k(l3, u4, t3) {
    var i3, r3, o3, e3 = {};
    for (o3 in u4) "key" == o3 ? i3 = u4[o3] : "ref" == o3 ? r3 = u4[o3] : e3[o3] = u4[o3];
    if (arguments.length > 2 && (e3.children = arguments.length > 3 ? n.call(arguments, 2) : t3), "function" == typeof l3 && null != l3.defaultProps) for (o3 in l3.defaultProps) void 0 === e3[o3] && (e3[o3] = l3.defaultProps[o3]);
    return x(l3, e3, i3, r3, null);
  }
  function x(n2, t3, i3, r3, o3) {
    var e3 = { type: n2, props: t3, key: i3, ref: r3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o3 ? ++u : o3, __i: -1, __u: 0 };
    return null == o3 && null != l.vnode && l.vnode(e3), e3;
  }
  function S(n2) {
    return n2.children;
  }
  function C(n2, l3) {
    this.props = n2, this.context = l3;
  }
  function $(n2, l3) {
    if (null == l3) return n2.__ ? $(n2.__, n2.__i + 1) : null;
    for (var u4; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) return u4.__e;
    return "function" == typeof n2.type ? $(n2) : null;
  }
  function I(n2) {
    if (n2.__P && n2.__d) {
      var u4 = n2.__v, t3 = u4.__e, i3 = [], r3 = [], o3 = m({}, u4);
      o3.__v = u4.__v + 1, l.vnode && l.vnode(o3), q(n2.__P, o3, u4, n2.__n, n2.__P.namespaceURI, 32 & u4.__u ? [t3] : null, i3, null == t3 ? $(u4) : t3, !!(32 & u4.__u), r3), o3.__v = u4.__v, o3.__.__k[o3.__i] = o3, D(i3, o3, r3), u4.__e = u4.__ = null, o3.__e != t3 && P(o3);
    }
  }
  function P(n2) {
    if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l3) {
      if (null != l3 && null != l3.__e) return n2.__e = n2.__c.base = l3.__e;
    }), P(n2);
  }
  function A(n2) {
    (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
  }
  function H() {
    try {
      for (var n2, l3 = 1; i.length; ) i.length > l3 && i.sort(e), n2 = i.shift(), l3 = i.length, I(n2);
    } finally {
      i.length = H.__r = 0;
    }
  }
  function L(n2, l3, u4, t3, i3, r3, o3, e3, f4, c3, a3) {
    var s3, h4, p3, v3, y3, _3, g4, m3 = t3 && t3.__k || w, b2 = l3.length;
    for (f4 = T(u4, l3, m3, f4, b2), s3 = 0; s3 < b2; s3++) null != (p3 = u4.__k[s3]) && (h4 = -1 != p3.__i && m3[p3.__i] || d, p3.__i = s3, _3 = q(n2, p3, h4, i3, r3, o3, e3, f4, c3, a3), v3 = p3.__e, p3.ref && h4.ref != p3.ref && (h4.ref && J(h4.ref, null, p3), a3.push(p3.ref, p3.__c || v3, p3)), null == y3 && null != v3 && (y3 = v3), (g4 = !!(4 & p3.__u)) || h4.__k === p3.__k ? (f4 = j(p3, f4, n2, g4), g4 && h4.__e && (h4.__e = null)) : "function" == typeof p3.type && void 0 !== _3 ? f4 = _3 : v3 && (f4 = v3.nextSibling), p3.__u &= -7);
    return u4.__e = y3, f4;
  }
  function T(n2, l3, u4, t3, i3) {
    var r3, o3, e3, f4, c3, a3 = u4.length, s3 = a3, h4 = 0;
    for (n2.__k = new Array(i3), r3 = 0; r3 < i3; r3++) null != (o3 = l3[r3]) && "boolean" != typeof o3 && "function" != typeof o3 ? ("string" == typeof o3 || "number" == typeof o3 || "bigint" == typeof o3 || o3.constructor == String ? o3 = n2.__k[r3] = x(null, o3, null, null, null) : g(o3) ? o3 = n2.__k[r3] = x(S, { children: o3 }, null, null, null) : void 0 === o3.constructor && o3.__b > 0 ? o3 = n2.__k[r3] = x(o3.type, o3.props, o3.key, o3.ref ? o3.ref : null, o3.__v) : n2.__k[r3] = o3, f4 = r3 + h4, o3.__ = n2, o3.__b = n2.__b + 1, e3 = null, -1 != (c3 = o3.__i = O(o3, u4, f4, s3)) && (s3--, (e3 = u4[c3]) && (e3.__u |= 2)), null == e3 || null == e3.__v ? (-1 == c3 && (i3 > a3 ? h4-- : i3 < a3 && h4++), "function" != typeof o3.type && (o3.__u |= 4)) : c3 != f4 && (c3 == f4 - 1 ? h4-- : c3 == f4 + 1 ? h4++ : (c3 > f4 ? h4-- : h4++, o3.__u |= 4))) : n2.__k[r3] = null;
    if (s3) for (r3 = 0; r3 < a3; r3++) null != (e3 = u4[r3]) && 0 == (2 & e3.__u) && (e3.__e == t3 && (t3 = $(e3)), K(e3, e3));
    return t3;
  }
  function j(n2, l3, u4, t3) {
    var i3, r3;
    if ("function" == typeof n2.type) {
      for (i3 = n2.__k, r3 = 0; i3 && r3 < i3.length; r3++) i3[r3] && (i3[r3].__ = n2, l3 = j(i3[r3], l3, u4, t3));
      return l3;
    }
    n2.__e != l3 && (t3 && (l3 && n2.type && !l3.parentNode && (l3 = $(n2)), u4.insertBefore(n2.__e, l3 || null)), l3 = n2.__e);
    do {
      l3 = l3 && l3.nextSibling;
    } while (null != l3 && 8 == l3.nodeType);
    return l3;
  }
  function F(n2, l3) {
    return l3 = l3 || [], null == n2 || "boolean" == typeof n2 || (g(n2) ? n2.some(function(n3) {
      F(n3, l3);
    }) : l3.push(n2)), l3;
  }
  function O(n2, l3, u4, t3) {
    var i3, r3, o3, e3 = n2.key, f4 = n2.type, c3 = l3[u4], a3 = null != c3 && 0 == (2 & c3.__u);
    if (null === c3 && null == e3 || a3 && e3 == c3.key && f4 == c3.type) return u4;
    if (t3 > (a3 ? 1 : 0)) {
      for (i3 = u4 - 1, r3 = u4 + 1; i3 >= 0 || r3 < l3.length; ) if (null != (c3 = l3[o3 = i3 >= 0 ? i3-- : r3++]) && 0 == (2 & c3.__u) && e3 == c3.key && f4 == c3.type) return o3;
    }
    return -1;
  }
  function z(n2, l3, u4) {
    "-" == l3[0] ? n2.setProperty(l3, null == u4 ? "" : u4) : n2[l3] = null == u4 ? "" : "number" != typeof u4 || _.test(l3) ? u4 : u4 + "px";
  }
  function N(n2, l3, u4, t3, i3) {
    var r3, o3;
    n: if ("style" == l3) if ("string" == typeof u4) n2.style.cssText = u4;
    else {
      if ("string" == typeof t3 && (n2.style.cssText = t3 = ""), t3) for (l3 in t3) u4 && l3 in u4 || z(n2.style, l3, "");
      if (u4) for (l3 in u4) t3 && u4[l3] == t3[l3] || z(n2.style, l3, u4[l3]);
    }
    else if ("o" == l3[0] && "n" == l3[1]) r3 = l3 != (l3 = l3.replace(s, "$1")), o3 = l3.toLowerCase(), l3 = o3 in n2 || "onFocusOut" == l3 || "onFocusIn" == l3 ? o3.slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + r3] = u4, u4 ? t3 ? u4[a] = t3[a] : (u4[a] = h2, n2.addEventListener(l3, r3 ? v : p, r3)) : n2.removeEventListener(l3, r3 ? v : p, r3);
    else {
      if ("http://www.w3.org/2000/svg" == i3) l3 = l3.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if ("width" != l3 && "height" != l3 && "href" != l3 && "list" != l3 && "form" != l3 && "tabIndex" != l3 && "download" != l3 && "rowSpan" != l3 && "colSpan" != l3 && "role" != l3 && "popover" != l3 && l3 in n2) try {
        n2[l3] = null == u4 ? "" : u4;
        break n;
      } catch (n3) {
      }
      "function" == typeof u4 || (null == u4 || false === u4 && "-" != l3[4] ? n2.removeAttribute(l3) : n2.setAttribute(l3, "popover" == l3 && 1 == u4 ? "" : u4));
    }
  }
  function V(n2) {
    return function(u4) {
      if (this.l) {
        var t3 = this.l[u4.type + n2];
        if (null == u4[c]) u4[c] = h2++;
        else if (u4[c] < t3[a]) return;
        return t3(l.event ? l.event(u4) : u4);
      }
    };
  }
  function q(n2, u4, t3, i3, r3, o3, e3, f4, c3, a3) {
    var s3, h4, p3, v3, y3, d3, _3, k3, x3, M3, $3, I2, P4, A4, H3, T4 = u4.type;
    if (void 0 !== u4.constructor) return null;
    128 & t3.__u && (c3 = !!(32 & t3.__u), o3 = [f4 = u4.__e = t3.__e]), (s3 = l.__b) && s3(u4);
    n: if ("function" == typeof T4) try {
      if (k3 = u4.props, x3 = T4.prototype && T4.prototype.render, M3 = (s3 = T4.contextType) && i3[s3.__c], $3 = s3 ? M3 ? M3.props.value : s3.__ : i3, t3.__c ? _3 = (h4 = u4.__c = t3.__c).__ = h4.__E : (x3 ? u4.__c = h4 = new T4(k3, $3) : (u4.__c = h4 = new C(k3, $3), h4.constructor = T4, h4.render = Q), M3 && M3.sub(h4), h4.state || (h4.state = {}), h4.__n = i3, p3 = h4.__d = true, h4.__h = [], h4._sb = []), x3 && null == h4.__s && (h4.__s = h4.state), x3 && null != T4.getDerivedStateFromProps && (h4.__s == h4.state && (h4.__s = m({}, h4.__s)), m(h4.__s, T4.getDerivedStateFromProps(k3, h4.__s))), v3 = h4.props, y3 = h4.state, h4.__v = u4, p3) x3 && null == T4.getDerivedStateFromProps && null != h4.componentWillMount && h4.componentWillMount(), x3 && null != h4.componentDidMount && h4.__h.push(h4.componentDidMount);
      else {
        if (x3 && null == T4.getDerivedStateFromProps && k3 !== v3 && null != h4.componentWillReceiveProps && h4.componentWillReceiveProps(k3, $3), u4.__v == t3.__v || !h4.__e && null != h4.shouldComponentUpdate && false === h4.shouldComponentUpdate(k3, h4.__s, $3)) {
          u4.__v != t3.__v && (h4.props = k3, h4.state = h4.__s, h4.__d = false), u4.__e = t3.__e, u4.__k = t3.__k, u4.__k.some(function(n3) {
            n3 && (n3.__ = u4);
          }), w.push.apply(h4.__h, h4._sb), h4._sb = [], h4.__h.length && e3.push(h4);
          break n;
        }
        null != h4.componentWillUpdate && h4.componentWillUpdate(k3, h4.__s, $3), x3 && null != h4.componentDidUpdate && h4.__h.push(function() {
          h4.componentDidUpdate(v3, y3, d3);
        });
      }
      if (h4.context = $3, h4.props = k3, h4.__P = n2, h4.__e = false, I2 = l.__r, P4 = 0, x3) h4.state = h4.__s, h4.__d = false, I2 && I2(u4), s3 = h4.render(h4.props, h4.state, h4.context), w.push.apply(h4.__h, h4._sb), h4._sb = [];
      else do {
        h4.__d = false, I2 && I2(u4), s3 = h4.render(h4.props, h4.state, h4.context), h4.state = h4.__s;
      } while (h4.__d && ++P4 < 25);
      h4.state = h4.__s, null != h4.getChildContext && (i3 = m(m({}, i3), h4.getChildContext())), x3 && !p3 && null != h4.getSnapshotBeforeUpdate && (d3 = h4.getSnapshotBeforeUpdate(v3, y3)), A4 = null != s3 && s3.type === S && null == s3.key ? E(s3.props.children) : s3, f4 = L(n2, g(A4) ? A4 : [A4], u4, t3, i3, r3, o3, e3, f4, c3, a3), h4.base = u4.__e, u4.__u &= -161, h4.__h.length && e3.push(h4), _3 && (h4.__E = h4.__ = null);
    } catch (n3) {
      if (u4.__v = null, c3 || null != o3) if (n3.then) {
        for (u4.__u |= c3 ? 160 : 128; f4 && 8 == f4.nodeType && f4.nextSibling; ) f4 = f4.nextSibling;
        o3[o3.indexOf(f4)] = null, u4.__e = f4;
      } else {
        for (H3 = o3.length; H3--; ) b(o3[H3]);
        B(u4);
      }
      else u4.__e = t3.__e, u4.__k = t3.__k, n3.then || B(u4);
      l.__e(n3, u4, t3);
    }
    else null == o3 && u4.__v == t3.__v ? (u4.__k = t3.__k, u4.__e = t3.__e) : f4 = u4.__e = G(t3.__e, u4, t3, i3, r3, o3, e3, c3, a3);
    return (s3 = l.diffed) && s3(u4), 128 & u4.__u ? void 0 : f4;
  }
  function B(n2) {
    n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
  }
  function D(n2, u4, t3) {
    for (var i3 = 0; i3 < t3.length; i3++) J(t3[i3], t3[++i3], t3[++i3]);
    l.__c && l.__c(u4, n2), n2.some(function(u5) {
      try {
        n2 = u5.__h, u5.__h = [], n2.some(function(n3) {
          n3.call(u5);
        });
      } catch (n3) {
        l.__e(n3, u5.__v);
      }
    });
  }
  function E(n2) {
    return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : void 0 !== n2.constructor ? null : m({}, n2);
  }
  function G(u4, t3, i3, r3, o3, e3, f4, c3, a3) {
    var s3, h4, p3, v3, y3, w3, _3, m3 = i3.props || d, k3 = t3.props, x3 = t3.type;
    if ("svg" == x3 ? o3 = "http://www.w3.org/2000/svg" : "math" == x3 ? o3 = "http://www.w3.org/1998/Math/MathML" : o3 || (o3 = "http://www.w3.org/1999/xhtml"), null != e3) {
      for (s3 = 0; s3 < e3.length; s3++) if ((y3 = e3[s3]) && "setAttribute" in y3 == !!x3 && (x3 ? y3.localName == x3 : 3 == y3.nodeType)) {
        u4 = y3, e3[s3] = null;
        break;
      }
    }
    if (null == u4) {
      if (null == x3) return document.createTextNode(k3);
      u4 = document.createElementNS(o3, x3, k3.is && k3), c3 && (l.__m && l.__m(t3, e3), c3 = false), e3 = null;
    }
    if (null == x3) m3 === k3 || c3 && u4.data == k3 || (u4.data = k3);
    else {
      if (e3 = "textarea" == x3 && null != k3.defaultValue ? null : e3 && n.call(u4.childNodes), !c3 && null != e3) for (m3 = {}, s3 = 0; s3 < u4.attributes.length; s3++) m3[(y3 = u4.attributes[s3]).name] = y3.value;
      for (s3 in m3) y3 = m3[s3], "dangerouslySetInnerHTML" == s3 ? p3 = y3 : "children" == s3 || s3 in k3 || "value" == s3 && "defaultValue" in k3 || "checked" == s3 && "defaultChecked" in k3 || N(u4, s3, null, y3, o3);
      for (s3 in k3) y3 = k3[s3], "children" == s3 ? v3 = y3 : "dangerouslySetInnerHTML" == s3 ? h4 = y3 : "value" == s3 ? w3 = y3 : "checked" == s3 ? _3 = y3 : c3 && "function" != typeof y3 || m3[s3] === y3 || N(u4, s3, y3, m3[s3], o3);
      if (h4) c3 || p3 && (h4.__html == p3.__html || h4.__html == u4.innerHTML) || (u4.innerHTML = h4.__html), t3.__k = [];
      else if (p3 && (u4.innerHTML = ""), L("template" == t3.type ? u4.content : u4, g(v3) ? v3 : [v3], t3, i3, r3, "foreignObject" == x3 ? "http://www.w3.org/1999/xhtml" : o3, e3, f4, e3 ? e3[0] : i3.__k && $(i3, 0), c3, a3), null != e3) for (s3 = e3.length; s3--; ) b(e3[s3]);
      c3 && "textarea" != x3 || (s3 = "value", "progress" == x3 && null == w3 ? u4.removeAttribute("value") : null != w3 && (w3 !== u4[s3] || "progress" == x3 && !w3 || "option" == x3 && w3 != m3[s3]) && N(u4, s3, w3, m3[s3], o3), s3 = "checked", null != _3 && _3 != u4[s3] && N(u4, s3, _3, m3[s3], o3));
    }
    return u4;
  }
  function J(n2, u4, t3) {
    try {
      if ("function" == typeof n2) {
        var i3 = "function" == typeof n2.__u;
        i3 && n2.__u(), i3 && null == u4 || (n2.__u = n2(u4));
      } else n2.current = u4;
    } catch (n3) {
      l.__e(n3, t3);
    }
  }
  function K(n2, u4, t3) {
    var i3, r3;
    if (l.unmount && l.unmount(n2), (i3 = n2.ref) && (i3.current && i3.current != n2.__e || J(i3, null, u4)), null != (i3 = n2.__c)) {
      if (i3.componentWillUnmount) try {
        i3.componentWillUnmount();
      } catch (n3) {
        l.__e(n3, u4);
      }
      i3.base = i3.__P = null;
    }
    if (i3 = n2.__k) for (r3 = 0; r3 < i3.length; r3++) i3[r3] && K(i3[r3], u4, t3 || "function" != typeof n2.type);
    t3 || b(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
  }
  function Q(n2, l3, u4) {
    return this.constructor(n2, u4);
  }
  function R(u4, t3, i3) {
    var r3, o3, e3, f4;
    t3 == document && (t3 = document.documentElement), l.__ && l.__(u4, t3), o3 = (r3 = "function" == typeof i3) ? null : i3 && i3.__k || t3.__k, e3 = [], f4 = [], q(t3, u4 = (!r3 && i3 || t3).__k = k(S, null, [u4]), o3 || d, d, t3.namespaceURI, !r3 && i3 ? [i3] : o3 ? null : t3.firstChild ? n.call(t3.childNodes) : null, e3, !r3 && i3 ? i3 : o3 ? o3.__e : t3.firstChild, r3, f4), D(e3, u4, f4);
  }
  n = w.slice, l = { __e: function(n2, l3, u4, t3) {
    for (var i3, r3, o3; l3 = l3.__; ) if ((i3 = l3.__c) && !i3.__) try {
      if ((r3 = i3.constructor) && null != r3.getDerivedStateFromError && (i3.setState(r3.getDerivedStateFromError(n2)), o3 = i3.__d), null != i3.componentDidCatch && (i3.componentDidCatch(n2, t3 || {}), o3 = i3.__d), o3) return i3.__E = i3;
    } catch (l4) {
      n2 = l4;
    }
    throw n2;
  } }, u = 0, t = function(n2) {
    return null != n2 && void 0 === n2.constructor;
  }, C.prototype.setState = function(n2, l3) {
    var u4;
    u4 = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state), "function" == typeof n2 && (n2 = n2(m({}, u4), this.props)), n2 && m(u4, n2), null != n2 && this.__v && (l3 && this._sb.push(l3), A(this));
  }, C.prototype.forceUpdate = function(n2) {
    this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
  }, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l3) {
    return n2.__v.__b - l3.__v.__b;
  }, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, a = "__a" + f, s = /(PointerCapture)$|Capture$/i, h2 = 0, p = V(false), v = V(true), y = 0;

  // node_modules/preact/hooks/dist/hooks.module.js
  var t2;
  var r2;
  var u2;
  var i2;
  var o2 = 0;
  var f2 = [];
  var c2 = l;
  var e2 = c2.__b;
  var a2 = c2.__r;
  var v2 = c2.diffed;
  var l2 = c2.__c;
  var m2 = c2.unmount;
  var s2 = c2.__;
  function p2(n2, t3) {
    c2.__h && c2.__h(r2, n2, o2 || t3), o2 = 0;
    var u4 = r2.__H || (r2.__H = { __: [], __h: [] });
    return n2 >= u4.__.length && u4.__.push({}), u4.__[n2];
  }
  function d2(n2) {
    return o2 = 1, h3(D2, n2);
  }
  function h3(n2, u4, i3) {
    var o3 = p2(t2++, 2);
    if (o3.t = n2, !o3.__c && (o3.__ = [i3 ? i3(u4) : D2(void 0, u4), function(n3) {
      var t3 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t3, n3);
      t3 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
    }], o3.__c = r2, !r2.__f)) {
      var f4 = function(n3, t3, r3) {
        if (!o3.__c.__H) return true;
        var u5 = o3.__c.__H.__.filter(function(n4) {
          return n4.__c;
        });
        if (u5.every(function(n4) {
          return !n4.__N;
        })) return !c3 || c3.call(this, n3, t3, r3);
        var i4 = o3.__c.props !== n3;
        return u5.some(function(n4) {
          if (n4.__N) {
            var t4 = n4.__[0];
            n4.__ = n4.__N, n4.__N = void 0, t4 !== n4.__[0] && (i4 = true);
          }
        }), c3 && c3.call(this, n3, t3, r3) || i4;
      };
      r2.__f = true;
      var c3 = r2.shouldComponentUpdate, e3 = r2.componentWillUpdate;
      r2.componentWillUpdate = function(n3, t3, r3) {
        if (this.__e) {
          var u5 = c3;
          c3 = void 0, f4(n3, t3, r3), c3 = u5;
        }
        e3 && e3.call(this, n3, t3, r3);
      }, r2.shouldComponentUpdate = f4;
    }
    return o3.__N || o3.__;
  }
  function y2(n2, u4) {
    var i3 = p2(t2++, 3);
    !c2.__s && C2(i3.__H, u4) && (i3.__ = n2, i3.u = u4, r2.__H.__h.push(i3));
  }
  function A2(n2) {
    return o2 = 5, T2(function() {
      return { current: n2 };
    }, []);
  }
  function T2(n2, r3) {
    var u4 = p2(t2++, 7);
    return C2(u4.__H, r3) && (u4.__ = n2(), u4.__H = r3, u4.__h = n2), u4.__;
  }
  function q2(n2, t3) {
    return o2 = 8, T2(function() {
      return n2;
    }, t3);
  }
  function j2() {
    for (var n2; n2 = f2.shift(); ) {
      var t3 = n2.__H;
      if (n2.__P && t3) try {
        t3.__h.some(z2), t3.__h.some(B2), t3.__h = [];
      } catch (r3) {
        t3.__h = [], c2.__e(r3, n2.__v);
      }
    }
  }
  c2.__b = function(n2) {
    r2 = null, e2 && e2(n2);
  }, c2.__ = function(n2, t3) {
    n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), s2 && s2(n2, t3);
  }, c2.__r = function(n2) {
    a2 && a2(n2), t2 = 0;
    var i3 = (r2 = n2.__c).__H;
    i3 && (u2 === r2 ? (i3.__h = [], r2.__h = [], i3.__.some(function(n3) {
      n3.__N && (n3.__ = n3.__N), n3.u = n3.__N = void 0;
    })) : (i3.__h.some(z2), i3.__h.some(B2), i3.__h = [], t2 = 0)), u2 = r2;
  }, c2.diffed = function(n2) {
    v2 && v2(n2);
    var t3 = n2.__c;
    t3 && t3.__H && (t3.__H.__h.length && (1 !== f2.push(t3) && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t3.__H.__.some(function(n3) {
      n3.u && (n3.__H = n3.u), n3.u = void 0;
    })), u2 = r2 = null;
  }, c2.__c = function(n2, t3) {
    t3.some(function(n3) {
      try {
        n3.__h.some(z2), n3.__h = n3.__h.filter(function(n4) {
          return !n4.__ || B2(n4);
        });
      } catch (r3) {
        t3.some(function(n4) {
          n4.__h && (n4.__h = []);
        }), t3 = [], c2.__e(r3, n3.__v);
      }
    }), l2 && l2(n2, t3);
  }, c2.unmount = function(n2) {
    m2 && m2(n2);
    var t3, r3 = n2.__c;
    r3 && r3.__H && (r3.__H.__.some(function(n3) {
      try {
        z2(n3);
      } catch (n4) {
        t3 = n4;
      }
    }), r3.__H = void 0, t3 && c2.__e(t3, r3.__v));
  };
  var k2 = "function" == typeof requestAnimationFrame;
  function w2(n2) {
    var t3, r3 = function() {
      clearTimeout(u4), k2 && cancelAnimationFrame(t3), setTimeout(n2);
    }, u4 = setTimeout(r3, 35);
    k2 && (t3 = requestAnimationFrame(r3));
  }
  function z2(n2) {
    var t3 = r2, u4 = n2.__c;
    "function" == typeof u4 && (n2.__c = void 0, u4()), r2 = t3;
  }
  function B2(n2) {
    var t3 = r2;
    n2.__c = n2.__(), r2 = t3;
  }
  function C2(n2, t3) {
    return !n2 || n2.length !== t3.length || t3.some(function(t4, r3) {
      return t4 !== n2[r3];
    });
  }
  function D2(n2, t3) {
    return "function" == typeof t3 ? t3(n2) : t3;
  }

  // node_modules/preact/compat/dist/compat.module.js
  function g3(n2, t3) {
    for (var e3 in t3) n2[e3] = t3[e3];
    return n2;
  }
  function E2(n2, t3) {
    for (var e3 in n2) if ("__source" !== e3 && !(e3 in t3)) return true;
    for (var r3 in t3) if ("__source" !== r3 && n2[r3] !== t3[r3]) return true;
    return false;
  }
  function M2(n2, t3) {
    this.props = n2, this.context = t3;
  }
  (M2.prototype = new C()).isPureReactComponent = true, M2.prototype.shouldComponentUpdate = function(n2, t3) {
    return E2(this.props, n2) || E2(this.state, t3);
  };
  var T3 = l.__b;
  l.__b = function(n2) {
    n2.type && n2.type.__f && n2.ref && (n2.props.ref = n2.ref, n2.ref = null), T3 && T3(n2);
  };
  var A3 = "undefined" != typeof Symbol && Symbol.for && Symbol.for("react.forward_ref") || 3911;
  var O2 = l.__e;
  l.__e = function(n2, t3, e3, r3) {
    if (n2.then) {
      for (var u4, o3 = t3; o3 = o3.__; ) if ((u4 = o3.__c) && u4.__c) return null == t3.__e && (t3.__e = e3.__e, t3.__k = e3.__k), u4.__c(n2, t3);
    }
    O2(n2, t3, e3, r3);
  };
  var U2 = l.unmount;
  function V2(n2, t3, e3) {
    return n2 && (n2.__c && n2.__c.__H && (n2.__c.__H.__.forEach(function(n3) {
      "function" == typeof n3.__c && n3.__c();
    }), n2.__c.__H = null), null != (n2 = g3({}, n2)).__c && (n2.__c.__P === e3 && (n2.__c.__P = t3), n2.__c.__e = true, n2.__c = null), n2.__k = n2.__k && n2.__k.map(function(n3) {
      return V2(n3, t3, e3);
    })), n2;
  }
  function W2(n2, t3, e3) {
    return n2 && e3 && (n2.__v = null, n2.__k = n2.__k && n2.__k.map(function(n3) {
      return W2(n3, t3, e3);
    }), n2.__c && n2.__c.__P === t3 && (n2.__e && e3.appendChild(n2.__e), n2.__c.__e = true, n2.__c.__P = e3)), n2;
  }
  function P3() {
    this.__u = 0, this.o = null, this.__b = null;
  }
  function j3(n2) {
    var t3 = n2.__ && n2.__.__c;
    return t3 && t3.__a && t3.__a(n2);
  }
  function B3() {
    this.i = null, this.l = null;
  }
  l.unmount = function(n2) {
    var t3 = n2.__c;
    t3 && (t3.__z = true), t3 && t3.__R && t3.__R(), t3 && 32 & n2.__u && (n2.type = null), U2 && U2(n2);
  }, (P3.prototype = new C()).__c = function(n2, t3) {
    var e3 = t3.__c, r3 = this;
    null == r3.o && (r3.o = []), r3.o.push(e3);
    var u4 = j3(r3.__v), o3 = false, i3 = function() {
      o3 || r3.__z || (o3 = true, e3.__R = null, u4 ? u4(c3) : c3());
    };
    e3.__R = i3;
    var l3 = e3.__P;
    e3.__P = null;
    var c3 = function() {
      if (!--r3.__u) {
        if (r3.state.__a) {
          var n3 = r3.state.__a;
          r3.__v.__k[0] = W2(n3, n3.__c.__P, n3.__c.__O);
        }
        var t4;
        for (r3.setState({ __a: r3.__b = null }); t4 = r3.o.pop(); ) t4.__P = l3, t4.forceUpdate();
      }
    };
    r3.__u++ || 32 & t3.__u || r3.setState({ __a: r3.__b = r3.__v.__k[0] }), n2.then(i3, i3);
  }, P3.prototype.componentWillUnmount = function() {
    this.o = [];
  }, P3.prototype.render = function(n2, e3) {
    if (this.__b) {
      if (this.__v.__k) {
        var r3 = document.createElement("div"), o3 = this.__v.__k[0].__c;
        this.__v.__k[0] = V2(this.__b, r3, o3.__O = o3.__P);
      }
      this.__b = null;
    }
    var i3 = e3.__a && k(S, null, n2.fallback);
    return i3 && (i3.__u &= -33), [k(S, null, e3.__a ? null : n2.children), i3];
  };
  var H2 = function(n2, t3, e3) {
    if (++e3[1] === e3[0] && n2.l.delete(t3), n2.props.revealOrder && ("t" !== n2.props.revealOrder[0] || !n2.l.size)) for (e3 = n2.i; e3; ) {
      for (; e3.length > 3; ) e3.pop()();
      if (e3[1] < e3[0]) break;
      n2.i = e3 = e3[2];
    }
  };
  function Z(n2) {
    return this.getChildContext = function() {
      return n2.context;
    }, n2.children;
  }
  function Y(n2) {
    var e3 = this, r3 = n2.h;
    if (e3.componentWillUnmount = function() {
      R(null, e3.v), e3.v = null, e3.h = null;
    }, e3.h && e3.h !== r3 && e3.componentWillUnmount(), !e3.v) {
      for (var u4 = e3.__v; null !== u4 && !u4.__m && null !== u4.__; ) u4 = u4.__;
      e3.h = r3, e3.v = { nodeType: 1, parentNode: r3, childNodes: [], __k: { __m: u4.__m }, contains: function() {
        return true;
      }, namespaceURI: r3.namespaceURI, insertBefore: function(n3, t3) {
        this.childNodes.push(n3), e3.h.insertBefore(n3, t3);
      }, removeChild: function(n3) {
        this.childNodes.splice(this.childNodes.indexOf(n3) >>> 1, 1), e3.h.removeChild(n3);
      } };
    }
    R(k(Z, { context: e3.context }, n2.__v), e3.v);
  }
  function $2(n2, e3) {
    var r3 = k(Y, { __v: n2, h: e3 });
    return r3.containerInfo = e3, r3;
  }
  (B3.prototype = new C()).__a = function(n2) {
    var t3 = this, e3 = j3(t3.__v), r3 = t3.l.get(n2);
    return r3[0]++, function(u4) {
      var o3 = function() {
        t3.props.revealOrder ? (r3.push(u4), H2(t3, n2, r3)) : u4();
      };
      e3 ? e3(o3) : o3();
    };
  }, B3.prototype.render = function(n2) {
    this.i = null, this.l = /* @__PURE__ */ new Map();
    var t3 = F(n2.children);
    n2.revealOrder && "b" === n2.revealOrder[0] && t3.reverse();
    for (var e3 = t3.length; e3--; ) this.l.set(t3[e3], this.i = [1, 0, this.i]);
    return n2.children;
  }, B3.prototype.componentDidUpdate = B3.prototype.componentDidMount = function() {
    var n2 = this;
    this.l.forEach(function(t3, e3) {
      H2(n2, e3, t3);
    });
  };
  var q3 = "undefined" != typeof Symbol && Symbol.for && Symbol.for("react.element") || 60103;
  var G2 = /^(?:accent|alignment|arabic|baseline|cap|clip(?!PathU)|color|dominant|fill|flood|font|glyph(?!R)|horiz|image(!S)|letter|lighting|marker(?!H|W|U)|overline|paint|pointer|shape|stop|strikethrough|stroke|text(?!L)|transform|underline|unicode|units|v|vector|vert|word|writing|x(?!C))[A-Z]/;
  var J2 = /^on(Ani|Tra|Tou|BeforeInp|Compo)/;
  var K2 = /[A-Z0-9]/g;
  var Q2 = "undefined" != typeof document;
  var X2 = function(n2) {
    return ("undefined" != typeof Symbol && "symbol" == typeof Symbol() ? /fil|che|rad/ : /fil|che|ra/).test(n2);
  };
  function nn(n2, t3, e3) {
    return null == t3.__k && (t3.textContent = ""), R(n2, t3), "function" == typeof e3 && e3(), n2 ? n2.__c : null;
  }
  C.prototype.isReactComponent = true, ["componentWillMount", "componentWillReceiveProps", "componentWillUpdate"].forEach(function(t3) {
    Object.defineProperty(C.prototype, t3, { configurable: true, get: function() {
      return this["UNSAFE_" + t3];
    }, set: function(n2) {
      Object.defineProperty(this, t3, { configurable: true, writable: true, value: n2 });
    } });
  });
  var en = l.event;
  l.event = function(n2) {
    return en && (n2 = en(n2)), n2.persist = function() {
    }, n2.isPropagationStopped = function() {
      return this.cancelBubble;
    }, n2.isDefaultPrevented = function() {
      return this.defaultPrevented;
    }, n2.nativeEvent = n2;
  };
  var rn;
  var un = { configurable: true, get: function() {
    return this.class;
  } };
  var on = l.vnode;
  l.vnode = function(n2) {
    "string" == typeof n2.type && (function(n3) {
      var t3 = n3.props, e3 = n3.type, u4 = {}, o3 = -1 == e3.indexOf("-");
      for (var i3 in t3) {
        var l3 = t3[i3];
        if (!("value" === i3 && "defaultValue" in t3 && null == l3 || Q2 && "children" === i3 && "noscript" === e3 || "class" === i3 || "className" === i3)) {
          var c3 = i3.toLowerCase();
          "defaultValue" === i3 && "value" in t3 && null == t3.value ? i3 = "value" : "download" === i3 && true === l3 ? l3 = "" : "translate" === c3 && "no" === l3 ? l3 = false : "o" === c3[0] && "n" === c3[1] ? "ondoubleclick" === c3 ? i3 = "ondblclick" : "onchange" !== c3 || "input" !== e3 && "textarea" !== e3 || X2(t3.type) ? "onfocus" === c3 ? i3 = "onfocusin" : "onblur" === c3 ? i3 = "onfocusout" : J2.test(i3) && (i3 = c3) : c3 = i3 = "oninput" : o3 && G2.test(i3) ? i3 = i3.replace(K2, "-$&").toLowerCase() : null === l3 && (l3 = void 0), "oninput" === c3 && u4[i3 = c3] && (i3 = "oninputCapture"), u4[i3] = l3;
        }
      }
      "select" == e3 && (u4.multiple && Array.isArray(u4.value) && (u4.value = F(t3.children).forEach(function(n4) {
        n4.props.selected = -1 != u4.value.indexOf(n4.props.value);
      })), null != u4.defaultValue && (u4.value = F(t3.children).forEach(function(n4) {
        n4.props.selected = u4.multiple ? -1 != u4.defaultValue.indexOf(n4.props.value) : u4.defaultValue == n4.props.value;
      }))), t3.class && !t3.className ? (u4.class = t3.class, Object.defineProperty(u4, "className", un)) : t3.className && (u4.class = u4.className = t3.className), n3.props = u4;
    })(n2), n2.$$typeof = q3, on && on(n2);
  };
  var ln = l.__r;
  l.__r = function(n2) {
    ln && ln(n2), rn = n2.__c;
  };
  var cn = l.diffed;
  l.diffed = function(n2) {
    cn && cn(n2);
    var t3 = n2.props, e3 = n2.__e;
    null != e3 && "textarea" === n2.type && "value" in t3 && t3.value !== e3.value && (e3.value = null == t3.value ? "" : t3.value), rn = null;
  };

  // node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
  var f3 = 0;
  function u3(e3, t3, n2, o3, i3, u4) {
    t3 || (t3 = {});
    var a3, c3, p3 = t3;
    if ("ref" in p3) for (c3 in p3 = {}, t3) "ref" == c3 ? a3 = t3[c3] : p3[c3] = t3[c3];
    var l3 = { type: e3, props: p3, key: n2, ref: a3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f3, __i: -1, __u: 0, __source: i3, __self: u4 };
    if ("function" == typeof e3 && (a3 = e3.defaultProps)) for (c3 in a3) void 0 === p3[c3] && (p3[c3] = a3[c3]);
    return l.vnode && l.vnode(l3), l3;
  }

  // js/ui/components/modal.tsx
  function Modal({
    open,
    title = "",
    onClose,
    closeOnBackdrop = true,
    className = "",
    children,
    buttons = []
  }) {
    const contentRef = A2(null);
    y2(() => {
      if (!open) return;
      const handleEscape = (e3) => {
        if (e3.key === "Escape") onClose?.();
      };
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }, [open, onClose]);
    y2(() => {
      if (!open) return;
      const btn = contentRef.current?.querySelector("button");
      if (btn) btn.focus();
    }, [open]);
    if (!open) return null;
    return $2(
      /* @__PURE__ */ u3("div", { class: `modal ${className}`, role: "dialog", "aria-modal": "true", children: [
        closeOnBackdrop && /* @__PURE__ */ u3("div", { class: "modal-backdrop", onClick: onClose }),
        /* @__PURE__ */ u3("div", { class: "modal-content", ref: contentRef, children: [
          title && /* @__PURE__ */ u3("div", { class: "modal-title", children: title }),
          /* @__PURE__ */ u3("div", { class: "modal-body", children }),
          buttons.length > 0 && /* @__PURE__ */ u3("div", { class: "modal-buttons", children: buttons.map((btn, i3) => /* @__PURE__ */ u3(
            "button",
            {
              class: ["btn", btn.primary ? "btn-primary" : "btn-ghost", btn.className || ""].filter(Boolean).join(" "),
              onClick: btn.action,
              children: btn.label
            },
            i3
          )) })
        ] })
      ] }),
      document.body
    );
  }

  // js/ui/components/rename-modal.tsx
  function resolveRenameTarget(alias) {
    const colMap = buildColSourceMap();
    const src = colMap.get(alias);
    if (!src) return null;
    if (src.kind === "calc") return { alias, calcIdx: src.idx };
    return { alias, tid: src.tid, col: src.col };
  }
  function RenameModal({ target, onDone, onClose }) {
    const isCalc = target.calcIdx != null;
    const current = isCalc ? ((Array.isArray(db.calcStages) ? db.calcStages[target.calcIdx]?.alias : "") || "").trim() || target.alias : db.columnLabels?.[target.tid]?.[target.col] || "";
    const [value, setValue] = d2(current || target.alias);
    const inputRef = A2(null);
    y2(() => {
      const inp = inputRef.current;
      if (inp) {
        inp.focus();
        inp.select();
      }
    }, []);
    const handleRename = () => {
      const newName = value.trim();
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
      onClose();
      onDone?.();
    };
    const handleKey = (e3) => {
      if (e3.key === "Enter") {
        e3.preventDefault();
        handleRename();
      }
    };
    return /* @__PURE__ */ u3(
      Modal,
      {
        open: true,
        title: "Rename column",
        onClose,
        buttons: [
          { label: "Cancel", action: onClose },
          { label: "Rename", primary: true, action: handleRename }
        ],
        children: [
          /* @__PURE__ */ u3("label", { for: "rename-input", style: "font-size:0.78rem;color:var(--muted)", children: "Current name" }),
          /* @__PURE__ */ u3(
            "input",
            {
              ref: inputRef,
              id: "rename-input",
              type: "text",
              class: "rename-modal-input",
              value,
              onInput: (e3) => setValue(e3.target.value),
              onKeyDown: handleKey
            }
          )
        ]
      }
    );
  }

  // js/ui/components/context-menu.tsx
  function ContextMenu({ x: x3, y: y3, items, onClose }) {
    const menuRef = A2(null);
    y2(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = x3 - rect.width + "px";
      if (rect.bottom > window.innerHeight) menu.style.top = y3 - rect.height + "px";
      const close = (e3) => {
        if (!menu.contains(e3.target)) onClose();
      };
      setTimeout(() => {
        document.addEventListener("click", close, { once: true });
        document.addEventListener("contextmenu", close, { once: true });
      }, 0);
      return () => {
        document.removeEventListener("click", close);
        document.removeEventListener("contextmenu", close);
      };
    }, [x3, y3, onClose]);
    return $2(
      /* @__PURE__ */ u3("div", { class: "ctx-menu", ref: menuRef, style: { left: x3 + "px", top: y3 + "px" }, children: items.map((item, i3) => /* @__PURE__ */ u3(
        "button",
        {
          class: "ctx-menu-item",
          onClick: () => {
            onClose();
            item.action();
          },
          children: item.label
        },
        i3
      )) }),
      document.body
    );
  }

  // js/ui/components/chip.tsx
  function Chip({
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
    inlineStyle,
    onClick,
    onContextMenu,
    onDblClick,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop
  }) {
    const classes = [
      chipClass,
      selected ? "on" : "",
      colorClass,
      className
    ].filter(Boolean).join(" ");
    const extraAttrs = { ...dataAttrs };
    return /* @__PURE__ */ u3(
      "span",
      {
        class: classes,
        draggable,
        "data-col": col,
        "data-tip": tooltip || void 0,
        style: inlineStyle || void 0,
        ...extraAttrs,
        onClick,
        onContextMenu,
        onDblClick,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDrop,
        children: [
          label,
          badge && /* @__PURE__ */ u3(
            "span",
            {
              class: "chip-warn-badge",
              "data-autowarn": col,
              title: badgeTooltip,
              children: badge
            }
          )
        ]
      }
    );
  }

  // js/ui/components/tip.tsx
  function Tip({ text }) {
    return /* @__PURE__ */ u3("span", { class: "tip", "data-tip": text, children: "?" });
  }

  // js/query/layout-selection.ts
  var _seenCols = /* @__PURE__ */ new Set();
  var _previewOpen = /* @__PURE__ */ new Set();
  var _disabledCardCols = /* @__PURE__ */ new Set();
  function _sampleTipFor(tid, col, extra = []) {
    const tbl = db.tables?.[tid];
    const vals = (tbl?.samples?.[col] || []).slice(0, 3).map((v3) => String(v3));
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
    for (let i3 = 0; i3 < lookups.length; i3++) {
      if (i3 === excludeLookupIndex) continue;
      const lk = lookups[i3];
      if (!lk || lk.rightId !== tid) continue;
      if (Array.isArray(lk.cols) && lk.cols.includes(col)) return true;
    }
    return false;
  }
  function _hideLookupLayoutAliasesSafely(tid, col = null, excludeLookupIndex = -1) {
    const rt = tid ? db.tables?.[tid] : null;
    if (!rt || !Array.isArray(rt.cols)) return;
    const cols = col === null ? rt.cols : [col];
    for (const c3 of cols) {
      if (_lookupColumnUsedElsewhere(tid, c3, excludeLookupIndex)) continue;
      _hideLayoutAliasesForSource(tid, c3);
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
    const orderIdx = new Map(order.map((c3, i3) => [c3, i3]));
    const seen = /* @__PURE__ */ new Set();
    db.subtotalBy = db.subtotalBy.filter((c3) => orderIdx.has(c3) && !seen.has(c3) && (seen.add(c3), true)).sort((a3, b2) => (orderIdx.get(a3) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b2) ?? Number.MAX_SAFE_INTEGER));
  }
  function _afterCombineChange() {
    invalidateValidation();
    const nowCols = projectedCols();
    const selCols = db.selCols;
    if (selCols) {
      nowCols.forEach((c3) => {
        if (!_seenCols.has(c3)) {
          selCols.add(c3);
          _seenCols.add(c3);
        }
      });
      const nowSet = new Set(nowCols);
      for (const c3 of [...selCols]) {
        if (!nowSet.has(c3) && !_disabledCardCols.has(c3)) selCols.delete(c3);
      }
    }
    const colOrder = db.colOrder;
    if (!colOrder) {
      db.colOrder = [...nowCols];
    } else {
      const nowSet = new Set(nowCols);
      db.colOrder = [
        ...colOrder.filter((c3) => nowSet.has(c3)),
        ...nowCols.filter((c3) => !colOrder.includes(c3))
      ];
    }
    _syncSubtotalByToLayout();
    renderQueryBuilder();
  }

  // js/ui/components/calc-builder.ts
  function renderMathBuilder(ctx) {
    const { calc, i: i3, colOptsFor } = ctx;
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
      <select data-ci="${i3}" data-cp="mathOp" style="width:140px;flex-shrink:0">
        <option value="ARITH" ${!isRollingAvg && !isPctTotal ? "selected" : ""}>Arithmetic</option>
        <option value="ROLLAVG" ${isRollingAvg ? "selected" : ""}>Rolling Avg</option>
        <option value="PCTTOTAL" ${isPctTotal ? "selected" : ""}>% of Total</option>
      </select>
    </div>
    ${!isRollingAvg && !isPctTotal ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <select data-ci="${i3}" data-cp="leftCol" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
      <select data-ci="${i3}" data-cp="mathOperator" style="width:70px;flex-shrink:0">
        <option value="+" ${mathOp === "+" ? "selected" : ""}>+</option>
        <option value="-" ${mathOp === "-" ? "selected" : ""}>\u2212</option>
        <option value="*" ${mathOp === "*" ? "selected" : ""}>\xD7</option>
        <option value="/" ${mathOp === "/" ? "selected" : ""}>\xF7</option>
      </select>
      <select data-ci="${i3}" data-cp="rightCol" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(rightCol)}
      </select>
    </div>` : ""}
    ${isRollingAvg ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i3}" data-cp="leftCol" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
      <span class="pl-key-pair-label" style="margin-left:6px">Window</span>
      <input type="number" min="1" step="1" value="${windowVal}" data-ci="${i3}" data-cp="window" style="width:80px;flex-shrink:0">
    </div>` : ""}
    ${isPctTotal ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i3}" data-cp="leftCol" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
    </div>` : ""}`;
  }
  function renderTextBuilder(ctx) {
    const { calc, i: i3, colOptsFor } = ctx;
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
        <select data-ci="${i3}" data-cp="textSource" style="min-width:190px">
          <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
        </select>
        <span class="pl-key-pair-label" style="margin-left:6px">Count</span>
        <input type="number" min="1" step="1" value="${count}" data-ci="${i3}" data-cp="textCount" style="width:80px;flex-shrink:0">
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
        <select data-ci="${i3}" data-cp="textSource" style="min-width:190px">
          <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
        </select>
      </div>
      <div class="pl-key-pair" style="margin-top:4px">
        <span class="pl-key-pair-label">Start</span>
        <input type="number" min="1" step="1" value="${start}" data-ci="${i3}" data-cp="textStart" style="width:80px;flex-shrink:0">
        <span class="pl-key-pair-label" style="margin-left:6px">Length</span>
        <input type="number" min="1" step="1" value="${length}" data-ci="${i3}" data-cp="textLength" style="width:80px;flex-shrink:0">
      </div>`;
    }
    return "";
  }
  function renderCompareBuilder(ctx) {
    const { calc, i: i3, colOptsFor } = ctx;
    const compare = calc.compare;
    const glue = compare?.compareMode || "AND";
    const conditions = compare?.conditions || [];
    const trueVal = compare?.trueValue;
    const falseVal = compare?.falseValue;
    const COND_OPS = ["=", "!=", ">", ">=", "<", "<="];
    const condOptsFor = (selOp) => COND_OPS.map((o3) => `<option value="${h(o3)}" ${selOp === o3 ? "selected" : ""}>${h(o3)}</option>`).join("");
    const conditionsHtml = conditions.map((cond, j4) => `
    <div class="pl-key-pair" style="margin-top:${j4 === 0 ? "6px" : "4px"}">
      <span class="pl-key-pair-label">${j4 === 0 ? "Where" : glue}</span>
      <select data-ci="${i3}" data-cond="${j4}" data-cp="col" style="min-width:140px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(cond.col || "")}
      </select>
      <select data-ci="${i3}" data-cond="${j4}" data-cp="op" style="width:62px;flex-shrink:0">
        ${condOptsFor(cond.op || "=")}
      </select>
      <input type="text" data-ci="${i3}" data-cond="${j4}" data-cp="val" placeholder="value" value="${h(cond.val || "")}" style="min-width:100px">
    </div>`).join("");
    return `
    <div class="pl-key-pair" style="margin-top:8px">
      <span class="pl-key-pair-label">Match</span>
      <select data-ci="${i3}" data-cp="compareMode" style="width:80px;flex-shrink:0">
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
    const { calc, i: i3, colOptsFor } = ctx;
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
      <select data-ci="${i3}" data-cp="dateSource" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
      </select>
    </div>
    <div class="pl-key-pair" style="margin-top:4px">
      <span class="pl-key-pair-label">Extract</span>
      <select data-ci="${i3}" data-cp="datePart" style="width:140px;flex-shrink:0">
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
        <label class="tab-opt"><input type="radio" name="dateOutput_${i3}" value="number" ${output === "number" ? "checked" : ""} data-ci="${i3}" data-cp="dateOutput"><span>Number</span></label>
        <label class="tab-opt${textOnly ? " tab-opt--disabled" : ""}"><input type="radio" name="dateOutput_${i3}" value="short" ${output === "short" ? "checked" : ""}${shortDisabled} data-ci="${i3}" data-cp="dateOutput"><span>Short</span></label>
        <label class="tab-opt${textOnly ? " tab-opt--disabled" : ""}"><input type="radio" name="dateOutput_${i3}" value="text" ${output === "text" && !textOnly ? "checked" : ""}${fullDisabled} data-ci="${i3}" data-cp="dateOutput"><span>Full</span></label>
      </div>
    </div>`;
  }
  var calcModeRenderers = {
    math: renderMathBuilder,
    text: renderTextBuilder,
    compare: renderCompareBuilder,
    date: renderDateBuilder
  };

  // js/ui/views/pipeline-card.tsx
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
    rightId: (lk, inp, i3) => {
      const prevRightId = lk.rightId;
      lk.rightId = inp.value;
      lk.keyPairs = [{ left: "", right: "" }];
      const rt = lk.rightId && db.tables[lk.rightId];
      lk.cols = rt ? [...rt.cols] : [];
      if (prevRightId && prevRightId !== lk.rightId) _hideLookupLayoutAliasesSafely(prevRightId, null, i3);
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
      const pi = +(inp.dataset.lkp ?? "0");
      if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [{ left: "", right: "" }];
      if (!lk.keyPairs[pi]) lk.keyPairs[pi] = { left: "", right: "" };
      lk.keyPairs[pi].left = inp.value;
    },
    kpRight: (lk, inp) => {
      const pi = +(inp.dataset.lkp ?? "0");
      if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [{ left: "", right: "" }];
      if (!lk.keyPairs[pi]) lk.keyPairs[pi] = { left: "", right: "" };
      lk.keyPairs[pi].right = inp.value;
    }
  };
  var calcPropHandlers = {
    enabled: (c3, inp) => {
      const wasEnabled = c3.enabled !== false;
      const nowEnabled = inp.checked;
      c3.enabled = nowEnabled;
      const alias = (c3.alias || "").trim();
      if (!alias) return;
      if (wasEnabled && !nowEnabled) {
        if (db.selCols instanceof Set && _isAliasVisibleInLayout(alias, db.aggMode || "none")) {
          c3._prevSelState = true;
          _disabledCardCols.add(alias);
        } else {
          c3._prevSelState = false;
        }
      } else if (!wasEnabled && nowEnabled) {
        if (c3._prevSelState && db.selCols instanceof Set) {
          db.selCols.add(alias);
          _disabledCardCols.delete(alias);
        }
        delete c3._prevSelState;
      }
    },
    alias: (c3, inp) => {
      const oldAlias = (c3.alias || "").trim();
      c3.alias = inp.value;
      const newAlias = (c3.alias || "").trim();
      _renameProjectedAliasRefs(oldAlias, newAlias);
    },
    mode: (c3, inp) => {
      const newMode = inp.value;
      c3.mode = newMode;
      delete c3.math;
      delete c3.compare;
      delete c3.text;
      delete c3.date;
      const modeDefaults = {
        math: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] }),
        text: () => ({ operation: "combine", parts: [{ type: "column", value: "" }] }),
        compare: () => ({ compareMode: "AND", conditions: [{ col: "", op: "=", val: "" }], trueValue: { type: "number", value: "1" }, falseValue: { type: "number", value: "0" } }),
        date: () => ({ operation: "extract", source: { type: "column", value: "" }, part: "year", output: "number" })
      };
      c3[newMode] = modeDefaults[newMode]();
    },
    mathOp: (c3, inp) => {
      const mathOp = inp.value;
      c3.mathOp = mathOp;
      const mathOpDefaults = {
        ARITH: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] }),
        ROLLAVG: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }] }),
        PCTTOTAL: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }] })
      };
      c3.math = mathOpDefaults[mathOp]?.();
    },
    mathOperator: (c3, inp) => {
      const math = c3.math;
      if (math?.steps) {
        if (math.steps.length < 2) {
          math.steps.push({ type: "column", value: "", op: inp.value });
        } else {
          math.steps[1].op = inp.value;
        }
      }
    },
    leftCol: (c3, inp) => {
      const math = c3.math;
      if (math?.steps && math.steps.length > 0) {
        math.steps[0] = { type: "column", value: inp.value };
      }
    },
    rightCol: (c3, inp) => {
      const math = c3.math;
      if (math?.steps) {
        if (math.steps.length < 2) {
          math.steps.push({ type: "column", value: "", op: "+" });
        }
        math.steps[1] = { ...math.steps[1], type: "column", value: inp.value };
      }
    },
    window: (c3, inp) => {
      c3.window = String(Math.max(1, parseInt(inp.value, 10) || 7));
    },
    textSource: (c3, inp) => {
      const text = c3.text;
      if (text) {
        text.source = { type: "column", value: inp.value };
      }
    },
    textCount: (c3, inp) => {
      const text = c3.text;
      if (text) {
        text.count = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    textStart: (c3, inp) => {
      const text = c3.text;
      if (text) {
        text.start = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    textLength: (c3, inp) => {
      const text = c3.text;
      if (text) {
        text.length = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    compareMode: (c3, inp) => {
      const compare = c3.compare;
      if (compare) {
        compare.compareMode = inp.value;
      }
    },
    dateSource: (c3, inp) => {
      const date = c3.date;
      if (date) {
        date.source = { type: "column", value: inp.value };
      }
    },
    datePart: (c3, inp) => {
      const date = c3.date;
      if (date) {
        date.part = inp.value;
        if ((inp.value === "year" || inp.value === "week") && date.output !== "number") {
          date.output = "number";
        }
      }
    },
    dateOutput: (c3, inp) => {
      const date = c3.date;
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
  function StackSheets({ sortedIds, usedAsLookup, usedAsStack }) {
    if (!db.base || !db.tables[db.base]) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: [
        "\u2190",
        " Pick a sheet first"
      ] });
    }
    const stackAvail = sortedIds.filter((id) => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));
    return /* @__PURE__ */ u3("div", { class: "pl-stack-sheets", children: [
      (db.stacks || []).filter((id) => db.tables[id]).map((id) => /* @__PURE__ */ u3("span", { class: "pl-stack-chip", style: `border-left:3px solid ${getTableColor(id)}`, children: [
        db.tables[id].name,
        /* @__PURE__ */ u3("span", { class: "rm", onClick: () => removeStack(id), children: "\xD7" })
      ] })),
      stackAvail.length > 0 && /* @__PURE__ */ u3(
        "select",
        {
          style: "position:absolute;opacity:0;pointer-events:none;width:0;height:0",
          onChange: (e3) => {
            addStack(e3.target.value);
            e3.target.value = "";
          },
          children: [
            /* @__PURE__ */ u3("option", { value: "", children: [
              "pick a sheet",
              "\u2026"
            ] }),
            stackAvail.map((id) => /* @__PURE__ */ u3("option", { value: id, children: db.tables[id].name }))
          ]
        }
      ),
      stackAvail.length > 0 && /* @__PURE__ */ u3("div", { class: "pl-add-btn", onClick: (e3) => {
        const btn = e3.currentTarget;
        const sel = btn.nextElementSibling;
        if (!sel) return;
        sel.style.cssText = "position:absolute;opacity:1;pointer-events:auto;width:auto;height:auto";
        const r3 = btn.getBoundingClientRect();
        sel.style.top = r3.bottom + window.scrollY + 2 + "px";
        sel.style.left = r3.left + "px";
        document.body.appendChild(sel);
        sel.focus();
        sel.addEventListener("blur", () => {
          sel.style.cssText = "position:absolute;opacity:0;pointer-events:none;width:0;height:0";
          btn.parentElement?.appendChild(sel);
        }, { once: true });
      }, children: [
        "\uFF0B",
        " Include"
      ] })
    ] });
  }
  function BaseStage({ sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode }) {
    const allCols = db.base && db.tables[db.base] ? db.tables[db.base].cols : [];
    const [ctxMenu, setCtxMenu] = d2(null);
    const [renameTarget, setRenameTarget] = d2(null);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: "pl-top-pair", children: [
        /* @__PURE__ */ u3("div", { class: "pl-stage", children: [
          /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: "Start from" }),
          /* @__PURE__ */ u3("div", { class: "pl-base-row", children: /* @__PURE__ */ u3("select", { value: db.base || "", onChange: (e3) => onBaseChange(e3.target.value), children: [
            /* @__PURE__ */ u3("option", { value: "", children: [
              "\u2014",
              " select a sheet ",
              "\u2014"
            ] }),
            sortedIds.map((id) => /* @__PURE__ */ u3("option", { value: id, children: db.tables[id].name }))
          ] }) }),
          db.base && db.tables[db.base] && /* @__PURE__ */ u3("div", { class: "pl-lookup-cols", style: "margin-top:6px", children: [
            /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center", children: "Columns:" }),
            /* @__PURE__ */ u3(Tip, { text: "Right-click any chip to rename it." }),
            allCols.map((c3) => {
              const isLayoutVisible = _isSourceVisibleInLayout(db.base, c3, layoutColMap, layoutMode);
              const color = getTableColor(db.base);
              const chipStyle = `background:${color};border-color:${color};color:${chipFgColor(color)}`;
              return /* @__PURE__ */ u3(
                Chip,
                {
                  col: c3,
                  label: colUserLabel(db.base, c3),
                  selected: true,
                  draggable: false,
                  chipClass: "pl-col-chip",
                  className: isLayoutVisible ? "" : "pl-col-chip-layout-hidden",
                  tooltip: _sampleTipFor(db.base, c3, ["Click to show/hide this column in the report layout."]),
                  dataAttrs: { "data-bcc": c3 },
                  inlineStyle: chipStyle,
                  onClick: () => {
                    const colMap = buildColSourceMap();
                    const visible = _isSourceVisibleInLayout(db.base, c3, colMap, db.aggMode || "none");
                    if (visible) _hideLayoutAliasesForSource(db.base, c3);
                    else _showLayoutAliasesForSource(db.base, c3);
                    _afterCombineChange();
                  },
                  onContextMenu: (e3) => {
                    e3.preventDefault();
                    const colMap = buildColSourceMap();
                    let alias = "";
                    for (const [a3, src] of colMap.entries()) {
                      if (src && src.kind !== "calc" && src.tid === db.base && src.col === c3) {
                        alias = a3;
                        break;
                      }
                    }
                    if (!alias) return;
                    setCtxMenu({
                      x: e3.clientX,
                      y: e3.clientY,
                      items: [{ label: "Rename", action: () => setRenameTarget(resolveRenameTarget(alias)) }]
                    });
                  }
                }
              );
            }),
            /* @__PURE__ */ u3(
              "button",
              {
                class: "btn btn-ghost",
                style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0",
                onClick: () => {
                  _showLayoutAliasesForSource(db.base);
                  _afterCombineChange();
                },
                children: "All"
              }
            ),
            /* @__PURE__ */ u3(
              "button",
              {
                class: "btn btn-ghost",
                style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0",
                onClick: () => {
                  _hideLayoutAliasesForSource(db.base);
                  _afterCombineChange();
                },
                children: "None"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-h-arrow", children: [
          /* @__PURE__ */ u3("div", { class: "pl-h-line" }),
          /* @__PURE__ */ u3("div", { class: "pl-h-head" })
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-stage", children: [
          /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: [
            "Include rows from ",
            /* @__PURE__ */ u3(Tip, { text: "Add sheets with the same columns to get more rows. Like stacking spreadsheets on top of each other." })
          ] }),
          /* @__PURE__ */ u3(StackSheets, { sortedIds, usedAsLookup, usedAsStack })
        ] })
      ] }),
      ctxMenu && /* @__PURE__ */ u3(ContextMenu, { x: ctxMenu.x, y: ctxMenu.y, items: ctxMenu.items, onClose: () => setCtxMenu(null) }),
      renameTarget && /* @__PURE__ */ u3(RenameModal, { target: renameTarget, onDone: () => _afterCombineChange(), onClose: () => setRenameTarget(null) })
    ] });
  }
  function PipelineArrow({ id }) {
    const isOpen = _previewOpen.has(id);
    return /* @__PURE__ */ u3("div", { class: "pl-arrow", children: [
      /* @__PURE__ */ u3("div", { class: "pl-arrow-line" }),
      /* @__PURE__ */ u3("div", { class: "pl-arrow-meta", children: /* @__PURE__ */ u3("button", { class: "pl-preview-btn", onClick: () => togglePreview(id), children: isOpen ? "\u25B2 Hide preview" : "\u25BC Preview" }) }),
      /* @__PURE__ */ u3("div", { class: "pl-arrow-line" }),
      /* @__PURE__ */ u3("div", { class: "pl-arrow-head" }),
      isOpen && /* @__PURE__ */ u3("div", { class: "pl-mini-preview", dangerouslySetInnerHTML: { __html: _buildPreviewHTML(id) } })
    ] });
  }
  function LookupStage({ lk, i: i3, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode }) {
    const rt = lk.rightId && db.tables[lk.rightId];
    const leftCols = projectedColsUpToLookup(i3);
    const rightCols = rt ? rt.cols : [];
    if (!Array.isArray(lk.keyPairs) || !lk.keyPairs.length) lk.keyPairs = [{ left: "", right: "" }];
    const pairs = lk.keyPairs;
    const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : "";
    const lkColMap = buildColSourceMap();
    const [ctxMenu, setCtxMenu] = d2(null);
    const [renameTarget, setRenameTarget] = d2(null);
    const lkEnabled = lk.enabled !== false;
    const lkV = getValidation().items[`lookup_${i3}`];
    const lkVBlocked = lkV && lkV.blocking;
    const lkVUnresolved = lkV && !lkV.resolved;
    const lkVMsg = lkVUnresolved && lkV.issues[0] ? lkV.issues[0].message : null;
    const stageClasses = [
      "pl-lookup-stage",
      lkVBlocked ? "pl-lookup-stage--invalid" : "",
      lkVUnresolved && !lkEnabled ? "pl-lookup-stage--disabled-issue" : "",
      !lkEnabled ? "pl-stage-disabled" : ""
    ].filter(Boolean).join(" ");
    const handleLookupChange = (prop, e3) => {
      const inp = e3.target;
      const handler = lookupPropHandlers[prop];
      if (handler) {
        handler(lk, inp, i3);
        _afterCombineChange();
      }
    };
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: stageClasses, children: [
        /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: [
          "Look up columns from ",
          /* @__PURE__ */ u3(Tip, { text: "Pull columns from another sheet by matching a shared value \u2014 like VLOOKUP. Use '+ AND' to match on multiple columns at once." }),
          /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", title: lkEnabled ? "Disable this lookup (won't block report)" : "Enable this lookup", children: [
            /* @__PURE__ */ u3("input", { type: "checkbox", checked: lkEnabled, onChange: (e3) => handleLookupChange("enabled", e3) }),
            /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: lkEnabled ? "Enabled" : "Disabled" })
          ] })
        ] }),
        lkVMsg && /* @__PURE__ */ u3("div", { class: "pl-lookup-error", children: [
          lkVBlocked ? "\u26D4" : "\u26A0",
          " ",
          lkVMsg
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-lookup-header", children: [
          /* @__PURE__ */ u3("select", { value: lk.rightId || "", onChange: (e3) => handleLookupChange("rightId", e3), children: [
            /* @__PURE__ */ u3("option", { value: "", children: [
              "\u2014",
              " pick a sheet ",
              "\u2014"
            ] }),
            sortedIds.filter((id) => id !== db.base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id)).map((id) => /* @__PURE__ */ u3("option", { value: id, children: db.tables[id].name }))
          ] }),
          /* @__PURE__ */ u3("button", { class: "btn btn-danger", style: "flex-shrink:0", onClick: () => removeLookup(i3), children: "\u2715" })
        ] }),
        rt && /* @__PURE__ */ u3("div", { class: "pl-lookup-keys", children: [
          pairs.map((pair, pi) => /* @__PURE__ */ u3("div", { class: "pl-key-pair", children: [
            /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: pi === 0 ? "Where" : "AND" }),
            /* @__PURE__ */ u3("select", { value: pair.left || "", "data-lkp": String(pi), onChange: (e3) => handleLookupChange("kpLeft", e3), children: [
              /* @__PURE__ */ u3("option", { value: "", children: [
                "\u2014",
                " column ",
                "\u2014"
              ] }),
              leftCols.map((c3) => /* @__PURE__ */ u3("option", { value: c3, children: colDisplayLabel(c3, lkColMap) }))
            ] }),
            /* @__PURE__ */ u3("span", { class: "pl-lookup-eq", children: "=" }),
            /* @__PURE__ */ u3("select", { value: pair.right || "", "data-lkp": String(pi), onChange: (e3) => handleLookupChange("kpRight", e3), children: [
              /* @__PURE__ */ u3("option", { value: "", children: [
                "\u2014",
                " column ",
                "\u2014"
              ] }),
              rightCols.map((c3) => /* @__PURE__ */ u3("option", { value: c3, children: `${db.tables[lk.rightId]?.name || lk.rightId} \u2192 ${colUserLabel(lk.rightId, c3)}` }))
            ] }),
            pairs.length > 1 && /* @__PURE__ */ u3("button", { class: "pl-rm-kp", title: "Remove this condition", onClick: () => {
              lk.keyPairs.splice(pi, 1);
              _afterCombineChange();
            }, children: "\u2715" })
          ] })),
          /* @__PURE__ */ u3("button", { class: "btn btn-ghost pl-add-kp", onClick: () => {
            if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [];
            lk.keyPairs.push({ left: "", right: "" });
            _afterCombineChange();
          }, children: [
            "\uFF0B",
            " AND ",
            "\u2026"
          ] })
        ] }),
        rt && /* @__PURE__ */ u3("div", { class: "pl-lookup-required", children: [
          /* @__PURE__ */ u3("span", { style: "flex-shrink:0", children: "If no match:" }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `lkreq_${i3}`, value: "0", checked: !lk.required, onChange: (e3) => handleLookupChange("required", e3) }),
            " Leave blank"
          ] }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `lkreq_${i3}`, value: "1", checked: lk.required, onChange: (e3) => handleLookupChange("required", e3) }),
            " Skip row"
          ] }),
          /* @__PURE__ */ u3(Tip, { text: "Leave blank: keep all rows even if no match.\\nSkip row: only keep rows that match." })
        ] }),
        rt && /* @__PURE__ */ u3("div", { class: "pl-lookup-required", children: [
          /* @__PURE__ */ u3("span", { style: "flex-shrink:0", children: "Duplicate keys:" }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `lkdup_${i3}`, value: "block", checked: (lk.duplicatePolicy && lk.duplicatePolicy.mode) !== "combine", onChange: (e3) => handleLookupChange("dupMode", e3) }),
            " Block (error)"
          ] }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `lkdup_${i3}`, value: "combine", checked: (lk.duplicatePolicy && lk.duplicatePolicy.mode) === "combine", onChange: (e3) => handleLookupChange("dupMode", e3) }),
            " Combine values"
          ] }),
          /* @__PURE__ */ u3(Tip, { text: "Block: the report cannot run if the same key appears more than once in the lookup sheet.\nCombine: concatenate matching values into a single cell, e.g. 'Tag1; Tag2'." })
        ] }),
        rt && /* @__PURE__ */ u3("div", { class: "pl-lookup-cols", children: [
          /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center", children: "Bring in:" }),
          /* @__PURE__ */ u3(Tip, { text: "Right-click any chip to rename it." }),
          rt.cols.map((c3) => {
            const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c3, layoutColMap, layoutMode);
            return /* @__PURE__ */ u3(
              Chip,
              {
                col: c3,
                label: colUserLabel(lk.rightId, c3),
                selected: true,
                draggable: false,
                chipClass: "pl-col-chip",
                colorClass: lkColorCls,
                className: isLayoutVisible ? "" : "pl-col-chip-layout-hidden",
                tooltip: _sampleTipFor(lk.rightId, c3, ["Click to show/hide this lookup column in the report layout."]),
                dataAttrs: { "data-li": String(i3), "data-lcc": c3 },
                onClick: () => {
                  const colMap = buildColSourceMap();
                  const visible = _isSourceVisibleInLayout(lk.rightId, c3, colMap, db.aggMode || "none");
                  if (visible) _hideLookupLayoutAliasesSafely(lk.rightId, c3, i3);
                  else _showLayoutAliasesForSource(lk.rightId, c3);
                  _afterCombineChange();
                },
                onContextMenu: (e3) => {
                  e3.preventDefault();
                  if (!lk.rightId) return;
                  const colMap = buildColSourceMap();
                  let alias = "";
                  for (const [a3, src] of colMap.entries()) {
                    if (src && src.kind !== "calc" && src.tid === lk.rightId && src.col === c3) {
                      alias = a3;
                      break;
                    }
                  }
                  if (!alias) return;
                  setCtxMenu({
                    x: e3.clientX,
                    y: e3.clientY,
                    items: [{ label: "Rename", action: () => setRenameTarget(resolveRenameTarget(alias)) }]
                  });
                }
              }
            );
          }),
          /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-ghost",
              style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0",
              onClick: () => selectAllLookupCols(i3),
              children: "All"
            }
          ),
          /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-ghost",
              style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0",
              onClick: () => selectNoneLookupCols(i3),
              children: "None"
            }
          )
        ] })
      ] }),
      ctxMenu && /* @__PURE__ */ u3(ContextMenu, { x: ctxMenu.x, y: ctxMenu.y, items: ctxMenu.items, onClose: () => setCtxMenu(null) }),
      renameTarget && /* @__PURE__ */ u3(RenameModal, { target: renameTarget, onDone: () => _afterCombineChange(), onClose: () => setRenameTarget(null) })
    ] });
  }
  function CalcStageComponent({ calc, i: i3 }) {
    const cols = projectedCols();
    const colMap = buildColSourceMap();
    const alias = (calc.alias || "").trim();
    const mode = calc.mode || "math";
    const [ctxMenu, setCtxMenu] = d2(null);
    const [renameTarget, setRenameTarget] = d2(null);
    const calcEnabled = calc.enabled !== false;
    const calcV = getValidation().items[`calc_${i3}`];
    const calcVBlocked = calcV && calcV.blocking;
    const calcVUnresolved = calcV && !calcV.resolved;
    const calcVMsg = calcVUnresolved && calcV.issues[0] ? calcV.issues[0].message : null;
    const stageClasses = [
      "pl-lookup-stage",
      calcVBlocked ? "pl-lookup-stage--invalid" : "",
      calcVUnresolved && !calcEnabled ? "pl-lookup-stage--disabled-issue" : "",
      !calcEnabled ? "pl-stage-disabled" : ""
    ].filter(Boolean).join(" ");
    const handleCalcChange = (prop, e3) => {
      const inp = e3.target;
      const handler = calcPropHandlers[prop];
      if (handler) {
        handler(calc, inp, i3);
        _afterCombineChange();
      }
    };
    const handleCondChange = (j4, prop, e3) => {
      const inp = e3.target;
      const compare = calc.compare;
      if (!compare?.conditions?.[j4]) return;
      const handler = condPropHandlers[prop];
      if (handler) {
        handler(compare.conditions[j4], inp);
        _afterCombineChange();
      }
    };
    const colOptsFor = (sel) => cols.filter((c3) => c3 !== alias).map((c3) => `<option value="${c3.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}" ${sel === c3 ? "selected" : ""}>${colDisplayLabel(c3, colMap).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</option>`).join("");
    const builderCtx = { calc, i: i3, cols, colOptsFor };
    const builderHtml = calcModeRenderers[mode](builderCtx);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: stageClasses, children: [
        /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: [
          "Calculated column ",
          /* @__PURE__ */ u3(Tip, { text: "Create a virtual column from existing columns.\nMath: arithmetic, rolling averages, percentages.\nText: string operations.\nCompare: conditional logic.\nDate: extract date parts." }),
          /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", title: calcEnabled ? "Disable this calculated column" : "Enable this calculated column", children: [
            /* @__PURE__ */ u3("input", { type: "checkbox", checked: calcEnabled, onChange: (e3) => handleCalcChange("enabled", e3) }),
            /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: calcEnabled ? "Enabled" : "Disabled" })
          ] })
        ] }),
        calcVMsg && /* @__PURE__ */ u3("div", { class: "pl-lookup-error", children: [
          calcVBlocked ? "\u26D4" : "\u26A0",
          " ",
          calcVMsg
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-lookup-header", style: "gap:8px;flex-wrap:wrap", children: [
          /* @__PURE__ */ u3(
            "input",
            {
              type: "text",
              placeholder: "Output column name",
              value: calc.alias || "",
              style: "flex:1;min-width:180px",
              onChange: (e3) => handleCalcChange("alias", e3)
            }
          ),
          /* @__PURE__ */ u3("button", { class: "btn btn-danger", style: "flex-shrink:0", onClick: () => removeCalcStage(i3), children: "\u2715" })
        ] }),
        /* @__PURE__ */ u3("div", { class: "tab-row", style: "margin-top:8px", children: [
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `calcMode_${i3}`, value: "math", checked: mode === "math", onChange: (e3) => handleCalcChange("mode", e3) }),
            /* @__PURE__ */ u3("span", { children: "Math" })
          ] }),
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `calcMode_${i3}`, value: "text", checked: mode === "text", onChange: (e3) => handleCalcChange("mode", e3) }),
            /* @__PURE__ */ u3("span", { children: "Text" })
          ] }),
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `calcMode_${i3}`, value: "compare", checked: mode === "compare", onChange: (e3) => handleCalcChange("mode", e3) }),
            /* @__PURE__ */ u3("span", { children: "Compare" })
          ] }),
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `calcMode_${i3}`, value: "date", checked: mode === "date", onChange: (e3) => handleCalcChange("mode", e3) }),
            /* @__PURE__ */ u3("span", { children: "Date" })
          ] })
        ] }),
        /* @__PURE__ */ u3("div", { onChange: (e3) => {
          const t3 = e3.target;
          const ci = t3.dataset.ci;
          const cp = t3.dataset.cp;
          const condIdx = t3.dataset.cond;
          if (!ci || !cp) return;
          if (condIdx !== void 0) {
            handleCondChange(+condIdx, cp, e3);
          } else {
            handleCalcChange(cp, e3);
          }
        }, dangerouslySetInnerHTML: { __html: builderHtml } }),
        alias && /* @__PURE__ */ u3("div", { class: "pl-lookup-cols", style: "margin-top:8px", children: [
          /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center", children: "Output:" }),
          /* @__PURE__ */ u3(Tip, { text: "Right-click the chip to rename this column. The alias input above will update." }),
          /* @__PURE__ */ u3(
            Chip,
            {
              col: alias,
              label: colDisplayLabel(alias, colMap),
              selected: _isAliasVisibleInLayout(alias, db.aggMode || "none"),
              draggable: false,
              chipClass: "pl-col-chip",
              dataAttrs: { "data-ci": String(i3), "data-ccc": alias },
              onClick: () => {
                if (!db.selCols) db.selCols = new Set(projectedCols());
                const s3 = db.selCols;
                if (s3.has(alias)) s3.delete(alias);
                else s3.add(alias);
                _afterCombineChange();
              },
              onContextMenu: (e3) => {
                e3.preventDefault();
                setCtxMenu({
                  x: e3.clientX,
                  y: e3.clientY,
                  items: [{
                    label: "Rename",
                    action: () => {
                      const target = resolveRenameTarget(alias);
                      if (!target) return;
                      setRenameTarget(target);
                    }
                  }]
                });
              }
            }
          )
        ] })
      ] }),
      ctxMenu && /* @__PURE__ */ u3(ContextMenu, { x: ctxMenu.x, y: ctxMenu.y, items: ctxMenu.items, onClose: () => setCtxMenu(null) }),
      renameTarget && /* @__PURE__ */ u3(RenameModal, { target: renameTarget, onDone: () => _afterCombineChange(), onClose: () => setRenameTarget(null) })
    ] });
  }
  function Pipeline() {
    const ids = Object.keys(db.tables);
    const sortedIds = ids.sort((a3, b2) => db.tables[a3].name.localeCompare(db.tables[b2].name));
    const usedAsLookup = new Set((db.lookups || []).map((l3) => l3.rightId).filter(Boolean));
    const usedAsStack = new Set(db.stacks || []);
    const layoutColMap = db.base && db.tables[db.base] ? buildColSourceMap() : /* @__PURE__ */ new Map();
    const layoutMode = db.aggMode || "none";
    return /* @__PURE__ */ u3("div", { id: "pipeline", class: "pipeline", children: [
      /* @__PURE__ */ u3(BaseStage, { sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode }),
      db.base && db.tables[db.base] && /* @__PURE__ */ u3(PipelineArrow, { id: "base" }),
      (db.lookups || []).map((lk, i3) => /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3(LookupStage, { lk, i: i3, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode }),
        /* @__PURE__ */ u3(PipelineArrow, { id: `lk${i3}` })
      ] })),
      (db.calcStages || []).map((calc, i3) => /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3(CalcStageComponent, { calc, i: i3 }),
        /* @__PURE__ */ u3(PipelineArrow, { id: `calc${i3}` })
      ] })),
      /* @__PURE__ */ u3("div", { style: "display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px", children: [
        /* @__PURE__ */ u3("div", { class: "pl-add-btn", onClick: () => addLookup(), children: [
          "\uFF0B",
          " Look up columns from another sheet"
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-add-btn", onClick: () => addCalcStage(), children: [
          "\uFF0B",
          " Add a calculated column from existing sheets"
        ] })
      ] })
    ] });
  }

  // js/ui/views/output-card.tsx
  function _buildTooltip(c3, src) {
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
Sample: ${vals.map((v3) => String(v3)).join(" \xB7 ")}` : `${from}
(no sample values)`;
    }
    return "";
  }
  function _chipAtPoint(el, x3, y3, dragCol) {
    const chips = [...el.querySelectorAll("[data-col]")].filter((c3) => c3.dataset.col !== dragCol);
    if (!chips.length) return null;
    const direct = document.elementFromPoint(x3, y3)?.closest("[data-col]");
    if (direct && direct.dataset.col !== dragCol) return direct;
    const sameRow = chips.filter((c3) => {
      const r3 = c3.getBoundingClientRect();
      return y3 >= r3.top && y3 <= r3.bottom;
    });
    const pool = sameRow.length ? sameRow : chips;
    let best = null, bestDist = Infinity;
    for (const chip of pool) {
      const r3 = chip.getBoundingClientRect();
      const cx = (r3.left + r3.right) / 2;
      const cy = (r3.top + r3.bottom) / 2;
      const d3 = sameRow.length ? Math.abs(x3 - cx) : Math.hypot(x3 - cx, y3 - cy);
      if (d3 < bestDist) {
        bestDist = d3;
        best = chip;
      }
    }
    return best;
  }
  function handleDblClick(col) {
    const mode = db.aggMode || "none";
    if (mode === "group") {
      const idx = db.groupBy.indexOf(col);
      if (idx >= 0) {
        db.groupBy.splice(idx, 1);
        if (db.groupBy.length === 0) {
          db.aggregates = db.aggregates.filter((a3) => !a3.auto);
        } else if (!db.aggregates.some((a3) => a3.col === col)) {
          db.aggregates.push({ fn: smartDefaultFn(col), col, alias: "", auto: true });
        }
      } else {
        db.groupBy.push(col);
        db.aggregates = db.aggregates.filter((a3) => !(a3.auto && a3.col === col));
        const allCols = projectedCols();
        for (const c3 of allCols) {
          if (!db.groupBy.includes(c3) && !db.aggregates.some((a3) => a3.col === c3)) {
            db.aggregates.push({ fn: smartDefaultFn(c3), col: c3, alias: "", auto: true });
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
      const s3 = db.selCols;
      if (s3.has(col)) s3.delete(col);
      renderQueryBuilder();
    }
  }
  function ColChips() {
    const containerRef = A2(null);
    const dragColRef = A2(null);
    const [ctxMenu, setCtxMenu] = d2(null);
    const [renameTarget, setRenameTarget] = d2(null);
    if (!db.base) return null;
    const cols = projectedCols();
    const colMap = buildColSourceMap();
    const mode = db.aggMode || "none";
    if (!db.selCols) {
      db.selCols = new Set(cols);
      _seenCols.clear();
      cols.forEach((c3) => _seenCols.add(c3));
    }
    if (!db.colOrder) {
      db.colOrder = [...cols];
    } else {
      const colSet = new Set(cols);
      db.colOrder = [
        ...db.colOrder.filter((c3) => colSet.has(c3)),
        ...cols.filter((c3) => !db.colOrder.includes(c3))
      ];
    }
    _syncSubtotalByToLayout();
    const groupSet = new Set(db.groupBy);
    const showBadges = mode === "group" && groupSet.size > 0;
    const selSet = db.selCols;
    const colOrder = db.colOrder;
    const onDragStart = q2((col, e3) => {
      dragColRef.current = col;
      e3.target.classList.add("dragging");
      if (e3.dataTransfer) e3.dataTransfer.effectAllowed = "move";
    }, []);
    const onDragEnd = q2(() => {
      dragColRef.current = null;
      containerRef.current?.querySelectorAll(".chip").forEach((c3) => c3.classList.remove("dragging", "drag-over"));
    }, []);
    const onDragOver = q2((e3) => {
      e3.preventDefault();
      if (e3.dataTransfer) e3.dataTransfer.dropEffect = "move";
      const el = containerRef.current;
      if (!el) return;
      const nearest = _chipAtPoint(el, e3.clientX, e3.clientY, dragColRef.current);
      el.querySelectorAll(".chip").forEach((c3) => c3.classList.remove("drag-over"));
      if (nearest) nearest.classList.add("drag-over");
    }, []);
    const onDrop = q2((e3) => {
      e3.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const nearest = _chipAtPoint(el, e3.clientX, e3.clientY, dragColRef.current);
      const dragCol = dragColRef.current;
      if (!nearest || !dragCol || nearest.dataset.col === dragCol) return;
      if (!db.colOrder) db.colOrder = projectedCols();
      const from = db.colOrder.indexOf(dragCol);
      const to = db.colOrder.indexOf(nearest.dataset.col);
      if (from < 0 || to < 0) return;
      db.colOrder.splice(from, 1);
      db.colOrder.splice(to, 0, dragCol);
      _syncSubtotalByToLayout();
      renderQueryBuilder();
      if ((db.aggMode || "none") === "subtotals") {
        const projected = projectedCols();
        const ordered = Array.isArray(db.colOrder) ? db.colOrder.filter((c3) => projected.includes(c3)) : projected;
        renderSubtotalsSection(ordered);
      }
    }, []);
    const hint = mode === "group" ? "\u2014 double-click to group by \xB7 drag to reorder \xB7 right-click to rename" : mode === "subtotals" ? "\u2014 double-click to group rows \xB7 drag to reorder \xB7 right-click to rename" : "\u2014 double-click to show/hide \xB7 drag to reorder \xB7 right-click to rename";
    return /* @__PURE__ */ u3("div", { children: [
      /* @__PURE__ */ u3(
        "div",
        {
          ref: containerRef,
          id: "colChips",
          class: "chips",
          onDragOver,
          onDrop,
          children: colOrder.map((c3) => {
            const src = colMap.get(c3);
            const colorCls = src ? getTableColorClass(src.tid) : "";
            const label = colDisplayLabel(c3, colMap);
            if (selSet && !selSet.has(c3)) return null;
            const tip = _buildTooltip(c3, src);
            if (mode === "group") {
              const isOn2 = groupSet.has(c3);
              const hasAgg = db.aggregates.some((a3) => a3.col === c3);
              const isOrphan = showBadges && !isOn2 && !hasAgg;
              const badge = isOrphan ? "\u26A0" : "";
              const badgeTip = isOrphan ? "No calculation for this column \u2014 it will be dropped from results. Click \u26A0 to add one automatically." : "";
              return /* @__PURE__ */ u3(
                Chip,
                {
                  col: c3,
                  label,
                  colorClass: colorCls,
                  selected: isOn2,
                  draggable: true,
                  tooltip: tip,
                  badge,
                  badgeTooltip: badgeTip,
                  className: isOrphan ? "chip-orphan" : "",
                  onDblClick: () => handleDblClick(c3),
                  onContextMenu: (e3) => {
                    e3.preventDefault();
                    setCtxMenu({ x: e3.clientX, y: e3.clientY, items: [{ label: "Rename", action: () => setRenameTarget(resolveRenameTarget(c3)) }] });
                  },
                  onDragStart: (e3) => onDragStart(c3, e3),
                  onDragEnd
                },
                c3
              );
            } else if (mode === "subtotals") {
              const isOn2 = (db.subtotalBy || []).includes(c3);
              return /* @__PURE__ */ u3(
                Chip,
                {
                  col: c3,
                  label,
                  colorClass: colorCls,
                  selected: isOn2,
                  draggable: true,
                  tooltip: tip,
                  onDblClick: () => handleDblClick(c3),
                  onContextMenu: (e3) => {
                    e3.preventDefault();
                    setCtxMenu({ x: e3.clientX, y: e3.clientY, items: [{ label: "Rename", action: () => setRenameTarget(resolveRenameTarget(c3)) }] });
                  },
                  onDragStart: (e3) => onDragStart(c3, e3),
                  onDragEnd
                },
                c3
              );
            }
            const isOn = selSet ? selSet.has(c3) : false;
            return /* @__PURE__ */ u3(
              Chip,
              {
                col: c3,
                label,
                colorClass: colorCls,
                selected: isOn,
                draggable: true,
                tooltip: tip,
                onDblClick: () => handleDblClick(c3),
                onContextMenu: (e3) => {
                  e3.preventDefault();
                  setCtxMenu({ x: e3.clientX, y: e3.clientY, items: [{ label: "Rename", action: () => setRenameTarget(resolveRenameTarget(c3)) }] });
                },
                onDragStart: (e3) => onDragStart(c3, e3),
                onDragEnd
              },
              c3
            );
          })
        }
      ),
      /* @__PURE__ */ u3("div", { id: "colCardHint", style: "font-size:0.72rem;color:var(--muted);margin-top:4px", children: hint }),
      ctxMenu && /* @__PURE__ */ u3(
        ContextMenu,
        {
          x: ctxMenu.x,
          y: ctxMenu.y,
          items: ctxMenu.items,
          onClose: () => setCtxMenu(null)
        }
      ),
      renameTarget && /* @__PURE__ */ u3(
        RenameModal,
        {
          target: renameTarget,
          onDone: () => {
            renderQueryBuilder();
            if (db.result) renderResults(db.result);
          },
          onClose: () => setRenameTarget(null)
        }
      )
    ] });
  }
  function selectAllCols() {
    db.selCols = new Set(projectedCols());
    renderQueryBuilder();
  }
  if (typeof window !== "undefined") window.selectAllCols = selectAllCols;
  function selectNoneCols() {
    db.selCols = /* @__PURE__ */ new Set();
    renderQueryBuilder();
  }
  if (typeof window !== "undefined") window.selectNoneCols = selectNoneCols;
  function MergeToggles() {
    const cols = db.result?.cols || [];
    if (!cols.length) return null;
    const baseDisplayCols = cols.filter((c3) => c3 !== "_rowno" && c3 !== "_row_type" && c3 !== "_isTotalsRow");
    const visibleDisplayCols = db.selCols?.has ? baseDisplayCols.filter((c3) => db.selCols.has(c3)) : baseDisplayCols;
    const orderedFromLayout = Array.isArray(db.colOrder) ? db.colOrder.filter((c3) => visibleDisplayCols.includes(c3)) : [];
    const displayCols = [
      ...orderedFromLayout,
      ...visibleDisplayCols.filter((c3) => !orderedFromLayout.includes(c3))
    ];
    if (!displayCols.length) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "No result columns" });
    }
    if (!db.mergedCols) db.mergedCols = [];
    const mergedSet = new Set(db.mergedCols);
    const colMap = buildColSourceMap();
    const toggle = (c3, checked) => {
      if (checked) {
        if (!db.mergedCols.includes(c3)) db.mergedCols.push(c3);
      } else {
        db.mergedCols = db.mergedCols.filter((x3) => x3 !== c3);
      }
      if (db.result) renderResults(db.result);
    };
    return /* @__PURE__ */ u3("div", { id: "mergeToggles", children: displayCols.map((c3) => /* @__PURE__ */ u3("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;font-weight:normal;margin-top:4px", children: [
      /* @__PURE__ */ u3(
        "input",
        {
          type: "checkbox",
          checked: mergedSet.has(c3),
          onChange: (e3) => toggle(c3, e3.target.checked)
        }
      ),
      colDisplayLabel(c3, colMap)
    ] }, c3)) });
  }
  function setMergeGroupUnderline(checked) {
    db.mergeGroupUnderline = !!checked;
    if (db.result) renderResults(db.result);
  }
  if (typeof window !== "undefined") window.setMergeGroupUnderline = setMergeGroupUnderline;
  var _colChipsRoot = null;
  var _mergeTogglesRoot = null;
  function renderColChips() {
    const el = document.getElementById("colChips");
    if (!el) return;
    if (!_colChipsRoot) {
      _colChipsRoot = el.parentElement;
    }
    nn(/* @__PURE__ */ u3(ColChips, {}), _colChipsRoot);
  }
  function renderMergeToggles(cols) {
    const el = document.getElementById("mergeToggles");
    if (!el) return;
    if (!_mergeTogglesRoot) {
      _mergeTogglesRoot = el;
    }
    nn(/* @__PURE__ */ u3(MergeToggles, {}), _mergeTogglesRoot);
  }

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
        aggregates: (db.aggregates || []).map((a3) => ({ ...a3 }))
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
      db.aggregates = Array.isArray(state.aggregates) ? state.aggregates.map((a3) => ({ ...a3 })) : [];
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
        renderAggregateItems2(cols);
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
        document.querySelectorAll('input[name="subtotalStrategy"]').forEach((r3) => {
          r3.checked = r3.value === strat;
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
    const allCols = db.colOrder ? db.colOrder.filter((c3) => projected.includes(c3)) : projected;
    const selSet = db.selCols;
    const cols = selSet ? allCols.filter((c3) => selSet.has(c3)) : allCols;
    const mode = db.aggMode || "none";
    const aggSection = document.getElementById("aggSection");
    const totSec = document.getElementById("totalsSection");
    const subSec = document.getElementById("subtotalsSection");
    const hint = document.getElementById("aggHint");
    document.querySelectorAll('input[name="aggMode"]').forEach((r3) => {
      r3.checked = r3.value === mode;
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
    const visibleCols = cols.filter((c3) => !selSet2 || selSet2.has(c3));
    wrap.innerHTML = visibleCols.map((col) => {
      const cur = db.colTotals[col] || "skip";
      const label = colDisplayLabel(col, colMap);
      return `
    <div class="totals-row">
      <span class="totals-col-name" title="${h(col)}">${h(label)}</span>
      <select class="totals-fn-sel" data-tcol="${h(col)}">
        ${TOTAL_FNS.map(
        (f4) => `<option value="${f4}" ${cur === f4 ? "selected" : ""}>${TOTAL_LABELS[f4]}</option>`
      ).join("")}
      </select>
    </div>`;
    }).join("");
  }
  if (typeof document !== "undefined") {
    document.getElementById("totalsItems").addEventListener("change", (e3) => {
      const sel = e3.target.closest("[data-tcol]");
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
    const visibleCols = cols.filter((c3) => (!selSet3 || selSet3.has(c3)) && !subtotalBy.includes(c3));
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
        (f4) => `<option value="${f4}" ${cur === f4 ? "selected" : ""}>${SUBTOTAL_LABELS[f4]}</option>`
      ).join("")}
      </select>
    </div>`;
    }).join("");
  }
  if (typeof window !== "undefined") window.renderSubtotalsSection = renderSubtotalsSection;
  if (typeof document !== "undefined") {
    document.getElementById("subtotalsItems").addEventListener("change", (e3) => {
      const sel = e3.target.closest("[data-stcol]");
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
  function renderAggregateItems2(cols) {
    const wrap = document.getElementById("aggItems");
    const colMap = buildColSourceMap();
    const selSet4 = db.selCols;
    cols = selSet4 instanceof Set ? cols.filter((c3) => selSet4.has(c3)) : cols;
    if (!db.aggregates.length) {
      if (db.groupBy.length > 0) {
        wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No calculations \u2014 add one below or click ungrouped chips above</span>';
      } else {
        wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">Click a column above to start grouping</span>';
      }
      return;
    }
    wrap.innerHTML = db.aggregates.map((agg, i3) => {
      const needsCol = AGG_NEEDS_COL(agg.fn);
      const colLabel = needsCol ? agg.col ? colDisplayLabel(agg.col, colMap) : "" : "all rows";
      const ph = h(defaultAggAlias(agg.fn, colLabel));
      const autoMark = agg.auto ? `<span class="agg-auto-badge" title="Auto-added \u2014 edit or delete to customize.">auto</span>` : "";
      const colPicker = needsCol ? `<span class="agg-eq">of</span>
         <select data-ai="${i3}" data-ap="col">
           ${cols.map(
        (c3) => `<option value="${h(c3)}" ${agg.col === c3 ? "selected" : ""}>${h(colDisplayLabel(c3, colMap))}</option>`
      ).join("")}
         </select>` : "";
      return `
    <div class="agg-row${agg.auto ? " agg-row-auto" : ""}">
      ${autoMark}
      <input type="text" class="agg-alias" placeholder="${ph}" value="${h(agg.alias)}"
             data-ai="${i3}" data-ap="alias">
      <span class="agg-eq">=</span>
      <select data-ai="${i3}" data-ap="fn">
        ${AGG_FNS.map((f4) => `<option value="${f4}" ${agg.fn === f4 ? "selected" : ""}>${AGG_LABELS[f4]}</option>`).join("")}
      </select>
      ${colPicker}
      <button class="btn btn-danger" data-rmagg="${i3}">\u2715</button>
    </div>`;
    }).join("");
  }
  if (typeof window !== "undefined") window.renderAggregateItems = renderAggregateItems2;
  function addAggregate() {
    const cols = projectedCols();
    const col = cols.find((c3) => !db.groupBy.includes(c3)) || cols[0] || "";
    db.aggregates.push({ fn: "SUM", col, alias: "", auto: false });
    renderAggregateItems2(cols);
  }
  if (typeof window !== "undefined") window.addAggregate = addAggregate;
  function removeAggregate(i3) {
    db.aggregates.splice(i3, 1);
    renderAggregation();
  }
  function touchAggregate(i3) {
    if (db.aggregates[i3]) db.aggregates[i3].auto = false;
  }
  if (typeof document !== "undefined") {
    document.getElementById("aggItems").addEventListener("change", (e3) => {
      const target = e3.target;
      const { ai, ap } = target.dataset;
      if (ai === void 0 || !ap) return;
      db.aggregates[+ai][ap] = target.value;
      touchAggregate(+ai);
      if (ap === "fn") renderAggregateItems2(projectedCols());
    });
    document.getElementById("aggItems").addEventListener("input", (e3) => {
      const target = e3.target;
      const { ai, ap } = target.dataset;
      if (ai !== void 0 && ap === "alias") {
        db.aggregates[+ai].alias = target.value;
        touchAggregate(+ai);
      }
    });
    document.getElementById("aggItems").addEventListener("click", (e3) => {
      const btn = e3.target.closest("[data-rmagg]");
      if (btn) removeAggregate(+btn.dataset.rmagg);
    });
  }

  // js/ui/views/filter-sort-card.tsx
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
  function useDistinctValues(alias) {
    const [values, setValues] = d2([]);
    y2(() => {
      if (!alias) {
        setValues([]);
        return;
      }
      const src = buildColSourceMap().get(alias);
      if (!src || src.kind === "calc") {
        setValues([]);
        return;
      }
      try {
        const rows = execQuery(
          `SELECT DISTINCT ${quoteId(src.col)} FROM ${quoteId(src.tid)}
         WHERE ${quoteId(src.col)} IS NOT NULL
         ORDER BY ${quoteId(src.col)} LIMIT 100`
        );
        setValues(rows.map((r3) => String(Object.values(r3)[0]).trim()).filter(Boolean));
      } catch {
        setValues([]);
      }
    }, [alias]);
    return values;
  }
  function FilterRow({ f: f4, i: i3, cols, colMap }) {
    const noVal = NO_VAL_OPS.has(f4.op);
    const vals = Array.isArray(f4.vals) ? f4.vals : [""];
    const fEnabled = f4.enabled !== false;
    const fV = getValidation().items[`filter_${i3}`];
    const fBlocked = fV && fV.blocking;
    const fUnresolved = fV && !fV.resolved;
    const fIssueMsg = fUnresolved && fV.issues[0] ? fV.issues[0].message : null;
    const distinct = useDistinctValues(f4.col);
    const datalistId = "fdl_" + i3;
    const update = (prop, value) => {
      f4[prop] = value;
      invalidateValidation();
      renderFilters();
    };
    return /* @__PURE__ */ u3("div", { class: `filter-row${fBlocked ? " pl-lookup-stage--invalid" : fUnresolved && !fEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!fEnabled ? "pl-stage-disabled" : ""}`, children: [
      fIssueMsg && /* @__PURE__ */ u3("div", { class: "pl-lookup-error", style: "width:100%;font-size:0.72rem;margin-bottom:3px", children: [
        fBlocked ? "\u26D4" : "\u26A0",
        " ",
        fIssueMsg
      ] }),
      /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", style: "margin-left:auto;order:99", title: fEnabled ? "Disable filter" : "Enable filter", children: [
        /* @__PURE__ */ u3("input", { type: "checkbox", checked: fEnabled, onChange: (e3) => update("enabled", e3.target.checked) }),
        /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: fEnabled ? "" : "Off" })
      ] }),
      /* @__PURE__ */ u3("select", { value: f4.col, onChange: (e3) => {
        f4.col = e3.target.value;
        f4.vals = [""];
        renderFilters();
      }, children: [
        /* @__PURE__ */ u3("option", { value: "", children: "Column\\u2026" }),
        cols.map((c3) => /* @__PURE__ */ u3("option", { value: c3, children: colDisplayLabel(c3, colMap) }, c3))
      ] }),
      /* @__PURE__ */ u3("select", { class: "fop", value: f4.op, onChange: (e3) => update("op", e3.target.value), children: FILTER_OPS.map((op) => /* @__PURE__ */ u3("option", { value: op, children: op }, op)) }),
      /* @__PURE__ */ u3("span", { class: "filter-or-wrap", style: { display: noVal ? "none" : "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }, children: [
        vals.map((v3, j4) => /* @__PURE__ */ u3("span", { style: "display:contents", children: [
          j4 > 0 && /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);padding:0 1px;flex-shrink:0", children: "OR" }),
          /* @__PURE__ */ u3(
            "input",
            {
              type: "text",
              list: datalistId,
              placeholder: "value",
              value: v3,
              style: "width:120px",
              onInput: (e3) => {
                if (!Array.isArray(f4.vals)) f4.vals = [""];
                f4.vals[j4] = e3.target.value;
              }
            }
          ),
          j4 > 0 && /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-danger",
              style: "padding:2px 5px;font-size:0.75rem;flex-shrink:0",
              title: "Remove this OR value",
              onClick: () => {
                if (f4.vals.length > 1) {
                  f4.vals.splice(j4, 1);
                  renderFilters();
                }
              },
              children: "\\u2715"
            }
          )
        ] }, j4)),
        /* @__PURE__ */ u3(
          "button",
          {
            class: "btn btn-ghost",
            style: "padding:2px 7px;font-size:0.76rem;flex-shrink:0",
            title: "Add OR value",
            onClick: () => {
              if (!Array.isArray(f4.vals)) f4.vals = [""];
              f4.vals.push("");
              renderFilters();
            },
            children: "\\uFF0B"
          }
        ),
        /* @__PURE__ */ u3("datalist", { id: datalistId, children: distinct.map((v3) => /* @__PURE__ */ u3("option", { value: v3 }, v3)) })
      ] }),
      /* @__PURE__ */ u3("button", { class: "btn btn-danger", onClick: () => {
        db.filters.splice(i3, 1);
        renderFilters();
      }, children: "\\u2715" })
    ] });
  }
  function Filters() {
    const colMap = buildColSourceMap();
    const cols = projectedCols();
    if (!db.filters.length) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "No filters \\u2014 all rows returned" });
    }
    return /* @__PURE__ */ u3("div", { id: "filterItems", children: db.filters.map((f4, i3) => /* @__PURE__ */ u3(FilterRow, { f: f4, i: i3, cols, colMap }, i3)) });
  }
  function addFilter() {
    db.filters.push({ col: "", op: "contains", val: "", vals: [""], enabled: true });
    renderFilters();
  }
  if (typeof window !== "undefined") window.addFilter = addFilter;
  function SortRow({ s: s3, i: i3, cols, colMap }) {
    const sEnabled = s3.enabled !== false;
    const sV = getValidation().items[`sort_${i3}`];
    const sBlocked = sV && sV.blocking;
    const sUnresolved = sV && !sV.resolved;
    const sIssueMsg = sUnresolved && sV.issues[0] ? sV.issues[0].message : null;
    const update = (prop, value) => {
      s3[prop] = value;
      invalidateValidation();
      renderSorts();
    };
    return /* @__PURE__ */ u3("div", { class: `sort-row${sBlocked ? " pl-lookup-stage--invalid" : sUnresolved && !sEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!sEnabled ? "pl-stage-disabled" : ""}`, children: [
      sIssueMsg && /* @__PURE__ */ u3("div", { class: "pl-lookup-error", style: "width:100%;font-size:0.72rem;margin-bottom:3px", children: [
        sBlocked ? "\u26D4" : "\u26A0",
        " ",
        sIssueMsg
      ] }),
      /* @__PURE__ */ u3("span", { class: "sort-level", children: [
        i3 + 1,
        "."
      ] }),
      /* @__PURE__ */ u3("select", { value: s3.col, style: "flex:1;min-width:0", onChange: (e3) => update("col", e3.target.value), children: [
        /* @__PURE__ */ u3("option", { value: "", children: "\\u2014 column \\u2014" }),
        cols.map((c3) => /* @__PURE__ */ u3("option", { value: c3, children: colDisplayLabel(c3, colMap) }, c3))
      ] }),
      /* @__PURE__ */ u3("select", { value: s3.dir, style: "width:95px;flex-shrink:0", onChange: (e3) => update("dir", e3.target.value), children: [
        /* @__PURE__ */ u3("option", { value: "ASC", children: "\\u2191 A \\u2192 Z" }),
        /* @__PURE__ */ u3("option", { value: "DESC", children: "\\u2193 Z \\u2192 A" })
      ] }),
      /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", title: sEnabled ? "Disable sort" : "Enable sort", children: [
        /* @__PURE__ */ u3("input", { type: "checkbox", checked: sEnabled, onChange: (e3) => update("enabled", e3.target.checked) }),
        /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: sEnabled ? "" : "Off" })
      ] }),
      /* @__PURE__ */ u3("button", { class: "btn btn-danger", onClick: () => {
        db.sorts.splice(i3, 1);
        renderSorts();
      }, children: "\\u2715" })
    ] });
  }
  function Sorts() {
    const selCols = db.selCols;
    const colOrder = db.colOrder || projectedCols();
    const cols = colOrder.filter((c3) => !selCols || selCols.has(c3));
    const colMap = buildColSourceMap();
    if (!db.sorts.length) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "No sort \\u2014 rows returned in natural order" });
    }
    return /* @__PURE__ */ u3("div", { id: "sortItems", children: db.sorts.map((s3, i3) => /* @__PURE__ */ u3(SortRow, { s: s3, i: i3, cols, colMap }, i3)) });
  }
  function addSort() {
    db.sorts.push({ col: "", dir: "ASC", enabled: true });
    renderSorts();
  }
  if (typeof window !== "undefined") window.addSort = addSort;
  var _filtersRoot = null;
  var _sortsRoot = null;
  function renderFilters() {
    const el = document.getElementById("filterItems");
    if (!el) return;
    if (!_filtersRoot) _filtersRoot = el;
    nn(/* @__PURE__ */ u3(Filters, {}), _filtersRoot);
  }
  function renderSorts() {
    const el = document.getElementById("sortItems");
    if (!el) return;
    if (!_sortsRoot) _sortsRoot = el;
    nn(/* @__PURE__ */ u3(Sorts, {}), _sortsRoot);
  }

  // js/ui/views/query-builder.tsx
  function QueryBuilder() {
    const ids = Object.keys(db.tables).sort((a3, b2) => db.tables[a3].name.localeCompare(db.tables[b2].name));
    const hasBase = !!db.base && !!db.tables[db.base];
    const hasBaseConfigured = !!db.base;
    y2(() => {
      if (hasBase) {
        renderAggregation();
      }
    });
    if (!ids.length) {
      return /* @__PURE__ */ u3("div", { id: "qEmpty", children: /* @__PURE__ */ u3("div", { class: "empty", children: [
        /* @__PURE__ */ u3("div", { class: "empty-icon", children: "\u{1F4C2}" }),
        /* @__PURE__ */ u3("div", { children: "Load a spreadsheet to get started" })
      ] }) });
    }
    let statusPill = null;
    let runDisabled = false;
    if (hasBaseConfigured) {
      const v3 = getValidation();
      const blocked = v3.reportStatus === "blocked";
      const items = Object.values(v3.items);
      const issueCount = items.filter((it) => it.blocking).length;
      if (blocked) {
        statusPill = { text: `\u26A0 Blocked (${issueCount} issue${issueCount !== 1 ? "s" : ""})`, bg: "rgba(200,60,60,0.18)", color: "#e07070", border: "1px solid rgba(200,60,60,0.35)" };
      } else {
        statusPill = { text: "\u2713 Healthy", bg: "rgba(50,180,100,0.15)", color: "#6ec87e", border: "1px solid rgba(50,180,100,0.3)" };
      }
      runDisabled = blocked;
    }
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3(Pipeline, {}),
      hasBase && /* @__PURE__ */ u3("div", { id: "colCard", class: "qb-card", children: [
        /* @__PURE__ */ u3("div", { class: "qb-title", style: "margin-bottom:6px", children: [
          "Report Layout",
          /* @__PURE__ */ u3("span", { class: "tip", id: "colCardTip", "data-tip": "Choose which columns appear in your report and how they are summarized. Drag chips to reorder columns. Double-click a chip to hide/show it.", children: "?" })
        ] }),
        /* @__PURE__ */ u3(ColChips, {}),
        /* @__PURE__ */ u3("div", { id: "aggSection" }),
        /* @__PURE__ */ u3("div", { id: "totalsSection" }),
        /* @__PURE__ */ u3("div", { id: "subtotalsSection" })
      ] }),
      hasBase && /* @__PURE__ */ u3("div", { id: "filterSortCard", class: "qb-card", children: [
        /* @__PURE__ */ u3("div", { class: "qb-title", style: "margin-bottom:6px", children: "Sort & Filter" }),
        /* @__PURE__ */ u3("div", { style: "margin-bottom:8px", children: [
          /* @__PURE__ */ u3("div", { style: "font-size:0.76rem;margin-bottom:4px", children: "Sort By" }),
          /* @__PURE__ */ u3(Sorts, {}),
          /* @__PURE__ */ u3("button", { class: "btn btn-ghost", style: "font-size:0.72rem;margin-top:4px", onClick: addSort2, children: "+ Add sort" })
        ] }),
        /* @__PURE__ */ u3("div", { style: "margin-bottom:8px", children: [
          /* @__PURE__ */ u3("div", { style: "font-size:0.76rem;margin-bottom:4px", children: "Filters" }),
          /* @__PURE__ */ u3(Filters, {}),
          /* @__PURE__ */ u3("button", { class: "btn btn-ghost", style: "font-size:0.72rem;margin-top:4px", onClick: addFilter2, children: "+ Add filter" })
        ] }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("div", { style: "font-size:0.76rem;margin-bottom:4px", children: "Merge duplicate cells" }),
          /* @__PURE__ */ u3(MergeToggles, {})
        ] })
      ] }),
      hasBaseConfigured && /* @__PURE__ */ u3("div", { id: "runRow", style: "display:flex;align-items:center;gap:8px;padding:8px 0", children: [
        /* @__PURE__ */ u3("span", { id: "reportStatusPill", style: {
          display: "",
          background: statusPill?.bg || "",
          color: statusPill?.color || "",
          border: statusPill?.border || "",
          fontSize: "0.72rem",
          padding: "2px 8px",
          borderRadius: "10px"
        }, children: statusPill?.text || "" }),
        /* @__PURE__ */ u3("button", { id: "runBtn", class: "btn btn-primary", disabled: runDisabled, onClick: runQuery, children: "Run Report" }),
        /* @__PURE__ */ u3("span", { id: "runStatus", style: "font-size:0.72rem;color:var(--muted)" })
      ] })
    ] });
  }
  function addSort2() {
    db.sorts.push({ col: "", dir: "ASC", enabled: true });
    renderQueryBuilder();
  }
  function addFilter2() {
    db.filters.push({ col: "", op: "contains", val: "", vals: [""], enabled: true });
    renderQueryBuilder();
  }
  function onBaseChange(val) {
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
    if (_previewOpen.has(key)) _previewOpen.delete(key);
    else _previewOpen.add(key);
    renderQueryBuilder();
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
          const sel = baseCols.map((c3) => tCols.includes(c3) ? quoteId(c3) : "NULL").join(", ");
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
      <thead><tr>${cols.map((c3) => `<th title="${c3}">${colDisplayLabel(c3, pvMap)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(
        (r3) => `<tr>${cols.map((c3) => `<td title="${String(r3[c3] ?? "")}">${String(r3[c3] ?? "")}</td>`).join("")}</tr>`
      ).join("")}</tbody>
    </table>`;
    } catch (ex) {
      return `<em style="color:var(--red);font-size:0.72rem">Error: ${ex.message}</em>`;
    }
  }
  function addStack(id) {
    if (!id || !db.tables[id] || id === db.base) return;
    if (!db.stacks.includes(id)) db.stacks.push(id);
    _afterCombineChange();
  }
  function removeStack(id) {
    db.stacks = db.stacks.filter((s3) => s3 !== id);
    _afterCombineChange();
  }
  function addLookup() {
    if (!db.base) return;
    if (!db.lookups) db.lookups = [];
    db.lookups.push({ rightId: "", keyPairs: [{ left: "", right: "" }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: "block" } });
    _afterCombineChange();
  }
  function addCalcStage() {
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
  function removeCalcStage(i3) {
    if (!Array.isArray(db.calcStages)) db.calcStages = [];
    db.calcStages.splice(i3, 1);
    _afterCombineChange();
  }
  function removeLookup(i3) {
    db.lookups.splice(i3, 1);
    _afterCombineChange();
  }
  function selectAllLookupCols(i3) {
    const lk = db.lookups[i3];
    const rt = lk.rightId && db.tables[lk.rightId];
    if (rt) {
      _showLayoutAliasesForSource(lk.rightId);
      _afterCombineChange();
    }
  }
  function selectNoneLookupCols(i3) {
    const lk = db.lookups[i3];
    _hideLookupLayoutAliasesSafely(lk.rightId, null, i3);
    _afterCombineChange();
  }
  function runQuery() {
    if (!db.base || !db.tables[db.base]) return;
    invalidateValidation();
    const v3 = getValidation();
    if (v3.reportStatus === "blocked") {
      const blockingItems = Object.values(v3.items).filter((item) => item.blocking);
      const firstMsg = blockingItems[0]?.issues?.[0]?.message || "missing source data";
      toast(`Can't run \u2014 fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ""}).`, "err");
      return;
    }
    const _hasAgg = db.aggMode === "group" && (db.groupBy.length > 0 || db.aggregates.length > 0);
    if (!_hasAgg && !["totals", "subtotals"].includes(db.aggMode) && db.selCols && db.selCols.size === 0) {
      toast("No output columns selected \u2014 click All or pick at least one column.", "err");
      return;
    }
    const status = document.getElementById("runStatus");
    status.textContent = "Running\u2026";
    setTimeout(() => {
      try {
        const resultSet = runReport(db);
        if (!resultSet) throw new Error("No result set returned");
        const displayRows = resultSet.rows.filter((r3) => !r3._row_type);
        const hasTotals = !!resultSet.metadata.totalsRow;
        const hasSubs = !!resultSet.metadata.hasSubtotals;
        db.result = { rows: resultSet.rows, totalsRow: resultSet.metadata.totalsRow || null, cols: resultSet.columns, hasSubtotals: hasSubs };
        let statusText = displayRows.length.toLocaleString() + " rows";
        if (hasTotals) statusText += " + grand total";
        if (hasSubs) statusText += " (subtotals)";
        status.textContent = statusText;
        switchTab("results");
        renderResults(db.result);
      } catch (ex) {
        status.textContent = "Error";
        toast("Query error: " + ex.message, "err");
      }
    }, 20);
  }
  function renderQueryBuilder() {
    invalidateValidation();
    const ids = Object.keys(db.tables).sort((a3, b2) => db.tables[a3].name.localeCompare(db.tables[b2].name));
    const qEmpty = document.getElementById("qEmpty");
    const qBuilder = document.getElementById("qBuilder");
    if (qEmpty) qEmpty.style.display = ids.length ? "none" : "";
    if (qBuilder) qBuilder.style.display = ids.length ? "grid" : "none";
    if (!ids.length) {
      if (qBuilder) nn(null, qBuilder);
      return;
    }
    if (qBuilder) nn(/* @__PURE__ */ u3(QueryBuilder, {}), qBuilder);
  }
  if (typeof window !== "undefined") window.onBaseChange = onBaseChange;
  if (typeof window !== "undefined") window.addStack = addStack;
  if (typeof window !== "undefined") window.addLookup = addLookup;
  if (typeof window !== "undefined") window.addCalcStage = addCalcStage;
  if (typeof window !== "undefined") window.runQuery = runQuery;

  // js/ui/grid.ts
  function openRenameModal(target, onDone) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cleanup = () => {
      nn(null, host);
      host.remove();
    };
    nn(
      RenameModal({ target, onDone, onClose: cleanup }),
      host
    );
  }
  var gridResult = null;
  var gridPreview = null;
  function refreshResultGridLayout() {
    if (!gridResult) return;
    try {
      gridResult.resetRowHeights?.();
    } catch (_3) {
    }
    try {
      gridResult.refreshCells?.({ force: true });
    } catch (_3) {
    }
    try {
      gridResult.redrawRows?.();
    } catch (_3) {
    }
  }
  function refreshPreviewGridLayout() {
    if (!gridPreview) return;
    try {
      gridPreview.resetRowHeights?.();
    } catch (_3) {
    }
    try {
      gridPreview.refreshCells?.({ force: true });
    } catch (_3) {
    }
    try {
      gridPreview.redrawRows?.();
    } catch (_3) {
    }
  }
  function renderResults(result) {
    const wrap = document.getElementById("resultsWrap");
    const meta = document.getElementById("resultsMeta");
    const btnXlsx = document.getElementById("btnExpXlsx");
    const btnCsv = document.getElementById("btnExpCsv");
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
          const v3 = params.value;
          return v3 == null ? "" : String(v3);
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
    const el = document.getElementById("resGrid");
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
    const sel = document.getElementById("previewSel");
    if (!sel) return;
    const prev = sel.value;
    const ids = Object.keys(db.tables);
    sel.innerHTML = '<option value="">\u2014 select a table to preview \u2014</option>' + ids.map((id) => `<option value="${id}">${h(db.tables[id].name)}</option>`).join("");
    if (db.tables[prev]) sel.value = prev;
  }
  function loadPreview() {
    const id = document.getElementById("previewSel").value;
    const wrap = document.getElementById("previewWrap");
    const meta = document.getElementById("previewMeta");
    if (gridPreview) {
      gridPreview.destroy();
      gridPreview = null;
    }
    if (!id || !db.tables[id]) {
      meta.textContent = "";
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">\u{1F446}</div><div>Select a table above</div></div>';
      return;
    }
    const t3 = db.tables[id];
    const cap = 1e4;
    const excluded = db.excludedRows[id] || /* @__PURE__ */ new Set();
    let rows;
    try {
      rows = execQuery(`SELECT "_rowno", ${t3.cols.map((c3) => quoteId(c3)).join(", ")} FROM ${quoteId(id)} LIMIT ${cap}`);
    } catch (ex) {
      meta.textContent = "Error loading preview";
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">\u274C</div><div>' + h(ex.message) + "</div></div>";
      return;
    }
    const excCount = excluded.size;
    meta.textContent = t3.rowCount.toLocaleString() + " rows \xB7 " + t3.cols.length + " cols" + (excCount ? " \xB7 " + excCount + " excluded" : "") + (t3.rowCount > cap ? " (preview: first " + cap.toLocaleString() + ")" : "");
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
        const preview = t3.cols.filter((c3) => c3 !== "_rowno").map((c3) => rowData[c3] == null ? "" : String(rowData[c3])).filter((v3) => v3 !== "").slice(0, 6).join(" \xB7 ");
        const action = isExcl ? "Restore row to reports" : "Exclude row from reports";
        btn.title = `${action}
\u2192 ${preview}`;
        btn.style.cssText = "background:transparent;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1";
        btn.textContent = isExcl ? "\u{1F6AB}" : "\u2705";
        btn.addEventListener("click", () => toggleRowExclusion(id, rowno));
        return btn;
      }
    };
    const el = document.getElementById("prevGrid");
    gridPreview = agGrid.createGrid(el, {
      rowData: rows,
      columnDefs: [excludeColDef, ...makePreviewCols(id, t3.cols)],
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
        floatingFilter: true,
        minWidth: 80,
        cellRenderer: (params) => {
          const v3 = params.value;
          return v3 == null ? "" : String(v3);
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
    const dataCols = cols.filter((c3) => c3 !== "_rowno" && c3 !== "_row_type" && c3 !== "_isTotalsRow");
    return dataCols.map((c3) => {
      const src = colMap.get(c3);
      const dispLabel = colDisplayLabel(c3, colMap);
      const srcPhys = src;
      const renamed = src && src.kind !== "calc" ? db.columnLabels?.[srcPhys.tid]?.[srcPhys.col] : void 0;
      const color = src ? getTableColor(srcPhys?.tid || "") : null;
      const doRename = () => {
        const target = resolveRenameTarget(c3);
        if (!target) return;
        openRenameModal(target, () => {
          renderQueryBuilder();
          if (db.result) renderResults(db.result);
        });
      };
      return {
        field: c3,
        headerName: dispLabel,
        tooltipField: c3,
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
          const v3 = params.value;
          return v3 == null ? "" : String(v3);
        }
      };
    });
  }
  function makePreviewCols(tid, physCols) {
    const color = getTableColor(tid);
    return physCols.filter((c3) => c3 !== "_rowno").map((c3) => {
      const renamed = db.columnLabels?.[tid]?.[c3];
      const label = renamed || c3;
      const doRename = () => {
        const colMap = buildColSourceMap();
        for (const [alias, src] of colMap.entries()) {
          if (src && src.kind !== "calc" && src.tid === tid && src.col === c3) {
            const target = resolveRenameTarget(alias);
            if (target) {
              openRenameModal(target, () => {
                renderQueryBuilder();
                if (db.result) renderResults(db.result);
                loadPreview();
              });
            }
            return;
          }
        }
      };
      const doClear = renamed ? () => {
        setColLabel(tid, c3, c3);
        renderQueryBuilder();
        if (db.result) renderResults(db.result);
        loadPreview();
      } : null;
      return {
        field: c3,
        headerName: label,
        minWidth: 110,
        filter: "agTextColumnFilter",
        floatingFilter: true,
        sortable: true,
        resizable: true,
        headerComponent: _makeHeaderComponent(label, color, renamed, c3, doRename, doClear),
        cellRenderer: (params) => {
          const v3 = params.value;
          return v3 == null ? "" : String(v3);
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
        txt.addEventListener("click", (e3) => params.progressSort(e3.shiftKey));
        this._gui.appendChild(txt);
        if (onRename) {
          const more = document.createElement("button");
          more.textContent = "\u22EF";
          more.title = "Rename column";
          more.style.cssText = "background:none;border:none;cursor:pointer;font-size:13px;padding:0 2px;color:#aaa;flex-shrink:0;line-height:1";
          more.addEventListener("click", (e3) => {
            e3.stopPropagation();
            onRename();
          });
          this._gui.appendChild(more);
        }
        if (onClear) {
          const clr = document.createElement("button");
          clr.textContent = "\xD7";
          clr.title = `Clear rename (original: ${origCol})`;
          clr.style.cssText = "background:none;border:none;cursor:pointer;font-size:10px;padding:0 1px;color:#aaa;flex-shrink:0;line-height:1";
          clr.addEventListener("click", (e3) => {
            e3.stopPropagation();
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
    document.querySelectorAll(".tab-panel").forEach((p3) => p3.classList.toggle("active", p3.id === "tab-" + name));
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
    const v3 = getValidation();
    if (v3.reportStatus === "blocked") {
      const blockingItems = Object.values(v3.items).filter((item) => item.blocking);
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
      (c3) => c3 !== "_rowno" && c3 !== "_row_type" && c3 !== "_isTotalsRow" && c3 !== "_sort_row_type" && !String(c3).startsWith("_sort_group_")
    );
    const exportHeaders = exportCols.map((c3) => hdrMap?.[c3] || c3);
    const mergeHeaderSet = new Set(
      exportCols.filter((c3) => (db.mergedCols || []).includes(c3)).map((c3) => hdrMap?.[c3] || c3)
    );
    const remap = (row) => {
      const out = {};
      for (const c3 of exportCols) {
        const header = hdrMap?.[c3];
        out[header || c3] = row[c3];
      }
      return out;
    };
    const dataRows = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : [...rows];
    const rowKinds = dataRows.map((r3) => {
      if (r3._isTotalsRow) return 3;
      const t3 = Number(r3._row_type);
      return Number.isFinite(t3) ? t3 : 0;
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
      let i3 = 0;
      while (i3 < cleanRows.length) {
        if ((rowKinds[i3] ?? 0) !== 0) {
          i3++;
          continue;
        }
        const v3 = cleanRows[i3]?.[h4];
        if (v3 == null || String(v3) === "") {
          i3++;
          continue;
        }
        let j4 = i3 + 1;
        while (j4 < cleanRows.length && (rowKinds[j4] ?? 0) === 0 && cleanRows[j4]?.[h4] === v3) {
          if (gateByLeft && leftGateHeaders.some((lh) => cleanRows[j4]?.[lh] !== cleanRows[j4 - 1]?.[lh])) {
            break;
          }
          j4++;
        }
        const span = j4 - i3;
        if (span > 1) {
          const s3 = { r: i3 + 1, c: cIdx };
          const e3 = { r: j4, c: cIdx };
          merges.push({ s: s3, e: e3 });
          for (let rr = s3.r + 1; rr <= e3.r; rr++) {
            const addr = xlsxUtils.encode_cell({ r: rr, c: cIdx });
            ws[addr] = { t: "z", v: void 0 };
          }
        }
        i3 = j4;
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
    const mergeStartSet = new Set((ws["!merges"] || []).map((m3) => `${m3.s.r}:${m3.s.c}`));
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
        let i3 = 0;
        while (i3 < cleanRows.length) {
          if ((rowKinds[i3] ?? 0) !== 0) {
            i3++;
            continue;
          }
          const v3 = cleanRows[i3]?.[h4];
          if (v3 == null || String(v3) === "") {
            i3++;
            continue;
          }
          let j4 = i3 + 1;
          while (j4 < cleanRows.length && (rowKinds[j4] ?? 0) === 0 && cleanRows[j4]?.[h4] === v3) {
            if (leftGateHeaders.some((lh) => cleanRows[j4]?.[lh] !== cleanRows[j4 - 1]?.[lh])) break;
            j4++;
          }
          const span = j4 - i3;
          if (span > 1) {
            let p3 = mergeParticipation.get(h4);
            if (!p3) {
              p3 = /* @__PURE__ */ new Set();
              mergeParticipation.set(h4, p3);
            }
            for (let r3 = i3; r3 < j4; r3++) p3.add(r3);
            addUnderline(j4 - 1, cIdx);
          } else {
            const hasLeftMergeContext = leftGateHeaders.some((lh) => mergeParticipation.get(lh)?.has(i3));
            if (hasLeftMergeContext) addUnderline(i3, cIdx);
          }
          i3 = j4;
        }
      });
    }
    const ensureRowUnderlineSet = /* @__PURE__ */ new Set();
    if (underlineMergedGroups) {
      for (const [r3, cStart] of mergeUnderlineStartByRow.entries()) {
        for (let c3 = cStart; c3 <= range.e.c; c3++) ensureRowUnderlineSet.add(`${r3}:${c3}`);
      }
    }
    for (let c3 = range.s.c; c3 <= range.e.c; c3++) {
      const addr = xlsxUtils.encode_cell({ r: 0, c: c3 });
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
    for (let r3 = 1; r3 <= range.e.r; r3++) {
      const rowType = rowKinds[r3 - 1] ?? 0;
      const isSubtotal = rowType === 1;
      const isGrand = rowType === 3;
      const isSpacer = rowType === 2;
      const isSummary = isSubtotal || isGrand;
      const summaryBorder = {
        style: isGrand ? "thick" : "medium",
        color: isGrand ? grandBorderColor : borderColor
      };
      const rowObj = cleanRows[r3 - 1] || {};
      let lastDataColIdx = range.s.c;
      if (isSummary) {
        lastDataColIdx = range.e.c;
      } else {
        for (let i3 = headers.length - 1; i3 >= 0; i3--) {
          const v3 = rowObj[headers[i3]];
          if (v3 != null && String(v3) !== "") {
            lastDataColIdx = range.s.c + i3;
            break;
          }
        }
      }
      const rowUnderlineStart = mergeUnderlineStartByRow.get(r3);
      const hasRowUnderline = rowUnderlineStart != null;
      for (let c3 = range.s.c; c3 <= range.e.c; c3++) {
        const addr = xlsxUtils.encode_cell({ r: r3, c: c3 });
        let cell = ws[addr];
        const shouldPersistBlank = isSummary || !isSummary && ensureRowUnderlineSet.has(`${r3}:${c3}`);
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
        const isMergedAnchor = mergeStartSet.has(`${r3}:${c3}`);
        const border = {};
        if (isSummary) {
          border.top = summaryBorder;
          border.bottom = summaryBorder;
          if (c3 === range.s.c) border.left = summaryBorder;
          if (c3 === lastDataColIdx) border.right = summaryBorder;
        }
        if (!isSummary && hasRowUnderline && c3 >= rowUnderlineStart) {
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
      for (let i3 = 0; i3 < sample; i3++) {
        const v3 = cleanRows[i3]?.[h4];
        if (v3 == null) continue;
        maxLen = Math.max(maxLen, String(v3).length);
      }
      return { wch: Math.min(MAX_COL_WCH, Math.max(MIN_COL_WCH, maxLen + 2)), MDW: 6, customWidth: 1 };
    });
    ws["!rows"] = ws["!rows"] || [];
    ws["!rows"][0] = { ...ws["!rows"][0] || {}, hpt: 24 };
    for (let r3 = 1; r3 <= range.e.r; r3++) {
      ws["!rows"][r3] = { ...ws["!rows"][r3] || {}, hpt: BODY_ROW_HPT };
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
      lookups: (db.lookups || []).map((l3) => ({
        rightId: l3.rightId,
        keyPairs: (l3.keyPairs || []).map((p3) => ({ left: p3.left, right: p3.right })),
        cols: [...l3.cols || []],
        required: !!l3.required,
        enabled: l3.enabled !== false,
        duplicatePolicy: l3.duplicatePolicy ? { ...l3.duplicatePolicy } : { mode: "block" }
      })),
      calcStages: (db.calcStages || []).map((c3) => ({
        alias: (c3.alias || "").trim(),
        mode: c3.mode,
        enabled: c3.enabled !== false,
        ...c3.math ? { math: JSON.parse(JSON.stringify(c3.math)) } : {},
        ...c3.compare ? { compare: JSON.parse(JSON.stringify(c3.compare)) } : {},
        ...c3.text ? { text: JSON.parse(JSON.stringify(c3.text)) } : {}
      })),
      selCols: db.selCols ? [...db.selCols] : null,
      colOrder: db.colOrder ? [...db.colOrder] : null,
      filters: db.filters.map((f4) => ({
        col: f4.col || "",
        op: f4.op || "contains",
        vals: Array.isArray(f4.vals) ? [...f4.vals] : [""],
        enabled: f4.enabled !== false
      })),
      sorts: db.sorts.map((s3) => ({ col: s3.col || "", dir: s3.dir === "DESC" ? "DESC" : "ASC", enabled: s3.enabled !== false })),
      groupBy: [...db.groupBy],
      aggregates: db.aggregates.map((a3) => ({ ...a3 })),
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
      } catch (_3) {
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
      for (const c3 of next.calcStages || []) {
        if (c3.alias) colSet.add(c3.alias);
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
      const dropped = baseLoaded ? payload.baseCols.filter((c3) => !db.tables[savedBase].cols.includes(c3)) : [];
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
          keyPairs: Array.isArray(lk.keyPairs) ? lk.keyPairs.map((p3) => ({ left: p3.left || "", right: p3.right || "" })) : [{ left: "", right: "" }],
          cols: Array.isArray(lk.cols) ? [...lk.cols] : [],
          required: !!lk.required,
          enabled: lk.enabled !== false,
          duplicatePolicy: lk.duplicatePolicy && lk.duplicatePolicy.mode ? { ...lk.duplicatePolicy } : { mode: "block" }
        });
        continue;
      }
      const leftAvail = baseLoaded ? projectedColsUpToLookup(next.lookups.length, next) : [];
      const keyPairs = (Array.isArray(lk.keyPairs) ? lk.keyPairs : []).map((p3) => {
        const leftOk = !baseLoaded || leftAvail.includes(p3.left);
        const rightOk = rt.cols.includes(p3.right);
        if (!leftOk && p3.left) brokenRefs.push(`Match column "${p3.left}" not found (left side of lookup from "${rt.name}")`);
        if (!rightOk && p3.right) brokenRefs.push(`Match column "${p3.right}" not found in "${rt.name}"`);
        return { left: p3.left || "", right: p3.right || "" };
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
    for (const c3 of payload.calcStages || []) {
      const alias = (c3.alias || "").trim();
      const enabled = c3.enabled !== false;
      if (!c3.mode || !VALID_CALC_MODES.has(c3.mode)) {
        brokenRefs.push(`Calculated column "${alias}" has an unsupported or missing mode`);
        next.calcStages.push({ ...c3, alias, enabled });
        continue;
      }
      if (!alias) {
        brokenRefs.push("Calculated stage has no alias");
        next.calcStages.push({ ...c3, alias, enabled });
        continue;
      }
      const availNow = nextAvailableCols();
      if (c3.mode === "math") {
        const math = c3.math;
        if (math && Array.isArray(math.steps)) {
          for (const step of math.steps) {
            _checkColRef(step.type === "column" ? step.value : null, baseLoaded, availNow, alias, brokenRefs);
          }
        }
      }
      if (c3.mode === "compare") {
        const compare = c3.compare;
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
      if (c3.mode === "text") {
        const text = c3.text;
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
      if (c3.mode === "date") {
        const date = c3.date;
        if (date && date.operation === "extract" && date.source) {
          _checkColRef(date.source.type === "column" ? date.source.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
      }
      next.calcStages.push({ ...c3, alias, enabled });
    }
    const available = nextAvailableCols();
    if (payload.selCols === null) {
      next.selCols = null;
    } else if (Array.isArray(payload.selCols)) {
      const dropped = baseLoaded ? payload.selCols.filter((c3) => !available.has(c3)) : [];
      if (dropped.length) brokenRefs.push(`Selected columns not available: ${dropped.join(", ")}`);
      next.selCols = new Set(payload.selCols);
    } else {
      next.selCols = null;
    }
    next.colOrder = Array.isArray(payload.colOrder) ? [...payload.colOrder] : null;
    next.filters = [];
    for (const f4 of payload.filters || []) {
      if (f4.col && baseLoaded && !available.has(f4.col)) {
        brokenRefs.push(`Filter on column "${f4.col}" is not available`);
      }
      const vals = Array.isArray(f4.vals) ? [...f4.vals] : f4.vals;
      next.filters.push({ col: f4.col || "", op: f4.op || "contains", vals, enabled: f4.enabled !== false });
    }
    const gbDropped = baseLoaded ? (payload.groupBy || []).filter((c3) => !available.has(c3)) : [];
    if (gbDropped.length) brokenRefs.push(`Group By columns not available: ${gbDropped.join(", ")}`);
    next.groupBy = [...payload.groupBy || []];
    next.aggregates = [];
    for (const a3 of payload.aggregates || []) {
      if (a3.col && a3.col !== "*" && baseLoaded && !available.has(a3.col)) {
        brokenRefs.push(`Aggregate "${a3.alias || a3.fn}" on column "${a3.col}" is not available`);
      }
      next.aggregates.push({ fn: a3.fn || "SUM", col: a3.col || "*", alias: a3.alias || "" });
    }
    next.sorts = [];
    for (const s3 of payload.sorts || []) {
      if (s3.col && baseLoaded && !available.has(s3.col)) {
        brokenRefs.push(`Sort on column "${s3.col}" is not available`);
      }
      next.sorts.push({ col: s3.col || "", dir: s3.dir === "DESC" ? "DESC" : "ASC", enabled: s3.enabled !== false });
    }
    next.aggMode = typeof payload.aggMode === "string" ? payload.aggMode : "none";
    next.colTotals = {};
    for (const [col, fn] of Object.entries(payload.colTotals || {})) {
      if (baseLoaded && !available.has(col)) brokenRefs.push(`Totals column "${col}" not available`);
      next.colTotals[col] = fn;
    }
    const sbDropped = baseLoaded ? (payload.subtotalBy || []).filter((c3) => !available.has(c3)) : [];
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
          aggregates: Array.isArray(rawGroup.aggregates) ? rawGroup.aggregates.map((a3) => ({ fn: a3.fn || "SUM", col: a3.col || "*", alias: a3.alias || "", auto: !!a3.auto })) : []
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
    next.mergedCols = (payload.mergedCols || []).filter((c3) => typeof c3 === "string");
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
    reader.onload = (e3) => {
      let payload = {};
      try {
        payload = JSON.parse(e3.target.result);
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
    const ids = Object.keys(db.tables).sort((a3, b2) => db.tables[a3].name.localeCompare(db.tables[b2].name));
    document.getElementById("tableCount").textContent = String(ids.length);
    const list = document.getElementById("tablesList");
    if (!ids.length) {
      list.innerHTML = '<div class="empty" style="flex:none;padding:16px"><div class="empty-icon">\u{1F4CB}</div><div>No tables loaded</div></div>';
      return;
    }
    list.innerHTML = ids.map((id) => {
      const t3 = db.tables[id];
      return `<div class="tcard" data-tid="${id}" style="border-left:3px solid ${getTableColor(id)}">
      <div class="tcard-rm" data-rm="${id}">\u2715</div>
      <div class="tcard-name" title="${h(t3.name)}">${h(t3.name)}</div>
      <div class="tcard-meta">${t3.rowCount.toLocaleString()} rows &middot; ${t3.cols.length} cols</div>
    </div>`;
    }).join("");
  }
  if (typeof document !== "undefined") {
    document.getElementById("tablesList").addEventListener("click", (e3) => {
      const rm = e3.target.closest("[data-rm]");
      const card = e3.target.closest("[data-tid]");
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
        const r3 = XLSX.utils.decode_range(ws["!ref"]);
        rows = (r3.e.r - r3.s.r).toLocaleString();
        cols = r3.e.c - r3.s.c + 1;
      } catch (_3) {
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
  function closeModal() {
    if (!_modalQueue.length) return;
    _modalQueue.shift();
    document.getElementById("sheetModal").style.display = "none";
    _showNextModal();
  }
  if (typeof window !== "undefined") window.closeModal = closeModal;
  (function() {
    const overlay = document.getElementById("dropOverlay");
    let dragDepth = 0;
    document.addEventListener("dragenter", (e3) => {
      if (!e3.dataTransfer.types.includes("Files")) return;
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
    document.addEventListener("dragover", (e3) => {
      e3.preventDefault();
    });
    document.addEventListener("drop", (e3) => {
      dragDepth = 0;
      overlay.classList.remove("active");
      if (e3.defaultPrevented) return;
      e3.preventDefault();
      [...e3.dataTransfer.files].forEach(loadFile);
    });
  })();
  var fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", (e3) => {
    const target = e3.target;
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
      merges.forEach(({ s: s3, e: e3 }) => {
        const srcCell = (dense[s3.r] || [])[s3.c];
        if (!srcCell) return;
        for (let r3 = s3.r; r3 <= e3.r; r3++) {
          if (!dense[r3]) dense[r3] = [];
          for (let c3 = s3.c; c3 <= e3.c; c3++) {
            if (r3 === s3.r && c3 === s3.c) continue;
            const tgt = dense[r3][c3];
            if (!tgt || tgt.v == null || tgt.t === "z") {
              dense[r3][c3] = { ...srcCell };
            }
          }
        }
      });
      return;
    }
    merges.forEach(({ s: s3, e: e3 }) => {
      const srcAddr = XLSX.utils.encode_cell({ r: s3.r, c: s3.c });
      const srcCell = ws[srcAddr];
      if (!srcCell) return;
      for (let r3 = s3.r; r3 <= e3.r; r3++) {
        for (let c3 = s3.c; c3 <= e3.c; c3++) {
          if (r3 === s3.r && c3 === s3.c) continue;
          const addr = XLSX.utils.encode_cell({ r: r3, c: c3 });
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
    rawData.forEach((row, i3) => {
      row[_ROWNO] = i3 + 1;
    });
    const cols = Object.keys(rawData[0]).filter((c3) => c3 !== _ROWNO);
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
      for (const c3 of cols) {
        const v3 = row[c3];
        if (v3 == null) continue;
        if (TOTAL_RE.test(String(v3))) {
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
        const v3 = row[col];
        if (v3 == null) continue;
        const s3 = String(v3).trim();
        if (!s3 || seen.has(s3)) continue;
        seen.add(s3);
        vals.push(s3);
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
      const previewStr = previews.length === 1 ? `"${previews[0]}"` : previews.map((p3) => `"${p3}"`).join(", ");
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
    document.addEventListener("mouseover", (e3) => {
      if (document.querySelector(".ctx-menu")) return;
      const src = e3.target.closest("[data-tip]");
      if (!src) return;
      tipBox.textContent = src.dataset.tip;
      tipBox.style.display = "block";
      const r3 = src.getBoundingClientRect();
      const bw = 304;
      let left = r3.left + r3.width / 2 - bw / 2;
      left = Math.max(6, Math.min(left, window.innerWidth - bw - 6));
      const top = r3.top - tipBox.offsetHeight - 8;
      tipBox.style.left = left + "px";
      tipBox.style.top = (top < 6 ? r3.bottom + 8 : top) + "px";
    });
    document.addEventListener("mouseout", (e3) => {
      if (e3.target.closest("[data-tip]")) tipBox.style.display = "none";
    });
  }
})();
