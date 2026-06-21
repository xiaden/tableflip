/**
 * Data Loader — ingests XLSX/CSV spreadsheets into SQLite via the reactive store.
 *
 * Ported from `SRC/js/ui/loader.ts`. Key differences:
 * - No DOM manipulation (overlay, modal, drag-drop, file input)
 * - No window assignments (confirmModal, closeModal)
 * - All state mutations go through `store.update()` instead of direct `db` mutation
 * - `loadState` receives `store` as a parameter
 */

import type { Store } from '../core/store';
import type { ColumnType } from '../types';
import { toast, stickyToast, stripExt, getTableColor } from '../core/utils';
import { loadState } from '../core/state-loader';
import { dropTable, createTable, insertRows, tableRowCount } from '../core/sqldb';
import { _afterCombineChange } from '../query/layout-selection';

/**
 * Expands merged cells in an XLSX worksheet so that every cell in a merge range
 * receives a copy of the source cell's value. Handles both dense and sparse sheet formats.
 * @param ws - The XLSX worksheet to expand merges in (mutated in place)
 */
function expandMerges(ws: XLSXSheet): void {
  const merges = ws['!merges'];
  if (!merges || !merges.length) return;

  const dense = Array.isArray(ws['!data']) ? ws['!data'] as unknown[][] : (Array.isArray(ws) ? ws : null);
  if (dense) {
    merges.forEach(({ s, e }) => {
      const srcCell = (dense[s.r] || [])[s.c];
      if (!srcCell) return;
      for (let r = s.r; r <= e.r; r++) {
        if (!dense[r]) dense[r] = [];
        for (let c = s.c; c <= e.c; c++) {
          if (r === s.r && c === s.c) continue;
          const tgt = dense[r][c];
          if (!tgt || (tgt as Record<string, unknown>).v == null || (tgt as Record<string, unknown>).t === 'z') {
            dense[r][c] = { ...(srcCell as Record<string, unknown>) };
          }
        }
      }
    });
    return;
  }

  merges.forEach(({ s, e }) => {
    const srcAddr = XLSX.utils.encode_cell({ r: s.r, c: s.c });
    const srcCell = ws[srcAddr] as Record<string, unknown> | undefined;
    if (!srcCell) return;
    for (let r = s.r; r <= e.r; r++) {
      for (let c = s.c; c <= e.c; c++) {
        if (r === s.r && c === s.c) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        const tgt = ws[addr] as Record<string, unknown> | undefined;
        if (!tgt || tgt.v == null || tgt.t === 'z') {
          ws[addr] = { ...srcCell };
        }
      }
    }
  });
}

/**
 * Returns true if the given Excel format string contains date/time patterns.
 * Checks for yyyy, yy, mm, dd, hh, ss (case-insensitive).
 *
 * @param z - The Excel format string to check
 * @returns True if the string contains date/time patterns
 */
function isDateFormat(z: string): boolean {
  return /yyyy|yy|mm|dd|hh|ss/i.test(z);
}

/**
 * Maps a SheetJS cell type code to the application's ColumnType.
 *
 * @param t - The SheetJS cell type code ('n', 's', 'd', 'b', or other)
 * @returns The corresponding ColumnType
 */
function sheetTypeToColumnType(t: string): ColumnType {
  switch (t) {
    case 'n': return 'number';
    case 's': return 'string';
    case 'd': return 'date';
    case 'b': return 'boolean';
    default:  return 'string';
  }
}

/**
 * Scans a dense XLSX worksheet to determine the majority cell type per column.
 *
 * Reads the header row (row 0) for column names, then iterates data rows (r >= 1)
 * counting cell.t values per column. The type with the highest count wins; ties
 * are broken by first-encountered type (insertion order). For majority-'n' columns,
 * a date-format override reclassifies as 'date' if >50% of numeric cells carry
 * date-like format strings (cell.z).
 *
 * Skips: _rowno column, cells with t === 'z' (stub), v == null (empty), t === 'e' (error).
 *
 * @param ws - The XLSX worksheet to scan
 * @returns A record mapping column names to their detected ColumnType
 */
