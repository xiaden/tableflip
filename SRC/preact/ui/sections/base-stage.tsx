/**
 * Base stage — base table selector for the pipeline.
 *
 * Renders a dropdown to select the base table and shows the base table's
 * columns as toggleable chips with context-menu rename support.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx (BaseStage sub-component).
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../../core/store';
import {
  colUserLabel,
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
import type { AppState } from '../../types';

export interface BaseStageProps {
  /** Table IDs sorted by name. */
  sortedIds: string[];
}

export function BaseStage({ sortedIds }: BaseStageProps) {
  const [state, setState] = useState<AppState>(getStore().getState());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const base = state.base;
  const tables = state.tables;
  const baseTable = base && tables[base] ? tables[base] : null;
  const allCols = baseTable ? baseTable.cols : [];
  const aggMode = state.aggMode || 'none';

  const handleBaseChange = useCallback((val: string) => {
    getStore().update(draft => {
      draft.base = val;
      draft.baseCols = null;
      draft.stacks = [];
      draft.selCols = null;
      draft.colOrder = null;
    });
    _previewOpen.clear();
    _disabledCardCols.clear();
    _afterCombineChange();
  }, []);

  return (
    <>
      <div class="pl-stage">
        <div class="pl-stage-label">Start from <Tip text="Pick the main sheet for your report. This is the sheet that all other sheets will be combined with — like the main table in your workbook." /></div>
          <div class="pl-base-row">
            <select value={base || ''} onChange={e => handleBaseChange((e.target as HTMLSelectElement).value)}>
              <option value="">{'—'} select a sheet {'—'}</option>
              {sortedIds.map(id => (
                <option key={id} value={id}>{tables[id].name}</option>
              ))}
            </select>
          </div>
          {baseTable && (
            <div class="pl-lookup-cols" style="margin-top:6px">
              <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Columns:</span>
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
                    label={colUserLabel(base, c)}
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
                        if (!alias) return;
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
              <button
                class="btn btn-ghost"
                style="font-size:0.68rem;padding:2px 6px;flex-shrink:0"
                onClick={() => { _showLayoutAliasesForSource(base); _afterCombineChange(); }}
              >
                All
              </button>
              <button
                class="btn btn-ghost"
                style="font-size:0.68rem;padding:2px 6px;flex-shrink:0"
                onClick={() => { _hideLayoutAliasesForSource(base); _afterCombineChange(); }}
              >
                None
              </button>
            </div>
          )}
        </div>
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
      {renameTarget && <RenameModal target={renameTarget} onDone={() => _afterCombineChange()} onClose={() => setRenameTarget(null)} />}
      </>
  );
}
