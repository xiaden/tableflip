# Task: Export Overlay Rendering

## Problem Statement

Part E of the detail-bands-overlay feature replaces the current row-walking export band layout pipeline (`computeBandColSets()` → `buildBandColumnLayout()` → `applyBandGroup()`) with a descriptor-driven approach. The new `buildExportFromDescriptors()` function consumes `OverlayDescriptor[]` produced by Part B's grouping layer and produces the same parent-column-aligned export layout: parent rows pass through with all columns, band section headers relabel parent positions with band column display names, band data rows have empty col 0 + band values in parent column positions.

The three old functions are deleted. `exportAs()` band dispatch is updated to call `buildOverlayDescriptors()` then `buildExportFromDescriptors()` instead of `buildBandColumnLayout()`.

**Scope:** `ui/export.ts` only. Test file cleanup (remove dead imports/suites for deleted functions). New tests for `buildExportFromDescriptors()` are Part F scope.

**Delivery:** Single commit with Parts A–F. Phases are structural only.

**Prerequisite:** Part A (types + engine contract), Part B (grouping layer — `buildOverlayDescriptors()`, `OverlayDescriptor` types).

## Phases

### Phase 1: Implement buildExportFromDescriptors()

Add the new descriptor-driven export layout function to `export.ts`. This function replaces `computeBandColSets()` + `buildBandColumnLayout()` + `applyBandGroup()` as a single pure function that iterates `OverlayDescriptor[]` and produces the export output arrays.

- [x] Add import of `OverlayDescriptor`, `ParentDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor` types from `../types` to `export.ts`. These types are added by Part A.
    **Note:** Added OverlayDescriptor, ParentDescriptor, BandSectionDescriptor, BandRowDescriptor to existing type import on line 16 of export.ts.
- [x] Add import of `buildOverlayDescriptors` from `../report/overlay-grouping` to `export.ts`. This function is created by Part B.
    **Note:** Added buildOverlayDescriptors import from ../report/overlay-grouping on line 18. Added eslint-disable-next-line for unused-vars since this import is consumed in Phase 2.
- [x] Implement `buildExportFromDescriptors()` in `export.ts` with signature: `(descriptors: OverlayDescriptor[], parentCols: string[], hdrMap: Record<string, string>, isCsv?: boolean) => { cleanRows: Record<string, unknown>[]; rowKinds: number[]; headers: string[]; bandIds: string[] }`. Add JSDoc per DD spec: "Build export layout from overlay descriptors. Produces parent-column-aligned output: parent rows pass through with all columns, band section headers relabel parent positions, band data rows have empty col 0 + band values. Replaces buildBandColumnLayout() + applyBandGroup()."
    **Note:** Implemented buildExportFromDescriptors() at lines 396-558 of export.ts. Function signature matches plan spec exactly. JSDoc includes the specified description. Placed after enrichRowsWithBandHeaders() and before exportAs(). Function is exported.
- [x] Implement header computation inside `buildExportFromDescriptors()`: compute parent labels from `parentCols` + `hdrMap` (each alias → `hdrMap[alias] || alias`). Scan descriptors for the widest `BandSectionDescriptor.bandColumns` array. If `maxBandWidth > parentCols.length - 1`, append extra columns from the widest band's `bandColumns` (starting at index `parentCols.length - 1`), resolving display labels via two-step process: `rawLabel = hdrMap[colAlias] || colAlias`, then `displayLabel = rawLabel.startsWith('_band_') ? rawLabel.replace(/^_band_\\d+_/, '') : rawLabel`. This matches the current `buildBandColumnLayout()` extra-column logic.
    **Note:** Header computation: parent labels via hdrMap lookup, scan descriptors for widest band-section bandColumns, append extra columns from widest band if maxBandWidth > P-1. Extra column labels resolved via two-step: prefixedKey lookup in hdrMap, then strip _band_\d+_ prefix. Tracks widestBandId directly during scan (cleaner than reference-equality lookup).
- [x] Implement descriptor iteration for ParentDescriptor inside `buildExportFromDescriptors()`: when `type === 'parent'`, build a row keyed by header labels. Remap `data` alias keys to label keys via `hdrMap` (`label = hdrMap[alias] || alias`). Copy internal keys (starting with `_`) as-is. Fill any header positions not covered by parent data with empty strings. If `data._isTotalsRow` is true, assign kind 3. Otherwise assign kind 5. Push row, push kind, push empty bandId.
    **Note:** ParentDescriptor iteration: remaps alias keys via hdrMap, copies _ prefixed keys as-is, fills uncovered header positions with ''. Kind 3 if _isTotalsRow, else kind 5. Empty bandId pushed.
