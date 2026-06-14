---
name: bands-feature-orientation
description: Use when working with detail bands — the 1:N child row fan-out feature that produces vertical sub-row expansion under parent rows. Covers the DetailBandSpec contract, band column catalog propagation, per-band SQL generation, JS-side row stitching (separate and stack modes), grid tinted-row styling, XLSX section headers, band validation, serialization, and common failure modes.
---

# Detail Bands Feature Orientation

## Mental Model

Detail bands produce **vertical fan-out** from parent rows to child rows (1:N), distinct from lookups which produce horizontal column extension (N:1). A band configures a child table, key mapping (parent→child columns), optional column subset, per-band sorting, and a user label. During report execution, the parent query runs normally, then per-band `WHERE key IN (...)` queries fetch all child rows at once, and JavaScript stitches them together. Two modes control multiple-band interaction: **separate** (each parent row followed by its child rows from each band) and **stack** (Cartesian cross-product of child rows from all bands per parent).

## Coverage

**Documented:** DetailBandSpec interface and fields, band column prefixing and kind tagging in the catalog, per-band SQL generation (single-key and multi-key), JS row stitching (interleaveRows for separate, crossProductRows for stack), RowExplosionError cap, band metadata in result sets, grid tinted-row background styling, XLSX band section headers and tint palettes, CSV _band_id retention, band validation (missing table, key columns, sort columns), state serialization/hydration for persistence, pipeline UI (add, configure, reorder, mode toggle).

**Not yet documented:** Performance characteristics of multi-key band queries at scale, interaction between bands and calculated columns that reference band columns, band drag-and-drop reorder edge cases with validation state.

**Last extended:** 2026-06-14

## Key Files

| Area | Canonical File |
|------|---------------|
| Type definition | `SRC/preact/types.ts:53-61` (DetailBandSpec) |
| State shape | `SRC/preact/types.ts:160-196` (detailBands, detailBandMode on AppState) |
| State shape (ReportSpec) | `SRC/preact/types.ts:214-251` (pipeline.detailBands, detailBandMode) |
| Default factory | `SRC/preact/core/state.ts:136-146` (createDetailBandSpec) |
| buildReportSpecFromState | `SRC/preact/core/state.ts:159-168` (includes detailBands) |
| Serialization | `SRC/preact/core/state-serializer.ts:79-88` |
| Hydration | `SRC/preact/core/state-hydrator.ts:334-390` |
| Schema recognition | `SRC/preact/core/state-schema.ts:16` (detailBands key) |
| Column catalog integration | `SRC/preact/catalog/column-catalog.ts:168-184` (band prefixing + kind tagging) |
| Band SQL generation | `SRC/preact/query/sql-detail-bands.ts` |
| Query plan pass-through | `SRC/preact/query/query-plan.ts:149` |
| Report execution engine | `SRC/preact/report/engine.ts:404-521` (runDetailBandsMode, interleaveRows, crossProductRows) |
| Row explosion guard | `SRC/preact/report/engine.ts:130-151` (RowExplosionError, STACK_ROW_LIMIT) |
| Result set metadata | `SRC/preact/report/result-set.ts:25-36` (bandCount, bandIds, bandLabels) |
| Validation | `SRC/preact/report/validation.ts:304-365` |
| Pipeline card UI | `SRC/preact/ui/cards/pipeline-card.tsx` |
| Band configuration UI | `SRC/preact/ui/sections/detail-band-stage.tsx` |
| Grid row tinting | `SRC/preact/ui/grid.tsx:37-83` (createBandRowStyler) |
| Export (band headers, tints) | `SRC/preact/ui/export.ts:55-64` (buildBandLabels), `89-124` (enrichRowsWithBandHeaders), `276-475` (styleExportSheet) |
| Tests (catalog) | `SRC/preact/tests/catalog/column-catalog-bands.test.ts`, `column-catalog-bands-kind.test.ts` |
| Tests (query) | `SRC/preact/tests/query/sql-detail-bands.test.ts`, `query-plan-bands.test.ts` |
| Tests (engine) | `SRC/preact/tests/report/engine-bands.test.ts`, `engine-perf.test.ts` |
| Tests (validation) | `SRC/preact/tests/report/validation-bands.test.ts` |
| Tests (result set) | `SRC/preact/tests/report/result-set-bands.test.ts` |
| Tests (grid) | `SRC/preact/tests/ui/grid-bands.test.ts` |
| Tests (export) | `SRC/preact/tests/ui/export-bands.test.ts` |
| Tests (state persistence) | `SRC/preact/tests/core/state-serializer-bands.test.ts`, `state-hydrator-bands.test.ts` |
| Tests (integration) | `SRC/preact/tests/integration/band-columns-catalog.test.ts` |
| Tests (UI reorder) | `SRC/preact/tests/ui/pipeline-card-reorder.test.ts` |
| Tests (row explosion dialog) | `SRC/preact/tests/ui/row-explosion-dialog.test.ts` |
| Public exports | `SRC/preact/index.ts:47-48` (buildBandQuery, BandQueryResult), `71-72` (BandChildIndex) |

