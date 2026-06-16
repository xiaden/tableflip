/**
 * Sort list — sort rows UI.
 *
 * Renders a list of sort conditions with column selector and direction (ASC/DESC).
 * Supports add/remove/enable/disable per sort.
 * Uses store for state access.
 *
 * Ported from SRC/js/ui/views/filter-sort-card.tsx (SortRow + Sorts components).
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../../core/store';
import { buildReportSpecFromState } from '../../core/state';
import { colLabel } from '../../core/utils';
import { buildColSourceMap, projectedCols } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import { invalidateValidation } from '../../report/validation';
import { _afterCombineChange } from '../../query/layout-selection';
import type { AppState, SortSpec } from '../../types';

interface SortRowProps {
  s: SortSpec;
  i: number;
  cols: string[];
  colMap: Map<string, import('../../catalog/column-catalog.js').ColMapEntry>;
}

function SortRow({ s, i, cols, colMap }: SortRowProps) {
  const sEnabled = s.enabled !== false;

  const updateSort = useCallback((updater: (draft: SortSpec) => void) => {
    getStore().update(draft => {
      const sDraft = draft.sorts[i];
      if (sDraft) updater(sDraft);
    });
    invalidateValidation();
    _afterCombineChange();
  }, [i]);

  const handleColChange = useCallback((val: string) => {
    updateSort(draft => { draft.col = val; });
  }, [updateSort]);

  const handleDirChange = useCallback((val: string) => {
    updateSort(draft => { draft.dir = val; });
  }, [updateSort]);

  const handleEnabledChange = useCallback((checked: boolean) => {
    updateSort(draft => { draft.enabled = checked; });
  }, [updateSort]);

  const removeSort = useCallback(() => {
    getStore().update(draft => { draft.sorts.splice(i, 1); });
    invalidateValidation();
    _afterCombineChange();
  }, [i]);

  const rowClasses = [
    'sort-row',
    sEnabled ? '' : 'pl-stage-disabled',
  ].filter(Boolean).join(' ');

  return (
    <div class={rowClasses}>
      <span class="sort-level">{i + 1}.</span>
      <select value={s.col} style="flex:1;min-width:0" onChange={e => handleColChange((e.target as HTMLSelectElement).value)}>
        <option value="">{'—'} column {'—'}</option>
        {cols.map(c => {
          const src = colMap.get(c);
          const label = src && src.kind !== 'calc' ? colLabel(src.tid, src.col) : c;
          return <option key={c} value={c}>{label}</option>;
        })}
      </select>
      <select value={s.dir} style="width:95px;flex-shrink:0" onChange={e => handleDirChange((e.target as HTMLSelectElement).value)}>
        <option value="ASC">{'↑'} A {'→'} Z</option>
        <option value="DESC">{'↓'} Z {'→'} A</option>
      </select>
      <label class="pl-enable-toggle" title={sEnabled ? 'Disable sort' : 'Enable sort'}>
        <input type="checkbox" checked={sEnabled} onChange={e => handleEnabledChange((e.target as HTMLInputElement).checked)} />
        <span class="pl-enable-label">{sEnabled ? '' : 'Off'}</span>
      </label>
      <button class="btn btn-danger" onClick={removeSort}>{'✕'}</button>
    </div>
  );
}

export function SortList() {
  const [state, setState] = useState<AppState>(getStore().getState());

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const selCols = state.selCols;
  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(state.tables);
  const allCols = projectedCols(reportSpec, sourceCatalog);
  const colOrder = state.colOrder || allCols;
  const cols = colOrder.filter(c => !selCols || selCols.has(c));
  const colMap = buildColSourceMap();
  const sorts = state.sorts;

  if (!sorts.length) {
    return <span style="font-size:0.76rem;color:var(--muted)">No sort — rows returned in natural order</span>;
  }

  return (
    <>
      {sorts.map((s, i) => (
        <SortRow key={i} s={s} i={i} cols={cols} colMap={colMap} />
      ))}
    </>
  );
}

/** Add a new empty sort condition. */
export function addSort(): void {
  getStore().update(draft => {
    draft.sorts.push({ col: '', dir: 'ASC', enabled: true });
  });
  invalidateValidation();
  _afterCombineChange();
}