- [x] Implement descriptor iteration for BandSectionDescriptor inside `buildExportFromDescriptors()`: when `type === 'band-section'` and `isCsv` is true, SKIP this descriptor entirely (no section headers in CSV). Otherwise build a section header row: set `headers[0]` (first parent label / match column position) to `descriptor.matchValue`. For each band column at index `i`, set `headers[i + 1]` to the display label using two-step resolution: `rawLabel = hdrMap[bandCol] || bandCol`, then strip `_{bandId}_` prefix if present. Fill remaining header positions with empty strings. Assign kind 4. Push row, push kind, push empty bandId.
    **Note:** BandSectionDescriptor iteration: skipped when isCsv=true. Section header row: headers[0]=matchValue, headers[i+1]=display label from prefixedKey hdrMap lookup with _band_ prefix stripping. Kind 4. Empty bandId pushed.
- [x] Implement descriptor iteration for BandRowDescriptor inside `buildExportFromDescriptors()`: when `type === 'band-row'`, build a data row: set `headers[0]` to empty string (empty col 0). For each band column at index `i`, set `headers[i + 1]` to `data[bandCol] ?? ''`. Fill remaining header positions with empty strings. Assign kind 0. Push row, push kind, push `descriptor.bandId`.
    **Note:** BandRowDescriptor iteration: headers[0]='', headers[i+1]=data[prefixedKey] where prefixedKey=_{bandId}_{col}. Uses bandRow.columns (unprefixed) to construct prefixed keys for data lookup. Kind 0. descriptor.bandId pushed.
- [x] After descriptor iteration, project all rows to `headers` only (extract `cleanRows` by picking only header keys from each row, defaulting to empty string). Return `{ cleanRows, rowKinds, headers, bandIds }`.
    **Note:** Post-iteration projection: maps rows to cleanRows by picking only header keys (defaulting to ''). Returns { cleanRows, rowKinds, headers, bandIds }.
- [x] Verify the function handles edge cases: empty descriptor array → empty output with headers from parentCols; no BandSectionDescriptors → only parent rows; all bands wider than parent → extra columns appended correctly.
    **Note:** Edge cases verified: (1) empty descriptors → early return with headers from parentCols, empty arrays for rows/kinds/bandIds; (2) no band-section descriptors → maxBandWidth stays 0, no extra columns appended, only parent rows emitted; (3) bands wider than parent → extra columns appended from widest band. All three scenarios produce correct output structurally. Typecheck, lint, and all 991 tests pass.

### Phase 2: Wire exportAs() to Descriptor Path

Update the `exportAs()` band dispatch to use `buildOverlayDescriptors()` + `buildExportFromDescriptors()` instead of `buildBandColumnLayout()`.

- [x] Update `exportAs()` band layout path detection: replace `const enabledBands = (state.detailBands || []).filter(b => b.enabled !== false && b.rightId); if (enabledBands.length > 0)` with `const bandResult = (result as { bandResult?: BandResultSet }).bandResult; if (bandResult)`. Import `BandResultSet` from `../types` if not already imported.
    **Note:** Replaced band path detection in exportAs() (lines 612-614): changed from `enabledBands = state.detailBands.filter(...)` + `if (enabledBands.length > 0)` to `bandResult = (result as { bandResult?: BandResultSet }).bandResult` + `if (bandResult)`. Added `BandResultSet` to type import on line 16. Removed eslint-disable comment on line 17 since `buildOverlayDescriptors` is now consumed.
- [x] Inside the band layout path, replace the `buildBandColumnLayout()` call with: (1) append totalsRow to `bandResult.parentRows` if present (create `adjustedBandResult = { ...bandResult, parentRows: totalsRow ? [...bandResult.parentRows, { ...totalsRow, _isTotalsRow: true }] : bandResult.parentRows }`), (2) call `buildOverlayDescriptors(adjustedBandResult, state.detailBands || [])` to get descriptors, (3) call `buildExportFromDescriptors(descriptors, bandResult.parentCols, hdrMap || {}, isCsv)` to get `{ cleanRows, rowKinds, headers, bandIds }`.
    **Note:** Replaced buildBandColumnLayout() call (lines 615-616) with three-step descriptor pipeline: (1) create adjustedParentRows by appending totalsRow with _isTotalsRow flag if present, (2) build adjustedBandResult with adjusted parentRows, (3) call buildOverlayDescriptors(adjustedBandResult, state.detailBands || []) to get descriptors, (4) call buildExportFromDescriptors(descriptors, bandResult.parentCols, hdrMap || {}, isCsv) to get { cleanRows, bandRowKinds, bandHeaders, bandIds }. Variable names intentionally preserved so downstream CSV/XLSX handling works unchanged.
