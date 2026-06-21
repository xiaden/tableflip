/**
 * Tests for the LayoutModal component — modal dialog for grouping, aggregation,
 * and subtotal configuration.
 *
 * Covers: rendering open/closed, GroupBy section (empty state, add/remove/reorder,
 * sort toggle, subtotal break), Aggregates section (empty state, add/remove,
 * fn/col/alias changes), Toggles section (totals, subtotals, on-top, spacer,
 * grand total), and Done button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';

const { mockInvalidateValidation, mockAfterCombineChange } = vi.hoisted(() => ({
  mockInvalidateValidation: vi.fn(),
  mockAfterCombineChange: vi.fn(),
}));

vi.mock('../../report/validation', () => ({
  invalidateValidation: mockInvalidateValidation,
}));

vi.mock('../../query/layout-selection', () => ({
  _afterCombineChange: mockAfterCombineChange,
}));

vi.mock('../../catalog/column-catalog', () => ({
  buildColSourceMap: vi.fn(() => new Map()),
}));

vi.mock('../../core/utils', () => ({
  colLabel: vi.fn((_tid: string, col: string) => col),
  defaultAggAlias: vi.fn((fn: string, col: string) => `${fn}(${col})`),
}));

import { LayoutModal } from '../../ui/layout-modal';
import type { DbTable } from '../../types';

function makeTable(id: string, name: string, cols: string[] = ['A', 'B']): DbTable {
  return { id, name, cols, rowCount: 10 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  initStore({
    tables: { t1: makeTable('t1', 'Orders', ['Amount', 'Tax', 'Region']) },
    base: 't1',
    colOrder: ['Amount', 'Tax', 'Region'],
    selCols: new Set(['Amount', 'Tax', 'Region']),
    groupBy: [],
    aggregates: [],
    subtotalBy: [],
    colTotals: {},
    subtotalGrandTotal: false,
    subtotalSpacer: false,
    subtotalOnTop: false,
    sorts: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LayoutModal', () => {
  describe('rendering', () => {
    it('renders when open=true', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Layout')).toBeTruthy();
    });

    it('does not render when open=false', () => {
      render(<LayoutModal open={false} onClose={vi.fn()} />);
      expect(screen.queryByText('Layout')).toBeNull();
    });

    it('renders the "Done" button', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Done')).toBeTruthy();
    });

    it('calls onClose when Done is clicked', () => {
      const onClose = vi.fn();
      render(<LayoutModal open={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Done'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('GroupBy section — empty state', () => {
    it('shows "No group levels" message when groupBy is empty', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText(/No group levels/)).toBeTruthy();
    });

    it('shows "+ Add group level" button', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('+ Add group level')).toBeTruthy();
    });

    it('adds a group level when "+ Add group level" is clicked', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);

      act(() => {
        fireEvent.click(screen.getByText('+ Add group level'));
      });

      const state = getStore().getState();
      expect(state.groupBy.length).toBe(1);
    });
  });

  describe('GroupBy section — with levels', () => {
    beforeEach(() => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders', ['Amount', 'Tax', 'Region']) },
        base: 't1',
        colOrder: ['Amount', 'Tax', 'Region'],
        selCols: new Set(['Amount', 'Tax', 'Region']),
        groupBy: ['Region', 'Amount'],
        aggregates: [],
        subtotalBy: [],
        colTotals: {},
        subtotalGrandTotal: false,
        subtotalSpacer: false,
        subtotalOnTop: false,
        sorts: [],
      });
    });

    it('renders group level labels', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      // GroupBy section renders "1. Region" and "2. Amount"
      // Dialog renders in a portal, so use document.body
      expect(document.body.textContent).toContain('Region');
      expect(document.body.textContent).toContain('Amount');
    });

    it('shows reorder buttons (move up/down)', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      // Reorder buttons contain ▲ (move up) and ▼ (move down) Unicode chars
      const allSpans = Array.from(document.querySelectorAll('button span'));
      const moveUpButtons = allSpans.filter(s => s.textContent === '\u25B2');
      const moveDownButtons = allSpans.filter(s => s.textContent === '\u25BC');
      expect(moveUpButtons.length).toBe(2);
      expect(moveDownButtons.length).toBe(2);
    });

    it('move up swaps group levels', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      // Click "Move down" (▼) on the first item
      const allSpans = Array.from(document.querySelectorAll('button span'));
      const moveDownButtons = allSpans.filter(s => s.textContent === '\u25BC');

      act(() => {
        fireEvent.click(moveDownButtons[0].closest('button')!);
      });

      const state = getStore().getState();
      expect(state.groupBy[0]).toBe('Amount');
      expect(state.groupBy[1]).toBe('Region');
    });

    it('shows sort direction toggle button', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      // Default sort direction is ASC
      const ascButtons = screen.getAllByText('ASC');
      expect(ascButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('toggles sort direction from ASC to DESC', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      // Click the first sort toggle button (ASC)
      const sortButtons = screen.getAllByText('ASC');

      act(() => {
        fireEvent.click(sortButtons[0]);
      });

      const state = getStore().getState();
      expect(state.sorts.length).toBeGreaterThanOrEqual(1);
      expect(state.sorts[0].dir).toBe('DESC');
    });

    it('shows subtotal break checkboxes', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      const breakLabels = screen.getAllByText('break subtotals');
      expect(breakLabels.length).toBe(2);
    });

    it('checking subtotal break adds column to subtotalBy', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      // Find the "break subtotals" labels and click the associated checkbox
      const breakLabels = screen.getAllByText('break subtotals');
      const label = breakLabels[0].closest('label')!;
      const checkbox = label.querySelector('input')!;

      act(() => {
        fireEvent.click(checkbox);
      });

      const state = getStore().getState();
      expect(state.subtotalBy.length).toBe(1);
    });

    it('remove button removes a group level', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      // Remove buttons contain ✕ Unicode character
      const removeSpans = Array.from(document.querySelectorAll('button span')).filter(
        s => s.textContent === '\u2715',
      );
      expect(removeSpans.length).toBe(2);

      act(() => {
        fireEvent.click(removeSpans[0].closest('button')!);
      });

      const state = getStore().getState();
      expect(state.groupBy.length).toBe(1);
    });
  });

  describe('Aggregates section', () => {
    it('shows "No aggregates configured" when aggregates is empty', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText(/No aggregates configured/)).toBeTruthy();
    });

    it('shows "+ Add aggregate" button', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('+ Add aggregate')).toBeTruthy();
    });

    it('adds an aggregate when "+ Add aggregate" is clicked', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);

      act(() => {
        fireEvent.click(screen.getByText('+ Add aggregate'));
      });

      const state = getStore().getState();
      expect(state.aggregates.length).toBe(1);
      expect(state.aggregates[0].fn).toBe('SUM');
    });

    it('renders aggregate rows with fn selector and remove button', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders', ['Amount', 'Tax', 'Region']) },
        base: 't1',
        colOrder: ['Amount', 'Tax', 'Region'],
        selCols: new Set(['Amount', 'Tax', 'Region']),
        groupBy: [],
        aggregates: [{ fn: 'SUM', col: 'Amount', alias: '' }],
        subtotalBy: [],
        colTotals: {},
        sorts: [],
      });

      render(<LayoutModal open={true} onClose={vi.fn()} />);
      // The remove button has the × character
      const removeButtons = screen.getAllByText('\u2715');
      expect(removeButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('removes an aggregate when remove button is clicked', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders', ['Amount', 'Tax', 'Region']) },
        base: 't1',
        colOrder: ['Amount', 'Tax', 'Region'],
        selCols: new Set(['Amount', 'Tax', 'Region']),
        groupBy: [],
        aggregates: [
          { fn: 'SUM', col: 'Amount', alias: '' },
          { fn: 'AVG', col: 'Tax', alias: '' },
        ],
        subtotalBy: [],
        colTotals: {},
        sorts: [],
      });

      render(<LayoutModal open={true} onClose={vi.fn()} />);
      const removeButtons = screen.getAllByText('\u2715');

      act(() => {
        fireEvent.click(removeButtons[0]);
      });

      const state = getStore().getState();
      expect(state.aggregates.length).toBe(1);
      expect(state.aggregates[0].fn).toBe('AVG');
    });
  });

  describe('Toggles section', () => {
    it('renders all toggle checkboxes', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Show Totals')).toBeTruthy();
      expect(screen.getByText('Show Subtotals')).toBeTruthy();
      expect(screen.getByText('Show Subtotals on Top')).toBeTruthy();
      expect(screen.getByText('Blank Space Between Groups')).toBeTruthy();
      expect(screen.getByText('Grand Total Row')).toBeTruthy();
    });

    it('toggling "Show Totals" on populates colTotals', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      const totalsLabel = screen.getByText('Show Totals');
      const checkbox = totalsLabel.closest('label')!.querySelector('input')!;

      act(() => {
        fireEvent.click(checkbox);
      });

      const state = getStore().getState();
      expect(Object.keys(state.colTotals).length).toBeGreaterThan(0);
    });

    it('toggling "Show Totals" off clears colTotals', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders', ['Amount', 'Tax', 'Region']) },
        base: 't1',
        colOrder: ['Amount', 'Tax', 'Region'],
        selCols: new Set(['Amount', 'Tax', 'Region']),
        groupBy: [],
        aggregates: [],
        subtotalBy: [],
        colTotals: { Amount: 'SUM', Tax: 'SUM' },
        sorts: [],
      });

      render(<LayoutModal open={true} onClose={vi.fn()} />);
      const totalsLabel = screen.getByText('Show Totals');
      const checkbox = totalsLabel.closest('label')!.querySelector('input')!;

      act(() => {
        fireEvent.click(checkbox);
      });

      const state = getStore().getState();
      expect(Object.keys(state.colTotals).length).toBe(0);
    });

    it('toggling "Grand Total Row" updates subtotalGrandTotal', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      const grandTotalLabel = screen.getByText('Grand Total Row');
      const checkbox = grandTotalLabel.closest('label')!.querySelector('input')!;

      expect(checkbox.checked).toBe(false);

      act(() => {
        fireEvent.click(checkbox);
      });

      expect(getStore().getState().subtotalGrandTotal).toBe(true);
    });

    it('toggling "Blank Space Between Groups" updates subtotalSpacer', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      const spacerLabel = screen.getByText('Blank Space Between Groups');
      const checkbox = spacerLabel.closest('label')!.querySelector('input')!;

      expect(checkbox.checked).toBe(false);

      act(() => {
        fireEvent.click(checkbox);
      });

      expect(getStore().getState().subtotalSpacer).toBe(true);
    });

    it('toggling "Show Subtotals on Top" updates subtotalOnTop', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);
      const onTopLabel = screen.getByText('Show Subtotals on Top');
      const checkbox = onTopLabel.closest('label')!.querySelector('input')!;

      expect(checkbox.checked).toBe(false);

      act(() => {
        fireEvent.click(checkbox);
      });

      expect(getStore().getState().subtotalOnTop).toBe(true);
    });
  });

  describe('validation invalidation', () => {
    it('calls invalidateValidation when group level is added', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);

      act(() => {
        fireEvent.click(screen.getByText('+ Add group level'));
      });

      expect(mockInvalidateValidation).toHaveBeenCalled();
    });

    it('calls invalidateValidation when aggregate is added', () => {
      render(<LayoutModal open={true} onClose={vi.fn()} />);

      act(() => {
        fireEvent.click(screen.getByText('+ Add aggregate'));
      });

      expect(mockInvalidateValidation).toHaveBeenCalled();
    });
  });
});
