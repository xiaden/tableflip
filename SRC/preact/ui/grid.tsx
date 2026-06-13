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

import { useRef, useEffect } from 'preact/hooks';
import type { ColSourceEntry } from '../types';
import { getStore } from '../core/store';
import { tableShortName, colUserLabel, getTableColor, setColLabel } from '../core/utils';
import { buildColSourceMap } from '../catalog/column-catalog';
import { resolveRenameTarget } from './components/rename-modal';
import { execQuery, quoteId } from '../core/sqldb';

/**
 * Synchronous display label computation (avoids async colDisplayLabel).
 * For physical columns, formats as "TableName → ColumnLabel".
 * For calculated columns, returns the calc alias or falls back to the alias.
 */
function _displayLabel(alias: string, colMap: Map<string, ColSourceEntry>): string {
  const src = colMap.get(alias);
  if (!src) return alias;
  if (src.kind === 'calc') {
    const calc = getStore().getState().calcStages?.[src.idx];
    return (calc?.alias || '').trim() || alias;
  }
  return tableShortName(src.tid) + ' \u2192 ' + colUserLabel(src.tid, src.col);
}

// ── Band row styling ─────────────────────────────────────────────────────────

/**
 * Subtle tinted backgrounds for band rows on the dark AG Grid theme.
 * Each band gets a distinct hue; parent rows (null _band_id) are unstyled.
 */
const BAND_ROW_TINTS = [
  'rgba(148, 163, 184, 0.08)',  // slate
  'rgba(96, 165, 250, 0.08)',   // blue
  'rgba(74, 222, 128, 0.08)',   // green
  'rgba(251, 146, 60, 0.08)',   // orange
  'rgba(192, 132, 252, 0.08)',  // purple
];

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
 */
export function ResultGrid({ result, onRenameDone }: ResultGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const { rows, totalsRow, cols } = result as {
      rows: Record<string, unknown>[];
      totalsRow: Record<string, unknown> | null;
      cols: string[];
    };
    const hasData = rows.length > 0 || totalsRow !== null;

    if (gridResult) { gridResult.destroy(); gridResult = null; }

    if (!hasData) return;

    const tableData = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : rows;
    const colDefs = makeResultCols(cols, onRenameDone);
    const bandStyler = createBandRowStyler(rows);

    const options: Record<string, unknown> = {
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

    gridResult = agGrid.createGrid(el, options);

    requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));

    const state = getStore().getState();
    if (state.colState) {
      gridResult.applyColumnState(state.colState as unknown as Array<Record<string, unknown>>);
    }

    return () => { if (gridResult) { gridResult.destroy(); gridResult = null; } };
  }, [result, onRenameDone]);

  const { rows, totalsRow, cols } = result as {
    rows: Record<string, unknown>[];
    totalsRow: Record<string, unknown> | null;
    cols: string[];
  };
  const hasData = rows.length > 0 || totalsRow !== null;

  return (
    <>
      {hasData ? (
        <>
          <span class="results-count" style="font-size:0.76rem;color:var(--muted)">
            {totalsRow
              ? rows.length.toLocaleString() + ' rows + 1 totals row \u00b7 ' + cols.length + ' columns'
              : rows.length.toLocaleString() + ' rows \u00b7 ' + cols.length + ' columns'}
          </span>
          <div ref={gridRef} class="ag-theme-balham-dark" style="height:100%;width:100%" />
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
 */
export function PreviewGrid({ tableId, onRenameDone }: PreviewGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const state = getStore().getState();

    if (gridPreview) { gridPreview.destroy(); gridPreview = null; }

    if (!tableId || !state.tables[tableId]) return;

    const t = state.tables[tableId];
    const cap = 10000;
    const excluded = state.excludedRows[tableId] || new Set<number>();

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
        const isExcl = excluded.has(rowno);
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
        });
        return btn;
      },
    };

    gridPreview = agGrid.createGrid(el, {
      rowData: rows,
      columnDefs: [excludeColDef, ...makePreviewCols(tableId, t.cols, onRenameDone)],
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
        if (excluded.has(rowno)) {
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
  }, [tableId, onRenameDone]);

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
    </>
  );
}

// ── Column definitions ───────────────────────────────────────────────────────

/**
 * Creates AG Grid column definitions for result columns.
 * Includes color stripe, rename button, and clear rename button.
 */
function makeResultCols(cols: string[], onRenameDone?: () => void): Record<string, unknown>[] {
  const colMap = buildColSourceMap();
  const state = getStore().getState();
  const dataCols = cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id');

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
 * Includes color stripe, rename button, and clear rename button.
 */
function makePreviewCols(tid: string, physCols: string[], onRenameDone?: () => void): Record<string, unknown>[] {
  const color = getTableColor(tid);
  const state = getStore().getState();

  return physCols.filter(c => c !== '_rowno').map(c => {
    const renamed = state.columnLabels?.[tid]?.[c];
    const label = renamed || c;

    const doRename = (): void => {
      const colMap = buildColSourceMap();
      for (const [alias, src] of colMap.entries()) {
        if (src && src.kind !== 'calc' && src.tid === tid && src.col === c) {
          const target = resolveRenameTarget(alias);
          if (target && onRenameDone) onRenameDone();
          return;
        }
      }
    };

    const doClear = renamed
      ? () => {
          setColLabel(tid, c, c);
          if (onRenameDone) onRenameDone();
        }
      : null;

    return {
      field: c,
      headerName: label,
      minWidth: 110,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
      resizable: true,
      headerComponent: _makeHeaderComponent(label, color, renamed, c, doRename, doClear),
      cellRenderer: (params: { value: unknown }) => {
        const v = params.value;
        return v == null ? '' : String(v);
      },
    };
  });
}

/**
 * Creates an AG Grid header component class with color stripe and rename controls.
 */
function _makeHeaderComponent(
  label: string,
  color: string | null,
  renamed: string | undefined,
  origCol: string | null,
  onRename: (() => void) | null,
  onClear: (() => void) | null,
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

      if (onRename) {
        const more = document.createElement('button');
        more.textContent = '\u22ef';
        more.title = 'Rename column';
        more.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:0 2px;color:#aaa;flex-shrink:0;line-height:1';
        more.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); onRename(); });
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
