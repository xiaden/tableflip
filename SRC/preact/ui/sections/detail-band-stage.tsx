/**
 * Detail band stage — detail band configuration section.
 *
 * Configures a detail band: child table, key pairs, column selection,
 * enable/disable toggle, remove button. Modeled on LookupStage but
 * produces vertical fan-out (1:N child rows) instead of horizontal
 * column extension.
 *
 * Key differences from LookupStage:
 * - Label: "Related Details from" (not "Look up columns from")
 * - No "If no match" option (parent row always shown)
 * - No "Duplicate keys" option (1:N is expected)
 * - Column chips use band.cols array directly (not layout system)
 * - Table picker excludes already-used band tables
 * - Calls invalidateValidation() after every mutation
 */

import { useState, useEffect, useCallback } from 'react';
import { getStore } from '../../core/store';
import { useStore } from '../useStore';
import { buildReportSpecFromState } from '../../core/state';
import {
  colLabel,
  getTableColorClass,
} from '../../core/utils';
import {
  buildColSourceMap,
  projectedColsUpToLookup,
} from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import { getValidation, invalidateValidation } from '../../report/validation';
import { Chip } from '../components/chip';
import { Tip } from '../components/tip';
import { ContextMenu, type CtxMenuItem } from '../components/context-menu';
import { resolveRenameTarget, RenameModal, type RenameTarget } from '../components/rename-modal';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import type { AppState, DetailBandSpec } from '../../types';

export interface DetailBandStageProps {
  /** Index of this band in the detailBands array. */
  i: number;
  /** All table IDs sorted by name. */
  sortedIds: string[];
  /** Table IDs used as lookup right tables. */
  usedAsLookup: Set<string>;
  /** Table IDs used as stacks. */
  usedAsStack: Set<string>;
  /** Base table ID (excluded from band table picker). */
  usedAsBase: string;
}

