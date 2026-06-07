
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportHealthy, expectResultColumns, sqlContains } from '../helpers.js';

describe('B. Column enable/disable', () => {
  it('should exclude Amount from plan and result when disabled', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status']),
      colOrder: ['OrderId', 'Company', 'Status'],
      aggMode: 'none',
    });

    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['OrderId', 'Company', 'Status']);
    assert.ok(!sqlContains(r.sql, 'Amount'), 'Amount should NOT appear in SQL');
    assert.ok(!r.plan.selectedColumns.includes('Amount'));
  });

  it('should include Amount after re-enabling', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
      aggMode: 'none',
    });

    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['OrderId', 'Company', 'Status', 'Amount']);
    assert.ok(sqlContains(r.sql, 'Amount'), 'Amount should appear in SQL');
  });
});
