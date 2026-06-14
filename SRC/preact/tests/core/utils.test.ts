import { describe, it, expect, beforeEach } from 'vitest';
import { initStore } from '../../core/store';
import {
  h,
  stripExt,
  chipFgColor,
  smartDefaultFn,
  defaultAggAlias,
  TABLE_PALETTE,
  getTableColor,
  getTableColorClass,
  tableShortName,
  colUserLabel,
  setColLabel,
} from '../../core/utils';

beforeEach(() => {
  initStore();
});

describe('Utils', () => {
  describe('h() HTML escaping', () => {
    it('should escape ampersands', () => {
      expect(h('a&b')).toBe('a&amp;b');
    });

    it('should escape less-than', () => {
      expect(h('a<b')).toBe('a&lt;b');
    });

    it('should escape greater-than', () => {
      expect(h('a>b')).toBe('a&gt;b');
    });

    it('should escape double quotes', () => {
      expect(h('a"b')).toBe('a&quot;b');
    });

    it('should handle null and undefined', () => {
      expect(h(null)).toBe('');
      expect(h(undefined)).toBe('');
    });

    it('should handle numbers', () => {
      expect(h(42)).toBe('42');
    });

    it('should escape multiple characters', () => {
      expect(h('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    });
  });

  describe('stripExt()', () => {
    it('should remove file extension', () => {
      expect(stripExt('file.txt')).toBe('file');
    });

    it('should remove last extension only', () => {
      expect(stripExt('archive.tar.gz')).toBe('archive.tar');
    });

    it('should handle no extension', () => {
      expect(stripExt('filename')).toBe('filename');
    });

    it('should handle path with extension', () => {
      expect(stripExt('/path/to/file.xlsx')).toBe('/path/to/file');
    });
  });

  describe('chipFgColor()', () => {
    it('should return dark text for light backgrounds', () => {
      expect(chipFgColor('#FFFFFF')).toBe('#111');
      expect(chipFgColor('#FFFF00')).toBe('#111');
    });

    it('should return white text for dark backgrounds', () => {
      expect(chipFgColor('#000000')).toBe('#fff');
      expect(chipFgColor('#4477AA')).toBe('#fff');
    });

    it('should return default for invalid input', () => {
      expect(chipFgColor('')).toBe('#111');
      expect(chipFgColor('invalid')).toBe('#111');
      expect(chipFgColor(null as any)).toBe('#111');
    });
  });

  describe('smartDefaultFn()', () => {
    it('should return DATE RANGE for date columns', () => {
      expect(smartDefaultFn('date')).toBe('DATE RANGE');
      expect(smartDefaultFn('shipped_date')).toBe('DATE RANGE');
      expect(smartDefaultFn('created_at')).toBe('DATE RANGE');
      expect(smartDefaultFn('time')).toBe('DATE RANGE');
    });

    it('should return SUM for numeric columns', () => {
      expect(smartDefaultFn('Amount')).toBe('SUM');
      expect(smartDefaultFn('total_price')).toBe('SUM');
      expect(smartDefaultFn('quantity')).toBe('SUM');
      expect(smartDefaultFn('revenue')).toBe('SUM');
    });

    it('should return FIRST for other columns', () => {
      expect(smartDefaultFn('Name')).toBe('FIRST');
      expect(smartDefaultFn('Status')).toBe('FIRST');
      expect(smartDefaultFn('Category')).toBe('FIRST');
    });
  });

  describe('defaultAggAlias()', () => {
    it('should return correct alias for SUM', () => {
      expect(defaultAggAlias('SUM', 'Amount')).toBe('Total Amount');
    });

    it('should return correct alias for AVG', () => {
      expect(defaultAggAlias('AVG', 'Price')).toBe('Avg Price');
    });

    it('should return correct alias for COUNT ROWS', () => {
      expect(defaultAggAlias('COUNT ROWS', '')).toBe('Row Count');
    });

    it('should return correct alias for COUNT NON-EMPTY', () => {
      expect(defaultAggAlias('COUNT NON-EMPTY', 'Email')).toBe('# Email');
    });

    it('should return correct alias for COUNT DISTINCT', () => {
      expect(defaultAggAlias('COUNT DISTINCT', 'Company')).toBe('Unique Company');
    });

    it('should return correct alias for MIN', () => {
      expect(defaultAggAlias('MIN', 'Amount')).toBe('Min Amount');
    });

    it('should return correct alias for MAX', () => {
      expect(defaultAggAlias('MAX', 'Amount')).toBe('Max Amount');
    });

    it('should return correct alias for FIRST', () => {
      expect(defaultAggAlias('FIRST', 'Name')).toBe('Name (first)');
    });

    it('should return correct alias for LAST', () => {
      expect(defaultAggAlias('LAST', 'Name')).toBe('Name (last)');
    });

    it('should return correct alias for DATE RANGE', () => {
      expect(defaultAggAlias('DATE RANGE', 'Date')).toBe('Date Range');
    });

    it('should return correct alias for DATE SPAN', () => {
      expect(defaultAggAlias('DATE SPAN', 'Date')).toBe('Date Span (days)');
    });

    it('should return correct alias for LIST', () => {
      expect(defaultAggAlias('LIST', 'Items')).toBe('Items (list)');
    });

    it('should return fallback for unknown function', () => {
      expect(defaultAggAlias('CUSTOM', 'Col')).toBe('CUSTOM(Col)');
    });
  });

  describe('TABLE_PALETTE', () => {
    it('should be a non-empty array of hex colors', () => {
      expect(TABLE_PALETTE.length).toBeGreaterThan(0);
      for (const c of TABLE_PALETTE) {
        expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });
  });

  describe('getTableColor()', () => {
    it('should assign a color to a table', () => {
      const color = getTableColor('TestTable');
      expect(color).toBeTruthy();
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should return same color for same table', () => {
      const color1 = getTableColor('SameTable');
      const color2 = getTableColor('SameTable');
      expect(color1).toBe(color2);
    });

    it('should assign different colors to different tables', () => {
      const color1 = getTableColor('Table1');
      const color2 = getTableColor('Table2');
      expect(color1).not.toBe(color2);
    });
  });

  describe('getTableColorClass()', () => {
    it('should return correct class format', () => {
      const cls = getTableColorClass('ClassTest');
      expect(cls).toMatch(/^chip-c\d+$/);
    });
  });

  describe('tableShortName()', () => {
    it('should return full name for short names', () => {
      initStore({
        tables: { Short: { id: 'Short', name: 'Short', cols: [], rowCount: 0 } },
      });
      expect(tableShortName('Short')).toBe('Short');
    });

    it('should truncate long names with ellipsis', () => {
      initStore({
        tables: { VeryLongTableName: { id: 'VeryLongTableName', name: 'VeryLongTableName', cols: [], rowCount: 0 } },
      });
      const result = tableShortName('VeryLongTableName');
      expect(result).toHaveLength(13);
      expect(result).toContain('…');
    });

    it('should fallback to tid when table not found', () => {
      expect(tableShortName('NonExistent')).toBe('NonExistent');
    });
  });

  describe('colUserLabel()', () => {
    it('should return custom label when set', () => {
      initStore({
        columnLabels: { Orders: { Amount: 'Total $' } },
      });
      expect(colUserLabel('Orders', 'Amount')).toBe('Total $');
    });

    it('should return physical column name when no label', () => {
      initStore({ columnLabels: {} });
      expect(colUserLabel('Orders', 'Amount')).toBe('Amount');
    });
  });

  describe('setColLabel()', () => {
    it('should set a custom label', () => {
      initStore({ columnLabels: {} });
      setColLabel('Orders', 'Amount', 'Revenue');
      expect(getStore().getState().columnLabels['Orders']['Amount']).toBe('Revenue');
    });

    it('should clear label when set to physical column name', () => {
      initStore({
        columnLabels: { Orders: { Amount: 'Revenue' } },
      });
      setColLabel('Orders', 'Amount', 'Amount');
      expect(getStore().getState().columnLabels['Orders']?.['Amount']).toBeUndefined();
    });

    it('should clear label when set to empty string', () => {
      initStore({
        columnLabels: { Orders: { Amount: 'Revenue' } },
      });
      setColLabel('Orders', 'Amount', '');
      expect(getStore().getState().columnLabels['Orders']?.['Amount']).toBeUndefined();
    });

    it('should clean up empty table label object', () => {
      initStore({
        columnLabels: { Orders: { Amount: 'Revenue' } },
      });
      setColLabel('Orders', 'Amount', 'Amount');
      expect(getStore().getState().columnLabels['Orders']).toBeUndefined();
    });
  });
});

// Need getStore import for setColLabel tests
import { getStore } from '../../core/store';
