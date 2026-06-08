import { describe, it, expect } from 'vitest';
import { renderWhereClause } from '../../js/query/sql-where.js';

describe('renderWhereClause', () => {
  it('should return null for unknown operator', () => {
    const params: unknown[] = [];
    const result = renderWhereClause('"Col"', 'bogus', 'val', params);
    expect(result).toBeNull();
    expect(params).toHaveLength(0);
  });

  describe('contains', () => {
    it('should generate LIKE with wildcards', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Name"', 'contains', 'foo', params);
      expect(result).toBe(`CAST("Name" AS TEXT) LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(['%foo%']);
    });

    it('should escape LIKE metacharacters in value', () => {
      const params: unknown[] = [];
      renderWhereClause('"Name"', 'contains', '100%', params);
      expect(params).toEqual(['%100\\%%']);
    });

    it('should escape underscore in value', () => {
      const params: unknown[] = [];
      renderWhereClause('"Name"', 'contains', 'a_b', params);
      expect(params).toEqual(['%a\\_b%']);
    });
  });

  describe('equals', () => {
    it('should use text comparison by default', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Status"', 'equals', 'Open', params);
      expect(result).toBe(`CAST("Status" AS TEXT) = ?`);
      expect(params).toEqual(['Open']);
    });

    it('should use numeric comparison with numericHint and numeric value', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Amount"', 'equals', '150', params, { numericHint: true });
      expect(result).toBe(`CAST("Amount" AS REAL) = ?`);
      expect(params).toEqual([150]);
    });

    it('should strip commas from numeric values', () => {
      const params: unknown[] = [];
      renderWhereClause('"Amount"', 'equals', '1,500', params, { numericHint: true });
      expect(params).toEqual([1500]);
    });

    it('should fall back to text when numericHint but non-numeric value', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Status"', 'equals', 'Open', params, { numericHint: true });
      expect(result).toBe(`CAST("Status" AS TEXT) = ?`);
      expect(params).toEqual(['Open']);
    });

    it('should fall back to text when numericHint but empty value', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Amount"', 'equals', '', params, { numericHint: true });
      expect(result).toBe(`CAST("Amount" AS TEXT) = ?`);
      expect(params).toEqual(['']);
    });
  });

  describe('not equals', () => {
    it('should use text comparison by default', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Status"', 'not equals', 'Closed', params);
      expect(result).toBe(`CAST("Status" AS TEXT) != ?`);
      expect(params).toEqual(['Closed']);
    });

    it('should use numeric comparison with numericHint', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Amount"', 'not equals', '100', params, { numericHint: true });
      expect(result).toBe(`CAST("Amount" AS REAL) != ?`);
      expect(params).toEqual([100]);
    });
  });

  describe('comparison operators', () => {
    it('should handle > operator', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Amount"', '>', '50', params);
      expect(result).toBe(`CAST("Amount" AS REAL) > ?`);
      expect(params).toEqual([50]);
    });

    it('should handle < operator', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Amount"', '<', '100', params);
      expect(result).toBe(`CAST("Amount" AS REAL) < ?`);
      expect(params).toEqual([100]);
    });

    it('should handle >= operator', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Amount"', '>=', '200', params);
      expect(result).toBe(`CAST("Amount" AS REAL) >= ?`);
      expect(params).toEqual([200]);
    });

    it('should handle <= operator', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Amount"', '<=', '300', params);
      expect(result).toBe(`CAST("Amount" AS REAL) <= ?`);
      expect(params).toEqual([300]);
    });

    it('should default to 0 for non-numeric values in comparison operators', () => {
      const params: unknown[] = [];
      renderWhereClause('"Amount"', '>', 'abc', params);
      expect(params).toEqual([0]);
    });

    it('should handle decimal values', () => {
      const params: unknown[] = [];
      renderWhereClause('"Amount"', '>', '99.5', params);
      expect(params).toEqual([99.5]);
    });
  });

  describe('starts with', () => {
    it('should generate LIKE with trailing wildcard', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Name"', 'starts with', 'Acme', params);
      expect(result).toBe(`CAST("Name" AS TEXT) LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(['Acme%']);
    });

    it('should escape LIKE metacharacters', () => {
      const params: unknown[] = [];
      renderWhereClause('"Name"', 'starts with', '100_%', params);
      expect(params).toEqual(['100\\_\\%%']);
    });
  });

  describe('ends with', () => {
    it('should generate LIKE with leading wildcard', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Name"', 'ends with', 'Corp', params);
      expect(result).toBe(`CAST("Name" AS TEXT) LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(['%Corp']);
    });
  });

  describe('is empty', () => {
    it('should check for NULL or empty string', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Phone"', 'is empty', '', params);
      expect(result).toBe(`("Phone" IS NULL OR CAST("Phone" AS TEXT) = '')`);
      expect(params).toHaveLength(0);
    });

    it('should ignore provided value', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Phone"', 'is empty', 'ignored', params);
      expect(result).toBe(`("Phone" IS NULL OR CAST("Phone" AS TEXT) = '')`);
      expect(params).toHaveLength(0);
    });
  });

  describe('not empty', () => {
    it('should check for NOT NULL and non-empty string', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Phone"', 'not empty', '', params);
      expect(result).toBe(`("Phone" IS NOT NULL AND CAST("Phone" AS TEXT) != '')`);
      expect(params).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle null value by passing null to params', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Col"', 'equals', null as any, params);
      expect(result).toBe(`CAST("Col" AS TEXT) = ?`);
      expect(params).toEqual([null]);
    });

    it('should handle undefined value by passing undefined to params', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Col"', 'equals', undefined as any, params);
      expect(result).toBe(`CAST("Col" AS TEXT) = ?`);
      expect(params).toEqual([undefined]);
    });

    it('should trim whitespace from value', () => {
      const params: unknown[] = [];
      renderWhereClause('"Col"', 'equals', '  hello  ', params);
      expect(params).toEqual(['  hello  ']);
    });

    it('should handle single quotes in value (no SQL injection)', () => {
      const params: unknown[] = [];
      const result = renderWhereClause('"Col"', 'equals', "Robert'; DROP TABLE--", params);
      expect(result).toBe(`CAST("Col" AS TEXT) = ?`);
      expect(params).toEqual(["Robert'; DROP TABLE--"]);
    });

    it('should handle values with both % and _ for contains', () => {
      const params: unknown[] = [];
      renderWhereClause('"Col"', 'contains', '%_%', params);
      expect(params).toEqual(['%\\%\\_\\%%']);
    });
  });
});
