/**
 * Export logic — exports result data as XLSX or CSV.
 *
 * Ported from `SRC/js/ui/export.ts`. Key differences:
 * - No window assignment (exportAs)
 * - State reads from store instead of db global
 * - Uses preact utils for toast/dl
 * - Uses preact catalog for colSourceMap
 * - Uses preact validation for report status check
 */

import { getStore } from '../core/store';
import { buildExportHeaderMap, toast, dl } from '../core/utils';
import { buildColSourceMap } from '../catalog/column-catalog';
import { getValidation } from '../report/validation';
import type { DetailBandSpec, DbTable } from '../types';

// ── Pure helpers (extracted for testability) ─────────────────────────────────

/**
 * Internal columns filtered from XLSX export output.
 * Note: _band_id is filtered for XLSX (section headers provide visual grouping)
 * but kept for CSV (downstream consumers use it for grouping).
 */
const XLSX_INTERNAL_COLS = new Set([
  '_rowno', '_row_type', '_isTotalsRow', '_band_id', '_sort_row_type',
]);

/**
 * Internal columns filtered from CSV export output.
 * _band_id is intentionally NOT filtered — it provides grouping information
 * for downstream consumers.
 */
const CSV_INTERNAL_COLS = new Set([
  '_rowno', '_row_type', '_isTotalsRow', '_sort_row_type',
]);

/**
 * Filter internal/system columns from the export column list.
 * Also filters _sort_group_* columns by prefix.
 * @param cols - Column names to filter
 * @param isCsv - When true, _band_id is kept (CSV export); when false/omitted, _band_id is filtered (XLSX export)
 */
export function filterExportCols(cols: string[], isCsv = false): string[] {
  const internalCols = isCsv ? CSV_INTERNAL_COLS : XLSX_INTERNAL_COLS;
  return cols.filter(c =>
    !internalCols.has(c) && !String(c).startsWith('_sort_group_')
  );
}

/**
 * Build a band ID → display label map from detail band specs and table metadata.
 * Resolution order: band.label → table name → band.id
 */
export function buildBandLabels(
  detailBands: DetailBandSpec[] | undefined,
  tables: Record<string, DbTable> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const band of (detailBands || [])) {
    result[band.id] = band.label || tables?.[band.rightId]?.name || band.id;
  }
  return result;
}

/**
 * Subtle background tints for band data rows.
 * Alternating colors visually group band rows under their parent row.
 * Parent rows (_band_id = null) retain default detail row styling.
 */
const BAND_TINT_PALETTE = [
  'FFF8FAFC',  // slate-50
  'FFEFF6FF',  // blue-50
  'FFF0FDF4',  // green-50
  'FFFFF7ED',  // orange-50
  'FFFDF4FF',  // purple-50
];

/**
 * Insert band section header rows when _band_id transitions and compute rowKinds.
 * Returns enriched rows and the parallel rowKinds array.
 * For CSV format (isCsv=true), no headers are inserted.
 *
 * @param dataRows - Raw result rows (each may carry a `_band_id` field).
 * @param exportCols - Ordered column names to include in the export.
 * @param bandLabels - Map from band ID to human-readable label for band header rows.
 * @param isCsv - When true, skip header insertion (CSV has no row-kind styling).
 */
export function enrichRowsWithBandHeaders(
  dataRows: Record<string, unknown>[],
  exportCols: string[],
  bandLabels: Record<string, string>,
  isCsv: boolean,
): { enrichedRows: Record<string, unknown>[]; rowKinds: number[] } {
  let enrichedRows: Record<string, unknown>[];
  if (!isCsv) {
    enrichedRows = [];
    let prevBandId: unknown = undefined;
    for (const row of dataRows) {
      const bandId = row._band_id;
      if (bandId != null && bandId !== prevBandId) {
        const headerRow: Record<string, unknown> & { _isBandHeader: true } = { _isBandHeader: true };
        for (const c of exportCols) {
          headerRow[c] = '';
        }
        headerRow[exportCols[0]] = bandLabels[String(bandId)] || String(bandId);
        enrichedRows.push(headerRow);
      }
      enrichedRows.push(row);
      prevBandId = bandId;
    }
  } else {
    enrichedRows = dataRows;
  }

  const rowKinds = enrichedRows.map(r => {
    if (r._isBandHeader) return 4;
    if (r._isTotalsRow) return 3;
    const t = Number(r._row_type);
    return Number.isFinite(t) ? t : 0;
  });

  return { enrichedRows, rowKinds };
}

/**
 * Exports the current result set as XLSX or CSV.
 * Validates the report before export and applies merge/styling for XLSX.
 * @param fmt - Export format: 'xlsx' or 'csv'
 */
