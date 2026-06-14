# Default Selection Conventions — Contracts Ledger

**Design doc:** `artifacts/designs/pending/DD-default-selection-conventions.md`
**Last updated:** 2026-06-14 (Plans A, B, C, D implemented — all source changes done; Plan E validated)

---

## Architectural Rules

- **Pool-Selection defaults**: Fields that select from a pool (columns, band cols, baseCols, selCols, outputColumns, displayCols) default to full populated list. Empty means nothing selected.
- **Ordering defaults**: `colOrder` defaults to full list in natural order. Empty means use default ordering.
- **Constraint-Accumulation defaults**: Filters, sorts, aggregates default to empty array. Unchanged.
- **Non-nullable types**: All pool-selection fields are `string[]` or `Set<string>` — never `| null`.
- **Lazy population**: State creation functions default to empty. UI handlers and hydration populate full lists when pool becomes available.
- **Overlay hydration**: Populate full list → overlay saved payload. Backward compatible with old `.rcjson` files.
- **No version bump**: Old files with `null` hydrate to full lists. Semantic is preserved.
- **Zero null-checks at consumers**: Replace truthy/null guards with length/size checks (`arr.length > 0`, `set.size > 0`).

---

## Type Definitions

| Field | Old Type | New Type | File |
| --- | --- | --- | --- |
| `DetailBandSpec.cols` | `string[] \| null` | `string[]` | types.ts:57 |
| `AppState.baseCols` | `string[] \| null` | `string[]` | types.ts:169 |
| `AppState.selCols` | `Set<string> \| null` | `Set<string>` | types.ts:173 |
| `AppState.colOrder` | `string[] \| null` | `string[]` | types.ts:174 |
| `ReportSpec.pipeline.baseCols` | `string[] \| null` | `string[]` | types.ts:220 |
| `ReportSpec.outputColumns` | `string[] \| null` | `string[]` | types.ts:226 |
| `ResultSetMetadata.displayCols` | `string[] \| null` | `string[]` | result-set.ts:29 |

---

## Factory Functions

| Function | Old Default | New Default | File |
| --- | --- | --- | --- |
| `createAppState` | `baseCols: null, selCols: null, colOrder: null` | `baseCols: [], selCols: new Set(), colOrder: []` | core/state.ts |
| `createReportSpec` | `pipeline.baseCols: null, outputColumns: null` | `pipeline.baseCols: [], outputColumns: []` | core/state.ts |
| `createDetailBandSpec` | `cols: []` (already correct) | `cols: []` | core/state.ts |

---

## Hydration Overlay Algorithm

```
hydrateState(payload, loadedTables):
  1. Create fresh state with empty arrays/Sets
  2. Set base table → populate baseCols with full list
  3. Process lookups/calcs → compute projected columns
  4. Populate selCols with full projected list
  5. Populate colOrder with full projected list
  6. Overlay saved selections if Array.isArray(payload.xxx)
  7. If payload.xxx is null/missing → keep full list
```

---

## Serialization Contract

All pool-selection fields serialize as plain arrays — never null:
```typescript
baseCols: [...state.baseCols],   // was: state.baseCols ? [...state.baseCols] : null
selCols: [...state.selCols],     // was: state.selCols ? [...state.selCols] : null
colOrder: [...state.colOrder],   // was: state.colOrder ? [...state.colOrder] : null
cols: [...b.cols],               // was: [...(b.cols || [])]
```

---

## Consumer Guard Pattern

| Before | After |
| --- | --- |
| `cond ? cond : default` | `cond.length > 0 ? cond : default` |
| `val ?? fallback` | `val.length > 0 ? val : fallback` |
| `val instanceof Set ? val.has(x) : true` | `val.size > 0 ? val.has(x) : true` |
| `val \|\| fallback` | `val.length > 0 ? val : fallback` |

---

## UI Handler Contracts

| Handler | Old Behavior | New Behavior |
| --- | --- | --- |
| `handleRightIdChange` | `cols = null` (all) | `cols = [...childTableCols]` (full list) |
| `toggleCol` | null→materialize to all, then toggle | direct array toggle |
| `selectAllCols` | `cols = null` (all) | `cols = [...allCols]` (full list) |
| `selectNoneCols` | `cols = []` (none) | `cols = []` (none — unchanged) |
| `colChip isSelected` | `cols == null \|\| cols.includes(c)` | `cols.includes(c)` |

