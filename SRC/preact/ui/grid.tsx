/**
 * AG Grid integration — result grid, preview grid, column definitions.
 *
 * Provides React components that wrap <AgGridReact> for declarative AG Grid
 * lifecycle management. All rendering is done through JSX — no innerHTML.
 *
 * Migrated from imperative `agGrid.createGrid()` pattern to declarative
 * `<AgGridReact>` components. Grid lifecycle (create/destroy) is now managed
 * by React reconciliation. External refresh functions use module-level API
 * refs populated via `onGridReady` callbacks.
 *
 * Ported from `SRC/js/ui/grid.ts`. Key differences:
 * - No window assignments (renderResults, loadPreview, clearExclusions)
 * - State mutations go through store.update() instead of direct db mutation
 * - Column rename uses RenameModal rendered via createPortal
 * - No import from SRC/js/ — uses catalog and utils
 */

import { useRef, useState, useCallback, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { GridApi, GridReadyEvent, ColDef, RowClassParams, RowStyle, IsFullWidthRowParams, ColumnState } from 'ag-grid-community';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import type { ColSourceEntry, ColumnType, OverlayDescriptor, BandResultSet } from '../types';
import { getStore } from '../core/store';
import { colLabel, getTableColor, setColLabel } from '../core/utils';
import { buildColSourceMap } from '../catalog/column-catalog';
import { resolveRenameTarget, RenameModal, type RenameTarget } from './components/rename-modal';
import { execQuery, quoteId } from '../core/sqldb';
import { invalidateValidation } from '../report/validation';
import { ContextMenu, type CtxMenuItem } from './components/context-menu';
import { buildOverlayDescriptors } from '../report/overlay-grouping';
import { ThreeRowHeader } from './three-row-header';

/**
 * Synchronous display label computation (avoids async colDisplayLabel).
 * For physical columns, formats as "SheetName:ColumnLabel".
 * For calculated columns, returns the calc alias or falls back to the alias.
 */
function _displayLabel(alias: string, colMap: Map<string, ColSourceEntry>): string {
  const src = colMap.get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') {
    const calc = getStore().getState().calcStages?.[src.idx];
    return (calc?.alias || '').trim() || alias;
  }
  return colLabel(src.tid, src.col);
}

// ── Band row styling ─────────────────────────────────────────────────────────

/**
 * Subtle tinted backgrounds for band rows on the dark AG Grid theme.
 * Each band gets a distinct hue; parent rows (null _band_id) are unstyled.
 */
export const BAND_ROW_TINTS = [
  'rgba(148, 163, 184, 0.08)',  // slate
  'rgba(96, 165, 250, 0.08)',   // blue
  'rgba(74, 222, 128, 0.08)',   // green
  'rgba(251, 146, 60, 0.08)',   // orange
  'rgba(192, 132, 252, 0.08)',  // purple
];

/**
 * Convert OverlayDescriptor[] into AG Grid-compatible flat row data.
 * Computes superset columns (parent + all band columns), null-pads rows,
 * and inserts band header markers. The null-padding is a rendering concern
 * applied at the grid boundary — not in the engine.
 *
 * @param descriptors - Ordered overlay descriptors from buildOverlayDescriptors().
 * @param parentCols - Parent column names.
 * @param bandColSets - Map of band ID → band column names for computing superset.
 * @returns Flat row data suitable for AG Grid's rowData option.
 */
