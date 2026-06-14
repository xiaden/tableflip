import { describe, it, expect, beforeEach } from 'vitest';
import { buildColSourceMap, buildColumnCatalog } from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import { initStore } from '../../core/store';

/**
 * Tests for colType propagation in buildColSourceMap and buildColumnCatalog.
 *
 * Verifies that column type metadata flows from DbTable.colTypes and
 * columnTypeOverrides into PhysicalColEntry.colType and BandColEntry.colType.
 */
describe('Column Catalog — colType Propagation', () => {
  // ── buildColSourceMap (store-based) ─────────────────────────────────────

  describe('buildColSourceMap()', () => {
    beforeEach(() => {
      initStore();
    });

    it('propagates colType from DbTable.colTypes for base columns', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: {
            id: 'Orders', name: 'Orders', cols: ['Amount', 'Company'],
            rowCount: 1,
            colTypes: { Amount: 'number', Company: 'string' },
          },
        },
      });
      const map = buildColSourceMap();

      const amountEntry = map.get('Amount')!;
      expect(amountEntry).toBeDefined();
      expect((amountEntry as any).tid).toBe('Orders');
      expect((amountEntry as any).colType).toBe('number');

      const companyEntry = map.get('Company')!;
      expect(companyEntry).toBeDefined();
      expect((companyEntry as any).colType).toBe('string');
    });

    it('applies columnTypeOverrides over auto-detected colTypes', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: {
            id: 'Orders', name: 'Orders', cols: ['Amount'],
            rowCount: 1,
            colTypes: { Amount: 'string' },
          },
        },
        columnTypeOverrides: { Orders: { Amount: 'number' } },
      });
      const map = buildColSourceMap();

      const entry = map.get('Amount')!;
      expect(entry).toBeDefined();
      expect((entry as any).colType).toBe('number'); // override wins
    });

    it('omits colType field when neither colTypes nor overrides provide a value', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: {
            id: 'Orders', name: 'Orders', cols: ['Amount'],
            rowCount: 1,
            // No colTypes property
          },
        },
        // No columnTypeOverrides
      });
      const map = buildColSourceMap();

      const entry = map.get('Amount')!;
      expect(entry).toBeDefined();
      expect('colType' in entry).toBe(false);
    });

    it('propagates colType for lookup columns', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: {
            id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company'],
            rowCount: 2,
            colTypes: { OrderId: 'number', Company: 'string' },
          },
          Contacts: {
            id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email'],
            rowCount: 2,
            colTypes: { ContactId: 'number', Name: 'string', Email: 'string' },
          },
        },
        lookups: [{
          rightId: 'Contacts',
          keyPairs: [{ left: 'OrderId', right: 'ContactId' }],
          cols: [],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        }],
      });
      const map = buildColSourceMap();

      // Base columns
      expect((map.get('OrderId') as any).colType).toBe('number');
      expect((map.get('Company') as any).colType).toBe('string');

      // Lookup columns — no name collision, so added directly
      const contactIdEntry = map.get('ContactId')!;
      expect(contactIdEntry).toBeDefined();
      expect((contactIdEntry as any).tid).toBe('Contacts');
      expect((contactIdEntry as any).colType).toBe('number');

      const nameEntry = map.get('Name')!;
      expect(nameEntry).toBeDefined();
      expect((nameEntry as any).tid).toBe('Contacts');
      expect((nameEntry as any).colType).toBe('string');
    });
  });

  // ── buildColumnCatalog (pure, catalog-based) ───────────────────────────

  describe('buildColumnCatalog()', () => {
    it('propagates colType from sourceCatalog source.colTypes for base columns', () => {
      const sourceCatalog = new Map<string, SourceTableEntry>([
        ['Orders', {
          id: 'Orders', name: 'Orders',
          cols: ['OrderId', 'Amount', 'OrderDate'],
          kind: 'imported',
          source: {
            id: 'Orders', name: 'Orders',
            cols: ['OrderId', 'Amount', 'OrderDate'], rowCount: 8,
            colTypes: { OrderId: 'number', Amount: 'number', OrderDate: 'date' },
          },
        }],
      ]);

      const spec = { base: 'Orders', lookups: [], calcStages: [], detailBands: [] };
      const cat = buildColumnCatalog(spec, sourceCatalog);

      expect((cat.colMap.get('OrderId') as any).colType).toBe('number');
      expect((cat.colMap.get('Amount') as any).colType).toBe('number');
      expect((cat.colMap.get('OrderDate') as any).colType).toBe('date');
    });

    it('applies columnTypeOverrides via options parameter over source.colTypes', () => {
      const sourceCatalog = new Map<string, SourceTableEntry>([
        ['Orders', {
          id: 'Orders', name: 'Orders',
          cols: ['Amount'],
          kind: 'imported',
          source: {
            id: 'Orders', name: 'Orders',
            cols: ['Amount'], rowCount: 8,
            colTypes: { Amount: 'string' },
          },
        }],
      ]);

      const spec = { base: 'Orders', lookups: [], calcStages: [], detailBands: [] };
      const cat = buildColumnCatalog(spec, sourceCatalog, {
        columnTypeOverrides: { Orders: { Amount: 'number' } },
      });

      const entry = cat.colMap.get('Amount')!;
      expect(entry).toBeDefined();
      expect((entry as any).colType).toBe('number'); // override wins
    });

    it('propagates colType for band columns', () => {
      const sourceCatalog = new Map<string, SourceTableEntry>([
        ['Orders', {
          id: 'Orders', name: 'Orders',
          cols: ['OrderId', 'Company'],
          kind: 'imported',
          source: {
            id: 'Orders', name: 'Orders',
            cols: ['OrderId', 'Company'], rowCount: 8,
            colTypes: { OrderId: 'number', Company: 'string' },
          },
        }],
        ['Details', {
          id: 'Details', name: 'Details',
          cols: ['DetailId', 'OrderId', 'Qty', 'Price'],
          kind: 'imported',
          source: {
            id: 'Details', name: 'Details',
            cols: ['DetailId', 'OrderId', 'Qty', 'Price'], rowCount: 50,
            colTypes: { DetailId: 'number', OrderId: 'number', Qty: 'number', Price: 'number' },
          },
        }],
      ]);

      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [],
        detailBands: [{
          id: 'band_0',
          rightId: 'Details',
          keyPairs: [{ left: 'OrderId', right: 'OrderId' }],
          cols: [], // all columns
          enabled: true,
          sorts: [],
          label: 'Details',
        }],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);

      // Band columns should have _band_0_ prefix and carry colType from Details table
      const qtyEntry = cat.colMap.get('_band_0_Qty')!;
      expect(qtyEntry).toBeDefined();
      expect(qtyEntry.kind).toBe('band');
      expect((qtyEntry as any).tid).toBe('Details');
      expect((qtyEntry as any).colType).toBe('number');

      const priceEntry = cat.colMap.get('_band_0_Price')!;
      expect(priceEntry).toBeDefined();
      expect(priceEntry.kind).toBe('band');
      expect((priceEntry as any).colType).toBe('number');

      const detailIdEntry = cat.colMap.get('_band_0_DetailId')!;
      expect(detailIdEntry).toBeDefined();
      expect((detailIdEntry as any).colType).toBe('number');
    });

    it('omits colType for calc columns', () => {
      const sourceCatalog = new Map<string, SourceTableEntry>([
        ['Orders', {
          id: 'Orders', name: 'Orders',
          cols: ['Amount', 'Price'],
          kind: 'imported',
          source: {
            id: 'Orders', name: 'Orders',
            cols: ['Amount', 'Price'], rowCount: 8,
            colTypes: { Amount: 'number', Price: 'number' },
          },
        }],
      ]);

      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [{
          alias: 'DoubleAmt',
          mode: 'math',
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { op: '+', type: 'column', value: 'Amount' },
            ],
          },
        }],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);

      const calcEntry = cat.colMap.get('DoubleAmt')!;
      expect(calcEntry).toBeDefined();
      expect(calcEntry.kind).toBe('calc');
      expect('colType' in calcEntry).toBe(false);
    });

    it('is backward compatible — call without options, no colTypes on source', () => {
      const sourceCatalog = new Map<string, SourceTableEntry>([
        ['Orders', {
          id: 'Orders', name: 'Orders',
          cols: ['OrderId', 'Amount'],
          kind: 'imported',
          source: {
            id: 'Orders', name: 'Orders',
            cols: ['OrderId', 'Amount'], rowCount: 8,
            // No colTypes — like old pre-colTypes fixtures
          },
        }],
      ]);

      const spec = { base: 'Orders', lookups: [], calcStages: [], detailBands: [] };
      // Call with 2 args — no options parameter
      const cat = buildColumnCatalog(spec, sourceCatalog);

      const orderIdEntry = cat.colMap.get('OrderId')!;
      expect(orderIdEntry).toBeDefined();
      expect('colType' in orderIdEntry).toBe(false);

      const amountEntry = cat.colMap.get('Amount')!;
      expect(amountEntry).toBeDefined();
      expect('colType' in amountEntry).toBe(false);
    });
  });
});
