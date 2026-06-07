
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runReportPipeline, expectReportBlocked, expectReportHealthy, expectItemBlocked, getBlockingIssues } from '../helpers.js';
import { isRecognizableConfig } from '../../js/core/state-schema.js';
import { hydrateState, applyState } from '../../js/core/state-hydrator.js';

// ── Recognizability ───────────────────────────────────────────────────────────
// These tests verify the isRecognizableConfig gate.
// They use direct calls (not runReportPipeline) so they need no fixture.

describe('T. Load with blockers — recognizability', () => {
  it('A. recognizable config with different version loads', () => {
    const payload = {
      v: 999,
      base: 'Orders',
      lookups: [],
      filters: [],
      colOrder: ['OrderId'],
      aggMode: 'none',
    };
    assert.ok(isRecognizableConfig(payload), 'Config with 2+ TF keys should be recognizable');
    assert.equal(payload.v, 999, 'Different version should not prevent recognition');
  });

  it('B. unrecognizable payload rejects', () => {
    assert.equal(isRecognizableConfig(null), false, 'null should not be recognizable');
    assert.equal(isRecognizableConfig('hello'), false, 'string should not be recognizable');
    assert.equal(isRecognizableConfig([1, 2, 3]), false, 'array should not be recognizable');
    assert.equal(isRecognizableConfig({}), false, 'empty object should not be recognizable');
    assert.equal(isRecognizableConfig({ foo: 'bar' }), false, 'random object should not be recognizable');
    assert.equal(isRecognizableConfig({ v: 1, title: 'My Data' }), false, 'single non-TF key should not be recognizable');
    assert.equal(isRecognizableConfig({ v: 1, base: 'Sheet1' }), false, 'only 1 TF key (base) not enough');
  });

  it('threshold: at least 2 TableFlip keys required', () => {
    assert.equal(isRecognizableConfig({ base: 'Orders' }), false, 'only 1 key not enough');
    assert.equal(isRecognizableConfig({ base: 'Orders', filters: [] }), true, '2 keys is enough');
  });
});

// ── Direct hydrateState / applyState tests ────────────────────────────────────
// These call hydrateState directly, then applyState, then assert validation
// and db state.  The beforeEach (setupTwoTableFixture) provides Orders + Contacts.

