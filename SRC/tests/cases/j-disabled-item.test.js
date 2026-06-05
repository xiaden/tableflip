'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy, expectReportBlocked } = require('../helpers.js');

describe('J. Disabled unresolved item does not block', () => {
  it('should not block when missing lookup is disabled', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      lookups: [{
        rightId: 'NonExistentTable',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: [],
        required: false,
        enabled: false,
      }],
    });

    expectReportHealthy(r.validation);
    const item = r.validation.items['lookup_0'];
    assert.ok(item, 'Item should exist');
    assert.equal(item.blocking, false, 'Disabled item should not block');
  });

  it('should still block dependent enabled items', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company', 'FromCalc']),
      colOrder: ['OrderId', 'Company', 'FromCalc'],
      aggMode: 'none',
      calcStages: [{
        alias: 'FromCalc',
        left: 'MissingCol',
        op: '+',
        right: 'OrderId',
        enabled: true,
      }],
    });

    expectReportBlocked(r.validation);
  });
});
