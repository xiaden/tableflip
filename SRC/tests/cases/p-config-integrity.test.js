
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportHealthy, expectResultRowCount, getBlockingIssues } from '../helpers.js';
import { loadAggModeState, saveActiveAggModeState } from '../../js/ui/aggregation.js';

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

  it('should preserve selCols and isolate mode config when switching detail→group→detail', () => {
    resetDb(); setupBase();
    setSel(KNOWN_SEL);

    saveActiveAggModeState();
    db.aggMode = 'group';
    loadAggModeState('group');

    assert.ok(db.selCols instanceof Set, 'selCols should still be a Set in group mode');
    assert.deepEqual([...db.selCols], KNOWN_SEL, 'selCols preserved when entering group mode');
    assert.deepEqual(db.groupBy, [], 'groupBy should be empty on first group entry');
    assert.deepEqual(db.aggregates, [], 'aggregates should be empty on first group entry');

    db.groupBy = ['Company'];
    db.aggregates = [{ alias: 'Total', col: 'Amount', fn: 'SUM', enabled: true }];

    saveActiveAggModeState();
    db.aggMode = 'none';
    loadAggModeState('none');

    assert.deepEqual(db.groupBy, [], 'groupBy should not bleed into detail mode');
    assert.deepEqual(db.aggregates, [], 'aggregates should not bleed into detail mode');
    assert.ok(db.selCols instanceof Set, 'selCols should be a Set back in detail mode');
    assert.deepEqual([...db.selCols], KNOWN_SEL, 'selCols restored from detail saved state');

    saveActiveAggModeState();
    db.aggMode = 'group';
    loadAggModeState('group');
    assert.deepEqual(db.groupBy, ['Company'], 'groupBy restored when re-entering group mode');
    assert.equal(db.aggregates.length, 1, 'aggregates restored when re-entering group mode');
    assert.equal(db.aggregates[0].alias, 'Total', 'aggregate alias restored');
  });

  it('should not reset selCols when first switching to totals mode', () => {
    resetDb(); setupBase();
    setSel(KNOWN_SEL);

    saveActiveAggModeState();
    db.aggMode = 'totals';
    loadAggModeState('totals');

    assert.ok(db.selCols instanceof Set,
      'selCols should remain a Set when first entering totals mode (not become null)');
    assert.deepEqual([...db.selCols], KNOWN_SEL,
      'selCols should preserve existing selection on first totals entry');
    assert.deepEqual(db.colTotals, {}, 'colTotals should be empty on first totals entry');

    saveActiveAggModeState();
    db.aggMode = 'none';
    loadAggModeState('none');
    assert.deepEqual([...db.selCols], KNOWN_SEL, 'selCols restored after returning to detail');
    assert.deepEqual(db.colTotals, {}, 'colTotals should not bleed into detail mode');
  });

  it('should not reset selCols when first switching to subtotals mode', () => {
    resetDb(); setupBase();
    setSel(KNOWN_SEL);

    saveActiveAggModeState();
    db.aggMode = 'subtotals';
    loadAggModeState('subtotals');

    assert.ok(db.selCols instanceof Set,
      'selCols should remain a Set when first entering subtotals mode');
    assert.deepEqual([...db.selCols], KNOWN_SEL,
      'selCols should preserve existing selection on first subtotals entry');
    assert.deepEqual(db.subtotalBy, [], 'subtotalBy should be empty on first entry');
    assert.deepEqual(db.subtotalFns, {}, 'subtotalFns should be empty on first entry');
    assert.equal(db.subtotalGrandTotal, true, 'subtotalGrandTotal defaults to true');
    assert.equal(db.subtotalSpacer, false, 'subtotalSpacer defaults to false');

    db.subtotalBy = ['Company'];

    saveActiveAggModeState();
    db.aggMode = 'none';
    loadAggModeState('none');
    assert.deepEqual(db.subtotalBy, [], 'subtotalBy should not bleed into detail mode');
    assert.deepEqual([...db.selCols], KNOWN_SEL, 'selCols restored in detail mode');
  });

  it('should independently save and restore config for all four modes', () => {
    resetDb(); setupBase();

    const detailSel = ['OrderId', 'Company'];
    setSel(detailSel);
    saveActiveAggModeState();

    db.aggMode = 'group';
    loadAggModeState('group');
    setSel(['Company', 'Amount', 'OrderDate']);
    db.groupBy = ['Company'];
    db.aggregates = [{ alias: 'SumAmt', col: 'Amount', fn: 'SUM', enabled: true }];
    saveActiveAggModeState();

    db.aggMode = 'totals';
    loadAggModeState('totals');
    setSel(['OrderId', 'Company', 'Status']);
    db.colTotals = { Amount: 'SUM' };
    saveActiveAggModeState();

    db.aggMode = 'subtotals';
    loadAggModeState('subtotals');
    setSel(['Region', 'Company', 'Amount']);
    db.subtotalBy = ['Region'];
    db.subtotalFns = { Amount: 'SUM' };
    saveActiveAggModeState();

    db.aggMode = 'none';
    loadAggModeState('none');
    assert.deepEqual([...db.selCols], detailSel, 'detail selCols restored');
    assert.deepEqual(db.groupBy, [], 'detail: no groupBy');
    assert.deepEqual(db.colTotals, {}, 'detail: no colTotals');
    assert.deepEqual(db.subtotalBy, [], 'detail: no subtotalBy');

    db.aggMode = 'group';
    loadAggModeState('group');
    assert.deepEqual([...db.selCols], ['Company', 'Amount', 'OrderDate'], 'group selCols restored');
    assert.deepEqual(db.groupBy, ['Company'], 'group groupBy restored');
    assert.equal(db.aggregates.length, 1, 'group aggregates restored');
    assert.deepEqual(db.colTotals, {}, 'group: no colTotals bleed');
    assert.deepEqual(db.subtotalBy, [], 'group: no subtotalBy bleed');

    db.aggMode = 'totals';
    loadAggModeState('totals');
    assert.deepEqual([...db.selCols], ['OrderId', 'Company', 'Status'], 'totals selCols restored');
    assert.deepEqual(db.colTotals, { Amount: 'SUM' }, 'totals colTotals restored');
    assert.deepEqual(db.groupBy, [], 'totals: no groupBy bleed');
    assert.deepEqual(db.aggregates, [], 'totals: no aggregates bleed');

    db.aggMode = 'subtotals';
    loadAggModeState('subtotals');
    assert.deepEqual([...db.selCols], ['Region', 'Company', 'Amount'], 'subtotals selCols restored');
    assert.deepEqual(db.subtotalBy, ['Region'], 'subtotals subtotalBy restored');
    assert.deepEqual(db.subtotalFns, { Amount: 'SUM' }, 'subtotals subtotalFns restored');
    assert.deepEqual(db.groupBy, [], 'subtotals: no groupBy bleed');
    assert.deepEqual(db.colTotals, {}, 'subtotals: no colTotals bleed');
  });

  it('should not let merge config affect SQL, validation, or other config sections', () => {
    resetDb(); setupBase();
    setSel(ALL_COLS);

    const baseResult = runReportPipeline({});
    expectReportHealthy(baseResult.validation);

    db.mergedCols = ['Company', 'Region'];
    db.mergeGroupUnderline = true;

    const mergeResult = runReportPipeline({});
    expectReportHealthy(mergeResult.validation);
    assert.equal(mergeResult.sql, baseResult.sql,
      'SQL should be identical with or without merge config');
    assert.equal(mergeResult.plan.joins.length, baseResult.plan.joins.length,
      'Plan joins unchanged by merge config');
    assert.deepEqual(mergeResult.plan.filters, baseResult.plan.filters,
      'Plan filters unchanged by merge config');

    const blocking = getBlockingIssues(mergeResult.validation);
    const mergeBlocking = blocking.filter(i => i.id && i.id.startsWith('merge_'));
    assert.equal(mergeBlocking.length, 0, 'Merge config should not cause blocking');

    expectResultRowCount(mergeResult.result, 8);
  });

  it('should warn (non-blocking) when mergedCols references missing column', () => {
    resetDb(); setupBase();
    setSel(ALL_COLS);

    db.mergedCols = ['NonExistentCol'];
    const r = runReportPipeline({});
    assert.ok(r.result, 'Should execute despite missing merge column');
    expectResultRowCount(r.result, 8);
    assert.ok(r.validation, 'Validation should exist');
  });
});
