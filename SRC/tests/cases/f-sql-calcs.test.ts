import { describe, it, expect, beforeAll } from 'vitest';

let _renderCalcExpr: any;
let buildQueryPlan: any;
let buildSourceCatalog: any;
let invalidateValidation: any;
let getValidation: any;

beforeAll(async () => {
  const mod = await import('../../js/query/sql-calcs.js');
  const planMod = await import('../../js/query/query-plan.js');
  const catMod = await import('../../js/catalog/source-catalog.js');
  const valMod = await import('../../js/report/validation.js');
  _renderCalcExpr = mod._renderCalcExpr;
  buildQueryPlan = planMod.buildQueryPlan;
  buildSourceCatalog = catMod.buildSourceCatalog;
  invalidateValidation = valMod.invalidateValidation;
  getValidation = valMod.getValidation;
});

function makePlanWithCalcs(calcStages: any[]) {
  const db = (globalThis as any).db;
  Object.assign(db, {
    base: 'Orders',
    stacks: [],
    lookups: [],
    calcStages,
    selCols: null,
    colOrder: null,
    filters: [],
    sorts: [],
    groupBy: [],
    aggregates: [],
    aggMode: 'none',
    excludedRows: {},
  });
  invalidateValidation();
  const validation = getValidation();
  const sourceCatalog = buildSourceCatalog();
  return buildQueryPlan(null, null, validation, sourceCatalog);
}

