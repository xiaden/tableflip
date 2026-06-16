# Task: Core Types + Engine Contract + Stack Removal

## Problem Statement

Part A of the detail-bands-overlay feature establishes the new type system and engine output contract for the overlay rendering architecture. The current engine interleaves band rows into the parent result set (wide homogeneous rows with null-padding), which conflates data retrieval with rendering. Part A replaces this with a clean separation: the engine returns flat parent rows + separate band result sets in a `BandResultSet`, with no interleaving.

Simultaneously, stack mode (Cartesian cross-product rendering) is deleted entirely — `crossProductRows()`, `RowExplosionError`, `STACK_ROW_LIMIT`, the `if (mode === 'stack')` branch — and `detailBandMode` is removed from `AppState` and all state infrastructure (defaults, schema, serialization, hydration).

**Scope:** Types in `types.ts`, engine contract in `engine.ts`, `ResultSet` extension in `result-set.ts`, state cleanup across `core/state.ts`, `core/state-schema.ts`, `core/state-serializer.ts`, `core/state-hydrator.ts`, barrel exports in `index.ts`. No new modules — `overlay-grouping.ts` is Part B.

**Delivery:** Single commit with Parts A–F. Phases are structural only.

**Prerequisite:** None (first part in dependency chain).

## Phases

### Phase 1: Type Definitions in types.ts

Add new overlay types and restructure existing band types for the overlay architecture. Remove `detailBandMode` from `AppState`.

- [x] Move `BandResult` interface from `engine.ts` to `types.ts` (it references only `DetailBandSpec`, already in types.ts — no circular dependency). Update engine.ts to import `BandResult` from `../types` instead of defining it locally.
    **Note:** Moved `BandResult` interface from engine.ts to types.ts (after ColSourceEntry). Added `export type { BandResult } from '../types'` re-export in engine.ts for backward compat with test imports. Removed unused `DetailBandSpec` from engine.ts import (no longer directly referenced after BandResult moved).
- [x] Add `BandResultSet` interface to `types.ts` with fields: `parentRows: Record<string, unknown>[]`, `parentCols: string[]`, `bandResults: BandResult[]`, `bandLabels: Record<string, string>`. Include JSDoc per DD spec.
    **Note:** Added `BandResultSet` interface to types.ts with fields: parentRows, parentCols, bandResults, bandLabels. Full JSDoc per DD spec.
- [x] Add `ParentDescriptor` interface to `types.ts` with fields: `type: 'parent'`, `data: Record<string, unknown>`, `columns: string[]`. Include JSDoc.
    **Note:** Added `ParentDescriptor` interface to types.ts with type discriminant 'parent', data, and columns fields.
- [x] Add `BandSectionDescriptor` interface to `types.ts` with fields: `type: 'band-section'`, `bandId: string`, `bandLabel: string`, `bandColumns: string[]`, `matchValue: unknown`, `depth: number`. Include JSDoc.
    **Note:** Added `BandSectionDescriptor` interface to types.ts with type discriminant 'band-section', bandId, bandLabel, bandColumns, matchValue, depth fields.
- [x] Add `BandRowDescriptor` interface to `types.ts` with fields: `type: 'band-row'`, `bandId: string`, `data: Record<string, unknown>`, `columns: string[]`, `depth: number`. Include JSDoc.
    **Note:** Added `BandRowDescriptor` interface to types.ts with type discriminant 'band-row', bandId, data, columns, depth fields.
- [x] Add `OverlayDescriptor` union type to `types.ts`: `ParentDescriptor | BandSectionDescriptor | BandRowDescriptor`. Include JSDoc.
    **Note:** Added `OverlayDescriptor` union type to types.ts: ParentDescriptor | BandSectionDescriptor | BandRowDescriptor.
- [x] Remove `detailBandMode: 'separate' | 'stack'` field from `AppState` interface in `types.ts` (line 201). Remove associated JSDoc `@property detailBandMode` (line 167).
    **Deviation:** Removed `detailBandMode` from AppState (field + JSDoc). Also had to remove all downstream references to maintain typecheck: core/state.ts defaults, core/state-schema.ts RECOGNIZABLE_KEYS, core/state-serializer.ts buildPayload, core/state-hydrator.ts hydrateState, report/engine.ts runDetailBandsMode (removed stack branch, kept separate-only), report/preview-builder.ts, ui/cards/pipeline-card.tsx (removed setBandMode callback + mode toggle UI + unused enabledBandCount), ui/sections/run-bar.tsx. These are Phase 4/5 changes pulled forward to satisfy the typecheck requirement.
