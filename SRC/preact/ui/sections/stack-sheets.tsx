/**
 * Stack sheets — UNION ALL additional tables section.
 *
 * Shows stacked table chips with remove buttons and an "Include" button
 * to add more sheets to the UNION ALL.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx (StackSheets sub-component).
 */

import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getStore } from '../../core/store';
import { getTableColor } from '../../core/utils';
import { _afterCombineChange } from '../../query/layout-selection';
import type { AppState } from '../../types';

export interface StackSheetsProps {
  /** All table IDs sorted by name. */
  sortedIds: string[];
  /** Table IDs already used as lookup right tables. */
  usedAsLookup: Set<string>;
  /** Table IDs already used as stacks. */
  usedAsStack: Set<string>;
}

export function StackSheets({ sortedIds, usedAsLookup, usedAsStack }: StackSheetsProps) {
  const [state, setState] = useState<AppState>(getStore().getState());
  const selRef = useRef<HTMLSelectElement>(null);

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const base = state.base;
  const tables = state.tables;
  const stacks = state.stacks || [];

  const addStack = useCallback((id: string) => {
    if (!id || !tables[id] || id === base) return;
    getStore().update(draft => {
      if (!draft.stacks.includes(id)) draft.stacks.push(id);
    });
    _afterCombineChange();
  }, [base, tables]);

  const removeStack = useCallback((id: string) => {
    getStore().update(draft => {
      draft.stacks = draft.stacks.filter(s => s !== id);
    });
    _afterCombineChange();
  }, []);

  if (!base || !tables[base]) {
    return <span style="font-size:0.76rem;color:var(--muted)">{'←'} Pick a sheet first</span>;
  }

  const stackAvail = sortedIds.filter(id => id !== base && !usedAsStack.has(id) && !usedAsLookup.has(id));

  const handleAddClick = useCallback(() => {
    const sel = selRef.current;
    if (!sel) return;
    sel.style.cssText = 'position:absolute;opacity:1;pointer-events:auto;width:auto;height:auto';
    sel.focus();
    const handleBlur = () => {
      sel.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0';
      sel.removeEventListener('blur', handleBlur);
    };
    sel.addEventListener('blur', handleBlur);
  }, []);

  const handleSelectChange = useCallback((e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val) addStack(val);
    (e.target as HTMLSelectElement).value = '';
  }, [addStack]);

  return (
    <div class="pl-stack-sheets">
      {stacks.filter(id => tables[id]).map(id => (
        <span key={id} class="pl-stack-chip" style={`border-left:3px solid ${getTableColor(id)}`}>
          {tables[id].name}
          <span class="rm" onClick={() => removeStack(id)}>{'×'}</span>
        </span>
      ))}
      {stackAvail.length > 0 && (
        <>
          <select
            ref={selRef}
            style="position:absolute;opacity:0;pointer-events:none;width:0;height:0"
            onChange={handleSelectChange}
          >
            <option value="">pick a sheet{'…'}</option>
            {stackAvail.map(id => (
              <option key={id} value={id}>{tables[id].name}</option>
            ))}
          </select>
          <div class="pl-add-btn" onClick={handleAddClick}>
            {'＋'} Include
          </div>
        </>
      )}
    </div>
  );
}
