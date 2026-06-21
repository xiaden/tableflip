/**
 * Join key pair chip component for the three-row header top row.
 *
 * Renders two compact chips side-by-side representing the left (existing)
 * and right (joined) columns of a lookup, with a gear icon between them
 * that opens the join options popup.
 *
 * Only mounted when a join pair actually exists — solo columns do not
 * show this component or a gear icon (P5-S2).
 *
 * ASR-0002: No "JOIN"/"SQL"/"WHERE" in user-facing text.
 */

import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import Box from '@mui/material/Box';
import ChipMUI from '@mui/material/Chip';
import { getTableColor, chipFgColor } from '../core/utils';

/**
 * Props for the JoinKeyPair component.
 */
export interface JoinKeyPairProps {
  /** Display name of the left (existing) column */
  leftCol: string;
  /** Table ID of the left column's source table */
  leftTableId: string;
  /** Display name of the right (joined) column */
  rightCol: string;
  /** Table ID of the right (joined) table */
  rightTableId: string;
  /** Index in store.lookups for this join pair */
  lookupIndex: number;
  /** Callback when the gear icon is clicked — opens the join options popup */
  onGearClick: (lookupIndex: number, anchorEl: HTMLElement) => void;
}

/** Compact chip height for the header area. */
const CHIP_HEIGHT = 20;

/**
 * Renders two colored chips representing a join key pair with a gear icon
 * between them. The gear icon triggers the join options popup.
 *
 * Both chips are colored by their respective table colors using getTableColor().
 * Text color is computed via chipFgColor() for contrast.
 */
export function JoinKeyPair({
  leftCol,
  leftTableId,
  rightCol,
  rightTableId,
  lookupIndex,
  onGearClick,
}: JoinKeyPairProps) {
  const leftColor = getTableColor(leftTableId);
  const leftFg = chipFgColor(leftColor);
  const rightColor = getTableColor(rightTableId);
  const rightFg = chipFgColor(rightColor);

  /** Handle gear icon click: pass the button element as anchor for the popover. */
  const handleGearClick = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onGearClick(lookupIndex, e.currentTarget);
  }, [lookupIndex, onGearClick]);

  const chipSx = {
    height: CHIP_HEIGHT,
    fontSize: '0.65rem',
    '& .MuiChip-label': { px: '4px' },
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        overflow: 'hidden',
      }}
      data-join-pair={lookupIndex}
    >
      {/* Left chip — existing column from the base table */}
      <ChipMUI
        label={leftCol}
        size="small"
        draggable={false}
        sx={{
          ...chipSx,
          backgroundColor: leftColor,
          color: leftFg,
          borderLeft: `2px solid ${leftColor}`,
        }}
      />

      {/* Gear icon — opens join options popup */}
      <Box
        component="button"
        onClick={handleGearClick}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          color: '#aaa',
          fontSize: '13px',
          cursor: 'pointer',
          borderRadius: '3px',
          p: 0,
          '&:hover': {
            background: 'rgba(255,255,255,0.1)',
            color: '#ddd',
          },
        }}
        title="Join options"
        type="button"
      >
        {'\u2699'}
      </Box>

      {/* Right chip — joined column from the right table */}
      <ChipMUI
        label={rightCol}
        size="small"
        draggable={false}
        sx={{
          ...chipSx,
          backgroundColor: rightColor,
          color: rightFg,
          borderLeft: `2px solid ${rightColor}`,
        }}
      />
    </Box>
  );
}
