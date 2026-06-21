/**
 * Band config modal — MUI Dialog for configuring detail band settings.
 *
 * Opened when the user clicks the gear icon on a band chip in the middle row
 * of the three-row header. Provides three configuration sections:
 *
 * 1. Match keys — parent column ↔ child column pair selector with add/remove
 * 2. Child columns — checkboxes for each column in the child table
 * 3. Band label — text field defaulting to the child table's short name
 *
 * On save, updates the band's keyPairs, cols, and label in store.detailBands
 * and calls invalidateValidation(). Detail bands do NOT use _afterCombineChange().
 *
 * ASR-0002: No "JOIN"/"SQL"/"WHERE" in user-facing text.
 * Uses "match" or "pair" instead of "join key".
 */

import { useCallback, useMemo, useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import type { AppState } from '../types';
import { getStore } from '../core/store';
import { invalidateValidation } from '../report/validation';
import { tableShortName } from '../core/utils';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface BandConfigModalProps {
  /** Whether the dialog is open */
  open: boolean;
  /** ID of the band being configured (null when closed) */
  bandId: string | null;
  /** Callback to close the dialog */
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function BandConfigModal({ open, bandId, onClose }: BandConfigModalProps) {
  // Subscribe to store for reactive rendering
  const [state, setState] = useState<AppState>(getStore().getState());
  useEffect(() => {
    if (!open) return;
    return getStore().subscribe(s => setState(s));
  }, [open]);

  // Local draft state — changes are applied on Save, not immediately
  const [draftKeyPairs, setDraftKeyPairs] = useState<Array<{ left: string; right: string }>>([]);
  const [draftCols, setDraftCols] = useState<string[]>([]);
  const [draftLabel, setDraftLabel] = useState('');

  // Find the band from the store
  const band = useMemo(() => {
    if (!bandId) return null;
    return state.detailBands.find(b => b.id === bandId) ?? null;
  }, [state.detailBands, bandId]);

  // Parent (base) table columns
  const parentCols = useMemo(() => {
    if (!state.base || !state.tables[state.base]) return [];
    return state.tables[state.base].cols;
  }, [state.base, state.tables]);

  // Child table columns
  const childCols = useMemo(() => {
    if (!band || !state.tables[band.rightId]) return [];
    return state.tables[band.rightId].cols;
  }, [band, state.tables]);

  // Initialize draft state when the modal opens or the band changes
  useEffect(() => {
    if (band) {
      setDraftKeyPairs(band.keyPairs.map(p => ({ ...p })));
      setDraftCols([...band.cols]);
      setDraftLabel(band.label || tableShortName(band.rightId));
    }
  }, [band]);

  // ── Match key pair handlers ──────────────────────────────────────────────────

  const handleAddPair = useCallback(() => {
    setDraftKeyPairs(prev => [...prev, { left: '', right: '' }]);
  }, []);

  const handleRemovePair = useCallback((index: number) => {
    setDraftKeyPairs(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handlePairLeftChange = useCallback((index: number, value: string) => {
    setDraftKeyPairs(prev => prev.map((p, i) => i === index ? { ...p, left: value } : p));
  }, []);

  const handlePairRightChange = useCallback((index: number, value: string) => {
    setDraftKeyPairs(prev => prev.map((p, i) => i === index ? { ...p, right: value } : p));
  }, []);

  // ── Child column checkbox handlers ───────────────────────────────────────────

  const handleColToggle = useCallback((col: string) => {
    setDraftCols(prev => {
      if (prev.includes(col)) {
        return prev.filter(c => c !== col);
      }
      return [...prev, col];
    });
  }, []);

  // ── Save handler ─────────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (!bandId) return;

    // Filter out incomplete pairs (both left and right must be set)
    const validPairs = draftKeyPairs.filter(p => p.left && p.right);

    getStore().update(draft => {
      const idx = draft.detailBands.findIndex(b => b.id === bandId);
      if (idx < 0) return;
      draft.detailBands[idx] = {
        ...draft.detailBands[idx],
        keyPairs: validPairs,
        cols: draftCols,
        label: draftLabel,
      };
    });

    // Detail bands call invalidateValidation() directly, NOT _afterCombineChange()
    invalidateValidation();
    onClose();
  }, [bandId, draftKeyPairs, draftCols, draftLabel, onClose]);

  // ── Guard: no band found ─────────────────────────────────────────────────────

  const bandTitle = band ? (tableShortName(band.rightId) + ' — Configuration') : 'Band Configuration';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600, pb: 1 }}>
        {bandTitle}
      </DialogTitle>
      <DialogContent dividers>
        {/* Section: Band label */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Label
          </Typography>
          <TextField
            value={draftLabel}
            onChange={e => setDraftLabel(e.target.value)}
            placeholder={band ? tableShortName(band.rightId) : ''}
            size="small"
            variant="outlined"
            fullWidth
            sx={{ '& .MuiInputBase-input': { fontSize: '0.82rem' } }}
          />
        </Box>

        {/* Section: Match keys (parent column ↔ child column) */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Match pairs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: '0.75rem' }}>
            Pair columns from the base sheet with columns from the child sheet.
          </Typography>

          {draftKeyPairs.map((pair, idx) => (
            <Box
              key={idx}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 1,
              }}
            >
              {/* Parent column (left) */}
              <FormControl size="small" sx={{ minWidth: 140, flex: 1 }}>
                <InputLabel sx={{ fontSize: '0.78rem' }}>Base column</InputLabel>
                <Select
                  value={pair.left}
                  onChange={e => handlePairLeftChange(idx, e.target.value as string)}
                  label="Base column"
                  sx={{ fontSize: '0.78rem' }}
                >
                  {parentCols.map(col => (
                    <MenuItem key={col} value={col} sx={{ fontSize: '0.78rem' }}>
                      {col}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Typography sx={{ fontSize: '0.75rem', color: '#888', flexShrink: 0 }}>
                ↔
              </Typography>

              {/* Child column (right) */}
              <FormControl size="small" sx={{ minWidth: 140, flex: 1 }}>
                <InputLabel sx={{ fontSize: '0.78rem' }}>Child column</InputLabel>
                <Select
                  value={pair.right}
                  onChange={e => handlePairRightChange(idx, e.target.value as string)}
                  label="Child column"
                  sx={{ fontSize: '0.78rem' }}
                >
                  {childCols.map(col => (
                    <MenuItem key={col} value={col} sx={{ fontSize: '0.78rem' }}>
                      {col}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Remove pair button */}
              <Button
                size="small"
                onClick={() => handleRemovePair(idx)}
                sx={{ minWidth: 28, p: 0, fontSize: '1rem', color: '#aaa', '&:hover': { color: '#f44' } }}
                title="Remove pair"
              >
                ×
              </Button>
            </Box>
          ))}

          <Button
            size="small"
            onClick={handleAddPair}
            sx={{ textTransform: 'none', fontSize: '0.78rem', mt: 0.5 }}
          >
            + Add pair
          </Button>
        </Box>

        {/* Section: Child columns */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Child columns
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: '0.75rem' }}>
            Select which columns from the child sheet to include.
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {childCols.map(col => (
              <FormControlLabel
                key={col}
                control={
                  <Checkbox
                    checked={draftCols.includes(col)}
                    onChange={() => handleColToggle(col)}
                    size="small"
                    sx={{ py: '2px' }}
                  />
                }
                label={
                  <Typography sx={{ fontSize: '0.78rem' }}>{col}</Typography>
                }
              />
            ))}
          </Box>

          {childCols.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              No columns available. Select a child sheet first.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="outlined" size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" size="small" onClick={handleSave} autoFocus>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
