import { describe, it, expect } from 'vitest';
import { deriveValidation } from '../../report/validation';
import type { AppState, DetailBandSpec } from '../../types';
import type { ColMapEntry } from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import { createAppState } from '../../core/state';

describe('validation — detail bands', () => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  const ordersCols = ['OrderId', 'Company', 'Contact', 'Status', 'Amount'];
  const lineItemsCols = ['ItemId', 'OrderId', 'Product', 'Qty', 'UnitPrice'];

  function makeSourceCatalog(): Map<string, SourceTableEntry> {
    return new Map([
      ['Orders', {
        id: 'Orders',
        name: 'Orders',
        cols: ordersCols,
        kind: 'imported',
        source: { id: 'Orders', name: 'Orders', cols: ordersCols, rowCount: 8 },
      }],
      ['LineItems', {
        id: 'LineItems',
        name: 'Line Items',
        cols: lineItemsCols,
        kind: 'imported',
        source: { id: 'LineItems', name: 'Line Items', cols: lineItemsCols, rowCount: 50 },
      }],
    ]);
  }

  function makeColMap(): Map<string, ColMapEntry> {
    const entries: [string, ColMapEntry][] = ordersCols.map(c => [c, { tid: 'Orders', col: c }]);
    return new Map(entries);
  }

  function baseState(overrides: Partial<AppState> = {}): AppState {
    return createAppState({
      tables: {
        Orders: { id: 'Orders', name: 'Orders', cols: ordersCols, rowCount: 8 },
        LineItems: { id: 'LineItems', name: 'Line Items', cols: lineItemsCols, rowCount: 50 },
      },
      base: 'Orders',
      ...overrides,
    });
  }

  function makeBand(overrides: Partial<DetailBandSpec> = {}): DetailBandSpec {
    return {
      id: 'band_0',
      rightId: 'LineItems',
      keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      cols: ['Product', 'Qty'],
      enabled: true,
      sorts: [],
      label: 'Line Items',
      ...overrides,
    };
  }

  // ── Missing table ──────────────────────────────────────────────────────

  it('should block when band child table is not loaded', () => {
    const state = baseState({
      detailBands: [makeBand({ rightId: 'NonExistent' })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.reportStatus).toBe('blocked');
    expect(result.items['detailband_0']).toBeDefined();
    expect(result.items['detailband_0'].blocking).toBe(true);
    expect(result.items['detailband_0'].issues.length).toBeGreaterThanOrEqual(1);
    expect(result.items['detailband_0'].issues[0].id).toBe('detailband_0_missing_table');
    // Uses band label when available, falling back to rightId
    expect(result.items['detailband_0'].issues[0].message).toContain('Line Items');
  });

  it('should fall back to rightId in message when label is empty and table missing', () => {
    const state = baseState({
      detailBands: [makeBand({ rightId: 'NonExistent', label: '' })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0'].blocking).toBe(true);
    expect(result.items['detailband_0'].issues[0].message).toContain('NonExistent');
  });

  it('should show "(none)" in message when rightId and label are both empty', () => {
    const state = baseState({
      detailBands: [makeBand({ rightId: '', label: '' })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0'].blocking).toBe(true);
    expect(result.items['detailband_0'].issues[0].message).toContain('(none)');
  });

  // ── Key pair validation ────────────────────────────────────────────────

  it('should block when key pair left column is not in projected cols', () => {
    const state = baseState({
      detailBands: [makeBand({
        keyPairs: [{ left: 'NonExistentCol', right: 'OrderId' }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.reportStatus).toBe('blocked');
    expect(result.items['detailband_0'].blocking).toBe(true);
    const leftIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_kp0_left',
    );
    expect(leftIssue).toBeDefined();
    expect(leftIssue!.message).toContain('NonExistentCol');
  });

  it('should block when key pair right column is not in child table', () => {
    const state = baseState({
      detailBands: [makeBand({
        keyPairs: [{ left: 'OrderId', right: 'NonExistentCol' }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.reportStatus).toBe('blocked');
    expect(result.items['detailband_0'].blocking).toBe(true);
    const rightIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_kp0_right',
    );
    expect(rightIssue).toBeDefined();
    expect(rightIssue!.message).toContain('NonExistentCol');
    expect(rightIssue!.message).toContain('Line Items');
  });

  it('should block when no complete key pair exists', () => {
    const state = baseState({
      detailBands: [makeBand({
        keyPairs: [{ left: '', right: 'OrderId' }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.reportStatus).toBe('blocked');
    expect(result.items['detailband_0'].blocking).toBe(true);
    const noKpIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_no_key_pairs',
    );
    expect(noKpIssue).toBeDefined();
    expect(noKpIssue!.message).toContain('Line Items');
  });

  it('should block when key pairs array is empty', () => {
    const state = baseState({
      detailBands: [makeBand({ keyPairs: [] })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0'].blocking).toBe(true);
    const noKpIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_no_key_pairs',
    );
    expect(noKpIssue).toBeDefined();
  });

  it('should pass with valid key pairs', () => {
    const state = baseState({
      detailBands: [makeBand({
        keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0']).toBeDefined();
    expect(result.items['detailband_0'].blocking).toBe(false);
    expect(result.items['detailband_0'].resolved).toBe(true);
  });

  // ── Multi-key validation ───────────────────────────────────────────────

  it('should validate each key pair independently', () => {
    const state = baseState({
      detailBands: [makeBand({
        keyPairs: [
          { left: 'OrderId', right: 'OrderId' },
          { left: 'BadLeft', right: 'BadRight' },
        ],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0'].blocking).toBe(true);
    // First pair is valid — no issues for kp0
    const kp0Left = result.items['detailband_0'].issues.find(i => i.id === 'detailband_0_kp0_left');
    const kp0Right = result.items['detailband_0'].issues.find(i => i.id === 'detailband_0_kp0_right');
    expect(kp0Left).toBeUndefined();
    expect(kp0Right).toBeUndefined();
    // Second pair is invalid — issues for kp1
    const kp1Left = result.items['detailband_0'].issues.find(i => i.id === 'detailband_0_kp1_left');
    const kp1Right = result.items['detailband_0'].issues.find(i => i.id === 'detailband_0_kp1_right');
    expect(kp1Left).toBeDefined();
    expect(kp1Right).toBeDefined();
  });

  // ── Sort column validation (warning severity) ─────────────────────────

  it('should warn (not block) when sort column is not in child table', () => {
    const state = baseState({
      detailBands: [makeBand({
        sorts: [{ col: 'NonExistentSort', dir: 'ASC', enabled: true }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    // Should NOT block — sort issues are warnings
    expect(result.items['detailband_0'].blocking).toBe(false);
    expect(result.items['detailband_0'].resolved).toBe(true);
    const sortIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_sort_0_missing',
    );
    expect(sortIssue).toBeDefined();
    expect(sortIssue!.severity).toBe('warning');
    expect(sortIssue!.message).toContain('NonExistentSort');
  });

  it('should not warn for disabled sort entries', () => {
    const state = baseState({
      detailBands: [makeBand({
        sorts: [{ col: 'NonExistentSort', dir: 'ASC', enabled: false }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0'].issues.length).toBe(0);
  });

  it('should pass when sort column exists in child table', () => {
    const state = baseState({
      detailBands: [makeBand({
        sorts: [{ col: 'Product', dir: 'ASC', enabled: true }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0'].issues.length).toBe(0);
  });

  // ── Disabled bands ────────────────────────────────────────────────────

  it('should not block when band is disabled even with issues', () => {
    const state = baseState({
      detailBands: [makeBand({
        rightId: 'NonExistent',
        enabled: false,
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0']).toBeDefined();
    expect(result.items['detailband_0'].enabled).toBe(false);
    expect(result.items['detailband_0'].blocking).toBe(false);
  });

  // ── Card mapping ──────────────────────────────────────────────────────

  it('should map detailband items to pipeline card', () => {
    const state = baseState({
      detailBands: [makeBand({ rightId: 'NonExistent' })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.cards['pipeline']).toBeDefined();
    expect(result.cards['pipeline'].status).toBe('blocked');
    const pipelineIssue = result.cards['pipeline'].issues.find(
      i => i.id === 'detailband_0_missing_table',
    );
    expect(pipelineIssue).toBeDefined();
  });

  // ── Multiple bands ────────────────────────────────────────────────────

  it('should validate multiple bands independently', () => {
    const state = baseState({
      detailBands: [
        makeBand({ id: 'band_0', rightId: 'LineItems', keyPairs: [{ left: 'OrderId', right: 'OrderId' }] }),
        makeBand({ id: 'band_1', rightId: 'Missing' }),
      ],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    // First band is valid
    expect(result.items['detailband_0'].blocking).toBe(false);
    // Second band is blocked
    expect(result.items['detailband_1'].blocking).toBe(true);
    expect(result.items['detailband_1'].issues[0].id).toBe('detailband_1_missing_table');
  });

  // ── Empty detailBands ─────────────────────────────────────────────────

  it('should produce no band items when detailBands is empty', () => {
    const state = baseState({ detailBands: [] });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    const bandItems = Object.keys(result.items).filter(k => k.startsWith('detailband_'));
    expect(bandItems.length).toBe(0);
    expect(result.reportStatus).toBe('healthy');
  });

  // ── Key pair skipped when base not ok ─────────────────────────────────

  it('should only report missing table when base table is also missing', () => {
    const state = baseState({
      base: 'NonExistentBase',
      detailBands: [makeBand({ rightId: 'LineItems' })],
    });
    // baseOk is false, so key pair validation is skipped;
    // but ct (LineItems) exists, so missing_table is NOT emitted either.
    // The band item should be resolved since no issues are generated.
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    expect(result.items['detailband_0']).toBeDefined();
    // base is blocked but band_0 itself has no issues (key pair validation skipped)
    expect(result.items['detailband_0'].issues.length).toBe(0);
  });

  // ── Label in validation messages ──────────────────────────────────────

  it('should use band label instead of table name in "no key pairs" message', () => {
    const state = baseState({
      detailBands: [makeBand({
        label: 'My Custom Label',
        keyPairs: [{ left: '', right: 'OrderId' }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    const noKpIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_no_key_pairs',
    );
    expect(noKpIssue).toBeDefined();
    expect(noKpIssue!.message).toContain('My Custom Label');
    expect(noKpIssue!.message).not.toContain('Line Items');
  });

  it('should fall back to table name when label is empty in "no key pairs" message', () => {
    const state = baseState({
      detailBands: [makeBand({
        label: '',
        keyPairs: [{ left: '', right: 'OrderId' }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    const noKpIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_no_key_pairs',
    );
    expect(noKpIssue).toBeDefined();
    expect(noKpIssue!.message).toContain('Line Items');
  });

  it('should use band label in "right column not found" message', () => {
    const state = baseState({
      detailBands: [makeBand({
        label: 'Custom Band Name',
        keyPairs: [{ left: 'OrderId', right: 'BadCol' }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    const rightIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_kp0_right',
    );
    expect(rightIssue).toBeDefined();
    expect(rightIssue!.message).toContain('Custom Band Name');
    expect(rightIssue!.message).not.toContain('Line Items');
  });

  it('should use band label in sort column warning message', () => {
    const state = baseState({
      detailBands: [makeBand({
        label: 'Sorted Items',
        sorts: [{ col: 'BadSortCol', dir: 'ASC', enabled: true }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    const sortIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_sort_0_missing',
    );
    expect(sortIssue).toBeDefined();
    expect(sortIssue!.message).toContain('Sorted Items');
    expect(sortIssue!.message).not.toContain('Line Items');
  });

  it('should ignore whitespace-only label and fall back to table name', () => {
    const state = baseState({
      detailBands: [makeBand({
        label: '   ',
        keyPairs: [{ left: '', right: 'OrderId' }],
      })],
    });
    const result = deriveValidation(state, ordersCols, makeColMap(), makeSourceCatalog());
    const noKpIssue = result.items['detailband_0'].issues.find(
      i => i.id === 'detailband_0_no_key_pairs',
    );
    expect(noKpIssue).toBeDefined();
    expect(noKpIssue!.message).toContain('Line Items');
  });
});
