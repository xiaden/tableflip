import { describe, it, expect } from 'vitest';
import {
  AGG_FNS,
  AGG_LABELS,
  AGG_NEEDS_COL,
  TOTAL_FNS,
  TOTAL_LABELS,
  SUBTOTAL_FNS,
  SUBTOTAL_LABELS,
  AGG_MODES,
  getAggregateLabel,
  getTotalLabel,
  getSubtotalLabel,
  isValidAggregateFn,
  isValidTotalFn,
  isValidSubtotalFn,
  aggregateNeedsColumn,
} from '../../report/aggregation-constants';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('aggregation-constants', () => {
  // ── AGG_FNS ──────────────────────────────────────────────────────────────

  describe('AGG_FNS', () => {
    it('should contain all expected aggregate functions', () => {
      expect(AGG_FNS).toEqual([
        'SUM', 'AVG', 'MIN', 'MAX',
        'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
        'FIRST', 'LAST',
        'DATE RANGE', 'DATE SPAN',
        'NUMERIC RANGE', 'NUMERIC SPAN',
        'LIST',
      ]);
    });

    it('should have 14 functions', () => {
      expect(AGG_FNS).toHaveLength(14);
    });
  });

  // ── AGG_LABELS ───────────────────────────────────────────────────────────

  describe('AGG_LABELS', () => {
    it('should map all AGG_FNS to non-empty labels', () => {
      for (const fn of AGG_FNS) {
        expect(AGG_LABELS[fn]).toBeTruthy();
        expect(typeof AGG_LABELS[fn]).toBe('string');
        expect(AGG_LABELS[fn].length).toBeGreaterThan(0);
      }
    });

    it('should contain expected label mappings', () => {
      expect(AGG_LABELS['SUM']).toBe('Sum');
      expect(AGG_LABELS['AVG']).toBe('Average');
      expect(AGG_LABELS['MIN']).toBe('Min value');
      expect(AGG_LABELS['MAX']).toBe('Max value');
      expect(AGG_LABELS['COUNT ROWS']).toBe('Count rows');
      expect(AGG_LABELS['COUNT NON-EMPTY']).toBe('Count non-empty');
      expect(AGG_LABELS['COUNT DISTINCT']).toBe('Count distinct');
      expect(AGG_LABELS['FIRST']).toBe('First value');
      expect(AGG_LABELS['LAST']).toBe('Last value');
      expect(AGG_LABELS['LIST']).toBeTruthy();
    });
  });

  // ── TOTAL_FNS ────────────────────────────────────────────────────────────

  describe('TOTAL_FNS', () => {
    it('should contain expected total functions', () => {
      expect(TOTAL_FNS).toEqual([
        'skip', 'SUM', 'AVG', 'MIN', 'MAX',
        'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT', 'LIST',
      ]);
    });

    it('should have 9 functions', () => {
      expect(TOTAL_FNS).toHaveLength(9);
    });
  });

  // ── TOTAL_LABELS ─────────────────────────────────────────────────────────

  describe('TOTAL_LABELS', () => {
    it('should map all TOTAL_FNS to non-empty labels', () => {
      for (const fn of TOTAL_FNS) {
        expect(TOTAL_LABELS[fn]).toBeTruthy();
        expect(typeof TOTAL_LABELS[fn]).toBe('string');
        expect(TOTAL_LABELS[fn].length).toBeGreaterThan(0);
      }
    });

    it('should contain expected label mappings', () => {
      expect(TOTAL_LABELS['skip']).toBe('Skip (leave blank)');
      expect(TOTAL_LABELS['SUM']).toBe('Sum');
      expect(TOTAL_LABELS['AVG']).toBe('Average');
      expect(TOTAL_LABELS['LIST']).toBeTruthy();
    });
  });

  // ── SUBTOTAL_FNS ─────────────────────────────────────────────────────────

  describe('SUBTOTAL_FNS', () => {
    it('should contain expected subtotal functions', () => {
      expect(SUBTOTAL_FNS).toEqual([
        'skip',
        'SUM', 'AVG', 'MIN', 'MAX',
        'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
        'FIRST', 'LAST',
        'DATE RANGE', 'DATE SPAN',
        'NUMERIC RANGE', 'NUMERIC SPAN',
        'LIST',
      ]);
    });

    it('should have 15 functions', () => {
      expect(SUBTOTAL_FNS).toHaveLength(15);
    });
  });

  // ── SUBTOTAL_LABELS ──────────────────────────────────────────────────────

  describe('SUBTOTAL_LABELS', () => {
    it('should map all SUBTOTAL_FNS to non-empty labels', () => {
      for (const fn of SUBTOTAL_FNS) {
        expect(SUBTOTAL_LABELS[fn]).toBeTruthy();
        expect(typeof SUBTOTAL_LABELS[fn]).toBe('string');
        expect(SUBTOTAL_LABELS[fn].length).toBeGreaterThan(0);
      }
    });

    it('should contain expected label mappings', () => {
      expect(SUBTOTAL_LABELS['skip']).toBe('Skip (leave blank)');
      expect(SUBTOTAL_LABELS['SUM']).toBe('Sum');
      expect(SUBTOTAL_LABELS['DATE RANGE']).toBeTruthy();
      expect(SUBTOTAL_LABELS['NUMERIC SPAN']).toBeTruthy();
    });
  });

  // ── AGG_MODES ────────────────────────────────────────────────────────────

  describe('AGG_MODES', () => {
    it('should contain all four aggregation modes', () => {
      expect(AGG_MODES).toEqual(['none', 'group', 'totals', 'subtotals']);
    });

    it('should have 4 modes', () => {
      expect(AGG_MODES).toHaveLength(4);
    });
  });

  // ── getAggregateLabel ────────────────────────────────────────────────────

  describe('getAggregateLabel()', () => {
    it('should return label for known function', () => {
      expect(getAggregateLabel('SUM')).toBe('Sum');
      expect(getAggregateLabel('AVG')).toBe('Average');
      expect(getAggregateLabel('COUNT ROWS')).toBe('Count rows');
    });

    it('should return fallback (raw fn name) for unknown function', () => {
      expect(getAggregateLabel('UNKNOWN_FN')).toBe('UNKNOWN_FN');
      expect(getAggregateLabel('')).toBe('');
    });
  });

  // ── getTotalLabel ────────────────────────────────────────────────────────

  describe('getTotalLabel()', () => {
    it('should return label for known function', () => {
      expect(getTotalLabel('SUM')).toBe('Sum');
      expect(getTotalLabel('skip')).toBe('Skip (leave blank)');
      expect(getTotalLabel('LIST')).toBeTruthy();
    });

    it('should return fallback (raw fn name) for unknown function', () => {
      expect(getTotalLabel('UNKNOWN_FN')).toBe('UNKNOWN_FN');
    });
  });

  // ── getSubtotalLabel ─────────────────────────────────────────────────────

  describe('getSubtotalLabel()', () => {
    it('should return label for known function', () => {
      expect(getSubtotalLabel('SUM')).toBe('Sum');
      expect(getSubtotalLabel('skip')).toBe('Skip (leave blank)');
      expect(getSubtotalLabel('DATE RANGE')).toBeTruthy();
    });

    it('should return fallback (raw fn name) for unknown function', () => {
      expect(getSubtotalLabel('UNKNOWN_FN')).toBe('UNKNOWN_FN');
    });
  });

  // ── isValidAggregateFn ───────────────────────────────────────────────────

  describe('isValidAggregateFn()', () => {
    it('should return true for valid aggregate functions', () => {
      for (const fn of AGG_FNS) {
        expect(isValidAggregateFn(fn)).toBe(true);
      }
    });

    it('should return false for invalid function names', () => {
      expect(isValidAggregateFn('UNKNOWN')).toBe(false);
      expect(isValidAggregateFn('skip')).toBe(false); // skip is total-only
      expect(isValidAggregateFn('')).toBe(false);
    });
  });

  // ── isValidTotalFn ───────────────────────────────────────────────────────

  describe('isValidTotalFn()', () => {
    it('should return true for valid total functions', () => {
      for (const fn of TOTAL_FNS) {
        expect(isValidTotalFn(fn)).toBe(true);
      }
    });

    it('should return false for invalid function names', () => {
      expect(isValidTotalFn('UNKNOWN')).toBe(false);
      expect(isValidTotalFn('FIRST')).toBe(false); // FIRST is not in TOTAL_FNS
      expect(isValidTotalFn('')).toBe(false);
    });
  });

  // ── isValidSubtotalFn ────────────────────────────────────────────────────

  describe('isValidSubtotalFn()', () => {
    it('should return true for valid subtotal functions', () => {
      for (const fn of SUBTOTAL_FNS) {
        expect(isValidSubtotalFn(fn)).toBe(true);
      }
    });

    it('should return false for invalid function names', () => {
      expect(isValidSubtotalFn('UNKNOWN')).toBe(false);
      expect(isValidSubtotalFn('')).toBe(false);
    });
  });

  // ── aggregateNeedsColumn ─────────────────────────────────────────────────

  describe('aggregateNeedsColumn()', () => {
    it('should return false for COUNT ROWS', () => {
      expect(aggregateNeedsColumn('COUNT ROWS')).toBe(false);
    });

    it('should return true for SUM', () => {
      expect(aggregateNeedsColumn('SUM')).toBe(true);
    });

    it('should return true for AVG', () => {
      expect(aggregateNeedsColumn('AVG')).toBe(true);
    });

    it('should return true for MIN', () => {
      expect(aggregateNeedsColumn('MIN')).toBe(true);
    });

    it('should return true for MAX', () => {
      expect(aggregateNeedsColumn('MAX')).toBe(true);
    });

    it('should return true for COUNT NON-EMPTY', () => {
      expect(aggregateNeedsColumn('COUNT NON-EMPTY')).toBe(true);
    });

    it('should return true for COUNT DISTINCT', () => {
      expect(aggregateNeedsColumn('COUNT DISTINCT')).toBe(true);
    });

    it('should return true for FIRST', () => {
      expect(aggregateNeedsColumn('FIRST')).toBe(true);
    });

    it('should return true for LAST', () => {
      expect(aggregateNeedsColumn('LAST')).toBe(true);
    });

    it('should return true for LIST', () => {
      expect(aggregateNeedsColumn('LIST')).toBe(true);
    });

    it('should delegate to AGG_NEEDS_COL', () => {
      // Verify the delegation matches
      expect(aggregateNeedsColumn('COUNT ROWS')).toBe(AGG_NEEDS_COL('COUNT ROWS'));
      expect(aggregateNeedsColumn('SUM')).toBe(AGG_NEEDS_COL('SUM'));
    });
  });
});
