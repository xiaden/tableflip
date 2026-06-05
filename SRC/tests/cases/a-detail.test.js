'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy, expectResultColumns, expectResultRowCount, sqlContains } = require('../helpers.js');
const { ORDERS_ROWS } = require('../fixtures.js');

describe('A. Basic detail report', () => {
  it('should return all rows with expected columns', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
      aggMode: 'none',
    });

    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['OrderId', 'Company', 'Status', 'Amount']);
    expectResultRowCount(r.result, 8);

    assert.ok(sqlContains(r.sql, 'SELECT'), 'SQL should contain SELECT');
    assert.ok(sqlContains(r.sql, 'FROM Orders'), 'SQL should reference Orders');
    assert.ok(!sqlContains(r.sql, 'JOIN'), 'No JOIN for simple detail');
    assert.ok(!sqlContains(r.sql, 'WHERE'), 'No WHERE without filters');
    assert.ok(!sqlContains(r.sql, 'ORDER BY'), 'No ORDER BY without sort');
    assert.ok(!sqlContains(r.sql, 'GROUP BY'), 'No GROUP BY in detail mode');

    assert.equal(r.result.rows[0].OrderId, 'ORD-001');
    assert.equal(r.result.rows[0].Amount, 150);
    assert.equal(r.result.rows.length, ORDERS_ROWS.length);
  });
});
