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
    db.tables[base].cols.forEach((c) => map.set(c, { tid: base, col: c }));
    for (const lk of lookups || []) {
      if (lk.enabled === false) continue;
      if (!lk.rightId || !db.tables[lk.rightId]) continue;
      const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p) => p.left && p.right) : [];
      if (!pairs.length) continue;
      const rt = db.tables[lk.rightId];
      const prefix = tablePrefix(rt.name);
      rt.cols.forEach((c) => {
        const alias = map.has(c) ? prefix + c : c;
        if (!map.has(alias)) map.set(alias, { tid: lk.rightId, col: c });
      });
    }
    for (const [i, calc] of (calcStages || []).entries()) {
      if (calc?.enabled === false) continue;
      const alias = (calc?.alias || "").trim();
      if (!alias) continue;
      if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) continue;
      let valid = false;
      if (calc.mode === "math") {
        const m = calc.math;
        const steps = m && Array.isArray(m.steps) ? m.steps : [];
        const structValid = !!(m && m.strategy === "stepChain" && steps.length > 0 && !steps[0].op && steps.every((s) => s && ["column", "number", "text"].includes(s.type)) && steps.slice(1).every((s) => s.op && ["+", "-", "*", "/", "%"].includes(s.op)));
        const colsExist = structValid && steps.filter((s) => s.type === "column" && s.value).every((s) => map.has(s.value));
        valid = structValid && colsExist;
      } else if (calc.mode === "compare") {
        const c = calc.compare;
        const conds = Array.isArray(c?.conditions) ? c.conditions : [];
        valid = !!(c && conds.length > 0 && c.trueValue && c.falseValue && conds.every((cond) => cond.col && ["=", "!=", ">", ">=", "<", "<="].includes(cond.op)) && conds.some((cond) => map.has(cond.col)) && ["column", "number", "text"].includes(c.trueValue.type) && ["column", "number", "text"].includes(c.falseValue.type));
      } else if (calc.mode === "text") {
        const t = calc.text;
        if (t && ["combine", "left", "right", "substring"].includes(t.operation)) {
          if (t.operation === "combine") {
            const parts = Array.isArray(t.parts) ? t.parts : [];
            const structValid = parts.length > 0 && parts.every((p) => p && ["column", "number", "text"].includes(p.type));
            const colsExist = structValid && parts.filter((p) => p.type === "column" && p.value).every((p) => map.has(p.value));
            valid = structValid && colsExist;
          } else {
            const src = t.source;
            const structValid = !!(src && ["column", "text"].includes(src.type));
            const colExists = structValid && src.type !== "column" ? true : map.has(src.value);
            valid = structValid && colExists;
          }
        }
      } else if (calc.mode === "date") {
        const d = calc.date;
        if (d && d.operation === "extract") {
          const src = d.source;
          const structValid = !!(src && src.type === "column");
          const colExists = structValid && map.has(src.value);
          valid = structValid && colExists && ["year", "month", "day", "dow", "week", "quarter", "julian"].includes(d.part);
        }
      }
      if (!valid) continue;
      if (map.has(alias)) continue;
      map.set(alias, { kind: "calc", mode: calc.mode, idx: i, calc });
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
    for (let i = 0; i < upTo; i++) {
      const lk = (lookups || [])[i];
      if (!lk || lk.enabled === false || !lk.rightId || !db.tables[lk.rightId]) continue;
      const rt = db.tables[lk.rightId];
      const prefix = tablePrefix(rt.name);
      rt.cols.forEach((c) => {
        const alias = colSet.has(c) ? prefix + c : c;
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
      baseCols.forEach((c) => colMap.set(c, { tid: base, col: c }));
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
      const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p) => p.left && p.right) : [];
      if (!pairs.length) {
        lookupBoundaries.push(new Map(colMap));
        continue;
      }
      const rName = tableName(lk.rightId);
      const prefix = tablePrefix(rName);
      rtCols.forEach((c) => {
        const alias = colMap.has(c) ? prefix + c : c;
        if (!colMap.has(alias)) colMap.set(alias, { tid: lk.rightId, col: c });
      });
      lookupBoundaries.push(new Map(colMap));
    }
    for (const [i, calc] of calcStages.entries()) {
      if (calc?.enabled === false) continue;
      const alias = (calc?.alias || "").trim();
      if (!alias) continue;
      if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) continue;
      let valid = false;
      if (calc.mode === "math") {
        const m = calc.math;
        const steps = m && Array.isArray(m.steps) ? m.steps : [];
        const structValid = !!(m && m.strategy === "stepChain" && steps.length > 0 && !steps[0].op && steps.every((s) => s && ["column", "number", "text"].includes(s.type)) && steps.slice(1).every((s) => s.op && ["+", "-", "*", "/", "%"].includes(s.op)));
        const colsExist = structValid && steps.filter((s) => s.type === "column" && s.value).every((s) => colMap.has(s.value));
        valid = structValid && colsExist;
      } else if (calc.mode === "compare") {
        const c = calc.compare;
        const conds = Array.isArray(c?.conditions) ? c.conditions : [];
        valid = !!(c && conds.length > 0 && c.trueValue && c.falseValue && conds.every((cond) => cond.col && ["=", "!=", ">", ">=", "<", "<="].includes(cond.op)) && conds.some((cond) => colMap.has(cond.col)) && ["column", "number", "text"].includes(c.trueValue.type) && ["column", "number", "text"].includes(c.falseValue.type));
      } else if (calc.mode === "text") {
        const t = calc.text;
        if (t && ["combine", "left", "right", "substring"].includes(t.operation)) {
          if (t.operation === "combine") {
            const parts = Array.isArray(t.parts) ? t.parts : [];
            const structValid = parts.length > 0 && parts.every((p) => p && ["column", "number", "text"].includes(p.type));
            const colsExist = structValid && parts.filter((p) => p.type === "column" && p.value).every((p) => colMap.has(p.value));
            valid = structValid && colsExist;
          } else {
            const src = t.source;
            const structValid = !!(src && ["column", "text"].includes(src.type));
            const colExists = structValid && src.type !== "column" ? true : colMap.has(src.value);
            valid = structValid && colExists;
          }
        }
      } else if (calc.mode === "date") {
        const d = calc.date;
        if (d && d.operation === "extract") {
          const src = d.source;
          const structValid = !!(src && src.type === "column");
          const colExists = structValid && colMap.has(src.value);
          valid = structValid && colExists && ["year", "month", "day", "dow", "week", "quarter", "julian"].includes(d.part);
        }
      }
      if (!valid) continue;
      if (colMap.has(alias)) continue;
      colMap.set(alias, { kind: "calc", mode: calc.mode, idx: i, calc });
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
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === oldAlias) arr[i] = newAlias;
      }
    };
    replaceInArray(db.groupBy);
    replaceInArray(db.subtotalBy);
    replaceInArray(db.mergedCols);
    for (const a of db.aggregates || []) {
      if (a.col === oldAlias) a.col = newAlias;
    }
    for (const f of db.filters || []) {
      if (f.col === oldAlias) f.col = newAlias;
    }
    for (const s of db.sorts || []) {
      if (s.col === oldAlias) s.col = newAlias;
    }
    for (const c of db.calcStages || []) {
      if (c.mode === "math" && c.math && typeof c.math === "object") {
        const math = c.math;
        if (Array.isArray(math.steps)) {
          for (const step of math.steps) {
            if (step.type === "column" && step.value === oldAlias) step.value = newAlias;
          }
        }
      }
      if (c.mode === "compare" && c.compare && typeof c.compare === "object") {
        const compare = c.compare;
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
      if (c.mode === "text" && c.text && typeof c.text === "object") {
        const text = c.text;
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
        for (let i = 0; i < sel.length; i++) {
          if (sel[i] === oldAlias) sel[i] = newAlias;
        }
      };
      replaceInSel(as.none);
      replaceInSel(as.totals);
      replaceInSel(as.subtotals);
      const groupState = as.group;
      if (groupState && Array.isArray(groupState.groupBy)) {
        const gb = groupState.groupBy;
        for (let i = 0; i < gb.length; i++) {
          if (gb[i] === oldAlias) gb[i] = newAlias;
        }
      }
      if (groupState && Array.isArray(groupState.aggregates)) {
        for (const a of groupState.aggregates) {
          if (a && a.col === oldAlias) a.col = newAlias;
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
        for (let i = 0; i < sb.length; i++) {
          if (sb[i] === oldAlias) sb[i] = newAlias;
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
  function h(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function stripExt(fn) {
    return fn.replace(/\.[^.]+$/, "");
  }
  function dl(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  }
  function getToastContainer() {
    let c = document.getElementById("toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "toast-container";
      document.body.appendChild(c);
    }
    return c;
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
    const idx = TABLE_PALETTE.findIndex((c) => !used.has(c));
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
    const m = bg.trim().match(/^#([0-9a-f]{6})$/i);
    if (!m) return "#111";
    const hex = m[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
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
  function renameProjectedColumn(alias) {
    const colMap = buildColSourceMap();
    const src = colMap.get(alias);
    if (!src) return false;
    if (src.kind === "calc") {
      const calc = Array.isArray(db.calcStages) ? db.calcStages[src.idx] : null;
      if (!calc) return false;
      const current2 = (calc.alias || "").trim() || alias;
      const next2 = window.prompt("Rename column:", current2);
      if (next2 === null) return false;
      const renamed = next2.trim();
      if (!renamed || renamed === current2) return false;
      calc.alias = renamed;
      if (typeof _renameProjectedAliasRefs === "function") _renameProjectedAliasRefs(current2, renamed);
      return true;
    }
    const current = db.columnLabels?.[src.tid]?.[src.col] || "";
    const next = window.prompt("Rename column (blank to reset):", current);
    if (next === null) return false;
    setColLabel(src.tid, src.col, next.trim());
    return true;
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
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      result[alias] = n === 0 ? base : base + " " + (n + 1);
    }
    return result;
  }
  function smartDefaultFn(colName) {
    const n = String(colName).toLowerCase();
    if (/\bdate\b|time\b|\bdt\b|shipped|arrival|delivery|due\b|created/.test(n)) return "DATE RANGE";
    if (/amount|total|value|price|cost|\bqty\b|quantity|\bnum\b|number|units|sales|revenue|weight|volume/.test(n)) return "SUM";
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
  function coerceForSQL(v) {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 19);
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return v;
    const s = String(v).trim();
    const n = Number(s);
    if (s !== "" && !isNaN(n)) return n;
    return s || null;
  }
  function createTable(sqlName, cols) {
    const defs = cols.map((c) => quoteId(c)).join(", ");
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
        stmt.run(cols.map((c) => coerceForSQL(row[c])));
      }
      stmt.free();
      _sqlDb().run("COMMIT");
    } catch (e) {
      try {
        _sqlDb().run("ROLLBACK");
      } catch (_) {
      }
      throw e;
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
    } catch (e) {
      throw new Error(e.message + "\n\nQuery:\n" + sql);
    }
  }
  function dropTable(sqlName) {
    try {
      _sqlDb().run(`DROP TABLE IF EXISTS ${quoteId(sqlName)}`);
    } catch (_) {
    }
  }
  function tableRowCount(sqlName) {
    try {
      const r = _sqlDb().exec(`SELECT COUNT(*) FROM ${quoteId(sqlName)}`);
      return r[0]?.values[0]?.[0] ?? 0;
    } catch (_) {
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
    const r = Array.isArray(rows) ? rows : [];
    return {
      columns: Array.isArray(columns) ? columns : [],
      rows: r,
      metadata: Object.assign({
        rowCount: r.length,
        generatedAt: Date.now(),
        aggMode: "none",
        displayCols: null
      }, metadata || {})
    };
  }

  // js/query/sql-where.ts
  function renderWhereClause(colRef, op, val, params, opts) {
    const likeEsc = (v) => v.replace(/%/g, "\\%").replace(/_/g, "\\_");
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
    const s = colMap.get(alias);
    if (!s) return quoteId(alias);
    if (s.kind !== "calc") {
      const tid = s.tid === plan.source.base ? baseTid : s.tid;
      return `${tid === "_base" ? "_base" : quoteId(tid)}.${quoteId(s.col)}`;
    }
    const trail = new Set(_trail);
    trail.add(alias);
    const calc = s.calc || (db.calcStages || [])[s.idx];
    if (!calc) throw new Error(`Cannot render calc "${alias}": calc config not found`);
    if (s.mode === "math") {
      return _renderModeMath(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s.mode === "compare") {
      return _renderModeCompare(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s.mode === "text") {
      return _renderModeText(calc, alias, colMap, plan, baseTid, trail);
    }
    if (s.mode === "date") {
      return _renderModeDate(calc, alias, colMap, plan, baseTid, trail);
    }
    throw new Error(`Unknown calc mode "${s.mode}" for "${alias}"`);
  }
  function _renderModeMath(calc, alias, colMap, plan, baseTid, trail) {
    const math = calc.math;
    const steps = math.steps;
    const toNum = _toNum;
    const renderStepVal = (step, t) => {
      if (step.type === "number") {
        const n = parseFloat(step.value || "");
        return Number.isFinite(n) ? String(n) : "0";
      }
      if (step.type === "column") {
        const expr2 = _renderCalcExpr(step.value || "", colMap, plan, baseTid, t);
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
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      const r = renderStepVal(step, trail);
      switch (step.op) {
        case "+":
          expr = `(${expr} + ${r})`;
          break;
        case "-":
          expr = `(${expr} - ${r})`;
          break;
        case "*":
          expr = `(${expr} * ${r})`;
          break;
        case "/":
          expr = `(CASE WHEN ${r} = 0 THEN NULL ELSE ${expr} / ${r} END)`;
          break;
        case "%":
          expr = `(CASE WHEN ${r} = 0 THEN NULL ELSE ${expr} % ${r} END)`;
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
      const n = parseFloat(cv.replace(/,/g, ""));
      const cNum = toNum(colExpr);
      const cTxt = `CAST(${colExpr} AS TEXT)`;
      if ([">", ">=", "<", "<="].includes(op)) return `${cNum} ${op} ${Number.isFinite(n) ? n : 0}`;
      if (cv !== "" && Number.isFinite(n)) return `${cNum} ${op} ${n}`;
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
      const parts = text.parts.map((p) => _renderTextPart(p, colMap, plan, baseTid, trail));
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
        const branches = names.map((n, j) => `WHEN ${j + 1} THEN '${n}'`).join(" ");
        return `(CASE CAST(strftime('%m', ${src}) AS INTEGER) ${branches} END)`;
      };
      const dowCase = (names) => {
        const branches = names.map((n, j) => `WHEN ${j} THEN '${n}'`).join(" ");
        return `(CASE CAST(strftime('%w', ${src}) AS INTEGER) ${branches} END)`;
      };
      if (part === "quarter") {
        if (output === "short") {
          const branches = [1, 2, 3, 4].map((q) => `WHEN ${q} THEN 'Q${q}'`).join(" ");
          return `(CASE ((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1) ${branches} END)`;
        }
        if (output === "text") {
          const branches = [1, 2, 3, 4].map((q) => `WHEN ${q} THEN 'Quarter ${q}'`).join(" ");
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
      const s = colMap.get(alias);
      if (!s) return quoteId(alias);
      if (s.kind === "calc") return _renderCalcExpr(alias, colMap, plan, baseTid);
      const tid = s.tid === base ? baseTid : s.tid;
      return `${tid === "_base" ? "_base" : quoteId(tid)}.${quoteId(s.col)}`;
    }
    let fromClause;
    if (hasStacks) {
      const baseCols = src.baseCols || (src.tablesById && src.tablesById.has(base) ? src.tablesById.get(base).cols : []);
      const allTids = [base, ...src.stacks];
      const unionParts = allTids.filter((tid) => src.tablesById && src.tablesById.has(tid)).map((tid) => {
        const tCols = src.tablesById.get(tid).cols;
        const selStr = [`"_rowno"`, ...baseCols.map((c) => tCols.includes(c) ? quoteId(c) : `NULL AS ${quoteId(c)}`)].join(", ");
        const excl = src.excludedRows ? src.excludedRows[tid] : null;
        let q = `SELECT ${selStr} FROM ${quoteId(tid)}`;
        if (excl && excl.size) q += ` WHERE "_rowno" NOT IN (${[...excl].join(",")})`;
        return q;
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
      const keyRightCols = new Set(join.keyPairs.map((p) => p.right));
      let rightSource;
      let exclInSubquery = false;
      if (dupPolicy.mode === "combine" && rightCols.length > 0) {
        const combine = Object.assign({ separator: "; ", unique: true, includeBlank: false, sort: false }, dupPolicy.combine || {});
        const aggSeparator = combine.separator === "; " ? '"; "' : `'${combine.separator.replace(/'/g, "''")}'`;
        const valCols = rightCols.filter((c) => !keyRightCols.has(c));
        const keyColQuoted = join.keyPairs.map((p) => quoteId(p.right));
        const keyColSelects = join.keyPairs.map((p) => `${quoteId(p.right)} AS ${quoteId(p.right)}`);
        const whereClause = join.keyPairs.map((p) => `${quoteId(p.right)} IS NOT NULL AND TRIM(${quoteId(p.right)}) != ''`).join(" AND ");
        const exclClause = join.excludedRows && join.excludedRows.size ? ` AND "_rowno" NOT IN (${[...join.excludedRows].join(",")})` : "";
        const fullWhere = whereClause + exclClause;
        if (combine.unique) {
          const valSubExprs = valCols.map((c) => {
            let colExpr = quoteId(c);
            if (!combine.includeBlank) colExpr = `NULLIF(${colExpr}, '')`;
            const orderClause = combine.sort ? ` ORDER BY ${colExpr}` : "";
            const innerSub = `(SELECT DISTINCT ${keyColQuoted.join(", ")}, ${colExpr} AS ${quoteId(c)} FROM ${quoteId(join.rightId)} WHERE ${fullWhere})`;
            const corrCond = keyColQuoted.map((k) => `_inner.${k} = _keys.${k}`).join(" AND ");
            return `(SELECT GROUP_CONCAT(${quoteId(c)}, ${aggSeparator}${orderClause}) FROM ${innerSub} AS _inner WHERE ${corrCond}) AS ${quoteId(c)}`;
          });
          const keyDistinctSub = `(SELECT DISTINCT ${keyColQuoted.join(", ")} FROM ${quoteId(join.rightId)} WHERE ${fullWhere})`;
          const subSql = `SELECT ${keyColSelects.join(", ")}, ${valSubExprs.join(", ")} FROM ${keyDistinctSub} AS _keys`;
          rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
          exclInSubquery = true;
        } else {
          const valExprs = valCols.map((c) => {
            let colExpr = quoteId(c);
            if (!combine.includeBlank) colExpr = `NULLIF(${colExpr}, '')`;
            const orderClause = combine.sort ? ` ORDER BY ${quoteId(c)}` : "";
            return `GROUP_CONCAT(${colExpr}, ${aggSeparator}${orderClause}) AS ${quoteId(c)}`;
          });
          const selectParts = [...keyColSelects, ...valExprs];
          const subSql = `SELECT ${selectParts.join(", ")} FROM ${quoteId(join.rightId)} WHERE ${fullWhere} GROUP BY ${keyColQuoted.join(", ")}`;
          rightSource = `(${subSql}) AS ${quoteId(join.rightId)}`;
          exclInSubquery = true;
        }
      } else {
        rightSource = quoteId(join.rightId);
      }
      const onParts = join.keyPairs.map((p) => `${ref(p.left)} = ${quoteId(join.rightId)}.${quoteId(p.right)}`);
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
    for (const f of plan.filters || []) {
      if (!f.col) continue;
      const fs = colMap.get(f.col);
      const isNumericCalc = fs?.kind === "calc" && fs.mode === "math";
      const filterVals = Array.isArray(f.vals) ? f.vals : [""];
      const orParts = filterVals.map((v) => renderWhereClause(ref(f.col), f.op, String(v ?? ""), params, { numericHint: isNumericCalc })).filter(Boolean);
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
    const sortParts = (plan.sorts || []).map((s) => `${ref(s.col)} ${s.dir === "DESC" ? "DESC" : "ASC"}`);
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
        const r = ref(alias);
        selParts.push(`${r} AS ${quoteId(alias)}`);
        groupRefs.push(r);
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
    const sortParts = (plan.sorts || []).map((s) => `${ref(s.col)} ${s.dir === "DESC" ? "DESC" : "ASC"}`);
    if (sortParts.length) sql += "\nORDER BY " + sortParts.join(", ");
    return { sql, params, cols: colAliases };
  }

  // js/query/sql-totals.ts
  function renderTotalsSql(plan, detailCols) {
    if (!plan.source.base) throw new Error("No base table in plan");
    const { fromClause, joinClauses, whereParts, params, ref } = renderFromJoinWhere(plan);
    const colTotals = plan.colTotals || {};
    const hasAny = detailCols.some((c) => colTotals[c] && colTotals[c] !== "skip");
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
    const orderIdx = new Map(toShow.map((a, i) => [a, i]));
    const seenSub = /* @__PURE__ */ new Set();
    const subtotalBy = (plan.subtotalBy || []).filter((a) => orderIdx.has(a) && !seenSub.has(a) && (seenSub.add(a), true)).sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity));
    const n = subtotalBy.length;
    const sortGroupKeys = subtotalBy.map((_, i) => `_sort_group_${i}`);
    const detailSortType = subtotalOnTop ? 1 : 0;
    const subtotalSortType = subtotalOnTop ? 0 : 1;
    const subAggExpr = (a) => {
      const fn = subtotalFns[a];
      if (!fn || fn === "skip") return `NULL AS ${quoteId(a)}`;
      return `${renderAggregateExpr(fn, ref(a))} AS ${quoteId(a)}`;
    };
    const subtotalBySet = new Set(subtotalBy);
    const fromPart = `FROM ${fromClause}`;
    const joinPart = joinClauses.length ? "\n" + joinClauses.join("\n") : "";
    const wherePart = whereParts.length ? "\nWHERE " + whereParts.join("\n  AND ") : "";
    const nullFilter = n ? subtotalBy.map((a) => `${ref(a)} IS NOT NULL`).join(" OR ") : "";
    const subWherePart = nullFilter ? whereParts.length ? `
WHERE ${whereParts.join("\n  AND ")}
  AND (${nullFilter})` : `
WHERE (${nullFilter})` : wherePart;
    const detailSel = [
      ...toShow.map((a) => `${ref(a)} AS ${quoteId(a)}`),
      '0 AS "_row_type"',
      `${detailSortType} AS "_sort_row_type"`,
      ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`)
    ].join(",\n       ");
    function makeSubSel(depth) {
      const groupCols = subtotalBy.slice(0, depth + 1);
      const groupSet = new Set(groupCols);
      return [
        ...toShow.map((a) => {
          if (groupSet.has(a)) return `${ref(a)} AS ${quoteId(a)}`;
          if (subtotalBySet.has(a)) return `NULL AS ${quoteId(a)}`;
          return subAggExpr(a);
        }),
        '1 AS "_row_type"',
        `${subtotalSortType} AS "_sort_row_type"`,
        ...subtotalBy.map((a, i) => i <= depth ? `${ref(a)} AS ${quoteId(sortGroupKeys[i])}` : `NULL AS ${quoteId(sortGroupKeys[i])}`)
      ].join(",\n       ");
    }
    const grandSel = [
      ...toShow.map((a) => subtotalBySet.has(a) ? `NULL AS ${quoteId(a)}` : subAggExpr(a)),
      '3 AS "_row_type"',
      '3 AS "_sort_row_type"',
      ...subtotalBy.map((_, i) => `NULL AS ${quoteId(sortGroupKeys[i])}`)
    ].join(",\n       ");
    const spacerSel = [
      ...toShow.map((a) => `NULL AS ${quoteId(a)}`),
      '2 AS "_row_type"',
      '2 AS "_sort_row_type"',
      ...subtotalBy.map((a, i) => `${ref(a)} AS ${quoteId(sortGroupKeys[i])}`)
    ].join(",\n       ");
    const orderParts = [
      ...sortGroupKeys.map((k, i) => {
        if (isNested && i > 0 && subtotalOnTop) return `${quoteId(k)} ASC NULLS FIRST`;
        return `${quoteId(k)} ASC NULLS LAST`;
      }),
      '"_sort_row_type" ASC',
      ...(plan.sorts || []).filter((s) => toShow.includes(s.col) && !subtotalBySet.has(s.col)).map((s) => `${quoteId(s.col)} ${s.dir === "DESC" ? "DESC" : "ASC"}`)
    ];
    const branches = [`SELECT ${detailSel}
${fromPart}${joinPart}${wherePart}`];
    if (n > 0) {
      if (isNested && n > 1) {
        for (let d = 0; d < n; d++) {
          const groupClause = subtotalBy.slice(0, d + 1).map((a) => ref(a)).join(", ");
          branches.push(`SELECT ${makeSubSel(d)}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
        }
      } else {
        const groupClause = subtotalBy.map((a) => ref(a)).join(", ");
        branches.push(`SELECT ${makeSubSel(n - 1)}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
      }
      if (includeSpacer) {
        const groupClause = subtotalBy.map((a) => ref(a)).join(", ");
        branches.push(`SELECT ${spacerSel}
${fromPart}${joinPart}${subWherePart}
GROUP BY ${groupClause}`);
      }
    }
    if (includeGrand) {
      const hasGrandValue = toShow.some(
        (a) => !subtotalBySet.has(a) && subtotalFns[a] && subtotalFns[a] !== "skip"
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
    const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p) => p.left && p.right) : [];
    if (!pairs.length) return null;
    try {
      const table = quoteId(lk.rightId);
      const tname = db.tables[lk.rightId].name;
      const rightCols = pairs.map((p) => p.right);
      const whereParts = rightCols.map((c) => `${quoteId(c)} IS NOT NULL AND TRIM(${quoteId(c)}) != ''`);
      const excl = db.excludedRows?.[lk.rightId];
      if (excl && excl.size) {
        whereParts.push(`"_rowno" NOT IN (${[...excl].join(",")})`);
      }
      const whereNonNull = whereParts.join(" AND ");
      const concatExpr = rightCols.length === 1 ? quoteId(rightCols[0]) : rightCols.map((c) => quoteId(c)).join(` || CHAR(0) || `);
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
        const keyLabels = rightCols.map((c) => colUserLabel(lk.rightId, c) || c);
        const keyDesc = keyLabels.length === 1 ? `"${keyLabels[0]}"` : keyLabels.map((c) => `"${c}"`).join(" + ");
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
  function checkCalcError(calc, i) {
    const alias = (calc.alias || "").trim();
    if (!alias) return "Provide a label for this calculated column.";
    if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) {
      return "Pick a valid calculation type.";
    }
    const cols = new Set(projectedCols());
    const ctx = { calc, i, cols, alias };
    const modeError = calcModeValidators[calc.mode](ctx);
    if (modeError) return modeError;
    const map = buildColSourceMap();
    const src = map.get(alias);
    if (src && src.kind !== "calc") return "Label conflicts with an existing column name.";
    const duplicates = (db.calcStages || []).filter((c, idx) => idx !== i && (c.alias || "").trim() === alias);
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
      const e = enabled !== false;
      items[itemId] = { enabled: e, resolved, blocking: e && !resolved, issues: issues || [] };
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
    for (let i = 0; i < (db.stacks || []).length; i++) {
      const id = db.stacks[i];
      const ok = !!(id && db.tables && db.tables[id]);
      const issues = [];
      if (!ok) {
        issues.push(mkIssue(
          `stack_${i}_missing`,
          "stack",
          "pipeline",
          `stack_${i}`,
          `Stacked sheet "${id}" is not loaded`,
          { missingTableId: id, repairHint: "Load the file containing this sheet." }
        ));
      }
      mkItem(`stack_${i}`, true, ok, issues);
    }
    for (let i = 0; i < (db.lookups || []).length; i++) {
      const lk = db.lookups[i];
      const enabled = lk.enabled !== false;
      const issues = [];
      let resolved = true;
      const rt = lk.rightId && db.tables[lk.rightId];
      if (!rt) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i}_missing_table`,
          "lookup",
          `lookup_${i}`,
          `lookup_${i}`,
          `Lookup sheet "${lk.rightId || "(none)"}" is not loaded`,
          { missingTableId: lk.rightId || null, repairHint: "Load the file containing this sheet." }
        ));
      } else if (baseOk) {
        const leftCols = projectedColsUpToLookup(i);
        const leftSet = new Set(leftCols);
        for (let pi = 0; pi < (lk.keyPairs || []).length; pi++) {
          const p = lk.keyPairs[pi];
          if (p.left && !leftSet.has(p.left)) {
            resolved = false;
            issues.push(mkIssue(
              `lookup_${i}_kp${pi}_left`,
              "lookup",
              `lookup_${i}`,
              `lookup_${i}`,
              `Match column "${p.left}" is not available`,
              { missingColumn: p.left }
            ));
          }
          if (p.right && !rt.cols.includes(p.right)) {
            resolved = false;
            issues.push(mkIssue(
              `lookup_${i}_kp${pi}_right`,
              "lookup",
              `lookup_${i}`,
              `lookup_${i}`,
              `Match column "${p.right}" not found in "${rt.name}"`,
              { missingColumn: p.right }
            ));
          }
        }
      }
      const hasCompleteKeyPair = (lk.keyPairs || []).some((p) => p && p.left && p.right);
      if (rt && !hasCompleteKeyPair) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i}_no_key_pairs`,
          "lookup",
          `lookup_${i}`,
          `lookup_${i}`,
          `Lookup "${rt.name}" has no complete match column pair`
        ));
      }
      const dupErr = checkLookupDuplicates(lk);
      if (dupErr) {
        resolved = false;
        issues.push(mkIssue(
          `lookup_${i}_dup_keys`,
          "duplicateKeys",
          "pipeline",
          `lookup_${i}`,
          dupErr,
          { lookupIndex: i }
        ));
      }
      mkItem(`lookup_${i}`, enabled, resolved, issues);
    }
    for (let i = 0; i < (db.calcStages || []).length; i++) {
      const c = db.calcStages[i];
      const enabled = c.enabled !== false;
      const alias = (c.alias || "").trim();
      let resolved = true;
      const issues = [];
      if (!alias) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i}_no_alias`,
          "calculatedColumn",
          `calc_${i}`,
          `calc_${i}`,
          `Calculated column has no alias`
        ));
      } else if (!projected.has(alias)) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i}_unresolved`,
          "calculatedColumn",
          `calc_${i}`,
          `calc_${i}`,
          `Calculated column "${alias}" \u2014 one or more source columns are not available`
        ));
      }
      const calcErr = checkCalcError(c, i);
      if (calcErr) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i}_expr_error`,
          "calcError",
          "pipeline",
          `calc_${i}`,
          calcErr,
          { calcIndex: i }
        ));
      }
      mkItem(`calc_${i}`, enabled, resolved, issues);
    }
    for (let i = 0; i < (db.filters || []).length; i++) {
      const f = db.filters[i];
      const enabled = f.enabled !== false;
      let resolved = true;
      const issues = [];
      if (f.col && !projected.has(f.col)) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i}_missing_col`,
          "filter",
          "filterSort",
          `filter_${i}`,
          `Filter column "${f.col}" is not available`,
          { missingColumn: f.col }
        ));
      }
      if (!Array.isArray(f.vals)) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i}_bad_vals`,
          "filter",
          "filterSort",
          `filter_${i}`,
          `Filter "${f.col || "(no column)"}" has malformed values`
        ));
      } else if (f.vals.some((v) => typeof v !== "string")) {
        resolved = false;
        issues.push(mkIssue(
          `filter_${i}_bad_vals`,
          "filter",
          "filterSort",
          `filter_${i}`,
          `Filter "${f.col || "(no column)"}" has malformed values`
        ));
      }
      mkItem(`filter_${i}`, enabled, resolved, issues);
    }
    for (let i = 0; i < (db.sorts || []).length; i++) {
      const s = db.sorts[i];
      const enabled = s.enabled !== false;
      let resolved = true;
      const issues = [];
      if (s.col && !projected.has(s.col)) {
        resolved = false;
        issues.push(mkIssue(
          `sort_${i}_missing_col`,
          "sort",
          "filterSort",
          `sort_${i}`,
          `Sort column "${s.col}" is not available`,
          { missingColumn: s.col }
        ));
      }
      mkItem(`sort_${i}`, enabled, resolved, issues);
    }
    if (db.aggMode === "group") {
      for (let i = 0; i < (db.groupBy || []).length; i++) {
        const col = db.groupBy[i];
        const resolved = projected.has(col);
        const issues = [];
        if (!resolved) {
          issues.push(mkIssue(
            `groupby_${i}_missing_col`,
            "groupBy",
            "aggregation",
            `groupby_${i}`,
            `Group-by column "${col}" is not available`,
            { missingColumn: col }
          ));
        }
        mkItem(`groupby_${i}`, true, resolved, issues);
      }
      for (let i = 0; i < (db.aggregates || []).length; i++) {
        const agg = db.aggregates[i];
        const issues = [];
        let resolved = true;
        const needsCol = aggregateNeedsColumn(agg.fn);
        if (needsCol && agg.col && agg.col !== "*" && !projected.has(agg.col)) {
          resolved = false;
          issues.push(mkIssue(
            `agg_${i}_missing_col`,
            "aggregate",
            "aggregation",
            `agg_${i}`,
            `Aggregate column "${agg.col}" is not available`,
            { missingColumn: agg.col }
          ));
        }
        if (!isValidAggregateFn(agg.fn)) {
          resolved = false;
          issues.push(mkIssue(
            `agg_${i}_invalid_fn`,
            "aggregate",
            "aggregation",
            `agg_${i}`,
            `Unknown aggregate function "${agg.fn}"`
          ));
        }
        mkItem(`agg_${i}`, true, resolved, issues);
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
      for (let i = 0; i < (db.subtotalBy || []).length; i++) {
        const col = db.subtotalBy[i];
        const resolved = projected.has(col);
        const issues = [];
        if (!resolved) {
          issues.push(mkIssue(
            `subtotalby_${i}_missing_col`,
            "subtotalBy",
            "aggregation",
            `subtotalby_${i}`,
            `Subtotal group column "${col}" is not available`,
            { missingColumn: col }
          ));
        }
        mkItem(`subtotalby_${i}`, true, resolved, issues);
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
    const colOrderItems = (db.colOrder || []).filter((a) => !projected.has(a) && !outputAliases.has(a));
    for (let i = 0; i < colOrderItems.length; i++) {
      const col = colOrderItems[i];
      const issues = [mkIssue(
        `colorder_${i}_stale`,
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
    const reportBlocked = Object.values(items).some((i) => i.blocking);
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
        keyPairs: (lk.keyPairs || []).filter((p) => p.left && p.right),
        required: !!lk.required,
        duplicatePolicy: lk.duplicatePolicy || { mode: "block" },
        excludedRows: (ctx.excludedRows || {})[lk.rightId] || null
      };
    }).filter((j) => j.keyPairs.length > 0);
    const calculatedColumns = [...colMap.values()].filter((e) => e.kind === "calc");
    const filters = (ctx.filters || []).filter((f) => f.enabled !== false && f.col);
    const colOrder = ctx.colOrder;
    const aggMode = ctx.aggMode || "none";
    const aggregates = ctx.aggregates || [];
    const aggAliases = aggMode === "group" ? aggregates.map((a) => a.alias).filter((a) => a) : [];
    const orderedAliases = colOrder ? colOrder.filter((a) => colMap.has(a) || aggAliases.includes(a)) : [...colMap.keys(), ...aggAliases];
    const rawSelCols = ctx.selCols;
    const selCols = rawSelCols instanceof Set ? rawSelCols : null;
    const selectedColumns = selCols ? orderedAliases.filter((a) => selCols.has(a)) : orderedAliases;
    const sorts = (ctx.sorts || []).filter((s) => s.enabled !== false && s.col && colMap.has(s.col));
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
    const paddedRows = newAggCols.length ? detailRows.map((r) => {
      const row = Object.assign({}, r);
      newAggCols.forEach((c) => {
        row[c] = null;
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

  // js/query/layout-selection.ts
  var _seenCols = /* @__PURE__ */ new Set();
  var _previewOpen = /* @__PURE__ */ new Set();
  var _disabledCardCols = /* @__PURE__ */ new Set();
  function _sampleTipFor(tid, col, extra = []) {
    const tbl = db.tables?.[tid];
    const vals = (tbl?.samples?.[col] || []).slice(0, 3).map((v) => String(v));
    const lines = [
      `From sheet: ${tbl?.name || tid}`,
      vals.length ? `Sample values: ${vals.join(" \xB7 ")}` : "Sample values: (none found)",
      ...extra
    ];
    return `data-tip="${lines.map((line) => h(line)).join("&#10;")}"`;
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
    for (let i = 0; i < lookups.length; i++) {
      if (i === excludeLookupIndex) continue;
      const lk = lookups[i];
      if (!lk || lk.rightId !== tid) continue;
      if (Array.isArray(lk.cols) && lk.cols.includes(col)) return true;
    }
    return false;
  }
  function _hideLookupLayoutAliasesSafely(tid, col = null, excludeLookupIndex = -1) {
    const rt = tid ? db.tables?.[tid] : null;
    if (!rt || !Array.isArray(rt.cols)) return;
    const cols = col === null ? rt.cols : [col];
    for (const c of cols) {
      if (_lookupColumnUsedElsewhere(tid, c, excludeLookupIndex)) continue;
      _hideLayoutAliasesForSource(tid, c);
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
    const orderIdx = new Map(order.map((c, i) => [c, i]));
    const seen = /* @__PURE__ */ new Set();
    db.subtotalBy = db.subtotalBy.filter((c) => orderIdx.has(c) && !seen.has(c) && (seen.add(c), true)).sort((a, b) => (orderIdx.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b) ?? Number.MAX_SAFE_INTEGER));
  }
  function _afterCombineChange() {
    invalidateValidation();
    const nowCols = projectedCols();
    const selCols = db.selCols;
    if (selCols) {
      nowCols.forEach((c) => {
        if (!_seenCols.has(c)) {
          selCols.add(c);
          _seenCols.add(c);
        }
      });
      const nowSet = new Set(nowCols);
      for (const c of [...selCols]) {
        if (!nowSet.has(c) && !_disabledCardCols.has(c)) selCols.delete(c);
      }
    }
    const colOrder = db.colOrder;
    if (!colOrder) {
      db.colOrder = [...nowCols];
    } else {
      const nowSet = new Set(nowCols);
      db.colOrder = [
        ...colOrder.filter((c) => nowSet.has(c)),
        ...nowCols.filter((c) => !colOrder.includes(c))
      ];
    }
    _syncSubtotalByToLayout();
    renderQueryBuilder();
  }

  // js/ui/components/calc-builder.ts
  function renderMathBuilder(ctx) {
    const { calc, i, colOptsFor } = ctx;
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
      <select data-ci="${i}" data-cp="mathOp" style="width:140px;flex-shrink:0">
        <option value="ARITH" ${!isRollingAvg && !isPctTotal ? "selected" : ""}>Arithmetic</option>
        <option value="ROLLAVG" ${isRollingAvg ? "selected" : ""}>Rolling Avg</option>
        <option value="PCTTOTAL" ${isPctTotal ? "selected" : ""}>% of Total</option>
      </select>
    </div>
    ${!isRollingAvg && !isPctTotal ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <select data-ci="${i}" data-cp="leftCol" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
      <select data-ci="${i}" data-cp="mathOperator" style="width:70px;flex-shrink:0">
        <option value="+" ${mathOp === "+" ? "selected" : ""}>+</option>
        <option value="-" ${mathOp === "-" ? "selected" : ""}>\u2212</option>
        <option value="*" ${mathOp === "*" ? "selected" : ""}>\xD7</option>
        <option value="/" ${mathOp === "/" ? "selected" : ""}>\xF7</option>
      </select>
      <select data-ci="${i}" data-cp="rightCol" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(rightCol)}
      </select>
    </div>` : ""}
    ${isRollingAvg ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i}" data-cp="leftCol" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
      <span class="pl-key-pair-label" style="margin-left:6px">Window</span>
      <input type="number" min="1" step="1" value="${windowVal}" data-ci="${i}" data-cp="window" style="width:80px;flex-shrink:0">
    </div>` : ""}
    ${isPctTotal ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i}" data-cp="leftCol" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
    </div>` : ""}`;
  }
  function renderTextBuilder(ctx) {
    const { calc, i, colOptsFor } = ctx;
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
        <select data-ci="${i}" data-cp="textSource" style="min-width:190px">
          <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
        </select>
        <span class="pl-key-pair-label" style="margin-left:6px">Count</span>
        <input type="number" min="1" step="1" value="${count}" data-ci="${i}" data-cp="textCount" style="width:80px;flex-shrink:0">
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
        <select data-ci="${i}" data-cp="textSource" style="min-width:190px">
          <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
        </select>
      </div>
      <div class="pl-key-pair" style="margin-top:4px">
        <span class="pl-key-pair-label">Start</span>
        <input type="number" min="1" step="1" value="${start}" data-ci="${i}" data-cp="textStart" style="width:80px;flex-shrink:0">
        <span class="pl-key-pair-label" style="margin-left:6px">Length</span>
        <input type="number" min="1" step="1" value="${length}" data-ci="${i}" data-cp="textLength" style="width:80px;flex-shrink:0">
      </div>`;
    }
    return "";
  }
  function renderCompareBuilder(ctx) {
    const { calc, i, colOptsFor } = ctx;
    const compare = calc.compare;
    const glue = compare?.compareMode || "AND";
    const conditions = compare?.conditions || [];
    const trueVal = compare?.trueValue;
    const falseVal = compare?.falseValue;
    const COND_OPS = ["=", "!=", ">", ">=", "<", "<="];
    const condOptsFor = (selOp) => COND_OPS.map((o) => `<option value="${h(o)}" ${selOp === o ? "selected" : ""}>${h(o)}</option>`).join("");
    const conditionsHtml = conditions.map((cond, j) => `
    <div class="pl-key-pair" style="margin-top:${j === 0 ? "6px" : "4px"}">
      <span class="pl-key-pair-label">${j === 0 ? "Where" : glue}</span>
      <select data-ci="${i}" data-cond="${j}" data-cp="col" style="min-width:140px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(cond.col || "")}
      </select>
      <select data-ci="${i}" data-cond="${j}" data-cp="op" style="width:62px;flex-shrink:0">
        ${condOptsFor(cond.op || "=")}
      </select>
      <input type="text" data-ci="${i}" data-cond="${j}" data-cp="val" placeholder="value" value="${h(cond.val || "")}" style="min-width:100px">
    </div>`).join("");
    return `
    <div class="pl-key-pair" style="margin-top:8px">
      <span class="pl-key-pair-label">Match</span>
      <select data-ci="${i}" data-cp="compareMode" style="width:80px;flex-shrink:0">
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
    const { calc, i, colOptsFor } = ctx;
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
      <select data-ci="${i}" data-cp="dateSource" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
      </select>
    </div>
    <div class="pl-key-pair" style="margin-top:4px">
      <span class="pl-key-pair-label">Extract</span>
      <select data-ci="${i}" data-cp="datePart" style="width:140px;flex-shrink:0">
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
        <label class="tab-opt"><input type="radio" name="dateOutput_${i}" value="number" ${output === "number" ? "checked" : ""} data-ci="${i}" data-cp="dateOutput"><span>Number</span></label>
        <label class="tab-opt${textOnly ? " tab-opt--disabled" : ""}"><input type="radio" name="dateOutput_${i}" value="short" ${output === "short" ? "checked" : ""}${shortDisabled} data-ci="${i}" data-cp="dateOutput"><span>Short</span></label>
        <label class="tab-opt${textOnly ? " tab-opt--disabled" : ""}"><input type="radio" name="dateOutput_${i}" value="text" ${output === "text" && !textOnly ? "checked" : ""}${fullDisabled} data-ci="${i}" data-cp="dateOutput"><span>Full</span></label>
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
    rightId: (lk, inp, i) => {
      const prevRightId = lk.rightId;
      lk.rightId = inp.value;
      lk.keyPairs = [{ left: "", right: "" }];
      const rt = lk.rightId && db.tables[lk.rightId];
      lk.cols = rt ? [...rt.cols] : [];
      if (prevRightId && prevRightId !== lk.rightId) _hideLookupLayoutAliasesSafely(prevRightId, null, i);
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
    enabled: (c, inp) => {
      const wasEnabled = c.enabled !== false;
      const nowEnabled = inp.checked;
      c.enabled = nowEnabled;
      const alias = (c.alias || "").trim();
      if (!alias) return;
      if (wasEnabled && !nowEnabled) {
        if (db.selCols instanceof Set && _isAliasVisibleInLayout(alias, db.aggMode || "none")) {
          c._prevSelState = true;
          _disabledCardCols.add(alias);
        } else {
          c._prevSelState = false;
        }
      } else if (!wasEnabled && nowEnabled) {
        if (c._prevSelState && db.selCols instanceof Set) {
          db.selCols.add(alias);
          _disabledCardCols.delete(alias);
        }
        delete c._prevSelState;
      }
    },
    alias: (c, inp) => {
      const oldAlias = (c.alias || "").trim();
      c.alias = inp.value;
      const newAlias = (c.alias || "").trim();
      _renameProjectedAliasRefs(oldAlias, newAlias);
    },
    mode: (c, inp) => {
      const newMode = inp.value;
      c.mode = newMode;
      delete c.math;
      delete c.compare;
      delete c.text;
      delete c.date;
      const modeDefaults = {
        math: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] }),
        text: () => ({ operation: "combine", parts: [{ type: "column", value: "" }] }),
        compare: () => ({ compareMode: "AND", conditions: [{ col: "", op: "=", val: "" }], trueValue: { type: "number", value: "1" }, falseValue: { type: "number", value: "0" } }),
        date: () => ({ operation: "extract", source: { type: "column", value: "" }, part: "year", output: "number" })
      };
      c[newMode] = modeDefaults[newMode]();
    },
    mathOp: (c, inp) => {
      const mathOp = inp.value;
      c.mathOp = mathOp;
      const mathOpDefaults = {
        ARITH: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] }),
        ROLLAVG: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }] }),
        PCTTOTAL: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }] })
      };
      c.math = mathOpDefaults[mathOp]?.();
    },
    mathOperator: (c, inp) => {
      const math = c.math;
      if (math?.steps) {
        if (math.steps.length < 2) {
          math.steps.push({ type: "column", value: "", op: inp.value });
        } else {
          math.steps[1].op = inp.value;
        }
      }
    },
    leftCol: (c, inp) => {
      const math = c.math;
      if (math?.steps && math.steps.length > 0) {
        math.steps[0] = { type: "column", value: inp.value };
      }
    },
    rightCol: (c, inp) => {
      const math = c.math;
      if (math?.steps) {
        if (math.steps.length < 2) {
          math.steps.push({ type: "column", value: "", op: "+" });
        }
        math.steps[1] = { ...math.steps[1], type: "column", value: inp.value };
      }
    },
    window: (c, inp) => {
      c.window = String(Math.max(1, parseInt(inp.value, 10) || 7));
    },
    textSource: (c, inp) => {
      const text = c.text;
      if (text) {
        text.source = { type: "column", value: inp.value };
      }
    },
    textCount: (c, inp) => {
      const text = c.text;
      if (text) {
        text.count = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    textStart: (c, inp) => {
      const text = c.text;
      if (text) {
        text.start = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    textLength: (c, inp) => {
      const text = c.text;
      if (text) {
        text.length = Math.max(1, parseInt(inp.value, 10) || 1);
      }
    },
    compareMode: (c, inp) => {
      const compare = c.compare;
      if (compare) {
        compare.compareMode = inp.value;
      }
    },
    dateSource: (c, inp) => {
      const date = c.date;
      if (date) {
        date.source = { type: "column", value: inp.value };
      }
    },
    datePart: (c, inp) => {
      const date = c.date;
      if (date) {
        date.part = inp.value;
        if ((inp.value === "year" || inp.value === "week") && date.output !== "number") {
          date.output = "number";
        }
      }
    },
    dateOutput: (c, inp) => {
      const date = c.date;
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
    const sortedIds = ids.sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
    const usedAsLookup = new Set((db.lookups || []).map((l) => l.rightId).filter(Boolean));
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
      ${allCols.map((c) => {
        const isLayoutVisible = _isSourceVisibleInLayout(db.base, c, layoutColMap, layoutMode);
        const color = getTableColor(db.base);
        const chipStyle = `background:${color};border-color:${color};color:${chipFgColor(color)}`;
        return `<span class="pl-col-chip on ${isLayoutVisible ? "" : "pl-col-chip-layout-hidden"}" data-bcc="${h(c)}" style="${chipStyle}" ${_sampleTipFor(db.base, c, ["Click to show/hide this column in the report layout."])}>${h(colUserLabel(db.base, c))}</span>`;
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
      <div class="pl-stage-label">Include rows from <span class="tip" data-tip="Add sheets with the same columns to get more rows. Like stacking spreadsheets on top of each other.">?</span></div>
      ${stackSheetsHtml}
    </div>
  </div>`;
    if (!db.base || !db.tables[db.base]) {
      pl.innerHTML = html;
      return;
    }
    html += _plArrow("base");
    (db.lookups || []).forEach((lk, i) => {
      html += _plLookupStage(lk, i, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode);
      html += _plArrow(`lk${i}`);
    });
    (db.calcStages || []).forEach((calc, i) => {
      html += _plCalcStage(calc, i);
      html += _plArrow(`calc${i}`);
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
        const r = addBtn.getBoundingClientRect();
        addSel.style.top = r.bottom + window.scrollY + 2 + "px";
        addSel.style.left = r.left + "px";
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
      el.addEventListener("change", (e) => {
        const t = e.target;
        const i = +t.dataset.li;
        const lp = t.dataset.lp;
        if (!lp) return;
        const lk = db.lookups[i];
        const inp = t;
        const handler = lookupPropHandlers[lp];
        if (handler) {
          handler(lk, inp, i, el);
          _afterCombineChange();
        }
      });
    });
    qs("[data-ci]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const t = e.target;
        const i = +t.dataset.ci;
        const cp = t.dataset.cp;
        if (!cp) return;
        const c = db.calcStages?.[i];
        if (!c) return;
        const inp = t;
        const handler = calcPropHandlers[cp];
        if (handler) {
          handler(c, inp, i);
          _afterCombineChange();
        }
      });
    });
    qs("[data-cond]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const t = e.target;
        const i = +t.dataset.ci;
        const j = +t.dataset.cond;
        const cp = t.dataset.cp;
        if (!cp) return;
        const c = db.calcStages?.[i];
        if (!c || c.mode !== "compare") return;
        const compare = c.compare;
        if (!compare?.conditions?.[j]) return;
        const inp = t;
        const handler = condPropHandlers[cp];
        if (handler) {
          handler(compare.conditions[j], inp);
          _afterCombineChange();
        }
      });
    });
    qs("[data-lcc]").forEach((el) => {
      el.addEventListener("click", () => {
        const i = +el.dataset.li;
        const col = el.dataset.lcc;
        const lk = db.lookups[i];
        const colMap = buildColSourceMap();
        const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, col, colMap, db.aggMode || "none");
        if (isLayoutVisible) _hideLookupLayoutAliasesSafely(lk.rightId, col, i);
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
        const i = +el.dataset.ci;
        const c = db.calcStages?.[i];
        const alias = (c?.alias || "").trim();
        if (!alias) return;
        if (!db.selCols) db.selCols = new Set(projectedCols());
        const s = db.selCols;
        if (s.has(alias)) s.delete(alias);
        else s.add(alias);
        _afterCombineChange();
      });
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
  function _plLookupStage(lk, i, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode) {
    const rt = lk.rightId && db.tables[lk.rightId];
    const leftCols = projectedColsUpToLookup(i);
    const rightCols = rt ? rt.cols : [];
    if (!Array.isArray(lk.keyPairs) || !lk.keyPairs.length) lk.keyPairs = [{ left: "", right: "" }];
    const pairs = lk.keyPairs;
    const sheetOpts = sortedIds.filter((id) => id !== db.base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id)).map((id) => `<option value="${id}" ${lk.rightId === id ? "selected" : ""}>${h(db.tables[id].name)}</option>`).join("");
    const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : "";
    const lkColMap = buildColSourceMap();
    const leftOptsFor = (val) => leftCols.map((c) => `<option value="${h(c)}" ${val === c ? "selected" : ""}>${h(colDisplayLabel(c, lkColMap))}</option>`).join("");
    const rightOptsFor = (val) => rightCols.map((c) => `<option value="${h(c)}" ${val === c ? "selected" : ""}>${h(`${db.tables[lk.rightId]?.name || lk.rightId} \u2192 ${colUserLabel(lk.rightId, c)}`)}</option>`).join("");
    const keyPairsHTML = pairs.map((pair, pi) => `
    <div class="pl-key-pair">
      <span class="pl-key-pair-label">${pi === 0 ? "Where" : "AND"}</span>
      <select data-li="${i}" data-lkp="${pi}" data-lp="kpLeft">
        <option value="">\u2014 column \u2014</option>${leftOptsFor(pair.left)}
      </select>
      <span class="pl-lookup-eq">=</span>
      <select data-li="${i}" data-lkp="${pi}" data-lp="kpRight">
        <option value="">\u2014 column \u2014</option>${rightOptsFor(pair.right)}
      </select>
      ${pairs.length > 1 ? `<button class="pl-rm-kp" data-rmlkp="1" data-li="${i}" data-lkp="${pi}" title="Remove this condition">\u2715</button>` : ""}
    </div>`).join("");
    const colChips = rt ? rt.cols.map((c) => {
      const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c, layoutColMap, layoutMode);
      return `<span class="pl-col-chip on ${isLayoutVisible ? "" : "pl-col-chip-layout-hidden"} ${lkColorCls}" data-li="${i}" data-lcc="${h(c)}" ${_sampleTipFor(lk.rightId, c, ["Click to show/hide this lookup column in the report layout."])}>${h(colUserLabel(lk.rightId, c))}</span>`;
    }).join("") : "";
    const lkEnabled = lk.enabled !== false;
    const lkV = getValidation().items[`lookup_${i}`];
    const lkVBlocked = lkV && lkV.blocking;
    const lkVUnresolved = lkV && !lkV.resolved;
    const lkVMsg = lkVUnresolved && lkV.issues[0] ? lkV.issues[0].message : null;
    return `<div class="pl-lookup-stage${lkVBlocked ? " pl-lookup-stage--invalid" : lkVUnresolved && !lkEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!lkEnabled ? "pl-stage-disabled" : ""}">
    <div class="pl-stage-label">Look up columns from <span class="tip" data-tip="Pull columns from another sheet by matching a shared value \u2014 like VLOOKUP. Use '+ AND' to match on multiple columns at once.">?</span>
      <label class="pl-enable-toggle" title="${lkEnabled ? "Disable this lookup (won't block report)" : "Enable this lookup"}"><input type="checkbox" data-li="${i}" data-lp="enabled" ${lkEnabled ? "checked" : ""}><span class="pl-enable-label">${lkEnabled ? "Enabled" : "Disabled"}</span></label>
    </div>
    ${lkVMsg ? `<div class="pl-lookup-error">${lkVBlocked ? "\u26D4" : "\u26A0"} ${h(lkVMsg)}</div>` : ""}
    <div class="pl-lookup-header">
      <select data-li="${i}" data-lp="rightId">
        <option value="">\u2014 pick a sheet \u2014</option>
        ${sheetOpts}
      </select>
      <button class="btn btn-danger" style="flex-shrink:0" data-rmlookup="${i}">\u2715</button>
    </div>
    ${rt ? `
    <div class="pl-lookup-keys">
      ${keyPairsHTML}
      <button class="btn btn-ghost pl-add-kp" data-addlkp="${i}">\uFF0B AND \u2026</button>
    </div>
    <div class="pl-lookup-required">
      <span style="flex-shrink:0">If no match:</span>
      <label><input type="radio" name="lkreq_${i}" data-li="${i}" data-lp="required" value="0" ${!lk.required ? "checked" : ""}> Leave blank</label>
      <label><input type="radio" name="lkreq_${i}" data-li="${i}" data-lp="required" value="1" ${lk.required ? "checked" : ""}> Skip row</label>
      <span class="tip" data-tip="Leave blank: keep all rows even if no match.&#10;Skip row: only keep rows that match.">?</span>
    </div>
    <div class="pl-lookup-required">
      <span style="flex-shrink:0">Duplicate keys:</span>
      <label><input type="radio" name="lkdup_${i}" data-li="${i}" data-lp="dupMode" value="block" ${(lk.duplicatePolicy && lk.duplicatePolicy.mode) !== "combine" ? "checked" : ""}> Block (error)</label>
      <label><input type="radio" name="lkdup_${i}" data-li="${i}" data-lp="dupMode" value="combine" ${(lk.duplicatePolicy && lk.duplicatePolicy.mode) === "combine" ? "checked" : ""}> Combine values</label>
      <span class="tip" data-tip="Block: the report cannot run if the same key appears more than once in the lookup sheet.&#10;Combine: concatenate matching values into a single cell, e.g. 'Tag1; Tag2'.">?</span>
    </div>
    <div class="pl-lookup-cols">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Bring in:</span>
      ${colChips}
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-lk-all="${i}">All</button>
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-lk-none="${i}">None</button>
    </div>` : ""}
  </div>`;
  }
  function _plCalcStage(calc, i) {
    const cols = projectedCols();
    const colMap = buildColSourceMap();
    const alias = (calc.alias || "").trim();
    const mode = calc.mode || "math";
    const calcEnabled = calc.enabled !== false;
    const calcV = getValidation().items[`calc_${i}`];
    const calcVBlocked = calcV && calcV.blocking;
    const calcVUnresolved = calcV && !calcV.resolved;
    const calcVMsg = calcVUnresolved && calcV.issues[0] ? calcV.issues[0].message : null;
    const colOptsFor = (sel) => cols.filter((c) => c !== alias).map((c) => `<option value="${h(c)}" ${sel === c ? "selected" : ""}>${h(colDisplayLabel(c, colMap))}</option>`).join("");
    const builderCtx = { calc, i, cols, colOptsFor };
    const builderHtml = calcModeRenderers[mode](builderCtx);
    return `<div class="pl-lookup-stage${calcVBlocked ? " pl-lookup-stage--invalid" : calcVUnresolved && !calcEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!calcEnabled ? "pl-stage-disabled" : ""}">
    <div class="pl-stage-label">Calculated column <span class="tip" data-tip="Create a virtual column from existing columns.&#10;Math: arithmetic, rolling averages, percentages.&#10;Text: string operations.&#10;Compare: conditional logic.&#10;Date: extract date parts.">?</span>
      <label class="pl-enable-toggle" title="${calcEnabled ? "Disable this calculated column" : "Enable this calculated column"}"><input type="checkbox" data-ci="${i}" data-cp="enabled" ${calcEnabled ? "checked" : ""}><span class="pl-enable-label">${calcEnabled ? "Enabled" : "Disabled"}</span></label>
    </div>
    ${calcVMsg ? `<div class="pl-lookup-error">${calcVBlocked ? "\u26D4" : "\u26A0"} ${h(calcVMsg)}</div>` : ""}
    <div class="pl-lookup-header" style="gap:8px;flex-wrap:wrap">
      <input type="text" data-ci="${i}" data-cp="alias" placeholder="Output column name" value="${h(calc.alias || "")}" style="flex:1;min-width:180px">
      <button class="btn btn-danger" style="flex-shrink:0" data-rmcalc="${i}">\u2715</button>
    </div>
    <div class="tab-row" style="margin-top:8px">
      <label class="tab-opt"><input type="radio" name="calcMode_${i}" value="math" ${mode === "math" ? "checked" : ""} data-ci="${i}" data-cp="mode"><span>Math</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i}" value="text" ${mode === "text" ? "checked" : ""} data-ci="${i}" data-cp="mode"><span>Text</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i}" value="compare" ${mode === "compare" ? "checked" : ""} data-ci="${i}" data-cp="mode"><span>Compare</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i}" value="date" ${mode === "date" ? "checked" : ""} data-ci="${i}" data-cp="mode"><span>Date</span></label>
    </div>
    ${builderHtml}
    ${alias ? `<div class="pl-lookup-cols" style="margin-top:8px">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Output:</span>
      <span class="pl-col-chip ${_isAliasVisibleInLayout(alias, db.aggMode || "none") ? "on" : ""}" data-ci="${i}" data-ccc="${h(alias)}">${h(colDisplayLabel(alias, colMap))}</span>
    </div>` : ""}
  </div>`;
  }

  // js/ui/views/output-card.ts
  function renderColChips() {
    if (!db.base) return;
    const cols = projectedCols();
    const colMap = buildColSourceMap();
    const mode = db.aggMode || "none";
    if (!db.selCols) {
      db.selCols = new Set(cols);
      _seenCols.clear();
      cols.forEach((c) => _seenCols.add(c));
    }
    if (!db.colOrder) {
      db.colOrder = [...cols];
    } else {
      const colSet = new Set(cols);
      db.colOrder = [
        ...db.colOrder.filter((c) => colSet.has(c)),
        ...cols.filter((c) => !db.colOrder.includes(c))
      ];
    }
    _syncSubtotalByToLayout();
    const groupSet = new Set(db.groupBy);
    const showBadges = mode === "group" && groupSet.size > 0;
    const colOrder = db.colOrder;
    document.getElementById("colChips").innerHTML = colOrder.map((c) => {
      const src = colMap.get(c);
      const colorCls = src ? getTableColorClass(src.tid) : "";
      const label = h(colDisplayLabel(c, colMap));
      const selSet = db.selCols;
      if (selSet && !selSet.has(c)) return "";
      let tip = "";
      if (src?.kind === "calc") {
        const calc = db.calcStages?.[src.idx];
        const mode2 = calc?.mode || "unknown";
        if (mode2 === "math") {
          const math = calc.math;
          const steps = math?.steps?.length || 0;
          tip = `data-tip="Calculated: Math (${steps} step${steps !== 1 ? "s" : ""})"`;
        } else if (mode2 === "compare") {
          const compare = calc.compare;
          const condCount = compare?.conditions?.length || 0;
          const glue = compare?.compareMode || "AND";
          tip = `data-tip="Calculated: Compare (${condCount} condition${condCount !== 1 ? "s" : ""}, ${glue})"`;
        } else if (mode2 === "text") {
          const text = calc.text;
          tip = `data-tip="Calculated: Text (${text?.operation || "unknown"})"`;
        } else {
          tip = `data-tip="Calculated: ${h(mode2)}"`;
        }
      } else if (src && src.kind !== "calc") {
        const tbl = db.tables[src.tid];
        const tblAny = tbl;
        const samples = tblAny.samples;
        const vals = (samples?.[src.col] || []).slice(0, 3);
        const from = `From: ${h(tbl?.name ?? src.tid)}`;
        tip = vals.length ? `data-tip="${from}&#10;Sample: ${vals.map((v) => h(String(v))).join(" \xB7 ")}"` : `data-tip="${from}&#10;(no sample values)"`;
      }
      if (mode === "group") {
        const isOn = groupSet.has(c);
        const hasAgg = db.aggregates.some((a) => a.col === c);
        const isOrphan = showBadges && !isOn && !hasAgg;
        const badge = isOrphan ? ` <span class="chip-warn-badge" data-autowarn="${h(c)}" title="No calculation for this column \u2014 it will be dropped from results. Click \u26A0 to add one automatically.">\u26A0</span>` : "";
        return `<span class="chip ${isOn ? "on" : ""} ${isOrphan ? "chip-orphan" : ""} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}${badge}</span>`;
      } else if (mode === "subtotals") {
        const isOn = (db.subtotalBy || []).includes(c);
        return `<span class="chip ${isOn ? "on" : ""} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}</span>`;
      } else {
        const isOn = selSet ? selSet.has(c) : false;
        return `<span class="chip ${isOn ? "on" : ""} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}</span>`;
      }
    }).join("");
    const btnRow = document.getElementById("colBtnRow");
    if (btnRow) btnRow.style.display = mode === "group" || mode === "subtotals" ? "none" : "";
    const hint = document.getElementById("colCardHint");
    if (hint) {
      if (mode === "group") {
        hint.textContent = "\u2014 double-click to group by \xB7 drag to reorder";
      } else if (mode === "subtotals") {
        hint.textContent = "\u2014 double-click to group rows \xB7 drag to reorder";
      } else {
        hint.textContent = "\u2014 double-click to show/hide \xB7 drag to reorder";
      }
    }
  }
  if (typeof document !== "undefined") {
    let _chipAtPoint = function(container, x, y) {
      const chips = [...container.querySelectorAll("[data-col]")].filter((c) => c.dataset.col !== _dragCol);
      if (!chips.length) return null;
      const direct = document.elementFromPoint(x, y)?.closest("[data-col]");
      if (direct && direct.dataset.col !== _dragCol) return direct;
      const sameRow = chips.filter((c) => {
        const r = c.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      });
      const pool = sameRow.length ? sameRow : chips;
      let best = null, bestDist = Infinity;
      for (const chip of pool) {
        const r = chip.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const d = sameRow.length ? Math.abs(x - cx) : Math.hypot(x - cx, y - cy);
        if (d < bestDist) {
          bestDist = d;
          best = chip;
        }
      }
      return best;
    };
    _chipAtPoint2 = _chipAtPoint;
    let _dragCol = null;
    document.getElementById("colChips").addEventListener("click", (e) => {
      const badge = e.target.closest("[data-autowarn]");
      if (badge) {
        e.stopPropagation();
        const col = badge.dataset.autowarn;
        if (!db.aggregates.some((a) => a.col === col)) {
          db.aggregates.push({ fn: smartDefaultFn(col), col, alias: "", auto: true });
        }
        renderColChips();
        renderAggregateItems(projectedCols());
      }
    });
    document.getElementById("colChips").addEventListener("dblclick", (e) => {
      const chip = e.target.closest(".chip[data-col]");
      if (!chip) return;
      const col = chip.dataset.col;
      const mode = db.aggMode || "none";
      if (mode === "group") {
        const idx = db.groupBy.indexOf(col);
        if (idx >= 0) {
          db.groupBy.splice(idx, 1);
          if (db.groupBy.length === 0) {
            db.aggregates = db.aggregates.filter((a) => !a.auto);
          } else if (!db.aggregates.some((a) => a.col === col)) {
            db.aggregates.push({ fn: smartDefaultFn(col), col, alias: "", auto: true });
          }
        } else {
          db.groupBy.push(col);
          db.aggregates = db.aggregates.filter((a) => !(a.auto && a.col === col));
          const allCols = projectedCols();
          for (const c of allCols) {
            if (!db.groupBy.includes(c) && !db.aggregates.some((a) => a.col === c)) {
              db.aggregates.push({ fn: smartDefaultFn(c), col: c, alias: "", auto: true });
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
        const s = db.selCols;
        if (s.has(col)) s.delete(col);
        renderQueryBuilder();
      }
    });
    document.getElementById("colChips").addEventListener("contextmenu", (e) => {
      const chip = e.target.closest(".chip[data-col]");
      if (!chip) return;
      e.preventDefault();
      const alias = chip.dataset.col;
      if (!renameProjectedColumn(alias)) return;
      renderQueryBuilder();
      if (db.result) renderResults(db.result);
    });
    document.getElementById("colChips").addEventListener("dragstart", (e) => {
      const chip = e.target.closest("[data-col]");
      if (!chip) return;
      _dragCol = chip.dataset.col;
      chip.classList.add("dragging");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    document.getElementById("colChips").addEventListener("dragend", () => {
      _dragCol = null;
      document.querySelectorAll("#colChips .chip").forEach((c) => c.classList.remove("dragging", "drag-over"));
    });
    document.getElementById("colChips").addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const nearest = _chipAtPoint(e.currentTarget, e.clientX, e.clientY);
      document.querySelectorAll("#colChips .chip").forEach((c) => c.classList.remove("drag-over"));
      if (nearest) nearest.classList.add("drag-over");
    });
    document.getElementById("colChips").addEventListener("drop", (e) => {
      e.preventDefault();
      const nearest = _chipAtPoint(e.currentTarget, e.clientX, e.clientY);
      if (!nearest || !_dragCol || nearest.dataset.col === _dragCol) return;
      if (!db.colOrder) db.colOrder = projectedCols();
      const from = db.colOrder.indexOf(_dragCol);
      const to = db.colOrder.indexOf(nearest.dataset.col);
      if (from < 0 || to < 0) return;
      db.colOrder.splice(from, 1);
      db.colOrder.splice(to, 0, _dragCol);
      _syncSubtotalByToLayout();
      renderColChips();
      if ((db.aggMode || "none") === "subtotals") {
        const projected = projectedCols();
        const ordered = Array.isArray(db.colOrder) ? db.colOrder.filter((c) => projected.includes(c)) : projected;
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
    const wrap = document.getElementById("mergeToggles");
    if (!wrap) return;
    const ulChk = document.getElementById("chkMergeGroupUnderline");
    if (ulChk) ulChk.checked = !!db.mergeGroupUnderline;
    const baseDisplayCols = (cols || []).filter((c) => c !== "_rowno" && c !== "_row_type" && c !== "_isTotalsRow");
    const visibleDisplayCols = db.selCols?.has ? baseDisplayCols.filter((c) => db.selCols.has(c)) : baseDisplayCols;
    const orderedFromLayout = Array.isArray(db.colOrder) ? db.colOrder.filter((c) => visibleDisplayCols.includes(c)) : [];
    const displayCols = [
      ...orderedFromLayout,
      ...visibleDisplayCols.filter((c) => !orderedFromLayout.includes(c))
    ];
    if (!displayCols.length) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No result columns</span>';
      return;
    }
    if (!db.mergedCols) db.mergedCols = [];
    const mergedSet = new Set(db.mergedCols);
    const colMap = buildColSourceMap();
    wrap.innerHTML = "";
    for (const c of displayCols) {
      const label = colDisplayLabel(c, colMap);
      const checked = mergedSet.has(c);
      const lbl = document.createElement("label");
      lbl.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;font-weight:normal;margin-top:4px";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = checked;
      chk.addEventListener("change", () => {
        if (chk.checked) {
          if (!db.mergedCols.includes(c)) db.mergedCols.push(c);
        } else {
          db.mergedCols = db.mergedCols.filter((x) => x !== c);
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
        aggregates: (db.aggregates || []).map((a) => ({ ...a }))
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
      db.aggregates = Array.isArray(state.aggregates) ? state.aggregates.map((a) => ({ ...a })) : [];
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
        document.querySelectorAll('input[name="subtotalStrategy"]').forEach((r) => {
          r.checked = r.value === strat;
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
    const allCols = db.colOrder ? db.colOrder.filter((c) => projected.includes(c)) : projected;
    const selSet = db.selCols;
    const cols = selSet ? allCols.filter((c) => selSet.has(c)) : allCols;
    const mode = db.aggMode || "none";
    const aggSection = document.getElementById("aggSection");
    const totSec = document.getElementById("totalsSection");
    const subSec = document.getElementById("subtotalsSection");
    const hint = document.getElementById("aggHint");
    document.querySelectorAll('input[name="aggMode"]').forEach((r) => {
      r.checked = r.value === mode;
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
    const visibleCols = cols.filter((c) => !selSet2 || selSet2.has(c));
    wrap.innerHTML = visibleCols.map((col) => {
      const cur = db.colTotals[col] || "skip";
      const label = colDisplayLabel(col, colMap);
      return `
    <div class="totals-row">
      <span class="totals-col-name" title="${h(col)}">${h(label)}</span>
      <select class="totals-fn-sel" data-tcol="${h(col)}">
        ${TOTAL_FNS.map(
        (f) => `<option value="${f}" ${cur === f ? "selected" : ""}>${TOTAL_LABELS[f]}</option>`
      ).join("")}
      </select>
    </div>`;
    }).join("");
  }
  if (typeof document !== "undefined") {
    document.getElementById("totalsItems").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-tcol]");
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
    const visibleCols = cols.filter((c) => (!selSet3 || selSet3.has(c)) && !subtotalBy.includes(c));
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
        (f) => `<option value="${f}" ${cur === f ? "selected" : ""}>${SUBTOTAL_LABELS[f]}</option>`
      ).join("")}
      </select>
    </div>`;
    }).join("");
  }
  if (typeof window !== "undefined") window.renderSubtotalsSection = renderSubtotalsSection;
  if (typeof document !== "undefined") {
    document.getElementById("subtotalsItems").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-stcol]");
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
    cols = selSet4 instanceof Set ? cols.filter((c) => selSet4.has(c)) : cols;
    if (!db.aggregates.length) {
      if (db.groupBy.length > 0) {
        wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No calculations \u2014 add one below or click ungrouped chips above</span>';
      } else {
        wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">Click a column above to start grouping</span>';
      }
      return;
    }
    wrap.innerHTML = db.aggregates.map((agg, i) => {
      const needsCol = AGG_NEEDS_COL(agg.fn);
      const colLabel = needsCol ? agg.col ? colDisplayLabel(agg.col, colMap) : "" : "all rows";
      const ph = h(defaultAggAlias(agg.fn, colLabel));
      const autoMark = agg.auto ? `<span class="agg-auto-badge" title="Auto-added \u2014 edit or delete to customize.">auto</span>` : "";
      const colPicker = needsCol ? `<span class="agg-eq">of</span>
         <select data-ai="${i}" data-ap="col">
           ${cols.map(
        (c) => `<option value="${h(c)}" ${agg.col === c ? "selected" : ""}>${h(colDisplayLabel(c, colMap))}</option>`
      ).join("")}
         </select>` : "";
      return `
    <div class="agg-row${agg.auto ? " agg-row-auto" : ""}">
      ${autoMark}
      <input type="text" class="agg-alias" placeholder="${ph}" value="${h(agg.alias)}"
             data-ai="${i}" data-ap="alias">
      <span class="agg-eq">=</span>
      <select data-ai="${i}" data-ap="fn">
        ${AGG_FNS.map((f) => `<option value="${f}" ${agg.fn === f ? "selected" : ""}>${AGG_LABELS[f]}</option>`).join("")}
      </select>
      ${colPicker}
      <button class="btn btn-danger" data-rmagg="${i}">\u2715</button>
    </div>`;
    }).join("");
  }
  if (typeof window !== "undefined") window.renderAggregateItems = renderAggregateItems;
  function addAggregate() {
    const cols = projectedCols();
    const col = cols.find((c) => !db.groupBy.includes(c)) || cols[0] || "";
    db.aggregates.push({ fn: "SUM", col, alias: "", auto: false });
    renderAggregateItems(cols);
  }
  if (typeof window !== "undefined") window.addAggregate = addAggregate;
  function removeAggregate(i) {
    db.aggregates.splice(i, 1);
    renderAggregation();
  }
  function touchAggregate(i) {
    if (db.aggregates[i]) db.aggregates[i].auto = false;
  }
  if (typeof document !== "undefined") {
    document.getElementById("aggItems").addEventListener("change", (e) => {
      const target = e.target;
      const { ai, ap } = target.dataset;
      if (ai === void 0 || !ap) return;
      db.aggregates[+ai][ap] = target.value;
      touchAggregate(+ai);
      if (ap === "fn") renderAggregateItems(projectedCols());
    });
    document.getElementById("aggItems").addEventListener("input", (e) => {
      const target = e.target;
      const { ai, ap } = target.dataset;
      if (ai !== void 0 && ap === "alias") {
        db.aggregates[+ai].alias = target.value;
        touchAggregate(+ai);
      }
    });
    document.getElementById("aggItems").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rmagg]");
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
  function _populateFilterDatalist(i, alias) {
    const dl2 = document.getElementById("fdl_" + i);
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
      dl2.innerHTML = rows.map((r) => {
        const v = String(Object.values(r)[0]).trim();
        return v ? `<option value="${h(v)}">` : "";
      }).join("");
    } catch (_) {
    }
  }
  function addFilter() {
    db.filters.push({ col: "", op: "contains", val: "", vals: [""], enabled: true });
    renderFilters();
  }
  if (typeof window !== "undefined") window.addFilter = addFilter;
  function removeFilter(i) {
    db.filters.splice(i, 1);
    renderFilters();
  }
  function renderFilters() {
    const colMap = buildColSourceMap();
    const cols = projectedCols();
    const wrap = document.getElementById("filterItems");
    if (!db.filters.length) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No filters \u2014 all rows returned</span>';
      return;
    }
    wrap.innerHTML = db.filters.map((f, i) => {
      const noVal = NO_VAL_OPS.has(f.op);
      const vals = Array.isArray(f.vals) ? f.vals : [""];
      const fEnabled = f.enabled !== false;
      const fV = getValidation().items[`filter_${i}`];
      const fBlocked = fV && fV.blocking;
      const fUnresolved = fV && !fV.resolved;
      const fIssueMsg = fUnresolved && fV.issues[0] ? fV.issues[0].message : null;
      const orValInputs = vals.map((v, j) => `
      ${j > 0 ? '<span style="font-size:0.7rem;color:var(--muted);padding:0 1px;flex-shrink:0">OR</span>' : ""}
      <input type="text" list="fdl_${i}" placeholder="value" value="${h(v)}"
             data-fi="${i}" data-vi="${j}" data-fp="val" style="width:120px">
      ${j > 0 ? `<button class="btn btn-danger" style="padding:2px 5px;font-size:0.75rem;flex-shrink:0" data-rmval="${j}" data-fi="${i}" title="Remove this OR value">\u2715</button>` : ""}
    `).join("");
      return `
    <div class="filter-row${fBlocked ? " pl-lookup-stage--invalid" : fUnresolved && !fEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!fEnabled ? "pl-stage-disabled" : ""}">
      ${fIssueMsg ? `<div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">${fBlocked ? "\u26D4" : "\u26A0"} ${h(fIssueMsg)}</div>` : ""}
      <label class="pl-enable-toggle" style="margin-left:auto;order:99" title="${fEnabled ? "Disable filter" : "Enable filter"}"><input type="checkbox" data-fi="${i}" data-fp="enabled" ${fEnabled ? "checked" : ""}><span class="pl-enable-label">${fEnabled ? "" : "Off"}</span></label>
      <select data-fi="${i}" data-fp="col">
        <option value="">Column\u2026</option>
        ${cols.map((c) => `<option value="${h(c)}" ${f.col === c ? "selected" : ""}>${h(colDisplayLabel(c, colMap))}</option>`).join("")}
      </select>
      <select class="fop" data-fi="${i}" data-fp="op">
        ${FILTER_OPS.map((op) => `<option value="${op}" ${f.op === op ? "selected" : ""}>${op}</option>`).join("")}
      </select>
      <span class="filter-or-wrap" style="display:${noVal ? "none" : "flex"};gap:4px;align-items:center;flex-wrap:wrap">
        ${orValInputs}
        <button class="btn btn-ghost" style="padding:2px 7px;font-size:0.76rem;flex-shrink:0" data-addorval="${i}" title="Add OR value">\uFF0B</button>
        <datalist id="fdl_${i}"></datalist>
      </span>
      <button class="btn btn-danger" data-rmf="${i}">\u2715</button>
    </div>`;
    }).join("");
    db.filters.forEach((f, i) => {
      if (f.col) _populateFilterDatalist(i, f.col);
    });
  }
  if (typeof document !== "undefined") {
    document.getElementById("filterItems").addEventListener("change", (e) => {
      const el = e.target;
      const { fi, fp } = el.dataset;
      if (fi === void 0 || !fp) return;
      const f = db.filters[+fi];
      if (!f) return;
      if (fp === "enabled") {
        f.enabled = el.checked;
        invalidateValidation();
        renderFilters();
        return;
      }
      const i = +fi;
      if (fp === "col") {
        f.col = el.value;
        f.vals = [""];
        renderFilters();
        if (f.col) _populateFilterDatalist(i, f.col);
      } else if (fp === "op") {
        f.op = el.value;
        const orWrap = el.closest(".filter-row").querySelector(".filter-or-wrap");
        if (orWrap) orWrap.style.display = NO_VAL_OPS.has(el.value) ? "none" : "flex";
      }
    });
    document.getElementById("filterItems").addEventListener("input", (e) => {
      const el = e.target;
      const { fi, vi, fp } = el.dataset;
      if (fi !== void 0 && fp === "val" && vi !== void 0) {
        const f = db.filters[+fi];
        if (f) {
          if (!Array.isArray(f.vals)) f.vals = [""];
          f.vals[+vi] = el.value;
        }
      }
    });
    document.getElementById("filterItems").addEventListener("click", (e) => {
      const target = e.target;
      const rmf = target.closest("[data-rmf]");
      if (rmf) {
        removeFilter(+rmf.dataset.rmf);
        return;
      }
      const addOrBtn = target.closest("[data-addorval]");
      if (addOrBtn) {
        const i = +addOrBtn.dataset.addorval;
        const f = db.filters[i];
        if (!f) return;
        if (!Array.isArray(f.vals)) f.vals = [""];
        f.vals.push("");
        renderFilters();
        if (f.col) _populateFilterDatalist(i, f.col);
        return;
      }
      const rmVal = target.closest("[data-rmval]");
      if (rmVal) {
        const i = +rmVal.dataset.fi;
        const j = +rmVal.dataset.rmval;
        const f = db.filters[i];
        if (!f) return;
        if (!Array.isArray(f.vals)) f.vals = [""];
        if (f.vals.length <= 1) return;
        f.vals.splice(j, 1);
        renderFilters();
        if (f.col) _populateFilterDatalist(i, f.col);
        return;
      }
    });
  }
  function renderSorts() {
    const cols = projectedCols();
    const colMap = buildColSourceMap();
    const wrap = document.getElementById("sortItems");
    if (!wrap) return;
    if (!db.sorts.length) {
      wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No sort \u2014 rows returned in natural order</span>';
      return;
    }
    wrap.innerHTML = db.sorts.map((s, i) => {
      const sEnabled = s.enabled !== false;
      const sV = getValidation().items[`sort_${i}`];
      const sBlocked = sV && sV.blocking;
      const sUnresolved = sV && !sV.resolved;
      const sIssueMsg = sUnresolved && sV.issues[0] ? sV.issues[0].message : null;
      return `
    <div class="sort-row${sBlocked ? " pl-lookup-stage--invalid" : sUnresolved && !sEnabled ? " pl-lookup-stage--disabled-issue" : ""} ${!sEnabled ? "pl-stage-disabled" : ""}">
      ${sIssueMsg ? `<div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">${sBlocked ? "\u26D4" : "\u26A0"} ${h(sIssueMsg)}</div>` : ""}
      <span class="sort-level">${i + 1}.</span>
      <select data-si="${i}" data-sp="col" style="flex:1;min-width:0">
        <option value="">\u2014 column \u2014</option>
        ${cols.map((c) => `<option value="${h(c)}" ${s.col === c ? "selected" : ""}>${h(colDisplayLabel(c, colMap))}</option>`).join("")}
      </select>
      <select data-si="${i}" data-sp="dir" style="width:95px;flex-shrink:0">
        <option value="ASC"  ${s.dir === "ASC" ? "selected" : ""}>\u2191 A \u2192 Z</option>
        <option value="DESC" ${s.dir === "DESC" ? "selected" : ""}>\u2193 Z \u2192 A</option>
      </select>
      <label class="pl-enable-toggle" title="${sEnabled ? "Disable sort" : "Enable sort"}"><input type="checkbox" data-si="${i}" data-sp="enabled" ${sEnabled ? "checked" : ""}><span class="pl-enable-label">${sEnabled ? "" : "Off"}</span></label>
      <button class="btn btn-danger" data-rmsort="${i}">\u2715</button>
    </div>`;
    }).join("");
  }
  function addSort() {
    db.sorts.push({ col: "", dir: "ASC", enabled: true });
    renderSorts();
  }
  if (typeof window !== "undefined") window.addSort = addSort;
  function removeSort(i) {
    db.sorts.splice(i, 1);
    renderSorts();
  }
  if (typeof document !== "undefined") {
    document.getElementById("sortItems").addEventListener("change", (e) => {
      const el = e.target;
      const { si, sp } = el.dataset;
      if (si !== void 0 && sp === "enabled") {
        db.sorts[+si].enabled = el.checked;
        invalidateValidation();
        renderSorts();
        return;
      }
      if (si !== void 0 && sp) db.sorts[+si][sp] = el.value;
    });
    document.getElementById("sortItems").addEventListener("click", (e) => {
      const target = e.target;
      const btn = target.closest("[data-rmsort]");
      if (btn) removeSort(+btn.dataset.rmsort);
    });
  }

  // js/ui/views/query-builder.ts
  function renderQueryBuilder() {
    invalidateValidation();
    const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
    const qEmpty = document.getElementById("qEmpty");
    const qBuilder = document.getElementById("qBuilder");
    if (qEmpty) qEmpty.style.display = ids.length ? "none" : "";
    if (qBuilder) qBuilder.style.display = ids.length ? "grid" : "none";
    if (!ids.length) return;
    const hasBase = !!db.base && !!db.tables[db.base];
    const hasBaseConfigured = !!db.base;
    ["colCard", "filterSortCard"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = hasBase ? "" : "none";
    });
    const runRowEl = document.getElementById("runRow");
    if (runRowEl) runRowEl.style.display = hasBaseConfigured ? "" : "none";
    if (hasBaseConfigured) {
      const v = getValidation();
      const blocked = v.reportStatus === "blocked";
      const items = Object.values(v.items);
      const issueCount = items.filter((it) => it.blocking).length;
      const pill = document.getElementById("reportStatusPill");
      const runBtn = document.getElementById("runBtn");
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
    } catch (_) {
    }
  }
  function onBaseChange2(val) {
    db.base = val;
    db.baseCols = null;
    db.stacks = [];
    _seenCols.clear();
    _previewOpen.clear();
    renderQueryBuilder();
  }
  function togglePreview(key) {
    if (_previewOpen.has(key)) {
      _previewOpen.delete(key);
    } else {
      _previewOpen.add(key);
    }
    const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
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
          const sel = baseCols.map((c) => tCols.includes(c) ? quoteId(c) : "NULL").join(", ");
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
      <thead><tr>${cols.map((c) => `<th title="${h(c)}">${h(colDisplayLabel(c, pvMap))}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(
        (r) => `<tr>${cols.map((c) => `<td title="${h(String(r[c] ?? ""))}">${h(String(r[c] ?? ""))}</td>`).join("")}</tr>`
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
    db.stacks = db.stacks.filter((s) => s !== id);
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
  function removeCalcStage(i) {
    if (!Array.isArray(db.calcStages)) db.calcStages = [];
    db.calcStages.splice(i, 1);
    _afterCombineChange();
  }
  function removeLookup(i) {
    db.lookups.splice(i, 1);
    _afterCombineChange();
  }
  function selectAllLookupCols(i) {
    const lk = db.lookups[i];
    const rt = lk.rightId && db.tables[lk.rightId];
    if (rt) {
      _showLayoutAliasesForSource(lk.rightId);
      _afterCombineChange();
    }
  }
  function selectNoneLookupCols(i) {
    const lk = db.lookups[i];
    _hideLookupLayoutAliasesSafely(lk.rightId, null, i);
    _afterCombineChange();
  }
  function runQuery() {
    if (!db.base || !db.tables[db.base]) return;
    invalidateValidation();
    const v = getValidation();
    if (v.reportStatus === "blocked") {
      const blockingItems = Object.values(v.items).filter((item) => item.blocking);
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
        const displayRows = resultSet.rows.filter((r) => !r._row_type);
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
    } catch (_) {
    }
    try {
      gridResult.refreshCells?.({ force: true });
    } catch (_) {
    }
    try {
      gridResult.redrawRows?.();
    } catch (_) {
    }
  }
  function refreshPreviewGridLayout() {
    if (!gridPreview) return;
    try {
      gridPreview.resetRowHeights?.();
    } catch (_) {
    }
    try {
      gridPreview.refreshCells?.({ force: true });
    } catch (_) {
    }
    try {
      gridPreview.redrawRows?.();
    } catch (_) {
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
          const v = params.value;
          return v == null ? "" : String(v);
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
    const t = db.tables[id];
    const cap = 1e4;
    const excluded = db.excludedRows[id] || /* @__PURE__ */ new Set();
    let rows;
    try {
      rows = execQuery(`SELECT "_rowno", ${t.cols.map((c) => quoteId(c)).join(", ")} FROM ${quoteId(id)} LIMIT ${cap}`);
    } catch (ex) {
      meta.textContent = "Error loading preview";
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">\u274C</div><div>' + h(ex.message) + "</div></div>";
      return;
    }
    const excCount = excluded.size;
    meta.textContent = t.rowCount.toLocaleString() + " rows \xB7 " + t.cols.length + " cols" + (excCount ? " \xB7 " + excCount + " excluded" : "") + (t.rowCount > cap ? " (preview: first " + cap.toLocaleString() + ")" : "");
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
        const preview = t.cols.filter((c) => c !== "_rowno").map((c) => rowData[c] == null ? "" : String(rowData[c])).filter((v) => v !== "").slice(0, 6).join(" \xB7 ");
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
      columnDefs: [excludeColDef, ...makePreviewCols(id, t.cols)],
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
        floatingFilter: true,
        minWidth: 80,
        cellRenderer: (params) => {
          const v = params.value;
          return v == null ? "" : String(v);
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
    const dataCols = cols.filter((c) => c !== "_rowno" && c !== "_row_type" && c !== "_isTotalsRow");
    return dataCols.map((c) => {
      const src = colMap.get(c);
      const dispLabel = colDisplayLabel(c, colMap);
      const srcPhys = src;
      const renamed = src && src.kind !== "calc" ? db.columnLabels?.[srcPhys.tid]?.[srcPhys.col] : void 0;
      const color = src ? getTableColor(srcPhys?.tid || "") : null;
      const doRename = () => {
        if (!renameProjectedColumn(c)) return;
        renderQueryBuilder();
        if (db.result) renderResults(db.result);
      };
      return {
        field: c,
        headerName: dispLabel,
        tooltipField: c,
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
          const v = params.value;
          return v == null ? "" : String(v);
        }
      };
    });
  }
  function makePreviewCols(tid, physCols) {
    const color = getTableColor(tid);
    return physCols.filter((c) => c !== "_rowno").map((c) => {
      const renamed = db.columnLabels?.[tid]?.[c];
      const label = renamed || c;
      const doRename = () => {
        const newLabel = window.prompt("New label (blank to reset):", renamed || "");
        if (newLabel === null) return;
        setColLabel(tid, c, newLabel.trim());
        renderQueryBuilder();
        if (db.result) renderResults(db.result);
        loadPreview();
      };
      const doClear = renamed ? () => {
        setColLabel(tid, c, c);
        renderQueryBuilder();
        if (db.result) renderResults(db.result);
        loadPreview();
      } : null;
      return {
        field: c,
        headerName: label,
        minWidth: 110,
        filter: "agTextColumnFilter",
        floatingFilter: true,
        sortable: true,
        resizable: true,
        headerComponent: _makeHeaderComponent(label, color, renamed, c, doRename, doClear),
        cellRenderer: (params) => {
          const v = params.value;
          return v == null ? "" : String(v);
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
        txt.addEventListener("click", (e) => params.progressSort(e.shiftKey));
        this._gui.appendChild(txt);
        if (onRename) {
          const more = document.createElement("button");
          more.textContent = "\u22EF";
          more.title = "Rename column";
          more.style.cssText = "background:none;border:none;cursor:pointer;font-size:13px;padding:0 2px;color:#aaa;flex-shrink:0;line-height:1";
          more.addEventListener("click", (e) => {
            e.stopPropagation();
            onRename();
          });
          this._gui.appendChild(more);
        }
        if (onClear) {
          const clr = document.createElement("button");
          clr.textContent = "\xD7";
          clr.title = `Clear rename (original: ${origCol})`;
          clr.style.cssText = "background:none;border:none;cursor:pointer;font-size:10px;padding:0 1px;color:#aaa;flex-shrink:0;line-height:1";
          clr.addEventListener("click", (e) => {
            e.stopPropagation();
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
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
    if (name === "results") {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
    }
    if (name === "preview") {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
    }
  }
  if (typeof window !== "undefined") window.switchTab = switchTab;
  if (typeof document !== "undefined") {
    document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  }

  // js/ui/export.ts
  function exportAs(fmt) {
    if (!db.result || !db.result.rows) return;
    const v = getValidation();
    if (v.reportStatus === "blocked") {
      const blockingItems = Object.values(v.items).filter((item) => item.blocking);
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
      (c) => c !== "_rowno" && c !== "_row_type" && c !== "_isTotalsRow" && c !== "_sort_row_type" && !String(c).startsWith("_sort_group_")
    );
    const exportHeaders = exportCols.map((c) => hdrMap?.[c] || c);
    const mergeHeaderSet = new Set(
      exportCols.filter((c) => (db.mergedCols || []).includes(c)).map((c) => hdrMap?.[c] || c)
    );
    const remap = (row) => {
      const out = {};
      for (const c of exportCols) {
        const header = hdrMap?.[c];
        out[header || c] = row[c];
      }
      return out;
    };
    const dataRows = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : [...rows];
    const rowKinds = dataRows.map((r) => {
      if (r._isTotalsRow) return 3;
      const t = Number(r._row_type);
      return Number.isFinite(t) ? t : 0;
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
    headers.forEach((h2, cIdx) => {
      if (!mergeHeaderSet.has(h2)) return;
      const leftGateHeaders = headers.slice(0, cIdx).filter((lh) => mergeHeaderSet.has(lh));
      const gateByLeft = leftGateHeaders.length > 0;
      let i = 0;
      while (i < cleanRows.length) {
        if ((rowKinds[i] ?? 0) !== 0) {
          i++;
          continue;
        }
        const v = cleanRows[i]?.[h2];
        if (v == null || String(v) === "") {
          i++;
          continue;
        }
        let j = i + 1;
        while (j < cleanRows.length && (rowKinds[j] ?? 0) === 0 && cleanRows[j]?.[h2] === v) {
          if (gateByLeft && leftGateHeaders.some((lh) => cleanRows[j]?.[lh] !== cleanRows[j - 1]?.[lh])) {
            break;
          }
          j++;
        }
        const span = j - i;
        if (span > 1) {
          const s = { r: i + 1, c: cIdx };
          const e = { r: j, c: cIdx };
          merges.push({ s, e });
          for (let rr = s.r + 1; rr <= e.r; rr++) {
            const addr = xlsxUtils.encode_cell({ r: rr, c: cIdx });
            ws[addr] = { t: "z", v: void 0 };
          }
        }
        i = j;
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
    const mergeStartSet = new Set((ws["!merges"] || []).map((m) => `${m.s.r}:${m.s.c}`));
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
      headers.forEach((h2, cIdx) => {
        if (!mergeHeaderSet.has(h2)) return;
        const leftGateHeaders = headers.slice(0, cIdx).filter((lh) => mergeHeaderSet.has(lh));
        let i = 0;
        while (i < cleanRows.length) {
          if ((rowKinds[i] ?? 0) !== 0) {
            i++;
            continue;
          }
          const v = cleanRows[i]?.[h2];
          if (v == null || String(v) === "") {
            i++;
            continue;
          }
          let j = i + 1;
          while (j < cleanRows.length && (rowKinds[j] ?? 0) === 0 && cleanRows[j]?.[h2] === v) {
            if (leftGateHeaders.some((lh) => cleanRows[j]?.[lh] !== cleanRows[j - 1]?.[lh])) break;
            j++;
          }
          const span = j - i;
          if (span > 1) {
            let p = mergeParticipation.get(h2);
            if (!p) {
              p = /* @__PURE__ */ new Set();
              mergeParticipation.set(h2, p);
            }
            for (let r = i; r < j; r++) p.add(r);
            addUnderline(j - 1, cIdx);
          } else {
            const hasLeftMergeContext = leftGateHeaders.some((lh) => mergeParticipation.get(lh)?.has(i));
            if (hasLeftMergeContext) addUnderline(i, cIdx);
          }
          i = j;
        }
      });
    }
    const ensureRowUnderlineSet = /* @__PURE__ */ new Set();
    if (underlineMergedGroups) {
      for (const [r, cStart] of mergeUnderlineStartByRow.entries()) {
        for (let c = cStart; c <= range.e.c; c++) ensureRowUnderlineSet.add(`${r}:${c}`);
      }
    }
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = xlsxUtils.encode_cell({ r: 0, c });
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
    for (let r = 1; r <= range.e.r; r++) {
      const rowType = rowKinds[r - 1] ?? 0;
      const isSubtotal = rowType === 1;
      const isGrand = rowType === 3;
      const isSpacer = rowType === 2;
      const isSummary = isSubtotal || isGrand;
      const summaryBorder = {
        style: isGrand ? "thick" : "medium",
        color: isGrand ? grandBorderColor : borderColor
      };
      const rowObj = cleanRows[r - 1] || {};
      let lastDataColIdx = range.s.c;
      if (isSummary) {
        lastDataColIdx = range.e.c;
      } else {
        for (let i = headers.length - 1; i >= 0; i--) {
          const v = rowObj[headers[i]];
          if (v != null && String(v) !== "") {
            lastDataColIdx = range.s.c + i;
            break;
          }
        }
      }
      const rowUnderlineStart = mergeUnderlineStartByRow.get(r);
      const hasRowUnderline = rowUnderlineStart != null;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = xlsxUtils.encode_cell({ r, c });
        let cell = ws[addr];
        const shouldPersistBlank = isSummary || !isSummary && ensureRowUnderlineSet.has(`${r}:${c}`);
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
        const isMergedAnchor = mergeStartSet.has(`${r}:${c}`);
        const border = {};
        if (isSummary) {
          border.top = summaryBorder;
          border.bottom = summaryBorder;
          if (c === range.s.c) border.left = summaryBorder;
          if (c === lastDataColIdx) border.right = summaryBorder;
        }
        if (!isSummary && hasRowUnderline && c >= rowUnderlineStart) {
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
    ws["!cols"] = headers.map((h2) => {
      let maxLen = String(h2 || "").length;
      const sample = Math.min(cleanRows.length, WIDTH_SAMPLE_ROWS);
      for (let i = 0; i < sample; i++) {
        const v = cleanRows[i]?.[h2];
        if (v == null) continue;
        maxLen = Math.max(maxLen, String(v).length);
      }
      return { wch: Math.min(MAX_COL_WCH, Math.max(MIN_COL_WCH, maxLen + 2)), MDW: 6, customWidth: 1 };
    });
    ws["!rows"] = ws["!rows"] || [];
    ws["!rows"][0] = { ...ws["!rows"][0] || {}, hpt: 24 };
    for (let r = 1; r <= range.e.r; r++) {
      ws["!rows"][r] = { ...ws["!rows"][r] || {}, hpt: BODY_ROW_HPT };
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
      lookups: (db.lookups || []).map((l) => ({
        rightId: l.rightId,
        keyPairs: (l.keyPairs || []).map((p) => ({ left: p.left, right: p.right })),
        cols: [...l.cols || []],
        required: !!l.required,
        enabled: l.enabled !== false,
        duplicatePolicy: l.duplicatePolicy ? { ...l.duplicatePolicy } : { mode: "block" }
      })),
      calcStages: (db.calcStages || []).map((c) => ({
        alias: (c.alias || "").trim(),
        mode: c.mode,
        enabled: c.enabled !== false,
        ...c.math ? { math: JSON.parse(JSON.stringify(c.math)) } : {},
        ...c.compare ? { compare: JSON.parse(JSON.stringify(c.compare)) } : {},
        ...c.text ? { text: JSON.parse(JSON.stringify(c.text)) } : {}
      })),
      selCols: db.selCols ? [...db.selCols] : null,
      colOrder: db.colOrder ? [...db.colOrder] : null,
      filters: db.filters.map((f) => ({
        col: f.col || "",
        op: f.op || "contains",
        vals: Array.isArray(f.vals) ? [...f.vals] : [""],
        enabled: f.enabled !== false
      })),
      sorts: db.sorts.map((s) => ({ col: s.col || "", dir: s.dir === "DESC" ? "DESC" : "ASC", enabled: s.enabled !== false })),
      groupBy: [...db.groupBy],
      aggregates: db.aggregates.map((a) => ({ ...a })),
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
      } catch (_) {
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
      for (const c of next.calcStages || []) {
        if (c.alias) colSet.add(c.alias);
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
      const dropped = baseLoaded ? payload.baseCols.filter((c) => !db.tables[savedBase].cols.includes(c)) : [];
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
          keyPairs: Array.isArray(lk.keyPairs) ? lk.keyPairs.map((p) => ({ left: p.left || "", right: p.right || "" })) : [{ left: "", right: "" }],
          cols: Array.isArray(lk.cols) ? [...lk.cols] : [],
          required: !!lk.required,
          enabled: lk.enabled !== false,
          duplicatePolicy: lk.duplicatePolicy && lk.duplicatePolicy.mode ? { ...lk.duplicatePolicy } : { mode: "block" }
        });
        continue;
      }
      const leftAvail = baseLoaded ? projectedColsUpToLookup(next.lookups.length, next) : [];
      const keyPairs = (Array.isArray(lk.keyPairs) ? lk.keyPairs : []).map((p) => {
        const leftOk = !baseLoaded || leftAvail.includes(p.left);
        const rightOk = rt.cols.includes(p.right);
        if (!leftOk && p.left) brokenRefs.push(`Match column "${p.left}" not found (left side of lookup from "${rt.name}")`);
        if (!rightOk && p.right) brokenRefs.push(`Match column "${p.right}" not found in "${rt.name}"`);
        return { left: p.left || "", right: p.right || "" };
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
    for (const c of payload.calcStages || []) {
      const alias = (c.alias || "").trim();
      const enabled = c.enabled !== false;
      if (!c.mode || !VALID_CALC_MODES.has(c.mode)) {
        brokenRefs.push(`Calculated column "${alias}" has an unsupported or missing mode`);
        next.calcStages.push({ ...c, alias, enabled });
        continue;
      }
      if (!alias) {
        brokenRefs.push("Calculated stage has no alias");
        next.calcStages.push({ ...c, alias, enabled });
        continue;
      }
      const availNow = nextAvailableCols();
      if (c.mode === "math") {
        const math = c.math;
        if (math && Array.isArray(math.steps)) {
          for (const step of math.steps) {
            _checkColRef(step.type === "column" ? step.value : null, baseLoaded, availNow, alias, brokenRefs);
          }
        }
      }
      if (c.mode === "compare") {
        const compare = c.compare;
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
      if (c.mode === "text") {
        const text = c.text;
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
      if (c.mode === "date") {
        const date = c.date;
        if (date && date.operation === "extract" && date.source) {
          _checkColRef(date.source.type === "column" ? date.source.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
      }
      next.calcStages.push({ ...c, alias, enabled });
    }
    const available = nextAvailableCols();
    if (payload.selCols === null) {
      next.selCols = null;
    } else if (Array.isArray(payload.selCols)) {
      const dropped = baseLoaded ? payload.selCols.filter((c) => !available.has(c)) : [];
      if (dropped.length) brokenRefs.push(`Selected columns not available: ${dropped.join(", ")}`);
      next.selCols = new Set(payload.selCols);
    } else {
      next.selCols = null;
    }
    next.colOrder = Array.isArray(payload.colOrder) ? [...payload.colOrder] : null;
    next.filters = [];
    for (const f of payload.filters || []) {
      if (f.col && baseLoaded && !available.has(f.col)) {
        brokenRefs.push(`Filter on column "${f.col}" is not available`);
      }
      const vals = Array.isArray(f.vals) ? [...f.vals] : f.vals;
      next.filters.push({ col: f.col || "", op: f.op || "contains", vals, enabled: f.enabled !== false });
    }
    const gbDropped = baseLoaded ? (payload.groupBy || []).filter((c) => !available.has(c)) : [];
    if (gbDropped.length) brokenRefs.push(`Group By columns not available: ${gbDropped.join(", ")}`);
    next.groupBy = [...payload.groupBy || []];
    next.aggregates = [];
    for (const a of payload.aggregates || []) {
      if (a.col && a.col !== "*" && baseLoaded && !available.has(a.col)) {
        brokenRefs.push(`Aggregate "${a.alias || a.fn}" on column "${a.col}" is not available`);
      }
      next.aggregates.push({ fn: a.fn || "SUM", col: a.col || "*", alias: a.alias || "" });
    }
    next.sorts = [];
    for (const s of payload.sorts || []) {
      if (s.col && baseLoaded && !available.has(s.col)) {
        brokenRefs.push(`Sort on column "${s.col}" is not available`);
      }
      next.sorts.push({ col: s.col || "", dir: s.dir === "DESC" ? "DESC" : "ASC", enabled: s.enabled !== false });
    }
    next.aggMode = typeof payload.aggMode === "string" ? payload.aggMode : "none";
    next.colTotals = {};
    for (const [col, fn] of Object.entries(payload.colTotals || {})) {
      if (baseLoaded && !available.has(col)) brokenRefs.push(`Totals column "${col}" not available`);
      next.colTotals[col] = fn;
    }
    const sbDropped = baseLoaded ? (payload.subtotalBy || []).filter((c) => !available.has(c)) : [];
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
          aggregates: Array.isArray(rawGroup.aggregates) ? rawGroup.aggregates.map((a) => ({ fn: a.fn || "SUM", col: a.col || "*", alias: a.alias || "", auto: !!a.auto })) : []
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
    next.mergedCols = (payload.mergedCols || []).filter((c) => typeof c === "string");
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
    reader.onload = (e) => {
      let payload = {};
      try {
        payload = JSON.parse(e.target.result);
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
    const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
    document.getElementById("tableCount").textContent = String(ids.length);
    const list = document.getElementById("tablesList");
    if (!ids.length) {
      list.innerHTML = '<div class="empty" style="flex:none;padding:16px"><div class="empty-icon">\u{1F4CB}</div><div>No tables loaded</div></div>';
      return;
    }
    list.innerHTML = ids.map((id) => {
      const t = db.tables[id];
      return `<div class="tcard" data-tid="${id}" style="border-left:3px solid ${getTableColor(id)}">
      <div class="tcard-rm" data-rm="${id}">\u2715</div>
      <div class="tcard-name" title="${h(t.name)}">${h(t.name)}</div>
      <div class="tcard-meta">${t.rowCount.toLocaleString()} rows &middot; ${t.cols.length} cols</div>
    </div>`;
    }).join("");
  }
  if (typeof document !== "undefined") {
    document.getElementById("tablesList").addEventListener("click", (e) => {
      const rm = e.target.closest("[data-rm]");
      const card = e.target.closest("[data-tid]");
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
      const n = _sheetsLoaded;
      _sheetsLoaded = 0;
      toast(`Loaded ${n} sheet${n !== 1 ? "s" : ""}`, "ok");
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
        const r = XLSX.utils.decode_range(ws["!ref"]);
        rows = (r.e.r - r.s.r).toLocaleString();
        cols = r.e.c - r.s.c + 1;
      } catch (_) {
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
    document.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
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
    document.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    document.addEventListener("drop", (e) => {
      dragDepth = 0;
      overlay.classList.remove("active");
      if (e.defaultPrevented) return;
      e.preventDefault();
      [...e.dataTransfer.files].forEach(loadFile);
    });
  })();
  var fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", (e) => {
    const target = e.target;
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
          const usable = wb.SheetNames.filter((n) => wb.Sheets[n] && wb.Sheets[n]["!ref"]);
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
      merges.forEach(({ s, e }) => {
        const srcCell = (dense[s.r] || [])[s.c];
        if (!srcCell) return;
        for (let r = s.r; r <= e.r; r++) {
          if (!dense[r]) dense[r] = [];
          for (let c = s.c; c <= e.c; c++) {
            if (r === s.r && c === s.c) continue;
            const tgt = dense[r][c];
            if (!tgt || tgt.v == null || tgt.t === "z") {
              dense[r][c] = { ...srcCell };
            }
          }
        }
      });
      return;
    }
    merges.forEach(({ s, e }) => {
      const srcAddr = XLSX.utils.encode_cell({ r: s.r, c: s.c });
      const srcCell = ws[srcAddr];
      if (!srcCell) return;
      for (let r = s.r; r <= e.r; r++) {
        for (let c = s.c; c <= e.c; c++) {
          if (r === s.r && c === s.c) continue;
          const addr = XLSX.utils.encode_cell({ r, c });
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
    rawData.forEach((row, i) => {
      row[_ROWNO] = i + 1;
    });
    const cols = Object.keys(rawData[0]).filter((c) => c !== _ROWNO);
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
      for (const c of cols) {
        const v = row[c];
        if (v == null) continue;
        if (TOTAL_RE.test(String(v))) {
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
        const v = row[col];
        if (v == null) continue;
        const s = String(v).trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        vals.push(s);
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
      const previewStr = previews.length === 1 ? `"${previews[0]}"` : previews.map((p) => `"${p}"`).join(", ");
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
    document.addEventListener("mouseover", (e) => {
      const src = e.target.closest("[data-tip]");
      if (!src) return;
      tipBox.textContent = src.dataset.tip;
      tipBox.style.display = "block";
      const r = src.getBoundingClientRect();
      const bw = 304;
      let left = r.left + r.width / 2 - bw / 2;
      left = Math.max(6, Math.min(left, window.innerWidth - bw - 6));
      const top = r.top - tipBox.offsetHeight - 8;
      tipBox.style.left = left + "px";
      tipBox.style.top = (top < 6 ? r.bottom + 8 : top) + "px";
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest("[data-tip]")) tipBox.style.display = "none";
    });
  }
})();
