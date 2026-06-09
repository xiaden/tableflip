import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../js/ui/views/query-builder.js', () => ({
  renderQueryBuilder: vi.fn(),
}));

describe('Layout Selection', () => {
  let _isSourceVisibleInLayout: any;
  let _showLayoutAliasesForSource: any;
  let _hideLayoutAliasesForSource: any;
  let _hideLookupLayoutAliasesSafely: any;
  let _isAliasVisibleInLayout: any;
  let _syncSubtotalByToLayout: any;
  let _afterCombineChange: any;
  let buildColSourceMap: any;

  beforeEach(async () => {
    const layoutModule = await import('../../js/query/layout-selection.js');
    _isSourceVisibleInLayout = layoutModule._isSourceVisibleInLayout;
    _showLayoutAliasesForSource = layoutModule._showLayoutAliasesForSource;
    _hideLayoutAliasesForSource = layoutModule._hideLayoutAliasesForSource;
    _hideLookupLayoutAliasesSafely = layoutModule._hideLookupLayoutAliasesSafely;
    _isAliasVisibleInLayout = layoutModule._isAliasVisibleInLayout;
    _syncSubtotalByToLayout = layoutModule._syncSubtotalByToLayout;
    _afterCombineChange = layoutModule._afterCombineChange;
    
    const catalogModule = await import('../../js/catalog/column-catalog.js');
    buildColSourceMap = catalogModule.buildColSourceMap;
    const db = (globalThis as any).db;
    db.tables = {
      Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 8 },
      Contacts: { id: 'Contacts', name: 'Contacts', cols: ['Company', 'Contact', 'Email', 'Phone'], rowCount: 9 },
    };
    db.base = 'Orders';
    db.baseCols = null;
    db.stacks = [];
    db.lookups = [];
    db.calcStages = [];
    db.selCols = null;
    db.colOrder = null;
    db.filters = [];
    db.sorts = [];
    db.groupBy = [];
    db.aggregates = [];
    db.aggMode = 'none';
    db.subtotalBy = [];
    db.subtotalFns = {};
    db.result = null;

    vi.spyOn(window, 'prompt').mockReturnValue(null);
  });

  describe('_isSourceVisibleInLayout', () => {
    it('should return true when selCols is null (all visible)', () => {
      const db = (globalThis as any).db;
      db.selCols = null;
      const colMap = buildColSourceMap();
      expect(_isSourceVisibleInLayout('Orders', 'OrderId', colMap, 'none')).toBe(true);
    });

    it('should return true when alias is in selCols', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId', 'Company']);
      const colMap = buildColSourceMap();
      expect(_isSourceVisibleInLayout('Orders', 'OrderId', colMap, 'none')).toBe(true);
    });

    it('should return false when alias is not in selCols', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId']);
      const colMap = buildColSourceMap();
      expect(_isSourceVisibleInLayout('Orders', 'Company', colMap, 'none')).toBe(false);
    });

    it('should return true for column not in colMap (unseen)', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId']);
      const colMap = buildColSourceMap();
      expect(_isSourceVisibleInLayout('NonExistent', 'Foo', colMap, 'none')).toBe(true);
    });
  });

  describe('_showLayoutAliasesForSource', () => {
    it('should add columns to selCols', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId']);
      _showLayoutAliasesForSource('Orders', 'Company');
      expect(db.selCols.has('Company')).toBe(true);
      expect(db.selCols.has('OrderId')).toBe(true);
    });

    it('should add all columns for a source when col is null', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set();
      _showLayoutAliasesForSource('Orders');
      expect(db.selCols.has('OrderId')).toBe(true);
      expect(db.selCols.has('Company')).toBe(true);
      expect(db.selCols.has('Amount')).toBe(true);
    });

    it('should initialize selCols if null', () => {
      const db = (globalThis as any).db;
      db.selCols = null;
      _showLayoutAliasesForSource('Orders', 'OrderId');
      expect(db.selCols).toBeInstanceOf(Set);
      expect(db.selCols.has('OrderId')).toBe(true);
    });
  });

  describe('_hideLayoutAliasesForSource', () => {
    it('should remove columns from selCols', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId', 'Company', 'Amount']);
      _hideLayoutAliasesForSource('Orders', 'Company');
      expect(db.selCols.has('Company')).toBe(false);
      expect(db.selCols.has('OrderId')).toBe(true);
    });

    it('should remove all columns for a source when col is null', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId', 'Company', 'Amount', 'Status']);
      _hideLayoutAliasesForSource('Orders');
      expect(db.selCols.has('OrderId')).toBe(false);
      expect(db.selCols.has('Company')).toBe(false);
      expect(db.selCols.has('Amount')).toBe(false);
      expect(db.selCols.size).toBe(0);
    });
  });

  describe('_hideLookupLayoutAliasesSafely', () => {
    it('should respect other lookups using the same column', () => {
      const db = (globalThis as any).db;
      db.lookups = [
        { rightId: 'Contacts', keyPairs: [{ left: 'Company', right: 'Company' }], cols: ['Email', 'Phone'], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
        { rightId: 'Contacts', keyPairs: [{ left: 'Company', right: 'Company' }], cols: ['Email'], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
      ];
      db.selCols = new Set(['OrderId', 'Company', 'Contact', 'Email', 'Phone']);
      _hideLookupLayoutAliasesSafely('Contacts', 'Email', 0);
      expect(db.selCols.has('Email')).toBe(true);
    });

    it('should hide column when not used by other lookups', () => {
      const db = (globalThis as any).db;
      db.lookups = [
        { rightId: 'Contacts', keyPairs: [{ left: 'Company', right: 'Company' }], cols: ['Email'], required: false, enabled: true, duplicatePolicy: { mode: 'block' } },
      ];
      db.selCols = new Set(['OrderId', 'Company', 'Contact', 'Email', 'Phone']);
      _hideLookupLayoutAliasesSafely('Contacts', 'Phone', -1);
      expect(db.selCols.has('Phone')).toBe(false);
    });

    it('should not crash with invalid tid', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId']);
      expect(() => _hideLookupLayoutAliasesSafely('', 'Foo')).not.toThrow();
      expect(() => _hideLookupLayoutAliasesSafely('NonExistent', 'Foo')).not.toThrow();
    });
  });

  describe('_isAliasVisibleInLayout', () => {
    it('should return true when selCols is null', () => {
      const db = (globalThis as any).db;
      db.selCols = null;
      expect(_isAliasVisibleInLayout('OrderId', 'none')).toBe(true);
    });

    it('should return true when alias is in selCols', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId', 'Company']);
      expect(_isAliasVisibleInLayout('OrderId', 'none')).toBe(true);
    });

    it('should return false when alias is not in selCols', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId']);
      expect(_isAliasVisibleInLayout('Company', 'none')).toBe(false);
    });

    it('should return true for empty alias', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId']);
      expect(_isAliasVisibleInLayout('', 'none')).toBe(true);
    });
  });

  describe('_syncSubtotalByToLayout', () => {
    it('should order subtotalBy according to colOrder', () => {
      const db = (globalThis as any).db;
      db.colOrder = ['OrderId', 'Company', 'Region', 'Amount'];
      db.subtotalBy = ['Region', 'Company'];
      _syncSubtotalByToLayout();
      expect(db.subtotalBy).toEqual(['Company', 'Region']);
    });

    it('should remove columns not in colOrder', () => {
      const db = (globalThis as any).db;
      db.colOrder = ['OrderId', 'Company'];
      db.subtotalBy = ['Company', 'NonExistent'];
      _syncSubtotalByToLayout();
      expect(db.subtotalBy).toEqual(['Company']);
    });

    it('should deduplicate subtotalBy', () => {
      const db = (globalThis as any).db;
      db.colOrder = ['OrderId', 'Company', 'Region'];
      db.subtotalBy = ['Company', 'Company', 'Region'];
      _syncSubtotalByToLayout();
      expect(db.subtotalBy).toEqual(['Company', 'Region']);
    });

    it('should do nothing when subtotalBy is empty', () => {
      const db = (globalThis as any).db;
      db.subtotalBy = [];
      _syncSubtotalByToLayout();
      expect(db.subtotalBy).toEqual([]);
    });
  });

  describe('_afterCombineChange', () => {
    it('should update selCols with new columns', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId', 'Company']);
      db.colOrder = ['OrderId', 'Company'];
      db.lookups = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      _afterCombineChange();
      expect(db.selCols.has('Email')).toBe(true);
    });

    it('should remove stale columns from selCols', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId', 'Company', 'StaleCol']);
      db.colOrder = ['OrderId', 'Company', 'StaleCol'];
      _afterCombineChange();
      expect(db.selCols.has('StaleCol')).toBe(false);
    });

    it('should set colOrder when null', () => {
      const db = (globalThis as any).db;
      db.selCols = null;
      db.colOrder = null;
      _afterCombineChange();
      expect(db.colOrder).toBeTruthy();
      expect(Array.isArray(db.colOrder)).toBe(true);
      expect(db.colOrder.length).toBeGreaterThan(0);
    });

    it('should preserve existing colOrder and append new columns', () => {
      const db = (globalThis as any).db;
      db.selCols = new Set(['OrderId', 'Company']);
      db.colOrder = ['Company', 'OrderId'];
      db.lookups = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Company', right: 'Company' }],
        cols: ['Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      _afterCombineChange();
      expect(db.colOrder.indexOf('Company')).toBeLessThan(db.colOrder.indexOf('OrderId'));
      expect(db.colOrder).toContain('Email');
    });
  });
});
