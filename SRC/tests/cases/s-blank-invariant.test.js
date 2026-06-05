'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy } = require('../helpers.js');

describe('S. End-of-report blank-row invariant', () => {
  function trailingBlankCount(rows, dataCols) {
    let n = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (dataCols.every(c => rows[i][c] == null)) n++; else break;
    }
    return n;
  }

  const COLS = ['OrderId', 'Company', 'Status', 'Amount', 'Region'];
  const BASE = { selCols: new Set(COLS), colOrder: [...COLS] };

  it('should have at most one trailing blank row in any mode or config', () => {
    const cases = [
      { desc: 'detail' },
      { desc: 'group',       aggMode: 'group',     groupBy: ['Region'],
        aggregates: [{ col: 'Amount', fn: 'SUM', alias: 'Amount' }] },
      { desc: 'totals',      aggMode: 'totals',    colTotals: { Amount: 'SUM' } },
      { desc: 'sub(spacer,grand)', aggMode: 'subtotals', subtotalBy: ['Region'],
        subtotalSpacer: true,  subtotalGrandTotal: true,  subtotalFns: { Amount: 'SUM' } },
      { desc: 'sub(spacer,no-grand)', aggMode: 'subtotals', subtotalBy: ['Region'],
        subtotalSpacer: true,  subtotalGrandTotal: false, subtotalFns: { Amount: 'SUM' } },
      { desc: 'sub(no-spacer,grand)', aggMode: 'subtotals', subtotalBy: ['Region'],
        subtotalSpacer: false, subtotalGrandTotal: true,  subtotalFns: { Amount: 'SUM' } },
      { desc: 'sub(no-spacer,no-grand)', aggMode: 'subtotals', subtotalBy: ['Region'],
        subtotalSpacer: false, subtotalGrandTotal: false, subtotalFns: { Amount: 'SUM' } },
    ];

    for (const cfg of cases) {
      const c = Object.assign({}, BASE, cfg);
      const r = runReportPipeline(c);
      expectReportHealthy(r.validation);
      const n = trailingBlankCount(r.result.rows, r.result.columns);
      assert.ok(n <= 1, `${cfg.desc}: trailing blank rows = ${n} (max 1)`);
    }
  });

  it('should not introduce trailing blanks with combine lookups on subtotalBy', () => {
    const db = global.db;
    db.lookups = [{
      rightId: 'Contacts',
      keyPairs: [{ left: 'Company', right: 'Company' }],
      cols: ['Email'],
      required: false,
      enabled: true,
      duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true } },
    }];
    db.selCols = new Set(['OrderId', 'Company', 'Contact', 'Amount', 'Email']);
    db.colOrder = ['OrderId', 'Company', 'Contact', 'Amount', 'Email'];

    for (let i = 0; i < 10; i++) {
      sqlDb.run(`INSERT INTO "Orders" VALUES ('ORD-NO-${i}', 'NoMatch-${i}', 'N', 'Open', 100, '2026-01-01', 'Void')`);
    }

    const r = runReportPipeline({
      aggMode: 'subtotals',
      subtotalBy: ['Email'],
      subtotalSpacer: true,
      subtotalGrandTotal: true,
      subtotalFns: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    assert.ok(trailingBlankCount(r.result.rows, r.result.columns) <= 1,
      'Trailing blanks ≤ 1 with combine lookup');

    const nullSort = r.result.rows.filter(row => row._sort_group_0 == null);
    assert.equal(nullSort.filter(r => r._row_type === 1).length, 0, 'No null-group subtotal');
    assert.equal(nullSort.filter(r => r._row_type === 2).length, 0, 'No null-group spacer');
  });

  it('should not introduce trailing blanks with various combine-lookup settings', () => {
    const variants = [
      { desc: 'includeBlank:true',  combine: { includeBlank: true,  unique: true, sort: false } },
      { desc: 'includeBlank:false', combine: { includeBlank: false, unique: true, sort: true  } },
      { desc: 'both (unique+sort+includeBlank)', combine: { includeBlank: true, unique: true, sort: true } },
    ];

    for (const v of variants) {
      const db = global.db;
      db.lookups = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'combine', combine: v.combine },
      }];
      db.selCols = new Set(['OrderId', 'Company', 'Contact', 'Amount', 'Email']);
      db.colOrder = ['OrderId', 'Company', 'Contact', 'Amount', 'Email'];

      for (let i = 0; i < 10; i++) {
        sqlDb.run(`INSERT INTO "Orders" VALUES ('S3-NO-${v.desc.replace(/[^a-z]/gi,'')}-${i}', 'NoMatch-${i}', 'N', 'Open', 100, '2026-01-01', 'Void')`);
      }

      const r = runReportPipeline({
        aggMode: 'subtotals',
        subtotalBy: ['Email'],
        subtotalSpacer: true,
        subtotalGrandTotal: true,
        subtotalFns: { Amount: 'SUM' },
      });
      expectReportHealthy(r.validation);
      assert.ok(trailingBlankCount(r.result.rows, r.result.columns) <= 1,
        `${v.desc}: trailing blanks ≤ 1 (got ${trailingBlankCount(r.result.rows, r.result.columns)})`);
    }
  });

  it('should suppress grand total when all subtotal fns result in NULL', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount', 'Region']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount', 'Region'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      subtotalSpacer: true,
      subtotalGrandTotal: true,
      subtotalFns: { Amount: 'skip' },
    });
    expectReportHealthy(r.validation);
    const grandRows = r.result.rows.filter(row => row._row_type === 3);
    assert.equal(grandRows.length, 0, 'No grand total row when all fns are skip');
  });
});
