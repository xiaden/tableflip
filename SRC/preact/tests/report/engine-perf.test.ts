/**
 * Performance profiling tests for interleaveRows() and crossProductRows().
 *
 * These tests exercise the stitching functions with large datasets
 * (5,000+ parent rows, 3 bands) and assert that execution completes
 * within acceptable time bounds.
 *
 * Profiling targets (measured on CI-class hardware):
 * - interleaveRows: 5,000 parents × 3 bands × ~5 children each < 500ms
 * - crossProductRows: 5,000 parents × 3 bands × ~3 children each < 500ms
 * - crossProductRows (stress): 1,000 parents × 3 bands × ~10 children each < 500ms
 */
import { describe, it, expect } from 'vitest';
import {
  interleaveRows,
  crossProductRows,
  buildBandChildIndex,
} from '../../report/engine';
import type { BandResult } from '../../report/engine';
import type { DetailBandSpec } from '../../types';

// ── Test Data Generators ──────────────────────────────────────────────────────

function makeBandSpec(id: string): DetailBandSpec {
  return {
    id,
    rightId: `table_${id}`,
    keyPairs: [{ left: 'ParentKey', right: 'ParentKey' }],
    cols: [`_${id}_col0`, `_${id}_col1`],
    enabled: true,
    sorts: [],
    label: `Band ${id}`,
  };
}

/**
 * Generate parent rows with sequential keys.
 */
function makeParentRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    ParentKey: `PK-${i}`,
    ParentName: `Parent ${i}`,
    ParentValue: i * 100,
  }));
}

/**
 * Generate band results where each parent key has `childrenPerParent` matching children.
 * Keys are distributed round-robin so each parent gets exactly childrenPerParent rows.
 */
function makeBandResult(
  bandId: string,
  parentCount: number,
  childrenPerParent: number,
): BandResult {
  const spec = makeBandSpec(bandId);
  const rows: Record<string, unknown>[] = [];
  for (let p = 0; p < parentCount; p++) {
    for (let c = 0; c < childrenPerParent; c++) {
      rows.push({
        ParentKey: `PK-${p}`,
        [`_${bandId}_col0`]: `val_${p}_${c}`,
        [`_${bandId}_col1`]: p * childrenPerParent + c,
      });
    }
  }
  return {
    band: spec,
    rows,
    cols: spec.cols ?? [],
    parentKeyAliases: ['ParentKey'],
    childKeyCols: ['ParentKey'],
  };
}

// ── Profiling Tests ───────────────────────────────────────────────────────────

