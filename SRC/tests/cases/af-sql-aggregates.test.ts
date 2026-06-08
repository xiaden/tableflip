import { describe, it, expect } from 'vitest';
import { renderAggregateExpr } from '../../js/query/sql-aggregates.js';

describe('SQL Aggregates', () => {
  it('should render SUM', () => {
    expect(renderAggregateExpr('SUM', '"Amount"')).toBe('SUM("Amount")');
  });

  it('should render AVG', () => {
    expect(renderAggregateExpr('AVG', '"Amount"')).toBe('AVG("Amount")');
  });

  it('should render MIN', () => {
    expect(renderAggregateExpr('MIN', '"Amount"')).toBe('MIN("Amount")');
  });

  it('should render MAX', () => {
    expect(renderAggregateExpr('MAX', '"Amount"')).toBe('MAX("Amount")');
  });

  it('should render COUNT ROWS', () => {
    expect(renderAggregateExpr('COUNT ROWS', '"Amount"')).toBe('COUNT(*)');
  });

  it('should render COUNT NON-EMPTY', () => {
    expect(renderAggregateExpr('COUNT NON-EMPTY', '"Amount"')).toBe('COUNT("Amount")');
  });

  it('should render COUNT DISTINCT', () => {
    expect(renderAggregateExpr('COUNT DISTINCT', '"Amount"')).toBe('COUNT(DISTINCT "Amount")');
  });

  it('should render FIRST as MIN', () => {
    expect(renderAggregateExpr('FIRST', '"OrderDate"')).toBe('MIN("OrderDate")');
  });

  it('should render LAST as MAX', () => {
    expect(renderAggregateExpr('LAST', '"OrderDate"')).toBe('MAX("OrderDate")');
  });

  it('should render DATE RANGE', () => {
    expect(renderAggregateExpr('DATE RANGE', '"OrderDate"')).toBe(`MIN("OrderDate") || ' — ' || MAX("OrderDate")`);
  });

  it('should render DATE SPAN', () => {
    expect(renderAggregateExpr('DATE SPAN', '"OrderDate"')).toBe('CAST(julianday(MAX("OrderDate")) - julianday(MIN("OrderDate")) AS INTEGER)');
  });

  it('should render NUMERIC RANGE', () => {
    expect(renderAggregateExpr('NUMERIC RANGE', '"Amount"')).toBe(`MIN("Amount") || ' – ' || MAX("Amount")`);
  });

  it('should render NUMERIC SPAN', () => {
    expect(renderAggregateExpr('NUMERIC SPAN', '"Amount"')).toBe('MAX("Amount") - MIN("Amount")');
  });

  it('should render LIST', () => {
    expect(renderAggregateExpr('LIST', '"Region"')).toBe('GROUP_CONCAT(DISTINCT "Region")');
  });

  it('should fall back to COUNT for unknown function', () => {
    expect(renderAggregateExpr('UNKNOWN', '"col"')).toBe('COUNT("col")');
  });
});
