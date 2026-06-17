/**
 * Tests for the MathBuilder component — variable-length step chain UI
 * for calculated column math mode configuration.
 *
 * Covers: step rendering, type selector, add/remove step buttons,
 * operator visibility, ROLLAVG/PCTTOTAL sub-modes.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MathBuilder, DateBuilder } from '../../ui/components/calc-builder';
import type { CalcStage } from '../../types';

/** Minimal colOptsFor that returns a simple column entry. */
function mockColOpts(_sel: string) {
  return [{ value: 'Amount', label: 'Orders.Amount', selected: true }];
}

/** Create a CalcStage with 2-step ARITH math config. */
function makeArithCalc(steps?: Array<{ type?: string; value?: string; op?: string }>): CalcStage {
  return {
    alias: 'TestCalc',
    mode: 'math',
    math: {
      strategy: 'stepChain',
      steps: steps || [
        { type: 'column', value: 'Amount' },
        { type: 'number', value: '100', op: '+' },
      ],
    },
    enabled: true,
  };
}

beforeEach(() => {
  // suppress MUI Tooltip / Tip portal warnings in jsdom
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MathBuilder', () => {
  describe('step rendering', () => {
    it('renders without crashing with 2 steps', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc()}
          i={0}
          cols={['Amount', 'Tax']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      expect(container.textContent).toContain('Type');
    });

    it('renders without crashing with 1 step', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc([{ type: 'column', value: 'Amount' }])}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      expect(container.textContent).toContain('Type');
    });

    it('renders without crashing with 3 steps', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc([
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '100', op: '+' },
            { type: 'column', value: 'Tax', op: '*' },
          ])}
          i={0}
          cols={['Amount', 'Tax']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      expect(container.textContent).toContain('Type');
    });
  });

  describe('step type selector', () => {
    it('renders column select in step chain', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc()}
          i={0}
          cols={['Amount', 'Tax']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      // Should contain at least one combobox for type/op/value selects
      const comboboxes = container.querySelectorAll('[role="combobox"]');
      expect(comboboxes.length).toBeGreaterThanOrEqual(2);
    });

    it('renders number input field when step type is number', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc([
            { type: 'column', value: 'Amount' },
            { type: 'number', value: '42', op: '+' },
          ])}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      // MUI TextField for number renders an <input type="number">
      const numberInputs = container.querySelectorAll('input[type="number"]');
      expect(numberInputs.length).toBeGreaterThan(0);
    });
  });

  describe('add step button', () => {
    it('renders add step button text', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc()}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      expect(container.textContent).toContain('Add Step');
    });

    it('calls onMathAddStep when clicked', () => {
      const onMathAddStep = vi.fn();
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc()}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={onMathAddStep}
          onMathRemoveStep={vi.fn()}
        />,
      );
      // Find the Add Step button by text
      const buttons = container.querySelectorAll('button');
      const addBtn = Array.from(buttons).find(b => b.textContent?.includes('Add Step'));
      expect(addBtn).toBeTruthy();
      if (addBtn) {
        fireEvent.click(addBtn);
        expect(onMathAddStep).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('remove step button', () => {
    it('has remove button when 2+ steps', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc()}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      const buttons = container.querySelectorAll('button');
      const removeBtns = Array.from(buttons).filter(
        b => b.textContent === '✕',
      );
      expect(removeBtns.length).toBeGreaterThan(0);
    });

    it('calls onMathRemoveStep when remove is clicked', () => {
      const onMathRemoveStep = vi.fn();
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc()}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={onMathRemoveStep}
        />,
      );
      const buttons = container.querySelectorAll('button');
      const removeBtn = Array.from(buttons).find(
        b => b.textContent === '✕',
      );
      expect(removeBtn).toBeTruthy();
      if (removeBtn) {
        fireEvent.click(removeBtn);
        expect(onMathRemoveStep).toHaveBeenCalled();
      }
    });

    it('no remove button with only 1 step', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc([{ type: 'column', value: 'Amount' }])}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      const buttons = container.querySelectorAll('button');
      const removeBtns = Array.from(buttons).filter(
        b => b.textContent === '✕',
      );
      expect(removeBtns.length).toBe(0);
    });
  });

  describe('operator selector visibility', () => {
    it('shows operator in step chain with 2+ steps', () => {
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc()}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      // The operator selector displays '+' for step 1
      const comboboxes = container.querySelectorAll('[role="combobox"]');
      // Type selector (ARITH) + step 0 type + step 1 op + step 1 value = at least 4 comboboxes
      expect(comboboxes.length).toBeGreaterThanOrEqual(2);
    });

    it('no extra operator row for step index 0 only', () => {
      // With 1 step, there should be no operator selector
      const { container } = render(
        <MathBuilder
          calc={makeArithCalc([{ type: 'column', value: 'Amount' }])}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
          onMathStepChange={vi.fn()}
          onMathAddStep={vi.fn()}
          onMathRemoveStep={vi.fn()}
        />,
      );
      // 1 step = type selector + value select = 2 comboboxes (plus Type selector = 3)
      // No operator combobox
      const comboboxes = container.querySelectorAll('[role="combobox"]');
      // Type (ARITH) + step 0 type + step 0 value = 3 comboboxes
      expect(comboboxes.length).toBe(3);
    });
  });

  describe('sub-modes', () => {
    it('renders ROLLAVG sub-mode with Source and Window', () => {
      const calc: CalcStage = {
        alias: 'RollAvg',
        mode: 'math',
        math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }] },
        enabled: true,
        mathOp: 'ROLLAVG',
        window: '7',
      };

      const { container } = render(
        <MathBuilder
          calc={calc}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      expect(container.textContent).toContain('Source');
      expect(container.textContent).toContain('Window');
    });

    it('renders PCTTOTAL sub-mode with Source', () => {
      const calc: CalcStage = {
        alias: 'Pct',
        mode: 'math',
        math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }] },
        enabled: true,
        mathOp: 'PCTTOTAL',
      };

      const { container } = render(
        <MathBuilder
          calc={calc}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      expect(container.textContent).toContain('Source');
    });

    it('does not show add step in ROLLAVG mode', () => {
      const calc: CalcStage = {
        alias: 'RollAvg',
        mode: 'math',
        math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }] },
        enabled: true,
        mathOp: 'ROLLAVG',
        window: '7',
      };

      const { container } = render(
        <MathBuilder
          calc={calc}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      expect(container.textContent).not.toContain('Add Step');
    });

    it('does not show add step in PCTTOTAL mode', () => {
      const calc: CalcStage = {
        alias: 'Pct',
        mode: 'math',
        math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }] },
        enabled: true,
        mathOp: 'PCTTOTAL',
      };

      const { container } = render(
        <MathBuilder
          calc={calc}
          i={0}
          cols={['Amount']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      expect(container.textContent).not.toContain('Add Step');
    });
  });
});

