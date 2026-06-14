import { describe, it, expect } from 'vitest';
import { renderAggregateExpr, buildAggregates } from '../../query/sql-aggregates';
import type { AggregateSpec } from '../../types';
import { ordersColMap, normalizeSql } from './helpers';

describe('sql-aggregates', () => {
  describe('renderAggregateExpr()', () => {
    const colRef = '"Orders"."Amount"';

    it('should render SUM', () => {
      expect(renderAggregateExpr('SUM', colRef)).toBe(`SUM(${colRef})`);
    });

    it('should render AVG', () => {
      expect(renderAggregateExpr('AVG', colRef)).toBe(`AVG(${colRef})`);
    });

    it('should render MIN', () => {
      expect(renderAggregateExpr('MIN', colRef)).toBe(`MIN(${colRef})`);
    });

    it('should render MAX', () => {
      expect(renderAggregateExpr('MAX', colRef)).toBe(`MAX(${colRef})`);
    });

    it('should render COUNT ROWS as COUNT(*)', () => {
      expect(renderAggregateExpr('COUNT ROWS', colRef)).toBe('COUNT(*)');
    });

    it('should render COUNT NON-EMPTY as COUNT(colRef)', () => {
      expect(renderAggregateExpr('COUNT NON-EMPTY', colRef)).toBe(`COUNT(${colRef})`);
    });

    it('should render COUNT DISTINCT', () => {
      expect(renderAggregateExpr('COUNT DISTINCT', colRef)).toBe(`COUNT(DISTINCT ${colRef})`);
    });

    it('should render FIRST as MIN', () => {
      expect(renderAggregateExpr('FIRST', colRef)).toBe(`MIN(${colRef})`);
    });

    it('should render LAST as MAX', () => {
      expect(renderAggregateExpr('LAST', colRef)).toBe(`MAX(${colRef})`);
    });

    it('should render DATE RANGE', () => {
      const result = renderAggregateExpr('DATE RANGE', colRef);
      expect(result).toContain('MIN');
      expect(result).toContain('MAX');
      expect(result).toContain('—');
    });

    it('should render DATE SPAN', () => {
      const result = renderAggregateExpr('DATE SPAN', colRef);
      expect(result).toContain('julianday');
      expect(result).toContain('CAST');
    });

    it('should render NUMERIC RANGE', () => {
      const result = renderAggregateExpr('NUMERIC RANGE', colRef);
      expect(result).toContain('MIN');
      expect(result).toContain('MAX');
      expect(result).toContain('–');
    });

    it('should render NUMERIC SPAN', () => {
      const result = renderAggregateExpr('NUMERIC SPAN', colRef);
      expect(result).toContain('MAX');
      expect(result).toContain('MIN');
      expect(result).toContain('-');
    });

    it('should render LIST as GROUP_CONCAT', () => {
      const result = renderAggregateExpr('LIST', colRef);
      expect(result).toContain('GROUP_CONCAT');
      expect(result).toContain('DISTINCT');
    });

    it('should default to COUNT for unknown function', () => {
      expect(renderAggregateExpr('UNKNOWN', colRef)).toBe(`COUNT(${colRef})`);
    });
  });

  describe('buildAggregates()', () => {
    const colMap = ordersColMap();

    it('should return empty result for non-group mode', () => {
      const aggregates: AggregateSpec[] = [
        { col: 'Amount', fn: 'SUM', alias: 'Total', enabled: true },
      ];
      const result = buildAggregates(aggregates, 'none', colMap);
      expect(result.selects).toEqual([]);
      expect(result.groupBy).toEqual([]);
      expect(result.having).toBe('');
    });

    it('should return empty result for totals mode', () => {
      const aggregates: AggregateSpec[] = [
        { col: 'Amount', fn: 'SUM', alias: 'Total', enabled: true },
      ];
      const result = buildAggregates(aggregates, 'totals', colMap);
      expect(result.selects).toEqual([]);
    });

    it('should return empty result for subtotals mode', () => {
      const aggregates: AggregateSpec[] = [
        { col: 'Amount', fn: 'SUM', alias: 'Total', enabled: true },
      ];
      const result = buildAggregates(aggregates, 'subtotals', colMap);
      expect(result.selects).toEqual([]);
    });

    it('should produce SELECT expressions in group mode', () => {
      const aggregates: AggregateSpec[] = [
        { col: 'Amount', fn: 'SUM', alias: 'Total Amount', enabled: true },
      ];
      const result = buildAggregates(aggregates, 'group', colMap);
      expect(result.selects.length).toBe(1);
      const sel = normalizeSql(result.selects[0]);
      expect(sel).toContain('SUM');
      expect(sel).toContain('"Orders"."Amount"');
      expect(sel).toContain('AS "Total Amount"');
    });

    it('should handle multiple aggregates', () => {
      const aggregates: AggregateSpec[] = [
        { col: 'Amount', fn: 'SUM', alias: 'Total', enabled: true },
        { col: 'Amount', fn: 'AVG', alias: 'Average', enabled: true },
        { col: '*', fn: 'COUNT ROWS', alias: 'Count', enabled: true },
      ];
      const result = buildAggregates(aggregates, 'group', colMap);
      expect(result.selects.length).toBe(3);
      expect(normalizeSql(result.selects[0])).toContain('SUM');
      expect(normalizeSql(result.selects[1])).toContain('AVG');
      expect(normalizeSql(result.selects[2])).toContain('COUNT(*)');
    });

    it('should use default alias when alias is empty', () => {
      const aggregates: AggregateSpec[] = [
        { col: 'Amount', fn: 'SUM', alias: '', enabled: true },
      ];
      const result = buildAggregates(aggregates, 'group', colMap);
      expect(result.selects.length).toBe(1);
      // defaultAggAlias('SUM', 'Amount') => 'Total Amount'
      expect(normalizeSql(result.selects[0])).toContain('AS "Total Amount"');
    });

    it('should handle * column for COUNT ROWS', () => {
      const aggregates: AggregateSpec[] = [
        { col: '*', fn: 'COUNT ROWS', alias: 'Row Count', enabled: true },
      ];
      const result = buildAggregates(aggregates, 'group', colMap);
      expect(normalizeSql(result.selects[0])).toContain('COUNT(*)');
    });

    it('should handle * column for other functions', () => {
      const aggregates: AggregateSpec[] = [
        { col: '*', fn: 'LIST', alias: 'All', enabled: true },
      ];
      const result = buildAggregates(aggregates, 'group', colMap);
      // When col is '*', colRef is null → uses '*'
      expect(normalizeSql(result.selects[0])).toContain('GROUP_CONCAT');
    });
  });
});