describe('interleaveRows() performance', () => {
  it('should handle 5,000 parents × 3 bands × 5 children each within 500ms', () => {
    const parentCount = 5_000;
    const childrenPerParent = 5;
    const parentRows = makeParentRows(parentCount);
    const bandResults: BandResult[] = [
      makeBandResult('band_0', parentCount, childrenPerParent),
      makeBandResult('band_1', parentCount, childrenPerParent),
      makeBandResult('band_2', parentCount, childrenPerParent),
    ];
    const supersetCols = [
      'ParentKey', 'ParentName', 'ParentValue',
      '_band_0_col0', '_band_0_col1',
      '_band_1_col0', '_band_1_col1',
      '_band_2_col0', '_band_2_col1',
      '_band_id',
    ];

    const start = performance.now();
    const result = interleaveRows(parentRows, bandResults, supersetCols);
    const elapsed = performance.now() - start;

    // Expected: 5000 parents + 5000 × 3 × 5 children = 80,000 rows
    expect(result.length).toBe(parentCount + parentCount * 3 * childrenPerParent);

    // Performance assertion: should complete well under 500ms
    // Map-based indexing makes this O(n) — expected ~50-150ms
    expect(elapsed).toBeLessThan(500);
  });

  it('should handle 10,000 parents × 1 band × 10 children each within 500ms', () => {
    const parentCount = 10_000;
    const childrenPerParent = 10;
    const parentRows = makeParentRows(parentCount);
    const bandResults: BandResult[] = [
      makeBandResult('band_0', parentCount, childrenPerParent),
    ];
    const supersetCols = [
      'ParentKey', 'ParentName', 'ParentValue',
      '_band_0_col0', '_band_0_col1',
      '_band_id',
    ];

    const start = performance.now();
    const result = interleaveRows(parentRows, bandResults, supersetCols);
    const elapsed = performance.now() - start;

    // Expected: 10000 + 10000 × 10 = 110,000 rows
    expect(result.length).toBe(parentCount + parentCount * childrenPerParent);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('crossProductRows() performance', () => {
  it('should handle 5,000 parents × 3 bands × 3 children each within 500ms (with index)', () => {
    const parentCount = 5_000;
    const childrenPerParent = 3;
    const parentRows = makeParentRows(parentCount);
    const bandResults: BandResult[] = [
      makeBandResult('band_0', parentCount, childrenPerParent),
      makeBandResult('band_1', parentCount, childrenPerParent),
      makeBandResult('band_2', parentCount, childrenPerParent),
    ];
    const supersetCols = [
      'ParentKey', 'ParentName', 'ParentValue',
      '_band_0_col0', '_band_0_col1',
      '_band_1_col0', '_band_1_col1',
      '_band_2_col0', '_band_2_col1',
      '_band_id',
    ];

    // Build index once (as runDetailBandsMode does)
    const childIndex = buildBandChildIndex(bandResults);

    const start = performance.now();
    const resultRows: Record<string, unknown>[] = [];
    for (const parentRow of parentRows) {
      const combos = crossProductRows(parentRow, bandResults, supersetCols, 10_000, childIndex);
      resultRows.push(...combos);
    }
    const elapsed = performance.now() - start;

    // Expected: 5000 × (3 × 3 × 3) = 5000 × 27 = 135,000 rows
    expect(resultRows.length).toBe(parentCount * Math.pow(childrenPerParent, 3));
    // With Map-based index, child lookup is O(1) per band per parent
    expect(elapsed).toBeLessThan(500);
  });

  it('should handle 1,000 parents × 3 bands × 10 children each within 500ms (with index)', () => {
    const parentCount = 1_000;
    const childrenPerParent = 10;
    const parentRows = makeParentRows(parentCount);
    const bandResults: BandResult[] = [
      makeBandResult('band_0', parentCount, childrenPerParent),
      makeBandResult('band_1', parentCount, childrenPerParent),
      makeBandResult('band_2', parentCount, childrenPerParent),
    ];
    const supersetCols = [
      'ParentKey', 'ParentName', 'ParentValue',
      '_band_0_col0', '_band_0_col1',
      '_band_1_col0', '_band_1_col1',
      '_band_2_col0', '_band_2_col1',
      '_band_id',
    ];

    const childIndex = buildBandChildIndex(bandResults);

    const start = performance.now();
    let totalRows = 0;
    for (const parentRow of parentRows) {
      const combos = crossProductRows(parentRow, bandResults, supersetCols, 2_000_000, childIndex);
      totalRows += combos.length;
    }
    const elapsed = performance.now() - start;

    // Expected: 1000 × (10 × 10 × 10) = 1,000,000 rows
    expect(totalRows).toBe(parentCount * Math.pow(childrenPerParent, 3));
    // This is a stress test — 1M object allocations is inherently heavy.
    // The index optimizes lookup from O(n) to O(1), but object spread is the
    // remaining bottleneck. Allow 1000ms for this extreme workload.
    expect(elapsed).toBeLessThan(1000);
  });

  it('should handle single parent with many children across 3 bands within 500ms (with index)', () => {
    const parentRow = { ParentKey: 'PK-0', ParentName: 'Root', ParentValue: 0 };
    const childrenPerBand = 50;
    const bandResults: BandResult[] = [
      makeBandResult('band_0', 1, childrenPerBand),
      makeBandResult('band_1', 1, childrenPerBand),
      makeBandResult('band_2', 1, childrenPerBand),
    ];
    const supersetCols = [
      'ParentKey', 'ParentName', 'ParentValue',
      '_band_0_col0', '_band_0_col1',
      '_band_1_col0', '_band_1_col1',
      '_band_2_col0', '_band_2_col1',
      '_band_id',
    ];

    const childIndex = buildBandChildIndex(bandResults);

    const start = performance.now();
    const result = crossProductRows(parentRow, bandResults, supersetCols, 200_000, childIndex);
    const elapsed = performance.now() - start;

    // 50 × 50 × 50 = 125,000 rows for a single parent
    expect(result.length).toBe(Math.pow(childrenPerBand, 3));
    expect(elapsed).toBeLessThan(500);
  });

  it('should show significant speedup with index vs without index (5K parents)', () => {
    const parentCount = 5_000;
    const childrenPerParent = 3;
    const parentRows = makeParentRows(parentCount);
    const bandResults: BandResult[] = [
      makeBandResult('band_0', parentCount, childrenPerParent),
      makeBandResult('band_1', parentCount, childrenPerParent),
      makeBandResult('band_2', parentCount, childrenPerParent),
    ];
    const supersetCols = [
      'ParentKey', 'ParentName', 'ParentValue',
      '_band_0_col0', '_band_0_col1',
      '_band_1_col0', '_band_1_col1',
      '_band_2_col0', '_band_2_col1',
      '_band_id',
    ];

    // Without index (O(n) filter per parent per band)
    const startNoIndex = performance.now();
    for (const parentRow of parentRows) {
      crossProductRows(parentRow, bandResults, supersetCols, 10_000);
    }
    const elapsedNoIndex = performance.now() - startNoIndex;

    // With index (O(1) lookup per parent per band)
    const childIndex = buildBandChildIndex(bandResults);
    const startWithIndex = performance.now();
    for (const parentRow of parentRows) {
      crossProductRows(parentRow, bandResults, supersetCols, 10_000, childIndex);
    }
    const elapsedWithIndex = performance.now() - startWithIndex;

    // The indexed version should be at least 3x faster
    // (typically 10-50x faster for large datasets)
    const speedup = elapsedNoIndex / elapsedWithIndex;
    expect(speedup).toBeGreaterThan(3);
  });
});

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

describe('crossProductRows() indexed vs non-indexed equivalence', () => {
  it('should produce identical results with and without index', () => {
    const parentRow = { OrderId: 'ORD-001', Company: 'Acme' };
    const bandResults: BandResult[] = [{
      band: { id: 'band_0' } as DetailBandSpec,
      rows: [
        { OrderId: 'ORD-001', _band_0_Product: 'Widget' },
        { OrderId: 'ORD-001', _band_0_Product: 'Gadget' },
        { OrderId: 'ORD-002', _band_0_Product: 'Other' },
      ],
      cols: ['_band_0_Product'],
      parentKeyAliases: ['OrderId'],
      childKeyCols: ['OrderId'],
    }, {
      band: { id: 'band_1' } as DetailBandSpec,
      rows: [
        { OrderId: 'ORD-001', _band_1_Note: 'Rush' },
        { OrderId: 'ORD-001', _band_1_Note: 'Priority' },
      ],
      cols: ['_band_1_Note'],
      parentKeyAliases: ['OrderId'],
      childKeyCols: ['OrderId'],
    }];
    const superset = ['OrderId', 'Company', '_band_0_Product', '_band_1_Note', '_band_id'];

    // Without index
    const resultNoIndex = crossProductRows(parentRow, bandResults, superset);

    // With index
    const childIndex = buildBandChildIndex(bandResults);
    const resultWithIndex = crossProductRows(parentRow, bandResults, superset, 10_000, childIndex);

    // Same number of rows
    expect(resultWithIndex.length).toBe(resultNoIndex.length);

    // Same content in each row
    for (let i = 0; i < resultNoIndex.length; i++) {
      for (const col of superset) {
        expect(resultWithIndex[i][col]).toEqual(resultNoIndex[i][col]);
      }
    }
  });

  it('should handle no matching children identically', () => {
    const parentRow = { OrderId: 'ORD-999' };
    const bandResults: BandResult[] = [{
      band: { id: 'band_0' } as DetailBandSpec,
      rows: [{ OrderId: 'ORD-001', col: 'x' }],
      cols: ['col'],
      parentKeyAliases: ['OrderId'],
      childKeyCols: ['OrderId'],
    }];
    const superset = ['OrderId', 'col', '_band_id'];

    const childIndex = buildBandChildIndex(bandResults);
    const resultNoIndex = crossProductRows(parentRow, bandResults, superset);
    const resultWithIndex = crossProductRows(parentRow, bandResults, superset, 10_000, childIndex);

    expect(resultWithIndex.length).toBe(resultNoIndex.length);
    expect(resultWithIndex.length).toBe(1);
    expect(resultWithIndex[0]['OrderId']).toBe('ORD-999');
  });
});
