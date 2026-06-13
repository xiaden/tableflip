import { describe, it, expect } from 'vitest';
import { buildCalcExpressions } from '../../query/sql-calcs';
import type { CalcStage } from '../../types';
import type { ColMapEntry } from '../../catalog/column-catalog';
import { ordersColMap, normalizeSql } from './helpers';

describe('sql-calcs', () => {
  const colMap = ordersColMap();

  describe('buildCalcExpressions()', () => {
    // ── Math mode ─────────────────────────────────────────────────────────

    it('should handle math mode: simple addition', () => {
      const calcs: CalcStage[] = [{
        alias: 'Doubled',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'column', value: 'Amount', op: '+' },
          ],
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].alias).toBe('Doubled');
      expect(result[0].sql).toContain('+');
    });

    it('should handle math mode: subtraction', () => {
      const calcs: CalcStage[] = [{
        alias: 'Diff',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '10', op: '-' },
          ],
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('-');
    });

    it('should handle math mode: multiplication', () => {
      const calcs: CalcStage[] = [{
        alias: 'Tax',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '0.1', op: '*' },
          ],
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('*');
    });

    it('should handle math mode: division with zero protection', () => {
      const calcs: CalcStage[] = [{
        alias: 'Ratio',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '2', op: '/' },
          ],
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('CASE WHEN');
      expect(result[0].sql).toContain('THEN NULL');
    });

    it('should handle math mode: modulo with zero protection', () => {
      const calcs: CalcStage[] = [{
        alias: 'Remainder',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '3', op: '%' },
          ],
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('CASE WHEN');
      expect(result[0].sql).toContain('%');
    });

    it('should handle math mode: column + number steps', () => {
      const calcs: CalcStage[] = [{
        alias: 'Adjusted',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '100', op: '+' },
            { type: 'number', value: '2', op: '*' },
          ],
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('+');
      expect(result[0].sql).toContain('*');
    });

    // ── Compare mode ──────────────────────────────────────────────────────

    it('should handle compare mode: single condition', () => {
      const calcs: CalcStage[] = [{
        alias: 'IsHigh',
        mode: 'compare',
        compare: {
          compareMode: 'AND',
          conditions: [{ col: 'Amount', op: '>', val: '100' }],
          trueValue: { type: 'text', value: 'Yes' },
          falseValue: { type: 'text', value: 'No' },
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('CASE WHEN');
      expect(result[0].sql).toContain('THEN');
      expect(result[0].sql).toContain('ELSE');
    });

    it('should handle compare mode: AND conditions', () => {
      const calcs: CalcStage[] = [{
        alias: 'Flag',
        mode: 'compare',
        compare: {
          compareMode: 'AND',
          conditions: [
            { col: 'Amount', op: '>', val: '100' },
            { col: 'Status', op: '=', val: 'Open' },
          ],
          trueValue: { type: 'text', value: 'Y' },
          falseValue: { type: 'text', value: 'N' },
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('AND');
    });

    it('should handle compare mode: OR conditions', () => {
      const calcs: CalcStage[] = [{
        alias: 'Flag',
        mode: 'compare',
        compare: {
          compareMode: 'OR',
          conditions: [
            { col: 'Status', op: '=', val: 'Open' },
            { col: 'Status', op: '=', val: 'Pending' },
          ],
          trueValue: { type: 'text', value: 'Y' },
          falseValue: { type: 'text', value: 'N' },
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('OR');
    });

    // ── Text mode ─────────────────────────────────────────────────────────

    it('should handle text mode: combine', () => {
      const calcs: CalcStage[] = [{
        alias: 'FullName',
        mode: 'text',
        text: {
          operation: 'combine',
          parts: [
            { type: 'column', value: 'Company' },
            { type: 'text', value: ' - ' },
            { type: 'column', value: 'Contact' },
          ],
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('||');
    });

    it('should handle text mode: left', () => {
      const calcs: CalcStage[] = [{
        alias: 'Prefix',
        mode: 'text',
        text: {
          operation: 'left',
          source: { type: 'column', value: 'Company' },
          count: 3,
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('SUBSTR');
    });

    it('should handle text mode: right', () => {
      const calcs: CalcStage[] = [{
        alias: 'Suffix',
        mode: 'text',
        text: {
          operation: 'right',
          source: { type: 'column', value: 'Company' },
          count: 3,
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('SUBSTR');
      expect(result[0].sql).toContain('-3');
    });

    it('should handle text mode: substring', () => {
      const calcs: CalcStage[] = [{
        alias: 'Sub',
        mode: 'text',
        text: {
          operation: 'substring',
          source: { type: 'column', value: 'Company' },
          start: 2,
          length: 3,
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('SUBSTR');
    });

    // ── Date mode ─────────────────────────────────────────────────────────

    it('should handle date mode: extract year', () => {
      const calcs: CalcStage[] = [{
        alias: 'Year',
        mode: 'date',
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'year',
          output: 'numeric',
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('strftime');
      expect(result[0].sql).toContain('%Y');
    });

    it('should handle date mode: extract month', () => {
      const calcs: CalcStage[] = [{
        alias: 'Month',
        mode: 'date',
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'month',
          output: 'numeric',
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('strftime');
      expect(result[0].sql).toContain('%m');
    });

    it('should handle date mode: extract day', () => {
      const calcs: CalcStage[] = [{
        alias: 'Day',
        mode: 'date',
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'day',
          output: 'numeric',
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(1);
      expect(result[0].sql).toContain('strftime');
      expect(result[0].sql).toContain('%d');
    });

    // ── Skip conditions ───────────────────────────────────────────────────

    it('should skip disabled calc stages', () => {
      const calcs: CalcStage[] = [{
        alias: 'Disabled',
        mode: 'math',
        math: { strategy: 'stepChain', steps: [{ type: 'number', value: '1' }] },
        enabled: false,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(0);
    });

    it('should skip stages with empty alias', () => {
      const calcs: CalcStage[] = [{
        alias: '',
        mode: 'math',
        math: { strategy: 'stepChain', steps: [{ type: 'number', value: '1' }] },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(0);
    });

    it('should skip stages with whitespace-only alias', () => {
      const calcs: CalcStage[] = [{
        alias: '   ',
        mode: 'math',
        math: { strategy: 'stepChain', steps: [{ type: 'number', value: '1' }] },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(0);
    });

    it('should skip stages with invalid mode', () => {
      const calcs: CalcStage[] = [{
        alias: 'Bad',
        mode: 'invalid' as any,
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(0);
    });

    it('should skip stages with missing mode', () => {
      const calcs: CalcStage[] = [{
        alias: 'NoMode',
        mode: undefined as any,
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(0);
    });

    it('should return empty array for empty input', () => {
      const result = buildCalcExpressions([], colMap);
      expect(result).toEqual([]);
    });

    it('should handle multiple calc stages', () => {
      const calcs: CalcStage[] = [
        {
          alias: 'Calc1',
          mode: 'math',
          math: { strategy: 'stepChain', steps: [{ type: 'number', value: '1' }] },
          enabled: true,
        },
        {
          alias: 'Calc2',
          mode: 'math',
          math: { strategy: 'stepChain', steps: [{ type: 'number', value: '2' }] },
          enabled: true,
        },
      ];
      const result = buildCalcExpressions(calcs, colMap);
      expect(result.length).toBe(2);
      expect(result[0].alias).toBe('Calc1');
      expect(result[1].alias).toBe('Calc2');
    });

    // ── Cycle detection ────────────────────────────────────────────────────

    it('should handle self-reference: calc column referencing itself', () => {
      // Calc A references itself as a column — the trail detects the cycle
      // and returns NULL for the self-reference
      const selfRefMap = new Map<string, ColMapEntry>(colMap);
      selfRefMap.set('SelfRef', { kind: 'calc', idx: 0, mode: 'math', alias: 'SelfRef' });
      const calcs: CalcStage[] = [{
        alias: 'SelfRef',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: 'SelfRef' },
            { type: 'number', value: '1', op: '+' },
          ],
        },
        enabled: true,
      }];
      const result = buildCalcExpressions(calcs, selfRefMap);
      expect(result.length).toBe(1);
      // The self-reference resolves to NULL due to cycle detection
      expect(result[0].sql).toContain('NULL');
    });

    it('should handle mutual reference: calc A refs calc B, calc B refs calc A', () => {
      // Both calcs reference each other — cycle detection prevents infinite loop
      const mutualMap = new Map<string, ColMapEntry>(colMap);
      mutualMap.set('CalcA', { kind: 'calc', idx: 0, mode: 'math', alias: 'CalcA' });
      mutualMap.set('CalcB', { kind: 'calc', idx: 1, mode: 'math', alias: 'CalcB' });
      const calcs: CalcStage[] = [
        {
          alias: 'CalcA',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'CalcB' },
              { type: 'number', value: '1', op: '+' },
            ],
          },
          enabled: true,
        },
        {
          alias: 'CalcB',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'CalcA' },
              { type: 'number', value: '2', op: '*' },
            ],
          },
          enabled: true,
        },
      ];
      // Should not throw or hang — cycle detection terminates recursion
      const result = buildCalcExpressions(calcs, mutualMap);
      expect(result.length).toBe(2);
      expect(result[0].alias).toBe('CalcA');
      expect(result[1].alias).toBe('CalcB');
    });

    it('should handle transitive chain: A→B→C→A', () => {
      // Three calcs in a cycle: A refs B, B refs C, C refs A
      const chainMap = new Map<string, ColMapEntry>(colMap);
      chainMap.set('ChainA', { kind: 'calc', idx: 0, mode: 'math', alias: 'ChainA' });
      chainMap.set('ChainB', { kind: 'calc', idx: 1, mode: 'math', alias: 'ChainB' });
      chainMap.set('ChainC', { kind: 'calc', idx: 2, mode: 'math', alias: 'ChainC' });
      const calcs: CalcStage[] = [
        {
          alias: 'ChainA',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'ChainB' },
              { type: 'number', value: '1', op: '+' },
            ],
          },
          enabled: true,
        },
        {
          alias: 'ChainB',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'ChainC' },
              { type: 'number', value: '2', op: '*' },
            ],
          },
          enabled: true,
        },
        {
          alias: 'ChainC',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'ChainA' },
              { type: 'number', value: '3', op: '-' },
            ],
          },
          enabled: true,
        },
      ];
      // Should not throw or hang — cycle detection terminates recursion
      const result = buildCalcExpressions(calcs, chainMap);
      expect(result.length).toBe(3);
      expect(result[0].alias).toBe('ChainA');
      expect(result[1].alias).toBe('ChainB');
      expect(result[2].alias).toBe('ChainC');
    });
  });
});
