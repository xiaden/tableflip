import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  filterExportCols,
  buildBandLabels,
  enrichRowsWithBandHeaders,
  styleExportSheet,
  computeBandColSets,
  applyBandGroup,
  buildBandColumnLayout,
  exportAs,
} from '../../ui/export';
import { initStore, getStore } from '../../core/store';
import type { DetailBandSpec, DbTable } from '../../types';

// Mock validation to return healthy status so exportAs() doesn't block
vi.mock('../../report/validation', () => ({
  getValidation: vi.fn().mockReturnValue({ reportStatus: 'healthy', items: {} }),
}));

// ── XLSX mock ──────────────────────────────────────────────────────────────
// styleExportSheet uses XLSX.utils.encode_cell and XLSX.utils.decode_range.
// Provide minimal implementations for testing.

function encodeCell({ r, c }: { r: number; c: number }): string {
  let col = '';
  let n = c;
  do {
    col = String.fromCharCode(65 + (n % 26)) + col;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return col + (r + 1);
}

function decodeRange(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } } {
  const [start, end] = ref.split(':');
  const parseAddr = (addr: string) => {
    const match = addr.match(/^([A-Z]+)(\d+)$/);
    if (!match) return { r: 0, c: 0 };
    let c = 0;
    for (const ch of match[1]) {
      c = c * 26 + (ch.charCodeAt(0) - 64);
    }
    return { r: parseInt(match[2], 10) - 1, c: c - 1 };
  };
  return { s: parseAddr(start), e: parseAddr(end || start) };
}

/** Build a minimal XLSXSheet from a 2D array of values. */
function makeSheet(data: unknown[][]): XLSXSheet {
  const ws: XLSXSheet = {};
  const maxR = data.length - 1;
  const maxC = data.length > 0 ? data[0].length - 1 : 0;
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const addr = encodeCell({ r, c });
      const v = data[r][c];
      ws[addr] = v != null
        ? { t: typeof v === 'number' ? 'n' : 's', v }
        : { t: 's', v: '' };
    }
  }
  ws['!ref'] = encodeCell({ r: 0, c: 0 }) + ':' + encodeCell({ r: maxR, c: maxC });
  return ws;
}

beforeAll(() => {
  // Install minimal XLSX mock on globalThis
  (globalThis as any).XLSX = {
    utils: {
      encode_cell: encodeCell,
      decode_range: decodeRange,
      json_to_sheet: vi.fn().mockReturnValue({ '!ref': 'A1:B2' }),
      sheet_to_csv: vi.fn().mockReturnValue('a,b,c'),
      book_new: vi.fn().mockReturnValue({}),
      book_append_sheet: vi.fn(),
    },
    writeFile: vi.fn(),
  };
});

beforeEach(() => {
  initStore();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('filterExportCols', () => {
  it('filters _band_id from XLSX export columns (default)', () => {
    const cols = ['OrderId', 'Company', '_band_id', 'Amount'];
    const result = filterExportCols(cols);
    expect(result).toEqual(['OrderId', 'Company', 'Amount']);
    expect(result).not.toContain('_band_id');
  });

  it('filters _band_id when isCsv=false explicitly', () => {
    const cols = ['OrderId', '_band_id', 'Amount'];
    const result = filterExportCols(cols, false);
    expect(result).toEqual(['OrderId', 'Amount']);
  });

  it('keeps _band_id for CSV export (isCsv=true)', () => {
    const cols = ['OrderId', 'Company', '_band_id', 'Amount'];
    const result = filterExportCols(cols, true);
    expect(result).toEqual(['OrderId', 'Company', '_band_id', 'Amount']);
    expect(result).toContain('_band_id');
  });

  it('still filters other internal columns for CSV', () => {
    const cols = ['_rowno', '_row_type', '_isTotalsRow', '_band_id', '_sort_row_type', '_sort_group_0', 'Name', 'Value'];
    const result = filterExportCols(cols, true);
    expect(result).toEqual(['_band_id', 'Name', 'Value']);
  });

  it('filters all internal columns for XLSX', () => {
    const cols = ['_rowno', '_row_type', '_isTotalsRow', '_band_id', '_sort_row_type', '_sort_group_0', 'Name', 'Value'];
    const result = filterExportCols(cols);
    expect(result).toEqual(['Name', 'Value']);
  });

  it('passes through normal columns unchanged', () => {
    const cols = ['A', 'B', 'C'];
    expect(filterExportCols(cols)).toEqual(['A', 'B', 'C']);
  });

  it('handles empty array', () => {
    expect(filterExportCols([])).toEqual([]);
  });
});

describe('buildBandLabels', () => {
  const tables: Record<string, DbTable> = {
    'tbl-items': { id: 'tbl-items', name: 'Line Items', cols: ['ItemId', 'Product'], rowCount: 10 },
    'tbl-notes': { id: 'tbl-notes', name: 'Notes', cols: ['NoteId', 'Text'], rowCount: 5 },
  };

  it('uses band.label when present', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'tbl-items', keyPairs: [], cols: [], enabled: true, sorts: [], label: 'Custom Label' },
    ];
    const result = buildBandLabels(bands, tables);
    expect(result['band_0']).toBe('Custom Label');
  });

  it('falls back to table name when label is empty', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'tbl-items', keyPairs: [], cols: [], enabled: true, sorts: [], label: '' },
    ];
    const result = buildBandLabels(bands, tables);
    expect(result['band_0']).toBe('Line Items');
  });

  it('falls back to band.id when label is empty and table not found', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'nonexistent', keyPairs: [], cols: [], enabled: true, sorts: [], label: '' },
    ];
    const result = buildBandLabels(bands, tables);
    expect(result['band_0']).toBe('band_0');
  });

  it('handles multiple bands', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'tbl-items', keyPairs: [], cols: [], enabled: true, sorts: [], label: 'Items' },
      { id: 'band_1', rightId: 'tbl-notes', keyPairs: [], cols: [], enabled: true, sorts: [], label: '' },
    ];
    const result = buildBandLabels(bands, tables);
    expect(result['band_0']).toBe('Items');
    expect(result['band_1']).toBe('Notes');
  });

  it('handles undefined detailBands', () => {
    expect(buildBandLabels(undefined, tables)).toEqual({});
  });

  it('handles undefined tables', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'tbl-items', keyPairs: [], cols: [], enabled: true, sorts: [], label: '' },
    ];
    const result = buildBandLabels(bands, undefined);
    expect(result['band_0']).toBe('band_0');
  });
});

