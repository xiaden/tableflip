'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runReportPipeline, expectReportHealthy, expectResultRowCount, expectResultColumns, getFixtureFiles, loadExcelSheet, createTableFromSheet, snapshotTable, expectRowsEqual } = require('../helpers.js');

describe('O. Real-world fixture files', () => {
  it('should load every Excel fixture file without error', () => {
    const fixtureFiles = getFixtureFiles();
    assert.ok(fixtureFiles.length > 0, `No fixture files found`);
    const results = [];
    for (const f of fixtureFiles) {
      const fpath = require('path').resolve(__dirname, '../testfixtures', f);
      const loaded = loadExcelSheet(fpath);
      assert.ok(loaded.rows.length > 0, `"${f}" should have at least 1 data row`);
      results.push({ file: f, sheets: loaded.workbook.SheetNames.length, rows: loaded.rows.length, cols: Object.keys(loaded.rows[0]).length });
    }
  });

  it('should not mutate source table data through report config changes', () => {
    const fpath = require('path').resolve(__dirname, '../testfixtures', 'world_cup_2018_squads.xlsx');
    const loaded = loadExcelSheet(fpath);
    const tableName = 'WCSquads';

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

    sqlDb.run(`DROP TABLE IF EXISTS "${tableName}"`);
    createTableFromSheet(sqlDb, tableName, loaded.rows);

    const baseline = snapshotTable(sqlDb, tableName);
    assert.ok(baseline.rowCount > 0, 'Table should have rows');
    assert.ok(baseline.columns.length > 0, 'Table should have columns');

    const cols = baseline.columns.slice(0, 5);

    function setupBase() {
      db.tables[tableName] = { id: tableName, name: tableName, cols: [...baseline.columns] };
      db.base = tableName;
      db.baseCols = baseline.columns.reduce((acc, c) => ({ ...acc, [c]: c }), {});
    }

    hardReset(); setupBase();
    db.selCols = new Set(cols);
    db.colOrder = cols;
    const r1 = runReportPipeline({});
    expectReportHealthy(r1.validation);
    const after1 = snapshotTable(sqlDb, tableName);
    assert.equal(after1.rowCount, baseline.rowCount, 'Config 1: row count unchanged');
    assert.deepEqual(after1.rows, baseline.rows, 'Config 1: row data unchanged');

    hardReset(); setupBase();
    db.selCols = new Set(cols);
    db.colOrder = cols;
    db.filters = [{ col: 'Team', op: 'equals', vals: ['France'], enabled: true }];
    const r2 = runReportPipeline({});
    expectReportHealthy(r2.validation);
    const after2 = snapshotTable(sqlDb, tableName);
    assert.equal(after2.rowCount, baseline.rowCount, 'After filter: row count unchanged');
    assert.deepEqual(after2.rows, baseline.rows, 'After filter: row data unchanged');

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
