/**
 * Filter list — filter rows UI.
 *
 * Renders a list of filter conditions with column selector, operator, value input,
 * and OR-value support. Supports add/remove/enable/disable per filter.
 * Uses store for state access and projectedCols for column options.
 *
 * Ported from SRC/js/ui/views/filter-sort-card.tsx (FilterRow + Filters components).
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../../core/store';
import { buildReportSpecFromState } from '../../core/state';
import { colUserLabel } from '../../core/utils';
import { buildColSourceMap, projectedCols } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import { invalidateValidation } from '../../report/validation';
import { _afterCombineChange } from '../../query/layout-selection';
import type { AppState, FilterSpec } from '../../types';

const FILTER_OPS: string[] = [
  'contains', 'equals', 'not equals',
  '>', '<', '>=', '<=',
  'starts with', 'ends with',
  'is empty', 'not empty',
];
const NO_VAL_OPS: Set<string> = new Set(['is empty', 'not empty']);

interface FilterRowProps {
  f: FilterSpec;
  i: number;
  cols: string[];
  colMap: Map<string, import('../../catalog/column-catalog.js').ColMapEntry>;
}

function FilterRow({ f, i, cols, colMap }: FilterRowProps) {
  const noVal = NO_VAL_OPS.has(f.op);
  const vals = Array.isArray(f.vals) ? f.vals : [''];
  const fEnabled = f.enabled !== false;

  const updateFilter = useCallback((updater: (draft: FilterSpec) => void) => {
    getStore().update(draft => {
      const fDraft = draft.filters[i];
      if (fDraft) updater(fDraft);
    });
    invalidateValidation();
    _afterCombineChange();
  }, [i]);

  const handleColChange = useCallback((val: string) => {
    updateFilter(draft => {
      draft.col = val;
      draft.vals = [''];
    });
  }, [updateFilter]);

  const handleOpChange = useCallback((val: string) => {
    updateFilter(draft => { draft.op = val; });
  }, [updateFilter]);

  const handleEnabledChange = useCallback((checked: boolean) => {
    updateFilter(draft => { draft.enabled = checked; });
  }, [updateFilter]);

  const handleValChange = useCallback((j: number, val: string) => {
    getStore().update(draft => {
      const fDraft = draft.filters[i];
      if (!fDraft) return;
      if (!Array.isArray(fDraft.vals)) fDraft.vals = [''];
      fDraft.vals[j] = val;
    });
  }, [i]);

  const addOrValue = useCallback(() => {
    updateFilter(draft => {
      if (!Array.isArray(draft.vals)) draft.vals = [''];
      draft.vals.push('');
    });
  }, [updateFilter]);

  const removeOrValue = useCallback((j: number) => {
    updateFilter(draft => {
      if (draft.vals && draft.vals.length > 1) {
        draft.vals.splice(j, 1);
      }
    });
  }, [updateFilter]);

  const removeFilter = useCallback(() => {
    getStore().update(draft => { draft.filters.splice(i, 1); });
    invalidateValidation();
    _afterCombineChange();
  }, [i]);

  const datalistId = 'fdl_' + i;

  const rowClasses = [
    'filter-row',
    fEnabled ? '' : 'pl-stage-disabled',
  ].filter(Boolean).join(' ');

  return (
    <div class={rowClasses}>
      <label class="pl-enable-toggle" style="margin-left:auto;order:99" title={fEnabled ? 'Disable filter' : 'Enable filter'}>
        <input type="checkbox" checked={fEnabled} onChange={e => handleEnabledChange((e.target as HTMLInputElement).checked)} />
        <span class="pl-enable-label">{fEnabled ? '' : 'Off'}</span>
      </label>
      <select value={f.col} onChange={e => handleColChange((e.target as HTMLSelectElement).value)}>
        <option value="">Column…</option>
        {cols.map(c => {
          const src = colMap.get(c);
          const label = src && src.kind !== 'calc' ? colUserLabel(src.tid, src.col) : c;
          return <option key={c} value={c}>{label}</option>;
        })}
      </select>
      <select class="fop" value={f.op} onChange={e => handleOpChange((e.target as HTMLSelectElement).value)}>
        {FILTER_OPS.map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <span class="filter-or-wrap" style={{ display: noVal ? 'none' : 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
        {vals.map((v, j) => (
          <span key={j} style="display:contents">
            {j > 0 && <span style="font-size:0.7rem;color:var(--muted);padding:0 1px;flex-shrink:0">OR</span>}
            <input
              type="text"
              list={datalistId}
              placeholder="value"
              value={v}
              style="width:120px"
              onInput={e => handleValChange(j, (e.target as HTMLInputElement).value)}
            />
            {j > 0 && (
              <button
                class="btn btn-danger"
                style="padding:2px 5px;font-size:0.75rem;flex-shrink:0"
                title="Remove this OR value"
                onClick={() => removeOrValue(j)}
              >
                {'✕'}
              </button>
            )}
          </span>
        ))}
        <button
          class="btn btn-ghost"
          style="padding:2px 7px;font-size:0.76rem;flex-shrink:0"
          title="Add OR value"
          onClick={addOrValue}
        >
          {'＋'}
        </button>
      </span>
      <button class="btn btn-danger" onClick={removeFilter}>{'✕'}</button>
    </div>
  );
}

export function FilterList() {
  const [state, setState] = useState<AppState>(getStore().getState());

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(state.tables);
  const cols = projectedCols(reportSpec, sourceCatalog);
  const colMap = buildColSourceMap();
  const filters = state.filters;

  if (!filters.length) {
    return <span style="font-size:0.76rem;color:var(--muted)">No filters — all rows returned</span>;
  }

  return (
    <>
      {filters.map((f, i) => (
        <FilterRow key={i} f={f} i={i} cols={cols} colMap={colMap} />
      ))}
    </>
  );
}

/** Add a new empty filter condition. */
export function addFilter(): void {
  getStore().update(draft => {
    draft.filters.push({ col: '', op: 'contains', val: '', vals: [''], enabled: true });
  });
  invalidateValidation();
  _afterCombineChange();
}
