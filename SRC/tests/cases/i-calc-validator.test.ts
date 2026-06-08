import { describe, it, expect } from 'vitest';

function setupDb(overrides: Record<string, unknown> = {}) {
  const db = (globalThis as any).db;
  Object.assign(db, {
    base: 'Orders',
    lookups: [],
    calcStages: [],
  }, overrides);
  return db;
}

function checkCalcError(calc: any, i: number) {
  return (globalThis as any).checkCalcError(calc, i);
}

describe('Calc Validator — missing alias', () => {
  it('should error when alias is empty', () => {
    setupDb();
    const err = checkCalcError({ alias: '', mode: 'math' }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('label');
  });

  it('should error when alias is only whitespace', () => {
    setupDb();
    const err = checkCalcError({ alias: '   ', mode: 'math' }, 0);
    expect(err).toBeTruthy();
  });
});

describe('Calc Validator — invalid mode', () => {
  it('should error when mode is missing', () => {
    setupDb();
    const err = checkCalcError({ alias: 'X' }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('calculation type');
  });

  it('should error when mode is invalid', () => {
    setupDb();
    const err = checkCalcError({ alias: 'X', mode: 'bogus' }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('calculation type');
  });
});

describe('Calc Validator — valid math calc', () => {
  it('should pass for a simple column * number math', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Doubled',
      mode: 'math',
      math: {
        strategy: 'stepChain',
        steps: [
          { type: 'column', value: 'Amount' },
          { op: '*', type: 'number', value: '2' },
        ],
      },
    }, 0);
    expect(err).toBeNull();
  });

  it('should pass for multi-step math', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Computed',
      mode: 'math',
      math: {
        strategy: 'stepChain',
        steps: [
          { type: 'column', value: 'Amount' },
          { op: '+', type: 'number', value: '10' },
          { op: '*', type: 'number', value: '2' },
        ],
      },
    }, 0);
    expect(err).toBeNull();
  });

  it('should error when first step has an operator', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'math',
      math: {
        strategy: 'stepChain',
        steps: [
          { op: '+', type: 'column', value: 'Amount' },
          { op: '*', type: 'number', value: '2' },
        ],
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('first');
  });

  it('should error when step has invalid operator', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'math',
      math: {
        strategy: 'stepChain',
        steps: [
          { type: 'column', value: 'Amount' },
          { op: '^', type: 'number', value: '2' },
        ],
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('invalid operator');
  });

  it('should error when math references unavailable column', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'math',
      math: {
        strategy: 'stepChain',
        steps: [
          { type: 'column', value: 'NoSuchCol' },
          { op: '+', type: 'number', value: '1' },
        ],
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('unavailable');
  });

  it('should error when math has no steps', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'math',
      math: { strategy: 'stepChain', steps: [] },
    }, 0);
    expect(err).toBeTruthy();
  });

  it('should error when math strategy is not stepChain', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'math',
      math: { strategy: 'single', steps: [{ type: 'column', value: 'Amount' }] },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('stepChain');
  });

  it('should error on self-referencing column', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Amount',
      mode: 'math',
      math: {
        strategy: 'stepChain',
        steps: [
          { type: 'column', value: 'Amount' },
          { op: '+', type: 'number', value: '1' },
        ],
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('itself');
  });

  it('should error when step has non-numeric value for number type', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'math',
      math: {
        strategy: 'stepChain',
        steps: [
          { type: 'column', value: 'Amount' },
          { op: '+', type: 'number', value: 'abc' },
        ],
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('non-numeric');
  });
});

