/**
 * Join options popup for configuring lookup behavior.
 *
 * A MUI Popover that appears when the user clicks the gear icon on a
 * JoinKeyPair component. Provides two configuration sections:
 *
 * 1. "If no match" — controls LookupSpec.required (inner vs left join)
 * 2. "Duplicate keys" — controls LookupSpec.duplicatePolicy
 *
 * ASR-0002 compliance: No "JOIN"/"SQL"/"WHERE" in user-facing text.
 * Uses "Keep row" / "Only matching rows" instead of "LEFT JOIN" / "INNER JOIN".
 */

import { useCallback } from 'react';
import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { LookupSpec } from '../types';
import { getStore } from '../core/store';
import { invalidateValidation } from '../report/validation';

/**
 * Props for the JoinOptionsPopup component.
 */
export interface JoinOptionsPopupProps {
  /** Whether the popup is open */
  open: boolean;
  /** Anchor element for popover positioning (the gear icon button) */
  anchorEl: HTMLElement | null;
  /** Callback to close the popup */
  onClose: () => void;
  /** The LookupSpec being configured */
  lookup: LookupSpec;
  /** Index in store.lookups */
  lookupIndex: number;
}

/**
 * Join options popup component.
 *
 * Renders a MUI Popover with two radio groups:
 * - "If no match" → maps to LookupSpec.required (false = keep row / left join, true = only matching / inner join)
 * - "Duplicate keys" → maps to LookupSpec.duplicatePolicy.mode ('first' or 'combine')
 *
 * Changes are applied via store.update() and invalidateValidation().
 */
export function JoinOptionsPopup({
  open,
  anchorEl,
  onClose,
  lookup,
  lookupIndex,
}: JoinOptionsPopupProps) {
  /** Handle "if no match" change: update LookupSpec.required */
  const handleMatchChange = useCallback((_: unknown, value: string) => {
    const required = value === 'inner';
    getStore().update(draft => {
      draft.lookups[lookupIndex] = { ...draft.lookups[lookupIndex], required };
    });
    invalidateValidation();
  }, [lookupIndex]);

  /** Handle "duplicate keys" change: update LookupSpec.duplicatePolicy */
  const handleDuplicateChange = useCallback((_: unknown, value: string) => {
    const duplicatePolicy = value === 'combine'
      ? { mode: 'combine', combine: { separator: ', ', unique: false, includeBlank: false, sort: false } }
      : { mode: 'first' };
    getStore().update(draft => {
      draft.lookups[lookupIndex] = { ...draft.lookups[lookupIndex], duplicatePolicy };
    });
    invalidateValidation();
  }, [lookupIndex]);

  // Derive current radio values from the lookup spec
  const matchValue = lookup.required ? 'inner' : 'left';
  const duplicateValue = lookup.duplicatePolicy?.mode === 'combine' ? 'combine' : 'first';

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
      slotProps={{
        paper: {
          sx: {
            backgroundColor: '#1e1e2e',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '6px',
            p: '12px 16px',
            minWidth: 220,
            maxWidth: 300,
          },
        },
      }}
    >
      {/* Section 1: If no match */}
      <Box sx={{ mb: 2 }}>
        <Typography
          variant="caption"
          sx={{ color: '#aaa', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: '4px' }}
        >
          If no match
        </Typography>
        <RadioGroup value={matchValue} onChange={handleMatchChange}>
          <FormControlLabel
            value="left"
            control={<Radio size="small" sx={{ color: '#888', '&.Mui-checked': { color: '#7c8aff' } }} />}
            label={
              <Typography sx={{ fontSize: '0.78rem', color: '#ddd' }}>
                Keep row
              </Typography>
            }
          />
          <FormControlLabel
            value="inner"
            control={<Radio size="small" sx={{ color: '#888', '&.Mui-checked': { color: '#7c8aff' } }} />}
            label={
              <Typography sx={{ fontSize: '0.78rem', color: '#ddd' }}>
                Only matching rows
              </Typography>
            }
          />
        </RadioGroup>
      </Box>

      {/* Section 2: Duplicate keys */}
      <Box>
        <Typography
          variant="caption"
          sx={{ color: '#aaa', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: '4px' }}
        >
          Duplicate keys
        </Typography>
        <RadioGroup value={duplicateValue} onChange={handleDuplicateChange}>
          <FormControlLabel
            value="first"
            control={<Radio size="small" sx={{ color: '#888', '&.Mui-checked': { color: '#7c8aff' } }} />}
            label={
              <Typography sx={{ fontSize: '0.78rem', color: '#ddd' }}>
                Keep first match
              </Typography>
            }
          />
          <FormControlLabel
            value="combine"
            control={<Radio size="small" sx={{ color: '#888', '&.Mui-checked': { color: '#7c8aff' } }} />}
            label={
              <Typography sx={{ fontSize: '0.78rem', color: '#ddd' }}>
                Combine values
              </Typography>
            }
          />
        </RadioGroup>
      </Box>
    </Popover>
  );
}
