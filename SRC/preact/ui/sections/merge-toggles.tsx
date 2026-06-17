/**
 * Merge toggles — merge display toggles for columns.
 *
 * Renders checkboxes to toggle merged-cell display for each visible column.
 * Uses store for mergedCols state.
 *
 * Ported from SRC/js/ui/views/output-card.tsx (MergeToggles component).
 */

import { useCallback } from 'react';
import { getStore } from '../../core/store';
import { useStore } from '../useStore';
import { buildReportSpecFromState } from '../../core/state';
import { colLabel } from '../../core/utils';
import { buildColSourceMap, projectedCols } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

export function MergeToggles() {
  const state = useStore(s => s);

  const resultCols = (state.result?.cols as string[]) || null;
  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(state.tables);
  const projected = projectedCols(reportSpec, sourceCatalog);
  const cols = resultCols || projected;

  if (!cols.length) return null;

  const baseDisplayCols = cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id');
  const selCols = state.selCols;
  const visibleDisplayCols = selCols
    ? baseDisplayCols.filter(c => selCols.has(c))
    : baseDisplayCols;
  const colOrder = state.colOrder;
  const orderedFromLayout = colOrder
    ? colOrder.filter(c => visibleDisplayCols.includes(c))
    : [];
  const displayCols = [
    ...orderedFromLayout,
    ...visibleDisplayCols.filter(c => !orderedFromLayout.includes(c)),
  ];

  if (!displayCols.length) {
    return <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>No result columns</span>;
  }

  const mergedCols = state.mergedCols || [];
  const mergedSet = new Set(mergedCols);
  const colMap = buildColSourceMap();

  const toggle = useCallback((c: string, checked: boolean) => {
    getStore().update(draft => {
      if (!draft.mergedCols) draft.mergedCols = [];
      if (checked) {
        if (!draft.mergedCols.includes(c)) draft.mergedCols.push(c);
      } else {
        draft.mergedCols = draft.mergedCols.filter(x => x !== c);
      }
    });
  }, []);

  return (
    <div id="mergeToggles">
      {displayCols.map(c => {
        const src = colMap.get(c);
        const label = src && src.kind !== 'calc' ? colLabel(src.tid, src.col) : c;
        return (
          <FormControlLabel
            key={c}
            control={
              <Checkbox
                checked={mergedSet.has(c)}
                onChange={e => toggle(c, e.target.checked)}
                size="small"
                sx={{ py: 0, px: 0.5 }}
              />
            }
            label={label}
            sx={{ display: 'flex', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 'normal', mt: 0.5, '& .MuiFormControlLabel-label': { fontSize: '0.76rem' } }}
          />
        );
      })}
    </div>
  );
}

/** Toggle merge-group underline styling. */
export function setMergeGroupUnderline(checked: boolean): void {
  getStore().update(draft => { draft.mergeGroupUnderline = !!checked; });
}