describe('Calc Validator — valid compare calc', () => {
  it('should pass for a simple comparison', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'IsOpen',
      mode: 'compare',
      compare: {
        compareMode: 'AND',
        conditions: [{ col: 'Status', op: '=', val: 'Open' }],
        trueValue: { type: 'text', value: 'Yes' },
        falseValue: { type: 'text', value: 'No' },
      },
    }, 0);
    expect(err).toBeNull();
  });

  it('should error when compare mode is not AND/OR', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'compare',
      compare: {
        compareMode: 'XOR',
        conditions: [{ col: 'Status', op: '=', val: 'Open' }],
        trueValue: { type: 'text', value: 'Y' },
        falseValue: { type: 'text', value: 'N' },
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('AND or OR');
  });

  it('should error when condition has invalid operator', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'compare',
      compare: {
        compareMode: 'AND',
        conditions: [{ col: 'Status', op: 'LIKE', val: 'Open' }],
        trueValue: { type: 'text', value: 'Y' },
        falseValue: { type: 'text', value: 'N' },
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('operator');
  });

  it('should error when condition column is unavailable', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'compare',
      compare: {
        compareMode: 'AND',
        conditions: [{ col: 'FakeCol', op: '=', val: 'x' }],
        trueValue: { type: 'text', value: 'Y' },
        falseValue: { type: 'text', value: 'N' },
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('available');
  });

  it('should error when trueValue is missing', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'compare',
      compare: {
        compareMode: 'AND',
        conditions: [{ col: 'Status', op: '=', val: 'Open' }],
        falseValue: { type: 'text', value: 'N' },
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('trueValue');
  });

  it('should error when condition value is empty', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'compare',
      compare: {
        compareMode: 'AND',
        conditions: [{ col: 'Status', op: '=', val: '' }],
        trueValue: { type: 'text', value: 'Y' },
        falseValue: { type: 'text', value: 'N' },
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('value');
  });
});

describe('Calc Validator — valid text calc', () => {
  it('should pass for combine operation', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'FullLabel',
      mode: 'text',
      text: {
        operation: 'combine',
        parts: [
          { type: 'column', value: 'Company' },
          { type: 'text', value: ' - ' },
          { type: 'column', value: 'Region' },
        ],
      },
    }, 0);
    expect(err).toBeNull();
  });

  it('should pass for left operation', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Prefix',
      mode: 'text',
      text: {
        operation: 'left',
        source: { type: 'column', value: 'Company' },
        count: 3,
      },
    }, 0);
    expect(err).toBeNull();
  });

  it('should pass for substring operation', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Middle',
      mode: 'text',
      text: {
        operation: 'substring',
        source: { type: 'column', value: 'Company' },
        start: 1,
        length: 3,
      },
    }, 0);
    expect(err).toBeNull();
  });

  it('should error for unknown text operation', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'text',
      text: { operation: 'reverse' },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('Unknown text operation');
  });

  it('should error when combine part references unavailable column', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'text',
      text: {
        operation: 'combine',
        parts: [{ type: 'column', value: 'GhostCol' }],
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('unavailable');
  });

  it('should error when left count is not positive', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'text',
      text: {
        operation: 'left',
        source: { type: 'column', value: 'Company' },
        count: 0,
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('positive count');
  });

  it('should error when substring start is not positive', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Bad',
      mode: 'text',
      text: {
        operation: 'substring',
        source: { type: 'column', value: 'Company' },
        start: 0,
        length: 3,
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('positive start');
  });
});

describe('Calc Validator — duplicate alias', () => {
  it('should error when two calc stages share the same alias', () => {
    setupDb({
      calcStages: [
        {
          alias: 'Doubled',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { op: '*', type: 'number', value: '2' },
            ],
          },
        },
        {
          alias: 'Doubled',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { op: '*', type: 'number', value: '3' },
            ],
          },
        },
      ],
    });
    const db = (globalThis as any).db;
    const err = checkCalcError(db.calcStages[1], 1);
    expect(err).toBeTruthy();
    expect(err).toContain('unique');
  });
});

describe('Calc Validator — label conflict with physical column', () => {
  it('should error when alias matches a physical column name', () => {
    setupDb();
    const err = checkCalcError({
      alias: 'Company',
      mode: 'text',
      text: {
        operation: 'left',
        source: { type: 'column', value: 'Company' },
        count: 3,
      },
    }, 0);
    expect(err).toBeTruthy();
    expect(err).toContain('conflicts');
  });
});
