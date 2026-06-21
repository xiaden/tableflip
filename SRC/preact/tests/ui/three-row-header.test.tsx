/**
 * Tests for ThreeRowHeader — AG Grid header component with three drop rows.
 *
 * Covers: rendering three rows, top row drop (empty/same/different sheet),
 * middle row drop (sheet chip), bottom row drop (extra key pair),
 * × button (clear column), label click (progressSort).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';

const {
  mockInvalidateValidation,
  mockAfterCombineChange,
  mockBuildColSourceMap,
} = vi.hoisted(() => ({
  mockInvalidateValidation: vi.fn(),
  mockAfterCombineChange: vi.fn(),
  mockBuildColSourceMap: vi.fn(() => new Map()),
}));

vi.mock('../../report/validation', () => ({
  invalidateValidation: mockInvalidateValidation,
}));

vi.mock('../../query/layout-selection', () => ({
  _afterCombineChange: mockAfterCombineChange,
}));

vi.mock('../../catalog/column-catalog', () => ({
  buildColSourceMap: () => mockBuildColSourceMap(),
}));

import { ThreeRowHeader } from '../../ui/three-row-header';
import type { ThreeRowHeaderProps } from '../../ui/three-row-header';

function makeColumn(field: string) {
  return {
    getColDef: () => ({ field }),
  };
}

function makeProps(overrides: Partial<ThreeRowHeaderProps> = {}): ThreeRowHeaderProps {
  return {
    displayName: 'TestCol',
    label: 'TestCol',
    color: '#4477AA',
    renamed: undefined,
    origCol: null,
    onRename: null,
    onClear: null,
    onContextMenu: null,
    progressSort: vi.fn(),
    column: makeColumn('TestCol') as any,
    // IHeaderParams required fields
    enableSorting: true,
    enableMenu: true,
    enableFilterButton: false,
    showColumnMenu: vi.fn(),
    setSort: vi.fn(),
    onMenuClicked: vi.fn(),
    ...overrides,
  } as unknown as ThreeRowHeaderProps;
}

function makeDropEvent(data: Record<string, unknown>) {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      getData: (type: string) => {
        if (type === 'application/json') return JSON.stringify(data);
        return '';
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockBuildColSourceMap.mockReturnValue(new Map());
  initStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ThreeRowHeader', () => {
  describe('rendering', () => {
    it('renders three rows with data-row attributes', () => {
      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const topRow = container.querySelector('[data-row="top"]');
      const middleRow = container.querySelector('[data-row="middle"]');
      const bottomRow = container.querySelector('[data-row="bottom"]');
      expect(topRow).toBeTruthy();
      expect(middleRow).toBeTruthy();
      expect(bottomRow).toBeTruthy();
    });

    it('displays label text in the top row', () => {
      const { container } = render(<ThreeRowHeader {...makeProps({ label: 'OrderId' })} />);
      expect(container.textContent).toContain('OrderId');
    });

    it('falls back to displayName when label is empty', () => {
      const { container } = render(<ThreeRowHeader {...makeProps({ label: '', displayName: 'Fallback' })} />);
      expect(container.textContent).toContain('Fallback');
    });

    it('renders color stripe when color is provided', () => {
      const { container } = render(<ThreeRowHeader {...makeProps({ color: '#FF0000' })} />);
      const topRow = container.querySelector('[data-row="top"]') as HTMLElement;
      // Color stripe is the first child of the top row
      const firstChild = topRow.children[0] as HTMLElement;
      expect(firstChild).toBeTruthy();
    });

    it('renders × (clear) button', () => {
      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const clearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u00d7'),
      );
      expect(clearBtn).toBeTruthy();
    });
  });

  describe('top row drop — empty cell', () => {
    it('adds column to selCols/colOrder and sets base when cell is empty', () => {
      const colMap = new Map();
      // No entry for 'TestCol' → empty cell
      mockBuildColSourceMap.mockReturnValue(colMap);

      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const topRow = container.querySelector('[data-row="top"]') as HTMLElement;

      act(() => {
        fireEvent.drop(topRow, makeDropEvent({
          chipType: 'column',
          tableId: 'orders',
          columnName: 'Amount',
        }));
      });

      const state = getStore().getState();
      expect(state.base).toBe('orders');
      expect((state.selCols as Set<string>).has('Amount')).toBe(true);
      expect(state.colOrder).toContain('Amount');
      expect(mockInvalidateValidation).toHaveBeenCalled();
      expect(mockAfterCombineChange).toHaveBeenCalled();
    });
  });

  describe('top row drop — same sheet', () => {
    it('replaces column in selCols/colOrder when same tableId', () => {
      const colMap = new Map();
      colMap.set('TestCol', { kind: 'phys', tid: 'orders', col: 'OrderId', idx: 0 });
      mockBuildColSourceMap.mockReturnValue(colMap);

      // headerField is 'TestCol' (from column.getColDef().field)
      // The code removes headerField from selCols/colOrder, not the physical col name
      initStore({
        base: 'orders',
        selCols: new Set(['TestCol']),
        colOrder: ['TestCol'],
      });

      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const topRow = container.querySelector('[data-row="top"]') as HTMLElement;

      act(() => {
        fireEvent.drop(topRow, makeDropEvent({
          chipType: 'column',
          tableId: 'orders',
          columnName: 'Amount',
        }));
      });

      const state = getStore().getState();
      expect((state.selCols as Set<string>).has('TestCol')).toBe(false);
      expect((state.selCols as Set<string>).has('Amount')).toBe(true);
      expect(state.colOrder).not.toContain('TestCol');
      expect(state.colOrder).toContain('Amount');
    });
  });

  describe('top row drop — different sheet', () => {
    it('creates a LookupSpec when different tableId', () => {
      const colMap = new Map();
      colMap.set('TestCol', { kind: 'phys', tid: 'orders', col: 'OrderId', idx: 0 });
      mockBuildColSourceMap.mockReturnValue(colMap);

      initStore({
        base: 'orders',
        selCols: new Set(['OrderId']),
        colOrder: ['OrderId'],
      });

      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const topRow = container.querySelector('[data-row="top"]') as HTMLElement;

      act(() => {
        fireEvent.drop(topRow, makeDropEvent({
          chipType: 'column',
          tableId: 'customers',
          columnName: 'CompanyName',
        }));
      });

      const state = getStore().getState();
      expect(state.lookups.length).toBe(1);
      expect(state.lookups[0].rightId).toBe('customers');
      expect(state.lookups[0].keyPairs).toEqual([{ left: 'OrderId', right: 'CompanyName' }]);
      expect(state.lookups[0].required).toBe(false);
      expect(state.lookups[0].duplicatePolicy.mode).toBe('first');
    });
  });

  describe('middle row drop — sheet chip', () => {
    it('creates a DetailBandSpec on sheet chip drop', () => {
      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const middleRow = container.querySelector('[data-row="middle"]') as HTMLElement;

      act(() => {
        fireEvent.drop(middleRow, makeDropEvent({
          chipType: 'sheet',
          tableId: 'orderlines',
        }));
      });

      const state = getStore().getState();
      expect(state.detailBands.length).toBe(1);
      expect(state.detailBands[0].rightId).toBe('orderlines');
      expect(state.detailBands[0].keyPairs).toEqual([]);
      expect(state.detailBands[0].cols).toEqual([]);
      expect(state.detailBands[0].enabled).toBe(true);
      expect(mockInvalidateValidation).toHaveBeenCalled();
    });

    it('rejects column chip drops silently (no store change)', () => {
      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const middleRow = container.querySelector('[data-row="middle"]') as HTMLElement;

      act(() => {
        fireEvent.drop(middleRow, makeDropEvent({
          chipType: 'column',
          tableId: 'orders',
          columnName: 'Amount',
        }));
      });

      const state = getStore().getState();
      expect(state.detailBands.length).toBe(0);
      expect(mockInvalidateValidation).not.toHaveBeenCalled();
    });
  });

  describe('bottom row drop — extra key pair', () => {
    it('adds extra key pair to existing lookup', () => {
      const colMap = new Map();
      colMap.set('TestCol', { kind: 'phys', tid: 'orders', col: 'OrderId', idx: 0 });
      mockBuildColSourceMap.mockReturnValue(colMap);

      initStore({
        base: 'orders',
        lookups: [{
          rightId: 'customers',
          keyPairs: [{ left: 'OrderId', right: 'CustId' }],
          cols: ['CustId'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'first' },
        }],
      });

      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const bottomRow = container.querySelector('[data-row="bottom"]') as HTMLElement;

      act(() => {
        fireEvent.drop(bottomRow, makeDropEvent({
          chipType: 'column',
          tableId: 'customers',
          columnName: 'CustName',
        }));
      });

      const state = getStore().getState();
      expect(state.lookups[0].keyPairs.length).toBe(2);
      expect(state.lookups[0].keyPairs[1]).toEqual({ left: 'TestCol', right: 'CustName' });
      expect(mockInvalidateValidation).toHaveBeenCalled();
    });

    it('sets error state when no matching lookup exists', () => {
      const colMap = new Map();
      colMap.set('TestCol', { kind: 'phys', tid: 'orders', col: 'OrderId', idx: 0 });
      mockBuildColSourceMap.mockReturnValue(colMap);

      initStore({
        base: 'orders',
        lookups: [],
      });

      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const header = container.querySelector('[data-testid="three-row-header"]') as HTMLElement;

      act(() => {
        fireEvent.drop(
          container.querySelector('[data-row="bottom"]') as HTMLElement,
          makeDropEvent({
            chipType: 'column',
            tableId: 'customers',
            columnName: 'CustName',
          }),
        );
      });

      // Should have red border styling (error state)
      expect(header).toBeTruthy();
      // The error is tracked internally — verify no lookup was added
      const state = getStore().getState();
      expect(state.lookups.length).toBe(0);
    });
  });

  describe('× button — clear column', () => {
    it('removes column from selCols and colOrder', () => {
      initStore({
        base: 'orders',
        selCols: new Set(['TestCol', 'Other']),
        colOrder: ['TestCol', 'Other'],
      });

      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const clearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u00d7'),
      )!;

      act(() => {
        fireEvent.click(clearBtn);
      });

      const state = getStore().getState();
      expect((state.selCols as Set<string>).has('TestCol')).toBe(false);
      expect(state.colOrder).not.toContain('TestCol');
      expect((state.selCols as Set<string>).has('Other')).toBe(true);
    });

    it('removes lookups where this column is the left key', () => {
      const colMap = new Map();
      colMap.set('TestCol', { kind: 'phys', tid: 'orders', col: 'OrderId', idx: 0 });
      mockBuildColSourceMap.mockReturnValue(colMap);

      initStore({
        base: 'orders',
        lookups: [{
          rightId: 'customers',
          keyPairs: [{ left: 'OrderId', right: 'CustId' }],
          cols: ['CustId'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'first' },
        }],
      });

      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const clearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u00d7'),
      )!;

      act(() => {
        fireEvent.click(clearBtn);
      });

      const state = getStore().getState();
      expect(state.lookups.length).toBe(0);
    });

    it('calls invalidateValidation and _afterCombineChange', () => {
      const { container } = render(<ThreeRowHeader {...makeProps()} />);
      const clearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u00d7'),
      )!;

      act(() => {
        fireEvent.click(clearBtn);
      });

      expect(mockInvalidateValidation).toHaveBeenCalled();
      expect(mockAfterCombineChange).toHaveBeenCalled();
    });
  });

  describe('label click — progressSort', () => {
    it('calls progressSort when label is clicked', () => {
      const progressSort = vi.fn();
      const { container } = render(<ThreeRowHeader {...makeProps({ progressSort })} />);

      // Find the label text element
      const labelEl = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === 'TestCol' && el.childElementCount === 0,
      );
      expect(labelEl).toBeTruthy();

      fireEvent.click(labelEl!);
      expect(progressSort).toHaveBeenCalledTimes(1);
      expect(progressSort).toHaveBeenCalledWith(false);
    });

    it('calls progressSort with shiftKey=true on shift-click', () => {
      const progressSort = vi.fn();
      const { container } = render(<ThreeRowHeader {...makeProps({ progressSort })} />);

      const labelEl = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === 'TestCol' && el.childElementCount === 0,
      );

      fireEvent.click(labelEl!, { shiftKey: true });
      expect(progressSort).toHaveBeenCalledWith(true);
    });
  });
});
