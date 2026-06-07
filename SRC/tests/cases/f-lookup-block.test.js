
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportHealthy, expectReportBlocked, expectItemBlocked, getBlockingIssues } from '../helpers.js';

describe('F. Duplicate lookup block mode', () => {
  it('should mark report blocked when Contacts has duplicate Company keys', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Email']),
      colOrder: ['OrderId', 'Company', 'Status', 'Email'],
      aggMode: 'none',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }],
    });

    expectReportBlocked(r.validation);
    expectItemBlocked(r.validation, 'lookup_0');
    assert.equal(r.result, null, 'Engine should not execute when blocked');

    const blocking = getBlockingIssues(r.validation);
    assert.ok(blocking.some(i => i.id && i.id.includes('dup')),
      'Blocking should be from duplicate key issue');
  });

  it('should be healthy for compound key (Company+Contact) with combine mode', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Email']),
      colOrder: ['OrderId', 'Company', 'Status', 'Email'],
      aggMode: 'none',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }, { left: 'Contact', right: 'Contact' }],
        cols: ['Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true } },
      }],
    });

    expectReportHealthy(r.validation);
  });
});
