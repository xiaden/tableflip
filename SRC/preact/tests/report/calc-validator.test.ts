import { describe, it, expect } from 'vitest';
import { checkCalcError } from '../../report/calc-validator';
import type { CalcStage } from '../../types';

describe('calc-validator', () => {
  describe('checkCalcError()', () => {
    // ── Common ──────────────────────────────────────────────────────────────

    it('should return error for empty alias', () => {
      const calc: CalcStage = { alias: '', mode: 'math', math: { strategy: 'stepChain', steps: [{ type: 'number', value: '1' }] } };
      expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
    });

    it('should return error for whitespace-only alias', () => {
      const calc: CalcStage = { alias: '   ', mode: 'math', math: { strategy: 'stepChain', steps: [{ type: 'number', value: '1' }] } };
      expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
    });

    it('should return error for invalid mode', () => {
      const calc: CalcStage = { alias: 'X', mode: 'invalid' as any };
      expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
    });

    it('should return error for missing mode', () => {
      const calc: CalcStage = { alias: 'X' } as any;
      expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
    });

    // ── Math Mode ──────────────────────────────────────────────────────────

    describe('math mode', () => {
      it('should return null for valid math config', () => {
        const calc: CalcStage = {
          alias: 'Result',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { type: 'number', value: '2', op: '*' },
            ],
          },
        };
        expect(checkCalcError(calc, 0, ['Amount'])).toBeNull();
      });

      it('should return error for missing math config', () => {
        const calc: CalcStage = { alias: 'X', mode: 'math' };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error for invalid strategy', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'math',
          math: { strategy: 'invalid', steps: [{ type: 'number', value: '1' }] },
        };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error for no steps', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'math',
          math: { strategy: 'stepChain', steps: [] },
        };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error if first step has op', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'A', op: '+' },
            ],
          },
        };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error if step references unavailable column', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'NonExistent' },
            ],
          },
        };
        expect(checkCalcError(calc, 0, ['A', 'B'])).toBeTruthy();
      });

      it('should return error for self-referencing column', () => {
        const calc: CalcStage = {
          alias: 'MyCalc',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'MyCalc' },
            ],
          },
        };
        expect(checkCalcError(calc, 0, ['A', 'MyCalc'])).toBeTruthy();
      });
    });

    // ── Compare Mode ───────────────────────────────────────────────────────

    describe('compare mode', () => {
      const validCompare: CalcStage = {
        alias: 'Result',
        mode: 'compare',
        compare: {
          compareMode: 'AND',
          conditions: [
            { col: 'Amount', op: '>', val: '100' },
          ],
          trueValue: { type: 'text', value: 'High' },
          falseValue: { type: 'text', value: 'Low' },
        },
      };

      it('should return null for valid compare config', () => {
        expect(checkCalcError(validCompare, 0, ['Amount'])).toBeNull();
      });

      it('should return error for missing compare config', () => {
        const calc: CalcStage = { alias: 'X', mode: 'compare' };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error for invalid compareMode', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'compare',
          compare: {
            compareMode: 'INVALID',
            conditions: [{ col: 'A', op: '=', val: '1' }],
            trueValue: { type: 'text', value: 'Y' },
            falseValue: { type: 'text', value: 'N' },
          },
        };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error for no conditions', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'compare',
          compare: {
            compareMode: 'AND',
            conditions: [],
            trueValue: { type: 'text', value: 'Y' },
            falseValue: { type: 'text', value: 'N' },
          },
        };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error if condition column is unavailable', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'compare',
          compare: {
            compareMode: 'OR',
            conditions: [{ col: 'Missing', op: '=', val: '1' }],
            trueValue: { type: 'text', value: 'Y' },
            falseValue: { type: 'text', value: 'N' },
          },
        };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error if condition references output alias', () => {
        const calc: CalcStage = {
          alias: 'MyCalc',
          mode: 'compare',
          compare: {
            compareMode: 'AND',
            conditions: [{ col: 'MyCalc', op: '=', val: '1' }],
            trueValue: { type: 'text', value: 'Y' },
            falseValue: { type: 'text', value: 'N' },
          },
        };
        expect(checkCalcError(calc, 0, ['A', 'MyCalc'])).toBeTruthy();
      });
    });

    // ── Text Mode ──────────────────────────────────────────────────────────

    describe('text mode', () => {
      it('should return null for valid combine operation', () => {
        const calc: CalcStage = {
          alias: 'Full',
          mode: 'text',
          text: {
            operation: 'combine',
            parts: [
              { type: 'column', value: 'First' },
              { type: 'text', value: ' ' },
              { type: 'column', value: 'Last' },
            ],
          },
        };
        expect(checkCalcError(calc, 0, ['First', 'Last'])).toBeNull();
      });

      it('should return null for valid left operation', () => {
        const calc: CalcStage = {
          alias: 'Short',
          mode: 'text',
          text: {
            operation: 'left',
            source: { type: 'column', value: 'Name' },
            count: 3,
          },
        };
        expect(checkCalcError(calc, 0, ['Name'])).toBeNull();
      });

      it('should return null for valid substring operation', () => {
        const calc: CalcStage = {
          alias: 'Sub',
          mode: 'text',
          text: {
            operation: 'substring',
            source: { type: 'column', value: 'Name' },
            start: 2,
            length: 3,
          },
        };
        expect(checkCalcError(calc, 0, ['Name'])).toBeNull();
      });

      it('should return error for unknown text operation', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'text',
          text: { operation: 'unknown' },
        };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });
    });

    // ── Date Mode ──────────────────────────────────────────────────────────

    describe('date mode', () => {
      it('should return null for valid extract operation', () => {
        const calc: CalcStage = {
          alias: 'Year',
          mode: 'date',
          date: {
            operation: 'extract',
            source: { type: 'column', value: 'OrderDate' },
            part: 'year',
          },
        };
        expect(checkCalcError(calc, 0, ['OrderDate'])).toBeNull();
      });

      it('should return error for unknown date operation', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'date',
          date: {
            operation: 'unknown',
            source: { type: 'column', value: 'D' },
            part: 'year',
          },
        };
        expect(checkCalcError(calc, 0, ['D'])).toBeTruthy();
      });

      it('should return error if source column is unavailable', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'date',
          date: {
            operation: 'extract',
            source: { type: 'column', value: 'Missing' },
            part: 'year',
          },
        };
        expect(checkCalcError(calc, 0, ['A'])).toBeTruthy();
      });

      it('should return error for invalid date part', () => {
        const calc: CalcStage = {
          alias: 'X',
          mode: 'date',
          date: {
            operation: 'extract',
            source: { type: 'column', value: 'D' },
            part: 'invalid',
          },
        };
        expect(checkCalcError(calc, 0, ['D'])).toBeTruthy();
      });
    });
  });
});