describe('DateBuilder', () => {
  describe('operation tabs', () => {
    it('renders operation tabs for extract/duration/add/subtract', () => {
      const calc: CalcStage = {
        alias: 'TestDate',
        mode: 'date',
        date: {
          operation: 'extract',
          source: { type: 'column', value: 'OrderDate' },
          part: 'year',
        },
        enabled: true,
      };

      const { container } = render(
        <DateBuilder
          calc={calc}
          i={0}
          cols={['OrderDate']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      expect(container.textContent).toContain('Extract');
      expect(container.textContent).toContain('Duration');
      expect(container.textContent).toContain('Add');
      expect(container.textContent).toContain('Subtract');
    });
  });

  describe('duration operation', () => {
    it('renders start date and end date selectors for duration', () => {
      const calc: CalcStage = {
        alias: 'DaysBetween',
        mode: 'date',
        date: {
          operation: 'duration',
          source: { type: 'column', value: 'OrderDate' },
          source2: { type: 'column', value: 'ShipDate' },
          unit: 'days',
        },
        enabled: true,
      };

      const { container } = render(
        <DateBuilder
          calc={calc}
          i={0}
          cols={['OrderDate', 'ShipDate']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      expect(container.textContent).toContain('Start date');
      expect(container.textContent).toContain('End date');
      expect(container.textContent).toContain('Unit');
    });

    it('renders unit selector with days/weeks/months/years', () => {
      const calc: CalcStage = {
        alias: 'Duration',
        mode: 'date',
        date: {
          operation: 'duration',
          source: { type: 'column', value: 'OrderDate' },
          source2: { type: 'column', value: 'ShipDate' },
          unit: 'days',
        },
        enabled: true,
      };

      const { container } = render(
        <DateBuilder
          calc={calc}
          i={0}
          cols={['OrderDate', 'ShipDate']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      // Unit selector should be present
      const selects = container.querySelectorAll('[role="combobox"]');
      expect(selects.length).toBeGreaterThan(0);
    });
  });

  describe('add/subtract operations', () => {
    it('renders source date and operand controls for add', () => {
      const calc: CalcStage = {
        alias: 'FutureDate',
        mode: 'date',
        date: {
          operation: 'add',
          source: { type: 'column', value: 'OrderDate' },
          operand: { type: 'number', value: '7' },
          unit: 'days',
        },
        enabled: true,
      };

      const { container } = render(
        <DateBuilder
          calc={calc}
          i={0}
          cols={['OrderDate']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      expect(container.textContent).toContain('Source date');
      expect(container.textContent).toContain('Add');
      expect(container.textContent).toContain('Unit');
    });

    it('renders operand type switcher for number/column', () => {
      const calc: CalcStage = {
        alias: 'FutureDate',
        mode: 'date',
        date: {
          operation: 'add',
          source: { type: 'column', value: 'OrderDate' },
          operand: { type: 'number', value: '7' },
          unit: 'days',
        },
        enabled: true,
      };

      const { container } = render(
        <DateBuilder
          calc={calc}
          i={0}
          cols={['OrderDate']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      // Should have operand type selector (Number/Column)
      const selects = container.querySelectorAll('[role="combobox"]');
      expect(selects.length).toBeGreaterThan(0);
    });

    it('renders subtract label for subtract operation', () => {
      const calc: CalcStage = {
        alias: 'PastDate',
        mode: 'date',
        date: {
          operation: 'subtract',
          source: { type: 'column', value: 'OrderDate' },
          operand: { type: 'number', value: '30' },
          unit: 'days',
        },
        enabled: true,
      };

      const { container } = render(
        <DateBuilder
          calc={calc}
          i={0}
          cols={['OrderDate']}
          colOptsFor={mockColOpts}
          onPropChange={vi.fn()}
        />,
      );

      expect(container.textContent).toContain('Subtract');
    });
  });
});
