# Task: Column-Type-Aware WHERE — Foundations

## Problem Statement

Plans A through E for the "Column-Type-Aware SQL WHERE" feature all assume foundational types, interfaces, and storage behavior already exist in the codebase. The parts README claims these are "completed," but **none of them exist in source code**:

- `ColumnType = 'string' | 'number' | 'date' | 'boolean'` — NOT in `types.ts`
- `DbTable.colTypes?: Record<string, ColumnType>` — NOT in `types.ts`
- `AppState.columnTypeOverrides: Record<string, Record<string, ColumnType>>` — NOT in `types.ts`
- `XLSXSheet['!data']?: unknown[][]` — NOT in `globals.d.ts`
- `coerceForSQL()` returns `string | number | null` — must change to `string | null`
- `columnTypeOverrides: {}` default — NOT in `state.ts`
- `ColumnType` barrel export — NOT in `index.ts`

This plan creates all foundational artifacts that Plans A–E depend on. Without these, Plans A–E cannot compile or execute.

**Design doc:** `artifacts/designs/pending/DD-dd-column-type-aware-where.md` (Architecture Points 1 and 2)
**Contracts ledger:** `artifacts/designs/parts/column-type-aware-where/CONTRACTS.md` (Types & Interfaces section)

## Phases

### Phase 1: Type Definitions and Declarations

Add all new types, interface extensions, and type declarations that the feature requires. These are layer-0 changes referenced by all subsequent plans.

- [x] Add `ColumnType` type alias to `SRC/preact/types.ts` after the existing `CalcMode` type (line 2): `export type ColumnType = 'string' | 'number' | 'date' | 'boolean';`
    **Note:** Added `export type ColumnType = 'string' | 'number' | 'date' | 'boolean';` after CalcMode on line 2 of SRC/preact/types.ts.
- [x] Add optional `colTypes` property to `DbTable` interface in `SRC/preact/types.ts` (after `samples` on line 19): `colTypes?: Record<string, ColumnType>;`
    **Note:** Added `colTypes?: Record<string, ColumnType>;` to DbTable interface in SRC/preact/types.ts after the samples property.
- [x] Add `columnTypeOverrides` property to `AppState` interface in `SRC/preact/types.ts` (after `detailBandMode` on line 195): `columnTypeOverrides: Record<string, Record<string, ColumnType>>;`
    **Note:** Added `columnTypeOverrides: Record<string, Record<string, ColumnType>>;` to AppState interface in SRC/preact/types.ts after detailBandMode. This is a required property — createAppState() in core/state.ts does not yet provide it (Phase 2 adds the default). Typecheck may fail until P2-S1 is done.
- [x] Add `'!data'` property to `XLSXSheet` interface in `SRC/preact/types/globals.d.ts` (after `'!autofilter'` on line 53): `'!data'?: unknown[][];`
    **Note:** Added `'!data'?: unknown[][];` to XLSXSheet interface in SRC/preact/types/globals.d.ts after '!autofilter'.
- [x] Add `ColumnType` to the type-only barrel export block in `SRC/preact/index.ts` (line 123–140, within the `export type { ... } from './types'` block)
    **Note:** Added `ColumnType,` to the type-only barrel export block in SRC/preact/index.ts, alphabetically after CalcMode and before AggMode.
- [x] Run `npm run typecheck` in `SRC/` — must pass with zero errors
    **resolved:** Phase 2 added columnTypeOverrides default. Typecheck now passes with zero errors.
    **Blocked:** Typecheck fails: createAppState() in preact/core/state.ts does not provide columnTypeOverrides, which is now required on AppState. Phase 2 (P2-S1) adds `columnTypeOverrides: {}` to the defaults object in createAppState(), which will resolve this error. All 5 type definition edits (P1-S1 through P1-S5) are correct and in place.

### Phase 2: State Default

Add the `columnTypeOverrides` default value to `createAppState()` so that new state instances satisfy the `AppState` interface.

