/**
 * Preview builder — generates inline preview data for pipeline stage arrows.
 *
 * Pure function module: takes a stage key ("base", "lk0", "calc1", "band0")
 * and the full AppState, returns structured PreviewResult data suitable for
 * rendering as a JSX <table> in PipelineArrow.
 *
 * All SQL generation is synchronous. SQL execution delegates to
 * {@link runPreviewQuery} in engine.ts, keeping all database access
 * routed through the engine module.
 *
 * Errors are caught and returned as structured data — no uncaught
 * exceptions during render.
 */

import type { AppState, ReportSpec } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import { tablePrefix } from '../catalog/column-catalog';
import { buildQueryPlan } from '../query/query-plan';
import { quoteId } from '../core/sqldb';
import { runPreviewQuery } from './engine';

// ── Types ───────────────────────────────────────────────────────────────────

/** Structured preview result — either data or an error message. */
export interface PreviewResult {
  /** Column headers (display labels). */
  headers: string[];
  /** Row data — each row is a record of column alias → value. */
  rows: Record<string, unknown>[];
  /** Error message if preview generation failed. Null on success. */
  error: string | null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a preview for a pipeline stage.
 *
 * Pure function — no global state dependency. Takes the stage key
 * and full AppState, returns structured preview data.
 *
 * @param key   - Arrow ID: "base", "lkN", "calcN", or "bandN"
 * @param state - Current AppState (tables, base, lookups, calcStages, etc.)
 * @returns PreviewResult with headers, rows, and optional error
 */
export function buildPreview(key: string, state: AppState): PreviewResult {
  try {
    if (key === 'base') {
      return buildBasePreview(state);
    }

    const lkMatch = key.match(/^lk(\d+)$/);
    if (lkMatch) {
      return buildStagePreview(+lkMatch[1], 'lk', state);
    }

    const calcMatch = key.match(/^calc(\d+)$/);
    if (calcMatch) {
      return buildStagePreview(+calcMatch[1], 'calc', state);
    }

    const bandMatch = key.match(/^band(\d+)$/);
    if (bandMatch) {
      return buildBandPreview(+bandMatch[1], state);
    }

    return { headers: [], rows: [], error: 'Unknown stage' };
  } catch (ex) {
    return { headers: [], rows: [], error: (ex as Error).message };
  }
}

// ── Pure Helpers ────────────────────────────────────────────────────────────

/**
 * Pure variant of colUserLabel — takes state instead of reading global store.
 */
function colUserLabelForState(tid: string, physCol: string, state: AppState): string {
  return state.columnLabels?.[tid]?.[physCol] ?? physCol;
}

/**
 * Pure variant of buildColSourceMap — takes state instead of reading global store.
 *
 * Duplicated from catalog/column-catalog.ts:buildColSourceMap() with the
 * `getStore().getState()` call replaced by the `state` parameter. Used only
 * for resolving column aliases to display labels in preview headers.
 */
function buildColSourceMapForState(state: AppState): Map<string, ColMapEntry> {
  const map = new Map<string, ColMapEntry>();

  const base = state.base;
  if (!base || !state.tables[base]) return map;

  const lookups = state.lookups || [];
  const calcStages = state.calcStages || [];

  state.tables[base].cols.forEach(c => map.set(c, { tid: base, col: c }));

  for (const lk of lookups) {
    if (lk.enabled === false) continue;
    if (!lk.rightId || !state.tables[lk.rightId]) continue;
    const pairs = Array.isArray(lk.keyPairs) ? lk.keyPairs.filter(p => p.left && p.right) : [];
    if (!pairs.length) continue;
    const rt = state.tables[lk.rightId];
    const prefix = tablePrefix(rt.name);
    rt.cols.forEach(c => {
      const alias = map.has(c) ? prefix + c : c;
      if (!map.has(alias)) map.set(alias, { tid: lk.rightId, col: c });
    });
  }

  for (let i = 0; i < calcStages.length; i++) {
    const calc = calcStages[i];
    if (calc?.enabled === false) continue;
    const alias = (calc?.alias || '').trim();
    if (!alias) continue;
    if (!calc.mode || !['math', 'compare', 'text', 'date'].includes(calc.mode as string)) continue;

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
        valid = colExists && ['year', 'month', 'day', 'dow', 'week', 'quarter', 'julian'].includes(d.part as string);
      }
    }
    if (!valid) continue;
    if (map.has(alias)) continue;
    map.set(alias, { kind: 'calc', mode: calc.mode as string, idx: i, calc: calc });
  }

  return map;
}

/**
 * Build display labels for a list of column aliases.
 *
 * Resolves each alias through the colMap: physical columns use their
 * user-defined label (or physical name), calculated columns use their
 * alias directly.
 */
function buildHeaders(cols: string[], state: AppState): string[] {
  const colMap = buildColSourceMapForState(state);
  return cols.map(alias => {
    const src = colMap.get(alias);
    if (!src) return alias;
    if (src.kind === 'calc') return alias;
    if (src.kind === 'band') return alias;
    return colUserLabelForState(src.tid, src.col, state);
  });
}

// ── Base Preview ────────────────────────────────────────────────────────────

/**
 * Build a base preview: UNION ALL across base + stacked tables.
 *
 * Builds a manual UNION ALL query that selects matching columns from each
 * table, padding missing columns with NULL. Mirrors the old JS implementation
 * from commit 46d15d7.
 */
