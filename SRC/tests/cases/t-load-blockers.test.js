'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportBlocked, expectReportHealthy, expectItemBlocked, getBlockingIssues } = require('../helpers.js');

describe('T. Load with blockers — broken items preserved, validation blocks', () => {
  it('A. malformed filter (non-array vals) is preserved and blocked', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      filters: [{ col: 'Status', op: 'equals', vals: 'Open', enabled: true }],
    });

    const filters = db.filters || [];
    assert.equal(filters.length, 1, 'Filter should be preserved in config');
    assert.equal(filters[0].vals, 'Open', 'Non-array vals should be preserved as-is');
    expectReportBlocked(r.validation);
    expectItemBlocked(r.validation, 'filter_0');
  });

  it('B. aliasless calc stage is preserved and blocked', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
      calcStages: [{
        alias: '',
        op: '+',
        left: 'OrderId',
        right: 'Company',
        enabled: true,
      }],
    });

    const calcs = db.calcStages || [];
    assert.equal(calcs.length, 1, 'Calc stage should be preserved in config');
    assert.equal(calcs[0].alias, '', 'Empty alias should be preserved as-is');
    expectReportBlocked(r.validation);
    expectItemBlocked(r.validation, 'calc_0');
    const issues = r.validation.items['calc_0'].issues;
    assert.ok(issues.some(i => i.id === 'calc_0_no_alias'), 'Should have no-alias issue');
  });

  it('C. disabled aliasless calc is preserved but does not block', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
      calcStages: [{
        alias: '',
        op: '+',
        left: 'OrderId',
        right: 'Company',
        enabled: false,
      }],
    });

    const calcs = db.calcStages || [];
    assert.equal(calcs.length, 1, 'Disabled calc should be preserved');
    expectReportHealthy(r.validation);
    const item = r.validation.items['calc_0'];
    assert.ok(item, 'Item should exist');
    assert.equal(item.blocking, false, 'Disabled item should not block');
  });

  it('D. invalid aggregate function is preserved and blocked', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      aggMode: 'group',
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'SUPER_SUM' }],
    });

    const aggs = db.aggregates || [];
    assert.equal(aggs.length, 1, 'Aggregate should be preserved');
    assert.equal(aggs[0].fn, 'SUPER_SUM', 'Invalid fn should be preserved');
    expectReportBlocked(r.validation);
    const issues = r.validation.items['agg_0'].issues;
    assert.ok(issues.some(i => i.id === 'agg_0_invalid_fn'), 'Should have invalid-fn issue');
  });

  it('E. invalid totals function is preserved and blocked', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'totals',
      colTotals: { Amount: 'BAD_TOTAL' },
    });

    expectReportBlocked(r.validation);
    const issues = r.validation.items['totals_Amount'].issues;
    assert.ok(issues.some(i => i.id === 'totals_Amount_invalid_fn'), 'Should have invalid-totals-fn issue');
  });

  it('F. invalid subtotal function is preserved and blocked', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalFns: { Amount: 'BAD_SUBTOTAL' },
    });

    expectReportBlocked(r.validation);
    const issues = r.validation.items['subtotalfns_Amount'].issues;
    assert.ok(issues.some(i => i.id === 'subtotalfns_Amount_invalid_fn'), 'Should have invalid-subtotals-fn issue');
  });

  it('G. multiple broken items produce multiple blocking issues', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
      filters: [{ col: 'Status', op: 'equals', vals: null, enabled: true }],
      calcStages: [{
        alias: '',
        op: '+',
        left: 'OrderId',
        right: 'Company',
        enabled: true,
      }],
    });

    expectReportBlocked(r.validation);
    const blocking = getBlockingIssues(r.validation);
    assert.ok(blocking.length >= 2, 'Should have at least 2 blocking issues');
    assert.ok(blocking.some(i => i.id === 'filter_0_bad_vals'), 'Should include bad filter vals');
    assert.ok(blocking.some(i => i.id === 'calc_0_no_alias'), 'Should include calc no alias');
  });
});
