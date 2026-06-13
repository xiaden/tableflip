"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e3) {
      throw err = [e3], e3;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // preact/core/state.ts
  function createAppState(overrides) {
    return Object.assign({
      tables: {},
      excludedRows: {},
      tableColors: {},
      columnLabels: {},
      base: "",
      baseCols: null,
      stacks: [],
      lookups: [],
      calcStages: [],
      selCols: null,
      colOrder: null,
      filters: [],
      groupBy: [],
      aggregates: [],
      aggMode: "none",
      aggModeState: null,
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
      result: null,
      activeTab: "query",
      previewTableId: null,
      detailBands: [],
      detailBandMode: "separate"
    }, overrides || {});
  }
  function createDetailBandSpec(overrides) {
    return Object.assign({
      id: `band_${Date.now()}`,
      rightId: "",
      keyPairs: [{ left: "", right: "" }],
      cols: [],
      enabled: true,
      sorts: [],
      label: ""
    }, overrides || {});
  }
  function buildReportSpecFromState(state) {
    return {
      base: state.base,
      baseCols: state.baseCols,
      stacks: state.stacks,
      lookups: state.lookups,
      calcStages: state.calcStages,
      detailBands: state.detailBands || []
    };
  }
  var init_state = __esm({
    "preact/core/state.ts"() {
      "use strict";
    }
  });

  // preact/core/store.ts
  function deepClone(obj) {
    if (obj instanceof Set) return new Set(obj);
    if (Array.isArray(obj)) return obj.map(deepClone);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k3, v3] of Object.entries(obj)) out[k3] = deepClone(v3);
      return out;
    }
    return obj;
  }
  function createStore(initial) {
    let state = createAppState(initial);
    const listeners = /* @__PURE__ */ new Set();
    return {
      getState() {
        return state;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      update(updater) {
        const prev = state;
        const draft = deepClone(state);
        updater(draft);
        state = draft;
        for (const fn of listeners) {
          fn(state, prev);
        }
      },
      set(key, value) {
        const prev = state;
        state = { ...state, [key]: value };
        for (const fn of listeners) {
          fn(state, prev);
        }
      }
    };
  }
  function initStore(initial) {
    _store = createStore(initial);
    return _store;
  }
  function getStore() {
    if (!_store) {
      _store = createStore();
    }
    return _store;
  }
  var _store;
  var init_store = __esm({
    "preact/core/store.ts"() {
      "use strict";
      init_state();
      _store = null;
    }
  });

  // preact/catalog/column-catalog.ts
  var column_catalog_exports = {};
  __export(column_catalog_exports, {
    buildColSourceMap: () => buildColSourceMap,
    buildColumnCatalog: () => buildColumnCatalog,
    projectedCols: () => projectedCols,
    projectedColsUpToLookup: () => projectedColsUpToLookup,
    tablePrefix: () => tablePrefix
  });
  function tablePrefix(name) {
    return name.split("—").pop().trim().replace(/[^A-Za-z0-9_]/g, "_") + "__";
  }
  function buildColSourceMap() {
    const state = getStore().getState();
    const map = /* @__PURE__ */ new Map();
    for (const tid of Object.keys(state.tables)) {
      const cols = state.tables[tid]?.cols || [];
      for (const col of cols) {
        map.set(col, { tid, col });
      }
    }
    for (let i3 = 0; i3 < (state.calcStages || []).length; i3++) {
      const calc = state.calcStages[i3];
      if (calc?.alias) {
        map.set(calc.alias, { kind: "calc", idx: i3, alias: calc.alias });
      }
    }
    return map;
  }
  function buildColumnCatalog(reportSpec, sourceCatalog) {
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
    const detailBands = reportSpec.detailBands || [];
    for (const band of detailBands) {
      if (band.enabled === false || !band.rightId) continue;
      const rtCols = tableColumns(band.rightId);
      if (!rtCols) continue;
      const prefix = `_${band.id}_`;
      const bandCols = band.cols && band.cols.length > 0 ? band.cols : rtCols;
      for (const c3 of bandCols) {
        const alias = prefix + c3;
        if (!colMap.has(alias)) {
          colMap.set(alias, { kind: "band", tid: band.rightId, col: c3 });
        }
      }
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
  function projectedCols(reportSpec, sourceCatalog) {
    return [...buildColumnCatalog(reportSpec, sourceCatalog).colMap.keys()];
  }
  function projectedColsUpToLookup(upTo, reportSpec, sourceCatalog) {
    if (!(sourceCatalog instanceof Map)) {
      throw new Error("projectedColsUpToLookup: sourceCatalog (Map) is required");
    }
    const base = reportSpec.base;
    const lookups = reportSpec.lookups || [];
    if (!base) return [];
    const baseEntry = sourceCatalog.get(base);
    if (!baseEntry) return [];
    const cols = [...baseEntry.cols];
    const colSet = new Set(cols);
    for (let i3 = 0; i3 < upTo; i3++) {
      const lk = (lookups || [])[i3];
      if (!lk || lk.enabled === false || !lk.rightId) continue;
      const rtEntry = sourceCatalog.get(lk.rightId);
      if (!rtEntry) continue;
      const prefix = tablePrefix(rtEntry.name);
      rtEntry.cols.forEach((c3) => {
        const alias = colSet.has(c3) ? prefix + c3 : c3;
        if (!colSet.has(alias)) {
          cols.push(alias);
          colSet.add(alias);
        }
      });
    }
    return cols;
  }
  var init_column_catalog = __esm({
    "preact/catalog/column-catalog.ts"() {
      "use strict";
      init_store();
    }
  });

  // preact/query/alias-ref-updater.ts
  function _renameProjectedAliasRefs(oldAlias, newAlias) {
    const db = typeof window !== "undefined" ? window.__db : null;
    if (!db) return;
    const filters = db.filters;
    if (filters) {
      for (const f4 of filters) {
        if (f4.col === oldAlias) f4.col = newAlias;
      }
    }
    const sorts = db.sorts;
    if (sorts) {
      for (const s3 of sorts) {
        if (s3.col === oldAlias) s3.col = newAlias;
      }
    }
    const groupBy = db.groupBy;
    if (groupBy) {
      for (let i3 = 0; i3 < groupBy.length; i3++) {
        if (groupBy[i3] === oldAlias) groupBy[i3] = newAlias;
      }
    }
    const aggregates = db.aggregates;
    if (aggregates) {
      for (const a3 of aggregates) {
        if (a3.col === oldAlias) a3.col = newAlias;
      }
    }
    const detailBands = db.detailBands;
    if (detailBands) {
      for (const band of detailBands) {
        const keyPairs = band.keyPairs;
        if (keyPairs) {
          for (const kp of keyPairs) {
            if (kp.left === oldAlias) kp.left = newAlias;
          }
        }
        const cols = band.cols;
        if (cols) {
          for (let i3 = 0; i3 < cols.length; i3++) {
            if (cols[i3] === oldAlias) cols[i3] = newAlias;
          }
        }
      }
    }
  }
  var init_alias_ref_updater = __esm({
    "preact/query/alias-ref-updater.ts"() {
      "use strict";
    }
  });

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
  var h;
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
    var s3, h6, p3, v3, y3, _3, g4, m3 = t3 && t3.__k || w, b2 = l3.length;
    for (f4 = T(u4, l3, m3, f4, b2), s3 = 0; s3 < b2; s3++) null != (p3 = u4.__k[s3]) && (h6 = -1 != p3.__i && m3[p3.__i] || d, p3.__i = s3, _3 = q(n2, p3, h6, i3, r3, o3, e3, f4, c3, a3), v3 = p3.__e, p3.ref && h6.ref != p3.ref && (h6.ref && J(h6.ref, null, p3), a3.push(p3.ref, p3.__c || v3, p3)), null == y3 && null != v3 && (y3 = v3), (g4 = !!(4 & p3.__u)) || h6.__k === p3.__k ? (f4 = j(p3, f4, n2, g4), g4 && h6.__e && (h6.__e = null)) : "function" == typeof p3.type && void 0 !== _3 ? f4 = _3 : v3 && (f4 = v3.nextSibling), p3.__u &= -7);
    return u4.__e = y3, f4;
  }
  function T(n2, l3, u4, t3, i3) {
    var r3, o3, e3, f4, c3, a3 = u4.length, s3 = a3, h6 = 0;
    for (n2.__k = new Array(i3), r3 = 0; r3 < i3; r3++) null != (o3 = l3[r3]) && "boolean" != typeof o3 && "function" != typeof o3 ? ("string" == typeof o3 || "number" == typeof o3 || "bigint" == typeof o3 || o3.constructor == String ? o3 = n2.__k[r3] = x(null, o3, null, null, null) : g(o3) ? o3 = n2.__k[r3] = x(S, { children: o3 }, null, null, null) : void 0 === o3.constructor && o3.__b > 0 ? o3 = n2.__k[r3] = x(o3.type, o3.props, o3.key, o3.ref ? o3.ref : null, o3.__v) : n2.__k[r3] = o3, f4 = r3 + h6, o3.__ = n2, o3.__b = n2.__b + 1, e3 = null, -1 != (c3 = o3.__i = O(o3, u4, f4, s3)) && (s3--, (e3 = u4[c3]) && (e3.__u |= 2)), null == e3 || null == e3.__v ? (-1 == c3 && (i3 > a3 ? h6-- : i3 < a3 && h6++), "function" != typeof o3.type && (o3.__u |= 4)) : c3 != f4 && (c3 == f4 - 1 ? h6-- : c3 == f4 + 1 ? h6++ : (c3 > f4 ? h6-- : h6++, o3.__u |= 4))) : n2.__k[r3] = null;
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
    else if ("o" == l3[0] && "n" == l3[1]) r3 = l3 != (l3 = l3.replace(s, "$1")), o3 = l3.toLowerCase(), l3 = o3 in n2 || "onFocusOut" == l3 || "onFocusIn" == l3 ? o3.slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + r3] = u4, u4 ? t3 ? u4[a] = t3[a] : (u4[a] = h, n2.addEventListener(l3, r3 ? v : p, r3)) : n2.removeEventListener(l3, r3 ? v : p, r3);
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
        if (null == u4[c]) u4[c] = h++;
        else if (u4[c] < t3[a]) return;
        return t3(l.event ? l.event(u4) : u4);
      }
    };
  }
  function q(n2, u4, t3, i3, r3, o3, e3, f4, c3, a3) {
    var s3, h6, p3, v3, y3, d3, _3, k3, x3, M3, $3, I2, P4, A4, H3, T4 = u4.type;
    if (void 0 !== u4.constructor) return null;
    128 & t3.__u && (c3 = !!(32 & t3.__u), o3 = [f4 = u4.__e = t3.__e]), (s3 = l.__b) && s3(u4);
    n: if ("function" == typeof T4) try {
      if (k3 = u4.props, x3 = T4.prototype && T4.prototype.render, M3 = (s3 = T4.contextType) && i3[s3.__c], $3 = s3 ? M3 ? M3.props.value : s3.__ : i3, t3.__c ? _3 = (h6 = u4.__c = t3.__c).__ = h6.__E : (x3 ? u4.__c = h6 = new T4(k3, $3) : (u4.__c = h6 = new C(k3, $3), h6.constructor = T4, h6.render = Q), M3 && M3.sub(h6), h6.state || (h6.state = {}), h6.__n = i3, p3 = h6.__d = true, h6.__h = [], h6._sb = []), x3 && null == h6.__s && (h6.__s = h6.state), x3 && null != T4.getDerivedStateFromProps && (h6.__s == h6.state && (h6.__s = m({}, h6.__s)), m(h6.__s, T4.getDerivedStateFromProps(k3, h6.__s))), v3 = h6.props, y3 = h6.state, h6.__v = u4, p3) x3 && null == T4.getDerivedStateFromProps && null != h6.componentWillMount && h6.componentWillMount(), x3 && null != h6.componentDidMount && h6.__h.push(h6.componentDidMount);
      else {
        if (x3 && null == T4.getDerivedStateFromProps && k3 !== v3 && null != h6.componentWillReceiveProps && h6.componentWillReceiveProps(k3, $3), u4.__v == t3.__v || !h6.__e && null != h6.shouldComponentUpdate && false === h6.shouldComponentUpdate(k3, h6.__s, $3)) {
          u4.__v != t3.__v && (h6.props = k3, h6.state = h6.__s, h6.__d = false), u4.__e = t3.__e, u4.__k = t3.__k, u4.__k.some(function(n3) {
            n3 && (n3.__ = u4);
          }), w.push.apply(h6.__h, h6._sb), h6._sb = [], h6.__h.length && e3.push(h6);
          break n;
        }
        null != h6.componentWillUpdate && h6.componentWillUpdate(k3, h6.__s, $3), x3 && null != h6.componentDidUpdate && h6.__h.push(function() {
          h6.componentDidUpdate(v3, y3, d3);
        });
      }
      if (h6.context = $3, h6.props = k3, h6.__P = n2, h6.__e = false, I2 = l.__r, P4 = 0, x3) h6.state = h6.__s, h6.__d = false, I2 && I2(u4), s3 = h6.render(h6.props, h6.state, h6.context), w.push.apply(h6.__h, h6._sb), h6._sb = [];
      else do {
        h6.__d = false, I2 && I2(u4), s3 = h6.render(h6.props, h6.state, h6.context), h6.state = h6.__s;
      } while (h6.__d && ++P4 < 25);
      h6.state = h6.__s, null != h6.getChildContext && (i3 = m(m({}, i3), h6.getChildContext())), x3 && !p3 && null != h6.getSnapshotBeforeUpdate && (d3 = h6.getSnapshotBeforeUpdate(v3, y3)), A4 = null != s3 && s3.type === S && null == s3.key ? E(s3.props.children) : s3, f4 = L(n2, g(A4) ? A4 : [A4], u4, t3, i3, r3, o3, e3, f4, c3, a3), h6.base = u4.__e, u4.__u &= -161, h6.__h.length && e3.push(h6), _3 && (h6.__E = h6.__ = null);
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
    var s3, h6, p3, v3, y3, w3, _3, m3 = i3.props || d, k3 = t3.props, x3 = t3.type;
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
      for (s3 in k3) y3 = k3[s3], "children" == s3 ? v3 = y3 : "dangerouslySetInnerHTML" == s3 ? h6 = y3 : "value" == s3 ? w3 = y3 : "checked" == s3 ? _3 = y3 : c3 && "function" != typeof y3 || m3[s3] === y3 || N(u4, s3, y3, m3[s3], o3);
      if (h6) c3 || p3 && (h6.__html == p3.__html || h6.__html == u4.innerHTML) || (u4.innerHTML = h6.__html), t3.__k = [];
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
  }, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, a = "__a" + f, s = /(PointerCapture)$|Capture$/i, h = 0, p = V(false), v = V(true), y = 0;

  // preact/core/sqldb.ts
  var _SQLJS_VERSION = "1.12.0";
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
      } catch {
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
    } catch {
    }
  }
  function tableRowCount(sqlName) {
    try {
      const r3 = _sqlDb().exec(`SELECT COUNT(*) FROM ${quoteId(sqlName)}`);
      return r3[0]?.values[0]?.[0] ?? 0;
    } catch {
      return 0;
    }
  }

  // preact/app.ts
  init_store();

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
    return o2 = 1, h2(D2, n2);
  }
  function h2(n2, u4, i3) {
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

  // preact/ui/app.tsx
  init_store();

  // preact/core/utils.ts
  init_store();
  async function loadColSourceMap() {
    const mod = await Promise.resolve().then(() => (init_column_catalog(), column_catalog_exports));
    return mod.buildColSourceMap;
  }
  function h3(s3) {
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
    btn.textContent = "✕";
    btn.className = "toast-close";
    btn.onclick = () => el.remove();
    el.appendChild(btn);
    getToastContainer().appendChild(el);
  }
  function toggleSidebar() {
    const sb = document.getElementById("sidebar");
    const btn = document.getElementById("sidebarToggle");
    if (!sb || !btn) return;
    const collapsed = sb.classList.toggle("collapsed");
    btn.classList.toggle("collapsed", collapsed);
    btn.textContent = collapsed ? "❯" : "❮";
  }
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
    const state = getStore().getState();
    if (state.tableColors[tid]) return state.tableColors[tid];
    const used = new Set(Object.values(state.tableColors));
    const idx = TABLE_PALETTE.findIndex((c3) => !used.has(c3));
    const col = idx >= 0 ? TABLE_PALETTE[idx] : TABLE_PALETTE[Object.keys(state.tableColors).length % TABLE_PALETTE.length];
    getStore().update((draft) => {
      draft.tableColors[tid] = col;
    });
    return col;
  }
  function getTableColorClass(tid) {
    const state = getStore().getState();
    const color = state.tableColors[tid] || getTableColor(tid);
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
    const state = getStore().getState();
    const name = state.tables[tid]?.name || tid;
    return name.length > 14 ? name.slice(0, 12) + "…" : name;
  }
  function colUserLabel(tid, physCol) {
    const state = getStore().getState();
    return state.columnLabels?.[tid]?.[physCol] ?? physCol;
  }
  function setColLabel(tid, physCol, label) {
    const state = getStore().getState();
    const columnLabels = { ...state.columnLabels };
    if (!columnLabels[tid]) columnLabels[tid] = {};
    if (!label || label === physCol) {
      delete columnLabels[tid][physCol];
      if (!Object.keys(columnLabels[tid]).length) delete columnLabels[tid];
    } else {
      columnLabels[tid][physCol] = label;
    }
    getStore().update((draft) => {
      draft.columnLabels = columnLabels;
    });
  }
  async function colExportLabel(alias, map) {
    const src = (map || (await loadColSourceMap())()).get(alias);
    if (!src) return alias;
    if (src.kind === "calc") {
      const calc = getStore().getState().calcStages?.[src.idx];
      return (calc?.alias || "").trim() || alias;
    }
    return colUserLabel(src.tid, src.col);
  }
  async function buildExportHeaderMap(cols, map) {
    map = map || (await loadColSourceMap())();
    const seen = /* @__PURE__ */ new Map();
    const result = {};
    for (const alias of cols) {
      const base = await colExportLabel(alias, map);
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

  // preact/ui/sidebar.tsx
  init_store();

  // preact/ui/file-loader.tsx
  init_store();

  // preact/core/state-schema.ts
  var STATE_VERSION = 2;
  var RECOGNIZABLE_KEYS = [
    "base",
    "baseCols",
    "stacks",
    "lookups",
    "calcStages",
    "filters",
    "sorts",
    "colOrder",
    "selCols",
    "aggMode",
    "aggregates",
    "colTotals",
    "subtotalBy",
    "subtotalFns",
    "subtotalStrategy",
    "detailBands",
    "detailBandMode"
  ];
  function isRecognizableConfig(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    let matches = 0;
    for (const key of RECOGNIZABLE_KEYS) {
      if (key in payload) matches++;
    }
    return matches >= 2;
  }

  // preact/catalog/source-catalog.ts
  function buildSourceCatalog(tables) {
    const catalog = /* @__PURE__ */ new Map();
    for (const [tid, table] of Object.entries(tables)) {
      catalog.set(tid, {
        id: tid,
        name: table.name || tid,
        cols: table.cols || [],
        kind: "imported",
        source: table
      });
    }
    return catalog;
  }

  // preact/core/state-hydrator.ts
  init_column_catalog();
  function hydrateState(payload, loadedTables) {
    const next = {};
    const brokenRefs = [];
    const sourceCatalog = buildSourceCatalog(loadedTables);
    const nextAvailableCols = () => {
      const cols = projectedColsUpToLookup((next.lookups || []).length, next, sourceCatalog);
      const colSet = new Set(cols);
      for (const c3 of next.calcStages || []) {
        if (c3.alias) colSet.add(c3.alias);
      }
      return colSet;
    };
    const savedBase = payload.base || "";
    next.base = savedBase;
    const baseLoaded = !!(savedBase && loadedTables[savedBase]);
    if (!baseLoaded) {
      brokenRefs.push(`Primary sheet "${savedBase || "(none)"}" is not loaded`);
    }
    if (Array.isArray(payload.baseCols)) {
      const dropped = baseLoaded ? payload.baseCols.filter((c3) => !loadedTables[savedBase].cols.includes(c3)) : [];
      if (dropped.length) brokenRefs.push(`Base columns not available: ${dropped.join(", ")}`);
      next.baseCols = [...payload.baseCols];
    } else {
      next.baseCols = null;
    }
    next.stacks = [];
    for (const id of payload.stacks || []) {
      if (!loadedTables[id]) {
        brokenRefs.push(`Stacked sheet "${id}" is not loaded`);
        next.stacks.push(id);
        continue;
      }
      if (!next.stacks.includes(id)) next.stacks.push(id);
    }
    next.lookups = [];
    for (const lk of payload.lookups || []) {
      const rt = lk.rightId && loadedTables[lk.rightId];
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
      const leftAvail = baseLoaded ? projectedColsUpToLookup(next.lookups.length, next, sourceCatalog) : [];
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
    next.detailBands = [];
    if (Array.isArray(payload.detailBands)) {
      for (const band of payload.detailBands) {
        const rt = band.rightId && loadedTables[band.rightId];
        if (!rt) {
          brokenRefs.push(`Related details sheet "${band.rightId || "(none)"}" is not loaded`);
          next.detailBands.push({
            id: band.id || `band_${next.detailBands.length}`,
            rightId: band.rightId || "",
            keyPairs: Array.isArray(band.keyPairs) ? band.keyPairs.map((p3) => ({ left: p3.left || "", right: p3.right || "" })) : [{ left: "", right: "" }],
            cols: Array.isArray(band.cols) ? [...band.cols] : [],
            enabled: band.enabled !== false,
            sorts: Array.isArray(band.sorts) ? band.sorts.map((s3) => ({ col: s3.col || "", dir: s3.dir === "DESC" ? "DESC" : "ASC", enabled: s3.enabled !== false })) : [],
            label: typeof band.label === "string" ? band.label : ""
          });
          continue;
        }
        const keyPairs = (Array.isArray(band.keyPairs) ? band.keyPairs : []).map((p3) => {
          const leftOk = !baseLoaded || projectedColsUpToLookup((next.lookups || []).length, next, sourceCatalog).includes(p3.left);
          const rightOk = rt.cols.includes(p3.right);
          if (!leftOk && p3.left) brokenRefs.push(`Match column "${p3.left}" not found (left side of detail band from "${rt.name}")`);
          if (!rightOk && p3.right) brokenRefs.push(`Match column "${p3.right}" not found in "${rt.name}"`);
          return { left: p3.left || "", right: p3.right || "" };
        });
        const cols = Array.isArray(band.cols) ? band.cols.filter((c3) => rt.cols.includes(c3)) : [...rt.cols];
        const droppedCols = Array.isArray(band.cols) ? band.cols.filter((c3) => !rt.cols.includes(c3)) : [];
        if (droppedCols.length) brokenRefs.push(`Detail band "${band.label || band.id}" columns not available: ${droppedCols.join(", ")}`);
        const sorts = Array.isArray(band.sorts) ? band.sorts.map((s3) => {
          const sortColOk = rt.cols.includes(s3.col);
          if (!sortColOk && s3.col) brokenRefs.push(`Sort column "${s3.col}" not found in "${rt.name}"`);
          return { col: s3.col || "", dir: s3.dir === "DESC" ? "DESC" : "ASC", enabled: s3.enabled !== false };
        }) : [];
        next.detailBands.push({
          id: band.id || `band_${next.detailBands.length}`,
          rightId: band.rightId,
          keyPairs,
          cols,
          enabled: band.enabled !== false,
          sorts,
          label: typeof band.label === "string" ? band.label : ""
        });
      }
    }
    next.detailBandMode = payload.detailBandMode === "stack" ? "stack" : "separate";
    return { next, brokenRefs, nextExcludedRows };
  }

  // preact/core/state-applier.ts
  init_store();

  // preact/report/validation.ts
  init_store();
  init_column_catalog();

  // preact/query/lookup-resolver.ts
  function validateLookupSpec(lookupSpec, lookupIndex, sourceCatalog) {
    const issues = [];
    if (!lookupSpec.rightId) {
      issues.push({ code: "MISSING_RIGHT_TABLE", message: "Lookup has no right-side table." });
      return issues;
    }
    if (!sourceCatalog.has(lookupSpec.rightId)) {
      issues.push({
        code: "RIGHT_TABLE_NOT_FOUND",
        message: `Lookup table "${lookupSpec.rightId}" is not loaded.`,
        missingTableId: lookupSpec.rightId
      });
      return issues;
    }
    const keyPairs = Array.isArray(lookupSpec.keyPairs) ? lookupSpec.keyPairs : [];
    const complete = keyPairs.filter((p3) => p3.left && p3.right);
    if (!complete.length) {
      issues.push({ code: "NO_KEY_PAIRS", message: "Lookup has no complete key pairs." });
      return issues;
    }
    const rightTable = sourceCatalog.get(lookupSpec.rightId);
    for (const pair of complete) {
      if (!rightTable.cols.includes(pair.right)) {
        issues.push({
          code: "RIGHT_COLUMN_NOT_FOUND",
          message: `Right key "${pair.right}" not found in lookup table "${rightTable.name}".`,
          missingColumn: pair.right
        });
      }
    }
    return issues;
  }
  function expandLookups(lookups, sourceCatalog) {
    if (!lookups || lookups.length === 0) return [];
    const results = [];
    for (const lookup of lookups) {
      if (lookup.enabled === false) continue;
      if (!lookup.rightId || !sourceCatalog.has(lookup.rightId)) continue;
      const rightTable = sourceCatalog.get(lookup.rightId);
      const pairs = Array.isArray(lookup.keyPairs) ? lookup.keyPairs.filter((p3) => p3.left && p3.right) : [];
      if (pairs.length === 0) continue;
      const validPairs = pairs.filter((p3) => rightTable.cols.includes(p3.right));
      if (validPairs.length === 0) continue;
      results.push({
        lookup,
        resolved: {
          rightTable,
          pairs: validPairs
        }
      });
    }
    return results;
  }

  // preact/report/calc-validator.ts
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
  function validateDateMode(ctx) {
    const { calc, cols } = ctx;
    const date = calc.date;
    if (!date || typeof date !== "object") return "Date mode requires a date configuration object.";
    if (date.operation !== "extract") return `Unknown date operation "${date.operation}".`;
    const source = date.source;
    if (!source || typeof source !== "object") return "Date extract requires a source.";
    if (source.type !== "column") return `Date source has invalid type "${source.type}".`;
    if (!source.value) return "Date source column is required.";
    if (!cols.has(source.value)) return `Date source column "${source.value}" is not available.`;
    const validParts = ["year", "month", "day", "dow", "week", "quarter", "julian"];
    if (!date.part || !validParts.includes(date.part)) return `Unknown date part "${date.part}".`;
    return null;
  }
  var calcModeValidators = {
    math: validateMathMode,
    compare: validateCompareMode,
    text: validateTextMode,
    date: validateDateMode
  };
  function checkCalcError(calc, i3, projectedCols2) {
    const alias = (calc.alias || "").trim();
    if (!alias) return "Provide a label for this calculated column.";
    if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) {
      return "Pick a valid calculation type.";
    }
    const cols = new Set(projectedCols2);
    const ctx = { calc, i: i3, cols, alias };
    return calcModeValidators[calc.mode](ctx);
  }

  // preact/report/aggregation-constants.ts
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
    "DATE RANGE": "Date range  (earliest — latest)",
    "DATE SPAN": "Date span  (days between)",
    "NUMERIC RANGE": "Numeric range  (min – max)",
    "NUMERIC SPAN": "Numeric span  (max − min)",
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
    "DATE RANGE": "Date range  (earliest — latest)",
    "DATE SPAN": "Date span  (days between)",
    "NUMERIC RANGE": "Numeric range  (min – max)",
    "NUMERIC SPAN": "Numeric span  (max − min)",
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

  // preact/report/validation.ts
  var _validationCache = null;
  var _validationCacheState = null;
  function invalidateValidation() {
    _validationCache = null;
    _validationCacheState = null;
  }
  function getValidation() {
    const currentState = getStore().getState();
    if (!_validationCache || _validationCacheState !== currentState) {
      const sourceCatalog = buildSourceCatalog(currentState.tables);
      const colMap = buildColSourceMap();
      const reportSpec = {
        base: currentState.base,
        baseCols: currentState.baseCols,
        lookups: currentState.lookups,
        calcStages: currentState.calcStages
      };
      const proj = projectedCols(reportSpec, sourceCatalog);
      _validationCache = deriveValidation(currentState, proj, colMap, sourceCatalog);
      _validationCacheState = currentState;
    }
    return _validationCache;
  }
  function deriveValidation(state, projectedColsList, colMap, sourceCatalog) {
    const items = {};
    function mkIssue(id, area, cardId, itemId, message, extra) {
      return Object.assign(
        { id, severity: "blocked", area, cardId, itemId, message },
        extra || {}
      );
    }
    function mkItem(itemId, enabled, resolved, issues) {
      const e3 = enabled !== false;
      items[itemId] = { enabled: e3, resolved, blocking: e3 && !resolved, issues: issues || [] };
      return items[itemId];
    }
    const projected = new Set(projectedColsList);
    const baseOk = !!(state.base && state.tables && state.tables[state.base]);
    {
      const issues = [];
      if (!baseOk) {
        issues.push(mkIssue(
          "base_missing",
          "base",
          "pipeline",
          "base",
          `Primary sheet "${state.base || "(none)"}" is not loaded`,
          { missingTableId: state.base || null, repairHint: "Load the file containing this sheet." }
        ));
      }
      mkItem("base", true, baseOk, issues);
    }
    if (!["none", "group", "totals", "subtotals"].includes(state.aggMode)) {
      mkItem("aggMode", true, false, [
        mkIssue(
          "aggMode_invalid",
          "reportMode",
          "pipeline",
          "aggMode",
          `Unknown report mode "${state.aggMode}"`
        )
      ]);
    }
    for (let i3 = 0; i3 < (state.stacks || []).length; i3++) {
      const id = state.stacks[i3];
      const ok = !!(id && state.tables && state.tables[id]);
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
    const reportSpec = {
      base: state.base,
      baseCols: state.baseCols,
      lookups: state.lookups,
      calcStages: state.calcStages
    };
    for (let i3 = 0; i3 < (state.lookups || []).length; i3++) {
      const lk = state.lookups[i3];
      const enabled = lk.enabled !== false;
      const issues = [];
      let resolved = true;
      const rt = lk.rightId && state.tables[lk.rightId];
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
        const leftCols = projectedColsUpToLookup(i3, reportSpec, sourceCatalog);
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
      const lookupIssues = validateLookupSpec(lk, i3, sourceCatalog);
      if (lookupIssues.length) {
        resolved = false;
        for (const li of lookupIssues) {
          issues.push(mkIssue(
            `lookup_${i3}_dup_keys`,
            "duplicateKeys",
            "pipeline",
            `lookup_${i3}`,
            li.message,
            { lookupIndex: i3 }
          ));
        }
      }
      mkItem(`lookup_${i3}`, enabled, resolved, issues);
    }
    for (let i3 = 0; i3 < (state.detailBands || []).length; i3++) {
      const band = state.detailBands[i3];
      const enabled = band.enabled !== false;
      const issues = [];
      let resolved = true;
      const ct = band.rightId && state.tables[band.rightId];
      const displayName = band.label && band.label.trim() || (ct ? ct.name : "") || band.rightId || "(none)";
      if (!ct) {
        resolved = false;
        issues.push(mkIssue(
          `detailband_${i3}_missing_table`,
          "detailBand",
          "pipeline",
          `detailband_${i3}`,
          `Related details sheet "${displayName}" is not loaded`,
          { missingTableId: band.rightId || null, repairHint: "Load the file containing this sheet." }
        ));
      } else if (baseOk) {
        for (let pi = 0; pi < (band.keyPairs || []).length; pi++) {
          const p3 = band.keyPairs[pi];
          if (p3.left && !projected.has(p3.left)) {
            resolved = false;
            issues.push(mkIssue(
              `detailband_${i3}_kp${pi}_left`,
              "detailBand",
              "pipeline",
              `detailband_${i3}`,
              `Match column "${p3.left}" is not available`,
              { missingColumn: p3.left }
            ));
          }
          if (p3.right && !ct.cols.includes(p3.right)) {
            resolved = false;
            issues.push(mkIssue(
              `detailband_${i3}_kp${pi}_right`,
              "detailBand",
              "pipeline",
              `detailband_${i3}`,
              `Match column "${p3.right}" not found in "${displayName}"`,
              { missingColumn: p3.right }
            ));
          }
        }
        const hasCompleteKeyPair = (band.keyPairs || []).some((p3) => p3 && p3.left && p3.right);
        if (!hasCompleteKeyPair) {
          resolved = false;
          issues.push(mkIssue(
            `detailband_${i3}_no_key_pairs`,
            "detailBand",
            "pipeline",
            `detailband_${i3}`,
            `Related details "${displayName}" has no complete match column pair`
          ));
        }
        for (let si = 0; si < (band.sorts || []).length; si++) {
          const s3 = band.sorts[si];
          if (s3.enabled !== false && s3.col && !ct.cols.includes(s3.col)) {
            issues.push(mkIssue(
              `detailband_${i3}_sort_${si}_missing`,
              "detailBand",
              "pipeline",
              `detailband_${i3}`,
              `Sort column "${s3.col}" not found in "${displayName}"`,
              { severity: "warning", missingColumn: s3.col }
            ));
          }
        }
      }
      mkItem(`detailband_${i3}`, enabled, resolved, issues);
    }
    for (let i3 = 0; i3 < (state.calcStages || []).length; i3++) {
      const c3 = state.calcStages[i3];
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
          "Calculated column has no alias"
        ));
      } else if (!projected.has(alias)) {
        resolved = false;
        issues.push(mkIssue(
          `calc_${i3}_unresolved`,
          "calculatedColumn",
          `calc_${i3}`,
          `calc_${i3}`,
          `Calculated column "${alias}" — one or more source columns are not available`
        ));
      }
      const calcErr = checkCalcError(c3, i3, projectedColsList);
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
    for (let i3 = 0; i3 < (state.filters || []).length; i3++) {
      const f4 = state.filters[i3];
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
    for (let i3 = 0; i3 < (state.sorts || []).length; i3++) {
      const s3 = state.sorts[i3];
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
    if (state.aggMode === "group") {
      for (let i3 = 0; i3 < (state.groupBy || []).length; i3++) {
        const col = state.groupBy[i3];
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
      for (let i3 = 0; i3 < (state.aggregates || []).length; i3++) {
        const agg = state.aggregates[i3];
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
    if (state.aggMode === "totals") {
      for (const [col, fn] of Object.entries(state.colTotals || {})) {
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
              `"${col}" is a ${mathOp === "PCTTOTAL" ? "% of Total" : "Rolling Average"} calculated column — set its total function to "Skip" to avoid incorrect results`
            ));
          }
        }
        mkItem(`totals_${col}`, true, resolved, issues);
      }
    }
    if (state.aggMode === "subtotals") {
      const strat = state.subtotalStrategy;
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
      for (let i3 = 0; i3 < (state.subtotalBy || []).length; i3++) {
        const col = state.subtotalBy[i3];
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
      for (const [col, fn] of Object.entries(state.subtotalFns || {})) {
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
        const src = colMap.get(col);
        if (src?.kind === "calc") {
          const calcObj = src.calc;
          const mathOp = calcObj?.mathOp;
          if (mathOp === "PCTTOTAL" || mathOp === "ROLLAVG") {
            issues.push(mkIssue(
              `subtotalfns_${col}_advanced_calc`,
              "subtotalFns",
              "aggregation",
              `subtotalfns_${col}`,
              `"${col}" is a ${mathOp === "PCTTOTAL" ? "% of Total" : "Rolling Average"} calculated column — set its subtotal function to "Skip" to avoid incorrect results`
            ));
          }
        }
        mkItem(`subtotalfns_${col}`, true, resolved, issues);
      }
    }
    const outputAliases = /* @__PURE__ */ new Set();
    if (state.aggMode === "group") {
      for (const agg of state.aggregates || []) {
        if (agg.alias) outputAliases.add(agg.alias);
      }
    }
    for (const calc of state.calcStages || []) {
      if (calc.alias) outputAliases.add(calc.alias);
    }
    const colOrderItems = (state.colOrder || []).filter(
      (a3) => !projected.has(a3) && !outputAliases.has(a3)
    );
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
      const inSelCols = state.selCols instanceof Set ? state.selCols.has(col) : true;
      mkItem(`colorder_${col}`, inSelCols, false, issues);
    }
    for (const col of state.mergedCols || []) {
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
      if (itemId === "base" || itemId === "aggMode" || itemId.startsWith("stack_") || itemId.startsWith("lookup_") || itemId.startsWith("detailband_") || itemId.startsWith("calc_")) return "pipeline";
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

  // preact/query/layout-selection.ts
  init_store();
  init_column_catalog();
  var _seenCols = /* @__PURE__ */ new Set();
  var _previewOpen = /* @__PURE__ */ new Set();
  var _disabledCardCols = /* @__PURE__ */ new Set();
  function resetLayoutSelection() {
    _seenCols.clear();
    _previewOpen.clear();
    _disabledCardCols.clear();
  }
  function _sampleTipFor(tid, col, extra = []) {
    const store = getStore();
    const tbl = store.getState().tables?.[tid];
    const vals = (tbl?.samples?.[col] || []).slice(0, 3).map((v3) => String(v3));
    return [
      `From sheet: ${tbl?.name || tid}`,
      vals.length ? `Sample values: ${vals.join(" · ")}` : "Sample values: (none found)",
      ...extra
    ].join("\n");
  }
  function _isSourceVisibleInLayout(tid, col, colMap, _mode) {
    const store = getStore();
    const selCols = store.getState().selCols;
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
    const store = getStore();
    const colMap = buildColSourceMap();
    const aliases = [...colMap.keys()];
    store.update((draft) => {
      let selCols = draft.selCols;
      if (!(selCols instanceof Set)) {
        selCols = new Set(aliases);
        draft.selCols = selCols;
      }
      for (const alias of aliases) {
        const src = colMap.get(alias);
        if (!src || src.kind === "calc") continue;
        if (src.tid !== tid) continue;
        if (col !== null && src.col !== col) continue;
        if (isVisible) selCols.add(alias);
        else selCols.delete(alias);
      }
    });
  }
  function _showLayoutAliasesForSource(tid, col = null) {
    _setLayoutAliasesForSourceVisibility(tid, col, true);
  }
  function _hideLayoutAliasesForSource(tid, col = null) {
    _setLayoutAliasesForSourceVisibility(tid, col, false);
  }
  function _lookupColumnUsedElsewhere(tid, col, excludeLookupIndex = -1) {
    const store = getStore();
    const lookups = store.getState().lookups;
    for (let i3 = 0; i3 < lookups.length; i3++) {
      if (i3 === excludeLookupIndex) continue;
      const lk = lookups[i3];
      if (!lk || lk.rightId !== tid) continue;
      if (Array.isArray(lk.cols) && lk.cols.includes(col)) return true;
    }
    return false;
  }
  function _hideLookupLayoutAliasesSafely(tid, col = null, excludeLookupIndex = -1) {
    const store = getStore();
    const rt = tid ? store.getState().tables?.[tid] : null;
    if (!rt || !Array.isArray(rt.cols)) return;
    const cols = col === null ? rt.cols : [col];
    for (const c3 of cols) {
      if (_lookupColumnUsedElsewhere(tid, c3, excludeLookupIndex)) continue;
      _hideLayoutAliasesForSource(tid, c3);
    }
  }
  function _isAliasVisibleInLayout(alias, _mode) {
    if (!alias) return true;
    const store = getStore();
    const selCols = store.getState().selCols;
    if (!(selCols instanceof Set)) return true;
    return selCols.has(alias);
  }
  function _syncSubtotalByToLayout() {
    const store = getStore();
    const state = store.getState();
    if (!Array.isArray(state.subtotalBy) || !state.subtotalBy.length) return;
    const colMap = buildColSourceMap();
    const order = Array.isArray(state.colOrder) ? state.colOrder : [...colMap.keys()];
    const orderIdx = new Map(order.map((c3, i3) => [c3, i3]));
    const seen = /* @__PURE__ */ new Set();
    store.update((draft) => {
      draft.subtotalBy = draft.subtotalBy.filter((c3) => orderIdx.has(c3) && !seen.has(c3) && (seen.add(c3), true)).sort((a3, b2) => (orderIdx.get(a3) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b2) ?? Number.MAX_SAFE_INTEGER));
    });
  }
  function _afterCombineChange() {
    invalidateValidation();
    const store = getStore();
    const colMap = buildColSourceMap();
    const nowCols = [...colMap.keys()];
    store.update((draft) => {
      const selCols = draft.selCols;
      if (selCols instanceof Set) {
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
      if (!draft.colOrder) {
        draft.colOrder = [...nowCols];
      } else {
        const nowSet = new Set(nowCols);
        draft.colOrder = [
          ...draft.colOrder.filter((c3) => nowSet.has(c3)),
          ...nowCols.filter((c3) => !draft.colOrder.includes(c3))
        ];
      }
    });
    _syncSubtotalByToLayout();
  }

  // preact/core/state-applier.ts
  function applyState(next, nextExcludedRows) {
    getStore().update((draft) => {
      Object.assign(draft, next);
      for (const [tid, set] of Object.entries(nextExcludedRows)) {
        draft.excludedRows[tid] = set;
      }
    });
    invalidateValidation();
    resetLayoutSelection();
  }

  // preact/core/state-loader.ts
  function loadState(file, store) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e3) => {
        let payload = {};
        try {
          payload = JSON.parse(e3.target.result);
        } catch {
          toast("Could not parse state file — is it a valid .rcjson file?", "err");
          resolve({ ok: false, brokenRefs: [] });
          return;
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          toast("Invalid state file.", "err");
          resolve({ ok: false, brokenRefs: [] });
          return;
        }
        if (!isRecognizableConfig(payload)) {
          toast("File does not appear to be a TableFlip report configuration.", "err");
          resolve({ ok: false, brokenRefs: [] });
          return;
        }
        if (payload.v !== STATE_VERSION) {
          toast(`Version mismatch (saved: ${JSON.stringify(payload.v)}, app: ${STATE_VERSION}). Loaded with best-effort — check items for issues.`, "warn");
        }
        const loadedTables = store.getState().tables;
        const { next, brokenRefs, nextExcludedRows } = hydrateState(payload, loadedTables);
        applyState(next, nextExcludedRows);
        if (brokenRefs.length) {
          const summary = brokenRefs.length === 1 ? `1 item needs attention: ${brokenRefs[0]}.` : `${brokenRefs.length} items need attention — missing sheets or columns. Run the report to see full details.`;
          toast(`Report setup loaded with issues — ${summary}`, "warn");
        } else {
          toast("Report setup loaded.", "ok");
        }
        resolve({ ok: true, brokenRefs });
      };
      reader.onerror = () => {
        toast("Failed to read file.", "err");
        resolve({ ok: false, brokenRefs: [] });
      };
      reader.readAsText(file);
    });
  }

  // preact/ui/loader.ts
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
  function ingestSheet(wb, sheetName, label, store) {
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
    const state = store.getState();
    if (state.tables[id]) {
      dropTable(id);
      store.update((draft) => {
        delete draft.excludedRows[id];
      });
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
          suggestedPreviews.set(row[_ROWNO], snippets.join(" · "));
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
    const rowCount = tableRowCount(id);
    const color = getTableColor(id);
    store.update((draft) => {
      draft.excludedRows[id] = /* @__PURE__ */ new Set();
      draft.tables[id] = { id, name: label, cols, rowCount, samples };
      draft.tableColors[id] = color;
      if (!draft.base) draft.base = id;
    });
    if (suggested.size) {
      const previews = [...suggestedPreviews.values()];
      const previewStr = previews.length === 1 ? `"${previews[0]}"` : previews.map((p3) => `"${p3}"`).join(", ");
      const noun = suggested.size === 1 ? "row" : "rows";
      const btnLabel = suggested.size === 1 ? "Exclude it" : "Exclude them";
      stickyToast(
        `"${label}": ${suggested.size} ${noun} may be a totals ${noun}
Row contents → ${previewStr}`,
        "warn",
        () => {
          store.update((draft) => {
            draft.excludedRows[id] = new Set(suggested);
          });
        },
        btnLabel
      );
    }
  }
  function loadSheets(wb, sheetNames, store) {
    for (const name of sheetNames) {
      ingestSheet(wb, name, name, store);
    }
  }
  async function loadSpreadsheet(file, store) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "rcjson") {
      await loadState(file, store);
      return;
    }
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      toast(`Unsupported file type ".${ext}" — drop xlsx, xls, csv, or rcjson files.`, "err");
      return;
    }
    if (ext === "csv") {
      const text = await file.text();
      try {
        const wb = XLSX.read(text, { type: "string", dense: true });
        ingestSheet(wb, wb.SheetNames[0], stripExt(file.name), store);
      } catch (ex) {
        toast("Could not parse " + file.name + ": " + ex.message, "err");
      }
      return;
    }
    const buffer = await file.arrayBuffer();
    try {
      const wb = XLSX.read(buffer, { type: "array", cellDates: true, dense: true });
      const usable = wb.SheetNames.filter((n2) => wb.Sheets[n2] && wb.Sheets[n2]["!ref"]);
      if (!usable.length) {
        toast("No data found in " + file.name, "err");
        return;
      }
      if (usable.length === 1) {
        ingestSheet(wb, usable[0], stripExt(file.name), store);
      } else {
        loadSheets(wb, usable, store);
      }
    } catch (ex) {
      toast("Could not parse " + file.name + ": " + ex.message, "err");
    }
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
  var A3 = "undefined" != typeof Symbol && Symbol.for && /* @__PURE__ */ Symbol.for("react.forward_ref") || 3911;
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
  var q3 = "undefined" != typeof Symbol && Symbol.for && /* @__PURE__ */ Symbol.for("react.element") || 60103;
  var G2 = /^(?:accent|alignment|arabic|baseline|cap|clip(?!PathU)|color|dominant|fill|flood|font|glyph(?!R)|horiz|image(!S)|letter|lighting|marker(?!H|W|U)|overline|paint|pointer|shape|stop|strikethrough|stroke|text(?!L)|transform|underline|unicode|units|v|vector|vert|word|writing|x(?!C))[A-Z]/;
  var J2 = /^on(Ani|Tra|Tou|BeforeInp|Compo)/;
  var K2 = /[A-Z0-9]/g;
  var Q2 = "undefined" != typeof document;
  var X2 = function(n2) {
    return ("undefined" != typeof Symbol && "symbol" == typeof /* @__PURE__ */ Symbol() ? /fil|che|rad/ : /fil|che|ra/).test(n2);
  };
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

  // preact/ui/components/modal.tsx
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

  // preact/ui/file-loader.tsx
  function triggerFileInput() {
    document.getElementById("fileInput")?.click();
  }
  function SheetSelectorModal({
    pending,
    onConfirm,
    onClose
  }) {
    const [selected, setSelected] = d2(
      new Set(pending.sheets.map((s3) => s3.name))
    );
    const toggle = q2((name) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    }, []);
    const handleConfirm = q2(() => {
      onConfirm([...selected]);
    }, [selected, onConfirm]);
    return /* @__PURE__ */ u3(
      Modal,
      {
        open: true,
        title: "Select sheets to import",
        onClose,
        buttons: [
          { label: "Cancel", action: onClose },
          { label: "Import", primary: true, action: handleConfirm }
        ],
        children: [
          /* @__PURE__ */ u3("div", { style: "margin-bottom:8px;font-size:0.78rem;color:var(--muted)", children: [
            "File: ",
            /* @__PURE__ */ u3("strong", { children: pending.filename })
          ] }),
          /* @__PURE__ */ u3("div", { id: "modalSheets", children: pending.sheets.map((sheet) => {
            const id = "chk_" + sheet.name.replace(/[^A-Za-z0-9]/g, "_");
            return /* @__PURE__ */ u3("div", { class: "sheet-opt", children: /* @__PURE__ */ u3("label", { style: "display:flex;align-items:center;gap:10px;flex:1;cursor:pointer", children: [
              /* @__PURE__ */ u3(
                "input",
                {
                  type: "checkbox",
                  id,
                  checked: selected.has(sheet.name),
                  onChange: () => toggle(sheet.name),
                  style: "width:14px;height:14px;flex-shrink:0"
                }
              ),
              /* @__PURE__ */ u3("div", { children: [
                /* @__PURE__ */ u3("div", { class: "sheet-opt-name", children: sheet.name }),
                /* @__PURE__ */ u3("div", { class: "sheet-opt-meta", children: [
                  "~",
                  sheet.rows,
                  " rows · ",
                  sheet.cols,
                  " cols"
                ] })
              ] })
            ] }) }, sheet.name);
          }) })
        ]
      }
    );
  }
  function DropOverlay({ active }) {
    if (!active) return null;
    return /* @__PURE__ */ u3("div", { id: "dropOverlay", class: "drop-overlay active", children: [
      /* @__PURE__ */ u3("div", { class: "do-icon", children: "📂" }),
      /* @__PURE__ */ u3("div", { class: "do-label", children: "Drop files to import" })
    ] });
  }
  function LoadOverlay({ active }) {
    if (!active) return null;
    return /* @__PURE__ */ u3("div", { id: "loadOverlay", class: "load-overlay active", children: [
      /* @__PURE__ */ u3("div", { class: "lo-spinner" }),
      /* @__PURE__ */ u3("div", { class: "lo-title", children: "Loading..." })
    ] });
  }
  function Loader() {
    const [dropActive, setDropActive] = d2(false);
    const [loading, setLoading] = d2(false);
    const [pendingModal, setPendingModal] = d2(null);
    const pendingModalRef = A2(null);
    const dragDepth = A2(0);
    const fileInputRef = A2(null);
    const processFiles = q2(async (files) => {
      const store = getStore();
      let sheetCount = 0;
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop().toLowerCase();
        if (ext === "rcjson") {
          await loadSpreadsheet(file, store);
          continue;
        }
        if (!["xlsx", "xls", "csv"].includes(ext)) {
          toast(`Unsupported file type ".${ext}" — drop xlsx, xls, csv, or rcjson files.`, "err");
          continue;
        }
        setLoading(true);
        if (ext === "csv") {
          const text = await file.text();
          try {
            const wb = XLSX.read(text, { type: "string", dense: true });
            ingestSheet(wb, wb.SheetNames[0], stripExt(file.name), store);
            sheetCount++;
          } catch (ex) {
            toast("Could not parse " + file.name + ": " + ex.message, "err");
          }
        } else {
          const buffer = await file.arrayBuffer();
          try {
            const wb = XLSX.read(buffer, { type: "array", cellDates: true, dense: true });
            const usable = wb.SheetNames.filter((n2) => wb.Sheets[n2] && wb.Sheets[n2]["!ref"]);
            if (!usable.length) {
              toast("No data found in " + file.name, "err");
            } else if (usable.length === 1) {
              ingestSheet(wb, usable[0], stripExt(file.name), store);
              sheetCount++;
            } else {
              const sheets = usable.map((name) => {
                const ws = wb.Sheets[name];
                let rows = "?";
                let cols = "?";
                try {
                  const r3 = XLSX.utils.decode_range(ws["!ref"]);
                  rows = (r3.e.r - r3.s.r).toLocaleString();
                  cols = r3.e.c - r3.s.c + 1;
                } catch {
                }
                return { name, rows, cols };
              });
              const pending = { wb, filename: file.name, sheets };
              pendingModalRef.current = pending;
              setPendingModal(pending);
              await new Promise((resolve) => {
                window.__loaderResolve = resolve;
              });
            }
          } catch (ex) {
            toast("Could not parse " + file.name + ": " + ex.message, "err");
          }
        }
        setLoading(false);
      }
      if (sheetCount > 0) {
        toast(`Loaded ${sheetCount} sheet${sheetCount !== 1 ? "s" : ""}`, "ok");
      }
    }, []);
    const handleConfirmSheets = q2((selected) => {
      const pending = pendingModalRef.current;
      if (pending && selected.length > 0) {
        const store = getStore();
        loadSheets(pending.wb, selected, store);
        toast(`Loaded ${selected.length} sheet${selected.length !== 1 ? "s" : ""}`, "ok");
      }
      pendingModalRef.current = null;
      setPendingModal(null);
      const resolve = window.__loaderResolve;
      if (resolve) {
        resolve();
        delete window.__loaderResolve;
      }
    }, []);
    const handleCloseModal = q2(() => {
      pendingModalRef.current = null;
      setPendingModal(null);
      const resolve = window.__loaderResolve;
      if (resolve) {
        resolve();
        delete window.__loaderResolve;
      }
    }, []);
    y2(() => {
      const handleDragEnter = (e3) => {
        if (!e3.dataTransfer?.types.includes("Files")) return;
        dragDepth.current++;
        setDropActive(true);
      };
      const handleDragLeave = () => {
        dragDepth.current--;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDropActive(false);
        }
      };
      const handleDragOver = (e3) => {
        e3.preventDefault();
      };
      const handleDrop = (e3) => {
        dragDepth.current = 0;
        setDropActive(false);
        if (e3.defaultPrevented) return;
        e3.preventDefault();
        if (e3.dataTransfer?.files) {
          processFiles(e3.dataTransfer.files);
        }
      };
      document.addEventListener("dragenter", handleDragEnter);
      document.addEventListener("dragleave", handleDragLeave);
      document.addEventListener("dragover", handleDragOver);
      document.addEventListener("drop", handleDrop);
      return () => {
        document.removeEventListener("dragenter", handleDragEnter);
        document.removeEventListener("dragleave", handleDragLeave);
        document.removeEventListener("dragover", handleDragOver);
        document.removeEventListener("drop", handleDrop);
      };
    }, [processFiles]);
    const handleFileInput = q2((e3) => {
      const target = e3.target;
      if (target.files) {
        processFiles(target.files);
        target.value = "";
      }
    }, [processFiles]);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3(DropOverlay, { active: dropActive }),
      /* @__PURE__ */ u3(LoadOverlay, { active: loading }),
      pendingModal && /* @__PURE__ */ u3(
        SheetSelectorModal,
        {
          pending: pendingModal,
          onConfirm: handleConfirmSheets,
          onClose: handleCloseModal
        }
      ),
      /* @__PURE__ */ u3(
        "input",
        {
          ref: fileInputRef,
          id: "fileInput",
          type: "file",
          accept: ".xlsx,.xls,.csv,.rcjson",
          multiple: true,
          style: "display:none",
          onChange: handleFileInput
        }
      )
    ] });
  }

  // preact/core/state-serializer.ts
  init_store();

  // preact/ui/aggregation.ts
  init_store();
  function _selColsToArray(selCols) {
    if (selCols instanceof Set) return [...selCols];
    if (Array.isArray(selCols)) return [...selCols];
    return null;
  }
  function _readAggModeState(mode) {
    const state = getStore().getState();
    if (mode === "group") {
      return {
        selCols: _selColsToArray(state.selCols),
        groupBy: [...state.groupBy || []],
        aggregates: (state.aggregates || []).map((a3) => ({ ...a3 }))
      };
    }
    if (mode === "totals") {
      return {
        selCols: _selColsToArray(state.selCols),
        colTotals: { ...state.colTotals || {} }
      };
    }
    if (mode === "subtotals") {
      return {
        selCols: _selColsToArray(state.selCols),
        subtotalBy: [...state.subtotalBy || []],
        subtotalFns: { ...state.subtotalFns || {} },
        subtotalGrandTotal: state.subtotalGrandTotal !== false,
        subtotalSpacer: !!state.subtotalSpacer,
        subtotalOnTop: !!state.subtotalOnTop,
        subtotalStrategy: state.subtotalStrategy || "combined"
      };
    }
    return {
      selCols: _selColsToArray(state.selCols)
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
    getStore().update((draft) => {
      if (!draft.aggModeState || typeof draft.aggModeState !== "object") draft.aggModeState = {};
      for (const mode of AGG_MODES) {
        if (!draft.aggModeState[mode] || typeof draft.aggModeState[mode] !== "object") {
          draft.aggModeState[mode] = _defaultAggModeState(mode);
        }
      }
    });
  }
  function saveActiveAggModeState() {
    ensureAggModeState();
    const state = getStore().getState();
    const mode = state.aggMode || "none";
    const modeState = _readAggModeState(mode);
    getStore().update((draft) => {
      if (!draft.aggModeState) draft.aggModeState = {};
      draft.aggModeState[mode] = modeState;
    });
  }
  function loadAggModeState(mode) {
    ensureAggModeState();
    const state = getStore().getState();
    const savedState = state.aggModeState?.[mode] || _defaultAggModeState(mode);
    getStore().update((draft) => {
      draft.groupBy = [];
      draft.aggregates = [];
      draft.colTotals = {};
      draft.subtotalBy = [];
      draft.subtotalFns = {};
      if (mode === "group") {
        if ("selCols" in savedState) {
          draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols) : null;
        }
        draft.groupBy = Array.isArray(savedState.groupBy) ? [...savedState.groupBy] : [];
        draft.aggregates = Array.isArray(savedState.aggregates) ? savedState.aggregates.map((a3) => ({ ...a3 })) : [];
        return;
      }
      if (mode === "totals") {
        if ("selCols" in savedState) {
          draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols) : null;
        }
        draft.colTotals = savedState.colTotals && typeof savedState.colTotals === "object" ? { ...savedState.colTotals } : {};
        return;
      }
      if (mode === "subtotals") {
        if ("selCols" in savedState) {
          draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols) : null;
        }
        draft.subtotalBy = Array.isArray(savedState.subtotalBy) ? [...savedState.subtotalBy] : [];
        draft.subtotalFns = savedState.subtotalFns && typeof savedState.subtotalFns === "object" ? { ...savedState.subtotalFns } : {};
        draft.subtotalGrandTotal = savedState.subtotalGrandTotal !== false;
        draft.subtotalSpacer = !!savedState.subtotalSpacer;
        draft.subtotalOnTop = !!savedState.subtotalOnTop;
        draft.subtotalStrategy = savedState.subtotalStrategy === "nested" ? "nested" : "combined";
        return;
      }
      if ("selCols" in savedState) {
        draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols) : null;
      }
    });
  }
  function setAggMode(mode) {
    if (!AGG_MODES.includes(mode)) mode = "none";
    const aggMode = mode;
    const state = getStore().getState();
    const prev = state.aggMode || "none";
    if (prev === aggMode) return;
    saveActiveAggModeState();
    getStore().update((draft) => {
      draft.aggMode = aggMode;
    });
    loadAggModeState(aggMode);
  }
  function setSubtotalGrandTotal(checked) {
    getStore().update((draft) => {
      draft.subtotalGrandTotal = !!checked;
    });
  }
  function setSubtotalSpacer(checked) {
    getStore().update((draft) => {
      draft.subtotalSpacer = !!checked;
    });
  }
  function setSubtotalOnTop(checked) {
    getStore().update((draft) => {
      draft.subtotalOnTop = !!checked;
    });
  }
  function setSubtotalStrategy(value) {
    getStore().update((draft) => {
      draft.subtotalStrategy = value === "nested" ? "nested" : "combined";
    });
  }
  function addAggregate() {
    getStore().update((draft) => {
      const allCols = draft.colOrder || [];
      const col = allCols.find((c3) => !draft.groupBy.includes(c3)) || allCols[0] || "";
      draft.aggregates.push({
        fn: "SUM",
        col,
        alias: "",
        auto: false
      });
    });
  }
  function removeAggregate(i3) {
    getStore().update((draft) => {
      draft.aggregates.splice(i3, 1);
    });
  }

  // preact/core/state-serializer.ts
  function buildPayload(state) {
    const excludedRowsSerial = {};
    for (const [tid, set] of Object.entries(state.excludedRows)) {
      if (set && set.size) excludedRowsSerial[tid] = [...set];
    }
    return {
      v: STATE_VERSION,
      base: state.base,
      baseCols: state.baseCols ? [...state.baseCols] : null,
      stacks: [...state.stacks || []],
      lookups: (state.lookups || []).map((l3) => ({
        rightId: l3.rightId,
        keyPairs: (l3.keyPairs || []).map((p3) => ({ left: p3.left, right: p3.right })),
        cols: [...l3.cols || []],
        required: !!l3.required,
        enabled: l3.enabled !== false,
        duplicatePolicy: l3.duplicatePolicy ? { ...l3.duplicatePolicy } : { mode: "block" }
      })),
      calcStages: (state.calcStages || []).map((c3) => ({
        alias: (c3.alias || "").trim(),
        mode: c3.mode,
        enabled: c3.enabled !== false,
        ...c3.math ? { math: JSON.parse(JSON.stringify(c3.math)) } : {},
        ...c3.compare ? { compare: JSON.parse(JSON.stringify(c3.compare)) } : {},
        ...c3.text ? { text: JSON.parse(JSON.stringify(c3.text)) } : {},
        ...c3.date ? { date: JSON.parse(JSON.stringify(c3.date)) } : {}
      })),
      selCols: state.selCols ? [...state.selCols] : null,
      colOrder: state.colOrder ? [...state.colOrder] : null,
      filters: state.filters.map((f4) => ({
        col: f4.col || "",
        op: f4.op || "contains",
        vals: Array.isArray(f4.vals) ? [...f4.vals] : [""],
        enabled: f4.enabled !== false
      })),
      sorts: state.sorts.map((s3) => ({ col: s3.col || "", dir: s3.dir === "DESC" ? "DESC" : "ASC", enabled: s3.enabled !== false })),
      groupBy: [...state.groupBy],
      aggregates: state.aggregates.map((a3) => ({ ...a3 })),
      aggMode: state.aggMode || "none",
      aggModeState: JSON.parse(JSON.stringify(state.aggModeState || {})),
      colTotals: { ...state.colTotals || {} },
      subtotalBy: [...state.subtotalBy || []],
      subtotalFns: { ...state.subtotalFns || {} },
      subtotalGrandTotal: state.subtotalGrandTotal !== false,
      subtotalSpacer: !!state.subtotalSpacer,
      subtotalOnTop: !!state.subtotalOnTop,
      subtotalStrategy: state.subtotalStrategy || "combined",
      mergedCols: [...state.mergedCols || []],
      mergeGroupUnderline: !!state.mergeGroupUnderline,
      colState: state.colState || null,
      excludedRows: excludedRowsSerial,
      tableColors: { ...state.tableColors || {} },
      columnLabels: JSON.parse(JSON.stringify(state.columnLabels || {})),
      detailBands: (state.detailBands || []).map((b2) => ({
        id: b2.id || "",
        rightId: b2.rightId || "",
        keyPairs: (b2.keyPairs || []).map((p3) => ({ left: p3.left || "", right: p3.right || "" })),
        cols: [...b2.cols || []],
        enabled: b2.enabled !== false,
        sorts: (b2.sorts || []).map((s3) => ({ col: s3.col || "", dir: s3.dir === "DESC" ? "DESC" : "ASC", enabled: s3.enabled !== false })),
        label: typeof b2.label === "string" ? b2.label : ""
      })),
      detailBandMode: state.detailBandMode || "separate"
    };
  }
  function saveState() {
    const state = getStore().getState();
    if (!state.base) {
      toast("Nothing to save — load a data file first.", "err");
      return;
    }
    saveActiveAggModeState();
    ensureAggModeState();
    const raw = typeof window !== "undefined" ? window.prompt("Save query as:", "my-query") : null;
    if (raw === null) return;
    const name = (raw.trim() || "my-query").replace(/\.rcjson$/i, "");
    const currentState = getStore().getState();
    const payload = buildPayload(currentState);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    dl(blob, name + ".rcjson");
  }

  // preact/ui/sidebar.tsx
  function Sidebar() {
    const [state, setState] = d2(getStore().getState());
    y2(() => {
      const unsub = getStore().subscribe((s3) => setState(s3));
      return unsub;
    }, []);
    const tables = state.tables;
    const ids = Object.keys(tables).sort(
      (a3, b2) => tables[a3].name.localeCompare(tables[b2].name)
    );
    const handleRemove = q2((id) => {
      dropTable(id);
      getStore().update((draft) => {
        delete draft.tables[id];
        delete draft.excludedRows[id];
        delete draft.tableColors[id];
        if (draft.base === id) {
          draft.base = "";
          draft.selCols = null;
          draft.groupBy = [];
          draft.aggregates = [];
          draft.filters = [];
        }
      });
    }, []);
    const handlePreview = q2((id) => {
      getStore().update((draft) => {
        draft.previewTableId = id;
        draft.activeTab = "preview";
      });
    }, []);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: "sidebar-wrap", children: /* @__PURE__ */ u3("div", { id: "sidebar", class: "sidebar", children: [
        /* @__PURE__ */ u3("div", { class: "sb-sec", children: /* @__PURE__ */ u3("div", { id: "dropZone", onClick: triggerFileInput, children: [
          /* @__PURE__ */ u3("div", { class: "dz-icon", children: "📂" }),
          /* @__PURE__ */ u3("div", { class: "dz-main", children: "Import files" }),
          /* @__PURE__ */ u3("div", { class: "dz-sub", children: "Drop xlsx, csv, or rcjson here" })
        ] }) }),
        /* @__PURE__ */ u3("div", { class: "sb-sec", children: /* @__PURE__ */ u3("h3", { children: [
          "Tables (",
          ids.length,
          ")"
        ] }) }),
        /* @__PURE__ */ u3("div", { id: "tablesList", class: "tables-list", children: ids.length === 0 ? /* @__PURE__ */ u3("div", { class: "empty", style: "flex:none;padding:16px", children: [
          /* @__PURE__ */ u3("div", { class: "empty-icon", children: "📋" }),
          /* @__PURE__ */ u3("div", { children: "No tables loaded" })
        ] }) : ids.map((id) => {
          const t3 = tables[id];
          const color = getTableColor(id);
          return /* @__PURE__ */ u3(
            "div",
            {
              class: "tcard",
              "data-tid": id,
              style: { borderLeft: `3px solid ${color}` },
              children: [
                /* @__PURE__ */ u3(
                  "div",
                  {
                    class: "tcard-rm",
                    "data-rm": id,
                    onClick: (e3) => {
                      e3.stopPropagation();
                      handleRemove(id);
                    },
                    children: "✕"
                  }
                ),
                /* @__PURE__ */ u3(
                  "div",
                  {
                    class: "tcard-name",
                    title: t3.name,
                    onClick: () => handlePreview(id),
                    children: t3.name
                  }
                ),
                /* @__PURE__ */ u3("div", { class: "tcard-meta", children: [
                  t3.rowCount.toLocaleString(),
                  " rows · ",
                  t3.cols.length,
                  " cols"
                ] })
              ]
            },
            id
          );
        }) }),
        state.base && /* @__PURE__ */ u3("div", { class: "sidebar-footer", children: /* @__PURE__ */ u3("button", { class: "sidebar-save-btn", onClick: saveState, "data-tip": "Save your current report setup (sheets, columns, filters, sort, summary) as a file you can reload later.", children: "Save Report Config" }) })
      ] }) }),
      /* @__PURE__ */ u3("div", { id: "sidebarToggle", class: "sidebar-toggle", onClick: toggleSidebar, children: "❮" })
    ] });
  }

  // preact/ui/cards/pipeline-card.tsx
  init_store();

  // preact/ui/sections/base-stage.tsx
  init_store();
  init_column_catalog();

  // preact/ui/components/chip.tsx
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

  // preact/ui/components/tip.tsx
  function Tip({ text }) {
    return /* @__PURE__ */ u3("span", { class: "tip", "data-tip": text, children: "?" });
  }

  // preact/ui/components/context-menu.tsx
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

  // preact/ui/components/rename-modal.tsx
  init_store();
  init_column_catalog();
  init_alias_ref_updater();
  function resolveRenameTarget(alias) {
    const colMap = buildColSourceMap();
    const src = colMap.get(alias);
    if (!src) return null;
    if (src.kind === "calc") return { alias, calcIdx: src.idx };
    return { alias, tid: src.tid, col: src.col };
  }
  function RenameModal({ target, onDone, onClose }) {
    const isCalc = target.calcIdx != null;
    const state = getStore().getState();
    const current = isCalc ? ((Array.isArray(state.calcStages) ? state.calcStages[target.calcIdx]?.alias : "") || "").trim() || target.alias : state.columnLabels?.[target.tid]?.[target.col] || "";
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
          const calcStages = getStore().getState().calcStages;
          const calc = Array.isArray(calcStages) ? calcStages[target.calcIdx] : null;
          if (calc) {
            getStore().update((draft) => {
              if (draft.calcStages[target.calcIdx]) {
                draft.calcStages[target.calcIdx].alias = newName;
              }
            });
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

  // preact/ui/sections/base-stage.tsx
  function BaseStage({ sortedIds }) {
    const [state, setState] = d2(getStore().getState());
    const [ctxMenu, setCtxMenu] = d2(null);
    const [renameTarget, setRenameTarget] = d2(null);
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const base = state.base;
    const tables = state.tables;
    const baseTable = base && tables[base] ? tables[base] : null;
    const allCols = baseTable ? baseTable.cols : [];
    const aggMode = state.aggMode || "none";
    const handleBaseChange = q2((val) => {
      getStore().update((draft) => {
        draft.base = val;
        draft.baseCols = null;
        draft.stacks = [];
        draft.selCols = null;
        draft.colOrder = null;
      });
      _previewOpen.clear();
      _disabledCardCols.clear();
      _afterCombineChange();
    }, []);
    const layoutColMap = base && tables[base] ? buildColSourceMap() : /* @__PURE__ */ new Map();
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: "pl-stage", children: [
        /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: [
          "Start from ",
          /* @__PURE__ */ u3(Tip, { text: "Pick the main sheet for your report. This is the sheet that all other sheets will be combined with — like the main table in your workbook." })
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-base-row", children: /* @__PURE__ */ u3("select", { value: base || "", onChange: (e3) => handleBaseChange(e3.target.value), children: [
          /* @__PURE__ */ u3("option", { value: "", children: [
            "—",
            " select a sheet ",
            "—"
          ] }),
          sortedIds.map((id) => /* @__PURE__ */ u3("option", { value: id, children: tables[id].name }, id))
        ] }) }),
        baseTable && /* @__PURE__ */ u3("div", { class: "pl-lookup-cols", style: "margin-top:6px", children: [
          /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center", children: "Columns:" }),
          /* @__PURE__ */ u3(Tip, { text: "These are the columns in your main sheet. Click a chip to hide it from the report. Right-click any chip to rename it." }),
          allCols.map((c3) => {
            const colMap = buildColSourceMap();
            const isLayoutVisible = _isSourceVisibleInLayout(base, c3, colMap, aggMode);
            const color = getTableColor(base);
            const chipStyle = `background:${color};border-color:${color};color:${chipFgColor(color)}`;
            return /* @__PURE__ */ u3(
              Chip,
              {
                col: c3,
                label: colUserLabel(base, c3),
                selected: true,
                draggable: false,
                chipClass: "pl-col-chip",
                className: isLayoutVisible ? "" : "pl-col-chip-layout-hidden",
                tooltip: _sampleTipFor(base, c3, ["Click to show or hide this column in your report."]),
                dataAttrs: { "data-bcc": c3 },
                inlineStyle: chipStyle,
                onClick: () => {
                  const colMap2 = buildColSourceMap();
                  const visible = _isSourceVisibleInLayout(base, c3, colMap2, aggMode);
                  if (visible) _hideLayoutAliasesForSource(base, c3);
                  else _showLayoutAliasesForSource(base, c3);
                  _afterCombineChange();
                },
                onContextMenu: (e3) => {
                  e3.preventDefault();
                  const colMap2 = buildColSourceMap();
                  let alias = "";
                  for (const [a3, src] of colMap2.entries()) {
                    if (src && src.kind !== "calc" && src.tid === base && src.col === c3) {
                      alias = a3;
                      break;
                    }
                    if (!alias) return;
                  }
                  if (!alias) return;
                  setCtxMenu({
                    x: e3.clientX,
                    y: e3.clientY,
                    items: [{ label: "Rename", action: () => setRenameTarget(resolveRenameTarget(alias)) }]
                  });
                }
              },
              c3
            );
          }),
          /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-ghost",
              style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0",
              onClick: () => {
                _showLayoutAliasesForSource(base);
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
                _hideLayoutAliasesForSource(base);
                _afterCombineChange();
              },
              children: "None"
            }
          )
        ] })
      ] }),
      ctxMenu && /* @__PURE__ */ u3(ContextMenu, { x: ctxMenu.x, y: ctxMenu.y, items: ctxMenu.items, onClose: () => setCtxMenu(null) }),
      renameTarget && /* @__PURE__ */ u3(RenameModal, { target: renameTarget, onDone: () => _afterCombineChange(), onClose: () => setRenameTarget(null) })
    ] });
  }

  // preact/ui/sections/stack-sheets.tsx
  init_store();
  function StackSheets({ sortedIds, usedAsLookup, usedAsStack }) {
    const [state, setState] = d2(getStore().getState());
    const selRef = A2(null);
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const base = state.base;
    const tables = state.tables;
    const stacks = state.stacks || [];
    const addStack = q2((id) => {
      if (!id || !tables[id] || id === base) return;
      getStore().update((draft) => {
        if (!draft.stacks.includes(id)) draft.stacks.push(id);
      });
      _afterCombineChange();
    }, [base, tables]);
    const removeStack = q2((id) => {
      getStore().update((draft) => {
        draft.stacks = draft.stacks.filter((s3) => s3 !== id);
      });
      _afterCombineChange();
    }, []);
    if (!base || !tables[base]) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: [
        "←",
        " Pick a sheet first"
      ] });
    }
    const stackAvail = sortedIds.filter((id) => id !== base && !usedAsStack.has(id) && !usedAsLookup.has(id));
    const handleAddClick = q2(() => {
      const sel = selRef.current;
      if (!sel) return;
      sel.style.cssText = "position:absolute;opacity:1;pointer-events:auto;width:auto;height:auto";
      sel.focus();
      const handleBlur = () => {
        sel.style.cssText = "position:absolute;opacity:0;pointer-events:none;width:0;height:0";
        sel.removeEventListener("blur", handleBlur);
      };
      sel.addEventListener("blur", handleBlur);
    }, []);
    const handleSelectChange = q2((e3) => {
      const val = e3.target.value;
      if (val) addStack(val);
      e3.target.value = "";
    }, [addStack]);
    return /* @__PURE__ */ u3("div", { class: "pl-stack-sheets", children: [
      stacks.filter((id) => tables[id]).map((id) => /* @__PURE__ */ u3("span", { class: "pl-stack-chip", style: `border-left:3px solid ${getTableColor(id)}`, children: [
        tables[id].name,
        /* @__PURE__ */ u3("span", { class: "rm", onClick: () => removeStack(id), children: "×" })
      ] }, id)),
      stackAvail.length > 0 && /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3(
          "select",
          {
            ref: selRef,
            style: "position:absolute;opacity:0;pointer-events:none;width:0;height:0",
            onChange: handleSelectChange,
            children: [
              /* @__PURE__ */ u3("option", { value: "", children: [
                "pick a sheet",
                "…"
              ] }),
              stackAvail.map((id) => /* @__PURE__ */ u3("option", { value: id, children: tables[id].name }, id))
            ]
          }
        ),
        /* @__PURE__ */ u3("div", { class: "pl-add-btn", onClick: handleAddClick, children: [
          "＋",
          " Include"
        ] })
      ] })
    ] });
  }

  // preact/ui/sections/pipeline-arrow.tsx
  function PipelineArrow({ id }) {
    const [open, setOpen] = d2(_previewOpen.has(id));
    const toggle = () => {
      const next = !open;
      setOpen(next);
      if (next) _previewOpen.add(id);
      else _previewOpen.delete(id);
    };
    return /* @__PURE__ */ u3("div", { class: "pl-arrow", children: [
      /* @__PURE__ */ u3("div", { class: "pl-arrow-line" }),
      /* @__PURE__ */ u3("div", { class: "pl-arrow-meta", children: /* @__PURE__ */ u3("button", { class: "pl-preview-btn", onClick: toggle, children: open ? "▲ Hide preview" : "▼ Preview" }) }),
      /* @__PURE__ */ u3("div", { class: "pl-arrow-line" }),
      /* @__PURE__ */ u3("div", { class: "pl-arrow-head" }),
      open && /* @__PURE__ */ u3("div", { class: "pl-mini-preview", children: /* @__PURE__ */ u3("em", { style: { fontSize: "0.72rem", color: "var(--muted)" }, children: "Preview not available yet" }) })
    ] });
  }

  // preact/ui/sections/lookup-stage.tsx
  init_store();
  init_state();
  init_column_catalog();
  function LookupStage({ i: i3, sortedIds, usedAsLookup, usedAsStack }) {
    const [state, setState] = d2(getStore().getState());
    const [ctxMenu, setCtxMenu] = d2(null);
    const [renameTarget, setRenameTarget] = d2(null);
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    y2(() => {
      const lk2 = getStore().getState().lookups[i3];
      if (lk2 && (!Array.isArray(lk2.keyPairs) || !lk2.keyPairs.length)) {
        getStore().update((draft) => {
          if (draft.lookups[i3] && (!Array.isArray(draft.lookups[i3].keyPairs) || !draft.lookups[i3].keyPairs.length)) {
            draft.lookups[i3].keyPairs = [{ left: "", right: "" }];
          }
        });
      }
    }, [i3]);
    const lk = state.lookups[i3];
    if (!lk) return null;
    const tables = state.tables;
    const base = state.base;
    const aggMode = state.aggMode || "none";
    const rt = lk.rightId && tables[lk.rightId] ? tables[lk.rightId] : null;
    const reportSpec = buildReportSpecFromState(state);
    const sourceCatalog = buildSourceCatalog(tables);
    const leftCols = projectedColsUpToLookup(i3, reportSpec, sourceCatalog);
    const rightCols = rt ? rt.cols : [];
    const pairs = lk.keyPairs || [{ left: "", right: "" }];
    const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : "";
    const lkColMap = buildColSourceMap();
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
    const updateLookup = q2((updater) => {
      getStore().update((draft) => {
        const lkDraft = draft.lookups[i3];
        if (lkDraft) updater(draft, lkDraft);
      });
      _afterCombineChange();
    }, [i3]);
    const handleRightIdChange = q2((val) => {
      const prevRightId = lk.rightId;
      updateLookup((draft, lkDraft) => {
        lkDraft.rightId = val;
        lkDraft.keyPairs = [{ left: "", right: "" }];
        const rt2 = val && draft.tables[val];
        lkDraft.cols = rt2 ? [...rt2.cols] : [];
      });
      if (prevRightId && prevRightId !== val) _hideLookupLayoutAliasesSafely(prevRightId, null, i3);
      if (val) _showLayoutAliasesForSource(val);
    }, [i3, lk.rightId, updateLookup]);
    const handleEnabledChange = q2((checked) => {
      const wasEnabled = lk.enabled !== false;
      updateLookup((draft, lkDraft) => {
        lkDraft.enabled = checked;
        if (wasEnabled && !checked) {
          const rt2 = lkDraft.rightId && draft.tables[lkDraft.rightId];
          if (rt2 && draft.selCols instanceof Set) {
            const colMap = buildColSourceMap();
            const savedAliases = /* @__PURE__ */ new Set();
            for (const col of rt2.cols) {
              if (_isSourceVisibleInLayout(lkDraft.rightId, col, colMap, draft.aggMode || "none")) {
                for (const [alias, src] of colMap.entries()) {
                  if (src && src.kind !== "calc" && src.tid === lkDraft.rightId && src.col === col) {
                    savedAliases.add(alias);
                  }
                }
              }
            }
            lkDraft._prevSelState = savedAliases;
            for (const alias of savedAliases) _disabledCardCols.add(alias);
          }
        } else if (!wasEnabled && checked) {
          const saved = lkDraft._prevSelState;
          if (saved && draft.selCols instanceof Set) {
            for (const alias of saved) {
              draft.selCols.add(alias);
              _disabledCardCols.delete(alias);
            }
          }
          delete lkDraft._prevSelState;
        }
      });
    }, [i3, lk.enabled, updateLookup]);
    const handleRequiredChange = q2((val) => {
      updateLookup((_draft, lkDraft) => {
        lkDraft.required = val === "1";
      });
    }, [updateLookup]);
    const handleDupModeChange = q2((val) => {
      updateLookup((_draft, lkDraft) => {
        if (!lkDraft.duplicatePolicy) lkDraft.duplicatePolicy = { mode: "block" };
        lkDraft.duplicatePolicy.mode = val;
      });
    }, [updateLookup]);
    const handleKpLeftChange = q2((pi, val) => {
      updateLookup((_draft, lkDraft) => {
        if (!Array.isArray(lkDraft.keyPairs)) lkDraft.keyPairs = [{ left: "", right: "" }];
        if (!lkDraft.keyPairs[pi]) lkDraft.keyPairs[pi] = { left: "", right: "" };
        lkDraft.keyPairs[pi].left = val;
      });
    }, [updateLookup]);
    const handleKpRightChange = q2((pi, val) => {
      updateLookup((_draft, lkDraft) => {
        if (!Array.isArray(lkDraft.keyPairs)) lkDraft.keyPairs = [{ left: "", right: "" }];
        if (!lkDraft.keyPairs[pi]) lkDraft.keyPairs[pi] = { left: "", right: "" };
        lkDraft.keyPairs[pi].right = val;
      });
    }, [updateLookup]);
    const removeKeyPair = q2((pi) => {
      updateLookup((_draft, lkDraft) => {
        lkDraft.keyPairs.splice(pi, 1);
      });
    }, [updateLookup]);
    const addKeyPair = q2(() => {
      updateLookup((_draft, lkDraft) => {
        if (!Array.isArray(lkDraft.keyPairs)) lkDraft.keyPairs = [];
        lkDraft.keyPairs.push({ left: "", right: "" });
      });
    }, [updateLookup]);
    const removeLookup = q2(() => {
      getStore().update((draft) => {
        draft.lookups.splice(i3, 1);
      });
      _afterCombineChange();
    }, [i3]);
    const selectAllCols = q2(() => {
      if (lk.rightId) _showLayoutAliasesForSource(lk.rightId);
      _afterCombineChange();
    }, [lk.rightId]);
    const selectNoneCols = q2(() => {
      _hideLookupLayoutAliasesSafely(lk.rightId, null, i3);
      _afterCombineChange();
    }, [i3, lk.rightId]);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: stageClasses, children: [
        /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: [
          "Look up columns from ",
          /* @__PURE__ */ u3(Tip, { text: "Pull columns from another sheet by matching a shared value — just like VLOOKUP in Excel.\n\nFor example: match Employee ID in your main sheet to Employee ID in a lookup sheet to bring in their Department.\n\nUse '+ AND' to match on multiple columns at once." }),
          /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", title: lkEnabled ? "Disable this lookup (won't block report)" : "Enable this lookup", children: [
            /* @__PURE__ */ u3("input", { type: "checkbox", checked: lkEnabled, onChange: (e3) => handleEnabledChange(e3.target.checked) }),
            /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: lkEnabled ? "Enabled" : "Disabled" })
          ] })
        ] }),
        lkVMsg && /* @__PURE__ */ u3("div", { class: "pl-lookup-error", children: [
          lkVBlocked ? "⛔" : "⚠",
          " ",
          lkVMsg
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-lookup-header", children: [
          /* @__PURE__ */ u3("select", { value: lk.rightId || "", onChange: (e3) => handleRightIdChange(e3.target.value), children: [
            /* @__PURE__ */ u3("option", { value: "", children: [
              "—",
              " pick a sheet ",
              "—"
            ] }),
            sortedIds.filter((id) => id !== base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id)).map((id) => /* @__PURE__ */ u3("option", { value: id, children: tables[id].name }, id))
          ] }),
          /* @__PURE__ */ u3("button", { class: "btn btn-danger", style: "flex-shrink:0", onClick: removeLookup, children: "✕" })
        ] }),
        rt && /* @__PURE__ */ u3("div", { class: "pl-lookup-keys", children: [
          pairs.map((pair, pi) => /* @__PURE__ */ u3("div", { class: "pl-key-pair", children: [
            /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: pi === 0 ? "Where" : "AND" }),
            /* @__PURE__ */ u3("select", { value: pair.left || "", onChange: (e3) => handleKpLeftChange(pi, e3.target.value), children: [
              /* @__PURE__ */ u3("option", { value: "", children: [
                "—",
                " column ",
                "—"
              ] }),
              leftCols.map((c3) => {
                const src = lkColMap.get(c3);
                const label = src && src.kind !== "calc" ? colUserLabel(src.tid, src.col) : c3;
                return /* @__PURE__ */ u3("option", { value: c3, children: label }, c3);
              })
            ] }),
            /* @__PURE__ */ u3("span", { class: "pl-lookup-eq", children: "=" }),
            /* @__PURE__ */ u3("select", { value: pair.right || "", onChange: (e3) => handleKpRightChange(pi, e3.target.value), children: [
              /* @__PURE__ */ u3("option", { value: "", children: [
                "—",
                " column ",
                "—"
              ] }),
              rightCols.map((c3) => /* @__PURE__ */ u3("option", { value: c3, children: `${tables[lk.rightId]?.name || lk.rightId} → ${colUserLabel(lk.rightId, c3)}` }, c3))
            ] }),
            pairs.length > 1 && /* @__PURE__ */ u3("button", { class: "pl-rm-kp", title: "Remove this condition", onClick: () => removeKeyPair(pi), children: "✕" })
          ] }, pi)),
          /* @__PURE__ */ u3("button", { class: "btn btn-ghost pl-add-kp", onClick: addKeyPair, children: [
            "＋",
            " AND ",
            "…"
          ] })
        ] }),
        rt && /* @__PURE__ */ u3("div", { class: "pl-lookup-required", children: [
          /* @__PURE__ */ u3("span", { style: "flex-shrink:0", children: "If no match:" }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `lkreq_${i3}`, value: "0", checked: !lk.required, onChange: (e3) => handleRequiredChange(e3.target.value) }),
            " Leave blank"
          ] }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `lkreq_${i3}`, value: "1", checked: lk.required, onChange: (e3) => handleRequiredChange(e3.target.value) }),
            " Skip row"
          ] }),
          /* @__PURE__ */ u3(Tip, { text: "Leave blank: keep all rows from your main sheet, even if there is no match in the lookup sheet (the column will just be empty).\n\nSkip row: only keep rows that have a match — rows without a match are removed entirely." })
        ] }),
        rt && /* @__PURE__ */ u3("div", { class: "pl-lookup-required", children: [
          /* @__PURE__ */ u3("span", { style: "flex-shrink:0", children: "Duplicate keys:" }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `lkdup_${i3}`, value: "block", checked: (lk.duplicatePolicy?.mode ?? "block") !== "combine", onChange: (e3) => handleDupModeChange(e3.target.value) }),
            " Block (error)"
          ] }),
          /* @__PURE__ */ u3("label", { children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: `lkdup_${i3}`, value: "combine", checked: lk.duplicatePolicy?.mode === "combine", onChange: (e3) => handleDupModeChange(e3.target.value) }),
            " Combine values"
          ] }),
          /* @__PURE__ */ u3(Tip, { text: "Block: the report cannot run if the same key appears more than once in the lookup sheet. Use this when each match should be unique.\n\nCombine: if there are multiple matches, join them together into one cell separated by semicolons. For example: 'Tag1; Tag2; Tag3'." })
        ] }),
        rt && /* @__PURE__ */ u3("div", { class: "pl-lookup-cols", children: [
          /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center", children: "Bring in:" }),
          /* @__PURE__ */ u3(Tip, { text: "These are the columns from the lookup sheet. Click a chip to include or exclude it from the report. Right-click any chip to rename it." }),
          rt.cols.map((c3) => {
            const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c3, lkColMap, aggMode);
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
                tooltip: _sampleTipFor(lk.rightId, c3, ["Click to show or hide this lookup column in your report."]),
                dataAttrs: { "data-li": String(i3), "data-lcc": c3 },
                onClick: () => {
                  const colMap2 = buildColSourceMap();
                  const visible = _isSourceVisibleInLayout(lk.rightId, c3, colMap2, aggMode);
                  if (visible) _hideLookupLayoutAliasesSafely(lk.rightId, c3, i3);
                  else _showLayoutAliasesForSource(lk.rightId, c3);
                  _afterCombineChange();
                },
                onContextMenu: (e3) => {
                  e3.preventDefault();
                  if (!lk.rightId) return;
                  const colMap2 = buildColSourceMap();
                  let alias = "";
                  for (const [a3, src] of colMap2.entries()) {
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
              },
              c3
            );
          }),
          /* @__PURE__ */ u3("button", { class: "btn btn-ghost", style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0", onClick: selectAllCols, children: "All" }),
          /* @__PURE__ */ u3("button", { class: "btn btn-ghost", style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0", onClick: selectNoneCols, children: "None" })
        ] })
      ] }),
      ctxMenu && /* @__PURE__ */ u3(ContextMenu, { x: ctxMenu.x, y: ctxMenu.y, items: ctxMenu.items, onClose: () => setCtxMenu(null) }),
      renameTarget && /* @__PURE__ */ u3(RenameModal, { target: renameTarget, onDone: () => _afterCombineChange(), onClose: () => setRenameTarget(null) })
    ] });
  }

  // preact/ui/sections/calc-stage.tsx
  init_store();
  init_state();
  init_column_catalog();
  init_alias_ref_updater();

  // preact/core/date-format.ts
  init_store();
  function componentWidth(c3) {
    switch (c3) {
      case "D":
      case "M":
        return 1;
      case "DD":
      case "MM":
      case "YY":
        return 2;
      case "MMM":
        return 3;
      case "YYYY":
        return 4;
      default:
        return 2;
    }
  }
  function isMonth(c3) {
    return c3.startsWith("M");
  }
  function isDay(c3) {
    return c3.startsWith("D");
  }
  function isYear(c3) {
    return c3.startsWith("Y");
  }
  function monthToNumExpr(expr) {
    return `(CASE UPPER(${expr}) WHEN 'JAN' THEN '01' WHEN 'FEB' THEN '02' WHEN 'MAR' THEN '03' WHEN 'APR' THEN '04' WHEN 'MAY' THEN '05' WHEN 'JUN' THEN '06' WHEN 'JUL' THEN '07' WHEN 'AUG' THEN '08' WHEN 'SEP' THEN '09' WHEN 'OCT' THEN '10' WHEN 'NOV' THEN '11' WHEN 'DEC' THEN '12' ELSE '01' END)`;
  }
  function normalizeDateExpr(colExpr, format) {
    if (!format) return colExpr;
    const w1 = componentWidth(format.first);
    const w22 = componentWidth(format.second);
    const w3 = componentWidth(format.third);
    const p1 = 1;
    const p22 = p1 + w1 + 1;
    const p3 = p22 + w22 + 1;
    const extract = (pos, width) => `substr(${colExpr}, ${pos}, ${width})`;
    const v1 = extract(p1, w1);
    const v22 = extract(p22, w22);
    const v3 = extract(p3, w3);
    const parts = [
      { comp: format.first, expr: v1 },
      { comp: format.second, expr: v22 },
      { comp: format.third, expr: v3 }
    ];
    const yearPart = parts.find((p4) => isYear(p4.comp));
    const monthPart = parts.find((p4) => isMonth(p4.comp));
    const dayPart = parts.find((p4) => isDay(p4.comp));
    if (!yearPart || !monthPart || !dayPart) return colExpr;
    let yearExpr = yearPart.expr;
    if (yearPart.comp === "YY") yearExpr = `'20' || ${yearExpr}`;
    let monthExpr = monthPart.expr;
    if (monthPart.comp === "MMM") monthExpr = monthToNumExpr(monthExpr);
    else if (monthPart.comp === "M") monthExpr = `printf('%02d', CAST(${monthExpr} AS INTEGER))`;
    let dayExpr = dayPart.expr;
    if (dayPart.comp === "D") dayExpr = `printf('%02d', CAST(${dayExpr} AS INTEGER))`;
    return `${yearExpr} || '-' || ${monthExpr} || '-' || ${dayExpr}`;
  }
  function getDateInputFormat(date) {
    if (!date?.inputFormat) return null;
    const { first, second, third } = date.inputFormat;
    if (!first || !second || !third) return null;
    return { first, second, third };
  }
  var RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|\s|$)/;
  function isISODate(values) {
    let iso = 0;
    let total = 0;
    for (const v3 of values) {
      const s3 = v3.trim();
      if (!s3) continue;
      total++;
      if (RE_ISO_DATE.test(s3)) iso++;
    }
    return total > 0 && iso === total;
  }
  function getColumnSamples(tid, col) {
    const tbl = getStore().getState().tables?.[tid];
    const samples = tbl?.samples;
    return samples?.[col] || [];
  }

  // preact/ui/components/calc-builder.tsx
  init_column_catalog();
  function ColSelect({ value, style, onChange, colOpts }) {
    return /* @__PURE__ */ u3("select", { style, value, onChange: (e3) => onChange(e3.target.value), children: [
      /* @__PURE__ */ u3("option", { value: "", children: [
        "—",
        " column ",
        "—"
      ] }),
      colOpts.map((o3) => /* @__PURE__ */ u3("option", { value: o3.value, children: o3.label }, o3.value))
    ] });
  }
  function MathBuilder({ calc, i: i3, cols, colOptsFor, onPropChange }) {
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
    const leftOpts = colOptsFor(leftCol);
    const rightOpts = colOptsFor(rightCol);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:8px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: [
          "Type ",
          /* @__PURE__ */ u3(Tip, { text: "Arithmetic — add, subtract, multiply, or divide two columns.\n\nRolling Avg — a moving average over a sliding window of rows (like a 7-day average).\n\n% of Total — each row's value as a percentage of the grand total." })
        ] }),
        /* @__PURE__ */ u3("select", { style: "width:140px;flex-shrink:0", value: isRollingAvg ? "ROLLAVG" : isPctTotal ? "PCTTOTAL" : "ARITH", onChange: (e3) => onPropChange("mathOp", e3.target.value), children: [
          /* @__PURE__ */ u3("option", { value: "ARITH", children: "Arithmetic" }),
          /* @__PURE__ */ u3("option", { value: "ROLLAVG", children: "Rolling Avg" }),
          /* @__PURE__ */ u3("option", { value: "PCTTOTAL", children: "% of Total" })
        ] })
      ] }),
      !isRollingAvg && !isPctTotal && /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:6px", children: [
        /* @__PURE__ */ u3(ColSelect, { value: leftCol, style: "min-width:160px", onChange: (v3) => onPropChange("leftCol", v3), colOpts: leftOpts }),
        /* @__PURE__ */ u3("select", { style: "width:70px;flex-shrink:0", value: mathOp, onChange: (e3) => onPropChange("mathOperator", e3.target.value), children: [
          /* @__PURE__ */ u3("option", { value: "+", children: "+" }),
          /* @__PURE__ */ u3("option", { value: "-", children: "−" }),
          /* @__PURE__ */ u3("option", { value: "*", children: "×" }),
          /* @__PURE__ */ u3("option", { value: "/", children: "÷" })
        ] }),
        /* @__PURE__ */ u3(ColSelect, { value: rightCol, style: "min-width:160px", onChange: (v3) => onPropChange("rightCol", v3), colOpts: rightOpts })
      ] }),
      isRollingAvg && /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:6px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: "Source" }),
        /* @__PURE__ */ u3(ColSelect, { value: leftCol, style: "min-width:190px", onChange: (v3) => onPropChange("leftCol", v3), colOpts: leftOpts }),
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", style: "margin-left:6px", children: [
          "Window ",
          /* @__PURE__ */ u3(Tip, { text: "How many rows to include in the moving average.\n\nFor example, 7 means the average of the current row and the 6 rows above it — like a 7-day moving average." })
        ] }),
        /* @__PURE__ */ u3(
          "input",
          {
            type: "number",
            min: "1",
            step: "1",
            value: windowVal,
            style: "width:80px;flex-shrink:0",
            onChange: (e3) => onPropChange("window", e3.target.value)
          }
        )
      ] }),
      isPctTotal && /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:6px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: [
          "Source ",
          /* @__PURE__ */ u3(Tip, { text: "The column whose values will be expressed as a percentage of the total. Each row will show what share of the grand total it represents." })
        ] }),
        /* @__PURE__ */ u3(ColSelect, { value: leftCol, style: "min-width:190px", onChange: (v3) => onPropChange("leftCol", v3), colOpts: leftOpts })
      ] })
    ] });
  }
  function TextEditBuilder({ calc, i: i3, cols, colOptsFor, onPropChange }) {
    const text = calc.text;
    const op = text?.operation || "combine";
    if (op === "combine") {
      const parts = text?.parts || [];
      return /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3("div", { style: "margin-top:8px;font-size:0.76rem;color:var(--muted)", children: [
          "Combine parts: ",
          parts.length,
          " part(s)"
        ] }),
        /* @__PURE__ */ u3("div", { style: "margin-top:4px;font-size:0.7rem;color:var(--muted)", children: "Edit via report setup file for complex combinations." })
      ] });
    }
    if (op === "left" || op === "right") {
      const src = text?.source;
      const srcCol = src?.type === "column" ? src.value || "" : "";
      const count = text?.count || 1;
      return /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:8px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: "Source" }),
        /* @__PURE__ */ u3(ColSelect, { value: srcCol, style: "min-width:190px", onChange: (v3) => onPropChange("textSource", v3), colOpts: colOptsFor(srcCol) }),
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", style: "margin-left:6px", children: "Count" }),
        /* @__PURE__ */ u3(
          "input",
          {
            type: "number",
            min: "1",
            step: "1",
            value: count,
            style: "width:80px;flex-shrink:0",
            onChange: (e3) => onPropChange("textCount", e3.target.value)
          }
        )
      ] });
    }
    if (op === "substring") {
      const src = text?.source;
      const srcCol = src?.type === "column" ? src.value || "" : "";
      const start = text?.start || 1;
      const length = text?.length || 1;
      return /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:8px", children: [
          /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: "Source" }),
          /* @__PURE__ */ u3(ColSelect, { value: srcCol, style: "min-width:190px", onChange: (v3) => onPropChange("textSource", v3), colOpts: colOptsFor(srcCol) })
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:4px", children: [
          /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: "Start" }),
          /* @__PURE__ */ u3(
            "input",
            {
              type: "number",
              min: "1",
              step: "1",
              value: start,
              style: "width:80px;flex-shrink:0",
              onChange: (e3) => onPropChange("textStart", e3.target.value)
            }
          ),
          /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", style: "margin-left:6px", children: "Length" }),
          /* @__PURE__ */ u3(
            "input",
            {
              type: "number",
              min: "1",
              step: "1",
              value: length,
              style: "width:80px;flex-shrink:0",
              onChange: (e3) => onPropChange("textLength", e3.target.value)
            }
          )
        ] })
      ] });
    }
    return /* @__PURE__ */ u3(S, {});
  }
  var COND_OPS = ["=", "!=", ">", ">=", "<", "<="];
  function CompareBuilder({ calc, i: i3, cols, colOptsFor, onPropChange, onCondChange }) {
    const compare = calc.compare;
    const glue = compare?.compareMode || "AND";
    const conditions = compare?.conditions || [];
    const trueVal = compare?.trueValue;
    const falseVal = compare?.falseValue;
    const handleCondChange = (j4, prop, val) => {
      if (onCondChange) onCondChange(j4, prop, val);
    };
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:8px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: [
          "Match ",
          /* @__PURE__ */ u3(Tip, { text: "ALL — every condition must be true (like AND in Excel).\n\nANY — at least one condition must be true (like OR in Excel)." })
        ] }),
        /* @__PURE__ */ u3("select", { style: "width:80px;flex-shrink:0", value: glue, onChange: (e3) => onPropChange("compareMode", e3.target.value), children: [
          /* @__PURE__ */ u3("option", { value: "AND", children: "ALL" }),
          /* @__PURE__ */ u3("option", { value: "OR", children: "ANY" })
        ] }),
        /* @__PURE__ */ u3("span", { style: "font-size:0.72rem;color:var(--muted)", children: "of these conditions:" })
      ] }),
      conditions.map((cond, j4) => /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: `margin-top:${j4 === 0 ? "6px" : "4px"}`, children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: j4 === 0 ? "Where" : glue }),
        /* @__PURE__ */ u3(ColSelect, { value: cond.col || "", style: "min-width:140px", onChange: (v3) => handleCondChange(j4, "col", v3), colOpts: colOptsFor(cond.col || "") }),
        /* @__PURE__ */ u3("select", { style: "width:62px;flex-shrink:0", value: cond.op || "=", onChange: (e3) => handleCondChange(j4, "op", e3.target.value), children: COND_OPS.map((o3) => /* @__PURE__ */ u3("option", { value: o3, children: o3 }, o3)) }),
        /* @__PURE__ */ u3(
          "input",
          {
            type: "text",
            placeholder: "value",
            value: cond.val || "",
            style: "min-width:100px",
            onChange: (e3) => handleCondChange(j4, "val", e3.target.value)
          }
        )
      ] }, j4)),
      /* @__PURE__ */ u3("div", { style: "margin-top:6px;font-size:0.72rem;color:var(--muted)", children: [
        "Returns: ",
        trueVal?.type === "text" ? `"${trueVal.value || ""}"` : trueVal?.value || "1",
        " if match, ",
        falseVal?.type === "text" ? `"${falseVal.value || ""}"` : falseVal?.value || "0",
        " if not"
      ] })
    ] });
  }
  var FMT_OPTS = [["D", "D"], ["DD", "DD"], ["M", "M"], ["MM", "MM"], ["MMM", "MMM"], ["YY", "YY"], ["YYYY", "YYYY"]];
  function DateBuilder({ calc, i: i3, cols, colOptsFor, onPropChange }) {
    const date = calc.date;
    const src = date?.source;
    const srcCol = src?.type === "column" ? src.value || "" : "";
    const part = date?.part || "year";
    const output = date?.output || "text";
    const fmt = date?.inputFormat || {};
    const fmtFirst = fmt.first || "MM";
    const fmtSecond = fmt.second || "DD";
    const fmtThird = fmt.third || "YYYY";
    const [isoDetected, setIsoDetected] = d2(false);
    y2(() => {
      if (!srcCol) {
        setIsoDetected(false);
        return;
      }
      const colMap = buildColSourceMap();
      const entry = colMap.get(srcCol);
      if (entry && entry.kind !== "calc") {
        const samples = getColumnSamples(entry.tid, entry.col);
        setIsoDetected(isISODate(samples));
      } else {
        setIsoDetected(false);
      }
    }, [srcCol]);
    const textOnly = part === "year" || part === "week";
    const srcOpts = colOptsFor(srcCol);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:8px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: "Source" }),
        /* @__PURE__ */ u3(ColSelect, { value: srcCol, style: "min-width:190px", onChange: (v3) => onPropChange("dateSource", v3), colOpts: srcOpts })
      ] }),
      isoDetected ? /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:4px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: "Input format" }),
        /* @__PURE__ */ u3("span", { style: "font-size:0.72rem;color:var(--green)", children: "ISO (auto-detected)" })
      ] }) : /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:4px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: [
          "Input format ",
          /* @__PURE__ */ u3("span", { class: "tip", "data-tip": "D = day (1-9)\nDD = day (01-09)\nM = month (1-9)\nMM = month (01-09)\nMMM = month name (Jan, Feb, ...)\nYY = 2-digit year (23)\nYYYY = 4-digit year (2023)\n\nPick the order your dates use.\nExample: 12/25/2023 → MM/DD/YYYY\nExample: 25-Dec-2023 → DD/MMM/YYYY", children: "?" })
        ] }),
        /* @__PURE__ */ u3("div", { style: "display:flex;gap:2px;align-items:center", children: [
          /* @__PURE__ */ u3("select", { style: "width:65px", value: fmtFirst, onChange: (e3) => onPropChange("dateFmtFirst", e3.target.value), children: FMT_OPTS.map(([val, label]) => /* @__PURE__ */ u3("option", { value: val, children: label }, val)) }),
          /* @__PURE__ */ u3("span", { style: "color:var(--muted)", children: "/" }),
          /* @__PURE__ */ u3("select", { style: "width:65px", value: fmtSecond, onChange: (e3) => onPropChange("dateFmtSecond", e3.target.value), children: FMT_OPTS.map(([val, label]) => /* @__PURE__ */ u3("option", { value: val, children: label }, val)) }),
          /* @__PURE__ */ u3("span", { style: "color:var(--muted)", children: "/" }),
          /* @__PURE__ */ u3("select", { style: "width:65px", value: fmtThird, onChange: (e3) => onPropChange("dateFmtThird", e3.target.value), children: FMT_OPTS.map(([val, label]) => /* @__PURE__ */ u3("option", { value: val, children: label }, val)) })
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:4px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: "Extract" }),
        /* @__PURE__ */ u3("select", { style: "width:140px;flex-shrink:0", value: part, onChange: (e3) => onPropChange("datePart", e3.target.value), children: [
          /* @__PURE__ */ u3("option", { value: "year", children: "Year" }),
          /* @__PURE__ */ u3("option", { value: "month", children: "Month" }),
          /* @__PURE__ */ u3("option", { value: "day", children: "Day" }),
          /* @__PURE__ */ u3("option", { value: "dow", children: "Day of Week" }),
          /* @__PURE__ */ u3("option", { value: "week", children: "Week" }),
          /* @__PURE__ */ u3("option", { value: "quarter", children: "Quarter" }),
          /* @__PURE__ */ u3("option", { value: "julian", children: "Julian Date" })
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "pl-key-pair", style: "margin-top:4px", children: [
        /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: "Format" }),
        /* @__PURE__ */ u3("div", { class: "tab-row", style: "margin-left:0", children: [
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3(
              "input",
              {
                type: "radio",
                name: `dateOutput_${i3}`,
                value: "number",
                checked: output === "number",
                onChange: (e3) => onPropChange("dateOutput", e3.target.value)
              }
            ),
            /* @__PURE__ */ u3("span", { children: "Number" })
          ] }),
          /* @__PURE__ */ u3("label", { class: `tab-opt${textOnly ? " tab-opt--disabled" : ""}`, children: [
            /* @__PURE__ */ u3(
              "input",
              {
                type: "radio",
                name: `dateOutput_${i3}`,
                value: "short",
                checked: output === "short",
                disabled: textOnly,
                onChange: (e3) => onPropChange("dateOutput", e3.target.value)
              }
            ),
            /* @__PURE__ */ u3("span", { children: "Short" })
          ] }),
          /* @__PURE__ */ u3("label", { class: `tab-opt${textOnly ? " tab-opt--disabled" : ""}`, children: [
            /* @__PURE__ */ u3(
              "input",
              {
                type: "radio",
                name: `dateOutput_${i3}`,
                value: "text",
                checked: output === "text" && !textOnly,
                disabled: textOnly,
                onChange: (e3) => onPropChange("dateOutput", e3.target.value)
              }
            ),
            /* @__PURE__ */ u3("span", { children: "Full" })
          ] })
        ] })
      ] })
    ] });
  }
  var calcModeComponents = {
    math: MathBuilder,
    text: TextEditBuilder,
    compare: CompareBuilder,
    date: DateBuilder
  };

  // preact/ui/sections/calc-stage.tsx
  function CalcStageSection({ i: i3 }) {
    const [state, setState] = d2(getStore().getState());
    const [ctxMenu, setCtxMenu] = d2(null);
    const [renameTarget, setRenameTarget] = d2(null);
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const calc = state.calcStages[i3];
    if (!calc) return null;
    const aggMode = state.aggMode || "none";
    const alias = (calc.alias || "").trim();
    const mode = calc.mode || "math";
    const reportSpec = buildReportSpecFromState(state);
    const sourceCatalog = buildSourceCatalog(state.tables);
    const cols = projectedCols(reportSpec, sourceCatalog);
    const colMap = buildColSourceMap();
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
    const updateCalc = q2((updater) => {
      getStore().update((draft) => {
        const calcDraft = draft.calcStages[i3];
        if (calcDraft) updater(calcDraft);
      });
      _afterCombineChange();
    }, [i3]);
    const handleEnabledChange = q2((checked) => {
      const wasEnabled = calc.enabled !== false;
      updateCalc((calcDraft) => {
        calcDraft.enabled = checked;
        const calcAlias = (calcDraft.alias || "").trim();
        if (!calcAlias) return;
        if (wasEnabled && !checked) {
          const storeState = getStore().getState();
          if (storeState.selCols instanceof Set && _isAliasVisibleInLayout(calcAlias, storeState.aggMode || "none")) {
            calcDraft._prevSelState = true;
            _disabledCardCols.add(calcAlias);
          } else {
            calcDraft._prevSelState = false;
          }
        } else if (!wasEnabled && checked) {
          const storeState = getStore().getState();
          if (calcDraft._prevSelState && storeState.selCols instanceof Set) {
            storeState.selCols.add(calcAlias);
            _disabledCardCols.delete(calcAlias);
          }
          delete calcDraft._prevSelState;
        }
      });
    }, [i3, calc.enabled, updateCalc]);
    const handleAliasChange = q2((val) => {
      const oldAlias = (calc.alias || "").trim();
      updateCalc((calcDraft) => {
        calcDraft.alias = val;
      });
      const newAlias = val.trim();
      if (oldAlias && newAlias && oldAlias !== newAlias) _renameProjectedAliasRefs(oldAlias, newAlias);
    }, [i3, calc.alias, updateCalc]);
    const handleModeChange = q2((newMode) => {
      updateCalc((calcDraft) => {
        calcDraft.mode = newMode;
        delete calcDraft.math;
        delete calcDraft.compare;
        delete calcDraft.text;
        delete calcDraft.date;
        const modeDefaults = {
          math: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] }),
          text: () => ({ operation: "combine", parts: [{ type: "column", value: "" }] }),
          compare: () => ({ compareMode: "AND", conditions: [{ col: "", op: "=", val: "" }], trueValue: { type: "number", value: "1" }, falseValue: { type: "number", value: "0" } }),
          date: () => ({ operation: "extract", source: { type: "column", value: "" }, part: "year", output: "number" })
        };
        calcDraft[newMode] = modeDefaults[newMode]();
      });
    }, [updateCalc]);
    const handlePropChange = q2((prop, val) => {
      updateCalc((calcDraft) => {
        switch (prop) {
          case "mathOp": {
            calcDraft.mathOp = val;
            const defaults = {
              ARITH: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }, { type: "column", value: "", op: "+" }] }),
              ROLLAVG: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }] }),
              PCTTOTAL: () => ({ strategy: "stepChain", steps: [{ type: "column", value: "" }] })
            };
            calcDraft.math = defaults[val]?.();
            break;
          }
          case "mathOperator": {
            const math = calcDraft.math;
            if (math?.steps) {
              if (math.steps.length < 2) math.steps.push({ type: "column", value: "", op: val });
              else math.steps[1].op = val;
            }
            break;
          }
          case "leftCol": {
            const math = calcDraft.math;
            if (math?.steps && math.steps.length > 0) math.steps[0] = { type: "column", value: val };
            break;
          }
          case "rightCol": {
            const math = calcDraft.math;
            if (math?.steps) {
              if (math.steps.length < 2) math.steps.push({ type: "column", value: "", op: "+" });
              math.steps[1] = { ...math.steps[1], type: "column", value: val };
            }
            break;
          }
          case "window":
            calcDraft.window = String(Math.max(1, parseInt(val, 10) || 7));
            break;
          case "textSource": {
            const text = calcDraft.text;
            if (text) text.source = { type: "column", value: val };
            break;
          }
          case "textCount": {
            const text = calcDraft.text;
            if (text) text.count = Math.max(1, parseInt(val, 10) || 1);
            break;
          }
          case "textStart": {
            const text = calcDraft.text;
            if (text) text.start = Math.max(1, parseInt(val, 10) || 1);
            break;
          }
          case "textLength": {
            const text = calcDraft.text;
            if (text) text.length = Math.max(1, parseInt(val, 10) || 1);
            break;
          }
          case "compareMode": {
            const compare = calcDraft.compare;
            if (compare) compare.compareMode = val;
            break;
          }
          case "dateSource": {
            const date = calcDraft.date;
            if (date) date.source = { type: "column", value: val };
            break;
          }
          case "datePart": {
            const date = calcDraft.date;
            if (date) {
              date.part = val;
              if ((val === "year" || val === "week") && date.output !== "number") date.output = "number";
            }
            break;
          }
          case "dateOutput": {
            const date = calcDraft.date;
            if (date) date.output = val;
            break;
          }
          case "dateFmtFirst":
          case "dateFmtSecond":
          case "dateFmtThird": {
            if (!calcDraft.date) calcDraft.date = {};
            const date = calcDraft.date;
            if (!date.inputFormat) date.inputFormat = {};
            const key = prop === "dateFmtFirst" ? "first" : prop === "dateFmtSecond" ? "second" : "third";
            date.inputFormat[key] = val;
            break;
          }
        }
      });
    }, [updateCalc]);
    const handleCondChange = q2((j4, prop, val) => {
      updateCalc((calcDraft) => {
        const compare = calcDraft.compare;
        if (!compare?.conditions?.[j4]) return;
        const cond = compare.conditions[j4];
        switch (prop) {
          case "col":
            cond.col = val;
            break;
          case "op":
            cond.op = val;
            break;
          case "val":
            cond.val = val;
            break;
        }
      });
    }, [updateCalc]);
    const removeCalcStage = q2(() => {
      getStore().update((draft) => {
        draft.calcStages.splice(i3, 1);
      });
      _afterCombineChange();
    }, [i3]);
    const colOptsFor = q2((sel) => cols.filter((c3) => c3 !== alias).map((c3) => {
      const src = colMap.get(c3);
      const label = src && src.kind !== "calc" ? colUserLabel(src.tid, src.col) : c3;
      return { value: c3, label, selected: sel === c3 };
    }), [cols, alias, colMap]);
    const Builder = calcModeComponents[mode];
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: stageClasses, children: [
        /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: [
          "Calculated column ",
          /* @__PURE__ */ u3(Tip, { text: "Create a virtual column from existing columns — it does not change your source data.\n\n• Math: add, subtract, multiply, divide columns, or compute rolling averages and percentages\n• Text: join, trim, or extract parts of text\n• Compare: if/then logic — return one value if a condition is met, another if not\n• Date: pull out the year, month, day, or other parts from a date column" }),
          /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", title: calcEnabled ? "Disable this calculated column" : "Enable this calculated column", children: [
            /* @__PURE__ */ u3("input", { type: "checkbox", checked: calcEnabled, onChange: (e3) => handleEnabledChange(e3.target.checked) }),
            /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: calcEnabled ? "Enabled" : "Disabled" })
          ] })
        ] }),
        calcVMsg && /* @__PURE__ */ u3("div", { class: "pl-lookup-error", children: [
          calcVBlocked ? "⛔" : "⚠",
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
              onChange: (e3) => handleAliasChange(e3.target.value)
            }
          ),
          /* @__PURE__ */ u3("button", { class: "btn btn-danger", style: "flex-shrink:0", onClick: removeCalcStage, children: "✕" })
        ] }),
        /* @__PURE__ */ u3("div", { class: "tab-row", style: "margin-top:8px", children: ["math", "text", "compare", "date"].map((m3) => /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
          /* @__PURE__ */ u3("input", { type: "radio", name: `calcMode_${i3}`, value: m3, checked: mode === m3, onChange: () => handleModeChange(m3) }),
          /* @__PURE__ */ u3("span", { children: m3.charAt(0).toUpperCase() + m3.slice(1) })
        ] }, m3)) }),
        /* @__PURE__ */ u3(Builder, { calc, i: i3, cols, colOptsFor, onPropChange: handlePropChange, onCondChange: handleCondChange }),
        alias && /* @__PURE__ */ u3("div", { class: "pl-lookup-cols", style: "margin-top:8px", children: [
          /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center", children: "Output:" }),
          /* @__PURE__ */ u3(Tip, { text: "This chip represents your new calculated column. Double-click it to show or hide it in the report. Right-click to rename it — the name field above will update too." }),
          /* @__PURE__ */ u3(
            Chip,
            {
              col: alias,
              label: (() => {
                const src = colMap.get(alias);
                return src && src.kind !== "calc" ? colUserLabel(src.tid, src.col) : alias;
              })(),
              selected: _isAliasVisibleInLayout(alias, aggMode),
              draggable: false,
              chipClass: "pl-col-chip",
              dataAttrs: { "data-ci": String(i3), "data-ccc": alias },
              onClick: () => {
                getStore().update((draft) => {
                  if (!draft.selCols) {
                    const rs = buildReportSpecFromState(draft);
                    const sc = buildSourceCatalog(draft.tables);
                    draft.selCols = new Set(projectedCols(rs, sc));
                  }
                  const s3 = draft.selCols;
                  if (s3.has(alias)) s3.delete(alias);
                  else s3.add(alias);
                });
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
                      if (target) setRenameTarget(target);
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

  // preact/ui/sections/detail-band-stage.tsx
  init_store();
  init_state();
  init_column_catalog();
  function DetailBandStage({ i: i3, sortedIds, usedAsLookup, usedAsStack, usedAsBase }) {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    y2(() => {
      const band2 = getStore().getState().detailBands[i3];
      if (band2 && (!Array.isArray(band2.keyPairs) || !band2.keyPairs.length)) {
        getStore().update((draft) => {
          if (draft.detailBands[i3] && (!Array.isArray(draft.detailBands[i3].keyPairs) || !draft.detailBands[i3].keyPairs.length)) {
            draft.detailBands[i3].keyPairs = [{ left: "", right: "" }];
          }
        });
        invalidateValidation();
      }
    }, [i3]);
    const band = state.detailBands[i3];
    if (!band) return null;
    const tables = state.tables;
    const rt = band.rightId && tables[band.rightId] ? tables[band.rightId] : null;
    const lookupCount = (state.lookups || []).length;
    const reportSpec = buildReportSpecFromState(state);
    const sourceCatalog = buildSourceCatalog(tables);
    const leftCols = projectedColsUpToLookup(lookupCount, reportSpec, sourceCatalog);
    const rightCols = rt ? rt.cols : [];
    const pairs = band.keyPairs || [{ left: "", right: "" }];
    const bandColorCls = band.rightId ? getTableColorClass(band.rightId) : "";
    const lkColMap = buildColSourceMap();
    const bandEnabled = band.enabled !== false;
    const bandV = getValidation().items[`detailband_${i3}`];
    const bandVBlocked = bandV && bandV.blocking;
    const bandVUnresolved = bandV && !bandV.resolved;
    const bandVMsg = bandVUnresolved && bandV.issues[0] ? bandV.issues[0].message : null;
    const usedAsBand = new Set(
      (state.detailBands || []).map((b2, idx) => idx !== i3 ? b2.rightId : "").filter(Boolean)
    );
    const stageClasses = [
      "pl-band-stage",
      bandVBlocked ? "pl-band-stage--invalid" : "",
      bandVUnresolved && !bandEnabled ? "pl-band-stage--disabled-issue" : "",
      !bandEnabled ? "pl-stage-disabled" : ""
    ].filter(Boolean).join(" ");
    const updateBand = q2((updater) => {
      getStore().update((draft) => {
        const bandDraft = draft.detailBands[i3];
        if (bandDraft) updater(draft, bandDraft);
      });
      invalidateValidation();
    }, [i3]);
    const handleRightIdChange = q2((val) => {
      updateBand((_draft, bandDraft) => {
        bandDraft.rightId = val;
        bandDraft.keyPairs = [{ left: "", right: "" }];
        bandDraft.cols = [];
      });
    }, [updateBand]);
    const handleEnabledChange = q2((checked) => {
      updateBand((_d, bandDraft) => {
        bandDraft.enabled = checked;
      });
    }, [updateBand]);
    const handleKpLeftChange = q2((pi, val) => {
      updateBand((_draft, bandDraft) => {
        if (!Array.isArray(bandDraft.keyPairs)) bandDraft.keyPairs = [{ left: "", right: "" }];
        if (!bandDraft.keyPairs[pi]) bandDraft.keyPairs[pi] = { left: "", right: "" };
        bandDraft.keyPairs[pi].left = val;
      });
    }, [updateBand]);
    const handleKpRightChange = q2((pi, val) => {
      updateBand((_draft, bandDraft) => {
        if (!Array.isArray(bandDraft.keyPairs)) bandDraft.keyPairs = [{ left: "", right: "" }];
        if (!bandDraft.keyPairs[pi]) bandDraft.keyPairs[pi] = { left: "", right: "" };
        bandDraft.keyPairs[pi].right = val;
      });
    }, [updateBand]);
    const removeKeyPair = q2((pi) => {
      updateBand((_draft, bandDraft) => {
        bandDraft.keyPairs.splice(pi, 1);
      });
    }, [updateBand]);
    const addKeyPair = q2(() => {
      updateBand((_draft, bandDraft) => {
        if (!Array.isArray(bandDraft.keyPairs)) bandDraft.keyPairs = [];
        bandDraft.keyPairs.push({ left: "", right: "" });
      });
    }, [updateBand]);
    const removeBand = q2(() => {
      getStore().update((draft) => {
        draft.detailBands.splice(i3, 1);
      });
      invalidateValidation();
    }, [i3]);
    const toggleCol = q2((col) => {
      updateBand((_draft, bandDraft) => {
        const rtCols = bandDraft.rightId && _draft.tables[bandDraft.rightId] ? _draft.tables[bandDraft.rightId].cols : [];
        let cols = bandDraft.cols;
        if (!cols || cols.length === 0) {
          cols = rtCols.filter((c3) => c3 !== col);
        } else {
          const idx = cols.indexOf(col);
          if (idx >= 0) {
            cols = cols.filter((c3) => c3 !== col);
          } else {
            cols = [...cols, col];
          }
        }
        bandDraft.cols = cols;
      });
    }, [updateBand]);
    const selectAllCols = q2(() => {
      updateBand((_draft, bandDraft) => {
        bandDraft.cols = [];
      });
    }, [updateBand]);
    const handleLabelChange = q2((val) => {
      updateBand((_draft, bandDraft) => {
        bandDraft.label = val;
      });
    }, [updateBand]);
    const addSort2 = q2(() => {
      updateBand((_draft, bandDraft) => {
        if (!Array.isArray(bandDraft.sorts)) bandDraft.sorts = [];
        bandDraft.sorts.push({ col: "", dir: "ASC", enabled: true });
      });
    }, [updateBand]);
    const removeSort = q2((si) => {
      updateBand((_draft, bandDraft) => {
        if (!Array.isArray(bandDraft.sorts)) return;
        bandDraft.sorts.splice(si, 1);
      });
    }, [updateBand]);
    const handleSortColChange = q2((si, val) => {
      updateBand((_draft, bandDraft) => {
        if (!Array.isArray(bandDraft.sorts) || !bandDraft.sorts[si]) return;
        bandDraft.sorts[si].col = val;
      });
    }, [updateBand]);
    const handleSortDirChange = q2((si, val) => {
      updateBand((_draft, bandDraft) => {
        if (!Array.isArray(bandDraft.sorts) || !bandDraft.sorts[si]) return;
        bandDraft.sorts[si].dir = val;
      });
    }, [updateBand]);
    const handleSortEnabledChange = q2((si, checked) => {
      updateBand((_draft, bandDraft) => {
        if (!Array.isArray(bandDraft.sorts) || !bandDraft.sorts[si]) return;
        bandDraft.sorts[si].enabled = checked;
      });
    }, [updateBand]);
    return /* @__PURE__ */ u3("div", { class: stageClasses, children: [
      /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: [
        "Related Details from ",
        /* @__PURE__ */ u3(Tip, { text: "Add related rows from another sheet beneath each parent row — like sub-report details.\n\nFor example: show each Order followed by its Line Items. Use '+ AND' to match on multiple columns at once." }),
        /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", title: bandEnabled ? "Disable this detail band (won't block report)" : "Enable this detail band", children: [
          /* @__PURE__ */ u3("input", { type: "checkbox", checked: bandEnabled, onChange: (e3) => handleEnabledChange(e3.target.checked) }),
          /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: bandEnabled ? "Enabled" : "Disabled" })
        ] })
      ] }),
      bandVMsg && /* @__PURE__ */ u3("div", { class: "pl-band-error", children: [
        bandVBlocked ? "⛔" : "⚠",
        " ",
        bandVMsg
      ] }),
      /* @__PURE__ */ u3("div", { class: "pl-band-header", children: [
        /* @__PURE__ */ u3("select", { value: band.rightId || "", onChange: (e3) => handleRightIdChange(e3.target.value), children: [
          /* @__PURE__ */ u3("option", { value: "", children: [
            "—",
            " pick a sheet ",
            "—"
          ] }),
          sortedIds.filter(
            (id) => id !== usedAsBase && !usedAsStack.has(id) && (!usedAsLookup.has(id) || id === band.rightId) && (!usedAsBand.has(id) || id === band.rightId)
          ).map((id) => /* @__PURE__ */ u3("option", { value: id, children: tables[id].name }, id))
        ] }),
        /* @__PURE__ */ u3("button", { class: "btn btn-danger", style: "flex-shrink:0", onClick: removeBand, children: "✕" })
      ] }),
      rt && /* @__PURE__ */ u3("div", { class: "pl-band-keys", children: [
        pairs.map((pair, pi) => /* @__PURE__ */ u3("div", { class: "pl-key-pair", children: [
          /* @__PURE__ */ u3("span", { class: "pl-key-pair-label", children: pi === 0 ? "Where" : "AND" }),
          /* @__PURE__ */ u3("select", { value: pair.left || "", onChange: (e3) => handleKpLeftChange(pi, e3.target.value), children: [
            /* @__PURE__ */ u3("option", { value: "", children: [
              "—",
              " column ",
              "—"
            ] }),
            leftCols.map((c3) => {
              const src = lkColMap.get(c3);
              const label = src && src.kind !== "calc" ? colUserLabel(src.tid, src.col) : c3;
              return /* @__PURE__ */ u3("option", { value: c3, children: label }, c3);
            })
          ] }),
          /* @__PURE__ */ u3("span", { class: "pl-band-eq", children: "=" }),
          /* @__PURE__ */ u3("select", { value: pair.right || "", onChange: (e3) => handleKpRightChange(pi, e3.target.value), children: [
            /* @__PURE__ */ u3("option", { value: "", children: [
              "—",
              " column ",
              "—"
            ] }),
            rightCols.map((c3) => /* @__PURE__ */ u3("option", { value: c3, children: `${tables[band.rightId]?.name || band.rightId} → ${colUserLabel(band.rightId, c3)}` }, c3))
          ] }),
          pairs.length > 1 && /* @__PURE__ */ u3("button", { class: "pl-rm-kp", title: "Remove this condition", onClick: () => removeKeyPair(pi), children: "✕" })
        ] }, pi)),
        /* @__PURE__ */ u3("button", { class: "btn btn-ghost pl-add-kp", onClick: addKeyPair, children: [
          "＋",
          " AND ",
          "…"
        ] })
      ] }),
      rt && /* @__PURE__ */ u3("div", { class: "pl-band-cols", children: [
        /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center", children: "Include:" }),
        /* @__PURE__ */ u3(Tip, { text: "These are the columns from the child sheet. Click a chip to include or exclude it from the detail band." }),
        rt.cols.map((c3) => {
          const isSelected = band.cols.length === 0 || band.cols.includes(c3);
          return /* @__PURE__ */ u3(
            Chip,
            {
              col: c3,
              label: colUserLabel(band.rightId, c3),
              selected: isSelected,
              draggable: false,
              chipClass: "pl-col-chip",
              colorClass: bandColorCls,
              tooltip: `Click to ${isSelected ? "exclude" : "include"} this column from the detail band.`,
              dataAttrs: { "data-bi": String(i3), "data-bcc": c3 },
              onClick: () => toggleCol(c3)
            },
            c3
          );
        }),
        /* @__PURE__ */ u3("button", { class: "btn btn-ghost", style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0", onClick: selectAllCols, children: "All" })
      ] }),
      rt && /* @__PURE__ */ u3("div", { class: "pl-band-label-row", children: [
        /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0", children: "Label:" }),
        /* @__PURE__ */ u3(
          "input",
          {
            type: "text",
            class: "pl-band-label-input",
            placeholder: tables[band.rightId]?.name || "Section label",
            value: band.label || "",
            onChange: (e3) => handleLabelChange(e3.target.value),
            style: "font-size:0.72rem;padding:2px 6px;max-width:180px"
          }
        ),
        /* @__PURE__ */ u3(Tip, { text: "Optional label for this detail section. Defaults to the sheet name if left blank." })
      ] }),
      rt && /* @__PURE__ */ u3("div", { class: "pl-band-sorts", children: [
        /* @__PURE__ */ u3("span", { style: "font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center", children: "Sort by:" }),
        /* @__PURE__ */ u3(Tip, { text: "Sort the child rows within each band. Add multiple sort levels for tie-breaking." }),
        (band.sorts || []).map((s3, si) => {
          const sEnabled = s3.enabled !== false;
          return /* @__PURE__ */ u3("div", { class: `sort-row${sEnabled ? "" : " pl-stage-disabled"}`, children: [
            /* @__PURE__ */ u3("span", { class: "sort-level", children: [
              si + 1,
              "."
            ] }),
            /* @__PURE__ */ u3(
              "select",
              {
                value: s3.col,
                style: "flex:1;min-width:0",
                onChange: (e3) => handleSortColChange(si, e3.target.value),
                children: [
                  /* @__PURE__ */ u3("option", { value: "", children: [
                    "—",
                    " column ",
                    "—"
                  ] }),
                  rightCols.map((c3) => /* @__PURE__ */ u3("option", { value: c3, children: colUserLabel(band.rightId, c3) }, c3))
                ]
              }
            ),
            /* @__PURE__ */ u3(
              "select",
              {
                value: s3.dir,
                style: "width:95px;flex-shrink:0",
                onChange: (e3) => handleSortDirChange(si, e3.target.value),
                children: [
                  /* @__PURE__ */ u3("option", { value: "ASC", children: [
                    "↑",
                    " A ",
                    "→",
                    " Z"
                  ] }),
                  /* @__PURE__ */ u3("option", { value: "DESC", children: [
                    "↓",
                    " Z ",
                    "→",
                    " A"
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", title: sEnabled ? "Disable sort" : "Enable sort", children: [
              /* @__PURE__ */ u3("input", { type: "checkbox", checked: sEnabled, onChange: (e3) => handleSortEnabledChange(si, e3.target.checked) }),
              /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: sEnabled ? "" : "Off" })
            ] }),
            /* @__PURE__ */ u3("button", { class: "btn btn-danger", onClick: () => removeSort(si), children: "✕" })
          ] }, si);
        }),
        /* @__PURE__ */ u3("button", { class: "btn btn-ghost", style: "font-size:0.68rem;padding:2px 6px;flex-shrink:0", onClick: addSort2, children: [
          "＋",
          " sort"
        ] })
      ] })
    ] });
  }

  // preact/ui/cards/pipeline-card.tsx
  init_state();
  function PipelineCard() {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const tables = state.tables;
    const base = state.base;
    const lookups = state.lookups || [];
    const calcStages = state.calcStages || [];
    const detailBands = state.detailBands || [];
    const stacks = state.stacks || [];
    const ids = Object.keys(tables);
    const sortedIds = ids.sort((a3, b2) => tables[a3].name.localeCompare(tables[b2].name));
    const usedAsLookup = new Set(lookups.map((l3) => l3.rightId).filter(Boolean));
    const usedAsStack = new Set(stacks);
    const addLookup = q2(() => {
      const currentState = getStore().getState();
      if (!currentState.base) return;
      getStore().update((draft) => {
        if (!draft.lookups) draft.lookups = [];
        draft.lookups.push({
          rightId: "",
          keyPairs: [{ left: "", right: "" }],
          cols: [],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: "block" }
        });
      });
      _afterCombineChange();
    }, []);
    const addCalcStage = q2(() => {
      const currentState = getStore().getState();
      if (!currentState.base) return;
      getStore().update((draft) => {
        if (!draft.calcStages) draft.calcStages = [];
        draft.calcStages.push({
          alias: "",
          mode: "math",
          math: {
            strategy: "stepChain",
            steps: [
              { type: "column", value: "" },
              { type: "column", value: "", op: "+" }
            ]
          },
          enabled: true
        });
      });
      _afterCombineChange();
    }, []);
    const addDetailBand = q2(() => {
      const currentState = getStore().getState();
      if (!currentState.base) return;
      getStore().update((draft) => {
        if (!draft.detailBands) draft.detailBands = [];
        draft.detailBands.push(createDetailBandSpec());
      });
      _afterCombineChange();
    }, []);
    const setBandMode = q2((mode) => {
      getStore().update((draft) => {
        draft.detailBandMode = mode;
      });
      invalidateValidation();
    }, []);
    const hasBase = !!(base && tables[base]);
    const enabledBandCount = detailBands.filter((b2) => b2.enabled !== false).length;
    const dragBandIdx = A2(null);
    const [dragOverIdx, setDragOverIdx] = d2(null);
    const onBandDragStart = q2((idx, e3) => {
      dragBandIdx.current = idx;
      if (e3.dataTransfer) {
        e3.dataTransfer.effectAllowed = "move";
        e3.dataTransfer.setData("text/plain", String(idx));
      }
    }, []);
    const onBandDragOver = q2((idx, e3) => {
      e3.preventDefault();
      if (e3.dataTransfer) e3.dataTransfer.dropEffect = "move";
      setDragOverIdx(idx);
    }, []);
    const onBandDragEnd = q2(() => {
      dragBandIdx.current = null;
      setDragOverIdx(null);
    }, []);
    const onBandDrop = q2((targetIdx, e3) => {
      e3.preventDefault();
      const sourceIdx = dragBandIdx.current;
      if (sourceIdx === null || sourceIdx === targetIdx) {
        setDragOverIdx(null);
        return;
      }
      getStore().update((draft) => {
        if (!draft.detailBands || draft.detailBands.length < 2) return;
        const bands = [...draft.detailBands];
        const [moved] = bands.splice(sourceIdx, 1);
        bands.splice(targetIdx, 0, moved);
        draft.detailBands = bands;
      });
      invalidateValidation();
      _afterCombineChange();
      dragBandIdx.current = null;
      setDragOverIdx(null);
    }, []);
    return /* @__PURE__ */ u3("div", { id: "pipeline", class: "pipeline", children: [
      /* @__PURE__ */ u3("div", { class: "pl-top-pair", children: [
        /* @__PURE__ */ u3(BaseStage, { sortedIds }),
        hasBase && /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("div", { class: "pl-h-arrow", children: [
            /* @__PURE__ */ u3("div", { class: "pl-h-line" }),
            /* @__PURE__ */ u3("div", { class: "pl-h-head" })
          ] }),
          /* @__PURE__ */ u3("div", { class: "pl-v-arrow-stacked", children: [
            /* @__PURE__ */ u3("div", { class: "pl-arrow-line" }),
            /* @__PURE__ */ u3("div", { class: "pl-arrow-head" })
          ] }),
          /* @__PURE__ */ u3("div", { class: "pl-stage", children: [
            /* @__PURE__ */ u3("div", { class: "pl-stage-label", children: [
              "Include rows from ",
              /* @__PURE__ */ u3(Tip, { text: "Add sheets with the same columns to get more rows — like stacking spreadsheets on top of each other. For example: Jan Sales + Feb Sales + Mar Sales." })
            ] }),
            /* @__PURE__ */ u3(StackSheets, { sortedIds, usedAsLookup, usedAsStack })
          ] })
        ] })
      ] }),
      hasBase && /* @__PURE__ */ u3(PipelineArrow, { id: "base" }),
      lookups.map((_lk, i3) => /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3(
          LookupStage,
          {
            i: i3,
            sortedIds,
            usedAsLookup,
            usedAsStack
          }
        ),
        /* @__PURE__ */ u3(PipelineArrow, { id: `lk${i3}` })
      ] }, `lk-${i3}`)),
      calcStages.map((_calc, i3) => /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3(CalcStageSection, { i: i3 }),
        /* @__PURE__ */ u3(PipelineArrow, { id: `calc${i3}` })
      ] }, `calc-${i3}`)),
      enabledBandCount >= 2 && /* @__PURE__ */ u3("div", { class: "pl-band-mode-toggle", style: "display:flex;align-items:center;gap:8px;padding:4px 8px;flex-wrap:wrap", children: [
        /* @__PURE__ */ u3("span", { children: "Multiple bands:" }),
        /* @__PURE__ */ u3("label", { style: "display:inline-flex;align-items:center;gap:2px;cursor:pointer", children: [
          /* @__PURE__ */ u3(
            "input",
            {
              type: "radio",
              name: "bandMode",
              value: "separate",
              checked: state.detailBandMode === "separate",
              onChange: () => setBandMode("separate")
            }
          ),
          "Separate bands (under each row)"
        ] }),
        /* @__PURE__ */ u3("label", { style: "display:inline-flex;align-items:center;gap:2px;cursor:pointer", children: [
          /* @__PURE__ */ u3(
            "input",
            {
              type: "radio",
              name: "bandMode",
              value: "stack",
              checked: state.detailBandMode === "stack",
              onChange: () => setBandMode("stack")
            }
          ),
          "Stack side-by-side (cross-product)"
        ] }),
        /* @__PURE__ */ u3(Tip, { text: "Separate: each parent row is followed by its matching child rows from each band.\n\nStack: child rows from all bands are combined for each parent row (like a cross-product). Warning: this can produce many rows." })
      ] }),
      detailBands.map((_band, i3) => /* @__PURE__ */ u3(
        "div",
        {
          draggable: true,
          onDragStart: (e3) => onBandDragStart(i3, e3),
          onDragOver: (e3) => onBandDragOver(i3, e3),
          onDragEnd: onBandDragEnd,
          onDrop: (e3) => onBandDrop(i3, e3),
          style: dragOverIdx === i3 ? "opacity:0.5;border-top:2px solid var(--accent,#4a9eff)" : "",
          children: [
            /* @__PURE__ */ u3(
              DetailBandStage,
              {
                i: i3,
                sortedIds,
                usedAsLookup,
                usedAsStack,
                usedAsBase: base
              }
            ),
            /* @__PURE__ */ u3(PipelineArrow, { id: `band${i3}` })
          ]
        },
        `band-${i3}`
      )),
      hasBase && /* @__PURE__ */ u3("div", { style: "display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px", children: [
        /* @__PURE__ */ u3("div", { class: "pl-add-btn", onClick: addLookup, children: [
          "＋",
          " Look up columns from another sheet"
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-add-btn", onClick: addCalcStage, children: [
          "＋",
          " Add a calculated column from existing sheets"
        ] }),
        /* @__PURE__ */ u3("div", { class: "pl-add-btn", onClick: addDetailBand, children: [
          "＋",
          " Add related details from another sheet"
        ] })
      ] })
    ] });
  }

  // preact/ui/cards/layout-card.tsx
  init_store();
  init_state();
  init_column_catalog();

  // preact/ui/sections/column-chips.tsx
  init_store();
  init_state();
  init_column_catalog();
  function _buildTooltip(c3, src, state) {
    if (src?.kind === "calc") {
      const calc = state.calcStages?.[src.idx];
      const mode = calc?.mode || "unknown";
      if (mode === "math") {
        const math = calc?.math;
        const steps = math?.steps?.length || 0;
        return `Calculated column: Math (${steps} step${steps !== 1 ? "s" : ""})`;
      } else if (mode === "compare") {
        const compare = calc?.compare;
        const condCount = compare?.conditions?.length || 0;
        const glue = compare?.compareMode || "AND";
        return `Calculated column: Compare (${condCount} condition${condCount !== 1 ? "s" : ""}, ${glue})`;
      } else if (mode === "text") {
        const text = calc?.text;
        return `Calculated column: Text (${text?.operation || "unknown"})`;
      }
      return `Calculated column: ${mode}`;
    }
    if (src) {
      const tbl = state.tables[src.tid];
      const tblAny = tbl;
      const samples = tblAny?.samples;
      const vals = (samples?.[src.col] || []).slice(0, 3);
      const from = `From sheet: ${tbl?.name ?? src.tid}`;
      return vals.length ? `${from}
Sample values: ${vals.map((v3) => String(v3)).join(" · ")}` : `${from}
(no sample values available)`;
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
    let best = null;
    let bestDist = Infinity;
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
  function ColumnChips() {
    const [state, setState] = d2(getStore().getState());
    const containerRef = A2(null);
    const dragColRef = A2(null);
    const [ctxMenu, setCtxMenu] = d2(null);
    const [renameTarget, setRenameTarget] = d2(null);
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    y2(() => {
      const st = getStore().getState();
      if (!st.selCols) {
        const reportSpec2 = buildReportSpecFromState(st);
        const sourceCatalog2 = buildSourceCatalog(st.tables);
        const currentCols = projectedCols(reportSpec2, sourceCatalog2);
        getStore().update((draft) => {
          draft.selCols = new Set(currentCols);
          _seenCols.clear();
          currentCols.forEach((c3) => _seenCols.add(c3));
        });
      }
    }, []);
    y2(() => {
      const st = getStore().getState();
      const reportSpec2 = buildReportSpecFromState(st);
      const sourceCatalog2 = buildSourceCatalog(st.tables);
      const currentCols = projectedCols(reportSpec2, sourceCatalog2);
      if (!st.colOrder) {
        getStore().update((draft) => {
          draft.colOrder = [...currentCols];
        });
      } else {
        const colSet = new Set(currentCols);
        const needsSync = st.colOrder.some((c3) => !colSet.has(c3)) || currentCols.some((c3) => !st.colOrder.includes(c3));
        if (needsSync) {
          getStore().update((draft) => {
            const cs = projectedCols(reportSpec2, sourceCatalog2);
            const currentSet = new Set(cs);
            draft.colOrder = [
              ...(draft.colOrder || []).filter((c3) => currentSet.has(c3)),
              ...cs.filter((c3) => !(draft.colOrder || []).includes(c3))
            ];
          });
        }
        _syncSubtotalByToLayout();
      }
    }, [state.base, state.lookups.length, state.calcStages.length]);
    const base = state.base;
    if (!base) return null;
    const reportSpec = buildReportSpecFromState(state);
    const sourceCatalog = buildSourceCatalog(state.tables);
    const cols = projectedCols(reportSpec, sourceCatalog);
    const colMap = buildColSourceMap();
    const mode = state.aggMode || "none";
    const groupSet = new Set(state.groupBy);
    const showBadges = mode === "group" && groupSet.size > 0;
    const selSet = state.selCols;
    const colOrder = state.colOrder || cols;
    const handleDblClick = q2((col) => {
      const currentMode = getStore().getState().aggMode || "none";
      if (currentMode === "group") {
        getStore().update((draft) => {
          const idx = draft.groupBy.indexOf(col);
          if (idx >= 0) {
            draft.groupBy.splice(idx, 1);
            if (draft.groupBy.length === 0) {
              draft.aggregates = draft.aggregates.filter((a3) => !a3.auto);
            } else if (!draft.aggregates.some((a3) => a3.col === col)) {
              draft.aggregates.push({ fn: smartDefaultFn(col), col, alias: "", auto: true });
            }
          } else {
            draft.groupBy.push(col);
            draft.aggregates = draft.aggregates.filter((a3) => !(a3.auto && a3.col === col));
            const allCols = projectedCols(
              buildReportSpecFromState(draft),
              buildSourceCatalog(draft.tables)
            );
            for (const c3 of allCols) {
              if (!draft.groupBy.includes(c3) && !draft.aggregates.some((a3) => a3.col === c3)) {
                draft.aggregates.push({ fn: smartDefaultFn(c3), col: c3, alias: "", auto: true });
              }
            }
          }
        });
      } else if (currentMode === "subtotals") {
        getStore().update((draft) => {
          const sb = draft.subtotalBy || (draft.subtotalBy = []);
          const idx = sb.indexOf(col);
          if (idx >= 0) {
            sb.splice(idx, 1);
            delete draft.subtotalFns[col];
          } else {
            sb.push(col);
          }
        });
        _syncSubtotalByToLayout();
      } else {
        getStore().update((draft) => {
          if (!draft.selCols) {
            const rs = buildReportSpecFromState(draft);
            const sc = buildSourceCatalog(draft.tables);
            draft.selCols = new Set(projectedCols(rs, sc));
          }
          const s3 = draft.selCols;
          if (s3.has(col)) s3.delete(col);
          else s3.add(col);
        });
      }
      _afterCombineChange();
    }, []);
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
      getStore().update((draft) => {
        if (!draft.colOrder) {
          const rs = buildReportSpecFromState(draft);
          const sc = buildSourceCatalog(draft.tables);
          draft.colOrder = projectedCols(rs, sc);
        }
        const from = draft.colOrder.indexOf(dragCol);
        const to = draft.colOrder.indexOf(nearest.dataset.col);
        if (from < 0 || to < 0) return;
        draft.colOrder.splice(from, 1);
        draft.colOrder.splice(to, 0, dragCol);
      });
      _syncSubtotalByToLayout();
      _afterCombineChange();
    }, []);
    const hint = mode === "group" ? "— double-click to group by · drag to reorder · right-click to rename" : mode === "subtotals" ? "— double-click to group rows · drag to reorder · right-click to rename" : "— double-click to show/hide · drag to reorder · right-click to rename";
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
            const colorCls = src && src.kind !== "calc" ? getTableColorClass(src.tid) : "";
            const label = src && src.kind !== "calc" ? colUserLabel(src.tid, src.col) : c3;
            if (selSet && !selSet.has(c3)) return null;
            const tip = _buildTooltip(c3, src, state);
            if (mode === "group") {
              const isOn2 = groupSet.has(c3);
              const hasAgg = state.aggregates.some((a3) => a3.col === c3);
              const isOrphan = showBadges && !isOn2 && !hasAgg;
              const badge = isOrphan ? "⚠" : "";
              const badgeTip = isOrphan ? "This column has no calculation — it will be left out of the report. Click the ⚠ to add a calculation automatically." : "";
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
              const isOn2 = (state.subtotalBy || []).includes(c3);
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
      ctxMenu && /* @__PURE__ */ u3(ContextMenu, { x: ctxMenu.x, y: ctxMenu.y, items: ctxMenu.items, onClose: () => setCtxMenu(null) }),
      renameTarget && /* @__PURE__ */ u3(RenameModal, { target: renameTarget, onDone: () => _afterCombineChange(), onClose: () => setRenameTarget(null) })
    ] });
  }

  // preact/ui/sections/merge-toggles.tsx
  init_store();
  init_state();
  init_column_catalog();
  function MergeToggles() {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const resultCols = state.result?.cols || null;
    const reportSpec = buildReportSpecFromState(state);
    const sourceCatalog = buildSourceCatalog(state.tables);
    const projected = projectedCols(reportSpec, sourceCatalog);
    const cols = resultCols || projected;
    if (!cols.length) return null;
    const baseDisplayCols = cols.filter((c3) => c3 !== "_rowno" && c3 !== "_row_type" && c3 !== "_isTotalsRow" && c3 !== "_band_id");
    const selCols = state.selCols;
    const visibleDisplayCols = selCols ? baseDisplayCols.filter((c3) => selCols.has(c3)) : baseDisplayCols;
    const colOrder = state.colOrder;
    const orderedFromLayout = colOrder ? colOrder.filter((c3) => visibleDisplayCols.includes(c3)) : [];
    const displayCols = [
      ...orderedFromLayout,
      ...visibleDisplayCols.filter((c3) => !orderedFromLayout.includes(c3))
    ];
    if (!displayCols.length) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "No result columns" });
    }
    const mergedCols = state.mergedCols || [];
    const mergedSet = new Set(mergedCols);
    const colMap = buildColSourceMap();
    const toggle = q2((c3, checked) => {
      getStore().update((draft) => {
        if (!draft.mergedCols) draft.mergedCols = [];
        if (checked) {
          if (!draft.mergedCols.includes(c3)) draft.mergedCols.push(c3);
        } else {
          draft.mergedCols = draft.mergedCols.filter((x3) => x3 !== c3);
        }
      });
    }, []);
    return /* @__PURE__ */ u3("div", { id: "mergeToggles", children: displayCols.map((c3) => {
      const src = colMap.get(c3);
      const label = src && src.kind !== "calc" ? colUserLabel(src.tid, src.col) : c3;
      return /* @__PURE__ */ u3("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;font-weight:normal;margin-top:4px", children: [
        /* @__PURE__ */ u3(
          "input",
          {
            type: "checkbox",
            checked: mergedSet.has(c3),
            onChange: (e3) => toggle(c3, e3.target.checked)
          }
        ),
        label
      ] }, c3);
    }) });
  }
  function setMergeGroupUnderline(checked) {
    getStore().update((draft) => {
      draft.mergeGroupUnderline = !!checked;
    });
  }

  // preact/ui/cards/layout-card.tsx
  function _syncColDisplayLabel(alias, colMap) {
    const src = colMap.get(alias);
    if (!src) return alias;
    if (src.kind === "calc") {
      const calc = getStore().getState().calcStages?.[src.idx];
      return (calc?.alias || "").trim() || alias;
    }
    return tableShortName(src.tid) + " → " + colUserLabel(src.tid, src.col);
  }
  function getHint(mode, state) {
    if (mode === "none") return null;
    if (mode === "group") {
      return "ℹ Results show one row per unique group. Columns marked ⚠ need a calculation — click ⚠ to add one, or they will be left out of the report.";
    }
    if (mode === "totals") {
      return "ℹ All your rows are shown as-is. A totals row is added at the bottom — choose what each column should calculate (Sum, Count, etc.).";
    }
    if (mode === "subtotals") {
      const hasGroups = (state.subtotalBy || []).length > 0;
      const strategyName = state.subtotalStrategy === "nested" ? "nested" : "combined";
      return hasGroups ? `ℹ All rows shown, grouped by the highlighted columns (${strategyName} grouping). A subtotal row appears after each group.` : null;
    }
    return null;
  }
  function TotalsSection({ cols }) {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const colMap = buildColSourceMap();
    const selSet = state.selCols;
    const visibleCols = cols.filter((c3) => !selSet || selSet.has(c3));
    const handleTotalChange = q2((col, val) => {
      getStore().update((draft) => {
        if (val === "skip") delete draft.colTotals[col];
        else draft.colTotals[col] = val;
      });
    }, []);
    if (!visibleCols.length) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "No columns available" });
    }
    return /* @__PURE__ */ u3(S, { children: visibleCols.map((col) => {
      const cur = state.colTotals[col] || "skip";
      const label = _syncColDisplayLabel(col, colMap);
      return /* @__PURE__ */ u3("div", { class: "totals-row", children: [
        /* @__PURE__ */ u3("span", { class: "totals-col-name", title: col, children: label }),
        /* @__PURE__ */ u3(
          "select",
          {
            class: "totals-fn-sel",
            value: cur,
            onChange: (e3) => handleTotalChange(col, e3.target.value),
            children: TOTAL_FNS.map((f4) => /* @__PURE__ */ u3("option", { value: f4, children: TOTAL_LABELS[f4] }, f4))
          }
        )
      ] }, col);
    }) });
  }
  function SubtotalsSection({ cols }) {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const colMap = buildColSourceMap();
    const subtotalBy = state.subtotalBy || [];
    const selSet = state.selCols;
    y2(() => {
      const st = getStore().getState();
      const cm = buildColSourceMap();
      const needsInit = cols.filter((col) => {
        const src = cm.get(col);
        return src?.kind === "calc" && !st.subtotalFns[col];
      });
      if (needsInit.length) {
        getStore().update((draft) => {
          for (const col of needsInit) {
            if (!draft.subtotalFns[col]) {
              const src = cm.get(col);
              const isAdv = src?.kind === "calc" && (() => {
                const calcObj = src?.calc;
                return calcObj?.mathOp === "ROLLAVG" || calcObj?.mathOp === "PCTTOTAL";
              })();
              draft.subtotalFns[col] = isAdv ? "skip" : "SUM";
            }
          }
        });
      }
    }, [cols]);
    const handleSubtotalFnChange = q2((col, val) => {
      getStore().update((draft) => {
        if (val === "skip") delete draft.subtotalFns[col];
        else draft.subtotalFns[col] = val;
      });
    }, []);
    if (subtotalBy.length === 0) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "Click columns above to choose group keys — then configure subtotal rows here." });
    }
    const visibleCols = cols.filter((c3) => (!selSet || selSet.has(c3)) && !subtotalBy.includes(c3));
    if (!visibleCols.length) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "All columns are group keys." });
    }
    return /* @__PURE__ */ u3(S, { children: visibleCols.map((col) => {
      const src = colMap.get(col);
      const isCalc = src?.kind === "calc";
      const isAdvancedCalc = isCalc && (() => {
        const calcObj = src?.calc;
        const op = calcObj?.mathOp;
        return op === "ROLLAVG" || op === "PCTTOTAL";
      })();
      const cur = state.subtotalFns[col] || "skip";
      const label = _syncColDisplayLabel(col, colMap);
      const fnList = isAdvancedCalc ? ["skip"] : SUBTOTAL_FNS;
      return /* @__PURE__ */ u3("div", { class: "totals-row", children: [
        /* @__PURE__ */ u3("span", { class: "totals-col-name", title: col, children: label }),
        /* @__PURE__ */ u3(
          "select",
          {
            class: "totals-fn-sel",
            value: cur,
            onChange: (e3) => handleSubtotalFnChange(col, e3.target.value),
            children: fnList.map((f4) => /* @__PURE__ */ u3("option", { value: f4, children: SUBTOTAL_LABELS[f4] }, f4))
          }
        )
      ] }, col);
    }) });
  }
  function AggregateItems({ cols }) {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const colMap = buildColSourceMap();
    const selSet = state.selCols;
    const visibleCols = selSet ? cols.filter((c3) => selSet.has(c3)) : cols;
    const aggregates = state.aggregates;
    const groupBy = state.groupBy;
    if (!aggregates.length) {
      const msg = groupBy.length > 0 ? "No calculations — add one below or click ungrouped chips above" : "Click a column above to start grouping";
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: msg });
    }
    const handleFnChange = q2((i3, val) => {
      getStore().update((draft) => {
        draft.aggregates[i3].fn = val;
        draft.aggregates[i3].auto = false;
      });
    }, []);
    const handleColChange = q2((i3, val) => {
      getStore().update((draft) => {
        draft.aggregates[i3].col = val;
        draft.aggregates[i3].auto = false;
      });
    }, []);
    const handleAliasChange = q2((i3, val) => {
      getStore().update((draft) => {
        draft.aggregates[i3].alias = val;
        draft.aggregates[i3].auto = false;
      });
    }, []);
    return /* @__PURE__ */ u3(S, { children: aggregates.map((agg, i3) => {
      const needsCol = AGG_NEEDS_COL(agg.fn);
      const colLabel = needsCol ? agg.col ? _syncColDisplayLabel(agg.col, colMap) : "" : "all rows";
      const placeholder = defaultAggAlias(agg.fn, colLabel);
      const isAuto = agg.auto;
      return /* @__PURE__ */ u3("div", { class: `agg-row${isAuto ? " agg-row-auto" : ""}`, children: [
        isAuto && /* @__PURE__ */ u3("span", { class: "agg-auto-badge", title: "Auto-added — edit or delete to customize.", children: "auto" }),
        /* @__PURE__ */ u3(
          "input",
          {
            type: "text",
            class: "agg-alias",
            placeholder,
            value: agg.alias,
            onInput: (e3) => handleAliasChange(i3, e3.target.value)
          }
        ),
        /* @__PURE__ */ u3("span", { class: "agg-eq", children: "=" }),
        /* @__PURE__ */ u3("select", { value: agg.fn, onChange: (e3) => handleFnChange(i3, e3.target.value), children: AGG_FNS.map((f4) => /* @__PURE__ */ u3("option", { value: f4, children: AGG_LABELS[f4] }, f4)) }),
        needsCol && /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("span", { class: "agg-eq", children: "of" }),
          /* @__PURE__ */ u3("select", { value: agg.col, onChange: (e3) => handleColChange(i3, e3.target.value), children: visibleCols.map((c3) => /* @__PURE__ */ u3("option", { value: c3, children: _syncColDisplayLabel(c3, colMap) }, c3)) })
        ] }),
        /* @__PURE__ */ u3("button", { class: "btn btn-danger", onClick: () => removeAggregate(i3), children: "✕" })
      ] }, i3);
    }) });
  }
  function LayoutCard() {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const base = state.base;
    if (!base) return null;
    const mode = state.aggMode || "none";
    const reportSpec = buildReportSpecFromState(state);
    const sourceCatalog = buildSourceCatalog(state.tables);
    const projected = projectedCols(reportSpec, sourceCatalog);
    const allCols = state.colOrder ? state.colOrder.filter((c3) => projected.includes(c3)) : projected;
    const selSet = state.selCols;
    const cols = selSet ? allCols.filter((c3) => selSet.has(c3)) : allCols;
    const hint = getHint(mode, state);
    const handleModeChange = q2((newMode) => {
      setAggMode(newMode);
    }, []);
    return /* @__PURE__ */ u3("div", { id: "layoutCard", class: "card", children: [
      /* @__PURE__ */ u3("div", { class: "card-header", style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap", children: [
        /* @__PURE__ */ u3("span", { style: "font-weight:600;font-size:0.82rem", children: [
          "Layout ",
          /* @__PURE__ */ u3(Tip, { text: "Choose which columns appear in your report and how they are arranged. Drag chips to reorder columns. Double-click a chip to show or hide it." })
        ] }),
        /* @__PURE__ */ u3("div", { class: "tab-row", children: [
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: "aggMode", value: "none", checked: mode === "none", onChange: () => handleModeChange("none") }),
            /* @__PURE__ */ u3("span", { "data-tip": "Show every row exactly as it is. Use the chips below to choose which columns appear in your report.", children: "No summary" })
          ] }),
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: "aggMode", value: "group", checked: mode === "group", onChange: () => handleModeChange("group") }),
            /* @__PURE__ */ u3("span", { "data-tip": "Group rows that share the same value, then calculate totals for each group — like a PivotTable. Double-click a chip to make it a group key.", children: "Summarize" })
          ] }),
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: "aggMode", value: "totals", checked: mode === "totals", onChange: () => handleModeChange("totals") }),
            /* @__PURE__ */ u3("span", { "data-tip": "Keep every row as-is, then add one extra row at the bottom with totals (like Sum, Count, Average) for each column.", children: "Keep all rows + totals" })
          ] }),
          /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
            /* @__PURE__ */ u3("input", { type: "radio", name: "aggMode", value: "subtotals", checked: mode === "subtotals", onChange: () => handleModeChange("subtotals") }),
            /* @__PURE__ */ u3("span", { "data-tip": "Keep all detail rows, but group them visually. After each group, insert a subtotal row. Optionally add a grand total at the very bottom.", children: "Group rows + subtotals" })
          ] })
        ] }),
        /* @__PURE__ */ u3(Tip, { text: "Choose how your data is summarized:\n\n• No summary — every row stays as-is\n• Summarize — group rows and calculate totals\n• Keep all + totals — show all rows plus a totals row\n• Group + subtotals — group rows with a subtotal after each group" })
      ] }),
      hint && /* @__PURE__ */ u3("div", { id: "aggHint", style: "font-size:0.72rem;color:var(--muted);padding:4px 0", children: hint }),
      /* @__PURE__ */ u3(ColumnChips, {}),
      mode === "group" && /* @__PURE__ */ u3("div", { id: "aggSection", style: "margin-top:8px", children: [
        /* @__PURE__ */ u3("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:4px", children: /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;font-weight:600;color:var(--muted)", children: [
          "Calculations ",
          /* @__PURE__ */ u3(Tip, { text: "Choose how non-group columns are summarized.\n\nFor example:\n• Sum adds up all values\n• Average finds the mean\n• Count counts the rows\n\nYou can add multiple calculations." })
        ] }) }),
        /* @__PURE__ */ u3(AggregateItems, { cols }),
        state.groupBy.length > 0 && /* @__PURE__ */ u3("div", { id: "aggAddRow", style: "margin-top:6px", children: /* @__PURE__ */ u3("button", { class: "btn btn-ghost", style: "font-size:0.72rem;padding:2px 8px", onClick: addAggregate, title: "Add another calculation like Sum, Average, Count, etc.", children: [
          "＋",
          " Add calculation"
        ] }) })
      ] }),
      mode === "totals" && /* @__PURE__ */ u3("div", { id: "totalsSection", style: "margin-top:8px", children: [
        /* @__PURE__ */ u3("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:4px", children: /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;font-weight:600;color:var(--muted)", children: [
          "Totals row ",
          /* @__PURE__ */ u3(Tip, { text: "For each column in your report, choose what the totals row at the bottom should display.\n\n• Skip — leaves the cell blank\n• Sum, Average, Count, etc. — calculates that value for the column" })
        ] }) }),
        /* @__PURE__ */ u3(TotalsSection, { cols })
      ] }),
      mode === "subtotals" && /* @__PURE__ */ u3("div", { id: "subtotalsSection", style: "margin-top:8px", children: [
        /* @__PURE__ */ u3("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:4px", children: /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;font-weight:600;color:var(--muted)", children: [
          "Subtotal rows ",
          /* @__PURE__ */ u3(Tip, { text: "For each non-group column, choose what value appears in the subtotal row after each group.\n\n• Skip — leaves the cell blank\n• Sum, Average, Count, etc. — calculates that value for the group" })
        ] }) }),
        /* @__PURE__ */ u3("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:0.76rem;margin-bottom:8px", children: [
          /* @__PURE__ */ u3("label", { style: "cursor:pointer;display:flex;align-items:center;gap:3px", children: [
            /* @__PURE__ */ u3(
              "input",
              {
                type: "checkbox",
                checked: state.subtotalGrandTotal !== false,
                onChange: (e3) => setSubtotalGrandTotal(e3.target.checked)
              }
            ),
            "Grand total ",
            /* @__PURE__ */ u3(Tip, { text: "Adds one final total row at the very bottom, combining all groups together." })
          ] }),
          /* @__PURE__ */ u3("label", { style: "cursor:pointer;display:flex;align-items:center;gap:3px", children: [
            /* @__PURE__ */ u3(
              "input",
              {
                type: "checkbox",
                checked: !!state.subtotalSpacer,
                onChange: (e3) => setSubtotalSpacer(e3.target.checked)
              }
            ),
            "Spacer rows ",
            /* @__PURE__ */ u3(Tip, { text: "Inserts an empty row after each subtotal block to make the report easier to read." })
          ] }),
          /* @__PURE__ */ u3("label", { style: "cursor:pointer;display:flex;align-items:center;gap:3px", children: [
            /* @__PURE__ */ u3(
              "input",
              {
                type: "checkbox",
                checked: !!state.subtotalOnTop,
                onChange: (e3) => setSubtotalOnTop(e3.target.checked)
              }
            ),
            "Headers on top ",
            /* @__PURE__ */ u3(Tip, { text: "Shows each group's subtotal row before that group's detail rows instead of after." })
          ] })
        ] }),
        /* @__PURE__ */ u3("div", { style: "margin-bottom:8px", children: [
          /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted);margin-right:8px", children: [
            "Strategy ",
            /* @__PURE__ */ u3(Tip, { text: "'Combined' groups all keys at once — like a PivotTable with multiple row fields.\n\n'Nested' produces subtotals at each level — like an outline with sub-groups." }),
            ":"
          ] }),
          /* @__PURE__ */ u3("div", { class: "tab-row", style: "display:inline-flex", children: [
            /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
              /* @__PURE__ */ u3("input", { type: "radio", name: "subtotalStrategy", value: "combined", checked: (state.subtotalStrategy || "combined") === "combined", onChange: () => setSubtotalStrategy("combined") }),
              /* @__PURE__ */ u3("span", { children: "Combined" })
            ] }),
            /* @__PURE__ */ u3("label", { class: "tab-opt", children: [
              /* @__PURE__ */ u3("input", { type: "radio", name: "subtotalStrategy", value: "nested", checked: state.subtotalStrategy === "nested", onChange: () => setSubtotalStrategy("nested") }),
              /* @__PURE__ */ u3("span", { children: "Nested" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ u3(SubtotalsSection, { cols })
      ] }),
      /* @__PURE__ */ u3("div", { style: "margin-top:12px", children: [
        /* @__PURE__ */ u3("div", { style: "font-size:0.76rem;font-weight:600;margin-bottom:4px", children: [
          "Merge display ",
          /* @__PURE__ */ u3(Tip, { text: "When enabled for a column, consecutive rows with the same value are visually merged into one tall cell — like Excel's 'Merge cells' feature.\n\nUseful for cleaner-looking grouped data." })
        ] }),
        /* @__PURE__ */ u3(MergeToggles, {}),
        /* @__PURE__ */ u3("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;margin-top:6px", children: [
          /* @__PURE__ */ u3(
            "input",
            {
              type: "checkbox",
              checked: state.mergeGroupUnderline,
              onChange: (e3) => setMergeGroupUnderline(e3.target.checked)
            }
          ),
          "Underline merged groups ",
          /* @__PURE__ */ u3(Tip, { text: "Adds a subtle line at the end of each merged block to help visually separate groups." })
        ] })
      ] })
    ] });
  }

  // preact/ui/cards/filter-sort-card.tsx
  init_store();

  // preact/ui/sections/filter-list.tsx
  init_store();
  init_state();
  init_column_catalog();
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
  function FilterRow({ f: f4, i: i3, cols, colMap }) {
    const noVal = NO_VAL_OPS.has(f4.op);
    const vals = Array.isArray(f4.vals) ? f4.vals : [""];
    const fEnabled = f4.enabled !== false;
    const updateFilter = q2((updater) => {
      getStore().update((draft) => {
        const fDraft = draft.filters[i3];
        if (fDraft) updater(fDraft);
      });
      invalidateValidation();
      _afterCombineChange();
    }, [i3]);
    const handleColChange = q2((val) => {
      updateFilter((draft) => {
        draft.col = val;
        draft.vals = [""];
      });
    }, [updateFilter]);
    const handleOpChange = q2((val) => {
      updateFilter((draft) => {
        draft.op = val;
      });
    }, [updateFilter]);
    const handleEnabledChange = q2((checked) => {
      updateFilter((draft) => {
        draft.enabled = checked;
      });
    }, [updateFilter]);
    const handleValChange = q2((j4, val) => {
      getStore().update((draft) => {
        const fDraft = draft.filters[i3];
        if (!fDraft) return;
        if (!Array.isArray(fDraft.vals)) fDraft.vals = [""];
        fDraft.vals[j4] = val;
      });
    }, [i3]);
    const addOrValue = q2(() => {
      updateFilter((draft) => {
        if (!Array.isArray(draft.vals)) draft.vals = [""];
        draft.vals.push("");
      });
    }, [updateFilter]);
    const removeOrValue = q2((j4) => {
      updateFilter((draft) => {
        if (draft.vals && draft.vals.length > 1) {
          draft.vals.splice(j4, 1);
        }
      });
    }, [updateFilter]);
    const removeFilter = q2(() => {
      getStore().update((draft) => {
        draft.filters.splice(i3, 1);
      });
      invalidateValidation();
      _afterCombineChange();
    }, [i3]);
    const datalistId = "fdl_" + i3;
    const rowClasses = [
      "filter-row",
      fEnabled ? "" : "pl-stage-disabled"
    ].filter(Boolean).join(" ");
    return /* @__PURE__ */ u3("div", { class: rowClasses, children: [
      /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", style: "margin-left:auto;order:99", title: fEnabled ? "Disable filter" : "Enable filter", children: [
        /* @__PURE__ */ u3("input", { type: "checkbox", checked: fEnabled, onChange: (e3) => handleEnabledChange(e3.target.checked) }),
        /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: fEnabled ? "" : "Off" })
      ] }),
      /* @__PURE__ */ u3("select", { value: f4.col, onChange: (e3) => handleColChange(e3.target.value), children: [
        /* @__PURE__ */ u3("option", { value: "", children: "Column…" }),
        cols.map((c3) => {
          const src = colMap.get(c3);
          const label = src && src.kind !== "calc" ? colUserLabel(src.tid, src.col) : c3;
          return /* @__PURE__ */ u3("option", { value: c3, children: label }, c3);
        })
      ] }),
      /* @__PURE__ */ u3("select", { class: "fop", value: f4.op, onChange: (e3) => handleOpChange(e3.target.value), children: FILTER_OPS.map((op) => /* @__PURE__ */ u3("option", { value: op, children: op }, op)) }),
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
              onInput: (e3) => handleValChange(j4, e3.target.value)
            }
          ),
          j4 > 0 && /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-danger",
              style: "padding:2px 5px;font-size:0.75rem;flex-shrink:0",
              title: "Remove this OR value",
              onClick: () => removeOrValue(j4),
              children: "✕"
            }
          )
        ] }, j4)),
        /* @__PURE__ */ u3(
          "button",
          {
            class: "btn btn-ghost",
            style: "padding:2px 7px;font-size:0.76rem;flex-shrink:0",
            title: "Add OR value",
            onClick: addOrValue,
            children: "＋"
          }
        )
      ] }),
      /* @__PURE__ */ u3("button", { class: "btn btn-danger", onClick: removeFilter, children: "✕" })
    ] });
  }
  function FilterList() {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const reportSpec = buildReportSpecFromState(state);
    const sourceCatalog = buildSourceCatalog(state.tables);
    const cols = projectedCols(reportSpec, sourceCatalog);
    const colMap = buildColSourceMap();
    const filters = state.filters;
    if (!filters.length) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "No filters — all rows returned" });
    }
    return /* @__PURE__ */ u3(S, { children: filters.map((f4, i3) => /* @__PURE__ */ u3(FilterRow, { f: f4, i: i3, cols, colMap }, i3)) });
  }
  function addFilter() {
    getStore().update((draft) => {
      draft.filters.push({ col: "", op: "contains", val: "", vals: [""], enabled: true });
    });
    invalidateValidation();
    _afterCombineChange();
  }

  // preact/ui/sections/sort-list.tsx
  init_store();
  init_state();
  init_column_catalog();
  function SortRow({ s: s3, i: i3, cols, colMap }) {
    const sEnabled = s3.enabled !== false;
    const updateSort = q2((updater) => {
      getStore().update((draft) => {
        const sDraft = draft.sorts[i3];
        if (sDraft) updater(sDraft);
      });
      invalidateValidation();
      _afterCombineChange();
    }, [i3]);
    const handleColChange = q2((val) => {
      updateSort((draft) => {
        draft.col = val;
      });
    }, [updateSort]);
    const handleDirChange = q2((val) => {
      updateSort((draft) => {
        draft.dir = val;
      });
    }, [updateSort]);
    const handleEnabledChange = q2((checked) => {
      updateSort((draft) => {
        draft.enabled = checked;
      });
    }, [updateSort]);
    const removeSort = q2(() => {
      getStore().update((draft) => {
        draft.sorts.splice(i3, 1);
      });
      invalidateValidation();
      _afterCombineChange();
    }, [i3]);
    const rowClasses = [
      "sort-row",
      sEnabled ? "" : "pl-stage-disabled"
    ].filter(Boolean).join(" ");
    return /* @__PURE__ */ u3("div", { class: rowClasses, children: [
      /* @__PURE__ */ u3("span", { class: "sort-level", children: [
        i3 + 1,
        "."
      ] }),
      /* @__PURE__ */ u3("select", { value: s3.col, style: "flex:1;min-width:0", onChange: (e3) => handleColChange(e3.target.value), children: [
        /* @__PURE__ */ u3("option", { value: "", children: [
          "—",
          " column ",
          "—"
        ] }),
        cols.map((c3) => {
          const src = colMap.get(c3);
          const label = src && src.kind !== "calc" ? colUserLabel(src.tid, src.col) : c3;
          return /* @__PURE__ */ u3("option", { value: c3, children: label }, c3);
        })
      ] }),
      /* @__PURE__ */ u3("select", { value: s3.dir, style: "width:95px;flex-shrink:0", onChange: (e3) => handleDirChange(e3.target.value), children: [
        /* @__PURE__ */ u3("option", { value: "ASC", children: [
          "↑",
          " A ",
          "→",
          " Z"
        ] }),
        /* @__PURE__ */ u3("option", { value: "DESC", children: [
          "↓",
          " Z ",
          "→",
          " A"
        ] })
      ] }),
      /* @__PURE__ */ u3("label", { class: "pl-enable-toggle", title: sEnabled ? "Disable sort" : "Enable sort", children: [
        /* @__PURE__ */ u3("input", { type: "checkbox", checked: sEnabled, onChange: (e3) => handleEnabledChange(e3.target.checked) }),
        /* @__PURE__ */ u3("span", { class: "pl-enable-label", children: sEnabled ? "" : "Off" })
      ] }),
      /* @__PURE__ */ u3("button", { class: "btn btn-danger", onClick: removeSort, children: "✕" })
    ] });
  }
  function SortList() {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const selCols = state.selCols;
    const reportSpec = buildReportSpecFromState(state);
    const sourceCatalog = buildSourceCatalog(state.tables);
    const allCols = projectedCols(reportSpec, sourceCatalog);
    const colOrder = state.colOrder || allCols;
    const cols = colOrder.filter((c3) => !selCols || selCols.has(c3));
    const colMap = buildColSourceMap();
    const sorts = state.sorts;
    if (!sorts.length) {
      return /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted)", children: "No sort — rows returned in natural order" });
    }
    return /* @__PURE__ */ u3(S, { children: sorts.map((s3, i3) => /* @__PURE__ */ u3(SortRow, { s: s3, i: i3, cols, colMap }, i3)) });
  }
  function addSort() {
    getStore().update((draft) => {
      draft.sorts.push({ col: "", dir: "ASC", enabled: true });
    });
    invalidateValidation();
    _afterCombineChange();
  }

  // preact/ui/cards/filter-sort-card.tsx
  function FilterSortCard() {
    const [state, setState] = d2(getStore().getState());
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const base = state.base;
    if (!base) return null;
    return /* @__PURE__ */ u3("div", { id: "filterSortCard", class: "card", children: [
      /* @__PURE__ */ u3("div", { style: "margin-bottom:12px", children: [
        /* @__PURE__ */ u3("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:6px", children: [
          /* @__PURE__ */ u3("span", { style: "font-weight:600;font-size:0.82rem", children: [
            "Filters ",
            /* @__PURE__ */ u3(Tip, { text: "Narrow your results by adding conditions. Only rows that match ALL active filters will appear. For example: Region = 'East' AND Status = 'Active'." })
          ] }),
          /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-ghost",
              style: "font-size:0.72rem;padding:2px 8px",
              onClick: addFilter,
              title: "Add a new filter condition",
              children: [
                "＋",
                " Add filter"
              ]
            }
          )
        ] }),
        /* @__PURE__ */ u3(FilterList, {})
      ] }),
      /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:6px", children: [
          /* @__PURE__ */ u3("span", { style: "font-weight:600;font-size:0.82rem", children: [
            "Sort ",
            /* @__PURE__ */ u3(Tip, { text: "Control the order rows appear in your report. Level 1 is the primary sort, Level 2 breaks ties, and so on. Like sorting by Last Name, then First Name." })
          ] }),
          /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-ghost",
              style: "font-size:0.72rem;padding:2px 8px",
              onClick: addSort,
              title: "Add another sort level",
              children: [
                "＋",
                " Add sort"
              ]
            }
          )
        ] }),
        /* @__PURE__ */ u3(SortList, {})
      ] })
    ] });
  }

  // preact/ui/sections/run-bar.tsx
  init_store();

  // preact/ui/components/row-explosion-dialog.tsx
  function RowExplosionDialog({
    projectedCount,
    limit,
    onProceed,
    onCancel
  }) {
    return /* @__PURE__ */ u3(
      Modal,
      {
        open: true,
        title: "Row count warning",
        onClose: onCancel,
        closeOnBackdrop: false,
        buttons: [
          { label: "Cancel", action: onCancel },
          { label: "Proceed anyway", primary: true, action: onProceed, className: "btn-warning" }
        ],
        children: [
          /* @__PURE__ */ u3("p", { style: "font-size:0.82rem;line-height:1.5;margin:0 0 8px 0", children: [
            "The stacking-mode cross-product would produce",
            " ",
            /* @__PURE__ */ u3("strong", { children: projectedCount.toLocaleString() }),
            " rows, which exceeds the limit of ",
            /* @__PURE__ */ u3("strong", { children: limit.toLocaleString() }),
            "."
          ] }),
          /* @__PURE__ */ u3("p", { style: "font-size:0.78rem;line-height:1.5;margin:0;color:var(--muted)", children: [
            "This may cause the application to slow down or become unresponsive. Click ",
            /* @__PURE__ */ u3("em", { children: "Proceed anyway" }),
            " to run with an elevated limit, or",
            " ",
            /* @__PURE__ */ u3("em", { children: "Cancel" }),
            " to abort."
          ] })
        ]
      }
    );
  }

  // preact/query/query-plan.ts
  init_column_catalog();

  // preact/query/resolve-ref.ts
  function resolveRef(alias, colMap) {
    const entry = colMap.get(alias);
    if (!entry || entry.kind === "calc" || entry.kind === "band") return quoteId(alias);
    return `${quoteId(entry.tid)}.${quoteId(entry.col)}`;
  }

  // preact/query/sql-calcs.ts
  function toNum(expr) {
    return `CAST(COALESCE(NULLIF(TRIM(CAST(${expr} AS TEXT)), ''), '0') AS REAL)`;
  }
  function findBaseTid(colMap) {
    for (const entry of colMap.values()) {
      if (!entry || entry.kind === "calc") continue;
      const physical = entry;
      if (physical.col === "_rowno") return physical.tid;
    }
    for (const entry of colMap.values()) {
      if (!entry || entry.kind === "calc") continue;
      return entry.tid;
    }
    return "_base";
  }
  function renderCalcExpr(calc, alias, colMap, trail) {
    if (trail.has(alias)) return "NULL";
    trail.add(alias);
    if (calc.mode === "math") {
      return renderModeMath(calc, alias, colMap, trail);
    }
    if (calc.mode === "compare") {
      return renderModeCompare(calc, alias, colMap, trail);
    }
    if (calc.mode === "text") {
      return renderModeText(calc, alias, colMap, trail);
    }
    if (calc.mode === "date") {
      return renderModeDate(calc, alias, colMap, trail);
    }
    throw new Error(`Unknown calc mode "${calc.mode}" for "${alias}"`);
  }
  function renderModeMath(calc, alias, colMap, trail) {
    const math = calc.math;
    const steps = math.steps;
    const renderStepVal = (step, t3) => {
      if (step.type === "number") {
        const n2 = parseFloat(step.value || "");
        return Number.isFinite(n2) ? String(n2) : "0";
      }
      if (step.type === "column") {
        const expr2 = resolveRef(step.value || "", colMap);
        const refEntry = colMap.get(step.value || "");
        if (refEntry && refEntry.kind === "calc") {
          const refCalc = refEntry.calc;
          if (refCalc) {
            return toNum(renderCalcExpr(refCalc, step.value || "", colMap, t3));
          }
        }
        return toNum(expr2);
      }
      if (step.type === "text") {
        return `'${String(step.value || "").replace(/'/g, "''")}'`;
      }
      throw new Error(`Unsupported math step type "${step.type}" in calc "${alias}"`);
    };
    const ext = calc;
    const mathOp = ext.mathOp;
    const colExpr = renderStepVal(steps[0], trail);
    const baseTid = findBaseTid(colMap);
    const rownoRef = `${quoteId(baseTid)}.${quoteId("_rowno")}`;
    if (mathOp === "ROLLAVG") {
      const window2 = Math.max(1, parseInt(String(ext.window || "7"), 10) || 7);
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
  function renderModeCompare(calc, alias, colMap, trail) {
    const compare = calc.compare;
    const glue = compare.compareMode === "OR" ? " OR " : " AND ";
    const condParts = compare.conditions.map((cond) => {
      const colExpr = resolveRef(cond.col, colMap);
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
    const thenExpr = renderTypedValue(compare.trueValue, colMap, trail);
    const elseExpr = renderTypedValue(compare.falseValue, colMap, trail);
    return `(CASE WHEN ${condParts.join(glue)} THEN ${thenExpr} ELSE ${elseExpr} END)`;
  }
  function renderModeText(calc, alias, colMap, trail) {
    const text = calc.text;
    const op = text.operation;
    if (op === "combine") {
      const parts = text.parts.map(
        (p3) => renderTextPart(p3, colMap, trail)
      );
      return parts.join(" || ");
    }
    if (op === "left") {
      const src = renderTextSource(text.source, colMap, trail);
      return `SUBSTR(${src}, 1, ${text.count})`;
    }
    if (op === "right") {
      const src = renderTextSource(text.source, colMap, trail);
      return `SUBSTR(${src}, -${text.count})`;
    }
    if (op === "substring") {
      const src = renderTextSource(text.source, colMap, trail);
      return `SUBSTR(${src}, ${text.start}, ${text.length})`;
    }
    throw new Error(`Unknown text operation "${op}" in calc "${alias}"`);
  }
  function renderModeDate(calc, alias, colMap, trail) {
    const date = calc.date;
    const op = date.operation;
    if (op === "extract") {
      const inputFormat = getDateInputFormat(date);
      const src = renderDateSource(date.source, colMap, trail, inputFormat);
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
  function renderDateSource(source, colMap, trail, format) {
    if (source.type === "column") {
      const expr = resolveRef(source.value, colMap);
      return normalizeDateExpr(expr, format ?? null);
    }
    throw new Error(`Unsupported date source type "${source.type}"`);
  }
  function renderTypedValue(tv, colMap, trail) {
    if (tv.type === "text") return `'${String(tv.value).replace(/'/g, "''")}'`;
    if (tv.type === "number") return String(Number(tv.value));
    if (tv.type === "column") return resolveRef(tv.value, colMap);
    throw new Error(`Unsupported typed-value type "${tv.type}"`);
  }
  function renderTextPart(part, colMap, _trail) {
    if (part.type === "text") return `'${String(part.value).replace(/'/g, "''")}'`;
    if (part.type === "number") return `CAST(${Number(part.value)} AS TEXT)`;
    if (part.type === "column") {
      const expr = resolveRef(part.value, colMap);
      return `COALESCE(CAST(${expr} AS TEXT), '')`;
    }
    throw new Error(`Unsupported text part type "${part.type}"`);
  }
  function renderTextSource(source, colMap, _trail) {
    if (source.type === "text") return `'${String(source.value).replace(/'/g, "''")}'`;
    if (source.type === "column") return resolveRef(source.value, colMap);
    throw new Error(`Unsupported text source type "${source.type}"`);
  }
  function buildCalcExpressions(calcStages, colMap) {
    const results = [];
    for (let i3 = 0; i3 < calcStages.length; i3++) {
      const calc = calcStages[i3];
      if (!calc || calc.enabled === false) continue;
      const alias = (calc.alias || "").trim();
      if (!alias) continue;
      if (!calc.mode || !["math", "compare", "text", "date"].includes(calc.mode)) continue;
      try {
        const trail = /* @__PURE__ */ new Set();
        const sql = renderCalcExpr(calc, alias, colMap, trail);
        results.push({ alias, sql });
      } catch {
      }
    }
    return results;
  }

  // preact/query/sql-where.ts
  function likeEsc(v3) {
    return v3.replace(/%/g, "\\%").replace(/_/g, "\\_");
  }
  function columnRefs(alias, colMap) {
    const ref = resolveRef(alias, colMap);
    const txt = `CAST(${ref} AS TEXT)`;
    const num = `CAST(${ref} AS REAL)`;
    return { txt, num };
  }
  function isDisabled(f4) {
    return f4.enabled === false;
  }
  function isNumericCalc(alias, colMap) {
    const entry = colMap.get(alias);
    return entry?.kind === "calc" && entry.mode === "math";
  }
  function renderClause(op, txt, num, val, params, numericHint, alias, colMap) {
    const normVal = String(val ?? "").trim();
    const numVal = Number(normVal.replace(/,/g, ""));
    const hasNumericVal = normVal !== "" && Number.isFinite(numVal);
    const normalizedOp = op === "equals" ? "=" : op === "not equals" ? "!=" : op === "starts with" ? "starts_with" : op === "ends with" ? "ends_with" : op === "is empty" ? "is_null" : op === "not empty" ? "is_not_null" : op;
    switch (normalizedOp) {
      case "=":
        if (numericHint && hasNumericVal) {
          params.push(numVal);
          return `${num} = ?`;
        }
        params.push(val);
        return `${txt} = ?`;
      case "!=":
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
      case "contains":
        params.push("%" + likeEsc(val) + "%");
        return `${txt} LIKE ? ESCAPE '\\'`;
      case "starts_with":
        params.push(likeEsc(val) + "%");
        return `${txt} LIKE ? ESCAPE '\\'`;
      case "ends_with":
        params.push("%" + likeEsc(val));
        return `${txt} LIKE ? ESCAPE '\\'`;
      case "in": {
        if (!normVal) return null;
        const vals = normVal.split(",").map((v3) => v3.trim()).filter(Boolean);
        if (!vals.length) return null;
        const allNumeric = numericHint && vals.every((v3) => {
          const n2 = Number(v3.replace(/,/g, ""));
          return v3 !== "" && Number.isFinite(n2);
        });
        const ref = resolveRef(alias, colMap);
        if (allNumeric) {
          const numVals = vals.map((v3) => Number(v3.replace(/,/g, "")));
          params.push(...numVals);
          const placeholders2 = numVals.map(() => "?").join(", ");
          return `CAST(${ref} AS REAL) IN (${placeholders2})`;
        }
        params.push(...vals);
        const placeholders = vals.map(() => "?").join(", ");
        return `${ref} IN (${placeholders})`;
      }
      case "not_in": {
        if (!normVal) return null;
        const vals = normVal.split(",").map((v3) => v3.trim()).filter(Boolean);
        if (!vals.length) return null;
        const allNumeric = numericHint && vals.every((v3) => {
          const n2 = Number(v3.replace(/,/g, ""));
          return v3 !== "" && Number.isFinite(n2);
        });
        const ref = resolveRef(alias, colMap);
        if (allNumeric) {
          const numVals = vals.map((v3) => Number(v3.replace(/,/g, "")));
          params.push(...numVals);
          const placeholders2 = numVals.map(() => "?").join(", ");
          return `CAST(${ref} AS REAL) NOT IN (${placeholders2})`;
        }
        params.push(...vals);
        const placeholders = vals.map(() => "?").join(", ");
        return `${ref} NOT IN (${placeholders})`;
      }
      case "is_null":
        return `(${txt} IS NULL OR ${txt} = '')`;
      case "is_not_null":
        return `(${txt} IS NOT NULL AND ${txt} != '')`;
      default:
        return null;
    }
  }
  function renderFilter(f4, colMap, params) {
    if (!f4.col) return null;
    const numericHint = isNumericCalc(f4.col, colMap);
    const { txt, num } = columnRefs(f4.col, colMap);
    const filterVals = Array.isArray(f4.vals) && f4.vals.length > 0 ? f4.vals : [""];
    const orParts = [];
    for (const v3 of filterVals) {
      const clause = renderClause(f4.op, txt, num, String(v3 ?? ""), params, numericHint, f4.col, colMap);
      if (clause) orParts.push(clause);
    }
    if (!orParts.length) return null;
    return orParts.length > 1 ? `(${orParts.join(" OR ")})` : orParts[0];
  }
  function buildWhere(filters, colMap, colState) {
    if (!filters || filters.length === 0) return { where: "", params: [] };
    const params = [];
    const parts = [];
    for (const f4 of filters) {
      if (isDisabled(f4)) continue;
      const clause = renderFilter(f4, colMap, params);
      if (clause) parts.push(clause);
    }
    return {
      where: parts.join(" AND "),
      params
    };
  }

  // preact/query/sql-joins.ts
  function getTableName(tid, sourceCatalog) {
    const entry = sourceCatalog.get(tid);
    return entry ? entry.name ?? tid : tid;
  }
  function buildJoins(lookups, colMap, sourceCatalog) {
    if (!lookups || lookups.length === 0) return { joins: "", params: [] };
    const params = [];
    const joinClauses = [];
    for (const lk of lookups) {
      if (lk.enabled === false || !lk.rightId) continue;
      const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter((p3) => p3.left && p3.right) : [];
      if (pairs.length === 0) continue;
      const jType = lk.required ? "INNER" : "LEFT";
      const rightTableName = getTableName(lk.rightId, sourceCatalog);
      const rightTableRef = quoteId(lk.rightId);
      const onParts = [];
      for (const p3 of pairs) {
        const leftRef = resolveRef(p3.left, colMap);
        const rightRef = `${rightTableRef}.${quoteId(p3.right)}`;
        onParts.push(`${leftRef} = ${rightRef}`);
      }
      if (onParts.length === 0) continue;
      const joinClause = `${jType} JOIN ${rightTableRef} ON ${onParts.join(" AND ")}`;
      joinClauses.push(joinClause);
    }
    return {
      joins: joinClauses.join("\n"),
      params
    };
  }

  // preact/query/sql-detail.ts
  function buildDetailQuery(reportSpec, colMap, sourceCatalog, calcExprs = /* @__PURE__ */ new Map()) {
    if (!reportSpec.pipeline.base) throw new Error("No base table in reportSpec");
    const outputCols = reportSpec.outputColumns;
    const projected = outputCols && outputCols.length > 0 ? outputCols.filter((alias) => colMap.has(alias)) : [...colMap.keys()];
    const filteredProjected = projected.filter((alias) => {
      const entry = colMap.get(alias);
      return !entry || entry.kind !== "band";
    });
    const selParts = [];
    const cols = [];
    for (const alias of filteredProjected) {
      const calcExpr = calcExprs.get(alias);
      if (calcExpr) {
        selParts.push(`${calcExpr} AS ${quoteId(alias)}`);
      } else {
        selParts.push(`${resolveRef(alias, colMap)} AS ${quoteId(alias)}`);
      }
      cols.push(alias);
    }
    if (!selParts.length) selParts.push("*");
    const fromClause = quoteId(reportSpec.pipeline.base);
    const lookups = reportSpec.pipeline.lookups || [];
    const { joins: joinClause, params: joinParams } = buildJoins(lookups, colMap, sourceCatalog);
    const filters = reportSpec.filters || [];
    const { where: whereClause, params: whereParams } = buildWhere(filters, colMap);
    const sorts = reportSpec.sorts || [];
    const sortParts = sorts.filter((s3) => s3.enabled !== false).filter((s3) => {
      const entry = colMap.get(s3.col);
      return !entry || entry.kind !== "band";
    }).map((s3) => {
      const calcExpr = calcExprs.get(s3.col);
      const sortRef = calcExpr ?? resolveRef(s3.col, colMap);
      return `${sortRef} ${s3.dir === "DESC" ? "DESC" : "ASC"}`;
    });
    let sql = `SELECT ${selParts.join(",\n       ")}
FROM ${fromClause}`;
    if (joinClause) sql += "\n" + joinClause;
    if (whereClause) sql += "\nWHERE " + whereClause;
    if (sortParts.length) sql += "\nORDER BY " + sortParts.join(", ");
    const params = [...joinParams, ...whereParams];
    return { sql, params, cols };
  }

  // preact/query/sql-aggregates.ts
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
        return `MIN(${colRef}) || ' — ' || MAX(${colRef})`;
      case "DATE SPAN":
        return `CAST(julianday(MAX(${colRef})) - julianday(MIN(${colRef})) AS INTEGER)`;
      case "NUMERIC RANGE":
        return `MIN(${colRef}) || ' – ' || MAX(${colRef})`;
      case "NUMERIC SPAN":
        return `MAX(${colRef}) - MIN(${colRef})`;
      case "LIST":
        return `GROUP_CONCAT(DISTINCT ${colRef})`;
      default:
        return `COUNT(${colRef})`;
    }
  }

  // preact/query/sql-grouped.ts
  function buildGroupedQuery(reportSpec, colMap, sourceCatalog, calcExprs = /* @__PURE__ */ new Map()) {
    if (!reportSpec.pipeline.base) throw new Error("No base table in reportSpec");
    const groupByAliases = reportSpec.aggregation.groupBy || [];
    const aggregates = reportSpec.aggregation.aggregates || [];
    const hasAgg = groupByAliases.length > 0 || aggregates.length > 0;
    const outputCols = reportSpec.outputColumns;
    const selColSet = outputCols && outputCols.length > 0 ? new Set(outputCols) : null;
    const isBand = (alias) => {
      const entry = colMap.get(alias);
      return !!entry && entry.kind === "band";
    };
    const selParts = [];
    const colAliases = [];
    const groupRefs = [];
    if (hasAgg) {
      for (const alias of groupByAliases) {
        if (selColSet && !selColSet.has(alias)) continue;
        if (isBand(alias)) continue;
        const calcExpr = calcExprs.get(alias);
        const ref = calcExpr ?? resolveRef(alias, colMap);
        selParts.push(`${ref} AS ${quoteId(alias)}`);
        groupRefs.push(ref);
        colAliases.push(alias);
      }
      for (const agg of aggregates) {
        const colLabel = agg.col && agg.col !== "*" ? agg.col : "all rows";
        const outName = agg.alias?.trim() || defaultAggAlias(agg.fn, colLabel);
        if (selColSet && !selColSet.has(outName)) continue;
        if (isBand(outName)) continue;
        const calcExpr = agg.col ? calcExprs.get(agg.col) : void 0;
        const colRef = agg.col && agg.col !== "*" ? calcExpr ?? resolveRef(agg.col, colMap) : null;
        const expr = renderAggregateExpr(agg.fn, colRef || "*");
        selParts.push(`${expr} AS ${quoteId(outName)}`);
        colAliases.push(outName);
      }
    } else {
      const projected = selColSet ? [...colMap.keys()].filter((a3) => selColSet.has(a3)) : [...colMap.keys()];
      for (const alias of projected) {
        if (isBand(alias)) continue;
        const calcExpr = calcExprs.get(alias);
        if (calcExpr) {
          selParts.push(`${calcExpr} AS ${quoteId(alias)}`);
        } else {
          selParts.push(`${resolveRef(alias, colMap)} AS ${quoteId(alias)}`);
        }
        colAliases.push(alias);
      }
    }
    if (!selParts.length) selParts.push("*");
    const fromClause = quoteId(reportSpec.pipeline.base);
    const lookups = reportSpec.pipeline.lookups || [];
    const { joins: joinClause, params: joinParams } = buildJoins(lookups, colMap, sourceCatalog);
    const filters = reportSpec.filters || [];
    const { where: whereClause, params: whereParams } = buildWhere(filters, colMap);
    const groupByClause = groupRefs.length ? "\nGROUP BY " + groupRefs.join(", ") : "";
    const sorts = reportSpec.sorts || [];
    const sortParts = sorts.filter((s3) => s3.enabled !== false).filter((s3) => !isBand(s3.col)).map((s3) => {
      const calcExpr = calcExprs.get(s3.col);
      const sortRef = calcExpr ?? resolveRef(s3.col, colMap);
      return `${sortRef} ${s3.dir === "DESC" ? "DESC" : "ASC"}`;
    });
    let sql = `SELECT ${selParts.join(",\n       ")}
FROM ${fromClause}`;
    if (joinClause) sql += "\n" + joinClause;
    if (whereClause) sql += "\nWHERE " + whereClause;
    if (groupByClause) sql += groupByClause;
    if (sortParts.length) sql += "\nORDER BY " + sortParts.join(", ");
    const params = [...joinParams, ...whereParams];
    return { sql, params, cols: colAliases };
  }

  // preact/query/sql-totals.ts
  function buildTotalsQuery(reportSpec, colMap, sourceCatalog, calcExprs = /* @__PURE__ */ new Map()) {
    if (!reportSpec.pipeline.base) throw new Error("No base table in reportSpec");
    const colTotals = reportSpec.aggregation.colTotals || {};
    const outputCols = reportSpec.outputColumns;
    const projected = outputCols && outputCols.length > 0 ? outputCols.filter((alias) => colMap.has(alias)) : [...colMap.keys()];
    const filteredProjected = projected.filter((alias) => {
      const entry = colMap.get(alias);
      return !entry || entry.kind !== "band";
    });
    const hasAny = filteredProjected.some((c3) => colTotals[c3] && colTotals[c3] !== "skip");
    if (!hasAny) return null;
    const selParts = [];
    for (const alias of filteredProjected) {
      const fn = colTotals[alias];
      if (!fn || fn === "skip") {
        selParts.push(`NULL AS ${quoteId(alias)}`);
      } else {
        const calcExpr = calcExprs.get(alias);
        const innerRef = calcExpr ?? resolveRef(alias, colMap);
        selParts.push(`${renderAggregateExpr(fn, innerRef)} AS ${quoteId(alias)}`);
      }
    }
    if (!selParts.length) selParts.push("*");
    const fromClause = quoteId(reportSpec.pipeline.base);
    const lookups = reportSpec.pipeline.lookups || [];
    const { joins: joinClause, params: joinParams } = buildJoins(lookups, colMap, sourceCatalog);
    const filters = reportSpec.filters || [];
    const { where: whereClause, params: whereParams } = buildWhere(filters, colMap);
    let sql = `SELECT ${selParts.join(",\n       ")}
FROM ${fromClause}`;
    if (joinClause) sql += "\n" + joinClause;
    if (whereClause) sql += "\nWHERE " + whereClause;
    const params = [...joinParams, ...whereParams];
    return { sql, params, cols: filteredProjected };
  }

  // preact/query/sql-subtotals.ts
  function buildSubtotalsQuery(reportSpec, colMap, sourceCatalog, calcExprs = /* @__PURE__ */ new Map()) {
    if (!reportSpec.pipeline.base) throw new Error("No base table in reportSpec");
    const agg = reportSpec.aggregation;
    const outputCols = reportSpec.outputColumns;
    const rawToShow = outputCols && outputCols.length > 0 ? outputCols.filter((alias) => colMap.has(alias)) : [...colMap.keys()];
    const toShow = rawToShow.filter((alias) => {
      const entry = colMap.get(alias);
      return !entry || entry.kind !== "band";
    });
    if (!toShow.length) return null;
    const subtotalFns = agg.subtotalFns || {};
    const includeGrand = agg.subtotalGrandTotal !== false;
    const includeSpacer = !!agg.subtotalSpacer;
    const subtotalOnTop = !!agg.subtotalOnTop;
    const isNested = agg.subtotalStrategy === "nested";
    const orderIdx = new Map(toShow.map((a3, i3) => [a3, i3]));
    const seenSub = /* @__PURE__ */ new Set();
    const subtotalBy = (agg.subtotalBy || []).filter((a3) => orderIdx.has(a3) && !seenSub.has(a3) && (seenSub.add(a3), true)).sort((a3, b2) => (orderIdx.get(a3) ?? Infinity) - (orderIdx.get(b2) ?? Infinity));
    const n2 = subtotalBy.length;
    if (n2 === 0) return null;
    const sortGroupKeys = subtotalBy.map((_3, i3) => `_sort_group_${i3}`);
    const detailSortType = subtotalOnTop ? 1 : 0;
    const subtotalSortType = subtotalOnTop ? 0 : 1;
    const subtotalBySet = new Set(subtotalBy);
    const subAggExpr = (a3) => {
      const fn = subtotalFns[a3];
      if (!fn || fn === "skip") return `NULL AS ${quoteId(a3)}`;
      const calcExpr = calcExprs.get(a3);
      const innerRef = calcExpr ?? resolveRef(a3, colMap);
      return `${renderAggregateExpr(fn, innerRef)} AS ${quoteId(a3)}`;
    };
    const ref = (a3) => calcExprs.get(a3) ?? resolveRef(a3, colMap);
    const fromClause = quoteId(reportSpec.pipeline.base);
    const lookups = reportSpec.pipeline.lookups || [];
    const { joins: joinClause, params: joinParams } = buildJoins(lookups, colMap, sourceCatalog);
    const filters = reportSpec.filters || [];
    const { where: whereClause, params: whereParams } = buildWhere(filters, colMap);
    const joinPart = joinClause ? "\n" + joinClause : "";
    const wherePart = whereClause ? "\nWHERE " + whereClause : "";
    const nullFilter = subtotalBy.map((a3) => `${ref(a3)} IS NOT NULL`).join(" OR ");
    const subWherePart = whereClause ? `
WHERE ${whereClause}
  AND (${nullFilter})` : `
WHERE (${nullFilter})`;
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
      ...(reportSpec.sorts || []).filter((s3) => s3.enabled !== false && toShow.includes(s3.col) && !subtotalBySet.has(s3.col)).map((s3) => `${quoteId(s3.col)} ${s3.dir === "DESC" ? "DESC" : "ASC"}`)
    ];
    const branches = [
      `SELECT ${detailSel}
FROM ${fromClause}${joinPart}${wherePart}`
    ];
    if (isNested) {
      for (let d3 = 0; d3 < n2; d3++) {
        const groupClause = subtotalBy.slice(0, d3 + 1).map((a3) => ref(a3)).join(", ");
        branches.push(
          `SELECT ${makeSubSel(d3)}
FROM ${fromClause}${joinPart}${subWherePart}
GROUP BY ${groupClause}`
        );
      }
    } else {
      const groupClause = subtotalBy.map((a3) => ref(a3)).join(", ");
      branches.push(
        `SELECT ${makeSubSel(n2 - 1)}
FROM ${fromClause}${joinPart}${subWherePart}
GROUP BY ${groupClause}`
      );
    }
    if (includeSpacer) {
      const groupClause = subtotalBy.map((a3) => ref(a3)).join(", ");
      branches.push(
        `SELECT ${spacerSel}
FROM ${fromClause}${joinPart}${subWherePart}
GROUP BY ${groupClause}`
      );
    }
    if (includeGrand) {
      const hasGrandValue = toShow.some(
        (a3) => !subtotalBySet.has(a3) && subtotalFns[a3] && subtotalFns[a3] !== "skip"
      );
      if (hasGrandValue) {
        branches.push(`SELECT ${grandSel}
FROM ${fromClause}${joinPart}${wherePart}`);
      }
    }
    const filterParams = [...joinParams, ...whereParams];
    const params = branches.flatMap(() => [...filterParams]);
    const sql = branches.join("\nUNION ALL\n") + "\nORDER BY " + orderParts.join(", ");
    return {
      sql,
      params,
      cols: [...toShow]
    };
  }

  // preact/query/query-plan.ts
  function buildQueryPlan(reportSpec, tables) {
    const sourceCatalog = buildSourceCatalog(tables);
    const catalogCtx = {
      base: reportSpec.pipeline.base,
      baseCols: reportSpec.pipeline.baseCols,
      stacks: reportSpec.pipeline.stacks,
      lookups: reportSpec.pipeline.lookups,
      calcStages: reportSpec.pipeline.calculatedColumns,
      detailBands: reportSpec.pipeline.detailBands || []
    };
    const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);
    const _resolvedLookups = expandLookups(
      reportSpec.pipeline.lookups || [],
      sourceCatalog
    );
    const tablesById = /* @__PURE__ */ new Map();
    for (const [tid, entry] of sourceCatalog) {
      tablesById.set(tid, { cols: entry.cols, name: entry.name });
    }
    const source = {
      base: reportSpec.pipeline.base || "",
      stacks: (reportSpec.pipeline.stacks || []).filter(
        (id) => tablesById.has(id)
      ),
      baseCols: reportSpec.pipeline.baseCols ?? (tablesById.has(reportSpec.pipeline.base) ? tablesById.get(reportSpec.pipeline.base).cols : null),
      excludedRows: {},
      tablesById
    };
    const lookups = reportSpec.pipeline.lookups || [];
    const joins = lookups.filter((lk) => lk.enabled !== false && lk.rightId && tablesById.has(lk.rightId)).map((lk) => {
      const rtMeta = tablesById.get(lk.rightId);
      return {
        rightId: lk.rightId,
        rightColumns: rtMeta ? rtMeta.cols : [],
        rightTableName: rtMeta ? rtMeta.name : lk.rightId,
        keyPairs: (lk.keyPairs || []).filter((p3) => p3.left && p3.right),
        required: !!lk.required,
        duplicatePolicy: lk.duplicatePolicy || { mode: "block" },
        excludedRows: null
      };
    }).filter((j4) => j4.keyPairs.length > 0);
    const calcStages = reportSpec.pipeline.calculatedColumns || [];
    const calculatedColumns = buildCalcExpressions(calcStages, colMap);
    const calcExprs = /* @__PURE__ */ new Map();
    for (const col of calculatedColumns) {
      calcExprs.set(col.alias, col.sql);
    }
    const filters = (reportSpec.filters || []).filter((f4) => f4.enabled !== false && f4.col);
    const aggMode = reportSpec.aggregation.mode || "none";
    const aggregates = reportSpec.aggregation.aggregates || [];
    const aggAliases = aggMode === "group" ? aggregates.map((a3) => a3.alias).filter(Boolean) : [];
    const colOrder = reportSpec.outputColumns;
    const orderedAliases = colOrder && colOrder.length > 0 ? colOrder.filter((a3) => colMap.has(a3) || aggAliases.includes(a3)) : [...colMap.keys(), ...aggAliases];
    const selectedColumns = orderedAliases;
    const sorts = (reportSpec.sorts || []).filter(
      (s3) => s3.enabled !== false && s3.col && colMap.has(s3.col)
    );
    let sql;
    let params;
    let cols;
    switch (aggMode) {
      case "group": {
        const result = buildGroupedQuery(reportSpec, colMap, sourceCatalog, calcExprs);
        sql = result.sql;
        params = result.params;
        cols = result.cols;
        break;
      }
      case "totals": {
        const result = buildTotalsQuery(reportSpec, colMap, sourceCatalog, calcExprs);
        if (!result) throw new Error("buildQueryPlan: no totals to build");
        sql = result.sql;
        params = result.params;
        cols = result.cols;
        break;
      }
      case "subtotals": {
        const result = buildSubtotalsQuery(reportSpec, colMap, sourceCatalog, calcExprs);
        if (!result) throw new Error("buildQueryPlan: no subtotals to build");
        sql = result.sql;
        params = result.params;
        cols = result.cols;
        break;
      }
      default: {
        const result = buildDetailQuery(reportSpec, colMap, sourceCatalog, calcExprs);
        sql = result.sql;
        params = result.params;
        cols = result.cols;
        break;
      }
    }
    return {
      source,
      joins,
      calculatedColumns,
      filters,
      selectedColumns,
      groupBy: reportSpec.aggregation.groupBy || [],
      aggregates,
      sorts,
      colTotals: reportSpec.aggregation.colTotals || {},
      subtotalBy: reportSpec.aggregation.subtotalBy || [],
      subtotalFns: reportSpec.aggregation.subtotalFns || {},
      subtotalGrandTotal: reportSpec.aggregation.subtotalGrandTotal !== false,
      subtotalSpacer: !!reportSpec.aggregation.subtotalSpacer,
      subtotalOnTop: !!reportSpec.aggregation.subtotalOnTop,
      subtotalStrategy: reportSpec.aggregation.subtotalStrategy || "combined",
      aggMode: reportSpec.aggregation.mode || "none",
      colMap,
      sql,
      params,
      cols
    };
  }

  // preact/report/engine.ts
  init_column_catalog();

  // preact/query/sql-detail-bands.ts
  function buildBandQuery(band, parentKeyValues, bandColMap, _sourceCatalog) {
    const childTable = quoteId(band.rightId);
    const pairs = (band.keyPairs || []).filter((p3) => p3.left && p3.right);
    const parentKeyAliases = pairs.map((p3) => p3.left);
    const childKeyCols = pairs.map((p3) => p3.right);
    const selParts = [];
    const cols = [];
    for (const [alias, entry] of bandColMap) {
      if (entry.kind === "calc") continue;
      selParts.push(`${childTable}.${quoteId(entry.col)} AS ${quoteId(alias)}`);
      cols.push(alias);
    }
    const seenKeyCols = /* @__PURE__ */ new Set();
    for (const ck of childKeyCols) {
      if (seenKeyCols.has(ck)) continue;
      seenKeyCols.add(ck);
      selParts.push(`${childTable}.${quoteId(ck)} AS ${quoteId(ck)}`);
    }
    const keyValuesArr = Array.from(parentKeyValues);
    let whereClause;
    let params;
    if (pairs.length === 0 || keyValuesArr.length === 0) {
      whereClause = "1 = 0";
      params = [];
    } else if (pairs.length === 1) {
      const placeholders = keyValuesArr.map(() => "?").join(", ");
      whereClause = `${childTable}.${quoteId(childKeyCols[0])} IN (${placeholders})`;
      params = keyValuesArr;
    } else {
      const sep = " || " + String.fromCharCode(39) + "|||" + String.fromCharCode(39) + " || ";
      const concatLeft = childKeyCols.map((ck) => `${childTable}.${quoteId(ck)}`).join(sep);
      const placeholders = keyValuesArr.map(() => "?").join(", ");
      whereClause = `(${concatLeft}) IN (${placeholders})`;
      params = keyValuesArr;
    }
    const sortParts = (band.sorts || []).filter((s3) => s3.enabled !== false && s3.col).map((s3) => `${childTable}.${quoteId(s3.col)} ${s3.dir === "DESC" ? "DESC" : "ASC"}`);
    let sql = `SELECT ${selParts.join(", ")}
FROM ${childTable}
WHERE ${whereClause}`;
    if (sortParts.length) sql += `
ORDER BY ${sortParts.join(", ")}`;
    return {
      sql,
      params,
      cols,
      parentKeyAliases,
      childKeyCols
    };
  }

  // preact/report/result-set.ts
  function buildResultSet(columns, rows, metadata) {
    const r3 = Array.isArray(rows) ? rows : [];
    return {
      columns: Array.isArray(columns) ? columns : [],
      rows: r3,
      metadata: Object.assign(
        {
          rowCount: r3.length,
          generatedAt: Date.now(),
          aggMode: "none",
          displayCols: null
        },
        metadata || {}
      )
    };
  }

  // preact/report/engine.ts
  function runDetailMode(plan) {
    const rows = execQuery(plan.sql, plan.params);
    return buildResultSet(plan.cols, rows, { aggMode: "none" });
  }
  function runTotalsMode(plan, reportSpec, tables) {
    const sourceCatalog = buildSourceCatalog(tables);
    const catalogCtx = {
      base: reportSpec.pipeline.base,
      baseCols: reportSpec.pipeline.baseCols,
      stacks: reportSpec.pipeline.stacks,
      lookups: reportSpec.pipeline.lookups,
      calcStages: reportSpec.pipeline.calculatedColumns,
      detailBands: reportSpec.pipeline.detailBands || []
    };
    const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);
    const calcStages = reportSpec.pipeline.calculatedColumns || [];
    const calculatedColumns = buildCalcExpressions(calcStages, colMap);
    const calcExprs = /* @__PURE__ */ new Map();
    for (const col of calculatedColumns) {
      calcExprs.set(col.alias, col.sql);
    }
    const detail = buildDetailQuery(reportSpec, colMap, sourceCatalog, calcExprs);
    const detailRows = execQuery(detail.sql, detail.params);
    const totalsRows = execQuery(plan.sql, plan.params);
    const newAggCols = plan.cols.slice(detail.cols.length);
    const paddedRows = newAggCols.length ? detailRows.map((r3) => {
      const row = { ...r3 };
      for (const c3 of newAggCols) row[c3] = null;
      return row;
    }) : detailRows;
    return buildResultSet(plan.cols, paddedRows, {
      aggMode: "totals",
      totalsRow: totalsRows[0] || null
    });
  }
  function runSubtotalsMode(plan) {
    const rows = execQuery(plan.sql, plan.params);
    return buildResultSet(plan.cols, rows, {
      aggMode: "subtotals",
      hasSubtotals: true,
      allCols: plan.cols
    });
  }
  function runGroupedMode(plan) {
    const rows = execQuery(plan.sql, plan.params);
    return buildResultSet(plan.cols, rows, { aggMode: "group" });
  }
  var STACK_ROW_LIMIT = 1e4;
  var RowExplosionError = class extends Error {
    /** The projected number of rows that would be produced. */
    projectedCount;
    /** The limit that was exceeded. */
    limit;
    constructor(projectedCount, limit) {
      super(
        `Detail band cross-product would produce ${projectedCount} rows, exceeding limit of ${limit}.`
      );
      this.name = "RowExplosionError";
      this.projectedCount = projectedCount;
      this.limit = limit;
    }
  };
  function computeSupersetCols(parentCols, bandResults) {
    const superset = [...parentCols];
    const seen = new Set(parentCols);
    for (const br of bandResults) {
      for (const col of br.cols) {
        if (!seen.has(col)) {
          superset.push(col);
          seen.add(col);
        }
      }
    }
    if (!seen.has("_band_id")) superset.push("_band_id");
    return superset;
  }
  function padParentRow(row, supersetCols) {
    const padded = { ...row };
    for (const col of supersetCols) {
      if (!(col in padded)) padded[col] = null;
    }
    padded._band_id = null;
    return padded;
  }
  function padBandRow(row, supersetCols, bandId) {
    const padded = {};
    for (const col of supersetCols) {
      padded[col] = col in row ? row[col] : null;
    }
    padded._band_id = bandId;
    return padded;
  }
  function interleaveRows(parentRows, bandResults, supersetCols) {
    const bandIndex = /* @__PURE__ */ new Map();
    for (const br of bandResults) {
      const idx = /* @__PURE__ */ new Map();
      for (const row of br.rows) {
        const key = makeKeyValue(row, br.childKeyCols);
        if (!idx.has(key)) idx.set(key, []);
        idx.get(key).push(row);
      }
      bandIndex.set(br.band.id, idx);
    }
    const result = [];
    for (const parentRow of parentRows) {
      result.push(padParentRow(parentRow, supersetCols));
      for (const br of bandResults) {
        const key = makeKeyValue(parentRow, br.parentKeyAliases);
        const children = bandIndex.get(br.band.id)?.get(key) || [];
        for (const child of children) {
          result.push(padBandRow(child, supersetCols, br.band.id));
        }
      }
    }
    return result;
  }
  function makeKeyValue(row, keyCols) {
    if (keyCols.length === 1) return String(row[keyCols[0]] ?? "");
    return keyCols.map((k3) => String(row[k3] ?? "")).join("|||");
  }
  function buildBandChildIndex(bandResults) {
    const index = /* @__PURE__ */ new Map();
    for (const br of bandResults) {
      const idx = /* @__PURE__ */ new Map();
      for (const row of br.rows) {
        const key = makeKeyValue(row, br.childKeyCols);
        let bucket = idx.get(key);
        if (!bucket) {
          bucket = [];
          idx.set(key, bucket);
        }
        bucket.push(row);
      }
      index.set(br.band.id, idx);
    }
    return index;
  }
  function crossProductRows(parentRow, bandResults, supersetCols, limit = STACK_ROW_LIMIT, childIndex) {
    let combinations = [parentRow];
    for (const br of bandResults) {
      const parentKey = makeKeyValue(parentRow, br.parentKeyAliases);
      let children;
      if (childIndex) {
        children = childIndex.get(br.band.id)?.get(parentKey) || [];
      } else {
        children = br.rows.filter(
          (r3) => makeKeyValue(r3, br.childKeyCols) === parentKey
        );
      }
      if (children.length === 0) continue;
      const next = [];
      for (const combo of combinations) {
        for (const child of children) {
          next.push({ ...combo, ...child, _band_id: br.band.id });
        }
      }
      if (next.length > limit) {
        throw new RowExplosionError(next.length, limit);
      }
      combinations = next;
    }
    return combinations.map((row) => {
      const padded = {};
      for (const col of supersetCols) {
        padded[col] = col in row ? row[col] : null;
      }
      return padded;
    });
  }
  function runDetailBandsMode(plan, reportSpec, tables, stackRowLimit = STACK_ROW_LIMIT) {
    const parentRows = execQuery(plan.sql, plan.params);
    const sourceCatalog = buildSourceCatalog(tables);
    const catalogCtx = {
      base: reportSpec.pipeline.base,
      baseCols: reportSpec.pipeline.baseCols,
      stacks: reportSpec.pipeline.stacks,
      lookups: reportSpec.pipeline.lookups,
      calcStages: reportSpec.pipeline.calculatedColumns,
      detailBands: reportSpec.pipeline.detailBands || []
    };
    const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);
    const parentCols = [];
    if (parentRows.length > 0) {
      const seen = /* @__PURE__ */ new Set();
      for (const row of parentRows) {
        for (const key of Object.keys(row)) {
          if (!seen.has(key)) {
            parentCols.push(key);
            seen.add(key);
          }
        }
      }
    }
    const bands = (reportSpec.pipeline.detailBands || []).filter((b2) => b2.enabled !== false && b2.rightId);
    const bandResults = [];
    for (const band of bands) {
      const prefix = `_${band.id}_`;
      const bandColMap = /* @__PURE__ */ new Map();
      for (const [alias, entry] of colMap) {
        if (alias.startsWith(prefix) && entry.kind === "band") {
          bandColMap.set(alias, entry);
        }
      }
      const pairs = (band.keyPairs || []).filter((p3) => p3.left && p3.right);
      if (pairs.length === 0) continue;
      const parentKeyAliases = pairs.map((p3) => p3.left);
      const keyValues = /* @__PURE__ */ new Set();
      for (const row of parentRows) {
        const kv = makeKeyValue(row, parentKeyAliases);
        if (kv !== void 0) keyValues.add(kv);
      }
      if (keyValues.size === 0) continue;
      const bandQuery = buildBandQuery(band, keyValues, bandColMap, sourceCatalog);
      const bandRows = execQuery(bandQuery.sql, bandQuery.params);
      for (const row of bandRows) {
        row._band_id = band.id;
      }
      bandResults.push({
        band,
        rows: bandRows,
        cols: bandQuery.cols,
        parentKeyAliases: bandQuery.parentKeyAliases,
        childKeyCols: bandQuery.childKeyCols
      });
    }
    const supersetCols = computeSupersetCols(parentCols, bandResults);
    const mode = reportSpec.detailBandMode || "separate";
    let resultRows;
    if (mode === "stack") {
      const childIndex = buildBandChildIndex(bandResults);
      resultRows = [];
      for (const parentRow of parentRows) {
        const combos = crossProductRows(parentRow, bandResults, supersetCols, stackRowLimit, childIndex);
        resultRows.push(...combos);
        if (resultRows.length > stackRowLimit) {
          throw new RowExplosionError(resultRows.length, stackRowLimit);
        }
      }
    } else {
      resultRows = interleaveRows(parentRows, bandResults, supersetCols);
    }
    const bandLabels = {};
    for (const br of bandResults) {
      bandLabels[br.band.id] = br.band.label || br.band.id;
    }
    return buildResultSet(supersetCols, resultRows, {
      aggMode: "none",
      bandCount: bandResults.length,
      bandIds: bandResults.map((br) => br.band.id),
      bandLabels
    });
  }
  function runReport(reportSpec, tables, stackRowLimit) {
    const plan = buildQueryPlan(reportSpec, tables);
    const enabledBands = (reportSpec.pipeline.detailBands || []).filter((b2) => b2.enabled !== false && b2.rightId);
    if (enabledBands.length > 0 && plan.aggMode === "none") {
      return runDetailBandsMode(plan, reportSpec, tables, stackRowLimit);
    }
    switch (plan.aggMode) {
      case "totals":
        return runTotalsMode(plan, reportSpec, tables);
      case "subtotals":
        return runSubtotalsMode(plan);
      case "group":
        return runGroupedMode(plan);
      default:
        return runDetailMode(plan);
    }
  }

  // preact/ui/sections/run-bar.tsx
  function RunBar({ onResult }) {
    const [state, setState] = d2(getStore().getState());
    const [runStatus, setRunStatus] = d2("");
    const [explosionDialog, setExplosionDialog] = d2(null);
    y2(() => getStore().subscribe((s3) => setState(s3)), []);
    const base = state.base;
    const hasBaseConfigured = !!base;
    if (!hasBaseConfigured) return null;
    const v3 = getValidation();
    const blocked = v3.reportStatus === "blocked";
    const items = Object.values(v3.items);
    const issueCount = items.filter((it) => it.blocking).length;
    const statusPill = blocked ? { text: `⚠ Blocked (${issueCount} issue${issueCount !== 1 ? "s" : ""})`, bg: "rgba(200,60,60,0.18)", color: "#e07070", border: "1px solid rgba(200,60,60,0.35)" } : { text: "✓ Healthy", bg: "rgba(50,180,100,0.15)", color: "#6ec87e", border: "1px solid rgba(50,180,100,0.3)" };
    const runDisabled = blocked;
    const runQuery = q2((overrideLimit) => {
      const currentState = getStore().getState();
      if (!currentState.base || !currentState.tables[currentState.base]) return;
      invalidateValidation();
      const val = getValidation();
      if (val.reportStatus === "blocked") {
        const blockingItems = Object.values(val.items).filter((item) => item.blocking);
        const firstMsg = blockingItems[0]?.issues?.[0]?.message || "missing source data";
        toast(`Can't run — fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ""}).`, "err");
        return;
      }
      const hasAgg = currentState.aggMode === "group" && (currentState.groupBy.length > 0 || currentState.aggregates.length > 0);
      if (!hasAgg && !["totals", "subtotals"].includes(currentState.aggMode) && currentState.selCols && currentState.selCols.size === 0) {
        toast("No output columns selected — click All or pick at least one column.", "err");
        return;
      }
      setRunStatus("Running…");
      setTimeout(() => {
        try {
          const reportSpec = {
            id: null,
            name: "",
            enabled: true,
            pipeline: {
              base: currentState.base,
              baseCols: currentState.baseCols,
              stacks: currentState.stacks,
              lookups: currentState.lookups,
              calculatedColumns: currentState.calcStages,
              detailBands: currentState.detailBands || []
            },
            outputColumns: currentState.colOrder,
            filters: currentState.filters,
            sorts: currentState.sorts,
            aggregation: {
              mode: currentState.aggMode,
              groupBy: currentState.groupBy,
              aggregates: currentState.aggregates,
              colTotals: currentState.colTotals,
              subtotalBy: currentState.subtotalBy,
              subtotalFns: currentState.subtotalFns,
              subtotalGrandTotal: currentState.subtotalGrandTotal,
              subtotalSpacer: currentState.subtotalSpacer,
              subtotalOnTop: currentState.subtotalOnTop,
              subtotalStrategy: currentState.subtotalStrategy
            },
            mergeDisplay: {
              mergedCols: currentState.mergedCols,
              mergeGroupUnderline: currentState.mergeGroupUnderline
            },
            outputDefinition: null,
            publish: { enabled: false, tableName: "" },
            detailBandMode: currentState.detailBandMode || "separate"
          };
          const resultSet = overrideLimit != null ? runReport(reportSpec, currentState.tables, overrideLimit) : runReport(reportSpec, currentState.tables);
          if (!resultSet) throw new Error("No result set returned");
          const displayRows = resultSet.rows.filter((r3) => !r3._row_type);
          const hasTotals = !!resultSet.metadata.totalsRow;
          const hasSubs = !!resultSet.metadata.hasSubtotals;
          const result = {
            rows: resultSet.rows,
            totalsRow: resultSet.metadata.totalsRow || null,
            cols: resultSet.columns,
            hasSubtotals: hasSubs
          };
          getStore().update((draft) => {
            draft.result = result;
          });
          let statusText = displayRows.length.toLocaleString() + " rows";
          if (hasTotals) statusText += " + grand total";
          if (hasSubs) statusText += " (subtotals)";
          setRunStatus(statusText);
          if (onResult) onResult(result);
        } catch (ex) {
          if (ex instanceof RowExplosionError) {
            setExplosionDialog({ projectedCount: ex.projectedCount, limit: ex.limit });
            setRunStatus("Row limit exceeded");
            return;
          }
          setRunStatus("Error");
          toast("Query error: " + ex.message, "err");
        }
      }, 20);
    }, [onResult]);
    const handleExplosionProceed = q2(() => {
      setExplosionDialog(null);
      const elevated = Math.max(5e4, Math.ceil((explosionDialog?.projectedCount ?? 5e4) * 2));
      runQuery(elevated);
    }, [runQuery, explosionDialog]);
    const handleExplosionCancel = q2(() => {
      setExplosionDialog(null);
      setRunStatus("Cancelled");
    }, []);
    return /* @__PURE__ */ u3("div", { id: "runRow", style: "display:flex;align-items:center;gap:8px;padding:8px 0", children: [
      /* @__PURE__ */ u3(
        "span",
        {
          id: "reportStatusPill",
          style: {
            background: statusPill.bg,
            color: statusPill.color,
            border: statusPill.border,
            fontSize: "0.72rem",
            padding: "2px 8px",
            borderRadius: "10px"
          },
          children: statusPill.text
        }
      ),
      /* @__PURE__ */ u3("button", { id: "runBtn", class: "btn btn-primary", disabled: runDisabled, onClick: () => runQuery(), title: "Generate your report applying all sheet combinations, filters, sort order, and summary settings.", children: [
        "Run Report ",
        /* @__PURE__ */ u3(Tip, { text: "Generate your report. This applies all your:\n• Sheet combinations and lookups\n• Calculated columns\n• Filters and sort order\n• Summary settings\n\nto produce the final output." })
      ] }),
      /* @__PURE__ */ u3("span", { id: "runStatus", style: "font-size:0.72rem;color:var(--muted)", children: runStatus }),
      explosionDialog && /* @__PURE__ */ u3(
        RowExplosionDialog,
        {
          projectedCount: explosionDialog.projectedCount,
          limit: explosionDialog.limit,
          onProceed: handleExplosionProceed,
          onCancel: handleExplosionCancel
        }
      )
    ] });
  }

  // preact/ui/tabs.ts
  init_store();
  function switchTab(name) {
    getStore().update((draft) => {
      draft.activeTab = name;
    });
  }

  // preact/ui/grid.tsx
  init_store();
  init_column_catalog();
  function _displayLabel(alias, colMap) {
    const src = colMap.get(alias);
    if (!src) return alias;
    if (src.kind === "calc") {
      const calc = getStore().getState().calcStages?.[src.idx];
      return (calc?.alias || "").trim() || alias;
    }
    return tableShortName(src.tid) + " → " + colUserLabel(src.tid, src.col);
  }
  var BAND_ROW_TINTS = [
    "rgba(148, 163, 184, 0.08)",
    // slate
    "rgba(96, 165, 250, 0.08)",
    // blue
    "rgba(74, 222, 128, 0.08)",
    // green
    "rgba(251, 146, 60, 0.08)",
    // orange
    "rgba(192, 132, 252, 0.08)"
    // purple
  ];
  function createBandRowStyler(rows) {
    const bandIndex = /* @__PURE__ */ new Map();
    let nextIdx = 0;
    for (const row of rows) {
      const bandId = row._band_id;
      if (typeof bandId === "string" && !bandIndex.has(bandId)) {
        bandIndex.set(bandId, nextIdx++);
      }
    }
    return (params) => {
      const data = params.data;
      if (!data) return void 0;
      const bandId = data._band_id;
      if (bandId == null || typeof bandId !== "string") return void 0;
      const idx = bandIndex.get(bandId);
      if (idx === void 0) return void 0;
      return { background: BAND_ROW_TINTS[idx % BAND_ROW_TINTS.length] };
    };
  }
  var gridResult = null;
  var gridPreview = null;
  function refreshResultGridLayout() {
    if (!gridResult) return;
    try {
      gridResult.resetRowHeights?.();
    } catch {
    }
    try {
      gridResult.refreshCells?.({ force: true });
    } catch {
    }
    try {
      gridResult.redrawRows?.();
    } catch {
    }
  }
  function refreshPreviewGridLayout() {
    if (!gridPreview) return;
    try {
      gridPreview.resetRowHeights?.();
    } catch {
    }
    try {
      gridPreview.refreshCells?.({ force: true });
    } catch {
    }
    try {
      gridPreview.redrawRows?.();
    } catch {
    }
  }
  function _saveResultColState() {
    if (gridResult) {
      const colState = gridResult.getColumnState();
      getStore().update((draft) => {
        draft.colState = colState;
      });
    }
  }
  function ResultGrid({ result, onRenameDone }) {
    const gridRef = A2(null);
    y2(() => {
      const el = gridRef.current;
      if (!el) return;
      const { rows: rows2, totalsRow: totalsRow2, cols: cols2 } = result;
      const hasData2 = rows2.length > 0 || totalsRow2 !== null;
      if (gridResult) {
        gridResult.destroy();
        gridResult = null;
      }
      if (!hasData2) return;
      const tableData = totalsRow2 ? [...rows2, { ...totalsRow2, _isTotalsRow: true }] : rows2;
      const colDefs = makeResultCols(cols2, onRenameDone);
      const bandStyler = createBandRowStyler(rows2);
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
        getRowStyle: (params) => bandStyler(params),
        pagination: true,
        paginationPageSize: 500,
        paginationPageSizeSelector: [100, 250, 500, 1e3, 5e3],
        multiSortKey: "ctrl",
        onColumnMoved: () => _saveResultColState(),
        onColumnResized: () => _saveResultColState(),
        onColumnVisible: () => _saveResultColState()
      };
      gridResult = agGrid.createGrid(el, options);
      requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
      const state = getStore().getState();
      if (state.colState) {
        gridResult.applyColumnState(state.colState);
      }
      return () => {
        if (gridResult) {
          gridResult.destroy();
          gridResult = null;
        }
      };
    }, [result, onRenameDone]);
    const { rows, totalsRow, cols } = result;
    const hasData = rows.length > 0 || totalsRow !== null;
    return /* @__PURE__ */ u3(S, { children: hasData ? /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("span", { class: "results-count", style: "font-size:0.76rem;color:var(--muted)", children: totalsRow ? rows.length.toLocaleString() + " rows + 1 totals row · " + cols.length + " columns" : rows.length.toLocaleString() + " rows · " + cols.length + " columns" }),
      /* @__PURE__ */ u3("div", { ref: gridRef, class: "ag-theme-balham-dark", style: "height:100%;width:100%" })
    ] }) : /* @__PURE__ */ u3("div", { class: "empty", children: [
      /* @__PURE__ */ u3("div", { class: "empty-icon", children: "🔍" }),
      /* @__PURE__ */ u3("div", { children: "No rows matched your query" })
    ] }) });
  }
  function PreviewGrid({ tableId, onRenameDone }) {
    const gridRef = A2(null);
    y2(() => {
      const el = gridRef.current;
      if (!el) return;
      const state2 = getStore().getState();
      if (gridPreview) {
        gridPreview.destroy();
        gridPreview = null;
      }
      if (!tableId || !state2.tables[tableId]) return;
      const t4 = state2.tables[tableId];
      const cap2 = 1e4;
      const excluded2 = state2.excludedRows[tableId] || /* @__PURE__ */ new Set();
      let rows;
      try {
        rows = execQuery(`SELECT "_rowno", ${t4.cols.map((c3) => quoteId(c3)).join(", ")} FROM ${quoteId(tableId)} LIMIT ${cap2}`);
      } catch {
        return;
      }
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
          const isExcl = excluded2.has(rowno);
          const btn = document.createElement("button");
          const rowData = params.data;
          const preview = t4.cols.filter((c3) => c3 !== "_rowno").map((c3) => rowData[c3] == null ? "" : String(rowData[c3])).filter((v3) => v3 !== "").slice(0, 6).join(" · ");
          const action = isExcl ? "Restore row to reports" : "Exclude row from reports";
          btn.title = `${action}
→ ${preview}`;
          btn.style.cssText = "background:transparent;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1";
          btn.textContent = isExcl ? "🚫" : "✅";
          btn.addEventListener("click", () => {
            getStore().update((draft) => {
              if (!draft.excludedRows[tableId]) draft.excludedRows[tableId] = /* @__PURE__ */ new Set();
              const set = draft.excludedRows[tableId];
              if (set.has(rowno)) set.delete(rowno);
              else set.add(rowno);
            });
          });
          return btn;
        }
      };
      gridPreview = agGrid.createGrid(el, {
        rowData: rows,
        columnDefs: [excludeColDef, ...makePreviewCols(tableId, t4.cols, onRenameDone)],
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
          if (excluded2.has(rowno)) {
            return {
              color: "#c0392b",
              textDecoration: "line-through",
              background: "rgba(220,50,50,0.08)"
            };
          }
        }
      });
      requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
      return () => {
        if (gridPreview) {
          gridPreview.destroy();
          gridPreview = null;
        }
      };
    }, [tableId, onRenameDone]);
    const state = getStore().getState();
    if (!tableId || !state.tables[tableId]) {
      return /* @__PURE__ */ u3("div", { class: "empty", children: [
        /* @__PURE__ */ u3("div", { class: "empty-icon", children: "👆" }),
        /* @__PURE__ */ u3("div", { children: "Select a table above" })
      ] });
    }
    try {
      const t4 = state.tables[tableId];
      execQuery(`SELECT "_rowno", ${t4.cols.map((c3) => quoteId(c3)).join(", ")} FROM ${quoteId(tableId)} LIMIT 1`);
    } catch (ex) {
      return /* @__PURE__ */ u3("div", { class: "empty", children: [
        /* @__PURE__ */ u3("div", { class: "empty-icon", children: "❌" }),
        /* @__PURE__ */ u3("div", { children: ex.message })
      ] });
    }
    const t3 = state.tables[tableId];
    const excluded = state.excludedRows[tableId] || /* @__PURE__ */ new Set();
    const excCount = excluded.size;
    const cap = 1e4;
    return /* @__PURE__ */ u3(S, { children: [
      excCount > 0 && /* @__PURE__ */ u3("div", { style: "padding:4px 10px;font-size:12px;background:rgba(255,170,0,0.12);border-bottom:1px solid rgba(255,170,0,0.3);color:#c9a020;display:flex;align-items:center;gap:8px;", children: [
        /* @__PURE__ */ u3("span", { children: [
          "⚠",
          " ",
          excCount,
          " row",
          excCount > 1 ? "s" : "",
          " excluded from reports"
        ] }),
        /* @__PURE__ */ u3(
          "button",
          {
            style: "font-size:11px;padding:1px 7px;border-radius:3px;border:1px solid #c9a020;background:transparent;color:#c9a020;cursor:pointer",
            onClick: () => {
              getStore().update((draft) => {
                draft.excludedRows[tableId] = /* @__PURE__ */ new Set();
              });
            },
            children: "Clear all"
          }
        )
      ] }),
      /* @__PURE__ */ u3("span", { style: "font-size:0.76rem;color:var(--muted);padding:2px 4px", children: [
        t3.rowCount.toLocaleString(),
        " rows \\u00b7 ",
        t3.cols.length,
        " cols",
        excCount ? " · " + excCount + " excluded" : "",
        t3.rowCount > cap ? " (preview: first " + cap.toLocaleString() + ")" : ""
      ] }),
      /* @__PURE__ */ u3("div", { ref: gridRef, class: "ag-theme-balham-dark", style: "height:100%;width:100%" })
    ] });
  }
  function makeResultCols(cols, onRenameDone) {
    const colMap = buildColSourceMap();
    const state = getStore().getState();
    const dataCols = cols.filter((c3) => c3 !== "_rowno" && c3 !== "_row_type" && c3 !== "_isTotalsRow" && c3 !== "_band_id");
    return dataCols.map((c3) => {
      const src = colMap.get(c3);
      const dispLabel = _displayLabel(c3, colMap);
      const srcPhys = src;
      const renamed = src && src.kind !== "calc" ? state.columnLabels?.[srcPhys.tid]?.[srcPhys.col] : void 0;
      const color = src ? getTableColor(srcPhys?.tid || "") : null;
      const doRename = () => {
        const target = resolveRenameTarget(c3);
        if (!target) return;
        if (onRenameDone) onRenameDone();
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
            if (onRenameDone) onRenameDone();
          } : null
        ),
        cellRenderer: (params) => {
          const v3 = params.value;
          return v3 == null ? "" : String(v3);
        }
      };
    });
  }
  function makePreviewCols(tid, physCols, onRenameDone) {
    const color = getTableColor(tid);
    const state = getStore().getState();
    return physCols.filter((c3) => c3 !== "_rowno").map((c3) => {
      const renamed = state.columnLabels?.[tid]?.[c3];
      const label = renamed || c3;
      const doRename = () => {
        const colMap = buildColSourceMap();
        for (const [alias, src] of colMap.entries()) {
          if (src && src.kind !== "calc" && src.tid === tid && src.col === c3) {
            const target = resolveRenameTarget(alias);
            if (target && onRenameDone) onRenameDone();
            return;
          }
        }
      };
      const doClear = renamed ? () => {
        setColLabel(tid, c3, c3);
        if (onRenameDone) onRenameDone();
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
          more.textContent = "⋯";
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
          clr.textContent = "×";
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

  // preact/ui/export.ts
  init_store();
  init_column_catalog();
  var XLSX_INTERNAL_COLS = /* @__PURE__ */ new Set([
    "_rowno",
    "_row_type",
    "_isTotalsRow",
    "_band_id",
    "_sort_row_type"
  ]);
  var CSV_INTERNAL_COLS = /* @__PURE__ */ new Set([
    "_rowno",
    "_row_type",
    "_isTotalsRow",
    "_sort_row_type"
  ]);
  function filterExportCols(cols, isCsv = false) {
    const internalCols = isCsv ? CSV_INTERNAL_COLS : XLSX_INTERNAL_COLS;
    return cols.filter(
      (c3) => !internalCols.has(c3) && !String(c3).startsWith("_sort_group_")
    );
  }
  function buildBandLabels(detailBands, tables) {
    const result = {};
    for (const band of detailBands || []) {
      result[band.id] = band.label || tables?.[band.rightId]?.name || band.id;
    }
    return result;
  }
  var BAND_TINT_PALETTE = [
    "FFF8FAFC",
    // slate-50
    "FFEFF6FF",
    // blue-50
    "FFF0FDF4",
    // green-50
    "FFFFF7ED",
    // orange-50
    "FFFDF4FF"
    // purple-50
  ];
  function enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, isCsv) {
    let enrichedRows;
    if (!isCsv) {
      enrichedRows = [];
      let prevBandId = void 0;
      for (const row of dataRows) {
        const bandId = row._band_id;
        if (bandId != null && bandId !== prevBandId) {
          const headerRow = { _isBandHeader: true };
          for (const c3 of exportCols) {
            headerRow[c3] = "";
          }
          headerRow[exportCols[0]] = bandLabels[String(bandId)] || String(bandId);
          enrichedRows.push(headerRow);
        }
        enrichedRows.push(row);
        prevBandId = bandId;
      }
    } else {
      enrichedRows = dataRows;
    }
    const rowKinds = enrichedRows.map((r3) => {
      if (r3._isBandHeader) return 4;
      if (r3._isTotalsRow) return 3;
      const t3 = Number(r3._row_type);
      return Number.isFinite(t3) ? t3 : 0;
    });
    return { enrichedRows, rowKinds };
  }
  async function exportAs(fmt) {
    const state = getStore().getState();
    if (!state.result || !state.result.rows) return;
    const v3 = getValidation();
    if (v3 && v3.reportStatus === "blocked") {
      const blockingItems = Object.values(v3.items).filter((item) => item.blocking);
      const firstMsg = blockingItems[0]?.issues?.[0]?.message || "missing source data";
      toast(`Can't export — fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ""}).`, "err");
      return;
    }
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fn = "report-" + ts;
    const result = state.result;
    const { rows, totalsRow, cols } = result;
    const colMap = buildColSourceMap();
    const hdrMap = await buildExportHeaderMap(cols || [], colMap);
    const isCsv = fmt === "csv";
    const exportCols = filterExportCols(cols || [], isCsv);
    const exportHeaders = exportCols.map((c3) => hdrMap?.[c3] || c3);
    const mergeHeaderSet = new Set(
      exportCols.filter((c3) => (state.mergedCols || []).includes(c3)).map((c3) => hdrMap?.[c3] || c3)
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
    const bandLabels = buildBandLabels(state.detailBands, state.tables);
    const { enrichedRows, rowKinds } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, isCsv);
    const clean = enrichedRows.map(remap);
    if (isCsv) {
      const ws = XLSX.utils.json_to_sheet(clean, { header: exportHeaders, skipHeader: false });
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      dl(blob, fn + ".csv");
    } else {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(clean, { header: exportHeaders, skipHeader: false });
      applyExportMerges(ws, clean, rowKinds, exportHeaders, mergeHeaderSet);
      const bandIds = enrichedRows.map((r3) => r3._band_id != null ? String(r3._band_id) : "");
      styleExportSheet(ws, clean, rowKinds, mergeHeaderSet, bandIds);
      XLSX.utils.book_append_sheet(wb, ws, "Results");
      XLSX.writeFile(wb, fn + ".xlsx");
    }
    toast("Exported " + clean.length.toLocaleString() + " rows as " + fmt.toUpperCase(), "ok");
  }
  function applyExportMerges(ws, cleanRows, rowKinds, headers, mergeHeaderSet) {
    if (!ws || !Array.isArray(cleanRows) || !cleanRows.length) return;
    if (!headers || !headers.length || !mergeHeaderSet || mergeHeaderSet.size === 0) return;
    const merges = [];
    headers.forEach((h6, cIdx) => {
      if (!mergeHeaderSet.has(h6)) return;
      const leftGateHeaders = headers.slice(0, cIdx).filter((lh) => mergeHeaderSet.has(lh));
      const gateByLeft = leftGateHeaders.length > 0;
      let i3 = 0;
      while (i3 < cleanRows.length) {
        if ((rowKinds[i3] ?? 0) !== 0) {
          i3++;
          continue;
        }
        const v3 = cleanRows[i3]?.[h6];
        if (v3 == null || String(v3) === "") {
          i3++;
          continue;
        }
        let j4 = i3 + 1;
        while (j4 < cleanRows.length && (rowKinds[j4] ?? 0) === 0 && cleanRows[j4]?.[h6] === v3) {
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
            const addr = XLSX.utils.encode_cell({ r: rr, c: cIdx });
            ws[addr] = { t: "z", v: void 0 };
          }
        }
        i3 = j4;
      }
    });
    if (merges.length) ws["!merges"] = merges;
  }
  function styleExportSheet(ws, cleanRows, rowKinds, mergeHeaderSet = /* @__PURE__ */ new Set(), bandIds) {
    const ref = ws["!ref"];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    const borderColor = { rgb: "FF6B7280" };
    const grandBorderColor = { rgb: "FF4B5563" };
    const fontBase = { name: "Aptos", sz: 11, color: { rgb: "FF111827" } };
    const MIN_COL_WCH = 10;
    const MAX_COL_WCH = 40;
    const WIDTH_SAMPLE_ROWS = 300;
    const BODY_ROW_HPT = 18;
    const headers = cleanRows[0] ? Object.keys(cleanRows[0]) : [];
    const mergeStartSet = new Set((ws["!merges"] || []).map((m3) => `${m3.s.r}:${m3.s.c}`));
    const state = getStore().getState();
    const underlineMergedGroups = !!state?.mergeGroupUnderline;
    const mergeUnderlineStartByRow = /* @__PURE__ */ new Map();
    if (underlineMergedGroups) {
      const mergeParticipation = /* @__PURE__ */ new Map();
      const addUnderline = (bodyRowIdx, colIdx) => {
        const sheetRow = bodyRowIdx + 1;
        if (sheetRow < 1) return;
        const prev = mergeUnderlineStartByRow.get(sheetRow);
        mergeUnderlineStartByRow.set(sheetRow, prev == null ? colIdx : Math.min(prev, colIdx));
      };
      headers.forEach((h6, cIdx) => {
        if (!mergeHeaderSet.has(h6)) return;
        const leftGateHeaders = headers.slice(0, cIdx).filter((lh) => mergeHeaderSet.has(lh));
        let i3 = 0;
        while (i3 < cleanRows.length) {
          if ((rowKinds[i3] ?? 0) !== 0) {
            i3++;
            continue;
          }
          const v3 = cleanRows[i3]?.[h6];
          if (v3 == null || String(v3) === "") {
            i3++;
            continue;
          }
          let j4 = i3 + 1;
          while (j4 < cleanRows.length && (rowKinds[j4] ?? 0) === 0 && cleanRows[j4]?.[h6] === v3) {
            if (leftGateHeaders.some((lh) => cleanRows[j4]?.[lh] !== cleanRows[j4 - 1]?.[lh])) break;
            j4++;
          }
          const span = j4 - i3;
          if (span > 1) {
            let p3 = mergeParticipation.get(h6);
            if (!p3) {
              p3 = /* @__PURE__ */ new Set();
              mergeParticipation.set(h6, p3);
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
      const addr = XLSX.utils.encode_cell({ r: 0, c: c3 });
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
      if (rowType === 4) {
        for (let c3 = range.s.c; c3 <= range.e.c; c3++) {
          const addr = XLSX.utils.encode_cell({ r: r3, c: c3 });
          let cell = ws[addr];
          if (!cell) {
            cell = { t: "s", v: "" };
            ws[addr] = cell;
          }
          cell.s = {
            font: { ...fontBase, bold: true, italic: true, color: { rgb: "FF1E40AF" } },
            fill: { fgColor: { rgb: "FFDBEAFE" } },
            alignment: { horizontal: "left", vertical: "center" },
            border: { bottom: { style: "thin", color: borderColor } }
          };
        }
        continue;
      }
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
        const addr = XLSX.utils.encode_cell({ r: r3, c: c3 });
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
        else {
          const rowBandId = bandIds?.[r3 - 1] ?? "";
          const bIdx = rowBandId ? bandIds.indexOf(rowBandId) : -1;
          if (bIdx >= 0) {
            style.fill = { fgColor: { rgb: BAND_TINT_PALETTE[bIdx % BAND_TINT_PALETTE.length] } };
          }
        }
        cell.s = style;
      }
    }
    ws["!autofilter"] = { ref };
    ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
    ws["!cols"] = headers.map((h6) => {
      let maxLen = String(h6 || "").length;
      const sample = Math.min(cleanRows.length, WIDTH_SAMPLE_ROWS);
      for (let i3 = 0; i3 < sample; i3++) {
        const v3 = cleanRows[i3]?.[h6];
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

  // preact/ui/app.tsx
  function PreviewPanel() {
    const [state, setState] = d2(getStore().getState());
    const [selectedTable, setSelectedTable] = d2("");
    y2(() => {
      const unsub = getStore().subscribe((s3) => setState(s3));
      return unsub;
    }, []);
    const tableIds = Object.keys(state.tables).sort(
      (a3, b2) => state.tables[a3].name.localeCompare(state.tables[b2].name)
    );
    y2(() => {
      const previewId = state.previewTableId;
      if (previewId && state.tables[previewId] && previewId !== selectedTable) {
        setSelectedTable(previewId);
      }
    }, [state]);
    const handleSelect = q2((e3) => {
      const val = e3.target.value;
      setSelectedTable(val);
    }, []);
    return /* @__PURE__ */ u3("div", { class: "data-body", children: [
      /* @__PURE__ */ u3("div", { class: "btn-row", style: "flex-shrink:0", children: /* @__PURE__ */ u3("div", { style: "flex:1;max-width:320px", children: /* @__PURE__ */ u3("select", { value: selectedTable, onChange: handleSelect, children: [
        /* @__PURE__ */ u3("option", { value: "", children: [
          "—",
          " select a table to preview ",
          "—"
        ] }),
        tableIds.map((id) => /* @__PURE__ */ u3("option", { value: id, children: h3(state.tables[id].name) }, id))
      ] }) }) }),
      /* @__PURE__ */ u3("div", { class: "grid-wrap", children: /* @__PURE__ */ u3(PreviewGrid, { tableId: selectedTable }, selectedTable) })
    ] });
  }
  function ResultsPanel() {
    const [state, setState] = d2(getStore().getState());
    y2(() => {
      const unsub = getStore().subscribe((s3) => setState(s3));
      return unsub;
    }, []);
    const result = state.result;
    const hasResults = !!(result && result.rows);
    return /* @__PURE__ */ u3("div", { class: "data-body", children: [
      /* @__PURE__ */ u3("div", { class: "results-bar", children: [
        /* @__PURE__ */ u3("span", { class: "results-count", style: !hasResults ? { fontSize: "0.76rem", color: "var(--muted)" } : void 0, children: hasResults ? "" : "No results yet — run a query first" }),
        /* @__PURE__ */ u3("div", { style: "flex:1" }),
        hasResults && /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-ghost",
              onClick: () => exportAs("xlsx"),
              "data-tip": "Download the current report results as an Excel (.xlsx) file you can open in Microsoft Excel.",
              children: [
                "⬇",
                " Excel"
              ]
            }
          ),
          /* @__PURE__ */ u3(
            "button",
            {
              class: "btn btn-ghost",
              onClick: () => exportAs("csv"),
              "data-tip": "Download as a comma-separated values (.csv) file — a simple text format that any spreadsheet program can open.",
              children: [
                "⬇",
                " CSV"
              ]
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "grid-wrap", children: hasResults ? /* @__PURE__ */ u3(
        ResultGrid,
        {
          result,
          onRenameDone: () => {
            invalidateValidation();
          }
        }
      ) : /* @__PURE__ */ u3("div", { class: "empty", children: [
        /* @__PURE__ */ u3("div", { class: "empty-icon", children: "⚡" }),
        /* @__PURE__ */ u3("div", { class: "empty-title", children: "No results yet" }),
        /* @__PURE__ */ u3("div", { class: "empty-sub", children: [
          "Build a query and click ",
          "▶",
          " Run Report"
        ] })
      ] }) })
    ] });
  }
  function QueryBuilderTab() {
    const [state, setState] = d2(getStore().getState());
    y2(() => {
      const unsub = getStore().subscribe((s3) => setState(s3));
      return unsub;
    }, []);
    const ids = Object.keys(state.tables).sort(
      (a3, b2) => state.tables[a3].name.localeCompare(state.tables[b2].name)
    );
    const hasBase = !!state.base && !!state.tables[state.base];
    const hasBaseConfigured = !!state.base;
    if (ids.length === 0) {
      return /* @__PURE__ */ u3("div", { class: "empty", children: [
        /* @__PURE__ */ u3("div", { class: "empty-icon", children: "📂" }),
        /* @__PURE__ */ u3("div", { class: "empty-title", children: "Drop files to get started" }),
        /* @__PURE__ */ u3("div", { class: "empty-sub", children: [
          "Drop your Excel or CSV files ",
          "—",
          " each sheet becomes available to build your report from"
        ] })
      ] });
    }
    return /* @__PURE__ */ u3("div", { class: "qb-body", children: [
      /* @__PURE__ */ u3(PipelineCard, {}),
      hasBase && /* @__PURE__ */ u3(LayoutCard, {}),
      hasBase && /* @__PURE__ */ u3(FilterSortCard, {}),
      hasBaseConfigured && /* @__PURE__ */ u3(RunBar, { onResult: () => switchTab("results") })
    ] });
  }
  function App() {
    const [state, setState] = d2(getStore().getState());
    const activeTab = state.activeTab || "query";
    y2(() => {
      const unsub = getStore().subscribe((s3) => setState(s3));
      return unsub;
    }, []);
    y2(() => {
      if (activeTab === "results") {
        requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
      }
      if (activeTab === "preview") {
        requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
      }
    }, [activeTab]);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3(Loader, {}),
      /* @__PURE__ */ u3("div", { class: "hdr", children: [
        /* @__PURE__ */ u3("h1", { children: [
          "TableFlip (",
          "╯",
          "°",
          "□",
          "°",
          ")",
          "╯",
          "︵",
          " ",
          "┻",
          "━",
          "┻"
        ] }),
        /* @__PURE__ */ u3("div", { class: "spacer" }),
        /* @__PURE__ */ u3("span", { class: "sub", children: [
          "Flip your spreadsheet tables into reports ",
          "—",
          " no 250-character formulas required"
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "layout", children: [
        /* @__PURE__ */ u3(Sidebar, {}),
        /* @__PURE__ */ u3("div", { class: "main", children: [
          /* @__PURE__ */ u3("div", { class: "tabs", children: [
            /* @__PURE__ */ u3(
              "div",
              {
                class: `tab-btn${activeTab === "query" ? " active" : ""}`,
                onClick: () => switchTab("query"),
                children: [
                  "Report Setup",
                  " ",
                  /* @__PURE__ */ u3(
                    "span",
                    {
                      class: "tip",
                      "data-tip": "Set up your report here: choose a main sheet, combine it with others, pick which columns to show, filter rows, sort, and summarize.",
                      children: "?"
                    }
                  )
                ]
              }
            ),
            /* @__PURE__ */ u3(
              "div",
              {
                class: `tab-btn${activeTab === "preview" ? " active" : ""}`,
                onClick: () => switchTab("preview"),
                children: [
                  "Browse Sheet",
                  " ",
                  /* @__PURE__ */ u3("span", { class: "tip", "data-tip": "Look at the raw data in any loaded sheet — no filters or summary applied.", children: "?" })
                ]
              }
            ),
            /* @__PURE__ */ u3(
              "div",
              {
                class: `tab-btn${activeTab === "results" ? " active" : ""}`,
                onClick: () => switchTab("results"),
                children: [
                  "Report",
                  " ",
                  /* @__PURE__ */ u3(
                    "span",
                    {
                      class: "tip",
                      "data-tip": "View your report results here after clicking Run Report. Export to Excel or CSV from this tab.",
                      children: "?"
                    }
                  )
                ]
              }
            )
          ] }),
          /* @__PURE__ */ u3("div", { class: "tab-content", children: [
            /* @__PURE__ */ u3(
              "div",
              {
                class: `tab-panel${activeTab === "query" ? " active" : ""}`,
                id: "tab-query",
                children: /* @__PURE__ */ u3(QueryBuilderTab, {})
              }
            ),
            /* @__PURE__ */ u3(
              "div",
              {
                class: `tab-panel${activeTab === "preview" ? " active" : ""}`,
                id: "tab-preview",
                children: /* @__PURE__ */ u3(PreviewPanel, {})
              }
            ),
            /* @__PURE__ */ u3(
              "div",
              {
                class: `tab-panel${activeTab === "results" ? " active" : ""}`,
                id: "tab-results",
                children: /* @__PURE__ */ u3(ResultsPanel, {})
              }
            )
          ] })
        ] })
      ] })
    ] });
  }

  // preact/app.ts
  async function main() {
    await initDb();
    initStore();
    const root = document.getElementById("app");
    if (root) {
      R(k(App, null), root);
    } else {
      const el = document.createElement("div");
      el.id = "app";
      document.body.appendChild(el);
      R(k(App, null), el);
    }
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) {
      overlay.style.display = "none";
    }
    initTooltipEngine();
  }
  function initTooltipEngine() {
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
  main().catch((err) => {
    console.error("[app] Failed to initialize:", err);
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) {
      overlay.innerHTML = `
      <div style="font-size:2rem">⚠️</div>
      <div style="font-size:1rem;font-weight:600">Failed to load</div>
      <div style="font-size:0.8rem;color:var(--muted)">${String(err.message || err)}</div>
    `;
    }
  });
})();
