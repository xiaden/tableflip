import { describe, it, expect } from 'vitest';
import { createBandRowStyler, descriptorsToGridRows, BandHeaderRenderer, BAND_ROW_TINTS } from '../../ui/grid';
import type { OverlayDescriptor } from '../../types';

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

describe('descriptorsToGridRows', () => {
  it('returns empty array for empty descriptors', () => {
    expect(descriptorsToGridRows([], ['a'], {})).toEqual([]);
  });

  it('parent row: retains data and pads band columns with empty string', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { name: 'Alice', age: 30 }, columns: ['name', 'age'] },
    ];
    const rows = descriptorsToGridRows(descriptors, ['name', 'age'], { band_0: ['salary'] });

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
    expect(rows[0].age).toBe(30);
    expect(rows[0].salary).toBe('');
    expect(rows[0]._isBandHeader).toBeUndefined();
    expect(rows[0]._band_id).toBeUndefined();
  });

  it('band-section: produces synthetic header row with all superset cols empty', () => {
    const descriptors: OverlayDescriptor[] = [
      {
        type: 'band-section',
        bandId: 'band_0',
        bandLabel: 'Orders',
        bandColumns: ['order_id', 'total'],
        matchValue: 'Alice',
        depth: 0,
      },
    ];
    const rows = descriptorsToGridRows(descriptors, ['name'], { band_0: ['order_id', 'total'] });

    expect(rows).toHaveLength(1);
    expect(rows[0]._isBandHeader).toBe(true);
    expect(rows[0]._band_id).toBe('band_0');
    expect(rows[0]._bandLabel).toBe('Orders');
    expect(rows[0]._bandTintIndex).toBe(0);
    // All superset columns (parent + band) set to ''
    expect(rows[0].name).toBe('');
    expect(rows[0].order_id).toBe('');
    expect(rows[0].total).toBe('');
  });

  it('band-row: retains data, pads parent columns, sets _band_id', () => {
    const descriptors: OverlayDescriptor[] = [
      {
        type: 'band-row',
        bandId: 'band_0',
        data: { order_id: 'O1', total: 100 },
        columns: ['order_id', 'total'],
        depth: 0,
      },
    ];
    const rows = descriptorsToGridRows(descriptors, ['name', 'age'], { band_0: ['order_id', 'total'] });

    expect(rows).toHaveLength(1);
    expect(rows[0].order_id).toBe('O1');
    expect(rows[0].total).toBe(100);
    expect(rows[0]._band_id).toBe('band_0');
    // Parent columns padded
    expect(rows[0].name).toBe('');
    expect(rows[0].age).toBe('');
    // No header marker
    expect(rows[0]._isBandHeader).toBeUndefined();
  });

  it('computes superset columns from all band column sets', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { name: 'Alice' }, columns: ['name'] },
    ];
    const rows = descriptorsToGridRows(
      descriptors,
      ['name'],
      { band_0: ['order_id'], band_1: ['item_name', 'qty'] },
    );

    // Parent row should have all band columns padded
    expect(rows[0].name).toBe('Alice');
    expect(rows[0].order_id).toBe('');
    expect(rows[0].item_name).toBe('');
    expect(rows[0].qty).toBe('');
  });

  it('assigns tint indices in order of first appearance', () => {
    const descriptors: OverlayDescriptor[] = [
      {
        type: 'band-section', bandId: 'band_b', bandLabel: 'B',
        bandColumns: [], matchValue: 'x', depth: 0,
      },
      {
        type: 'band-section', bandId: 'band_a', bandLabel: 'A',
        bandColumns: [], matchValue: 'y', depth: 0,
      },
    ];
    const rows = descriptorsToGridRows(descriptors, [], { band_a: [], band_b: [] });

    // band_b appears first → tint index 0
    expect(rows[0]._bandTintIndex).toBe(0);
    // band_a appears second → tint index 1
    expect(rows[1]._bandTintIndex).toBe(1);
  });

  it('empty bandColSets: band-section still pads parentCols, parent has no extra padding', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { name: 'Alice' }, columns: ['name'] },
      {
        type: 'band-section', bandId: 'band_0', bandLabel: 'Orders',
        bandColumns: [], matchValue: 'Alice', depth: 0,
      },
    ];
    const rows = descriptorsToGridRows(descriptors, ['name'], {});

    // Parent row: no band columns to pad
    expect(rows[0].name).toBe('Alice');
    // Band-section: parent cols still set to ''
    expect(rows[1].name).toBe('');
    expect(rows[1]._isBandHeader).toBe(true);
  });

  it('empty parentCols: band rows have no extra parent padding', () => {
    const descriptors: OverlayDescriptor[] = [
      {
        type: 'band-row', bandId: 'band_0',
        data: { order_id: 'O1' }, columns: ['order_id'], depth: 0,
      },
    ];
    const rows = descriptorsToGridRows(descriptors, [], { band_0: ['order_id'] });

    expect(rows[0].order_id).toBe('O1');
    expect(rows[0]._band_id).toBe('band_0');
    // No parent columns to pad — only band data + _band_id
    expect(Object.keys(rows[0]).sort()).toEqual(['_band_id', 'order_id']);
  });

  it('mixed descriptor sequence produces correct 7-row output', () => {
    const descriptors: OverlayDescriptor[] = [
      { type: 'parent', data: { name: 'Alice' }, columns: ['name'] },
      {
        type: 'band-section', bandId: 'band_0', bandLabel: 'Orders',
        bandColumns: ['order_id'], matchValue: 'Alice', depth: 0,
      },
      {
        type: 'band-row', bandId: 'band_0',
        data: { order_id: 'O1' }, columns: ['order_id'], depth: 0,
      },
      {
        type: 'band-row', bandId: 'band_0',
        data: { order_id: 'O2' }, columns: ['order_id'], depth: 0,
      },
      { type: 'parent', data: { name: 'Bob' }, columns: ['name'] },
      {
        type: 'band-section', bandId: 'band_0', bandLabel: 'Orders',
        bandColumns: ['order_id'], matchValue: 'Bob', depth: 0,
      },
      {
        type: 'band-row', bandId: 'band_0',
        data: { order_id: 'O3' }, columns: ['order_id'], depth: 0,
      },
    ];
    const rows = descriptorsToGridRows(descriptors, ['name'], { band_0: ['order_id'] });

    expect(rows).toHaveLength(7);
    // Row 0: parent (Alice)
    expect(rows[0].name).toBe('Alice');
    expect(rows[0].order_id).toBe('');
    // Row 1: band-section header
    expect(rows[1]._isBandHeader).toBe(true);
    expect(rows[1].name).toBe('');
    expect(rows[1].order_id).toBe('');
    // Row 2: band-row (O1)
    expect(rows[2].order_id).toBe('O1');
    expect(rows[2].name).toBe('');
    expect(rows[2]._band_id).toBe('band_0');
    // Row 3: band-row (O2)
    expect(rows[3].order_id).toBe('O2');
    expect(rows[3].name).toBe('');
    // Row 4: parent (Bob)
    expect(rows[4].name).toBe('Bob');
    expect(rows[4].order_id).toBe('');
    // Row 5: band-section header
    expect(rows[5]._isBandHeader).toBe(true);
    // Row 6: band-row (O3)
    expect(rows[6].order_id).toBe('O3');
    expect(rows[6]._band_id).toBe('band_0');
  });

  it('tint index cycles when more than 5 distinct bands', () => {
    const descriptors: OverlayDescriptor[] = Array.from({ length: 7 }, (_, i) => ({
      type: 'band-section' as const,
      bandId: `band_${i}`,
      bandLabel: `Band ${i}`,
      bandColumns: [],
      matchValue: i,
      depth: 0,
    }));
    const bandColSets: Record<string, string[]> = {};
    for (let i = 0; i < 7; i++) bandColSets[`band_${i}`] = [];

    const rows = descriptorsToGridRows(descriptors, [], bandColSets);

    // Bands 0-4 get indices 0-4, band 5 wraps to 0, band 6 wraps to 1
    expect(rows[0]._bandTintIndex).toBe(0);
    expect(rows[4]._bandTintIndex).toBe(4);
    expect(rows[5]._bandTintIndex).toBe(5);
    expect(rows[6]._bandTintIndex).toBe(6);
    // The actual color cycling happens in the renderer/styler using modulo,
    // but descriptorsToGridRows stores the raw sequential index.
    // Verify the indices are sequential.
    for (let i = 0; i < 7; i++) {
      expect(rows[i]._bandTintIndex).toBe(i);
    }
  });

  it('reuses tint index when same bandId appears in multiple descriptors', () => {
    const descriptors: OverlayDescriptor[] = [
      {
        type: 'band-section', bandId: 'band_0', bandLabel: 'First',
        bandColumns: [], matchValue: 'a', depth: 0,
      },
      { type: 'parent', data: { name: 'Alice' }, columns: ['name'] },
      {
        type: 'band-section', bandId: 'band_0', bandLabel: 'Second',
        bandColumns: [], matchValue: 'b', depth: 0,
      },
    ];
    const rows = descriptorsToGridRows(descriptors, ['name'], { band_0: [] });

    // Both band-sections for band_0 should have the same tint index (0)
    expect(rows[0]._bandTintIndex).toBe(0);
    expect(rows[2]._bandTintIndex).toBe(0);
  });
});