describe('enrichRowsWithBandHeaders', () => {
  const exportCols = ['OrderId', 'Product', 'Amount'];
  const bandLabels = { band_0: 'Line Items', band_1: 'Notes' };

  it('inserts section header rows on _band_id transitions (XLSX)', () => {
    const dataRows = [
      { OrderId: 'ORD-1', Product: null, Amount: 100, _band_id: null },
      { OrderId: null, Product: 'Widget', Amount: null, _band_id: 'band_0' },
      { OrderId: null, Product: 'Gadget', Amount: null, _band_id: 'band_0' },
      { OrderId: 'ORD-2', Product: null, Amount: 200, _band_id: null },
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, false);

    // Expected: parent, header(band_0), band_row, band_row, parent
    expect(enrichedRows).toHaveLength(5);
    expect(enrichedRows[0]).toHaveProperty('OrderId', 'ORD-1');
    expect(enrichedRows[1]).toHaveProperty('_isBandHeader', true);
    expect(enrichedRows[1]).toHaveProperty(exportCols[0], 'Line Items');
    expect(enrichedRows[2]).toHaveProperty('Product', 'Widget');
    expect(enrichedRows[3]).toHaveProperty('Product', 'Gadget');
    expect(enrichedRows[4]).toHaveProperty('OrderId', 'ORD-2');
  });

  it('inserts multiple section headers for different bands', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { OrderId: null, _band_id: 'band_0' },
      { OrderId: null, _band_id: 'band_1' },
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, false);

    // Expected: parent, header(band_0), band_0_row, header(band_1), band_1_row
    expect(enrichedRows).toHaveLength(5);
    expect((enrichedRows[1] as any)._isBandHeader).toBe(true);
    expect(enrichedRows[1][exportCols[0]]).toBe('Line Items');
    expect((enrichedRows[3] as any)._isBandHeader).toBe(true);
    expect(enrichedRows[3][exportCols[0]]).toBe('Notes');
  });

  it('does NOT insert extra headers when same band continues', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },       // parent row
      { OrderId: null, _band_id: 'band_0' },      // first band row → header inserted
      { OrderId: null, _band_id: 'band_0' },      // same band → no extra header
      { OrderId: null, _band_id: 'band_0' },      // same band → no extra header
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, false);
    // parent + 1 header + 3 band rows = 5
    expect(enrichedRows).toHaveLength(5);
    // Only one header (at index 1)
    const headerCount = enrichedRows.filter(r => (r as any)._isBandHeader).length;
    expect(headerCount).toBe(1);
  });

  it('does NOT insert headers in CSV mode', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { OrderId: null, _band_id: 'band_0' },
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, true);
    expect(enrichedRows).toHaveLength(2);
    expect(enrichedRows).toEqual(dataRows);
  });

  it('assigns row kind 4 to band header rows', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { OrderId: null, _band_id: 'band_0' },
    ];
    const { rowKinds } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, false);
    // [parent(kind 0), header(kind 4), band_row(kind 0)]
    expect(rowKinds).toEqual([0, 4, 0]);
  });

  it('assigns correct rowKinds for mixed row types', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null, _row_type: 0 },
      { OrderId: null, _band_id: 'band_0', _row_type: 0 },
      { _isTotalsRow: true, OrderId: 'TOTAL' },
    ];
    const { rowKinds } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, false);
    // [parent(0), header(4), band_row(0), totals(3)]
    expect(rowKinds).toEqual([0, 4, 0, 3]);
  });

  it('band header rows have empty strings in non-first columns', () => {
    const dataRows = [
      { OrderId: 'ORD-1', Product: null, Amount: 100, _band_id: null },
      { OrderId: null, Product: 'Widget', Amount: null, _band_id: 'band_0' },
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, false);
    const header = enrichedRows[1];
    expect(header[exportCols[0]]).toBe('Line Items');
    expect(header[exportCols[1]]).toBe('');
    expect(header[exportCols[2]]).toBe('');
  });

  it('uses bandId as fallback when label not found', () => {
    const dataRows = [
      { OrderId: null, _band_id: 'unknown_band' },
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportCols, {}, false);
    expect(enrichedRows[0][exportCols[0]]).toBe('unknown_band');
  });

  it('handles empty dataRows', () => {
    const { enrichedRows, rowKinds } = enrichRowsWithBandHeaders([], exportCols, bandLabels, false);
    expect(enrichedRows).toEqual([]);
    expect(rowKinds).toEqual([]);
  });
});

