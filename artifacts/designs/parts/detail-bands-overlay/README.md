# Detail Bands Rendering Overlay — Implementation Parts

**Design doc:** `artifacts/designs/pending/DD-detail-bands-rendering-overlay.md`
**Delivery model:** Single commit — phases are structural only.

## Parts

| Part | Title | Depends On | Layers |
| --- | --- | --- | --- |
| A | Core types + engine contract + stack removal | None | Core, Report |
| B | Grouping layer (overlay-grouping.ts) | A | Report |
| C | Stack mode UI removal | A | UI |
| D | Grid overlay rendering | B | UI |
| E | Export overlay rendering | B | UI |
| F | Tests | D, E | Tests |

## Dependency Graph

```
A ───┬─── B ───┬─── D ───┐
     │         │         ├─── F
     │         ├─── E ───┘
     │         │
     └─── C ───┘
```

## Execution Rounds

Round 1: A, C (no deps)
Round 2: B (depends on A)
Round 3: D, E (depend on B)
Round 4: F (depends on D, E)

## Per-Part Scope

### Part A: Core types + engine contract + stack removal
Creates `BandResultSet`, `OverlayDescriptor`, `BandSectionDescriptor`, `BandRowDescriptor` types in `types.ts`. Adds optional `bandResult` field to `ResultSet`. Modifies `runDetailBandsMode()` in `engine.ts` to return `BandResultSet` (no interleaving). Removes stack mode from engine: deletes `crossProductRows()`, `RowExplosionError`, `STACK_ROW_LIMIT`, the `if (mode === 'stack')` branch. Removes `detailBandMode` from `DetailBandSpec`, `AppState`, state defaults, schema recognition, serialization, hydration. Updates `index.ts` exports. No new module — modifies existing files only. Files: `types.ts`, `engine.ts`, `result-set.ts`, `core/state.ts`, `core/state-schema.ts`, `core/state-serializer.ts`, `core/state-hydrator.ts`, `index.ts`.

### Part B: Grouping layer
Creates new module `report/overlay-grouping.ts` exporting `buildOverlayDescriptors()`. Contains `GroupBoundaryDetector` class. Walks parent rows, detects group boundaries by match key transitions, emits `OverlayDescriptor[]`. Pure function — no state dependency. Updates `validation.ts`: match column existence check replaces selCols membership check. Updates `report-output.ts`: `PublishedOutput` gains optional `bandResult` field, `createResultTable()` passes through band data. Updates `preview-builder.ts`: removes `detailBandMode` from preview spec. Files: `report/overlay-grouping.ts` (new), `report/validation.ts`, `report/report-output.ts`, `report/preview-builder.ts`.

### Part C: Stack mode UI removal
Removes stack mode UI: deletes mode toggle radio buttons from `cards/pipeline-card.tsx`, deletes entire `row-explosion-dialog.tsx` file, removes `RowExplosionError` handler from `run-bar.tsx`. Files: `cards/pipeline-card.tsx`, `row-explosion-dialog.tsx` (deleted), `run-bar.tsx`.

### Part D: Grid overlay rendering
Adds `descriptorsToGridRows()` adapter, `BandHeaderRenderer` class, and full-width row configuration to `grid.tsx`. Consumes `OverlayDescriptor[]` from grouping layer. Configures `isFullWidthRow`, `fullWidthCellRenderer`, `embedFullWidthRows` in AG Grid options. Extends `AGridApi` type declarations in `globals.d.ts`. Files: `ui/grid.tsx`, `types/globals.d.ts`.

### Part E: Export overlay rendering
Adds `buildExportFromDescriptors()` to `export.ts`. Consumes `OverlayDescriptor[]` from grouping layer. Produces parent-column-aligned layout: section headers relabel parent positions, band data rows have empty col 0 + band values. Removes `applyBandGroup()`, `buildBandColumnLayout()`, `computeBandColSets()`. Updates `exportAs()` band dispatch. Files: `ui/export.ts`.

### Part F: Tests
Writes tests first (TDD) encoding spec behavior. Unit tests for overlay-grouping, engine changes, grid adapter, export adapter. Integration tests for end-to-end descriptor pipeline. Removes stack mode tests. Updates all existing band tests. Files: all test files in `preact/tests/`.
