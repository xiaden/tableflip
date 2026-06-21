/**
 * Root App component — composes the full application shell.
 *
 * Two-tab layout:
 *   Tab 0 — Report: PivotLayout (MenuBar + PivotMain + PivotSidebar)
 *   Tab 1 — Browse Sheet: PreviewPanel (raw data viewer)
 *
 * Converted from the old 3-tab design (Query Builder / Browse Sheet / Report)
 * to the new PivotLayout-based design from the Live Chip-Table UI redesign.
 */

import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { useStore } from './useStore';
import { Loader } from './file-loader';
import { PivotLayout } from './pivot-layout';
import {
  PreviewGrid,
  refreshPreviewGridLayout,
} from './grid';
import { getStore } from '../core/store';

// ── Preview Panel ─────────────────────────────────────────────────────────────

/**
 * Browse Sheet tab — lets the user select a table and view its raw data.
 * Uses the PreviewGrid component for AG Grid rendering.
 */
function PreviewPanel() {
  const { tables, previewTableId } = useStore(s => ({ tables: s.tables, previewTableId: s.previewTableId }));
  const [selectedTable, setSelectedTable] = useState<string>('');

  const tableIds = Object.keys(tables).sort((a, b) =>
    tables[a].name.localeCompare(tables[b].name)
  );

  // Restore selected table from store if coming back to this tab
  useEffect(() => {
    if (previewTableId && tables[previewTableId] && previewTableId !== selectedTable) {
      setSelectedTable(previewTableId);
    }
  }, [tables, previewTableId, selectedTable]);

  const handleSelect = useCallback((e: { target: { value: unknown } }) => {
    setSelectedTable(e.target.value as string);
  }, []);

  return (
    <Box className="data-body" sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0, display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, maxWidth: 320 }}>
          <Select
            value={selectedTable}
            onChange={handleSelect}
            displayEmpty
            size="small"
            sx={{ width: '100%', fontSize: '0.82rem' }}
          >
            <MenuItem value="" disabled>{'\u2014'} select a table to preview {'\u2014'}</MenuItem>
            {tableIds.map(id => (
              <MenuItem key={id} value={id}>{tables[id].name}</MenuItem>
            ))}
          </Select>
        </Box>
      </Box>
      <Box className="grid-wrap" sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <PreviewGrid key={selectedTable} tableId={selectedTable} />
      </Box>
    </Box>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

/**
 * Root application component.
 *
 * Renders the full UI shell: header, and tabbed main area with
 * Report (PivotLayout) and Browse Sheet (PreviewPanel) tabs.
 */
export function App() {
  const activeTab = useStore(s => s.activeTab) || 'query';

  // Refresh preview grid when tab becomes visible
  useEffect(() => {
    if (activeTab === 'preview') {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
    }
  }, [activeTab]);

  // 2-tab layout: 'preview' → tab 1, everything else → tab 0 (Report)
  const tabValue = activeTab === 'preview' ? 1 : 0;

  const handleTabChange = (_event: unknown, newValue: number): void => {
    const tabNames = ['query', 'preview'];
    getStore().set('activeTab', tabNames[newValue]);
  };

  return (
    <>
      {/* File drop/loading overlays and sheet selector modal */}
      <Loader />

      {/* Header */}
      <Box className="hdr" sx={{ display: 'flex', alignItems: 'center', padding: '6px 16px', background: 'var(--hdr-bg, #1a1a2e)', borderBottom: '1px solid var(--border, #333)' }}>
        <Typography variant="h6" component="h1" sx={{ fontSize: '1rem', fontWeight: 700, margin: 0, whiteSpace: 'nowrap' }}>
          TableFlip ({'\u256F'}{'\u00B0'}{'\u25A1'}{'\u00B0'}){'\u256F'}{'\uFE35'} {'\u253B'}{'\u2501'}{'\u253B'}
        </Typography>
        <Box className="spacer" sx={{ flex: 1 }} />
        <Typography className="sub" sx={{ fontSize: '0.72rem', color: 'var(--muted, #888)', marginLeft: 2 }}>
          Flip your spreadsheet tables into reports {'\u2014'} no 250-character formulas required
        </Typography>
      </Box>

      {/* Main layout */}
      <Box className="layout" sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main content */}
        <Box className="main" sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Tab bar */}
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            className="tabs"
            sx={{
              minHeight: 'auto',
              borderBottom: '1px solid var(--border, #333)',
              '& .MuiTab-root': {
                minHeight: 'auto',
                py: '8px',
                px: 2,
                fontSize: '0.82rem',
                textTransform: 'none',
                color: 'var(--muted, #888)',
                '&.Mui-selected': {
                  color: 'var(--text, #e0e0e0)',
                  fontWeight: 600,
                },
              },
              '& .MuiTabs-indicator': {
                backgroundColor: 'var(--accent, #4477AA)',
              },
            }}
          >
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  Report{' '}
                  <Tooltip title="Set up your report: choose a main sheet, combine sheets, pick columns, filter, sort, aggregate, and view results.">
                    <Typography component="span" sx={{ fontSize: '0.72rem', color: 'var(--muted, #888)', cursor: 'help' }}>?</Typography>
                  </Tooltip>
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  Browse Sheet{' '}
                  <Tooltip title="Look at the raw data in any loaded sheet — no filters or summary applied.">
                    <Typography component="span" sx={{ fontSize: '0.72rem', color: 'var(--muted, #888)', cursor: 'help' }}>?</Typography>
                  </Tooltip>
                </Box>
              }
            />
          </Tabs>

          {/* Tab panels */}
          <Box className="tab-content" sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <Box
              className={`tab-panel${activeTab !== 'preview' ? ' active' : ''}`}
              id="tab-report"
              sx={{ display: activeTab !== 'preview' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}
            >
              <PivotLayout />
            </Box>
            <Box
              className={`tab-panel${activeTab === 'preview' ? ' active' : ''}`}
              id="tab-preview"
              sx={{ display: activeTab === 'preview' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}
            >
              <PreviewPanel />
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );
}