describe('T. Load with blockers — hydrate/apply', () => {
  it('C. malformed filter vals survives hydrate/apply and blocks', () => {
    const { next, brokenRefs, nextExcludedRows } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      filters: [{ col: 'Status', op: 'equals', vals: 'not-an-array', enabled: true }],
    });

    assert.equal(next.filters.length, 1, 'Filter should survive hydration');
    assert.equal(next.filters[0].vals, 'not-an-array', 'Non-array vals preserved');
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'filter_0');
    assert.ok(v.items['filter_0'].issues.some(i => i.id === 'filter_0_bad_vals'));
  });

  it('D. aliasless calc survives hydrate/apply and blocks', () => {
    const { next, brokenRefs, nextExcludedRows } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
      calcStages: [{ alias: '', op: '+', left: 'OrderId', right: 'Company', enabled: true }],
    });

    assert.equal(next.calcStages.length, 1, 'Calc should survive hydration');
    assert.equal(next.calcStages[0].alias, '', 'Empty alias preserved');
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'calc_0');
    assert.ok(v.items['calc_0'].issues.some(i => i.id === 'calc_0_no_alias'));
  });

  it('E. invalid aggregate/totals/subtotal function survives hydrate/apply and blocks', () => {
    // aggregate
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['Region', 'Amount'],
      aggMode: 'group',
      groupBy: ['Region'],
      aggregates: [{ col: 'Amount', fn: 'BAD_AGG' }],
    });
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'agg_0');
    assert.ok(v.items['agg_0'].issues.some(i => i.id === 'agg_0_invalid_fn'));
  });

  it('F. missing source refs survive hydrate/apply and block', () => {
    const { next, brokenRefs } = hydrateState({
      base: 'Orders',
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

    assert.equal(next.lookups.length, 1, 'Missing-source lookup should survive');
    assert.equal(next.lookups[0].rightId, 'NonExistentTable');
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'lookup_0');
  });

  it('G. disabled unresolved item survives and does not block by itself', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
      calcStages: [{ alias: '', op: '+', left: 'OrderId', right: 'Company', enabled: false }],
    });
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportHealthy(v);
    const item = v.items['calc_0'];
    assert.ok(item, 'Item should exist');
    assert.equal(item.blocking, false, 'Disabled item should not block');
  });

  it('K. invalid calc operator survives hydrate/apply and blocks', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
      calcStages: [{ alias: 'BadCalc', op: 'BAD_OP', left: 'OrderId', right: 'Company', enabled: true }],
    });

    assert.equal(next.calcStages.length, 1, 'Calc should survive hydration');
    assert.equal(next.calcStages[0].op, 'BAD_OP', 'Operator should be preserved, not replaced');
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'calc_0');
    assert.ok(v.items['calc_0'].issues.some(i => i.id === 'calc_0_expr_error'));
  });

  it('L. invalid aggMode survives hydrate/apply and blocks', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'BAD_MODE',
    });

    assert.equal(next.aggMode, 'BAD_MODE', 'aggMode should be preserved');
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    const item = v.items['aggMode'];
    assert.ok(item, 'aggMode item should exist');
    assert.ok(item.blocking, 'aggMode should be blocking');
    assert.ok(item.issues.some(i => i.id === 'aggMode_invalid'));
  });

  it('M. filter vals with non-strings survive hydrate/apply and block', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      filters: [{ col: 'Status', op: 'equals', vals: ['Open', 123], enabled: true }],
    });

    assert.equal(next.filters.length, 1, 'Filter should survive hydration');
    assert.equal(next.filters[0].vals[0], 'Open', 'String value preserved');
    assert.equal(next.filters[0].vals[1], 123, 'Non-string value preserved (not filtered)');
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'filter_0');
    assert.ok(v.items['filter_0'].issues.some(i => i.id === 'filter_0_bad_vals'));
  });

  it('N. COMPARE calc with invalid condition operator preserves op and blocks', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      calcStages: [{
        alias: 'BadCompare',
        op: 'COMPARE',
        conditions: [{ col: 'Company', op: 'BAD_OP', val: 'ACME' }],
        enabled: true,
      }],
    });

    assert.equal(next.calcStages.length, 1, 'Calc should survive hydration');
    assert.equal(next.calcStages[0].conditions[0].op, 'BAD_OP', 'Condition op preserved, not replaced with =');
    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'calc_0');
    assert.ok(v.items['calc_0'].issues.some(i => i.id === 'calc_0_expr_error'));
  });
});

// ── New calc schema (mode-based) — Phase 1 ─────────────────────────────────
// These tests verify the new mode-based calc format: hydration, serialization,
// column-catalog registration, and validation.  No SQL rendering yet.

