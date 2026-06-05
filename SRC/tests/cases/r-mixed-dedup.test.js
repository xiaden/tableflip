'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy, findRow } = require('../helpers.js');

describe('R. Mixed-value per-column dedup', () => {
  it('should deduplicate per column when duplicate-key rows share one column value but differ in another', () => {
    sqlDb.run("INSERT INTO Contacts VALUES ('Acme Corp', 'Alice', 'shared@acme.com', '111-3000')");
    sqlDb.run("INSERT INTO Contacts VALUES ('Acme Corp', 'Alice', 'shared@acme.com', '111-4000')");

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
        duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true, sort: true } },
      }],
    });

    expectReportHealthy(r.validation);

    assert.equal(r.plan.joins[0].duplicatePolicy.mode, 'combine');
    assert.equal(r.plan.joins[0].duplicatePolicy.combine.unique, true);

    const acmeRow = findRow(r.result.rows, { OrderId: 'ORD-001' });
    assert.ok(acmeRow, 'ORD-001 should exist');

    const emails = acmeRow.Email.split('; ').filter(Boolean);
    const uniqueEmails = [...new Set(emails)];
    assert.equal(uniqueEmails.length, emails.length, 'Emails must be unique');

    const sharedCount = emails.filter(e => e === 'shared@acme.com').length;
    assert.equal(sharedCount, 1, 'shared@acme.com should appear exactly once (not duplicated across rows)');

    const phones = acmeRow.Phone.split('; ').filter(Boolean);
    const uniquePhones = [...new Set(phones)];
    assert.equal(uniquePhones.length, phones.length, 'Phones must be unique');
  });
});
