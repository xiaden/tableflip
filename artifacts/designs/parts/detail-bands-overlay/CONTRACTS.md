# Detail Bands Rendering Overlay — Contracts Ledger

**Design doc:** `artifacts/designs/pending/DD-detail-bands-rendering-overlay.md`
**Last updated:** 2026-06-15 (Plan E)

---

## Architectural Rules

- Three-layer separation: Data (engine) → Grouping (overlay-grouping) → Rendering (grid + export)
- Bands are rendering overlays, not data — no interleaving in engine
- Group boundaries determined by match key transitions, not `_band_id`
- Match columns used for grouping detection, not display — don't need to be in `selCols`
- One band section per group boundary (emitted at end of group, not per parent row)
- `OverlayDescriptor` is the single source of truth for rendered output structure
- Grid and export share the same grouping layer — consistency by construction
- Stack mode removed entirely — not hidden, not disabled, deleted
- TDD: tests encoding spec behavior written first, implementation makes them pass
- Single commit delivery — phases are structural only
- No upward imports: Report reads Core, UI reads Report + Core
- `_band_id` is an implementation detail of band result sets, not parent data
- Null-padding is a rendering concern — applied at grid/export boundary, not in engine
- `_isBandHeader` is a synthetic row marker for AG Grid full-width detection, filtered from column definitions

---

## Collections & Methods

### types.ts (Core)

**Moved:**
- `BandResult` — moved from `engine.ts` to `types.ts` (references only `DetailBandSpec`, no circular dependency)

**Created:**
- `BandResultSet` — structured engine output: `parentRows`, `parentCols`, `bandResults: BandResult[]`, `bandLabels`
- `OverlayDescriptor` — union type: `ParentDescriptor | BandSectionDescriptor | BandRowDescriptor`
- `ParentDescriptor` — `{ type: 'parent', data, columns }`
- `BandSectionDescriptor` — `{ type: 'band-section', bandId, bandLabel, bandColumns, matchValue, depth }`
- `BandRowDescriptor` — `{ type: 'band-row', bandId, data, columns, depth }`

**Removed:**
- `detailBandMode` field from `AppState` interface
- `detailBandMode` field from `ReportSpec` interface

### result-set.ts (Report)

**Modified:**
- `ResultSet` interface — added optional `bandResult?: BandResultSet` field

### engine.ts (Report)

**Modified:**
- `runDetailBandsMode(plan, reportSpec, tables): ResultSet` — removed `stackRowLimit` parameter; returns `ResultSet` with `bandResult` populated, `columns`/`rows` contain only parent data (no interleaving)
- `runReport(reportSpec, tables): ResultSet` — removed `stackRowLimit` parameter

**Kept (reused by Part B):**
- `BandChildIndex` type
- `buildBandChildIndex(bandResults: BandResult[]): BandChildIndex`
- `makeKeyValue(row, keyCols): string` (internal helper)

**Deleted:**
- `STACK_ROW_LIMIT` constant
- `RowExplosionError` class
- `computeSupersetCols()` function
- `padParentRow()` function
- `padBandRow()` function
- `interleaveRows()` function
- `crossProductRows()` function

### core/state.ts

**Modified:**
- `createAppState()` — removed `detailBandMode: 'separate'` from defaults
- `createReportSpec()` — removed `detailBandMode: 'separate'` from defaults

### core/state-schema.ts

**Modified:**
- `RECOGNIZABLE_KEYS` — removed `'detailBandMode'` from array

### core/state-serializer.ts

**Modified:**
- `buildPayload()` — removed `detailBandMode: state.detailBandMode || 'separate'` from payload

### core/state-hydrator.ts

**Modified:**
- `hydrateState()` — removed `next.detailBandMode = ...` assignment

### index.ts

**Removed exports:**
- `RowExplosionError`, `STACK_ROW_LIMIT` (from engine)
- `RowExplosionDialog`, `RowExplosionDialogProps` (from UI)

**Added exports:**
- `BandResult`, `BandResultSet`, `OverlayDescriptor`, `ParentDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor` (from types)

### engine.ts (Report) — Part B amendment

**Modified:**
- `makeKeyValue(row, keyCols): string` — changed from private to exported; reused by `GroupBoundaryDetector` in overlay-grouping.ts for match key computation

### overlay-grouping.ts (Report — NEW in Part B)

**Created:**
- `GroupBoundaryDetector` class — tracks match key transitions across parent rows; constructor takes `keyAliases: string[]`; methods: `isNewGroup(parentRow): boolean`, `getCurrentMatchValue(parentRow): unknown`
- `buildOverlayDescriptors(bandResult: BandResultSet, detailBands: DetailBandSpec[]): OverlayDescriptor[]` — pure function; walks parent rows, detects group boundaries via `GroupBoundaryDetector`, emits `OverlayDescriptor[]` (parent, band-section, band-row); uses `buildBandChildIndex()` from engine.ts for O(1) child lookup