export function scanCellTypes(ws: XLSXSheet): Record<string, ColumnType> {
  const dense: unknown[][] | null = Array.isArray(ws['!data'])
    ? ws['!data'] as unknown[][]
    : (Array.isArray(ws) ? ws : null);
  if (!dense) return {};

  // Row 0 = headers
  const headerRow = dense[0] as Record<string, unknown>[] | undefined;
  if (!headerRow || !headerRow.length) return {};

  // Build column-index → column-name map
  const colNames: string[] = [];
  for (let c = 0; c < headerRow.length; c++) {
    const cell = headerRow[c] as Record<string, unknown> | undefined;
    if (cell && cell.v != null) {
      colNames[c] = String(cell.v);
    }
  }

  // Per-column type counters (Map preserves insertion order for tie-breaking)
  const typeCounts: Map<number, Map<string, number>> = new Map();
  // Per-column format counters for numeric cells
  const fmtCounts: Map<number, Map<string, number>> = new Map();
  // Per-column total numeric cell count (for date-format override denominator)
  const numTotals: Map<number, number> = new Map();

  const VALID_TYPES = new Set(['n', 's', 'd', 'b']);

  for (let r = 1; r < dense.length; r++) {
    const row = dense[r] as Record<string, unknown>[] | undefined;
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c] as Record<string, unknown> | undefined;
      if (!cell) continue;
      if (cell.v == null) continue;
      const t = cell.t as string | undefined;
      if (!t || t === 'z' || t === 'e') continue;
      if (!VALID_TYPES.has(t)) continue;

      const colName = colNames[c];
      if (!colName || colName === '_rowno') continue;

      // Increment type counter
      if (!typeCounts.has(c)) typeCounts.set(c, new Map());
      const tc = typeCounts.get(c)!;
      tc.set(t, (tc.get(t) ?? 0) + 1);

      // Track format strings for numeric cells
      if (t === 'n') {
        numTotals.set(c, (numTotals.get(c) ?? 0) + 1);
        const z = cell.z as string | undefined;
        if (z) {
          if (!fmtCounts.has(c)) fmtCounts.set(c, new Map());
          const fc = fmtCounts.get(c)!;
          fc.set(z, (fc.get(z) ?? 0) + 1);
        }
      }
    }
  }

  // Determine majority type per column
  const result: Record<string, ColumnType> = {};
  for (const [c, tc] of typeCounts) {
    const colName = colNames[c];
    if (!colName || colName === '_rowno') continue;

    // Majority vote — first-encountered type wins ties (Map iteration = insertion order)
    let majorityType = '';
    let majorityCount = 0;
    for (const [t, count] of tc) {
      if (count > majorityCount) {
        majorityType = t;
        majorityCount = count;
      }
    }

    // Date-format override: if majority is 'n' and >50% of numeric cells have date-like formats
    if (majorityType === 'n') {
      const totalNum = numTotals.get(c) ?? 0;
      if (totalNum > 0) {
        let dateFmtCount = 0;
        const fc = fmtCounts.get(c);
        if (fc) {
          for (const [fmt, count] of fc) {
            if (isDateFormat(fmt)) {
              dateFmtCount += count;
            }
          }
        }
        if (dateFmtCount > totalNum / 2) {
          majorityType = 'd';
        }
      }
    }

    result[colName] = sheetTypeToColumnType(majorityType);
  }

  return result;
}

/**
 * Ingests a single worksheet from an XLSX workbook into SQLite and updates the store.
 *
 * Expands merged cells, scans cell types for column metadata, converts to JSON,
 * adds a `_rowno` column, creates the SQLite table, inserts all rows, detects
 * potential total/subtotal rows, collects column value samples, and updates the
 * reactive store with the new table metadata.
 *
 * @param wb - The XLSX workbook containing the sheet
 * @param sheetName - Name of the sheet to ingest
 * @param label - Human-readable label for the table (used for ID generation and display)
 * @param store - The reactive store instance
 */