- [x] Update the `exportAs()` JSDoc dispatch-path description: replace reference to `buildBandColumnLayout()` with `buildOverlayDescriptors()` + `buildExportFromDescriptors()`. Note that the band path activates when `result.bandResult` is present (not when `enabledBands.length > 0`).
    **Note:** Updated exportAs() JSDoc (lines 553-567): replaced reference to buildBandColumnLayout() with buildOverlayDescriptors() + buildExportFromDescriptors(). Updated dispatch path description to note band path activates when result.bandResult is present (not when enabledBands.length > 0).
- [x] Verify the CSV path within the band layout block still works: `cleanRows` and `headers` from `buildExportFromDescriptors()` with `isCsv=true` skip section headers and retain `_band_id` on band data rows (via `filterExportCols` which keeps `_band_id` for CSV).
    **Note:** CSV path verified: buildExportFromDescriptors() receives isCsv=true, which causes BandSectionDescriptor iteration to skip section headers (line 486: `if (isCsv) continue`). cleanRows and headers from buildExportFromDescriptors() are passed to json_to_sheet() and sheet_to_csv() unchanged. Variable names (cleanRows, bandHeaders) match the original code so the CSV block works identically. All 93 export-bands tests pass (1 skipped for Phase 4 update).
- [x] Verify the XLSX path within the band layout block still works: `cleanRows`, `bandRowKinds`, `bandHeaders`, `bandIds` are passed to `applyExportMerges()` and `styleExportSheet()` unchanged — the output contract of `buildExportFromDescriptors()` matches `buildBandColumnLayout()`.
    **Note:** XLSX path verified: buildExportFromDescriptors() output contract matches buildBandColumnLayout() — returns { cleanRows, rowKinds, headers, bandIds }. Variable names preserved (bandRowKinds, bandHeaders, bandIds) so applyExportMerges() and styleExportSheet() calls work unchanged. Typecheck passes with zero errors, lint passes with zero warnings, all 990 tests pass (1 skipped for Phase 4 update).

### Phase 3: Remove Old Band Layout Functions

Delete the three functions replaced by the descriptor-driven approach.

- [x] Delete `computeBandColSets()` function (lines 89–110) from `export.ts`. This function is no longer called — `buildExportFromDescriptors()` gets band column info from `BandSectionDescriptor.bandColumns`.
    **Note:** Deleted computeBandColSets() function (was lines 80-111 including JSDoc) from export.ts. Function is not exported from index.ts. Only remaining references are in test file (Phase 4 scope).
- [x] Delete `applyBandGroup()` function (lines 135–246) from `export.ts`. This function is no longer called — descriptor iteration replaces row-walking.
    **Note:** Deleted applyBandGroup() function (was lines 113-247 including JSDoc) from export.ts. Function is not exported from index.ts. Only remaining references are in test file (Phase 4 scope).
- [x] Delete `buildBandColumnLayout()` function (lines 264–345) from `export.ts`. This function is no longer called — `buildExportFromDescriptors()` replaces it.
    **Note:** Deleted buildBandColumnLayout() function (was lines 249-346 including JSDoc) from export.ts. Function is not exported from index.ts. Only remaining references are in test file (Phase 4 scope).
- [x] Remove the now-unused `DetailBandSpec` import from `export.ts` if it was only used by the deleted functions. Check: `DetailBandSpec` is still used by `buildBandLabels()` — keep the import.
    **Note:** Checked all imports in export.ts. DetailBandSpec is still used by buildBandLabels() (line 57). DbTable is still used by buildBandLabels() (line 58). OverlayDescriptor, ParentDescriptor, BandSectionDescriptor, BandRowDescriptor are used by buildExportFromDescriptors(). BandResultSet is used by exportAs(). buildOverlayDescriptors is used by exportAs(). No unused imports found — all imports are still needed.
- [x] Update `export.ts` module-level comment (lines 1–10) if it references the deleted functions.
    **Note:** Module-level comment (lines 1-10) does not reference any of the deleted functions. No update needed. Comment only mentions general porting differences (window assignment, state reads, utils, catalog, validation). Verification: typecheck passes with zero errors for production code (export.ts). Four typecheck errors remain in test file (export-bands.test.ts imports deleted functions) — Phase 4 scope. Lint passes with zero warnings on export.ts.

### Phase 4: Update Test File for Compilation

Remove dead imports and test suites from `export-bands.test.ts` so that `npm run typecheck` passes after the deleted functions are removed. Part F will add new tests for `buildExportFromDescriptors()`.

- [x] Remove `computeBandColSets`, `applyBandGroup`, `buildBandColumnLayout` from the import statement in `preact/tests/ui/export-bands.test.ts` (lines 7–9).
    **Note:** Removed computeBandColSets, applyBandGroup, buildBandColumnLayout from import statement in export-bands.test.ts. Kept: filterExportCols, buildBandLabels, enrichRowsWithBandHeaders, styleExportSheet, exportAs.
