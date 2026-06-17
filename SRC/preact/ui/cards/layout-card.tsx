/**
 * Layout card — aggregation mode selector, column chips, and aggregation config.
 *
 * Renders toggle buttons for aggregation mode (none/group/totals/subtotals),
 * column chips for layout ordering, and mode-specific aggregation sections
 * (group-by aggregates, column totals, subtotal configuration).
 *
 * Ported from pipeline-card.tsx (layout card portion) and output-card.tsx.
 * Uses useStore() for reactive updates instead of raw store.subscribe().
 */

import { useEffect, useCallback } from 'react';
import Tooltip from '@mui/material/Tooltip';
import { getStore } from '../../core/store';
import { useStore } from '../useStore';
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
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';

// ── Sync display label helper ─────────────────────────────────────────────────
// colDisplayLabel is async in the core layer; this sync version works when
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
  const state = useStore(s => s);

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
    return <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>No columns available</span>;
  }

  return (
    <>
      {visibleCols.map(col => {
        const cur = state.colTotals[col] || 'skip';
        const label = _syncColDisplayLabel(col, colMap);
        return (
          <div key={col} className="totals-row">
            <span className="totals-col-name" title={col}>{label}</span>
            <FormControl size="small">
              <Select
                className="totals-fn-sel"
                value={cur}
                onChange={e => handleTotalChange(col, e.target.value as string)}
                sx={{
                  '& .MuiSelect-select': { py: 0.5, px: 1, fontSize: '0.78rem', minHeight: 'unset' },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
                }}
              >
                {TOTAL_FNS.map(f => (
                  <MenuItem key={f} value={f}>{TOTAL_LABELS[f]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
        );
      })}
    </>
  );
}

// ── Subtotals Section ─────────────────────────────────────────────────────────

function SubtotalsSection({ cols }: { cols: string[] }) {
  const state = useStore(s => s);

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
    return <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>Click columns above to choose group keys — then configure subtotal rows here.</span>;
  }

  const visibleCols = cols.filter(c => (!selSet || selSet.has(c)) && !subtotalBy.includes(c));

  if (!visibleCols.length) {
    return <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>All columns are group keys.</span>;
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
          <div key={col} className="totals-row">
            <span className="totals-col-name" title={col}>{label}</span>
            <FormControl size="small">
              <Select
                className="totals-fn-sel"
                value={cur}
                onChange={e => handleSubtotalFnChange(col, e.target.value as string)}
                sx={{
                  '& .MuiSelect-select': { py: 0.5, px: 1, fontSize: '0.78rem', minHeight: 'unset' },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
                }}
              >
                {fnList.map(f => (
                  <MenuItem key={f} value={f}>{SUBTOTAL_LABELS[f]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
        );
      })}
    </>
  );
}

// ── Aggregate Items Section ───────────────────────────────────────────────────

function AggregateItems({ cols }: { cols: string[] }) {
  const state = useStore(s => s);

  const colMap = buildColSourceMap();
  const selSet = state.selCols;
  const visibleCols = selSet ? cols.filter(c => selSet.has(c)) : cols;
  const aggregates = state.aggregates;
  const groupBy = state.groupBy;

  if (!aggregates.length) {
    const msg = groupBy.length > 0
      ? 'No calculations — add one below or click ungrouped chips above'
      : 'Click a column above to start grouping';
    return <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>{msg}</span>;
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

  const compactSelectSx = {
    '& .MuiSelect-select': { py: 0.5, px: 1, fontSize: '0.78rem', minHeight: 'unset' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
  };

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
          <div key={i} className="agg-row" style={isAuto ? { opacity: 0.82 } : undefined}>
            {isAuto && (
              <span style={{
                fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase' as const,
                letterSpacing: '0.06em', color: 'var(--muted)',
                border: '1px solid var(--border)', borderRadius: '4px',
                padding: '1px 5px', flexShrink: 0, alignSelf: 'center',
              }} title="Auto-added — edit or delete to customize.">auto</span>
            )}
            <TextField
              className="agg-alias"
              placeholder={placeholder}
              value={agg.alias}
              onChange={e => handleAliasChange(i, e.target.value)}
              size="small"
              sx={{
                width: 120,
                '& input': { py: 0.5, px: 1, fontSize: '0.78rem' },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
              }}
            />
            <span className="agg-eq">=</span>
            <FormControl size="small">
              <Select
                value={agg.fn}
                onChange={e => handleFnChange(i, e.target.value as string)}
                sx={compactSelectSx}
              >
                {AGG_FNS.map(f => (
                  <MenuItem key={f} value={f}>{AGG_LABELS[f]}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {needsCol && (
              <>
                <span className="agg-eq">of</span>
                <FormControl size="small">
                  <Select
                    value={agg.col}
                    onChange={e => handleColChange(i, e.target.value as string)}
                    sx={compactSelectSx}
                  >
                    {visibleCols.map(c => (
                      <MenuItem key={c} value={c}>{_syncColDisplayLabel(c, colMap)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            )}
            <Button
              variant="contained"
              color="error"
              size="small"
              sx={{ minWidth: 'unset', py: 0.25, px: 0.75 }}
              onClick={() => removeAggregate(i)}
            >
              {'✕'}
            </Button>
          </div>
        );
      })}
    </>
  );
}

// ── Main Layout Card ──────────────────────────────────────────────────────────

/**
 * Layout card — aggregation mode selector, column chips, and aggregation config.
 *
 * Renders toggle buttons for aggregation mode (none/group/totals/subtotals),
 * column chips for layout ordering, and mode-specific aggregation sections
 * (group-by aggregates, column totals, subtotal configuration). Also renders
 * merge display toggles for visual cell merging.
 *
 * Returns null when no base table is selected. Delegates state mutations to
 * the aggregation module (setAggMode, addAggregate, etc.) which handle
 * validation invalidation.
 */
export function LayoutCard() {
  const state = useStore(s => s);

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

  const handleModeChange = useCallback((_: React.MouseEvent<HTMLElement>, newMode: string | null) => {
    if (newMode) setAggMode(newMode as AggMode);
  }, []);

  return (
    <Card id="layoutCard" className="card" sx={{ background: 'transparent', boxShadow: 'none' }}>
      <CardContent>
        {/* Aggregation mode tabs */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.82rem' }}>
            Layout <Tip text="Choose which columns appear in your report and how they are arranged. Drag chips to reorder columns. Double-click a chip to show or hide it." />
          </Typography>
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={handleModeChange}
            size="small"
            className="tab-row"
          >
            <ToggleButton value="none" sx={{ fontSize: '0.76rem', py: 0.25, px: 1, textTransform: 'none' }}>
              <Tooltip title="Show every row exactly as it is. Use the chips below to choose which columns appear in your report.">
                <span>No summary</span>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="group" sx={{ fontSize: '0.76rem', py: 0.25, px: 1, textTransform: 'none' }}>
              <Tooltip title="Group rows that share the same value, then calculate totals for each group — like a PivotTable. Double-click a chip to make it a group key.">
                <span>Summarize</span>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="totals" sx={{ fontSize: '0.76rem', py: 0.25, px: 1, textTransform: 'none' }}>
              <Tooltip title="Keep every row as-is, then add one extra row at the bottom with totals (like Sum, Count, Average) for each column.">
                <span>Keep all rows + totals</span>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="subtotals" sx={{ fontSize: '0.76rem', py: 0.25, px: 1, textTransform: 'none' }}>
              <Tooltip title="Keep all detail rows, but group them visually. After each group, insert a subtotal row. Optionally add a grand total at the very bottom.">
                <span>Group rows + subtotals</span>
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <Tip text={"Choose how your data is summarized:\n\n• No summary — every row stays as-is\n• Summarize — group rows and calculate totals\n• Keep all + totals — show all rows plus a totals row\n• Group + subtotals — group rows with a subtotal after each group"} />
        </Box>

        {/* Hint */}
        {hint && (
          <Box id="aggHint" sx={{ fontSize: '0.72rem', color: 'var(--muted)', py: 0.5 }}>
            {hint}
          </Box>
        )}

        {/* Column chips (always visible) */}
        <ColumnChips />

        {/* Group-by aggregates section */}
        {mode === 'group' && (
          <Box id="aggSection" sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--muted)' }}>
                Calculations <Tip text={"Choose how non-group columns are summarized.\n\nFor example:\n• Sum adds up all values\n• Average finds the mean\n• Count counts the rows\n\nYou can add multiple calculations."} />
              </Typography>
            </Box>
            <AggregateItems cols={cols} />
            {(state.groupBy.length > 0) && (
              <Box id="aggAddRow" sx={{ mt: 0.75 }}>
                <Button
                  variant="text"
                  size="small"
                  onClick={addAggregate}
                  title="Add another calculation like Sum, Average, Count, etc."
                  sx={{ fontSize: '0.72rem', py: 0.25, px: 1, minWidth: 'unset' }}
                >
                  {'＋'} Add calculation
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* Totals section */}
        {mode === 'totals' && (
          <Box id="totalsSection" sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--muted)' }}>
                Totals row <Tip text={"For each column in your report, choose what the totals row at the bottom should display.\n\n• Skip — leaves the cell blank\n• Sum, Average, Count, etc. — calculates that value for the column"} />
              </Typography>
            </Box>
            <TotalsSection cols={cols} />
          </Box>
        )}

        {/* Subtotals section */}
        {mode === 'subtotals' && (
          <Box id="subtotalsSection" sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--muted)' }}>
                Subtotal rows <Tip text={"For each non-group column, choose what value appears in the subtotal row after each group.\n\n• Skip — leaves the cell blank\n• Sum, Average, Count, etc. — calculates that value for the group"} />
              </Typography>
            </Box>
            {/* Subtotal options */}
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.76rem', mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={state.subtotalGrandTotal !== false}
                    onChange={e => setSubtotalGrandTotal(e.target.checked)}
                    size="small"
                    sx={{ py: 0, px: 0.5 }}
                  />
                }
                label={<span>Grand total <Tip text="Adds one final total row at the very bottom, combining all groups together." /></span>}
                sx={{ cursor: 'pointer', '& .MuiFormControlLabel-label': { fontSize: '0.76rem' } }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!state.subtotalSpacer}
                    onChange={e => setSubtotalSpacer(e.target.checked)}
                    size="small"
                    sx={{ py: 0, px: 0.5 }}
                  />
                }
                label={<span>Spacer rows <Tip text="Inserts an empty row after each subtotal block to make the report easier to read." /></span>}
                sx={{ cursor: 'pointer', '& .MuiFormControlLabel-label': { fontSize: '0.76rem' } }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!state.subtotalOnTop}
                    onChange={e => setSubtotalOnTop(e.target.checked)}
                    size="small"
                    sx={{ py: 0, px: 0.5 }}
                  />
                }
                label={<span>Headers on top <Tip text="Shows each group's subtotal row before that group's detail rows instead of after." /></span>}
                sx={{ cursor: 'pointer', '& .MuiFormControlLabel-label': { fontSize: '0.76rem' } }}
              />
            </Box>
            <Box sx={{ mb: 1 }}>
              <Typography component="span" sx={{ fontSize: '0.76rem', color: 'var(--muted)', mr: 1 }}>
                Strategy <Tip text={"'Combined' groups all keys at once — like a PivotTable with multiple row fields.\n\n'Nested' produces subtotals at each level — like an outline with sub-groups."} />:
              </Typography>
              <ToggleButtonGroup
                value={state.subtotalStrategy || 'combined'}
                exclusive
                onChange={(_: React.MouseEvent<HTMLElement>, val: string | null) => { if (val) setSubtotalStrategy(val); }}
                size="small"
                sx={{ display: 'inline-flex' }}
              >
                <ToggleButton value="combined" sx={{ fontSize: '0.76rem', py: 0.25, px: 1, textTransform: 'none' }}>
                  Combined
                </ToggleButton>
                <ToggleButton value="nested" sx={{ fontSize: '0.76rem', py: 0.25, px: 1, textTransform: 'none' }}>
                  Nested
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <SubtotalsSection cols={cols} />
          </Box>
        )}

        {/* Merge toggles */}
        <Box sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, mb: 0.5 }}>
            Merge display <Tip text={"When enabled for a column, consecutive rows with the same value are visually merged into one tall cell — like Excel's 'Merge cells' feature.\n\nUseful for cleaner-looking grouped data."} />
          </Typography>
          <MergeToggles />
          <FormControlLabel
            control={
              <Checkbox
                checked={state.mergeGroupUnderline}
                onChange={e => setMergeGroupUnderline(e.target.checked)}
                size="small"
                sx={{ py: 0, px: 0.5 }}
              />
            }
            label={<span>Underline merged groups <Tip text="Adds a subtle line at the end of each merged block to help visually separate groups." /></span>}
            sx={{ display: 'flex', cursor: 'pointer', fontSize: '0.76rem', mt: 0.75, '& .MuiFormControlLabel-label': { fontSize: '0.76rem' } }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
