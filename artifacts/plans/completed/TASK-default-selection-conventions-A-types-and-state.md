# Task: Type System & State Creation

## Problem Statement

TableFlip uses an inverted convention where `null` means "ALL items" in 7 pool-selection type fields across `types.ts` and `result-set.ts`. This is semantically backwards (null should mean "nothing"), makes the "no columns selected" state unrepresentable, diverges from the existing `LookupSpec.cols` pattern, and forces null checks at 15+ consumer sites.

This plan (Part A) is the foundation of the default-selection-conventions refactoring. It removes `| null` from all 7 type fields, updates state factory functions to default to empty arrays/Sets instead of `null`, and updates JSDoc comments. Test fixture updates are OUT OF SCOPE — Part E handles those. Downstream consumer fixes are handled by Parts B, C, and D.

**Prerequisite:** None (first part in the dependency chain).

## Phases

### Phase 1: Type Definition Changes
Remove `| null` from all 7 pool-selection type fields to establish non-nullable contracts.

- [x] Change `DetailBandSpec.cols` from `string[] | null` to `string[]` in `SRC/preact/types.ts` line 57
    **Note:** Removed `| null` from DetailBandSpec.cols (line 62)
- [x] Change `AppState.baseCols` from `string[] | null` to `string[]` in `SRC/preact/types.ts` line 169
    **Note:** Removed `| null` from AppState.baseCols (line 175)
- [x] Change `AppState.selCols` from `Set<string> | null` to `Set<string>` in `SRC/preact/types.ts` line 173
    **Note:** Removed `| null` from AppState.selCols (line 179)
- [x] Change `AppState.colOrder` from `string[] | null` to `string[]` in `SRC/preact/types.ts` line 174
    **Note:** Removed `| null` from AppState.colOrder (line 180)
- [x] Change `ReportSpec.pipeline.baseCols` from `string[] | null` to `string[]` in `SRC/preact/types.ts` line 220
    **Note:** Removed `| null` from ReportSpec.pipeline.baseCols (line 227)
- [x] Change `ReportSpec.outputColumns` from `string[] | null` to `string[]` in `SRC/preact/types.ts` line 226
    **Note:** Removed `| null` from ReportSpec.outputColumns (line 233)
- [x] Change `ResultSetMetadata.displayCols` from `string[] | null` to `string[]` in `SRC/preact/report/result-set.ts` line 29
    **Note:** Removed `| null` from ResultSetMetadata.displayCols (line 29)

### Phase 2: JSDoc Comment Updates
Update JSDoc comments to document the new non-nullable convention, replacing "null = all" with "empty = nothing, populated lazily."

- [x] Update `DetailBandSpec` JSDoc at `types.ts` line 48: change `@property cols` description from "Columns to include from the child table" to add "Empty array = no columns selected; populated with full child table column list when table is assigned"
    **Note:** Updated DetailBandSpec.cols JSDoc in types.ts line 53: added "Empty array = no columns selected; populated with full child table column list when table is assigned."
- [x] Update `AppState.baseCols` JSDoc at `types.ts` line 137: change "null = all" to "[] = no base columns selected; populated lazily when base table is set"
    **Note:** Updated AppState.baseCols JSDoc in types.ts line 143: changed "null = all" to "[] = no base columns selected; populated lazily when base table is set"
- [x] Update `AppState.selCols` JSDoc at `types.ts` line 141: change "null = all" to "empty Set = nothing selected; populated lazily with all projected columns"
    **Note:** Updated AppState.selCols JSDoc in types.ts line 147: changed "null = all" to "empty Set = nothing selected; populated lazily with all projected columns"
- [x] Update `AppState.colOrder` JSDoc at `types.ts` line 142: change "null = default" to "[] = use default ordering; populated lazily with natural column order"
    **Note:** Updated AppState.colOrder JSDoc in types.ts line 148: changed "null = default" to "[] = use default ordering; populated lazily with natural column order"
- [x] Update `ReportSpec` JSDoc at `types.ts` line 204: change "null = auto" to "[] = project nothing; populated lazily with all projected aliases"
    **Note:** Updated ReportSpec.outputColumns JSDoc in types.ts line 211: changed "null = auto" to "[] = project nothing; populated lazily with all projected aliases"
- [x] Update `ResultSetMetadata.displayCols` JSDoc at `result-set.ts` line 17: change "null = use columns array as-is" to "[] = use columns array as-is"
    **Note:** Updated ResultSetMetadata.displayCols JSDoc in result-set.ts line 17: changed "null = use columns array as-is" to "[] = use columns array as-is"

### Phase 3: State Factory Default Updates
Update factory functions in `core/state.ts` and `buildResultSet` in `result-set.ts` to use empty arrays/Sets instead of `null`.

