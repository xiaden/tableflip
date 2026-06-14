# Task: Test Fixtures & Validation

## Problem Statement

Parts A–D of the default-selection-conventions refactoring change 7 pool-selection type fields from nullable (`string[] | null`, `Set<string> | null`) to non-nullable (`string[]`, `Set<string>`). Factory functions now default to empty arrays/Sets instead of `null`. Consumer sites use length/size checks instead of null guards. Hydration uses an overlay strategy where `null` payload values keep the pre-populated full list.

After Parts A–D, all test files that construct fixtures with `baseCols: null`, `outputColumns: null`, `displayCols: null`, or band `cols: null` will produce TypeScript errors because those fields no longer accept `null`. Additionally, test expectations that assert `.toBeNull()` on factory defaults or serializer output will fail because the new defaults are `[]` / `new Set()`.

This plan (Part E) mechanically replaces `null` with `[]` in ~19 test fixture files (~80+ locations), updates ~12 test expectations to match new factory/serializer defaults, updates test descriptions that reference the old "null = all" semantic, adds backward-compatibility tests for old `.rcjson` files with `null` values, and runs the full quality gate.

**Prerequisite:** Parts A, B, C, D (all source changes must be complete).

## Phases

### Phase 1: Shared Test Helper
Update the shared query test helper that is imported by most query-layer test files. This must be done first since many other files depend on it.

- [ ] In `SRC/preact/tests/query/helpers.ts` line 60, change `baseCols: null` to `baseCols: []` inside `makeReportSpec` factory's `pipeline` object
- [ ] In `SRC/preact/tests/query/helpers.ts` line 66, change `outputColumns: null` to `outputColumns: []` inside `makeReportSpec` factory

### Phase 2: Query Layer Test Fixtures
Replace `baseCols: null` with `baseCols: []` in all 7 query-layer test files. These are mechanical replacements — no test logic changes.

- [ ] In `SRC/preact/tests/query/query-plan.test.ts`, replace all `baseCols: null` with `baseCols: []` (4 locations: lines 100, 124, 205, 214)
- [ ] In `SRC/preact/tests/query/query-plan-bands.test.ts`, replace all `baseCols: null` with `baseCols: []` (9 locations: lines 45, 61, 90, 111, 141, 170, 203, 226, 249)
- [ ] In `SRC/preact/tests/query/sql-detail.test.ts`, replace all `baseCols: null` with `baseCols: []` (3 locations: lines 64, 95, 114)
- [ ] In `SRC/preact/tests/query/sql-grouped.test.ts`, replace `baseCols: null` with `baseCols: []` (1 location: line 83)
- [ ] In `SRC/preact/tests/query/sql-totals.test.ts`, replace all `baseCols: null` with `baseCols: []` (2 locations: lines 115, 159)
- [ ] In `SRC/preact/tests/query/sql-subtotals.test.ts`, replace `baseCols: null` with `baseCols: []` (1 location: line 167)
- [ ] In `SRC/preact/tests/query/calc-columns-execution.test.ts`, replace all `baseCols: null` with `baseCols: []` (8 locations: lines 80, 105, 137, 191, 225, 268, 312, 352)

### Phase 3: Report Layer Test Fixtures
Replace `baseCols: null`, `displayCols: null`, and band `cols: null` in all 4 report-layer test files.

- [ ] In `SRC/preact/tests/report/engine.test.ts`, replace `baseCols: null` with `baseCols: []` (1 location: line 122)
- [ ] In `SRC/preact/tests/report/engine-calc.test.ts`, replace all `baseCols: null` with `baseCols: []` (6 locations: lines 65, 97, 138, 185, 240, 282)
- [ ] In `SRC/preact/tests/report/report-graph.test.ts`, replace all `baseCols: null` with `baseCols: []` (20 locations: lines 21, 103, 127, 156, 174, 190, 207, 233, 264, 295, 314, 325, 347, 358, 369, 407, 418, 461, 484, 495)
- [ ] In `SRC/preact/tests/report/report-output.test.ts`, replace all `displayCols: null` with `displayCols: []` in fixture objects (3 locations: lines 23, 73, 207)
- [ ] In `SRC/preact/tests/report/preview-builder.test.ts`, replace all band `cols: null` with `cols: []` (5 locations: lines 328, 358, 387, 418, 457)

