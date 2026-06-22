/**
 * PivotMain — center panel for the Report tab (grid area).
 *
 * Renders the ResultGrid component when a query result exists, or an empty
 * state when no result is available. The ResultGrid uses ThreeRowHeader
 * (set in Phase 1) with headerHeight=90 for the three-row drop zone header.
 *
 * Phase 8 (P8-S1): Replaced placeholder text with ResultGrid integration.
 * Phase 8 (P8-S5): Added validation red border when reportStatus === 'blocked'.
 */

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useStore } from './useStore';
import { ResultGrid } from './grid';
import { invalidateValidation, getValidation } from '../report/validation';
import type { AppState } from '../types';

export function PivotMain() {
  // Subscribe to result and validation state
  const result = useStore(s => s.result) as AppState['result'];
  const validationStatus = useStore(() => {
    try {
      return getValidation().reportStatus;
    } catch {
      return 'healthy' as const;
    }
  });

  // P8-S5: Red border when validation is blocked
  const isBlocked = validationStatus === 'blocked';

  const wrapperSx = useMemo(() => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    // P8-S5: Red border when report is blocked
    ...(isBlocked ? {
      border: '2px solid red',
      borderRadius: '4px',
    } : {}),
  }), [isBlocked]);

  // Always render the grid — when no result exists yet, pass a blank result
  // so the __add column is available as a drop target.
  const blankResult = {
    columns: [],
    rows: [],
    metadata: { rowCount: 0, generatedAt: Date.now(), aggMode: 'none', displayCols: [] },
  };

  return (
    <Box sx={wrapperSx}>
      <ResultGrid result={result ?? blankResult} onRenameDone={() => invalidateValidation()} />
    </Box>
  );
}
