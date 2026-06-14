# Default Selection Conventions — Implementation Parts

## Parts

| Part | Title | Depends On | Layers |
| --- | --- | --- | --- |
| A | Type System & State Creation | None | Core, Types |
| B | State Hydration & Serialization | A | Core |
| C | Consumer Sites | A | Catalog, Query, Report |
| D | UI Layer & aggModeState | A | UI, Report |
| E | Test Fixtures & Validation | A, B, C, D | All |

## Dependency Graph

```
A (Types + State)
├── B (Hydration + Serialization)
├── C (Consumer Sites)
└── D (UI + aggModeState)
     └── E (Test Fixtures + Validation) ← depends on A,B,C,D
```

## Execution Rounds

Round 1: **A** (no deps)
Round 2: **B, C, D** (depend on A only — parallelizable)
Round 3: **E** (depends on all)

## Per-Part Scope

### Part A: Type System & State Creation

Removes `null` from all 7 pool-selection type fields across `types.ts` (`DetailBandSpec.cols`, `AppState.baseCols/selCols/colOrder`, `ReportSpec.pipeline.baseCols/outputColumns`) and `result-set.ts` (`ResultSetMetadata.displayCols`). Updates state creation functions in `core/state.ts` (`createAppState`, `createReportSpec`, `createDetailBandSpec`) to default to empty arrays/Sets instead of `null`. Fixes all initial compilation errors from the type changes — excluding test fixtures which are handled in Part E.

**Contracts exposed:** Type definitions (non-nullable `string[]`, `Set<string>`) consumed by B, C, D. Factory functions consumed by B.

### Part B: State Hydration & Serialization

Implements the hydration overlay algorithm in `core/state-hydrator.ts`: create fresh state → populate full lists from pool → overlay saved payload. Handles all 7 fields + aggModeState sub-selections. Removes null serialization branches from `core/state-serializer.ts` (always serialize arrays, never null). Ensures backward compatibility with old `.rcjson` files where `null` meant "all" — these hydrate to full lists.

**Contracts exposed:** Hydration entrypoint signature, overlay helper (reusable pattern). Serialization produces arrays-only output.

### Part C: Consumer Sites

Enables 7 files across Catalog/Query/Report layers to compile under the new non-nullable types. Replaces null-coalesce/truthy-null patterns with length/size checks at each consumer: `column-catalog.ts:241` (band.cols), `query-plan.ts:37/164/209-211` (SourcePlan.baseCols, baseCols fallback, colOrder), `sql-detail.ts:72-74` (outputCols), `validation.ts:625` (selCols), `report-output.ts:53` (displayCols), `preview-builder.ts:269/275` (baseCols dead coalesce, outputColumns null literal), `engine.ts:61/417` (pass-through).

**Contracts exposed:** No new contracts. Consumer logic unchanged — only null guard patterns replaced.

### Part D: UI Layer & aggModeState

Enables `detail-band-stage.tsx` and `column-chips.tsx` to compile under non-nullable types. Removes all materialization cascades (null→list on first interaction). Updates `selectAllCols`/`selectNoneCols`/`handleRightIdChange` handlers. Fixes `ui/aggregation.ts` which actively assigns `null` to `draft.selCols` — converts to `new Set()` default. Updates `_selColsToArray()` return type from `string[] | null` to `string[]`.

**Contracts exposed:** UI interaction contracts (toggle/reorder/select all/select none work without materialization). aggModeState sub-selections are always populated.

### Part E: Test Fixtures & Validation

Mechanically replaces `null` with `[]` in ~17 test files (~50+ fixture locations). Updates test expectations to reflect new convention (e.g., `cols: []` means empty, not all). Runs full gate: `npm run typecheck`, `npm run lint`, `npm test` — all must pass. Verifies backward compatibility by loading old-style fixtures through the new hydration path.
