# Column-Type-Aware SQL WHERE Generation with Uniform String Storage — Design Document

**Status:** Draft  
**Author:** RnD-DDAuthor (via RnD-Manager dispatch)  
**Created:** 2026-06-14  
**Supersedes:** DD-column-type-aware-where.md (Option E heuristic approach — rejected)

**Related Documents:**
- [buildWhere implementation](SRC/preact/query/sql-where.ts) — Current WHERE generation with narrow numericHint (only calc+math). Target file for type-aware replacement.
- [Column catalog](SRC/preact/catalog/column-catalog.ts) — ColMapEntry types (PhysicalColEntry, CalcColEntry, BandColEntry). Target for colType propagation.
- [Type definitions](SRC/preact/types.ts) — DbTable, AppState interfaces. Target for ColumnType and columnTypeOverrides.
- [State defaults](SRC/preact/core/state.ts) — AppState default factories. Target for columnTypeOverrides default.
- [State serializer](SRC/preact/core/state-serializer.ts) — buildPayload(). Target for columnTypeOverrides serialization.
- [State hydrator](SRC/preact/core/state-hydrator.ts) — hydrateState(). Target for columnTypeOverrides hydration.
- [State schema](SRC/preact/core/state-schema.ts) — STATE_VERSION (currently 2). May need bump.
- [XLSX/CSV ingestion](SRC/preact/ui/loader.ts) — Import pipeline using sheet_to_json with raw:true, dense:true. Target for cell metadata scanning.
- [SQL coercion](SRC/preact/core/sqldb.ts) — coerceForSQL(). Target for uniform string storage change.
- [Global type declarations](SRC/preact/types/globals.d.ts) — XLSXSheet interface. Needs `!data` property for dense format access.
- [Context menu component](SRC/preact/ui/components/context-menu.tsx) — Flat CtxMenuItem[] API. Needs extension for submenu or alternative UI pattern.
- [Caller — detail queries](SRC/preact/query/sql-detail.ts) — Caller of buildWhere at line 105. No changes needed.
- [Caller — grouped queries](SRC/preact/query/sql-grouped.ts) — Caller of buildWhere at line 148. No changes needed.
- [Caller — totals queries](SRC/preact/query/sql-totals.ts) — Caller of buildWhere at line 110. No changes needed.
- [Caller — subtotals queries](SRC/preact/query/sql-subtotals.ts) — Caller of buildWhere at line 140. No changes needed.
- [Existing WHERE tests](SRC/preact/tests/query/sql-where.test.ts) — 28 existing tests. Target for new test cases.
- [ColStateEntry dead-end](artifacts/logs/agent.log.jsonl#L1) — Records the removed ColStateEntry pattern. Do NOT reintroduce.

---

## Scope

SRC/preact/query/sql-where.ts, SRC/preact/catalog/column-catalog.ts, SRC/preact/types.ts, SRC/preact/core/state.ts, SRC/preact/core/sqldb.ts, SRC/preact/core/state-serializer.ts, SRC/preact/core/state-hydrator.ts, SRC/preact/core/state-schema.ts, SRC/preact/ui/loader.ts, SRC/preact/ui/components/context-menu.tsx, SRC/preact/ui/grid.tsx, SRC/preact/types/globals.d.ts, SRC/preact/tests/query/sql-where.test.ts

---

## Problem Statement

### The Regressions

The `buildWhere` function in `sql-where.ts` has multiple regressions from the old JS codebase:

1. **Lost `numericHint` feature**: The old codebase had per-filter `opts.numericHint` that controlled whether `equals`/`not equals` used REAL vs TEXT comparison. This was lost in the Preact conversion. The replacement `isNumericCalc()` (lines 46-49) only triggers for calculated columns with `kind: 'calc' && mode: 'math'` — too narrow, missing the most common case of physical columns from spreadsheets containing numeric data.

2. **Dead `colState` placeholder**: A `colState: Record<string, ColStateEntry>` parameter was introduced as an architectural placeholder during the Preact conversion but never wired to any caller. Removed as dead code (caught by lint). Do NOT reintroduce — this feature needs proper design, not placeholder parameters.

3. **Comparison operator bug**: Lines 87-90 of `sql-where.ts` unconditionally use `CAST(col AS REAL)` for `>`, `<`, `>=`, `<=` operators. This is wrong for text columns (zip codes, phone numbers, employee IDs) where lexicographic comparison is needed and leading zeros must be preserved. `CAST('02134' AS REAL)` = `2134` — the leading zero is lost.

4. **Equality formatting bug**: A filter with `equals "5"` on a numeric column fails to match values stored as `"5.00"` or `"5.0"` because `CAST('5.00' AS TEXT) = '5'` evaluates to false (the string `'5.00'` does not textually equal `'5'`). The correct fix is `CAST(col AS REAL) = 5` which matches all numeric representations.

### Why the Previous Approach Was Rejected

The previous design document (DD-column-type-aware-where.md) recommended Option E — a filter-value heuristic (`looksNumeric()`) that would deduce column type from the filter value at query time. This was rejected because it reconstructs discarded information. The right approach is to not discard the cell type information at import time.

### Design Direction

Store all cell values as uniform strings in SQLite, capture XLSX cell type metadata at import time, and use that metadata to drive type-aware CAST expressions at query time. This decouples storage from type decisions — changing a column's declared type becomes a metadata write, not a data migration.

---

## Architecture (Decided — 6 Points)

### 1. Uniform String Storage

Store ALL cell values as strings in SQLite at import time. Change `coerceForSQL()` in `sqldb.ts` to produce only strings (or NULL):

| Input Type | Current Behavior | New Behavior |
|-----------|-----------------|-------------|
| Number 5 | Stored as number `5` | Stored as string `"5"` |
| Number 3.14 | Stored as number `3.14` | Stored as string `"3.14"` |
| Boolean true | Stored as number `1` | Stored as string `"1"` |
| Boolean false | Stored as number `0` | Stored as string `"0"` |
| Date | Stored as ISO string | Stored as ISO string (unchanged) |
| Numeric string "42" | Stored as number `42` | Stored as string `"42"` |
| null/undefined | Stored as NULL | Stored as NULL (unchanged) |

**Why:** Decouples storage from type decisions. Changing a column's declared type becomes a metadata write, not a data migration. No ALTER TABLE, no repopulation. CAST at query time is cheap — `CAST("col" AS REAL)` works on both TEXT and REAL storage.

**Implementation in `coerceForSQL()` (sqldb.ts:39-48):**
```typescript
function coerceForSQL(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  const s = String(v).trim();
  return s || null;
}
```

Note: Return type changes from `string | number | null` to `string | null`. The function no longer produces numeric SQLite values.

### 2. XLSX Cell Metadata Capture at Ingestion

In `ingestSheet()` in `loader.ts`, scan the worksheet cells directly to collect per-column type metadata from `cell.t` (type code) and `cell.z` (number format string). This must happen BEFORE or AFTER `sheet_to_json` — the metadata is on the worksheet object, not in the JSON output.

**Dense format access:** The project reads all workbooks with `dense: true` (loader.ts:218 for CSV, loader.ts:227 for XLSX). In dense mode, the worksheet is a 2D array. The `expandMerges()` function (loader.ts:25) shows the access pattern:
```typescript
const dense = Array.isArray(ws['!data'])
  ? ws['!data'] as unknown[][]
  : (Array.isArray(ws) ? ws : null);
```
Cell scanning must follow this same dual-access pattern. The `XLSXSheet` type declaration in `globals.d.ts` does not currently declare `!data` — it is accessed via the `[cell: string]: unknown` index signature. The type declaration should be extended to include `'!data'?: unknown[][]` for type safety.

**SheetJS cell.t values (from Context7 research):**
- `'n'` = Number (JS number in `.v`, formatted display in `.w`)
- `'s'` = String (JS string in `.v`)
- `'d'` = Date (JS Date object when `cellDates: true` is set; otherwise serial number with `'n'` type)
- `'b'` = Boolean (JS boolean in `.v`)
- `'e'` = Error (skip these)
- `'z'` = Stub/empty (skip these)

**SheetJS cell.z (number format string):**
- Date formats contain patterns like `yyyy`, `yy`, `mm`, `dd`, `hh`, `ss` (case-insensitive)
- Number formats contain patterns like `#,##0`, `0.00`, `0%`
- Text format: `'@'`
- The `cell.z` property is populated from the XLSX style information when using xlsx-js-style (the vendored fork)

**Majority-type determination:** For each column, count `cell.t` occurrences across all data rows (row index >= 1). The type with the highest count wins. Empty/missing cells (null, undefined, `cell.t === 'z'`) do not count toward the majority. Tie-breaking: first encountered type wins.

**Date format override:** For columns with majority type `'n'` (number), scan `cell.z` values for date format patterns. If >50% of numeric cells have date-like format strings (containing `yyyy`, `yy`, `mm`, `dd`, `hh`, `ss`), reclassify the column as `'date'`. This handles the common XLSX pattern where dates are stored as serial numbers with date formatting.

**For CSV imports:** CSV files are read with `dense: true` but have no cell metadata (all cells are type `'s'` or absent). All CSV columns default to `'string'` type — no scanning needed.

### 3. Column Type Metadata on DbTable and ColMapEntry

**New type in `types.ts`:**
```typescript
export type ColumnType = 'string' | 'number' | 'date' | 'boolean';
```

**Extended `DbTable` interface in `types.ts`:**
```typescript
export interface DbTable {
  id: string;
  name: string;
  cols: string[];
  rowCount: number;
  samples?: Record<string, string[]>;
  colTypes?: Record<string, ColumnType>;  // NEW — optional for backward compat
}
```

**Extended `PhysicalColEntry` in `column-catalog.ts`:**
```typescript
export interface PhysicalColEntry {
  kind?: undefined;
  tid: string;
  col: string;
  colType?: ColumnType;  // NEW — from DbTable.colTypes
}
```

**Extended `BandColEntry` in `column-catalog.ts`:**
```typescript
export interface BandColEntry {
  kind: 'band';
  tid: string;
  col: string;
  colType?: ColumnType;  // NEW — from DbTable.colTypes
}
```

`CalcColEntry` does NOT need a `colType` field — calc column types are derived from `mode` at query time (see point 4).

### 4. Type-Aware SQL Generation in buildWhere

Replace the `numericHint: boolean` approach with column-type-aware SQL generation.

**New `getColumnType()` helper in `sql-where.ts`:**
```typescript
import type { ColumnType } from '../types';

function getColumnType(alias: string, colMap: Map<string, ColMapEntry>): ColumnType {
  // _ROWNO special case — synthetic column, always numeric
  if (alias === '_rowno' || alias === '_ROWNO') return 'number';

  const entry = colMap.get(alias);
  if (!entry) return 'string';

  // Calc columns: derive type from mode
  if (entry.kind === 'calc') {
    if (entry.mode === 'math') return 'number';
    if (entry.mode === 'date') return 'date';
    return 'string'; // 'text' and 'compare' modes produce strings
  }

  // Physical/band columns: use colType metadata
  if (entry.kind !== 'calc' && 'colType' in entry && entry.colType) {
    return entry.colType;
  }

  return 'string'; // Default fallback — safe for all operators
}
```

**Type to SQL mapping:**

| ColumnType | = , != | > , < , >= , <= | IN , NOT IN |
|-----------|--------|-----------------|-------------|
| `'number'` | `CAST(ref AS REAL)` op `?` (numeric param) | `CAST(ref AS REAL)` op `?` (numeric param) | `CAST(ref AS REAL) IN (?)` (numeric params) |
| `'boolean'` | `CAST(ref AS REAL)` op `?` (numeric param) | `CAST(ref AS REAL)` op `?` (numeric param) | `CAST(ref AS REAL) IN (?)` (numeric params) |
| `'string'` | `CAST(ref AS TEXT)` op `?` (string param) | `CAST(ref AS TEXT)` op `?` (string param) | `ref IN (?)` (raw ref, string params) |
| `'date'` | `CAST(ref AS TEXT)` op `?` (string param) | `CAST(ref AS TEXT)` op `?` (string param) | `CAST(ref AS TEXT) IN (?)` (string params) |
| `undefined` / default | `CAST(ref AS TEXT)` op `?` (string param) | `CAST(ref AS TEXT)` op `?` (string param) | `ref IN (?)` (raw ref, string params) |

**Key change for comparison operators (`>`, `<`, `>=`, `<=`):** The default for undefined colType is now `CAST(ref AS TEXT)` — NOT `CAST(ref AS REAL)`. This fixes the current bug where text columns get numeric comparison. Only columns explicitly typed as `'number'` or `'boolean'` use REAL cast for comparisons.

**Key change for IN/NOT IN:** String columns use the raw ref (no CAST) for IN — same as current behavior for non-numeric. Number/boolean columns use `CAST(ref AS REAL)`. Date columns use `CAST(ref AS TEXT)` since ISO date strings sort lexicographically.

**`buildWhere()` API stays unchanged:** Signature remains `buildWhere(filters: FilterSpec[], colMap: Map<string, ColMapEntry>): WhereResult`. All four callers (sql-detail.ts:105, sql-grouped.ts:148, sql-totals.ts:110, sql-subtotals.ts:140) remain unchanged.

### 5. User Override via Context Menu

Add "Change column type" to the column context menu. On selection, update `AppState.columnTypeOverrides` — no data rewrite needed.

**UI pattern:** The current `ContextMenu` component (context-menu.tsx) supports only flat `{label: string, action: () => void}[]` items — no submenu support. Two options:

- **Option A (Recommended):** Extend `ContextMenu` to support nested items: `{ label, action?, children?: CtxMenuItem[] }`. When `children` is present, render a flyout submenu on hover.
- **Option B:** Use four flat items: "Type: String", "Type: Number", "Type: Date", "Type: Boolean". The active type is indicated by a checkmark or disabled state.

```
Column Header Menu:
├── Rename
├── Change type to: String    ✓ (if currently string)
├── Change type to: Number
├── Change type to: Date
├── Change type to: Boolean
├── Delete
```

**State update path:**
```typescript
store.update(draft => {
  if (!draft.columnTypeOverrides) draft.columnTypeOverrides = {};
  if (!draft.columnTypeOverrides[tableId]) draft.columnTypeOverrides[tableId] = {};
  draft.columnTypeOverrides[tableId][colName] = selectedType;
});
invalidateValidation(); // Force re-query with new type
```

**Effective type resolution (in `buildColSourceMap`):**
```typescript
const effectiveType = state.columnTypeOverrides?.[tid]?.[col] ?? table.colTypes?.[col];
map.set(col, { tid, col, colType: effectiveType });
```

### 6. _ROWNO Special Case

`_ROWNO` (stored as `_rowno` in the data) is a synthetic column added at `ingestSheet()` line 87 (`row[_ROWNO] = i + 1`). It:
- Has no XLSX cell origin — it's created after `sheet_to_json`
- Is stored as a number (not stringified) — it's internal machinery, not user data
- Should NOT appear in `DbTable.colTypes` metadata
- Gets special-cased in `getColumnType()` as `'number'` (see point 4)
- Is never user-overridable via context menu

The uniform string storage change in `coerceForSQL()` does NOT affect `_ROWNO` because `_rowno` values are set AFTER `sheet_to_json` returns (line 87) and are already numbers. When `insertRows` calls `coerceForSQL(row['_rowno'])`, the value is a number — under the new behavior it would be stringified to `"1"`, `"2"`, etc. However, since `getColumnType()` always returns `'number'` for `_rowno`, the SQL generation will `CAST(ref AS REAL)` which correctly converts `"1"` back to `1`. This is harmless but wasteful.

**Decision:** Keep `_rowno` going through the normal `coerceForSQL()` path (stored as string). The CAST at query time handles it correctly. No special-case in the ingestion path — simplicity wins.

---

## SheetJS Cell Metadata Research (Context7 Findings)

### Cell Object Structure

SheetJS cell objects in dense mode (`ws['!data'][r][c]`) have these relevant properties:

| Property | Type | Description |
|----------|------|-------------|
| `t` | `string` | Type code: `'n'` (number), `'s'` (string), `'d'` (date), `'b'` (boolean), `'e'` (error), `'z'` (stub) |
| `v` | `any` | Raw value (number, string, Date, boolean depending on `t`) |
| `w` | `string` | Formatted/display value (e.g., `"1,234.56"`, `"01/15/2024"`) |
| `z` | `string` | Number format string (e.g., `"#,##0.00"`, `"yyyy-mm-dd"`, `"@"`) |
| `f` | `string` | Formula (if cell contains a formula) |

### Reading Options Used by This Project

- `dense: true` — produces 2D array format (`ws['!data']` or `Array.isArray(ws)`)
- `raw: true` — returns raw values (`.v`) instead of formatted (`.w`) in `sheet_to_json`
- `cellDates: true` — converts date serial numbers to JS Date objects (sets `cell.t = 'd'`)
- `defval: null` — empty cells get `null` instead of being omitted
- `blankrows: false` — blank rows are excluded from output

### Key Findings

1. **`cell.t` is available in dense mode.** The dense format preserves all cell properties including `t`, `z`, `w`. The `sheet_to_json` utility strips this metadata from its output, but the worksheet object retains it.

2. **`cellDates: true` converts dates.** When this option is set (as it is for XLSX imports at loader.ts:227), date cells get `t: 'd'` and `v: Date`. Without this option, dates appear as `t: 'n'` with a serial number value. CSV imports do NOT set `cellDates` (loader.ts:218) — but CSV has no date cells anyway.

3. **`cell.z` is populated by xlsx-js-style.** The vendored fork (xlsx-js-style) preserves number format strings from XLSX files. This enables the date-format override for numeric columns.

4. **CSV cells are all strings.** When reading CSV with `XLSX.read(text, {type: 'string', dense: true})`, all cells have `t: 's'` or are empty. No type metadata is available — all columns default to `'string'`.

5. **Dense format access pattern.** The worksheet in dense mode can be accessed as either `ws['!data']` (array of arrays) or directly as an array (since `Array.isArray(ws)` returns true). The `expandMerges` function (loader.ts:25) handles both cases. Cell scanning should follow the same pattern.

---

## Data Flow

```
XLSX file → loadSpreadsheet() → ingestSheet()
  │
  ├── expandMerges(ws)
  │
  ├── [NEW] scanCells(ws) → colTypes: Record<string, ColumnType>
  │     ├── Read dense array (ws['!data'] or Array.isArray(ws))
  │     ├── For each data row (r >= 1), for each column (c):
  │     │     Read cell.t → increment type counter
  │     │     If cell.t === 'n', also read cell.z for date format detection
  │     ├── Majority vote per column
  │     ├── Date format override for majority-'n' columns
  │     └── Skip _rowno column
  │
  ├── XLSX.utils.sheet_to_json(ws, {defval:null, raw:true, blankrows:false})
  │     → rawData: Record<string, unknown>[]
  │
  ├── rawData.forEach(row => { row['_rowno'] = i + 1 })
  │
  ├── [CHANGED] coerceForSQL() stores ALL values as strings
  │     → "5", "3.14", "2024-01-15T00:00:00", "1", "0"
  │
  ├── insertRows(id, allCols, rawData)
  │
  └── store.update() → draft.tables[id] = { ..., colTypes }
                            │
                            ▼
                buildColSourceMap() / buildColumnCatalog()
                            │
                      PhysicalColEntry.colType = overrides[tid][col] ?? colTypes[col]
                      BandColEntry.colType = overrides[tid][col] ?? colTypes[col]
                      CalcColEntry — no colType field (derived from mode)
                            │
                            ▼
                buildWhere(filters, colMap)
                            │
                      getColumnType(alias, colMap)
                        → returns 'number' | 'string' | 'date' | 'boolean'
                            │
                            ▼
                renderClause() uses colType instead of numericHint
                  → correct CAST expression for each operator
```

---

## Design Goals

1. **Fix equality bug**: Filter `equals "5"` on a numeric column must match `5`, `5.00`, `5.0` — all representations via `CAST(col AS REAL) = 5`

2. **Fix comparison operators**: `>`, `<`, `>=`, `<=` must use TEXT cast for string columns (preserving leading zeros in zip codes, phone numbers), REAL cast for numeric columns

3. **Zero schema migration**: Column type changes are metadata-only — no ALTER TABLE, no data rewrite, no repopulation

4. **Backward compatible**: Existing .rcjson files have no `columnTypeOverrides` → all columns use auto-detected `colTypes` or default to `'string'`, producing safe TEXT comparisons

5. **Clean buildWhere API**: Stays `buildWhere(filters, colMap)` — 2 parameters, no dead placeholders. Do NOT reintroduce `ColStateEntry` or any placeholder parameter

6. **Preserve five-layer architecture**: No upward imports (UI → Query forbidden). Catalog feeds Query, not the other way around

7. **Work for both XLSX and CSV**: XLSX gets full cell-type metadata. CSV defaults to string for all columns

---

## Constraints

1. Five-layer architecture must be respected — no upward imports (UI → Query is forbidden)
2. `buildWhere` API must stay clean — exactly 2 params: `buildWhere(filters, colMap)`. Do NOT reintroduce `ColStateEntry` or any placeholder parameter
3. SQL identifiers must use `quoteId()` from `sqldb.ts` — never concatenate raw strings into SQL
4. No `dangerouslySetInnerHTML` — Preact JSX only
5. No breaking existing filter behavior for text columns (default is `'string'`)
6. `window`/`document` access must be guarded with `typeof window !== 'undefined'`
7. All changes must pass `npm run typecheck` (zero errors), `npm run lint` (zero warnings), `npm test` (all pass)
8. No change to AG Grid or UI rendering in the core design — colType metadata is purely for SQL generation. AG Grid filter type selection is a secondary concern
9. `_ROWNO` goes through normal `coerceForSQL()` path (stored as string). No special-case in ingestion. `getColumnType()` special-cases it as `'number'` at query time
10. Vendored CJS modules require `// @ts-expect-error - vendored CJS module` before `import()` of files in `js/wasm/` and `js/vendor/`
11. State changes must call `invalidateValidation()` after modifying db state, or validation stays stale

---

## File-by-File Impact Table

| File | Layer | Change | Complexity |
|------|-------|--------|-----------|
| `preact/types.ts` | Core | Add `ColumnType` type alias. Add `colTypes?` to `DbTable`. Add `columnTypeOverrides` to `AppState`. | Trivial |
| `preact/core/sqldb.ts` | Core | Change `coerceForSQL()` return type to `string \| null`. Stringify numbers and booleans. | Small |
| `preact/ui/loader.ts` | UI | Add `scanCellTypes(ws)` function. Call after `expandMerges()`. Store `colTypes` on `DbTable`. | Medium |
| `preact/types/globals.d.ts` | Core | Add `'!data'?: unknown[][]` to `XLSXSheet` interface. | Trivial |
| `preact/catalog/column-catalog.ts` | Catalog | Add `colType?` to `PhysicalColEntry` and `BandColEntry`. Propagate in `buildColSourceMap()` and `buildColumnCatalog()`. | Small |
| `preact/query/sql-where.ts` | Query | Remove `isNumericCalc()`. Add `getColumnType()`. Change `renderFilter()` and `renderClause()` to use `colType` instead of `numericHint`. Fix comparison operators. | Medium |
| `preact/core/state.ts` | Core | Add `columnTypeOverrides: {}` default in `createAppState()`. | Trivial |
| `preact/core/state-serializer.ts` | Core | Add `columnTypeOverrides` to `buildPayload()`. | Trivial |
| `preact/core/state-hydrator.ts` | Core | Add `columnTypeOverrides` hydration in `hydrateState()`. Default to `{}` if absent. | Trivial |
| `preact/core/state-schema.ts` | Core | Evaluate STATE_VERSION bump (2 → 3). See Open Questions. | Trivial |
| `preact/ui/components/context-menu.tsx` | UI | Extend to support nested items (submenu) OR document flat-item approach for type selection. | Small |
| `preact/ui/grid.tsx` | UI | Add "Change column type" context menu items to column header menu. Wire to store update. | Small |
| `preact/index.ts` | Core | Export `ColumnType` type from `types.ts`. | Trivial |
| `preact/tests/query/sql-where.test.ts` | Test | Add tests for type-aware behavior (~15 new test cases). | Medium |

**Total estimated:** ~225 lines changed across 14 files.

---

## Implementation Phases (Dependency-Ordered)

### Phase 1: Type Foundations
**Files:** `types.ts`, `globals.d.ts`, `index.ts`  
**Dependencies:** None  
**Description:** Add `ColumnType` type alias, extend `DbTable` with `colTypes?`, extend `AppState` with `columnTypeOverrides`, add `!data` to `XLSXSheet`, export `ColumnType` from barrel.  
**Validation:** `npm run typecheck` passes.

### Phase 2: Uniform String Storage
**Files:** `core/sqldb.ts`  
**Dependencies:** Phase 1  
**Description:** Change `coerceForSQL()` to always stringify. Return type becomes `string | null`. Numbers → `String(v)`, booleans → `'1'`/`'0'`, numeric strings → stay as strings (no `Number()` conversion). Dates and nulls unchanged.  
**Validation:** `npm test` — existing tests that depend on numeric storage may need updating. Verify `insertRows` still works with string-only values.

### Phase 3: Cell Metadata Capture
**Files:** `ui/loader.ts`  
**Dependencies:** Phase 1, Phase 2  
**Description:** Add `scanCellTypes(ws)` function that reads the dense worksheet array, counts `cell.t` per column, applies date-format override for majority-numeric columns, returns `Record<string, ColumnType>`. Call after `expandMerges()`, before `sheet_to_json`. Store result on `DbTable.colTypes` in the `store.update()` call. Skip `_rowno`.  
**Validation:** Manual test with XLSX file containing mixed-type columns. Verify `colTypes` appears in store after import. CSV import should produce empty/absent `colTypes`.

### Phase 4: Catalog Type Propagation
**Files:** `catalog/column-catalog.ts`  
**Dependencies:** Phase 1  
**Description:** Add `colType?` to `PhysicalColEntry` and `BandColEntry`. In `buildColSourceMap()`, read `state.tables[tid].colTypes?.[col]` and `state.columnTypeOverrides?.[tid]?.[col]`, set `colType: override ?? auto`. In `buildColumnCatalog()`, propagate similarly for base columns (line 142), lookup columns (line 163), and band columns (line 181). Calc columns get no `colType` field.  
**Validation:** `npm run typecheck` passes. Unit test: buildColSourceMap returns entries with colType set.

### Phase 5: Type-Aware SQL Generation
**Files:** `query/sql-where.ts`, `tests/query/sql-where.test.ts`  
**Dependencies:** Phase 2, Phase 4  
**Description:** Remove `isNumericCalc()`. Add `getColumnType()` helper. Change `renderFilter()` to call `getColumnType()` instead of `isNumericCalc()`. Change `renderClause()` signature: replace `numericHint: boolean` with `colType: ColumnType`. Update all switch cases per the type-to-SQL mapping table. Fix comparison operators to use TEXT cast for string/default columns. Add ~15 new test cases covering: numeric column equals, string column comparison, boolean column IN, date column equals, calc column type derivation, _ROWNO special case, undefined colType fallback.  
**Validation:** All 28 existing tests pass (some may need colMap fixtures updated to include colType). All new tests pass. `npm run typecheck` and `npm run lint` clean.

### Phase 6: Persistence
**Files:** `core/state.ts`, `core/state-serializer.ts`, `core/state-hydrator.ts`, `core/state-schema.ts`  
**Dependencies:** Phase 1  
**Description:** Add `columnTypeOverrides: {}` to `createAppState()` defaults. Add `columnTypeOverrides` to `buildPayload()` serialization. Add `columnTypeOverrides` hydration in `hydrateState()` (default to `{}` if absent). Evaluate STATE_VERSION bump — see Open Questions.  
**Validation:** Save a .rcjson with column type overrides, reload it, verify overrides are restored. Load an old .rcjson (v2, no columnTypeOverrides) — should load without errors, overrides default to `{}`.

### Phase 7: User Override UI
**Files:** `ui/components/context-menu.tsx`, `ui/grid.tsx`  
**Dependencies:** Phase 4, Phase 6  
**Description:** Either extend `ContextMenu` to support submenus or use flat items for type selection. Add "Change column type" items to the column header context menu in the preview grid. On selection, update `draft.columnTypeOverrides[tid][col]` and call `invalidateValidation()`.  
**Validation:** Manual test: right-click column header, change type, verify filter SQL changes. Save/reload preserves override.

### Phase Dependency Graph

```
Phase 1 (Types)
  ├── Phase 2 (Storage) ──┐
  ├── Phase 3 (Ingestion) ← depends on Phase 2
  ├── Phase 4 (Catalog) ──┤
  │                        ├── Phase 5 (SQL Generation) ← depends on Phase 2 + Phase 4
  ├── Phase 6 (Persistence)│
  │                        └── Phase 7 (UI) ← depends on Phase 4 + Phase 6
```

Phases 1, 4, and 6 can proceed in parallel after Phase 1 is complete. Phase 2 and Phase 3 are sequential. Phase 5 depends on Phases 2 and 4. Phase 7 depends on Phases 4 and 6.

---

## Open Questions

1. **STATE_VERSION bump:** Adding `columnTypeOverrides` to the payload is backward-compatible (old files lack the field, hydrator defaults to `{}`). A version bump from 2 → 3 would cause a warning toast for existing .rcjson files ("Version mismatch... Loaded with best-effort"). Since the field is optional with a safe default, **recommendation: do NOT bump STATE_VERSION**. The field is silently ignored by old hydrators and safely defaulted by new ones. However, if the team prefers strict versioning, bump to 3 and add `'columnTypeOverrides'` to `RECOGNIZABLE_KEYS`.

2. **Date type scope in v1:** Should `'date'` column type get full implementation in this pass or just the extension point? **Recommendation:** Implement basic TEXT comparison for dates now (ISO strings sort lexicographically correct). Add `julianday`-based math later if needed.

3. **Mixed-type columns:** A column with 80% numbers and 20% strings → classified as `'number'`. The 20% strings CAST to 0 in numeric comparisons. **Recommendation:** Accept this behavior for v1. The user can override via context menu if the auto-detection is wrong. Document this in the UI tooltip.

4. **ContextMenu submenu vs flat items:** The current `ContextMenu` component has no submenu support. **Recommendation:** Use flat items (Option B from point 5) for v1 — simpler, no component API change. The four "Change type to: X" items are clear and discoverable. Submenu support can be added later if more column-level actions need it.

5. **`coerceForSQL` return type change:** Changing from `string | number | null` to `string | null` is a breaking change for any code that depends on the numeric return. **Recommendation:** Verify no other callers depend on numeric returns. The only caller is `insertRows()` in `sqldb.ts` itself, which passes values to `stmt.run()` — SQLite accepts strings for all column types.

6. **Calc column type for `mode: 'compare'`:** Compare mode evaluates conditions and returns either `trueValue` or `falseValue`, which can be numbers, strings, or column references. The return type is dynamic. **Recommendation:** Treat `compare` as `'string'` for SQL generation — the values are heterogeneous and TEXT comparison is the safe default.

---

## Appendix: Research Findings

### Codebase Patterns Discovered

1. **`buildColSourceMap()` vs `buildColumnCatalog()`**: Two parallel APIs for building column maps. `buildColSourceMap()` is store-based (reads from `getStore().getState()`), used by the UI layer. `buildColumnCatalog()` is catalog-based (pure function with explicit `sourceCatalog` parameter), used by the query/report layer. Both must propagate `colType`.

2. **`resolveRef()` in `resolve-ref.ts`**: Physical columns resolve to `"tid"."col"` via `quoteId()`. Calc and band columns resolve to `"alias"`. This is used by `columnRefs()` in `sql-where.ts` to produce `CAST(ref AS TEXT)` and `CAST(ref AS REAL)` expressions. No changes needed to `resolveRef()`.

3. **Context menu pattern in UI**: Five components use `ContextMenu` (base-stage, column-chips, lookup-stage, calc-stage, and implicitly grid). All use the same pattern: `useState<{x, y, items} | null>` + `onContextMenu` handler + conditional render. Adding type-change items follows this established pattern.

4. **`invalidateValidation()`**: Must be called after any state change that affects query results. The context menu type-change handler must call this after updating `columnTypeOverrides`.

5. **Test helpers**: `ordersColMap()` in `tests/query/helpers.ts` provides a pre-built colMap for tests. New tests will need to extend this or create new fixtures with `colType` fields.

### What Was Investigated and Rejected

- **AG Grid as type source**: `grid.tsx` hardcodes `filter: 'agTextColumnFilter'` for all columns. AG Grid's `cellDataType` system requires manual configuration. Not a viable type source.
- **SQLite `typeof()` introspection**: Under the new uniform string storage, all columns will be `TEXT` in SQLite (except `_rowno`). `typeof()` would return `'text'` for everything — useless for type discrimination.
- **Option E (filter-value heuristic)**: Rejected because it reconstructs discarded information. The cell type metadata is available at import time at near-zero cost — discarding it and re-inferring at query time is strictly worse.