## Critical Invariants

1. **Band columns are prefixed `_{bandId}_` and tagged `kind: 'band'`.** This prefixing prevents collision with parent/lookup columns. The `kind: 'band'` tag signals the main query builder to skip these entries in the parent SELECT projection — band columns have no JOIN in the FROM clause.

2. **Bands only activate when `aggMode === 'none'`.** The dispatch in `runReport` (engine.ts:553-556) checks `enabledBands.length > 0 && plan.aggMode === 'none'`. Bands are silently ignored in totals/subtotals/group modes.

3. **Bands are always positioned after all lookups in the pipeline.** Key pair left-side columns are resolved against `projectedColsUpToLookup(lookupCount, ...)` — all lookup columns plus base columns are available as parent key sources.

4. **Empty `band.cols` means "all columns" from the child table.** The catalog materializes all child table columns when `cols` is empty. The UI (detail-band-stage.tsx) checks `band.cols.length === 0` to determine "all selected" state.

5. **`_band_id` is the canonical row-type discriminator.** `null` = parent row, `band.id` string = child row from that band. This field is filtered from XLSX export (section headers provide visual grouping) but retained in CSV export (downstream consumers need it for grouping).

6. **Stack mode has a hard row explosion cap of 10,000 rows per parent (enforced in crossProductRows).** The `runDetailBandsMode` function also applies a cumulative cap across all parents. `RowExplosionError` is thrown when exceeded, which is caught in the UI and shown as a dialog.

7. **Per-band queries use batched WHERE IN (one query per band, not per parent row).** The engine extracts deduplicated key values from all parent rows and passes them as a single batched `WHERE key IN (?,?,...)` query per band. For multi-key bands, parent-side values are pre-concatenated with `|||` separator to match the SQL concatenation pattern.

8. **Disabled bands (enabled === false) are excluded at every layer:** catalog column addition, validation, engine execution, and key value extraction.

9. **Per-band sort specifications are applied in SQL ORDER BY**, not in JS. The `buildBandQuery` function appends them to the generated SQL.

10. **Band labels default to the child table name if not explicitly set.** Resolution order in `buildBandLabels`: `band.label` → `tables[band.rightId].name` → `band.id`.

## Common Failure Modes

