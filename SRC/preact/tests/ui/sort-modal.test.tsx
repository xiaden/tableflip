/**
 * Tests for the SortModal component — a thin modal shell wrapping SortList.
 *
 * Covers: rendering with correct title when open, hiding when closed,
 * add sort button, done button calling onClose.
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
  projectedCols: vi.fn(() => []),
}));

vi.mock('../../catalog/source-catalog', () => ({
  buildSourceCatalog: vi.fn(() => []),
}));

vi.mock('../../core/utils', () => ({
  colLabel: vi.fn((_tid: string, col: string) => col),
}));

import { SortModal } from '../../ui/sort-modal';
import type { DbTable } from '../../types';

function makeTable(id: string, name: string, cols: string[] = ['A', 'B']): DbTable {
  return { id, name, cols, rowCount: 10 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  initStore({
    tables: { t1: makeTable('t1', 'Orders', ['Amount', 'Region']) },
    base: 't1',
    colOrder: ['Amount', 'Region'],
    selCols: new Set(['Amount', 'Region']),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SortModal', () => {
  describe('rendering', () => {
    it('renders with "Sorting" title when open=true', () => {
      render(<SortModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Sorting')).toBeTruthy();
    });

    it('does not render when open=false', () => {
      render(<SortModal open={false} onClose={vi.fn()} />);
      expect(screen.queryByText('Sorting')).toBeNull();
    });

    it('renders the "+ Add sort" button', () => {
      render(<SortModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('+ Add sort')).toBeTruthy();
    });

    it('renders the "Done" button', () => {
      render(<SortModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Done')).toBeTruthy();
    });
  });

  describe('close behavior', () => {
    it('calls onClose when Done button is clicked', () => {
      const onClose = vi.fn();
      render(<SortModal open={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Done'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('add sort', () => {
    it('adds a sort to the store when "+ Add sort" is clicked', () => {
      render(<SortModal open={true} onClose={vi.fn()} />);

      const before = getStore().getState().sorts.length;
      act(() => {
        fireEvent.click(screen.getByText('+ Add sort'));
      });
      const after = getStore().getState().sorts.length;
      expect(after).toBe(before + 1);
    });
  });
});
