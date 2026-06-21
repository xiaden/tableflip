/**
 * PivotSidebar — left-side panel for the Report tab.
 *
 * Composes three child sections:
 * 1. TopSection — Import file, Import config, Save config buttons
 * 2. SheetAccordions — per-sheet MUI Accordions with draggable column chips
 * 3. CalcAccordion — calculated columns with CalcBuilder dialog
 *
 * Supports collapse/expand via _ui.sidebarCollapsed in the store.
 * When collapsed, width transitions to 0 with overflow hidden, and the
 * main area reflows to fill the freed space. A toggle button on the
 * left edge allows the user to collapse/expand the sidebar.
 */

import { useCallback } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { useStore } from './useStore';
import { getStore } from '../core/store';
import { TopSection } from './top-section';
import { SheetAccordions } from './sheet-accordions';
import { CalcAccordion } from './calc-accordion';

/**
 * PivotSidebar — 270px collapsible left sidebar for the Report tab.
 *
 * Layout (top to bottom):
 * - TopSection (import/save buttons)
 * - SheetAccordions (scrollable, flex: 1)
 * - Flex spacer (pushes CalcAccordion to bottom)
 * - CalcAccordion (stuck to bottom via mt: 'auto')
 *
 * Collapse behavior:
 * - Width transitions between 270px (expanded) and 0 (collapsed)
 * - overflow: 'hidden' prevents content leaking during transition
 * - borderRight only visible when expanded
 * - Toggle button peeks out on the right edge when collapsed
 */
export function PivotSidebar() {
  // Read collapse state from the transient _ui slice
  const sidebarCollapsed = useStore(s => s._ui?.sidebarCollapsed ?? false);

  /**
   * Toggle the sidebar collapsed state.
   * Initializes _ui if it doesn't exist (defensive — state factory sets it).
   */
  const toggleSidebar = useCallback(() => {
    getStore().update(draft => {
      if (!draft._ui) draft._ui = {};
      draft._ui.sidebarCollapsed = !draft._ui.sidebarCollapsed;
    });
  }, []);

  return (
    <Box
      sx={{
        position: 'relative',
        width: sidebarCollapsed ? 0 : 270,
        minWidth: sidebarCollapsed ? 0 : 270,
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        borderRight: sidebarCollapsed ? 'none' : '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Collapse/expand toggle button — positioned on the right edge */}
      <IconButton
        size="small"
        onClick={toggleSidebar}
        sx={{
          position: 'absolute',
          right: sidebarCollapsed ? -24 : 0,
          top: 8,
          zIndex: 10,
          width: 24,
          height: 24,
          borderRadius: '0 4px 4px 0',
          backgroundColor: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderLeft: 'none',
          color: 'var(--muted)',
          p: 0,
          '&:hover': {
            color: 'var(--text)',
            backgroundColor: 'var(--bg3)',
          },
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {sidebarCollapsed ? (
            <polyline points="15 18 9 12 15 6" />
          ) : (
            <polyline points="9 18 15 12 9 6" />
          )}
        </svg>
      </IconButton>

      {/* Sidebar content — only visible when expanded (overflow: hidden clips when width=0) */}
      <TopSection />
      <SheetAccordions />
      <Box sx={{ flexGrow: 1 }} />
      <Box sx={{ mt: 'auto' }}>
        <CalcAccordion />
      </Box>
    </Box>
  );
}
