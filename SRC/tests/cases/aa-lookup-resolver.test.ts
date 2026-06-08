import { describe, it, expect, beforeAll } from 'vitest';

let validateLookupSpec: any;
let buildLookupPlan: any;
let checkLookupDuplicates: any;
let detectDuplicateLookupKeys: any;
let applyDuplicatePolicy: any;

beforeAll(async () => {
  const mod = await import('../../js/query/lookup-resolver.js');
  validateLookupSpec = mod.validateLookupSpec;
  buildLookupPlan = mod.buildLookupPlan;
  checkLookupDuplicates = mod.checkLookupDuplicates;
  detectDuplicateLookupKeys = mod.detectDuplicateLookupKeys;
  applyDuplicatePolicy = mod.applyDuplicatePolicy;
});

function makeLookup(overrides: Record<string, unknown> = {}): LookupSpec {
  return {
    rightId: 'Contacts',
    keyPairs: [{ left: 'Company', right: 'Company' }],
    cols: ['Email', 'Phone'],
    required: false,
    enabled: true,
    duplicatePolicy: { mode: 'block' },
    ...overrides,
  } as LookupSpec;
}

describe('Lookup Resolver', () => {
  describe('validateLookupSpec', () => {
    it('should return no issues for a valid lookup spec', () => {
      const db = (globalThis as any).db;
      db.lookups = [makeLookup()];
      const issues = validateLookupSpec(makeLookup(), 0);
      expect(issues).toEqual([]);
    });

    it('should fail with MISSING_RIGHT_TABLE when rightId is empty', () => {
      const issues = validateLookupSpec(makeLookup({ rightId: '' }), 0);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].code).toBe('MISSING_RIGHT_TABLE');
    });

    it('should fail with RIGHT_TABLE_NOT_FOUND for unknown table', () => {
      const issues = validateLookupSpec(makeLookup({ rightId: 'NoSuchTable' }), 0);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].code).toBe('RIGHT_TABLE_NOT_FOUND');
      expect(issues[0].missingTableId).toBe('NoSuchTable');
    });

    it('should fail with NO_KEY_PAIRS when keyPairs is empty', () => {
      const issues = validateLookupSpec(makeLookup({ keyPairs: [] }), 0);
      const noKeyPairs = issues.find((i: any) => i.code === 'NO_KEY_PAIRS');
      expect(noKeyPairs).toBeTruthy();
    });

    it('should fail with NO_KEY_PAIRS when all keyPairs are incomplete', () => {
      const issues = validateLookupSpec(makeLookup({ keyPairs: [{ left: '', right: '' }] }), 0);
      const noKeyPairs = issues.find((i: any) => i.code === 'NO_KEY_PAIRS');
      expect(noKeyPairs).toBeTruthy();
    });

    it('should report LEFT_COLUMN_UNAVAILABLE for invalid left column', () => {
      const db = (globalThis as any).db;
      db.lookups = [makeLookup({ keyPairs: [{ left: 'NonExistent', right: 'Company' }] })];
      const issues = validateLookupSpec(makeLookup({ keyPairs: [{ left: 'NonExistent', right: 'Company' }] }), 0);
      const leftIssue = issues.find((i: any) => i.code === 'LEFT_COLUMN_UNAVAILABLE');
      expect(leftIssue).toBeTruthy();
      expect(leftIssue.missingColumn).toBe('NonExistent');
    });

    it('should report RIGHT_COLUMN_NOT_FOUND for invalid right column', () => {
      const db = (globalThis as any).db;
      db.lookups = [makeLookup({ keyPairs: [{ left: 'Company', right: 'NoSuchCol' }] })];
      const issues = validateLookupSpec(makeLookup({ keyPairs: [{ left: 'Company', right: 'NoSuchCol' }] }), 0);
      const rightIssue = issues.find((i: any) => i.code === 'RIGHT_COLUMN_NOT_FOUND');
      expect(rightIssue).toBeTruthy();
      expect(rightIssue.missingColumn).toBe('NoSuchCol');
    });

    it('should validate compound key pairs', () => {
      const db = (globalThis as any).db;
      const lk = makeLookup({ keyPairs: [{ left: 'Company', right: 'Company' }, { left: 'Contact', right: 'Contact' }] });
      db.lookups = [lk];
      const issues = validateLookupSpec(lk, 0);
      expect(issues).toEqual([]);
    });
  });

  describe('buildLookupPlan', () => {
    it('should build plan with correct structure', () => {
      const lk = makeLookup();
      const plan = buildLookupPlan(lk);
      expect(plan.rightId).toBe('Contacts');
      expect(plan.keyPairs).toEqual([{ left: 'Company', right: 'Company' }]);
      expect(plan.required).toBe(false);
      expect(plan.duplicatePolicy).toEqual({ mode: 'block' });
    });

    it('should filter incomplete keyPairs', () => {
      const lk = makeLookup({ keyPairs: [{ left: 'Company', right: 'Company' }, { left: '', right: 'Contact' }, { left: 'Contact', right: '' }] });
      const plan = buildLookupPlan(lk);
      expect(plan.keyPairs).toEqual([{ left: 'Company', right: 'Company' }]);
    });

    it('should return empty keyPairs when all are incomplete', () => {
      const lk = makeLookup({ keyPairs: [{ left: '', right: '' }] });
      const plan = buildLookupPlan(lk);
      expect(plan.keyPairs).toEqual([]);
    });

    it('should preserve duplicatePolicy', () => {
      const policy = { mode: 'combine', combine: { separator: ', ', unique: true, includeBlank: false, sort: true } };
      const lk = makeLookup({ duplicatePolicy: policy });
      const plan = buildLookupPlan(lk);
      expect(plan.duplicatePolicy).toEqual(policy);
    });

    it('should default duplicatePolicy to block when missing', () => {
      const lk = makeLookup();
      delete (lk as any).duplicatePolicy;
      const plan = buildLookupPlan(lk);
      expect(plan.duplicatePolicy).toEqual({ mode: 'block' });
    });

    it('should handle required flag as true', () => {
      const lk = makeLookup({ required: true });
      const plan = buildLookupPlan(lk);
      expect(plan.required).toBe(true);
    });

    it('should handle required flag as falsy', () => {
      const lk = makeLookup({ required: false });
      const plan = buildLookupPlan(lk);
      expect(plan.required).toBe(false);
    });

    it('should handle missing keyPairs gracefully', () => {
      const lk = makeLookup();
      delete (lk as any).keyPairs;
      const plan = buildLookupPlan(lk);
      expect(plan.keyPairs).toEqual([]);
    });
  });

  describe('checkLookupDuplicates', () => {
    it('should return null when rightId is empty', () => {
      const result = checkLookupDuplicates(makeLookup({ rightId: '' }));
      expect(result).toBeNull();
    });

    it('should return null for non-existent table', () => {
      const result = checkLookupDuplicates(makeLookup({ rightId: 'NoSuchTable' }));
      expect(result).toBeNull();
    });

    it('should return null for combine mode (duplicates allowed)', () => {
      const lk = makeLookup({ duplicatePolicy: { mode: 'combine' } });
      const result = checkLookupDuplicates(lk);
      expect(result).toBeNull();
    });

    it('should return null when no valid key pairs', () => {
      const lk = makeLookup({ keyPairs: [{ left: '', right: '' }] });
      const result = checkLookupDuplicates(lk);
      expect(result).toBeNull();
    });

    it('should return error message for duplicate Company keys', () => {
      const lk = makeLookup({ keyPairs: [{ left: 'Company', right: 'Company' }] });
      const result = checkLookupDuplicates(lk);
      expect(result).toBeTruthy();
      expect(result).toContain('duplicate');
    });

    it('should return null for unique compound keys (Company + Contact + Email)', () => {
      const lk = makeLookup({
        keyPairs: [
          { left: 'Company', right: 'Company' },
          { left: 'Contact', right: 'Contact' },
          { left: 'Company', right: 'Email' },
        ],
      });
      const result = checkLookupDuplicates(lk);
      expect(result).toBeNull();
    });

    it('should handle excluded rows', () => {
      const db = (globalThis as any).db;
      db.excludedRows = { Contacts: new Set([1, 2, 5]) };
      const lk = makeLookup({ keyPairs: [{ left: 'Company', right: 'Company' }] });
      const result = checkLookupDuplicates(lk);
      expect(result).toBeNull();
    });
  });

  describe('detectDuplicateLookupKeys', () => {
    it('should detect no duplicates in unique data', () => {
      const rows = [
        { Company: 'A', Val: '1' },
        { Company: 'B', Val: '2' },
        { Company: 'C', Val: '3' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'Company' }]);
      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicateCount).toBe(0);
      expect(result.duplicateKeys).toEqual([]);
    });

    it('should detect a single duplicate', () => {
      const rows = [
        { Company: 'A', Val: '1' },
        { Company: 'A', Val: '2' },
        { Company: 'B', Val: '3' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'Company' }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(1);
      expect(result.duplicateKeys).toEqual(['A']);
    });

    it('should detect multiple duplicates', () => {
      const rows = [
        { Company: 'A', Val: '1' },
        { Company: 'A', Val: '2' },
        { Company: 'B', Val: '3' },
        { Company: 'B', Val: '4' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'Company' }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(2);
      expect(result.duplicateKeys).toContain('A');
      expect(result.duplicateKeys).toContain('B');
    });

    it('should handle compound keys', () => {
      const rows = [
        { Company: 'A', Contact: 'X', Val: '1' },
        { Company: 'A', Contact: 'X', Val: '2' },
        { Company: 'A', Contact: 'Y', Val: '3' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'Company' }, { right: 'Contact' }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(1);
      expect(result.duplicateKeys[0]).toContain('A');
      expect(result.duplicateKeys[0]).toContain('X');
    });

    it('should handle empty rows', () => {
      const result = detectDuplicateLookupKeys([], [{ right: 'Company' }]);
      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicateCount).toBe(0);
    });

    it('should handle null/undefined row values', () => {
      const rows = [
        { Company: null, Val: '1' },
        { Company: undefined, Val: '2' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'Company' }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(1);
    });

    it('should return correct duplicate count and keys for fixture-like data', () => {
      const rows = [
        { Company: 'Acme Corp', Email: 'a@x.com' },
        { Company: 'Acme Corp', Email: 'b@x.com' },
        { Company: 'Acme Corp', Email: 'c@x.com' },
        { Company: 'Beta Inc', Email: 'd@x.com' },
      ];
      const result = detectDuplicateLookupKeys(rows, [{ right: 'Company' }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(1);
      expect(result.duplicateKeys).toEqual(['Acme Corp']);
    });
  });

  describe('applyDuplicatePolicy', () => {
    it('should return original rows for block mode', () => {
      const rows = [{ Company: 'A', Val: '1' }, { Company: 'A', Val: '2' }];
      const result = applyDuplicatePolicy(rows, [{ right: 'Company' }], { mode: 'block' });
      expect(result).toBe(rows);
    });

    it('should return original rows when policy is null', () => {
      const rows = [{ Company: 'A', Val: '1' }];
      const result = applyDuplicatePolicy(rows, [{ right: 'Company' }], null as any);
      expect(result).toBe(rows);
    });

    it('should combine duplicate rows with default separator', () => {
      const rows = [
        { Company: 'A', Email: 'a@x.com', Phone: '111' },
        { Company: 'A', Email: 'b@x.com', Phone: '222' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'Company' }], { mode: 'combine' });
      expect(result).toHaveLength(1);
      expect(result[0].Company).toBe('A');
      expect(result[0].Email).toContain('a@x.com');
      expect(result[0].Email).toContain('b@x.com');
      expect(result[0].Email).toContain('; ');
    });

    it('should combine with custom separator', () => {
      const rows = [
        { Company: 'A', Email: 'a@x.com' },
        { Company: 'A', Email: 'b@x.com' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { separator: ' | ' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].Email).toContain(' | ');
    });

    it('should handle unique flag (deduplicate values)', () => {
      const rows = [
        { Company: 'A', Email: 'same@x.com' },
        { Company: 'A', Email: 'same@x.com' },
      ];
      const resultUnique = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { unique: true },
      });
      expect(resultUnique[0].Email).toBe('same@x.com');

      const resultNonUnique = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { unique: false },
      });
      expect(resultNonUnique[0].Email).toBe('same@x.com; same@x.com');
    });

    it('should handle includeBlank flag', () => {
      const rows = [
        { Company: 'A', Email: 'a@x.com' },
        { Company: 'A', Email: '' },
      ];
      const resultExclude = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { includeBlank: false },
      });
      expect(resultExclude[0].Email).toBe('a@x.com');

      const resultInclude = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { includeBlank: true },
      });
      expect(resultInclude[0].Email).toContain('');
      expect(resultInclude[0].Email).toContain('a@x.com');
    });

    it('should handle sort flag', () => {
      const rows = [
        { Company: 'A', Email: 'z@x.com' },
        { Company: 'A', Email: 'a@x.com' },
      ];
      const resultSorted = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { sort: true, unique: true },
      });
      expect(resultSorted[0].Email).toBe('a@x.com; z@x.com');

      const resultUnsorted = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { sort: false, unique: true },
      });
      expect(resultUnsorted[0].Email).toBe('z@x.com; a@x.com');
    });

    it('should preserve key column values from first-seen row', () => {
      const rows = [
        { Company: 'A', Contact: 'First', Email: 'a@x.com' },
        { Company: 'A', Contact: 'Second', Email: 'b@x.com' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { unique: true },
      });
      expect(result[0].Company).toBe('A');
    });

    it('should handle multiple groups of duplicates', () => {
      const rows = [
        { Company: 'A', Email: 'a1@x.com' },
        { Company: 'B', Email: 'b1@x.com' },
        { Company: 'A', Email: 'a2@x.com' },
        { Company: 'B', Email: 'b2@x.com' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { sort: true, unique: true },
      });
      expect(result).toHaveLength(2);
      expect(result[0].Company).toBe('A');
      expect(result[0].Email).toBe('a1@x.com; a2@x.com');
      expect(result[1].Company).toBe('B');
      expect(result[1].Email).toBe('b1@x.com; b2@x.com');
    });

    it('should preserve order of first-seen keys', () => {
      const rows = [
        { Company: 'B', Email: 'b@x.com' },
        { Company: 'A', Email: 'a@x.com' },
        { Company: 'B', Email: 'b2@x.com' },
      ];
      const result = applyDuplicatePolicy(rows, [{ right: 'Company' }], {
        mode: 'combine',
        combine: { sort: false, unique: true },
      });
      expect(result[0].Company).toBe('B');
      expect(result[1].Company).toBe('A');
    });

    it('should handle empty rows array', () => {
      const result = applyDuplicatePolicy([], [{ right: 'Company' }], { mode: 'combine' });
      expect(result).toEqual([]);
    });
  });
});
