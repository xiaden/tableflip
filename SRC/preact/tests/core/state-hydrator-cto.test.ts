/**
 * Unit tests — state hydrator: hydrateState() columnTypeOverrides hydration.
 *
 * Tests that columnTypeOverrides is correctly hydrated from a .rcjson payload,
 * handles missing/null/invalid values gracefully, and round-trips through
 * buildPayload → hydrateState without data loss.
 */
import { describe, it, expect } from 'vitest';
import { hydrateState } from '../../core/state-hydrator';
import { buildPayload } from '../../core/state-serializer';
import { createAppState } from '../../core/state';
import type { DbTable, ColumnType } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Standard Orders table metadata. */
const ordersTable: DbTable = {
  id: 'Orders',
  name: 'Orders',
  cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
  rowCount: 8,
};

/** Loaded tables record with Orders. */
function loadedTables(): Record<string, DbTable> {
  return { Orders: ordersTable };
}

/** Minimal valid .rcjson payload referencing Orders. */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    base: 'Orders',
    aggMode: 'none',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('hydrateState — columnTypeOverrides', () => {
  it('should default to {} when payload has no columnTypeOverrides', () => {
    const payload = validPayload();
    const { next } = hydrateState(payload, loadedTables());

    expect(next.columnTypeOverrides).toEqual({});
  });

  it('should default to {} when columnTypeOverrides is null', () => {
    const payload = validPayload({ columnTypeOverrides: null });
    const { next } = hydrateState(payload, loadedTables());

    expect(next.columnTypeOverrides).toEqual({});
  });

  it('should hydrate valid overrides correctly', () => {
    const payload = validPayload({
      columnTypeOverrides: {
        table1: { colA: 'number', colB: 'string' },
        table2: { colC: 'date' },
      },
    });
    const { next } = hydrateState(payload, loadedTables());

    expect(next.columnTypeOverrides).toEqual({
      table1: { colA: 'number', colB: 'string' },
      table2: { colC: 'date' },
    });
  });

  it('should default to {} when columnTypeOverrides is a non-object value', () => {
    const payload = validPayload({ columnTypeOverrides: 'invalid' });
    const { next } = hydrateState(payload, loadedTables());

    expect(next.columnTypeOverrides).toEqual({});
  });

  it('should round-trip through buildPayload then hydrateState', () => {
    const overrides: Record<string, Record<string, ColumnType>> = {
      table1: { colA: 'number', colB: 'string' },
      table2: { colC: 'date' },
    };
    const state = createAppState({
      base: 'Orders',
      columnTypeOverrides: overrides,
    });

    const payload = buildPayload(state);
    const { next } = hydrateState(payload, loadedTables());

    expect(next.columnTypeOverrides).toEqual(overrides);
  });
});