describe('BandHeaderRenderer', () => {
  it('init() creates a div with the band label', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _bandLabel: 'Orders', _band_id: 'band_0', _bandTintIndex: 0 } });

    const gui = renderer.getGui();
    expect(gui).toBeInstanceOf(HTMLDivElement);
    expect(gui.textContent).toBe('Orders');
  });

  it('getGui() returns the same element created by init()', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _bandLabel: 'Test', _band_id: 'b', _bandTintIndex: 0 } });

    const gui1 = renderer.getGui();
    const gui2 = renderer.getGui();
    expect(gui1).toBe(gui2);
  });

  it('falls back to _band_id when _bandLabel is missing', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _band_id: 'band_42', _bandTintIndex: 0 } });

    expect(renderer.getGui().textContent).toBe('band_42');
  });

  it('applies tint color from BAND_ROW_TINTS based on _bandTintIndex', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _bandLabel: 'X', _band_id: 'b', _bandTintIndex: 2 } });

    const style = renderer.getGui().style.cssText;
    expect(style).toContain(BAND_ROW_TINTS[2]);
  });

  it('refresh() returns false', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _bandLabel: 'X', _band_id: 'b', _bandTintIndex: 0 } });
    expect(renderer.refresh()).toBe(false);
  });

  it('destroy() does not throw', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _bandLabel: 'X', _band_id: 'b', _bandTintIndex: 0 } });
    expect(() => renderer.destroy()).not.toThrow();
  });

  it('wraps tint index when _bandTintIndex >= BAND_ROW_TINTS.length', () => {
    const renderer = new BandHeaderRenderer();
    // BAND_ROW_TINTS.length = 5, so index 5 wraps to tint[0]
    renderer.init({ data: { _bandLabel: 'Wrap', _band_id: 'b', _bandTintIndex: 5 } });
    const style = renderer.getGui().style.cssText;
    expect(style).toContain(BAND_ROW_TINTS[0]);
  });

  it('wraps tint index 6 to BAND_ROW_TINTS[1]', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _bandLabel: 'Wrap2', _band_id: 'c', _bandTintIndex: 6 } });
    const style = renderer.getGui().style.cssText;
    expect(style).toContain(BAND_ROW_TINTS[1]);
  });

  it('defaults tint to index 0 when _bandTintIndex is missing', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _bandLabel: 'Default', _band_id: 'd' } });
    const style = renderer.getGui().style.cssText;
    expect(style).toContain(BAND_ROW_TINTS[0]);
  });

  it('defaults tint to index 0 when _bandTintIndex is null', () => {
    const renderer = new BandHeaderRenderer();
    renderer.init({ data: { _bandLabel: 'Null', _band_id: 'e', _bandTintIndex: null } });
    const style = renderer.getGui().style.cssText;
    expect(style).toContain(BAND_ROW_TINTS[0]);
  });
});

describe('createBandRowStyler _isBandHeader guard', () => {
  it('returns undefined for band header rows (_isBandHeader is true)', () => {
    const rows = [
      { _isBandHeader: true, _band_id: 'band_0', _bandLabel: 'Orders' },
      { col1: 'x', _band_id: 'band_0' },
    ];
    const styler = createBandRowStyler(rows);

    const result = styler({ data: { _isBandHeader: true, _band_id: 'band_0', _bandLabel: 'Orders' } });
    expect(result).toBeUndefined();
  });
});
