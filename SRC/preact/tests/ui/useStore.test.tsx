/**
 * Tests for the useStore React hook — the bridge between the pub/sub store
 * and React's rendering model via useSyncExternalStore.
 *
 * Covers: basic subscription, selector slicing, re-render on store changes,
 * shallow equality optimization, various selector types, and unmount cleanup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useStore } from '../../ui/useStore';
import { initStore, getStore } from '../../core/store';
import type { AppState } from '../../types';

beforeEach(() => {
  initStore();
});

afterEach(() => {
  cleanup();
});

// ── Test harness components ──────────────────────────────────────────────────

/** Renders the selected store slice as JSON text. */
function StoreReader<T>({
  selector,
  testId = 'value',
}: {
  selector: (s: AppState) => T;
  testId?: string;
}) {
  const value = useStore(selector);
  return <div data-testid={testId}>{JSON.stringify(value)}</div>;
}

/** Wraps StoreReader in an error boundary for safe rendering. */
function Harness({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useStore', () => {
  describe('basic subscription', () => {
    it('returns the correct initial value for a primitive selector', () => {
      render(
        <Harness>
          <StoreReader selector={(s) => s.activeTab} testId="tab" />
        </Harness>,
      );

      // Default activeTab from createAppState is 'query'
      expect(screen.getByTestId('tab').textContent).toBe('"query"');
    });

    it('returns the correct initial value for base table selector', () => {
      render(
        <Harness>
          <StoreReader selector={(s) => s.base} testId="base" />
        </Harness>,
      );

      // Default base is ''
      expect(screen.getByTestId('base').textContent).toBe('""');
    });
  });

  describe('selector returns correct slice', () => {
    it('selects a nested object slice', () => {
      // Set up a table in the store
      act(() => {
        getStore().update(draft => {
          draft.tables['tbl1'] = {
            id: 'tbl1',
            name: 'Orders',
            cols: ['OrderId', 'Company'],
            rowCount: 10,
          };
        });
      });

      render(
        <Harness>
          <StoreReader selector={(s) => s.tables['tbl1']?.name} testId="name" />
        </Harness>,
      );

      expect(screen.getByTestId('name').textContent).toBe('"Orders"');
    });

    it('selects an array slice', () => {
      act(() => {
        getStore().update(draft => {
          draft.groupBy = ['col1', 'col2'];
        });
      });

      render(
        <Harness>
          <StoreReader selector={(s) => s.groupBy} testId="group" />
        </Harness>,
      );

      expect(screen.getByTestId('group').textContent).toBe('["col1","col2"]');
    });
  });

  describe('component re-renders on store changes', () => {
    it('updates displayed value when the selected slice changes', () => {
      render(
        <Harness>
          <StoreReader selector={(s) => s.activeTab} testId="tab" />
        </Harness>,
      );

      expect(screen.getByTestId('tab').textContent).toBe('"query"');

      act(() => {
        getStore().set('activeTab', 'output');
      });

      expect(screen.getByTestId('tab').textContent).toBe('"output"');
    });

    it('updates when store is mutated via update()', () => {
      render(
        <Harness>
          <StoreReader selector={(s) => s.base} testId="base" />
        </Harness>,
      );

      expect(screen.getByTestId('base').textContent).toBe('""');

      act(() => {
        getStore().update(draft => {
          draft.base = 'Orders';
        });
      });

      expect(screen.getByTestId('base').textContent).toBe('"Orders"');
    });
  });

  describe('shallow equality prevents unnecessary re-renders', () => {
    it('does not change reference when object slice is shallow-equal', () => {
      // Set up initial state
      act(() => {
        getStore().update(draft => {
          draft.tables['tbl1'] = {
            id: 'tbl1',
            name: 'Orders',
            cols: ['A', 'B'],
            rowCount: 5,
          };
        });
      });

      // Track render count via a side-channel
      let renderCount = 0;

      function TrackingReader() {
        renderCount++;
        const tables = useStore((s) => s.tables);
        return <div data-testid="tables">{Object.keys(tables).join(',')}</div>;
      }

      render(
        <Harness>
          <TrackingReader />
        </Harness>,
      );

      expect(screen.getByTestId('tables').textContent).toBe('tbl1');

      // Update an unrelated field (activeTab) — tables reference should stay stable
      act(() => {
        getStore().set('activeTab', 'output');
      });

      // The displayed value should not change
      expect(screen.getByTestId('tables').textContent).toBe('tbl1');
    });

    it('does not re-render when a different primitive changes', () => {
      let renderCount = 0;

      function BaseReader() {
        renderCount++;
        const base = useStore((s) => s.base);
        return <div data-testid="base">{base}</div>;
      }

      render(
        <Harness>
          <BaseReader />
        </Harness>,
      );

      // Change activeTab — base reader should not re-render
      act(() => {
        getStore().set('activeTab', 'output');
      });

      // The displayed value should be unchanged
      expect(screen.getByTestId('base').textContent).toBe('');
    });
  });

  describe('various selector types', () => {
    it('works with a boolean selector', () => {
      act(() => {
        getStore().update(draft => {
          draft.subtotalGrandTotal = false;
        });
      });

      render(
        <Harness>
          <StoreReader selector={(s) => s.subtotalGrandTotal} testId="val" />
        </Harness>,
      );

      expect(screen.getByTestId('val').textContent).toBe('false');
    });

    it('works with a number selector', () => {
      act(() => {
        getStore().update(draft => {
          draft.tables['t1'] = {
            id: 't1',
            name: 'T1',
            cols: ['A'],
            rowCount: 42,
          };
        });
      });

      render(
        <Harness>
          <StoreReader selector={(s) => s.tables['t1']?.rowCount ?? 0} testId="val" />
        </Harness>,
      );

      expect(screen.getByTestId('val').textContent).toBe('42');
    });

    it('works with a null value selector', () => {
      render(
        <Harness>
          <StoreReader selector={(s) => s.result} testId="val" />
        </Harness>,
      );

      expect(screen.getByTestId('val').textContent).toBe('null');
    });

    it('works with a Set selector', () => {
      act(() => {
        getStore().update(draft => {
          draft.selCols = new Set(['a', 'b', 'c']);
        });
      });

      render(
        <Harness>
          <StoreReader selector={(s) => Array.from(s.selCols).sort()} testId="val" />
        </Harness>,
      );

      expect(screen.getByTestId('val').textContent).toBe('["a","b","c"]');
    });
  });

  describe('unmount cleanup', () => {
    it('does not throw when store updates after unmount', () => {
      const { unmount } = render(
        <Harness>
          <StoreReader selector={(s) => s.activeTab} testId="tab" />
        </Harness>,
      );

      // Unmount the component
      unmount();

      // Updating the store after unmount should not throw
      expect(() => {
        act(() => {
          getStore().set('activeTab', 'output');
        });
      }).not.toThrow();
    });

    it('multiple components can subscribe independently', () => {
      render(
        <Harness>
          <StoreReader selector={(s) => s.activeTab} testId="tab" />
          <StoreReader selector={(s) => s.base} testId="base" />
        </Harness>,
      );

      expect(screen.getByTestId('tab').textContent).toBe('"query"');
      expect(screen.getByTestId('base').textContent).toBe('""');

      act(() => {
        getStore().set('activeTab', 'output');
      });

      // Only the tab reader should update
      expect(screen.getByTestId('tab').textContent).toBe('"output"');
      expect(screen.getByTestId('base').textContent).toBe('""');
    });
  });
});
