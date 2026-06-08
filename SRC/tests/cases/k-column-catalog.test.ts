import { describe, it, expect } from 'vitest';
import { buildColSourceMap, buildColumnCatalog, projectedCols } from '../../js/catalog/column-catalog.js';
import { buildSourceCatalog } from '../../js/catalog/source-catalog.js';

describe('Column Catalog', () => {
  describe('buildColSourceMap', () => {
    it('should include physical columns from base table', () => {
      const map = buildColSourceMap();
      expect(map.has('OrderId')).toBe(true);
      expect(map.has('Company')).toBe(true);
      expect(map.has('Amount')).toBe(true);
    });

    it('should have correct structure for physical columns', () => {
      const map = buildColSourceMap();
      const entry = map.get('OrderId')!;
      expect(entry).toBeTruthy();
      expect(entry.kind).toBeUndefined();
      expect((entry as any).tid).toBe('Orders');
      expect((entry as any).col).toBe('OrderId');
    });

    it('should include calculated columns', () => {
      const db = (globalThis as any).db;
      db.calcStages = [
        {
          alias: 'Doubled',
          mode: 'math',
          enabled: true,
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { op: '*', type: 'number', value: '2' },
            ],
          },
        },
      ];
      const map = buildColSourceMap();
      expect(map.has('Doubled')).toBe(true);
      const entry = map.get('Doubled')!;
      expect(entry.kind).toBe('calc');
      expect((entry as any).mode).toBe('math');
      expect((entry as any).idx).toBe(0);
    });

    it('should include lookup columns with prefix on collision', () => {
      const db = (globalThis as any).db;
      db.lookups = [
        {
          rightId: 'Contacts',
          enabled: true,
          keyPairs: [{ left: 'Company', right: 'Company' }],
        },
      ];
      const map = buildColSourceMap();
      expect(map.has('Email')).toBe(true);
      expect(map.has('Phone')).toBe(true);
      const emailEntry = map.get('Email')!;
      expect((emailEntry as any).tid).toBe('Contacts');
    });

    it('should skip disabled lookups', () => {
      const db = (globalThis as any).db;
      db.lookups = [
        {
          rightId: 'Contacts',
          enabled: false,
          keyPairs: [{ left: 'Company', right: 'Company' }],
        },
      ];
      const map = buildColSourceMap();
      expect(map.has('Email')).toBe(false);
    });

    it('should skip disabled calc stages', () => {
      const db = (globalThis as any).db;
      db.calcStages = [
        {
          alias: 'Disabled',
          mode: 'math',
          enabled: false,
          math: { strategy: 'stepChain', steps: [{ type: 'column', value: 'Amount' }] },
        },
      ];
      const map = buildColSourceMap();
      expect(map.has('Disabled')).toBe(false);
    });

    it('should return empty map when base is missing', () => {
      const db = (globalThis as any).db;
      const savedBase = db.base;
      db.base = 'nonexistent';
      try {
        const map = buildColSourceMap();
        expect(map.size).toBe(0);
      } finally {
        db.base = savedBase;
      }
    });
  });

  describe('projectedCols', () => {
    it('should return all base columns when selCols is null', () => {
      const cols = projectedCols();
      expect(cols).toContain('OrderId');
      expect(cols).toContain('Company');
      expect(cols).toContain('Amount');
    });

    it('should include lookup columns', () => {
      const db = (globalThis as any).db;
      db.lookups = [
        {
          rightId: 'Contacts',
          enabled: true,
          keyPairs: [{ left: 'Company', right: 'Company' }],
        },
      ];
      const cols = projectedCols();
      expect(cols).toContain('Email');
      expect(cols).toContain('Phone');
    });

    it('should include calculated columns', () => {
      const db = (globalThis as any).db;
      db.calcStages = [
        {
          alias: 'CalcCol',
          mode: 'math',
          enabled: true,
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { op: '+', type: 'number', value: '10' },
            ],
          },
        },
      ];
      const cols = projectedCols();
      expect(cols).toContain('CalcCol');
    });
  });

  describe('buildColumnCatalog', () => {
    it('should throw if sourceCatalog is not a Map', () => {
      expect(() => buildColumnCatalog({}, null as any)).toThrow();
    });

    it('should build catalog with base columns', () => {
      const sourceCatalog = buildSourceCatalog();
      const reportSpec = { base: 'Orders', lookups: [], calcStages: [] };
      const catalog = buildColumnCatalog(reportSpec, sourceCatalog);
      expect(catalog.colMap.has('OrderId')).toBe(true);
      expect(catalog.colMap.has('Amount')).toBe(true);
    });

    it('should build catalog with lookup columns', () => {
      const sourceCatalog = buildSourceCatalog();
      const reportSpec = {
        base: 'Orders',
        lookups: [
          {
            rightId: 'Contacts',
            enabled: true,
            keyPairs: [{ left: 'Company', right: 'Company' }],
          },
        ],
        calcStages: [],
      };
      const catalog = buildColumnCatalog(reportSpec, sourceCatalog);
      expect(catalog.colMap.has('Email')).toBe(true);
      expect(catalog.colMap.has('Phone')).toBe(true);
    });

    it('should build catalog with calculated columns', () => {
      const sourceCatalog = buildSourceCatalog();
      const reportSpec = {
        base: 'Orders',
        lookups: [],
        calcStages: [
          {
            alias: 'TotalCalc',
            mode: 'math',
            enabled: true,
            math: {
              strategy: 'stepChain',
              steps: [
                { type: 'column', value: 'Amount' },
                { op: '*', type: 'number', value: '1.1' },
              ],
            },
          },
        ],
      };
      const catalog = buildColumnCatalog(reportSpec, sourceCatalog);
      expect(catalog.colMap.has('TotalCalc')).toBe(true);
      const entry = catalog.colMap.get('TotalCalc')!;
      expect(entry.kind).toBe('calc');
    });

    it('should create lookup boundaries', () => {
      const sourceCatalog = buildSourceCatalog();
      const reportSpec = {
        base: 'Orders',
        lookups: [
          {
            rightId: 'Contacts',
            enabled: true,
            keyPairs: [{ left: 'Company', right: 'Company' }],
          },
        ],
        calcStages: [],
      };
      const catalog = buildColumnCatalog(reportSpec, sourceCatalog);
      expect(catalog.lookupBoundaries).toHaveLength(2);
      expect(catalog.lookupBoundaries[0].has('OrderId')).toBe(true);
      expect(catalog.lookupBoundaries[0].has('Email')).toBe(false);
      expect(catalog.lookupBoundaries[1].has('Email')).toBe(true);
    });
  });
});
