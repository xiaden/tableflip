/**
 * Tests for the FilterModal component — a thin modal shell wrapping FilterList.
 *
 * Covers: rendering with correct title when open, hiding when closed,
 * add filter button, done button calling onClose.
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

import { FilterModal } from '../../ui/filter-modal';
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

describe('FilterModal', () => {
  describe('rendering', () => {
    it('renders with "Filters" title when open=true', () => {
      render(<FilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Filters')).toBeTruthy();
    });

    it('does not render when open=false', () => {
      render(<FilterModal open={false} onClose={vi.fn()} />);
      expect(screen.queryByText('Filters')).toBeNull();
    });

    it('renders the "+ Add filter" button', () => {
      render(<FilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('+ Add filter')).toBeTruthy();
    });

    it('renders the "Done" button', () => {
      render(<FilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Done')).toBeTruthy();
    });
  });

  describe('close behavior', () => {
    it('calls onClose when Done button is clicked', () => {
      const onClose = vi.fn();
      render(<FilterModal open={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Done'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('add filter', () => {
    it('adds a filter to the store when "+ Add filter" is clicked', () => {
      render(<FilterModal open={true} onClose={vi.fn()} />);

      const before = getStore().getState().filters.length;
      act(() => {
        fireEvent.click(screen.getByText('+ Add filter'));
      });
      const after = getStore().getState().filters.length;
      expect(after).toBe(before + 1);
    });
  });
});