- **Adding a band column to the main SELECT without `kind: 'band'` tagging** — causes SQL errors because the band table has no JOIN in the parent FROM clause. Band columns must remain as column-catalog entries used only by the per-band SQL generator.
- **Omitting `detailBands` from the `catalogCtx`** when calling `buildColumnCatalog`/`projectedColsUpToLookup` — band columns silently vanish from the column catalog. The `buildReportSpecFromState` helper exists to prevent this.
- **Mutating band state without calling `invalidateValidation()`** — stale validation persists until manual invalidation. Every band mutation handler in `detail-band-stage.tsx` calls it.
- **Not filtering `_band_id` from XLSX column list** — the internal column appears in export output. The XLSX side is handled by `filterExportCols()` but any new code consuming result rows must choose appropriately for its format.
- **Assuming band order is stable after serialization/hydration** — band order is a meaningful user choice (affects separate-mode rendering order). Drag-and-drop reorder in the pipeline card updates the array position. Hydration preserves incoming array order.
- **Forgetting that stack mode Cartesian product can explode** — even with the 10,000 cap, a report that formerly returned 100 rows can suddenly return 10,000+ rows when stacking bands are enabled. The cap is per-parent, not per-report, so the total can be much larger.

## Report Execution Flow (Detail Bands Path)

```
runReport()
  └─ buildQueryPlan() [passes detailBands through catalogCtx]
  └─ enabledBands > 0 && aggMode === 'none' → runDetailBandsMode()
       ├─ 1. Execute parent SQL (same as detail mode)
       ├─ 2. Build source catalog + column catalog
       ├─ 3. Determine parent columns from actual row data
       ├─ 4. For each enabled band:
       │      ├─ Filter colMap to _{bandId}_ entries with kind: 'band'
       │      ├─ Extract deduplicated parent key values
       │      ├─ buildBandQuery() → per-band SQL with WHERE IN
       │      ├─ execQuery() → band rows
       │      └─ Tag each row with _band_id = band.id
       ├─ 5. Compute superset columns (parent cols + all band cols + _band_id)
       ├─ 6. Stitch rows:
       │      ├─ 'separate' → interleaveRows() [O(1) index-based child lookup]
       │      └─ 'stack' → crossProductRows() [Cartesian product per parent]
       ├─ 7. Build band labels map
       └─ 8. buildResultSet() with band metadata
```

## Band Color/Tint Palettes

Two separate palettes exist and must be kept in sync conceptually:

| Context | Palette | Location |
|---------|---------|----------|
| AG Grid (dark theme) | `BAND_ROW_TINTS` — 5 rgba values with 0.08 alpha | `ui/grid.tsx:43-49` |
| XLSX export | `BAND_TINT_PALETTE` — 5 hex color codes with FF alpha prefix | `ui/export.ts:71-76` |

Both cycle by order of first appearance of each band ID in the result rows.

## Investigation Entrypoints

- **Band rows missing from results**: Check `runReport()` dispatch — is `aggMode` 'none'? Are bands enabled? Does `rightId` reference a loaded table?
- **Band column not found in catalog**: Check the prefix is `_{bandId}_` and the entry has `kind: 'band'` in `buildColumnCatalog()`.
- **SQL error in band query**: Check `buildBandQuery()` — single key uses simple IN, multi-key uses `|||` concatenation. No calc column support in v1.
- **Wrong child rows matched**: Check `makeKeyValue()` — single key is raw value, multi-key is `|||` concatenation. Both parent and child sides must agree.
- **Row explosion error**: Check stack mode with many bands/children. Adjust `STACK_ROW_LIMIT` or switch to separate mode.
- **Export has unexpected _band_id column**: Check `filterExportCols()` — XLSX filters it, CSV keeps it.
- **Validation not clearing after band fix**: Check `invalidateValidation()` is called after mutation.

## Sources

No formal ADRs exist for the detail bands feature. Design emerged from TASK-subreport-detail-rows. The following design document describes the feature:
- DD: TASK-subreport-detail-rows (see artifacts/designs/ if archived)

Key decisions embedded in code (no ADR recorded):
- Band column prefixing (`_{bandId}_`) chosen over alternate scoping mechanisms
- Batched WHERE IN per band chosen over per-parent-row N+1 queries
- No calculated column support in v1 band queries
- `|||` separator pattern reused from lookup resolver for multi-key joins
