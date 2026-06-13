import { describe, it, expect } from 'vitest';
import { buildResultSet } from '../../report/result-set';
import type { ResultSetMetadata } from '../../report/result-set';

describe('result-set', () => {
  describe('buildResultSet()', () => {
    it('should build a basic result set with columns and rows', () => {
      const cols = ['A', 'B', 'C'];
      const rows = [
        { A: 1, B: 'x', C: true },
        { A: 2, B: 'y', C: false },
      ];
      const result = buildResultSet(cols, rows);

      expect(result.columns).toEqual(['A', 'B', 'C']);
      expect(result.rows).toEqual(rows);
      expect(result.metadata.rowCount).toBe(2);
      expect(result.metadata.aggMode).toBe('none');
      expect(result.metadata.displayCols).toBeNull();
      expect(typeof result.metadata.generatedAt).toBe('number');
    });

    it('should default metadata: rowCount from rows.length', () => {
      const rows = [{ X: 1 }, { X: 2 }, { X: 3 }];
      const result = buildResultSet(['X'], rows);
      expect(result.metadata.rowCount).toBe(3);
    });

    it('should default metadata: generatedAt is a number', () => {
      const result = buildResultSet(['A'], []);
      expect(typeof result.metadata.generatedAt).toBe('number');
      expect(result.metadata.generatedAt).toBeGreaterThan(0);
    });

    it('should default metadata: aggMode is "none"', () => {
      const result = buildResultSet(['A'], []);
      expect(result.metadata.aggMode).toBe('none');
    });

    it('should default metadata: displayCols is null', () => {
      const result = buildResultSet(['A'], []);
      expect(result.metadata.displayCols).toBeNull();
    });

    it('should allow custom metadata overrides', () => {
      const rows = [{ A: 1 }];
      const meta: Partial<ResultSetMetadata> = {
        aggMode: 'group',
        displayCols: ['A'],
        generatedAt: 12345,
      };
      const result = buildResultSet(['A'], rows, meta);
      expect(result.metadata.aggMode).toBe('group');
      expect(result.metadata.displayCols).toEqual(['A']);
      expect(result.metadata.generatedAt).toBe(12345);
      expect(result.metadata.rowCount).toBe(1); // still from rows.length
    });

    it('should handle empty rows → rowCount=0', () => {
      const result = buildResultSet(['A', 'B'], []);
      expect(result.columns).toEqual(['A', 'B']);
      expect(result.rows).toEqual([]);
      expect(result.metadata.rowCount).toBe(0);
    });

    it('should coerce non-array rows to empty array', () => {
      const result = buildResultSet(['A'], null as unknown as Record<string, unknown>[]);
      expect(result.rows).toEqual([]);
      expect(result.metadata.rowCount).toBe(0);
    });

    it('should coerce non-array columns to empty array', () => {
      const result = buildResultSet(null as unknown as string[], [{ A: 1 }]);
      expect(result.columns).toEqual([]);
    });

    it('should include totalsRow in metadata when provided', () => {
      const totalsRow = { A: 'Total', B: 100 };
      const result = buildResultSet(['A', 'B'], [{ A: 1, B: 10 }], {
        aggMode: 'totals',
        totalsRow,
      });
      expect(result.metadata.totalsRow).toEqual(totalsRow);
      expect(result.metadata.aggMode).toBe('totals');
    });

    it('should include hasSubtotals and allCols in metadata when provided', () => {
      const result = buildResultSet(['A', 'B'], [{ A: 1, B: 10 }], {
        aggMode: 'subtotals',
        hasSubtotals: true,
        allCols: ['A', 'B', 'C'],
      });
      expect(result.metadata.hasSubtotals).toBe(true);
      expect(result.metadata.allCols).toEqual(['A', 'B', 'C']);
    });

    it('should have undefined band metadata fields when not provided (backward-compatible)', () => {
      const result = buildResultSet(['A'], [{ A: 1 }]);
      expect(result.metadata.bandCount).toBeUndefined();
      expect(result.metadata.bandIds).toBeUndefined();
      expect(result.metadata.bandLabels).toBeUndefined();
    });

    it('should accept band metadata fields alongside existing metadata', () => {
      const result = buildResultSet(['A'], [{ A: 1 }], {
        bandCount: 2,
        bandIds: ['band_0', 'band_1'],
        bandLabels: { band_0: 'Items', band_1: 'Notes' },
      });
      expect(result.metadata.bandCount).toBe(2);
      expect(result.metadata.bandIds).toEqual(['band_0', 'band_1']);
      expect(result.metadata.bandLabels).toEqual({ band_0: 'Items', band_1: 'Notes' });
      expect(result.metadata.rowCount).toBe(1);
      expect(result.metadata.aggMode).toBe('none');
    });
  });
});