export async function exportAs(fmt: string): Promise<void> {
  const state = getStore().getState();
  if (!state.result || !(state.result as Record<string, unknown>).rows) return;

  const v = getValidation();
  if (v && v.reportStatus === 'blocked') {
    const blockingItems = Object.values(v.items).filter(item => item.blocking);
    const firstMsg = (blockingItems[0] as { issues?: Array<{ message: string }> } | undefined)?.issues?.[0]?.message || 'missing source data';
    toast(`Can't export — fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ''}).`, 'err');
    return;
  }

  const ts = new Date().toISOString().slice(0, 10);
  const fn = 'report-' + ts;

  const result = state.result as {
    rows: Record<string, unknown>[];
    totalsRow?: Record<string, unknown> | null;
    cols?: string[];
  };
  const { rows, totalsRow, cols } = result;
  const colMap = buildColSourceMap();
  const hdrMap = await buildExportHeaderMap(cols || [], colMap);

  const isCsv = fmt === 'csv';
  const exportCols = filterExportCols(cols || [], isCsv);
  const exportHeaders = exportCols.map(c => hdrMap?.[c] || c);
  const mergeHeaderSet = new Set(
    exportCols
      .filter(c => (state.mergedCols || []).includes(c))
      .map(c => hdrMap?.[c] || c)
  );

  const remap = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const c of exportCols) {
      const header = hdrMap?.[c];
      out[header || c] = row[c];
    }
    return out;
  };

  const dataRows = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : [...rows];

  // Build band label lookup and insert section header rows (XLSX only)
  const bandLabels = buildBandLabels(state.detailBands, state.tables);
  const { enrichedRows, rowKinds } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, isCsv);
  const clean = enrichedRows.map(remap);

  if (isCsv) {
    const ws = XLSX.utils.json_to_sheet(clean, { header: exportHeaders, skipHeader: false });
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    dl(blob, fn + '.csv');
  } else {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(clean, { header: exportHeaders, skipHeader: false });
    applyExportMerges(ws, clean, rowKinds, exportHeaders, mergeHeaderSet);
    const bandIds = enrichedRows.map(r => r._band_id != null ? String(r._band_id) : '');
    styleExportSheet(ws, clean, rowKinds, mergeHeaderSet, bandIds);
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    XLSX.writeFile(wb, fn + '.xlsx');
  }
  toast('Exported ' + clean.length.toLocaleString() + ' rows as ' + fmt.toUpperCase(), 'ok');
}

// ── Merge logic ──────────────────────────────────────────────────────────────

/**
 * Applies merge ranges to the export worksheet for merged columns.
 * Merges cells with the same value in consecutive rows.
 */
function applyExportMerges(
  ws: XLSXSheet,
  cleanRows: Record<string, unknown>[],
  rowKinds: number[],
  headers: string[],
  mergeHeaderSet: Set<string>,
): void {
  if (!ws || !Array.isArray(cleanRows) || !cleanRows.length) return;
  if (!headers || !headers.length || !mergeHeaderSet || mergeHeaderSet.size === 0) return;

  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];

  headers.forEach((h, cIdx) => {
    if (!mergeHeaderSet.has(h)) return;

    const leftGateHeaders = headers.slice(0, cIdx).filter(lh => mergeHeaderSet.has(lh));
    const gateByLeft = leftGateHeaders.length > 0;

    let i = 0;
    while (i < cleanRows.length) {
      if ((rowKinds[i] ?? 0) !== 0) { i++; continue; }

      const v = cleanRows[i]?.[h];
      if (v == null || String(v) === '') { i++; continue; }

      let j = i + 1;
      while (
        j < cleanRows.length &&
        (rowKinds[j] ?? 0) === 0 &&
        cleanRows[j]?.[h] === v
      ) {
        if (gateByLeft && leftGateHeaders.some(lh => cleanRows[j]?.[lh] !== cleanRows[j - 1]?.[lh])) {
          break;
        }
        j++;
      }

      const span = j - i;
      if (span > 1) {
        const s = { r: i + 1, c: cIdx };
        const e = { r: j, c: cIdx };
        merges.push({ s, e });

        for (let rr = s.r + 1; rr <= e.r; rr++) {
          const addr = XLSX.utils.encode_cell({ r: rr, c: cIdx });
          ws[addr] = { t: 'z', v: undefined };
        }
      }

      i = j;
    }
  });

  if (merges.length) ws['!merges'] = merges;
}

// ── Styling ──────────────────────────────────────────────────────────────────

