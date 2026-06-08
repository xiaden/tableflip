import { describe, it, expect } from 'vitest';
import { buildResultSet } from '../../js/report/result-set.js';

describe('Result Set', () => {
  describe('buildResultSet', () => {
    it('should build a result set with columns and rows', () => {
      const rs = buildResultSet(['A', 'B'], [{ A: 1, B: 2 }, { A: 3, B: 4 }]);
      expect(rs.columns).toEqual(['A', 'B']);
      expect(rs.rows.length).toBe(2);
      expect(rs.rows[0]).toEqual({ A: 1, B: 2 });
      expect(rs.rows[1]).toEqual({ A: 3, B: 4 });
    });

    it('should set metadata defaults', () => {
      const rs = buildResultSet(['A'], [{ A: 1 }]);
      expect(rs.metadata.rowCount).toBe(1);
      expect(rs.metadata.aggMode).toBe('none');
      expect(rs.metadata.displayCols).toBeNull();
      expect(typeof rs.metadata.generatedAt).toBe('number');
    });

    it('should handle empty rows', () => {
      const rs = buildResultSet(['A', 'B'], []);
      expect(rs.columns).toEqual(['A', 'B']);
      expect(rs.rows).toEqual([]);
      expect(rs.metadata.rowCount).toBe(0);
    });

    it('should handle null rows by treating as empty', () => {
      const rs = buildResultSet(['A'], null as any);
      expect(rs.rows).toEqual([]);
      expect(rs.metadata.rowCount).toBe(0);
    });

    it('should handle null columns by treating as empty', () => {
      const rs = buildResultSet(null as any, [{ A: 1 }]);
      expect(rs.columns).toEqual([]);
      expect(rs.rows.length).toBe(1);
    });

    it('should handle both null columns and rows', () => {
      const rs = buildResultSet(null as any, null as any);
      expect(rs.columns).toEqual([]);
      expect(rs.rows).toEqual([]);
      expect(rs.metadata.rowCount).toBe(0);
    });

    it('should allow overriding metadata', () => {
      const rs = buildResultSet(
        ['A'],
        [{ A: 1 }],
        { aggMode: 'sum', displayCols: ['A'] }
      );
      expect(rs.metadata.aggMode).toBe('sum');
      expect(rs.metadata.displayCols).toEqual(['A']);
    });

    it('should preserve rowCount from actual rows even if metadata override omits it', () => {
      const rs = buildResultSet(
        ['A'],
        [{ A: 1 }, { A: 2 }, { A: 3 }],
        { aggMode: 'avg' }
      );
      expect(rs.metadata.rowCount).toBe(3);
      expect(rs.metadata.aggMode).toBe('avg');
    });

    it('should allow overriding rowCount explicitly', () => {
      const rs = buildResultSet(
        ['A'],
        [{ A: 1 }],
        { rowCount: 99 }
      );
      expect(rs.metadata.rowCount).toBe(99);
    });

    it('should support different aggModes', () => {
      const modes = ['none', 'sum', 'avg', 'count', 'min', 'max'];
      for (const mode of modes) {
        const rs = buildResultSet(['A'], [{ A: 1 }], { aggMode: mode });
        expect(rs.metadata.aggMode).toBe(mode);
      }
    });

    it('should support totalsRow in metadata', () => {
      const rs = buildResultSet(
        ['A', 'B'],
        [{ A: 1, B: 10 }, { A: 2, B: 20 }],
        { totalsRow: { A: 3, B: 30 }, hasSubtotals: true }
      );
      expect(rs.metadata.totalsRow).toEqual({ A: 3, B: 30 });
      expect(rs.metadata.hasSubtotals).toBe(true);
    });

    it('should support allCols in metadata', () => {
      const rs = buildResultSet(
        ['A'],
        [{ A: 1 }],
        { allCols: ['A', 'B', 'C'], displayCols: ['A'] }
      );
      expect(rs.metadata.allCols).toEqual(['A', 'B', 'C']);
      expect(rs.metadata.displayCols).toEqual(['A']);
    });

    it('should have a generatedAt timestamp close to now', () => {
      const before = Date.now();
      const rs = buildResultSet(['A'], [{ A: 1 }]);
      const after = Date.now();
      expect(rs.metadata.generatedAt).toBeGreaterThanOrEqual(before);
      expect(rs.metadata.generatedAt).toBeLessThanOrEqual(after);
    });

    it('should allow overriding generatedAt', () => {
      const ts = 1000000;
      const rs = buildResultSet(['A'], [{ A: 1 }], { generatedAt: ts });
      expect(rs.metadata.generatedAt).toBe(ts);
    });

    it('should handle rows with varying keys', () => {
      const rs = buildResultSet(
        ['A', 'B', 'C'],
        [{ A: 1 }, { B: 2 }, { C: 3 }]
      );
      expect(rs.rows.length).toBe(3);
      expect(rs.columns).toEqual(['A', 'B', 'C']);
    });
  });
});
