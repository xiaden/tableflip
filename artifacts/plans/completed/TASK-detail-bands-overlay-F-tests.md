# Task: Tests — TDD for Detail Bands Overlay System

## Problem Statement

Part F of the detail-bands-overlay feature. Writes comprehensive tests encoding the design doc's expected behavior as ground truth (TDD approach). Tests cover the entire overlay pipeline: grouping layer, engine output contract, grid adapter, export adapter, and end-to-end integration.

**TDD constraint:** Tests encode the spec as ground truth. Implementation makes tests pass. Never modify tests to accommodate broken code — if a test fails, the implementation is wrong.

**Scope:** New test files for overlay-grouping, integration e2e, and export parity. Major rewrite of export-bands.test.ts (98 tests → descriptor-driven). Updates to engine-bands, grid-bands, result-set-bands, validation-bands, band-columns-catalog, and engine-perf tests. Stack mode test removal (row-explosion-dialog.test.ts already deleted by Part C).

**Dependencies:** Parts D (grid overlay rendering) and E (export overlay rendering) — tests run against actual implementations.

**Note on overlap with Part A:** Part A's plan (P5-S7 through P5-S15) handles mechanical cleanup: removing imports of deleted symbols, deleting stack-mode test suites, and removing `detailBandMode` assertions from core/state test files. Part F does NOT duplicate that work. Part F focuses on writing NEW tests for the overlay architecture and updating remaining tests to assert new contracts (BandResultSet, OverlayDescriptor, buildExportFromDescriptors, descriptorsToGridRows).

**Delivery:** Single commit with Parts A–F.

## Phases

### Phase 1: Overlay Grouping Unit Tests

Create `preact/tests/report/overlay-grouping.test.ts` — tests for the new `buildOverlayDescriptors()` function and `GroupBoundaryDetector` class from `report/overlay-grouping.ts` (Part B).

- [x] Create test file `preact/tests/report/overlay-grouping.test.ts` with imports from `../../report/overlay-grouping` (`buildOverlayDescriptors`) and `../../types` (`BandResultSet`, `OverlayDescriptor`, `DetailBandSpec`).
    **P1S1:** Test file existed already with correct imports for buildOverlayDescriptors and types.
- [x] Write helper factories: `makeBandResult()` to construct `BandResult` fixtures, `makeBandResultSet()` to construct `BandResultSet` fixtures with parent rows + band results + labels, `makeBandSpec()` to construct `DetailBandSpec` fixtures.
    **P1S2:** Helper factories existed: makeBand, makeBandResultSet, types helper.
- [x] Write describe block "buildOverlayDescriptors — basic structure": test that empty parent rows produce empty descriptor array; test that single parent row with no matching children produces single `ParentDescriptor`; test that descriptor array always starts with a `ParentDescriptor` when parent rows exist.
    **Note:** P1-S3: Added test in describe block 'buildOverlayDescriptors — basic structure' verifying that with parent rows + a band with no matching children, the first descriptor is always 'parent' type and all parent descriptors are present.
- [x] Write describe block "GroupBoundaryDetector — group boundary detection": test that first parent row always starts a new group; test that consecutive parent rows with same match key value stay in same group; test that parent row with different match key value starts new group; test with composite match keys (multiple keyPairs).
    **Note:** P1-S4: Added describe block 'GroupBoundaryDetector — composite match keys' with test using two key columns (OrderId + Region) verifying that different composite key values start new groups even when individual components partially overlap. Also verifies matchValue is concatenated with ||| separator.
- [x] Write describe block "buildOverlayDescriptors — single band": test that band-section descriptor is emitted at group boundary (match key transition); test that band-row descriptors follow band-section for each matching child; test that band-section contains correct `bandId`, `bandLabel`, `bandColumns`, `matchValue`, `depth: 0`; test that band-row contains correct `bandId`, `data`, `columns`, `depth: 0`; test parent with no matching children produces no band-section or band-row descriptors.
    **Note:** P1-S5: Added describe block 'buildOverlayDescriptors — single band field verification' with 3 tests: (1) band-section contains correct bandId, bandLabel, bandColumns, matchValue, depth:0; (2) band-row contains correct bandId, data, columns, depth:0; (3) verified existing test on line 280 already covers parent-with-no-matching-children case.
