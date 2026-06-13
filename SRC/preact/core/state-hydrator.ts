/**
 * State Hydrator — takes a raw JSON payload and produces a hydrated state
 * object plus broken reference warnings.
 *
 * Ported from `SRC/js/core/state-hydrator.ts`. Key differences:
 * - No global `db` import — receives `loadedTables` as an explicit parameter
 * - Uses `buildSourceCatalog` + `projectedColsUpToLookup` from catalog layer
 * - No `applyState` re-export, no window assignments
 */

import type { DbTable } from '../types';
import type { SourceTableEntry } from '../catalog/source-catalog';
import { buildSourceCatalog } from '../catalog/source-catalog';
import { projectedColsUpToLookup } from '../catalog/column-catalog';

/**
 * Hydrate a raw JSON payload into a validated state object.
 *
 * Takes a parsed .rcjson payload and the currently loaded table definitions,
 * then produces:
 * - `next` — a hydrated state object ready to be applied to the store
 * - `brokenRefs` — human-readable warnings for missing tables/columns/refs
 * - `nextExcludedRows` — excluded row sets keyed by table ID
 *
 * @param payload - Raw JSON payload from a saved .rcjson file
 * @param loadedTables - Currently loaded database tables keyed by table ID
 * @returns `{ next, brokenRefs, nextExcludedRows }`
 */
