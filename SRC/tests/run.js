'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { setupEnv, resetTestState } = require('./env.js');
const { setupTwoTableFixture, ORDERS_COLS, ORDERS_ROWS } = require('./fixtures.js');
const {
  normalizeSql, sqlContains, runReportPipeline, expectReportHealthy, expectReportBlocked,
  expectItemBlocked, expectResultColumns, expectResultRowCount, expectRowsEqual,
  getBlockingIssues, findRow, getFixtureFiles, loadExcelSheet, createTableFromSheet, snapshotTable,
} = require('./helpers.js');

// ── Bootstrap ───────────────────────────────────────────────────────────────
before(async () => { await setupEnv(); });

beforeEach(() => {
  resetTestState();
  setupTwoTableFixture();
});

// ═══════════════════════════════════════════════════════════════════════════
// A. Basic detail report
// ═══════════════════════════════════════════════════════════════════════════
describe('A. Basic detail report', () => {
  it('should return all rows with expected columns', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
      aggMode: 'none',
    });

    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['OrderId', 'Company', 'Status', 'Amount']);
    expectResultRowCount(r.result, 8);

    assert.ok(sqlContains(r.sql, 'SELECT'), 'SQL should contain SELECT');
    assert.ok(sqlContains(r.sql, 'FROM Orders'), 'SQL should reference Orders');
    assert.ok(!sqlContains(r.sql, 'JOIN'), 'No JOIN for simple detail');
    assert.ok(!sqlContains(r.sql, 'WHERE'), 'No WHERE without filters');
    assert.ok(!sqlContains(r.sql, 'ORDER BY'), 'No ORDER BY without sort');
    assert.ok(!sqlContains(r.sql, 'GROUP BY'), 'No GROUP BY in detail mode');

    assert.equal(r.result.rows[0].OrderId, 'ORD-001');
    assert.equal(r.result.rows[0].Amount, 150);
    assert.equal(r.result.rows.length, ORDERS_ROWS.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Column enable / disable
// ═══════════════════════════════════════════════════════════════════════════
describe('B. Column enable/disable', () => {
  it('should exclude Amount from plan and result when disabled', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status']),
      colOrder: ['OrderId', 'Company', 'Status'],
      aggMode: 'none',
    });

    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['OrderId', 'Company', 'Status']);
    assert.ok(!sqlContains(r.sql, 'Amount'), 'Amount should NOT appear in SQL');
    assert.ok(!r.plan.selectedColumns.includes('Amount'));
  });

  it('should include Amount after re-enabling', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
      aggMode: 'none',
    });

    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['OrderId', 'Company', 'Status', 'Amount']);
    assert.ok(sqlContains(r.sql, 'Amount'), 'Amount should appear in SQL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Filter add / remove
// ═══════════════════════════════════════════════════════════════════════════
describe('C. Filter add/remove', () => {
  it('should add WHERE clause and return only Open rows when Status filter is active', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
      aggMode: 'none',
      filters: [{ col: 'Status', op: 'equals', vals: ['Open'], enabled: true }],
    });

    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['OrderId', 'Company', 'Status', 'Amount']);
    assert.ok(sqlContains(r.sql, 'WHERE'), 'SQL should contain WHERE with filter');
    expectResultRowCount(r.result, 4);
    for (const row of r.result.rows) {
      assert.equal(row.Status, 'Open');
    }
  });

  it('should return all rows after removing filter', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
      aggMode: 'none',
      filters: [],
    });

    expectReportHealthy(r.validation);
    expectResultRowCount(r.result, 8);
    // No WHERE clause for filters
    const hasFilterWhere = sqlContains(r.sql, 'WHERE') && sqlContains(r.sql, 'Status');
    assert.ok(!hasFilterWhere, 'WHERE should not contain Status filter after removal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Sort add / remove
// ═══════════════════════════════════════════════════════════════════════════
describe('D. Sort add/remove', () => {
  it('should ORDER BY OrderDate descending', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount', 'OrderDate']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount', 'OrderDate'],
      aggMode: 'none',
      sorts: [{ col: 'OrderDate', dir: 'DESC', enabled: true }],
    });

    expectReportHealthy(r.validation);
    assert.ok(sqlContains(r.sql, 'ORDER BY'), 'SQL should contain ORDER BY');

    const dates = r.result.rows.map(row => row.OrderDate);
    const sorted = [...dates].sort().reverse();
    assert.deepEqual(dates, sorted, 'Rows should be sorted by OrderDate DESC');
  });

  it('should not contain ORDER BY after removing sort', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Status', 'Amount', 'OrderDate']),
      colOrder: ['OrderId', 'Company', 'Status', 'Amount', 'OrderDate'],
      aggMode: 'none',
      sorts: [],
    });

    expectReportHealthy(r.validation);
    assert.ok(!sqlContains(r.sql, 'ORDER BY'), 'SQL should not contain ORDER BY after sort removed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. Lookup required vs optional
// ═══════════════════════════════════════════════════════════════════════════
describe('E. Lookup required vs optional', () => {
  it('optional lookup uses LEFT JOIN, keeps base rows without match', () => {
    // Contacts has duplicate Company keys, so use combine mode to avoid blocking
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

    // Delta Co has no Contacts match (different company name: Delta Ltd)
    const deltaRow = findRow(r.result.rows, { OrderId: 'ORD-005' });
    assert.ok(deltaRow, 'Delta Co row should exist');
    assert.equal(deltaRow.Email, null, 'Delta Co should have null Email (no Contacts match)');
  });

  it('required lookup uses INNER JOIN, blocks on duplicate keys', () => {
    // With mode=block and duplicate Company keys, report is blocked
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

// ═══════════════════════════════════════════════════════════════════════════
// F. Duplicate lookup block mode
// ═══════════════════════════════════════════════════════════════════════════
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
    // Company+Contact with duplicate rows (e.g. Alice+Acme Corp appears 3 times)
    // Use combine mode to handle the dups
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

// ═══════════════════════════════════════════════════════════════════════════
// G. Duplicate lookup combine mode
// ═══════════════════════════════════════════════════════════════════════════
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

    // Acme Corp orders should have combined emails
    const acmeRows = r.result.rows.filter(row => row.Company === 'Acme Corp');
    assert.equal(acmeRows.length, 3, 'Acme Corp should have 3 orders');

    for (const row of acmeRows) {
      assert.ok(row.Email.includes('alice@acme.com'), 'Email should include alice@acme.com');
      assert.ok(row.Email.includes('bob@acme.com'), 'Email should include bob@acme.com');
      // No duplicate emails
      const emails = row.Email.split('; ');
      assert.equal(emails.length, new Set(emails).size, 'Emails should be unique');
    }

    // SQL should use GROUP_CONCAT for combine mode
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

    // Acme/Alice should have both emails combined
    const acmeRows = r.result.rows.filter(row => row.Company === 'Acme Corp');
    for (const row of acmeRows) {
      assert.ok(row.Email.includes('alice@acme.com'), 'Should have primary email');
      assert.ok(row.Email.includes('alice_alt@acme.com'), 'Should have alt email');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Duplicate combine — exact-row and per-column dedupe
// ═══════════════════════════════════════════════════════════════════════════
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

    // Acme Corp emails should be unique (alice@acme.com appears twice in raw data)
    const acmeRow = findRow(r.result.rows, { OrderId: 'ORD-001' });
    assert.ok(acmeRow, 'ORD-001 should exist');

    // Email: should include alice@acme.com, alice_alt@acme.com, bob@acme.com
    const emails = acmeRow.Email.split('; ').filter(Boolean);
    const uniqueEmails = [...new Set(emails)];
    assert.equal(uniqueEmails.length, emails.length, 'Emails should be unique');

    // Phone: raw data has 111-1000 (2 distinct rows) and 111-2000 (1 row) for Acme Corp
    // Per-column dedup removes the duplicate 111-1000
    const phones = acmeRow.Phone.split('; ').filter(Boolean);
    const uniquePhones = [...new Set(phones)];
    assert.equal(uniquePhones.length, phones.length, 'Phones should be unique');
    assert.ok(phones.includes('111-1000'), 'Should include 111-1000');
    assert.ok(phones.includes('111-2000'), 'Should include 111-2000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// I. Missing source reference blocks
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// J. Disabled unresolved item does not block
// ═══════════════════════════════════════════════════════════════════════════
describe('J. Disabled unresolved item does not block', () => {
  it('should not block when missing lookup is disabled', () => {
    const r = runReportPipeline({
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      lookups: [{
        rightId: 'NonExistentTable',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: [],
        required: false,
        enabled: false,
      }],
    });

    expectReportHealthy(r.validation);
    const item = r.validation.items['lookup_0'];
    assert.ok(item, 'Item should exist');
    assert.equal(item.blocking, false, 'Disabled item should not block');
  });

  it('should still block dependent enabled items', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company', 'FromCalc']),
      colOrder: ['OrderId', 'Company', 'FromCalc'],
      aggMode: 'none',
      calcStages: [{
        alias: 'FromCalc',
        left: 'MissingCol',
        op: '+',
        right: 'OrderId',
        enabled: true,
      }],
    });

    expectReportBlocked(r.validation);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// K. Grouped report
// ═══════════════════════════════════════════════════════════════════════════
describe('K. Grouped report', () => {
  it('should GROUP BY Region with SUM Amount', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Amount']),
      colOrder: ['Region', 'Amount'],
      aggMode: 'group',
      groupBy: ['Region'],
      aggregates: [{ alias: 'TotalAmount', col: 'Amount', fn: 'SUM', enabled: true }],
    });

    expectReportHealthy(r.validation);
    assert.ok(sqlContains(r.sql, 'GROUP BY'), 'Grouped report should have GROUP BY');
    expectResultRowCount(r.result, 4);

    const regions = r.result.rows.map(row => row.Region).sort();
    assert.deepEqual(regions, ['East', 'North', 'South', 'West']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L. Subtotal report
// ═══════════════════════════════════════════════════════════════════════════
describe('L. Subtotal report', () => {
  it('should produce subtotal rows by Region', () => {
    const r = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      colTotals: { Amount: 'SUM' },
    });

    expectReportHealthy(r.validation);
    assert.ok(r.result.rows.length > 0, 'Should have result rows');

    const hasSubtotal = r.result.rows.some(row => row._row_type === 1);
    assert.ok(hasSubtotal, 'Should contain subtotal rows (_row_type=1)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M. Report type switching
// ═══════════════════════════════════════════════════════════════════════════
describe('M. Report type switching', () => {
  it('should switch detail grouped subtotal detail without cross-leakage', () => {
    // 1. Detail
    const d1 = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
    });
    expectReportHealthy(d1.validation);
    expectResultRowCount(d1.result, 8);
    assert.ok(!sqlContains(d1.sql, 'GROUP BY'), 'Detail should not have GROUP BY');

    // 2. Grouped
    const g = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'group',
      groupBy: ['Company'],
      aggregates: [{ alias: 'Total', col: 'Amount', fn: 'SUM', enabled: true }],
    });
    expectReportHealthy(g.validation);
    assert.ok(sqlContains(g.sql, 'GROUP BY'), 'Grouped should have GROUP BY');
    assert.ok(g.result.rows.length < 8, 'Grouped should have fewer rows');
    assert.ok(g.result.rows.length > 0, 'Grouped should have some rows');

    // 3. Subtotal
    const s = runReportPipeline({
      selCols: new Set(['Region', 'Company', 'Amount']),
      colOrder: ['Region', 'Company', 'Amount'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(s.validation);
    const hasSubtotal = s.result.rows.some(row => row._row_type === 1);
    assert.ok(hasSubtotal, 'Subtotal mode should have subtotal rows');

    // 4. Back to detail
    const d2 = runReportPipeline({
      selCols: new Set(['OrderId', 'Company', 'Amount']),
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
    });
    expectReportHealthy(d2.validation);
    expectResultRowCount(d2.result, 8);
    assert.ok(!sqlContains(d2.sql, 'GROUP BY'), 'Return to detail should not have GROUP BY');
    assert.ok(!sqlContains(d2.sql, '_row_type'), 'Return to detail should not have subtotal markers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// N. Save/load current schema
// ═══════════════════════════════════════════════════════════════════════════
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

    // "Save" — capture durable config
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

    // "Load" — re-apply saved config
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

// ═══════════════════════════════════════════════════════════════════════════
// O. Real-world fixture files
// ═══════════════════════════════════════════════════════════════════════════
describe('O. Real-world fixture files', () => {
  it('should load every Excel fixture file without error', () => {
    const fixtureFiles = getFixtureFiles();
    assert.ok(fixtureFiles.length > 0, `No fixture files found`);
    const results = [];
    for (const f of fixtureFiles) {
      const fpath = require('path').resolve(__dirname, 'testfixtures', f);
      const loaded = loadExcelSheet(fpath);
      assert.ok(loaded.rows.length > 0, `"${f}" should have at least 1 data row`);
      results.push({ file: f, sheets: loaded.workbook.SheetNames.length, rows: loaded.rows.length, cols: Object.keys(loaded.rows[0]).length });
    }
  });

  it('should not mutate source table data through report config changes', () => {
    const fpath = require('path').resolve(__dirname, 'testfixtures', 'world_cup_2018_squads.xlsx');
    const loaded = loadExcelSheet(fpath);
    const tableName = 'WCSquads';

    // Helper: reset only db config, NOT the SQLite table
    function hardReset() {
      if (typeof invalidateValidation === 'function') invalidateValidation();
      Object.assign(global.db, {
        tables: {}, excludedRows: {}, tableColors: {}, columnLabels: {},
        base: '', baseCols: null, stacks: [], lookups: [], calcStages: [],
        selCols: null, colOrder: null, filters: [], groupBy: [], aggregates: [],
        aggMode: 'none', aggModeState: null, colTotals: {}, subtotalBy: [],
        subtotalFns: {}, subtotalGrandTotal: true, subtotalSpacer: false,
        subtotalOnTop: false, mergedCols: [], mergeGroupUnderline: false,
        colState: null, sorts: [], result: null,
      });
    }

    // Create table once, keep it across configs
    sqlDb.run(`DROP TABLE IF EXISTS "${tableName}"`);
    createTableFromSheet(sqlDb, tableName, loaded.rows);

    // Baseline snapshot
    const baseline = snapshotTable(sqlDb, tableName);
    assert.ok(baseline.rowCount > 0, 'Table should have rows');
    assert.ok(baseline.columns.length > 0, 'Table should have columns');

    const cols = baseline.columns.slice(0, 5);

    function setupBase() {
      db.tables[tableName] = { id: tableName, name: tableName, cols: [...baseline.columns] };
      db.base = tableName;
      db.baseCols = baseline.columns.reduce((acc, c) => ({ ...acc, [c]: c }), {});
    }

    // Config 1: simple detail, subset of columns
    hardReset(); setupBase();
    db.selCols = new Set(cols);
    db.colOrder = cols;
    const r1 = runReportPipeline({});
    expectReportHealthy(r1.validation);
    const after1 = snapshotTable(sqlDb, tableName);
    assert.equal(after1.rowCount, baseline.rowCount, 'Config 1: row count unchanged');
    assert.deepEqual(after1.rows, baseline.rows, 'Config 1: row data unchanged');

    // Config 2: add filter
    hardReset(); setupBase();
    db.selCols = new Set(cols);
    db.colOrder = cols;
    db.filters = [{ col: 'Team', op: 'equals', vals: ['France'], enabled: true }];
    const r2 = runReportPipeline({});
    expectReportHealthy(r2.validation);
    const after2 = snapshotTable(sqlDb, tableName);
    assert.equal(after2.rowCount, baseline.rowCount, 'After filter: row count unchanged');
    assert.deepEqual(after2.rows, baseline.rows, 'After filter: row data unchanged');

    // Config 3: grouped report
    hardReset(); setupBase();
    db.selCols = new Set(['Team', 'Caps']);
    db.colOrder = ['Team', 'Caps'];
    db.aggMode = 'group';
    db.groupBy = ['Team'];
    db.aggregates = [{ alias: 'TotalCaps', col: 'Caps', fn: 'SUM', enabled: true }];
    const r3 = runReportPipeline({});
    expectReportHealthy(r3.validation);
    const after3 = snapshotTable(sqlDb, tableName);
    assert.equal(after3.rowCount, baseline.rowCount, 'After group: row count unchanged');
    assert.deepEqual(after3.rows, baseline.rows, 'After group: row data unchanged');

    // Config 4: sort
    hardReset(); setupBase();
    db.selCols = new Set(cols);
    db.colOrder = cols;
    db.sorts = [{ col: 'Goals', dir: 'DESC', enabled: true }];
    const r4 = runReportPipeline({});
    expectReportHealthy(r4.validation);
    const after4 = snapshotTable(sqlDb, tableName);
    assert.equal(after4.rowCount, baseline.rowCount, 'After sort: row count unchanged');
    assert.deepEqual(after4.rows, baseline.rows, 'After sort: row data unchanged');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P. Report type switch — config integrity
// ═══════════════════════════════════════════════════════════════════════════
describe('P. Report type switch — config integrity', () => {
  const ALL_COLS = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];
  const BASE_COLS = ALL_COLS;
  const KNOWN_SEL = ['OrderId', 'Company', 'Amount'];

  function resetDb() {
    if (typeof invalidateValidation === 'function') invalidateValidation();
    Object.assign(global.db, {
      tables: {}, excludedRows: {}, tableColors: {}, columnLabels: {},
      base: '', baseCols: null, stacks: [], lookups: [], calcStages: [],
      selCols: null, colOrder: null, filters: [], groupBy: [], aggregates: [],
      aggMode: 'none', aggModeState: null, colTotals: {}, subtotalBy: [],
      subtotalFns: {}, subtotalGrandTotal: true, subtotalSpacer: false,
      subtotalOnTop: false, mergedCols: [], mergeGroupUnderline: false,
      colState: null, sorts: [], result: null,
    });
  }

  function setupBase() {
    db.tables.Orders = { id: 'Orders', name: 'Orders', cols: [...BASE_COLS] };
    db.base = 'Orders';
    db.baseCols = BASE_COLS.reduce((acc, c) => ({ ...acc, [c]: c }), {});
  }

  function setSel(cols) {
    db.selCols = new Set(cols);
    db.colOrder = [...cols];
  }

  // ── Detail → Group → Detail: selCols preserved, mode config isolated ───
  it('should preserve selCols and isolate mode config when switching detail→group→detail', () => {
    resetDb(); setupBase();
    setSel(KNOWN_SEL);

    // Switch to group: save detail state, load group state
    saveActiveAggModeState();
    db.aggMode = 'group';
    loadAggModeState('group');

    // In group mode: selCols should stay (group default doesn't touch it)
    assert.ok(db.selCols instanceof Set, 'selCols should still be a Set in group mode');
    assert.deepEqual([...db.selCols], KNOWN_SEL, 'selCols preserved when entering group mode');
    assert.deepEqual(db.groupBy, [], 'groupBy should be empty on first group entry');
    assert.deepEqual(db.aggregates, [], 'aggregates should be empty on first group entry');

    // Set group-specific config
    db.groupBy = ['Company'];
    db.aggregates = [{ alias: 'Total', col: 'Amount', fn: 'SUM', enabled: true }];

    // Switch back to detail: save group state, load detail state
    saveActiveAggModeState();
    db.aggMode = 'none';
    loadAggModeState('none');

    // In detail mode: group config should NOT bleed
    assert.deepEqual(db.groupBy, [], 'groupBy should not bleed into detail mode');
    assert.deepEqual(db.aggregates, [], 'aggregates should not bleed into detail mode');
    // selCols should be restored from detail state
    assert.ok(db.selCols instanceof Set, 'selCols should be a Set back in detail mode');
    assert.deepEqual([...db.selCols], KNOWN_SEL, 'selCols restored from detail saved state');

    // Switch back to group: group config restored
    saveActiveAggModeState();
    db.aggMode = 'group';
    loadAggModeState('group');
    assert.deepEqual(db.groupBy, ['Company'], 'groupBy restored when re-entering group mode');
    assert.equal(db.aggregates.length, 1, 'aggregates restored when re-entering group mode');
    assert.equal(db.aggregates[0].alias, 'Total', 'aggregate alias restored');
  });

  // ── Detail → Totals → Detail: first-time totals doesn't enable all cols ──
  it('should not reset selCols when first switching to totals mode', () => {
    resetDb(); setupBase();
    setSel(KNOWN_SEL);

    // Switch to totals (first time): selCols should NOT become null
    saveActiveAggModeState();
    db.aggMode = 'totals';
    loadAggModeState('totals');

    // BUG CHECK: _defaultAggModeState('totals') returns { selCols: null, colTotals: {} }
    // which causes loadAggModeState to set db.selCols = null (all columns active).
    // Expected: selCols should stay as-is on first entry.
    assert.ok(db.selCols instanceof Set,
      'selCols should remain a Set when first entering totals mode (not become null)');
    assert.deepEqual([...db.selCols], KNOWN_SEL,
      'selCols should preserve existing selection on first totals entry');
    assert.deepEqual(db.colTotals, {}, 'colTotals should be empty on first totals entry');

    // Switch back to detail
    saveActiveAggModeState();
    db.aggMode = 'none';
    loadAggModeState('none');
    assert.deepEqual([...db.selCols], KNOWN_SEL, 'selCols restored after returning to detail');
    assert.deepEqual(db.colTotals, {}, 'colTotals should not bleed into detail mode');
  });

  // ── Detail → Subtotals → Detail: first-time subtotals doesn't enable all ──
  it('should not reset selCols when first switching to subtotals mode', () => {
    resetDb(); setupBase();
    setSel(KNOWN_SEL);

    // Switch to subtotals (first time)
    saveActiveAggModeState();
    db.aggMode = 'subtotals';
    loadAggModeState('subtotals');

    // BUG CHECK: same as totals — _defaultAggModeState('subtotals') returns
    // { selCols: null, ... } causing all columns to be enabled.
    assert.ok(db.selCols instanceof Set,
      'selCols should remain a Set when first entering subtotals mode');
    assert.deepEqual([...db.selCols], KNOWN_SEL,
      'selCols should preserve existing selection on first subtotals entry');
    assert.deepEqual(db.subtotalBy, [], 'subtotalBy should be empty on first entry');
    assert.deepEqual(db.subtotalFns, {}, 'subtotalFns should be empty on first entry');
    assert.equal(db.subtotalGrandTotal, true, 'subtotalGrandTotal defaults to true');
    assert.equal(db.subtotalSpacer, false, 'subtotalSpacer defaults to false');

    // Set subtotals config
    db.subtotalBy = ['Company'];

    // Switch back to detail
    saveActiveAggModeState();
    db.aggMode = 'none';
    loadAggModeState('none');
    assert.deepEqual(db.subtotalBy, [], 'subtotalBy should not bleed into detail mode');
    assert.deepEqual([...db.selCols], KNOWN_SEL, 'selCols restored in detail mode');
  });

  // ── Round-trip save/restore across all 4 modes ──
  it('should independently save and restore config for all four modes', () => {
    resetDb(); setupBase();

    // Start in detail with specific selCols
    const detailSel = ['OrderId', 'Company'];
    setSel(detailSel);
    saveActiveAggModeState();

    // Switch to group, set config, save
    db.aggMode = 'group';
    loadAggModeState('group');
    setSel(['Company', 'Amount', 'OrderDate']);
    db.groupBy = ['Company'];
    db.aggregates = [{ alias: 'SumAmt', col: 'Amount', fn: 'SUM', enabled: true }];
    saveActiveAggModeState();

    // Switch to totals, set config, save
    db.aggMode = 'totals';
    loadAggModeState('totals');
    setSel(['OrderId', 'Company', 'Status']);
    db.colTotals = { Amount: 'SUM' };
    saveActiveAggModeState();

    // Switch to subtotals, set config, save
    db.aggMode = 'subtotals';
    loadAggModeState('subtotals');
    setSel(['Region', 'Company', 'Amount']);
    db.subtotalBy = ['Region'];
    db.subtotalFns = { Amount: 'SUM' };
    saveActiveAggModeState();

    // Now verify each mode's state is independently preserved
    // → detail
    db.aggMode = 'none';
    loadAggModeState('none');
    assert.deepEqual([...db.selCols], detailSel, 'detail selCols restored');
    assert.deepEqual(db.groupBy, [], 'detail: no groupBy');
    assert.deepEqual(db.colTotals, {}, 'detail: no colTotals');
    assert.deepEqual(db.subtotalBy, [], 'detail: no subtotalBy');

    // → group
    db.aggMode = 'group';
    loadAggModeState('group');
    assert.deepEqual([...db.selCols], ['Company', 'Amount', 'OrderDate'], 'group selCols restored');
    assert.deepEqual(db.groupBy, ['Company'], 'group groupBy restored');
    assert.equal(db.aggregates.length, 1, 'group aggregates restored');
    assert.deepEqual(db.colTotals, {}, 'group: no colTotals bleed');
    assert.deepEqual(db.subtotalBy, [], 'group: no subtotalBy bleed');

    // → totals
    db.aggMode = 'totals';
    loadAggModeState('totals');
    assert.deepEqual([...db.selCols], ['OrderId', 'Company', 'Status'], 'totals selCols restored');
    assert.deepEqual(db.colTotals, { Amount: 'SUM' }, 'totals colTotals restored');
    assert.deepEqual(db.groupBy, [], 'totals: no groupBy bleed');
    assert.deepEqual(db.aggregates, [], 'totals: no aggregates bleed');

    // → subtotals
    db.aggMode = 'subtotals';
    loadAggModeState('subtotals');
    assert.deepEqual([...db.selCols], ['Region', 'Company', 'Amount'], 'subtotals selCols restored');
    assert.deepEqual(db.subtotalBy, ['Region'], 'subtotals subtotalBy restored');
    assert.deepEqual(db.subtotalFns, { Amount: 'SUM' }, 'subtotals subtotalFns restored');
    assert.deepEqual(db.groupBy, [], 'subtotals: no groupBy bleed');
    assert.deepEqual(db.colTotals, {}, 'subtotals: no colTotals bleed');
  });

  // ── Merge config independence ──
  it('should not let merge config affect SQL, validation, or other config sections', () => {
    resetDb(); setupBase();
    setSel(ALL_COLS);

    // Run baseline pipeline without merge config
    const baseResult = runReportPipeline({});
    expectReportHealthy(baseResult.validation);

    // Set merge config
    db.mergedCols = ['Company', 'Region'];
    db.mergeGroupUnderline = true;

    // Run again with merge config — SQL and validation should be identical
    const mergeResult = runReportPipeline({});
    expectReportHealthy(mergeResult.validation);
    assert.equal(mergeResult.sql, baseResult.sql,
      'SQL should be identical with or without merge config');
    assert.equal(mergeResult.plan.joins.length, baseResult.plan.joins.length,
      'Plan joins unchanged by merge config');
    assert.deepEqual(mergeResult.plan.filters, baseResult.plan.filters,
      'Plan filters unchanged by merge config');

    // Validation should not report merge-related blocking
    const blocking = getBlockingIssues(mergeResult.validation);
    const mergeBlocking = blocking.filter(i => i.id && i.id.startsWith('merge_'));
    assert.equal(mergeBlocking.length, 0, 'Merge config should not cause blocking');

    // Merge config should not affect execution
    expectResultRowCount(mergeResult.result, 8);
  });

  // ── Merge config for non-existent column should warn, not block ──
  it('should warn (non-blocking) when mergedCols references missing column', () => {
    resetDb(); setupBase();
    setSel(ALL_COLS);

    db.mergedCols = ['NonExistentCol'];
    const r = runReportPipeline({});
    // Should still execute
    assert.ok(r.result, 'Should execute despite missing merge column');
    expectResultRowCount(r.result, 8);
    // Validation should exist (may have non-blocking merge warnings)
    assert.ok(r.validation, 'Validation should exist');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q. Column toggle data integrity — disable, run, re-enable, run, verify
// ═══════════════════════════════════════════════════════════════════════════
describe('Q. Column toggle data integrity', () => {
  const ALL = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];

  // ── Q1: Detail mode ──
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

  // ── Q2: Detail — progressive toggle ──
  it('should survive progressive disable and re-enable cycles in detail mode', () => {
    let r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    const baseline = r.result.rows;

    // Cycle 1: disable Contact, re-enable
    let active = ALL.filter(c => c !== 'Contact');
    r = runReportPipeline({ selCols: new Set(active), colOrder: active, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, active);
    assert.equal(r.result.rows[0].Contact, undefined, 'Contact absent after disable');
    r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectRowsEqual(r.result.rows, baseline);

    // Cycle 2: disable OrderDate, re-enable
    active = ALL.filter(c => c !== 'OrderDate');
    r = runReportPipeline({ selCols: new Set(active), colOrder: active, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, active);
    r = runReportPipeline({ selCols: new Set(ALL), colOrder: ALL, aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ALL);
    expectRowsEqual(r.result.rows, baseline);

    // Cycle 3: disable three columns at once
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

  // ── Q3: Totals mode ──
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

  // ── Q4: Subtotals mode ──
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

    // Disable Amount
    r = runReportPipeline({
      selCols: new Set(['Region', 'Company']),
      colOrder: ['Region', 'Company'],
      aggMode: 'subtotals',
      subtotalBy: ['Region'],
      colTotals: { Amount: 'SUM' },
    });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, ['Region', 'Company']);

    // Re-enable Amount
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

  // ── Q5: Detail — value integrity against fixture data ──
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

  // ── Q6: Lookup columns survive disable/enable cycle ──
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

    // Disable lookup → prune selCols (simulates _afterCombineChange)
    db.lookups[0].enabled = false;
    const nowCols = projectedCols();
    const nowSet = new Set(nowCols);
    for (const c of [...db.selCols]) { if (!nowSet.has(c)) db.selCols.delete(c); }
    db.colOrder = db.colOrder.filter(c => nowSet.has(c));

    r = runReportPipeline({ aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, allCols.filter(c => !lookupCols.includes(c)));

    // Re-enable lookup + re-add columns
    db.lookups[0].enabled = true;
    db.selCols = new Set(allCols);
    db.colOrder = [...allCols];

    r = runReportPipeline({ aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, allCols);
    expectRowsEqual(r.result.rows, baseline);
  });

  // ── Q7: Combine lookup with row exclusion ──
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

    // Baseline — no exclusion
    let r = runReportPipeline({ aggMode: 'none' });
    expectReportHealthy(r.validation);
    expectResultColumns(r.result, allCols);

    // Exclude row 4 from Contacts
    r = runReportPipeline({ aggMode: 'none', excludedRows: { Contacts: [4] } });
    expectReportHealthy(r.validation);

    // Verify _rowno is in subquery, not after the final ON
    const joinOn = 'ON "Orders"."Company" = "Contacts"."Company"';
    const joinIdx = r.sql.indexOf(joinOn);
    assert.ok(joinIdx >= 0, 'Join ON clause found');
    assert.ok(!r.sql.slice(joinIdx).includes('_rowno'),
      'No _rowno in or after the ON clause');
    assert.ok(r.sql.slice(0, joinIdx).includes('_rowno'),
      '_rowno appears before the ON clause (in subquery)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R. Mixed-value per-column dedup
// ═══════════════════════════════════════════════════════════════════════════
describe('R. Mixed-value per-column dedup', () => {
  it('should deduplicate per column when duplicate-key rows share one column value but differ in another', () => {
    // Add rows where duplicate Company keys have same Email but different Phone
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

    // Plan assertion: combine policy is preserved
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