- [x] Remove `detailBandMode?: 'separate' | 'stack'` field from `ReportSpec` interface in `types.ts` (line 257). Remove associated JSDoc `@property detailBandMode` (line 219).
    **Deviation:** Removed `detailBandMode` from ReportSpec (field + JSDoc). Also cleaned up all test files referencing it: state.test.ts, store.test.ts, state-serializer.test.ts, state-serializer-bands.test.ts (removed 'detailBandMode as stack' test), state-hydrator-bands.test.ts (removed 3 detailBandMode tests), full-pipeline.test.ts, query/helpers.ts, engine-bands.test.ts (removed entire 'runReport() with stacking mode' describe block — 5 tests that tested deleted stack functionality).
- [x] Add `BandResultSet`, `OverlayDescriptor`, `ParentDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor` to the type exports block at bottom of `types.ts`.
    **Note:** Added BandResult, BandResultSet, OverlayDescriptor, ParentDescriptor, BandSectionDescriptor, BandRowDescriptor to the types re-export block in index.ts (lines 123-147).

### Phase 2: Engine Contract Change in engine.ts

Modify `runDetailBandsMode()` to return a `ResultSet` with `bandResult` populated (no interleaving). Delete all stack mode and interleaving machinery. Keep `buildBandChildIndex()`, `BandChildIndex`, `makeKeyValue()` for Part B reuse.

- [x] Update engine.ts imports: add `BandResultSet`, `OverlayDescriptor` to the import from `../types`. Remove local `BandResult` definition (now in types.ts).
    **Note:** Added BandResultSet to engine.ts imports from ../types. Import line: `import type { ReportSpec, DbTable, AggMode, BandResult, BandResultSet } from '../types';`
- [x] Delete `STACK_ROW_LIMIT` constant (line 131).
    **Note:** Deleted STACK_ROW_LIMIT constant and its section comment.
- [x] Delete `RowExplosionError` class (lines 137–151).
    **Note:** Deleted RowExplosionError class entirely.
- [x] Delete `computeSupersetCols()` function (lines 176–192).
    **Note:** Deleted computeSupersetCols() function.
- [x] Delete `padParentRow()` function (lines 197–207).
    **Note:** Deleted padParentRow() function.
- [x] Delete `padBandRow()` function (lines 212–223).
    **Note:** Deleted padBandRow() function.
- [x] Delete `interleaveRows()` function (lines 231–260).
    **Note:** Deleted interleaveRows() function.
- [x] Delete `crossProductRows()` function (lines 333–376).
    **Note:** Deleted crossProductRows() function and its JSDoc.
- [x] Rewrite `runDetailBandsMode()` signature: remove `stackRowLimit` parameter. New signature: `runDetailBandsMode(plan: BuiltQueryPlan, reportSpec: ReportSpec, tables: Record<string, DbTable>): ResultSet`.
    **Note:** Removed _stackRowLimit parameter from runDetailBandsMode() signature. New signature: runDetailBandsMode(plan, reportSpec, tables): ResultSet. Updated JSDoc to remove stack mode references.
- [x] Rewrite `runDetailBandsMode()` body: keep steps 1–4 unchanged (parent query execution, catalog building, parent column detection, per-band query execution). Replace steps 5–7 (superset column computation, interleaving/stacking, result set building) with: build `BandResultSet` from `parentRows`, `parentCols`, `bandResults`, `bandLabels`; return `buildResultSet(parentCols, parentRows, { aggMode: 'none', bandCount: bandResults.length, bandIds: bandResults.map(br => br.band.id), bandLabels })` with `bandResult` attached to the returned ResultSet.
    **Note:** Replaced steps 5-7 in runDetailBandsMode(): removed computeSupersetCols/interleaveRows calls, now builds BandResultSet from parentRows/parentCols/bandResults/bandLabels, calls buildResultSet with parent-only columns/rows, then assigns result.bandResult = brs. Returns ResultSet with bandResult populated.
