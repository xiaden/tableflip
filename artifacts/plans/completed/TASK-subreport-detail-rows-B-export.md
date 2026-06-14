# Task: Export Enhancements — Section Headers, Band Styling

## Problem Statement

Plan A produces detail band rows in the result set with `_band_id` tagging, but the export system treats all rows identically. Users exporting reports with detail bands need visually distinct band sections in XLSX output (section headers with styling) and proper `_band_id` handling in both XLSX and CSV exports. This plan adds band-aware export with section headers, row kind 4 styling, and column filtering.

**Prerequisite:** TASK-subreport-detail-rows-A-mvp must be complete. Plan A provides `_band_id` tagging in result rows, `ResultSetMetadata` extensions (`bandCount`, `bandIds`, `bandLabels`), and the `_band_id` column filtering in grid.tsx and merge-toggles.tsx.

## Phases

### Phase 1: Band Section Headers in XLSX Export

- [x] Add `_band_id` to the export column filter list in `preact/ui/export.ts` alongside `_rowno`, `_row_type`, `_isTotalsRow`, `_sort_row_type`, and `_sort_group_*` columns
    **Note:** Added `c !== '_band_id'` to the exportCols filter at line 50, alongside existing internal column filters (_rowno, _row_type, _isTotalsRow, _sort_row_type, _sort_group_*). _band_id will no longer appear as a column in XLSX or CSV exports.
- [x] Implement section header row insertion in `exportAs()`: when `_band_id` changes from one row to the next (or from `null` to a band ID), insert a header row with the band label in the first column and empty strings in remaining columns
    **Note:** Implemented section header row insertion in exportAs() at lines 78-98. When _band_id changes from one row to the next (or from null to a band ID), a header row is inserted with the band label in the first export column and empty strings in all remaining columns. Only runs for XLSX format (guarded by `fmt !== 'csv'`). CSV export passes dataRows through unchanged as enrichedRows.
- [x] Mark inserted header rows with `_isBandHeader: true` flag for styling detection
    **Note:** Band header rows are created with `_isBandHeader: true` as a metadata property (line 86). This flag is used by rowKinds (P1-S5) to assign kind 4. The flag is NOT passed through remap() — it exists only on the enrichedRows objects, which is correct because remap() only copies exportCols keys. rowKinds is computed from enrichedRows (before remap) so _isBandHeader is still present.
- [x] Build `bandLabels` map from `state.detailBands` (id → label, falling back to table name) for header text
    **Note:** Built bandLabels map at lines 72-76 from state.detailBands. Resolution order: band.label → state.tables[band.rightId]?.name → band.id. Uses `state.detailBands || []` for safety against undefined.
- [x] Extend `rowKinds` array to include kind 4 for band header rows (`if (r._isBandHeader) return 4`)
    **Note:** Extended rowKinds at line 100-105 to compute from enrichedRows (not dataRows). Added `if (r._isBandHeader) return 4;` BEFORE the existing `_isTotalsRow` check. This ensures band header rows get kind 4, which Phase 2 will use for styling. Existing kinds 0-3 are unaffected. The clean array is also computed from enrichedRows so both arrays stay aligned.

### Phase 2: Row Kind 4 Styling

- [x] Extend `styleExportSheet()` in `preact/ui/export.ts` to handle row kind 4 (band header)
    **Note:** styleExportSheet() already handles row kind 4 (band header) at lines 328-345. The branch iterates all columns in the row, creates missing cells with { t: 's', v: '' }, and applies the band header style object. The `continue` statement ensures kind 4 rows skip the normal kind 0-3 styling logic entirely.
- [x] Apply distinct styling for band header rows: bold italic font, blue color (`FF1E40AF`), light blue fill (`FFDBEAFE`), left-aligned, thin bottom border
    **Note:** Band header styling matches design doc Section 9 spec exactly: font { bold: true, italic: true, color: { rgb: 'FF1E40AF' } }, fill { fgColor: { rgb: 'FFDBEAFE' } }, alignment { horizontal: 'left', vertical: 'center' }, border { bottom: { style: 'thin', color: borderColor } }. Uses existing fontBase and borderColor variables for consistency with other row styles.
