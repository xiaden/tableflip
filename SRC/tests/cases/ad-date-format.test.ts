import { describe, it, expect } from 'vitest';
import { normalizeDateExpr, getDateInputFormat, type DateInputFormat } from '../../js/core/date-format.js';

describe('Date Format', () => {
  describe('normalizeDateExpr()', () => {
    it('should return original expression when format is null', () => {
      expect(normalizeDateExpr('"col"', null)).toBe('"col"');
    });

    it('should return original expression when format is undefined', () => {
      expect(normalizeDateExpr('"col"', undefined)).toBe('"col"');
    });

    it('should generate MM/DD/YYYY conversion SQL', () => {
      const result = normalizeDateExpr('"OrderDate"', { first: 'MM', second: 'DD', third: 'YYYY' });
      expect(result).toContain("substr(\"OrderDate\", 1, 2)");
      expect(result).toContain("substr(\"OrderDate\", 4, 2)");
      expect(result).toContain("substr(\"OrderDate\", 7, 4)");
      expect(result).toContain("'-'");
    });

    it('should generate DD/MM/YYYY conversion SQL', () => {
      const result = normalizeDateExpr('"OrderDate"', { first: 'DD', second: 'MM', third: 'YYYY' });
      expect(result).toContain("substr(\"OrderDate\", 1, 2)");
      expect(result).toContain("substr(\"OrderDate\", 4, 2)");
      expect(result).toContain("substr(\"OrderDate\", 7, 4)");
    });

    it('should generate DD MMM YYYY conversion SQL', () => {
      const result = normalizeDateExpr('"OrderDate"', { first: 'DD', second: 'MMM', third: 'YYYY' });
      expect(result).toContain("substr(\"OrderDate\", 1, 2)");
      expect(result).toContain("substr(\"OrderDate\", 4, 3)");
      expect(result).toContain("substr(\"OrderDate\", 8, 4)");
      expect(result).toContain('CASE UPPER');
      expect(result).toContain("'JAN'");
    });

    it('should generate YYYY-MM-DD conversion SQL', () => {
      const result = normalizeDateExpr('"OrderDate"', { first: 'YYYY', second: 'MM', third: 'DD' });
      expect(result).toContain("substr(\"OrderDate\", 1, 4)");
      expect(result).toContain("substr(\"OrderDate\", 6, 2)");
      expect(result).toContain("substr(\"OrderDate\", 9, 2)");
    });

    it('should handle single-digit month with printf', () => {
      const result = normalizeDateExpr('"col"', { first: 'M', second: 'DD', third: 'YYYY' });
      expect(result).toContain('printf');
    });

    it('should handle single-digit day with printf', () => {
      const result = normalizeDateExpr('"col"', { first: 'MM', second: 'D', third: 'YYYY' });
      expect(result).toContain('printf');
    });

    it('should handle two-digit year with 20 prefix', () => {
      const result = normalizeDateExpr('"col"', { first: 'MM', second: 'DD', third: 'YY' });
      expect(result).toContain("'20'");
    });
  });

  describe('getDateInputFormat()', () => {
    it('should return null when date is undefined', () => {
      expect(getDateInputFormat(undefined)).toBeNull();
    });

    it('should return null when inputFormat is missing', () => {
      expect(getDateInputFormat({})).toBeNull();
    });

    it('should return null when inputFormat is incomplete', () => {
      const fmt = { first: 'MM' as const, second: 'DD' as const, third: '' as 'YYYY' };
      expect(getDateInputFormat({ inputFormat: fmt })).toBeNull();
    });

    it('should return format when all three components present', () => {
      const fmt = { first: 'MM' as const, second: 'DD' as const, third: 'YYYY' as const };
      expect(getDateInputFormat({ inputFormat: fmt })).toEqual(fmt);
    });
  });
});