---

## Decisions

| Decision | Rationale | Plan |
| --- | --- | --- |
| Part A scope excludes consumer fixes | Consumer files have null-coalesce patterns that compile without errors under non-nullable types — they become dead code but don't break. Parts C/D handle those. | A |
| Part A scope excludes test fixtures | ~80+ test fixture locations need `null` → `[]` replacements. Scoped to Part E. | A |
| Executor agents failed to apply edits for Plan A | Three executor invocations marked steps complete without editing files. Director applied edits directly. | A |
| Plans B, C, D executed by Director directly | Same executor reliability issue. Changes applied in single session. | B, C, D |
| Three additional UI files found with null assignments | `base-stage.tsx`, `sidebar.tsx`, and one remaining `aggregation.ts:151` line were missed by plans. Fixed during execution. | D |
| `_seenCols` import removed from column-chips.tsx | Was only used in the selCols init effect that was removed. | D |
| `reportSpec`/`sourceCatalog` removed from column-chips.tsx render | No longer needed after `state.colOrder || cols` became `state.colOrder`. | D |

---

## Local Type Changes

| Type | Field | Old Type | New Type | File | Plan |
| --- | --- | --- | --- | --- | --- |
| `SourcePlan` | `baseCols` | `string[] \| null` | `string[]` | query-plan.ts:37 | C |

---

## Consumer Guard Applications (Part C)

All consumer sites updated to use length/size checks instead of null guards:

| File | Line | Old Pattern | New Pattern |
| --- | --- | --- | --- |
| `column-catalog.ts` | 241 | `band.cols != null && band.cols.length > 0` | `band.cols.length > 0` |
| `query-plan.ts` | 164 | `reportSpec.pipeline.baseCols ?? (...)` | `reportSpec.pipeline.baseCols.length > 0 ? ... : (...)` |
| `query-plan.ts` | 209 | `colOrder && colOrder.length > 0` | `colOrder.length > 0` |
| `sql-detail.ts` | 72 | `outputCols && outputCols.length > 0` | `outputCols.length > 0` |
| `validation.ts` | 625 | `state.selCols instanceof Set ? ... : true` | `state.selCols.size > 0 ? ... : true` |
| `report-output.ts` | 53 | `resultSet.metadata.displayCols \|\| resultSet.columns` | `resultSet.metadata.displayCols.length > 0 ? ... : ...` |
| `preview-builder.ts` | 269 | `state.baseCols ?? null` | `state.baseCols` |
| `preview-builder.ts` | 275 | `outputColumns: null` | `outputColumns: []` |

---

## aggModeState UI Contracts (Part D)

All materialization cascades removed. `selCols` is always `Set<string>`, `colOrder` is always `string[]`.

| Site | Old Pattern | New Pattern |
| --- | --- | --- |
| `_selColsToArray` (aggregation.ts:21) | Returns `string[] \| null`; fallback `return null` | Returns `string[]`; fallback `return []` |
| `loadAggModeState` (aggregation.ts:124/132/139/151) | `draft.selCols = Array.isArray(...) ? new Set(...) : null` | `: new Set()` (empty Set fallback) |
| `handleRightIdChange` (detail-band-stage.tsx:120) | `bandDraft.cols = null` | `bandDraft.cols = rt ? [...rt.cols] : []` |
| `toggleCol` (detail-band-stage.tsx:172-173) | `bandDraft.cols == null ? [...rtCols] : [...bandDraft.cols]` | `[...bandDraft.cols]` |
| `selectAllCols` (detail-band-stage.tsx:187) | `bandDraft.cols = null` | `bandDraft.cols = [...rtCols]` |
| Chip `isSelected` (detail-band-stage.tsx:297) | `band.cols == null \|\| band.cols!.includes(c)` | `band.cols.includes(c)` |
| `selCols` init (column-chips.tsx:101-114) | `if (!st.selCols) { ... materialize ... }` | Removed (always populated) |
| `colOrder` init (column-chips.tsx:122-123) | `if (!st.colOrder) { ... materialize ... }` | Removed (always populated) |
| `colOrder` fallback (column-chips.tsx:153) | `state.colOrder \|\| cols` | `state.colOrder` |
| `handleDblClick` (column-chips.tsx:192-196) | `if (!draft.selCols) { ... materialize ... }` | Removed (direct toggle) |
| `onDrop` (column-chips.tsx:235-239) | `if (!draft.colOrder) { ... materialize ... }` | Removed (direct reorder) |

