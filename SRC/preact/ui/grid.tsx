/**
 * AG Grid integration — result grid, preview grid, column definitions.
 *
 * Provides Preact components that manage AG Grid lifecycle via refs and
 * effects. All rendering is done through JSX — no innerHTML.
 *
 * Ported from `SRC/js/ui/grid.ts`. Key differences:
 * - No window assignments (renderResults, loadPreview, clearExclusions)
 * - State mutations go through store.update() instead of direct db mutation
 * - Column rename uses Preact RenameModal rendered via createPortal
 * - No import from SRC/js/ — uses preact catalog and utils
 */

import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import type { ColSourceEntry, ColumnType, OverlayDescriptor, BandResultSet } from '../types';
import { getStore } from '../core/store';
import { colLabel, getTableColor, setColLabel } from '../core/utils';
import { buildColSourceMap } from '../catalog/column-catalog';
import { resolveRenameTarget, RenameModal, type RenameTarget } from './components/rename-modal';
import { execQuery, quoteId } from '../core/sqldb';
import { invalidateValidation } from '../report/validation';
import { ContextMenu, type CtxMenuItem } from './components/context-menu';
import { buildOverlayDescriptors } from '../report/overlay-grouping';

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

// ── Grid instance tracking ───────────────────────────────────────────────────

let gridResult: AGridApi | null = null;
let gridPreview: AGridApi | null = null;

/**
 * Refreshes the result grid layout (row heights, cells, redraw).
 * Call after the grid container becomes visible or resizes.
 */
export function refreshResultGridLayout(): void {
  if (!gridResult) return;
  try { (gridResult as unknown as Record<string, () => void>).resetRowHeights?.(); } catch { /* ignore */ }
  try { gridResult.refreshCells?.({ force: true }); } catch { /* ignore */ }
  try { (gridResult as unknown as Record<string, () => void>).redrawRows?.(); } catch { /* ignore */ }
}

/**
 * Refreshes the preview grid layout (row heights, cells, redraw).
 * Call after the grid container becomes visible or resizes.
 */
export function refreshPreviewGridLayout(): void {
  if (!gridPreview) return;
  try { (gridPreview as unknown as Record<string, () => void>).resetRowHeights?.(); } catch { /* ignore */ }
  try { gridPreview.refreshCells?.({ force: true }); } catch { /* ignore */ }
  try { (gridPreview as unknown as Record<string, () => void>).redrawRows?.(); } catch { /* ignore */ }
}

function _saveResultColState(): void {
  if (gridResult) {
    const colState = gridResult.getColumnState() as unknown as Record<string, unknown> | null;
    getStore().update(draft => { draft.colState = colState; });
  }
}

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
 */
