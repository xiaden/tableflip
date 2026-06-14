# Violation Report: ASR-001 — Source Data Immutability and Fidelity

**Proposed artifact:** ASR-001
**Audited by:** support-pattern-enforcer
**Date:** 2026-06-14
**Codebase:** `/workspace/report-thingy/tableflip/SRC/preact/`

---

## VIOLATION: `coerceForSQL()` silently coerces numeric strings to numbers

**Severity:** CRITICAL — directly contradicts the prohibition's primary example

**File:** `core/sqldb.ts`, lines 39–48 (coercion at lines 44–46)

**Relevant code:**

```typescript
function coerceForSQL(v: unknown): string | number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const n = Number(s);
  if (s !== '' && !isNaN(n)) return n;    // ← THIS LINE
  return s || null;
}
```

**What ASR-001 prohibits:**

> **Prohibited:** Silent type coercion of cell values (e.g., "00123" → 123)

**What the code does:** Any string that parses as a valid JavaScript number gets auto-converted to a number. The exact prohibited transformation:

| Input (string) | Stored as | Lost information |
|---|---|---|
| `"00123"` | `123` (number) | Leading zeros |
| `"3.14"` | `3.14` (number) | — |
| `"42"` | `42` (number) | Original string type |
| `"1.0"` | `1` (number) | Decimal precision signal |

**Test that confirms the behavior** (`tests/core/sqldb.test.ts`, lines 108–116):

```typescript
it('should coerce numeric strings to numbers', () => {
  createTable('TestCoerce', ['val']);
  insertRows('TestCoerce', ['val'], [{ val: '42' }, { val: '3.14' }]);
  const rows = execQuery('SELECT * FROM "TestCoerce"');
  expect(rows[0].val).toBe(42);
  expect(rows[1].val).toBe(3.14);
});
```

The test name itself — *"should coerce numeric strings to numbers"* — advertises the contradiction.

**Impact on roundtrip fidelity:** An "ingest → rearrange columns → export" roundtrip would silently alter cell values. A cell containing `"00123"` in the source file (e.g., a ZIP code, product code, employee ID) would become `123` in the export. The original value is irrecoverable.

---

## Secondary concern: boolean coercion

**File:** `core/sqldb.ts`, line 42

```typescript
if (typeof v === 'boolean') return v ? 1 : 0;
```

Booleans (`true`/`false`) from XLSX boolean-typed cells are silently converted to integers (`1`/`0`). While SQLite lacks a native boolean type, this is technically silent type coercion of a cell value. The corresponding test (`tests/core/sqldb.test.ts`, lines 128–136) expects:

```typescript
expect(rows[0].val).toBe(1);   // true → 1
expect(rows[1].val).toBe(0);   // false → 0
```

---

## Discussion point: `blankrows: false` during import

**File:** `ui/loader.ts`, line 81

```typescript
rawData = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: false });
```

`blankrows: false` silently drops completely empty rows during import. ASR-001 prohibits "Row loss during import." However, blank rows carry no cell values. The ASR's roundtrip requirement ("cell values identical to the original") could be interpreted to exclude blank rows since they contribute no cell values. This is borderline and likely acceptable, but worth documenting.

---

## Areas confirmed compliant

| Requirement | Status | Evidence |
|---|---|---|
| No SQL mutations on source tables outside ingestion | ✅ PASS | All INSERT/DROP in `ui/loader.ts` (ingestSheet); report/ and query/ layers only use SELECT |
| No network calls carrying user data | ✅ PASS | Only CDN fetch for sql.js WASM in `core/sqldb.ts:12`; XLSX loaded from local vendored bundle |
| _-prefix metadata column namespace | ✅ PASS | `_rowno` in source tables; `_row_type`, `_sort_row_type`, `_sort_group_N`, `_band_id`, `_isTotalsRow`, `_isBandHeader` in derived data — all use `_` prefix |
| No ALTER TABLE or CREATE INDEX on source tables | ✅ PASS | No such SQL found anywhere in preact/ code |
| Export pipeline reads in-memory only | ✅ PASS | `export.ts` reads from `state.result` (in-memory ResultSet), never queries source tables |
| Report execution only does SELECT | ✅ PASS | All `execQuery()` calls in `report/engine.ts` use SELECT-only queries |

---

## Recommendation

**Must fix:** `coerceForSQL()` at `core/sqldb.ts:44-46`. Options:

1. **(Recommended) Remove numeric string coercion entirely.** Store all strings as-is. Change lines 44–46 to `return s || null;`. This would break the existing test `'should coerce numeric strings to numbers'`, which must be updated.

2. **Use a configurable coercion mode** — let callers opt in to numeric coercion when desired (not during ingestion), keeping the current behavior only for internal query operations.

The boolean coercion at line 42 should also be evaluated. Options: store `true`/`false` as the strings `"true"`/`"false"`, or continue storing as 0/1 with an explicit ASR carve-out for booleans (documenting that SQLite lacks a boolean type).
