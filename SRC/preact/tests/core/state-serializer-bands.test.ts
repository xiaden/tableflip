/**
 * Unit tests — state serializer: buildPayload() with detail bands.
 *
 * Tests that the serializer correctly converts detailBands and detailBandMode
 * to a serializable payload, handles all field types, and produces output
 * compatible with the hydrator.
 */
import { describe, it, expect } from 'vitest';
import { buildPayload } from '../../core/state-serializer';
import { createAppState } from '../../core/state';
import type { DetailBandSpec } from '../../types';

describe('buildPayload — detail bands', () => {
  it('should serialize empty detailBands', () => {
    const state = createAppState({ base: 'Orders' });
    const payload = buildPayload(state);

    expect(payload.detailBands).toEqual([]);
  });

  it('should serialize a single detail band with all fields', () => {
    const band: DetailBandSpec = {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['ProductName', 'Quantity', 'UnitPrice'],
      enabled: true,
      sorts: [{ col: 'ProductName', dir: 'ASC', enabled: true }],
      label: 'Line Items',
    };
    const state = createAppState({ base: 'Orders', detailBands: [band] });
    const payload = buildPayload(state);

    expect(payload.detailBands).toEqual([{
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['ProductName', 'Quantity', 'UnitPrice'],
      enabled: true,
      sorts: [{ col: 'ProductName', dir: 'ASC', enabled: true }],
      label: 'Line Items',
    }]);
  });

  it('should serialize multiple detail bands', () => {
    const bands: DetailBandSpec[] = [
      {
        id: 'band_0',
        rightId: 'Items',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['ProductName'],
        enabled: true,
        sorts: [],
        label: 'Items',
      },
      {
        id: 'band_1',
        rightId: 'Notes',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['NoteText'],
        enabled: false,
        sorts: [],
        label: 'Notes',
      },
    ];
    const state = createAppState({ base: 'Orders', detailBands: bands });
    const payload = buildPayload(state);

    expect(payload.detailBands).toHaveLength(2);
    expect((payload.detailBands as any[])[0].id).toBe('band_0');
    expect((payload.detailBands as any[])[1].id).toBe('band_1');
    expect((payload.detailBands as any[])[1].enabled).toBe(false);
  });

  it('should normalize sort directions during serialization', () => {
    const band: DetailBandSpec = {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['ProductName'],
      enabled: true,
      sorts: [
        { col: 'ProductName', dir: 'DESC', enabled: true },
        { col: 'Quantity', dir: 'ASC', enabled: false },
      ],
      label: '',
    };
    const state = createAppState({ base: 'Orders', detailBands: [band] });
    const payload = buildPayload(state);

    const sorts = (payload.detailBands as any[])[0].sorts;
    expect(sorts).toEqual([
      { col: 'ProductName', dir: 'DESC', enabled: true },
      { col: 'Quantity', dir: 'ASC', enabled: false },
    ]);
  });

  it('should serialize multi-key pairs', () => {
    const band: DetailBandSpec = {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [
        { left: 'OrderId', right: 'OrderId' },
        { left: 'Region', right: 'Region' },
      ],
      cols: ['ProductName'],
      enabled: true,
      sorts: [],
      label: '',
    };
    const state = createAppState({ base: 'Orders', detailBands: [band] });
    const payload = buildPayload(state);

    const keyPairs = (payload.detailBands as any[])[0].keyPairs;
    expect(keyPairs).toEqual([
      { left: 'OrderId', right: 'OrderId' },
      { left: 'Region', right: 'Region' },
    ]);
  });

  it('should produce a payload that can be JSON stringified and parsed back', () => {
    const band: DetailBandSpec = {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['ProductName', 'Quantity'],
      enabled: true,
      sorts: [{ col: 'ProductName', dir: 'ASC', enabled: true }],
      label: 'Line Items',
    };
    const state = createAppState({
      base: 'Orders',
      detailBands: [band],
    });
    const payload = buildPayload(state);

    const json = JSON.stringify(payload, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed.detailBands).toEqual([{
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['ProductName', 'Quantity'],
      enabled: true,
      sorts: [{ col: 'ProductName', dir: 'ASC', enabled: true }],
      label: 'Line Items',
    }]);
  });

  it('should deep clone detail band arrays to avoid reference sharing', () => {
    const band: DetailBandSpec = {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['ProductName'],
      enabled: true,
      sorts: [],
      label: '',
    };
    const state = createAppState({ base: 'Orders', detailBands: [band] });
    const payload = buildPayload(state);

    // Mutate the payload and verify the original state is unaffected
    (payload.detailBands as any[])[0].keyPairs[0].left = 'Modified';
    expect(state.detailBands[0].keyPairs[0].left).toBe('OrderId');
  });

  it('should handle disabled bands correctly', () => {
    const band: DetailBandSpec = {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['ProductName'],
      enabled: false,
      sorts: [],
      label: '',
    };
    const state = createAppState({ base: 'Orders', detailBands: [band] });
    const payload = buildPayload(state);

    expect((payload.detailBands as any[])[0].enabled).toBe(false);
  });

  it('should handle empty cols and sorts arrays', () => {
    const band: DetailBandSpec = {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [],
      cols: [],
      enabled: true,
      sorts: [],
      label: '',
    };
    const state = createAppState({ base: 'Orders', detailBands: [band] });
    const payload = buildPayload(state);

    expect((payload.detailBands as any[])[0].cols).toEqual([]);
    expect((payload.detailBands as any[])[0].sorts).toEqual([]);
    expect((payload.detailBands as any[])[0].keyPairs).toEqual([]);
  });
});