export function ResultGrid({ result, onRenameDone }: ResultGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

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

    if (gridResult) { gridResult.destroy(); gridResult = null; }

    if (!hasData) return;

    let tableData: Record<string, unknown>[];
    let colDefs: Record<string, unknown>[];
    let bandStyler: (params: { data: Record<string, unknown> }) => Record<string, string> | undefined;
    let options: Record<string, unknown>;

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

      options = {
        rowData: tableData,
        columnDefs: colDefs,
        defaultColDef: {
          sortable: true,
          resizable: true,
          filter: true,
          floatingFilter: true,
          minWidth: 80,
          cellRenderer: (params: { value: unknown }) => {
            const v = params.value;
            return v == null ? '' : String(v);
          },
        },
        isFullWidthRow: (params: { data: Record<string, unknown> }) => params.data?._isBandHeader === true,
        fullWidthCellRenderer: BandHeaderRenderer,
        embedFullWidthRows: true,
        getRowStyle: (params: { data: Record<string, unknown> }) => bandStyler(params),
        pagination: true,
        paginationPageSize: 500,
        paginationPageSizeSelector: [100, 250, 500, 1000, 5000],
        multiSortKey: 'ctrl',
        onColumnMoved: () => _saveResultColState(),
        onColumnResized: () => _saveResultColState(),
        onColumnVisible: () => _saveResultColState(),
      };
    } else {
      // ── Standard (non-band) path ───────────────────────────────────
      tableData = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : rows;
      colDefs = makeResultCols(cols, onRenameDone, onTypeContextMenu);
      bandStyler = createBandRowStyler(rows);

      options = {
        rowData: tableData,
        columnDefs: colDefs,
        defaultColDef: {
          sortable: true,
          resizable: true,
          filter: true,
          floatingFilter: true,
          minWidth: 80,
          cellRenderer: (params: { value: unknown }) => {
            const v = params.value;
            return v == null ? '' : String(v);
          },
        },
        getRowStyle: (params: { data: Record<string, unknown> }) => bandStyler(params),
        pagination: true,
        paginationPageSize: 500,
        paginationPageSizeSelector: [100, 250, 500, 1000, 5000],
        multiSortKey: 'ctrl',
        onColumnMoved: () => _saveResultColState(),
        onColumnResized: () => _saveResultColState(),
        onColumnVisible: () => _saveResultColState(),
      };
    }

    gridResult = agGrid.createGrid(el, options);

    requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));

    const state = getStore().getState();
    if (state.colState) {
      gridResult.applyColumnState(state.colState as unknown as Array<Record<string, unknown>>);
    }

    return () => { if (gridResult) { gridResult.destroy(); gridResult = null; } };
  }, [result, onRenameDone]);

  const resultRows = (result as Record<string, unknown>).rows as Record<string, unknown>[];
  const resultTotalsRow = (result as Record<string, unknown>).totalsRow as Record<string, unknown> | null;
  const resultCols = (result as Record<string, unknown>).cols as string[];
  const bandResult = (result as Record<string, unknown>).bandResult as BandResultSet | undefined;

  // For display count: when bands active, show parent rows + superset columns
  const displayRows = bandResult ? bandResult.parentRows : resultRows;
  const hasTotalsRow = resultTotalsRow !== null;
  // Compute superset column count for band path
  const displayCols = bandResult
    ? [...bandResult.parentCols, ...bandResult.bandResults.flatMap(br => br.cols)]
    : resultCols;
  const hasData = displayRows.length > 0 || hasTotalsRow;

  return (
    <>
      {hasData ? (
        <>
          <span class="results-count" style="font-size:0.76rem;color:var(--muted)">
            {hasTotalsRow
              ? displayRows.length.toLocaleString() + ' rows + 1 totals row \u00b7 ' + displayCols.length + ' columns'
              : displayRows.length.toLocaleString() + ' rows \u00b7 ' + displayCols.length + ' columns'}
          </span>
          <div ref={gridRef} class="ag-theme-balham-dark" style="height:100%;width:100%" />
          {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
        </>
      ) : (
        <div class="empty">
          <div class="empty-icon">{'\u{1F50D}'}</div>
          <div>No rows matched your query</div>
        </div>
      )}
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
 */
export function PreviewGrid({ tableId }: PreviewGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{x: number; y: number; items: CtxMenuItem[]} | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  const showPreviewColumnMenu = useCallback((e: MouseEvent, col: string): void => {
    const state = getStore().getState();
    const currentType: ColumnType = state.columnTypeOverrides?.[tableId]?.[col] ?? state.tables[tableId]?.colTypes?.[col] ?? 'string';
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

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const state = getStore().getState();

    if (gridPreview) { gridPreview.destroy(); gridPreview = null; }

    if (!tableId || !state.tables[tableId]) return;

    const t = state.tables[tableId];
    const cap = 10000;

    let rows: Record<string, unknown>[];
    try {
      rows = execQuery(`SELECT "_rowno", ${t.cols.map(c => quoteId(c)).join(', ')} FROM ${quoteId(tableId)} LIMIT ${cap}`);
    } catch {
      return;
    }

    const excludeColDef: Record<string, unknown> = {
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
        const preview = t.cols
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
          if (gridPreview) {
            gridPreview.refreshCells({ force: true });
            (gridPreview as unknown as Record<string, () => void>).redrawRows?.();
          }
        });
        return btn;
      },
    };

    gridPreview = agGrid.createGrid(el, {
      rowData: rows,
      columnDefs: [excludeColDef, ...makePreviewCols(tableId, t.cols, showPreviewColumnMenu)],
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
        floatingFilter: true,
        minWidth: 80,
        cellRenderer: (params: { value: unknown }) => {
          const v = params.value;
          return v == null ? '' : String(v);
        },
      },
      pagination: true,
      paginationPageSize: 200,
      paginationPageSizeSelector: [100, 200, 500, 1000],
      multiSortKey: 'ctrl',
      getRowStyle: (params: { data: Record<string, unknown> }) => {
        const rowno = params.data && params.data._rowno as number;
        const st = getStore().getState();
        const excludedSet = st.excludedRows[tableId] || new Set<number>();
        if (excludedSet.has(rowno)) {
          return {
            color: '#c0392b',
            textDecoration: 'line-through',
            background: 'rgba(220,50,50,0.08)',
          };
        }
      },
    } as Record<string, unknown>);

    requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));

    return () => { if (gridPreview) { gridPreview.destroy(); gridPreview = null; } };
  }, [tableId, showPreviewColumnMenu]);

  const state = getStore().getState();

  if (!tableId || !state.tables[tableId]) {
    return (
      <div class="empty">
        <div class="empty-icon">{'\u{1F446}'}</div>
        <div>Select a table above</div>
      </div>
    );
  }

  try {
    const t = state.tables[tableId];
    execQuery(`SELECT "_rowno", ${t.cols.map(c => quoteId(c)).join(', ')} FROM ${quoteId(tableId)} LIMIT 1`);
  } catch (ex) {
    return (
      <div class="empty">
        <div class="empty-icon">{'\u274C'}</div>
        <div>{(ex as Error).message}</div>
      </div>
    );
  }

  const t = state.tables[tableId];
  const excluded = state.excludedRows[tableId] || new Set<number>();
  const excCount = excluded.size;
  const cap = 10000;

  return (
    <>
      {excCount > 0 && (
        <div style="padding:4px 10px;font-size:12px;background:rgba(255,170,0,0.12);border-bottom:1px solid rgba(255,170,0,0.3);color:#c9a020;display:flex;align-items:center;gap:8px;">
          <span>{'\u26A0'} {excCount} row{excCount > 1 ? 's' : ''} excluded from reports</span>
          <button
            style="font-size:11px;padding:1px 7px;border-radius:3px;border:1px solid #c9a020;background:transparent;color:#c9a020;cursor:pointer"
            onClick={() => {
              getStore().update(draft => { draft.excludedRows[tableId] = new Set<number>(); });
              if (gridPreview) {
                gridPreview.refreshCells({ force: true });
                (gridPreview as unknown as Record<string, () => void>).redrawRows?.();
              }
            }}
          >
            Clear all
          </button>
        </div>
      )}
      <span style="font-size:0.76rem;color:var(--muted);padding:2px 4px">
        {t.rowCount.toLocaleString()} rows \u00b7 {t.cols.length} cols
        {excCount ? ' \u00b7 ' + excCount + ' excluded' : ''}
        {t.rowCount > cap ? ' (preview: first ' + cap.toLocaleString() + ')' : ''}
      </span>
      <div ref={gridRef} class="ag-theme-balham-dark" style="height:100%;width:100%" />
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

// ── Column definitions ───────────────────────────────────────────────────────

/**
 * Creates AG Grid column definitions for result columns.
 * Includes color stripe, rename button, clear rename button,
 * and an optional onTypeContextMenu callback for column type overrides.
 */
function makeResultCols(cols: string[], onRenameDone?: () => void, onTypeContextMenu?: ((e: MouseEvent, tid: string, col: string) => void) | null): Record<string, unknown>[] {
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
      headerComponent: _makeHeaderComponent(
        dispLabel,
        color,
        renamed,
        (src && src.kind !== 'calc') ? src.col : null,
        doRename,
        (src && src.kind !== 'calc' && renamed)
          ? () => {
              setColLabel(src.tid, src.col, src.col);
              if (onRenameDone) onRenameDone();
            }
          : null,
        onTypeContextMenu && src && src.kind !== 'calc' ? (e: MouseEvent) => onTypeContextMenu(e, src.tid, src.col) : null,
      ),
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
function makePreviewCols(tid: string, physCols: string[], onShowPreviewMenu?: ((e: MouseEvent, col: string) => void) | null): Record<string, unknown>[] {
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
      headerComponent: _makeHeaderComponent(label, color, renamed, c, null, doClear, null, showMenu),
      cellRenderer: (params: { value: unknown }) => {
        const v = params.value;
        return v == null ? '' : String(v);
      },
    };
  });
}