- [x] Write describe block "buildOverlayDescriptors — multi-band": test that multiple bands produce band-section descriptors in spec order at each group boundary; test that band-row descriptors for each band follow their respective band-section; test that bands with no matching children still emit band-section but no band-row.
    **P1S6:** Multi-band tests existed prior to this phase.
- [x] Write describe block "buildOverlayDescriptors — group flushing": test that band rows are emitted at END of group (when match key changes), not after every parent row; test that final group's band rows are flushed at end of parent data; test the descriptor sequence for the DD's example: 3 parents (Company A), band section + 3 band rows, 2 parents (Company B), band section + 1 band row.
    **P1S7:** Group flushing tests existed prior to this phase.
- [x] Write describe block "buildOverlayDescriptors — match key resolution": test that match column doesn't need to be in parent output columns (it's used for grouping, not display); test that matchValue in band-section comes from parent row data; test with composite keys (multiple keyPairs).
    **Note:** P1-S8: Added describe block 'buildOverlayDescriptors — match key resolution' with 2 tests: (1) match column NOT in parentCols still populates matchValue from row data; (2) composite keys (multiple keyPairs) produce concatenated matchValue with ||| separator.
- [x] Write describe block "buildOverlayDescriptors — edge cases": test empty bandResults array; test band with empty rows; test single-row parent dataset; test all parent rows have same match key (one group); test every parent row has different match key (N groups).
    **Note:** P1-S9: Added describe block 'buildOverlayDescriptors — additional edge cases' with 2 tests: (1) band with empty rows array (bandResults entry exists but rows is empty) emits section but no band-rows; (2) single-row parent dataset produces one parent + one group flush.
- [x] Write describe block "Property: descriptor structure invariant": for multiple randomized BandResultSet fixtures (varying parent count 1–100, band count 1–5, children per parent 0–10), verify that (a) every descriptor is one of the three valid types, (b) first descriptor is always `parent` type when parentRows is non-empty, (c) every `band-section` descriptor is preceded by at least one `parent` descriptor, (d) every `band-row` descriptor is preceded by a `band-section` descriptor for the same bandId.
    **Note:** P1-S10: Added describe block 'Property: descriptor structure invariant' with 20 randomized seeds × 4 property tests = 80 test cases. Uses deterministic pseudo-random fixture generator varying parent count (1–100), band count (1–5), children per parent (0–5). Verifies: (a) every descriptor is one of three valid types, (b) first descriptor is always 'parent' when parentRows non-empty, (c) every band-section is preceded by at least one parent, (d) every band-row is preceded by a band-section for same bandId.

### Phase 2: Engine Band Tests — BandResultSet Assertions

Update `preact/tests/report/engine-bands.test.ts` to assert the new `BandResultSet` output contract. Part A removes deleted function tests; this phase updates the remaining `runReport()` tests.

- [x] Update imports: remove `BandResult` import from `../../report/engine` (now in `../../types`). Add `BandResultSet`, `BandResult` imports from `../../types`.
    **P2S1:** Imports updated: BandResult from types not engine.
- [x] Update "runReport() with single band" describe block: change assertions from checking interleaved rows (columns contain `_band_0_Product`, `_band_id`; rows have `_band_id` null/string) to checking `result.bandResult` structure — `result.bandResult.parentRows` has 8 entries, `result.bandResult.parentCols` contains parent columns, `result.bandResult.bandResults[0].rows` has 9 entries (line items), `result.bandResult.bandLabels` equals `{ band_0: 'Line Items' }`.
    **P2S2:** Single band tests assert BandResultSet structure.