export function hydrateState(
  payload: Record<string, any>,
  loadedTables: Record<string, DbTable>,
): { next: Record<string, unknown>; brokenRefs: string[]; nextExcludedRows: Record<string, Set<number>> } {
  const next: Record<string, any> = {};
  const brokenRefs: string[] = [];

  const sourceCatalog: Map<string, SourceTableEntry> = buildSourceCatalog(loadedTables);

  const nextAvailableCols = (): Set<string> => {
    const cols   = projectedColsUpToLookup((next.lookups || []).length, next as any, sourceCatalog);
    const colSet = new Set(cols);
    for (const c of (next.calcStages || [])) {
      if (c.alias) colSet.add(c.alias);
    }
    return colSet;
  };

  // ── Base table ────────────────────────────────────────────────────────────────

  const savedBase = payload.base || '';
  next.base = savedBase;
  const baseLoaded = !!(savedBase && loadedTables[savedBase]);
  if (!baseLoaded) {
    brokenRefs.push(`Primary sheet "${savedBase || '(none)'}" is not loaded`);
  }

  if (Array.isArray(payload.baseCols)) {
    const dropped = baseLoaded ? payload.baseCols.filter((c: string) => !loadedTables[savedBase].cols.includes(c)) : [];
    if (dropped.length) brokenRefs.push(`Base columns not available: ${dropped.join(', ')}`);
    next.baseCols = [...payload.baseCols];
  } else {
    next.baseCols = null;
  }

  // ── Stacked tables ────────────────────────────────────────────────────────────

  next.stacks = [];
  for (const id of (payload.stacks || [])) {
    if (!loadedTables[id]) {
      brokenRefs.push(`Stacked sheet "${id}" is not loaded`);
      next.stacks.push(id);
      continue;
    }
    if (!next.stacks.includes(id)) next.stacks.push(id);
  }

  // ── Lookups ───────────────────────────────────────────────────────────────────

  next.lookups = [];
  for (const lk of (payload.lookups || [])) {
    const rt = lk.rightId && loadedTables[lk.rightId];
    if (!lk.rightId || !rt) {
      brokenRefs.push(`Lookup sheet "${lk.rightId || '(none)'}" is not loaded`);
      next.lookups.push({
        rightId:  lk.rightId || '',
        keyPairs: Array.isArray(lk.keyPairs) ? lk.keyPairs.map((p: Record<string, any>) => ({ left: p.left || '', right: p.right || '' })) : [{ left: '', right: '' }],
        cols:     Array.isArray(lk.cols) ? [...lk.cols] : [],
        required: !!lk.required,
        enabled:  lk.enabled !== false,
        duplicatePolicy: lk.duplicatePolicy && lk.duplicatePolicy.mode ? { ...lk.duplicatePolicy } : { mode: 'block' },
      });
      continue;
    }
    const leftAvail = baseLoaded ? projectedColsUpToLookup(next.lookups.length, next as any, sourceCatalog) : [];
    const keyPairs = (Array.isArray(lk.keyPairs) ? lk.keyPairs : []).map((p: Record<string, any>) => {
      const leftOk  = !baseLoaded || leftAvail.includes(p.left);
      const rightOk = rt.cols.includes(p.right);
      if (!leftOk && p.left) brokenRefs.push(`Match column "${p.left}" not found (left side of lookup from "${rt.name}")`);
      if (!rightOk && p.right) brokenRefs.push(`Match column "${p.right}" not found in "${rt.name}"`);
      return { left: p.left || '', right: p.right || '' };
    });
    const cols = Array.isArray(lk.cols) ? lk.cols : [...rt.cols];
    next.lookups.push({ rightId: lk.rightId, keyPairs, cols, required: !!lk.required, enabled: lk.enabled !== false, duplicatePolicy: lk.duplicatePolicy && lk.duplicatePolicy.mode ? { ...lk.duplicatePolicy } : { mode: 'block' } });
  }

  // ── Calculated columns ────────────────────────────────────────────────────────

  const VALID_CALC_MODES = new Set(['math', 'compare', 'text', 'date']);

  function _checkColRef(colName: string | null, baseLoaded: boolean, availNow: Set<string>, alias: string, brokenRefs: string[]): void {
    if (colName && baseLoaded && availNow.size && !availNow.has(colName)) {
      brokenRefs.push(`Calculated column "${alias}" references unavailable column "${colName}"`);
    }
  }

  next.calcStages = [];
  for (const c of (payload.calcStages || [])) {
    const alias = (c.alias || '').trim();
    const enabled = c.enabled !== false;

    if (!c.mode || !VALID_CALC_MODES.has(c.mode)) {
      brokenRefs.push(`Calculated column "${alias}" has an unsupported or missing mode`);
      next.calcStages.push({ ...c, alias, enabled });
      continue;
    }

    if (!alias) {
      brokenRefs.push('Calculated stage has no alias');
      next.calcStages.push({ ...c, alias, enabled });
      continue;
    }
    const availNow = nextAvailableCols();

    if (c.mode === 'math') {
      const math = c.math;
      if (math && Array.isArray(math.steps)) {
        for (const step of math.steps) {
          _checkColRef(step.type === 'column' ? step.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
      }
    }

    if (c.mode === 'compare') {
      const compare = c.compare;
      if (compare && Array.isArray(compare.conditions)) {
        for (const cond of compare.conditions) {
          _checkColRef(cond.col, baseLoaded, availNow, alias, brokenRefs);
        }
      }
      if (compare && compare.trueValue) {
        _checkColRef(compare.trueValue.type === 'column' ? compare.trueValue.value : null, baseLoaded, availNow, alias, brokenRefs);
      }
      if (compare && compare.falseValue) {
        _checkColRef(compare.falseValue.type === 'column' ? compare.falseValue.value : null, baseLoaded, availNow, alias, brokenRefs);
      }
    }

    if (c.mode === 'text') {
      const text = c.text;
      if (text) {
        if (text.operation === 'combine' && Array.isArray(text.parts)) {
          for (const part of text.parts) {
            _checkColRef(part.type === 'column' ? part.value : null, baseLoaded, availNow, alias, brokenRefs);
          }
        }
        if (text.source) {
          _checkColRef(text.source.type === 'column' ? text.source.value : null, baseLoaded, availNow, alias, brokenRefs);
        }
      }
    }

    if (c.mode === 'date') {
      const date = c.date;
      if (date && date.operation === 'extract' && date.source) {
        _checkColRef(date.source.type === 'column' ? date.source.value : null, baseLoaded, availNow, alias, brokenRefs);
      }
    }

    next.calcStages.push({ ...c, alias, enabled });
  }

  // ── Selected columns ──────────────────────────────────────────────────────────

  const available = nextAvailableCols();

  if (payload.selCols === null) {
    next.selCols = null;
  } else if (Array.isArray(payload.selCols)) {
    const dropped = baseLoaded ? payload.selCols.filter((c: string) => !available.has(c)) : [];
    if (dropped.length) brokenRefs.push(`Selected columns not available: ${dropped.join(', ')}`);
    next.selCols = new Set(payload.selCols);
  } else {
    next.selCols = null;
  }
  next.colOrder = Array.isArray(payload.colOrder) ? [...payload.colOrder] : null;

  // ── Filters ───────────────────────────────────────────────────────────────────

  next.filters = [];
  for (const f of (payload.filters || [])) {
    if (f.col && baseLoaded && !available.has(f.col)) {
      brokenRefs.push(`Filter on column "${f.col}" is not available`);
    }
    const vals = Array.isArray(f.vals) ? [...f.vals] : f.vals;
    next.filters.push({ col: f.col || '', op: f.op || 'contains', vals, enabled: f.enabled !== false });
  }

  // ── Group By ──────────────────────────────────────────────────────────────────

  const gbDropped: string[] = baseLoaded ? (payload.groupBy || []).filter((c: string) => !available.has(c)) : [];
  if (gbDropped.length) brokenRefs.push(`Group By columns not available: ${gbDropped.join(', ')}`);
  next.groupBy = [...(payload.groupBy || [])];

  // ── Aggregates ────────────────────────────────────────────────────────────────

  next.aggregates = [];
  for (const a of (payload.aggregates || [])) {
    if (a.col && a.col !== '*' && baseLoaded && !available.has(a.col)) {
      brokenRefs.push(`Aggregate "${a.alias || a.fn}" on column "${a.col}" is not available`);
    }
    next.aggregates.push({ fn: a.fn || 'SUM', col: a.col || '*', alias: a.alias || '' });
  }

  // ── Sorts ─────────────────────────────────────────────────────────────────────

  next.sorts = [];
  for (const s of (payload.sorts || [])) {
    if (s.col && baseLoaded && !available.has(s.col)) {
      brokenRefs.push(`Sort on column "${s.col}" is not available`);
    }
    next.sorts.push({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC', enabled: s.enabled !== false });
  }

  // ── Aggregation mode ──────────────────────────────────────────────────────────

  next.aggMode = typeof payload.aggMode === 'string' ? payload.aggMode : 'none';

  // ── Column totals ─────────────────────────────────────────────────────────────

  next.colTotals = {};
  for (const [col, fn] of Object.entries(payload.colTotals || {})) {
    if (baseLoaded && !available.has(col)) brokenRefs.push(`Totals column "${col}" not available`);
    next.colTotals[col] = fn;
  }

  // ── Subtotals ─────────────────────────────────────────────────────────────────

  const sbDropped: string[] = baseLoaded ? (payload.subtotalBy || []).filter((c: string) => !available.has(c)) : [];
  if (sbDropped.length) brokenRefs.push(`Subtotal By columns not available: ${sbDropped.join(', ')}`);
  next.subtotalBy = [...(payload.subtotalBy || [])];
  next.subtotalFns = {};
  for (const [col, fn] of Object.entries(payload.subtotalFns || {})) {
    if (baseLoaded && !available.has(col)) brokenRefs.push(`Subtotal function column "${col}" not available`);
    next.subtotalFns[col] = fn;
  }
  next.subtotalGrandTotal = payload.subtotalGrandTotal !== false;
  next.subtotalSpacer     = !!payload.subtotalSpacer;
  next.subtotalOnTop      = !!payload.subtotalOnTop;
  next.subtotalStrategy   = payload.subtotalStrategy === 'nested' ? 'nested' : 'combined';

  // ── Aggregation mode state ────────────────────────────────────────────────────

  if (!payload.aggModeState || typeof payload.aggModeState !== 'object') {
    next.aggModeState = null;
  } else {
    const raw = payload.aggModeState;
    const rawNone      = raw.none      && typeof raw.none      === 'object' ? raw.none      : null;
    const rawGroup     = raw.group     && typeof raw.group     === 'object' ? raw.group     : null;
    const rawTotals    = raw.totals    && typeof raw.totals    === 'object' ? raw.totals    : null;
    const rawSubtotals = raw.subtotals && typeof raw.subtotals === 'object' ? raw.subtotals : null;
    next.aggModeState = {
      none: rawNone ? {
        selCols: Array.isArray(rawNone.selCols) ? [...rawNone.selCols] : null,
      } : null,
      group: rawGroup ? {
        groupBy:    Array.isArray(rawGroup.groupBy) ? [...rawGroup.groupBy] : [],
        aggregates: Array.isArray(rawGroup.aggregates)
          ? (rawGroup.aggregates as Record<string, any>[]).map(a => ({ fn: a.fn || 'SUM', col: a.col || '*', alias: a.alias || '', auto: !!a.auto }))
          : [],
      } : null,
      totals: rawTotals ? {
        selCols:   Array.isArray(rawTotals.selCols) ? [...rawTotals.selCols] : null,
        colTotals: rawTotals.colTotals && typeof rawTotals.colTotals === 'object' ? { ...rawTotals.colTotals } : {},
      } : null,
      subtotals: rawSubtotals ? {
        selCols:          Array.isArray(rawSubtotals.selCols) ? [...rawSubtotals.selCols] : null,
        subtotalBy:       Array.isArray(rawSubtotals.subtotalBy) ? [...rawSubtotals.subtotalBy] : [],
        subtotalFns:      rawSubtotals.subtotalFns && typeof rawSubtotals.subtotalFns === 'object' ? { ...rawSubtotals.subtotalFns } : {},
        subtotalGrandTotal: rawSubtotals.subtotalGrandTotal !== false,
        subtotalSpacer:     !!rawSubtotals.subtotalSpacer,
        subtotalOnTop:      !!rawSubtotals.subtotalOnTop,
        subtotalStrategy:   rawSubtotals.subtotalStrategy === 'nested' ? 'nested' : 'combined',
      } : null,
    };
  }

  // ── Merge display ─────────────────────────────────────────────────────────────

  next.mergedCols = (payload.mergedCols || []).filter((c: unknown) => typeof c === 'string');
  next.mergeGroupUnderline = !!payload.mergeGroupUnderline;
  next.colState   = Array.isArray(payload.colState) ? payload.colState : null;

  // ── Excluded rows ─────────────────────────────────────────────────────────────

  const nextExcludedRows: Record<string, Set<number>> = {};
  if (payload.excludedRows && typeof payload.excludedRows === 'object') {
    for (const [tid, arr] of Object.entries(payload.excludedRows)) {
      if (Array.isArray(arr) && arr.length) {
        nextExcludedRows[tid] = new Set(arr);
      }
    }
  }

  // ── Table colors ──────────────────────────────────────────────────────────────

  next.tableColors = {};
  for (const [tid, color] of Object.entries(payload.tableColors || {})) {
    if (typeof color === 'string' && color.startsWith('#')) {
      next.tableColors[tid] = color;
    }
  }

  // ── Column labels ─────────────────────────────────────────────────────────────

  next.columnLabels = {};
  for (const [tid, labels] of Object.entries(payload.columnLabels || {})) {
    if (!labels || typeof labels !== 'object') continue;
    const kept: Record<string, string> = {};
    for (const [col, label] of Object.entries(labels as Record<string, unknown>)) {
      if (label && label !== col) kept[col] = label as string;
    }
    if (Object.keys(kept).length) next.columnLabels[tid] = kept;
  }

  // ── Detail bands ───────────────────────────────────────────────────────────────

  next.detailBands = [];
  if (Array.isArray(payload.detailBands)) {
    for (const band of payload.detailBands) {
      const rt = band.rightId && loadedTables[band.rightId];
      if (!rt) {
        brokenRefs.push(`Related details sheet "${band.rightId || '(none)'}" is not loaded`);
        // Still hydrate the band so the user can see/fix it
        next.detailBands.push({
          id:        band.id || `band_${next.detailBands.length}`,
          rightId:   band.rightId || '',
          keyPairs:  Array.isArray(band.keyPairs) ? band.keyPairs.map((p: Record<string, any>) => ({ left: p.left || '', right: p.right || '' })) : [{ left: '', right: '' }],
          cols:      Array.isArray(band.cols) ? [...band.cols] : [],
          enabled:   band.enabled !== false,
          sorts:     Array.isArray(band.sorts) ? band.sorts.map((s: Record<string, any>) => ({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' as const : 'ASC' as const, enabled: s.enabled !== false })) : [],
          label:     typeof band.label === 'string' ? band.label : '',
        });
        continue;
      }

      // Table is loaded — validate key pairs and columns
      const keyPairs = (Array.isArray(band.keyPairs) ? band.keyPairs : []).map((p: Record<string, any>) => {
        const leftOk  = !baseLoaded || projectedColsUpToLookup((next.lookups || []).length, next as any, sourceCatalog).includes(p.left);
        const rightOk = rt.cols.includes(p.right);
        if (!leftOk && p.left) brokenRefs.push(`Match column "${p.left}" not found (left side of detail band from "${rt.name}")`);
        if (!rightOk && p.right) brokenRefs.push(`Match column "${p.right}" not found in "${rt.name}"`);
        return { left: p.left || '', right: p.right || '' };
      });

      const cols = Array.isArray(band.cols) ? band.cols.filter((c: string) => rt.cols.includes(c)) : [...rt.cols];
      const droppedCols = Array.isArray(band.cols) ? band.cols.filter((c: string) => !rt.cols.includes(c)) : [];
      if (droppedCols.length) brokenRefs.push(`Detail band "${band.label || band.id}" columns not available: ${droppedCols.join(', ')}`);

      const sorts = Array.isArray(band.sorts) ? band.sorts.map((s: Record<string, any>) => {
        const sortColOk = rt.cols.includes(s.col);
        if (!sortColOk && s.col) brokenRefs.push(`Sort column "${s.col}" not found in "${rt.name}"`);
        return { col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' as const : 'ASC' as const, enabled: s.enabled !== false };
      }) : [];

      next.detailBands.push({
        id:        band.id || `band_${next.detailBands.length}`,
        rightId:   band.rightId,
        keyPairs,
        cols,
        enabled:   band.enabled !== false,
        sorts,
        label:     typeof band.label === 'string' ? band.label : '',
      });
    }
  }
  // Backward compatibility: old .rcjson without detailBands loads with empty array
  // (handled by the Array.isArray check above — if payload.detailBands is undefined, the loop is skipped)

  // ── Detail band mode ───────────────────────────────────────────────────────────

  next.detailBandMode = payload.detailBandMode === 'stack' ? 'stack' : 'separate';

  return { next, brokenRefs, nextExcludedRows };
}
