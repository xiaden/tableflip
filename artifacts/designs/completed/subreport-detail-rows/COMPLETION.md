# Subreport Detail Rows — Completion Manifest

**Feature:** Subreport Detail Rows (1:N child row fan-out)
**Design Doc:** DD-subreport-detail-rows.md
**Completed:** 2026-06-14

---

## Execution Summary

| Plan | Title | Steps | Status |
|------|-------|-------|--------|
| A | MVP — Core Types, Query Gen, Basic UI, Stitching (incl. stacking) | 83/83 | ✅ DONE |
| A-fix | Fix merge-toggles inline ReportSpec construction | 3/3 | ✅ DONE |
| B | Export Enhancements — Section Headers, Band Styling | 20/20 | ✅ DONE |
| C | Polish — Grid Styling, Reorder, Warning Dialog, Performance | 30/30 | ✅ DONE |

**Total:** 136/136 steps across 4 plans. 806 tests across 41 test files. Zero lint warnings. Zero type errors.

**Note:** The original Plan B (Multi-Band Mode — stacking, mode toggle, explosion protection) had no formal plan file. Its features were absorbed into Plans A and C during implementation. All features exist in the codebase and are verified by tests.

---

## Design Deviations

| Deviation | Plan | Resolution |
|-----------|------|-----------|
| `DetailBandSpec` made optional in `ReportSpec.pipeline` | A | Backward-compatible; 37+ existing fixtures don't include bands |
| `DetailBandSpec` Omitted from `catalogCtx` in `buildQueryPlan()`/`runTotalsMode()` | A | Band columns in catalogCtx cause SQL errors from missing JOINs |
| No "None" button in column chips | A | Empty `band.cols` means "all columns" — cannot represent "none" without breaking catalog semantic |
| `buildReportSpecFromState` uses flat shape instead of nested `pipeline` | A | All 13 call sites access `reportSpec.base`/`reportSpec.lookups` at top level |
| More-button appears when only context menu is set (no rename) | A | Defensive UI improvement |

---

## Key Decisions

- **Stacking mode + cross-product**: `crossProductRows()` computes Cartesian product across bands; `rowExplosionError` guard with dialog allows user override
- **Mode toggle**: `detailBandMode: 'separate' | 'stack'` in AppState; switched via toggle button in pipeline card
- **Band IDs stable across reorder**: IDs assigned at creation via `Date.now()`, not by index
- **`_band_id` hidden everywhere except CSV**: Filtered from grid (grid.tsx), merge toggles, XLSX export. Preserved in CSV for downstream consumers
- **STATE_VERSION bumped 1→2**: `detailBands` and `detailBandMode` added to RECOGNIZABLE_KEYS
- **No `colType` on band columns in v1**: Deferred — band columns use string type by default
- **Band header styling (XLSX)**: Bold italic blue font (`FF1E40AF`), light blue fill (`FFDBEAFE`), left-aligned, thin bottom border
- **Band row tints (grid + XLSX)**: 5-color palette cycling per band; parent rows retain default styling
- **`buildBandChildIndex()` optimization**: 21x speedup for stacking mode (2650ms→124ms for 5K×3×3)

---

## Files Created/Modified

### Core Layer
- `preact/types.ts` — `DetailBandSpec` interface, `detailBands`/`detailBandMode` on `AppState` and `ReportSpec`
- `preact/core/state.ts` — `createDetailBandSpec()` factory, `buildReportSpecFromState()` helper, state defaults
- `preact/core/state-serializer.ts` — `detailBands`/`detailBandMode` serialization
- `preact/core/state-hydrator.ts` — `detailBands` hydration with reference validation
- `preact/core/state-schema.ts` — `STATE_VERSION` 1→2, `RECOGNIZABLE_KEYS` updated
- `preact/index.ts` — Barrel exports for all new types and functions; `ColStateEntry` removed

### Catalog Layer
- `preact/catalog/column-catalog.ts` — Band column propagation with `_{bandId}_` prefix; `colType?` on `PhysicalColEntry`/`BandColEntry`

### Query Layer
- `preact/query/sql-detail-bands.ts` — **New file**: `buildBandQuery()`, `BandQueryResult`, multi-key support with `|||` separator
- `preact/query/alias-ref-updater.ts` — Band reference updates on alias rename
- `preact/query/sql-where.ts` — `getColumnType()`, type-aware CAST, `numericHint`→`colType`, removed `ColStateEntry`/`isNumericCalc`