/**
 * Applies professional styling to the export worksheet.
 * Includes header styling, row-type–based fill, borders, column widths, and freeze panes.
 *
 * Row-kind handling:
 *  - kind 4 (band header): bold italic blue text on blue-100 background, full-width underline.
 *  - Other data rows with a matching band index receive a subtle tint from
 *    BAND_TINT_PALETTE (cycling by band position) to visually group child rows.
 *
 * @param ws - The worksheet to style.
 * @param cleanRows - Data rows (after enrichment) used to derive cell types and band IDs.
 * @param rowKinds - Parallel array of row-kind codes (0=detail, 1=subtotal, 2=spacer, 3=grand, 4=band header).
 * @param mergeHeaderSet - Set of "row:col" keys identifying merged-cell anchors for underline styling.
 * @param bandIds - Ordered band-ID list used to resolve each row's band index for tint selection.
 */
export function styleExportSheet(
  ws: XLSXSheet,
  cleanRows: Record<string, unknown>[],
  rowKinds: number[],
  mergeHeaderSet: Set<string> = new Set(),
  bandIds?: string[],
): void {
  const ref = ws['!ref'];
  if (!ref) return;

  const range = XLSX.utils.decode_range(ref);
  const borderColor = { rgb: 'FF6B7280' };
  const grandBorderColor = { rgb: 'FF4B5563' };
  const fontBase = { name: 'Aptos', sz: 11, color: { rgb: 'FF111827' } };
  const MIN_COL_WCH = 10;
  const MAX_COL_WCH = 40;
  const WIDTH_SAMPLE_ROWS = 300;
  const BODY_ROW_HPT = 18;

  const headers = cleanRows[0] ? Object.keys(cleanRows[0]) : [];
  const mergeStartSet = new Set((ws['!merges'] || []).map((m: { s: { r: number; c: number } }) => `${m.s.r}:${m.s.c}`));
  const state = getStore().getState();
  const underlineMergedGroups = !!state?.mergeGroupUnderline;
  const mergeUnderlineStartByRow = new Map<number, number>();

  if (underlineMergedGroups) {
    const mergeParticipation = new Map<string, Set<number>>();
    const addUnderline = (bodyRowIdx: number, colIdx: number): void => {
      const sheetRow = bodyRowIdx + 1;
      if (sheetRow < 1) return;
      const prev = mergeUnderlineStartByRow.get(sheetRow);
      mergeUnderlineStartByRow.set(sheetRow, prev == null ? colIdx : Math.min(prev, colIdx));
    };

    headers.forEach((h, cIdx) => {
      if (!mergeHeaderSet.has(h)) return;

      const leftGateHeaders = headers.slice(0, cIdx).filter(lh => mergeHeaderSet.has(lh));
      let i = 0;
      while (i < cleanRows.length) {
        if ((rowKinds[i] ?? 0) !== 0) { i++; continue; }

        const v = cleanRows[i]?.[h];
        if (v == null || String(v) === '') { i++; continue; }

        let j = i + 1;
        while (
          j < cleanRows.length &&
          (rowKinds[j] ?? 0) === 0 &&
          cleanRows[j]?.[h] === v
        ) {
          if (leftGateHeaders.some(lh => cleanRows[j]?.[lh] !== cleanRows[j - 1]?.[lh])) break;
          j++;
        }

        const span = j - i;
        if (span > 1) {
          let p = mergeParticipation.get(h);
          if (!p) { p = new Set<number>(); mergeParticipation.set(h, p); }
          for (let r = i; r < j; r++) p.add(r);
          addUnderline(j - 1, cIdx);
        } else {
          const hasLeftMergeContext = leftGateHeaders.some(lh => mergeParticipation.get(lh)?.has(i));
          if (hasLeftMergeContext) addUnderline(i, cIdx);
        }

        i = j;
      }
    });
  }

  const ensureRowUnderlineSet = new Set<string>();
  if (underlineMergedGroups) {
    for (const [r, cStart] of mergeUnderlineStartByRow.entries()) {
      for (let c = cStart; c <= range.e.c; c++) ensureRowUnderlineSet.add(`${r}:${c}`);
    }
  }

  // Header row styling
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr] as Record<string, unknown> | undefined;
    if (!cell) continue;
    cell.s = {
      font: { ...fontBase, bold: true, color: { rgb: 'FFF9FAFB' } },
      fill: { fgColor: { rgb: 'FF334155' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: borderColor },
        bottom: { style: 'thin', color: borderColor },
      },
    };
  }

  // Body row styling
  for (let r = 1; r <= range.e.r; r++) {
    const rowType = rowKinds[r - 1] ?? 0;

    // Band header row (kind 4) — distinct styling, full-width, skip normal logic
    if (rowType === 4) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        let cell = ws[addr] as Record<string, unknown> | undefined;
        if (!cell) {
          cell = { t: 's', v: '' };
          ws[addr] = cell;
        }
        cell.s = {
          font: { ...fontBase, bold: true, italic: true, color: { rgb: 'FF1E40AF' } },
          fill: { fgColor: { rgb: 'FFDBEAFE' } },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: { bottom: { style: 'thin', color: borderColor } },
        };
      }
      continue;
    }

    const isSubtotal = rowType === 1;
    const isGrand = rowType === 3;
    const isSpacer = rowType === 2;
    const isSummary = isSubtotal || isGrand;

    const summaryBorder = {
      style: isGrand ? 'thick' : 'medium',
      color: isGrand ? grandBorderColor : borderColor,
    };

    const rowObj = cleanRows[r - 1] || {};
    let lastDataColIdx = range.s.c;
    if (isSummary) {
      lastDataColIdx = range.e.c;
    } else {
      for (let i = headers.length - 1; i >= 0; i--) {
        const v = rowObj[headers[i]];
        if (v != null && String(v) !== '') { lastDataColIdx = range.s.c + i; break; }
      }
    }
    const rowUnderlineStart = mergeUnderlineStartByRow.get(r);
    const hasRowUnderline = rowUnderlineStart != null;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      let cell = ws[addr] as Record<string, unknown> | undefined;

      const shouldPersistBlank = isSummary || (!isSummary && ensureRowUnderlineSet.has(`${r}:${c}`));
      const isStubOrUndefined = !!cell && (cell.t === 'z' || cell.v === undefined);
      if (shouldPersistBlank && (!cell || isStubOrUndefined)) {
        cell = { t: 's', v: '' };
        ws[addr] = cell;
      }
      if (!cell) continue;

      if (isSpacer) {
        cell.s = {
          font: { ...fontBase, color: { rgb: 'FF6B7280' } },
          alignment: { horizontal: 'left', vertical: 'center' },
        };
        continue;
      }

      const isNumeric = cell.t === 'n';
      if (isNumeric && !cell.z) {
        cell.z = Number.isInteger(cell.v) ? '#,##0' : '#,##0.00########';
      }

      const isMergedAnchor = mergeStartSet.has(`${r}:${c}`);

      const border: Record<string, unknown> = {};
      if (isSummary) {
        border.top = summaryBorder;
        border.bottom = summaryBorder;
        if (c === range.s.c) border.left = summaryBorder;
        if (c === lastDataColIdx) border.right = summaryBorder;
      }
      if (!isSummary && hasRowUnderline && c >= rowUnderlineStart) {
        border.bottom = { style: 'thin', color: borderColor };
      }

      const style: Record<string, unknown> = {
        font: { ...fontBase, bold: isSummary },
        alignment: {
          horizontal: isNumeric ? 'right' : 'left',
          vertical: isMergedAnchor ? 'top' : 'center',
          wrapText: isMergedAnchor,
        },
        border,
      };
      if (isGrand) style.fill = { fgColor: { rgb: 'FFE2E8F0' } };
      else if (isSubtotal) style.fill = { fgColor: { rgb: 'FFF1F5F9' } };
      else {
        // Band data rows get subtle alternating background tints per band
        const rowBandId = bandIds?.[r - 1] ?? '';
        const bIdx = rowBandId ? bandIds!.indexOf(rowBandId) : -1;
        if (bIdx >= 0) {
          style.fill = { fgColor: { rgb: BAND_TINT_PALETTE[bIdx % BAND_TINT_PALETTE.length] } };
        }
      }
      cell.s = style;
    }
  }

  ws['!autofilter'] = { ref };
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

  ws['!cols'] = headers.map(h => {
    let maxLen = String(h || '').length;
    const sample = Math.min(cleanRows.length, WIDTH_SAMPLE_ROWS);
    for (let i = 0; i < sample; i++) {
      const v = cleanRows[i]?.[h];
      if (v == null) continue;
      maxLen = Math.max(maxLen, String(v).length);
    }
    return { wch: Math.min(MAX_COL_WCH, Math.max(MIN_COL_WCH, maxLen + 2)), MDW: 6, customWidth: 1 };
  });

  ws['!rows'] = ws['!rows'] || [];
  (ws['!rows'] as Record<string, unknown>[])[0] = { ...((ws['!rows'] as Record<string, unknown>[])[0] || {}), hpt: 24 };
  for (let r = 1; r <= range.e.r; r++) {
    (ws['!rows'] as Record<string, unknown>[])[r] = { ...((ws['!rows'] as Record<string, unknown>[])[r] || {}), hpt: BODY_ROW_HPT };
  }
}