export function ingestSheet(wb: XLSXWorkbook, sheetName: string, label: string, store: Store): void {
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) { toast('Empty sheet: ' + sheetName, 'err'); return; }

  expandMerges(ws);
  const colTypes = scanCellTypes(ws);

  let rawData: Record<string, unknown>[];
  try {
    rawData = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: false }) as Record<string, unknown>[];
  } catch (ex) { toast('Parse error: ' + (ex as Error).message, 'err'); return; }

  if (!rawData.length) { toast('No rows found in ' + sheetName, 'err'); return; }

  const _ROWNO = '_rowno';
  rawData.forEach((row: Record<string, unknown>, i: number) => { row[_ROWNO] = i + 1; });

  const cols    = Object.keys(rawData[0]).filter((c: string) => c !== _ROWNO);
  const allCols = [_ROWNO, ...cols];

  const id = 't_' + label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

  const state = store.getState();
  if (state.tables[id]) {
    dropTable(id);
    store.update(draft => { delete draft.excludedRows[id]; });
  }

  try {
    createTable(id, allCols);
    insertRows(id, allCols, rawData);
  } catch (ex) {
    dropTable(id);
    toast('DB insert error: ' + (ex as Error).message, 'err');
    return;
  }

  const TOTAL_RE = /^\s*(grand\s+)?total[s]?\s*[:：]?|subtotal[s]?\s*[:：]?/i;
  const suggested = new Set<number>();
  const suggestedPreviews = new Map<number, string>();
  for (const row of rawData) {
    for (const c of cols) {
      const v = row[c];
      if (v == null) continue;
      if (TOTAL_RE.test(String(v))) {
        suggested.add(row[_ROWNO] as number);
        const snippets = cols
          .map((col: string) => row[col])
          .filter((val: unknown) => val != null && String(val).trim() !== '')
          .slice(0, 5)
          .map((val: unknown) => String(val).trim());
        suggestedPreviews.set(row[_ROWNO] as number, snippets.join(' · '));
        break;
      }
    }
  }

  const samples: Record<string, string[]> = {};
  for (const col of cols) {
    const seen = new Set<string>();
    const vals: string[] = [];
    for (const row of rawData) {
      const v = row[col];
      if (v == null) continue;
      const s = String(v).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      vals.push(s);
      if (vals.length >= 3) break;
    }
    samples[col] = vals;
  }

  rawData = null as unknown as Record<string, unknown>[];

  const rowCount = tableRowCount(id);
  const color = getTableColor(id);

  store.update(draft => {
    draft.excludedRows[id] = new Set<number>();
    draft.tables[id] = { id, name: label, cols, rowCount, samples, ...(Object.keys(colTypes).length ? { colTypes } : {}) };
    draft.tableColors[id] = color;
  });
  _afterCombineChange();

  if (suggested.size) {
    const previews = [...suggestedPreviews.values()];
    const previewStr = previews.length === 1
      ? `"${previews[0]}"`
      : previews.map((p: string) => `"${p}"`).join(', ');
    const noun = suggested.size === 1 ? 'row' : 'rows';
    const btnLabel = suggested.size === 1 ? 'Exclude it' : 'Exclude them';
    stickyToast(
      `"${label}": ${suggested.size} ${noun} may be a totals ${noun}\nRow contents → ${previewStr}`,
      'warn',
      () => {
        store.update(draft => { draft.excludedRows[id] = new Set(suggested); });
      },
      btnLabel
    );
  }
}

/**
 * Ingests specific sheets from an XLSX workbook into the store.
 *
 * For now, ingests all provided sheets sequentially. The UI layer's sheet selector
 * modal calls this after the user confirms their selection.
 *
 * @param wb - The XLSX workbook containing the sheets
 * @param sheetNames - Array of sheet names to ingest
 * @param store - The reactive store instance
 */
export function loadSheets(wb: XLSXWorkbook, sheetNames: string[], store: Store): void {
  for (const name of sheetNames) {
    ingestSheet(wb, name, name, store);
  }
}

/**
 * Loads a spreadsheet file (XLSX, XLS, CSV) or report configuration (.rcjson) into the store.
 *
 * - For `.rcjson` files, delegates to `loadState()`.
 * - For `.csv` files, reads as text and ingests the first sheet.
 * - For `.xlsx`/`.xls` files, reads as ArrayBuffer. If the workbook has a single usable sheet,
 *   ingests directly. If multiple, calls `loadSheets()` with all usable sheets.
 *
 * @param file - The file to load
 * @param store - The reactive store instance
 */
export async function loadSpreadsheet(file: File, store: Store): Promise<void> {
  const ext = file.name.split('.').pop()!.toLowerCase();

  if (ext === 'rcjson') {
    await loadState(file, store);
    return;
  }

  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    toast(`Unsupported file type ".${ext}" — drop xlsx, xls, csv, or rcjson files.`, 'err');
    return;
  }

  if (ext === 'csv') {
    const text = await file.text();
    try {
      const wb = XLSX.read(text, { type: 'string', dense: true });
      ingestSheet(wb, wb.SheetNames[0], stripExt(file.name), store);
    } catch (ex) { toast('Could not parse ' + file.name + ': ' + (ex as Error).message, 'err'); }
    return;
  }

  // XLSX / XLS
  const buffer = await file.arrayBuffer();
  try {
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dense: true });
    const usable = wb.SheetNames.filter((n: string) => wb.Sheets[n] && wb.Sheets[n]['!ref']);
    if (!usable.length) { toast('No data found in ' + file.name, 'err'); return; }
    if (usable.length === 1) {
      ingestSheet(wb, usable[0], stripExt(file.name), store);
    } else {
      loadSheets(wb, usable, store);
    }
  } catch (ex) { toast('Could not parse ' + file.name + ': ' + (ex as Error).message, 'err'); }
}