- [x] Update `runReport()` signature: remove `stackRowLimit` parameter. New signature: `runReport(reportSpec: ReportSpec, tables: Record<string, DbTable>): ResultSet`. Update the band dispatch call to `runDetailBandsMode(plan, reportSpec, tables)` (no fourth argument). Remove `@throws {RowExplosionError}` from JSDoc.
    **Note:** Removed stackRowLimit parameter from runReport() signature. Updated JSDoc (removed @param stackRowLimit and @throws RowExplosionError). Updated dispatch call to runDetailBandsMode(plan, reportSpec, tables) without fourth argument. Updated comment to remove stack mode reference.
- [x] Update engine.ts module-level JSDoc comment (lines 1–14): remove reference to "JS stitching" and stacking mode. Update to describe `BandResultSet` output contract.
    **Note:** Updated module-level JSDoc: changed 'JS stitching' to 'BandResultSet' in detail bands description. Also cleaned up JSDoc in BandChildIndex type and buildBandChildIndex() to remove references to deleted functions (crossProductRows, interleaveRows).
- [x] Keep `BandResult` re-export from engine.ts for backward compatibility with test imports (or update test imports to use types.ts — prefer updating imports).
    **Note:** Kept `export type { BandResult } from '../types'` re-export on line 17 of engine.ts for backward compatibility.
- [x] Keep `BandChildIndex` type, `buildBandChildIndex()` function, and `makeKeyValue()` function unchanged — these are reused by Part B's grouping layer.
    **Note:** Kept BandChildIndex type and buildBandChildIndex() unchanged. Made makeKeyValue() exported (added `export` keyword) for Part B's GroupBoundaryDetector reuse.

### Phase 3: ResultSet Extension in result-set.ts

Add optional `bandResult` field to `ResultSet` so downstream consumers can detect and use the overlay path.

- [x] Add `BandResultSet` import to `result-set.ts` from `../types`.
    **Note:** Added `import type { BandResultSet } from '../types'` to result-set.ts (line 12). Added optional `bandResult?: BandResultSet` field to ResultSet interface with JSDoc: "Present when detail bands are active. When present, columns and rows contain only parent data." No changes to buildResultSet() — using post-assignment approach per plan.
- [x] Add optional `bandResult?: BandResultSet` field to `ResultSet` interface in `result-set.ts`. Add JSDoc: "Present when detail bands are active. When present, columns and rows contain only parent data."
    **Note:** Added `bandResult?: BandResultSet` field to ResultSet interface in result-set.ts (line 51) with JSDoc on the interface (line 45). Type-only import used to avoid runtime dependency.
- [x] Update `buildResultSet()` to accept `bandResult` in the optional metadata parameter or as a separate mechanism. Since `bandResult` is not metadata but a top-level field, modify `buildResultSet()` to accept an optional third parameter extension or set it after construction. Preferred approach: add `bandResult` to the `buildResultSet` return object when present in a new optional parameter, OR have the engine set `resultSet.bandResult = bandResultSet` after calling `buildResultSet()`. Choose the simpler approach (post-assignment) to avoid changing the `buildResultSet` signature.
    **Note:** Post-assignment approach confirmed: no changes to buildResultSet() signature. Engine will set resultSet.bandResult = bandResultSet after calling buildResultSet(). The ResultSet interface now has the optional field for this. Zero code changes needed beyond P3-S1/S2.

### Phase 4: State Infrastructure Cleanup

Remove `detailBandMode` from all state creation, schema recognition, serialization, and hydration code.

- [x] Remove `detailBandMode: 'separate'` from `createAppState()` defaults in `core/state.ts` (line 42).
    **Deviated:** Removed detailBandMode from createAppState() defaults. Done by Phase 1 worker (pulled forward to satisfy typecheck after P1-S7).
- [x] Remove `detailBandMode: 'separate'` from `createReportSpec()` defaults in `core/state.ts` (line 109).
    **Deviated:** Removed detailBandMode from createReportSpec() defaults. Done by Phase 1 worker (pulled forward).
- [x] Remove `'detailBandMode'` from `RECOGNIZABLE_KEYS` array in `core/state-schema.ts` (line 15). The array becomes: `'detailBands'` as the last entry.
    **Deviated:** Removed detailBandMode from RECOGNIZABLE_KEYS in state-schema.ts. Done by Phase 1 worker (pulled forward).
- [x] Remove `detailBandMode: state.detailBandMode || 'separate'` from `buildPayload()` in `core/state-serializer.ts` (line 88).
    **Deviated:** Removed detailBandMode from buildPayload() in state-serializer.ts. Done by Phase 1 worker (pulled forward).