export function descriptorsToGridRows(
  descriptors: OverlayDescriptor[],
  parentCols: string[],
  bandColSets: Record<string, string[]>,
): Record<string, unknown>[] {
  const allBandCols = Object.values(bandColSets).flat();
  const supersetCols = [...parentCols, ...allBandCols];

  const bandTintMap = new Map<string, number>();
  let tintIdx = 0;
  for (const d of descriptors) {
    if ((d.type === 'band-row' || d.type === 'band-section') && d.bandId != null && !bandTintMap.has(d.bandId)) {
      bandTintMap.set(d.bandId, tintIdx++);
    }
  }

  return descriptors.map(d => {
    if (d.type === 'parent') {
      const row: Record<string, unknown> = { ...d.data };
      for (const bc of allBandCols) {
        if (row[bc] === undefined) row[bc] = '';
      }
      return row;
    }
    if (d.type === 'band-section') {
      const row: Record<string, unknown> = {
        _isBandHeader: true,
        _band_id: d.bandId,
        _bandLabel: d.bandLabel,
        _bandTintIndex: bandTintMap.get(d.bandId) ?? 0,
      };
      for (const sc of supersetCols) {
        row[sc] = '';
      }
      return row;
    }
    // band-row
    const row: Record<string, unknown> = { ...d.data, _band_id: d.bandId };
    for (const pc of parentCols) {
      if (row[pc] === undefined) row[pc] = '';
    }
    return row;
  });
}

/**
 * AG Grid full-width cell renderer for band section headers.
 * Displays the band label with a tinted background matching the band's color assignment.
 *
 * AG Grid's imperative cell renderer contract:
 * - init(params) – set up DOM
 * - getGui() – return the root element
 * - refresh() – return false (no partial updates)
 * - destroy() – cleanup (no-op)
 *
 * The params.data object is the synthetic row produced by descriptorsToGridRows()
 * and contains _bandLabel, _band_id, and _bandTintIndex.
 */
export class BandHeaderRenderer {
  private eGui!: HTMLDivElement;

  init(params: { data: Record<string, unknown> }): void {
    this.eGui = document.createElement('div');
    const label = String(params.data._bandLabel ?? params.data._band_id ?? '');
    const tintIndex = (params.data._bandTintIndex as number) ?? 0;
    const color = BAND_ROW_TINTS[tintIndex % BAND_ROW_TINTS.length];

    this.eGui.style.cssText = `
      display: flex; align-items: center; height: 100%;
      padding: 4px 12px; background: ${color};
      border-top: 1px solid rgba(255,255,255,0.1);
      font-weight: 600; font-size: 13px;
    `.trim();
    this.eGui.textContent = label;
  }

  getGui(): HTMLDivElement {
    return this.eGui;
  }

  refresh(): boolean {
    return false;
  }

  destroy(): void {
    // no-op
  }
}

/**
 * Build a getRowStyle callback that applies tinted backgrounds to band rows.
 * Parent rows (_band_id is null/undefined) return undefined (default style).
 * Band rows cycle through BAND_ROW_TINTS by order of first appearance.
 *
 * Exported for unit testing.
 *
 * @param rows - The result rows (used to determine band ordering).
 * @returns A getRowStyle callback suitable for AG Grid options.
 */
export function createBandRowStyler(
  rows: Record<string, unknown>[],
): (params: { data: Record<string, unknown> }) => Record<string, string> | undefined {
  // Build band ID → index map (order of first appearance)
  const bandIndex = new Map<string, number>();
  let nextIdx = 0;
  for (const row of rows) {
    const bandId = row._band_id;
    if (typeof bandId === 'string' && !bandIndex.has(bandId)) {
      bandIndex.set(bandId, nextIdx++);
    }
  }

  return (params: { data: Record<string, unknown> }): Record<string, string> | undefined => {
    const data = params.data;
    if (!data) return undefined;
    // Guard: full-width band header rows should not get row styling
    if (data._isBandHeader === true) return undefined;
    const bandId = data._band_id;
    if (bandId == null || typeof bandId !== 'string') return undefined;
    const idx = bandIndex.get(bandId);
    if (idx === undefined) return undefined;
    return { background: BAND_ROW_TINTS[idx % BAND_ROW_TINTS.length] };
  };
}

// ── Grid API tracking ────────────────────────────────────────────────────────
//
// These module-level variables are intentionally retained as singletons.
// External callers (app.tsx) invoke refreshResultGridLayout() and
// refreshPreviewGridLayout() via requestAnimationFrame after tab switches
// and visibility changes. These functions need synchronous access to the
// GridApi without going through React state or refs. The onGridReady
// callbacks populate these refs, and they are effectively "global" because
// there is only one result grid and one preview grid at any time.
// A ref-based approach would require plumbing callbacks through the component
// tree, which is more complex than the current pattern for these singletons.

