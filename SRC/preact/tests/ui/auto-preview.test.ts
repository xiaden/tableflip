/**
 * Tests for the auto-preview module — debounced report execution triggered
 * by store state changes.
 *
 * Covers: init/destroy lifecycle, debounce timing, hash-based skip logic,
 * result storage, grid refresh, early return on missing base table, and
 * error handling with reentry guard reset.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initStore, getStore } from '../../core/store';
import {
  initAutoPreview,
  destroyAutoPreview,
  schedulePreview,
} from '../../ui/auto-preview';
import { runReport } from '../../report/engine';
import { refreshResultGridLayout } from '../../ui/grid';
import type { DbTable } from '../../types';

// Mock the report engine — runReport returns a fake ResultSet
const FAKE_RESULT = {
  columns: ['A', 'B'],
  rows: [{ A: 1, B: 2 }],
  metadata: { rowCount: 1, generatedAt: 0, aggMode: 'none', displayCols: ['A', 'B'] },
};
vi.mock('../../report/engine', () => ({
  runReport: vi.fn(() => FAKE_RESULT),
}));

// Mock the grid module — refreshResultGridLayout is a void function
vi.mock('../../ui/grid', () => ({
  refreshResultGridLayout: vi.fn(),
}));

function makeTable(id: string, name: string, cols: string[] = ['A', 'B']): DbTable {
  return { id, name, cols, rowCount: 10 };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Reset module-level singleton state (timer, running, queued, unsubscribe).
  // Note: _lastHash is NOT reset by destroy — tests use unique base names to
  // avoid hash collisions across tests.
  destroyAutoPreview();
  vi.mocked(runReport).mockClear();
  vi.mocked(refreshResultGridLayout).mockClear();
});

afterEach(() => {
  destroyAutoPreview();
  vi.useRealTimers();
});

describe('auto-preview', () => {
  // ── Lifecycle ──────────────────────────────────────────────────────────────

  describe('initAutoPreview / lifecycle', () => {
    it('subscribes to store and triggers execution on meaningful change', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
      });
      initAutoPreview();

      // Make a meaningful change (filters are pipeline-affecting)
      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);

      // Advance past the 400ms debounce window
      vi.advanceTimersByTime(400);

      expect(runReport).toHaveBeenCalledTimes(1);
    });

    it('skips scheduling when only _ui field changes', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
      });
      initAutoPreview();

      // Only change the transient _ui field — should NOT trigger execution
      getStore().set('_ui', { sidebarCollapsed: true });

      vi.advanceTimersByTime(400);

      expect(runReport).not.toHaveBeenCalled();
    });

    it('double-init is a no-op — only one subscription active', () => {
      initStore({
        tables: { t1: makeTable('t1', 'Orders') },
        base: 't1',
      });
      initAutoPreview();
      initAutoPreview(); // Should be no-op (guard: _unsubscribe already set)

      // Destroy once — if two subscriptions existed, one would survive
      destroyAutoPreview();

      // Make a change — should NOT trigger execution because we unsubscribed
      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);
      vi.advanceTimersByTime(400);

      expect(runReport).not.toHaveBeenCalled();
    });

    it('destroyAutoPreview unsubscribes — no execution after destroy', () => {
      initStore({
        tables: { t_destroy: makeTable('t_destroy', 'Orders') },
        base: 't_destroy',
      });
      initAutoPreview();
      destroyAutoPreview();

      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);
      vi.advanceTimersByTime(400);

      expect(runReport).not.toHaveBeenCalled();
    });

    it('destroyAutoPreview clears pending timer', () => {
      initStore({
        tables: { t_clear: makeTable('t_clear', 'Orders') },
        base: 't_clear',
      });
      initAutoPreview();

      // Trigger a schedule via store change
      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);

      // Destroy before the 400ms timer fires
      destroyAutoPreview();

      // Advance past where the timer would have fired
      vi.advanceTimersByTime(400);

      expect(runReport).not.toHaveBeenCalled();
    });

    it('destroyAutoPreview is safe to call multiple times', () => {
      expect(() => {
        destroyAutoPreview();
        destroyAutoPreview();
        destroyAutoPreview();
      }).not.toThrow();
    });
  });

  // ── Debounce ───────────────────────────────────────────────────────────────

  describe('schedulePreview (debounce)', () => {
    it('debounces at 400ms', () => {
      initStore({
        tables: { t_debounce: makeTable('t_debounce', 'Orders') },
        base: 't_debounce',
      });

      // Call schedulePreview directly (no subscription needed for this test)
      schedulePreview();

      // 399ms — should NOT fire yet
      vi.advanceTimersByTime(399);
      expect(runReport).not.toHaveBeenCalled();

      // 1ms more (total 400ms) — should fire
      vi.advanceTimersByTime(1);
      expect(runReport).toHaveBeenCalledTimes(1);
    });

    it('resets debounce timer on re-call', () => {
      initStore({
        tables: { t_reset: makeTable('t_reset', 'Orders') },
        base: 't_reset',
      });

      // First call at t=0
      schedulePreview();

      // Advance 300ms (t=300)
      vi.advanceTimersByTime(300);

      // Second call at t=300 — resets the debounce timer
      schedulePreview();

      // Advance 399ms from second call (t=699) — should NOT fire
      vi.advanceTimersByTime(399);
      expect(runReport).not.toHaveBeenCalled();

      // 1ms more (t=700 = 300 + 400) — should fire (400ms from last call)
      vi.advanceTimersByTime(1);
      expect(runReport).toHaveBeenCalledTimes(1);
    });
  });

  // ── Execution ──────────────────────────────────────────────────────────────

  describe('executePreview (via schedulePreview)', () => {
    it('hash check skips when content unchanged', () => {
      initStore({
        tables: { t_hash_skip: makeTable('t_hash_skip', 'Orders') },
        base: 't_hash_skip',
      });
      initAutoPreview();

      // Make a change → triggers schedulePreview via subscription
      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);

      // First execution — runReport called
      vi.advanceTimersByTime(400);
      expect(runReport).toHaveBeenCalledTimes(1);

      // The store.set('result', ...) inside executePreview triggers the
      // subscription again (result is part of the fingerprint but NOT part
      // of the hash). This schedules a second execution.
      // Advance past the second debounce — hash check should skip because
      // buildReportSpecFromAppState output hasn't changed.
      vi.advanceTimersByTime(400);
      expect(runReport).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('hash permits re-execution when content changes', () => {
      initStore({
        tables: { t_hash_change: makeTable('t_hash_change', 'Orders') },
        base: 't_hash_change',
      });
      initAutoPreview();

      // First change — filters with val 'x'
      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);
      vi.advanceTimersByTime(400);
      expect(runReport).toHaveBeenCalledTimes(1);

      // The result set triggered another schedulePreview (timer pending).
      // Before it fires, make a different change that resets the timer.
      vi.advanceTimersByTime(200); // Partial advance — timer still pending
      getStore().set('filters', [
        { col: 'B', op: 'contains', val: 'y', vals: null, enabled: true },
      ]);
      // Subscription fires, fingerprint changed, schedulePreview resets timer

      // Advance past the new debounce — hash differs, so runReport runs again
      vi.advanceTimersByTime(400);
      expect(runReport).toHaveBeenCalledTimes(2);
    });

    it('stores result via store.set', () => {
      initStore({
        tables: { t_result: makeTable('t_result', 'Orders') },
        base: 't_result',
      });
      initAutoPreview();

      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);
      vi.advanceTimersByTime(400);

      const result = getStore().getState().result;
      expect(result).toEqual(FAKE_RESULT);
    });

    it('calls refreshResultGridLayout', () => {
      initStore({
        tables: { t_grid: makeTable('t_grid', 'Orders') },
        base: 't_grid',
      });
      initAutoPreview();

      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);
      vi.advanceTimersByTime(400);

      expect(refreshResultGridLayout).toHaveBeenCalledTimes(1);
    });

    it('returns early when no base table configured', () => {
      initStore({
        tables: { t_nobase: makeTable('t_nobase', 'Orders') },
        base: '', // No base table selected
      });
      initAutoPreview();

      // Make a change — schedules execution, but executePreview returns early
      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);
      vi.advanceTimersByTime(400);

      expect(runReport).not.toHaveBeenCalled();
    });

    it('handles errors from runReport gracefully', () => {
      initStore({
        tables: { t_error: makeTable('t_error', 'Orders') },
        base: 't_error',
      });

      // First execution: runReport throws
      vi.mocked(runReport).mockImplementationOnce(() => {
        throw new Error('Engine failure');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      initAutoPreview();

      // Trigger execution — runReport throws, error is caught
      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'x', vals: null, enabled: true },
      ]);
      vi.advanceTimersByTime(400);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[auto-preview] Report execution failed:',
        expect.any(Error),
      );

      // _running should be reset in finally block — next schedule should work
      vi.mocked(runReport).mockImplementationOnce(() => FAKE_RESULT);

      // Make a different change to ensure hash differs from _lastHash
      getStore().set('filters', [
        { col: 'A', op: 'contains', val: 'z', vals: null, enabled: true },
      ]);
      vi.advanceTimersByTime(400);

      // runReport was called twice: once (threw) + once (succeeded)
      expect(runReport).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });
});