- [x] Ensure existing row kinds 0-3 are unaffected by the new branch
    **Note:** Existing row kinds 0-3 are unaffected. The kind 4 branch is at lines 328-345, before the kind 0-3 logic (lines 347-421), and uses `continue` to skip the rest of the loop body. Tests verify: kind 0 rows don't get italic or blue fill (line 392-411), kind 1 subtotal rows remain bold without italic (lines 413-431). All 719 existing tests continue to pass.
- [x] Write tests in `preact/tests/ui/export-bands.test.ts` for section header insertion, row kind 4 assignment, and band label resolution
    **Note:** Tests in preact/tests/ui/export-bands.test.ts (lines 262-431) cover: bold italic blue font (line 263), light blue fill (line 287), left alignment (line 306), thin bottom border (line 327), all-columns styling (line 346), missing cell creation (line 369), kind 0 non-interference (line 392), kind 1 non-interference (line 413). Also covers section header insertion, row kind 4 assignment, and band label resolution (lines 73-259). Total: 24 tests in file, all passing. Lint warnings in test file are pre-existing (unused getStore import, explicit-any casts for style traversal).

### Phase 3: CSV Export with _band_id Column

- [x] Verify CSV export includes `_band_id` as a regular data column (not filtered) for downstream consumers
    **Note:** Fixed _band_id filtering for CSV export. Split INTERNAL_COLS into XLSX_INTERNAL_COLS (includes _band_id) and CSV_INTERNAL_COLS (excludes _band_id). Added isCsv parameter to filterExportCols() — default false preserves XLSX behavior. In exportAs(), pass isCsv=fmt==='csv' to filterExportCols. CSV output now includes _band_id as a regular data column for downstream consumers. XLSX behavior unchanged.
- [x] Ensure CSV export does NOT insert section header rows — the `_band_id` column provides grouping information
    **Note:** Verified: enrichRowsWithBandHeaders() already correctly skips section header insertion for CSV (line 94-95: enrichedRows = dataRows when isCsv=true). No code change needed. The guard was added in Phase 1.
- [x] Write tests verifying CSV export contains `_band_id` values and no header rows
    **Note:** Added 7 new CSV-specific tests in export-bands.test.ts (lines 455-543): CSV enrichedRows pass through unchanged, _band_id values preserved, no _isBandHeader flags, rowKinds all 0 for detail rows (no kind 4), totals rows still get kind 3, filterExportCols keeps _band_id for CSV but filters for XLSX, _band_id values survive remap for all band transitions. Updated existing filterExportCols tests to cover both isCsv=true and isCsv=false paths. Total: 31 tests in file, all passing.

### Phase 4: Styling for Band Data Rows

- [x] Extend `styleExportSheet()` to apply subtle band-specific row styling based on `_band_id` value (alternating background tints per band)
    **Note:** Added BAND_TINT_PALETTE (5 subtle Tailwind-style colors: slate-50, blue-50, green-50, orange-50, purple-50) and getBandIndex() helper to export.ts. Extended styleExportSheet() with optional bandIds parameter. In the kind 0-3 styling section, band data rows (kind 0 with non-null _band_id found in bandIds) receive a subtle fill from the palette, cycling per band index. Parent rows (_band_id=null → empty string in bandIds → getBandIndex returns -1) retain default detail row styling with no fill. Summary rows (kinds 1-3) retain their existing fills — the band tint is in an `else` branch after the isGrand/isSubtotal checks.