describe('T. Load with blockers — new calc schema', () => {
  it('O. math calc hydrates and round-trips', () => {
    const payload = {
      base: 'Orders',
      colOrder: ['OrderId', 'Amount'],
      aggMode: 'none',
      calcStages: [{
        alias: 'AmtPlusFee',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { op: '+', type: 'column', value: 'Fee' },
          ],
        },
      }],
    };

    const { next } = hydrateState(payload);
    assert.equal(next.calcStages.length, 1, 'Math calc should survive hydration');
    const c = next.calcStages[0];
    assert.equal(c.mode, 'math', 'Mode preserved');
    assert.equal(c.math.strategy, 'stepChain', 'Strategy preserved');
    assert.equal(c.math.steps[0].type, 'column', 'First step type preserved');
    assert.equal(c.math.steps[0].value, 'Amount', 'First step value preserved');
    assert.equal(c.math.steps[1].op, '+', 'Second step op preserved');
    assert.equal(c.math.steps[1].value, 'Fee', 'Second step value preserved');

    // Simulate serialization — JSON round trip
    const serialized = JSON.parse(JSON.stringify(next.calcStages));
    assert.equal(serialized[0].mode, 'math', 'Mode survives JSON round trip');
    assert.equal(serialized[0].math.strategy, 'stepChain', 'Strategy survives JSON');
    assert.equal(serialized[0].math.steps[1].op, '+', 'Step op survives JSON');
  });

  it('P. compare calc hydrates and round-trips', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      calcStages: [{
        alias: 'IsOpen',
        mode: 'compare',
        enabled: true,
        compare: {
          compareMode: 'AND',
          conditions: [{ col: 'Status', op: '=', val: 'Open' }],
          trueValue: { type: 'text', value: 'Yes' },
          falseValue: { type: 'text', value: 'No' },
        },
      }],
    });

    const c = next.calcStages[0];
    assert.equal(c.mode, 'compare', 'Mode preserved');
    assert.equal(c.compare.compareMode, 'AND', 'compareMode preserved');
    assert.equal(c.compare.conditions[0].col, 'Status', 'Condition col preserved');
    assert.equal(c.compare.trueValue.type, 'text', 'trueValue type preserved');
    assert.equal(c.compare.trueValue.value, 'Yes', 'trueValue value preserved');
    assert.equal(c.compare.falseValue.value, 'No', 'falseValue value preserved');

    const serialized = JSON.parse(JSON.stringify(next.calcStages));
    assert.equal(serialized[0].mode, 'compare', 'Mode survives JSON');
    assert.equal(serialized[0].compare.trueValue.type, 'text', 'trueValue type survives JSON');
  });

  it('Q. text combine calc hydrates and round-trips', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      calcStages: [{
        alias: 'FullName',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'combine',
          parts: [
            { type: 'column', value: 'Company' },
            { type: 'text', value: ' - ' },
            { type: 'column', value: 'OrderId' },
          ],
        },
      }],
    });

    const c = next.calcStages[0];
    assert.equal(c.mode, 'text', 'Mode preserved');
    assert.equal(c.text.operation, 'combine', 'operation preserved');
    assert.equal(c.text.parts.length, 3, 'Parts count preserved');
    assert.equal(c.text.parts[1].type, 'text', 'Literal part type preserved');
    assert.equal(c.text.parts[1].value, ' - ', 'Literal part value preserved');
  });

  it('R. text left calc hydrates', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      calcStages: [{
        alias: 'CodePrefix',
        mode: 'text',
        enabled: true,
        text: { operation: 'left', source: { type: 'column', value: 'OrderId' }, count: 3 },
      }],
    });

    const c = next.calcStages[0];
    assert.equal(c.mode, 'text', 'Mode preserved');
    assert.equal(c.text.operation, 'left', 'Operation preserved');
    assert.equal(c.text.source.type, 'column', 'Source type preserved');
    assert.equal(c.text.count, 3, 'Count preserved');
  });

  it('S. text right calc hydrates', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      calcStages: [{
        alias: 'LastChars',
        mode: 'text',
        enabled: true,
        text: { operation: 'right', source: { type: 'column', value: 'OrderId' }, count: 2 },
      }],
    });

    assert.equal(next.calcStages[0].text.operation, 'right', 'Operation preserved');
    assert.equal(next.calcStages[0].text.count, 2, 'Count preserved');
  });

  it('T. text substring calc hydrates', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      calcStages: [{
        alias: 'SubCode',
        mode: 'text',
        enabled: true,
        text: { operation: 'substring', source: { type: 'column', value: 'OrderId' }, start: 1, length: 3 },
      }],
    });

    const c = next.calcStages[0];
    assert.equal(c.text.operation, 'substring', 'Operation preserved');
    assert.equal(c.text.start, 1, 'Start preserved');
    assert.equal(c.text.length, 3, 'Length preserved');
  });

  it('U. enabled math calc validates and blocks', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Amount'],
      aggMode: 'none',
      calcStages: [{
        alias: 'BadMath',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'NonExistentCol' },
            { op: '+', type: 'number', value: '5' },
          ],
        },
      }],
    });

    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'calc_0');
    assert.ok(v.items['calc_0'].issues.some(i => i.id === 'calc_0_expr_error'));
  });

  it('V. enabled compare calc validates and blocks on bad condition op', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      calcStages: [{
        alias: 'BadCompare',
        mode: 'compare',
        enabled: true,
        compare: {
          compareMode: 'AND',
          conditions: [{ col: 'Company', op: 'XOR', val: 'ACME' }],
          trueValue: { type: 'text', value: 'Yes' },
          falseValue: { type: 'text', value: 'No' },
        },
      }],
    });

    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportBlocked(v);
    expectItemBlocked(v, 'calc_0');
    assert.ok(v.items['calc_0'].issues.some(i => i.id === 'calc_0_expr_error'));
  });

  it('W. disabled invalid calc does not block', () => {
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Amount'],
      aggMode: 'none',
      calcStages: [{
        alias: 'BadDisabled',
        mode: 'math',
        enabled: false,
        math: {
          strategy: 'stepChain',
          steps: [{ type: 'column', value: 'NonExistent' }],
        },
      }],
    });

    Object.assign(db, next);
    if (typeof invalidateValidation === 'function') invalidateValidation();

    const v = getValidation();
    expectReportHealthy(v);
    const item = v.items['calc_0'];
    assert.ok(item, 'Item should exist');
    assert.equal(item.blocking, false, 'Disabled calc should not block');
  });

  it('X. old-format calc still works alongside new format', () => {
    // Regression: old-format valid calc must still work unchanged
    const { next } = hydrateState({
      base: 'Orders',
      colOrder: ['OrderId', 'Company', 'Amount'],
      aggMode: 'none',
      calcStages: [
        { alias: 'OldCalc', op: '+', left: 'Amount', right: 'Fee', enabled: true },
      ],
    });

    assert.equal(next.calcStages.length, 1, 'Old format calc survives hydration');
    assert.equal(next.calcStages[0].op, '+', 'Old format op preserved');
    assert.equal(next.calcStages[0].left, 'Amount', 'Old format left preserved');
  });
});

