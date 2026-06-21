/**
 * Tests for the StacksModal component — modal dialog for stack/UNION ALL configuration.
 *
 * Covers: rendering open/closed, no-base-table guard, empty stacks state,
 * stack chips, include button/menu, remove stack, alias TextFields,
 * source column toggle/name, Done button, _afterCombineChange calls.
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

vi.mock('../../core/utils', () => ({
  getTableColor: vi.fn(() => '#ccc'),
}));

import { StacksModal } from '../../ui/stacks-modal';
import type { DbTable } from '../../types';

function makeTable(id: string, name: string, cols: string[] = ['A', 'B']): DbTable {
  return { id, name, cols, rowCount: 10 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StacksModal', () => {
  describe('rendering', () => {
    it('renders when open=true', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Stacks')).toBeTruthy();
    });

    it('does not render when open=false', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={false} onClose={vi.fn()} />);
      expect(screen.queryByText('Stacks')).toBeNull();
    });

    it('renders the "Done" button', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Done')).toBeTruthy();
    });

    it('calls onClose when Done is clicked', () => {
      const onClose = vi.fn();
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Done'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('no base table guard', () => {
    it('shows "Pick a primary sheet first" when no base table', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: '',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText(/Pick a primary sheet first/)).toBeTruthy();
    });

    it('shows "Pick a primary sheet first" when base table does not exist', () => {
      initStore({
        tables: {},
        base: 'nonexistent',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText(/Pick a primary sheet first/)).toBeTruthy();
    });
  });

  describe('empty stacks state', () => {
    it('shows "No sheets stacked" message when stacks is empty', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText(/No sheets stacked/)).toBeTruthy();
    });
  });

  describe('stack chips', () => {
    it('renders chips for stacked tables', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
          t3: makeTable('t3', 'Products'),
        },
        base: 't1',
        stacks: ['t2', 't3'],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      expect(screen.getByText('Customers')).toBeTruthy();
      expect(screen.getByText('Products')).toBeTruthy();
    });

    it('does not show "No sheets stacked" when stacks exist', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: ['t2'],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);
      expect(screen.queryByText(/No sheets stacked/)).toBeNull();
    });
  });

  describe('include button and menu', () => {
    it('shows Include button when tables are available', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);
      // The Include button contains the ➕ Unicode character
      const includeBtn = screen.getByText(/\u2795 Include/);
      expect(includeBtn).toBeTruthy();
    });

    it('opens menu when Include button is clicked', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      act(() => {
        fireEvent.click(screen.getByText(/\u2795 Include/));
      });

      // Menu should show the available table name
      expect(screen.getByText('Customers')).toBeTruthy();
    });

    it('adds a stack when menu item is clicked', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      act(() => {
        fireEvent.click(screen.getByText(/\u2795 Include/));
      });

      act(() => {
        fireEvent.click(screen.getByText('Customers'));
      });

      expect(getStore().getState().stacks).toContain('t2');
    });

    it('calls _afterCombineChange when a stack is added', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      act(() => {
        fireEvent.click(screen.getByText(/\u2795 Include/));
      });

      mockAfterCombineChange.mockClear();

      act(() => {
        fireEvent.click(screen.getByText('Customers'));
      });

      expect(mockAfterCombineChange).toHaveBeenCalled();
    });
  });

  describe('remove stack', () => {
    it('removes a stack when chip delete is clicked', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: ['t2'],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      // The delete icon is the × character on the chip
      const deleteIcons = screen.getAllByText('\u00d7');
      expect(deleteIcons.length).toBeGreaterThanOrEqual(1);

      act(() => {
        fireEvent.click(deleteIcons[0]);
      });

      expect(getStore().getState().stacks).not.toContain('t2');
    });

    it('calls _afterCombineChange when a stack is removed', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: ['t2'],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      mockAfterCombineChange.mockClear();
      const deleteIcons = screen.getAllByText('\u00d7');

      act(() => {
        fireEvent.click(deleteIcons[0]);
      });

      expect(mockAfterCombineChange).toHaveBeenCalled();
    });
  });

  describe('source column', () => {
    it('shows "Include source sheet name column" checkbox', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Include source sheet name column')).toBeTruthy();
    });

    it('toggling includeSourceColumn updates the store', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
        includeSourceColumn: false,
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      const label = screen.getByText('Include source sheet name column');
      const checkbox = label.closest('label')!.querySelector('input')!;

      act(() => {
        fireEvent.click(checkbox);
      });

      expect(getStore().getState().includeSourceColumn).toBe(true);
    });

    it('shows source column name TextField when includeSourceColumn is true', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
        includeSourceColumn: true,
        sourceColumnName: 'Source Sheet',
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      // "Source column name" appears as both label and legend
      const elements = screen.getAllByText('Source column name');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    it('does not show source column name TextField when includeSourceColumn is false', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
        includeSourceColumn: false,
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      expect(screen.queryByText('Source column name')).toBeNull();
    });

    it('changing source column name updates the store', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
        stacks: [],
        includeSourceColumn: true,
        sourceColumnName: 'Source Sheet',
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText('Source') as HTMLInputElement;
      expect(input).toBeTruthy();

      act(() => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )!.set!;
        nativeInputValueSetter.call(input, 'New Source');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });

      expect(getStore().getState().sourceColumnName).toBe('New Source');
    });
  });

  describe('alias TextFields', () => {
    it('shows alias TextFields per chip when includeSourceColumn is true', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: ['t2'],
        includeSourceColumn: true,
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      const aliasField = screen.getByPlaceholderText('Customers') as HTMLInputElement;
      expect(aliasField).toBeTruthy();
    });

    it('does not show alias TextFields when includeSourceColumn is false', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: ['t2'],
        includeSourceColumn: false,
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      expect(screen.queryByPlaceholderText('Customers')).toBeNull();
    });

    it('changing alias TextField updates stackAliases in store', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        base: 't1',
        stacks: ['t2'],
        includeSourceColumn: true,
      });
      render(<StacksModal open={true} onClose={vi.fn()} />);

      const aliasField = screen.getByPlaceholderText('Customers') as HTMLInputElement;

      act(() => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )!.set!;
        nativeInputValueSetter.call(aliasField, 'Cust Alias');
        aliasField.dispatchEvent(new Event('input', { bubbles: true }));
      });

      expect(getStore().getState().stackAliases?.t2).toBe('Cust Alias');
    });
  });
});