### Phase 4: Integration & UI Test Fixtures
Replace `baseCols: null` and `outputColumns: null` in integration and UI test files, plus the previously-unlisted `band-columns-catalog.test.ts`.

- [ ] In `SRC/preact/tests/integration/state-loading.test.ts`, replace `baseCols: null` with `baseCols: []` (1 location: line 64)
- [ ] In `SRC/preact/tests/integration/full-pipeline.test.ts`, replace all `baseCols: null` with `baseCols: []` (3 locations: lines 39, 195, 244) and `outputColumns: null` with `outputColumns: []` (1 location: line 45)
- [ ] In `SRC/preact/tests/integration/band-columns-catalog.test.ts`, replace all `baseCols: null` with `baseCols: []` (7 locations: lines 74, 93, 119, 152, 195, 253, 270)
- [ ] In `SRC/preact/tests/ui/row-explosion-dialog.test.ts`, replace `baseCols: null` with `baseCols: []` (1 location: line 122)

### Phase 5: Factory Default & Serializer Expectation Updates
Update test expectations that assert `.toBeNull()` on factory defaults and serializer output. After Parts A–B, `createAppState()` defaults to `baseCols: []`, `selCols: new Set()`, `colOrder: []`; `createReportSpec()` defaults to `pipeline.baseCols: []`, `outputColumns: []`; `buildResultSet()` defaults to `displayCols: []`; and `buildPayload()` serializes arrays (never null) for these fields.

- [ ] In `SRC/preact/tests/core/state.test.ts` line 23, change `expect(state.baseCols).toBeNull()` to `expect(state.baseCols).toEqual([])`
- [ ] In `SRC/preact/tests/core/state.test.ts` line 27, change `expect(state.selCols).toBeNull()` to `expect(state.selCols).toEqual(new Set())`
- [ ] In `SRC/preact/tests/core/state.test.ts` line 28, change `expect(state.colOrder).toBeNull()` to `expect(state.colOrder).toEqual([])`
- [ ] In `SRC/preact/tests/core/state.test.ts` line 98, change `expect(rpt.pipeline.baseCols).toBeNull()` to `expect(rpt.pipeline.baseCols).toEqual([])`
- [ ] In `SRC/preact/tests/core/state.test.ts` line 103, change `expect(rpt.outputColumns).toBeNull()` to `expect(rpt.outputColumns).toEqual([])`
- [ ] In `SRC/preact/tests/core/state-serializer.test.ts` line 18, change `expect(payload.baseCols).toBeNull()` to `expect(payload.baseCols).toEqual([])`
- [ ] In `SRC/preact/tests/core/state-serializer.test.ts` line 22, change `expect(payload.selCols).toBeNull()` to `expect(payload.selCols).toEqual([])`
- [ ] In `SRC/preact/tests/core/state-serializer.test.ts` line 23, change `expect(payload.colOrder).toBeNull()` to `expect(payload.colOrder).toEqual([])`
- [ ] In `SRC/preact/tests/core/state-serializer.test.ts` lines 58-63, rewrite the test "should preserve null selCols" — the test currently passes `selCols: null` to `createAppState()` which is a TypeScript error after Part A. Change to: test name "should serialize empty selCols Set as empty array", create state with `selCols: new Set()`, assert `payload.selCols` equals `[]`
- [ ] In `SRC/preact/tests/report/result-set.test.ts` line 19, change `expect(result.metadata.displayCols).toBeNull()` to `expect(result.metadata.displayCols).toEqual([])`
- [ ] In `SRC/preact/tests/report/result-set.test.ts` lines 40-43, change test name from "should default metadata: displayCols is null" to "should default metadata: displayCols is empty array", and change `expect(result.metadata.displayCols).toBeNull()` to `expect(result.metadata.displayCols).toEqual([])`