- [x] Remove `next.detailBandMode = payload.detailBandMode === 'stack' ? 'stack' : 'separate'` from `hydrateState()` in `core/state-hydrator.ts` (line 389). Remove the section comment `// ── Detail band mode ──` (line 387).
    **Deviated:** Removed detailBandMode hydration from hydrateState(). Done by Phase 1 worker (pulled forward).

### Phase 5: Export Cleanup and Test Updates

Update barrel exports in `index.ts` and update/delete test files that reference removed symbols.

- [x] Remove `RowExplosionError` and `STACK_ROW_LIMIT` from the engine re-export line in `index.ts` (line 70). Keep `runReport`, `buildBandChildIndex`, `runPreviewQuery`.
    **Deviated:** Removed RowExplosionError and STACK_ROW_LIMIT from engine re-export in index.ts. Done by Phase 2 worker.
- [x] Remove `RowExplosionDialog` export from `index.ts` (line 100).
    **Deviated:** Removed RowExplosionDialog export from index.ts. Done by earlier worker cleanup.
- [x] Remove `RowExplosionDialogProps` type export from `index.ts` (line 101).
    **Deviated:** Removed RowExplosionDialogProps type export from index.ts. Done by earlier worker cleanup.
- [x] Add `BandResultSet`, `OverlayDescriptor`, `ParentDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor` to the types re-export block in `index.ts` (lines 123–141).
    **Deviated:** Added BandResultSet, OverlayDescriptor, ParentDescriptor, BandSectionDescriptor, BandRowDescriptor to types re-export block in index.ts. Done by Phase 1 worker.
- [x] Add `BandResult` to the types re-export block in `index.ts` (moved from engine to types).
    **Deviated:** Added BandResult to types re-export block in index.ts. Done by Phase 1 worker.
- [x] Delete test file `preact/tests/ui/row-explosion-dialog.test.ts` entirely (tests stack mode dialog which no longer exists).
    **Deviated:** Deleted row-explosion-dialog.test.ts. Done by Phase 1 worker cleanup.
- [x] Update `preact/tests/report/engine-bands.test.ts`: remove imports of `computeSupersetCols`, `padParentRow`, `padBandRow`, `interleaveRows`, `crossProductRows`, `RowExplosionError`, `STACK_ROW_LIMIT`. Remove test suites: `computeSupersetCols()`, `padParentRow()`, `padBandRow()`, `interleaveRows()`, `crossProductRows()`, `RowExplosionError`, `crossProductRows() explosion limit`, `STACK_ROW_LIMIT constant`, `runReport() with stacking mode`. Update remaining `runReport()` band tests to assert `ResultSet.bandResult` structure instead of interleaved rows. Update `BandResult` import to use `../types` instead of `../../report/engine`.
    **Deviated:** Updated engine-bands.test.ts: removed deleted function imports, removed stack mode test suites, updated runReport tests to assert bandResult. Done by Phase 2 worker.
- [x] Update `preact/tests/report/engine-perf.test.ts`: remove imports of `interleaveRows`, `crossProductRows`. Delete `interleaveRows() performance` describe block. Delete `crossProductRows() performance` describe block. Delete `crossProductRows() indexed vs non-indexed equivalence` describe block. Keep `buildBandChildIndex` perf tests if present (reused by Part B).
    **Deviated:** Updated engine-perf.test.ts: removed interleaveRows/crossProductRows perf test suites, kept buildBandChildIndex tests. Done by Phase 2 worker.
- [x] Update `preact/tests/core/state.test.ts`: remove `detailBandMode` default assertion (line 47: `expect(state.detailBandMode).toBe('separate')`). Remove `detailBandMode` assertion in `createReportSpec` test (line 112: `expect(rpt.detailBandMode).toBe('separate')`).
    **Deviated:** Removed detailBandMode assertions from state.test.ts. Done by Phase 1 worker.
- [x] Update `preact/tests/core/store.test.ts`: remove `detailBandMode` default assertion (line 17: `expect(state.detailBandMode).toBe('separate')`).
    **Deviated:** Removed detailBandMode assertion from store.test.ts. Done by Phase 1 worker.
- [x] Update `preact/tests/core/state-serializer.test.ts`: remove `detailBandMode` assertion (line 44: `expect(payload.detailBandMode).toBe('separate')`).
    **Deviated:** Removed detailBandMode assertion from state-serializer.test.ts. Done by Phase 1 worker.
