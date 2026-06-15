# Band Export Layout — Contracts Ledger

**Design doc:** `artifacts/designs/pending/DD-band-export-v2.md`
**Last updated:** 2026-06-15 (Phase 1 implementation complete)

---

## Architectural Rules

- All changes are in UI export layer only (`preact/ui/export.ts`)
- No engine, query, catalog, or UI component changes
- Pure functions for testability — no side effects in new functions
- `hdrMap` (from `buildExportHeaderMap()`) is the single source of truth for column display labels
- Band column aliases follow `_{bandId}_` prefix pattern (e.g., `_band_0_Product`)
- Band rows from engine have `null` for ALL parent columns (including match alias) — match value must come from preceding parent row
- `_processed` flag on synthetic rows enables composable band group transformations
- `_rowKind` on synthetic rows carries row kind codes (5=parent, 4=section header, 0=band data)
- `_band_id` on band data rows enables tint color assignment in `styleExportSheet()`
- Match column is NOT merged — explicit value on every row for scroll context
- Format consistency: same row structure for CSV and XLSX, no format-specific branching in data structure
- No new state properties, no serialization/hydration changes, no STATE_VERSION bump

---

## Collections & Methods

### New Functions in `preact/ui/export.ts`

| Function | Signature | Description |
| --- | --- | --- |
| `computeBandColSets` | `(detailBands: DetailBandSpec[] \| undefined, allCols: string[]) → Record<string, string[]>` | Extracts per-band ordered column alias arrays from superset columns using `_{bandId}_` prefix filter. Skips disabled bands. Orders by `band.cols` array. |
| `applyBandGroup` | `(rows: Record<string, unknown>[], bandId: string, matchAlias: string, bandColAliases: string[], allBandLabels: string[], hdrMap: Record<string, string>) → Record<string, unknown>[]` | Composable per-band-group row transformation. Replaces wide band rows with compact format (match value + band values). Inserts section headers (kind 4). Marks synthetic rows with `_processed: true`. Parent rows become kind 5. `_processed` kind-5 rows from prior bands trigger flush + match value update. `_isTotalsRow` rows pass through unchanged. |
| `buildBandColumnLayout` | `(dataRows: Record<string, unknown>[], detailBands: DetailBandSpec[], allCols: string[], hdrMap: Record<string, string>) → BandLayoutResult` | Orchestrates composition of all band group transformations. Builds header array. Returns `{ cleanRows, rowKinds, headers, bandIds }`. |

### Modified Functions

| Function | Change |
| --- | --- |
| `exportAs` | Band layout path inserted after `dataRows` construction (line 173). Dispatches to `buildBandColumnLayout()` when enabled detail bands present. Early return before non-band path. |
| `styleExportSheet` | New `rowType === 5` branch before kind 4 check (line 374). Bold font, slate-50 fill (`FFF8FAFC`), thin bottom border, left/center alignment. Creates cells if missing. |

---

## API Contracts

_(empty — this feature has no API contracts)_

---

## DTOs Created

### `BandLayoutResult` (return type of `buildBandColumnLayout`)

```typescript
{
  cleanRows: Record<string, unknown>[];  // Projected to headers only — no _band_id, no _processed
  rowKinds: number[];                    // 5=parent, 4=section header, 0=band data, 3=totals
  headers: string[];                     // [matchLabel, ...allBandLabels] — display labels from hdrMap
  bandIds: string[];                     // Per-row band ID for tint assignment ('' if no band)
}
```

---

## Decisions Made

| Decision | Rationale | Plan |
| --- | --- | --- |
| Match column not merged | Explicit value on every row improves scroll context; match value on section headers reinforces parent association | — |
| No format-specific branching | Same compact row structure for CSV and XLSX; we don't decide how consumers use data | — |
| Each band group is independent | Band groups compose sequentially; each has its own match column from `keyPairs[0].left` | — |
| Stack mode removed entirely | Cartesian cross-products are undesired behavior for detail bands | — |
| No v1/v2 fallback logic | Band layout is the only export path when detail bands are present | — |
| `_processed` parent rows trigger flush in subsequent bands | When band B encounters a `_processed` kind-5 row from band A, it flushes collected band rows and updates match value from the processed row's match column. This ensures correct section header placement across parent boundaries in multi-band compositions. | TASK-band-export-layout-A |
| Totals rows pass through `applyBandGroup` unchanged | Rows with `_isTotalsRow: true` are flushed and passed through without conversion to kind-5 parent rows. The `rowKinds` extraction in `buildBandColumnLayout` then correctly assigns kind 3. Without this, totals rows (which have `_band_id == null`) would be misidentified as parent rows. | TASK-band-export-layout-A |
