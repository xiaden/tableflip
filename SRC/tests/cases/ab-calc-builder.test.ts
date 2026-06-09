import { describe, it, expect } from 'vitest';
import {
  renderMathBuilder,
  renderTextBuilder,
  renderCompareBuilder,
  renderDateBuilder,
  calcModeRenderers,
  type CalcBuilderCtx,
} from '../../js/ui/components/calc-builder.js';

const makeCtx = (overrides: Partial<CalcBuilderCtx> = {}): CalcBuilderCtx => ({
  calc: { alias: '', mode: 'math', enabled: true } as CalcStage,
  i: 0,
  cols: ['a', 'b', 'c'],
  colOptsFor: (sel: string) =>
    ['a', 'b', 'c'].map(c =>
      `<option value="${c}" ${sel === c ? 'selected' : ''}>${c}</option>`
    ).join(''),
  ...overrides,
});

describe('calc-builder', () => {
  describe('renderMathBuilder', () => {
    it('should render arithmetic mode by default', () => {
      const ctx = makeCtx();
      const html = renderMathBuilder(ctx);
      expect(html).toContain('Arithmetic');
      expect(html).toContain('data-cp="mathOp"');
    });

    it('should render Rolling Avg mode', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'math', mathOp: 'ROLLAVG', math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'a' }] }, enabled: true } as CalcStage,
      });
      const html = renderMathBuilder(ctx);
      expect(html).toContain('Rolling Avg');
      expect(html).toContain('Window');
    });

    it('should render % of Total mode', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'math', mathOp: 'PCTTOTAL', math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'a' }] }, enabled: true } as CalcStage,
      });
      const html = renderMathBuilder(ctx);
      expect(html).toContain('% of Total');
    });

    it('should render operator dropdown for arithmetic', () => {
      const ctx = makeCtx();
      const html = renderMathBuilder(ctx);
      expect(html).toContain('data-cp="mathOperator"');
      expect(html).toContain('data-cp="rightCol"');
    });
  });

  describe('renderTextBuilder', () => {
    it('should render combine mode by default', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'text', text: { operation: 'combine', parts: [{ type: 'column', value: 'a' }] }, enabled: true } as CalcStage,
      });
      const html = renderTextBuilder(ctx);
      expect(html).toContain('Combine parts');
    });

    it('should render left/right extraction mode', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'text', text: { operation: 'left', source: { type: 'column', value: 'a' }, count: 3 }, enabled: true } as CalcStage,
      });
      const html = renderTextBuilder(ctx);
      expect(html).toContain('data-cp="textSource"');
      expect(html).toContain('Count');
    });

    it('should render substring mode', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'text', text: { operation: 'substring', source: { type: 'column', value: 'a' }, start: 2, length: 5 }, enabled: true } as CalcStage,
      });
      const html = renderTextBuilder(ctx);
      expect(html).toContain('data-cp="textStart"');
      expect(html).toContain('data-cp="textLength"');
    });
  });

  describe('renderCompareBuilder', () => {
    it('should render AND mode by default', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'compare', compare: { compareMode: 'AND', conditions: [{ col: 'a', op: '=', val: '1' }], trueValue: { type: 'number', value: '1' }, falseValue: { type: 'number', value: '0' } }, enabled: true } as CalcStage,
      });
      const html = renderCompareBuilder(ctx);
      expect(html).toContain('ALL');
      expect(html).toContain('Where');
    });

    it('should render OR mode', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'compare', compare: { compareMode: 'OR', conditions: [{ col: 'a', op: '=', val: '1' }], trueValue: { type: 'number', value: '1' }, falseValue: { type: 'number', value: '0' } }, enabled: true } as CalcStage,
      });
      const html = renderCompareBuilder(ctx);
      expect(html).toContain('ANY');
    });

    it('should render multiple conditions', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'compare', compare: { compareMode: 'AND', conditions: [{ col: 'a', op: '=', val: '1' }, { col: 'b', op: '>', val: '0' }], trueValue: { type: 'number', value: '1' }, falseValue: { type: 'number', value: '0' } }, enabled: true } as CalcStage,
      });
      const html = renderCompareBuilder(ctx);
      expect(html).toContain('Where');
      expect(html).toContain('AND');
    });

    it('should show return values', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'compare', compare: { compareMode: 'AND', conditions: [{ col: 'a', op: '=', val: '1' }], trueValue: { type: 'number', value: '1' }, falseValue: { type: 'text', value: 'no' } }, enabled: true } as CalcStage,
      });
      const html = renderCompareBuilder(ctx);
      expect(html).toContain('Returns:');
    });
  });

  describe('renderDateBuilder', () => {
    it('should render date extraction UI', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'date', date: { operation: 'extract', source: { type: 'column', value: 'a' }, part: 'year' }, enabled: true } as CalcStage,
      });
      const html = renderDateBuilder(ctx);
      expect(html).toContain('data-cp="dateSource"');
      expect(html).toContain('data-cp="datePart"');
    });

    it('should select the correct date part', () => {
      const ctx = makeCtx({
        calc: { alias: '', mode: 'date', date: { operation: 'extract', source: { type: 'column', value: 'a' }, part: 'month' }, enabled: true } as CalcStage,
      });
      const html = renderDateBuilder(ctx);
      expect(html).toContain('month');
    });
  });

  describe('calcModeRenderers', () => {
    it('should have all four mode renderers', () => {
      expect(Object.keys(calcModeRenderers)).toEqual(['math', 'text', 'compare', 'date']);
    });

    it('should return HTML for each mode', () => {
      const ctx = makeCtx();
      for (const [, renderer] of Object.entries(calcModeRenderers)) {
        const html = renderer(ctx);
        expect(html).toBeTruthy();
        expect(typeof html).toBe('string');
      }
    });
  });
});
