/**
 * Integration tests — state loading pipeline: .rcjson payload → validate → hydrate → apply → verify state.
 *
 * Tests the full state loading chain: isRecognizableConfig, hydrateState,
 * applyState, and round-trip consistency.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isRecognizableConfig } from '../../core/state-schema';
import { hydrateState } from '../../core/state-hydrator';
import { applyState } from '../../core/state-applier';
import { initStore, getStore } from '../../core/store';
import type { DbTable } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Standard Orders table metadata (matches vitest-setup.ts data). */
const ordersTable: DbTable = {
  id: 'Orders',
  name: 'Orders',
  cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
  rowCount: 8,
};

/** Standard Contacts table metadata. */
const contactsTable: DbTable = {
  id: 'Contacts',
  name: 'Contacts',
  cols: ['ContactId', 'Name', 'Email', 'Phone'],
  rowCount: 5,
};

/** Loaded tables record. */
function loadedTables(extra?: Record<string, DbTable>): Record<string, DbTable> {
  return { Orders: ordersTable, Contacts: contactsTable, ...extra };
}

/** Minimal valid .rcjson payload referencing Orders. */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    base: 'Orders',
    aggMode: 'none',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Integration: State Loading', () => {
  beforeEach(() => {
    // Reset store singleton between tests
    initStore();
  });

  // ── isRecognizableConfig ─────────────────────────────────────────────────

  describe('isRecognizableConfig', () => {
    it('should return true for a valid config with 2+ recognizable keys', () => {
      const payload = validPayload(); // has 'base' and 'aggMode'
      expect(isRecognizableConfig(payload)).toBe(true);
    });

    it('should return true for a config with many recognizable keys', () => {
      const payload = validPayload({
        baseCols: [],
        stacks: [],
        lookups: [],
        filters: [],
        sorts: [],
        aggregates: [],
        colTotals: {},
        groupBy: [],
      });
      expect(isRecognizableConfig(payload)).toBe(true);
    });

    it('should return false for a non-object payload', () => {
      expect(isRecognizableConfig(null)).toBe(false);
      expect(isRecognizableConfig(undefined)).toBe(false);
      expect(isRecognizableConfig('string')).toBe(false);
      expect(isRecognizableConfig(42)).toBe(false);
    });

    it('should return false for an array', () => {
      expect(isRecognizableConfig([])).toBe(false);
      expect(isRecognizableConfig([{ base: 'Orders' }])).toBe(false);
    });

    it('should return false for an object with fewer than 2 recognizable keys', () => {
      // Only 'base' — 1 key is not enough
      expect(isRecognizableConfig({ base: 'Orders' })).toBe(false);
      // No recognizable keys
      expect(isRecognizableConfig({ foo: 'bar', baz: 42 })).toBe(false);
    });
  });

  // ── hydrateState ─────────────────────────────────────────────────────────

  describe('hydrateState', () => {
    it('should hydrate a valid config with matching tables and produce no brokenRefs', () => {
      const payload = validPayload({
        baseCols: ['OrderId', 'Company', 'Amount'],
        aggMode: 'none',
      });
      const { next, brokenRefs } = hydrateState(payload, loadedTables());

      expect(next['base']).toBe('Orders');
      expect(next['aggMode']).toBe('none');
      expect(next['baseCols']).toEqual(['OrderId', 'Company', 'Amount']);
      // No broken refs since Orders is loaded and columns exist
      expect(brokenRefs).toEqual([]);
    });

    it('should report brokenRef when base table is not loaded', () => {
      const payload = validPayload({ base: 'NonExistent' });
      const { next, brokenRefs } = hydrateState(payload, loadedTables());

      expect(next['base']).toBe('NonExistent');
      expect(brokenRefs.length).toBeGreaterThan(0);
      expect(brokenRefs.some(r => r.includes('NonExistent'))).toBe(true);
    });

    it('should report brokenRef when stacked table is not loaded', () => {
      const payload = validPayload({ stacks: ['MissingTable'] });
      const { brokenRefs } = hydrateState(payload, loadedTables());

      expect(brokenRefs.some(r => r.includes('MissingTable'))).toBe(true);
    });

    it('should report brokenRef when lookup references a missing table', () => {
      const payload = validPayload({
        lookups: [{
          rightId: 'GhostTable',
          keyPairs: [{ left: 'Company', right: 'Name' }],
          cols: ['Name'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const { brokenRefs } = hydrateState(payload, loadedTables());

      expect(brokenRefs.some(r => r.includes('GhostTable'))).toBe(true);
    });

    it('should hydrate filters, sorts, groupBy, aggregates', () => {
      const payload = validPayload({
        filters: [{ col: 'Company', op: '=', vals: ['Acme Corp'], enabled: true }],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
        groupBy: ['Company'],
        aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'Total' }],
        aggMode: 'group',
      });
      const { next } = hydrateState(payload, loadedTables());

      expect(next['filters']).toEqual([
        { col: 'Company', op: '=', vals: ['Acme Corp'], enabled: true },
      ]);
      expect(next['sorts']).toEqual([
        { col: 'Amount', dir: 'DESC', enabled: true },
      ]);
      expect(next['groupBy']).toEqual(['Company']);
      expect(next['aggregates']).toEqual([{ fn: 'SUM', col: 'Amount', alias: 'Total' }]);
      expect(next['aggMode']).toBe('group');
    });

    it('should hydrate excludedRows into nextExcludedRows as Sets', () => {
      const payload = validPayload({
        excludedRows: { Orders: [0, 2, 4] },
      });
      const { nextExcludedRows } = hydrateState(payload, loadedTables());

      expect(nextExcludedRows['Orders']).toBeInstanceOf(Set);
      expect(nextExcludedRows['Orders'].size).toBe(3);
      expect(nextExcludedRows['Orders'].has(0)).toBe(true);
      expect(nextExcludedRows['Orders'].has(2)).toBe(true);
      expect(nextExcludedRows['Orders'].has(4)).toBe(true);
    });

    it('should hydrate tableColors and columnLabels', () => {
      const payload = validPayload({
        tableColors: { Orders: '#ff0000' },
        columnLabels: { Orders: { Company: 'Client' } },
      });
      const { next } = hydrateState(payload, loadedTables());

      expect(next['tableColors']).toEqual({ Orders: '#ff0000' });
      expect(next['columnLabels']).toEqual({ Orders: { Company: 'Client' } });
    });


  });

  // ── applyState ───────────────────────────────────────────────────────────

  describe('applyState', () => {
    it('should apply hydrated state to the store', () => {
      const payload = validPayload({
        baseCols: ['OrderId', 'Company'],
        aggMode: 'none',
        tableColors: { Orders: '#00ff00' },
      });
      const { next, nextExcludedRows } = hydrateState(payload, loadedTables());

      applyState(next, nextExcludedRows);

      const state = getStore().getState();
      expect(state.base).toBe('Orders');
      expect(state.baseCols).toEqual(['OrderId', 'Company']);
      expect(state.aggMode).toBe('none');
      expect(state.tableColors).toEqual({ Orders: '#00ff00' });
    });

    it('should apply excludedRows to the store', () => {
      const payload = validPayload({
        excludedRows: { Orders: [1, 3] },
      });
      const { next, nextExcludedRows } = hydrateState(payload, loadedTables());

      applyState(next, nextExcludedRows);

      const state = getStore().getState();
      expect(state.excludedRows['Orders']).toBeInstanceOf(Set);
      expect(state.excludedRows['Orders'].has(1)).toBe(true);
      expect(state.excludedRows['Orders'].has(3)).toBe(true);
    });

    it('should apply filters and sorts to the store', () => {
      const payload = validPayload({
        filters: [{ col: 'Status', op: '=', vals: ['Open'], enabled: true }],
        sorts: [{ col: 'Amount', dir: 'ASC', enabled: true }],
      });
      const { next, nextExcludedRows } = hydrateState(payload, loadedTables());

      applyState(next, nextExcludedRows);

      const state = getStore().getState();
      expect(state.filters).toHaveLength(1);
      expect(state.filters[0].col).toBe('Status');
      expect(state.sorts).toHaveLength(1);
      expect(state.sorts[0].col).toBe('Amount');
    });
  });

  // ── Round-trip ───────────────────────────────────────────────────────────

  describe('round-trip', () => {
    it('should survive hydrate → apply and produce consistent state', () => {
      // 1. Build a payload that represents a saved report configuration
      const originalPayload = validPayload({
        baseCols: ['OrderId', 'Company', 'Amount'],
        stacks: [],
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'ContactId' }],
          cols: ['Name', 'Email'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
        calcStages: [],
        filters: [{ col: 'Status', op: '=', vals: ['Open'], enabled: true }],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
        groupBy: [],
        aggregates: [],
        aggMode: 'none',
        colTotals: {},
        subtotalBy: [],
        subtotalFns: {},
        subtotalGrandTotal: true,
        subtotalSpacer: false,
        subtotalOnTop: false,
        subtotalStrategy: 'combined',
        tableColors: { Orders: '#3366cc', Contacts: '#dc3912' },
        columnLabels: { Orders: { Amount: 'Total' } },
        mergedCols: [],
        mergeGroupUnderline: false,
      });

      // 2. Hydrate
      const { next, brokenRefs, nextExcludedRows } = hydrateState(originalPayload, loadedTables());
      expect(brokenRefs).toEqual([]);

      // 3. Apply to store
      applyState(next, nextExcludedRows);

      // 4. Verify store state matches the original payload
      const state = getStore().getState();
      expect(state.base).toBe('Orders');
      expect(state.baseCols).toEqual(['OrderId', 'Company', 'Amount']);
      expect(state.aggMode).toBe('none');
      expect(state.filters).toHaveLength(1);
      expect(state.filters[0].col).toBe('Status');
      expect(state.filters[0].op).toBe('=');
      expect(state.sorts).toHaveLength(1);
      expect(state.sorts[0].col).toBe('Amount');
      expect(state.sorts[0].dir).toBe('DESC');
      expect(state.tableColors).toEqual({ Orders: '#3366cc', Contacts: '#dc3912' });
      expect(state.columnLabels).toEqual({ Orders: { Amount: 'Total' } });

      // 5. Now re-serialize the relevant state fields and re-hydrate
      //    to verify round-trip consistency
      const rePayload: Record<string, unknown> = {
        base: state.base,
        baseCols: state.baseCols,
        stacks: state.stacks,
        lookups: state.lookups,
        calcStages: state.calcStages,
        filters: state.filters,
        sorts: state.sorts,
        groupBy: state.groupBy,
        aggregates: state.aggregates,
        aggMode: state.aggMode,
        colTotals: state.colTotals,
        subtotalBy: state.subtotalBy,
        subtotalFns: state.subtotalFns,
        subtotalGrandTotal: state.subtotalGrandTotal,
        subtotalSpacer: state.subtotalSpacer,
        subtotalOnTop: state.subtotalOnTop,
        subtotalStrategy: state.subtotalStrategy,
        tableColors: state.tableColors,
        columnLabels: state.columnLabels,
        mergedCols: state.mergedCols,
        mergeGroupUnderline: state.mergeGroupUnderline,
      };

      // Re-init store and re-apply
      initStore();
      const { next: next2, brokenRefs: brokenRefs2, nextExcludedRows: nextExcludedRows2 } =
        hydrateState(rePayload, loadedTables());
      expect(brokenRefs2).toEqual([]);
      applyState(next2, nextExcludedRows2);

      const state2 = getStore().getState();
      expect(state2.base).toBe('Orders');
      expect(state2.baseCols).toEqual(['OrderId', 'Company', 'Amount']);
      expect(state2.filters).toHaveLength(1);
      expect(state2.filters[0].col).toBe('Status');
      expect(state2.sorts).toHaveLength(1);
      expect(state2.sorts[0].col).toBe('Amount');
      expect(state2.tableColors).toEqual({ Orders: '#3366cc', Contacts: '#dc3912' });
    });

    it('should preserve group aggregation config through round-trip', () => {
      const payload = validPayload({
        aggMode: 'group',
        groupBy: ['Company'],
        aggregates: [{ fn: 'SUM', col: 'Amount', alias: 'TotalAmount' }],
      });

      const { next, nextExcludedRows } = hydrateState(payload, loadedTables());
      applyState(next, nextExcludedRows);

      const state = getStore().getState();
      expect(state.aggMode).toBe('group');
      expect(state.groupBy).toEqual(['Company']);
      expect(state.aggregates).toHaveLength(1);
      expect(state.aggregates[0].fn).toBe('SUM');
      expect(state.aggregates[0].col).toBe('Amount');
      expect(state.aggregates[0].alias).toBe('TotalAmount');
    });
  });
});
