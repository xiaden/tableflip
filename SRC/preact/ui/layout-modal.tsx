/**
 * Layout modal — consolidates grouping, aggregation, and subtotal configuration
 * into a single MUI Dialog.
 *
 * Sections:
 * - Group By: ordered list of group-by columns with reorder, sort direction,
 *   and subtotal-break checkboxes
 * - Grouping Sort: per-level sort direction display for group-by columns
 * - Aggregates: list of aggregate specs with function/column selectors
 * - Toggles: Show Totals, Show Subtotals, Subtotals on Top, Blank Space
 *
 * All mutations go through store.update() / store.set() and call
 * invalidateValidation() afterwards.
 */

import { useCallback, useMemo } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import { getStore } from '../core/store';
import { useStore } from './useStore';
import { invalidateValidation } from '../report/validation';
import { colLabel, defaultAggAlias } from '../core/utils';
import { buildColSourceMap } from '../catalog/column-catalog';
import {
  AGG_FNS, AGG_LABELS, AGG_NEEDS_COL,
} from '../report/aggregation-constants';
import {
  addAggregate,
  removeAggregate,
  setSubtotalGrandTotal,
  setSubtotalSpacer,
  setSubtotalOnTop,
} from './aggregation';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { AggregateSpec } from '../types';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface LayoutModalProps {
  open: boolean;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _syncColDisplayLabel(alias: string, colMap: Map<string, ColMapEntry>): string {
  const src = colMap.get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') {
    const calc = getStore().getState().calcStages?.[src.idx];
    return (calc?.alias || '').trim() || alias;
  }
  return colLabel(src.tid, src.col);
}

/** Mutate store then invalidate validation — common pattern. */
function mutateAndInvalidate(updater: (draft: import('../types').AppState) => void): void {
  getStore().update(updater);
  invalidateValidation();
}

// ── Group By Section ───────────────────────────────────────────────────────────