let _resultGridApi: GridApi | null = null;
let _previewGridApi: GridApi | null = null;

/**
 * Refreshes the result grid layout (row heights, cells, redraw).
 * Call after the grid container becomes visible or resizes.
 */
export function refreshResultGridLayout(): void {
  if (!_resultGridApi) return;
  try { _resultGridApi.resetRowHeights(); } catch { /* ignore */ }
  try { _resultGridApi.refreshCells({ force: true }); } catch { /* ignore */ }
  try { _resultGridApi.redrawRows(); } catch { /* ignore */ }
}

/**
 * Refreshes the preview grid layout (row heights, cells, redraw).
 * Call after the grid container becomes visible or resizes.
 */
export function refreshPreviewGridLayout(): void {
  if (!_previewGridApi) return;
  try { _previewGridApi.resetRowHeights(); } catch { /* ignore */ }
  try { _previewGridApi.refreshCells({ force: true }); } catch { /* ignore */ }
  try { _previewGridApi.redrawRows(); } catch { /* ignore */ }
}

function _saveResultColState(): void {
  if (_resultGridApi) {
    const colState = _resultGridApi.getColumnState() as unknown as Record<string, unknown> | null;
    getStore().update(draft => {
      draft.colState = colState;
      // P8-S3: Also save column widths to _ui.columnWidths for persistence
      if (colState && Array.isArray(colState)) {
        const widths: Record<string, number> = {};
        for (const cs of colState as Array<Record<string, unknown>>) {
          if (typeof cs.colId === 'string' && typeof cs.width === 'number') {
            widths[cs.colId] = cs.width;
          }
        }
        if (!draft._ui) draft._ui = {};
        draft._ui.columnWidths = widths;
      }
    });
  }
}

// ── Shared default column definition ─────────────────────────────────────────

const DEFAULT_COL_DEF: ColDef = {
  sortable: true,
  resizable: true,
  filter: true,
  floatingFilter: true,
  minWidth: 80,
  cellRenderer: (params: { value: unknown }) => {
    const v = params.value;
    return v == null ? '' : String(v);
  },
};

// ── Result grid component ────────────────────────────────────────────────────

interface ResultGridProps {
  result: Record<string, unknown>;
  onRenameDone?: () => void;
}

/**
 * Renders query results in an AG Grid with pagination, sorting, filtering,
 * and column rename. Shows an empty state when no rows match.
 * Right-clicking the column header "⋯" button opens a context menu for
 * overriding the column type (String/Number/Date/Boolean).
 *
 * Uses declarative <AgGridReact> — grid lifecycle is managed by React.
 */
