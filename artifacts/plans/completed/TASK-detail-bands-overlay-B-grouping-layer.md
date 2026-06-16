# Task: Grouping Layer (overlay-grouping.ts) + Validation + Report Output + Preview Cleanup

## Problem Statement

Part B of the detail-bands-overlay feature creates the shared grouping layer that sits between the engine's data output and the rendering consumers (grid, export). Part A established the type system (`BandResultSet`, `OverlayDescriptor`, etc.) and modified the engine to return flat parent rows + separate band result sets. Part B consumes that output and produces `OverlayDescriptor[]` — a flat, ordered array of declarative descriptors that describe the rendered output structure.

The core new module is `report/overlay-grouping.ts`, which exports `buildOverlayDescriptors()`. This pure function walks parent rows sequentially, detects group boundaries by match key transitions (using a `GroupBoundaryDetector` helper class), and emits parent/band-section/band-row descriptors. Band rows are emitted once per group (at the end of the group, when the match key changes), not after every parent row.

Part B also updates three existing Report-layer modules:
- **validation.ts**: Match column existence check replaces selCols membership check — match columns are used for grouping, not display, so they need to exist in parent data but don't need to be in the user's selected output columns.
- **report-output.ts**: `PublishedOutput` gains an optional `bandResult` field so downstream consumers receive band data alongside flat parent output. The old `_band_id` column-injection logic is removed (band data now lives in `bandResult.bandResults[]`, not in interleaved rows).
- **preview-builder.ts**: Removes `detailBandMode: 'separate'` from the preview `ReportSpec` construction (Part A removed the field from the type).

**Scope:** `report/overlay-grouping.ts` (new), `report/validation.ts`, `report/report-output.ts`, `report/preview-builder.ts`, `report/engine.ts` (export `makeKeyValue`), `index.ts` (add export). No UI changes — grid and export consumption of descriptors is Part D/E.

**Delivery:** Single commit with Parts A–F. Phases are structural only.

**Prerequisite:** TASK-detail-bands-overlay-A-core-types-engine (Part A must be complete — provides `BandResultSet`, `OverlayDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor` types in `types.ts`, `buildBandChildIndex()` in `engine.ts`, and `bandResult` field on `ResultSet`).

## Phases

### Phase 1: Infrastructure — Export makeKeyValue + Module Skeleton

Prepare the engine's internal helper for cross-module use and create the new grouping module file.

- [x] Export `makeKeyValue()` from `report/engine.ts` (currently a private function at line 267). Add the `export` keyword. This function is reused by the `GroupBoundaryDetector` in overlay-grouping.ts for match key computation — using the same function ensures key format consistency between the engine's child index and the grouping layer's boundary detection.
    **Note:** Verified: makeKeyValue is already exported from engine.ts at line 136 ('export function makeKeyValue'). Also confirmed buildBandChildIndex (line 159) and BandChildIndex type (line 148) are exported. No changes needed.
  **Notes:** Part A's CONTRACTS.md lists `makeKeyValue` as "kept (reused by Part B)" but the current code has it as a non-exported function. This step rectifies that.
- [x] Create new file `report/overlay-grouping.ts` with module JSDoc describing its role: consumes `BandResultSet` from engine, produces `OverlayDescriptor[]` for rendering consumers. Pure function module — no global state dependency. Add imports: `BandResultSet`, `OverlayDescriptor`, `ParentDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor`, `DetailBandSpec` from `../types`; `BandChildIndex`, `buildBandChildIndex` from `./engine`; `makeKeyValue` from `./engine`.
    **Note:** Created SRC/preact/report/overlay-grouping.ts with module JSDoc, type imports (BandResultSet, OverlayDescriptor, DetailBandSpec), and placeholder buildOverlayDescriptors() returning []. Unused imports (ParentDescriptor, BandSectionDescriptor, BandRowDescriptor, buildBandChildIndex, makeKeyValue, BandChildIndex) deferred to Phase 2 when they'll be consumed by the actual implementation — lint requires zero warnings. Parameters prefixed with _ to satisfy no-unused-vars.
- [x] Add `buildOverlayDescriptors` to the Report layer re-export block in `index.ts` (after the existing engine re-export at line 70). Add line: `export { buildOverlayDescriptors } from './report/overlay-grouping';`
    **Note:** Added 'export { buildOverlayDescriptors } from './report/overlay-grouping';' to index.ts after the engine re-export block (line 71). Typecheck + lint pass with zero warnings.

### Phase 2: Core Grouping Logic — GroupBoundaryDetector + buildOverlayDescriptors

Implement the overlay descriptor construction algorithm. This is the core of the overlay system.

