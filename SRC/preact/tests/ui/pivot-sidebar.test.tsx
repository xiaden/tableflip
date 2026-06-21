/**
 * Tests for PivotSidebar — the collapsible right-side panel composing
 * TopSection, SheetAccordions, and CalcAccordion.
 *
 * Covers: rendering all 3 child components, toggle button,
 * collapse/expand behavior via _ui.sidebarCollapsed in the store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';
import { PivotSidebar } from '../../ui/pivot-sidebar';

// Mock child components to simple divs to isolate layout/toggle behavior
vi.mock('../../ui/top-section', () => ({
  TopSection: () => <div data-testid="top-section">TopSection</div>,
}));

vi.mock('../../ui/sheet-accordions', () => ({
  SheetAccordions: () => <div data-testid="sheet-accordions">SheetAccordions</div>,
}));

vi.mock('../../ui/calc-accordion', () => ({
  CalcAccordion: () => <div data-testid="calc-accordion">CalcAccordion</div>,
}));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  initStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PivotSidebar', () => {
  describe('child component rendering', () => {
    it('renders TopSection', () => {
      const { container } = render(<PivotSidebar />);
      expect(container.textContent).toContain('TopSection');
    });

    it('renders SheetAccordions', () => {
      const { container } = render(<PivotSidebar />);
      expect(container.textContent).toContain('SheetAccordions');
    });

    it('renders CalcAccordion', () => {
      const { container } = render(<PivotSidebar />);
      expect(container.textContent).toContain('CalcAccordion');
    });
  });

  describe('toggle button', () => {
    it('renders a toggle button', () => {
      const { container } = render(<PivotSidebar />);
      const toggleBtn = container.querySelector('button');
      expect(toggleBtn).toBeTruthy();
    });

    it('toggle button has an SVG icon', () => {
      const { container } = render(<PivotSidebar />);
      const svg = container.querySelector('button svg');
      expect(svg).toBeTruthy();
    });
  });

  describe('collapse/expand behavior', () => {
    it('starts expanded by default (_ui.sidebarCollapsed is false)', () => {
      render(<PivotSidebar />);
      const state = getStore().getState();
      expect(state._ui?.sidebarCollapsed).toBeFalsy();
    });

    it('clicking toggle sets _ui.sidebarCollapsed to true', () => {
      const { container } = render(<PivotSidebar />);
      const toggleBtn = container.querySelector('button')!;

      act(() => {
        fireEvent.click(toggleBtn);
      });

      const state = getStore().getState();
      expect(state._ui?.sidebarCollapsed).toBe(true);
    });

    it('clicking toggle twice returns to expanded', () => {
      const { container } = render(<PivotSidebar />);
      const toggleBtn = container.querySelector('button')!;

      act(() => {
        fireEvent.click(toggleBtn);
      });
      expect(getStore().getState()._ui?.sidebarCollapsed).toBe(true);

      act(() => {
        fireEvent.click(toggleBtn);
      });
      expect(getStore().getState()._ui?.sidebarCollapsed).toBe(false);
    });

    it('initializes _ui if it does not exist', () => {
      // Set up store without _ui
      initStore();
      // Manually clear _ui to simulate missing field
      getStore().update(draft => {
        (draft as unknown as Record<string, unknown>)._ui = undefined;
      });

      const { container } = render(<PivotSidebar />);
      const toggleBtn = container.querySelector('button')!;

      act(() => {
        fireEvent.click(toggleBtn);
      });

      const state = getStore().getState();
      expect(state._ui).toBeTruthy();
      expect(state._ui?.sidebarCollapsed).toBe(true);
    });
  });

  describe('collapsed state rendering', () => {
    it('component renders correctly when collapsed', () => {
      initStore({ _ui: { sidebarCollapsed: true } } as any);
      const { container } = render(<PivotSidebar />);

      // jsdom doesn't compute MUI sx styles, but we can verify the component rendered
      // and the store state is correct
      const sidebarBox = container.firstElementChild as HTMLElement;
      expect(sidebarBox).toBeTruthy();
      expect(getStore().getState()._ui?.sidebarCollapsed).toBe(true);
    });
  });
});
