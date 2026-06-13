import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  filterExportCols,
  buildBandLabels,
  enrichRowsWithBandHeaders,
  styleExportSheet,
} from '../../ui/export';
import { initStore } from '../../core/store';
import type { DetailBandSpec, DbTable } from '../../types';

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
    },
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

  it('works without bandIds parameter (backward compatibility)', () => {
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