describe('styleExportSheet — band header (kind 4) styling', () => {
  it('applies bold italic blue font to kind 4 rows', () => {
    // Sheet: header row (0) + band header data row (1)
    const ws = makeSheet([
      ['OrderId', 'Product', 'Amount'],  // row 0: header
      ['Line Items', '', ''],             // row 1: band header
    ]);
    // cleanRows does NOT include the header row — parallels sheet rows 1+
    const cleanRows = [
      { OrderId: 'Line Items', Product: '', Amount: '' },
    ];
    const rowKinds = [4];

    styleExportSheet(ws, cleanRows, rowKinds);

    // Check band header row cells (sheet row 1)
    const cellA2 = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cellA2.s as Record<string, unknown>;
    const font = style.font as Record<string, unknown>;
    expect(font.bold).toBe(true);
    expect(font.italic).toBe(true);
    const fontColor = font.color as Record<string, unknown>;
    expect(fontColor.rgb).toBe('FF1E40AF');
  });

  it('applies light blue fill to kind 4 rows', () => {
    const ws = makeSheet([
      ['Col1', 'Col2'],
      ['Band Header', ''],
    ]);
    const cleanRows = [
      { Col1: 'Band Header', Col2: '' },
    ];
    const rowKinds = [4];

    styleExportSheet(ws, cleanRows, rowKinds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const fill = style.fill as Record<string, unknown>;
    const fgColor = fill.fgColor as Record<string, unknown>;
    expect(fgColor.rgb).toBe('FFDBEAFE');
  });

  it('applies left alignment to kind 4 rows', () => {
    const ws = makeSheet([
      ['Col1', 'Col2'],
      ['Data', 'Data2'],
      ['Band Header', ''],
    ]);
    const cleanRows = [
      { Col1: 'Data', Col2: 'Data2' },
      { Col1: 'Band Header', Col2: '' },
    ];
    const rowKinds = [0, 4];

    styleExportSheet(ws, cleanRows, rowKinds);

    const cell = ws[encodeCell({ r: 2, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const alignment = style.alignment as Record<string, unknown>;
    expect(alignment.horizontal).toBe('left');
    expect(alignment.vertical).toBe('center');
  });

  it('applies thin bottom border to kind 4 rows', () => {
    const ws = makeSheet([
      ['Col1'],
      ['Band Header'],
    ]);
    const cleanRows = [
      { Col1: 'Band Header' },
    ];
    const rowKinds = [4];

    styleExportSheet(ws, cleanRows, rowKinds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const border = style.border as Record<string, unknown>;
    const bottom = border.bottom as Record<string, unknown>;
    expect(bottom.style).toBe('thin');
  });

  it('applies styling to ALL columns in a kind 4 row', () => {
    const ws = makeSheet([
      ['A', 'B', 'C'],
      ['Header', '', ''],
    ]);
    const cleanRows = [
      { A: 'Header', B: '', C: '' },
    ];
    const rowKinds = [4];

    styleExportSheet(ws, cleanRows, rowKinds);

    // All three cells in sheet row 1 should have kind 4 styling
    for (let c = 0; c < 3; c++) {
      const cell = ws[encodeCell({ r: 1, c })] as Record<string, unknown>;
      expect(cell).toBeDefined();
      const style = cell.s as Record<string, unknown>;
      const font = style.font as Record<string, unknown>;
      expect(font.bold).toBe(true);
      expect(font.italic).toBe(true);
    }
  });

  it('creates cells for kind 4 row if they do not exist', () => {
    // Sheet with header cells defined, range extends to row 1 but no cells there
    const ws: XLSXSheet = {};
    ws[encodeCell({ r: 0, c: 0 })] = { t: 's', v: 'Col1' };
    ws[encodeCell({ r: 0, c: 1 })] = { t: 's', v: 'Col2' };
    ws['!ref'] = 'A1:B2'; // Range includes row 1 which has no cells

    const cleanRows = [
      { Col1: 'Band Header', Col2: '' },
    ];
    const rowKinds = [4];

    styleExportSheet(ws, cleanRows, rowKinds);

    // Cells should have been created for sheet row 1
    const cellA2 = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const cellB2 = ws[encodeCell({ r: 1, c: 1 })] as Record<string, unknown>;
    expect(cellA2).toBeDefined();
    expect(cellB2).toBeDefined();
    expect((cellA2.s as Record<string, unknown>).font).toBeDefined();
    expect((cellB2.s as Record<string, unknown>).font).toBeDefined();
  });

  it('does not affect kind 0 rows (existing behavior preserved)', () => {
    const ws = makeSheet([
      ['Col1', 'Col2'],
      ['Data1', 'Data2'],
    ]);
    const cleanRows = [
      { Col1: 'Data1', Col2: 'Data2' },
    ];
    const rowKinds = [0];

    styleExportSheet(ws, cleanRows, rowKinds);

    // Kind 0 row should NOT have band header styling
    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const font = style.font as Record<string, unknown>;
    expect(font.italic).toBeUndefined();
    // Should not have blue fill
    expect(style.fill).toBeUndefined();
  });

  it('does not affect kind 1 (subtotal) rows', () => {
    const ws = makeSheet([
      ['Col1'],
      ['Subtotal'],
    ]);
    const cleanRows = [
      { Col1: 'Subtotal' },
    ];
    const rowKinds = [1];

    styleExportSheet(ws, cleanRows, rowKinds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const font = style.font as Record<string, unknown>;
    // Subtotal rows are bold but NOT italic
    expect(font.bold).toBe(true);
    expect(font.italic).toBeUndefined();
  });
});

// ── CSV Export Tests ─────────────────────────────────────────────────────────

describe('CSV export — _band_id column and no section headers', () => {
  const exportColsCsv = ['OrderId', 'Product', 'Amount', '_band_id'];
  const bandLabels = { band_0: 'Line Items', band_1: 'Notes' };

  it('CSV enrichedRows pass through dataRows unchanged (no section headers)', () => {
    const dataRows = [
      { OrderId: 'ORD-1', Product: null, Amount: 100, _band_id: null },
      { OrderId: null, Product: 'Widget', Amount: null, _band_id: 'band_0' },
      { OrderId: null, Product: 'Gadget', Amount: null, _band_id: 'band_0' },
      { OrderId: 'ORD-2', Product: null, Amount: 200, _band_id: null },
      { OrderId: null, Product: 'Sprocket', Amount: null, _band_id: 'band_1' },
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportColsCsv, bandLabels, true);

    // CSV must have exactly the same number of rows — no headers inserted
    expect(enrichedRows).toHaveLength(5);
    expect(enrichedRows).toEqual(dataRows);
  });

  it('CSV enrichedRows contain _band_id values for downstream grouping', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { OrderId: null, _band_id: 'band_0' },
      { OrderId: null, _band_id: 'band_1' },
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportColsCsv, bandLabels, true);

    // _band_id values must be preserved in CSV output
    expect(enrichedRows[0]._band_id).toBeNull();
    expect(enrichedRows[1]._band_id).toBe('band_0');
    expect(enrichedRows[2]._band_id).toBe('band_1');
  });

  it('CSV enrichedRows have no _isBandHeader flags', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { OrderId: null, _band_id: 'band_0' },
    ];
    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportColsCsv, bandLabels, true);

    for (const row of enrichedRows) {
      expect((row as any)._isBandHeader).toBeUndefined();
    }
  });

  it('CSV rowKinds are all 0 for detail rows (no kind 4)', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null, _row_type: 0 },
      { OrderId: null, _band_id: 'band_0', _row_type: 0 },
      { OrderId: null, _band_id: 'band_0', _row_type: 0 },
    ];
    const { rowKinds } = enrichRowsWithBandHeaders(dataRows, exportColsCsv, bandLabels, true);

    // No band headers in CSV, so no kind 4
    expect(rowKinds).toEqual([0, 0, 0]);
    expect(rowKinds).not.toContain(4);
  });

  it('CSV rowKinds correctly identify totals rows', () => {
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null, _row_type: 0 },
      { OrderId: null, _band_id: 'band_0', _row_type: 0 },
      { _isTotalsRow: true, OrderId: 'TOTAL', _band_id: null },
    ];
    const { rowKinds } = enrichRowsWithBandHeaders(dataRows, exportColsCsv, bandLabels, true);

    expect(rowKinds).toEqual([0, 0, 3]);
  });

  it('filterExportCols keeps _band_id for CSV but filters it for XLSX', () => {
    const cols = ['OrderId', 'Product', '_band_id', '_rowno', '_row_type'];
    const csvCols = filterExportCols(cols, true);
    const xlsxCols = filterExportCols(cols, false);

    expect(csvCols).toContain('_band_id');
    expect(csvCols).not.toContain('_rowno');
    expect(csvCols).not.toContain('_row_type');

    expect(xlsxCols).not.toContain('_band_id');
    expect(xlsxCols).not.toContain('_rowno');
    expect(xlsxCols).not.toContain('_row_type');
  });

  it('CSV _band_id values survive remap for all band transitions', () => {
    // Simulate the remap function from exportAs() for CSV
    const exportCols = ['OrderId', 'Product', '_band_id'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', Product: 'Product', _band_id: '_band_id' };
    const remap = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const c of exportCols) {
        out[hdrMap[c] || c] = row[c];
      }
      return out;
    };

    const dataRows = [
      { OrderId: 'ORD-1', Product: null, _band_id: null },
      { OrderId: null, Product: 'Widget', _band_id: 'band_0' },
      { OrderId: null, Product: 'Gadget', _band_id: 'band_0' },
      { OrderId: 'ORD-2', Product: null, _band_id: null },
      { OrderId: null, Product: 'Note A', _band_id: 'band_1' },
    ];

    const { enrichedRows } = enrichRowsWithBandHeaders(dataRows, exportCols, bandLabels, true);
    const clean = enrichedRows.map(remap);

    // Verify _band_id is present in remapped output
    expect(clean).toHaveLength(5);
    expect(clean[0]['_band_id']).toBeNull();
    expect(clean[1]['_band_id']).toBe('band_0');
    expect(clean[2]['_band_id']).toBe('band_0');
    expect(clean[3]['_band_id']).toBeNull();
    expect(clean[4]['_band_id']).toBe('band_1');
  });
});

// ── Band Data Row Tint Styling Tests (Phase 4) ──────────────────────────────

