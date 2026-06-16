/**
 * Tests for ui/export.ts — band export functions.
 *
 * Covers buildExportFromDescriptors() (parent rows, section headers, band data rows,
 * row kind assignment, label resolution, CSV path, edge cases), filterExportCols(),
 * buildBandLabels(), and styleExportSheet() (kind 4/5 band styling, tint styling).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  filterExportCols,
  buildBandLabels,
  buildExportFromDescriptors,
  styleExportSheet,
} from '../../ui/export';
import { initStore } from '../../core/store';
import type { DetailBandSpec, DbTable, OverlayDescriptor } from '../../types';

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

// ── buildExportFromDescriptors tests ─────────────────────────────────────────

describe('buildExportFromDescriptors — parent rows', () => {
  const parentCols = ['OrderId', 'Company'];
  const hdrMap: Record<string, string> = { OrderId: 'Order ID', Company: 'Company Name' };

  it('produces row with all parent columns populated', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.cleanRows).toHaveLength(1);
    expect(result.cleanRows[0]['Order ID']).toBe('ORD-1');
    expect(result.cleanRows[0]['Company Name']).toBe('Acme');
  });

  it('row kind is 5 (band parent row)', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.rowKinds).toEqual([5]);
  });

  it('parent data values match descriptor data', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-42', Company: 'Globex' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.cleanRows[0]['Order ID']).toBe('ORD-42');
    expect(result.cleanRows[0]['Company Name']).toBe('Globex');
  });

  it('internal keys starting with _ pass through as-is', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', _row_type: 0, _isTotalsRow: false }, columns: ['OrderId'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // Internal keys are copied to intermediate row but cleanRows is projected to headers.
    // The key behavior: _isTotalsRow=false means kind 5 (not 3).
    expect(result.rowKinds).toEqual([5]);
  });

  it('totals row (_isTotalsRow: true) has kind 3', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'TOTAL', _isTotalsRow: true }, columns: ['OrderId'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.rowKinds).toEqual([3]);
  });
});

describe('buildExportFromDescriptors — section headers', () => {
  const parentCols = ['OrderId', 'Company', 'Amount'];
  const hdrMap: Record<string, string> = {
    OrderId: 'Order ID',
    Company: 'Company',
    Amount: 'Amount',
    '_band_0_Product': '_band_0_Product',
    '_band_0_Qty': '_band_0_Qty',
  };

  it('produces section header row with match value in col 0 and band column display names', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: ['Product', 'Qty'], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // Section header is the second row (index 1)
    expect(result.cleanRows).toHaveLength(2);
    expect(result.cleanRows[1]['Order ID']).toBe('Acme');
    expect(result.cleanRows[1]['Company']).toBe('Product');
    expect(result.cleanRows[1]['Amount']).toBe('Qty');
  });

  it('row kind is 4', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: ['Product'], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.rowKinds).toEqual([5, 4]);
  });

  it('_band_id is NOT set on section header row (bandIds entry is empty)', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: ['Product'], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.bandIds[1]).toBe('');
  });

  it('band column prefix stripping: _band_0_Product → Product via hdrMap lookup at prefixed key', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: ['Product'], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // hdrMap['_band_0_Product'] = '_band_0_Product', then strip _band_\d+_ → 'Product'
    expect(result.cleanRows[1]['Company']).toBe('Product');
  });

  it('section header skipped for CSV (isCsv=true)', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: ['Product'], matchValue: 'Acme', depth: 0 },
      { type: 'band-row', bandId: 'band_0', data: { _band_0_Product: 'Widget' }, columns: ['Product'], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap, true);
    // CSV skips section headers: parent + band-row = 2 rows
    expect(result.cleanRows).toHaveLength(2);
    expect(result.rowKinds).toEqual([5, 0]);
  });
});

describe('buildExportFromDescriptors — band data rows', () => {
  const parentCols = ['OrderId', 'Company', 'Amount'];
  const hdrMap: Record<string, string> = {
    OrderId: 'Order ID',
    Company: 'Company',
    Amount: 'Amount',
  };

  it('produces row with empty column 0 and band values in parent column positions', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-row', bandId: 'band_0', data: { _band_0_Product: 'Widget', _band_0_Qty: 5 }, columns: ['Product', 'Qty'], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.cleanRows[1]['Order ID']).toBe('');
    expect(result.cleanRows[1]['Company']).toBe('Widget');
    expect(result.cleanRows[1]['Amount']).toBe(5);
  });

  it('row kind is 0', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-row', bandId: 'band_0', data: { _band_0_Product: 'Widget' }, columns: ['Product'], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.rowKinds[1]).toBe(0);
  });

  it('bandIds entry contains the band bandId for tint styling tracking', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-row', bandId: 'band_0', data: { _band_0_Product: 'Widget' }, columns: ['Product'], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.bandIds[1]).toBe('band_0');
  });

  it('band values populated from prefixed keys in descriptor.data', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-row', bandId: 'band_0', data: { _band_0_Product: 'Gadget', _band_0_Qty: 10 }, columns: ['Product', 'Qty'], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.cleanRows[1]['Company']).toBe('Gadget');
    expect(result.cleanRows[1]['Amount']).toBe(10);
  });

  it('band data row fills remaining positions with empty strings', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme', Amount: 100 }, columns: ['OrderId', 'Company', 'Amount'] },
      { type: 'band-row', bandId: 'band_0', data: { _band_0_Product: 'Widget' }, columns: ['Product'], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // Only 1 band column (Product → Company position), Amount position should be empty
    expect(result.cleanRows[1]['Amount']).toBe('');
  });
});

describe('buildExportFromDescriptors — row kind assignment', () => {
  const parentCols = ['OrderId', 'Company'];
  const hdrMap: Record<string, string> = { OrderId: 'Order ID', Company: 'Company' };

  it('ParentDescriptor produces kind 5', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.rowKinds).toEqual([5]);
  });

  it('BandSectionDescriptor produces kind 4', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: [], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.rowKinds[1]).toBe(4);
  });

  it('BandRowDescriptor produces kind 0', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-row', bandId: 'band_0', data: {}, columns: [], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.rowKinds[1]).toBe(0);
  });

  it('mixed descriptor sequence produces correct rowKinds array', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: [], matchValue: 'Acme', depth: 0 },
      { type: 'band-row', bandId: 'band_0', data: {}, columns: [], depth: 0 },
      { type: 'band-row', bandId: 'band_0', data: {}, columns: [], depth: 0 },
      { type: 'parent', data: { OrderId: 'ORD-2', Company: 'Globex' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.rowKinds).toEqual([5, 4, 0, 0, 5]);
  });
});

describe('buildExportFromDescriptors — label resolution', () => {
  const parentCols = ['OrderId', 'Company'];

  it('hdrMap lookup resolves raw aliases to display labels for headers', () => {
    const hdrMap: Record<string, string> = { OrderId: 'Order ID', Company: 'Company Name' };
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.headers).toEqual(['Order ID', 'Company Name']);
  });

  it('prefix stripped from prefixed keys for section header display labels', () => {
    const hdrMap: Record<string, string> = {
      OrderId: 'Order ID',
      Company: 'Company',
      '_band_0_Product': '_band_0_Product',
    };
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: ['Product'], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // hdrMap['_band_0_Product'] = '_band_0_Product', strip _band_\d+_ → 'Product'
    expect(result.cleanRows[1]['Company']).toBe('Product');
  });

  it('missing hdrMap entry falls back to raw column name', () => {
    const hdrMap: Record<string, string> = {
      OrderId: 'Order ID',
      Company: 'Company',
      // No entry for '_band_0_Product'
    };
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: ['Product'], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // Fallback: rawLabel = col = 'Product', strip → 'Product'
    expect(result.cleanRows[1]['Company']).toBe('Product');
  });
});

describe('buildExportFromDescriptors — CSV path', () => {
  const parentCols = ['OrderId', 'Company'];
  const hdrMap: Record<string, string> = { OrderId: 'Order ID', Company: 'Company' };

  it('CSV format skips section header insertion', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: [], matchValue: 'Acme', depth: 0 },
      { type: 'band-row', bandId: 'band_0', data: {}, columns: [], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap, true);
    // CSV skips section headers: parent + band-row = 2 rows
    expect(result.cleanRows).toHaveLength(2);
    expect(result.rowKinds).not.toContain(4);
  });

  it('CSV still produces correct parent and band data rows', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-row', bandId: 'band_0', data: { _band_0_Product: 'Widget' }, columns: ['Product'], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap, true);
    expect(result.cleanRows).toHaveLength(2);
    expect(result.cleanRows[0]['Order ID']).toBe('ORD-1');
    expect(result.cleanRows[1]['Order ID']).toBe('');
  });

  it('CSV rowKinds are all 5 for parents, 0 for band rows (no 4)', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: [], matchValue: 'Acme', depth: 0 },
      { type: 'band-row', bandId: 'band_0', data: {}, columns: [], depth: 0 },
      { type: 'parent', data: { OrderId: 'ORD-2', Company: 'Globex' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap, true);
    expect(result.rowKinds).toEqual([5, 0, 5]);
  });
});

describe('buildExportFromDescriptors — output structure', () => {
  const parentCols = ['OrderId', 'Company'];
  const hdrMap: Record<string, string> = { OrderId: 'Order ID', Company: 'Company' };

  it('returned object has cleanRows, rowKinds, headers, bandIds fields', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result).toHaveProperty('cleanRows');
    expect(result).toHaveProperty('rowKinds');
    expect(result).toHaveProperty('headers');
    expect(result).toHaveProperty('bandIds');
    expect(Array.isArray(result.cleanRows)).toBe(true);
    expect(Array.isArray(result.rowKinds)).toBe(true);
    expect(Array.isArray(result.headers)).toBe(true);
    expect(Array.isArray(result.bandIds)).toBe(true);
  });

  it('headers array contains resolved display labels from hdrMap', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.headers).toEqual(['Order ID', 'Company']);
  });

  it('bandIds array tracks band transitions for tint styling', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: [], matchValue: 'Acme', depth: 0 },
      { type: 'band-row', bandId: 'band_0', data: {}, columns: [], depth: 0 },
      { type: 'band-row', bandId: 'band_0', data: {}, columns: [], depth: 0 },
      { type: 'parent', data: { OrderId: 'ORD-2', Company: 'Globex' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_1', bandLabel: 'Notes', bandColumns: [], matchValue: 'Globex', depth: 0 },
      { type: 'band-row', bandId: 'band_1', data: {}, columns: [], depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // parent(''), section(''), band_0, band_0, parent(''), section(''), band_1
    expect(result.bandIds).toEqual(['', '', 'band_0', 'band_0', '', '', 'band_1']);
  });
});

describe('buildExportFromDescriptors — edge cases', () => {
  const parentCols = ['OrderId', 'Company'];
  const hdrMap: Record<string, string> = { OrderId: 'Order ID', Company: 'Company' };

  it('empty descriptor array', () => {
    const result = buildExportFromDescriptors([], parentCols, hdrMap);
    expect(result.cleanRows).toEqual([]);
    expect(result.rowKinds).toEqual([]);
    expect(result.bandIds).toEqual([]);
    // Headers should still be computed from parentCols
    expect(result.headers).toEqual(['Order ID', 'Company']);
  });

  it('descriptors with only parent rows (no bands)', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'parent', data: { OrderId: 'ORD-2', Company: 'Globex' }, columns: ['OrderId', 'Company'] },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    expect(result.cleanRows).toHaveLength(2);
    expect(result.rowKinds).toEqual([5, 5]);
    expect(result.bandIds).toEqual(['', '']);
  });

  it('section header with unknown band ID (fallback to raw column name)', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'unknown_band', bandLabel: 'Unknown', bandColumns: ['Foo'], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // hdrMap doesn't have '_unknown_band_Foo', so rawLabel = col = 'Foo'
    // 'Foo'.replace(/^_band_\d+_/, '') = 'Foo' (no prefix to strip)
    expect(result.cleanRows[1]['Company']).toBe('Foo');
  });

  it('band columns wider than P-1 positions (extra headers appended)', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { OrderId: 'ORD-1', Company: 'Acme' }, columns: ['OrderId', 'Company'] },
      { type: 'band-section', bandId: 'band_0', bandLabel: 'Items', bandColumns: ['Product', 'Qty', 'Price'], matchValue: 'Acme', depth: 0 },
    ];
    const result = buildExportFromDescriptors(descriptors, parentCols, hdrMap);
    // P = 2, maxBandWidth = 3, P-1 = 1, so 3 > 1 → extra headers appended
    // headers = ['Order ID', 'Company', 'Qty', 'Price']
    expect(result.headers).toEqual(['Order ID', 'Company', 'Qty', 'Price']);
  });
});
