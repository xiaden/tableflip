/**
 * Filter list — filter rows UI.
 *
 * Renders a list of filter conditions with column selector, operator, value input,
 * and OR-value support. Supports add/remove/enable/disable per filter.
 * Uses store for state access and projectedCols for column options.
 *
 * Ported from SRC/js/ui/views/filter-sort-card.tsx (FilterRow + Filters components).
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
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import type { FilterSpec } from '../../types';

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

  const compactSelectSx = {
    '& .MuiSelect-select': { py: 0.5, px: 1, fontSize: '0.78rem', minHeight: 'unset' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
  };

  return (
    <div className={`filter-row${fEnabled ? '' : ' pl-stage-disabled'}`} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <FormControlLabel
        control={
          <Checkbox
            checked={fEnabled}
            onChange={e => handleEnabledChange(e.target.checked)}
            size="small"
            sx={{ py: 0, px: 0.5 }}
          />
        }
        label={<span className="pl-enable-label">{fEnabled ? '' : 'Off'}</span>}
        title={fEnabled ? 'Disable filter' : 'Enable filter'}
        sx={{ ml: 'auto', order: 99 }}
      />
      <FormControl size="small">
        <Select
          value={f.col}
          onChange={e => handleColChange(e.target.value as string)}
          sx={{ minWidth: 140, ...compactSelectSx }}
          displayEmpty
        >
          <MenuItem value="">Column{'…'}</MenuItem>
          {cols.map(c => {
            const src = colMap.get(c);
            const label = src && src.kind !== 'calc' ? colLabel(src.tid, src.col) : c;
            return <MenuItem key={c} value={c}>{label}</MenuItem>;
          })}
        </Select>
      </FormControl>
      <FormControl size="small">
        <Select
          className="fop"
          value={f.op}
          onChange={e => handleOpChange(e.target.value as string)}
          sx={{ minWidth: 120, ...compactSelectSx }}
        >
          {FILTER_OPS.map(op => <MenuItem key={op} value={op}>{op}</MenuItem>)}
        </Select>
      </FormControl>
      <span className="filter-or-wrap" style={{ display: noVal ? 'none' : 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {vals.map((v, j) => (
          <span key={j} style={{ display: 'contents' }}>
            {j > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--muted)', padding: '0 1px', flexShrink: 0 }}>OR</span>}
            <TextField
              slotProps={{ htmlInput: { list: datalistId } }}
              placeholder="value"
              value={v}
              onChange={e => handleValChange(j, e.target.value)}
              size="small"
              sx={{ width: 120, '& input': { py: 0.5, px: 1, fontSize: '0.78rem' } }}
            />
            {j > 0 && (
              <Button
                variant="contained"
                color="error"
                size="small"
                title="Remove this OR value"
                onClick={() => removeOrValue(j)}
                sx={{ py: 0, px: 0.75, fontSize: '0.75rem', minWidth: 'unset', flexShrink: 0 }}
              >
                {'✕'}
              </Button>
            )}
          </span>
        ))}
        <Button
          variant="text"
          size="small"
          title="Add OR value"
          onClick={addOrValue}
          sx={{ py: 0, px: 0.75, fontSize: '0.76rem', minWidth: 'unset', flexShrink: 0 }}
        >
          {'＋'}
        </Button>
      </span>
      <Button variant="contained" color="error" size="small" sx={{ minWidth: 'unset', py: 0.25, px: 0.75 }} onClick={removeFilter}>{'✕'}</Button>
    </div>
  );
}

export function FilterList() {
  const state = useStore(s => s);

  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(state.tables);
  const cols = projectedCols(reportSpec, sourceCatalog);
  const colMap = buildColSourceMap();
  const filters = state.filters;

  if (!filters.length) {
    return <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>No filters — all rows returned</span>;
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
