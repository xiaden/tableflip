/**
 * Tests for report/result-set.ts — band metadata and ResultSet.bandResult field.
 *
 * Covers bandCount, bandIds, bandLabels in ResultSet metadata, and the
 * BandResultSet structure on the bandResult field.
 */
import { describe, it, expect } from 'vitest';
import { buildResultSet } from '../../report/result-set';
import type { ResultSetMetadata, ResultSet } from '../../report/result-set';
import type { BandResultSet } from '../../types';

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

  describe('ResultSet.bandResult field', () => {
    it('should have bandResult undefined by default', () => {
      const result = buildResultSet(['A'], [{ A: 1 }]);
      expect(result.bandResult).toBeUndefined();
    });

    it('should allow bandResult to be attached post-construction', () => {
      const result = buildResultSet(['OrderId', 'Company'], [
        { OrderId: 'ORD-001', Company: 'Acme' },
        { OrderId: 'ORD-002', Company: 'Beta' },
      ]);

      const bandResult: BandResultSet = {
        parentRows: [
          { OrderId: 'ORD-001', Company: 'Acme' },
          { OrderId: 'ORD-002', Company: 'Beta' },
        ],
        parentCols: ['OrderId', 'Company'],
        bandResults: [{
          band: { id: 'band_0', rightId: 'Items', keyPairs: [{ left: 'OrderId', right: 'OrderId' }], cols: ['Product', 'Qty'], enabled: true, sorts: [], label: 'Line Items' },
          rows: [
            { OrderId: 'ORD-001', _band_0_Product: 'Widget', _band_0_Qty: 5 },
            { OrderId: 'ORD-002', _band_0_Product: 'Gadget', _band_0_Qty: 3 },
          ],
          cols: ['_band_0_Product', '_band_0_Qty'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        bandLabels: { band_0: 'Line Items' },
      };

      // bandResult is attached post-assignment (engine sets it after buildResultSet)
      (result as ResultSet).bandResult = bandResult;
      expect(result.bandResult).toBeDefined();
      expect(result.bandResult).toBe(bandResult);
    });

    it('should have bandResult structure matching BandResultSet interface', () => {
      const result = buildResultSet(['OrderId'], [{ OrderId: 'ORD-001' }]);

      const bandResult: BandResultSet = {
        parentRows: [{ OrderId: 'ORD-001' }],
        parentCols: ['OrderId'],
        bandResults: [],
        bandLabels: {},
      };
      (result as ResultSet).bandResult = bandResult;

      // Verify BandResultSet structure
      expect(result.bandResult).toBeDefined();
      expect(Array.isArray(result.bandResult!.parentRows)).toBe(true);
      expect(Array.isArray(result.bandResult!.parentCols)).toBe(true);
      expect(Array.isArray(result.bandResult!.bandResults)).toBe(true);
      expect(typeof result.bandResult!.bandLabels).toBe('object');

      // Verify parentRows structure
      expect(result.bandResult!.parentRows).toHaveLength(1);
      expect(result.bandResult!.parentRows[0]).toHaveProperty('OrderId');

      // Verify parentCols
      expect(result.bandResult!.parentCols).toEqual(['OrderId']);

      // Verify bandResults is an array (empty in this case)
      expect(result.bandResult!.bandResults).toHaveLength(0);

      // Verify bandLabels
      expect(result.bandResult!.bandLabels).toEqual({});
    });

    it('should have bandResult with populated bandResults matching BandResult interface', () => {
      const result = buildResultSet(['OrderId'], [{ OrderId: 'ORD-001' }]);

      const bandResult: BandResultSet = {
        parentRows: [{ OrderId: 'ORD-001' }],
        parentCols: ['OrderId'],
        bandResults: [{
          band: { id: 'band_0', rightId: 'Items', keyPairs: [{ left: 'OrderId', right: 'OrderId' }], cols: ['Product'], enabled: true, sorts: [], label: 'Items' },
          rows: [{ OrderId: 'ORD-001', _band_0_Product: 'Widget' }],
          cols: ['_band_0_Product'],
          parentKeyAliases: ['OrderId'],
          childKeyCols: ['OrderId'],
        }],
        bandLabels: { band_0: 'Items' },
      };
      (result as ResultSet).bandResult = bandResult;

      // Verify BandResult structure within bandResults
      expect(result.bandResult!.bandResults).toHaveLength(1);
      const br = result.bandResult!.bandResults[0];
      expect(br.band.id).toBe('band_0');
      expect(Array.isArray(br.rows)).toBe(true);
      expect(Array.isArray(br.cols)).toBe(true);
      expect(Array.isArray(br.parentKeyAliases)).toBe(true);
      expect(Array.isArray(br.childKeyCols)).toBe(true);
      expect(br.rows).toHaveLength(1);
      expect(br.cols).toEqual(['_band_0_Product']);
    });
  });
});