**Added exports:**
- `buildOverlayDescriptors` (from overlay-grouping.ts)

### validation.ts (Report) — Modified in Part B

**Modified:**
- `deriveValidation()` — detail band key pair left check changed from `!projected.has(p.left)` to `!colMap.has(p.left)`; error message changed from "is not available" to "does not exist in parent data"; issue ID unchanged (`detailband_${i}_kp${pi}_left`)

### report-output.ts (Report) — Modified in Part B

**Modified:**
- `PublishedOutput` interface — added optional `bandResult?: BandResultSet` field
- `createResultTable()` — removed `_band_id` column-injection logic (no more `hasBandIdInData` check); returns `{ columns, rows }` without `_band_id` append
- `publishReportOutput()` — passes through `bandResult` from `ResultSet` to `PublishedOutput`

### preview-builder.ts (Report) — Modified in Part B

**Modified:**
- `buildPreviewReportSpec()` — removed `detailBandMode: 'separate'` from returned `ReportSpec` object (field removed from type by Part A)

### grid.tsx (UI)

**Created:**
- `descriptorsToGridRows(descriptors, parentCols, bandColSets): Record<string, unknown>[]` — converts `OverlayDescriptor[]` into flat AG Grid-compatible rows with null-padding at the grid boundary
- `BandHeaderRenderer` class — AG Grid `fullWidthCellRenderer` for band section headers (implements `init`, `getGui`, `refresh`, `destroy`)

**Modified:**
- `createBandRowStyler(rows)` — added guard to return `undefined` for `_isBandHeader` rows (defensive)
- `makeResultCols(cols, ...)` — added `_isBandHeader` to the synthetic column filter list
- `ResultGrid` component — detects `bandResult` on result object, branches to overlay path when present

### run-bar.tsx (UI)

**Modified:**
- Result object construction — added `bandResult: resultSet.bandResult` pass-through to make band data available to `ResultGrid`

### globals.d.ts (Types)

**Modified:**
- `agGrid.createGrid` declaration — added JSDoc documenting full-width row options (`isFullWidthRow`, `fullWidthCellRenderer`, `embedFullWidthRows`)

### export.ts (UI)

**Created:**
- `buildExportFromDescriptors(descriptors, parentCols, hdrMap, isCsv?): { cleanRows, rowKinds, headers, bandIds }` — consumes `OverlayDescriptor[]` from grouping layer, produces parent-column-aligned export layout. Replaces `computeBandColSets()` + `buildBandColumnLayout()` + `applyBandGroup()`.

**Modified:**
- `exportAs(fmt)` band dispatch — changed activation condition from `enabledBands.length > 0` to `bandResult != null`; calls `buildOverlayDescriptors()` then `buildExportFromDescriptors()` instead of `buildBandColumnLayout()`

**Deleted:**
- `computeBandColSets()` function — band column info now comes from `BandSectionDescriptor.bandColumns`
- `applyBandGroup()` function — descriptor iteration replaces row-walking
- `buildBandColumnLayout()` function — replaced by `buildExportFromDescriptors()`

---

## API Contracts

_(empty — this feature has no API contracts)_

---

## DTOs Created

### Plan A

| DTO | File | Fields |
| --- | --- | --- |
| `BandResultSet` | `types.ts` | `parentRows: Record<string, unknown>[]`, `parentCols: string[]`, `bandResults: BandResult[]`, `bandLabels: Record<string, string>` |
| `ParentDescriptor` | `types.ts` | `type: 'parent'`, `data: Record<string, unknown>`, `columns: string[]` |
| `BandSectionDescriptor` | `types.ts` | `type: 'band-section'`, `bandId: string`, `bandLabel: string`, `bandColumns: string[]`, `matchValue: unknown`, `depth: number` |
| `BandRowDescriptor` | `types.ts` | `type: 'band-row'`, `bandId: string`, `data: Record<string, unknown>`, `columns: string[]`, `depth: number` |
| `OverlayDescriptor` | `types.ts` | Union: `ParentDescriptor \| BandSectionDescriptor \| BandRowDescriptor` |

### DTOs Modified

| DTO | File | Change |
| --- | --- | --- |
| `ResultSet` | `result-set.ts` | Added optional `bandResult?: BandResultSet` |
| `AppState` | `types.ts` | Removed `detailBandMode` field |
| `ReportSpec` | `types.ts` | Removed `detailBandMode` field |
| `BandResult` | `types.ts` (moved from `engine.ts`) | No field changes — relocated for architectural correctness |

### Plan D

