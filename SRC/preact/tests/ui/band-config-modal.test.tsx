/**
 * Tests for BandConfigModal — dialog for configuring detail band settings.
 *
 * Covers: rendering, match pairs add/remove, child column checkboxes,
 * label field, save/cancel behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';

const { mockInvalidateValidation } = vi.hoisted(() => ({
  mockInvalidateValidation: vi.fn(),
}));

vi.mock('../../report/validation', () => ({
  invalidateValidation: mockInvalidateValidation,
}));

import { BandConfigModal } from '../../ui/band-config-modal';
import type { DbTable } from '../../types';

function makeTable(id: string, name: string, cols: string[]): DbTable {
  return { id, name, cols, rowCount: 10 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  initStore({
    tables: {
      orders: makeTable('orders', 'Orders', ['OrderId', 'Amount']),
      lines: makeTable('lines', 'Order Lines', ['LineId', 'Product', 'Qty']),
    },
    base: 'orders',
    detailBands: [{
      id: 'band_1',
      rightId: 'lines',
      keyPairs: [],
      cols: [],
      enabled: true,
      sorts: [],
      label: 'Order Lines',
    }],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BandConfigModal', () => {
  describe('rendering', () => {
    it('renders dialog title with band table short name', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);
      expect(screen.getByText(/Order Lines/)).toBeTruthy();
    });

    it('does not render when open=false', () => {
      render(<BandConfigModal open={false} bandId="band_1" onClose={vi.fn()} />);
      expect(screen.queryByText(/Order Lines/)).toBeNull();
    });

    it('renders "Match pairs" section', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);
      expect(screen.getByText('Match pairs')).toBeTruthy();
    });

    it('renders "Child columns" section', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);
      expect(screen.getByText('Child columns')).toBeTruthy();
    });

    it('renders "Label" section', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);
      expect(screen.getByText('Label')).toBeTruthy();
    });

    it('renders Save and Cancel buttons', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);
      expect(screen.getByText('Save')).toBeTruthy();
      expect(screen.getByText('Cancel')).toBeTruthy();
    });
  });

  describe('match pairs', () => {
    it('renders "+ Add pair" button', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);
      expect(screen.getByText('+ Add pair')).toBeTruthy();
    });

    it('clicking "+ Add pair" adds a new pair row', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);

      act(() => {
        fireEvent.click(screen.getByText('+ Add pair'));
      });

      // Should now have Base column and Child column labels visible
      expect(screen.getAllByText('Base column').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Child column').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('child columns', () => {
    it('renders checkboxes for each child table column', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);
      // Child table 'lines' has columns: LineId, Product, Qty
      expect(screen.getByText('LineId')).toBeTruthy();
      expect(screen.getByText('Product')).toBeTruthy();
      expect(screen.getByText('Qty')).toBeTruthy();
    });

    it('clicking a checkbox toggles it in draft state', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);

      // Find the checkbox next to "Product"
      const productLabel = screen.getByText('Product');
      const checkbox = productLabel.closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox).toBeTruthy();
      expect(checkbox.checked).toBe(false);

      act(() => {
        fireEvent.click(checkbox);
      });

      // After clicking, it should be checked
      expect(checkbox.checked).toBe(true);
    });
  });

  describe('save', () => {
    it('writes keyPairs, cols, label to store.detailBands and calls invalidateValidation', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);

      // Toggle a child column checkbox
      const productLabel = screen.getByText('Product');
      const checkbox = productLabel.closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      act(() => {
        fireEvent.click(checkbox);
      });

      // Click Save
      act(() => {
        fireEvent.click(screen.getByText('Save'));
      });

      const state = getStore().getState();
      const band = state.detailBands.find(b => b.id === 'band_1');
      expect(band).toBeTruthy();
      expect(band!.cols).toContain('Product');
      expect(mockInvalidateValidation).toHaveBeenCalled();
    });

    it('filters out incomplete pairs on save', () => {
      render(<BandConfigModal open={true} bandId="band_1" onClose={vi.fn()} />);

      // Add a pair but don't fill it in
      act(() => {
        fireEvent.click(screen.getByText('+ Add pair'));
      });

      // Click Save
      act(() => {
        fireEvent.click(screen.getByText('Save'));
      });

      const state = getStore().getState();
      const band = state.detailBands.find(b => b.id === 'band_1');
      // Incomplete pairs (empty left or right) should be filtered out
      expect(band!.keyPairs.length).toBe(0);
    });
  });

  describe('cancel', () => {
    it('calls onClose without store mutation', () => {
      const onClose = vi.fn();
      render(<BandConfigModal open={true} bandId="band_1" onClose={onClose} />);

      // Toggle a checkbox
      const productLabel = screen.getByText('Product');
      const checkbox = productLabel.closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      act(() => {
        fireEvent.click(checkbox);
      });

      // Click Cancel
      act(() => {
        fireEvent.click(screen.getByText('Cancel'));
      });

      expect(onClose).toHaveBeenCalledTimes(1);

      // Store should not have been mutated
      const state = getStore().getState();
      const band = state.detailBands.find(b => b.id === 'band_1');
      expect(band!.cols).toEqual([]);
    });
  });
});