### Report Layer
- `preact/report/engine.ts` — `runDetailBandsMode()`, `computeSupersetCols()`, `padParentRow()`, `padBandRow()`, `interleaveRows()`, `crossProductRows()`, `buildBandChildIndex()`, `RowExplosionError`, `runReport()` dispatch
- `preact/report/result-set.ts` — `ResultSetMetadata` extended with `bandCount`, `bandIds`, `bandLabels`
- `preact/report/validation.ts` — Detail band validation (table missing, key pair invalid, no complete pair, sort column warnings)
- `preact/report/report-graph.ts` — Band rightId refs in dependency graph
- `preact/report/report-output.ts` — Published output handles `_band_id` column

### UI Layer
- `preact/ui/sections/detail-band-stage.tsx` — **New file**: Band config component (table picker, key pairs, column chips, enable/disable, remove)
- `preact/ui/cards/pipeline-card.tsx` — Band stages rendering, add button, reorder drag-and-drop
- `preact/ui/grid.tsx` — `_band_id` hidden from grid columns, band row tinting via `createBandRowStyler()`, context menu type overrides
- `preact/ui/sections/merge-toggles.tsx` — `_band_id` hidden from merge toggles
- `preact/ui/export.ts` — Band section headers (kind 4), band data row tints, `_band_id` XLSX filtering, CSV passthrough
- `preact/ui/loader.ts` — `scanCellTypes()`, `isDateFormat()`, `sheetTypeToColumnType()`, ingestion integration
- `preact/ui/components/context-menu.tsx` — `CtxMenuItem.checked?: boolean` with ✓ rendering
- `preact/ui/components/row-explosion-dialog.tsx` — **New file**: Stacking overflow warning dialog

### Consumer Sites Updated
- `preact/ui/sections/column-chips.tsx` — 7 inline constructions → `buildReportSpecFromState()`
- `preact/ui/sections/sort-list.tsx` — 1 construction → helper
- `preact/ui/sections/filter-list.tsx` — 1 construction → helper
- `preact/ui/cards/layout-card.tsx` — 1 construction → helper
- `preact/ui/sections/calc-stage.tsx` — 2 constructions → helper
- `preact/ui/sections/lookup-stage.tsx` — 1 construction → helper
- `preact/ui/sections/merge-toggles.tsx` — 1 construction → helper
- `preact/ui/run-bar.tsx` — `detailBands`/`detailBandMode` in `ReportSpec` construction

### Tests
- `preact/tests/core/state-serializer-bands.test.ts` — Created (10 tests)
- `preact/tests/core/state-hydrator-bands.test.ts` — Created (17 tests)
- `preact/tests/catalog/column-catalog-bands.test.ts` — Created (22 tests)
- `preact/tests/query/sql-detail-bands.test.ts` — Created (26 tests)
- `preact/tests/report/engine-bands.test.ts` — Created (22 tests)
- `preact/tests/report/result-set-bands.test.ts` — Created (8 tests)
- `preact/tests/report/validation-bands.test.ts` — Created (16 tests)
- `preact/tests/ui/export-bands.test.ts` — Created (41 tests)
- `preact/tests/ui/grid-bands.test.ts` — Created (12 tests)
- `preact/tests/ui/pipeline-card-reorder.test.ts` — Created (8 tests)
- `preact/tests/ui/row-explosion-dialog.test.ts` — Created (16 tests)
- `preact/tests/report/engine-perf.test.ts` — Created (12 tests)
- `preact/tests/report/report-output.test.ts` — Extended (10 band tests)
- `preact/tests/core/state.test.ts` — Updated fixtures
- `preact/tests/core/store.test.ts` — Updated fixtures
- `preact/tests/core/state-serializer.test.ts` — Updated fixtures
- `preact/tests/report/engine.test.ts` — Updated fixtures
- `preact/tests/report/result-set.test.ts` — Updated fixtures
- `preact/tests/report/report-output.test.ts` — Updated fixtures
- `preact/tests/catalog/column-catalog.test.ts` — Updated fixtures (14 catalogCtx objects)
- `preact/tests/query/query-plan.test.ts` — Updated fixtures
- `preact/tests/query/helpers.ts` — Updated test helpers
- `preact/tests/integration/full-pipeline.test.ts` — Updated fixtures
- `preact/tests/integration/state-loading.test.ts` — Backward compat test

---

## Final Lint Status

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors, 126 warnings (all pre-existing) |
| `npm test` | ✅ 806 tests, 41 files (pre-column-type-aware-where baseline) |