- [x] Delete the `describe('computeBandColSets', ...)` test suite (lines 844–887, 5 tests).
    **Note:** Deleted describe('computeBandColSets', ...) test suite (5 tests) from export-bands.test.ts.
- [x] Delete the `describe('applyBandGroup', ...)` test suite (lines 891–1130, 18 tests).
    **Note:** Deleted describe('applyBandGroup', ...) test suite (18 tests) from export-bands.test.ts.
- [x] Delete the `describe('buildBandColumnLayout', ...)` test suite (lines 1134–1358, 14 tests).
    **Note:** Deleted describe('buildBandColumnLayout', ...) test suite (14 tests) from export-bands.test.ts.
- [x] Delete the `describe('buildBandColumnLayout — integration scenarios', ...)` test suite (lines 1525–1632, 4 tests).
    **Note:** Deleted describe('buildBandColumnLayout — integration scenarios', ...) test suite (4 tests) from export-bands.test.ts.
- [x] Update the `describe('exportAs — band layout dispatch', ...)` test suite (lines 1636–1755): update test setup to provide `bandResult` on the result object instead of interleaved rows with `_band_id`. The tests should set `draft.result = { rows: parentRows, cols: parentCols, bandResult: { parentRows, parentCols, bandResults: [...], bandLabels: {...} } }` so the new descriptor path activates. Keep the test assertions about header shape (no `_band_` prefixes, parent columns present).
    **Note:** Updated exportAs — band layout dispatch test suite: unskipped first test, updated all 3 band-path tests to provide bandResult on result object with proper BandResultSet structure (parentRows, parentCols, bandResults with child rows containing OrderId match key, bandLabels). Child rows include OrderId field so buildBandChildIndex() can match them to parent rows via makeKeyValue(). Non-band path test unchanged.
  **Warning:** These tests may need adjustment depending on how `buildOverlayDescriptors()` handles the test data. If the mock `bandResult` structure doesn't produce valid descriptors, the tests may need to be simplified or deferred to Part F. Mark tests as `it.skip()` if they cannot be made to pass without the full Part B grouping layer.
- [x] Verify `npm run typecheck` passes with zero errors after all deletions.
    **Note:** Typecheck passes with zero errors after all deletions and updates.
- [x] Verify `npm run lint` passes with zero warnings after all deletions.
    **Note:** Lint passes with zero warnings after all deletions and updates.
- [x] Verify `npm test` passes — remaining test suites (`filterExportCols`, `buildBandLabels`, `enrichRowsWithBandHeaders`, `styleExportSheet` band styling, `exportAs` dispatch) must all pass.
    **Note:** All 953 tests pass across 54 test files. Remaining export-bands test suites: filterExportCols (7), buildBandLabels (6), enrichRowsWithBandHeaders (9), CSV export (7), styleExportSheet band data row tint (10), styleExportSheet band parent kind 5 (8), styleExportSheet band header kind 4 (8), exportAs band layout dispatch (4). Total: 953 tests, 0 failures.

## Completion Criteria

- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes — all remaining tests green
- `buildExportFromDescriptors()` exists in `export.ts` with JSDoc, consumes `OverlayDescriptor[]`, produces `{ cleanRows, rowKinds, headers, bandIds }`
- `exportAs()` band dispatch calls `buildOverlayDescriptors()` + `buildExportFromDescriptors()` instead of `buildBandColumnLayout()`
- `computeBandColSets()`, `applyBandGroup()`, `buildBandColumnLayout()` are deleted from `export.ts`
- `export.ts` imports `OverlayDescriptor` types from `../types` and `buildOverlayDescriptors` from `../report/overlay-grouping`
- Test file compiles — dead imports and test suites for deleted functions are removed
- Parent-column-aligned layout preserved: parent rows pass through with all columns, section headers relabel parent positions, band data rows have empty col 0 + band values
- Row kind assignment: ParentDescriptor → 5, BandSectionDescriptor → 4, BandRowDescriptor → 0, totals → 3
- CSV path skips section header insertion (isCsv=true)
- Label resolution: two-step prefix stripping preserved (`hdrMap` lookup → strip `_{bandId}_` prefix)

## References

- Design doc: `artifacts/designs/pending/DD-detail-bands-rendering-overlay.md` (Phase 3: Export Overlay Rendering)
- Parts README: `artifacts/designs/parts/detail-bands-overlay/README.md`
- Contracts: `artifacts/designs/parts/detail-bands-overlay/CONTRACTS.md`
- Sibling parts: A (Core types + engine), B (Grouping layer), C (Stack UI removal), D (Grid overlay), F (Tests)
- DD §Export Rendering: descriptor-driven export, label resolution coordination, match value in section headers, row kind assignment, CSV export behavior
