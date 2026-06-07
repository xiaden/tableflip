import { db } from '../core/state.js';
import { buildExportHeaderMap, toast, dl } from '../core/utils.js';
import { buildColSourceMap } from '../catalog/column-catalog.js';
import { getValidation } from '../report/validation.js';

export function exportAs(fmt) {
  if (!db.result || !db.result.rows) return;

  const v = getValidation();
  if (v.reportStatus === 'blocked') {
    const blockingItems = Object.values(v.items).filter(item => item.blocking);
    const firstMsg = blockingItems[0]?.issues[0]?.message || 'missing source data';
    toast(`Can't export — fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ''}).`, 'err');
    return;
  }

  const ts = new Date().toISOString().slice(0, 10);
  const fn = 'report-' + ts;

  const { rows, totalsRow, cols } = db.result;
  const colMap = buildColSourceMap();
  const hdrMap = buildExportHeaderMap(cols, colMap);

  const exportCols = cols.filter(c =>
    c !== '_rowno' &&
    c !== '_row_type' &&
    c !== '_isTotalsRow' &&
    c !== '_sort_row_type' &&
    !String(c).startsWith('_sort_group_')
  );
  const exportHeaders = exportCols.map(c => hdrMap?.[c] || c);
  const mergeHeaderSet = new Set(
    exportCols
      .filter(c => (db.mergedCols || []).includes(c))
      .map(c => hdrMap?.[c] || c)
  );

  const remap = row => {
    const out = {};
    for (const c of exportCols) {
      const header = hdrMap?.[c];
      out[header || c] = row[c];
    }
    return out;
  };

  const dataRows = totalsRow ? [...rows, { ...totalsRow, _isTotalsRow: true }] : [...rows];
  const rowKinds = dataRows.map(r => {
    if (r._isTotalsRow) return 3;
    const t = Number(r._row_type);
    return Number.isFinite(t) ? t : 0;
  });
  const clean = dataRows.map(remap);

  if (fmt === 'csv') {
    const ws   = XLSX.utils.json_to_sheet(clean, { header: exportHeaders, skipHeader: false });
    const csv  = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    dl(blob, fn + '.csv');
  } else {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(clean, { header: exportHeaders, skipHeader: false });
    applyExportMerges(ws, clean, rowKinds, exportHeaders, mergeHeaderSet);
    styleExportSheet(ws, clean, rowKinds, mergeHeaderSet);
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    XLSX.writeFile(wb, fn + '.xlsx');
  }
  toast('Exported ' + clean.length.toLocaleString() + ' rows as ' + fmt.toUpperCase(), 'ok');
}
window.exportAs = exportAs;

function applyExportMerges(ws, cleanRows, rowKinds, headers, mergeHeaderSet) {
  if (!ws || !Array.isArray(cleanRows) || !cleanRows.length) return;
  if (!headers || !headers.length || !mergeHeaderSet || mergeHeaderSet.size === 0) return;

  const merges = [];

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

function styleExportSheet(ws, cleanRows, rowKinds, mergeHeaderSet = new Set()) {
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
  const mergeStartSet = new Set((ws['!merges'] || []).map(m => `${m.s.r}:${m.s.c}`));
  const underlineMergedGroups = !!db?.mergeGroupUnderline;
  const mergeUnderlineStartByRow = new Map();
  if (underlineMergedGroups) {
    const mergeParticipation = new Map();
    const addUnderline = (bodyRowIdx, colIdx) => {
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
          if (!p) { p = new Set(); mergeParticipation.set(h, p); }
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

  const ensureRowUnderlineSet = new Set();
  if (underlineMergedGroups) {
    for (const [r, cStart] of mergeUnderlineStartByRow.entries()) {
      for (let c = cStart; c <= range.e.c; c++) ensureRowUnderlineSet.add(`${r}:${c}`);
    }
  }

  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr];
    if (!cell) continue;
    cell.s = {
      font: { ...fontBase, bold: true, color: { rgb: 'FFF9FAFB' } },
      fill: { fgColor: { rgb: 'FF334155' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top:    { style: 'thin', color: borderColor },
        bottom: { style: 'thin', color: borderColor },
      },
    };
  }

  for (let r = 1; r <= range.e.r; r++) {
    const rowType = rowKinds[r - 1] ?? 0;
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
      let cell = ws[addr];

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

      const border = {};
      if (isSummary) {
        border.top = summaryBorder;
        border.bottom = summaryBorder;
        if (c === range.s.c) border.left = summaryBorder;
        if (c === lastDataColIdx) border.right = summaryBorder;
      }
      if (!isSummary && hasRowUnderline && c >= rowUnderlineStart) {
        border.bottom = { style: 'thin', color: borderColor };
      }

      const style = {
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
      cell.s = style;
    }
  }

  ws['!autofilter'] = { ref };
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

  ws['!cols'] = headers.map((h) => {
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
  ws['!rows'][0] = { ...(ws['!rows'][0] || {}), hpt: 24 };
  for (let r = 1; r <= range.e.r; r++) {
    ws['!rows'][r] = { ...(ws['!rows'][r] || {}), hpt: BODY_ROW_HPT };
  }
}
