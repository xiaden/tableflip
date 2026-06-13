/**
 * Lookup stage — lookup (join) configuration section.
 *
 * Configures a lookup join: right table, key pairs, column selection,
 * required/optional, duplicate policy. Uses store for state access.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx (LookupStage sub-component).
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../../core/store';
import { buildReportSpecFromState } from '../../core/state';
import {
  colUserLabel,
  getTableColorClass,
} from '../../core/utils';
import {
  buildColSourceMap,
  projectedColsUpToLookup,
} from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import {
  _isSourceVisibleInLayout,
  _sampleTipFor,
  _afterCombineChange,
  _hideLookupLayoutAliasesSafely,
  _showLayoutAliasesForSource,
  _disabledCardCols,
} from '../../query/layout-selection';
import { getValidation } from '../../report/validation';
import { Chip } from '../components/chip';
import { Tip } from '../components/tip';
import { ContextMenu, type CtxMenuItem } from '../components/context-menu';
import { resolveRenameTarget, RenameModal, type RenameTarget } from '../components/rename-modal';
import type { AppState, LookupSpec } from '../../types';

export interface LookupStageProps {
  /** Index of this lookup in the lookups array. */
  i: number;
  /** All table IDs sorted by name. */
  sortedIds: string[];
  /** Table IDs used as lookup right tables. */
  usedAsLookup: Set<string>;
  /** Table IDs used as stacks. */
  usedAsStack: Set<string>;
}

