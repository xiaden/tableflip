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
} from '../../js/ui/components/aggregation-constants.js';

describe('aggregation-constants', () => {
  describe('AGG_FNS', () => {
    it('should contain standard aggregate functions', () => {
      expect(AGG_FNS).toContain('SUM');
      expect(AGG_FNS).toContain('AVG');
      expect(AGG_FNS).toContain('MIN');
      expect(AGG_FNS).toContain('MAX');
      expect(AGG_FNS).toContain('COUNT ROWS');
    });

    it('should include list function', () => {
      expect(AGG_FNS).toContain('LIST');
    });
  });

  describe('AGG_LABELS', () => {
    it('should have labels for all functions', () => {
      for (const fn of AGG_FNS) {
        expect(AGG_LABELS[fn]).toBeTruthy();
      }
    });
  });

  describe('AGG_NEEDS_COL', () => {
    it('should return false for COUNT ROWS', () => {
      expect(AGG_NEEDS_COL('COUNT ROWS')).toBe(false);
    });

    it('should return true for other functions', () => {
      expect(AGG_NEEDS_COL('SUM')).toBe(true);
      expect(AGG_NEEDS_COL('AVG')).toBe(true);
    });
  });

  describe('TOTAL_FNS', () => {
    it('should include skip and standard totals', () => {
      expect(TOTAL_FNS).toContain('skip');
      expect(TOTAL_FNS).toContain('SUM');
    });
  });

  describe('TOTAL_LABELS', () => {
    it('should have labels for all total functions', () => {
      for (const fn of TOTAL_FNS) {
        expect(TOTAL_LABELS[fn]).toBeTruthy();
      }
    });
  });

  describe('SUBTOTAL_FNS', () => {
    it('should include all subtotal functions', () => {
      expect(SUBTOTAL_FNS).toContain('skip');
      expect(SUBTOTAL_FNS).toContain('SUM');
      expect(SUBTOTAL_FNS).toContain('LIST');
    });
  });

  describe('SUBTOTAL_LABELS', () => {
    it('should have labels for all subtotal functions', () => {
      for (const fn of SUBTOTAL_FNS) {
        expect(SUBTOTAL_LABELS[fn]).toBeTruthy();
      }
    });
  });

  describe('AGG_MODES', () => {
    it('should contain the four aggregation modes', () => {
      expect(AGG_MODES).toEqual(['none', 'group', 'totals', 'subtotals']);
    });
  });

  describe('getAggregateLabel', () => {
    it('should return label for known function', () => {
      expect(getAggregateLabel('SUM')).toBe('Sum');
    });

    it('should return function name for unknown function', () => {
      expect(getAggregateLabel('UNKNOWN')).toBe('UNKNOWN');
    });
  });

  describe('getTotalLabel', () => {
    it('should return label for known function', () => {
      expect(getTotalLabel('SUM')).toBe('Sum');
    });

    it('should return label for skip', () => {
      expect(getTotalLabel('skip')).toBe('Skip (leave blank)');
    });
  });

  describe('getSubtotalLabel', () => {
    it('should return label for known function', () => {
      expect(getSubtotalLabel('SUM')).toBe('Sum');
    });
  });

  describe('isValidAggregateFn', () => {
    it('should return true for valid functions', () => {
      expect(isValidAggregateFn('SUM')).toBe(true);
      expect(isValidAggregateFn('AVG')).toBe(true);
    });

    it('should return false for invalid functions', () => {
      expect(isValidAggregateFn('INVALID')).toBe(false);
    });
  });

  describe('isValidTotalFn', () => {
    it('should return true for valid total functions', () => {
      expect(isValidTotalFn('SUM')).toBe(true);
      expect(isValidTotalFn('skip')).toBe(true);
    });

    it('should return false for invalid functions', () => {
      expect(isValidTotalFn('INVALID')).toBe(false);
    });
  });

  describe('isValidSubtotalFn', () => {
    it('should return true for valid subtotal functions', () => {
      expect(isValidSubtotalFn('SUM')).toBe(true);
      expect(isValidSubtotalFn('LIST')).toBe(true);
    });

    it('should return false for invalid functions', () => {
      expect(isValidSubtotalFn('INVALID')).toBe(false);
    });
  });

  describe('aggregateNeedsColumn', () => {
    it('should return false for COUNT ROWS', () => {
      expect(aggregateNeedsColumn('COUNT ROWS')).toBe(false);
    });

    it('should return true for other functions', () => {
      expect(aggregateNeedsColumn('SUM')).toBe(true);
    });
  });
});
