/**
 * Stack sheets — UNION ALL additional tables section.
 *
 * Shows stacked table chips with remove buttons and an "Include" button
 * to add more sheets to the UNION ALL.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx (StackSheets sub-component).
 */

import { useCallback, useState } from 'react';
import { getStore } from '../../core/store';
import { useStore } from '../useStore';
import { getTableColor } from '../../core/utils';
import { _afterCombineChange } from '../../query/layout-selection';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';

export interface StackSheetsProps {
  /** All table IDs sorted by name. */
  sortedIds: string[];
  /** Table IDs already used as lookup right tables. */
  usedAsLookup: Set<string>;
  /** Table IDs already used as stacks. */
  usedAsStack: Set<string>;
}

export function StackSheets({ sortedIds, usedAsLookup, usedAsStack }: StackSheetsProps) {
  const state = useStore(s => s);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

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
    return <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>{'←'} Pick a sheet first</span>;
  }

  const stackAvail = sortedIds.filter(id => id !== base && !usedAsStack.has(id) && !usedAsLookup.has(id));

  const handleAddClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor(e.currentTarget);
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenuAnchor(null);
  }, []);

  const handleMenuSelect = useCallback((id: string) => {
    addStack(id);
    setMenuAnchor(null);
  }, [addStack]);

  return (
    <div className="pl-stack-sheets" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {stacks.filter(id => tables[id]).map(id => (
        <Chip
          key={id}
          label={tables[id].name}
          onDelete={() => removeStack(id)}
          deleteIcon={<span>{'×'}</span>}
          sx={{
            fontSize: '0.76rem',
            borderLeft: `3px solid ${getTableColor(id)}`,
            '& .MuiChip-deleteIcon': { fontSize: '0.85rem' },
          }}
          className="pl-stack-chip"
        />
      ))}
      {stackAvail.length > 0 && (
        <>
          <div className="pl-add-btn" onClick={handleAddClick} style={{ cursor: 'pointer', fontSize: '0.76rem' }}>
            {'＋'} Include
          </div>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={handleMenuClose}
          >
            {stackAvail.map(id => (
              <MenuItem key={id} onClick={() => handleMenuSelect(id)} sx={{ fontSize: '0.82rem' }}>
                {tables[id].name}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </div>
  );
}
