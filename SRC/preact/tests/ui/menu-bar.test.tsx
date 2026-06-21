/**
 * Tests for the MenuBar component — horizontal menu bar with File, Format, Config menus.
 *
 * Covers: rendering menu buttons, opening menus, menu items, export submenu
 * (only when result exists), opening modals from menu items.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';

const {
  mockTriggerFileInput,
  mockSaveState,
  mockExportAs,
  mockInvalidateValidation,
  mockAfterCombineChange,
} = vi.hoisted(() => ({
  mockTriggerFileInput: vi.fn(),
  mockSaveState: vi.fn(),
  mockExportAs: vi.fn(),
  mockInvalidateValidation: vi.fn(),
  mockAfterCombineChange: vi.fn(),
}));

vi.mock('../../ui/file-loader', () => ({
  triggerFileInput: mockTriggerFileInput,
}));

vi.mock('../../ui/loader', () => ({
  loadSpreadsheet: vi.fn(),
}));

vi.mock('../../core/state-serializer', () => ({
  saveState: mockSaveState,
}));

vi.mock('../../ui/export', () => ({
  exportAs: mockExportAs,
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
  defaultAggAlias: vi.fn((fn: string, col: string) => `${fn}(${col})`),
  getTableColor: vi.fn(() => '#ccc'),
}));

import { MenuBar } from '../../ui/menu-bar';
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
    groupBy: [],
    aggregates: [],
    subtotalBy: [],
    colTotals: {},
    sorts: [],
    stacks: [],
    result: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MenuBar', () => {
  describe('rendering', () => {
    it('renders File, Format, Config buttons', () => {
      render(<MenuBar />);
      expect(screen.getByText('File')).toBeTruthy();
      expect(screen.getByText('Format')).toBeTruthy();
      expect(screen.getByText('Config')).toBeTruthy();
    });
  });

  describe('File menu', () => {
    it('opens File menu when File button is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('File'));
      });

      expect(screen.getByText('Import file')).toBeTruthy();
      expect(screen.getByText('Import config')).toBeTruthy();
      expect(screen.getByText('Export config')).toBeTruthy();
      expect(screen.getByText('Export report')).toBeTruthy();
    });

    it('calls triggerFileInput when "Import file" is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('File'));
      });

      act(() => {
        fireEvent.click(screen.getByText('Import file'));
      });

      expect(mockTriggerFileInput).toHaveBeenCalledTimes(1);
    });

    it('calls saveState when "Export config" is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('File'));
      });

      act(() => {
        fireEvent.click(screen.getByText('Export config'));
      });

      expect(mockSaveState).toHaveBeenCalledTimes(1);
    });

    it('"Export report" is disabled when no result exists', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('File'));
      });

      const exportReportItem = screen.getByText('Export report').closest('li');
      expect(exportReportItem).toBeTruthy();
      // MUI disabled MenuItem gets aria-disabled
      expect(exportReportItem!.getAttribute('aria-disabled')).toBe('true');
    });

    it('"Export report" is enabled when result exists', () => {
      getStore().update(draft => {
        draft.result = { rows: [], cols: [] };
      });

      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('File'));
      });

      const exportReportItem = screen.getByText('Export report').closest('li');
      expect(exportReportItem).toBeTruthy();
      expect(exportReportItem!.getAttribute('aria-disabled')).toBeNull();
    });

    it('shows export submenu (Excel, CSV) when "Export report" is clicked and result exists', () => {
      getStore().update(draft => {
        draft.result = { rows: [], cols: [] };
      });

      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('File'));
      });

      act(() => {
        fireEvent.click(screen.getByText('Export report'));
      });

      expect(screen.getByText('Excel')).toBeTruthy();
      expect(screen.getByText('CSV')).toBeTruthy();
    });

    it('calls exportAs("xlsx") when "Excel" is clicked', () => {
      getStore().update(draft => {
        draft.result = { rows: [], cols: [] };
      });

      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('File'));
      });

      act(() => {
        fireEvent.click(screen.getByText('Export report'));
      });

      act(() => {
        fireEvent.click(screen.getByText('Excel'));
      });

      expect(mockExportAs).toHaveBeenCalledWith('xlsx');
    });

    it('calls exportAs("csv") when "CSV" is clicked', () => {
      getStore().update(draft => {
        draft.result = { rows: [], cols: [] };
      });

      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('File'));
      });

      act(() => {
        fireEvent.click(screen.getByText('Export report'));
      });

      act(() => {
        fireEvent.click(screen.getByText('CSV'));
      });

      expect(mockExportAs).toHaveBeenCalledWith('csv');
    });
  });

  describe('Format menu', () => {
    it('opens Format menu when Format button is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('Format'));
      });

      expect(screen.getByText('Layout')).toBeTruthy();
      expect(screen.getByText('Stacks')).toBeTruthy();
    });

    it('opens Layout modal when "Layout" is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('Format'));
      });

      act(() => {
        // Click the "Layout" menu item (it's inside a li[role="menuitem"])
        const layoutItems = screen.getAllByText('Layout');
        const menuItem = layoutItems.find(el => el.closest('[role="menuitem"]'));
        fireEvent.click(menuItem!);
      });

      // Layout modal should be open — check for dialog with "Layout" title
      const dialogs = document.querySelectorAll('[role="dialog"]');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
    });

    it('opens Stacks modal when "Stacks" is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('Format'));
      });

      act(() => {
        const stacksItems = screen.getAllByText('Stacks');
        const menuItem = stacksItems.find(el => el.closest('[role="menuitem"]'));
        fireEvent.click(menuItem!);
      });

      // Stacks modal should be open
      const dialogs = document.querySelectorAll('[role="dialog"]');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Config menu', () => {
    it('opens Config menu when Config button is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('Config'));
      });

      expect(screen.getByText('Sorting')).toBeTruthy();
      expect(screen.getByText('Filtering')).toBeTruthy();
    });

    it('opens Sort modal when "Sorting" is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('Config'));
      });

      act(() => {
        const sortingItems = screen.getAllByText('Sorting');
        const menuItem = sortingItems.find(el => el.closest('[role="menuitem"]'));
        fireEvent.click(menuItem!);
      });

      // Sort modal should be open — check for dialog
      const dialogs = document.querySelectorAll('[role="dialog"]');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
      // The dialog should contain "Sorting" title
      const dialogTexts = Array.from(dialogs).map(d => d.textContent);
      expect(dialogTexts.some(t => t!.includes('Sorting'))).toBe(true);
    });

    it('opens Filter modal when "Filtering" is clicked', () => {
      render(<MenuBar />);

      act(() => {
        fireEvent.click(screen.getByText('Config'));
      });

      act(() => {
        const filteringItems = screen.getAllByText('Filtering');
        const menuItem = filteringItems.find(el => el.closest('[role="menuitem"]'));
        fireEvent.click(menuItem!);
      });

      // Filter modal should be open — check for dialog with "Filters" title
      const dialogs = document.querySelectorAll('[role="dialog"]');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
      const dialogTexts = Array.from(dialogs).map(d => d.textContent);
      expect(dialogTexts.some(t => t!.includes('Filters'))).toBe(true);
    });
  });
});