export function DetailBandStage({ i, sortedIds, usedAsLookup, usedAsStack, usedAsBase }: DetailBandStageProps) {
  const { detailBands, tables, lookups } = useStore(s => ({ detailBands: s.detailBands, tables: s.tables, lookups: s.lookups }));
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  // Initialize keyPairs if empty (moved from render phase)
  useEffect(() => {
    const band = getStore().getState().detailBands[i];
    if (band && (!Array.isArray(band.keyPairs) || !band.keyPairs.length)) {
      getStore().update(draft => {
        if (draft.detailBands[i] && (!Array.isArray(draft.detailBands[i].keyPairs) || !draft.detailBands[i].keyPairs.length)) {
          draft.detailBands[i].keyPairs = [{ left: '', right: '' }];
        }
      });
      invalidateValidation();
    }
  }, [i]);

  const band = detailBands[i];
  if (!band) return null;

  const rt = band.rightId && tables[band.rightId] ? tables[band.rightId] : null;

  // Build reportSpec for projectedColsUpToLookup — bands use all lookups
  // since bands are always after all lookups in the pipeline.
  const lookupCount = (lookups || []).length;
  const reportSpec = buildReportSpecFromState(getStore().getState());
  const sourceCatalog = buildSourceCatalog(tables);
  const leftCols = projectedColsUpToLookup(lookupCount, reportSpec, sourceCatalog);
  const rightCols = rt ? rt.cols : [];

  const pairs = band.keyPairs || [{ left: '', right: '' }];

  const bandColorCls = band.rightId ? getTableColorClass(band.rightId) : '';
  const lkColMap = buildColSourceMap();

  const bandEnabled = band.enabled !== false;
  const bandV = getValidation().items[`detailband_${i}`];
  const bandVBlocked = bandV && bandV.blocking;
  const bandVUnresolved = bandV && !bandV.resolved;
  const bandVMsg = bandVUnresolved && bandV.issues[0] ? bandV.issues[0].message : null;

  // Compute which tables are already used by other bands
  const usedAsBand = new Set(
    (detailBands || []).map((b, idx) => idx !== i ? b.rightId : '').filter(Boolean),
  );

  const stageClasses = [
    'pl-lookup-stage',
    bandVBlocked ? 'pl-lookup-stage--invalid' : '',
    bandVUnresolved && !bandEnabled ? 'pl-lookup-stage--disabled-issue' : '',
    !bandEnabled ? 'pl-stage-disabled' : '',
  ].filter(Boolean).join(' ');

  /** Helper: update the band in the store and invalidate validation. */
  const updateBand = useCallback((updater: (draft: AppState, bandDraft: DetailBandSpec) => void) => {
    getStore().update(draft => {
      const bandDraft = draft.detailBands[i];
      if (bandDraft) updater(draft, bandDraft);
    });
    invalidateValidation();
  }, [i]);

  const handleRightIdChange = useCallback((val: string) => {
    updateBand((_draft, bandDraft) => {
      bandDraft.rightId = val;
      bandDraft.keyPairs = [{ left: '', right: '' }];
      const rt = val && _draft.tables[val] ? _draft.tables[val] : null;
      bandDraft.cols = rt ? [...rt.cols] : [];
    });
  }, [updateBand]);

  const handleEnabledChange = useCallback((checked: boolean) => {
    updateBand((_d, bandDraft) => {
      bandDraft.enabled = checked;
    });
  }, [updateBand]);

  const handleKpLeftChange = useCallback((pi: number, val: string) => {
    updateBand((_draft, bandDraft) => {
      if (!Array.isArray(bandDraft.keyPairs)) bandDraft.keyPairs = [{ left: '', right: '' }];
      if (!bandDraft.keyPairs[pi]) bandDraft.keyPairs[pi] = { left: '', right: '' };
      bandDraft.keyPairs[pi].left = val;
    });
  }, [updateBand]);

  const handleKpRightChange = useCallback((pi: number, val: string) => {
    updateBand((_draft, bandDraft) => {
      if (!Array.isArray(bandDraft.keyPairs)) bandDraft.keyPairs = [{ left: '', right: '' }];
      if (!bandDraft.keyPairs[pi]) bandDraft.keyPairs[pi] = { left: '', right: '' };
      bandDraft.keyPairs[pi].right = val;
    });
  }, [updateBand]);

  const removeKeyPair = useCallback((pi: number) => {
    updateBand((_draft, bandDraft) => {
      bandDraft.keyPairs.splice(pi, 1);
    });
  }, [updateBand]);

  const addKeyPair = useCallback(() => {
    updateBand((_draft, bandDraft) => {
      if (!Array.isArray(bandDraft.keyPairs)) bandDraft.keyPairs = [];
      bandDraft.keyPairs.push({ left: '', right: '' });
    });
  }, [updateBand]);

  const removeBand = useCallback(() => {
    getStore().update(draft => {
      draft.detailBands.splice(i, 1);
    });
    invalidateValidation();
  }, [i]);

  /** Toggle a column in/out of band.cols. */
  const toggleCol = useCallback((col: string) => {
    updateBand((_draft, bandDraft) => {
      let cols = [...bandDraft.cols];
      const idx = cols.indexOf(col);
      if (idx >= 0) {
        cols = cols.filter(c => c !== col);
      } else {
        cols.push(col);
      }
      bandDraft.cols = cols;
    });
  }, [updateBand]);

  /** Select all columns (set to full child table column list). */
  const selectAllCols = useCallback(() => {
    updateBand((_draft, bandDraft) => {
      const rtCols = bandDraft.rightId && _draft.tables[bandDraft.rightId]
        ? _draft.tables[bandDraft.rightId].cols
        : [];
      bandDraft.cols = [...rtCols];
    });
  }, [updateBand]);

  /** Select no columns. */
  const selectNoneCols = useCallback(() => {
    updateBand((_draft, bandDraft) => {
      bandDraft.cols = [];
    });
  }, [updateBand]);

  const handleLabelChange = useCallback((val: string) => {
    updateBand((_draft, bandDraft) => {
      bandDraft.label = val;
    });
  }, [updateBand]);

  // ── Sort handlers ──────────────────────────────────────────────────────────

  const addSort = useCallback(() => {
    updateBand((_draft, bandDraft) => {
      if (!Array.isArray(bandDraft.sorts)) bandDraft.sorts = [];
      bandDraft.sorts.push({ col: '', dir: 'ASC', enabled: true });
    });
  }, [updateBand]);

  const removeSort = useCallback((si: number) => {
    updateBand((_draft, bandDraft) => {
      if (!Array.isArray(bandDraft.sorts)) return;
      bandDraft.sorts.splice(si, 1);
    });
  }, [updateBand]);

  const handleSortColChange = useCallback((si: number, val: string) => {
    updateBand((_draft, bandDraft) => {
      if (!Array.isArray(bandDraft.sorts) || !bandDraft.sorts[si]) return;
      bandDraft.sorts[si].col = val;
    });
  }, [updateBand]);

  const handleSortDirChange = useCallback((si: number, val: string) => {
    updateBand((_draft, bandDraft) => {
      if (!Array.isArray(bandDraft.sorts) || !bandDraft.sorts[si]) return;
      bandDraft.sorts[si].dir = val as 'ASC' | 'DESC';
    });
  }, [updateBand]);

  const handleSortEnabledChange = useCallback((si: number, checked: boolean) => {
    updateBand((_draft, bandDraft) => {
      if (!Array.isArray(bandDraft.sorts) || !bandDraft.sorts[si]) return;
      bandDraft.sorts[si].enabled = checked;
    });
  }, [updateBand]);

  return (
    <>
      <div className={stageClasses}>
      <div className="pl-stage-label">
          Related Details from <Tip text={"Add related rows from another sheet beneath each parent row — like sub-report details.\n\nFor example: show each Order followed by its Line Items. Use '+ AND' to match on multiple columns at once.\n\nExported spreadsheets cannot be re-sorted after detail bands are inserted — apply all desired sorts in the report's Sorting stage before export."} />
        <FormControlLabel
          className="pl-enable-toggle"
          control={
            <Checkbox
              checked={bandEnabled}
              onChange={e => handleEnabledChange(e.target.checked)}
              size="small"
              sx={{ py: 0, px: 0.5 }}
            />
          }
          label={<span className="pl-enable-label">{bandEnabled ? 'Enabled' : 'Disabled'}</span>}
          title={bandEnabled ? "Disable this detail band (won't block report)" : 'Enable this detail band'}
        />
      </div>
      {bandVMsg && <div className="pl-lookup-error">{bandVBlocked ? '\u26D4' : '\u26A0'} {bandVMsg}</div>}
      <div className="pl-lookup-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <FormControl size="small">
          <Select
            value={band.rightId || ''}
            onChange={e => handleRightIdChange(e.target.value as string)}
            sx={{ minWidth: 180 }}
            displayEmpty
          >
            <MenuItem value="">{'\u2014'} pick a sheet {'\u2014'}</MenuItem>
            {sortedIds
              .filter(id =>
                id !== usedAsBase &&
                !usedAsStack.has(id) &&
                (!usedAsLookup.has(id) || id === band.rightId) &&
                (!usedAsBand.has(id) || id === band.rightId),
              )
              .map(id => <MenuItem key={id} value={id}>{tables[id].name}</MenuItem>)}
          </Select>
        </FormControl>
        <Button variant="contained" color="error" size="small" sx={{ flexShrink: 0, minWidth: 'unset', py: 0.25, px: 1 }} onClick={removeBand}>{'\u2715'}</Button>
      </div>
      {rt && (
        <div className="pl-lookup-keys">
          {pairs.map((pair, pi) => (
            <div key={pi} className="pl-key-pair">
              <span className="pl-key-pair-label">{pi === 0 ? 'Where' : 'AND'}</span>
              <FormControl size="small">
                <Select
                  value={pair.left || ''}
                  onChange={e => handleKpLeftChange(pi, e.target.value as string)}
                  sx={{ minWidth: 140 }}
                  displayEmpty
                >
                  <MenuItem value="">{'\u2014'} column {'\u2014'}</MenuItem>
                  {leftCols.map(c => {
                    const src = lkColMap.get(c);
                    const label = src && src.kind !== 'calc' ? colLabel(src.tid, src.col) : c;
                    return <MenuItem key={c} value={c}>{label}</MenuItem>;
                  })}
                </Select>
              </FormControl>
              <span className="pl-lookup-eq">=</span>
              <FormControl size="small">
                <Select
                  value={pair.right || ''}
                  onChange={e => handleKpRightChange(pi, e.target.value as string)}
                  sx={{ minWidth: 140 }}
                  displayEmpty
                >
                  <MenuItem value="">{'\u2014'} column {'\u2014'}</MenuItem>
                  {rightCols.map(c => <MenuItem key={c} value={c}>{colLabel(band.rightId, c)}</MenuItem>)}
                </Select>
              </FormControl>
              {pairs.length > 1 && (
                <IconButton className="pl-rm-kp" size="small" title="Remove this condition" onClick={() => removeKeyPair(pi)} sx={{ fontSize: '0.75rem' }}>{'\u2715'}</IconButton>
              )}
            </div>
          ))}
          <Button variant="text" size="small" className="pl-add-kp" onClick={addKeyPair} sx={{ fontSize: '0.76rem', textTransform: 'none' }}>{'\uFF0B'} AND {'\u2026'}</Button>
        </div>
      )}
      {rt && (
        <div className="pl-band-cols" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0, alignSelf: 'center' }}>Include:</span>
          <Tip text="These are the columns from the child sheet. Click a chip to include or exclude it from the detail band. Right-click any chip to rename it." />
          {rt.cols.map(c => {
            const isSelected = band.cols.includes(c);
            return (
              <Chip
                key={c}
                col={c}
                label={colLabel(band.rightId, c)}
                selected={isSelected}
                draggable={false}
                chipClass="pl-col-chip"
                colorClass={bandColorCls}
                tooltip={`Click to ${isSelected ? 'exclude' : 'include'} this column from the detail band.`}
                dataAttrs={{ 'data-bi': String(i), 'data-bcc': c }}
                onClick={() => toggleCol(c)}
                onContextMenu={e => {
                  e.preventDefault();
                  if (!band.rightId) return;
                  const bandPrefix = `_${band.id}_`;
                  const alias = bandPrefix + c;
                  setCtxMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(alias)) }],
                  });
                }}
              />
            );
          })}
          <Button variant="text" size="small" sx={{ fontSize: '0.68rem', py: 0.25, px: 0.75, minWidth: 'unset', flexShrink: 0 }} onClick={selectAllCols}>All</Button>
          <Button variant="text" size="small" sx={{ fontSize: '0.68rem', py: 0.25, px: 0.75, minWidth: 'unset', flexShrink: 0 }} onClick={selectNoneCols}>None</Button>
        </div>
      )}
      {rt && (
        <div className="pl-band-label-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>Label:</span>
          <TextField
            className="pl-band-label-input"
            placeholder={tables[band.rightId]?.name || 'Section label'}
            value={band.label || ''}
            onChange={e => handleLabelChange(e.target.value)}
            size="small"
            sx={{ fontSize: '0.72rem', maxWidth: 180, '& input': { py: 0.25, px: 0.75, fontSize: '0.72rem' } }}
          />
          <Tip text="Optional label for this detail section. Defaults to the sheet name if left blank." />
        </div>
      )}
      {rt && (
        <div className="pl-band-sorts" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0, alignSelf: 'center' }}>Sort by:</span>
          <Tip text="Sort the child rows within each band. Add multiple sort levels for tie-breaking." />
          {(band.sorts || []).map((s, si) => {
            const sEnabled = s.enabled !== false;
            return (
              <div key={si} className={`sort-row${sEnabled ? '' : ' pl-stage-disabled'}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="sort-level">{si + 1}.</span>
                <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                  <Select
                    value={s.col}
                    onChange={e => handleSortColChange(si, e.target.value as string)}
                    
                    displayEmpty
                  >
                    <MenuItem value="">{'\u2014'} column {'\u2014'}</MenuItem>
                    {rightCols.map(c => (
                      <MenuItem key={c} value={c}>{colLabel(band.rightId, c)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ width: 95, flexShrink: 0 }}>
                  <Select
                    value={s.dir}
                    onChange={e => handleSortDirChange(si, e.target.value as string)}
                   
                  >
                    <MenuItem value="ASC">{'\u2191'} A {'\u2192'} Z</MenuItem>
                    <MenuItem value="DESC">{'\u2193'} Z {'\u2192'} A</MenuItem>
                  </Select>
                </FormControl>
                <FormControlLabel
                  className="pl-enable-toggle"
                  control={
                    <Checkbox
                      checked={sEnabled}
                      onChange={e => handleSortEnabledChange(si, e.target.checked)}
                      size="small"
                      sx={{ py: 0, px: 0.5 }}
                    />
                  }
                  label={<span className="pl-enable-label">{sEnabled ? '' : 'Off'}</span>}
                  title={sEnabled ? 'Disable sort' : 'Enable sort'}
                />
                <Button variant="contained" color="error" size="small" sx={{ minWidth: 'unset', py: 0.25, px: 0.75 }} onClick={() => removeSort(si)}>{'\u2715'}</Button>
              </div>
            );
          })}
          <Button variant="text" size="small" sx={{ fontSize: '0.68rem', py: 0.25, px: 0.75, flexShrink: 0, textTransform: 'none' }} onClick={addSort}>{'\uFF0B'} sort</Button>
        </div>
      )}
      </div>
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
      {renameTarget && <RenameModal target={renameTarget} onDone={() => invalidateValidation()} onClose={() => setRenameTarget(null)} />}
    </>
  );
}
