import { db } from '../core/state.js';

export interface PhysicalColEntry {
  kind?: undefined;
  tid: string;
  col: string;
}

export interface CalcColEntry {
  kind: 'calc';
  idx: number;
  mode: string;
  calc?: unknown;
}

export type ColMapEntry = PhysicalColEntry | CalcColEntry;

interface ColumnCatalog {
  colMap: Map<string, ColMapEntry>;
  lookupBoundaries: Map<string, ColMapEntry>[];
  reportSpec: Record<string, unknown>;
}

function tablePrefix(name: string): string {
  return name.split('—').pop()!.trim().replace(/[^A-Za-z0-9_]/g, '_') + '__';
}

export function buildColSourceMap(ctx?: { base: string; lookups: LookupSpec[]; calcStages: CalcStage[] }): Map<string, ColMapEntry> {
  ctx = ctx || (db as { base: string; lookups: LookupSpec[]; calcStages: CalcStage[] });
  const base       = ctx.base;
  const lookups    = ctx.lookups;
  const calcStages = ctx.calcStages;
  const map = new Map<string, ColMapEntry>();
  if (!base || !db.tables[base]) return map;

  db.tables[base].cols.forEach(c => map.set(c, { tid: base, col: c }));

  for (const lk of (lookups || [])) {
    if (lk.enabled === false) continue;
    if (!lk.rightId || !db.tables[lk.rightId]) continue;
    const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter(p => p.left && p.right) : [];
    if (!pairs.length) continue;
    const rt     = db.tables[lk.rightId];
    const prefix = tablePrefix(rt.name);
    rt.cols.forEach(c => {
      const alias = map.has(c) ? prefix + c : c;
      if (!map.has(alias)) map.set(alias, { tid: lk.rightId, col: c });
    });
  }

  for (const [i, calc] of (calcStages || []).entries()) {
    if (calc?.enabled === false) continue;
    const alias = (calc?.alias || '').trim();
    if (!alias) continue;
    if (!calc.mode || !['math', 'compare', 'text', 'date'].includes(calc.mode)) continue;

    let valid = false;
    if (calc.mode === 'math') {
      const m = calc.math as Record<string, unknown> | undefined;
      const steps = (m && Array.isArray(m.steps) ? m.steps : []) as { op?: string; type?: string; value?: string }[];
      const structValid = !!(m && m.strategy === 'stepChain' && steps.length > 0 &&
              !steps[0].op && steps.every(s => s && ['column', 'number', 'text'].includes(s.type!)) &&
              steps.slice(1).every(s => s.op && ['+', '-', '*', '/', '%'].includes(s.op)));
      const colsExist = structValid && steps
        .filter(s => s.type === 'column' && s.value)
        .every(s => map.has(s.value!));
      valid = structValid && colsExist;
    } else if (calc.mode === 'compare') {
      const c = calc.compare as Record<string, unknown> | undefined;
      const conds = (Array.isArray(c?.conditions) ? c.conditions : []) as { col?: string; op?: string }[];
      valid = !!(c && conds.length > 0 && c.trueValue && c.falseValue &&
              conds.every(cond => cond.col && ['=', '!=', '>', '>=', '<', '<='].includes(cond.op!)) &&
              conds.some(cond => map.has(cond.col!)) &&
              ['column', 'number', 'text'].includes((c.trueValue as Record<string, unknown>).type as string) &&
              ['column', 'number', 'text'].includes((c.falseValue as Record<string, unknown>).type as string));
    } else if (calc.mode === 'text') {
      const t = calc.text as Record<string, unknown> | undefined;
      if (t && ['combine', 'left', 'right', 'substring'].includes(t.operation as string)) {
        if (t.operation === 'combine') {
          const parts = (Array.isArray(t.parts) ? t.parts : []) as { type?: string; value?: string }[];
          const structValid = parts.length > 0 && parts.every(p => p && ['column', 'number', 'text'].includes(p.type!));
          const colsExist = structValid && parts
            .filter(p => p.type === 'column' && p.value)
            .every(p => map.has(p.value!));
          valid = structValid && colsExist;
        } else {
          const src = t.source as Record<string, unknown> | undefined;
          const structValid = !!(src && ['column', 'text'].includes(src.type as string));
          const colExists = structValid && src!.type !== 'column' ? true : map.has(src!.value as string);
          valid = structValid && colExists;
        }
      }
    } else if (calc.mode === 'date') {
      const d = calc.date as Record<string, unknown> | undefined;
      if (d && d.operation === 'extract') {
        const src = d.source as Record<string, unknown> | undefined;
        const structValid = !!(src && src.type === 'column');
        const colExists = structValid && map.has(src!.value as string);
        valid = structValid && colExists && ['year', 'month', 'day', 'dow', 'week', 'quarter', 'julian'].includes(d.part as string);
      }
    }
    if (!valid) continue;
    if (map.has(alias)) continue;
    map.set(alias, { kind: 'calc', mode: calc.mode, idx: i, calc: calc });
  }

  return map;
}

