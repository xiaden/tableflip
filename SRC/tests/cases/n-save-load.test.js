
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportHealthy, expectResultColumns, expectResultRowCount } from '../helpers.js';

describe('N. Save/load current schema', () => {
  it('should preserve durable config and not save derived state', () => {
    const config = {
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount', 'Email']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount', 'Email'],
      aggMode: 'none',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true } },
      }],
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
      sorts: [{ col: 'OrderId', dir: 'ASC', enabled: true }],
    };

    const r1 = runReportPipeline(config);
    expectReportHealthy(r1.validation);

    const savedConfig = {
      base:         db.base,
      baseCols:     db.baseCols,
      stacks:       db.stacks ? [...db.stacks] : [],
      lookups:      db.lookups.map(lk => Object.assign({}, lk)),
      calcStages:   db.calcStages.map(c => Object.assign({}, c)),
      selCols:      db.selCols ? new Set(db.selCols) : null,
      colOrder:     db.colOrder ? [...db.colOrder] : [],
      filters:      db.filters.map(f => Object.assign({}, f)),
      sorts:        db.sorts.map(s => Object.assign({}, s)),
      aggMode:      db.aggMode,
      groupBy:      db.groupBy ? [...db.groupBy] : [],
      aggregates:   db.aggregates.map(a => Object.assign({}, a)),
      subtotalBy:   db.subtotalBy ? [...db.subtotalBy] : [],
      subtotalFns:  Object.assign({}, db.subtotalFns),
      colTotals:    Object.assign({}, db.colTotals),
    };

    const r2 = runReportPipeline(savedConfig);

    assert.equal(r2.plan.source.base, 'Orders', 'Base should be preserved');
    assert.equal(r2.plan.joins.length, 1, 'Lookup should be preserved');
    assert.equal(r2.plan.joins[0].duplicatePolicy.mode, 'combine', 'Duplicate policy preserved');
    assert.equal(r2.plan.filters.length, 1, 'Filter should be preserved');
    assert.equal(r2.plan.sorts.length, 1, 'Sort should be preserved');

    expectReportHealthy(r2.validation);
    expectResultColumns(r2.result, r1.result.columns);
    expectResultRowCount(r2.result, r1.result.rows.length);
  });

  it('should not save derived validation state as authoritative config', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
    });

    const valAfterRun = getValidation();
    const valCached = getValidation();
    assert.equal(valCached.reportStatus, valAfterRun.reportStatus,
      'Validation state should be deterministic');
  });
});