export function LookupStage({ i, sortedIds, usedAsLookup, usedAsStack }: LookupStageProps) {
  const [state, setState] = useState<AppState>(getStore().getState());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  // Initialize keyPairs if empty (moved from render phase)
  useEffect(() => {
    const lk = getStore().getState().lookups[i];
    if (lk && (!Array.isArray(lk.keyPairs) || !lk.keyPairs.length)) {
      getStore().update(draft => {
        if (draft.lookups[i] && (!Array.isArray(draft.lookups[i].keyPairs) || !draft.lookups[i].keyPairs.length)) {
          draft.lookups[i].keyPairs = [{ left: '', right: '' }];
        }
      });
    }
  }, [i]);

  const lk = state.lookups[i];
  if (!lk) return null;

  const tables = state.tables;
  const base = state.base;
  const aggMode = state.aggMode || 'none';
  const rt = lk.rightId && tables[lk.rightId] ? tables[lk.rightId] : null;
  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(tables);
  const leftCols = projectedColsUpToLookup(i, reportSpec, sourceCatalog);
  const rightCols = rt ? rt.cols : [];

  const pairs = lk.keyPairs || [{ left: '', right: '' }];

  const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : '';
  const lkColMap = buildColSourceMap();

  const lkEnabled = lk.enabled !== false;
  const lkV = getValidation().items[`lookup_${i}`];
  const lkVBlocked = lkV && lkV.blocking;
  const lkVUnresolved = lkV && !lkV.resolved;
  const lkVMsg = lkVUnresolved && lkV.issues[0] ? lkV.issues[0].message : null;

  const stageClasses = [
    'pl-lookup-stage',
    lkVBlocked ? 'pl-lookup-stage--invalid' : '',
    lkVUnresolved && !lkEnabled ? 'pl-lookup-stage--disabled-issue' : '',
    !lkEnabled ? 'pl-stage-disabled' : '',
  ].filter(Boolean).join(' ');

  const updateLookup = useCallback((updater: (draft: AppState, lk: LookupSpec) => void) => {
    getStore().update(draft => {
      const lkDraft = draft.lookups[i];
      if (lkDraft) updater(draft, lkDraft);
    });
    _afterCombineChange();
  }, [i]);

  const handleRightIdChange = useCallback((val: string) => {
    const prevRightId = lk.rightId;
    updateLookup((draft, lkDraft) => {
      lkDraft.rightId = val;
      lkDraft.keyPairs = [{ left: '', right: '' }];
      const rt2 = val && draft.tables[val];
      lkDraft.cols = rt2 ? [...rt2.cols] : [];
    });
    if (prevRightId && prevRightId !== val) _hideLookupLayoutAliasesSafely(prevRightId, null, i);
    if (val) _showLayoutAliasesForSource(val);
  }, [i, lk.rightId, updateLookup]);

  const handleEnabledChange = useCallback((checked: boolean) => {
    const wasEnabled = lk.enabled !== false;
    updateLookup((draft, lkDraft) => {
      lkDraft.enabled = checked;
      if (wasEnabled && !checked) {
        const rt2 = lkDraft.rightId && draft.tables[lkDraft.rightId];
        if (rt2 && draft.selCols instanceof Set) {
          const colMap = buildColSourceMap();
          const savedAliases = new Set<string>();
          for (const col of rt2.cols) {
            if (_isSourceVisibleInLayout(lkDraft.rightId, col, colMap, draft.aggMode || 'none')) {
              for (const [alias, src] of colMap.entries()) {
                if (src && src.kind !== 'calc' && src.tid === lkDraft.rightId && src.col === col) {
                  savedAliases.add(alias);
                }
              }
            }
          }
          (lkDraft as Record<string, unknown>)._prevSelState = savedAliases;
          for (const alias of savedAliases) _disabledCardCols.add(alias);
        }
      } else if (!wasEnabled && checked) {
        const saved = (lkDraft as Record<string, unknown>)._prevSelState as Set<string> | undefined;
        if (saved && draft.selCols instanceof Set) {
          for (const alias of saved) {
            (draft.selCols as Set<string>).add(alias);
            _disabledCardCols.delete(alias);
          }
        }
        delete (lkDraft as Record<string, unknown>)._prevSelState;
      }
    });
  }, [i, lk.enabled, updateLookup]);

  const handleRequiredChange = useCallback((val: string) => {
    updateLookup((_draft, lkDraft) => { lkDraft.required = val === '1'; });
  }, [updateLookup]);

  const handleDupModeChange = useCallback((val: string) => {
    updateLookup((_draft, lkDraft) => {
      if (!lkDraft.duplicatePolicy) lkDraft.duplicatePolicy = { mode: 'block' };
      lkDraft.duplicatePolicy.mode = val;
    });
  }, [updateLookup]);

  const handleKpLeftChange = useCallback((pi: number, val: string) => {
    updateLookup((_draft, lkDraft) => {
      if (!Array.isArray(lkDraft.keyPairs)) lkDraft.keyPairs = [{ left: '', right: '' }];
      if (!lkDraft.keyPairs[pi]) lkDraft.keyPairs[pi] = { left: '', right: '' };
      lkDraft.keyPairs[pi].left = val;
    });
  }, [updateLookup]);

  const handleKpRightChange = useCallback((pi: number, val: string) => {
    updateLookup((_draft, lkDraft) => {
      if (!Array.isArray(lkDraft.keyPairs)) lkDraft.keyPairs = [{ left: '', right: '' }];
      if (!lkDraft.keyPairs[pi]) lkDraft.keyPairs[pi] = { left: '', right: '' };
      lkDraft.keyPairs[pi].right = val;
    });
  }, [updateLookup]);

  const removeKeyPair = useCallback((pi: number) => {
    updateLookup((_draft, lkDraft) => {
      lkDraft.keyPairs.splice(pi, 1);
    });
  }, [updateLookup]);

  const addKeyPair = useCallback(() => {
    updateLookup((_draft, lkDraft) => {
      if (!Array.isArray(lkDraft.keyPairs)) lkDraft.keyPairs = [];
      lkDraft.keyPairs.push({ left: '', right: '' });
    });
  }, [updateLookup]);

  const removeLookup = useCallback(() => {
    getStore().update(draft => {
      draft.lookups.splice(i, 1);
    });
    _afterCombineChange();
  }, [i]);

  const selectAllCols = useCallback(() => {
    if (lk.rightId) _showLayoutAliasesForSource(lk.rightId);
    _afterCombineChange();
  }, [lk.rightId]);

  const selectNoneCols = useCallback(() => {
    _hideLookupLayoutAliasesSafely(lk.rightId, null, i);
    _afterCombineChange();
  }, [i, lk.rightId]);

  return (
    <>
      <div class={stageClasses}>
        <div class="pl-stage-label">
          Look up columns from <Tip text={"Pull columns from another sheet by matching a shared value — just like VLOOKUP in Excel.\n\nFor example: match Employee ID in your main sheet to Employee ID in a lookup sheet to bring in their Department.\n\nUse '+ AND' to match on multiple columns at once."} />
          <label class="pl-enable-toggle" title={lkEnabled ? "Disable this lookup (won't block report)" : 'Enable this lookup'}>
            <input type="checkbox" checked={lkEnabled} onChange={e => handleEnabledChange((e.target as HTMLInputElement).checked)} />
            <span class="pl-enable-label">{lkEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
        {lkVMsg && <div class="pl-lookup-error">{lkVBlocked ? '⛔' : '⚠'} {lkVMsg}</div>}
        <div class="pl-lookup-header">
          <select value={lk.rightId || ''} onChange={e => handleRightIdChange((e.target as HTMLSelectElement).value)}>
            <option value="">{'—'} pick a sheet {'—'}</option>
            {sortedIds
              .filter(id => id !== base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id))
              .map(id => <option key={id} value={id}>{tables[id].name}</option>)}
          </select>
          <button class="btn btn-danger" style="flex-shrink:0" onClick={removeLookup}>{'✕'}</button>
        </div>
        {rt && (
          <div class="pl-lookup-keys">
            {pairs.map((pair, pi) => (
              <div key={pi} class="pl-key-pair">
                <span class="pl-key-pair-label">{pi === 0 ? 'Where' : 'AND'}</span>
                <select value={pair.left || ''} onChange={e => handleKpLeftChange(pi, (e.target as HTMLSelectElement).value)}>
                  <option value="">{'—'} column {'—'}</option>
                  {leftCols.map(c => {
                    const src = lkColMap.get(c);
                    const label = src && src.kind !== 'calc' ? colUserLabel(src.tid, src.col) : c;
                    return <option key={c} value={c}>{label}</option>;
                  })}
                </select>
                <span class="pl-lookup-eq">=</span>
                <select value={pair.right || ''} onChange={e => handleKpRightChange(pi, (e.target as HTMLSelectElement).value)}>
                  <option value="">{'—'} column {'—'}</option>
                  {rightCols.map(c => <option key={c} value={c}>{`${tables[lk.rightId]?.name || lk.rightId} → ${colUserLabel(lk.rightId, c)}`}</option>)}
                </select>
                {pairs.length > 1 && (
                  <button class="pl-rm-kp" title="Remove this condition" onClick={() => removeKeyPair(pi)}>{'✕'}</button>
                )}
              </div>
            ))}
            <button class="btn btn-ghost pl-add-kp" onClick={addKeyPair}>{'＋'} AND {'…'}</button>
          </div>
        )}
        {rt && (
          <div class="pl-lookup-required">
            <span style="flex-shrink:0">If no match:</span>
            <label><input type="radio" name={`lkreq_${i}`} value="0" checked={!lk.required} onChange={e => handleRequiredChange((e.target as HTMLInputElement).value)} /> Leave blank</label>
            <label><input type="radio" name={`lkreq_${i}`} value="1" checked={lk.required} onChange={e => handleRequiredChange((e.target as HTMLInputElement).value)} /> Skip row</label>
            <Tip text={"Leave blank: keep all rows from your main sheet, even if there is no match in the lookup sheet (the column will just be empty).\n\nSkip row: only keep rows that have a match — rows without a match are removed entirely."} />
          </div>
        )}
        {rt && (
          <div class="pl-lookup-required">
            <span style="flex-shrink:0">Duplicate keys:</span>
            <label><input type="radio" name={`lkdup_${i}`} value="block" checked={(lk.duplicatePolicy?.mode ?? 'block') !== 'combine'} onChange={e => handleDupModeChange((e.target as HTMLInputElement).value)} /> Block (error)</label>
            <label><input type="radio" name={`lkdup_${i}`} value="combine" checked={lk.duplicatePolicy?.mode === 'combine'} onChange={e => handleDupModeChange((e.target as HTMLInputElement).value)} /> Combine values</label>
            <Tip text={"Block: the report cannot run if the same key appears more than once in the lookup sheet. Use this when each match should be unique.\n\nCombine: if there are multiple matches, join them together into one cell separated by semicolons. For example: 'Tag1; Tag2; Tag3'."} />
          </div>
        )}
        {rt && (
          <div class="pl-lookup-cols">
            <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Bring in:</span>
            <Tip text="These are the columns from the lookup sheet. Click a chip to include or exclude it from the report. Right-click any chip to rename it." />
            {rt.cols.map(c => {
              const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c, lkColMap, aggMode);
              return (
                <Chip
                  key={c}
                  col={c}
                  label={colUserLabel(lk.rightId, c)}
                  selected={true}
                  draggable={false}
                  chipClass="pl-col-chip"
                  colorClass={lkColorCls}
                  className={isLayoutVisible ? '' : 'pl-col-chip-layout-hidden'}
                  tooltip={_sampleTipFor(lk.rightId, c, ['Click to show or hide this lookup column in your report.'])}
                  dataAttrs={{ 'data-li': String(i), 'data-lcc': c }}
                  onClick={() => {
                    const colMap2 = buildColSourceMap();
                    const visible = _isSourceVisibleInLayout(lk.rightId, c, colMap2, aggMode);
                    if (visible) _hideLookupLayoutAliasesSafely(lk.rightId, c, i);
                    else _showLayoutAliasesForSource(lk.rightId, c);
                    _afterCombineChange();
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    if (!lk.rightId) return;
                    const colMap2 = buildColSourceMap();
                    let alias = '';
                    for (const [a, src] of colMap2.entries()) {
                      if (src && src.kind !== 'calc' && src.tid === lk.rightId && src.col === c) { alias = a; break; }
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
            <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" onClick={selectAllCols}>All</button>
            <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" onClick={selectNoneCols}>None</button>
          </div>
        )}
      </div>
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
      {renameTarget && <RenameModal target={renameTarget} onDone={() => _afterCombineChange()} onClose={() => setRenameTarget(null)} />}
    </>
  );
}
