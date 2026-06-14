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
import { toast, stickyToast, stripExt, getTableColor } from '../core/utils';
import { loadState } from '../core/state-loader';
import { dropTable, createTable, insertRows, tableRowCount } from '../core/sqldb';

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
 * Ingests a single worksheet from an XLSX workbook into SQLite and updates the store.
 *
 * Expands merged cells, converts to JSON, adds a `_rowno` column, creates the
 * SQLite table, inserts all rows, detects potential total/subtotal rows, collects
 * column value samples, and updates the reactive store with the new table metadata.
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
    draft.tables[id] = { id, name: label, cols, rowCount, samples };
    draft.tableColors[id] = color;
    if (!draft.base) draft.base = id;
  });

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
