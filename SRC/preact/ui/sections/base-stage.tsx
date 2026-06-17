/**
 * Base stage — base table selector for the pipeline.
 *
 * Renders a dropdown to select the base table and shows the base table's
 * columns as toggleable chips with context-menu rename support.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx (BaseStage sub-component).
 */

import { useState, useCallback } from 'react';
import { getStore } from '../../core/store';
import { useStore } from '../useStore';
import {
  colLabel,
  getTableColor,
  chipFgColor,
} from '../../core/utils';
import { buildColSourceMap } from '../../catalog/column-catalog';
import {
  _isSourceVisibleInLayout,
  _sampleTipFor,
  _afterCombineChange,
  _showLayoutAliasesForSource,
  _hideLayoutAliasesForSource,
  _previewOpen,
  _disabledCardCols,
} from '../../query/layout-selection';
import { Chip } from '../components/chip';
import { Tip } from '../components/tip';
import { ContextMenu, type CtxMenuItem } from '../components/context-menu';
import { resolveRenameTarget, RenameModal, type RenameTarget } from '../components/rename-modal';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Button from '@mui/material/Button';

export interface BaseStageProps {
  /** Table IDs sorted by name. */
  sortedIds: string[];
}

export function BaseStage({ sortedIds }: BaseStageProps) {
  const state = useStore(s => s);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  const base = state.base;
  const tables = state.tables;
  const baseTable = base && tables[base] ? tables[base] : null;
  const allCols = baseTable ? baseTable.cols : [];
  const aggMode = state.aggMode || 'none';

  const handleBaseChange = useCallback((val: string) => {
    getStore().update(draft => {
      draft.base = val;
      draft.baseCols = [];
      draft.stacks = [];
      draft.selCols = new Set();
      draft.colOrder = [];
    });
    _previewOpen.clear();
    _disabledCardCols.clear();
    _afterCombineChange();
  }, []);

  return (
    <>
      <div className="pl-stage">
        <div className="pl-stage-label">Start from <Tip text="Pick the main sheet for your report. This is the sheet that all other sheets will be combined with — like the main table in your workbook." /></div>
          <div className="pl-base-row">
            <FormControl size="small">
              <Select
                value={base || ''}
                onChange={e => handleBaseChange(e.target.value as string)}
                sx={{ minWidth: 200 }}
                displayEmpty
              >
                <MenuItem value="">{'—'} select a sheet {'—'}</MenuItem>
                {sortedIds.map(id => (
                  <MenuItem key={id} value={id}>{tables[id].name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
          {baseTable && (
            <div className="pl-lookup-cols" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0, alignSelf: 'center' }}>Columns:</span>
              <Tip text="These are the columns in your main sheet. Click a chip to hide it from the report. Right-click any chip to rename it." />
              {allCols.map(c => {
                const colMap = buildColSourceMap();
                const isLayoutVisible = _isSourceVisibleInLayout(base, c, colMap, aggMode);
                const color = getTableColor(base);
                const chipStyle = `background:${color};border-color:${color};color:${chipFgColor(color)}`;
                return (
                  <Chip
                    key={c}
                    col={c}
                    label={colLabel(base, c)}
                    selected={true}
                    draggable={false}
                    chipClass="pl-col-chip"
                    className={isLayoutVisible ? '' : 'pl-col-chip-layout-hidden'}
                    tooltip={_sampleTipFor(base, c, ['Click to show or hide this column in your report.'])}
                    dataAttrs={{ 'data-bcc': c }}
                    inlineStyle={chipStyle}
                    onClick={() => {
                      const colMap2 = buildColSourceMap();
                      const visible = _isSourceVisibleInLayout(base, c, colMap2, aggMode);
                      if (visible) _hideLayoutAliasesForSource(base, c);
                      else _showLayoutAliasesForSource(base, c);
                      _afterCombineChange();
                    }}
                    onContextMenu={e => {
                      e.preventDefault();
                      const colMap2 = buildColSourceMap();
                      let alias = '';
                      for (const [a, src] of colMap2.entries()) {
                        if (src && src.kind !== 'calc' && src.tid === base && src.col === c) { alias = a; break; }
                      }
                      if (!alias) return;
                      setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(alias)) }],
                      });
                    }}
                  />
                );
              })}
              <Button
                variant="text"
                size="small"
                sx={{ fontSize: '0.68rem', py: 0.25, px: 0.75, minWidth: 'unset', flexShrink: 0 }}
                onClick={() => { _showLayoutAliasesForSource(base); _afterCombineChange(); }}
              >
                All
              </Button>
              <Button
                variant="text"
                size="small"
                sx={{ fontSize: '0.68rem', py: 0.25, px: 0.75, minWidth: 'unset', flexShrink: 0 }}
                onClick={() => { _hideLayoutAliasesForSource(base); _afterCombineChange(); }}
              >
                None
              </Button>
            </div>
          )}
        </div>
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
      {renameTarget && <RenameModal target={renameTarget} onDone={() => _afterCombineChange()} onClose={() => setRenameTarget(null)} />}
      </>
  );
}
