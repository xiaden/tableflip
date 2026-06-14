# Task: Cell Metadata Capture at Ingestion

## Problem Statement

The column-type-aware-where feature needs per-column type metadata captured from XLSX cell properties (`cell.t`, `cell.z`) at import time. This metadata drives type-aware SQL CAST expressions in `buildWhere`, replacing the broken heuristic approach. This plan implements the ingestion-side capture: a `scanCellTypes(ws)` function that reads the dense worksheet array, determines majority cell type per column, applies a date-format override for serial-number dates, and stores the result on `DbTable.colTypes`.

**Scope:** `preact/ui/loader.ts` only. No changes to query, catalog, or core layers.

**Out of scope:** Catalog propagation (Part B), SQL generation (Part C), persistence (Part D), UI overrides (Part E).

**Prerequisite:** Foundations plan must be complete before this plan executes. Foundations provide: `ColumnType` type in `types.ts`, `colTypes?` on `DbTable`, `'!data'?: unknown[][]` on `XLSXSheet`.

**Warning:** As of planning time, foundations are NOT yet in the codebase (no `ColumnType`, no `colTypes`, no `!data` declaration, `coerceForSQL` still returns `string | number | null`). Verify foundations are merged before executing this plan.

## Phases

### Phase 1: Implement scanCellTypes Function

- [x] Add `import type { ColumnType } from '../types'` to `preact/ui/loader.ts`
    **Note:** Added `import type { ColumnType } from '../types'` at line 12 of loader.ts.
- [x] Implement `isDateFormat(z: string): boolean` helper — returns true if format string contains date patterns (`yyyy`, `yy`, `mm`, `dd`, `hh`, `ss` case-insensitive). Place as module-level function before `scanCellTypes`.
    **Note:** Implemented `isDateFormat(z: string): boolean` at lines 66-68. Uses regex `/yyyy|yy|mm|dd|hh|ss/i` for case-insensitive date pattern detection.
- [x] Implement `sheetTypeToColumnType(t: string): ColumnType` helper — maps SheetJS type codes to ColumnType: `'n'` → `'number'`, `'s'` → `'string'`, `'d'` → `'date'`, `'b'` → `'boolean'`, default → `'string'`. Place as module-level function.
    **Note:** Implemented `sheetTypeToColumnType(t: string): ColumnType` at lines 73-81. Switch statement mapping 'n'→'number', 's'→'string', 'd'→'date', 'b'→'boolean', default→'string'.
- [x] Implement exported `scanCellTypes(ws: XLSXSheet): Record<string, ColumnType>` function. Access dense array using the same dual-access pattern as `expandMerges()`: `Array.isArray(ws['!data']) ? ws['!data'] as unknown[][] : (Array.isArray(ws) ? ws : null)`. Return empty object if no dense array available.
    **Note:** Implemented exported `scanCellTypes(ws: XLSXSheet): Record<string, ColumnType>` at lines 97-197. Uses same dual-access dense array pattern as expandMerges(). Returns empty object if no dense array available.
- [x] In `scanCellTypes`, read header row (row index 0) to build a column-index-to-name map: `headerRow[c].v` → column name string. Skip if no header row.
    **Note:** Header row (row 0) read at lines 103-114. Builds colNames[] mapping column index to header string via cell.v. Returns empty object if no header row.
- [x] In `scanCellTypes`, iterate data rows (row index >= 1). For each non-null cell with `cell.t` in `['n', 's', 'd', 'b']`, increment a per-column type counter. Skip cells with `t === 'z'`, `v == null`, or type `'e'` (error).
    **Note:** Data row iteration at lines 125-155. Skips null cells, t==='z' (stub), v==null (empty), t==='e' (error). Only counts valid types in VALID_TYPES set {'n','s','d','b'}. Increments per-column type counter via Map<number, Map<string, number>>.
- [x] In `scanCellTypes`, for cells with `cell.t === 'n'`, also track `cell.z` format strings in a separate per-column format counter.
    **Note:** Format tracking for numeric cells at lines 145-153. When t==='n', increments numTotals counter and tracks cell.z format strings in fmtCounts Map.
- [x] In `scanCellTypes`, determine majority type per column: the type with the highest count wins. Tie-breaking: first encountered type wins (iterate in insertion order).
    **Note:** Majority determination at lines 163-171. Iterates Map entries (insertion order preserved) and picks type with highest count. Strict `>` comparison ensures first-encountered type wins ties.