/**
 * Creates an AG Grid header component class with color stripe, rename controls,
 * and an optional context menu trigger on the "⋯" button.
 */
function _makeHeaderComponent(
  label: string,
  color: string | null,
  renamed: string | undefined,
  origCol: string | null,
  onRename: (() => void) | null,
  onClear: (() => void) | null,
  onContextMenu: ((e: MouseEvent) => void) | null = null,
  onShowMenu: ((e: MouseEvent) => void) | null = null,
): unknown {
  return class {
    _params!: Record<string, unknown>;
    _gui!: HTMLElement;

    init(params: Record<string, unknown>): void {
      this._params = params;
      this._gui = document.createElement('div');
      this._gui.style.cssText = 'display:flex;align-items:center;gap:3px;width:100%;overflow:hidden';

      if (color) {
        const stripe = document.createElement('span');
        stripe.style.cssText = `width:3px;flex-shrink:0;align-self:stretch;background:${color};border-radius:1px;margin-right:2px`;
        this._gui.appendChild(stripe);
      }

      const txt = document.createElement('span');
      txt.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer';
      txt.textContent = label;
      if (origCol) txt.title = renamed ? `Original: ${origCol}` : origCol;
      txt.addEventListener('click', (e: MouseEvent) => (params.progressSort as (shift: boolean) => void)(e.shiftKey));
      this._gui.appendChild(txt);

      if (onShowMenu || onRename || onContextMenu) {
        const more = document.createElement('button');
        more.textContent = '\u22ef';
        more.title = 'Rename column';
        more.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:0 2px;color:#aaa;flex-shrink:0;line-height:1';
        more.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          if (onShowMenu) onShowMenu(e);
          else if (onRename) onRename();
        });
        more.addEventListener('contextmenu', (e: MouseEvent) => {
          e.preventDefault(); e.stopPropagation();
          if (onShowMenu) onShowMenu(e);
          else if (onContextMenu) onContextMenu(e);
        });
        this._gui.appendChild(more);
      }

      if (onClear) {
        const clr = document.createElement('button');
        clr.textContent = '\u00d7';
        clr.title = `Clear rename (original: ${origCol})`;
        clr.style.cssText = 'background:none;border:none;cursor:pointer;font-size:10px;padding:0 1px;color:#aaa;flex-shrink:0;line-height:1';
        clr.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); onClear(); });
        this._gui.appendChild(clr);
      }
    }

    getGui(): HTMLElement { return this._gui; }
    destroy(): void {}
    refresh(): boolean { return false; }
  };
}
