'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportBlocked, expectItemBlocked } = require('../helpers.js');

describe('I. Missing source reference blocks', () => {
  it('should load config preserving broken reference, validation blocks it', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      lookups: [{
        rightId: 'NonExistentTable',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: [],
        required: false,
        enabled: true,
      }],
    });

    assert.equal(db.lookups.length, 1, 'Lookup should be preserved in config');
    assert.equal(db.lookups[0].rightId, 'NonExistentTable');
    expectReportBlocked(r.validation);
    expectItemBlocked(r.validation, 'lookup_0');
  });

  it('should block when selected column references missing alias', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'MissingCol']),
      colOrder: ['OrderId', 'MissingCol'],
      aggMode: 'none',
    });

    expectReportBlocked(r.validation);
  });
});
