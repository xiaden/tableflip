'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy, expectResultColumns, expectResultRowCount, expectRowsEqual, findRow, sqlContains } = require('../helpers.js');

describe('Q. Column toggle data integrity', () => {
  const ALL = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];

  it('should preserve detail data when re-enabling disabled columns', () => {
    let r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectResultRowCount(r.result, 8);
    const baseline = r.result.rows;

    const disabled = ['Contact', 'OrderDate', 'Region'];
    const enabled = ALL.filter(c => !disabled.includes(c));
    r = runReportPipeline({ selCols: new Set(enabled), colOrder: enabled, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, enabled);
    for (const col of disabled) {
      r.result.rows.forEach((row, i) => assert.equal(row[col], undefined,
        `Disabled col "${col}" absent from row ${i}`));
      assert.ok(!r.sql.includes(col), `SQL excludes disabled column "${col}"`);
    }

    r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectResultRowCount(r.result, 8);
    expectRowsEqual(r.result.rows, baseline);
  });

  it('should survive progressive disable and re-enable cycles in detail mode', () => {
    let r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    const baseline = r.result.rows;

    let active = ALL.filter(c => c !== 'Contact');
    r = runReportPipeline({ selCols: new Set(active), colOrder: active, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, active);
    assert.equal(r.result.rows[0].Contact, undefined, 'Contact absent after disable');
    r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectRowsEqual(r.result.rows, baseline);

    active = ALL.filter(c => c !== 'OrderDate');
    r = runReportPipeline({ selCols: new Set(active), colOrder: active, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, active);
    r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectRowsEqual(r.result.rows, baseline);

    const batch = ['Contact', 'OrderDate', 'Region'];
    active = ALL.filter(c => !batch.includes(c));
    r = runReportPipeline({ selCols: new Set(active), colOrder: active, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, active);
    r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectRowsEqual(r.result.rows, baseline);
  });

  it('should preserve totals data when re-enabling disabled columns', () => {
    let r = runReportPipeline({
      selCols: new Set(ALL), colOrder: ALL, aggMode: 'totals',
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectResultRowCount(r.result, 8);
    assert.ok(r.result.metadata && r.result.metadata.totalsRow, 'Has totals row');
    const baselineRows = r.result.rows;
    const baselineTotals = r.result.metadata.totalsRow;

    const disabled = ['Contact', 'OrderDate', 'Region'];
    const enabled = ALL.filter(c => !disabled.includes(c));
    r = runReportPipeline({
      selCols: new Set(enabled), colOrder: enabled, aggMode: 'totals',
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, enabled);
    expectResultRowCount(r.result, 8);
    for (const col of disabled) {
      assert.ok(!r.sql.includes(col), `SQL excludes disabled column "${col}"`);
    }

    r = runReportPipeline({
      selCols: new Set(ALL), colOrder: ALL, aggMode: 'totals',
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectResultRowCount(r.result, 8);
    expectRowsEqual(r.result.rows, baselineRows);
    assert.ok(r.result.metadata && r.result.metadata.totalsRow, 'Still has totals row');
    assert.equal(r.result.metadata.totalsRow.Amount, baselineTotals.Amount,
      `Totals Amount matches: ${JSON.stringify(baselineTotals.Amount)}`);
  });

  it('should preserve subtotals data when re-enabling disabled columns', () => {
    let r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['Region', 'Company', 'Amount']);
    const baselineRows = r.result.rows;

    r = runReportPipeline({
      selCols: new Set(['Region', 'Company']),
      colOrder: ['Region', 'Company'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['Region', 'Company']);

    r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['Region', 'Company', 'Amount']);
    assert.equal(r.result.rows.length, baselineRows.length,
      `Row count: ${r.result.rows.length} vs ${baselineRows.length}`);
    for (let i = 0; i < baselineRows.length; i++) {
      assert.equal(r.result.rows[i].Amount, baselineRows[i].Amount,
        `Row ${i} Amount matches after re-enable`);
    }
  });

  it('should return correct values for re-enabled columns matching fixture', () => {
    const r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);

    const fixture = [
      { OrderId: 'ORD-001', Company: 'Acme Corp', Contact: 'Alice',  Status: 'Open',     Amount: 150,   OrderDate: '2025-01-15', Region: 'North' },
      { OrderId: 'ORD-002', Company: 'Beta Inc',  Contact: 'Bob',    Status: 'Shipped',  Amount: 275,   OrderDate: '2025-02-01', Region: 'South' },
      { OrderId: 'ORD-003', Company: 'Acme Corp', Contact: 'Alice',  Status: 'Open',     Amount: 99.5,  OrderDate: '2025-03-10', Region: 'North' },
      { OrderId: 'ORD-004', Company: 'Gamma LLC', Contact: 'Carol',  Status: 'Closed',   Amount: 500,   OrderDate: '2024-11-20', Region: 'East'  },
      { OrderId: 'ORD-005', Company: 'Delta Co',  Contact: 'Dave',   Status: 'Open',     Amount: 0,     OrderDate: '2025-01-01', Region: 'West'  },
      { OrderId: 'ORD-006', Company: 'Beta Inc',  Contact: 'Bob',    Status: 'Shipped',  Amount: null,  OrderDate: '2025-04-05', Region: 'South' },
      { OrderId: 'ORD-007', Company: 'Echo Ltd',  Contact: 'Eve',    Status: 'Open',     Amount: 820,   OrderDate: '2025-05-12', Region: 'East'  },
      { OrderId: 'ORD-008', Company: 'Acme Corp', Contact: 'Alice',  Status: 'Pending',  Amount: 310,   OrderDate: '2025-06-01', Region: 'North' },
    ];
    for (let i = 0; i < fixture.length; i++) {
      const row = r.result.rows[i];
      const exp = fixture[i];
      for (const col of ALL) {
        assert.equal(row[col], exp[col],
          `Row ${i}, col "${col}": ${JSON.stringify(row[col])} !== ${JSON.stringify(exp[col])}`);
      }
    }
  });

  it('should restore lookup column data after lookup disable/enable with selCols update', () => {
    const allCols = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region', 'Email', 'Phone'];
    const lookupCols = ['Email', 'Phone'];

    db.lookups = [{
      rightId: 'Contacts',
      keyPairs: [{ left: 'Company', right: 'Company' }],
      cols: ['Email', 'Phone'],
      required: false,
      enabled: true,
      duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true } },
    }];
    db.selCols = new Set(allCols);
    db.colOrder = [...allCols];

    let r = runReportPipeline({ aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, allCols);
    const baseline = r.result.rows;

    db.lookups[0].enabled = false;
    const nowCols = projectedCols();
    const nowSet = new Set(nowCols);
    for (const c of [...db.selCols]) { if (!nowSet.has(c)) db.selCols.delete(c); }
    db.colOrder = db.colOrder.filter(c => nowSet.has(c));

    r = runReportPipeline({ aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, allCols.filter(c => !lookupCols.includes(c)));

    db.lookups[0].enabled = true;
    db.selCols = new Set(allCols);
    db.colOrder = [...allCols];

    r = runReportPipeline({ aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, allCols);
    expectRowsEqual(r.result.rows, baseline);
  });

  it('should inject _rowno NOT IN into subquery WHERE (not ON clause)', () => {
    const allCols = ['OrderId', 'Company', 'Contact', 'Email'];
    db.lookups = [{
      rightId: 'Contacts',
      keyPairs: [{ left: 'Company', right: 'Company' }],
      cols: ['Email'],
      required: false,
      enabled: true,
      duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true } },
    }];
    db.selCols = new Set(allCols);
    db.colOrder = [...allCols];

    let r = runReportPipeline({ aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, allCols);

    r = runReportPipeline({ aggMode: 'none', excludedRows: { Contacts: [4] } });
    expectReportHealthy(r.validation);

    const joinOn = 'ON "Orders"."Company" = "Contacts"."Company"';
    const joinIdx = r.sql.indexOf(joinOn);
    assert.ok(joinIdx >= 0, 'Join ON clause found');
    assert.ok(!r.sql.slice(joinIdx).includes('_rowno'),
      'No _rowno in or after the ON clause');
    assert.ok(r.sql.slice(0, joinIdx).includes('_rowno'),
      '_rowno appears before the ON clause (in subquery)');
  });
});