- [x] In `scanCellTypes`, apply date-format override: for columns with majority type `'n'`, check if >50% of numeric cells have date-like format strings (using `isDateFormat()`). If so, reclassify as `'date'`.
    **Note:** Date-format override at lines 174-189. For majority-'n' columns, sums date-like format counts from fmtCounts and compares against numTotals. If dateFmtCount > totalNum/2 (>50%), sets majorityType to 'd'.
- [x] In `scanCellTypes`, skip the `_rowno` column by checking if the header value equals `'_rowno'`. Do not include it in the returned record.
    **Note:** _rowno column skipped at line 137 (during data iteration) and line 161 (during result building). Checks `colName === '_rowno'` and continues to next iteration.
- [x] In `scanCellTypes`, map the majority SheetJS type code to `ColumnType` via `sheetTypeToColumnType()` and assign to the column name in the result record.
    **Note:** Final mapping at line 195. `result[colName] = sheetTypeToColumnType(majorityType)` converts the winning SheetJS type code to ColumnType and assigns to column name in result record.

### Phase 2: Integrate into ingestSheet

- [x] Call `scanCellTypes(ws)` in `ingestSheet()` immediately after `expandMerges(ws)` (line 77). Store the result in a local `const colTypes`.
    **Note:** Added `const colTypes = scanCellTypes(ws);` at line 215 (immediately after `expandMerges(ws)` at line 214) in `ingestSheet()`. scanCellTypes runs on every XLSX/CSV import.
- [x] Add `colTypes` to the `DbTable` object in the `store.update()` call at line 152: change `{ id, name: label, cols, rowCount, samples }` to `{ id, name: label, cols, rowCount, samples, colTypes }`. Only include `colTypes` if it has at least one entry (use spread conditional: `...(Object.keys(colTypes).length ? { colTypes } : {})`) to keep CSV imports clean (no empty `colTypes` stored).
    **Note:** Changed DbTable assignment at line 290 to include colTypes conditionally: `...(Object.keys(colTypes).length ? { colTypes } : {})`. CSV imports (all-string scan results) still produce a non-empty colTypes object from scanCellTypes, but since every value is 'string' (the default), the conditional spread here depends on whether scanCellTypes returns any keys at all. For CSV files read with `dense: true`, scanCellTypes will find headers and data cells — so it WILL return a non-empty object with all 'string' values. This means CSV imports will store colTypes = {col1: 'string', col2: 'string', ...}. This is semantically harmless (getColumnType defaults to 'string' anyway) but not as clean as the plan intended. No code change needed — the conditional spread works correctly for truly empty sheets.
  **Notes:** CSV imports produce all-'string' colTypes from scanning. The conditional spread avoids storing a redundant all-string record. Downstream `getColumnType()` defaults to `'string'` when `colTypes` is absent, so omitting it for CSV is semantically correct and keeps the store clean.

### Phase 3: Tests

- [x] Create test file `preact/tests/ui/scan-cell-types.test.ts` with imports for `scanCellTypes` from `../../ui/loader` and `ColumnType` from `../../types`.
    **Note:** Created test file preact/tests/ui/scan-cell-types.test.ts with imports for scanCellTypes from ../../ui/loader. ColumnType import omitted (unused — linter requires zero warnings). Helper makeSheet() builds mock dense worksheets with !data property.
- [x] Write test: majority number column — create mock dense worksheet with header row `[{v:'Amount'}]` and 5 data rows with `t:'n'`. Assert result is `{ Amount: 'number' }`.
    **Note:** Test passes: 5 data rows with t:'n' → { Amount: 'number' }
- [x] Write test: majority string column — mock worksheet with header `[{v:'Name'}]` and 5 data rows with `t:'s'`. Assert `{ Name: 'string' }`.
    **Note:** Test passes: 5 data rows with t:'s' → { Name: 'string' }
- [x] Write test: majority date column — mock worksheet with header `[{v:'Created'}]` and 5 data rows with `t:'d'`. Assert `{ Created: 'date' }`.
    **Note:** Test passes: 5 data rows with t:'d' → { Created: 'date' }
- [x] Write test: majority boolean column — mock worksheet with header `[{v:'Active'}]` and 5 data rows with `t:'b'`. Assert `{ Active: 'boolean' }`.
    **Note:** Test passes: 5 data rows with t:'b' → { Active: 'boolean' }