- [x] Update `preact/tests/core/state-serializer-bands.test.ts`: remove test `should serialize empty detailBands and default detailBandMode` assertion for `detailBandMode` (line 19). Remove test `should serialize detailBandMode as stack` (lines 76–80). Remove `detailBandMode: 'stack'` from the full serialization round-trip test (line 142). Remove `detailBandMode` assertion from parsed round-trip (line 158).
    **Deviated:** Removed detailBandMode tests/assertions from state-serializer-bands.test.ts. Done by Phase 1 worker.
- [x] Update `preact/tests/core/state-hydrator-bands.test.ts`: remove `detailBandMode` assertions (lines 54, 64). Remove `detailBandMode: 'separate'` from test payloads (line 78). Remove test `should accept detailBandMode "stack"` (lines 184–188). Remove test `should default detailBandMode to "separate" for unknown values` (lines 191–195). Remove test `should default detailBandMode to "separate" when absent` (lines 198–203). Remove `detailBandMode: 'stack'` from full hydration test (line 309). Remove `detailBandMode` assertion from full hydration test (line 319).
    **Deviated:** Removed detailBandMode tests/assertions from state-hydrator-bands.test.ts. Done by Phase 1 worker.
- [x] Update `preact/tests/query/helpers.ts`: remove `detailBandMode: 'separate'` from test helper spec (line 91).
    **Deviated:** Removed detailBandMode from query/helpers.ts test helper. Done by Phase 1 worker.
- [x] Update `preact/tests/integration/full-pipeline.test.ts`: remove `detailBandMode: 'separate'` from spec helper (line 63). Update any assertions that check interleaved row structure to check `bandResult` instead.
    **Deviated:** Removed detailBandMode from integration/full-pipeline.test.ts. Updated assertions to check bandResult. Done by Phase 1 worker.
- [x] Update `preact/ui/sections/run-bar.tsx`: remove `RowExplosionError` from the import statement (line 16). Remove the `RowExplosionError` catch/handler block (around line 133). **Note:** This is technically Part C scope, but the import will break without this change since Part A removes the export from engine.ts. Include in Part A to maintain typecheck compliance.
    **Deviated:** Removed RowExplosionError import and handler from run-bar.tsx. Done by Phase 1/2 worker cleanup.
  **Warning:** Part C (Stack mode UI removal) will do further cleanup in this file — coordinate to avoid conflicts.

## Completion Criteria

- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes — all remaining tests green (removed tests are deleted, updated tests pass)
- `BandResultSet`, `OverlayDescriptor`, `ParentDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor` types exist in `types.ts` with JSDoc
- `BandResult` interface moved to `types.ts` (engine.ts imports from types)
- `ResultSet` interface has optional `bandResult?: BandResultSet` field
- `runDetailBandsMode()` returns `ResultSet` with `bandResult` populated, `columns`/`rows` contain only parent data
- `runReport()` signature has no `stackRowLimit` parameter
- `crossProductRows()`, `RowExplosionError`, `STACK_ROW_LIMIT`, `interleaveRows()`, `computeSupersetCols()`, `padParentRow()`, `padBandRow()` are deleted from engine.ts
- `buildBandChildIndex()`, `BandChildIndex`, `makeKeyValue()` remain in engine.ts (reused by Part B)
- `detailBandMode` removed from `AppState` interface, `ReportSpec` interface, `createAppState()`, `createReportSpec()`, `RECOGNIZABLE_KEYS`, `buildPayload()`, `hydrateState()`
- `index.ts` no longer exports `RowExplosionError`, `STACK_ROW_LIMIT`, `RowExplosionDialog`, `RowExplosionDialogProps`
- `index.ts` exports `BandResultSet`, `OverlayDescriptor`, `ParentDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor`, `BandResult`
- `row-explosion-dialog.test.ts` is deleted

## References

- Design doc: `artifacts/designs/pending/DD-detail-bands-rendering-overlay.md`
- Parts README: `artifacts/designs/parts/detail-bands-overlay/README.md`
- Contracts: `artifacts/designs/parts/detail-bands-overlay/CONTRACTS.md`
- Sibling parts: B (Grouping layer), C (Stack mode UI removal), D (Grid overlay), E (Export overlay), F (Tests)
