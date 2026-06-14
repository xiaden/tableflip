import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ingestSheet } from '../../ui/loader';
import { initStore, getStore } from '../../core/store';

// ── XLSX mock ──────────────────────────────────────────────────────────────
// ingestSheet calls XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: false })
// SheetJS is loaded via script tags and unavailable in jsdom, so we mock it.

beforeAll(() => {
  if (!(globalThis as any).XLSX) {
    (globalThis as any).XLSX = {
      utils: {
        sheet_to_json: (ws: XLSXSheet, opts?: any) => {
          // Read !data dense array, convert to row objects with header keys
          const dense = (ws as any)['!data'];
          if (!dense || dense.length < 2) return [];
          const headers = (dense[0] as any[]).map((h: any) => String(h.v));
          const result: Record<string, unknown>[] = [];
          for (let r = 1; r < dense.length; r++) {
            const row = dense[r] as any[];
            if (!row) continue;
            const obj: Record<string, unknown> = {};
            let hasValue = false;
            for (let c = 0; c < Math.min(row.length, headers.length); c++) {
              const cell = row[c];
              if (cell != null && cell.v !== undefined) {
                obj[headers[c]] = cell.v;
                hasValue = true;
              } else if (opts?.defval !== undefined && opts.defval !== null) {
                obj[headers[c]] = opts.defval;
              } else {
                obj[headers[c]] = null;
              }
            }
            if (hasValue || opts?.blankrows !== false) {
              result.push(obj);
            }
          }
          return result;
        },
      },
    };
  }
});

beforeEach(() => {
  initStore();
});

// ── Helper ──────────────────────────────────────────────────────────────────

/**
 * Build a mock XLSXWorkbook with a single sheet containing dense data.
 * Headers are strings; data cells are { t, v, z? } objects matching SheetJS dense format.
 */
