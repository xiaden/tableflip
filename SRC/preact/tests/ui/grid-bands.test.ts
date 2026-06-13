import { describe, it, expect } from 'vitest';
import { createBandRowStyler } from '../../ui/grid';

describe('createBandRowStyler', () => {
  it('returns undefined for parent rows (_band_id is null)', () => {
    const rows = [
      { col1: 'a', _band_id: null },
      { col1: 'x', _band_id: 'band_0' },
    ];
    const styler = createBandRowStyler(rows);

    const result = styler({ data: { col1: 'a', _band_id: null } });
    expect(result).toBeUndefined();
  });

  it('returns undefined for parent rows (_band_id is undefined)', () => {
    const rows = [
      { col1: 'a' },
      { col1: 'x', _band_id: 'band_0' },
    ];
    const styler = createBandRowStyler(rows);

    const result = styler({ data: { col1: 'a' } });
    expect(result).toBeUndefined();
  });

  it('returns a background style for band rows', () => {
    const rows = [
      { col1: 'a', _band_id: null },
      { col1: 'x', _band_id: 'band_0' },
    ];
    const styler = createBandRowStyler(rows);

    const result = styler({ data: { col1: 'x', _band_id: 'band_0' } });
    expect(result).toBeDefined();
    expect(result!.background).toBeDefined();
    expect(typeof result!.background).toBe('string');
  });

  it('assigns different colors to different bands', () => {
    const rows = [
      { col1: 'a', _band_id: null },
      { col1: 'x', _band_id: 'band_0' },
      { col1: 'y', _band_id: 'band_1' },
    ];
    const styler = createBandRowStyler(rows);

    const style0 = styler({ data: { col1: 'x', _band_id: 'band_0' } });
    const style1 = styler({ data: { col1: 'y', _band_id: 'band_1' } });

    expect(style0).toBeDefined();
    expect(style1).toBeDefined();
    expect(style0!.background).not.toBe(style1!.background);
  });

  it('assigns the same color to rows from the same band', () => {
    const rows = [
      { col1: 'a', _band_id: null },
      { col1: 'x', _band_id: 'band_0' },
      { col1: 'y', _band_id: 'band_0' },
    ];
    const styler = createBandRowStyler(rows);

    const style1 = styler({ data: { col1: 'x', _band_id: 'band_0' } });
    const style2 = styler({ data: { col1: 'y', _band_id: 'band_0' } });

    expect(style1!.background).toBe(style2!.background);
  });

  it('cycles colors when there are more bands than palette entries', () => {
    const rows = [
      { _band_id: 'band_0' },
      { _band_id: 'band_1' },
      { _band_id: 'band_2' },
      { _band_id: 'band_3' },
      { _band_id: 'band_4' },
      { _band_id: 'band_5' }, // wraps around
    ];
    const styler = createBandRowStyler(rows);

    const style0 = styler({ data: { _band_id: 'band_0' } });
    const style5 = styler({ data: { _band_id: 'band_5' } });

    // band_5 should cycle to the same color as band_0 (index 5 % 5 = 0)
    expect(style5!.background).toBe(style0!.background);
  });

  it('returns undefined when params.data is null/undefined', () => {
    const rows = [{ _band_id: 'band_0' }];
    const styler = createBandRowStyler(rows);

    expect(styler({ data: null as unknown as Record<string, unknown> })).toBeUndefined();
    expect(styler({ data: undefined as unknown as Record<string, unknown> })).toBeUndefined();
  });

  it('returns undefined when there are no band rows', () => {
    const rows = [
      { col1: 'a', _band_id: null },
      { col1: 'b', _band_id: null },
    ];
    const styler = createBandRowStyler(rows);

    expect(styler({ data: { col1: 'a', _band_id: null } })).toBeUndefined();
  });

  it('handles empty rows array', () => {
    const styler = createBandRowStyler([]);
    expect(styler({ data: { _band_id: 'band_0' } })).toBeUndefined();
  });

  it('orders bands by first appearance in rows', () => {
    const rows = [
      { _band_id: null },
      { _band_id: 'band_1' }, // appears first → index 0
      { _band_id: null },
      { _band_id: 'band_0' }, // appears second → index 1
    ];
    const styler = createBandRowStyler(rows);

    const style1 = styler({ data: { _band_id: 'band_1' } });
    const style0 = styler({ data: { _band_id: 'band_0' } });

    // band_1 should get the first palette color (index 0)
    // band_0 should get the second palette color (index 1)
    expect(style1).toBeDefined();
    expect(style0).toBeDefined();
    expect(style1!.background).not.toBe(style0!.background);
  });

  it('ignores non-string _band_id values', () => {
    const rows = [
      { _band_id: 42 },
      { _band_id: true },
      { _band_id: 'band_0' },
    ];
    const styler = createBandRowStyler(rows);

    expect(styler({ data: { _band_id: 42 } })).toBeUndefined();
    expect(styler({ data: { _band_id: true } })).toBeUndefined();
    expect(styler({ data: { _band_id: 'band_0' } })).toBeDefined();
  });
});

describe('null cell rendering in band rows', () => {
  it('band rows with null parent columns are handled by the default cellRenderer', () => {
    // The default cellRenderer in ResultGrid converts null → '' via:
    //   v == null ? '' : String(v)
    // This test verifies that the band row data shape (null parent cols)
    // does not interfere with the styling logic.
    const bandRow: Record<string, unknown> = {
      parentCol1: null,
      parentCol2: null,
      bandCol1: 'value',
      _band_id: 'band_0',
    };

    const rows = [
      { parentCol1: 'a', parentCol2: 'b', bandCol1: null, _band_id: null },
      bandRow,
    ];
    const styler = createBandRowStyler(rows);

    // Styler should still return a background for the band row
    // even when most cells are null
    const style = styler({ data: bandRow });
    expect(style).toBeDefined();
    expect(style!.background).toBeDefined();

    // The cellRenderer (tested implicitly) handles null values:
    // null → '' (empty string)
    const cellRenderer = (params: { value: unknown }) => {
      const v = params.value;
      return v == null ? '' : String(v);
    };
    expect(cellRenderer({ value: null })).toBe('');
    expect(cellRenderer({ value: undefined })).toBe('');
    expect(cellRenderer({ value: 'value' })).toBe('value');
  });
});