describe('styleExportSheet — band data row tint styling', () => {
  it('applies subtle background fill to band data rows (kind 0 with bandIds)', () => {
    const ws = makeSheet([
      ['OrderId', 'Product', 'Amount'],  // header row
      ['ORD-1', '', '100'],              // parent row (no band tint)
      ['Widget', 'Gadget', ''],          // band data row
    ]);
    const cleanRows = [
      { OrderId: 'ORD-1', Product: '', Amount: '100' },
      { OrderId: 'Widget', Product: 'Gadget', Amount: '' },
    ];
    const rowKinds = [0, 0];
    const bandIds = ['', 'band_0'];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    // Band data row (sheet row 2) should have a fill
    const bandCell = ws[encodeCell({ r: 2, c: 0 })] as Record<string, unknown>;
    const bandStyle = bandCell.s as Record<string, unknown>;
    const bandFill = bandStyle.fill as Record<string, unknown>;
    expect(bandFill).toBeDefined();
    const bandFgColor = bandFill.fgColor as Record<string, unknown>;
    expect(bandFgColor.rgb).toBeDefined();
    // Should be one of the palette colors
    expect(['FFF8FAFC', 'FFEFF6FF', 'FFF0FDF4', 'FFFFF7ED', 'FFFDF4FF']).toContain(bandFgColor.rgb);
  });

  it('does NOT apply band tint to parent rows (null _band_id)', () => {
    const ws = makeSheet([
      ['OrderId', 'Product'],
      ['ORD-1', 'Acme'],
    ]);
    const cleanRows = [
      { OrderId: 'ORD-1', Product: 'Acme' },
    ];
    const rowKinds = [0];
    const bandIds = [''];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    // Parent row should have NO fill (standard detail row styling)
    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    expect(style.fill).toBeUndefined();
  });

  it('applies different tints for different bands', () => {
    const ws = makeSheet([
      ['Col1', 'Col2'],
      ['band_0 data', ''],    // band_0 row
      ['band_1 data', ''],    // band_1 row
    ]);
    const cleanRows = [
      { Col1: 'band_0 data', Col2: '' },
      { Col1: 'band_1 data', Col2: '' },
    ];
    const rowKinds = [0, 0];
    const bandIds = ['band_0', 'band_1'];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    const cell0 = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const fill0 = (cell0.s as Record<string, unknown>).fill as Record<string, unknown>;
    const rgb0 = (fill0.fgColor as Record<string, unknown>).rgb as string;

    const cell1 = ws[encodeCell({ r: 2, c: 0 })] as Record<string, unknown>;
    const fill1 = (cell1.s as Record<string, unknown>).fill as Record<string, unknown>;
    const rgb1 = (fill1.fgColor as Record<string, unknown>).rgb as string;

    // Different bands must get different colors
    expect(rgb0).not.toBe(rgb1);
  });

  it('applies same tint to consecutive rows of the same band', () => {
    const ws = makeSheet([
      ['Col1'],
      ['item_a'],
      ['item_b'],
      ['item_c'],
    ]);
    const cleanRows = [
      { Col1: 'item_a' },
      { Col1: 'item_b' },
      { Col1: 'item_c' },
    ];
    const rowKinds = [0, 0, 0];
    const bandIds = ['band_0', 'band_0', 'band_0'];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    const fills = [0, 1, 2].map(r => {
      const cell = ws[encodeCell({ r: r + 1, c: 0 })] as Record<string, unknown>;
      const style = cell.s as Record<string, unknown>;
      const fill = style.fill as Record<string, unknown>;
      return (fill.fgColor as Record<string, unknown>).rgb as string;
    });

    // All three rows belong to band_0 → same tint
    expect(fills[0]).toBe(fills[1]);
    expect(fills[1]).toBe(fills[2]);
  });

  it('does NOT override kind 4 (band header) fill with band tint', () => {
    const ws = makeSheet([
      ['Col1', 'Col2'],
      ['Band Header', ''],
    ]);
    const cleanRows = [
      { Col1: 'Band Header', Col2: '' },
    ];
    const rowKinds = [4]; // kind 4 = band header
    const bandIds = ['band_0'];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const fill = style.fill as Record<string, unknown>;
    const fgColor = fill.fgColor as Record<string, unknown>;
    // Band header rows must keep their blue fill, not get a band tint
    expect(fgColor.rgb).toBe('FFDBEAFE');
  });

  it('does NOT override kind 1 (subtotal) fill with band tint', () => {
    const ws = makeSheet([
      ['Col1'],
      ['Subtotal'],
    ]);
    const cleanRows = [
      { Col1: 'Subtotal' },
    ];
    const rowKinds = [1]; // kind 1 = subtotal
    const bandIds = ['band_0'];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const fill = style.fill as Record<string, unknown>;
    const fgColor = fill.fgColor as Record<string, unknown>;
    // Subtotal rows keep their existing fill
    expect(fgColor.rgb).toBe('FFF1F5F9');
  });

  it('does NOT override kind 3 (grand total) fill with band tint', () => {
    const ws = makeSheet([
      ['Col1'],
      ['Grand Total'],
    ]);
    const cleanRows = [
      { Col1: 'Grand Total' },
    ];
    const rowKinds = [3]; // kind 3 = grand total
    const bandIds = [''];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const fill = style.fill as Record<string, unknown>;
    const fgColor = fill.fgColor as Record<string, unknown>;
    // Grand total rows keep their existing fill
    expect(fgColor.rgb).toBe('FFE2E8F0');
  });

  it('works without bandIds parameter', () => {
    const ws = makeSheet([
      ['Col1'],
      ['Data'],
    ]);
    const cleanRows = [
      { Col1: 'Data' },
    ];
    const rowKinds = [0];

    // Call without bandIds — should not throw, should not apply band tint
    styleExportSheet(ws, cleanRows, rowKinds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    // Without bandIds, no band tint should be applied
    expect(style.fill).toBeUndefined();
  });

  it('applies band tint to all columns in the row', () => {
    const ws = makeSheet([
      ['A', 'B', 'C'],
      ['val_a', 'val_b', 'val_c'],
    ]);
    const cleanRows = [
      { A: 'val_a', B: 'val_b', C: 'val_c' },
    ];
    const rowKinds = [0];
    const bandIds = ['band_0'];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    // All three cells should have the same band tint fill
    const fills: string[] = [];
    for (let c = 0; c < 3; c++) {
      const cell = ws[encodeCell({ r: 1, c })] as Record<string, unknown>;
      const style = cell.s as Record<string, unknown>;
      const fill = style.fill as Record<string, unknown>;
      expect(fill).toBeDefined();
      fills.push((fill.fgColor as Record<string, unknown>).rgb as string);
    }
    expect(fills[0]).toBe(fills[1]);
    expect(fills[1]).toBe(fills[2]);
  });

  it('handles interleaved parent and band rows correctly', () => {
    // Simulates: parent, band_0 row, band_0 row, parent, band_1 row
    const ws = makeSheet([
      ['OrderId', 'Product'],
      ['ORD-1', ''],         // parent
      ['Widget', ''],        // band_0
      ['Gadget', ''],        // band_0
      ['ORD-2', ''],         // parent
      ['Sprocket', ''],      // band_1
    ]);
    const cleanRows = [
      { OrderId: 'ORD-1', Product: '' },
      { OrderId: 'Widget', Product: '' },
      { OrderId: 'Gadget', Product: '' },
      { OrderId: 'ORD-2', Product: '' },
      { OrderId: 'Sprocket', Product: '' },
    ];
    const rowKinds = [0, 0, 0, 0, 0];
    const bandIds = ['', 'band_0', 'band_0', '', 'band_1'];

    styleExportSheet(ws, cleanRows, rowKinds, new Set(), bandIds);

    const getFill = (r: number): string | undefined => {
      const cell = ws[encodeCell({ r, c: 0 })] as Record<string, unknown>;
      const style = cell.s as Record<string, unknown>;
      const fill = style.fill as Record<string, unknown> | undefined;
      return fill ? (fill.fgColor as Record<string, unknown>).rgb as string : undefined;
    };

    // Parent rows (sheet rows 1 and 4) — no fill
    expect(getFill(1)).toBeUndefined();
    expect(getFill(4)).toBeUndefined();

    // Band_0 rows (sheet rows 2 and 3) — same tint
    const band0Fill = getFill(2);
    expect(band0Fill).toBeDefined();
    expect(getFill(3)).toBe(band0Fill);

    // Band_1 row (sheet row 5) — different tint from band_0
    const band1Fill = getFill(5);
    expect(band1Fill).toBeDefined();
    expect(band1Fill).not.toBe(band0Fill);
  });
});

// ── computeBandColSets Tests ──────────────────────────────────────────────────

describe('computeBandColSets', () => {
  it('returns per-band column arrays with _{bandId}_ prefix', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'tbl', keyPairs: [], cols: ['Product', 'Qty'], enabled: true, sorts: [], label: '' },
    ];
    const allCols = ['OrderId', '_band_0_Product', '_band_0_Qty', '_band_1_Note'];
    const result = computeBandColSets(bands, allCols);
    expect(result['band_0']).toEqual(['_band_0_Product', '_band_0_Qty']);
  });

  it('preserves column order from band.cols', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'tbl', keyPairs: [], cols: ['Qty', 'Product'], enabled: true, sorts: [], label: '' },
    ];
    const allCols = ['_band_0_Product', '_band_0_Qty'];
    const result = computeBandColSets(bands, allCols);
    expect(result['band_0']).toEqual(['_band_0_Qty', '_band_0_Product']);
  });

  it('skips disabled bands', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'tbl', keyPairs: [], cols: ['Product'], enabled: true, sorts: [], label: '' },
      { id: 'band_1', rightId: 'tbl2', keyPairs: [], cols: ['Note'], enabled: false, sorts: [], label: '' },
    ];
    const allCols = ['_band_0_Product', '_band_1_Note'];
    const result = computeBandColSets(bands, allCols);
    expect(result['band_0']).toBeDefined();
    expect(result['band_1']).toBeUndefined();
  });

  it('handles empty cols array', () => {
    const bands: DetailBandSpec[] = [
      { id: 'band_0', rightId: 'tbl', keyPairs: [], cols: [], enabled: true, sorts: [], label: '' },
    ];
    const allCols = ['_band_0_Product', '_band_0_Qty'];
    const result = computeBandColSets(bands, allCols);
    // band.cols is empty, so ordered starts empty; defensive append adds the rest
    expect(result['band_0']).toEqual(['_band_0_Product', '_band_0_Qty']);
  });

  it('returns empty object for undefined detailBands', () => {
    expect(computeBandColSets(undefined, ['col1'])).toEqual({});
  });
});