export function projectedCols(ctx?: { base: string; lookups: LookupSpec[]; calcStages: CalcStage[] }): string[] {
  return [...buildColSourceMap(ctx).keys()];
}

// Projected cols available as left-key for lookup[upTo].
// Uses ALL right-table cols (not just lk.cols) so the user can join on any
// prior-lookup column even if it is not brought into the output.
export function projectedColsUpToLookup(upTo: number, ctx?: { base: string; lookups: LookupSpec[] }): string[] {
  ctx = ctx || (db as { base: string; lookups: LookupSpec[] });
  const base    = ctx.base;
  const lookups = ctx.lookups;
  if (!base || !db.tables[base]) return [];
  const cols   = [...db.tables[base].cols];
  const colSet = new Set(cols);
  for (let i = 0; i < upTo; i++) {
    const lk = (lookups || [])[i];
    if (!lk || lk.enabled === false || !lk.rightId || !db.tables[lk.rightId]) continue;
    const rt     = db.tables[lk.rightId];
    const prefix = tablePrefix(rt.name);
    rt.cols.forEach(c => {
      const alias = colSet.has(c) ? prefix + c : c;
      if (!colSet.has(alias)) { cols.push(alias); colSet.add(alias); }
    });
  }
  return cols;
}

// ── Catalog-based API ──────────────────────────────────────────────────────────
// buildColumnCatalog builds from explicit reportSpec (no window.db config reads).
// sourceCatalog is a SourceCatalog Map<tid, { id, name, cols, kind, source }>
// produced by buildSourceCatalog() in source-catalog.js.
// sourceCatalog (Map) is required — throws if missing.
export function buildColumnCatalog(reportSpec: Record<string, unknown>, sourceCatalog: Map<string, { cols?: string[]; name?: string }>): ColumnCatalog {
  reportSpec   = reportSpec   || (db as unknown as Record<string, unknown>);
  if (!(sourceCatalog instanceof Map)) {
    throw new Error('buildColumnCatalog: sourceCatalog (Map) is required');
  }

  const base       = reportSpec.base as string | undefined;
  const lookups    = (reportSpec.lookups || []) as LookupSpec[];
  const calcStages = (reportSpec.calcStages || []) as CalcStage[];

  function tableColumns(tid: string): string[] | null {
    const entry = sourceCatalog.get(tid);
    return entry ? (entry.cols ?? null) : null;
  }

  function tableName(tid: string): string {
    const entry = sourceCatalog.get(tid);
    return entry ? (entry.name ?? tid) : tid;
  }

  const colMap = new Map<string, ColMapEntry>();

  // Base columns
  const baseCols = base ? tableColumns(base) : null;
  if (baseCols) {
    baseCols.forEach(c => colMap.set(c, { tid: base!, col: c }));
  }

  // Lookup boundary snapshots for getColumnsAvailableBeforeLookup
  // lookupBoundaries[i] = Map of aliases available just before lookups[i]
  const lookupBoundaries = [new Map(colMap)]; // snapshot before lookup[0]

  // Lookup columns
  for (const lk of lookups) {
    if (lk.enabled === false || !lk.rightId) {
      lookupBoundaries.push(new Map(colMap));
      continue;
    }
    const rtCols = tableColumns(lk.rightId);
    if (!rtCols) { lookupBoundaries.push(new Map(colMap)); continue; }
    const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter(p => p.left && p.right) : [];
    if (!pairs.length) { lookupBoundaries.push(new Map(colMap)); continue; }
    const rName  = tableName(lk.rightId);
    const prefix = tablePrefix(rName);
    rtCols.forEach(c => {
      const alias = colMap.has(c) ? prefix + c : c;
      if (!colMap.has(alias)) colMap.set(alias, { tid: lk.rightId, col: c });
    });
    lookupBoundaries.push(new Map(colMap)); // snapshot after this lookup
  }

  // Calculated columns
  for (const [i, calc] of calcStages.entries()) {
    if (calc?.enabled === false) continue;
    const alias = (calc?.alias || '').trim();
    if (!alias) continue;
    if (!calc.mode || !['math', 'compare', 'text', 'date'].includes(calc.mode)) continue;

    let valid = false;
    if (calc.mode === 'math') {
      const m = calc.math as Record<string, unknown> | undefined;
      const steps = (m && Array.isArray(m.steps) ? m.steps : []) as { op?: string; type?: string; value?: string }[];
      const structValid = !!(m && m.strategy === 'stepChain' && steps.length > 0 &&
              !steps[0].op && steps.every(s => s && ['column', 'number', 'text'].includes(s.type!)) &&
              steps.slice(1).every(s => s.op && ['+', '-', '*', '/', '%'].includes(s.op)));
      const colsExist = structValid && steps
        .filter(s => s.type === 'column' && s.value)
        .every(s => colMap.has(s.value!));
      valid = structValid && colsExist;
    } else if (calc.mode === 'compare') {
      const c = calc.compare as Record<string, unknown> | undefined;
      const conds = (Array.isArray(c?.conditions) ? c.conditions : []) as { col?: string; op?: string }[];
      valid = !!(c && conds.length > 0 && c.trueValue && c.falseValue &&
              conds.every(cond => cond.col && ['=', '!=', '>', '>=', '<', '<='].includes(cond.op!)) &&
              conds.some(cond => colMap.has(cond.col!)) &&
              ['column', 'number', 'text'].includes((c.trueValue as Record<string, unknown>).type as string) &&
              ['column', 'number', 'text'].includes((c.falseValue as Record<string, unknown>).type as string));
    } else if (calc.mode === 'text') {
      const t = calc.text as Record<string, unknown> | undefined;
      if (t && ['combine', 'left', 'right', 'substring'].includes(t.operation as string)) {
        if (t.operation === 'combine') {
          const parts = (Array.isArray(t.parts) ? t.parts : []) as { type?: string; value?: string }[];
          const structValid = parts.length > 0 && parts.every(p => p && ['column', 'number', 'text'].includes(p.type!));
          const colsExist = structValid && parts
            .filter(p => p.type === 'column' && p.value)
            .every(p => colMap.has(p.value!));
          valid = structValid && colsExist;
        } else {
          const src = t.source as Record<string, unknown> | undefined;
          const structValid = !!(src && ['column', 'text'].includes(src.type as string));
          const colExists = structValid && src!.type !== 'column' ? true : colMap.has(src!.value as string);
          valid = structValid && colExists;
        }
      }
    } else if (calc.mode === 'date') {
      const d = calc.date as Record<string, unknown> | undefined;
      if (d && d.operation === 'extract') {
        const src = d.source as Record<string, unknown> | undefined;
        const structValid = !!(src && src.type === 'column');
        const colExists = structValid && colMap.has(src!.value as string);
        valid = structValid && colExists && ['year', 'month', 'day', 'dow', 'week', 'quarter', 'julian'].includes(d.part as string);
      }
    }
    if (!valid) continue;
    if (colMap.has(alias)) continue;
    colMap.set(alias, { kind: 'calc', mode: calc.mode, idx: i, calc: calc });
  }

  return { colMap, lookupBoundaries, reportSpec };
}

function getProjectedColumns(catalog: ColumnCatalog): string[] {
  return [...catalog.colMap.keys()];
}
