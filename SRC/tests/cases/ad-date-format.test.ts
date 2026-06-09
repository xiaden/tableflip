import { describe, it, expect, beforeEach } from 'vitest';
import { detectDateFormat, normalizeDateExpr, getColumnSamples, type DateFormat } from '../../js/core/date-format.js';
import { db } from '../../js/core/state.js';

describe('Date Format Detection', () => {
  describe('detectDateFormat()', () => {
    it('should detect MM/DD/YYYY format', () => {
      const result = detectDateFormat(['12/25/2023', '01/15/2024', '06/30/2022']);
      expect(result).toBe('mdy');
    });

    it('should detect DD/MM/YYYY when day > 12', () => {
      const result = detectDateFormat(['25/12/2023', '15/01/2024', '30/06/2022']);
      expect(result).toBe('dmy');
    });

    it('should detect DD MMM YYYY format', () => {
      const result = detectDateFormat(['25-Dec-2023', '3-Jan-2024', '15-Jun-2022']);
      expect(result).toBe('dmmy');
    });

    it('should return null for empty input', () => {
      expect(detectDateFormat([])).toBeNull();
    });

    it('should return null for non-date strings', () => {
      expect(detectDateFormat(['hello', 'world', 'foo'])).toBeNull();
    });

    it('should return null for ISO dates (already normalized)', () => {
      expect(detectDateFormat(['2023-12-25', '2024-01-15'])).toBeNull();
    });

    it('should prefer dmmy when DD MMM YYYY detected', () => {
      const result = detectDateFormat(['1-Jan-2023', '15-Feb-2024']);
      expect(result).toBe('dmmy');
    });

    it('should disambiguate MM/DD vs DD/MM using day > 12', () => {
      // 13/01/2023 — only valid as DD/MM (month 13 invalid)
      const result = detectDateFormat(['13/01/2023', '14/02/2024']);
      expect(result).toBe('dmy');
    });

    it('should disambiguate MM/DD vs DD/MM using month > 12', () => {
      // 01/13/2023 — only valid as MM/DD (day 13 valid, month 13 invalid for DD/MM)
      const result = detectDateFormat(['01/13/2023', '02/14/2024']);
      expect(result).toBe('mdy');
    });

    it('should default to mdy for fully ambiguous dates', () => {
      // 01/02/2023 — valid as both MM/DD and DD/MM
      const result = detectDateFormat(['01/02/2023', '03/04/2024']);
      expect(result).toBe('mdy');
    });

    it('should handle single-digit month/day', () => {
      const result = detectDateFormat(['1/5/2023', '12/25/2024']);
      expect(result).toBe('mdy');
    });
  });

  describe('normalizeDateExpr()', () => {
    it('should return original expression when format is null', () => {
      expect(normalizeDateExpr('"col"', null)).toBe('"col"');
    });

    it('should generate mdy conversion SQL', () => {
      const result = normalizeDateExpr('"OrderDate"', 'mdy');
      expect(result).toContain('substr');
      expect(result).toContain("substr(\"OrderDate\",7,4) || '-' || substr(\"OrderDate\",1,2) || '-' || substr(\"OrderDate\",4,2)");
    });

    it('should generate dmy conversion SQL', () => {
      const result = normalizeDateExpr('"OrderDate"', 'dmy');
      expect(result).toContain("substr(\"OrderDate\",7,4) || '-' || substr(\"OrderDate\",4,2) || '-' || substr(\"OrderDate\",1,2)");
    });

    it('should generate dmmy conversion SQL', () => {
      const result = normalizeDateExpr('"OrderDate"', 'dmmy');
      expect(result).toContain('instr');
      expect(result).toContain('printf');
    });
  });

  describe('getColumnSamples()', () => {
    beforeEach(() => {
      db.tables = {} as typeof db.tables;
    });

    it('should return samples when available', () => {
      (db.tables as Record<string, unknown>)['T1'] = {
        id: 'T1', name: 'Test', cols: ['Date'], rowCount: 3,
        samples: { Date: ['12/25/2023', '01/15/2024'] },
      };
      expect(getColumnSamples('T1', 'Date')).toEqual(['12/25/2023', '01/15/2024']);
    });

    it('should return empty array when no samples', () => {
      (db.tables as Record<string, unknown>)['T1'] = {
        id: 'T1', name: 'Test', cols: ['Date'], rowCount: 0,
      };
      expect(getColumnSamples('T1', 'Date')).toEqual([]);
    });

    it('should return empty array for missing table', () => {
      expect(getColumnSamples('T1', 'Date')).toEqual([]);
    });
  });
});
