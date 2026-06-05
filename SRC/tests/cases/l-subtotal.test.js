'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy } = require('../helpers.js');

describe('L. Subtotal report', () => {
  it('should produce subtotal rows by Region', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      colTotals: { Amount: 'SUM' },
    });

    expectReportHealthy(r.validation);
    assert.ok(r.result.rows.length > 0, 'Should have result rows');

    const hasSubtotal = r.result.rows.some(row => row._row_type === 1);
    assert.ok(hasSubtotal, 'Should contain subtotal rows (_row_type=1)');
  });
});
