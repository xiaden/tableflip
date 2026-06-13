import { describe, it, expect, beforeEach } from 'vitest';
import { getStore, initStore } from '../../core/store';
import { createDetailBandSpec } from '../../core/state';

describe('Pipeline card band reorder', () => {
  beforeEach(() => {
    initStore();
  });

  it('reorders detailBands array when moved from index 0 to index 2', () => {
    const store = getStore();
    const band0 = createDetailBandSpec({ id: 'band_0', rightId: 'table_a' });
    const band1 = createDetailBandSpec({ id: 'band_1', rightId: 'table_b' });
    const band2 = createDetailBandSpec({ id: 'band_2', rightId: 'table_c' });

    store.update(draft => {
      draft.detailBands = [band0, band1, band2];
    });

    // Simulate drag from index 0 to index 2
    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(0, 1);
      bands.splice(2, 0, moved);
      draft.detailBands = bands;
    });

    const state = store.getState();
    expect(state.detailBands).toHaveLength(3);
    expect(state.detailBands[0].id).toBe('band_1');
    expect(state.detailBands[1].id).toBe('band_2');
    expect(state.detailBands[2].id).toBe('band_0');
  });

  it('reorders detailBands array when moved from index 2 to index 0', () => {
    const store = getStore();
    const band0 = createDetailBandSpec({ id: 'band_0', rightId: 'table_a' });
    const band1 = createDetailBandSpec({ id: 'band_1', rightId: 'table_b' });
    const band2 = createDetailBandSpec({ id: 'band_2', rightId: 'table_c' });

    store.update(draft => {
      draft.detailBands = [band0, band1, band2];
    });

    // Simulate drag from index 2 to index 0
    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(2, 1);
      bands.splice(0, 0, moved);
      draft.detailBands = bands;
    });

    const state = store.getState();
    expect(state.detailBands).toHaveLength(3);
    expect(state.detailBands[0].id).toBe('band_2');
    expect(state.detailBands[1].id).toBe('band_0');
    expect(state.detailBands[2].id).toBe('band_1');
  });

  it('preserves band IDs across reorders (IDs are stable)', () => {
    const store = getStore();
    const band0 = createDetailBandSpec({ id: 'band_0', rightId: 'table_a' });
    const band1 = createDetailBandSpec({ id: 'band_1', rightId: 'table_b' });
    const band2 = createDetailBandSpec({ id: 'band_2', rightId: 'table_c' });

    store.update(draft => {
      draft.detailBands = [band0, band1, band2];
    });

    const originalIds = store.getState().detailBands.map(b => b.id);

    // Reorder multiple times
    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(0, 1);
      bands.splice(2, 0, moved);
      draft.detailBands = bands;
    });

    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(1, 1);
      bands.splice(0, 0, moved);
      draft.detailBands = bands;
    });

    const finalIds = store.getState().detailBands.map(b => b.id);

    // IDs should be the same set, just in different order
    expect(new Set(finalIds)).toEqual(new Set(originalIds));
    expect(finalIds).toHaveLength(originalIds.length);
  });

  it('preserves band properties across reorders', () => {
    const store = getStore();
    const band0 = createDetailBandSpec({
      id: 'band_0',
      rightId: 'table_a',
      label: 'Band A',
      cols: ['col1', 'col2'],
      enabled: true,
    });
    const band1 = createDetailBandSpec({
      id: 'band_1',
      rightId: 'table_b',
      label: 'Band B',
      cols: ['col3'],
      enabled: false,
    });

    store.update(draft => {
      draft.detailBands = [band0, band1];
    });

    // Reorder
    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(0, 1);
      bands.splice(1, 0, moved);
      draft.detailBands = bands;
    });

    const state = store.getState();
    expect(state.detailBands).toHaveLength(2);
    
    // band_1 should now be at index 0
    expect(state.detailBands[0].id).toBe('band_1');
    expect(state.detailBands[0].label).toBe('Band B');
    expect(state.detailBands[0].rightId).toBe('table_b');
    expect(state.detailBands[0].cols).toEqual(['col3']);
    expect(state.detailBands[0].enabled).toBe(false);

    // band_0 should now be at index 1
    expect(state.detailBands[1].id).toBe('band_0');
    expect(state.detailBands[1].label).toBe('Band A');
    expect(state.detailBands[1].rightId).toBe('table_a');
    expect(state.detailBands[1].cols).toEqual(['col1', 'col2']);
    expect(state.detailBands[1].enabled).toBe(true);
  });

  it('does not modify array when source and target indices are the same', () => {
    const store = getStore();
    const band0 = createDetailBandSpec({ id: 'band_0', rightId: 'table_a' });
    const band1 = createDetailBandSpec({ id: 'band_1', rightId: 'table_b' });

    store.update(draft => {
      draft.detailBands = [band0, band1];
    });

    const before = store.getState().detailBands.map(b => b.id);

    // Simulate drag to same position (index 0 to index 0)
    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const sourceIdx = 0;
      const targetIdx = 0;
      if (sourceIdx === targetIdx) return; // Early return
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(sourceIdx, 1);
      bands.splice(targetIdx, 0, moved);
      draft.detailBands = bands;
    });

    const after = store.getState().detailBands.map(b => b.id);
    expect(after).toEqual(before);
  });

  it('handles reorder with only two bands', () => {
    const store = getStore();
    const band0 = createDetailBandSpec({ id: 'band_0', rightId: 'table_a' });
    const band1 = createDetailBandSpec({ id: 'band_1', rightId: 'table_b' });

    store.update(draft => {
      draft.detailBands = [band0, band1];
    });

    // Swap the two bands
    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(0, 1);
      bands.splice(1, 0, moved);
      draft.detailBands = bands;
    });

    const state = store.getState();
    expect(state.detailBands).toHaveLength(2);
    expect(state.detailBands[0].id).toBe('band_1');
    expect(state.detailBands[1].id).toBe('band_0');
  });

  it('does not crash when reordering with less than 2 bands', () => {
    const store = getStore();
    const band0 = createDetailBandSpec({ id: 'band_0', rightId: 'table_a' });

    store.update(draft => {
      draft.detailBands = [band0];
    });

    // Try to reorder (should be a no-op)
    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(0, 1);
      bands.splice(1, 0, moved);
      draft.detailBands = bands;
    });

    const state = store.getState();
    expect(state.detailBands).toHaveLength(1);
    expect(state.detailBands[0].id).toBe('band_0');
  });

  it('does not crash when detailBands is empty', () => {
    const store = getStore();

    store.update(draft => {
      draft.detailBands = [];
    });

    // Try to reorder (should be a no-op)
    store.update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(0, 1);
      bands.splice(1, 0, moved);
      draft.detailBands = bands;
    });

    const state = store.getState();
    expect(state.detailBands).toHaveLength(0);
  });
});
