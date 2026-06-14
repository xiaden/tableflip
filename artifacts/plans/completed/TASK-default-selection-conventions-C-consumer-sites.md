# Task: Consumer Sites

## Problem Statement

Part A of the default-selection-conventions refactoring removes `| null` from 7 pool-selection type fields (`DetailBandSpec.cols`, `AppState.baseCols/selCols/colOrder`, `ReportSpec.pipeline.baseCols/outputColumns`, `ResultSetMetadata.displayCols`), making them non-nullable (`string[]` or `Set<string>`). After Part A, these fields are never null at runtime.

However, 7 consumer files across the Catalog, Query, and Report layers still contain null-coalesce guards, truthy-null checks, and null literals that were written for the old nullable types. These patterns become dead code under non-nullable types — they don't break at runtime, but they mislead readers and violate the architectural rule that consumers must use length/size checks (`arr.length > 0`, `set.size > 0`) instead of null guards.

This plan (Part C) replaces all null-guard patterns at consumer sites with the canonical length/size checks. It also updates one local type definition (`SourcePlan.baseCols`) and removes dead null coalesces and null literals. No consumer logic changes — only the guard patterns are replaced.

**Prerequisite:** Part A (Type System & State Creation) must be completed first, since the non-nullable types are what make these consumer changes necessary.

## Phases

### Phase 1: Catalog Layer Consumer
Replace null-coalesce guard in the column catalog's detail-band column resolution.

- [ ] In `SRC/preact/catalog/column-catalog.ts` line 241, change `(band.cols != null && band.cols.length > 0) ? band.cols : rtCols` to `band.cols.length > 0 ? band.cols : rtCols` — remove the `band.cols != null` check since `band.cols` is now `string[]` (never null); empty array means no columns selected, so fall back to `rtCols`

### Phase 2: Query Layer Consumers
Update the query plan builder's local type definition and two null-guard patterns, plus the SQL detail module's output-column guard.

- [ ] In `SRC/preact/query/query-plan.ts` line 36-37, change `SourcePlan.baseCols` type from `string[] | null` to `string[]` and update JSDoc from "Base column aliases, or null to use all base columns" to "Base column aliases; empty array means use all base columns"
- [ ] In `SRC/preact/query/query-plan.ts` lines 164-166, change `baseCols: reportSpec.pipeline.baseCols ?? (tablesById.has(reportSpec.pipeline.base) ? tablesById.get(reportSpec.pipeline.base)!.cols : null)` to `baseCols: reportSpec.pipeline.baseCols.length > 0 ? reportSpec.pipeline.baseCols : (tablesById.has(reportSpec.pipeline.base) ? tablesById.get(reportSpec.pipeline.base)!.cols : [])` — replace null-coalesce with length check; fallback produces `[]` instead of `null`
- [ ] In `SRC/preact/query/query-plan.ts` lines 208-211, change `const colOrder = reportSpec.outputColumns;` followed by `colOrder && colOrder.length > 0` to `colOrder.length > 0` — remove the truthy-null guard since `outputColumns` is now `string[]` (never null)
- [ ] In `SRC/preact/query/sql-detail.ts` lines 71-74, change `const outputCols = reportSpec.outputColumns;` followed by `(outputCols && outputCols.length > 0)` to `outputCols.length > 0` — remove the truthy-null guard since `outputColumns` is now `string[]` (never null)

### Phase 3: Report Layer Consumers
Update validation, report-output, preview-builder, and engine consumers to use length/size checks and remove dead null patterns.

- [ ] In `SRC/preact/report/validation.ts` line 625, change `state.selCols instanceof Set ? state.selCols.has(col) : true` to `state.selCols.size > 0 ? state.selCols.has(col) : true` — `selCols` is now always `Set<string>` (never null); check emptiness to preserve the "all selected" semantic (empty Set = nothing explicitly selected = treat as implicitly selected)
- [ ] In `SRC/preact/report/report-output.ts` line 53, change `(resultSet.metadata && resultSet.metadata.displayCols) || resultSet.columns` to `(resultSet.metadata && resultSet.metadata.displayCols.length > 0) ? resultSet.metadata.displayCols : resultSet.columns` — replace truthy-null fallback with explicit length check; empty `displayCols` means "use columns array as-is"
- [ ] In `SRC/preact/report/preview-builder.ts` line 269, change `baseCols: state.baseCols ?? null` to `baseCols: state.baseCols` — remove dead null coalesce; `state.baseCols` is already `string[]` after Part A, so `?? null` is unreachable
- [ ] In `SRC/preact/report/preview-builder.ts` line 275, change `outputColumns: null` to `outputColumns: []` — replace null literal with empty array to match the new non-nullable `ReportSpec.outputColumns` type
- [ ] Verify `SRC/preact/report/engine.ts` lines 61 and 417 compile without changes — `baseCols: reportSpec.pipeline.baseCols` is a pass-through into `catalogCtx: Record<string, unknown>`, and `string[]` is assignable to `unknown`; no logic change needed

### Phase 4: Compilation Verification
Run typecheck to confirm all consumer files compile cleanly under the new non-nullable types.

- [ ] Run `npm run typecheck` from `SRC/` and capture error output
- [ ] Verify that NO errors exist in the 7 files modified by this plan: `column-catalog.ts`, `query-plan.ts`, `sql-detail.ts`, `validation.ts`, `report-output.ts`, `preview-builder.ts`, `engine.ts`
- [ ] Verify that remaining errors (if any) are ONLY in files claimed by other parts: test files (Part E), `state-hydrator.ts`/`state-serializer.ts` (Part B), UI files (Part D)
- [ ] Log any unexpected errors to the agent log with category `discovery`

## Completion Criteria

- All null-coalesce guards (`??`, `!= null`, truthy-null `&&`) replaced with length/size checks in all 7 consumer files
- `SourcePlan.baseCols` type changed from `string[] | null` to `string[]` with updated JSDoc
- Dead null coalesce (`state.baseCols ?? null`) and null literal (`outputColumns: null`) removed from preview-builder.ts
- `engine.ts` pass-through compiles without changes under new type
- `npm run typecheck` produces zero errors in all 7 files modified by this plan
- No consumer logic is semantically changed — only guard patterns are replaced
- Zero null-checks remain at consumer sites for the 7 pool-selection fields

## References

- Design doc: `artifacts/designs/pending/DD-default-selection-conventions.md`
- Parts README: `artifacts/designs/parts/default-selection-conventions/README.md`
- Contracts ledger: `artifacts/designs/parts/default-selection-conventions/CONTRACTS.md`
- Prerequisite plan: `artifacts/plans/pending/TASK-default-selection-conventions-A-types-and-state.md`
- Sibling plans: Part B (Hydration & Serialization), Part D (UI & aggModeState), Part E (Test Fixtures)