function buildBasePreview(state: AppState): PreviewResult {
  const base = state.base;
  if (!base || !state.tables[base]) {
    return { headers: [], rows: [], error: 'No base table selected' };
  }

  const baseTable = state.tables[base];
  const baseCols = state.selCols instanceof Set && state.selCols.size > 0
    ? baseTable.cols.filter(c => state.selCols.has(c))
    : baseTable.cols;
  if (!baseCols.length) {
    return { headers: [], rows: [], error: 'Base table has no columns' };
  }

  // Collect table IDs: base + stacks (filters out non-existent stack tables)
  const stackIds = (state.stacks || []).filter(id => state.tables[id]);
  const tableIds = [base, ...stackIds];

  // Build SELECT for each table: base column if it exists, else NULL
  const selects = tableIds.map(tid => {
    const table = state.tables[tid];
    const proj = baseCols.map(c =>
      table.cols.includes(c) ? quoteId(c) : 'NULL',
    );
    return `SELECT ${proj.join(', ')} FROM ${quoteId(tid)}`;
  });

  const sql = selects.join(' UNION ALL ') + ' LIMIT 5';
  const rows = runPreviewQuery(sql);

  // Headers use user-defined labels for base columns
  const headers = baseCols.map(c => colUserLabelForState(base, c, state));

  return { headers, rows, error: null };
}

// ── Lookup / Calc Stage Preview ─────────────────────────────────────────────

/**
 * Build a complete ReportSpec for preview SQL generation.
 *
 * Produces a full ReportSpec with all required fields populated.
 * Pipeline fields (lookups, calcs) are sliced according to options.
 * Preview-specific defaults: no filters, no sorts, aggMode 'none',
 * outputColumns null (project all), bands excluded.
 *
 * Filters disabled lookups BEFORE slicing — disabled stages do not
 * contribute JOINs or count toward the slice limit. This matches
 * buildQueryPlan's own filtering at query-plan.ts:174.
 */
function buildPreviewReportSpec(
  state: AppState,
  options: { lookupsUpTo: number; calcsUpTo: number },
): ReportSpec {
  const enabledLookups = (state.lookups || []).filter(lk => lk.enabled !== false);

  const slicedLookups = options.lookupsUpTo < 0
    ? []
    : enabledLookups.slice(0, options.lookupsUpTo + 1);

  const slicedCalcs = options.calcsUpTo < 0
    ? []
    : (state.calcStages || []).slice(0, options.calcsUpTo + 1);

  return {
    id: null,
    name: 'preview',
    enabled: true,
    pipeline: {
      base: state.base,
      baseCols: state.baseCols,
      stacks: state.stacks || [],
      lookups: slicedLookups,
      calculatedColumns: slicedCalcs,
      detailBands: [],
    },
    outputColumns: state.selCols instanceof Set
      ? (state.colOrder || []).filter(c => state.selCols.has(c))
      : (state.colOrder || []),
    filters: [],
    sorts: [],
    aggregation: {
      mode: 'none',
      groupBy: [],
      aggregates: [],
      colTotals: {},
      subtotalBy: [],
      subtotalFns: {},
      subtotalGrandTotal: false,
      subtotalSpacer: false,
      subtotalOnTop: false,
      subtotalStrategy: 'combined',
    },
    mergeDisplay: { mergedCols: [], mergeGroupUnderline: false },
    outputDefinition: null,
    publish: { enabled: false, tableName: '' },
  };
}

/**
 * Build a lookup or calculated column stage preview.
 *
 * Constructs a full ReportSpec with the appropriate pipeline depth,
 * runs it through buildQueryPlan, strips any trailing ORDER BY,
 * appends LIMIT 5, executes, and returns structured result.
 */
function buildStagePreview(
  depth: number,
  kind: 'lk' | 'calc',
  state: AppState,
): PreviewResult {
  const base = state.base;
  if (!base || !state.tables[base]) {
    return { headers: [], rows: [], error: 'No base table selected' };
  }

  const options = kind === 'lk'
    ? { lookupsUpTo: depth, calcsUpTo: -1 }
    : { lookupsUpTo: Infinity, calcsUpTo: depth };

  const reportSpec = buildPreviewReportSpec(state, options);

  const plan = buildQueryPlan(reportSpec, state.tables);

  // Strip trailing ORDER BY as safety measure (spec has sorts:[] so none
  // should be generated, but future changes might introduce implicit sorts).
  const sql = plan.sql.replace(/\s*ORDER\s+BY\s+[^;]+$/i, '') + ' LIMIT 5';

  const rows = runPreviewQuery(sql, plan.params);

  // Use plan.cols for column ordering; resolve display labels
  const headers = buildHeaders(plan.cols, state);

  return { headers, rows, error: null };
}

// ── Band Preview ────────────────────────────────────────────────────────────

/**
 * Build a detail band preview: raw child table SELECT * LIMIT 5.
 *
 * Band preview is intentionally simple — without parent row context,
 * a meaningful joined preview is impossible. The raw child table gives
 * the user a sense of what data the band will pull from.
 */
function buildBandPreview(bandIdx: number, state: AppState): PreviewResult {
  const bands = state.detailBands || [];
  if (bandIdx < 0 || bandIdx >= bands.length) {
    return { headers: [], rows: [], error: 'Band not found' };
  }

  const band = bands[bandIdx];
  if (!band.rightId || !state.tables[band.rightId]) {
    return { headers: [], rows: [], error: 'Band table not found' };
  }

  const table = state.tables[band.rightId];
  const sql = `SELECT * FROM ${quoteId(band.rightId)} LIMIT 5`;
  const rows = runPreviewQuery(sql);

  // Headers use user-defined labels for child table columns
  const headers = table.cols.map(c => colUserLabelForState(band.rightId, c, state));

  return { headers, rows, error: null };
}