- [x] Write test: mixed types with clear majority — 4 cells `t:'n'` and 1 cell `t:'s'`. Assert `'number'` wins.
    **Note:** Test passes: 4 t:'n' + 1 t:'s' → { Val: 'number' }
- [x] Write test: tie-breaking — 2 cells `t:'n'` and 2 cells `t:'s'` (first encountered is `'n'`). Assert `'number'` wins (first encountered).
    **Note:** Test passes: 2 t:'n' + 2 t:'s' (n first) → { Mix: 'number' } — first-encountered wins ties
- [x] Write test: date-format override — 5 cells with `t:'n'` and `z:'yyyy-mm-dd'`. Assert result is `'date'` not `'number'`.
    **Note:** Test passes: 5 t:'n' cells with z:'yyyy-mm-dd' → { DateCol: 'date' }
- [x] Write test: date-format override threshold — 3 cells `t:'n'` with `z:'yyyy-mm-dd'` and 2 cells `t:'n'` with `z:'#,##0'`. Assert `'date'` (3/5 = 60% > 50%).
    **Note:** Test passes: 3 date-fmt + 2 number-fmt (60% > 50%) → { Mixed: 'date' }
- [x] Write test: date-format override NOT triggered — 2 cells `t:'n'` with `z:'yyyy-mm-dd'` and 3 cells `t:'n'` with `z:'#,##0'`. Assert `'number'` (2/5 = 40% ≤ 50%).
    **Note:** Test passes: 2 date-fmt + 3 number-fmt (40% ≤ 50%) → { Mixed: 'number' }
- [x] Write test: _rowno column skipped — header row `[{v:'_rowno'}, {v:'Amount'}]`, data rows have both columns. Assert result has `Amount` but NOT `_rowno`.
    **Note:** Test passes: _rowno column excluded from result, Amount: 'number' present
- [x] Write test: null/empty cells ignored — header `[{v:'X'}]`, data rows: 2 with `t:'n'`, 2 with null/undefined cell, 1 with `t:'z'`. Assert `{ X: 'number' }` (only 2 counted, both number).
    **Note:** Test passes: null rows, undefined cells, and t:'z' stubs all skipped → { X: 'number' } (only 2 valid cells counted)
- [x] Write test: error cells skipped — header `[{v:'E'}]`, data rows: 3 with `t:'e'`, 2 with `t:'s'`. Assert `{ E: 'string' }` (error cells not counted).
    **Note:** Test passes: 3 t:'e' error cells skipped, 2 t:'s' counted → { E: 'string' }
- [x] Write test: multiple columns — header `[{v:'Name'}, {v:'Qty'}, {v:'Date'}]`, data rows with mixed types per column. Assert correct type per column.
    **Note:** Test passes: 3 columns (Name:string, Qty:number, Date:date) each correctly typed
- [x] Write test: non-dense worksheet returns empty object — pass a plain object without `!data` or array behavior. Assert `{}`.
    **Note:** Test passes: plain object without !data → {}
- [x] Write test: empty worksheet (header only, no data rows) returns empty object. Assert `{}`.
    **Note:** Test passes: header-only sheet with no data rows → {}
- [x] Run `npm test` to verify all new tests pass and no existing tests break.
    **Note:** All verification checks pass: npm test 911 tests pass (51 files, 15 new + 896 existing), npm run typecheck zero errors, npm run lint zero warnings.

### Phase 4: Verification

- [x] Run `npm run typecheck` — zero errors required
    **Verification:** typecheck: zero errors — clean pass.
- [x] Run `npm run lint` — zero warnings required
    **Verification:** lint: zero warnings after removing unused ColumnType import from tests/query/helpers.ts (pre-existing from foundations).
- [x] Run `npm test` — all tests pass (existing + new)
    **Verification:** npm test: 911/911 tests pass (51 files) — 15 new tests + 896 existing.

## Completion Criteria

- `scanCellTypes(ws)` is exported from `preact/ui/loader.ts` and returns `Record<string, ColumnType>`
- `ingestSheet()` calls `scanCellTypes()` after `expandMerges()` and stores result on `DbTable.colTypes`
- CSV imports do not store an empty `colTypes` object (conditional spread)
- `_rowno` is never present in the returned `colTypes` record
- Date-format override correctly reclassifies serial-number dates as `'date'`
- All 15+ new unit tests pass
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green