function GroupBySection({ availableCols }: { availableCols: string[] }) {
  const { groupBy, subtotalBy, sorts, colOrder } = useStore(s => ({
    groupBy: s.groupBy,
    subtotalBy: s.subtotalBy,
    sorts: s.sorts,
    colOrder: s.colOrder,
  }));

  const colMap = buildColSourceMap();

  const handleMoveUp = useCallback((idx: number) => {
    if (idx <= 0) return;
    mutateAndInvalidate(draft => {
      const arr = draft.groupBy;
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    });
  }, []);

  const handleMoveDown = useCallback((idx: number) => {
    mutateAndInvalidate(draft => {
      const arr = draft.groupBy;
      if (idx >= arr.length - 1) return;
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    });
  }, []);

  const handleSortToggle = useCallback((col: string) => {
    mutateAndInvalidate(draft => {
      const sortIdx = draft.sorts.findIndex(s => s.col === col);
      if (sortIdx >= 0) {
        draft.sorts[sortIdx].dir = draft.sorts[sortIdx].dir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        draft.sorts.push({ col, dir: 'DESC', enabled: true });
      }
    });
  }, []);

  const handleSubtotalBreak = useCallback((col: string, checked: boolean) => {
    mutateAndInvalidate(draft => {
      const sb = draft.subtotalBy;
      const idx = sb.indexOf(col);
      if (checked && idx < 0) {
        sb.push(col);
      } else if (!checked && idx >= 0) {
        sb.splice(idx, 1);
      }
    });
  }, []);

  const handleAddGroupLevel = useCallback(() => {
    mutateAndInvalidate(draft => {
      const allCols = draft.colOrder?.length ? draft.colOrder : availableCols;
      const next = allCols.find(c => !draft.groupBy.includes(c));
      if (next) {
        draft.groupBy.push(next);
      }
    });
  }, [availableCols]);

  const handleRemoveGroupLevel = useCallback((idx: number) => {
    mutateAndInvalidate(draft => {
      const col = draft.groupBy[idx];
      draft.groupBy.splice(idx, 1);
      // Also remove from subtotalBy if present
      const sbIdx = draft.subtotalBy.indexOf(col);
      if (sbIdx >= 0) draft.subtotalBy.splice(sbIdx, 1);
    });
  }, []);

  const subtotalBySet = new Set(subtotalBy || []);

  // Get sort direction for a group-by column
  const getSortDir = (col: string): string => {
    const sortEntry = sorts.find(s => s.col === col);
    return sortEntry?.dir || 'ASC';
  };

  if (groupBy.length === 0) {
    return (
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, mb: 0.5 }}>
          Group By
        </Typography>
        <Typography sx={{ fontSize: '0.76rem', color: 'var(--muted)' }}>
          No group levels. Click below to add one.
        </Typography>
        <Button
          size="small"
          variant="text"
          onClick={handleAddGroupLevel}
          disabled={availableCols.length === 0}
          sx={{ fontSize: '0.72rem', mt: 0.5, minWidth: 'unset' }}
        >
          + Add group level
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, mb: 0.5 }}>
        Group By
      </Typography>
      {groupBy.map((col, idx) => {
        const label = _syncColDisplayLabel(col, colMap);
        const dir = getSortDir(col);
        const hasBreak = subtotalBySet.has(col);
        return (
          <Box
            key={col}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              py: 0.5,
              px: 1,
              mb: 0.5,
              border: '1px solid var(--border)',
              borderRadius: 1,
            }}
          >
            <Typography sx={{ fontSize: '0.76rem', flex: 1, minWidth: 0 }}>
              <strong>{idx + 1}.</strong> {label}
            </Typography>
            <IconButton
              size="small"
              onClick={() => handleMoveUp(idx)}
              disabled={idx === 0}
              title="Move up"
              sx={{ p: 0.25 }}
            >
              <span style={{ fontSize: '0.7rem' }}>{'\u25B2'}</span>
            </IconButton>
            <IconButton
              size="small"
              onClick={() => handleMoveDown(idx)}
              disabled={idx === groupBy.length - 1}
              title="Move down"
              sx={{ p: 0.25 }}
            >
              <span style={{ fontSize: '0.7rem' }}>{'\u25BC'}</span>
            </IconButton>
            <Button
              size="small"
              variant={dir === 'ASC' ? 'outlined' : 'contained'}
              onClick={() => handleSortToggle(col)}
              sx={{ minWidth: 'unset', py: 0, px: 0.75, fontSize: '0.68rem' }}
              title={`Sort: ${dir}`}
            >
              {dir === 'ASC' ? 'ASC' : 'DESC'}
            </Button>
            <FormControlLabel
              control={
                <Checkbox
                  checked={hasBreak}
                  onChange={e => handleSubtotalBreak(col, e.target.checked)}
                  size="small"
                  sx={{ py: 0, px: 0.25 }}
                />
              }
              label={<span style={{ fontSize: '0.68rem' }}>break subtotals</span>}
              sx={{ ml: 0.5, '& .MuiFormControlLabel-label': { fontSize: '0.68rem' } }}
            />
            <IconButton
              size="small"
              onClick={() => handleRemoveGroupLevel(idx)}
              title="Remove group level"
              sx={{ p: 0.25 }}
            >
              <span style={{ fontSize: '0.7rem', color: 'var(--error, #d32f2f)' }}>{'\u2715'}</span>
            </IconButton>
          </Box>
        );
      })}
      <Button
        size="small"
        variant="text"
        onClick={handleAddGroupLevel}
        disabled={groupBy.length >= (colOrder?.length || availableCols.length)}
        sx={{ fontSize: '0.72rem', mt: 0.5, minWidth: 'unset' }}
      >
        + Add group level
      </Button>
    </Box>
  );
}

// ── Grouping Sort Section ──────────────────────────────────────────────────────

