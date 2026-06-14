# Column-Type-Aware SQL WHERE — Completion Manifest

**Feature:** Column-Type-Aware SQL WHERE Generation with Uniform String Storage
**Design Doc:** DD-dd-column-type-aware-where.md
**Completed:** 2026-06-14

---

## Execution Summary

| Plan | Title | Steps | Review Rounds | Status |
|------|-------|-------|---------------|--------|
| foundations | Type Definitions + Uniform String Storage | 25/25 | 1 | ✅ DONE |
| A | Cell Metadata Capture at Ingestion | 33/33 | 2 | ✅ DONE |
| B | Catalog Type Propagation | 38/38 | 2 | ✅ DONE |
| C | Type-Aware SQL WHERE Generation + Tests | 15/15 | 1 | ✅ DONE |
| D | Persistence of Column Type Overrides | 8/8 | 1 | ✅ DONE |
| E | User Override UI via Context Menu | 19/19 | 1 | ✅ DONE |

**Total:** 138/138 steps across 6 plans. 948 tests in 53 test files. Zero lint warnings. Zero type errors.

---

## Design Deviations

No deviations from the design doc. All 6 architecture points implemented as specified:

1. **Uniform String Storage** — `coerceForSQL()` returns `string | null` only
2. **XLSX Cell Metadata Capture** — `scanCellTypes()` with majority vote + date-format override
3. **Column Type Metadata** — `ColumnType` on `DbTable.colTypes`, `PhysicalColEntry.colType`, `BandColEntry.colType`
4. **Type-Aware SQL Generation** — `getColumnType()` drives CAST expressions; comparison operators default to TEXT (fixing leading-zero bug)
5. **User Override via Context Menu** — Flat "Type: X" items with checkmark, no submenu
6. **\_ROWNO Special Case** — Special-cased in `getColumnType()` as `'number'`; excluded from colTypes and UI

One defensive deviation noted in Plan E: the more-button now appears when `onContextMenu` is set (even without `onRename`), improving UX for columns with type menu only.

---

## Key Decisions

- **`columnTypeOverrides` required on `AppState`** (not optional) with safe default `{}` — ensures all downstream code can access it without null checks
- **No STATE_VERSION bump** — `columnTypeOverrides` is optional user config with safe default; backward compatible with old `.rcjson` files
- **NOT added to RECOGNIZABLE_KEYS** — optional user config, not required for file recognition
- **CSV imports store no `colTypes`** — all-string is redundant since `getColumnType()` defaults to `'string'` when absent
- **`buildWhere` cleaned to 2 params** — `ColStateEntry` and `_colState` removed as dead code; API stays `buildWhere(filters, colMap)`
- **Comparison operators default to TEXT** — fixes the leading-zero bug where `CAST('02134' AS REAL)` became `2134`
- **Flat context menu items** (no submenu) — per user decision: "Fewer clicks, better clicks"
- **Calc columns excluded from type override** — their type is derived from `mode` at query time, not user-overridable
- **`_rowno` excluded from type override** — synthetic column, always numeric
- **`scanCellTypes` exported for testability** — pure function, no side effects

---

## Files Created/Modified

### Core Layer
- `preact/types.ts` — Added `ColumnType`, `DbTable.colTypes?`, `AppState.columnTypeOverrides`
- `preact/types/globals.d.ts` — Added `XLSXSheet['!data']?: unknown[][]`
- `preact/core/state.ts` — Added `columnTypeOverrides: {}` default
- `preact/core/sqldb.ts` — Changed `coerceForSQL()` to uniform string storage
- `preact/core/state-serializer.ts` — Added `columnTypeOverrides` deep-clone serialization
- `preact/core/state-hydrator.ts` — Added `columnTypeOverrides` hydration (default `{}`)
- `preact/index.ts` — Added `ColumnType` barrel export; removed `ColStateEntry` export

### Catalog Layer
- `preact/catalog/column-catalog.ts` — Added `colType?: ColumnType` to `PhysicalColEntry`/`BandColEntry`; propagation in `buildColSourceMap()` and `buildColumnCatalog()`

### Query Layer
- `preact/query/sql-where.ts` — Removed `isNumericCalc()`, `ColStateEntry`, `_colState`; added `getColumnType()`; updated `renderClause()`/`renderFilter()` for type-aware SQL

### UI Layer
- `preact/ui/loader.ts` — Added `scanCellTypes()`, `isDateFormat()`, `sheetTypeToColumnType()`; integrated into `ingestSheet()`
- `preact/ui/components/context-menu.tsx` — Added `CtxMenuItem.checked?: boolean` with ✓ rendering
- `preact/ui/grid.tsx` — Added context menu state/rendering to PreviewGrid and ResultGrid; wired type-change store update + `invalidateValidation()`

### Tests
- `preact/tests/core/sqldb.test.ts` — Updated 3 test suites for string storage
- `preact/tests/core/state-serializer-cto.test.ts` — Created (4 tests)
- `preact/tests/core/state-hydrator-cto.test.ts` — Created (5 tests)
- `preact/tests/ui/scan-cell-types.test.ts` — Created (18 tests)
- `preact/tests/ui/loader-ingestion-coltypes.test.ts` — Created (6 tests)
- `preact/tests/catalog/column-catalog-coltype.test.ts` — Created (9 tests)
- `preact/tests/query/helpers.ts` — Updated test fixtures with colTypes
- `preact/tests/query/sql-where.test.ts` — Updated existing + 15 new type-aware tests

---

## Final Lint Status

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 warnings |
| `npm test` | ✅ 948 tests, 53 files, 0 failures |