---

## Collections & Methods

| Method | Signature | Plan |
| --- | --- | --- |
| `createAppState` | `(overrides?: Partial<AppState>) => AppState` — defaults: `baseCols: [], selCols: new Set(), colOrder: []` | A |
| `createReportSpec` | `(overrides?: Partial<ReportSpec>) => ReportSpec` — defaults: `pipeline.baseCols: [], outputColumns: []` | A |
| `createDetailBandSpec` | `(overrides?: Partial<DetailBandSpec>) => DetailBandSpec` — defaults: `cols: []` (unchanged) | A |
| `buildResultSet` | `(columns: string[], rows: Record<string, unknown>[], metadata?: Partial<ResultSetMetadata>) => ResultSet` — defaults: `displayCols: []` | A |
| `hydrateState` | `(payload: Record<string, any>, loadedTables: Record<string, DbTable>) => { next, brokenRefs, nextExcludedRows }` — overlay algorithm: pre-populate full lists → overlay saved arrays. Null/missing payload fields keep full lists. | B |
| `buildPayload` | `(state: AppState) => Record<string, unknown>` — always serializes arrays for `baseCols`, `selCols`, `colOrder`, `band.cols` (never null) | B |
| `_selColsToArray` | `(selCols: unknown) => string[]` — returns `string[]` (never null); fallback is `[]` | D |
| `loadAggModeState` | `(mode: string) => void` — loads saved agg mode state; fallback for missing selCols is `new Set()` (never null) | D |

---

## Hydration Overlay Contracts (Plan B)

Fields hydrated with the overlay strategy (pre-populate → overlay saved payload):

| Field | Pre-populate source | Overlay condition | Null/missing behavior |
| --- | --- | --- | --- |
| `baseCols` | `loadedTables[savedBase].cols` | `Array.isArray(payload.baseCols)` | Keep full list |
| `selCols` | `new Set(nextAvailableCols())` | `Array.isArray(payload.selCols)` | Keep full Set |
| `colOrder` | `[...nextAvailableCols()]` | `Array.isArray(payload.colOrder)` | Keep full list |
| `band.cols` (broken table) | n/a (no pool available) | `Array.isArray(band.cols)` | `[]` (empty) |
| `band.cols` (normal) | n/a (filtered by `rt.cols`) | `Array.isArray(band.cols)` | `[]` (empty) |
| `aggModeState.none.selCols` | n/a (deferred to Part D) | `Array.isArray(rawNone.selCols)` | `[]` (empty) |
| `aggModeState.totals.selCols` | n/a (deferred to Part D) | `Array.isArray(rawTotals.selCols)` | `[]` (empty) |
| `aggModeState.subtotals.selCols` | n/a (deferred to Part D) | `Array.isArray(rawSubtotals.selCols)` | `[]` (empty) |

---

## Part E: Test Fixtures & Validation

**Scope:** Test files only. No production code changes. No new contracts created.

**Files modified:** 19 test files under `SRC/preact/tests/`

**Changes:**
- Mechanical replacement: `null` → `[]` in ~80+ fixture locations across 19 test files
- Expectation updates: `.toBeNull()` → `.toEqual([])` or `.toEqual(new Set())` in 12 locations
- Test description updates: 3 tests renamed to reflect new semantic (empty = no selection → fallback)
- Backward compatibility tests: 5 new tests verifying old `.rcjson` payloads with `null` values hydrate correctly

**No new production contracts.** Part E is purely test-layer work.

---

## DTOs Created

| DTO | Module | Fields | Plan |
| --- | --- | --- | --- |
| | | | |
