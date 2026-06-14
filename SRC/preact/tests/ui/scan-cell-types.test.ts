import { describe, it, expect } from 'vitest';
import { scanCellTypes } from '../../ui/loader';

/**
 * Helper: build a mock dense worksheet from a header array and data rows.
 * Each cell is an object with { t, v, z? } matching SheetJS dense format.
 */
function makeSheet(
  headers: { v: string }[],
  dataRows: ({ t: string; v: unknown; z?: string } | null | undefined)[][]
): XLSXSheet {
  const dense: unknown[][] = [
    headers.map(h => ({ t: 's', v: h.v })),
    ...dataRows.map(row =>
      row.map(cell => (cell == null ? null : cell))
    ),
  ];
  return { '!data': dense } as unknown as XLSXSheet;
}

describe('scanCellTypes', () => {
  // P3-S2: majority number column
  it('detects majority number column', () => {
    const ws = makeSheet(
      [{ v: 'Amount' }],
      [
        [{ t: 'n', v: 10 }],
        [{ t: 'n', v: 20 }],
        [{ t: 'n', v: 30 }],
        [{ t: 'n', v: 40 }],
        [{ t: 'n', v: 50 }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Amount: 'number' });
  });

  // P3-S3: majority string column
  it('detects majority string column', () => {
    const ws = makeSheet(
      [{ v: 'Name' }],
      [
        [{ t: 's', v: 'Alice' }],
        [{ t: 's', v: 'Bob' }],
        [{ t: 's', v: 'Charlie' }],
        [{ t: 's', v: 'Diana' }],
        [{ t: 's', v: 'Eve' }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Name: 'string' });
  });

  // P3-S4: majority date column
  it('detects majority date column', () => {
    const ws = makeSheet(
      [{ v: 'Created' }],
      [
        [{ t: 'd', v: new Date('2024-01-01') }],
        [{ t: 'd', v: new Date('2024-02-01') }],
        [{ t: 'd', v: new Date('2024-03-01') }],
        [{ t: 'd', v: new Date('2024-04-01') }],
        [{ t: 'd', v: new Date('2024-05-01') }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Created: 'date' });
  });

  // P3-S5: majority boolean column
  it('detects majority boolean column', () => {
    const ws = makeSheet(
      [{ v: 'Active' }],
      [
        [{ t: 'b', v: true }],
        [{ t: 'b', v: false }],
        [{ t: 'b', v: true }],
        [{ t: 'b', v: true }],
        [{ t: 'b', v: false }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Active: 'boolean' });
  });

  // P3-S6: mixed types with clear majority
  it('picks number when 4 number vs 1 string', () => {
    const ws = makeSheet(
      [{ v: 'Val' }],
      [
        [{ t: 'n', v: 1 }],
        [{ t: 'n', v: 2 }],
        [{ t: 'n', v: 3 }],
        [{ t: 'n', v: 4 }],
        [{ t: 's', v: 'oops' }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Val: 'number' });
  });

  // P3-S7: tie-breaking — first encountered wins
  it('breaks ties by first-encountered type (number before string)', () => {
    const ws = makeSheet(
      [{ v: 'Mix' }],
      [
        [{ t: 'n', v: 1 }],
        [{ t: 's', v: 'a' }],
        [{ t: 'n', v: 2 }],
        [{ t: 's', v: 'b' }],
      ]
    );
    const result = scanCellTypes(ws);
    // 2 number, 2 string — first encountered is 'n' so number wins
    expect(result).toEqual({ Mix: 'number' });
  });

  // P3-S8: date-format override — all numeric cells have date format
  it('overrides number to date when all numeric cells have date format', () => {
    const ws = makeSheet(
      [{ v: 'DateCol' }],
      [
        [{ t: 'n', v: 44927, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 44928, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 44929, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 44930, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 44931, z: 'yyyy-mm-dd' }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ DateCol: 'date' });
  });

  // P3-S9: date-format override threshold — 3/5 = 60% > 50%
  it('overrides to date when 60% of numeric cells have date format', () => {
    const ws = makeSheet(
      [{ v: 'Mixed' }],
      [
        [{ t: 'n', v: 44927, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 44928, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 44929, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 100, z: '#,##0' }],
        [{ t: 'n', v: 200, z: '#,##0' }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Mixed: 'date' });
  });

  // P3-S10: date-format override NOT triggered — 2/5 = 40% ≤ 50%
  it('stays number when only 40% of numeric cells have date format', () => {
    const ws = makeSheet(
      [{ v: 'Mixed' }],
      [
        [{ t: 'n', v: 44927, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 44928, z: 'yyyy-mm-dd' }],
        [{ t: 'n', v: 100, z: '#,##0' }],
        [{ t: 'n', v: 200, z: '#,##0' }],
        [{ t: 'n', v: 300, z: '#,##0' }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Mixed: 'number' });
  });

  // P3-S11: _rowno column skipped
  it('skips _rowno column in result', () => {
    const ws = makeSheet(
      [{ v: '_rowno' }, { v: 'Amount' }],
      [
        [{ t: 'n', v: 1 }, { t: 'n', v: 100 }],
        [{ t: 'n', v: 2 }, { t: 'n', v: 200 }],
        [{ t: 'n', v: 3 }, { t: 'n', v: 300 }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toHaveProperty('Amount', 'number');
    expect(result).not.toHaveProperty('_rowno');
  });

  // P3-S12: null/empty cells ignored
  it('ignores null and empty cells', () => {
    // Build sheet manually to allow null/undefined cells within rows
    const dense: unknown[][] = [
      [{ t: 's', v: 'X' }],           // header
      [{ t: 'n', v: 1 }],             // valid number
      [{ t: 'n', v: 2 }],             // valid number
      [null],                          // null cell
      [undefined],                     // undefined cell
      [{ t: 'z', v: undefined }],     // stub cell
    ];
    const ws = { '!data': dense } as unknown as XLSXSheet;
    const result = scanCellTypes(ws);
    expect(result).toEqual({ X: 'number' });
  });

  // P3-S13: error cells skipped
  it('skips error cells (t=e)', () => {
    const ws = makeSheet(
      [{ v: 'E' }],
      [
        [{ t: 'e', v: '#DIV/0!' }],
        [{ t: 'e', v: '#N/A' }],
        [{ t: 'e', v: '#VALUE!' }],
        [{ t: 's', v: 'hello' }],
        [{ t: 's', v: 'world' }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ E: 'string' });
  });

  // P3-S14: multiple columns with different types
  it('detects correct type per column for multiple columns', () => {
    const ws = makeSheet(
      [{ v: 'Name' }, { v: 'Qty' }, { v: 'Date' }],
      [
        [{ t: 's', v: 'Alice' }, { t: 'n', v: 10 }, { t: 'd', v: new Date('2024-01-01') }],
        [{ t: 's', v: 'Bob' }, { t: 'n', v: 20 }, { t: 'd', v: new Date('2024-02-01') }],
        [{ t: 's', v: 'Charlie' }, { t: 'n', v: 30 }, { t: 'd', v: new Date('2024-03-01') }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({
      Name: 'string',
      Qty: 'number',
      Date: 'date',
    });
  });

  // P3-S15: non-dense worksheet returns empty object
  it('returns empty object for non-dense worksheet', () => {
    // A plain object with no '!data' and not an array
    const ws = { '!ref': 'A1:B3' } as unknown as XLSXSheet;
    const result = scanCellTypes(ws);
    expect(result).toEqual({});
  });

  // P3-S16: empty worksheet (header only, no data rows) returns empty object
  it('returns empty object for header-only worksheet', () => {
    const ws = makeSheet(
      [{ v: 'Col1' }, { v: 'Col2' }],
      []
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({});
  });

  // Null header cell — column silently dropped
  it('silently drops columns with null header cells', () => {
    const dense: unknown[][] = [
      [{ t: 's', v: 'Label' }, { v: null }],
      [{ t: 's', v: 'A' }, { t: 'n', v: 100 }],
      [{ t: 's', v: 'B' }, { t: 'n', v: 200 }],
      [{ t: 's', v: 'C' }, { t: 'n', v: 300 }],
    ];
    const ws = { '!data': dense } as unknown as XLSXSheet;
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Label: 'string' });
    expect(Object.keys(result)).toHaveLength(1);
  });

  // Sparse dense array — null row between data rows is skipped
  it('skips null rows in sparse dense arrays', () => {
    const dense: unknown[][] = [
      [{ t: 's', v: 'Val' }],
      [{ t: 'n', v: 1 }],
      null as unknown as unknown[],
      [{ t: 'n', v: 2 }],
    ];
    const ws = { '!data': dense } as unknown as XLSXSheet;
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Val: 'number' });
  });

  // All-skipped column — valid header but all data cells are errors/stubs/null
  it('omits columns where all data cells are errors', () => {
    const ws = makeSheet(
      [{ v: 'Name' }, { v: 'Notes' }],
      [
        [{ t: 's', v: 'Alice' }, { t: 'e', v: '#N/A' }],
        [{ t: 's', v: 'Bob' }, { t: 'e', v: '#DIV/0!' }],
        [{ t: 's', v: 'Charlie' }, { t: 'e', v: '#VALUE!' }],
      ]
    );
    const result = scanCellTypes(ws);
    expect(result).toEqual({ Name: 'string' });
    expect(result).not.toHaveProperty('Notes');
  });
});
