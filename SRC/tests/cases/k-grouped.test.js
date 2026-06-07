
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportHealthy, expectResultRowCount, sqlContains } from '../helpers.js';

describe('K. Grouped report', () => {
  it('should GROUP BY Region with SUM Amount', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      aggMode: 'group',
      groupBy: ['Region'],
      aggregates: [{ alias: 'TotalAmount', col: 'Amount', fn: 'SUM', enabled: true }],
    });

    expectReportHealthy(r.validation);
    assert.ok(sqlContains(r.sql, 'GROUP BY'), 'Grouped report should have GROUP BY');
    expectResultRowCount(r.result, 4);

    const regions = r.result.rows.map(row => row.Region).sort();
    assert.deepEqual(regions, ['East', 'North', 'South', 'West']);
  });
});
