/**
 * Layout card — aggregation mode selector, column chips, and aggregation config.
 *
 * Renders radio buttons for aggregation mode (none/group/totals/subtotals),
 * column chips for layout ordering, and mode-specific aggregation sections
 * (group-by aggregates, column totals, subtotal configuration).
 *
 * Ported from pipeline-card.tsx (layout card portion) and output-card.tsx.
 * Uses store.subscribe() for reactive updates instead of imperative re-renders.
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../../core/store';
import { buildReportSpecFromState } from '../../core/state';
import { colLabel, defaultAggAlias } from '../../core/utils';
import { buildColSourceMap, projectedCols } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import {
  AGG_FNS, AGG_LABELS, AGG_NEEDS_COL,
  TOTAL_FNS, TOTAL_LABELS,
  SUBTOTAL_FNS, SUBTOTAL_LABELS,
} from '../../report/aggregation-constants';
import { ColumnChips } from '../sections/column-chips';
import { MergeToggles, setMergeGroupUnderline } from '../sections/merge-toggles';

import { Tip } from '../components/tip';
import {
  setAggMode,
  addAggregate,
  removeAggregate,
  touchAggregate,
  setSubtotalGrandTotal,
  setSubtotalSpacer,
  setSubtotalOnTop,
  setSubtotalStrategy,
} from '../aggregation';
import type { AppState, AggMode, AggregateSpec } from '../../types';
import type { ColMapEntry } from '../../catalog/column-catalog';

// ── Sync display label helper ─────────────────────────────────────────────────
// colDisplayLabel is async in the preact core; this sync version works when
// a pre-built colMap is available.

function _syncColDisplayLabel(alias: string, colMap: Map<string, ColMapEntry>): string {
  const src = colMap.get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') {
    const calc = getStore().getState().calcStages?.[src.idx];
    return (calc?.alias || '').trim() || alias;
  }
  return colLabel(src.tid, src.col);
}

// ── Hint text per mode ────────────────────────────────────────────────────────

function getHint(mode: AggMode, state: AppState): string | null {
  if (mode === 'none') return null;
  if (mode === 'group') {
    return 'ℹ Results show one row per unique group. Columns marked ⚠ need a calculation — click ⚠ to add one, or they will be left out of the report.';
  }
  if (mode === 'totals') {
    return 'ℹ All your rows are shown as-is. A totals row is added at the bottom — choose what each column should calculate (Sum, Count, etc.).';
  }
  if (mode === 'subtotals') {
    const hasGroups = (state.subtotalBy || []).length > 0;
    const strategyName = state.subtotalStrategy === 'nested' ? 'nested' : 'combined';
    return hasGroups
      ? `ℹ All rows shown, grouped by the highlighted columns (${strategyName} grouping). A subtotal row appears after each group.`
      : null;
  }
  return null;
}

// ── Totals Section ────────────────────────────────────────────────────────────

function TotalsSection({ cols }: { cols: string[] }) {
  const [state, setState] = useState<AppState>(getStore().getState());
  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const colMap = buildColSourceMap();
  const selSet = state.selCols;
  const visibleCols = cols.filter(c => !selSet || selSet.has(c));

  const handleTotalChange = useCallback((col: string, val: string) => {
    getStore().update(draft => {
      if (val === 'skip') delete draft.colTotals[col];
      else draft.colTotals[col] = val;
    });
  }, []);

  if (!visibleCols.length) {
    return <span style="font-size:0.76rem;color:var(--muted)">No columns available</span>;
  }

  return (
    <>
      {visibleCols.map(col => {
        const cur = state.colTotals[col] || 'skip';
        const label = _syncColDisplayLabel(col, colMap);
        return (
          <div key={col} class="totals-row">
            <span class="totals-col-name" title={col}>{label}</span>
            <select
              class="totals-fn-sel"
              value={cur}
              onChange={e => handleTotalChange(col, (e.target as HTMLSelectElement).value)}
            >
              {TOTAL_FNS.map(f => (
                <option key={f} value={f}>{TOTAL_LABELS[f]}</option>
              ))}
            </select>
          </div>
        );
      })}
    </>
  );
}

// ── Subtotals Section ─────────────────────────────────────────────────────────

function SubtotalsSection({ cols }: { cols: string[] }) {
  const [state, setState] = useState<AppState>(getStore().getState());
  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const colMap = buildColSourceMap();
  const subtotalBy = state.subtotalBy || [];
  const selSet = state.selCols;

  // Initialize default subtotal fns for calc columns (moved from render phase)
  useEffect(() => {
    const st = getStore().getState();
    const cm = buildColSourceMap();
    const needsInit = cols.filter(col => {
      const src = cm.get(col);
      return src?.kind === 'calc' && !st.subtotalFns[col];
    });
    if (needsInit.length) {
      getStore().update(draft => {
        for (const col of needsInit) {
          if (!draft.subtotalFns[col]) {
            const src = cm.get(col);
            const isAdv = src?.kind === 'calc' && (() => {
              const calcObj = (src as { calc?: Record<string, unknown> })?.calc;
              return calcObj?.mathOp === 'ROLLAVG' || calcObj?.mathOp === 'PCTTOTAL';
            })();
            draft.subtotalFns[col] = isAdv ? 'skip' : 'SUM';
          }
        }
      });
    }
  }, [cols]);

  const handleSubtotalFnChange = useCallback((col: string, val: string) => {
    getStore().update(draft => {
      if (val === 'skip') delete draft.subtotalFns[col];
      else draft.subtotalFns[col] = val;
    });
  }, []);

  if (subtotalBy.length === 0) {
    return <span style="font-size:0.76rem;color:var(--muted)">Click columns above to choose group keys — then configure subtotal rows here.</span>;
  }

  const visibleCols = cols.filter(c => (!selSet || selSet.has(c)) && !subtotalBy.includes(c));

  if (!visibleCols.length) {
    return <span style="font-size:0.76rem;color:var(--muted)">All columns are group keys.</span>;
  }

  return (
    <>
      {visibleCols.map(col => {
        const src = colMap.get(col);
        const isCalc = src?.kind === 'calc';
        const isAdvancedCalc = isCalc && (() => {
          const calcObj = (src as { calc?: Record<string, unknown> })?.calc;
          const op = calcObj?.mathOp;
          return op === 'ROLLAVG' || op === 'PCTTOTAL';
        })();

        const cur = state.subtotalFns[col] || 'skip';
        const label = _syncColDisplayLabel(col, colMap);
        const fnList = isAdvancedCalc ? ['skip' as const] : SUBTOTAL_FNS;

        return (
          <div key={col} class="totals-row">
            <span class="totals-col-name" title={col}>{label}</span>
            <select
              class="totals-fn-sel"
              value={cur}
              onChange={e => handleSubtotalFnChange(col, (e.target as HTMLSelectElement).value)}
            >
              {fnList.map(f => (
                <option key={f} value={f}>{SUBTOTAL_LABELS[f]}</option>
              ))}
            </select>
          </div>
        );
      })}
    </>
  );
}

// ── Aggregate Items Section ───────────────────────────────────────────────────

function AggregateItems({ cols }: { cols: string[] }) {
  const [state, setState] = useState<AppState>(getStore().getState());
  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const colMap = buildColSourceMap();
  const selSet = state.selCols;
  const visibleCols = selSet ? cols.filter(c => selSet.has(c)) : cols;
  const aggregates = state.aggregates;
  const groupBy = state.groupBy;

  if (!aggregates.length) {
    const msg = groupBy.length > 0
      ? 'No calculations — add one below or click ungrouped chips above'
      : 'Click a column above to start grouping';
    return <span style="font-size:0.76rem;color:var(--muted)">{msg}</span>;
  }

  const handleFnChange = useCallback((i: number, val: string) => {
    getStore().update(draft => {
      (draft.aggregates[i] as unknown as Record<string, unknown>).fn = val;
      touchAggregate(i);
    });
  }, []);

  const handleColChange = useCallback((i: number, val: string) => {
    getStore().update(draft => {
      (draft.aggregates[i] as unknown as Record<string, unknown>).col = val;
      touchAggregate(i);
    });
  }, []);

  const handleAliasChange = useCallback((i: number, val: string) => {
    getStore().update(draft => {
      (draft.aggregates[i] as unknown as Record<string, unknown>).alias = val;
      touchAggregate(i);
    });
  }, []);

  return (
    <>
      {aggregates.map((agg, i) => {
        const needsCol = AGG_NEEDS_COL(agg.fn);
        const colLabel = needsCol
          ? (agg.col ? _syncColDisplayLabel(agg.col, colMap) : '')
          : 'all rows';
        const placeholder = defaultAggAlias(agg.fn, colLabel);
        const isAuto = (agg as AggregateSpec & { auto?: boolean }).auto;

        return (
          <div key={i} class={`agg-row${isAuto ? ' agg-row-auto' : ''}`}>
            {isAuto && (
              <span class="agg-auto-badge" title="Auto-added — edit or delete to customize.">auto</span>
            )}
            <input
              type="text"
              class="agg-alias"
              placeholder={placeholder}
              value={agg.alias}
              onInput={e => handleAliasChange(i, (e.target as HTMLInputElement).value)}
            />
            <span class="agg-eq">=</span>
            <select value={agg.fn} onChange={e => handleFnChange(i, (e.target as HTMLSelectElement).value)}>
              {AGG_FNS.map(f => (
                <option key={f} value={f}>{AGG_LABELS[f]}</option>
              ))}
            </select>
            {needsCol && (
              <>
                <span class="agg-eq">of</span>
                <select value={agg.col} onChange={e => handleColChange(i, (e.target as HTMLSelectElement).value)}>
                  {visibleCols.map(c => (
                    <option key={c} value={c}>{_syncColDisplayLabel(c, colMap)}</option>
                  ))}
                </select>
              </>
            )}
            <button class="btn btn-danger" onClick={() => removeAggregate(i)}>{'✕'}</button>
          </div>
        );
      })}
    </>
  );
}

// ── Main Layout Card ──────────────────────────────────────────────────────────

export function LayoutCard() {
  const [state, setState] = useState<AppState>(getStore().getState());

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const base = state.base;
  if (!base) return null;

  const mode: AggMode = state.aggMode || 'none';
  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(state.tables);
  const projected = projectedCols(reportSpec, sourceCatalog);
  const allCols = state.colOrder
    ? state.colOrder.filter(c => projected.includes(c))
    : projected;
  const selSet = state.selCols;
  const cols = selSet ? allCols.filter(c => selSet.has(c)) : allCols;

  const hint = getHint(mode, state);

  const handleModeChange = useCallback((newMode: string) => {
    setAggMode(newMode as AggMode);
  }, []);

  return (
    <div id="layoutCard" class="card">
      {/* Aggregation mode tabs */}
      <div class="card-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-weight:600;font-size:0.82rem">Layout <Tip text="Choose which columns appear in your report and how they are arranged. Drag chips to reorder columns. Double-click a chip to show or hide it." /></span>
        <div class="tab-row">
          <label class="tab-opt">
            <input type="radio" name="aggMode" value="none" checked={mode === 'none'} onChange={() => handleModeChange('none')} />
            <span data-tip="Show every row exactly as it is. Use the chips below to choose which columns appear in your report.">No summary</span>
          </label>
          <label class="tab-opt">
            <input type="radio" name="aggMode" value="group" checked={mode === 'group'} onChange={() => handleModeChange('group')} />
            <span data-tip="Group rows that share the same value, then calculate totals for each group — like a PivotTable. Double-click a chip to make it a group key.">Summarize</span>
          </label>
          <label class="tab-opt">
            <input type="radio" name="aggMode" value="totals" checked={mode === 'totals'} onChange={() => handleModeChange('totals')} />
            <span data-tip="Keep every row as-is, then add one extra row at the bottom with totals (like Sum, Count, Average) for each column.">Keep all rows + totals</span>
          </label>
          <label class="tab-opt">
            <input type="radio" name="aggMode" value="subtotals" checked={mode === 'subtotals'} onChange={() => handleModeChange('subtotals')} />
            <span data-tip="Keep all detail rows, but group them visually. After each group, insert a subtotal row. Optionally add a grand total at the very bottom.">Group rows + subtotals</span>
          </label>
        </div>
        <Tip text={"Choose how your data is summarized:\n\n• No summary — every row stays as-is\n• Summarize — group rows and calculate totals\n• Keep all + totals — show all rows plus a totals row\n• Group + subtotals — group rows with a subtotal after each group"} />
      </div>

      {/* Hint */}
      {hint && (
        <div id="aggHint" style="font-size:0.72rem;color:var(--muted);padding:4px 0">
          {hint}
        </div>
      )}

      {/* Column chips (always visible) */}
      <ColumnChips />

      {/* Group-by aggregates section */}
      {mode === 'group' && (
        <div id="aggSection" style="margin-top:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-size:0.76rem;font-weight:600;color:var(--muted)">Calculations <Tip text={"Choose how non-group columns are summarized.\n\nFor example:\n• Sum adds up all values\n• Average finds the mean\n• Count counts the rows\n\nYou can add multiple calculations."} /></span>
          </div>
          <AggregateItems cols={cols} />
          {(state.groupBy.length > 0) && (
            <div id="aggAddRow" style="margin-top:6px">
              <button class="btn btn-ghost" style="font-size:0.72rem;padding:2px 8px" onClick={addAggregate} title="Add another calculation like Sum, Average, Count, etc.">
                {'＋'} Add calculation
              </button>
            </div>
          )}
        </div>
      )}

      {/* Totals section */}
      {mode === 'totals' && (
        <div id="totalsSection" style="margin-top:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-size:0.76rem;font-weight:600;color:var(--muted)">Totals row <Tip text={"For each column in your report, choose what the totals row at the bottom should display.\n\n• Skip — leaves the cell blank\n• Sum, Average, Count, etc. — calculates that value for the column"} /></span>
          </div>
          <TotalsSection cols={cols} />
        </div>
      )}

      {/* Subtotals section */}
      {mode === 'subtotals' && (
        <div id="subtotalsSection" style="margin-top:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-size:0.76rem;font-weight:600;color:var(--muted)">Subtotal rows <Tip text={"For each non-group column, choose what value appears in the subtotal row after each group.\n\n• Skip — leaves the cell blank\n• Sum, Average, Count, etc. — calculates that value for the group"} /></span>
          </div>
          {/* Subtotal options */}
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:0.76rem;margin-bottom:8px">
            <label style="cursor:pointer;display:flex;align-items:center;gap:3px">
              <input
                type="checkbox"
                checked={state.subtotalGrandTotal !== false}
                onChange={e => setSubtotalGrandTotal((e.target as HTMLInputElement).checked)}
              />
              Grand total <Tip text="Adds one final total row at the very bottom, combining all groups together." />
            </label>
            <label style="cursor:pointer;display:flex;align-items:center;gap:3px">
              <input
                type="checkbox"
                checked={!!state.subtotalSpacer}
                onChange={e => setSubtotalSpacer((e.target as HTMLInputElement).checked)}
              />
              Spacer rows <Tip text="Inserts an empty row after each subtotal block to make the report easier to read." />
            </label>
            <label style="cursor:pointer;display:flex;align-items:center;gap:3px">
              <input
                type="checkbox"
                checked={!!state.subtotalOnTop}
                onChange={e => setSubtotalOnTop((e.target as HTMLInputElement).checked)}
              />
              Headers on top <Tip text="Shows each group's subtotal row before that group's detail rows instead of after." />
            </label>
          </div>
          <div style="margin-bottom:8px">
            <span style="font-size:0.76rem;color:var(--muted);margin-right:8px">Strategy <Tip text={"'Combined' groups all keys at once — like a PivotTable with multiple row fields.\n\n'Nested' produces subtotals at each level — like an outline with sub-groups."} />:</span>
            <div class="tab-row" style="display:inline-flex">
              <label class="tab-opt">
                <input type="radio" name="subtotalStrategy" value="combined" checked={(state.subtotalStrategy || 'combined') === 'combined'} onChange={() => setSubtotalStrategy('combined')} />
                <span>Combined</span>
              </label>
              <label class="tab-opt">
                <input type="radio" name="subtotalStrategy" value="nested" checked={state.subtotalStrategy === 'nested'} onChange={() => setSubtotalStrategy('nested')} />
                <span>Nested</span>
              </label>
            </div>
          </div>
          <SubtotalsSection cols={cols} />
        </div>
      )}

      {/* Merge toggles */}
      <div style="margin-top:12px">
        <div style="font-size:0.76rem;font-weight:600;margin-bottom:4px">Merge display <Tip text={"When enabled for a column, consecutive rows with the same value are visually merged into one tall cell — like Excel's 'Merge cells' feature.\n\nUseful for cleaner-looking grouped data."} /></div>
        <MergeToggles />
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;margin-top:6px">
          <input
            type="checkbox"
            checked={state.mergeGroupUnderline}
            onChange={e => setMergeGroupUnderline((e.target as HTMLInputElement).checked)}
          />
          Underline merged groups <Tip text="Adds a subtle line at the end of each merged block to help visually separate groups." />
        </label>
      </div>
    </div>
  );
}
