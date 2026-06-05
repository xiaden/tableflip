'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy, expectResultRowCount, sqlContains } = require('../helpers.js');

describe('M. Report type switching', () => {
  it('should switch detail grouped subtotal detail without cross-leakage', () => {
    const d1 = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
    });
    expectReportHealthy(d1.validation);
    expectResultRowCount(d1.result, 8);
    assert.ok(!sqlContains(d1.sql, 'GROUP BY'), 'Detail should not have GROUP BY');

    const g = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'group',
      groupBy: ['Company'],
      aggregates: [{ alias: 'Total', col: 'Amount', fn: 'SUM', enabled: true }],
    });
    expectReportHealthy(g.validation);
    assert.ok(sqlContains(g.sql, 'GROUP BY'), 'Grouped should have GROUP BY');
    assert.ok(g.result.rows.length < 8, 'Grouped should have fewer rows');
    assert.ok(g.result.rows.length > 0, 'Grouped should have some rows');

    const s = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(s.validation);
    const hasSubtotal = s.result.rows.some(row => row._row_type === 1);
    assert.ok(hasSubtotal, 'Subtotal mode should have subtotal rows');

    const d2 = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
    });
    expectReportHealthy(d2.validation);
    expectResultRowCount(d2.result, 8);
    assert.ok(!sqlContains(d2.sql, 'GROUP BY'), 'Return to detail should not have GROUP BY');
    assert.ok(!sqlContains(d2.sql, '_row_type'), 'Return to detail should not have subtotal markers');
  });
});
