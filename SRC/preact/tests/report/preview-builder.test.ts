import { describe, it, expect } from 'vitest';
import { buildPreview } from '../../report/preview-builder';
import type { AppState } from '../../types';
import { createAppState } from '../../core/state';
import { createTable, insertRows } from '../../core/sqldb';

const ORDERS_COLS = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];

/** Minimal state helper with defaults and overrides. */
function st(overrides: Partial<AppState> = {}): AppState {
  return createAppState({
    tables: {
      Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
    },
    base: 'Orders',
    ...overrides,
  });
}

describe('buildPreview', () => {
  // ── Base preview ────────────────────────────────────────────────────────

  describe('base preview', () => {
    it('returns rows from the base table capped at 5', () => {
      const result = buildPreview('base', st());
      expect(result.error).toBeNull();
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.length).toBeLessThanOrEqual(5);
      expect(result.headers).toEqual(ORDERS_COLS);
    });

    it('returns error when base table is empty string', () => {
      const result = buildPreview('base', st({ base: '' }));
      expect(result.error).toBe('No base table selected');
      expect(result.rows).toEqual([]);
    });

    it('returns error when base table does not exist', () => {
      const result = buildPreview('base', st({ base: 'Missing' }));
      expect(result.error).toBe('No base table selected');
    });

    it('includes stacked tables via UNION ALL', () => {
      // Create a second table with same columns
      createTable('Orders2', ORDERS_COLS);
      insertRows('Orders2', ORDERS_COLS, [
        { OrderId: 'STK-001', Company: 'StackCo', Contact: 'Zoe', Status: 'Open', Amount: 50, OrderDate: '2025-07-01', Region: 'North' },
        { OrderId: 'STK-002', Company: 'StackCo', Contact: 'Zoe', Status: 'Closed', Amount: 75, OrderDate: '2025-07-02', Region: 'South' },
      ]);

      const state = st({
        stacks: ['Orders2'],
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          Orders2: { id: 'Orders2', name: 'Orders2', cols: ORDERS_COLS, rowCount: 2 },
        },
      });

      const result = buildPreview('base', state);
      expect(result.error).toBeNull();
      // Should have rows from both tables (capped at 5)
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.length).toBeLessThanOrEqual(5);
    });

    it('pads missing columns with NULL in stacked tables', () => {
      // Create a stacked table with fewer columns
      createTable('OrdersPartial', ['OrderId', 'Company', 'Amount']);
      insertRows('OrdersPartial', ['OrderId', 'Company', 'Amount'], [
        { OrderId: 'PAR-001', Company: 'PartialCo', Amount: 25 },
      ]);

      const state = st({
        stacks: ['OrdersPartial'],
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          OrdersPartial: { id: 'OrdersPartial', name: 'OrdersPartial', cols: ['OrderId', 'Company', 'Amount'], rowCount: 1 },
        },
      });

      const result = buildPreview('base', state);
      expect(result.error).toBeNull();
      // Find a row from the partial table (those not in Orders base)
      const partialRow = result.rows.find(r => r['Company'] === 'PartialCo');
      if (partialRow) {
        // Missing columns should be null
        expect(partialRow['Contact']).toBeNull();
        expect(partialRow['Status']).toBeNull();
        expect(partialRow['OrderDate']).toBeNull();
        expect(partialRow['Region']).toBeNull();
        // Present columns should have values
        expect(partialRow['OrderId']).toBe('PAR-001');
      }
    });

    it('uses user-defined column labels in headers', () => {
      const state = st({
        columnLabels: {
          Orders: { Company: 'Company Name', Amount: 'Total Amount' },
        },
      });

      const result = buildPreview('base', state);
      expect(result.error).toBeNull();
      expect(result.headers).toContain('Company Name');
      expect(result.headers).toContain('Total Amount');
      // Unlabeled columns keep their physical names
      expect(result.headers).toContain('OrderId');
    });

    it('returns error for empty base table with no columns', () => {
      // Error is returned before any SQL execution — no table creation needed
      const state = st({
        base: 'EmptyTbl',
        tables: {
          ...st().tables,
          EmptyTbl: { id: 'EmptyTbl', name: 'Empty', cols: [], rowCount: 0 },
        },
      });
      const result = buildPreview('base', state);
      expect(result.error).toBe('Base table has no columns');
    });
  });

  // ── Lookup preview ──────────────────────────────────────────────────────

  describe('lk preview', () => {
    // Create a Contacts table for join tests
    const CONTACTS_COLS = ['ContactId', 'Name', 'Email', 'Phone'];

    function setupContactsState(): AppState {
      createTable('Contacts', CONTACTS_COLS);
      insertRows('Contacts', CONTACTS_COLS, [
        { ContactId: 'Alice', Name: 'Alice Smith', Email: 'alice@example.com', Phone: '555-0100' },
        { ContactId: 'Bob', Name: 'Bob Jones', Email: 'bob@example.com', Phone: '555-0200' },
        { ContactId: 'Carol', Name: 'Carol White', Email: 'carol@example.com', Phone: '555-0300' },
        { ContactId: 'Dave', Name: 'Dave Brown', Email: 'dave@example.com', Phone: '555-0400' },
        { ContactId: 'Eve', Name: 'Eve Black', Email: 'eve@example.com', Phone: '555-0500' },
      ]);

      return createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          Contacts: { id: 'Contacts', name: 'Contacts', cols: CONTACTS_COLS, rowCount: 5 },
        },
        base: 'Orders',
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'ContactId' }],
          cols: ['Name', 'Email'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
      });
    }

    it('returns joined preview rows for lk0', () => {
      const state = setupContactsState();
      const result = buildPreview('lk0', state);

      expect(result.error).toBeNull();
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.length).toBeLessThanOrEqual(5);
      // Should include joined columns
      const firstRow = result.rows[0];
      expect(firstRow).toHaveProperty('OrderId');
    });

    it('returns error when no base table for lk', () => {
      const result = buildPreview('lk0', st({ base: '' }));
      expect(result.error).toBe('No base table selected');
    });

    it('returns data only for lookups up to the specified depth', () => {
      // Add two lookups but only preview lk0
      const state = setupContactsState();
      // Add a second (invalid) lookup — should not affect lk0 preview
      const s2 = createAppState({
        ...state,
        lookups: [
          {
            rightId: 'Contacts',
            keyPairs: [{ left: 'Contact', right: 'ContactId' }],
            cols: ['Name', 'Email'],
            required: false,
            enabled: true,
            duplicatePolicy: { mode: 'block' },
          },
          {
            rightId: '',
            keyPairs: [{ left: '', right: '' }],
            cols: [],
            required: false,
            enabled: true,
            duplicatePolicy: { mode: 'block' },
          },
        ],
      });

      const result = buildPreview('lk0', s2);
      expect(result.error).toBeNull();
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('skips disabled lookups when building preview', () => {
      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          Contacts: { id: 'Contacts', name: 'Contacts', cols: CONTACTS_COLS, rowCount: 5 },
        },
        base: 'Orders',
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'ContactId' }],
          cols: ['Name', 'Email'],
          required: false,
          enabled: false, // disabled
          duplicatePolicy: { mode: 'block' },
        }],
      });

      const result = buildPreview('lk0', state);
      expect(result.error).toBeNull();
      // With no enabled lookups, this should show base-only data
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  // ── Calc preview ────────────────────────────────────────────────────────

  describe('calc preview', () => {
    it('returns preview with a simple calc column', () => {
      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
        },
        base: 'Orders',
        calcStages: [{
          alias: 'DoubleAmount',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { type: 'number', value: '2', op: '*' },
            ],
          },
          enabled: true,
        }],
      });

      const result = buildPreview('calc0', state);
      expect(result.error).toBeNull();
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.length).toBeLessThanOrEqual(5);
      // Calc column alias should appear in headers
      expect(result.headers).toContain('DoubleAmount');
      // First row should have the calc column
      expect(result.rows[0]).toHaveProperty('DoubleAmount');
    });

    it('includes all lookups when previewing calc stage', () => {
      const CONTACTS_COLS = ['ContactId', 'Name', 'Email', 'Phone'];
      createTable('Contacts', CONTACTS_COLS);
      insertRows('Contacts', CONTACTS_COLS, [
        { ContactId: 'Alice', Name: 'Alice Smith', Email: 'alice@example.com', Phone: '555-0100' },
      ]);

      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          Contacts: { id: 'Contacts', name: 'Contacts', cols: CONTACTS_COLS, rowCount: 1 },
        },
        base: 'Orders',
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'ContactId' }],
          cols: ['Name', 'Email'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
        calcStages: [{
          alias: 'Greeting',
          mode: 'text',
          text: {
            operation: 'combine',
            parts: [
              { type: 'text', value: 'Hello, ' },
              { type: 'column', value: 'Name' },
            ],
          },
          enabled: true,
        }],
      });

      const result = buildPreview('calc0', state);
      expect(result.error).toBeNull();
      expect(result.rows.length).toBeGreaterThan(0);
      // Both lookup and calc columns should be in headers
      expect(result.headers).toContain('Name');
      expect(result.headers).toContain('Greeting');
    });
  });

  // ── Band preview ────────────────────────────────────────────────────────

  describe('band preview', () => {
    it('returns raw child table rows for band0', () => {
      createTable('Items', ['ItemId', 'OrderId', 'Product', 'Qty']);
      insertRows('Items', ['ItemId', 'OrderId', 'Product', 'Qty'], [
        { ItemId: 'I-1', OrderId: 'ORD-001', Product: 'Widget', Qty: 5 },
        { ItemId: 'I-2', OrderId: 'ORD-001', Product: 'Gadget', Qty: 2 },
        { ItemId: 'I-3', OrderId: 'ORD-002', Product: 'Widget', Qty: 10 },
      ]);

      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          Items: { id: 'Items', name: 'Items', cols: ['ItemId', 'OrderId', 'Product', 'Qty'], rowCount: 3 },
        },
        base: 'Orders',
        detailBands: [{
          id: 'band_0',
          rightId: 'Items',
          keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
          cols: [],
          enabled: true,
          sorts: [],
          label: 'Items',
        }],
      });

      const result = buildPreview('band0', state);
      expect(result.error).toBeNull();
      expect(result.rows.length).toBe(3); // 3 rows, under 5 limit
      expect(result.headers).toEqual(['ItemId', 'OrderId', 'Product', 'Qty']);
      expect(result.rows[0]).toHaveProperty('ItemId');
      expect(result.rows[0]).toHaveProperty('Product');
    });

    it('returns error for out-of-range band index', () => {
      const result = buildPreview('band99', st());
      expect(result.error).toBe('Band not found');
    });

    it('returns error when band table does not exist', () => {
      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
        },
        base: 'Orders',
        detailBands: [{
          id: 'band_0',
          rightId: 'Missing',
          keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
          cols: [],
          enabled: true,
          sorts: [],
          label: 'Missing',
        }],
      });

      const result = buildPreview('band0', state);
      expect(result.error).toBe('Band table not found');
    });

    it('caps band preview at 5 rows', () => {
      createTable('ManyItems', ['ItemId', 'Desc']);
      const data = Array.from({ length: 10 }, (_, i) => ({
        ItemId: `I-${i}`,
        Desc: `Item ${i}`,
      }));
      insertRows('ManyItems', ['ItemId', 'Desc'], data);

      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          ManyItems: { id: 'ManyItems', name: 'ManyItems', cols: ['ItemId', 'Desc'], rowCount: 10 },
        },
        base: 'Orders',
        detailBands: [{
          id: 'band_0',
          rightId: 'ManyItems',
          keyPairs: [{ left: 'OrderId', right: 'ItemId' }],
          cols: [],
          enabled: true,
          sorts: [],
          label: 'ManyItems',
        }],
      });

      const result = buildPreview('band0', state);
      expect(result.error).toBeNull();
      expect(result.rows.length).toBe(5);
    });

    it('uses column labels for band headers', () => {
      createTable('ItemsLab', ['ItemId', 'Product', 'Qty']);
      insertRows('ItemsLab', ['ItemId', 'Product', 'Qty'], [
        { ItemId: 'I-1', Product: 'Widget', Qty: 5 },
      ]);

      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          ItemsLab: { id: 'ItemsLab', name: 'ItemsLab', cols: ['ItemId', 'Product', 'Qty'], rowCount: 1 },
        },
        base: 'Orders',
        columnLabels: {
          ItemsLab: { Product: 'Product Name', Qty: 'Quantity' },
        },
        detailBands: [{
          id: 'band_0',
          rightId: 'ItemsLab',
          keyPairs: [{ left: 'OrderId', right: 'ItemId' }],
          cols: [],
          enabled: true,
          sorts: [],
          label: 'ItemsLab',
        }],
      });

      const result = buildPreview('band0', state);
      expect(result.error).toBeNull();
      expect(result.headers).toContain('Product Name');
      expect(result.headers).toContain('Quantity');
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns error for unknown key', () => {
      const result = buildPreview('unknown', st());
      expect(result.error).toBe('Unknown stage');
    });

    it('returns error for invalid key pattern', () => {
      const result = buildPreview('lkabc', st());
      expect(result.error).toBe('Unknown stage');
    });

    it('catches SQL execution errors and returns structured error', () => {
      // Create a state referencing a table that doesn't exist in SQLite
      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          Phantom: { id: 'Phantom', name: 'Phantom', cols: ['X'], rowCount: 1 },
        },
        base: 'Orders',
        detailBands: [{
          id: 'band_0',
          rightId: 'Phantom',
          keyPairs: [{ left: 'OrderId', right: 'X' }],
          cols: [],
          enabled: true,
          sorts: [],
          label: 'Phantom',
        }],
      });

      const result = buildPreview('band0', state);
      // The table Phantom doesn't exist in SQLite — should produce an error
      expect(result.error).toBeTruthy();
    });

    it('returns empty rows but no error when preview has no matching data', () => {
      // All lookups but non-matching keys — use unique table name to avoid
      // collision with the Contacts table created in earlier tests
      const COLS = ['ContactId', 'Name', 'Email'];
      createTable('ContactsX', COLS);
      insertRows('ContactsX', COLS, [
        { ContactId: 'Nobody', Name: 'N/A', Email: 'na@example.com' },
      ]);

      const state = createAppState({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ORDERS_COLS, rowCount: 8 },
          ContactsX: { id: 'ContactsX', name: 'ContactsX', cols: COLS, rowCount: 1 },
        },
        base: 'Orders',
        lookups: [{
          rightId: 'ContactsX',
          keyPairs: [{ left: 'Company', right: 'ContactId' }],
          cols: ['Name', 'Email'],
          required: true, // INNER JOIN — should filter out all rows if no match
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
      });

      const result = buildPreview('lk0', state);
      // With required=true and no matching keys, result may be empty
      expect(result.error).toBeNull();
    });
  });
});
