'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy, expectResultRowCount, findRow } = require('../helpers.js');

describe('H. Duplicate combine deduplication', () => {
  it('should deduplicate exact duplicate rows and repeated values', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Email', 'Phone']),
      colOrder: ['OrderId', 'Company', 'Email', 'Phone'],
      aggMode: 'none',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email', 'Phone'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true } },
      }],
    });

    expectReportHealthy(r.validation);
    expectResultRowCount(r.result, 8);

    const acmeRow = findRow(r.result.rows, { OrderId: 'ORD-001' });
    assert.ok(acmeRow, 'ORD-001 should exist');

    const emails = acmeRow.Email.split('; ').filter(Boolean);
    const uniqueEmails = [...new Set(emails)];
    assert.equal(uniqueEmails.length, emails.length, 'Emails should be unique');

    const phones = acmeRow.Phone.split('; ').filter(Boolean);
    const uniquePhones = [...new Set(phones)];
    assert.equal(uniquePhones.length, phones.length, 'Phones should be unique');
    assert.ok(phones.includes('111-1000'), 'Should include 111-1000');
    assert.ok(phones.includes('111-2000'), 'Should include 111-2000');
  });
});