function GroupingSortSection() {
  const { groupBy, sorts } = useStore(s => ({
    groupBy: s.groupBy,
    sorts: s.sorts,
  }));

  const colMap = buildColSourceMap();

  if (groupBy.length === 0) return null;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, mb: 0.5 }}>
        Grouping Sort
      </Typography>
      {groupBy.map((col, idx) => {
        const label = _syncColDisplayLabel(col, colMap);
        const sortEntry = sorts.find(s => s.col === col);
        const dir = sortEntry?.dir || 'ASC';

        const handleDirChange = (newDir: string) => {
          mutateAndInvalidate(draft => {
            const sIdx = draft.sorts.findIndex(s => s.col === col);
            if (sIdx >= 0) {
              draft.sorts[sIdx].dir = newDir;
            } else {
              draft.sorts.push({ col, dir: newDir, enabled: true });
            }
          });
        };

        return (
          <Box key={col} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.76rem', flex: 1 }}>
              Level {idx + 1}: {label}
            </Typography>
            <FormControl size="small">
              <Select
                value={dir}
                onChange={e => handleDirChange(e.target.value as string)}
                sx={{ minWidth: 80, fontSize: '0.76rem' }}
              >
                <MenuItem value="ASC">Ascending</MenuItem>
                <MenuItem value="DESC">Descending</MenuItem>
              </Select>
            </FormControl>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Aggregates Section ─────────────────────────────────────────────────────────

function AggregatesSection({ visibleCols }: { visibleCols: string[] }) {
  const { aggregates } = useStore(s => ({
    aggregates: s.aggregates,
  }));

  const colMap = buildColSourceMap();

  const handleFnChange = useCallback((i: number, val: string) => {
    getStore().update(draft => {
      (draft.aggregates[i] as unknown as Record<string, unknown>).fn = val;
      (draft.aggregates[i] as AggregateSpec & { auto?: boolean }).auto = false;
    });
    invalidateValidation();
  }, []);

  const handleColChange = useCallback((i: number, val: string) => {
    getStore().update(draft => {
      (draft.aggregates[i] as unknown as Record<string, unknown>).col = val;
      (draft.aggregates[i] as AggregateSpec & { auto?: boolean }).auto = false;
    });
    invalidateValidation();
  }, []);

  const handleAliasChange = useCallback((i: number, val: string) => {
    getStore().update(draft => {
      (draft.aggregates[i] as unknown as Record<string, unknown>).alias = val;
      (draft.aggregates[i] as AggregateSpec & { auto?: boolean }).auto = false;
    });
    invalidateValidation();
  }, []);

  const handleAdd = useCallback(() => {
    addAggregate();
    invalidateValidation();
  }, []);

  const handleRemove = useCallback((i: number) => {
    removeAggregate(i);
    invalidateValidation();
  }, []);

  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, mb: 0.5 }}>
        Aggregates
      </Typography>
      {aggregates.length === 0 && (
        <Typography sx={{ fontSize: '0.76rem', color: 'var(--muted)', mb: 0.5 }}>
          No aggregates configured.
        </Typography>
      )}
      {aggregates.map((agg, i) => {
        const needsCol = AGG_NEEDS_COL(agg.fn);
        const colDispLabel = needsCol
          ? (agg.col ? _syncColDisplayLabel(agg.col, colMap) : '')
          : 'all rows';
        const placeholder = defaultAggAlias(agg.fn, colDispLabel);

        return (
          <Box
            key={i}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              mb: 0.5,
              flexWrap: 'wrap',
            }}
          >
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <Select
                value={agg.fn}
                onChange={e => handleFnChange(i, e.target.value as string)}
                sx={{ fontSize: '0.76rem' }}
              >
                {AGG_FNS.map(f => (
                  <MenuItem key={f} value={f}>{AGG_LABELS[f]}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {needsCol && (
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <Select
                  value={agg.col}
                  onChange={e => handleColChange(i, e.target.value as string)}
                  sx={{ fontSize: '0.76rem' }}
                >
                  {visibleCols.map(c => (
                    <MenuItem key={c} value={c}>{_syncColDisplayLabel(c, colMap)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <Box
              component="input"
              type="text"
              placeholder={placeholder}
              value={agg.alias}
              onChange={e => handleAliasChange(i, (e.target as HTMLInputElement).value)}
              sx={{
                fontSize: '0.76rem',
                border: '1px solid var(--border)',
                borderRadius: 1,
                px: 0.75,
                py: 0.25,
                width: 110,
                minWidth: 0,
              }}
            />
            <Button
              variant="contained"
              color="error"
              size="small"
              sx={{ minWidth: 'unset', py: 0.25, px: 0.75, fontSize: '0.72rem' }}
              onClick={() => handleRemove(i)}
            >
              {'\u2715'}
            </Button>
          </Box>
        );
      })}
      <Button
        size="small"
        variant="text"
        onClick={handleAdd}
        sx={{ fontSize: '0.72rem', mt: 0.5, minWidth: 'unset' }}
      >
        + Add aggregate
      </Button>
    </Box>
  );
}

// ── Toggles Section ────────────────────────────────────────────────────────────

function TogglesSection() {
  const { colTotals, subtotalBy, subtotalOnTop, subtotalSpacer, subtotalGrandTotal } = useStore(s => ({
    colTotals: s.colTotals,
    subtotalBy: s.subtotalBy,
    subtotalOnTop: s.subtotalOnTop,
    subtotalSpacer: s.subtotalSpacer,
    subtotalGrandTotal: s.subtotalGrandTotal,
  }));

  const hasTotals = Object.keys(colTotals).length > 0;
  const hasSubtotals = (subtotalBy || []).length > 0;

  const handleToggleTotals = useCallback((checked: boolean) => {
    mutateAndInvalidate(draft => {
      if (checked) {
        // Set a default total (SUM) for all columns in colOrder
        const cols = draft.colOrder || [];
        for (const col of cols) {
          if (!draft.colTotals[col]) {
            draft.colTotals[col] = 'SUM';
          }
        }
      } else {
        // Clear all colTotals
        for (const key of Object.keys(draft.colTotals)) {
          delete draft.colTotals[key];
        }
      }
    });
  }, []);

  const handleToggleSubtotals = useCallback((checked: boolean) => {
    mutateAndInvalidate(draft => {
      if (checked && draft.subtotalBy.length === 0) {
        // Initialize subtotalBy with current groupBy columns
        draft.subtotalBy = [...draft.groupBy];
      } else if (!checked) {
        draft.subtotalBy = [];
      }
    });
  }, []);

  return (
    <Box sx={{ mb: 1 }}>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, mb: 0.5 }}>
        Toggles
      </Typography>
      <FormControlLabel
        control={
          <Checkbox
            checked={hasTotals}
            onChange={e => handleToggleTotals(e.target.checked)}
            size="small"
            sx={{ py: 0, px: 0.5 }}
          />
        }
        label={<span style={{ fontSize: '0.76rem' }}>Show Totals</span>}
        sx={{ display: 'flex' }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={hasSubtotals}
            onChange={e => handleToggleSubtotals(e.target.checked)}
            size="small"
            sx={{ py: 0, px: 0.5 }}
          />
        }
        label={<span style={{ fontSize: '0.76rem' }}>Show Subtotals</span>}
        sx={{ display: 'flex' }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={!!subtotalOnTop}
            onChange={e => { setSubtotalOnTop(e.target.checked); invalidateValidation(); }}
            size="small"
            sx={{ py: 0, px: 0.5 }}
          />
        }
        label={<span style={{ fontSize: '0.76rem' }}>Show Subtotals on Top</span>}
        sx={{ display: 'flex' }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={!!subtotalSpacer}
            onChange={e => { setSubtotalSpacer(e.target.checked); invalidateValidation(); }}
            size="small"
            sx={{ py: 0, px: 0.5 }}
          />
        }
        label={<span style={{ fontSize: '0.76rem' }}>Blank Space Between Groups</span>}
        sx={{ display: 'flex' }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={!!subtotalGrandTotal}
            onChange={e => { setSubtotalGrandTotal(e.target.checked); invalidateValidation(); }}
            size="small"
            sx={{ py: 0, px: 0.5 }}
          />
        }
        label={<span style={{ fontSize: '0.76rem' }}>Grand Total Row</span>}
        sx={{ display: 'flex' }}
      />
    </Box>
  );
}

// ── Main LayoutModal Component ─────────────────────────────────────────────────

/**
 * Layout modal — MUI Dialog consolidating grouping, aggregation, and subtotal
 * configuration. Reads from and writes to the application store.
 */
export function LayoutModal({ open, onClose }: LayoutModalProps) {
  const { colOrder, selCols, groupBy } = useStore(s => ({
    colOrder: s.colOrder,
    selCols: s.selCols,
    groupBy: s.groupBy,
  }));

  // Compute visible columns for selectors
  const visibleCols = useMemo(() => {
    const allCols = colOrder || [];
    const selSet = selCols;
    return selSet ? allCols.filter(c => selSet.has(c)) : allCols;
  }, [colOrder, selCols]);

  // Columns available for grouping (not already in groupBy)
  const availableGroupCols = useMemo(() => {
    const groupSet = new Set(groupBy);
    return visibleCols.filter(c => !groupSet.has(c));
  }, [visibleCols, groupBy]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-modal="true"
      slotProps={{
        paper: {
          sx: {
            minWidth: 420,
            maxWidth: 560,
            fontSize: '0.85rem',
          },
        },
      }}
    >
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600, pb: 1 }}>
        Layout
      </DialogTitle>
      <DialogContent sx={{ mb: 1 }}>
        <GroupBySection availableCols={availableGroupCols} />
        <Divider sx={{ my: 1 }} />
        <GroupingSortSection />
        <Divider sx={{ my: 1 }} />
        <AggregatesSection visibleCols={visibleCols} />
        <Divider sx={{ my: 1 }} />
        <TogglesSection />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          variant="contained"
          size="small"
          onClick={onClose}
          autoFocus
        >
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