- [x] Add `columnTypeOverrides: {}` to the defaults object in `createAppState()` in `SRC/preact/core/state.ts` (after `detailBandMode: 'separate'` on line 42)
    **Note:** Added `columnTypeOverrides: {}` to the defaults object in createAppState() in SRC/preact/core/state.ts, placed after `detailBandMode: 'separate'` (line 42→43). Used surrounding context (detailBands line + WorkspaceState JSDoc) to disambiguate from the identical pattern in createReportSpec().
- [x] Run `npm run typecheck` in `SRC/` — must pass with zero errors
    **Note:** `npm run typecheck` passes with zero errors. The columnTypeOverrides required field on AppState is now satisfied by the empty object default in createAppState(). Phase 1's P1-S6 blocker is resolved.

### Phase 3: Uniform String Storage

Change `coerceForSQL()` in `sqldb.ts` to produce only string values (or null), implementing the uniform string storage design from DD Architecture Point 1.

- [x] Change `coerceForSQL` return type from `string | number | null` to `string | null` in `SRC/preact/core/sqldb.ts` (line 39)
    **Note:** Changed coerceForSQL return type from `string | number | null` to `string | null` in SRC/preact/core/sqldb.ts line 39.
- [x] Change number handling: replace `if (typeof v === 'number') return v;` with `if (typeof v === 'number') return String(v);` (line 43)
    **Note:** Changed number handling to `return String(v)` instead of `return v` — numbers now stored as TEXT in SQLite.
- [x] Change boolean handling: replace `if (typeof v === 'boolean') return v ? 1 : 0;` with `if (typeof v === 'boolean') return v ? '1' : '0';` (line 42)
    **Note:** Changed boolean handling to return `'1'`/`'0'` strings instead of numeric `1`/`0`.
- [x] Remove numeric-string coercion: delete lines 45–46 (`const n = Number(s);` and `if (s !== '' && !isNaN(n)) return n;`) so that numeric strings stay as strings instead of being converted to numbers
    **Note:** Removed numeric-string coercion (deleted `const n = Number(s)` and `if (s !== '' && !isNaN(n)) return n`). Numeric strings now stay as strings. Function reduced from 10 lines to 8 lines.
- [x] Update the JSDoc comment on `coerceForSQL` (lines 33–38) to reflect new behavior: "All values stored as strings. Numeric strings stay as strings (no Number conversion). Empty strings become null."
    **Note:** Updated JSDoc to reflect new behavior: all values stored as strings, numeric strings stay as strings, empty strings become null.
- [x] Verify no external callers of `coerceForSQL` exist — it is a module-private function called only by `insertRows()` at line 77. No caller changes needed.
    **Note:** Verified: coerceForSQL is only referenced in sqldb.ts itself (definition at line 39, JSDoc mention at line 64, call at line 75 inside insertRows()). No external callers exist. No caller changes needed.
- [x] Run `npm run typecheck` in `SRC/` — must pass with zero errors
    **Note:** `npm run typecheck` passes with zero errors. All Phase 3 changes compile cleanly.

### Phase 4: Test Updates for String Storage

Update existing tests that assert numeric SQLite storage to expect string values instead. The `coerceForSQL` change causes all values to be stored as TEXT in SQLite.

- [x] Update test "should coerce numeric strings to numbers" in `SRC/preact/tests/core/sqldb.test.ts` (lines 108–116): rename to "should store numeric strings as strings", change `expect(rows[0].val).toBe(42)` to `expect(rows[0].val).toBe('42')`, change `expect(rows[1].val).toBe(3.14)` to `expect(rows[1].val).toBe('3.14')`
    **Note:** Renamed test to "should store numeric strings as strings", changed assertions from toBe(42)/toBe(3.14) to toBe('42')/toBe('3.14') in SRC/preact/tests/core/sqldb.test.ts.
- [x] Update test "should coerce boolean values" in `SRC/preact/tests/core/sqldb.test.ts` (lines 128–136): rename to "should store boolean values as strings", change `expect(rows[0].val).toBe(1)` to `expect(rows[0].val).toBe('1')`, change `expect(rows[1].val).toBe(0)` to `expect(rows[1].val).toBe('0')`
    **Note:** Renamed test to "should store boolean values as strings", changed assertions from toBe(1)/toBe(0) to toBe('1')/toBe('0') in SRC/preact/tests/core/sqldb.test.ts.
