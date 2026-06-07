
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportHealthy, expectResultRowCount, findRow, sqlContains } from '../helpers.js';

describe('G. Duplicate lookup combine mode', () => {
  it('should combine emails by Company with ; separator, not multiply rows', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Email']),
      colOrder: ['OrderId', 'Company', 'Email'],
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
    expectResultRowCount(r.result, 8);

    const acmeRows = r.result.rows.filter(row => row.Company === 'Acme Corp');
    assert.equal(acmeRows.length, 3, 'Acme Corp should have 3 orders');

    for (const row of acmeRows) {
      assert.ok(row.Email.includes('alice@acme.com'), 'Email should include alice@acme.com');
      assert.ok(row.Email.includes('bob@acme.com'), 'Email should include bob@acme.com');
      const emails = row.Email.split('; ');
      assert.equal(emails.length, new Set(emails).size, 'Emails should be unique');
    }

    assert.ok(sqlContains(r.sql, 'GROUP_CONCAT') || sqlContains(r.sql, 'group_concat'),
      'Combine SQL should use GROUP_CONCAT');
  });

  it('should combine by Company+Contact compound key', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Email']),
      colOrder: ['OrderId', 'Company', 'Email'],
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
    expectResultRowCount(r.result, 8);

    const acmeRows = r.result.rows.filter(row => row.Company === 'Acme Corp');
    for (const row of acmeRows) {
      assert.ok(row.Email.includes('alice@acme.com'), 'Should have primary email');
      assert.ok(row.Email.includes('alice_alt@acme.com'), 'Should have alt email');
    }
  });
});