// ── applyBandGroup Tests ──────────────────────────────────────────────────────

describe('applyBandGroup', () => {
  const hdrMap: Record<string, string> = {
    OrderId: 'Order ID',
    _band_0_Product: 'Product',
    _band_0_Qty: 'Qty',
    _band_1_Note: 'Note',
  };
  const allBandLabels = ['Product', 'Qty', 'Note'];

  it('single band single parent produces compact layout with section header', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_0_Qty: 5, _band_id: 'band_0' },
      { _band_0_Product: 'Gadget', _band_0_Qty: 2, _band_id: 'band_0' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product', '_band_0_Qty'], allBandLabels, hdrMap);
    // parent(kind 5) + section header(kind 4) + 2 data rows(kind 0) = 4
    expect(result).toHaveLength(4);
    expect(result[0]._rowKind).toBe(5);
    expect(result[1]._rowKind).toBe(4);
    expect(result[2]._rowKind).toBe(0);
    expect(result[3]._rowKind).toBe(0);
  });

  it('multiple parents tracks match value changes', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
      { OrderId: 'ORD-2', _band_id: null },
      { _band_0_Product: 'Sprocket', _band_id: 'band_0' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], allBandLabels, hdrMap);
    // parent1(5) + header(4) + data(0) + parent2(5) + header(4) + data(0) = 6
    expect(result).toHaveLength(6);
    expect(result[0]['Order ID']).toBe('ORD-1');
    expect(result[3]['Order ID']).toBe('ORD-2');
  });

  it('only this band rows transformed — other band rows pass through', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
      { _band_1_Note: 'Rush', _band_id: 'band_1' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], allBandLabels, hdrMap);
    // parent(5) + section_header(4) + data(0) + band_1_row(pass through) = 4
    const band1Row = result[result.length - 1];
    expect(band1Row._band_id).toBe('band_1');
    expect(band1Row._processed).toBeUndefined();
  });

  it('parent rows get _processed true, kind 5, match col populated, band cols empty', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], allBandLabels, hdrMap);
    const parentRow = result[0];
    expect(parentRow._processed).toBe(true);
    expect(parentRow._rowKind).toBe(5);
    expect(parentRow['Order ID']).toBe('ORD-1');
    expect(parentRow['Product']).toBe('');
    expect(parentRow['Qty']).toBe('');
    expect(parentRow['Note']).toBe('');
  });

  it('section header has display names in correct allBandLabels positions', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_0_Qty: 5, _band_id: 'band_0' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product', '_band_0_Qty'], allBandLabels, hdrMap);
    const headerRow = result[1];
    expect(headerRow._rowKind).toBe(4);
    expect(headerRow['Order ID']).toBe('ORD-1');
    expect(headerRow['Product']).toBe('Product');
    expect(headerRow['Qty']).toBe('Qty');
    expect(headerRow['Note']).toBe(''); // not this band's column
  });

  it('band data rows have values in correct positions', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_0_Qty: 5, _band_id: 'band_0' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product', '_band_0_Qty'], allBandLabels, hdrMap);
    const dataRow = result[2];
    expect(dataRow['Order ID']).toBe('ORD-1');
    expect(dataRow['Product']).toBe('Widget');
    expect(dataRow['Qty']).toBe(5);
    expect(dataRow['Note']).toBe(''); // not this band's column
  });

  it('match value propagates from parent to band rows (not null)', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], allBandLabels, hdrMap);
    // Both parent and data row should have 'ORD-1' in match column
    expect(result[0]['Order ID']).toBe('ORD-1');
    expect(result[2]['Order ID']).toBe('ORD-1');
  });

  it('other band rows pass through unmodified', () => {
    const otherRow = { _band_1_Note: 'Rush', _band_id: 'band_1' };
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
      otherRow,
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], allBandLabels, hdrMap);
    const passedThrough = result[result.length - 1];
    expect(passedThrough).toBe(otherRow); // same reference
  });

  it('already-processed rows pass through', () => {
    const processedRow = { _processed: true, _rowKind: 5, 'Order ID': 'ORD-1', 'Product': '' };
    const rows = [
      processedRow,
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], allBandLabels, hdrMap);
    expect(result[0]).toBe(processedRow); // same reference, not re-processed
  });

  it('empty band (no rows) emits no section header or data rows', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { OrderId: 'ORD-2', _band_id: null },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], allBandLabels, hdrMap);
    // Only parent rows, no section headers or data rows
    expect(result).toHaveLength(2);
    expect(result[0]._rowKind).toBe(5);
    expect(result[1]._rowKind).toBe(5);
  });

  it('totals rows pass through unchanged and trigger flush', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null, _band_0_Product: null },
      { OrderId: null, _band_id: 'band_0', _band_0_Product: 'Widget' },
      { OrderId: 'TOTAL', _band_0_Product: null, _isTotalsRow: true },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], ['Product'], { OrderId: 'Order ID', _band_0_Product: 'Product' });

    // Should have: parent (kind 5), section header (kind 4), data row (kind 0), totals row (isTotalsRow)
    expect(result.length).toBe(4);
    expect(result[0]).toHaveProperty('_rowKind', 5);
    expect(result[1]).toHaveProperty('_rowKind', 4);
    expect(result[2]).toHaveProperty('_rowKind', 0);
    // Totals row should be passed through unchanged (not kind 5)
    expect(result[3]).toHaveProperty('_isTotalsRow', true);
    expect(result[3]).not.toHaveProperty('_rowKind', 5);
  });

  it('kind-5 processed row from previous band triggers flush and updates match value', () => {
    const rows = [
      { _processed: true, _rowKind: 5, 'Order ID': 'ORD-2' },
      { _band_id: 'band_0', _band_0_Product: 'Gadget' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], ['Product'], { OrderId: 'Order ID', _band_0_Product: 'Product' });

    // The processed row should pass through unchanged
    expect(result[0]).toHaveProperty('_processed', true);
    expect(result[0]).toHaveProperty('_rowKind', 5);
    // A section header should be emitted with match value 'ORD-2'
    expect(result[1]).toHaveProperty('_rowKind', 4);
    expect(result[1]['Order ID']).toBe('ORD-2');
    // Data row should carry match value 'ORD-2'
    expect(result[2]).toHaveProperty('_rowKind', 0);
    expect(result[2]['Order ID']).toBe('ORD-2');
  });

  it('band row before first parent has null match value', () => {
    const rows = [
      { _band_id: 'band_0', _band_0_Product: 'Widget' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', ['_band_0_Product'], ['Product'], { OrderId: 'Order ID', _band_0_Product: 'Product' });
    // Section header + 1 data row
    expect(result.length).toBe(2);
    expect(result[0]).toHaveProperty('_rowKind', 4);
    expect(result[0]['Order ID']).toBeNull(); // match value is null since no parent preceded
    expect(result[1]).toHaveProperty('_rowKind', 0);
    expect(result[1]['Order ID']).toBeNull();
  });

  it('empty bandColAliases produces section header and data rows with only match column', () => {
    const rows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_id: 'band_0' },
    ];
    const result = applyBandGroup(rows, 'band_0', 'OrderId', [], ['Product', 'Qty'], { OrderId: 'Order ID' });
    // parent + section header + data row
    expect(result.length).toBe(3);
    // Section header: match value + empty strings
    expect(result[1]).toHaveProperty('_rowKind', 4);
    expect(result[1]['Order ID']).toBe('ORD-1');
    expect(result[1]['Product']).toBe(''); // empty since no band col aliases
    expect(result[1]['Qty']).toBe('');     // empty since no band col aliases
    // Data row: match value + empty strings
    expect(result[2]).toHaveProperty('_rowKind', 0);
    expect(result[2]['Order ID']).toBe('ORD-1');
    expect(result[2]['Product']).toBe('');
    expect(result[2]['Qty']).toBe('');
  });
});

