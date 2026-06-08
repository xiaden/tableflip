import { expect } from 'vitest';
import { db } from '../js/core/state.js';
import { invalidateValidation, getValidation } from '../js/report/validation.js';
import { buildSourceCatalog } from '../js/catalog/source-catalog.js';
import { buildQueryPlan } from '../js/query/query-plan.js';
import { renderDetailSql } from '../js/query/sql-detail.js';
import { renderGroupedSql } from '../js/query/sql-grouped.js';
import { renderTotalsSql } from '../js/query/sql-totals.js';
import { renderSubtotalsSql } from '../js/query/sql-subtotals.js';
import { runReport } from '../js/report/engine.js';

export interface ReportConfig {
  base?: string;
  baseCols?: string[] | null;
  stacks?: string[];
  lookups?: any[];
  calcStages?: any[];
  selCols?: Set<string> | null;
  colOrder?: string[] | null;
  filters?: any[];
  sorts?: any[];
  groupBy?: string[];
  aggregates?: any[];
  aggMode?: string;
  colTotals?: Record<string, string>;
  subtotalBy?: string[];
  subtotalFns?: Record<string, string>;
  subtotalGrandTotal?: boolean;
  subtotalSpacer?: boolean;
  subtotalOnTop?: boolean;
  subtotalStrategy?: string;
  mergedCols?: string[];
  mergeGroupUnderline?: boolean;
  excludedRows?: Record<string, Set<number>>;
}

export interface ReportResult {
  validation: any;
  plan: any;
  sql: string;
  result: any;
  error: string | null;
}

export function runReportPipeline(config: ReportConfig = {}): ReportResult {
  // Apply config to db
  if (config.base !== undefined) db.base = config.base;
  if (config.baseCols !== undefined) db.baseCols = config.baseCols;
  if (config.stacks !== undefined) db.stacks = config.stacks;
  if (config.lookups !== undefined) db.lookups = config.lookups;
  if (config.calcStages !== undefined) db.calcStages = config.calcStages;
  if (config.selCols !== undefined) db.selCols = config.selCols;
  if (config.colOrder !== undefined) db.colOrder = config.colOrder;
  if (config.filters !== undefined) db.filters = config.filters;
  if (config.sorts !== undefined) db.sorts = config.sorts;
  if (config.groupBy !== undefined) db.groupBy = config.groupBy;
  if (config.aggregates !== undefined) db.aggregates = config.aggregates;
  if (config.aggMode !== undefined) db.aggMode = config.aggMode as any;
  if (config.colTotals !== undefined) db.colTotals = config.colTotals;
  if (config.subtotalBy !== undefined) db.subtotalBy = config.subtotalBy;
  if (config.subtotalFns !== undefined) db.subtotalFns = config.subtotalFns;
  if (config.subtotalGrandTotal !== undefined) db.subtotalGrandTotal = config.subtotalGrandTotal;
  if (config.subtotalSpacer !== undefined) db.subtotalSpacer = config.subtotalSpacer;
  if (config.subtotalOnTop !== undefined) db.subtotalOnTop = config.subtotalOnTop;
  if (config.subtotalStrategy !== undefined) db.subtotalStrategy = config.subtotalStrategy;
  if (config.mergedCols !== undefined) db.mergedCols = config.mergedCols;
  if (config.mergeGroupUnderline !== undefined) db.mergeGroupUnderline = config.mergeGroupUnderline;
  if (config.excludedRows !== undefined) db.excludedRows = config.excludedRows;

  // Invalidate validation cache
  invalidateValidation();
  const validation = getValidation();

  // Build source catalog
  const sourceCatalog = buildSourceCatalog();

  // Build query plan
  let plan: any = null;
  let sql = '';
  let error: string | null = null;

  try {
    plan = buildQueryPlan(null, null, validation as unknown as Record<string, unknown> | null, sourceCatalog);

    // Render SQL based on mode
    const mode = plan.aggMode || 'none';
    if (mode === 'group') {
      const result = renderGroupedSql(plan);
      sql = result.sql;
    } else if (mode === 'totals') {
      const detail = renderDetailSql(plan);
      const totals = renderTotalsSql(plan, detail.cols);
      sql = detail.sql;
    } else if (mode === 'subtotals') {
      const subResult = renderSubtotalsSql(plan);
      sql = subResult!.sql;
    } else {
      const detResult = renderDetailSql(plan);
      sql = detResult.sql;
    }
  } catch (e: any) {
    error = e.message;
  }

  // Execute report if not blocked
  let result = null;
  if (!error && validation?.reportStatus !== 'blocked') {
    try {
      result = runReport();
    } catch (e: any) {
      error = e.message;
    }
  }

  return { validation, plan, sql, result: result!, error };
}

export function expectReportHealthy(validation: any): void {
  expect(validation, 'validation result should exist').toBeTruthy();
  expect(validation.reportStatus, 'Expected healthy report').toBe('healthy');
}

export function expectReportBlocked(validation: any): void {
  expect(validation, 'validation result should exist').toBeTruthy();
  expect(validation.reportStatus, 'Expected blocked report').toBe('blocked');
}

export function expectResultColumns(result: any, expectedCols: string[]): void {
  expect(result, 'Result should exist').toBeTruthy();
  expect(result.columns, 'Result should have columns').toEqual(expectedCols);
}

export function expectResultRowCount(result: any, expectedCount: number): void {
  expect(result, 'Result should exist').toBeTruthy();
  expect(result.rows, 'Result should have rows').toHaveLength(expectedCount);
}

export function expectRowsEqual(actual: any[], expected: any[]): void {
  expect(actual, 'Row count should match').toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    for (const key of Object.keys(expected[i])) {
      expect(actual[i][key], `Row ${i}, col "${key}"`).toBe(expected[i][key]);
    }
  }
}

export function sqlContains(sql: string, fragment: string): boolean {
  const normalizedSql = normalizeSql(sql);
  const normalizedFragment = normalizeSql(fragment);
  return normalizedSql.includes(normalizedFragment);
}

export function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .replace(/\s*([=<>!])\s*/g, '$1')
    .replace(/"/g, '')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function findRow(rows: any[], matcher: Record<string, any>): any | null {
  for (const row of rows) {
    let allMatch = true;
    for (const [k, v] of Object.entries(matcher)) {
      if (row[k] !== v) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return row;
  }
  return null;
}
