import { describe, it, expect } from 'vitest';
import {
  validateLookupSpec,
  expandLookups,
  detectDuplicateLookupKeys,
  applyDuplicatePolicy,
} from '../../query/lookup-resolver';
import type { LookupSpec } from '../../types';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import { standardSourceCatalog } from './helpers';

describe('lookup-resolver', () => {
  const sourceCatalog = standardSourceCatalog();

  describe('validateLookupSpec()', () => {
    it('should report missing rightId', () => {
      const lookup: LookupSpec = {
        rightId: '',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      };
      const issues = validateLookupSpec(lookup, 0, sourceCatalog);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].code).toBe('MISSING_RIGHT_TABLE');
    });

    it('should report rightId not in catalog', () => {
      const lookup: LookupSpec = {
        rightId: 'NonExistent',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      };
      const issues = validateLookupSpec(lookup, 0, sourceCatalog);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].code).toBe('RIGHT_TABLE_NOT_FOUND');
      expect(issues[0].missingTableId).toBe('NonExistent');
    });

    it('should report no key pairs', () => {
      const lookup: LookupSpec = {
        rightId: 'Contacts',
        keyPairs: [],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      };
      const issues = validateLookupSpec(lookup, 0, sourceCatalog);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].code).toBe('NO_KEY_PAIRS');
    });

    it('should report no complete key pairs (missing left)', () => {
      const lookup: LookupSpec = {
        rightId: 'Contacts',
        keyPairs: [{ left: '', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      };
      const issues = validateLookupSpec(lookup, 0, sourceCatalog);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].code).toBe('NO_KEY_PAIRS');
    });

    it('should report right column not found', () => {
      const lookup: LookupSpec = {
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'NonExistentCol' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      };
      const issues = validateLookupSpec(lookup, 0, sourceCatalog);
      expect(issues.length).toBeGreaterThan(0);
      const colIssue = issues.find(i => i.code === 'RIGHT_COLUMN_NOT_FOUND');
      expect(colIssue).toBeTruthy();
      expect(colIssue!.missingColumn).toBe('NonExistentCol');
    });

    it('should return empty issues for valid spec', () => {
      const lookup: LookupSpec = {
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name', 'Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      };
      const issues = validateLookupSpec(lookup, 0, sourceCatalog);
      expect(issues).toEqual([]);
    });

    it('should report multiple issues for multiple bad pairs', () => {
      const lookup: LookupSpec = {
        rightId: 'Contacts',
        keyPairs: [
          { left: 'Contact', right: 'BadCol1' },
          { left: 'Company', right: 'BadCol2' },
        ],
        cols: [],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      };
      const issues = validateLookupSpec(lookup, 0, sourceCatalog);
      const colIssues = issues.filter(i => i.code === 'RIGHT_COLUMN_NOT_FOUND');
      expect(colIssues.length).toBe(2);
    });
  });

  describe('expandLookups()', () => {
    it('should return empty array for empty lookups', () => {
      const result = expandLookups([], sourceCatalog);
      expect(result).toEqual([]);
    });

    it('should return empty array for null lookups', () => {
      const result = expandLookups(null as unknown as LookupSpec[], sourceCatalog);
      expect(result).toEqual([]);
    });

    it('should skip disabled lookups', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: false,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = expandLookups(lookups, sourceCatalog);
      expect(result).toEqual([]);
    });

    it('should skip lookups with missing rightId', () => {
      const lookups: LookupSpec[] = [{
        rightId: '',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = expandLookups(lookups, sourceCatalog);
      expect(result).toEqual([]);
    });

    it('should skip lookups with rightId not in catalog', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'NonExistent',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = expandLookups(lookups, sourceCatalog);
      expect(result).toEqual([]);
    });

    it('should skip lookups with no valid key pairs', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = expandLookups(lookups, sourceCatalog);
      expect(result).toEqual([]);
    });

    it('should skip lookups where right column does not exist in table', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'NonExistentCol' }],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = expandLookups(lookups, sourceCatalog);
      expect(result).toEqual([]);
    });

    it('should resolve valid lookups', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [{ left: 'Contact', right: 'ContactId' }],
        cols: ['Name', 'Email'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = expandLookups(lookups, sourceCatalog);
      expect(result.length).toBe(1);
      expect(result[0].lookup).toBe(lookups[0]);
      expect(result[0].resolved.rightTable.id).toBe('Contacts');
      expect(result[0].resolved.pairs).toEqual([{ left: 'Contact', right: 'ContactId' }]);
    });

    it('should filter out invalid pairs while keeping valid ones', () => {
      const lookups: LookupSpec[] = [{
        rightId: 'Contacts',
        keyPairs: [
          { left: 'Contact', right: 'ContactId' },
          { left: 'Company', right: 'NonExistentCol' },
        ],
        cols: ['Name'],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      }];
      const result = expandLookups(lookups, sourceCatalog);
      expect(result.length).toBe(1);
      expect(result[0].resolved.pairs.length).toBe(1);
      expect(result[0].resolved.pairs[0].right).toBe('ContactId');
    });

    it('should handle multiple valid lookups', () => {
      const extendedCatalog = new Map(sourceCatalog);
      extendedCatalog.set('Products', {
        id: 'Products',
        name: 'Products',
        cols: ['ProductId', 'ProductName'],
        kind: 'imported',
        source: { id: 'Products', name: 'Products', cols: ['ProductId', 'ProductName'], rowCount: 3 },
      });

      const lookups: LookupSpec[] = [
        {
          rightId: 'Contacts',
          keyPairs: [{ left: 'Contact', right: 'ContactId' }],
          cols: ['Name'],
          required: false,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        },
        {
          rightId: 'Products',
          keyPairs: [{ left: 'OrderId', right: 'ProductId' }],
          cols: ['ProductName'],
          required: true,
          enabled: true,
          duplicatePolicy: { mode: 'block' },
        },
      ];
      const result = expandLookups(lookups, extendedCatalog);
      expect(result.length).toBe(2);
    });
  });

  describe('detectDuplicateLookupKeys()', () => {
    it('should report no duplicates for unique keys', () => {
      const rows = [
        { ContactId: 'C1', Name: 'Alice' },
        { ContactId: 'C2', Name: 'Bob' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'ContactId' }]);
      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicateCount).toBe(0);
      expect(result.duplicateKeys).toEqual([]);
    });

    it('should detect duplicates', () => {
      const rows = [
        { ContactId: 'C1', Name: 'Alice' },
        { ContactId: 'C1', Name: 'Alice 2' },
        { ContactId: 'C2', Name: 'Bob' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'ContactId' }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(1);
      expect(result.duplicateKeys.length).toBe(1);
    });

    it('should handle empty rows', () => {
      const result = detectDuplicateLookupKeys([], [{ right: 'ContactId' }]);
      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicateCount).toBe(0);
    });

    it('should handle null rows', () => {
      const result = detectDuplicateLookupKeys(null as unknown as Record<string, unknown>[], [{ right: 'ContactId' }]);
      expect(result.hasDuplicates).toBe(false);
    });

    it('should handle composite keys', () => {
      const rows = [
        { A: '1', B: 'x', Name: 'First' },
        { A: '1', B: 'x', Name: 'Duplicate' },
        { A: '1', B: 'y', Name: 'Different' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'A' }, { right: 'B' }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(1);
    });

    it('should detect multiple duplicate groups', () => {
      const rows = [
        { K: 'a', V: 1 },
        { K: 'a', V: 2 },
        { K: 'b', V: 3 },
        { K: 'b', V: 4 },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'K' }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(2);
    });
  });

  describe('applyDuplicatePolicy()', () => {
    it('should return original rows when mode is block', () => {
      const rows = [
        { ContactId: 'C1', Name: 'Alice' },
        { ContactId: 'C1', Name: 'Alice 2' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'ContactId' }], { mode: 'block' });
      expect(result).toBe(rows);
      expect(result.length).toBe(2);
    });

    it('should return original rows when policy is null/undefined', () => {
      const rows = [
        { ContactId: 'C1', Name: 'Alice' },
      ];
      expect(applyDuplicatePolicy(rows, [{ right: 'ContactId' }], null as any)).toBe(rows);
      expect(applyDuplicatePolicy(rows, [{ right: 'ContactId' }], undefined as any)).toBe(rows);
    });

    it('should merge duplicates when mode is combine', () => {
      const rows = [
        { ContactId: 'C1', Name: 'Alice' },
        { ContactId: 'C1', Name: 'Bob' },
        { ContactId: 'C2', Name: 'Carol' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'ContactId' }], { mode: 'combine' });
      expect(result.length).toBe(2);
      // The merged row should have concatenated names (sorted)
      const c1Row = result.find(r => r.ContactId === 'C1');
      expect(c1Row).toBeTruthy();
      expect(c1Row!.Name).toContain('Alice');
      expect(c1Row!.Name).toContain('Bob');
    });

    it('should use custom separator in combine mode', () => {
      const rows = [
        { K: 'A', V: 'x' },
        { K: 'A', V: 'y' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'K' }], {
        mode: 'combine',
        combine: { separator: ' | ', sort: false, unique: true },
      });
      expect(result.length).toBe(1);
      expect(result[0].V).toBe('x | y');
    });

    it('should deduplicate values when unique is true', () => {
      const rows = [
        { K: 'A', V: 'x' },
        { K: 'A', V: 'x' },
        { K: 'A', V: 'y' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'K' }], {
        mode: 'combine',
        combine: { separator: ', ', unique: true, sort: false },
      });
      expect(result.length).toBe(1);
      expect(result[0].V).toBe('x, y');
    });

    it('should keep key column value from first row', () => {
      const rows = [
        { K: 'A', V: 'first' },
        { K: 'A', V: 'second' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'K' }], { mode: 'combine' });
      expect(result[0].K).toBe('A');
    });

    it('should handle empty rows', () => {
      const result = applyDuplicatePolicy([], [{ right: 'K' }], { mode: 'combine' });
      expect(result).toEqual([]);
    });

    it('should handle null rows', () => {
      const result = applyDuplicatePolicy(null as any, [{ right: 'K' }], { mode: 'combine' });
      expect(result).toEqual([]);
    });
  });
});