// ── buildBandColumnLayout Tests ───────────────────────────────────────────────

describe('buildBandColumnLayout', () => {
  const makeBand = (id: string, rightId: string, cols: string[], matchCol: string, enabled = true): DetailBandSpec => ({
    id, rightId, keyPairs: [{ left: matchCol, right: 'id' }], cols, enabled, sorts: [], label: '',
  });

  it('single band single parent produces correct column layout', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product', 'Qty'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product', '_band_0_Qty'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product', _band_0_Qty: 'Qty' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_0_Qty: 5, _band_id: 'band_0' },
    ];
    const { cleanRows, headers, rowKinds } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    expect(headers).toEqual(['Order ID', 'Product', 'Qty']);
    expect(cleanRows).toHaveLength(3); // parent(5) + section header(4) + 1 data(0)
    expect(rowKinds).toEqual([5, 4, 0]);
  });

  it('multiple parents with match value changes', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
      { OrderId: 'ORD-2', _band_id: null },
      { _band_0_Product: 'Sprocket', _band_id: 'band_0' },
    ];
    const { cleanRows, headers } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    expect(headers).toEqual(['Order ID', 'Product']);
    // parent1(5) + header(4) + data(0) + parent2(5) + header(4) + data(0) = 6
    expect(cleanRows).toHaveLength(6);
    expect(cleanRows[0]['Order ID']).toBe('ORD-1');
    expect(cleanRows[3]['Order ID']).toBe('ORD-2');
  });

  it('multiple bands same parent produces section headers for each', () => {
    const bands = [
      makeBand('band_0', 'tbl1', ['Product'], 'OrderId'),
      makeBand('band_1', 'tbl2', ['Note'], 'OrderId'),
    ];
    const allCols = ['OrderId', '_band_0_Product', '_band_1_Note'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product', _band_1_Note: 'Note' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
      { _band_1_Note: 'Rush', _band_id: 'band_1' },
    ];
    const { cleanRows, rowKinds } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    // parent(5) + band0_header(4) + band0_data(0) + band1_header(4) + band1_data(0) = 5
    expect(cleanRows).toHaveLength(5);
    expect(rowKinds).toEqual([5, 4, 0, 4, 0]);
  });

  it('variable band widths — sheet width = 1 + unique labels', () => {
    const bands = [
      makeBand('band_0', 'tbl1', ['Product', 'Qty', 'Price'], 'OrderId'),
      makeBand('band_1', 'tbl2', ['Note'], 'OrderId'),
    ];
    const allCols = ['OrderId', '_band_0_Product', '_band_0_Qty', '_band_0_Price', '_band_1_Note'];
    const hdrMap: Record<string, string> = {
      OrderId: 'Order ID', _band_0_Product: 'Product', _band_0_Qty: 'Qty',
      _band_0_Price: 'Price', _band_1_Note: 'Note',
    };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_0_Qty: 5, _band_0_Price: 10, _band_id: 'band_0' },
      { _band_1_Note: 'Rush', _band_id: 'band_1' },
    ];
    const { headers } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    // 1 match + 4 unique band labels = 5
    expect(headers).toHaveLength(5);
    expect(headers).toEqual(['Order ID', 'Product', 'Qty', 'Price', 'Note']);
  });

  it('parent rows have empty band columns', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
    ];
    const { cleanRows } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    const parentRow = cleanRows[0];
    expect(parentRow['Order ID']).toBe('ORD-1');
    expect(parentRow['Product']).toBe('');
  });

  it('section header has display names from hdrMap', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product Name' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
    ];
    const { cleanRows, headers } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    expect(headers).toEqual(['Order ID', 'Product Name']);
    const sectionHeader = cleanRows[1];
    expect(sectionHeader['Order ID']).toBe('ORD-1');
    expect(sectionHeader['Product Name']).toBe('Product Name');
  });

  it('band data rows have values', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
    ];
    const { cleanRows } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    const dataRow = cleanRows[2];
    expect(dataRow['Order ID']).toBe('ORD-1');
    expect(dataRow['Product']).toBe('Widget');
  });

  it('match value propagates to all band rows', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
      { _band_0_Product: 'Gadget', _band_id: 'band_0' },
    ];
    const { cleanRows } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    // All rows should have 'ORD-1' in match column
    for (const row of cleanRows) {
      expect(row['Order ID']).toBe('ORD-1');
    }
  });

  it('totals row gets kind 3', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
      { _isTotalsRow: true, OrderId: 'TOTAL' },
    ];
    const { rowKinds } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    // Last row should be kind 3 (totals)
    expect(rowKinds[rowKinds.length - 1]).toBe(3);
  });

  it('empty data rows produce empty output', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product' };
    const { cleanRows, rowKinds, headers, bandIds } = buildBandColumnLayout([], bands, allCols, hdrMap);
    expect(cleanRows).toEqual([]);
    expect(rowKinds).toEqual([]);
    expect(headers).toEqual(['Order ID', 'Product']);
    expect(bandIds).toEqual([]);
  });
});

// ── styleExportSheet — band parent (kind 5) styling ──────────────────────────

