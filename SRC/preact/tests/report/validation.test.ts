import { describe, it, expect, beforeEach } from 'vitest';
import { deriveValidation, invalidateValidation, getValidation } from '../../report/validation';
import type { AppState } from '../../types';
import type { ColMapEntry } from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import { createAppState } from '../../core/state';
import { initStore } from '../../core/store';

describe('validation', () => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  const ordersCols = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];

  function ordersSourceCatalog(): Map<string, SourceTableEntry> {
    return new Map([
      ['Orders', {
        id: 'Orders',
        name: 'Orders',
        cols: ordersCols,
        kind: 'imported',
        source: { id: 'Orders', name: 'Orders', cols: ordersCols, rowCount: 8 },
      }],
      ['Contacts', {
        id: 'Contacts',
        name: 'Contacts',
        cols: ['ContactId', 'Name', 'Email', 'Phone'],
        kind: 'imported',
        source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 5 },
      }],
    ]);
  }

  function ordersColMap(): Map<string, ColMapEntry> {
    return new Map(ordersCols.map(c => [c, { tid: 'Orders', col: c }]));
  }

  function baseState(overrides: Partial<AppState> = {}): AppState {
    return createAppState({
      tables: {
        Orders: { id: 'Orders', name: 'Orders', cols: ordersCols, rowCount: 8 },
        Contacts: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 5 },
      },
      base: 'Orders',
      ...overrides,
    });
  }

  // ── deriveValidation ─────────────────────────────────────────────────────

  describe('deriveValidation()', () => {
    it('should return healthy for valid base, lookups, and filters', () => {
      const state = baseState();
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('healthy');
    });

    it('should block when base table is missing', () => {
      const state = baseState({ base: 'NonExistent' });
      const result = deriveValidation(state, [], ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['base'].blocking).toBe(true);
    });

    it('should block when stack table is missing', () => {
      const state = baseState({ stacks: ['MissingSheet'] });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['stack_0'].blocking).toBe(true);
    });

    it('should block when lookup table is missing', () => {
      const state = baseState({
        lookups: [{
          rightId: 'NonExistent',
          keyPairs: [{ left: 'Contact', right: 'ContactId' }],
          cols: ['Name'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['lookup_0'].blocking).toBe(true);
    });

    it('should block lookup with no key pairs', () => {
      const state = baseState({
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [],
          cols: ['Name'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['lookup_0'].blocking).toBe(true);
    });

    it('should block calc stage with empty alias', () => {
      const state = baseState({
        calcStages: [{
          alias: '',
          mode: 'math',
          math: { strategy: 'stepChain', steps: [{ type: 'number', value: '1' }] },
          enabled: true,
        }],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['calc_0'].blocking).toBe(true);
    });

    it('should block calc stage with unresolved column', () => {
      const state = baseState({
        calcStages: [{
          alias: 'NonExistent',
          mode: 'math',
          math: { strategy: 'stepChain', steps: [{ type: 'number', value: '1' }] },
          enabled: true,
        }],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['calc_0'].blocking).toBe(true);
    });

    it('should block filter with missing column', () => {
      const state = baseState({
        filters: [{
          col: 'NonExistent',
          op: '=',
          val: 'X',
          vals: ['X'],
          enabled: true,
        }],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['filter_0'].blocking).toBe(true);
    });

    it('should block sort with missing column', () => {
      const state = baseState({
        sorts: [{
          col: 'NonExistent',
          dir: 'ASC',
          enabled: true,
        }],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['sort_0'].blocking).toBe(true);
    });

    it('should block group mode with missing groupBy column', () => {
      const state = baseState({
        aggMode: 'group',
        groupBy: ['NonExistent'],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['groupby_0'].blocking).toBe(true);
    });

    it('should block group mode with invalid aggregate function', () => {
      const state = baseState({
        aggMode: 'group',
        groupBy: ['Company'],
        aggregates: [{
          col: 'Amount',
          fn: 'INVALID_FN',
          alias: 'Total',
          enabled: true,
        }],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['agg_0'].blocking).toBe(true);
    });

    it('should block totals mode with missing totals column', () => {
      const state = baseState({
        aggMode: 'totals',
        colTotals: { NonExistent: 'SUM' },
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['totals_NonExistent'].blocking).toBe(true);
    });

    it('should block totals mode with invalid totals function', () => {
      const state = baseState({
        aggMode: 'totals',
        colTotals: { Amount: 'INVALID_FN' },
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['totals_Amount'].blocking).toBe(true);
    });

    it('should block subtotals mode with invalid strategy', () => {
      const state = baseState({
        aggMode: 'subtotals',
        subtotalStrategy: 'invalid',
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['subtotalStrategy'].blocking).toBe(true);
    });

    it('should block subtotals mode with missing subtotalBy column', () => {
      const state = baseState({
        aggMode: 'subtotals',
        subtotalBy: ['NonExistent'],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      expect(result.items['subtotalby_0'].blocking).toBe(true);
    });

    it('should block stale output columns in colOrder', () => {
      const state = baseState({
        colOrder: ['OrderId', 'StaleColumn'],
        selCols: new Set(['OrderId', 'StaleColumn']),
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.reportStatus).toBe('blocked');
      // StaleColumn is not in projected cols or output aliases
      expect(result.items['colorder_StaleColumn'].blocking).toBe(true);
    });

    it('should assign cards correctly for pipeline items', () => {
      const state = baseState();
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.cards['pipeline']).toBeDefined();
      expect(result.cards['pipeline'].status).toBe('healthy');
    });

    it('should assign cards correctly for filterSort items', () => {
      const state = baseState({
        filters: [{
          col: 'Status',
          op: '=',
          val: 'Open',
          vals: ['Open'],
          enabled: true,
        }],
        sorts: [{
          col: 'Amount',
          dir: 'DESC',
          enabled: true,
        }],
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.cards['filterSort']).toBeDefined();
      expect(result.cards['filterSort'].status).toBe('healthy');
    });

    it('should assign cards correctly for aggregation items', () => {
      const state = baseState({
        aggMode: 'totals',
        colTotals: { Amount: 'SUM' },
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.cards['aggregation']).toBeDefined();
      expect(result.cards['aggregation'].status).toBe('healthy');
    });

    it('should assign cards correctly for outputColumns items', () => {
      const state = baseState({
        colOrder: ['StaleCol'],
        selCols: new Set(['StaleCol']),
      });
      const result = deriveValidation(state, ordersCols, ordersColMap(), ordersSourceCatalog());
      expect(result.cards['outputColumns']).toBeDefined();
      expect(result.cards['outputColumns'].status).toBe('blocked');
    });
  });

  // ── invalidateValidation / getValidation ─────────────────────────────────

  describe('invalidateValidation / getValidation', () => {
    beforeEach(() => {
      initStore();
      invalidateValidation();
    });

    it('should invalidate cache and recompute on next getValidation', () => {
      // First call should compute
      const result1 = getValidation();
      expect(result1).toBeTruthy();

      // Invalidate
      invalidateValidation();

      // Second call should recompute (may produce same result but is a fresh computation)
      const result2 = getValidation();
      expect(result2).toBeTruthy();
      expect(result2.reportStatus).toBeDefined();
    });
  });
});
