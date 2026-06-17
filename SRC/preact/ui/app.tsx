/**
 * Root App component — composes the full application shell.
 *
 * Combines Sidebar, PipelineCard, LayoutCard, FilterSortCard, RunBar,
 * PreviewPanel, and ResultsPanel with tab switching.
 *
 * Converted from Preact to React + MUI.
 * Key differences from the Preact version:
 * - React hooks from 'react' instead of 'preact/hooks'
 * - useStore(selector) replaces getStore().subscribe() pattern
 * - MUI Tabs/Tab for tab bar, MUI Select/MenuItem for dropdowns
 * - MUI Box/Stack/Typography for layout instead of class-based divs
 * - MUI Button replaces native <button> elements
 * - MUI Tooltip wraps tab labels for help text
 */

import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { useStore } from './useStore';
import { Sidebar } from './sidebar';
import { Loader } from './file-loader';
import { PipelineCard } from './cards/pipeline-card';
import { LayoutCard } from './cards/layout-card';
import { FilterSortCard } from './cards/filter-sort-card';
import { RunBar } from './sections/run-bar';
import { switchTab } from './tabs';
import {
  ResultGrid,
  PreviewGrid,
  refreshResultGridLayout,
  refreshPreviewGridLayout,
} from './grid';
import { exportAs } from './export';
import { invalidateValidation } from '../report/validation';
import type { BandResultSet } from '../types';

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

// ── Results Panel ─────────────────────────────────────────────────────────────

/**
 * Report tab — displays query results in an AG Grid with export buttons.
 * Subscribes to store.result for reactive updates after report runs.
 */