describe('_renderCalcExpr', () => {
  describe('math mode', () => {
    it('should render simple column + number', () => {
      const plan = makePlanWithCalcs([{
        alias: 'PlusTen',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '10', op: '+' },
          ],
        },
      }]);
      const result = _renderCalcExpr('PlusTen', plan.colMap, plan, '"Orders"');
      expect(result).toContain('+');
      expect(result).toContain('10');
      expect(result).toContain('"Amount"');
    });

    it('should render subtraction', () => {
      const plan = makePlanWithCalcs([{
        alias: 'MinusFive',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '5', op: '-' },
          ],
        },
      }]);
      const result = _renderCalcExpr('MinusFive', plan.colMap, plan, '"Orders"');
      expect(result).toContain('-');
      expect(result).toContain('5');
    });

    it('should render multiplication', () => {
      const plan = makePlanWithCalcs([{
        alias: 'Double',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '2', op: '*' },
          ],
        },
      }]);
      const result = _renderCalcExpr('Double', plan.colMap, plan, '"Orders"');
      expect(result).toContain('*');
    });

    it('should render division with zero guard', () => {
      const plan = makePlanWithCalcs([{
        alias: 'Half',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '2', op: '/' },
          ],
        },
      }]);
      const result = _renderCalcExpr('Half', plan.colMap, plan, '"Orders"');
      expect(result).toContain('CASE WHEN');
      expect(result).toContain('= 0 THEN NULL');
    });

    it('should render modulo with zero guard', () => {
      const plan = makePlanWithCalcs([{
        alias: 'ModThree',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '3', op: '%' },
          ],
        },
      }]);
      const result = _renderCalcExpr('ModThree', plan.colMap, plan, '"Orders"');
      expect(result).toContain('CASE WHEN');
      expect(result).toContain('= 0 THEN NULL');
    });

    it('should render multi-step chain', () => {
      const plan = makePlanWithCalcs([{
        alias: 'Complex',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '10', op: '+' },
            { type: 'number', value: '2', op: '*' },
          ],
        },
      }]);
      const result = _renderCalcExpr('Complex', plan.colMap, plan, '"Orders"');
      expect(result).toContain('+');
      expect(result).toContain('*');
    });

    it('should render column-to-column math', () => {
      const plan = makePlanWithCalcs([{
        alias: 'AmtRatio',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'column', value: 'Amount', op: '/' },
          ],
        },
      }]);
      const result = _renderCalcExpr('AmtRatio', plan.colMap, plan, '"Orders"');
      expect(result).toContain('CASE WHEN');
      expect(result).toContain('"Amount"');
    });

    it('should handle invalid number value as 0', () => {
      const plan = makePlanWithCalcs([{
        alias: 'BadNum',
        mode: 'math',
        enabled: true,
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: 'not-a-number', op: '+' },
          ],
        },
      }]);
      const result = _renderCalcExpr('BadNum', plan.colMap, plan, '"Orders"');
      expect(result).toContain('0');
    });

    it('should throw on unsupported math step type', () => {
      const colMap = new Map();
      colMap.set('Amount', { tid: 'Orders', col: 'Amount' });
      colMap.set('BadStep', {
        kind: 'calc', mode: 'math', idx: 0,
        calc: {
          alias: 'BadStep', mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { type: 'bogus', value: 'x', op: '+' },
            ],
          },
        },
      });
      const plan = makePlanWithCalcs([]);
      expect(() => _renderCalcExpr('BadStep', colMap, plan, '"Orders"')).toThrow('Unsupported math step type');
    });

    it('should throw on unsupported math operator', () => {
      const colMap = new Map();
      colMap.set('Amount', { tid: 'Orders', col: 'Amount' });
      colMap.set('BadOp', {
        kind: 'calc', mode: 'math', idx: 0,
        calc: {
          alias: 'BadOp', mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { type: 'number', value: '2', op: '^' },
            ],
          },
        },
      });
      const plan = makePlanWithCalcs([]);
      expect(() => _renderCalcExpr('BadOp', colMap, plan, '"Orders"')).toThrow('Unsupported math operator');
    });
  });

  describe('compare mode', () => {
    it('should render CASE WHEN with AND conditions', () => {
      const plan = makePlanWithCalcs([{
        alias: 'IsHighValue',
        mode: 'compare',
        enabled: true,
        compare: {
          compareMode: 'AND',
          conditions: [{ col: 'Amount', op: '>', val: '100' }],
          trueValue: { type: 'text', value: 'Yes' },
          falseValue: { type: 'text', value: 'No' },
        },
      }]);
      const result = _renderCalcExpr('IsHighValue', plan.colMap, plan, '"Orders"');
      expect(result).toContain('CASE WHEN');
      expect(result).toContain('THEN');
      expect(result).toContain('ELSE');
      expect(result).toContain('END');
      expect(result).toContain("'Yes'");
      expect(result).toContain("'No'");
    });

    it('should render OR conditions', () => {
      const plan = makePlanWithCalcs([{
        alias: 'IsSpecial',
        mode: 'compare',
        enabled: true,
        compare: {
          compareMode: 'OR',
          conditions: [
            { col: 'Amount', op: '>', val: '500' },
            { col: 'Amount', op: '<', val: '10' },
          ],
          trueValue: { type: 'text', value: 'Special' },
          falseValue: { type: 'text', value: 'Normal' },
        },
      }]);
      const result = _renderCalcExpr('IsSpecial', plan.colMap, plan, '"Orders"');
      expect(result).toContain(' OR ');
    });

    it('should handle numeric typed values', () => {
      const plan = makePlanWithCalcs([{
        alias: 'NumResult',
        mode: 'compare',
        enabled: true,
        compare: {
          compareMode: 'AND',
          conditions: [{ col: 'Amount', op: '>', val: '100' }],
          trueValue: { type: 'number', value: '1' },
          falseValue: { type: 'number', value: '0' },
        },
      }]);
      const result = _renderCalcExpr('NumResult', plan.colMap, plan, '"Orders"');
      expect(result).toContain('THEN 1');
      expect(result).toContain('ELSE 0');
    });

    it('should handle column typed values', () => {
      const plan = makePlanWithCalcs([{
        alias: 'ColResult',
        mode: 'compare',
        enabled: true,
        compare: {
          compareMode: 'AND',
          conditions: [{ col: 'Amount', op: '>', val: '100' }],
          trueValue: { type: 'column', value: 'Amount' },
          falseValue: { type: 'number', value: '0' },
        },
      }]);
      const result = _renderCalcExpr('ColResult', plan.colMap, plan, '"Orders"');
      expect(result).toContain('"Amount"');
    });

    it('should escape single quotes in text values', () => {
      const plan = makePlanWithCalcs([{
        alias: 'Quoted',
        mode: 'compare',
        enabled: true,
        compare: {
          compareMode: 'AND',
          conditions: [{ col: 'Amount', op: '>', val: '0' }],
          trueValue: { type: 'text', value: "it's" },
          falseValue: { type: 'text', value: "isn't" },
        },
      }]);
      const result = _renderCalcExpr('Quoted', plan.colMap, plan, '"Orders"');
      expect(result).toContain("it''s");
      expect(result).toContain("isn''t");
    });

    it('should handle equality comparison with text value', () => {
      const plan = makePlanWithCalcs([{
        alias: 'StatusCheck',
        mode: 'compare',
        enabled: true,
        compare: {
          compareMode: 'AND',
          conditions: [{ col: 'Status', op: '=', val: 'Open' }],
          trueValue: { type: 'text', value: 'Yes' },
          falseValue: { type: 'text', value: 'No' },
        },
      }]);
      const result = _renderCalcExpr('StatusCheck', plan.colMap, plan, '"Orders"');
      expect(result).toContain('CASE WHEN');
      expect(result).toContain("'Open'");
    });

    it('should throw on invalid comparison operator', () => {
      const colMap = new Map();
      colMap.set('Amount', { tid: 'Orders', col: 'Amount' });
      colMap.set('BadCompare', {
        kind: 'calc', mode: 'compare', idx: 0,
        calc: {
          alias: 'BadCompare', mode: 'compare',
          compare: {
            compareMode: 'AND',
            conditions: [{ col: 'Amount', op: 'LIKE', val: '100' }],
            trueValue: { type: 'text', value: 'Yes' },
            falseValue: { type: 'text', value: 'No' },
          },
        },
      });
      const plan = makePlanWithCalcs([]);
      expect(() => _renderCalcExpr('BadCompare', colMap, plan, '"Orders"')).toThrow('Invalid comparison operator');
    });
  });

  describe('text mode', () => {
    it('should render combine operation', () => {
      const plan = makePlanWithCalcs([{
        alias: 'Combined',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'combine',
          parts: [
            { type: 'column', value: 'Company' },
            { type: 'text', value: ' - ' },
            { type: 'column', value: 'Contact' },
          ],
        },
      }]);
      const result = _renderCalcExpr('Combined', plan.colMap, plan, '"Orders"');
      expect(result).toContain('||');
      expect(result).toContain("' - '");
      expect(result).toContain('"Company"');
      expect(result).toContain('"Contact"');
    });

    it('should render left operation', () => {
      const plan = makePlanWithCalcs([{
        alias: 'First3',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'left',
          source: { type: 'column', value: 'Company' },
          count: 3,
        },
      }]);
      const result = _renderCalcExpr('First3', plan.colMap, plan, '"Orders"');
      expect(result).toContain('SUBSTR');
      expect(result).toContain('1, 3');
    });

    it('should render right operation', () => {
      const plan = makePlanWithCalcs([{
        alias: 'Last3',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'right',
          source: { type: 'column', value: 'Company' },
          count: 3,
        },
      }]);
      const result = _renderCalcExpr('Last3', plan.colMap, plan, '"Orders"');
      expect(result).toContain('SUBSTR');
      expect(result).toContain('-3');
    });

    it('should render substring operation', () => {
      const plan = makePlanWithCalcs([{
        alias: 'Middle',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'substring',
          source: { type: 'column', value: 'Company' },
          start: 2,
          length: 4,
        },
      }]);
      const result = _renderCalcExpr('Middle', plan.colMap, plan, '"Orders"');
      expect(result).toContain('SUBSTR');
      expect(result).toContain('2, 4');
    });

    it('should handle text source in left/right/substring', () => {
      const plan = makePlanWithCalcs([{
        alias: 'FromLiteral',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'left',
          source: { type: 'text', value: 'Hello World' },
          count: 5,
        },
      }]);
      const result = _renderCalcExpr('FromLiteral', plan.colMap, plan, '"Orders"');
      expect(result).toContain("'Hello World'");
      expect(result).toContain('SUBSTR');
    });

    it('should handle number parts in combine', () => {
      const plan = makePlanWithCalcs([{
        alias: 'WithNum',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'combine',
          parts: [
            { type: 'column', value: 'Company' },
            { type: 'text', value: ': ' },
            { type: 'number', value: '42' },
          ],
        },
      }]);
      const result = _renderCalcExpr('WithNum', plan.colMap, plan, '"Orders"');
      expect(result).toContain('||');
      expect(result).toContain('CAST(42 AS TEXT)');
    });

    it('should escape single quotes in text parts', () => {
      const plan = makePlanWithCalcs([{
        alias: 'Quoted',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'combine',
          parts: [
            { type: 'text', value: "it's" },
            { type: 'column', value: 'Company' },
          ],
        },
      }]);
      const result = _renderCalcExpr('Quoted', plan.colMap, plan, '"Orders"');
      expect(result).toContain("it''s");
    });

    it('should throw on unknown text operation', () => {
      const colMap = new Map();
      colMap.set('Company', { tid: 'Orders', col: 'Company' });
      colMap.set('BadText', {
        kind: 'calc', mode: 'text', idx: 0,
        calc: {
          alias: 'BadText', mode: 'text',
          text: {
            operation: 'reverse',
            source: { type: 'column', value: 'Company' },
          },
        },
      });
      const plan = makePlanWithCalcs([]);
      expect(() => _renderCalcExpr('BadText', colMap, plan, '"Orders"')).toThrow('Unknown text operation');
    });
  });

  describe('date mode', () => {
    it('should render extract year', () => {
      const plan = makePlanWithCalcs([{
        alias: 'OrderYear',
        mode: 'date',
        enabled: true,
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'year',
        },
      }]);
      const result = _renderCalcExpr('OrderYear', plan.colMap, plan, '"Orders"');
      expect(result).toContain("strftime('%Y'");
      expect(result).toContain('"OrderDate"');
    });

    it('should render extract month', () => {
      const plan = makePlanWithCalcs([{
        alias: 'OrderMonth',
        mode: 'date',
        enabled: true,
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'month',
        },
      }]);
      const result = _renderCalcExpr('OrderMonth', plan.colMap, plan, '"Orders"');
      expect(result).toContain("strftime('%m'");
    });

    it('should render extract day', () => {
      const plan = makePlanWithCalcs([{
        alias: 'OrderDay',
        mode: 'date',
        enabled: true,
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'day',
        },
      }]);
      const result = _renderCalcExpr('OrderDay', plan.colMap, plan, '"Orders"');
      expect(result).toContain("strftime('%d'");
    });

    it('should render extract quarter', () => {
      const plan = makePlanWithCalcs([{
        alias: 'OrderQuarter',
        mode: 'date',
        enabled: true,
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'quarter',
        },
      }]);
      const result = _renderCalcExpr('OrderQuarter', plan.colMap, plan, '"Orders"');
      expect(result).toContain("strftime('%m'");
      expect(result).toContain('/ 3');
    });

    it('should render extract julian', () => {
      const plan = makePlanWithCalcs([{
        alias: 'JulianDate',
        mode: 'date',
        enabled: true,
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'julian',
        },
      }]);
      const result = _renderCalcExpr('JulianDate', plan.colMap, plan, '"Orders"');
      expect(result).toContain('julianday');
    });

    it('should render extract dow', () => {
      const plan = makePlanWithCalcs([{
        alias: 'DayOfWeek',
        mode: 'date',
        enabled: true,
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'dow',
        },
      }]);
      const result = _renderCalcExpr('DayOfWeek', plan.colMap, plan, '"Orders"');
      expect(result).toContain("strftime('%w'");
    });

    it('should render extract week', () => {
      const plan = makePlanWithCalcs([{
        alias: 'WeekNum',
        mode: 'date',
        enabled: true,
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'week',
        },
      }]);
      const result = _renderCalcExpr('WeekNum', plan.colMap, plan, '"Orders"');
      expect(result).toContain("strftime('%W'");
    });

    it('should throw on unknown date operation', () => {
      const colMap = new Map();
      colMap.set('OrderDate', { tid: 'Orders', col: 'OrderDate' });
      colMap.set('BadDate', {
        kind: 'calc', mode: 'date', idx: 0,
        calc: {
          alias: 'BadDate', mode: 'date',
          date: {
            operation: 'add',
            source: { type: 'column', value: 'OrderDate' },
          },
        },
      });
      const plan = makePlanWithCalcs([]);
      expect(() => _renderCalcExpr('BadDate', colMap, plan, '"Orders"')).toThrow('Unknown date operation');
    });
  });

  describe('error handling', () => {
    it('should throw on unknown calc mode', () => {
      const colMap = new Map();
      colMap.set('Amount', { tid: 'Orders', col: 'Amount' });
      colMap.set('BadMode', {
        kind: 'calc', mode: 'bogus', idx: 0,
        calc: { alias: 'BadMode', mode: 'bogus' },
      });
      const plan = makePlanWithCalcs([]);
      expect(() => _renderCalcExpr('BadMode', colMap, plan, '"Orders"')).toThrow('Unknown calc mode');
    });

    it('should throw when calc config not found', () => {
      const colMap = new Map();
      colMap.set('Missing', { kind: 'calc', mode: 'math', idx: 999 });
      const plan = makePlanWithCalcs([]);
      expect(() => _renderCalcExpr('Missing', colMap, plan, '"Orders"')).toThrow('calc config not found');
    });

    it('should return quoted alias for unknown non-calc column', () => {
      const plan = makePlanWithCalcs([]);
      const result = _renderCalcExpr('UnknownCol', plan.colMap, plan, '"Orders"');
      expect(result).toBe('"UnknownCol"');
    });
  });

  describe('circular reference protection', () => {
    it('should return NULL for circular calc references', () => {
      const colMap = new Map();
      colMap.set('A', { kind: 'calc', mode: 'math', idx: 0, calc: {
        alias: 'A',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'A' },
            { type: 'number', value: '1', op: '+' },
          ],
        },
      }});
      const plan = makePlanWithCalcs([]);
      const trail = new Set(['A']);
      const result = _renderCalcExpr('A', colMap, plan, '"Orders"', trail);
      expect(result).toBe('NULL');
    });
  });

  describe('physical column pass-through', () => {
    it('should return table.column for physical column entries', () => {
      const plan = makePlanWithCalcs([]);
      const result = _renderCalcExpr('Amount', plan.colMap, plan, '"Orders"');
      expect(result).toContain('"Orders"');
      expect(result).toContain('"Amount"');
    });
  });
});