- [x] Implement `GroupBoundaryDetector` class in `report/overlay-grouping.ts`. Constructor takes `keyAliases: string[]` (the parent-side key column aliases for a band's key pairs). Private fields: `prevMatchValue: string | undefined = undefined`, `keyAliases: string[]`. Method `isNewGroup(parentRow: Record<string, unknown>): boolean` — computes current key value via `makeKeyValue(parentRow, this.keyAliases)`, returns true if this is the first row (`prevMatchValue === undefined`) or the key value differs from `prevMatchValue`; updates `prevMatchValue` on each call. Method `getCurrentMatchValue(parentRow: Record<string, unknown>): unknown` — returns the raw match key value from the parent row (used for `BandSectionDescriptor.matchValue`).
    **Note:** Implemented GroupBoundaryDetector class in overlay-grouping.ts (lines 33-67). Constructor takes keyAliases: string[], private fields prevMatchValue (string | undefined) and keyAliases (readonly). isNewGroup() computes makeKeyValue and returns true on first call or value change, updating prevMatchValue. getCurrentMatchValue() delegates to makeKeyValue returning unknown. Uses makeKeyValue from engine.ts for key format consistency with buildBandChildIndex.
  **Notes:** Uses `makeKeyValue` from engine.ts for key computation — same function used by `buildBandChildIndex`, ensuring key format consistency. Single-key returns raw value as string; multi-key concatenates with `|||` separator.
- [x] Implement `buildOverlayDescriptors(bandResult: BandResultSet, detailBands: DetailBandSpec[]): OverlayDescriptor[]` function. Algorithm: (1) Build `BandChildIndex` via `buildBandChildIndex(bandResult.bandResults)` for O(1) child lookup. (2) Determine enabled bands from `detailBands` parameter (filter `enabled !== false`), cross-referenced with `bandResult.bandResults` (only bands that produced query results). (3) For each enabled band, create a `GroupBoundaryDetector` using the band's `keyPairs.map(p => p.left)` as key aliases. (4) Walk `bandResult.parentRows` sequentially. For each parent row: (a) check if any band's boundary detector signals a new group (match key transition); (b) if a group boundary is detected, flush the pending group — emit `BandSectionDescriptor` for each enabled band (using `bandResult.bandLabels[bandId]` for `bandLabel`, band's `cols` for `bandColumns`, the PREVIOUS group's match value for `matchValue`, `depth: 0`), then emit `BandRowDescriptor` for each matching child row (looked up from the `BandChildIndex` using the PREVIOUS group's match value and each band's key aliases); (c) emit `ParentDescriptor` for the current parent row (using `bandResult.parentCols` for `columns`). (5) After the loop, flush the final group (emit band section + band row descriptors for the last group's match value). (6) Return the accumulated `OverlayDescriptor[]`.
    **Note:** Implemented full buildOverlayDescriptors() algorithm (lines 97-183). Imports added: buildBandChildIndex, makeKeyValue from ./engine. Algorithm: (1) empty parentRows → return []. (2) Filter enabled bands cross-referenced with bandResults. (3) No enabled bands → ParentDescriptor[] only. (4) Build BandChildIndex for O(1) child lookup. (5) Create GroupBoundaryDetector per band using keyPairs.map(p => p.left). (6) Walk parent rows: check ANY band's detector for boundary, flush pending group if detected (emit BandSectionDescriptor + BandRowDescriptors per band using tracked match values), update group match values, emit ParentDescriptor. (7) Flush final group after loop. Band rows emitted at END of each group, not after every parent row.
  **Notes:** Band rows are emitted at the END of each group (when match key changes or at end of data), not after every parent row. This matches the DD spec's "one band section per group boundary" design. The `matchValue` in `BandSectionDescriptor` comes from the parent row that DEFINED the group (the first row with that match value), captured before the boundary detector advances.
- [x] Handle edge cases in `buildOverlayDescriptors()`: empty parent rows (`bandResult.parentRows.length === 0`) return empty `OverlayDescriptor[]`; no enabled bands returns array of `ParentDescriptor` only (one per parent row); band with no matching children for a group emits `BandSectionDescriptor` but no `BandRowDescriptor` (section header with no data rows); single parent row emits one `ParentDescriptor` then flushes one group (band section + matching children); all parent rows with same match value emit all parent descriptors then one band section + all matching children at the end.
    **Note:** All edge cases handled: (1) Empty parentRows → empty [] (line 99). (2) No enabled bands → ParentDescriptor[] only (lines 108-113). (3) Band with no matching children → BandSectionDescriptor emitted but no BandRowDescriptors (children defaults to [] via ?? [] at line 155). (4) Single parent row → one ParentDescriptor, then flushGroup emits one band section + matching children. (5) All same match value → all ParentDescriptors emitted during walk, then one flushGroup at end emits one band section + all matching children. Typecheck + lint + 980 tests all pass.

### Phase 3: Validation Update — Match Column Existence Check

Update `deriveValidation()` in `validation.ts` to check match column existence in parent data (colMap) instead of projected output columns (selCols).

- [x] In `report/validation.ts`, update the Detail Bands validation section (lines 304–366). Change the left key pair check (line 326) from `!projected.has(p.left)` to `!colMap.has(p.left)`. The `colMap` parameter (already passed to `deriveValidation`) contains all resolvable parent columns from base table, lookups, and calc stages — this is the correct set for "exists in parent data". Update the error message from `"Match column \"${p.left}\" is not available"` to `"Match column \"${p.left}\" does not exist in parent data"`. Keep the issue ID (`detailband_${i}_kp${pi}_left`) unchanged for test compatibility.
    **Note:** Changed detail band left-key validation from `!projected.has(p.left)` to `!colMap.has(p.left)` in validation.ts line 326. Updated error message from "is not available" to "does not exist in parent data". This decouples match column validation from output column selection — match columns need to exist in parent data (colMap) but don't need to be in the user's selected output columns (projected). Issue ID unchanged for test compatibility.
  **Notes:** The `colMap` parameter is already available in `deriveValidation` (line 154). The `projected` set (line 186) is derived from `projectedColsList` which reflects user-selected output columns. Match columns don't need to be in the output — they just need to exist in the data. This change decouples match column validation from output column selection, enabling hidden match columns (Phase 4 feature).
- [x] Update test file `preact/tests/report/validation-bands.test.ts`: update the test `'should block when key pair left column is not in projected cols'` (line 98) — rename to `'should block when key pair left column does not exist in parent data'`. The test logic remains the same ('NonExistentCol' is not in the colMap), but the assertion for the error message should check for `'does not exist in parent data'` instead of `'is not available'`. Update any other tests that assert on the old message text.
    **Note:** Renamed test from 'should block when key pair left column is not in projected cols' to 'should block when key pair left column does not exist in parent data'. Added assertion for 'does not exist in parent data' in the error message. Checked state-hydrator-bands.test.ts line 128 — only asserts brokenRefs contains column name, not message text, so no change needed there.

### Phase 4: Report Output Update — PublishedOutput bandResult Pass-Through

Extend `PublishedOutput` to carry band data and remove the old `_band_id` column-injection logic.

- [x] In `report/report-output.ts`, add `BandResultSet` to the import from `../types` (add to existing import statement at line 12).
    **Note:** Added BandResultSet to import from ../types in report-output.ts line 12.
- [x] Add optional `bandResult?: BandResultSet` field to the `PublishedOutput` interface in `report/report-output.ts` (after `publishedAt` at line 34). Add JSDoc: "Present when detail bands are active. Contains flat parent rows + separate band result sets. When present, columns and rows contain only parent data."
    **Note:** Added optional bandResult?: BandResultSet field to PublishedOutput interface with JSDoc describing its purpose.
- [x] Rewrite `createResultTable()` in `report/report-output.ts` (lines 52–71): remove the `_band_id` column-injection logic (lines 57–64 — the `hasBandIdInData` check and conditional `_band_id` append). Under the overlay model, `ResultSet.columns` contains only parent columns (no `_band_id`, no band columns). Band data lives in `resultSet.bandResult.bandResults[]`. The function should simply return `{ columns: cols, rows }` where `cols` is derived from `displayCols` or `columns` as before, and `rows` are filtered by `_row_type` as before.
    **Note:** Rewrote createResultTable() — removed _band_id column-injection logic (hasBandIdInData check and conditional append). Function now simply returns { columns: cols, rows } with displayCols/columns fallback and _row_type filtering. Updated JSDoc to describe overlay model.
- [x] Update `publishReportOutput()` in `report/report-output.ts` (lines 82–93): pass through `bandResult` from the `ResultSet` to the `PublishedOutput`. Add `bandResult: resultSet.bandResult` to the returned object (or spread it conditionally: `...(resultSet.bandResult ? { bandResult: resultSet.bandResult } : {})`).
    **Note:** Updated publishReportOutput() to conditionally spread bandResult from ResultSet into PublishedOutput: ...(resultSet.bandResult ? { bandResult: resultSet.bandResult } : {}).
- [x] Rewrite the `'publishReportOutput() with detail bands'` describe block in `preact/tests/report/report-output.test.ts` (lines 124–292). Remove tests that assert `_band_id` in interleaved rows (the old model). Replace with tests that verify: `PublishedOutput.bandResult` is present when `ResultSet.bandResult` is present; `PublishedOutput.bandResult` is undefined when `ResultSet.bandResult` is undefined; `PublishedOutput.columns` contains only parent columns (no `_band_id` injection); `PublishedOutput.rows` contains only parent rows (no interleaved band rows); `bandResult` pass-through preserves structure (parentRows, parentCols, bandResults, bandLabels); `_row_type` filtering still works correctly for parent rows.
    **Note:** Rewrote 'publishReportOutput() with detail bands' describe block — replaced 9 old interleaved-row tests with 6 overlay-model tests: bandResult present/undefined, parent-only columns (no _band_id), parent-only rows, bandResult structure preservation, _row_type filtering with bandResult. Added BandResultSet import. Net test count: -3 (9 removed, 6 added).
  **Notes:** The old tests verified interleaved row structure (parent rows with `_band_id=null`, band rows with `_band_id='band_0'`). Under the overlay model, published output has only parent rows/columns, with band data in the separate `bandResult` field. The test data fixtures must change from interleaved rows to flat parent rows + BandResultSet.
- [x] Update the `'publish band data correctly through the catalog'` test in `buildPublishedOutputCatalog` describe block (lines 398–421). Replace interleaved row fixture with a `ResultSet` that has parent-only columns/rows + `bandResult`. Assert that the catalog output's `bandResult` is present and correctly structured.
    **Note:** Replaced catalog band test — old interleaved-row fixture replaced with parent-only columns/rows + BandResultSet. Asserts bandResult present and correctly structured (parentRows, parentCols, bandResults, bandLabels). No _band_id in columns.

### Phase 5: Preview Builder Cleanup — Remove detailBandMode

Remove the `detailBandMode` field from the preview spec construction. Part A removed `detailBandMode` from the `ReportSpec` type, so this line would cause a typecheck error if not removed.

- [x] Remove `detailBandMode: 'separate'` from `buildPreviewReportSpec()` in `report/preview-builder.ts` (line 297). This field no longer exists on the `ReportSpec` interface (removed by Part A). The returned object should not include it.
    **Done:** detailBandMode was already removed by Part A — no detailBandMode reference found in preview-builder.ts. Step verified complete.
  **Warning:** This step is technically required for typecheck compliance after Part A. If Part A already removed this line, skip it. Verify by checking if `detailBandMode` appears in preview-builder.ts after Part A is implemented.

## Completion Criteria

- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes — all existing tests green (updated tests pass, removed assertions are gone)
- `report/overlay-grouping.ts` exists and exports `buildOverlayDescriptors(bandResult: BandResultSet, detailBands: DetailBandSpec[]): OverlayDescriptor[]`
- `GroupBoundaryDetector` class exists in `overlay-grouping.ts` with `isNewGroup()` and `getCurrentMatchValue()` methods
- `makeKeyValue` is exported from `report/engine.ts`
- `buildOverlayDescriptors` is exported from `index.ts`
- `validation.ts` checks match column existence via `colMap.has()` instead of `projected.has()` for band key pair left columns
- `PublishedOutput` interface has optional `bandResult?: BandResultSet` field
- `createResultTable()` no longer injects `_band_id` into published columns
- `publishReportOutput()` passes through `bandResult` from `ResultSet` to `PublishedOutput`
- `preview-builder.ts` does not reference `detailBandMode`
- `buildOverlayDescriptors` is a pure function — no global state access, no store imports
- Group boundaries are detected by match key transitions in parent data, not `_band_id` transitions
- Band rows are emitted once per group boundary (end of group), not per parent row
- `buildBandChildIndex()` from engine.ts is reused for O(1) child lookup (not reimplemented)
- New test file `preact/tests/report/overlay-grouping.test.ts` covers: single-band grouping, multi-band grouping, empty bands, single-row groups, all-same-group, multi-group transitions, empty parent rows, band with no matching children

## References

- Design doc: `artifacts/designs/pending/DD-detail-bands-rendering-overlay.md`
- Parts README: `artifacts/designs/parts/detail-bands-overlay/README.md`
- Contracts: `artifacts/designs/parts/detail-bands-overlay/CONTRACTS.md`
- Prerequisite plan: `artifacts/plans/pending/TASK-detail-bands-overlay-A-core-types-engine.md`
- Sibling parts: D (Grid overlay rendering), E (Export overlay rendering) — these consume `buildOverlayDescriptors()` output
- Bands orientation skill: `.opencode/skills/bands-feature-orientation/SKILL.md`