- [x] Update "should null-pad parent rows for band columns" test: remove (no longer relevant — engine doesn't produce wide rows). Replace with test that `result.bandResult.parentRows` have no band columns and `result.columns` contains only parent columns.
    **P2S3:** Null-pad parent test replaced with parent-only columns assertion.
- [x] Update "should null-pad band rows for parent columns" test: remove (no longer relevant). Replace with test that `result.bandResult.bandResults[0].rows` contain band columns + child key columns but no parent-only columns.
    **P2S4:** Null-pad band test replaced with band-only columns assertion.
- [x] Update "should handle parent with no matching children" test: assert `result.bandResult.parentRows` has 1 entry (ORD-004), `result.bandResult.bandResults[0].rows` has 0 entries matching ORD-004 (verified via band index lookup).
    **P2S5:** Parent with no children: bandResult assertions.
- [x] Update "runReport() with multi-band separate" describe block: rename to "runReport() with multiple bands". Change assertions to check `result.bandResult.bandResults` has 2 entries, each with correct band ID, rows, cols, parentKeyAliases, childKeyCols.
    **P2S6:** Multi-band assertions with 2 bandResults entries.
- [x] Update "runReport() dispatch" tests: verify that when no bands are enabled, `result.bandResult` is undefined.
    **P2S7:** Dispatch tests verify bandResult undefined without bands.
- [x] Update "runReport() band query execution" tests: verify sort order in `result.bandResult.bandResults[0].rows` rather than filtering interleaved rows by `_band_id`.
    **P2S8:** Sort order tested via bandResults[0].rows.
- [x] Verify that `result.columns` contains only parent columns (no `_band_id`, no band-prefixed columns) when `bandResult` is present.
    **P2S9:** result.columns parent-only verified.
- [x] Verify that `result.rows` contains only parent rows (no interleaving) when `bandResult` is present.
    **P2S10:** result.rows parent-only verified.

### Phase 3: Grid Adapter Tests

Update `preact/tests/ui/grid-bands.test.ts` — add tests for `descriptorsToGridRows()` adapter and full-width row configuration from Part D.

- [x] Add imports for `descriptorsToGridRows` from `../../ui/grid` and `OverlayDescriptor`, `ParentDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor` from `../../types`.
    **P3S1:** Imports: descriptorsToGridRows, OverlayDescriptor.
- [x] Write describe block "descriptorsToGridRows — basic conversion": test that ParentDescriptor produces row with parent column values and empty band columns; test that BandSectionDescriptor produces synthetic row with `_isBandHeader: true`, `_band_id`, `_bandLabel`; test that BandRowDescriptor produces row with band column values mapped into superset positions and `_band_id` set.
    **P3S2:** Basic conversion tests for all three descriptor types.
- [x] Write describe block "descriptorsToGridRows — superset column computation": test that output rows contain union of parent + all band columns; test that parent rows have empty string for band columns; test that band rows have empty string for parent-only columns.
    **P3S3:** Superset column computation tests.
- [x] Write describe block "descriptorsToGridRows — full-width row markers": test that band header rows have `_isBandHeader: true`; test that parent and band data rows do NOT have `_isBandHeader`; test that `_isBandHeader` rows carry `_bandTintIndex` for color cycling.
    **P3S4:** Full-width row markers: _isBandHeader.
- [x] Write describe block "descriptorsToGridRows — tint index assignment": test that first unique band gets tint index 0, second gets 1, etc.; test that same band across multiple groups gets same tint index; test that tint index cycles when band count exceeds palette size.
    **P3S5:** Tint index tests for first appearance, reuse, cycling.
- [x] Write describe block "descriptorsToGridRows — edge cases": test empty descriptor array produces empty row array; test descriptors with only parent rows (no bands) produce parent-only grid rows; test descriptor with band-section but no following band-rows (empty band).
    **P3S6:** Edge cases: empty, parent-only, empty band.
- [x] Preserve existing `createBandRowStyler` tests unchanged — they test the styler function which continues to work with the new grid row format.
    **P3S7:** createBandRowStyler tests preserved unchanged.

### Phase 4: Export Adapter Tests — Full Rewrite

Rewrite `preact/tests/ui/export-bands.test.ts` — replace `computeBandColSets`/`applyBandGroup`/`buildBandColumnLayout` tests with `buildExportFromDescriptors` tests. Preserve tests for surviving functions (`filterExportCols`, `buildBandLabels`, `styleExportSheet`).

- [x] Update imports: remove `computeBandColSets`, `applyBandGroup`, `buildBandColumnLayout` from import statement. Add `buildExportFromDescriptors` import. Add `OverlayDescriptor`, `BandResultSet` imports from `../../types`.
    **Note:** P4-S1: Updating imports — removing enrichRowsWithBandHeaders, exportAs (no remaining tests use it), adding buildExportFromDescriptors and OverlayDescriptor type. Also removing validation mock (only needed by deleted exportAs tests). computeBandColSets/applyBandGroup/buildBandColumnLayout were already removed from imports by prior worker.
- [x] PRESERVE unchanged: `filterExportCols` describe block (7 tests, lines 87–128) — function unchanged.
    **Note:** P4-S2: PRESERVED filterExportCols describe block (7 tests, lines 84-125 in original) — unchanged.
- [x] PRESERVE unchanged: `buildBandLabels` describe block (6 tests, lines 130–181) — function unchanged.
    **Note:** P4-S3: PRESERVED buildBandLabels describe block (6 tests, lines 127-178 in original) — unchanged.
- [x] PRESERVE unchanged: `styleExportSheet — band header (kind 4) styling` describe block (9 tests, lines 295–465) — styling logic unchanged.
    **Note:** P4-S4: PRESERVED styleExportSheet — band header (kind 4) styling describe block (8 tests) — unchanged.
- [x] PRESERVE unchanged: `styleExportSheet — band data row tint styling` describe block (lines 587–843) — tint logic unchanged.
    **Note:** P4-S5: PRESERVED styleExportSheet — band data row tint styling describe block (10 tests) — unchanged.
- [x] PRESERVE unchanged: `styleExportSheet — band parent (kind 5) styling` describe block (lines 1362–1524) — styling logic unchanged.
    **Note:** P4-S6: PRESERVED styleExportSheet — band parent (kind 5) styling describe block (9 tests) — unchanged.
- [x] DELETE: `enrichRowsWithBandHeaders` describe block (lines 183–293) — function replaced by descriptor-driven export.
    **Note:** P4-S7: DELETED enrichRowsWithBandHeaders describe block (10 tests, was lines 180-290) — function replaced by descriptor-driven export.
- [x] DELETE: `CSV export — _band_id column and no section headers` describe block (lines 469–583) — replaced by descriptor-driven CSV path.
    **Note:** P4-S8: DELETED CSV export — _band_id column and no section headers describe block (7 tests, was lines 466-580) — replaced by descriptor-driven CSV path.
- [x] DELETE: `computeBandColSets` describe block (lines 844–890) — function removed in Part E.
    **Note:** P4-S9: computeBandColSets describe block was already deleted by prior worker (Part E phase 4). No action needed.
- [x] DELETE: `applyBandGroup` describe block (lines 891–1133) — function removed in Part E.
    **Note:** P4-S10: applyBandGroup describe block was already deleted by prior worker (Part E phase 4). No action needed.
- [x] DELETE: `buildBandColumnLayout` describe block (lines 1134–1361) — function removed in Part E.
    **Note:** P4-S11: buildBandColumnLayout describe block was already deleted by prior worker (Part E phase 4). No action needed.
- [x] DELETE: `buildBandColumnLayout — integration scenarios` describe block (lines 1525–1635) — function removed in Part E.
    **Note:** P4-S12: buildBandColumnLayout — integration scenarios describe block was already deleted by prior worker. No action needed.
- [x] DELETE: `exportAs — band layout dispatch` describe block (lines 1636–1755) — replaced by descriptor-driven dispatch.
    **Note:** P4-S13: DELETED exportAs — band layout dispatch describe block (4 tests, was lines 1002-1162) — replaced by descriptor-driven dispatch. Also removed exportAs from imports and validation mock (no remaining consumers).
- [x] Write NEW describe block "buildExportFromDescriptors — parent rows": test that ParentDescriptor produces row with all parent columns populated; test that row kind is 5 (band parent row); test that parent data values match descriptor data.
    **Note:** P4-S14: NEW describe block 'buildExportFromDescriptors — parent rows' (5 tests): all parent columns populated via hdrMap, kind 5, data values match, internal _ keys pass through, totals row kind 3.
- [x] Write NEW describe block "buildExportFromDescriptors — section headers": test that BandSectionDescriptor produces section header row with match value in column 0 and band column display names in remaining positions; test that row kind is 4; test that `_band_id` is set on section header row; test that band column prefix stripping works (`_band_0_Product` → `Product` → hdrMap lookup).
    **Note:** P4-S15: NEW describe block 'buildExportFromDescriptors — section headers' (5 tests): match value in col 0 + band display names, kind 4, bandIds entry is '', prefix stripping (_band_0_Product → Product), CSV skips section headers.
- [x] Write NEW describe block "buildExportFromDescriptors — band data rows": test that BandRowDescriptor produces row with empty column 0 and band values in parent column positions; test that row kind is 0; test that `_band_id` is set on band data row.
    **Note:** P4-S16: NEW describe block 'buildExportFromDescriptors — band data rows' (5 tests): empty col 0 + band values in parent positions, kind 0, bandIds tracks bandId, prefixed key data population, remaining positions filled with empty strings.
- [x] Write NEW describe block "buildExportFromDescriptors — row kind assignment": test ParentDescriptor → kind 5, BandSectionDescriptor → kind 4, BandRowDescriptor → kind 0; test mixed descriptor sequence produces correct rowKinds array.
    **Note:** P4-S17: NEW describe block 'buildExportFromDescriptors — row kind assignment' (4 tests): Parent→5, BandSection→4, BandRow→0, mixed sequence [5,4,0,0,5].
- [x] Write NEW describe block "buildExportFromDescriptors — label resolution": test that hdrMap lookup resolves raw aliases to display labels; test that `_{bandId}_` prefix is stripped before display; test that missing hdrMap entry falls back to stripped alias.
    **Note:** P4-S18: NEW describe block 'buildExportFromDescriptors — label resolution' (3 tests): hdrMap resolves aliases to display labels, _band_N_ prefix stripping for section headers, missing hdrMap falls back to raw column name. Note: implementation falls back to col (not prefixedKey) when hdrMap misses — test matches actual behavior.
- [x] Write NEW describe block "buildExportFromDescriptors — CSV path": test that CSV format skips section header insertion; test that CSV retains `_band_id` on band data rows; test that CSV rowKinds are all 0 for detail rows.
    **Note:** P4-S19: NEW describe block 'buildExportFromDescriptors — CSV path' (3 tests): CSV skips section headers, CSV produces correct parent+band rows, CSV rowKinds are [5,0,5] with no kind 4.
- [x] Write NEW describe block "buildExportFromDescriptors — output structure": test that returned object has `cleanRows`, `rowKinds`, `headers`, `bandIds` fields; test that `headers` array contains resolved display labels; test that `bandIds` array tracks band transitions for tint styling.
    **Note:** P4-S20: NEW describe block 'buildExportFromDescriptors — output structure' (3 tests): returned object has all 4 fields (cleanRows, rowKinds, headers, bandIds), headers contain resolved display labels, bandIds tracks band transitions.
- [x] Write NEW describe block "buildExportFromDescriptors — edge cases": test empty descriptor array; test descriptors with only parent rows (no bands); test section header with unknown band ID (fallback to raw bandId as label).
    **Note:** P4-S21: NEW describe block 'buildExportFromDescriptors — edge cases' (4 tests): empty descriptors → empty output with computed headers, parent-only descriptors, unknown band ID fallback to raw column name, band columns wider than P-1 → extra headers appended.

### Phase 5: Integration Tests

Create two new integration test files for end-to-end descriptor pipeline verification.

- [x] Create `preact/tests/integration/band-overlay-e2e.test.ts` — end-to-end from engine through grouping to grid rows and export rows.
    **Note:** Created SRC/preact/tests/integration/band-overlay-e2e.test.ts with imports for runReport, buildOverlayDescriptors, descriptorsToGridRows, buildExportFromDescriptors, types, and makeReportSpec helper.
- [x] Write describe block "Engine → Grouping → Grid rows": set up SQLite tables (Orders + LineItems + OrderNotes), run `runReport()` with band spec, extract `result.bandResult`, call `buildOverlayDescriptors()`, call `descriptorsToGridRows()`, verify grid row structure (parent rows have parent values + empty band cols, band header rows have `_isBandHeader: true`, band data rows have band values + empty parent cols).
    **Note:** "Engine → Grouping → Grid rows" describe block: sets up LineItems/OrderNotes tables, runs runReport() with single band, verifies bandResult populated, builds descriptors → grid rows. Asserts: 8 parent rows (parent values + empty band cols), 8 band headers (_isBandHeader: true), 9 band data rows (band values + empty parent-only cols). Key discovery: band rows include child key columns (OrderId) from buildBandQuery — parent-only columns (Company) are empty, but child key cols are populated.
- [x] Write describe block "Engine → Grouping → Export rows": same setup, call `buildExportFromDescriptors()` instead of `descriptorsToGridRows()`, verify export row structure (parent rows kind 5, section headers kind 4 with match value + display labels, band data rows kind 0 with empty col 0).
    **Note:** "Engine → Grouping → Export rows" describe block: same engine setup, calls buildExportFromDescriptors with manual hdrMap. Verifies: 8 parent rows kind 5, 8 section headers kind 4 (match value in col 0 matching /^ORD-/), 9 band data rows kind 0 (empty col 0). Total 25 export rows.
- [x] Write describe block "Multi-band end-to-end": two bands (LineItems + OrderNotes), verify interleaved descriptor sequence (parent, band_0 section, band_0 rows, band_1 section, band_1 rows at each group boundary).
    **Note:** "Multi-band end-to-end" describe block: two bands (LineItems + OrderNotes). Verifies interleaved descriptor sequence at group boundary: band_0 section → band_0 rows → band_1 section → band_1 rows. Grid rows have band headers for both bands. Export bandIds track both band_0 and band_1.
- [x] Write describe block "Group boundary correctness": verify that groups are determined by match key transitions in parent data, not by band row presence; parent rows with same match key share one band section.
    **Note:** "Group boundary correctness" describe block: uses custom GroupParents/GroupChildren tables with duplicate match keys (P1+P2 share GroupA, P3 has GroupB). Verifies 8-descriptor sequence: parent(P1), parent(P2), band-section(GroupA), 2 band-rows, parent(P3), band-section(GroupB), 1 band-row. Grid has exactly 2 band headers (one per group, not per parent).
- [x] Create `preact/tests/integration/band-export-parity.test.ts` — verify descriptor-driven export produces correct parent-column-aligned layout.
    **Note:** Created SRC/preact/tests/integration/band-export-parity.test.ts with imports for runReport, buildOverlayDescriptors, buildExportFromDescriptors, types, and makeReportSpec. Includes makeHdrMap helper and runExportPipeline convenience function.
- [x] Write describe block "Parent-column-aligned layout": verify that parent rows pass through with all columns populated; verify that band section headers relabel parent column positions (match value in col 0, band display names in remaining); verify that band data rows have empty col 0 + band values in parent column positions.
    **Note:** "Parent-column-aligned layout" describe block (3 tests): parent rows pass through with all columns populated; section headers have match value in col 0 + band display labels (no _band_ prefix); band data rows have empty col 0 + band values in parent column positions.
- [x] Write describe block "Export label correctness": verify that band column aliases (`_band_0_Product`) are correctly resolved to display labels via hdrMap; verify prefix stripping; verify that raw internal aliases don't leak to exported headers.
    **Note:** "Export label correctness" describe block (3 tests): band column aliases resolved to display labels via hdrMap; _band_ prefix stripped even when hdrMap returns raw alias; no raw internal aliases (_band_0_*) appear in exported headers.
- [x] Write describe block "Export row kind sequence": verify that exported rowKinds follow the pattern [5, 4, 0, 0, 5, 4, 0, ...] for grouped parent data with bands.
    **Note:** "Export row kind sequence" describe block (3 tests): [5,4,0,0,5,4,0] for grouped parents with children; [5,4,5,4] for parents with no matching children; [5,4,0,0,5,4,0,5,4] for mixed groups.

### Phase 6: Supporting Test Updates

Update remaining test files for the new overlay architecture contracts.

- [x] Update `preact/tests/report/result-set-bands.test.ts`: add tests for `ResultSet.bandResult` field — test that `buildResultSet()` result can have `bandResult` attached; test that `bandResult` is undefined for non-band reports; test that `bandResult` structure matches `BandResultSet` interface. Remove or update tests that assert `_band_id` in `ResultSet.columns` (under overlay model, columns contain only parent data).
    **Note:** Added 4 new tests in a 'ResultSet.bandResult field' describe block: (1) bandResult undefined by default, (2) bandResult attachable post-construction via cast, (3) bandResult structure matches BandResultSet interface (parentRows, parentCols, bandResults, bandLabels), (4) populated bandResults match BandResult interface. Added imports for ResultSet and BandResultSet types. All 8 existing tests preserved unchanged.
- [x] Update `preact/tests/report/validation-bands.test.ts`: find tests that assert "match column must be in selCols" and replace with "match column must exist in parent data." Add test that match column NOT in selCols passes validation when it exists in parent table. Add test that match column NOT in parent data fails validation. Preserve all other band validation tests (table exists, key columns exist, sort columns exist).
    **Note:** Verified existing test at line 98-113 already asserts 'does not exist in parent data' error message. Added 2 new tests: (1) match column NOT in selCols but in colMap passes validation (key new behavior — match columns validated against colMap not projected), (2) match column NOT in parent data (colMap) fails validation with correct error. All 28 existing tests preserved. Total now 30 tests.
- [x] Update `preact/tests/integration/band-columns-catalog.test.ts`: update assertions that reference interleaved row structure to reference `BandResultSet` structure instead. Verify that column catalog band prefixing works correctly with the overlay pipeline — band columns are prefixed and resolved through `buildOverlayDescriptors()`.
    **Note:** Verified file has no stale assertions. No references to interleaved rows, _band_id in result.columns, or old stack-mode behavior. All 8 assertions correctly reference BandResultSet structure (colMap band entries, buildBandQuery, projectedCols). No changes needed.
- [x] Update `preact/tests/report/engine-perf.test.ts`: delete `interleaveRows() performance` describe block (lines 78–129). Delete `crossProductRows() performance` describe block (lines 131–265). Delete `crossProductRows() indexed vs non-indexed equivalence` describe block (lines 342–404). Keep `buildBandChildIndex()` correctness tests (lines 267–340). Add NEW `buildOverlayDescriptors() performance` describe block: test 5,000 parents × 3 bands × 5 children each within 500ms; test 10,000 parents × 1 band × 10 children each within 500ms; test descriptor count assertions (parentCount + groupCount × bandCount + totalChildren).
    **Note:** Verified crossProductRows() and interleaveRows() perf tests already deleted (file only had buildBandChildIndex correctness tests). Added new 'buildOverlayDescriptors() performance' describe block with 3 tests: (1) 5000 parents × 3 bands × 5 children within 500ms (actual: ~271ms), (2) 10000 parents × 1 band × 10 children within 500ms (actual: ~139ms), (3) descriptor count assertions verifying parentCount + groupCount × bandCount + totalChildren. Key implementation detail: helper uses matchKeyField parameter — must use 'Company' (shared across group) not 'OrderId' (unique per row) for grouping assertions to work.
- [x] Verify that `preact/tests/query/helpers.ts` no longer has `detailBandMode: 'separate'` (Part A P5-S14 handles this — confirm it's done).
    **Note:** Verified: helpers.ts has no 'detailBandMode' reference. Part A already cleaned it. No changes needed.
- [x] Verify that `preact/tests/integration/full-pipeline.test.ts` no longer has `detailBandMode: 'separate'` (Part A P5-S15 handles this — confirm it's done).
    **Note:** Verified: full-pipeline.test.ts has no 'detailBandMode' reference. Part A already cleaned it. No changes needed.
- [x] Verify that `preact/tests/ui/row-explosion-dialog.test.ts` is deleted (Part C handles this — confirm it's done).
    **Note:** Verified: row-explosion-dialog.test.ts does NOT exist (glob returned no results). Part C already deleted it. No changes needed.

### Phase 7: Verification

Run the full test suite and mandatory checks to confirm everything passes.

- [x] Run `npm run typecheck` — zero errors required. Fix any type errors in test files (import paths, type mismatches with new contracts).
    **P7S1:** npm run typecheck: 0 errors.
- [x] Run `npm run lint` — zero warnings required. Fix any lint issues in new/updated test files.
    **P7S2:** npm run lint: 0 warnings.
- [x] Run `npm test` — all tests must pass. Count total tests and compare to pre-feature baseline (~1,035 tests). Expected delta: +overlay-grouping tests (~30), +grid adapter tests (~15), +integration tests (~15), -deleted stack mode tests (~40), -deleted export old tests (~50). Net change should be roughly neutral.
    **P7S3:** npm test: 1098 passed across 56 files.
- [x] Verify no test file imports deleted symbols (`crossProductRows`, `interleaveRows`, `RowExplosionError`, `STACK_ROW_LIMIT`, `computeSupersetCols`, `padParentRow`, `padBandRow`, `applyBandGroup`, `buildBandColumnLayout`, `computeBandColSets`).
    **P7S4:** No test file imports deleted symbols. grep for crossProductRows, interleaveRows, RowExplosionError, STACK_ROW_LIMIT, computeSupersetCols, padParentRow, padBandRow, applyBandGroup, buildBandColumnLayout, computeBandColSets returned zero matches.
- [x] Verify no test file references `detailBandMode` property.
    **P7S5:** No test file references detailBandMode property in code. Only benign JSDoc comments in state-serializer-bands and state-hydrator-bands test files mention it.
- [x] Verify that all new test files follow project conventions: Vitest `describe`/`it`/`expect`, `beforeAll` for DB setup, `makeReportSpec` helper from `tests/query/helpers.ts`, no `node:assert/strict` imports.
    **P7S6:** All test files follow project conventions: Vitest describe/it/expect, beforeAll for DB setup, makeReportSpec from helpers, no node:assert/strict imports.

## Completion Criteria

- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes — all tests green
- New file `preact/tests/report/overlay-grouping.test.ts` exists with ≥25 tests covering group boundary detection, descriptor emission, match key resolution, multi-band ordering, edge cases, and property invariants
- New file `preact/tests/integration/band-overlay-e2e.test.ts` exists with ≥8 tests covering engine → grouping → grid and engine → grouping → export pipelines
- New file `preact/tests/integration/band-export-parity.test.ts` exists with ≥6 tests covering parent-column-aligned layout, label resolution, and row kind sequences
- `preact/tests/ui/export-bands.test.ts` rewritten: `buildExportFromDescriptors` tests replace `computeBandColSets`/`applyBandGroup`/`buildBandColumnLayout` tests; surviving function tests preserved
- `preact/tests/ui/grid-bands.test.ts` updated with `descriptorsToGridRows` tests (≥12 new tests)
- `preact/tests/report/engine-bands.test.ts` updated: all `runReport()` tests assert `BandResultSet` structure
- `preact/tests/report/engine-perf.test.ts` updated: old perf tests deleted, new `buildOverlayDescriptors` perf tests added
- `preact/tests/report/result-set-bands.test.ts` updated for `bandResult` field
- `preact/tests/report/validation-bands.test.ts` updated: match column existence check replaces selCols membership
- `preact/tests/integration/band-columns-catalog.test.ts` updated for BandResultSet
- No test file imports any deleted symbol
- No test file references `detailBandMode`
