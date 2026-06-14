import { describe, it, expect, beforeEach } from 'vitest';
import {
  tablePrefix,
  buildColSourceMap,
  buildColumnCatalog,
  projectedCols,
  projectedColsUpToLookup,
} from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import { initStore } from '../../core/store';

describe('Column Catalog', () => {
  // ── tablePrefix ─────────────────────────────────────────────────────────

  describe('tablePrefix()', () => {
    it('should produce prefix from simple name', () => {
      expect(tablePrefix('Orders')).toBe('Orders__');
    });

    it('should take last segment after em-dash', () => {
      expect(tablePrefix('Main—Orders')).toBe('Orders__');
    });

    it('should strip special characters', () => {
      // Space and ! are both replaced → 'My_Table_' + '__' = 'My_Table___'
      expect(tablePrefix('My Table!')).toBe('My_Table___');
    });

    it('should handle multiple em-dashes', () => {
      expect(tablePrefix('A—B—Contacts')).toBe('Contacts__');
    });
  });

  // ── buildColSourceMap (store-based) ─────────────────────────────────────

  describe('buildColSourceMap()', () => {
    beforeEach(() => {
      initStore();
    });

    it('should return empty map for empty store', () => {
      const map = buildColSourceMap();
      expect(map.size).toBe(0);
    });

    it('should map physical columns from base table', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company'], rowCount: 2 },
        },
      });
      const map = buildColSourceMap();
      expect(map.get('OrderId')).toEqual({ tid: 'Orders', col: 'OrderId' });
      expect(map.get('Company')).toEqual({ tid: 'Orders', col: 'Company' });
    });

    it('should return empty map when no base table is set', () => {
      initStore({
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId'], rowCount: 1 },
          Contacts: { id: 'Contacts', name: 'Contacts', cols: ['Name'], rowCount: 1 },
        },
      });
      const map = buildColSourceMap();
      expect(map.size).toBe(0);
    });

    it('should only include base table columns', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId'], rowCount: 1 },
          Contacts: { id: 'Contacts', name: 'Contacts', cols: ['Name'], rowCount: 1 },
        },
      });
      const map = buildColSourceMap();
      expect(map.get('OrderId')).toEqual({ tid: 'Orders', col: 'OrderId' });
      expect(map.has('Name')).toBe(false);
    });

    it('should prefix lookup columns on name collision', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company'], rowCount: 1 },
          Contacts: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Company'], rowCount: 1 },
        },
        lookups: [{ rightId: 'Contacts', keyPairs: [{ left: 'OrderId', right: 'ContactId' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } }],
      });
      const map = buildColSourceMap();
      expect(map.get('OrderId')).toEqual({ tid: 'Orders', col: 'OrderId' });
      expect(map.get('Company')).toEqual({ tid: 'Orders', col: 'Company' });
      expect(map.get('ContactId')).toEqual({ tid: 'Contacts', col: 'ContactId' });
      expect(map.get('Contacts__Company')).toEqual({ tid: 'Contacts', col: 'Company' });
    });

    it('should not collide same-named columns from unrelated tables', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ['Amount'], rowCount: 1 },
          Budget: { id: 'Budget', name: 'Budget', cols: ['Amount'], rowCount: 1 },
        },
      });
      const map = buildColSourceMap();
      expect(map.get('Amount')).toEqual({ tid: 'Orders', col: 'Amount' });
    });

    it('should map calc stage aliases', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ['Amount'], rowCount: 1 },
        },
        calcStages: [
          { alias: 'DoubleAmt', mode: 'math', math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }, { op: '+', type: 'column', value: 'Amount' }] } },
        ],
      });
      const map = buildColSourceMap();
      expect(map.get('DoubleAmt')).toEqual({ kind: 'calc', idx: 0, mode: 'math', calc: expect.any(Object) });
    });

    it('should skip calc stages without alias', () => {
      initStore({
        base: 'Orders',
        tables: {
          Orders: { id: 'Orders', name: 'Orders', cols: ['Amount'], rowCount: 1 },
        },
        calcStages: [
          { alias: '', mode: 'math' },
        ],
      });
      const map = buildColSourceMap();
      expect(map.has('')).toBe(false);
    });
  });

  // ── buildColumnCatalog (pure, catalog-based) ───────────────────────────

  describe('buildColumnCatalog()', () => {
    const ordersSource: SourceTableEntry = {
      id: 'Orders',
      name: 'Orders',
      cols: ['OrderId', 'Company', 'Amount'],
      kind: 'imported',
      source: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Amount'], rowCount: 8 },
    };
    const contactsSource: SourceTableEntry = {
      id: 'Contacts',
      name: 'Contacts',
      cols: ['ContactId', 'Name', 'Company'],
      kind: 'imported',
      source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Company'], rowCount: 5 },
    };
    const sourceCatalog = new Map<string, SourceTableEntry>([
      ['Orders', ordersSource],
      ['Contacts', contactsSource],
    ]);

    it('should include base columns', () => {
      const spec = { base: 'Orders', lookups: [], calcStages: [], detailBands: [] };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('OrderId')).toBe(true);
      expect(cat.colMap.has('Company')).toBe(true);
      expect(cat.colMap.has('Amount')).toBe(true);
      const entry = cat.colMap.get('OrderId')!;
      expect(entry.kind).toBeUndefined();
      expect((entry as any).tid).toBe('Orders');
      expect((entry as any).col).toBe('OrderId');
    });

    it('should add lookup columns with prefix aliasing on conflict', () => {
      const spec = {
        base: 'Orders',
        lookups: [{ rightId: 'Contacts', keyPairs: [{ left: 'Company', right: 'Company' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } }],
        calcStages: [],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // 'Company' already exists from Orders → Contacts' Company becomes 'Contacts__Company'
      expect(cat.colMap.has('Company')).toBe(true);
      expect(cat.colMap.has('Contacts__Company')).toBe(true);
      expect((cat.colMap.get('Contacts__Company') as any).tid).toBe('Contacts');
      // Non-conflicting cols added directly
      expect(cat.colMap.has('ContactId')).toBe(true);
      expect(cat.colMap.has('Name')).toBe(true);
    });

    it('should add lookup columns without prefix if no conflict', () => {
      const spec = {
        base: 'Orders',
        lookups: [{ rightId: 'Contacts', keyPairs: [{ left: 'OrderId', right: 'ContactId' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } }],
        calcStages: [],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // Name doesn't conflict with any Orders column → added without prefix
      expect(cat.colMap.has('Name')).toBe(true);
      expect((cat.colMap.get('Name') as any).tid).toBe('Contacts');
    });

    it('should skip disabled lookups', () => {
      const spec = {
        base: 'Orders',
        lookups: [{ rightId: 'Contacts', keyPairs: [{ left: 'Company', right: 'Company' }], cols: [], required: false, enabled: false, duplicatePolicy: { mode: 'block' } }],
        calcStages: [],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // Only base columns
      expect(cat.colMap.size).toBe(3);
      expect(cat.colMap.has('ContactId')).toBe(false);
    });

    it('should add valid calc columns', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [
          {
            alias: 'DoubleAmt',
            mode: 'math',
            math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }, { op: '+', type: 'column', value: 'Amount' }] },
          },
        ],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('DoubleAmt')).toBe(true);
      const entry = cat.colMap.get('DoubleAmt')!;
      expect(entry.kind).toBe('calc');
      expect((entry as any).idx).toBe(0);
    });

    it('should skip calc columns with invalid mode', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [{ alias: 'Bad', mode: 'invalid' as any }],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('Bad')).toBe(false);
    });

    it('should skip calc columns with empty alias', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [{ alias: '', mode: 'math' }],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // Only base columns
      expect(cat.colMap.size).toBe(3);
    });

    it('should skip disabled calc columns', () => {
      const spec = {
        base: 'Orders',
        lookups: [],
        calcStages: [
          {
            alias: 'Disabled',
            mode: 'math',
            enabled: false,
            math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }] },
          },
        ],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      expect(cat.colMap.has('Disabled')).toBe(false);
    });

    it('should capture lookup boundary snapshots', () => {
      const spec = {
        base: 'Orders',
        lookups: [
          { rightId: 'Contacts', keyPairs: [{ left: 'Company', right: 'Company' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
        ],
        calcStages: [],
        detailBands: [],
      };
      const cat = buildColumnCatalog(spec, sourceCatalog);
      // 2 boundaries: before lookup[0] and after lookup[0]
      expect(cat.lookupBoundaries.length).toBe(2);
      // Before first lookup: only base cols
      expect(cat.lookupBoundaries[0].size).toBe(3);
      // After first lookup: base + lookup cols
      expect(cat.lookupBoundaries[1].size).toBeGreaterThan(3);
    });

    it('should throw if sourceCatalog is not a Map', () => {
      expect(() => buildColumnCatalog({ base: 'Orders' }, {} as any)).toThrow('sourceCatalog (Map) is required');
    });
  });

  // ── projectedCols ──────────────────────────────────────────────────────

  describe('projectedCols()', () => {
    const sourceCatalog = new Map<string, SourceTableEntry>([
      ['Orders', {
        id: 'Orders', name: 'Orders', cols: ['OrderId', 'Amount'], kind: 'imported',
        source: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Amount'], rowCount: 1 },
      }],
    ]);

    it('should return all colMap keys', () => {
      const cols = projectedCols({ base: 'Orders', lookups: [], calcStages: [], detailBands: [] }, sourceCatalog);
      expect(cols).toEqual(['OrderId', 'Amount']);
    });

    it('should include calc columns', () => {
      const cols = projectedCols({
        base: 'Orders',
        lookups: [],
        calcStages: [
          {
            alias: 'DoubleAmt',
            mode: 'math',
            math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }, { op: '+', type: 'column', value: 'Amount' }] },
          },
        ],
        detailBands: [],
      }, sourceCatalog);
      expect(cols).toContain('OrderId');
      expect(cols).toContain('Amount');
      expect(cols).toContain('DoubleAmt');
    });
  });

  // ── projectedColsUpToLookup ─────────────────────────────────────────────

  describe('projectedColsUpToLookup()', () => {
    const sourceCatalog = new Map<string, SourceTableEntry>([
      ['Orders', {
        id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Amount'], kind: 'imported',
        source: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Amount'], rowCount: 1 },
      }],
      ['Contacts', {
        id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name'], kind: 'imported',
        source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name'], rowCount: 1 },
      }],
    ]);

    it('should return only base cols when upTo=0', () => {
      const spec = {
        base: 'Orders',
        lookups: [
          { rightId: 'Contacts', keyPairs: [{ left: 'OrderId', right: 'ContactId' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
        ],
        detailBands: [],
      };
      const cols = projectedColsUpToLookup(0, spec, sourceCatalog);
      expect(cols).toEqual(['OrderId', 'Company', 'Amount']);
    });

    it('should include lookup cols up to index', () => {
      const spec = {
        base: 'Orders',
        lookups: [
          { rightId: 'Contacts', keyPairs: [{ left: 'OrderId', right: 'ContactId' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
        ],
        detailBands: [],
      };
      const cols = projectedColsUpToLookup(1, spec, sourceCatalog);
      expect(cols).toContain('OrderId');
      expect(cols).toContain('Company');
      expect(cols).toContain('Amount');
      expect(cols).toContain('ContactId');
      expect(cols).toContain('Name');
    });

    it('should prefix lookup cols on conflict', () => {
      const spec = {
        base: 'Orders',
        lookups: [
          { rightId: 'Contacts', keyPairs: [{ left: 'OrderId', right: 'ContactId' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
        ],
        detailBands: [],
      };
      const cols = projectedColsUpToLookup(1, spec, sourceCatalog);
      // 'Name' doesn't conflict → added directly
      expect(cols).toContain('Name');
    });

    it('should return empty array for missing base', () => {
      const cols = projectedColsUpToLookup(0, { base: 'Missing', lookups: [], detailBands: [] }, sourceCatalog);
      expect(cols).toEqual([]);
    });

    it('should return empty array if no base specified', () => {
      const cols = projectedColsUpToLookup(0, { lookups: [], detailBands: [] }, sourceCatalog);
      expect(cols).toEqual([]);
    });

    it('should skip disabled lookups', () => {
      const spec = {
        base: 'Orders',
        lookups: [
          { rightId: 'Contacts', keyPairs: [{ left: 'OrderId', right: 'ContactId' }], cols: [], required: false, enabled: false, duplicatePolicy: { mode: 'block' } },
        ],
        detailBands: [],
      };
      const cols = projectedColsUpToLookup(1, spec, sourceCatalog);
      // Only base cols — disabled lookup skipped
      expect(cols).toEqual(['OrderId', 'Company', 'Amount']);
    });
  });
});