describe('styleExportSheet — band parent (kind 5) styling', () => {
  it('kind 5 has bold font (not italic)', () => {
    const ws = makeSheet([
      ['Order ID', 'Product'],
      ['ORD-1', ''],
    ]);
    const cleanRows = [{ 'Order ID': 'ORD-1', 'Product': '' }];
    const rowKinds = [5];

    styleExportSheet(ws, cleanRows, rowKinds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const font = style.font as Record<string, unknown>;
    expect(font.bold).toBe(true);
    expect(font.italic).toBeUndefined();
  });

  it('kind 5 has slate-50 fill (FFF8FAFC)', () => {
    const ws = makeSheet([
      ['Order ID'],
      ['ORD-1'],
    ]);
    const cleanRows = [{ 'Order ID': 'ORD-1' }];
    const rowKinds = [5];

    styleExportSheet(ws, cleanRows, rowKinds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const fill = style.fill as Record<string, unknown>;
    const fgColor = fill.fgColor as Record<string, unknown>;
    expect(fgColor.rgb).toBe('FFF8FAFC');
  });

  it('kind 5 has thin bottom border', () => {
    const ws = makeSheet([
      ['Order ID'],
      ['ORD-1'],
    ]);
    const cleanRows = [{ 'Order ID': 'ORD-1' }];
    const rowKinds = [5];

    styleExportSheet(ws, cleanRows, rowKinds);

    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const style = cell.s as Record<string, unknown>;
    const border = style.border as Record<string, unknown>;
    const bottom = border.bottom as Record<string, unknown>;
    expect(bottom.style).toBe('thin');
  });

  it('kind 5 does not affect kinds 0/1/3/4', () => {
    // Test kind 0
    const ws0 = makeSheet([['Col'], ['Data']]);
    styleExportSheet(ws0, [{ Col: 'Data' }], [0]);
    const cell0 = ws0[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const font0 = ((cell0.s as Record<string, unknown>).font as Record<string, unknown>);
    // Kind 0 should not be bold (unless summary)
    expect(font0.bold).toBeFalsy();
    expect((cell0.s as Record<string, unknown>).fill).toBeUndefined();

    // Test kind 4 still has italic
    const ws4 = makeSheet([['Col'], ['Header']]);
    styleExportSheet(ws4, [{ Col: 'Header' }], [4]);
    const cell4 = ws4[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const font4 = ((cell4.s as Record<string, unknown>).font as Record<string, unknown>);
    expect(font4.italic).toBe(true);

    // Test kind 3 still has its own fill
    const ws3 = makeSheet([['Col'], ['Total']]);
    styleExportSheet(ws3, [{ Col: 'Total' }], [3]);
    const cell3 = ws3[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const fill3 = ((cell3.s as Record<string, unknown>).fill as Record<string, unknown>);
    expect((fill3.fgColor as Record<string, unknown>).rgb).toBe('FFE2E8F0');
  });

  it('creates cells for kind 5 row if they do not exist', () => {
    // Sheet with only header cells — range extends to row 1 but no cells there
    const ws: XLSXSheet = {};
    ws[encodeCell({ r: 0, c: 0 })] = { t: 's', v: 'Col1' };
    ws[encodeCell({ r: 0, c: 1 })] = { t: 's', v: 'Col2' };
    ws['!ref'] = 'A1:B2'; // Row 1 has no cells

    const cleanRows = [
      { Col1: 'Parent Row', Col2: '' },
    ];
    const rowKinds = [5];

    styleExportSheet(ws, cleanRows, rowKinds);

    // Cells should have been created for sheet row 1
    const cellA2 = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const cellB2 = ws[encodeCell({ r: 1, c: 1 })] as Record<string, unknown>;
    expect(cellA2).toBeDefined();
    expect(cellB2).toBeDefined();
    expect((cellA2.s as Record<string, unknown>).font).toBeDefined();
    expect((cellB2.s as Record<string, unknown>).font).toBeDefined();
  });

  it('kind 5 has left/center alignment', () => {
    const ws = makeSheet([['Col'], ['Parent']]);
    const cleanRows = [{ Col: 'Parent' }];
    const rowKinds = [5];
    styleExportSheet(ws, cleanRows, rowKinds);
    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const alignment = (cell.s as Record<string, unknown>).alignment as Record<string, unknown>;
    expect(alignment.horizontal).toBe('left');
    expect(alignment.vertical).toBe('center');
  });

  it('kind 5 has font color FF111827', () => {
    const ws = makeSheet([['Col'], ['Parent']]);
    const cleanRows = [{ Col: 'Parent' }];
    const rowKinds = [5];
    styleExportSheet(ws, cleanRows, rowKinds);
    const cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const font = (cell.s as Record<string, unknown>).font as Record<string, unknown>;
    expect(font.color).toEqual({ rgb: 'FF111827' });
  });

  it('kind 5 styling applied to ALL columns in the row', () => {
    const ws = makeSheet([
      ['A', 'B', 'C'],
      ['p', '', ''],
    ]);
    const cleanRows = [{ A: 'p', B: '', C: '' }];
    const rowKinds = [5];
    styleExportSheet(ws, cleanRows, rowKinds);
    for (let c = 0; c < 3; c++) {
      const cell = ws[encodeCell({ r: 1, c })] as Record<string, unknown>;
      expect(cell).toBeDefined();
      const style = cell.s as Record<string, unknown>;
      const font = style.font as Record<string, unknown>;
      expect(font.bold).toBe(true);
      expect(font.italic).toBeUndefined();
      const fill = style.fill as Record<string, unknown>;
      expect(fill.fgColor).toEqual({ rgb: 'FFF8FAFC' });
    }
  });

  it('kind 5 does not affect kind 1 or kind 2 rows', () => {
    const ws = makeSheet([
      ['Col'],
      ['Subtotal'],
      ['Spacer'],
    ]);
    const cleanRows = [{ Col: 'Subtotal' }, { Col: '' }];
    const rowKinds = [1, 2];
    styleExportSheet(ws, cleanRows, rowKinds);
    // Kind 1 should have bold but not slate-50 fill
    const kind1Cell = ws[encodeCell({ r: 1, c: 0 })] as Record<string, unknown>;
    const kind1Style = kind1Cell.s as Record<string, unknown>;
    expect(kind1Style.font).toBeDefined();
    // Kind 2 should not have slate-50 fill
    const kind2Cell = ws[encodeCell({ r: 2, c: 0 })] as Record<string, unknown>;
    const kind2Style = kind2Cell.s as Record<string, unknown>;
    expect(kind2Style.font).toBeDefined();
  });
});

// ── buildBandColumnLayout — integration scenarios ─────────────────────────────

describe('buildBandColumnLayout — integration scenarios', () => {
  const makeBand = (id: string, rightId: string, cols: string[], matchCol: string, enabled = true): DetailBandSpec => ({
    id, rightId, keyPairs: [{ left: matchCol, right: 'id' }], cols, enabled, sorts: [], label: '',
  });

  it('realistic band config with hdrMap produces compact layout', () => {
    const bands = [
      makeBand('band_0', 'tbl-items', ['Product', 'Qty', 'Price'], 'OrderId'),
      makeBand('band_1', 'tbl-notes', ['Note'], 'OrderId'),
    ];
    const allCols = ['OrderId', 'Company', 'Date', '_band_0_Product', '_band_0_Qty', '_band_0_Price', '_band_1_Note'];
    const hdrMap: Record<string, string> = {
      OrderId: 'Order ID', Company: 'Company', Date: 'Date',
      _band_0_Product: 'Product', _band_0_Qty: 'Qty', _band_0_Price: 'Price',
      _band_1_Note: 'Note',
    };
    const dataRows = [
      { OrderId: 'ORD-1', Company: 'Acme', Date: '2026-01-01', _band_id: null },
      { _band_0_Product: 'Widget', _band_0_Qty: 5, _band_0_Price: 10, _band_id: 'band_0' },
      { _band_0_Product: 'Gadget', _band_0_Qty: 2, _band_0_Price: 15, _band_id: 'band_0' },
      { _band_1_Note: 'Rush', _band_id: 'band_1' },
      { OrderId: 'ORD-2', Company: 'Beta', Date: '2026-01-02', _band_id: null },
      { _band_0_Product: 'Sprocket', _band_0_Qty: 1, _band_0_Price: 22.5, _band_id: 'band_0' },
      { _band_1_Note: 'Standard', _band_id: 'band_1' },
    ];
    const { cleanRows, headers, rowKinds, bandIds } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);

    // Headers: match + 4 band labels
    expect(headers).toEqual(['Order ID', 'Product', 'Qty', 'Price', 'Note']);

    // Row structure: parent1(5) + header0(4) + data(0) + data(0) + header1(4) + data(0) + parent2(5) + header0(4) + data(0) + header1(4) + data(0) = 11
    expect(cleanRows).toHaveLength(11);
    expect(rowKinds[0]).toBe(5);   // parent 1
    expect(rowKinds[1]).toBe(4);   // band_0 section header
    expect(rowKinds[4]).toBe(4);   // band_1 section header
    expect(rowKinds[6]).toBe(5);   // parent 2

    // _band_id not in headers
    expect(headers).not.toContain('_band_id');

    // bandIds has entries for data rows
    expect(bandIds[2]).toBe('band_0');
    expect(bandIds[5]).toBe('band_1');
  });

  it('CSV-equivalent output has same compact structure with no _band_id in headers', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId')];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
    ];
    const { cleanRows, headers } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);

    expect(headers).not.toContain('_band_id');
    // Verify cleanRows only have header keys
    for (const row of cleanRows) {
      const keys = Object.keys(row);
      expect(keys).not.toContain('_band_id');
      expect(keys).not.toContain('_processed');
      expect(keys).not.toContain('_rowKind');
    }
  });

  it('all-disabled bands filter results in no transformation', () => {
    const bands = [makeBand('band_0', 'tbl', ['Product'], 'OrderId', false)];
    const allCols = ['OrderId', '_band_0_Product'];
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', _band_0_Product: 'Product' };
    const dataRows = [
      { OrderId: 'ORD-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
    ];
    const { cleanRows, headers } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);
    // No enabled bands → data returned unchanged, empty headers
    expect(cleanRows).toEqual(dataRows);
    expect(headers).toEqual([]);
  });

  it('two bands with different match columns both work independently', () => {
    const bands = [
      makeBand('band_0', 'tbl1', ['Product'], 'OrderId'),
      makeBand('band_1', 'tbl2', ['Note'], 'CustomerId'),
    ];
    const allCols = ['OrderId', 'CustomerId', '_band_0_Product', '_band_1_Note'];
    const hdrMap: Record<string, string> = {
      OrderId: 'Order ID', CustomerId: 'Customer ID',
      _band_0_Product: 'Product', _band_1_Note: 'Note',
    };
    const dataRows = [
      { OrderId: 'ORD-1', CustomerId: 'CUST-1', _band_id: null },
      { _band_0_Product: 'Widget', _band_id: 'band_0' },
      { _band_1_Note: 'Rush', _band_id: 'band_1' },
    ];
    const { cleanRows, headers, rowKinds } = buildBandColumnLayout(dataRows, bands, allCols, hdrMap);

    // Header uses first band's match alias
    expect(headers[0]).toBe('Order ID');
    expect(headers).toContain('Product');
    expect(headers).toContain('Note');

    // Both bands produce section headers
    const kind4Count = rowKinds.filter(k => k === 4).length;
    expect(kind4Count).toBe(2);

    // Parent row
    expect(cleanRows[0]['Order ID']).toBe('ORD-1');
  });
});

// ── exportAs — band layout dispatch tests ─────────────────────────────────────

describe('exportAs — band layout dispatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('band path activates for valid band config and produces compact layout', async () => {
    initStore();
    getStore().update(draft => {
      draft.result = {
        rows: [
          { OrderId: 'ORD-1', _band_id: null, Company: 'Acme' },
          { OrderId: null, _band_id: 'band_0', _band_0_Product: 'Widget', _band_0_Qty: 5 },
        ],
        cols: ['OrderId', 'Company', '_band_0_Product', '_band_0_Qty'],
      };
      draft.detailBands = [
        { id: 'band_0', rightId: 'tbl-items', keyPairs: [{ left: 'OrderId', right: 'OrderId' }], cols: ['Product', 'Qty'], enabled: true, sorts: [], label: 'Items' },
      ];
      draft.tables = {};
    });

    const jsonToSheetSpy = vi.spyOn((globalThis as any).XLSX.utils, 'json_to_sheet');
    await exportAs('xlsx');

    expect(jsonToSheetSpy).toHaveBeenCalled();
    const firstCall = jsonToSheetSpy.mock.calls[0];
    const headers = (firstCall[1] as Record<string, unknown> | undefined)?.header as string[] | undefined;
    // Headers should be band-compact labels, not raw _band_0 aliases
    expect(headers).toBeDefined();
    expect(Array.isArray(headers)).toBe(true);
    // Should NOT contain raw band alias prefixes
    for (const h of headers!) {
      expect(h).not.toMatch(/^_band_/);
    }
  });

  it('CSV band layout produces same compact structure with no _band_id in headers', async () => {
    initStore();
    getStore().update(draft => {
      draft.result = {
        rows: [
          { OrderId: 'ORD-1', _band_id: null, _band_0_Product: null },
          { OrderId: null, _band_id: 'band_0', _band_0_Product: 'Widget' },
        ],
        cols: ['OrderId', '_band_0_Product'],
      };
      draft.detailBands = [
        { id: 'band_0', rightId: 'tbl-items', keyPairs: [{ left: 'OrderId', right: 'OrderId' }], cols: ['Product'], enabled: true, sorts: [], label: 'Items' },
      ];
      draft.tables = {};
    });

    const jsonToSheetSpy = vi.spyOn((globalThis as any).XLSX.utils, 'json_to_sheet');
    await exportAs('csv');

    expect(jsonToSheetSpy).toHaveBeenCalled();
    const firstCall = jsonToSheetSpy.mock.calls[0];
    const headers = (firstCall[1] as Record<string, unknown> | undefined)?.header as string[] | undefined;
    // Headers must not contain _band_id
    expect(headers).toBeDefined();
    expect(headers).not.toContain('_band_id');
  });

  it('non-band path for no bands uses existing headers', async () => {
    initStore();
    getStore().update(draft => {
      draft.result = {
        rows: [
          { OrderId: 'ORD-1', Company: 'Acme', _band_id: null },
        ],
        cols: ['OrderId', 'Company'],
      };
      draft.detailBands = [];
      draft.tables = {};
    });

    const jsonToSheetSpy = vi.spyOn((globalThis as any).XLSX.utils, 'json_to_sheet');
    await exportAs('xlsx');

    expect(jsonToSheetSpy).toHaveBeenCalled();
    const firstCall = jsonToSheetSpy.mock.calls[0];
    const headers = (firstCall[1] as Record<string, unknown> | undefined)?.header as string[] | undefined;
    // Non-band path uses original superset column display names
    expect(headers).toBeDefined();
  });

  it('band layout with multiple bands produces headers from both bands', async () => {
    initStore();
    getStore().update(draft => {
      draft.result = {
        rows: [
          { OrderId: 'ORD-1', _band_id: null, Company: 'Acme', _band_0_Product: null, _band_1_Note: null },
          { OrderId: null, _band_id: 'band_0', _band_0_Product: 'Widget', _band_1_Note: null },
          { OrderId: null, _band_id: 'band_1', _band_0_Product: null, _band_1_Note: 'Urgent' },
        ],
        cols: ['OrderId', 'Company', '_band_0_Product', '_band_1_Note'],
      };
      draft.detailBands = [
        { id: 'band_0', rightId: 'tbl-items', keyPairs: [{ left: 'OrderId', right: 'OrderId' }], cols: ['Product'], enabled: true, sorts: [], label: 'Items' },
        { id: 'band_1', rightId: 'tbl-notes', keyPairs: [{ left: 'OrderId', right: 'OrderId' }], cols: ['Note'], enabled: true, sorts: [], label: 'Notes' },
      ];
      draft.tables = {};
    });

    const jsonToSheetSpy = vi.spyOn((globalThis as any).XLSX.utils, 'json_to_sheet');
    await exportAs('xlsx');

    expect(jsonToSheetSpy).toHaveBeenCalled();
    const firstCall = jsonToSheetSpy.mock.calls[0];
    const headers = (firstCall[1] as Record<string, unknown> | undefined)?.header as string[] | undefined;
    expect(headers).toBeDefined();
    // Headers should include columns from both bands
    expect(headers!.length).toBeGreaterThanOrEqual(2);
  });
});
