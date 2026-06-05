'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy, sqlContains } = require('../helpers.js');

describe('D. Sort add/remove', () => {
  it('should ORDER BY OrderDate descending', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount', 'OrderDate']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount', 'OrderDate'],
      aggMode: 'none',
      sorts: [{ col: 'OrderDate', dir: 'DESC', enabled: true }],
    });

    expectReportHealthy(r.validation);
    assert.ok(sqlContains(r.sql, 'ORDER BY'), 'SQL should contain ORDER BY');

    const dates = r.result.rows.map(row => row.OrderDate);
    const sorted = [...dates].sort().reverse();
    assert.deepEqual(dates, sorted, 'Rows should be sorted by OrderDate DESC');
  });

  it('should not contain ORDER BY after removing sort', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount', 'OrderDate']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount', 'OrderDate'],
      aggMode: 'none',
      sorts: [],
    });

    expectReportHealthy(r.validation);
    assert.ok(!sqlContains(r.sql, 'ORDER BY'), 'SQL should not contain ORDER BY after sort removed');
  });
});
