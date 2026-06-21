/**
 * Stacks modal — MUI Dialog wrapping stack sheet (UNION ALL) configuration.
 *
 * Adapted from the inline sections/stack-sheets.tsx component. Shows:
 * - Current stack chips with remove buttons and optional alias fields
 * - An "Include" button with a popup menu for adding tables
 * - Include source column toggle and source column name field
 *
 * All mutations go through store.update() and call invalidateValidation()
 * plus _afterCombineChange() for layout reconciliation.
 */

import { useCallback, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { getStore } from '../core/store';
import { useStore } from './useStore';
import { invalidateValidation } from '../report/validation';
import { getTableColor } from '../core/utils';
import { _afterCombineChange } from '../query/layout-selection';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface StacksModalProps {
  open: boolean;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Mutate store, then invalidate validation and notify layout reconciliation. */
function mutateAndInvalidate(updater: (draft: import('../types').AppState) => void): void {
  getStore().update(updater);
  invalidateValidation();
  _afterCombineChange();
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StacksModal({ open, onClose }: StacksModalProps) {
  const { tables, base, stacks, lookups, detailBands, includeSourceColumn, sourceColumnName, stackAliases } = useStore(s => ({
    tables: s.tables,
    base: s.base,
    stacks: s.stacks || [],
    lookups: s.lookups || [],
    detailBands: s.detailBands || [],
    includeSourceColumn: s.includeSourceColumn,
    sourceColumnName: s.sourceColumnName,
    stackAliases: s.stackAliases,
  }));

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  // Compute sorted table IDs by name
  const sortedIds = useMemo(() => {
    const ids = Object.keys(tables);
    return ids.sort((a, b) => tables[a].name.localeCompare(tables[b].name));
  }, [tables]);

  // Tables used as lookup right tables
  const usedAsLookup = useMemo(() => {
    return new Set(lookups.map(l => l.rightId).filter(Boolean));
  }, [lookups]);

  // Tables used as detail band right tables
  const usedAsBand = useMemo(() => {
    return new Set(detailBands.map(b => b.rightId).filter(Boolean));
  }, [detailBands]);

  // Tables already used as stacks
  const usedAsStack = useMemo(() => {
    return new Set(stacks);
  }, [stacks]);

  // Available tables for adding as stacks (not base, not used as lookup/band/stack)
  const stackAvail = useMemo(() => {
    return sortedIds.filter(id =>
      id !== base &&
      !usedAsStack.has(id) &&
      !usedAsLookup.has(id) &&
      !usedAsBand.has(id),
    );
  }, [sortedIds, base, usedAsStack, usedAsLookup, usedAsBand]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const addStack = useCallback((id: string) => {
    if (!id || !tables[id] || id === base) return;
    mutateAndInvalidate(draft => {
      if (!draft.stacks.includes(id)) draft.stacks.push(id);
    });
  }, [tables, base]);

  const removeStack = useCallback((id: string) => {
    mutateAndInvalidate(draft => {
      draft.stacks = draft.stacks.filter(s => s !== id);
    });
  }, []);

  const onAliasChange = useCallback((id: string, value: string) => {
    mutateAndInvalidate(draft => {
      if (!draft.stackAliases) draft.stackAliases = {};
      draft.stackAliases[id] = value;
    });
  }, []);

  const toggleIncludeSourceColumn = useCallback(() => {
    mutateAndInvalidate(draft => {
      draft.includeSourceColumn = !draft.includeSourceColumn;
    });
  }, []);

  const onSourceColumnNameChange = useCallback((value: string) => {
    mutateAndInvalidate(draft => {
      draft.sourceColumnName = value;
    });
  }, []);

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

  // ── Guard: no base table ─────────────────────────────────────────────────────

  if (!base || !tables[base]) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Stacks</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Pick a primary sheet first.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Done</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Stacks</DialogTitle>
      <DialogContent dividers>
        {/* Section: Include rows from */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Include rows from:
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 2 }}>
          {stacks.filter(id => tables[id]).map(id => (
            <Box key={id} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <Chip
                label={tables[id].name}
                onDelete={() => removeStack(id)}
                deleteIcon={<span>{'\u00d7'}</span>}
                sx={{
                  fontSize: '0.82rem',
                  borderLeft: `3px solid ${getTableColor(id)}`,
                  '& .MuiChip-deleteIcon': { fontSize: '0.85rem' },
                }}
              />
              {includeSourceColumn === true && (
                <TextField
                  value={stackAliases?.[id] ?? ''}
                  onChange={e => onAliasChange(id, e.target.value)}
                  placeholder={tables[id].name}
                  size="small"
                  variant="outlined"
                  sx={{ width: 100, '& .MuiInputBase-input': { fontSize: '0.82rem', py: '2px' } }}
                />
              )}
            </Box>
          ))}

          {stackAvail.length > 0 && (
            <>
              <Button
                size="small"
                onClick={handleAddClick}
                sx={{ textTransform: 'none', fontSize: '0.82rem' }}
              >
                {'\u2795'} Include
              </Button>
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
        </Box>

        {stacks.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No sheets stacked. Use &quot;Include&quot; to add sheets with matching columns.
          </Typography>
        )}

        {/* Section: Source column */}
        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={!!includeSourceColumn}
                onChange={toggleIncludeSourceColumn}
                size="small"
              />
            }
            label={
              <Typography variant="body2">Include source sheet name column</Typography>
            }
          />

          {includeSourceColumn === true && (
            <TextField
              value={sourceColumnName ?? ''}
              onChange={e => onSourceColumnNameChange(e.target.value)}
              label="Source column name"
              placeholder="Source"
              size="small"
              variant="outlined"
              fullWidth
              sx={{ mt: 1, '& .MuiInputBase-input': { fontSize: '0.82rem' } }}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