| DTO | File | Fields |
| --- | --- | --- |
| Grid row (parent) | `grid.tsx` (produced by `descriptorsToGridRows`) | All `parentCols` populated, band columns `''`, no synthetic fields |
| Grid row (band-section) | `grid.tsx` (produced by `descriptorsToGridRows`) | `_isBandHeader: true`, `_band_id: string`, `_bandLabel: string`, `_bandTintIndex: number`, all data cols `''` |
| Grid row (band-row) | `grid.tsx` (produced by `descriptorsToGridRows`) | Band `data` spread, parent cols `''`, `_band_id: string` |

---

## Decisions Made

| Decision | Rationale | Plan |
| --- | --- | --- |
| Hybrid overlay descriptors (Option C) | Shared grouping layer ensures grid/export consistency; descriptor is declarative intermediate representation | — |
| Stack mode removed entirely | Cartesian cross-products conflict with group-based rendering; one band section per group boundary | — |
| AG Grid full-width rows for section headers | Only Community-available alternative row rendering; master/detail is Enterprise-only | — |
| Null-padding at grid boundary only | Rendering concern, not data concern; engine produces clean data | — |
| Match column free from selCols | Used for grouping detection, not display; always exists in parent data | — |
| TDD approach | Tests encode spec as ground truth; implementation makes tests pass; never "fix tests to match code" | — |
| Single commit delivery | DD is one PR; phases are organizational structure, not staggered deployment | — |
| `BandResult` moved to types.ts | `BandResultSet` (in Core types.ts) references `BandResult[]`; keeping `BandResult` in Report layer engine.ts would create upward import violation | A |
| `run-bar.tsx` import cleanup in Part A | Removing `RowExplosionError` export from engine.ts breaks run-bar.tsx import; fixed in Part A to maintain typecheck, even though full UI cleanup is Part C scope | A |
| Post-assignment for `bandResult` on ResultSet | `buildResultSet()` signature unchanged; engine sets `resultSet.bandResult` after construction — simpler than adding new parameter | A |
| `makeKeyValue` exported from engine.ts for Part B reuse | Was private; `GroupBoundaryDetector` needs same key format as `buildBandChildIndex` — exporting avoids duplication and ensures consistency | B |
| Validation uses `colMap.has()` not `projected.has()` for match columns | `colMap` contains all resolvable parent columns (base + lookup + calc); `projected` only contains user-selected output columns. Match columns need to exist in data, not in output | B |
| `PublishedOutput.bandResult` is optional pass-through | Downstream consumers check `bandResult != null` to determine overlay path; non-band reports have `bandResult === undefined` and are unaffected | B |
| `bandResult` pass-through via result object in run-bar.tsx | `ResultGrid` receives `result` prop; adding `bandResult` to the result object is the minimal change to make band data available without reading from store separately | D |
| `detailBands` read from store in ResultGrid | `ResultGrid` already imports `getStore()`; reading `detailBands` from store avoids adding a new prop to `ResultGridProps` | D |
| Superset columns computed from bandResult in ResultGrid | Column list for `makeResultCols()` derived from `bandResult.parentCols + bandResults.flatMap(br => br.cols)` — no need for `descriptorsToGridRows()` to return columns separately | D |
| `_isBandHeader` guard in `createBandRowStyler` | Defensive guard — AG Grid should not call `getRowStyle` for full-width rows, but prevents unexpected tinting if behavior changes | D |
| AGridApi interface not extended for full-width options | Full-width row options (`isFullWidthRow`, `fullWidthCellRenderer`, `embedFullWidthRows`) are passed via `Record<string, unknown>` options bag to `createGrid()`, not as API methods — JSDoc comment added instead | D |
| `buildExportFromDescriptors()` takes optional `isCsv` parameter | DD says "section headers not inserted for CSV" — current band layout path includes them in CSV, but new model aligns with non-band path behavior (no section headers in CSV) | E |
| `exportAs()` band dispatch checks `bandResult != null` | Replaces `enabledBands.length > 0` check — `bandResult` is the authoritative indicator that bands are active (engine returns it when detail bands exist) | E |
| Totals row appended to `bandResult.parentRows` before grouping | Grouping layer handles totals as a special ParentDescriptor with `_isTotalsRow: true` — simpler than adding a separate parameter to `buildOverlayDescriptors()` | E |
| `enrichRowsWithBandHeaders()` not removed | Non-band path fallback for legacy data without `bandResult` — not in DD removal list, kept for backward compatibility | E |
| No external property-based testing framework | Standard Vitest `describe`/`it`/`expect` with parameterized tests — no `fast-check` dependency; properties are simple enough for targeted assertions | F |
| Part A handles mechanical test cleanup | Part A plan (P5-S7–P5-S15) removes deleted symbol imports, stack-mode test suites, `detailBandMode` assertions; Part F focuses on new overlay architecture tests | F |
