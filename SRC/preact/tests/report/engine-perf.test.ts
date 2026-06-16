/**
 * Performance profiling tests for buildBandChildIndex() and buildOverlayDescriptors().
 *
 * These tests exercise the index-building and overlay descriptor functions with
 * large datasets to ensure they complete within acceptable time bounds.
 */
import { describe, it, expect } from 'vitest';
import {
  buildBandChildIndex,
} from '../../report/engine';
import { buildOverlayDescriptors } from '../../report/overlay-grouping';
import type { BandResult, BandResultSet, DetailBandSpec } from '../../types';

// ── buildBandChildIndex correctness ───────────────────────────────────────────

describe('buildBandChildIndex()', () => {
  it('should index rows by composite key value', () => {
    const bandResults: BandResult[] = [{
      band: { id: 'band_0' } as DetailBandSpec,
      rows: [
        { OrderId: 'A', _band_0_Product: 'Widget' },
        { OrderId: 'A', _band_0_Product: 'Gadget' },
        { OrderId: 'B', _band_0_Product: 'Gizmo' },
      ],
      cols: ['_band_0_Product'],
      parentKeyAliases: ['OrderId'],
      childKeyCols: ['OrderId'],
    }];

    const index = buildBandChildIndex(bandResults);

    expect(index.has('band_0')).toBe(true);
    const bandIdx = index.get('band_0')!;
    expect(bandIdx.get('A')?.length).toBe(2);
    expect(bandIdx.get('B')?.length).toBe(1);
    expect(bandIdx.has('C')).toBe(false);
  });

  it('should handle multiple bands', () => {
    const bandResults: BandResult[] = [
      {
        band: { id: 'band_0' } as DetailBandSpec,
        rows: [{ OrderId: 'A', col0: 'x' }],
        cols: ['col0'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      },
      {
        band: { id: 'band_1' } as DetailBandSpec,
        rows: [{ OrderId: 'A', col1: 'y' }, { OrderId: 'B', col1: 'z' }],
        cols: ['col1'],
        parentKeyAliases: ['OrderId'],
        childKeyCols: ['OrderId'],
      },
    ];

    const index = buildBandChildIndex(bandResults);
    expect(index.size).toBe(2);
    expect(index.get('band_0')!.get('A')?.length).toBe(1);
    expect(index.get('band_1')!.get('A')?.length).toBe(1);
    expect(index.get('band_1')!.get('B')?.length).toBe(1);
  });

  it('should handle empty band results', () => {
    const index = buildBandChildIndex([]);
    expect(index.size).toBe(0);
  });

  it('should handle multi-key composite values', () => {
    const bandResults: BandResult[] = [{
      band: { id: 'band_0' } as DetailBandSpec,
      rows: [
        { K1: 'a', K2: '1', val: 'x' },
        { K1: 'a', K2: '2', val: 'y' },
        { K1: 'a', K2: '1', val: 'z' },
      ],
      cols: ['val'],
      parentKeyAliases: ['K1', 'K2'],
      childKeyCols: ['K1', 'K2'],
    }];

    const index = buildBandChildIndex(bandResults);
    const bandIdx = index.get('band_0')!;
    expect(bandIdx.get('a|||1')?.length).toBe(2);
    expect(bandIdx.get('a|||2')?.length).toBe(1);
  });
});

// ── buildOverlayDescriptors() performance ─────────────────────────────────────

describe('buildOverlayDescriptors() performance', () => {
  /**
   * Helper: generate a BandResultSet fixture programmatically.
   * Creates parentRows with sequential key values, and bandResults with
   * children distributed across parent groups.
   *
   * @param matchKeyField - The parent column used for group matching (e.g. 'Company' or 'OrderId')
   */
  function makeLargeBandResultSet(
    parentCount: number,
    bands: Array<{ id: string; childrenPerParent: number; cols: string[] }>,
    groupSize: number,
    matchKeyField: string = 'OrderId',
  ): BandResultSet {
    const parentRows: Record<string, unknown>[] = [];
    const parentCols = ['OrderId', 'Company', 'Amount'];

    for (let i = 0; i < parentCount; i++) {
      parentRows.push({
        OrderId: `ORD-${String(i).padStart(5, '0')}`,
        Company: `Company-${Math.floor(i / groupSize)}`,
        Amount: (i + 1) * 10,
      });
    }

    const bandResults: BandResult[] = [];
    for (const bandDef of bands) {
      const rows: Record<string, unknown>[] = [];
      for (let p = 0; p < parentCount; p++) {
        const parentRow = parentRows[p];
        const matchValue = parentRow[matchKeyField] as string;
        for (let c = 0; c < bandDef.childrenPerParent; c++) {
          const row: Record<string, unknown> = { [matchKeyField]: matchValue };
          for (const col of bandDef.cols) {
            row[`_${bandDef.id}_${col}`] = `${col}-${p}-${c}`;
          }
          rows.push(row);
        }
      }
      bandResults.push({
        band: {
          id: bandDef.id,
          rightId: 'Items',
          keyPairs: [{ left: matchKeyField, right: matchKeyField }],
          cols: bandDef.cols.map(c => `_${bandDef.id}_${c}`),
          enabled: true,
          sorts: [],
          label: bandDef.id,
        } as DetailBandSpec,
        rows,
        cols: bandDef.cols.map(c => `_${bandDef.id}_${c}`),
        parentKeyAliases: [matchKeyField],
        childKeyCols: [matchKeyField],
      });
    }

    const bandLabels: Record<string, string> = {};
    for (const bandDef of bands) {
      bandLabels[bandDef.id] = bandDef.id;
    }

    return { parentRows, parentCols, bandResults, bandLabels };
  }

  function makeDetailBands(bandIds: string[], matchKeyField: string = 'OrderId'): DetailBandSpec[] {
    return bandIds.map(id => ({
      id,
      rightId: 'Items',
      keyPairs: [{ left: matchKeyField, right: matchKeyField }],
      cols: [],
      enabled: true,
      sorts: [],
      label: id,
    }));
  }

  it('5,000 parents × 3 bands × 5 children each within 500ms', () => {
    const bandResult = makeLargeBandResultSet(
      5000,
      [
        { id: 'band_0', childrenPerParent: 5, cols: ['Product', 'Qty'] },
        { id: 'band_1', childrenPerParent: 5, cols: ['Note', 'Date'] },
        { id: 'band_2', childrenPerParent: 5, cols: ['Attachment', 'Size'] },
      ],
      10, // group size: 10 parents per group = 500 groups
    );
    const detailBands = makeDetailBands(['band_0', 'band_1', 'band_2']);

    const start = performance.now();
    const descriptors = buildOverlayDescriptors(bandResult, detailBands);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    // Verify we got descriptors back
    expect(descriptors.length).toBeGreaterThan(0);
  });

  it('10,000 parents × 1 band × 10 children each within 500ms', () => {
    const bandResult = makeLargeBandResultSet(
      10000,
      [
        { id: 'band_0', childrenPerParent: 10, cols: ['Product', 'Qty', 'Price'] },
      ],
      20, // group size: 20 parents per group = 500 groups
    );
    const detailBands = makeDetailBands(['band_0']);

    const start = performance.now();
    const descriptors = buildOverlayDescriptors(bandResult, detailBands);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(descriptors.length).toBeGreaterThan(0);
  });

  it('descriptor count assertions: parentCount + groupCount × bandCount + totalChildren', () => {
    const parentCount = 100;
    const groupSize = 10; // 10 parents per group → 10 groups
    const bandCount = 2;
    const childrenPerParent = 3;

    // Use Company as the match key so that parents in the same group share
    // the same match value (OrderId is unique per parent → every row = new group).
    const bandResult = makeLargeBandResultSet(
      parentCount,
      [
        { id: 'band_0', childrenPerParent, cols: ['Product'] },
        { id: 'band_1', childrenPerParent, cols: ['Note'] },
      ],
      groupSize,
      'Company',
    );
    const detailBands = makeDetailBands(['band_0', 'band_1'], 'Company');

    const descriptors = buildOverlayDescriptors(bandResult, detailBands);

    // Count descriptor types
    const parentDescs = descriptors.filter(d => d.type === 'parent');
    const sectionDescs = descriptors.filter(d => d.type === 'band-section');
    const rowDescs = descriptors.filter(d => d.type === 'band-row');

    // Parent descriptors: one per parent row
    expect(parentDescs.length).toBe(parentCount);

    // Group count = parentCount / groupSize
    const groupCount = parentCount / groupSize;

    // Band section descriptors: one per group per band
    expect(sectionDescs.length).toBe(groupCount * bandCount);

    // Band row descriptors: one per child row total
    const totalChildren = parentCount * childrenPerParent * bandCount;
    expect(rowDescs.length).toBe(totalChildren);

    // Total descriptor count = parents + sections + rows
    const expectedTotal = parentCount + (groupCount * bandCount) + totalChildren;
    expect(descriptors.length).toBe(expectedTotal);
  });
});
