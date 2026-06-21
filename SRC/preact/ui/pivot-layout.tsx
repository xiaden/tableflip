/**
 * PivotLayout — top-level layout for the Report tab.
 *
 * Composes MenuBar (top), PivotSidebar (left), and PivotMain (center).
 * Mounts the auto-preview subscription on mount via initAutoPreview() and
 * tears it down on unmount via destroyAutoPreview().
 */

import { useEffect } from 'react';
import Box from '@mui/material/Box';
import { MenuBar } from './menu-bar';
import { PivotMain } from './pivot-main';
import { PivotSidebar } from './pivot-sidebar';
import { initAutoPreview, destroyAutoPreview } from './auto-preview';

export function PivotLayout() {
  useEffect(() => {
    initAutoPreview();
    return () => {
      destroyAutoPreview();
    };
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <MenuBar />
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <PivotSidebar />
        <PivotMain />
      </Box>
    </Box>
  );
}