export function ResultGrid({ result, onRenameDone }: ResultGridProps) {
  const gridRef = useRef<AgGridReact>(null);
  const [ctxMenu, setCtxMenu] = useState<{x: number; y: number; items: CtxMenuItem[]} | null>(null);

  const onTypeContextMenu = (e: MouseEvent, tid: string, col: string): void => {
    const state = getStore().getState();
    const currentType: ColumnType = state.columnTypeOverrides?.[tid]?.[col] ?? state.tables[tid]?.colTypes?.[col] ?? 'string';
    const items: CtxMenuItem[] = (['string', 'number', 'date', 'boolean'] as ColumnType[]).map(type => ({
      label: 'Type: ' + type.charAt(0).toUpperCase() + type.slice(1),
      checked: currentType === type,
      action: () => {
        getStore().update(draft => {
          if (!draft.columnTypeOverrides[tid]) draft.columnTypeOverrides[tid] = {} as Record<string, ColumnType>;
          draft.columnTypeOverrides[tid][col] = type;
        });
        invalidateValidation();
      },
    }));
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Compute grid data (rowData, columnDefs, band-specific options) via useMemo
  const gridData = useMemo(() => {
    const { rows, totalsRow, cols } = result as {
      rows: Record<string, unknown>[];
      totalsRow: Record<string, unknown> | null;
      cols: string[];
    };

    // Check for overlay band path
    const bandResult = (result as Record<string, unknown>).bandResult as BandResultSet | undefined;

    const hasData = bandResult
      ? bandResult.parentRows.length > 0
      : rows.length > 0 || totalsRow !== null;

    if (!hasData) {
      return { hasData: false, rowData: [], columnDefs: [] as ColDef[], getRowStyle: undefined,
        isFullWidthRow: undefined, fullWidthCellRenderer: undefined, embedFullWidthRows: undefined };
    }

    let tableData: Record<string, unknown>[];
    let colDefs: ColDef[];
    let bandStyler: (params: { data: Record<string, unknown> }) => Record<string, string> | undefined;
    let isFullWidthRow: ((params: { data: Record<string, unknown> }) => boolean) | undefined;
    let fullWidthCellRenderer: unknown;
    let embedFullWidthRows: boolean | undefined;

    if (bandResult) {
      // ── Overlay band path ───────────────────────────────────────────
      const detailBands = getStore().getState().detailBands;
      const descriptors = buildOverlayDescriptors(bandResult, detailBands);
      const bandColSets: Record<string, string[]> = {};
      for (const br of bandResult.bandResults) {
        bandColSets[br.band.id] = br.cols;
      }
      const gridRows = descriptorsToGridRows(descriptors, bandResult.parentCols, bandColSets);
      const supersetCols = [...bandResult.parentCols, ...bandResult.bandResults.flatMap(br => br.cols)];

      tableData = gridRows;
      colDefs = makeResultCols(supersetCols, onRenameDone, onTypeContextMenu);
      bandStyler = createBandRowStyler(gridRows);
      isFullWidthRow = (params: { data: Record<string, unknown> }) => params.data?._isBandHeader === true;
      fullWidthCellRenderer = BandHeaderRenderer;
      embedFullWidthRows = true;
    } else {
      // ── Standard (non-band) path ───────────────────────────────────
      tableData = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : rows;
      colDefs = makeResultCols(cols, onRenameDone, onTypeContextMenu);
      bandStyler = createBandRowStyler(rows);
    }

    return {
      hasData: true,
      rowData: tableData,
      columnDefs: colDefs,
      getRowStyle: (params: RowClassParams): RowStyle | undefined => bandStyler!(params as unknown as { data: Record<string, unknown> }),
      isFullWidthRow: isFullWidthRow as ((params: IsFullWidthRowParams) => boolean) | undefined,
      fullWidthCellRenderer,
      embedFullWidthRows,
    };
  }, [result, onRenameDone]);

  // onGridReady: store API ref and apply saved column state
  const onGridReady = useCallback((params: GridReadyEvent) => {
    _resultGridApi = params.api;
    const state = getStore().getState();
    if (state.colState) {
      params.api.applyColumnState({
        state: state.colState as unknown as ColumnState[],
        applyOrder: true,
      });
    }
  }, []);

  const hasData = gridData.hasData;

  if (!hasData) {
    return (
      <div className="empty">
        <div className="empty-icon">{'\u{1F50D}'}</div>
        <div>No rows matched your query</div>
      </div>
    );
  }

  return (
    <>
      <AgGridReact
        ref={gridRef}
        className="ag-theme-balham-dark"
        containerStyle={{ height: '100%', width: '100%' }}
        rowData={gridData.rowData}
        columnDefs={gridData.columnDefs}
        defaultColDef={DEFAULT_COL_DEF}
        headerHeight={90}
        pagination={true}
        paginationPageSize={500}
        paginationPageSizeSelector={[100, 250, 500, 1000, 5000]}
        multiSortKey="ctrl"
        onColumnMoved={() => _saveResultColState()}
        onColumnResized={() => _saveResultColState()}
        onColumnVisible={() => _saveResultColState()}
        onGridReady={onGridReady}
        getRowStyle={gridData.getRowStyle}
        isFullWidthRow={gridData.isFullWidthRow}
        fullWidthCellRenderer={gridData.fullWidthCellRenderer}
        embedFullWidthRows={gridData.embedFullWidthRows}
      />
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
    </>
  );
}

// ── Preview grid component ───────────────────────────────────────────────────

interface PreviewGridProps {
  tableId: string;
  onRenameDone?: () => void;
}

/**
 * Loads and renders a preview grid for the selected table with row exclusion
 * controls. Shows empty/error states via JSX.
 * Right-clicking the column header "⋯" button opens a context menu for
 * overriding the column type (String/Number/Date/Boolean).
 *
 * Uses declarative <AgGridReact> — grid lifecycle is managed by React.
 */
export function PreviewGrid({ tableId }: PreviewGridProps) {
  const gridRef = useRef<AgGridReact>(null);
  const [ctxMenu, setCtxMenu] = useState<{x: number; y: number; items: CtxMenuItem[]} | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  const state = getStore().getState();
  const table = tableId ? state.tables[tableId] : undefined;

  const showPreviewColumnMenu = useCallback((e: MouseEvent, col: string): void => {
    const st = getStore().getState();
    const currentType: ColumnType = st.columnTypeOverrides?.[tableId]?.[col] ?? st.tables[tableId]?.colTypes?.[col] ?? 'string';
    const items: CtxMenuItem[] = (['string', 'number', 'date', 'boolean'] as ColumnType[]).map(type => ({
      label: 'Type: ' + type.charAt(0).toUpperCase() + type.slice(1),
      checked: currentType === type,
      action: () => {
        getStore().update(draft => {
          if (!draft.columnTypeOverrides[tableId]) draft.columnTypeOverrides[tableId] = {} as Record<string, ColumnType>;
          draft.columnTypeOverrides[tableId][col] = type;
        });
        invalidateValidation();
      },
    }));
    items.push({ label: '', action: () => {}, separator: true });
    items.push({
      label: 'Rename',
      action: () => {
        const colMap = buildColSourceMap();
        for (const [alias, src] of colMap.entries()) {
          if (src && src.kind !== 'calc' && src.tid === tableId && src.col === col) {
            const target = resolveRenameTarget(alias);
            if (target) setRenameTarget(target);
            return;
          }
        }
      },
    });
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [tableId]);

  // Compute preview row data via useMemo (keyed on tableId)
  const previewRows = useMemo(() => {
    if (!tableId || !state.tables[tableId]) return null;
    const t = state.tables[tableId];
    const cap = 10000;
    try {
      return execQuery(`SELECT "_rowno", ${t.cols.map(c => quoteId(c)).join(', ')} FROM ${quoteId(tableId)} LIMIT ${cap}`);
    } catch {
      return null;
    }
  }, [tableId]);

  // Compute column definitions via useMemo
  const columnDefs = useMemo(() => {
    if (!tableId || !table) return [];
    const excludeColDef: ColDef = {
      headerName: '',
      field: '_rowno',
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      resizable: false,
      sortable: false,
      filter: false,
      floatingFilter: false,
      cellRenderer: (params: { value: number; data: Record<string, unknown> }) => {
        const rowno = params.value;
        const st = getStore().getState();
        const excludedSet = st.excludedRows[tableId] || new Set<number>();
        const isExcl = excludedSet.has(rowno);
        const btn = document.createElement('button');
        const rowData = params.data;
        const preview = table.cols
          .filter(c => c !== '_rowno')
          .map(c => rowData[c] == null ? '' : String(rowData[c]))
          .filter(v => v !== '')
          .slice(0, 6)
          .join(' \u00b7 ');
        const action = isExcl ? 'Restore row to reports' : 'Exclude row from reports';
        btn.title = `${action}\n\u2192 ${preview}`;
        btn.style.cssText = 'background:transparent;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1';
        btn.textContent = isExcl ? '\u{1F6AB}' : '\u2705';
        btn.addEventListener('click', () => {
          getStore().update(draft => {
            if (!draft.excludedRows[tableId]) draft.excludedRows[tableId] = new Set<number>();
            const set = draft.excludedRows[tableId];
            if (set.has(rowno)) set.delete(rowno); else set.add(rowno);
          });
          if (_previewGridApi) {
            _previewGridApi.refreshCells({ force: true });
            _previewGridApi.redrawRows();
          }
        });
        return btn;
      },
    };
    return [excludeColDef, ...makePreviewCols(tableId, table.cols, showPreviewColumnMenu)];
  }, [tableId, table, showPreviewColumnMenu]);

  // onGridReady: store API ref for external refresh and exclude-button cell refresh
  const onGridReady = useCallback((params: GridReadyEvent) => {
    _previewGridApi = params.api;
  }, []);

  // getRowStyle: strikethrough excluded rows
  const getRowStyle = useCallback((params: RowClassParams): RowStyle | undefined => {
    const rowno = params.data && (params.data as Record<string, unknown>)._rowno as number;
    const st = getStore().getState();
    const excludedSet = st.excludedRows[tableId] || new Set<number>();
    if (excludedSet.has(rowno)) {
      return {
        color: '#c0392b',
        textDecoration: 'line-through',
        background: 'rgba(220,50,50,0.08)',
      };
    }
    return undefined;
  }, [tableId]);

  // ── Early returns (after all hooks) ──────────────────────────────────────

  if (!tableId || !table) {
    return (
      <div className="empty">
        <div className="empty-icon">{'\u{1F446}'}</div>
        <div>Select a table above</div>
      </div>
    );
  }

  // Probe query to check table is queryable
  let probeError: string | null = null;
  try {
    execQuery(`SELECT "_rowno", ${table.cols.map(c => quoteId(c)).join(', ')} FROM ${quoteId(tableId)} LIMIT 1`);
  } catch (ex) {
    probeError = (ex as Error).message;
  }

  if (probeError) {
    return (
      <div className="empty">
        <div className="empty-icon">{'\u274C'}</div>
        <div>{probeError}</div>
      </div>
    );
  }

  if (!previewRows) {
    return (
      <div className="empty">
        <div className="empty-icon">{'\u274C'}</div>
        <div>Failed to load preview data</div>
      </div>
    );
  }

  const excluded = state.excludedRows[tableId] || new Set<number>();
  const excCount = excluded.size;
  const cap = 10000;

  return (
    <>
      {excCount > 0 && (
        <div style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(255,170,0,0.12)', borderBottom: '1px solid rgba(255,170,0,0.3)', color: '#c9a020', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{'\u26A0'} {excCount} row{excCount > 1 ? 's' : ''} excluded from reports</span>
          <button
            style={{ fontSize: '11px', padding: '1px 7px', borderRadius: '3px', border: '1px solid #c9a020', background: 'transparent', color: '#c9a020', cursor: 'pointer' }}
            onClick={() => {
              getStore().update(draft => { draft.excludedRows[tableId] = new Set<number>(); });
              if (_previewGridApi) {
                _previewGridApi.refreshCells({ force: true });
                _previewGridApi.redrawRows();
              }
            }}
          >
            Clear all
          </button>
        </div>
      )}
      <span style={{ fontSize: '0.76rem', color: 'var(--muted)', padding: '2px 4px' }}>
        {table.rowCount.toLocaleString()} rows \u00b7 {table.cols.length} cols
        {excCount ? ' \u00b7 ' + excCount + ' excluded' : ''}
        {table.rowCount > cap ? ' (preview: first ' + cap.toLocaleString() + ')' : ''}
      </span>
      <AgGridReact
        ref={gridRef}
        className="ag-theme-balham-dark"
        containerStyle={{ height: '100%', width: '100%' }}
        rowData={previewRows}
        columnDefs={columnDefs as ColDef[]}
        defaultColDef={DEFAULT_COL_DEF}
        headerHeight={90}
        pagination={true}
        paginationPageSize={200}
        paginationPageSizeSelector={[100, 200, 500, 1000]}
        multiSortKey="ctrl"
        getRowStyle={getRowStyle as (params: RowClassParams) => RowStyle | undefined}
        onGridReady={onGridReady}
      />
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
      {renameTarget && (
        <RenameModal
          target={renameTarget}
          onClose={() => setRenameTarget(null)}
          onDone={() => invalidateValidation()}
        />
      )}
    </>
  );
}

// ── Column header React component ─────────────────────────────────────────────

/**
 * Props for the ColumnHeader React component used as AG Grid headerComponent.
 * AG Grid merges headerComponentParams with its internal header params, so
 * this interface includes both custom props and the AG Grid params we use.
 */
export interface ColumnHeaderProps {
  /** Display label text */
  label: string;
  /** Table color for the left stripe (null = no stripe) */
  color: string | null;
  /** User-defined rename label (shown in tooltip) */
  renamed: string | undefined;
  /** Original physical column name (shown in tooltip) */
  origCol?: string | null;
  /** Callback for left-click on ⋯ button (rename or trigger menu) */
  onRename: (() => void) | null;
  /** Callback for × button click (clear rename) */
  onClear: (() => void) | null;
  /** Callback for right-click on ⋯ button (context menu) */
  onContextMenu: ((e: MouseEvent) => void) | null;
  /** Optional separate left-click handler for ⋯ (overrides onRename for left-click) */
  onMoreClick?: ((e: ReactMouseEvent) => void) | null;
  /** AG Grid sort callback — provided by grid via headerComponentParams merge */
  progressSort?: (multiSort?: boolean) => void;
}

/**
 * React functional component for AG Grid column headers.
 * Replaces the old imperative `_makeHeaderComponent` class factory.
 *
 * Renders a flex row with:
 * - A 3px color bar on the left (when color is provided)
 * - The column label text with text-overflow: ellipsis (click to sort)
 * - A "⋯" button for rename / context menu
 * - An "×" button for clearing rename
 *
 * Used as `headerComponent` in column definitions with custom props passed
 * via `headerComponentParams`. AG Grid merges its internal params (e.g.
 * progressSort) with the custom params before passing to this component.
 */
export function ColumnHeader(props: ColumnHeaderProps) {
  const { label, color, renamed, origCol, onRename, onClear, onContextMenu, onMoreClick, progressSort } = props;

  const handleLabelClick = (e: ReactMouseEvent): void => {
    if (progressSort) progressSort(e.shiftKey);
  };

  const handleMoreClick = (e: ReactMouseEvent): void => {
    e.stopPropagation();
    if (onMoreClick) {
      onMoreClick(e);
    } else if (onRename) {
      onRename();
    }
  };

  const handleMoreContextMenu = (e: ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (onContextMenu) onContextMenu(e.nativeEvent);
  };

  const handleClearClick = (e: ReactMouseEvent): void => {
    e.stopPropagation();
    if (onClear) onClear();
  };

  const showMore = !!(onMoreClick || onRename || onContextMenu);

  const tooltip = origCol
    ? (renamed ? `Original: ${origCol}` : origCol)
    : undefined;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '3px', width: '100%', overflow: 'hidden' }}>
      {color && (
        <Box
          sx={{
            width: 3,
            flexShrink: 0,
            alignSelf: 'stretch',
            background: color,
            borderRadius: '1px',
            mr: '2px',
          }}
        />
      )}
      <Typography
        noWrap
        sx={{
          flex: 1,
          minWidth: 0,
          cursor: 'pointer',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          lineHeight: 'inherit',
          color: 'inherit',
        }}
        onClick={handleLabelClick}
        title={tooltip}
      >
        {label}
      </Typography>
      {showMore && (
        <IconButton
          size="small"
          onClick={handleMoreClick}
          onContextMenu={handleMoreContextMenu}
          title="Rename column"
          sx={{
            padding: '0 2px',
            flexShrink: 0,
            color: '#aaa',
            fontSize: '13px',
            lineHeight: 1,
            '&:hover': { background: 'rgba(255,255,255,0.08)' },
          }}
        >
          {'\u22ef'}
        </IconButton>
      )}
      {onClear && (
        <IconButton
          size="small"
          onClick={handleClearClick}
          title={`Clear rename (original: ${origCol ?? ''})`}
          sx={{
            padding: '0 1px',
            flexShrink: 0,
            color: '#aaa',
            fontSize: '10px',
            lineHeight: 1,
            minWidth: 'auto',
            '&:hover': { background: 'rgba(255,255,255,0.08)' },
          }}
        >
          {'\u00d7'}
        </IconButton>
      )}
    </Box>
  );
}