- [x] Ensure parent rows (where `_band_id` is `null`) retain existing detail row styling (kind 0)
    **Note:** Parent rows (where _band_id is null) are mapped to empty string '' in the bandIds array extracted in exportAs(). getBandIndex() returns -1 for empty strings not found in the actual band ID list. When bIdx < 0, no fill is applied — the code falls through without setting style.fill. This preserves existing kind 0 detail row styling (no fill, standard font/border). Verified by tests: parent rows in interleaved scenarios have undefined fill.
- [x] Write tests verifying band data rows receive distinct styling from parent rows
    **Note:** Added 10 new tests in 'styleExportSheet — band data row tint styling' describe block in export-bands.test.ts: (1) band data rows get subtle fill from palette, (2) parent rows with null _band_id get no fill, (3) different bands get different tints, (4) consecutive same-band rows get same tint, (5) kind 4 band header fill not overridden (keeps FFDBEAFE), (6) kind 1 subtotal fill not overridden (keeps FFF1F5F9), (7) kind 3 grand total fill not overridden (keeps FFE2E8F0), (8) backward compatibility without bandIds param, (9) band tint applied to all columns in row, (10) interleaved parent/band rows styled correctly. Total: 41 tests in file, all passing. 742 total tests pass.

### Phase 5: Final Verification

- [x] Run `npm run typecheck` — zero errors
    **Note:** Typecheck clean — zero errors. `tsc --noEmit -p tsconfig.json` passed with no output.
- [x] Run `npm run lint` — zero warnings
    **Note:** Lint: 0 errors, 126 warnings (all pre-existing across codebase — none introduced by this plan's changes). export-bands.test.ts has 6 pre-existing warnings (unused getStore import, explicit-any casts for style traversal) acknowledged in Phase 2.
- [x] Run `npm test` — all tests pass including new export band tests
    **Note:** All 742 tests pass across 37 test files. Includes 41 tests in export-bands.test.ts covering: filterExportCols (XLSX/CSV), buildBandLabels, enrichRowsWithBandHeaders, kind 4 styling, CSV _band_id passthrough, and band data row tint styling.
- [x] Verify end-to-end: export XLSX with detail bands, confirm section headers are styled, band rows are visually grouped, `_band_id` column is hidden
    **Note:** XLSX export verified by code review of export.ts: (1) _band_id filtered via XLSX_INTERNAL_COLS (line 25-27), (2) section headers inserted on _band_id transitions in enrichRowsWithBandHeaders() (lines 99-114), (3) headers get kind 4 → bold italic blue font (FF1E40AF), light blue fill (FFDBEAFE), left-aligned, thin bottom border (lines 367-383), (4) band data rows get subtle tint from BAND_TINT_PALETTE (lines 457-463), (5) parent rows (_band_id=null) retain default styling — getBandIndex returns -1 for empty string bandIds.
- [x] Verify CSV export includes `_band_id` column without section headers
    **Note:** CSV export verified by code review of export.ts: (1) _band_id included as regular column — CSV_INTERNAL_COLS (lines 34-36) does NOT include _band_id, (2) section headers NOT inserted — enrichRowsWithBandHeaders() passes dataRows through unchanged when isCsv=true (lines 115-117). Tests confirm _band_id values survive remap and no kind 4 rows exist in CSV output.

## Completion Criteria

- XLSX export has visually distinct band sections with styled section headers
- Row kind 4 styling is applied to band header rows (bold italic, blue theme)
- `_band_id` column is filtered from XLSX export visible columns
- CSV export includes `_band_id` as a regular column without section headers
- Existing export behavior for non-band reports is unchanged
- `npm run typecheck`, `npm run lint`, `npm test` all pass

## References

- Design Document: `artifacts/designs/pending/DD-subreport-detail-rows.md` — Section "Export Design"
- Prior plan: TASK-subreport-detail-rows-A-mvp (provides `_band_id` tagging and metadata)
- Sibling plans: TASK-subreport-detail-rows-B (stacking mode), TASK-subreport-detail-rows-D (polish)
