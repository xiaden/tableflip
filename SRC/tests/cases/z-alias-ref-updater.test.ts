import { describe, it, expect, beforeEach } from 'vitest';
import { _renameProjectedAliasRefs } from '../../js/query/alias-ref-updater.js';

describe('Alias Ref Updater', () => {
  let db: any;

  beforeEach(() => {
    db = (globalThis as any).db;
    db.colOrder = null;
    db.selCols = null;
    db.groupBy = [];
    db.subtotalBy = [];
    db.mergedCols = [];
    db.aggregates = [];
    db.filters = [];
    db.sorts = [];
    db.calcStages = [];
    db.colTotals = {};
    db.subtotalFns = {};
    db.aggModeState = null;
  });

  describe('early return', () => {
    it('should do nothing when oldAlias is empty', () => {
      db.colOrder = ['A', 'B'];
      _renameProjectedAliasRefs('', 'B');
      expect(db.colOrder).toEqual(['A', 'B']);
    });

    it('should do nothing when newAlias is empty', () => {
      db.colOrder = ['A', 'B'];
      _renameProjectedAliasRefs('A', '');
      expect(db.colOrder).toEqual(['A', 'B']);
    });

    it('should do nothing when oldAlias equals newAlias', () => {
      db.colOrder = ['A', 'B'];
      _renameProjectedAliasRefs('A', 'A');
      expect(db.colOrder).toEqual(['A', 'B']);
    });
  });

  describe('colOrder', () => {
    it('should rename alias in colOrder', () => {
      db.colOrder = ['OrderId', 'OldName', 'Amount'];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.colOrder).toEqual(['OrderId', 'NewName', 'Amount']);
    });

    it('should remove entry if newAlias already exists in colOrder', () => {
      db.colOrder = ['OrderId', 'OldName', 'NewName'];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.colOrder).toEqual(['OrderId', 'NewName']);
    });

    it('should do nothing if oldAlias not in colOrder', () => {
      db.colOrder = ['OrderId', 'Amount'];
      _renameProjectedAliasRefs('Missing', 'NewName');
      expect(db.colOrder).toEqual(['OrderId', 'Amount']);
    });

    it('should handle null colOrder', () => {
      db.colOrder = null;
      expect(() => _renameProjectedAliasRefs('A', 'B')).not.toThrow();
    });
  });

  describe('selCols', () => {
    it('should rename alias in selCols Set', () => {
      db.selCols = new Set(['OrderId', 'OldName', 'Amount']);
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.selCols.has('NewName')).toBe(true);
      expect(db.selCols.has('OldName')).toBe(false);
      expect(db.selCols.size).toBe(3);
    });

    it('should handle null selCols', () => {
      db.selCols = null;
      expect(() => _renameProjectedAliasRefs('A', 'B')).not.toThrow();
    });

    it('should do nothing if oldAlias not in selCols', () => {
      db.selCols = new Set(['OrderId', 'Amount']);
      _renameProjectedAliasRefs('Missing', 'NewName');
      expect(db.selCols.has('OrderId')).toBe(true);
      expect(db.selCols.has('Amount')).toBe(true);
    });
  });

  describe('groupBy', () => {
    it('should rename alias in groupBy', () => {
      db.groupBy = ['Region', 'OldName'];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.groupBy).toEqual(['Region', 'NewName']);
    });

    it('should do nothing if oldAlias not in groupBy', () => {
      db.groupBy = ['Region', 'Status'];
      _renameProjectedAliasRefs('Missing', 'NewName');
      expect(db.groupBy).toEqual(['Region', 'Status']);
    });
  });

  describe('aggregates', () => {
    it('should rename alias in aggregates col', () => {
      db.aggregates = [
        { fn: 'SUM', col: 'OldName', alias: 'TotalOld' },
        { fn: 'COUNT', col: '*', alias: 'Count' },
      ];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggregates[0].col).toBe('NewName');
      expect(db.aggregates[1].col).toBe('*');
    });

    it('should not change aggregates that do not match', () => {
      db.aggregates = [{ fn: 'SUM', col: 'Amount', alias: 'TotalAmt' }];
      _renameProjectedAliasRefs('OtherCol', 'NewName');
      expect(db.aggregates[0].col).toBe('Amount');
    });
  });

  describe('filters', () => {
    it('should rename alias in filters col', () => {
      db.filters = [
        { col: 'OldName', op: 'equals', vals: ['x'], enabled: true },
        { col: 'Amount', op: 'gt', vals: ['100'], enabled: true },
      ];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.filters[0].col).toBe('NewName');
      expect(db.filters[1].col).toBe('Amount');
    });
  });

  describe('sorts', () => {
    it('should rename alias in sorts col', () => {
      db.sorts = [
        { col: 'OldName', dir: 'ASC', enabled: true },
        { col: 'Amount', dir: 'DESC', enabled: true },
      ];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.sorts[0].col).toBe('NewName');
      expect(db.sorts[1].col).toBe('Amount');
    });
  });

  describe('calcStages', () => {
    it('should rename alias in math calcStages steps', () => {
      db.calcStages = [{
        alias: 'Calc1',
        mode: 'math',
        enabled: true,
        math: {
          steps: [
            { type: 'column', value: 'OldName' },
            { type: 'operator', value: '+' },
            { type: 'number', value: '10' },
          ],
        },
      }];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.calcStages[0].math.steps[0].value).toBe('NewName');
      expect(db.calcStages[0].math.steps[1].value).toBe('+');
    });

    it('should rename alias in compare calcStages conditions', () => {
      db.calcStages = [{
        alias: 'Calc2',
        mode: 'compare',
        enabled: true,
        compare: {
          conditions: [{ col: 'OldName', op: 'gt', val: '100' }],
          trueValue: { type: 'column', value: 'OldName' },
          falseValue: { type: 'number', value: '0' },
        },
      }];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.calcStages[0].compare.conditions[0].col).toBe('NewName');
      expect(db.calcStages[0].compare.trueValue.value).toBe('NewName');
      expect(db.calcStages[0].compare.falseValue.value).toBe('0');
    });

    it('should rename alias in compare falseValue column ref', () => {
      db.calcStages = [{
        alias: 'Calc3',
        mode: 'compare',
        enabled: true,
        compare: {
          conditions: [],
          trueValue: { type: 'number', value: '1' },
          falseValue: { type: 'column', value: 'OldName' },
        },
      }];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.calcStages[0].compare.falseValue.value).toBe('NewName');
    });

    it('should rename alias in text calcStages parts', () => {
      db.calcStages = [{
        alias: 'Calc4',
        mode: 'text',
        enabled: true,
        text: {
          operation: 'combine',
          parts: [
            { type: 'column', value: 'OldName' },
            { type: 'literal', value: ' - ' },
            { type: 'column', value: 'Region' },
          ],
          source: { type: 'column', value: 'OldName' },
        },
      }];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.calcStages[0].text.parts[0].value).toBe('NewName');
      expect(db.calcStages[0].text.parts[1].value).toBe(' - ');
      expect(db.calcStages[0].text.parts[2].value).toBe('Region');
      expect(db.calcStages[0].text.source.value).toBe('NewName');
    });

    it('should not touch non-column steps', () => {
      db.calcStages = [{
        alias: 'Calc5',
        mode: 'math',
        enabled: true,
        math: {
          steps: [
            { type: 'number', value: 'OldName' },
            { type: 'operator', value: '+' },
          ],
        },
      }];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.calcStages[0].math.steps[0].value).toBe('OldName');
    });
  });

  describe('colTotals', () => {
    it('should rename key in colTotals', () => {
      db.colTotals = { OldName: 'SUM', Amount: 'AVG' };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.colTotals['NewName']).toBe('SUM');
      expect(db.colTotals['OldName']).toBeUndefined();
      expect(db.colTotals['Amount']).toBe('AVG');
    });

    it('should delete old key if new key already exists', () => {
      db.colTotals = { OldName: 'SUM', NewName: 'AVG' };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.colTotals['NewName']).toBe('AVG');
      expect(db.colTotals['OldName']).toBeUndefined();
    });

    it('should handle empty colTotals', () => {
      db.colTotals = {};
      expect(() => _renameProjectedAliasRefs('A', 'B')).not.toThrow();
    });
  });

  describe('subtotalFns', () => {
    it('should rename key in subtotalFns', () => {
      db.subtotalFns = { OldName: 'SUM', Amount: 'AVG' };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.subtotalFns['NewName']).toBe('SUM');
      expect(db.subtotalFns['OldName']).toBeUndefined();
      expect(db.subtotalFns['Amount']).toBe('AVG');
    });

    it('should delete old key if new key already exists', () => {
      db.subtotalFns = { OldName: 'SUM', NewName: 'COUNT' };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.subtotalFns['NewName']).toBe('COUNT');
      expect(db.subtotalFns['OldName']).toBeUndefined();
    });
  });

  describe('subtotalBy', () => {
    it('should rename alias in subtotalBy', () => {
      db.subtotalBy = ['Region', 'OldName'];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.subtotalBy).toEqual(['Region', 'NewName']);
    });
  });

  describe('mergedCols', () => {
    it('should rename alias in mergedCols', () => {
      db.mergedCols = ['Company', 'OldName'];
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.mergedCols).toEqual(['Company', 'NewName']);
    });
  });

  describe('aggModeState', () => {
    it('should rename in aggModeState.none.selCols', () => {
      db.aggModeState = {
        none: { selCols: ['OrderId', 'OldName'] },
        group: null,
        totals: null,
        subtotals: null,
      };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggModeState.none.selCols).toEqual(['OrderId', 'NewName']);
    });

    it('should rename in aggModeState.totals.selCols', () => {
      db.aggModeState = {
        none: null,
        group: null,
        totals: { selCols: ['OrderId', 'OldName'], colTotals: {} },
        subtotals: null,
      };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggModeState.totals.selCols).toEqual(['OrderId', 'NewName']);
    });

    it('should rename in aggModeState.totals.colTotals', () => {
      db.aggModeState = {
        none: null,
        group: null,
        totals: { selCols: [], colTotals: { OldName: 'SUM' } },
        subtotals: null,
      };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggModeState.totals.colTotals['NewName']).toBe('SUM');
      expect(db.aggModeState.totals.colTotals['OldName']).toBeUndefined();
    });

    it('should rename in aggModeState.group.groupBy', () => {
      db.aggModeState = {
        none: null,
        group: { groupBy: ['OldName', 'Region'], aggregates: [] },
        totals: null,
        subtotals: null,
      };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggModeState.group.groupBy).toEqual(['NewName', 'Region']);
    });

    it('should rename in aggModeState.group.aggregates', () => {
      db.aggModeState = {
        none: null,
        group: {
          groupBy: [],
          aggregates: [{ fn: 'SUM', col: 'OldName', alias: 'Total' }],
        },
        totals: null,
        subtotals: null,
      };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggModeState.group.aggregates[0].col).toBe('NewName');
    });

    it('should rename in aggModeState.subtotals.subtotalBy', () => {
      db.aggModeState = {
        none: null,
        group: null,
        totals: null,
        subtotals: {
          selCols: [],
          subtotalBy: ['OldName'],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggModeState.subtotals.subtotalBy).toEqual(['NewName']);
    });

    it('should rename in aggModeState.subtotals.subtotalFns', () => {
      db.aggModeState = {
        none: null,
        group: null,
        totals: null,
        subtotals: {
          selCols: [],
          subtotalBy: [],
          subtotalFns: { OldName: 'SUM' },
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggModeState.subtotals.subtotalFns['NewName']).toBe('SUM');
      expect(db.aggModeState.subtotals.subtotalFns['OldName']).toBeUndefined();
    });

    it('should rename in aggModeState.subtotals.selCols', () => {
      db.aggModeState = {
        none: null,
        group: null,
        totals: null,
        subtotals: {
          selCols: ['OrderId', 'OldName'],
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      };
      _renameProjectedAliasRefs('OldName', 'NewName');
      expect(db.aggModeState.subtotals.selCols).toEqual(['OrderId', 'NewName']);
    });

    it('should handle null aggModeState', () => {
      db.aggModeState = null;
      expect(() => _renameProjectedAliasRefs('A', 'B')).not.toThrow();
    });
  });

  describe('combined updates', () => {
    it('should update all references simultaneously', () => {
      db.colOrder = ['OldName', 'Region'];
      db.selCols = new Set(['OldName', 'Region']);
      db.groupBy = ['OldName'];
      db.aggregates = [{ fn: 'SUM', col: 'OldName', alias: 'Total' }];
      db.filters = [{ col: 'OldName', op: 'equals', vals: ['x'], enabled: true }];
      db.sorts = [{ col: 'OldName', dir: 'ASC', enabled: true }];
      db.colTotals = { OldName: 'SUM' };
      db.subtotalFns = { OldName: 'AVG' };

      _renameProjectedAliasRefs('OldName', 'NewName');

      expect(db.colOrder).toEqual(['NewName', 'Region']);
      expect(db.selCols.has('NewName')).toBe(true);
      expect(db.selCols.has('OldName')).toBe(false);
      expect(db.groupBy).toEqual(['NewName']);
      expect(db.aggregates[0].col).toBe('NewName');
      expect(db.filters[0].col).toBe('NewName');
      expect(db.sorts[0].col).toBe('NewName');
      expect(db.colTotals['NewName']).toBe('SUM');
      expect(db.subtotalFns['NewName']).toBe('AVG');
    });
  });
});