// ── Column definitions ───────────────────────────────────────────────────────

/**
 * Creates AG Grid column definitions for result columns.
 * Includes color stripe, rename button, clear rename button,
 * and an optional onTypeContextMenu callback for column type overrides.
 */
function makeResultCols(cols: string[], onRenameDone?: () => void, onTypeContextMenu?: ((e: MouseEvent, tid: string, col: string) => void) | null): ColDef[] {
  const colMap = buildColSourceMap();
  const state = getStore().getState();
  const dataCols = cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id' && c !== '_isBandHeader');

  return dataCols.map(c => {
    const src = colMap.get(c);
    const dispLabel = _displayLabel(c, colMap);
    const srcPhys = src as { tid: string; col: string } | undefined;
    const renamed = (src && src.kind !== 'calc') ? state.columnLabels?.[srcPhys!.tid]?.[srcPhys!.col] : undefined;
    const color = src ? getTableColor(srcPhys?.tid || '') : null;

    const doRename = (): void => {
      const target = resolveRenameTarget(c);
      if (!target) return;
      if (onRenameDone) onRenameDone();
    };

    return {
      field: c,
      headerName: dispLabel,
      tooltipField: c,
      minWidth: 110,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
      resizable: true,
      headerComponent: ThreeRowHeader,
      headerComponentParams: {
        label: dispLabel,
        color,
        renamed,
        origCol: (src && src.kind !== 'calc') ? src.col : null,
        onRename: (src && src.kind !== 'calc') ? doRename : null,
        onClear: (src && src.kind !== 'calc' && renamed)
          ? () => {
              setColLabel(src.tid, src.col, src.col);
              if (onRenameDone) onRenameDone();
            }
          : null,
        onContextMenu: onTypeContextMenu && src && src.kind !== 'calc' ? (e: MouseEvent) => onTypeContextMenu(e, src.tid, src.col) : null,
      },
      cellRenderer: (params: { value: unknown }) => {
        const v = params.value;
        return v == null ? '' : String(v);
      },
    };
  });
}

