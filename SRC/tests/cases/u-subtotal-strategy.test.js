
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runReportPipeline,
  expectReportHealthy,
  expectReportBlocked,
  expectItemBlocked,
  expectResultRowCount,
  sqlContains,
  findRow,
} from '../helpers.js';

describe('U. Subtotal strategy — combined vs nested', () => {

  // ── 1. Combined (default) with 2-level subtotalBy (regression) ──────────────
  it('should produce a single GROUP BY for combined strategy (2-level)', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    const subCount = r.result.rows.filter(row => row._row_type === 1).length;
    assert.ok(subCount > 0, 'Should have subtotal rows');
    const groupByCount = (r.sql.match(/GROUP BY/g) || []).length;
    assert.equal(groupByCount, 1, 'Combined should have 1 GROUP BY branch');
    // GROUP BY uses table-qualified aliases in SQL
    assert.ok(r.sql.includes('GROUP BY "Orders"."Region", "Orders"."Company"'),
      'Combined should GROUP BY Region, Company');
  });

  // ── 2. Combined respects subtotalOnTop ──────────────────────────────────────
  it('should order subtotals correctly for combined on-top', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    const firstNonGrand = r.result.rows.find(row => row._row_type !== 3);
    assert.equal(firstNonGrand._row_type, 1, 'First row should be subtotal (on-top)');
  });

  it('should order subtotals correctly for combined on-bottom', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalOnTop: false,
    });
    expectReportHealthy(r.validation);
    const firstDetail = r.result.rows.find(row => row._row_type === 0);
    const firstSub = r.result.rows.find(row => row._row_type === 1);
    assert.ok(firstDetail, 'Should have detail rows');
    assert.ok(firstSub, 'Should have subtotal rows');
    // On-bottom: detail rows appear before their subtotal rows
    const firstDetailIdx = r.result.rows.indexOf(firstDetail);
    const firstSubIdx = r.result.rows.indexOf(firstSub);
    assert.ok(firstDetailIdx < firstSubIdx,
      'Detail should appear before subtotal (on-bottom)');
  });

  // ── 3. Default strategy is 'combined' ──────────────────────────────────────
  it('should default to combined strategy when unspecified', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    const groupByCount = (r.sql.match(/GROUP BY/g) || []).length;
    assert.equal(groupByCount, 1, 'Default strategy should produce 1 GROUP BY');
  });

  // ── 4. Nested strategy with 2-level subtotalBy (on-top) ────────────────────
  it('should produce multiple GROUP BY branches for nested strategy', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    // Nested: one GROUP BY per prefix depth 2 branches
    const groupByCount = (r.sql.match(/GROUP BY/g) || []).length;
    assert.equal(groupByCount, 2, 'Nested (2-level) should have 2 GROUP BY branches');
    assert.ok(r.sql.includes('GROUP BY "Orders"."Region"'),
      'Nested should GROUP BY Region (depth 0)');
    assert.ok(r.sql.includes('GROUP BY "Orders"."Region", "Orders"."Company"'),
      'Nested should GROUP BY Region, Company (depth 1)');
  });

  it('should produce correct _row_type distribution for nested on-top', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    const rows = r.result.rows;
    const subtotalRows = rows.filter(row => row._row_type === 1);
    const detailRows = rows.filter(row => row._row_type === 0);
    const grandRows = rows.filter(row => row._row_type === 3);
    assert.ok(subtotalRows.length > 0, 'Should have subtotal rows');
    assert.ok(detailRows.length > 0, 'Should have detail rows');
    assert.equal(grandRows.length, 1, 'Should have grand total row');
  });

  it('should order nested subtotals with shallower levels first (on-top)', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    assert.ok(sqlContains(r.sql, 'NULLS FIRST'),
      'Nested on-top should use NULLS FIRST on deeper sort keys');
    assert.ok(r.sql.includes('"_sort_group_0" ASC NULLS LAST'),
      'sort_group_0 should use NULLS LAST');
  });

  it('should have nested subtotal at level 0 before level 1 in result (on-top)', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    // Region subtotals have Company=null, Region+Company subtotals have Company set
    const rows = r.result.rows.filter(row => row._row_type === 1);
    const level0 = rows.filter(row => row.Company === null);
    const level1 = rows.filter(row => row.Company !== null);
    assert.ok(level0.length > 0, 'Should have level-0 subtotals (Company=null)');
    assert.ok(level1.length > 0, 'Should have level-1 subtotals (Company=set)');
    // Level-0 should sort before level-1 within same Region
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (prev.Region === cur.Region && prev.Company === null) {
        assert.notEqual(cur.Company, null,
          'Level-0 subtotal (Company=null) should come before level-1');
      }
    }
  });

  it('should use NULLS LAST for all sort keys in nested on-bottom', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalOnTop: false,
    });
    expectReportHealthy(r.validation);
    const nullsFirstCount = (r.sql.match(/NULLS FIRST/g) || []).length;
    assert.equal(nullsFirstCount, 0, 'Nested on-bottom should not use NULLS FIRST');
    const nullsLastCount = (r.sql.match(/NULLS LAST/g) || []).length;
    assert.ok(nullsLastCount >= 2, 'Nested on-bottom should use NULLS LAST for sort keys');
  });

  // ── 5. Nested with 1-level subtotalBy (short-circuit  same as combined) ────
  it('should produce same result as combined for single subtotalBy', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
    });
    expectReportHealthy(r.validation);
    const groupByCount = (r.sql.match(/GROUP BY/g) || []).length;
    assert.equal(groupByCount, 1, '1-level nested should produce 1 GROUP BY');
    assert.ok(r.sql.includes('GROUP BY "Orders"."Region"'),
      '1-level nested should GROUP BY Region');
  });

  // ── 6. Nested with grand total ─────────────────────────────────────────────
  it('should include grand total with nested strategy (on-top)', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalGrandTotal: true,
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    const grandRows = r.result.rows.filter(row => row._row_type === 3);
    assert.equal(grandRows.length, 1, 'Should have grand total row');
    const lastRow = r.result.rows[r.result.rows.length - 1];
    assert.equal(lastRow._row_type, 3, 'Grand total should be last row');
  });

  it('should include grand total with nested strategy (on-bottom)', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalGrandTotal: true,
      subtotalOnTop: false,
    });
    expectReportHealthy(r.validation);
    const grandRows = r.result.rows.filter(row => row._row_type === 3);
    assert.equal(grandRows.length, 1, 'Should have grand total row');
    const lastRow = r.result.rows[r.result.rows.length - 1];
    assert.equal(lastRow._row_type, 3, 'Grand total should be last row');
  });

  it('should suppress grand total when all subtotalFns are skip with nested', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'skip' },
      subtotalStrategy: 'nested',
      subtotalGrandTotal: true,
    });
    expectReportHealthy(r.validation);
    const grandRows = r.result.rows.filter(row => row._row_type === 3);
    assert.equal(grandRows.length, 0, 'Should not have grand total row');
  });

  // ── 7. Nested with spacer ──────────────────────────────────────────────────
  it('should include spacer rows with nested strategy', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalSpacer: true,
      subtotalGrandTotal: true,
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    const spacerRows = r.result.rows.filter(row => row._row_type === 2);
    assert.ok(spacerRows.length > 0, 'Should have spacer rows');
  });

  // ── 8. Nested with subtotalFns ─────────────────────────────────────────────
  it('should apply subtotalFns correctly with nested strategy', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    const subtotalRows = r.result.rows.filter(row => row._row_type === 1);
    for (const row of subtotalRows) {
      assert.notEqual(row.Amount, null,
        'Subtotal Amount should not be null since SUM is applied');
    }
  });

  it('should apply different subtotalFns per column with nested', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'MAX' },
      subtotalStrategy: 'nested',
      subtotalOnTop: true,
    });
    expectReportHealthy(r.validation);
    const subtotalRows = r.result.rows.filter(row => row._row_type === 1);
    for (const row of subtotalRows) {
      assert.notEqual(row.Amount, null,
        'Subtotal Amount should not be null since MAX is applied');
    }
  });

  // ── 9. Validation blocks invalid subtotalStrategy ──────────────────────────
  it('should block invalid subtotalStrategy values', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'invalid_strategy',
    });
    expectReportBlocked(r.validation);
    expectItemBlocked(r.validation, 'subtotalStrategy');
  });

  it('should accept "combined" strategy as healthy', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'combined',
    });
    expectReportHealthy(r.validation);
  });

  it('should accept "nested" strategy as healthy', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
    });
    expectReportHealthy(r.validation);
  });

  // ── 10. Nested with 3-level subtotalBy ─────────────────────────────────────
  it('should produce 3 GROUP BY branches for 3-level nested', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Status', 'Company', 'Amount']),
      colOrder: ['Region', 'Status', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Status', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
    });
    expectReportHealthy(r.validation);
    const groupByCount = (r.sql.match(/GROUP BY/g) || []).length;
    assert.equal(groupByCount, 3, 'Nested (3-level) should have 3 GROUP BY branches');
    assert.ok(r.sql.includes('GROUP BY "Orders"."Region"'),
      'Depth 0: GROUP BY Region');
    assert.ok(r.sql.includes('GROUP BY "Orders"."Region", "Orders"."Status"'),
      'Depth 1: GROUP BY Region, Status');
    assert.ok(r.sql.includes('GROUP BY "Orders"."Region", "Orders"."Status", "Orders"."Company"'),
      'Depth 2: GROUP BY Region, Status, Company');
  });

  // ── 11. Nested does not affect detail rows ─────────────────────────────────
  it('should produce same detail rows for combined and nested', () => {
    const c = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'combined',
    });
    const n = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
    });
    expectReportHealthy(c.validation);
    expectReportHealthy(n.validation);
    const cDetails = c.result.rows.filter(row => row._row_type === 0);
    const nDetails = n.result.rows.filter(row => row._row_type === 0);
    assert.equal(cDetails.length, nDetails.length,
      'Detail row count should match between strategies');
    for (let i = 0; i < cDetails.length; i++) {
      assert.equal(cDetails[i].Region, nDetails[i].Region,
        `Detail row ${i}: Region mismatch`);
      assert.equal(cDetails[i].Company, nDetails[i].Company,
        `Detail row ${i}: Company mismatch`);
      assert.equal(cDetails[i].Amount, nDetails[i].Amount,
        `Detail row ${i}: Amount mismatch`);
    }
  });

  // ── 12. Subtotals with user-specified sorts ────────────────────────────────
  it('should preserve user-specified sorts on non-subtotalBy columns in nested', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region', 'Company'],
      subtotalFns: { Amount: 'SUM' },
      subtotalStrategy: 'nested',
      sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
    });
    expectReportHealthy(r.validation);
    assert.ok(sqlContains(r.sql, 'Amount DESC'));
  });

});
