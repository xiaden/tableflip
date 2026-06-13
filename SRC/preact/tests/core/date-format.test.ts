import { describe, it, expect, beforeEach } from 'vitest';
import { initStore } from '../../core/store';
import {
  normalizeDateExpr,
  getDateInputFormat,
  isISODate,
  getColumnSamples,
} from '../../core/date-format';

beforeEach(() => {
  initStore();
});

describe('date-format', () => {
  describe('normalizeDateExpr()', () => {
    it('should return column expression unchanged when format is null', () => {
      expect(normalizeDateExpr('"col"', null)).toBe('"col"');
    });

    it('should return column expression unchanged when format is undefined', () => {
      expect(normalizeDateExpr('"col"', undefined)).toBe('"col"');
    });

    it('should normalize MM/DD/YYYY format', () => {
      const result = normalizeDateExpr('"col"', { first: 'MM', second: 'DD', third: 'YYYY' });
      // Output: YYYY || '-' || MM || '-' || DD (2-digit components don't need printf)
      expect(result).toContain('substr');
      expect(result).toContain("|| '-' ||");
    });

    it('should normalize DD-MM-YYYY format', () => {
      const result = normalizeDateExpr('"col"', { first: 'DD', second: 'MM', third: 'YYYY' });
      // Output: YYYY || '-' || MM || '-' || DD (no printf needed for 2-digit components)
      expect(result).toContain('substr');
      expect(result).toContain("|| '-' ||");
    });

    it('should normalize YY/MM/DD format with 2-digit year', () => {
      const result = normalizeDateExpr('"col"', { first: 'YY', second: 'MM', third: 'DD' });
      expect(result).toContain("'20' ||");
      expect(result).toContain('substr');
    });

    it('should normalize MMM DD, YYYY format (month abbreviation)', () => {
      const result = normalizeDateExpr('"col"', { first: 'MMM', second: 'DD', third: 'YYYY' });
      expect(result).toContain('CASE UPPER');
      expect(result).toContain('JAN');
      expect(result).toContain('DEC');
    });

    it('should normalize M/D/YYYY format (single-digit month/day)', () => {
      const result = normalizeDateExpr('"col"', { first: 'M', second: 'D', third: 'YYYY' });
      expect(result).toContain('printf');
      expect(result).toContain('%02d');
    });

    it('should concatenate year-month-day with hyphens', () => {
      const result = normalizeDateExpr('"col"', { first: 'YYYY', second: 'MM', third: 'DD' });
      expect(result).toContain("'-' ||");
      expect(result).toContain("|| '-'");
    });
  });

  describe('getDateInputFormat()', () => {
    it('should return null for undefined input', () => {
      expect(getDateInputFormat(undefined)).toBeNull();
    });

    it('should return null for empty inputFormat', () => {
      expect(getDateInputFormat({})).toBeNull();
    });

    it('should return null when any component is missing', () => {
      expect(getDateInputFormat({ inputFormat: { first: 'MM', second: 'DD', third: '' as any } })).toBeNull();
    });

    it('should return valid DateInputFormat when all components present', () => {
      const result = getDateInputFormat({
        inputFormat: { first: 'MM', second: 'DD', third: 'YYYY' },
      });
      expect(result).toEqual({ first: 'MM', second: 'DD', third: 'YYYY' });
    });
  });

  describe('isISODate()', () => {
    it('should return true for all ISO date strings', () => {
      expect(isISODate(['2025-01-15', '2025-02-01', '2025-03-10'])).toBe(true);
    });

    it('should return true for ISO dates with time component', () => {
      expect(isISODate(['2025-01-15T10:30:00', '2025-02-01 12:00:00'])).toBe(true);
    });

    it('should return false when any value is not ISO format', () => {
      expect(isISODate(['2025-01-15', '01/15/2025'])).toBe(false);
    });

    it('should return false for non-date strings', () => {
      expect(isISODate(['hello', 'world'])).toBe(false);
    });

    it('should ignore empty strings', () => {
      expect(isISODate(['2025-01-15', '', '  '])).toBe(true);
    });

    it('should return false for empty array', () => {
      expect(isISODate([])).toBe(false);
    });

    it('should return false for all-empty array', () => {
      expect(isISODate(['', '', ''])).toBe(false);
    });

    it('should handle single ISO date', () => {
      expect(isISODate(['2025-06-01'])).toBe(true);
    });

    it('should handle single non-ISO date', () => {
      expect(isISODate(['06/01/2025'])).toBe(false);
    });
  });

  describe('getColumnSamples()', () => {
    it('should return empty array when table has no samples', () => {
      expect(getColumnSamples('NonExistent', 'col')).toEqual([]);
    });

    it('should return samples for a column', () => {
      initStore({
        tables: {
          Orders: {
            id: 'Orders',
            name: 'Orders',
            cols: ['Amount'],
            rowCount: 3,
            samples: { Amount: ['100', '200', '300'] },
          } as any,
        },
      });
      expect(getColumnSamples('Orders', 'Amount')).toEqual(['100', '200', '300']);
    });

    it('should return empty array when column has no samples', () => {
      initStore({
        tables: {
          Orders: {
            id: 'Orders',
            name: 'Orders',
            cols: ['Amount'],
            rowCount: 3,
            samples: {},
          } as any,
        },
      });
      expect(getColumnSamples('Orders', 'Amount')).toEqual([]);
    });
  });
});