/**
 * Creates AG Grid column definitions for preview columns.
 * Includes color stripe, rename button, clear rename button,
 * and an optional onTypeContextMenu callback for column type overrides.
 */
function makePreviewCols(tid: string, physCols: string[], onShowPreviewMenu?: ((e: MouseEvent, col: string) => void) | null): ColDef[] {
  const color = getTableColor(tid);
  const state = getStore().getState();

  return physCols.filter(c => c !== '_rowno').map(c => {
    const renamed = state.columnLabels?.[tid]?.[c];
    const label = renamed || c;

    const doClear = renamed
      ? () => {
          setColLabel(tid, c, c);
          invalidateValidation();
        }
      : null;

    const showMenu = onShowPreviewMenu ? (e: MouseEvent) => onShowPreviewMenu(e, c) : null;

    return {
      field: c,
      headerName: label,
      minWidth: 110,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
      resizable: true,
      headerComponent: ThreeRowHeader,
      headerComponentParams: {
        label,
        color,
        renamed,
        origCol: c,
        onRename: null,
        onClear: doClear,
        onContextMenu: showMenu ? (e: MouseEvent) => showMenu(e) : null,
        onMoreClick: showMenu ? (e: ReactMouseEvent) => showMenu(e.nativeEvent) : null,
      },
      cellRenderer: (params: { value: unknown }) => {
        const v = params.value;
        return v == null ? '' : String(v);
      },
    };
  });
}


