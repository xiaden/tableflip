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
import TextField from '@mui/material/TextField';

export interface StackSheetsProps {
  /** All table IDs sorted by name. */
  sortedIds: string[];
  /** Table IDs already used as lookup right tables. */
  usedAsLookup: Set<string>;
  /** Table IDs already used as stacks. */
  usedAsStack: Set<string>;
}

export function StackSheets({ sortedIds, usedAsLookup, usedAsStack }: StackSheetsProps) {
  const { base, tables, stacks, includeSourceColumn, stackAliases } = useStore(s => ({ base: s.base, tables: s.tables, stacks: s.stacks || [], includeSourceColumn: s.includeSourceColumn, stackAliases: s.stackAliases }));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

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

  const onAliasChange = useCallback((id: string, value: string) => {
    getStore().update(draft => {
      if (!draft.stackAliases) draft.stackAliases = {};
      draft.stackAliases[id] = value;
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
        <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Chip
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
          {includeSourceColumn === true && (
            <TextField
              value={stackAliases?.[id] ?? ''}
              onChange={e => onAliasChange(id, e.target.value)}
              placeholder={tables[id].name}
              size="small"
              variant="outlined"
              sx={{ width: 90, '& .MuiInputBase-input': { fontSize: '0.76rem', py: '2px' } }}
            />
          )}
        </span>
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
