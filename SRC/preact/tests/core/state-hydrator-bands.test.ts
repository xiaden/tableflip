/**
 * Unit tests — state hydrator: hydrateState() with detail bands.
 *
 * Tests that the hydrator correctly processes detailBands and detailBandMode
 * from a .rcjson payload, validates references, handles missing tables,
 * and broken refs.
 */
import { describe, it, expect } from 'vitest';
import { hydrateState } from '../../core/state-hydrator';
import { buildPayload } from '../../core/state-serializer';
import { createAppState } from '../../core/state';
import type { DbTable, DetailBandSpec } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Standard Orders table metadata (matches vitest-setup.ts data). */
const ordersTable: DbTable = {
  id: 'Orders',
  name: 'Orders',
  cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
  rowCount: 8,
};

/** Standard Items table metadata (child table for detail bands). */
const itemsTable: DbTable = {
  id: 'Items',
  name: 'Line Items',
  cols: ['ItemId', 'OrderId', 'ProductName', 'Quantity', 'UnitPrice'],
  rowCount: 20,
};

/** Loaded tables record with Orders and Items. */
function loadedTables(extra?: Record<string, DbTable>): Record<string, DbTable> {
  return { Orders: ordersTable, Items: itemsTable, ...extra };
}

/** Minimal valid .rcjson payload referencing Orders. */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    base: 'Orders',
    aggMode: 'none',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('hydrateState — detail bands', () => {
  it('should default detailBands to empty array when absent', () => {
    const payload = validPayload();
    const { next, brokenRefs } = hydrateState(payload, loadedTables());

    expect(next.detailBands).toEqual([]);
    // No broken refs related to detail bands
    expect(brokenRefs.filter(r => r.includes('detail') || r.includes('Related'))).toEqual([]);
  });

  it('should treat null detailBands as empty array', () => {
    const payload = validPayload({ detailBands: null });
    const { next } = hydrateState(payload, loadedTables());

    expect(next.detailBands).toEqual([]);
  });

  it('should hydrate a valid detail band with all fields', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: 'Items',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['ProductName', 'Quantity'],
        enabled: true,
        sorts: [{ col: 'ProductName', dir: 'ASC', enabled: true }],
        label: 'Line Items',
      }],
    });
    const { next, brokenRefs } = hydrateState(payload, loadedTables());

    expect(next.detailBands).toHaveLength(1);
    const band = (next.detailBands as any[])[0];
    expect(band.id).toBe('band_0');
    expect(band.rightId).toBe('Items');
    expect(band.keyPairs).toEqual([{ left: 'OrderId', right: 'OrderId' }]);
    expect(band.cols).toEqual(['ProductName', 'Quantity']);
    expect(band.enabled).toBe(true);
    expect(band.sorts).toEqual([{ col: 'ProductName', dir: 'ASC', enabled: true }]);
    expect(band.label).toBe('Line Items');
    expect(brokenRefs).toEqual([]);
  });

  it('should report brokenRef when band references a missing table', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: 'GhostTable',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['Name'],
        enabled: true,
        sorts: [],
        label: 'Missing',
      }],
    });
    const { next, brokenRefs } = hydrateState(payload, loadedTables());

    expect(brokenRefs.some(r => r.includes('GhostTable'))).toBe(true);
    // Band is still hydrated so user can see/fix it
    expect(next.detailBands).toHaveLength(1);
    expect((next.detailBands as any[])[0].rightId).toBe('GhostTable');
  });

  it('should report brokenRef when key pair right column does not exist in child table', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: 'Items',
        keyPairs: [{ left: 'OrderId', right: 'NonExistentCol' }],
        cols: ['ProductName'],
        enabled: true,
        sorts: [],
        label: '',
      }],
    });
    const { brokenRefs } = hydrateState(payload, loadedTables());

    expect(brokenRefs.some(r => r.includes('NonExistentCol') && r.includes('Items'))).toBe(true);
  });

  it('should report brokenRef when key pair left column is not available', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: 'Items',
        keyPairs: [{ left: 'FakeParentCol', right: 'OrderId' }],
        cols: ['ProductName'],
        enabled: true,
        sorts: [],
        label: '',
      }],
    });
    const { brokenRefs } = hydrateState(payload, loadedTables());

    expect(brokenRefs.some(r => r.includes('FakeParentCol'))).toBe(true);
  });

  it('should filter out unavailable columns from band.cols', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: 'Items',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['ProductName', 'GhostCol', 'Quantity'],
        enabled: true,
        sorts: [],
        label: 'Test',
      }],
    });
    const { next, brokenRefs } = hydrateState(payload, loadedTables());

    const band = (next.detailBands as any[])[0];
    expect(band.cols).toEqual(['ProductName', 'Quantity']);
    expect(brokenRefs.some(r => r.includes('GhostCol'))).toBe(true);
  });

  it('should report brokenRef when sort column does not exist in child table', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: 'Items',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['ProductName'],
        enabled: true,
        sorts: [{ col: 'FakeSortCol', dir: 'ASC', enabled: true }],
        label: '',
      }],
    });
    const { brokenRefs } = hydrateState(payload, loadedTables());

    expect(brokenRefs.some(r => r.includes('FakeSortCol') && r.includes('Line Items'))).toBe(true);
  });

  it('should normalize sort directions during hydration', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: 'Items',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['ProductName'],
        enabled: true,
        sorts: [
          { col: 'ProductName', dir: 'DESC', enabled: true },
          { col: 'Quantity', dir: 'INVALID', enabled: false },
        ],
        label: '',
      }],
    });
    const { next } = hydrateState(payload, loadedTables());

    const sorts = (next.detailBands as any[])[0].sorts;
    expect(sorts[0].dir).toBe('DESC');
    expect(sorts[1].dir).toBe('ASC'); // Invalid direction normalized to ASC
    expect(sorts[1].enabled).toBe(false);
  });

  it('should generate fallback id when band has no id', () => {
    const payload = validPayload({
      detailBands: [{
        rightId: 'Items',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['ProductName'],
        enabled: true,
        sorts: [],
        label: '',
      }],
    });
    const { next } = hydrateState(payload, loadedTables());

    expect((next.detailBands as any[])[0].id).toBe('band_0');
  });

  it('should handle multiple bands with mixed validity', () => {
    const payload = validPayload({
      detailBands: [
        {
          id: 'band_0',
          rightId: 'Items',
          keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
          cols: ['ProductName'],
          enabled: true,
          sorts: [],
          label: 'Valid Band',
        },
        {
          id: 'band_1',
          rightId: 'MissingTable',
          keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
          cols: ['Something'],
          enabled: true,
          sorts: [],
          label: 'Invalid Band',
        },
      ],
    });
    const { next, brokenRefs } = hydrateState(payload, loadedTables());

    expect(next.detailBands).toHaveLength(2);
    expect(brokenRefs.some(r => r.includes('MissingTable'))).toBe(true);
    // Valid band should have no broken refs related to it
    const validBand = (next.detailBands as any[])[0];
    expect(validBand.rightId).toBe('Items');
    expect(validBand.cols).toEqual(['ProductName']);
  });

  it('should handle empty rightId gracefully', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: '',
        keyPairs: [{ left: '', right: '' }],
        cols: [],
        enabled: true,
        sorts: [],
        label: '',
      }],
    });
    const { next, brokenRefs } = hydrateState(payload, loadedTables());

    expect(next.detailBands).toHaveLength(1);
    expect(brokenRefs.some(r => r.includes('Related details sheet'))).toBe(true);
  });

  it('should round-trip through buildPayload → hydrateState', () => {
    const band: DetailBandSpec = {
      id: 'band_0',
      rightId: 'Items',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['ProductName', 'Quantity'],
      enabled: true,
      sorts: [{ col: 'ProductName', dir: 'DESC', enabled: true }],
      label: 'Line Items',
    };
    const state = createAppState({
      base: 'Orders',
      detailBands: [band],
    });

    // Serialize
    const payload = buildPayload(state);

    // Hydrate
    const { next, brokenRefs } = hydrateState(payload as Record<string, any>, loadedTables());

    expect(brokenRefs).toEqual([]);
    expect(next.detailBands).toHaveLength(1);

    const hydratedBand = (next.detailBands as any[])[0];
    expect(hydratedBand.id).toBe('band_0');
    expect(hydratedBand.rightId).toBe('Items');
    expect(hydratedBand.keyPairs).toEqual([{ left: 'OrderId', right: 'OrderId' }]);
    expect(hydratedBand.cols).toEqual(['ProductName', 'Quantity']);
    expect(hydratedBand.enabled).toBe(true);
    expect(hydratedBand.sorts).toEqual([{ col: 'ProductName', dir: 'DESC', enabled: true }]);
    expect(hydratedBand.label).toBe('Line Items');
  });

  it('should handle disabled band correctly', () => {
    const payload = validPayload({
      detailBands: [{
        id: 'band_0',
        rightId: 'Items',
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
        cols: ['ProductName'],
        enabled: false,
        sorts: [],
        label: '',
      }],
    });
    const { next } = hydrateState(payload, loadedTables());

    expect((next.detailBands as any[])[0].enabled).toBe(false);
  });
});
