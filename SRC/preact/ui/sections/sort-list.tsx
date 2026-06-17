/**
 * Sort list — sort rows UI.
 *
 * Renders a list of sort conditions with column selector and direction (ASC/DESC).
 * Supports add/remove/enable/disable per sort.
 * Uses store for state access.
 *
 * Ported from SRC/js/ui/views/filter-sort-card.tsx (SortRow + Sorts components).
 */

import { useCallback } from 'react';
import { getStore } from '../../core/store';
import { useStore } from '../useStore';
import { buildReportSpecFromState } from '../../core/state';
import { colLabel } from '../../core/utils';
import { buildColSourceMap, projectedCols } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import { invalidateValidation } from '../../report/validation';
import { _afterCombineChange } from '../../query/layout-selection';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Button from '@mui/material/Button';
import type { SortSpec } from '../../types';

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

  const compactSelectSx = {
    '& .MuiSelect-select': { py: 0.5, px: 1, fontSize: '0.78rem', minHeight: 'unset' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
  };

  return (
    <div className={`sort-row${sEnabled ? '' : ' pl-stage-disabled'}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span className="sort-level">{i + 1}.</span>
      <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
        <Select
          value={s.col}
          onChange={e => handleColChange(e.target.value as string)}
          sx={compactSelectSx}
          displayEmpty
        >
          <MenuItem value="">{'—'} column {'—'}</MenuItem>
          {cols.map(c => {
            const src = colMap.get(c);
            const label = src && src.kind !== 'calc' ? colLabel(src.tid, src.col) : c;
            return <MenuItem key={c} value={c}>{label}</MenuItem>;
          })}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ width: 95, flexShrink: 0 }}>
        <Select
          value={s.dir}
          onChange={e => handleDirChange(e.target.value as string)}
          sx={compactSelectSx}
        >
          <MenuItem value="ASC">{'↑'} A {'→'} Z</MenuItem>
          <MenuItem value="DESC">{'↓'} Z {'→'} A</MenuItem>
        </Select>
      </FormControl>
      <FormControlLabel
        className="pl-enable-toggle"
        control={
          <Checkbox
            checked={sEnabled}
            onChange={e => handleEnabledChange(e.target.checked)}
            size="small"
            sx={{ py: 0, px: 0.5 }}
          />
        }
        label={<span className="pl-enable-label">{sEnabled ? '' : 'Off'}</span>}
        title={sEnabled ? 'Disable sort' : 'Enable sort'}
      />
      <Button variant="contained" color="error" size="small" sx={{ minWidth: 'unset', py: 0.25, px: 0.75 }} onClick={removeSort}>{'✕'}</Button>
    </div>
  );
}

export function SortList() {
  const state = useStore(s => s);

  const selCols = state.selCols;
  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(state.tables);
  const allCols = projectedCols(reportSpec, sourceCatalog);
  const colOrder = state.colOrder || allCols;
  const cols = colOrder.filter(c => !selCols || selCols.has(c));
  const colMap = buildColSourceMap();
  const sorts = state.sorts;

  if (!sorts.length) {
    return <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>No sort — rows returned in natural order</span>;
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
