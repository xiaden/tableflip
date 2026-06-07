
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportHealthy, expectResultColumns, expectResultRowCount, sqlContains } from '../helpers.js';

describe('C. Filter add/remove', () => {
  it('should add WHERE clause and return only Open rows when Status filter is active', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
      aggMode: 'none',
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
    });

    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['OrderId', 'Company', 'Status', 'Amount']);
    assert.ok(sqlContains(r.sql, 'WHERE'), 'SQL should contain WHERE with filter');
    expectResultRowCount(r.result, 4);
    for (const row of r.result.rows) {
      assert.equal(row.Status, 'Open');
    }
  });

  it('should remove WHERE clause when the filter is disabled', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
      aggMode: 'none',
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: false }],
    });

    expectReportHealthy(r.validation);
    expectResultRowCount(r.result, 8);
    const hasFilterWhere = sqlContains(r.sql, 'WHERE') && sqlContains(r.sql, 'Status');
    assert.ok(!hasFilterWhere, 'WHERE should not contain Status filter after removal');
  });
});