function makeWorkbook(
  sheetName: string,
  headers: { v: string }[],
  dataRows: ({ t: string; v: unknown; z?: string } | null | undefined)[][]
): XLSXWorkbook {
  const dense: unknown[][] = [
    headers.map(h => ({ t: 's', v: h.v })),
    ...dataRows.map(row => row.map(cell => (cell == null ? null : cell))),
  ];
  const ws: XLSXSheet = {
    '!data': dense,
    '!ref': `A1:${String.fromCharCode(64 + headers.length)}${dataRows.length + 1}`,
  };
  return {
    SheetNames: [sheetName],
    Sheets: { [sheetName]: ws },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ingestSheet colTypes integration', () => {
  it('stores colTypes on DbTable for mixed-type data', () => {
    const wb = makeWorkbook(
      'Sheet1',
      [{ v: 'Name' }, { v: 'Qty' }, { v: 'Created' }],
      [
        [{ t: 's', v: 'Alice' }, { t: 'n', v: 10 }, { t: 'd', v: new Date('2024-01-01') }],
        [{ t: 's', v: 'Bob' }, { t: 'n', v: 20 }, { t: 'd', v: new Date('2024-02-01') }],
        [{ t: 's', v: 'Charlie' }, { t: 'n', v: 30 }, { t: 'd', v: new Date('2024-03-01') }],
      ]
    );

    const store = getStore();
    ingestSheet(wb, 'Sheet1', 'MixedData', store);

    const state = store.getState();
    const tableId = 't_mixeddata';
    expect(state.tables[tableId]).toBeDefined();
    expect(state.tables[tableId].colTypes).toBeDefined();
    expect(state.tables[tableId].colTypes).toEqual({
      Name: 'string',
      Qty: 'number',
      Created: 'date',
    });
  });

  it('stores colTypes with all-string values for CSV-style data', () => {
    const wb = makeWorkbook(
      'Sheet1',
      [{ v: 'Col1' }, { v: 'Col2' }, { v: 'Col3' }],
      [
        [{ t: 's', v: 'a' }, { t: 's', v: 'b' }, { t: 's', v: 'c' }],
        [{ t: 's', v: 'd' }, { t: 's', v: 'e' }, { t: 's', v: 'f' }],
        [{ t: 's', v: 'g' }, { t: 's', v: 'h' }, { t: 's', v: 'i' }],
      ]
    );

    const store = getStore();
    ingestSheet(wb, 'Sheet1', 'CSVData', store);

    const state = store.getState();
    const tableId = 't_csvdata';
    expect(state.tables[tableId]).toBeDefined();
    expect(state.tables[tableId].colTypes).toBeDefined();
    expect(state.tables[tableId].colTypes).toEqual({
      Col1: 'string',
      Col2: 'string',
      Col3: 'string',
    });
  });

  it('does NOT store colTypes for empty sheet (no data rows)', () => {
    const wb = makeWorkbook(
      'Sheet1',
      [{ v: 'Col1' }, { v: 'Col2' }],
      []
    );

    const store = getStore();
    ingestSheet(wb, 'Sheet1', 'EmptySheet', store);

    const state = store.getState();
    const tableId = 't_emptysheet';
    // ingestSheet returns early with toast('No rows found...') when rawData is empty
    // So the table is never created in the store
    expect(state.tables[tableId]).toBeUndefined();
  });

  it('does NOT store colTypes for non-dense sheet', () => {
    // Non-dense sheet: has !ref but no !data
    const ws: XLSXSheet = {
      '!ref': 'A1:B3',
      A1: { t: 's', v: 'Col1' },
      B1: { t: 's', v: 'Col2' },
      A2: { t: 's', v: 'a' },
      B2: { t: 's', v: 'b' },
    };
    const wb: XLSXWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: ws },
    };

    const store = getStore();
    ingestSheet(wb, 'Sheet1', 'NonDense', store);

    const state = store.getState();
    const tableId = 't_nondense';
    // scanCellTypes returns {} for non-dense sheets, so colTypes is excluded by conditional spread
    // But the table itself should still be created (sheet_to_json will return empty array for non-dense)
    // Actually, our mock sheet_to_json returns [] when !data is missing, so ingestSheet returns early
    expect(state.tables[tableId]).toBeUndefined();
  });

  it('excludes _rowno from colTypes', () => {
    const wb = makeWorkbook(
      'Sheet1',
      [{ v: '_rowno' }, { v: 'Amount' }],
      [
        [{ t: 'n', v: 1 }, { t: 'n', v: 100 }],
        [{ t: 'n', v: 2 }, { t: 'n', v: 200 }],
        [{ t: 'n', v: 3 }, { t: 'n', v: 300 }],
      ]
    );

    const store = getStore();
    ingestSheet(wb, 'Sheet1', 'WithRowno', store);

    const state = store.getState();
    const tableId = 't_withrowno';
    expect(state.tables[tableId]).toBeDefined();
    expect(state.tables[tableId].colTypes).toBeDefined();
    expect(state.tables[tableId].colTypes).toHaveProperty('Amount', 'number');
    expect(state.tables[tableId].colTypes).not.toHaveProperty('_rowno');
  });

  it('stores colTypes with date-format override (numeric cells with date format)', () => {
    const wb = makeWorkbook(
      'Sheet1',
      [{ v: 'DateCol' }, { v: 'Name' }],
      [
        [{ t: 'n', v: 44927, z: 'yyyy-mm-dd' }, { t: 's', v: 'Alice' }],
        [{ t: 'n', v: 44928, z: 'yyyy-mm-dd' }, { t: 's', v: 'Bob' }],
        [{ t: 'n', v: 44929, z: 'yyyy-mm-dd' }, { t: 's', v: 'Charlie' }],
      ]
    );

    const store = getStore();
    ingestSheet(wb, 'Sheet1', 'DateOverride', store);

    const state = store.getState();
    const tableId = 't_dateoverride';
    expect(state.tables[tableId]).toBeDefined();
    expect(state.tables[tableId].colTypes).toBeDefined();
    expect(state.tables[tableId].colTypes).toEqual({
      DateCol: 'date',
      Name: 'string',
    });
  });
});
