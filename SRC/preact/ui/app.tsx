/**
 * Root App component — composes the full application shell.
 *
 * Combines Sidebar, PipelineCard, LayoutCard, FilterSortCard, RunBar,
 * PreviewPanel, and ResultsPanel with tab switching.
 *
 * Ported from SRC/js/ui/views/query-builder.tsx and the old index.html layout.
 * Key differences:
 * - Entire UI is a Preact component tree (no static HTML shell)
 * - Tab switching via store subscription instead of DOM class toggling
 * - Grid rendering handled by ResultGrid/PreviewGrid components (no innerHTML)
 * - No window assignments for event handlers
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../core/store';
import { h } from '../core/utils';
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
import type { AppState } from '../types';

// ── Preview Panel ─────────────────────────────────────────────────────────────

/**
 * Browse Sheet tab — lets the user select a table and view its raw data.
 * Uses the PreviewGrid component for AG Grid rendering.
 */
function PreviewPanel() {
  const [state, setState] = useState<AppState>(getStore().getState());
  const [selectedTable, setSelectedTable] = useState<string>('');

  useEffect(() => {
    const unsub = getStore().subscribe(s => setState(s));
    return unsub;
  }, []);

  const tableIds = Object.keys(state.tables).sort((a, b) =>
    state.tables[a].name.localeCompare(state.tables[b].name)
  );

  // Restore selected table from store if coming back to this tab
  useEffect(() => {
    const previewId = state.previewTableId;
    if (previewId && state.tables[previewId] && previewId !== selectedTable) {
      setSelectedTable(previewId);
    }
  }, [state]);

  const handleSelect = useCallback((e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    setSelectedTable(val);
  }, []);

  return (
    <div class="data-body">
      <div class="btn-row" style="flex-shrink:0">
        <div style="flex:1;max-width:320px">
          <select value={selectedTable} onChange={handleSelect}>
            <option value="">{'\u2014'} select a table to preview {'\u2014'}</option>
            {tableIds.map(id => (
              <option key={id} value={id}>{h(state.tables[id].name)}</option>
            ))}
          </select>
        </div>
      </div>
      <div class="grid-wrap">
        <PreviewGrid key={selectedTable} tableId={selectedTable} />
      </div>
    </div>
  );
}

// ── Results Panel ─────────────────────────────────────────────────────────────

/**
 * Report tab — displays query results in an AG Grid with export buttons.
 * Subscribes to store.result for reactive updates after report runs.
 */