function ResultsPanel() {
  const result = useStore(s => s.result) as Record<string, unknown> | null;
  const hasResults = !!(result && result.rows);

  // Compute results count for display (moved from ResultGrid to avoid duplication)
  let resultsCountText = '';
  if (hasResults) {
    const rows = (result as Record<string, unknown>).rows as Record<string, unknown>[];
    const totalsRow = (result as Record<string, unknown>).totalsRow as Record<string, unknown> | null;
    const cols = (result as Record<string, unknown>).cols as string[];
    const bandResult = (result as Record<string, unknown>).bandResult as BandResultSet | undefined;
    const displayRows = bandResult ? bandResult.parentRows : rows;
    const displayCols = bandResult
      ? [...bandResult.parentCols, ...bandResult.bandResults.flatMap(br => br.cols)]
      : cols;
    resultsCountText = totalsRow !== null
      ? displayRows.length.toLocaleString() + ' rows + 1 totals row \u00b7 ' + displayCols.length + ' columns'
      : displayRows.length.toLocaleString() + ' rows \u00b7 ' + displayCols.length + ' columns';
  }

  return (
    <Box className="data-body" sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <Box className="results-bar" sx={{ display: 'flex', alignItems: 'center', padding: '4px 10px', gap: 1 }}>
        <Typography
          className="results-count"
          sx={{
            fontSize: '0.76rem',
            color: hasResults ? 'inherit' : 'var(--muted)',
          }}
        >
          {hasResults ? resultsCountText : 'No results yet \u2014 run a query first'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {hasResults && (
          <>
            <Tooltip title="Download the current report results as an Excel (.xlsx) file you can open in Microsoft Excel.">
              <Button
                variant="text"
                size="small"
                onClick={() => exportAs('xlsx')}
                sx={{ color: 'inherit', textTransform: 'none' }}
              >
                {'\u2B07'} Excel
              </Button>
            </Tooltip>
            <Tooltip title="Download as a comma-separated values (.csv) file — a simple text format that any spreadsheet program can open.">
              <Button
                variant="text"
                size="small"
                onClick={() => exportAs('csv')}
                sx={{ color: 'inherit', textTransform: 'none' }}
              >
                {'\u2B07'} CSV
              </Button>
            </Tooltip>
          </>
        )}
      </Box>
      <Box className="grid-wrap" sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {hasResults ? (
          <ResultGrid
            result={result!}
            onRenameDone={() => { invalidateValidation(); }}
          />
        ) : (
          <Box className="empty" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
            <Box className="empty-icon" sx={{ fontSize: '2.5rem', marginBottom: '8px' }}>{'\u26A1'}</Box>
            <Box className="empty-title" sx={{ fontSize: '1rem', fontWeight: 600 }}>No results yet</Box>
            <Box className="empty-sub" sx={{ fontSize: '0.82rem' }}>Build a query and click {'\u25B6'} Run Report</Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ── Query Builder Tab ─────────────────────────────────────────────────────────

/**
 * Query Builder tab content — shows pipeline, layout, filter/sort, and run bar.
 * Shows an empty state when no tables are loaded.
 */
function QueryBuilderTab() {
  const { tables, base } = useStore(s => ({ tables: s.tables, base: s.base }));

  const ids = Object.keys(tables).sort((a, b) =>
    tables[a].name.localeCompare(tables[b].name)
  );
  const hasBase = !!base && !!tables[base];
  const hasBaseConfigured = !!base;

  if (ids.length === 0) {
    return (
      <Box className="empty" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
        <Box className="empty-icon" sx={{ fontSize: '2.5rem', marginBottom: '8px' }}>{'\u{1F4C2}'}</Box>
        <Box className="empty-title" sx={{ fontSize: '1rem', fontWeight: 600 }}>Drop files to get started</Box>
        <Box className="empty-sub" sx={{ fontSize: '0.82rem' }}>
          Drop your Excel or CSV files {'\u2014'} each sheet becomes available to build your report from
        </Box>
      </Box>
    );
  }

  return (
    <Box className="qb-body" sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto' }}>
      <PipelineCard />
      {hasBase && <LayoutCard />}
      {hasBase && <FilterSortCard />}
      {hasBaseConfigured && (
        <RunBar onResult={() => switchTab('results')} />
      )}
    </Box>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

/**
 * Root application component.
 *
 * Renders the full UI shell: header, sidebar with file loader, and tabbed main
 * area with Query Builder, Browse Sheet, and Report tabs.
 */
export function App() {
  const activeTab = useStore(s => s.activeTab) || 'query';

  // Refresh grids when tab becomes visible
  useEffect(() => {
    if (activeTab === 'results') {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
    }
    if (activeTab === 'preview') {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
    }
  }, [activeTab]);

  const tabValue = activeTab === 'query' ? 0 : activeTab === 'preview' ? 1 : 2;

  const handleTabChange = (_event: unknown, newValue: number): void => {
    const tabNames = ['query', 'preview', 'results'];
    switchTab(tabNames[newValue]);
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
        {/* Sidebar */}
        <Sidebar />

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
                  Report Setup{' '}
                  <Tooltip title="Set up your report here: choose a main sheet, combine it with others, pick which columns to show, filter rows, sort, and summarize.">
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
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  Report{' '}
                  <Tooltip title="View your report results here after clicking Run Report. Export to Excel or CSV from this tab.">
                    <Typography component="span" sx={{ fontSize: '0.72rem', color: 'var(--muted, #888)', cursor: 'help' }}>?</Typography>
                  </Tooltip>
                </Box>
              }
            />
          </Tabs>

          {/* Tab panels */}
          <Box className="tab-content" sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <Box
              className={`tab-panel${activeTab === 'query' ? ' active' : ''}`}
              id="tab-query"
              sx={{ display: activeTab === 'query' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}
            >
              <QueryBuilderTab />
            </Box>
            <Box
              className={`tab-panel${activeTab === 'preview' ? ' active' : ''}`}
              id="tab-preview"
              sx={{ display: activeTab === 'preview' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}
            >
              <PreviewPanel />
            </Box>
            <Box
              className={`tab-panel${activeTab === 'results' ? ' active' : ''}`}
              id="tab-results"
              sx={{ display: activeTab === 'results' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}
            >
              <ResultsPanel />
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );
}
