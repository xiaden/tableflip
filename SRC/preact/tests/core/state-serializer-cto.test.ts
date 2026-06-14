/**
 * Unit tests — state serializer: buildPayload() columnTypeOverrides serialization.
 *
 * Tests that columnTypeOverrides is correctly deep-cloned into the payload,
 * survives JSON round-trip, and does not share references with the source state.
 */
import { describe, it, expect } from 'vitest';
import { buildPayload } from '../../core/state-serializer';
import { createAppState } from '../../core/state';
import type { ColumnType } from '../../types';

describe('buildPayload — columnTypeOverrides', () => {
  it('should serialize default empty columnTypeOverrides as {}', () => {
    const state = createAppState({ base: 'Orders' });
    const payload = buildPayload(state);

    expect(payload.columnTypeOverrides).toEqual({});
  });

  it('should serialize populated overrides with multiple tables and columns', () => {
    const state = createAppState({
      base: 'Orders',
      columnTypeOverrides: {
        table1: { colA: 'number', colB: 'string' },
        table2: { colC: 'date' },
      },
    });
    const payload = buildPayload(state);

    expect(payload.columnTypeOverrides).toEqual({
      table1: { colA: 'number', colB: 'string' },
      table2: { colC: 'date' },
    });
  });

  it('should deep clone columnTypeOverrides so mutations do not affect the original state', () => {
    const state = createAppState({
      base: 'Orders',
      columnTypeOverrides: {
        table1: { colA: 'number' },
      },
    });
    const payload = buildPayload(state);

    // Mutate the returned payload's columnTypeOverrides
    const cto = payload.columnTypeOverrides as Record<string, Record<string, string>>;
    cto.table1.colB = 'string';
    cto.table2 = { colX: 'date' };

    // Original state must be unaffected
    expect(state.columnTypeOverrides).toEqual({
      table1: { colA: 'number' },
    });
  });

  it('should survive JSON stringify/parse round-trip', () => {
    const overrides: Record<string, Record<string, ColumnType>> = {
      table1: { colA: 'number', colB: 'string' },
      table2: { colC: 'date' },
    };
    const state = createAppState({
      base: 'Orders',
      columnTypeOverrides: overrides,
    });
    const payload = buildPayload(state);

    const json = JSON.stringify(payload);
    const parsed = JSON.parse(json);

    expect(parsed.columnTypeOverrides).toEqual(overrides);
  });
});