function ResultsPanel() {
  const [state, setState] = useState<AppState>(getStore().getState());

  useEffect(() => {
    const unsub = getStore().subscribe(s => setState(s));
    return unsub;
  }, []);

  const result = state.result as Record<string, unknown> | null;
  const hasResults = !!(result && result.rows);

  return (
    <div class="data-body">
      <div class="results-bar">
        <span class="results-count" style={!hasResults ? { fontSize: '0.76rem', color: 'var(--muted)' } : undefined}>
          {hasResults ? '' : 'No results yet \u2014 run a query first'}
        </span>
        <div style="flex:1" />
        {hasResults && (
          <>
            <button
              class="btn btn-ghost"
              onClick={() => exportAs('xlsx')}
              data-tip="Download the current report results as an Excel (.xlsx) file you can open in Microsoft Excel."
            >
              {'\u2B07'} Excel
            </button>
            <button
              class="btn btn-ghost"
              onClick={() => exportAs('csv')}
              data-tip="Download as a comma-separated values (.csv) file — a simple text format that any spreadsheet program can open."
            >
              {'\u2B07'} CSV
            </button>
          </>
        )}
      </div>
      <div class="grid-wrap">
        {hasResults ? (
          <ResultGrid
            result={result!}
            onRenameDone={() => { invalidateValidation(); }}
          />
        ) : (
          <div class="empty">
            <div class="empty-icon">{'\u26A1'}</div>
            <div class="empty-title">No results yet</div>
            <div class="empty-sub">Build a query and click {'\u25B6'} Run Report</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Query Builder Tab ─────────────────────────────────────────────────────────

/**
 * Query Builder tab content — shows pipeline, layout, filter/sort, and run bar.
 * Shows an empty state when no tables are loaded.
 */
function QueryBuilderTab() {
  const [state, setState] = useState<AppState>(getStore().getState());

  useEffect(() => {
    const unsub = getStore().subscribe(s => setState(s));
    return unsub;
  }, []);

  const ids = Object.keys(state.tables).sort((a, b) =>
    state.tables[a].name.localeCompare(state.tables[b].name)
  );
  const hasBase = !!state.base && !!state.tables[state.base];
  const hasBaseConfigured = !!state.base;

  if (ids.length === 0) {
    return (
      <div class="empty">
        <div class="empty-icon">{'\u{1F4C2}'}</div>
        <div class="empty-title">Drop files to get started</div>
        <div class="empty-sub">
          Drop your Excel or CSV files {'\u2014'} each sheet becomes available to build your report from
        </div>
      </div>
    );
  }

  return (
    <div class="qb-body">
      <PipelineCard />
      {hasBase && <LayoutCard />}
      {hasBase && <FilterSortCard />}
      {hasBaseConfigured && (
        <RunBar onResult={() => switchTab('results')} />
      )}
    </div>
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
  const [state, setState] = useState<AppState>(getStore().getState());
  const activeTab = state.activeTab || 'query';

  useEffect(() => {
    const unsub = getStore().subscribe(s => setState(s));
    return unsub;
  }, []);

  // Refresh grids when tab becomes visible
  useEffect(() => {
    if (activeTab === 'results') {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
    }
    if (activeTab === 'preview') {
      requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
    }
  }, [activeTab]);

  return (
    <>
      {/* File drop/loading overlays and sheet selector modal */}
      <Loader />

      {/* Header */}
      <div class="hdr">
        <h1>TableFlip ({'\u256F'}{'\u00B0'}{'\u25A1'}{'\u00B0'}){'\u256F'}{'\uFE35'} {'\u253B'}{'\u2501'}{'\u253B'}</h1>
        <div class="spacer" />
        <span class="sub">
          Flip your spreadsheet tables into reports {'\u2014'} no 250-character formulas required
        </span>
      </div>

      {/* Main layout */}
      <div class="layout">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <div class="main">
          {/* Tab bar */}
          <div class="tabs">
            <div
              class={`tab-btn${activeTab === 'query' ? ' active' : ''}`}
              onClick={() => switchTab('query')}
            >
              Report Setup{' '}
              <span
                class="tip"
                data-tip="Set up your report here: choose a main sheet, combine it with others, pick which columns to show, filter rows, sort, and summarize."
              >
                ?
              </span>
            </div>
            <div
              class={`tab-btn${activeTab === 'preview' ? ' active' : ''}`}
              onClick={() => switchTab('preview')}
            >
              Browse Sheet{' '}
              <span class="tip" data-tip="Look at the raw data in any loaded sheet — no filters or summary applied.">?</span>
            </div>
            <div
              class={`tab-btn${activeTab === 'results' ? ' active' : ''}`}
              onClick={() => switchTab('results')}
            >
              Report{' '}
              <span
                class="tip"
                data-tip="View your report results here after clicking Run Report. Export to Excel or CSV from this tab."
              >
                ?
              </span>
            </div>
          </div>

          {/* Tab panels */}
          <div class="tab-content">
            <div
              class={`tab-panel${activeTab === 'query' ? ' active' : ''}`}
              id="tab-query"
            >
              <QueryBuilderTab />
            </div>
            <div
              class={`tab-panel${activeTab === 'preview' ? ' active' : ''}`}
              id="tab-preview"
            >
              <PreviewPanel />
            </div>
            <div
              class={`tab-panel${activeTab === 'results' ? ' active' : ''}`}
              id="tab-results"
            >
              <ResultsPanel />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
