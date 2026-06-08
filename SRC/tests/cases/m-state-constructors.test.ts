import { describe, it, expect, beforeEach } from 'vitest';
import {
  createWorkspaceState,
  createReportSpec,
  createLookupSpec,
  createFilterSpec,
  createSortSpec,
  createOutputColumnSpec,
} from '../../js/core/state.js';

describe('State Constructors', () => {
  beforeEach(() => {
    const db = (globalThis as any).db;
    db.tables = {};
    db.base = '';
    db.stacks = [];
    db.lookups = [];
    db.calcStages = [];
    db.selCols = null;
    db.colOrder = null;
    db.filters = [];
    db.groupBy = [];
    db.aggregates = [];
    db.aggMode = 'none';
    db.sorts = [];
    db.result = null;
  });

  describe('createWorkspaceState', () => {
    it('should return correct default shape', () => {
      const ws = createWorkspaceState();
      expect(ws.version).toBe(1);
      expect(ws.sourceTables).toEqual({});
      expect(ws.reports).toEqual([]);
      expect(ws.activeReportId).toBeNull();
      expect(ws.runtime).toEqual({
        resultsByReportId: {},
        validationByReportId: {},
        activeGridState: {},
      });
    });

    it('should accept overrides', () => {
      const ws = createWorkspaceState({ version: 2, activeReportId: 'r1' });
      expect(ws.version).toBe(2);
      expect(ws.activeReportId).toBe('r1');
      expect(ws.reports).toEqual([]);
    });
  });

  describe('createReportSpec', () => {
    it('should return correct default shape', () => {
      const rs = createReportSpec();
      expect(rs.id).toBeNull();
      expect(rs.name).toBe('New Report');
      expect(rs.enabled).toBe(true);
      expect(rs.pipeline).toEqual({
        base: '',
        baseCols: null,
        stacks: [],
        lookups: [],
        calculatedColumns: [],
      });
      expect(rs.outputColumns).toBeNull();
      expect(rs.filters).toEqual([]);
      expect(rs.sorts).toEqual([]);
      expect(rs.aggregation).toEqual({
        mode: 'none',
        groupBy: [],
        aggregates: [],
        colTotals: {},
        subtotalBy: [],
        subtotalFns: {},
        subtotalGrandTotal: true,
        subtotalSpacer: false,
        subtotalOnTop: false,
        subtotalStrategy: 'combined',
      });
      expect(rs.mergeDisplay).toEqual({
        mergedCols: [],
        mergeGroupUnderline: false,
      });
      expect(rs.outputDefinition).toBeNull();
      expect(rs.publish).toEqual({ enabled: false, tableName: '' });
    });

    it('should accept overrides', () => {
      const rs = createReportSpec({ name: 'My Report', enabled: false });
      expect(rs.name).toBe('My Report');
      expect(rs.enabled).toBe(false);
      expect(rs.id).toBeNull();
    });
  });

  describe('createLookupSpec', () => {
    it('should return correct default shape', () => {
      const lk = createLookupSpec();
      expect(lk.rightId).toBe('');
      expect(lk.keyPairs).toEqual([]);
      expect(lk.cols).toEqual([]);
      expect(lk.required).toBe(false);
      expect(lk.enabled).toBe(true);
      expect(lk.duplicatePolicy).toEqual({ mode: 'block' });
    });

    it('should accept overrides', () => {
      const lk = createLookupSpec({ rightId: 'Contacts', required: true });
      expect(lk.rightId).toBe('Contacts');
      expect(lk.required).toBe(true);
      expect(lk.enabled).toBe(true);
    });
  });

  describe('createFilterSpec', () => {
    it('should return correct default shape', () => {
      const f = createFilterSpec();
      expect(f.col).toBe('');
      expect(f.op).toBe('contains');
      expect(f.val).toBe('');
      expect(f.vals).toBeNull();
      expect(f.enabled).toBe(true);
    });

    it('should accept overrides', () => {
      const f = createFilterSpec({ col: 'Amount', op: 'gt', val: '100' });
      expect(f.col).toBe('Amount');
      expect(f.op).toBe('gt');
      expect(f.val).toBe('100');
    });
  });

  describe('createSortSpec', () => {
    it('should return correct default shape', () => {
      const s = createSortSpec();
      expect(s.col).toBe('');
      expect(s.dir).toBe('ASC');
      expect(s.enabled).toBe(true);
    });

    it('should accept overrides', () => {
      const s = createSortSpec({ col: 'Amount', dir: 'DESC', enabled: false });
      expect(s.col).toBe('Amount');
      expect(s.dir).toBe('DESC');
      expect(s.enabled).toBe(false);
    });
  });

  describe('createOutputColumnSpec', () => {
    it('should return correct default shape', () => {
      const oc = createOutputColumnSpec();
      expect(oc.alias).toBe('');
      expect(oc.label).toBe('');
      expect(oc.visible).toBe(true);
      expect(oc.width).toBeNull();
    });

    it('should accept overrides', () => {
      const oc = createOutputColumnSpec({ alias: 'TotalAmt', label: 'Total', width: 120 });
      expect(oc.alias).toBe('TotalAmt');
      expect(oc.label).toBe('Total');
      expect(oc.width).toBe(120);
      expect(oc.visible).toBe(true);
    });
  });
});
