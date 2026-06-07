
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportHealthy, expectReportBlocked, expectResultRowCount, findRow, sqlContains } from '../helpers.js';

describe('E. Lookup required vs optional', () => {
  it('optional lookup uses LEFT JOIN, keeps base rows without match', () => {
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
        duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true } },
      }],
    });

    expectReportHealthy(r.validation);
    assert.ok(sqlContains(r.sql, 'LEFT JOIN'), 'Optional lookup should use LEFT JOIN');
    expectResultRowCount(r.result, 8);

    const deltaRow = findRow(r.result.rows, { OrderId: 'ORD-005' });
    assert.ok(deltaRow, 'Delta Co row should exist');
    assert.equal(deltaRow.Email, null, 'Delta Co should have null Email (no Contacts match)');
  });

  it('required lookup uses INNER JOIN, blocks on duplicate keys', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Email']),
      colOrder: ['OrderId', 'Company', 'Status', 'Email'],
      aggMode: 'none',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
        required: true,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }],
    });

    expectReportBlocked(r.validation);
    assert.equal(r.result, null, 'Engine should not execute when blocked');
  });
});