// ── NO_KEY_PAIRS validation ─────────────────────────────────────────────────
describe('T. Load with blockers — lookup key pair validation', () => {
  it('H. enabled lookup with no complete key pairs blocks', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [],
        cols: ['Email'],
        required: false,
        enabled: true,
      }],
    });

    expectReportBlocked(r.validation);
    expectItemBlocked(r.validation, 'lookup_0');
    assert.ok(r.validation.items['lookup_0'].issues.some(i => i.id === 'lookup_0_no_key_pairs'));
  });

  it('I. enabled lookup with incomplete key pairs blocks', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [{ left: '', right: 'Company' }],
        cols: ['Email'],
        required: false,
        enabled: true,
      }],
    });

    expectReportBlocked(r.validation);
    assert.ok(r.validation.items['lookup_0'].issues.some(i => i.id === 'lookup_0_no_key_pairs'));
  });

  it('J. disabled lookup with no complete key pairs does not block', () => {
    const r = runReportPipeline({
      base: 'Orders',
      selCols: new Set(['OrderId', 'Company']),
      colOrder: ['OrderId', 'Company'],
      aggMode: 'none',
      lookups: [{
        rightId: 'Contacts',
        keyPairs: [],
        cols: ['Email'],
        required: false,
        enabled: false,
      }],
    });

    expectReportHealthy(r.validation);
    const item = r.validation.items['lookup_0'];
    assert.ok(item, 'Item should exist');
    assert.equal(item.blocking, false, 'Disabled lookup should not block even with no key pairs');
  });
});