- [x] Change `createAppState` default: `baseCols: null` to `baseCols: []` in `SRC/preact/core/state.ts` line 16
    **Note:** Changed createAppState default: baseCols: null → baseCols: []
- [x] Change `createAppState` default: `selCols: null` to `selCols: new Set()` in `SRC/preact/core/state.ts` line 20
    **Note:** Changed createAppState default: selCols: null → selCols: new Set()
- [x] Change `createAppState` default: `colOrder: null` to `colOrder: []` in `SRC/preact/core/state.ts` line 21
    **Note:** Changed createAppState default: colOrder: null → colOrder: []
- [x] Change `createReportSpec` default: `pipeline.baseCols: null` to `pipeline.baseCols: []` in `SRC/preact/core/state.ts` line 78
    **Note:** Changed createReportSpec default: pipeline.baseCols: null → pipeline.baseCols: []
- [x] Change `createReportSpec` default: `outputColumns: null` to `outputColumns: []` in `SRC/preact/core/state.ts` line 84
    **Note:** Changed createReportSpec default: outputColumns: null → outputColumns: []
- [x] Verify `createDetailBandSpec` already has `cols: []` at `SRC/preact/core/state.ts` line 141 — no change needed, already correct
    **Note:** Verified createDetailBandSpec already has cols: [] at line 142 — no change needed
- [x] Change `buildResultSet` default: `displayCols: null` to `displayCols: []` in `SRC/preact/report/result-set.ts` line 78
    **Note:** Changed buildResultSet default: displayCols: null → displayCols: []

### Phase 4: Compilation Verification
Run typecheck to verify that only expected errors remain (test fixtures — Part E scope, and consumer files — Parts B/C/D scope).

- [x] Run `npm run typecheck` from `SRC/` and capture error output
    **Note:** Ran `npm run typecheck` — 80 errors total, all TS2322 (Type 'null' is not assignable to type 'string[]' or 'Set<string>'). Zero errors in files modified by this plan (types.ts, core/state.ts, report/result-set.ts).
- [x] Verify that NO errors exist in `types.ts`, `core/state.ts`, or `report/result-set.ts` (files modified by this plan)
    **Note:** Verified: zero errors in types.ts, core/state.ts, and report/result-set.ts. All 80 errors are in downstream consumer files and test fixtures.
- [x] Verify that remaining errors are ONLY in files claimed by other parts: test files (Part E), `state-hydrator.ts`/`state-serializer.ts` (Part B), consumer files (Part C), UI files (Part D)
    **Note:** Error breakdown by part — 80 total errors:

Part B (state-hydrator.ts, state-serializer.ts): 0 errors in source files
Part C (query/report consumers): 2 errors in 2 files:
  - preview-builder.ts: 1 error (NOT in original expected list — logged as unexpected)
  - column-catalog.ts, query-plan.ts, sql-detail.ts, validation.ts, report-output.ts, engine.ts: 0 errors each

Part D (UI consumers): 10 errors in 4 files:
  - aggregation.ts: 4 errors (expected)
  - detail-band-stage.tsx: 2 errors (expected)
  - base-stage.tsx: 3 errors (NOT in original expected list — logged as unexpected)
  - sidebar.tsx: 1 error (NOT in original expected list — logged as unexpected)

Part E (test files): 69 errors across 17 test files (expected)

3 unexpected files (base-stage.tsx, sidebar.tsx, preview-builder.ts) are legitimate downstream consumers that need null→[] fixes in Parts C/D.
- [x] Log any unexpected errors to the agent log with category `discovery`
    **Note:** Logged 3 unexpected files to exec-executor discovery log: base-stage.tsx (3 errors), sidebar.tsx (1 error), preview-builder.ts (1 error). All are legitimate downstream consumers that assign null to now-non-nullable fields — they will be fixed by Parts C and D.

## Completion Criteria

- All 7 type fields are non-nullable (`string[]` or `Set<string>`, no `| null`)
- All 3 factory functions (`createAppState`, `createReportSpec`, `createDetailBandSpec`) default to empty arrays/Sets
- `buildResultSet` defaults `displayCols` to `[]`
- JSDoc comments reflect the new convention (empty = nothing, populated lazily)
- `npm run typecheck` produces zero errors in files modified by this plan (`types.ts`, `core/state.ts`, `result-set.ts`)
- No consumer logic is changed — that is explicitly scoped to Parts B, C, D

## References

- Design doc: `artifacts/designs/pending/DD-default-selection-conventions.md`
- Parts README: `artifacts/designs/parts/default-selection-conventions/README.md`
- Contracts ledger: `artifacts/designs/parts/default-selection-conventions/CONTRACTS.md`
- Sibling plans: Part B (Hydration & Serialization), Part C (Consumer Sites), Part D (UI & aggModeState), Part E (Test Fixtures)
