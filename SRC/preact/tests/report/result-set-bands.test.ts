import { describe, it, expect } from 'vitest';
import { buildResultSet } from '../../report/result-set';
import type { ResultSetMetadata } from '../../report/result-set';

describe('result-set band metadata', () => {
  describe('buildResultSet() with band fields', () => {
    it('should accept bandCount in metadata', () => {
      const result = buildResultSet(['A', '_band_id'], [{ A: 1, _band_id: null }], {
        bandCount: 2,
      });
      expect(result.metadata.bandCount).toBe(2);
    });

    it('should accept bandIds in metadata', () => {
      const result = buildResultSet(['A', '_band_id'], [{ A: 1, _band_id: null }], {
        bandIds: ['band_0', 'band_1'],
      });
      expect(result.metadata.bandIds).toEqual(['band_0', 'band_1']);
    });

    it('should accept bandLabels in metadata', () => {
      const labels: Record<string, string> = { band_0: 'Line Items', band_1: 'Notes' };
      const result = buildResultSet(['A'], [{ A: 1 }], {
        bandLabels: labels,
      });
      expect(result.metadata.bandLabels).toEqual(labels);
      expect(result.metadata.bandLabels!['band_0']).toBe('Line Items');
      expect(result.metadata.bandLabels!['band_1']).toBe('Notes');
    });

    it('should include all band metadata together', () => {
      const result = buildResultSet(
        ['OrderId', '_band_0_Product', '_band_id'],
        [
          { OrderId: 'ORD-001', _band_0_Product: null, _band_id: null },
          { OrderId: null, _band_0_Product: 'Widget', _band_id: 'band_0' },
        ],
        {
          aggMode: 'none',
          bandCount: 1,
          bandIds: ['band_0'],
          bandLabels: { band_0: 'Items' },
        },
      );
      expect(result.metadata.aggMode).toBe('none');
      expect(result.metadata.bandCount).toBe(1);
      expect(result.metadata.bandIds).toEqual(['band_0']);
      expect(result.metadata.bandLabels).toEqual({ band_0: 'Items' });
      expect(result.metadata.rowCount).toBe(2);
    });

    it('should default band fields to undefined when not provided', () => {
      const result = buildResultSet(['A'], [{ A: 1 }]);
      expect(result.metadata.bandCount).toBeUndefined();
      expect(result.metadata.bandIds).toBeUndefined();
      expect(result.metadata.bandLabels).toBeUndefined();
    });

    it('should handle zero bands', () => {
      const result = buildResultSet(['A'], [{ A: 1 }], {
        bandCount: 0,
        bandIds: [],
        bandLabels: {},
      });
      expect(result.metadata.bandCount).toBe(0);
      expect(result.metadata.bandIds).toEqual([]);
      expect(result.metadata.bandLabels).toEqual({});
    });

    it('should preserve band metadata alongside existing metadata fields', () => {
      const result = buildResultSet(['A', 'B'], [{ A: 1, B: 2 }], {
        aggMode: 'totals',
        totalsRow: { A: 'Total', B: 100 },
        bandCount: 1,
        bandIds: ['band_0'],
      });
      expect(result.metadata.aggMode).toBe('totals');
      expect(result.metadata.totalsRow).toEqual({ A: 'Total', B: 100 });
      expect(result.metadata.bandCount).toBe(1);
      expect(result.metadata.bandIds).toEqual(['band_0']);
    });

    it('should allow band metadata overrides via Partial<ResultSetMetadata>', () => {
      const meta: Partial<ResultSetMetadata> = {
        bandCount: 3,
        bandIds: ['b1', 'b2', 'b3'],
        bandLabels: { b1: 'First', b2: 'Second', b3: 'Third' },
      };
      const result = buildResultSet(['A'], [{ A: 1 }], meta);
      expect(result.metadata.bandCount).toBe(3);
      expect(result.metadata.bandIds!.length).toBe(3);
      expect(result.metadata.bandLabels!['b2']).toBe('Second');
    });
  });
});
