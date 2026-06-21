/**
 * Tests for SheetAccordions — per-sheet MUI Accordions for the right sidebar.
 *
 * Covers: empty state, rendering accordions for tables, remove button flow
 * (verifying thorough state cleanup), stack visual distinction, and
 * column chip rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';

vi.mock('../../core/sqldb', () => ({
  dropTable: vi.fn(),
}));

vi.mock('../../report/validation', () => ({
  invalidateValidation: vi.fn(),
}));

vi.mock('../../ui/components/rename-modal', () => ({
  RenameModal: () => null,
  resolveRenameTarget: vi.fn(() => null),
}));

vi.mock('../../catalog/column-catalog', () => ({
  buildColSourceMap: vi.fn(() => new Map()),
}));

import { SheetAccordions } from '../../ui/sheet-accordions';
import type { DbTable } from '../../types';

function makeTable(id: string, name: string, cols: string[] = ['Col1', 'Col2'], rowCount: number = 100): DbTable {
  return { id, name, cols, rowCount };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SheetAccordions', () => {
  describe('empty state', () => {
    it('renders "No sheets imported" when no tables exist', () => {
      initStore({ tables: {} });
      const { container } = render(<SheetAccordions />);
      expect(container.textContent).toContain('No sheets imported');
    });

    it('does not render any accordions when empty', () => {
      initStore({ tables: {} });
      const { container } = render(<SheetAccordions />);
      const accordions = container.querySelectorAll('.MuiAccordion-root');
      expect(accordions.length).toBe(0);
    });
  });

  describe('rendering accordions for tables', () => {
    it('renders one accordion per table', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
      });
      const { container } = render(<SheetAccordions />);
      const accordions = container.querySelectorAll('.MuiAccordion-root');
      expect(accordions.length).toBe(2);
    });

    it('renders the table short name in each accordion', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
        },
      });
      const { container } = render(<SheetAccordions />);
      expect(container.textContent).toContain('Orders');
    });

    it('renders row count for each table', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders', ['A', 'B'], 1234),
        },
      });
      const { container } = render(<SheetAccordions />);
      expect(container.textContent).toContain('1,234 rows');
    });

    it('renders a remove button for each table', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
      });
      const { container } = render(<SheetAccordions />);
      const removeButtons = container.querySelectorAll('[title="Remove sheet"]');
      expect(removeButtons.length).toBe(2);
    });
  });

  describe('stack visual distinction', () => {
    it('renders "stack" label for tables in the stacks array', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Contacts'),
        },
        stacks: ['t2'],
      });
      const { container } = render(<SheetAccordions />);
      expect(container.textContent).toContain('stack');
    });

    it('does not render "stack" label for non-stack tables', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
        },
        stacks: [],
      });
      const { container } = render(<SheetAccordions />);
      const text = container.textContent || '';
      expect(text).not.toContain('stack');
    });
  });

  describe('remove button flow', () => {
    it('removes the table from state.tables when remove is clicked', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        tableColors: { t1: '#4477AA', t2: '#CC6677' },
        columnLabels: { t1: { Col1: 'Label1' } },
        columnTypeOverrides: { t1: { Col1: 'number' } },
        excludedRows: { t1: new Set([0, 1]) },
      });

      const { container } = render(<SheetAccordions />);

      expect(getStore().getState().tables['t1']).toBeTruthy();
      expect(getStore().getState().tableColors['t1']).toBeTruthy();

      const removeButtons = container.querySelectorAll('[title="Remove sheet"]');
      act(() => {
        fireEvent.click(removeButtons[0]);
      });

      const state = getStore().getState();
      expect(state.tables['t1']).toBeUndefined();
      expect(state.tableColors['t1']).toBeUndefined();
      expect(state.columnLabels['t1']).toBeUndefined();
      expect(state.columnTypeOverrides['t1']).toBeUndefined();
      expect(state.excludedRows['t1']).toBeUndefined();

      // Other table should remain
      expect(state.tables['t2']).toBeTruthy();
    });

    it('clears base and baseCols when removing the base table', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
        },
        base: 't1',
        baseCols: ['Col1', 'Col2'],
      });

      const { container } = render(<SheetAccordions />);
      const removeButtons = container.querySelectorAll('[title="Remove sheet"]');

      act(() => {
        fireEvent.click(removeButtons[0]);
      });

      const state = getStore().getState();
      expect(state.base).toBe('');
      expect(state.baseCols).toEqual([]);
    });

    it('removes table from stacks array when removing a stacked table', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Contacts'),
        },
        stacks: ['t2'],
      });

      const { container } = render(<SheetAccordions />);
      const removeButtons = container.querySelectorAll('[title="Remove sheet"]');

      act(() => {
        fireEvent.click(removeButtons[1]);
      });

      const state = getStore().getState();
      expect(state.stacks).not.toContain('t2');
    });

    it('removes table from stackAliases when present', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
        },
        stackAliases: { t1: 'alias1' },
      });

      const { container } = render(<SheetAccordions />);
      const removeButtons = container.querySelectorAll('[title="Remove sheet"]');

      act(() => {
        fireEvent.click(removeButtons[0]);
      });

      const state = getStore().getState();
      expect(state.stackAliases['t1']).toBeUndefined();
    });

    it('removes lookups referencing the removed table', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'Customers'),
        },
        lookups: [
          { rightId: 't2', keyPairs: [], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
          { rightId: 't1', keyPairs: [], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
        ],
      });

      const { container } = render(<SheetAccordions />);
      const removeButtons = container.querySelectorAll('[title="Remove sheet"]');

      act(() => {
        fireEvent.click(removeButtons[1]);
      });

      const state = getStore().getState();
      expect(state.lookups.length).toBe(1);
      expect(state.lookups[0].rightId).toBe('t1');
    });

    it('removes detailBands referencing the removed table', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders'),
          t2: makeTable('t2', 'LineItems'),
        },
        detailBands: [
          { id: 'band_0', rightId: 't2', keyPairs: [], cols: [], enabled: true, sorts: [], label: '' },
        ],
      });

      const { container } = render(<SheetAccordions />);
      const removeButtons = container.querySelectorAll('[title="Remove sheet"]');

      act(() => {
        fireEvent.click(removeButtons[1]); // Remove t2
      });

      const state = getStore().getState();
      expect(state.detailBands.length).toBe(0);
    });
  });

  describe('column chips', () => {
    it('renders column chips inside expanded accordion', () => {
      initStore({
        tables: {
          t1: makeTable('t1', 'Orders', ['OrderId', 'Company', 'Amount']),
        },
      });

      const { container } = render(<SheetAccordions />);

      // Expand the accordion by clicking the summary
      const summary = container.querySelector('.MuiAccordionSummary-root') as HTMLElement;
      expect(summary).toBeTruthy();
      act(() => {
        fireEvent.click(summary);
      });

      expect(container.textContent).toContain('OrderId');
      expect(container.textContent).toContain('Company');
      expect(container.textContent).toContain('Amount');
    });
  });
});
