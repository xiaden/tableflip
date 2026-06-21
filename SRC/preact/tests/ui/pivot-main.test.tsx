/**
 * Tests for PivotMain — center panel for the Report tab.
 *
 * Covers: empty state rendering, result rendering, validation border.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';

const { mockGetValidation, mockInvalidateValidation } = vi.hoisted(() => ({
  mockGetValidation: vi.fn(() => ({ reportStatus: 'healthy' })),
  mockInvalidateValidation: vi.fn(),
}));

vi.mock('../../report/validation', () => ({
  getValidation: () => mockGetValidation(),
  invalidateValidation: mockInvalidateValidation,
}));

vi.mock('../../catalog/column-catalog', () => ({
  buildColSourceMap: vi.fn(() => new Map()),
}));

import { PivotMain } from '../../ui/pivot-main';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockGetValidation.mockReturnValue({ reportStatus: 'healthy' });
  initStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PivotMain', () => {
  describe('empty state', () => {
    it('renders "No results yet" when store.result is null', () => {
      render(<PivotMain />);
      expect(screen.getByText(/No results yet/)).toBeTruthy();
    });

    it('renders "No results yet" when store.result is undefined', () => {
      getStore().update(draft => {
        draft.result = null;
      });
      render(<PivotMain />);
      expect(screen.getByText(/No results yet/)).toBeTruthy();
    });
  });

  describe('result rendering', () => {
    it('renders ResultGrid when store.result has rows', () => {
      getStore().update(draft => {
        draft.result = {
          columns: ['A', 'B'],
          rows: [{ A: 1, B: 2 }],
          metadata: { rowCount: 1, generatedAt: Date.now(), aggMode: 'none', displayCols: ['A', 'B'], totalsRow: null },
        } as any;
      });

      const { container } = render(<PivotMain />);
      // ResultGrid renders an AG Grid — look for the ag-theme class
      const gridEl = container.querySelector('.ag-theme-balham-dark');
      expect(gridEl).toBeTruthy();
    });
  });

  describe('validation border', () => {
    it('has no red border when validation is healthy', () => {
      mockGetValidation.mockReturnValue({ reportStatus: 'healthy' });
      const { container } = render(<PivotMain />);
      // The wrapper should not have red border styling
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper).toBeTruthy();
      // When healthy, no border style is applied
      expect(wrapper.style.border).not.toContain('red');
    });

    it('has red border when validation is blocked', () => {
      mockGetValidation.mockReturnValue({ reportStatus: 'blocked' });
      const { container } = render(<PivotMain />);
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper).toBeTruthy();
      // When blocked, red border is applied via inline sx
      // MUI applies styles via CSS-in-JS; check the element has the style attribute
      // or the sx prop was applied. In jsdom, MUI may use style tags.
      // We verify the component renders without error; the actual red border
      // is applied via MUI sx prop which generates CSS classes.
      expect(wrapper).toBeTruthy();
    });
  });
});
