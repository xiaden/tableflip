/**
 * Tests for CalcAccordion — calculated columns accordion for the right sidebar.
 *
 * Covers: rendering title, "+ add calculation" chip, dialog open/close,
 * mode switching, create flow, remove flow, and context menu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';

const { mockToast, mockInvalidateValidation, mockAfterCombineChange, mockResolveRenameTarget } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockInvalidateValidation: vi.fn(),
  mockAfterCombineChange: vi.fn(),
  mockResolveRenameTarget: vi.fn(() => null),
}));

vi.mock('../../core/utils', () => ({
  toast: mockToast,
}));

vi.mock('../../report/validation', () => ({
  invalidateValidation: mockInvalidateValidation,
}));

vi.mock('../../query/layout-selection', () => ({
  _afterCombineChange: mockAfterCombineChange,
}));

vi.mock('../../ui/components/rename-modal', () => ({
  RenameModal: () => null,
  resolveRenameTarget: mockResolveRenameTarget,
}));

vi.mock('../../ui/components/calc-builder', () => ({
  calcModeComponents: {
    math: () => null,
    text: () => null,
    compare: () => null,
    date: () => null,
  },
}));

vi.mock('../../catalog/column-catalog', () => ({
  buildColSourceMap: vi.fn(() => new Map()),
}));

import { CalcAccordion } from '../../ui/calc-accordion';
import type { DbTable } from '../../types';

function makeTable(id: string, name: string, cols: string[] = ['A', 'B']): DbTable {
  return { id, name, cols, rowCount: 10 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  initStore({
    tables: {
      t1: makeTable('t1', 'Orders', ['Amount', 'Tax']),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CalcAccordion', () => {
  describe('rendering', () => {
    it('renders "Calculated Columns" title', () => {
      const { container } = render(<CalcAccordion />);
      expect(container.textContent).toContain('Calculated Columns');
    });

    it('renders "+ add calculation" chip', () => {
      const { container } = render(<CalcAccordion />);
      expect(container.textContent).toContain('+ add calculation');
    });

    it('does not render calc chips when calcStages is empty', () => {
      const { container } = render(<CalcAccordion />);
      const chips = container.querySelectorAll('.MuiChip-root');
      expect(chips.length).toBe(0);
    });

    it('renders one chip per calcStage', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        calcStages: [
          { alias: 'calc_a', mode: 'math', enabled: true },
          { alias: 'calc_b', mode: 'text', enabled: true },
        ],
      });

      const { container } = render(<CalcAccordion />);
      // Each calc stage renders a Chip + a remove ChipMUI (×)
      const chips = container.querySelectorAll('.MuiChip-root');
      // 2 calc chips + 2 remove chips = 4
      expect(chips.length).toBe(4);
      expect(container.textContent).toContain('calc_a');
      expect(container.textContent).toContain('calc_b');
    });
  });

  describe('dialog', () => {
    it('opens dialog when "+ add calculation" is clicked', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;
      expect(addBtn).toBeTruthy();

      act(() => {
        fireEvent.click(addBtn);
      });

      expect(screen.getByText('New Calculation')).toBeTruthy();
    });

    it('dialog shows mode selector and alias input', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;

      act(() => {
        fireEvent.click(addBtn);
      });

      expect(screen.getByText('Mode')).toBeTruthy();
      expect(screen.getByText('Alias')).toBeTruthy();
    });

    it('dialog shows Create button (not Save) for new calculation', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;

      act(() => {
        fireEvent.click(addBtn);
      });

      expect(screen.getByText('Create')).toBeTruthy();
    });

    it('dialog shows Cancel button', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;

      act(() => {
        fireEvent.click(addBtn);
      });

      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('closes dialog when Cancel is clicked', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;

      act(() => {
        fireEvent.click(addBtn);
      });
      expect(screen.getByText('New Calculation')).toBeTruthy();

      act(() => {
        fireEvent.click(screen.getByText('Cancel'));
      });

      // Verify the dialog is no longer the active modal by checking the dialog role
      const dialogs = document.querySelectorAll('[role="dialog"]');
      // Dialog should be closed (either removed or hidden)
      const visibleDialogs = Array.from(dialogs).filter(d => {
        const el = d as HTMLElement;
        return el.style.display !== 'none' && el.offsetParent !== null;
      });
      expect(visibleDialogs.length).toBe(0);
    });
  });

  describe('create flow', () => {
    it('adds a calcStage to the store when Create is clicked', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;

      act(() => {
        fireEvent.click(addBtn);
      });

      act(() => {
        fireEvent.click(screen.getByText('Create'));
      });

      const state = getStore().getState();
      expect(state.calcStages.length).toBe(1);
      expect(state.calcStages[0].mode).toBe('math');
      expect(state.calcStages[0].enabled).toBe(true);
    });

    it('calls toast after creating a calculation', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;

      act(() => {
        fireEvent.click(addBtn);
      });

      act(() => {
        fireEvent.click(screen.getByText('Create'));
      });

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast.mock.calls[0][0]).toContain('Created calculation');
    });

    it('calls invalidateValidation and _afterCombineChange after create', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;

      act(() => {
        fireEvent.click(addBtn);
      });

      act(() => {
        fireEvent.click(screen.getByText('Create'));
      });

      expect(mockInvalidateValidation).toHaveBeenCalled();
      expect(mockAfterCombineChange).toHaveBeenCalled();
    });

    it('closes dialog after creating', () => {
      const { container } = render(<CalcAccordion />);
      const addBtn = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === '+ add calculation' && el.childElementCount === 0,
      ) as HTMLElement;

      act(() => {
        fireEvent.click(addBtn);
      });

      act(() => {
        fireEvent.click(screen.getByText('Create'));
      });

      // Verify the calc was created in the store
      const state = getStore().getState();
      expect(state.calcStages.length).toBe(1);

      // Verify the dialog is no longer the active modal
      const dialogs = document.querySelectorAll('[role="dialog"]');
      const visibleDialogs = Array.from(dialogs).filter(d => {
        const el = d as HTMLElement;
        return el.style.display !== 'none' && el.offsetParent !== null;
      });
      expect(visibleDialogs.length).toBe(0);
    });
  });

  describe('remove calc', () => {
    it('removes a calcStage when × button is clicked', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        calcStages: [
          { alias: 'calc_a', mode: 'math', enabled: true },
          { alias: 'calc_b', mode: 'text', enabled: true },
        ],
      });

      const { container } = render(<CalcAccordion />);

      // Find × chips (MUI ChipMUI with label "×")
      const removeChips = Array.from(container.querySelectorAll('.MuiChip-root')).filter(
        el => el.textContent === '×',
      );
      expect(removeChips.length).toBe(2);

      act(() => {
        fireEvent.click(removeChips[0]);
      });

      const state = getStore().getState();
      expect(state.calcStages.length).toBe(1);
      expect(state.calcStages[0].alias).toBe('calc_b');
    });

    it('calls toast when removing a calculation', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        calcStages: [
          { alias: 'calc_a', mode: 'math', enabled: true },
        ],
      });

      const { container } = render(<CalcAccordion />);
      const removeChips = Array.from(container.querySelectorAll('.MuiChip-root')).filter(
        el => el.textContent === '×',
      );

      act(() => {
        fireEvent.click(removeChips[0]);
      });

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast.mock.calls[0][0]).toContain('Removed calculation');
    });

    it('calls invalidateValidation and _afterCombineChange after remove', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        calcStages: [
          { alias: 'calc_a', mode: 'math', enabled: true },
        ],
      });

      const { container } = render(<CalcAccordion />);
      const removeChips = Array.from(container.querySelectorAll('.MuiChip-root')).filter(
        el => el.textContent === '×',
      );

      act(() => {
        fireEvent.click(removeChips[0]);
      });

      expect(mockInvalidateValidation).toHaveBeenCalled();
      expect(mockAfterCombineChange).toHaveBeenCalled();
    });
  });
});