### Phase 6: Test Description Updates for New Semantic
Update test descriptions that reference the old "null = all" semantic. The test logic remains correct — only the descriptions need updating to reflect that empty array (not null) triggers the fallback behavior.

- [ ] In `SRC/preact/tests/report/report-output.test.ts` line 65, change test name from "should fall back to columns when displayCols is null" to "should fall back to columns when displayCols is empty"
- [ ] In `SRC/preact/tests/report/report-output.test.ts` line 199, change test name from "should preserve _band_id when displayCols is null (falls back to columns)" to "should preserve _band_id when displayCols is empty (falls back to columns)"
- [ ] Verify `SRC/preact/tests/catalog/column-catalog-bands.test.ts` lines 87-99 — test "should use all child table cols when band.cols is empty" uses `cols: []` and expects fallback to all child table cols. This behavior is preserved under the new convention (empty array → consumer falls back to `rtCols`). No code change needed, but update test description to "should fall back to all child table cols when band.cols is empty (no selection)" for clarity

### Phase 7: Backward Compatibility Verification
Add tests that verify old-style `.rcjson` payloads with `null` values hydrate correctly through the new overlay algorithm (Part B). These tests ensure backward compatibility is maintained.

- [ ] In `SRC/preact/tests/core/state-hydrator-bands.test.ts` (or a new `SRC/preact/tests/core/state-hydrator-migration.test.ts` if more appropriate), add a test "should hydrate old payload with null baseCols to full base table column list": construct a payload with `baseCols: null` and a valid base table, hydrate it, verify `next.baseCols` equals the full base table column list
- [ ] Add a test "should hydrate old payload with null selCols to full projected column Set": construct a payload with `selCols: null`, hydrate with lookups that produce projected columns, verify `next.selCols` is a Set containing all projected columns
- [ ] Add a test "should hydrate old payload with null colOrder to full natural column order": construct a payload with `colOrder: null`, hydrate, verify `next.colOrder` equals the full projected column list
- [ ] Add a test "should hydrate old payload with null band.cols to empty array": construct a payload with a detail band where `cols: null`, hydrate, verify `next.detailBands[0].cols` equals `[]` — under the new convention, null band.cols hydrates to empty (no selection), and the consumer falls back to all child table cols at runtime
- [ ] Add a test "should hydrate old payload with explicit array selections preserving user choices": construct a payload with `baseCols: ['A', 'B']`, `selCols: ['A']`, hydrate, verify the saved selections are preserved (not overwritten by full lists)

### Phase 8: Quality Gate
Run the full quality gate to verify all changes compile and pass.

- [ ] Run `npm run typecheck` from `SRC/` — verify zero errors across the entire codebase (types, source, and tests)
- [ ] Run `npm run lint` from `SRC/` — verify zero warnings
- [ ] Run `npm test` from `SRC/` — verify all tests pass
- [ ] If any failures occur, fix them in-place and re-run the failing check until it passes

## Completion Criteria

- All `null` literals replaced with `[]` (or `new Set()` for `selCols`) in test fixtures across all 19 test files
- All `.toBeNull()` expectations updated to `.toEqual([])` or `.toEqual(new Set())` for the 7 pool-selection fields
- The "should preserve null selCols" serializer test rewritten to test empty Set serialization
- Test descriptions updated to reflect new semantic (empty = no selection → fallback, not null = all)
- Backward compatibility tests added verifying old `.rcjson` payloads with `null` values hydrate correctly
- `npm run typecheck` produces zero errors
- `npm run lint` produces zero warnings
- `npm test` — all tests pass
- No source files are modified (only test files under `SRC/preact/tests/`)

## References

- Design doc: `artifacts/designs/pending/DD-default-selection-conventions.md`
- Parts README: `artifacts/designs/parts/default-selection-conventions/README.md`
- Contracts ledger: `artifacts/designs/parts/default-selection-conventions/CONTRACTS.md`
- Upstream plans: Part A (Types & State), Part B (Hydration & Serialization), Part C (Consumer Sites), Part D (UI & aggModeState)