- [x] Update test "should insert all rows correctly" in `SRC/preact/tests/core/sqldb.test.ts` (lines 82–98): the `id` values `1, 2, 3` are now stored as strings `"1", "2", "3"` — update `toEqual` assertions on lines 95–97 to expect `{ id: '1', name: 'Alice' }`, `{ id: '2', name: 'Bob' }`, `{ id: '3', name: 'Carol' }`
    **Note:** Updated toEqual assertions for id values from numeric (1,2,3) to string ('1','2','3') in SRC/preact/tests/core/sqldb.test.ts lines 95-97.
- [x] Search all other test files for assertions that depend on numeric SQLite storage (e.g., `execQuery` results where numeric values are expected). Key files: `tests/report/preview-builder.test.ts`, `tests/query/sql-where.test.ts`. Update any assertions that break.
    **Note:** Searched all 48 test files for numeric SQLite storage assertions. Key findings: (1) vitest-setup.ts creates Orders fixture via direct stmt.run() with raw numeric values — NOT affected by coerceForSQL change. (2) full-pipeline.test.ts and engine.test.ts depend on Orders fixture numeric Amount values — unaffected. (3) preview-builder.test.ts uses insertRows() but only asserts string values, row counts, and headers — unaffected. (4) sql-where.test.ts is pure SQL generation with no SQLite data access — unaffected. No other test files needed updating.
- [x] Run `npm test` in `SRC/` — all tests must pass
    **Note:** npm test: 48 test files, 887 tests passed, zero failures.
- [x] Run `npm run lint` in `SRC/` — must pass with zero warnings
    **Note:** npm run lint: zero warnings, clean pass.

### Phase 5: Full Validation

Final gate to confirm all foundations are in place and no regressions exist.

- [x] Run `npm run typecheck` in `SRC/` — zero errors
    **Note:** `npm run typecheck` — zero errors. tsc --noEmit -p tsconfig.json exits clean.
- [x] Run `npm run lint` in `SRC/` — zero warnings
    **Note:** `npm run lint` — zero warnings. ESLint exits clean.
- [x] Run `npm test` in `SRC/` — all tests pass
    **Note:** `npm test` — 48 test files, 887 tests passed, zero failures.
- [x] Verify `ColumnType` is importable from the barrel: confirm `index.ts` line 123–140 includes `ColumnType` in the `export type { ... } from './types'` block
    **Note:** Confirmed `ColumnType` at line 125 of SRC/preact/index.ts, within the `export type { ... } from './types'` block (lines 123–141). Alphabetically placed after CalcMode. Barrel export is correct.

## Completion Criteria

- `ColumnType` type exists in `types.ts` and is exported from `index.ts`
- `DbTable` interface has optional `colTypes?: Record<string, ColumnType>` property
- `AppState` interface has `columnTypeOverrides: Record<string, Record<string, ColumnType>>` property
- `createAppState()` defaults include `columnTypeOverrides: {}`
- `XLSXSheet` interface declares `'!data'?: unknown[][]`
- `coerceForSQL()` returns `string | null` — numbers stringified, booleans stringified, numeric strings preserved as strings
- All existing tests pass with updated assertions for string storage
- `npm run typecheck`, `npm run lint`, `npm test` all pass clean

## References

- Design doc: `artifacts/designs/pending/DD-dd-column-type-aware-where.md` — Architecture Points 1 (Uniform String Storage) and 2 (XLSX Cell Metadata Capture)
- Contracts ledger: `artifacts/designs/parts/column-type-aware-where/CONTRACTS.md` — "Types & Interfaces (foundations)" section
- Parts README: `artifacts/designs/parts/column-type-aware-where/README.md` — claims foundations are "completed" but they are not
- Downstream plans: A (ingestion), B (catalog), C (SQL gen), D (persistence), E (UI) — all depend on this plan
