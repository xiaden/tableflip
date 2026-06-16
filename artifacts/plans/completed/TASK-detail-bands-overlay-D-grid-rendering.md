# Task: Grid Overlay Rendering

## Problem Statement

Part D of the detail-bands-overlay feature adds the grid rendering layer that consumes `OverlayDescriptor[]` from Part B's grouping layer and renders band section headers as full-width rows in AG Grid.

After Parts A and B, the engine returns flat parent rows + separate band result sets in a `BandResultSet`, and `buildOverlayDescriptors()` produces a flat `OverlayDescriptor[]` array describing the rendered output (parent rows, band section headers, band data rows). Part D bridges this descriptor array to AG Grid's rendering model.

AG Grid Community v32.1.0 supports **full-width rows** via `isFullWidthRow` + `fullWidthCellRenderer` — the only alternative row rendering available in Community edition (master/detail and tree data are Enterprise-only). Band section headers become full-width rows; band data rows become regular rows with tinted backgrounds (reusing the existing `createBandRowStyler`).

The null-padding that the old engine applied to interleaved rows is **reintroduced at the grid boundary** by `descriptorsToGridRows()` — a deliberate architectural choice: the engine produces clean data, the grouping layer produces clean descriptors, and the grid adapter produces AG Grid-compatible rows.

**Scope:** `descriptorsToGridRows()` adapter, `BandHeaderRenderer` class, full-width row configuration in `ResultGrid`, `AGridApi` type declaration review in `globals.d.ts`, `bandResult` pass-through in `run-bar.tsx`. Files: `ui/grid.tsx`, `types/globals.d.ts`, `ui/sections/run-bar.tsx` (one-line addition).

**Prerequisite:** TASK-detail-bands-overlay-B (Grouping layer) must be completed first — provides `buildOverlayDescriptors()` and `OverlayDescriptor` types. TASK-detail-bands-overlay-C (Stack mode UI removal) should be completed first — cleans up `run-bar.tsx` before the `bandResult` pass-through is added.

## Phases

### Phase 1: AG Grid Type Declarations (globals.d.ts)

Review and extend the AG Grid global type declarations to support full-width row configuration. The current `agGrid.createGrid()` accepts `Record<string, unknown>` for options and returns `AGridApi`. Full-width row options (`isFullWidthRow`, `fullWidthCellRenderer`, `embedFullWidthRows`) are passed via the options object, not the API interface. Verify whether any type additions improve safety or documentation.

- [x] Review `SRC/preact/types/globals.d.ts` `AGridApi` interface and `agGrid.createGrid` signature to determine if full-width row options need type declarations. The options are passed as `Record<string, unknown>` to `createGrid()`, so `isFullWidthRow`, `fullWidthCellRenderer`, and `embedFullWidthRows` do not require `AGridApi` method additions. Document this finding in a code comment above the `AGridApi` interface noting that full-width row options are passed via the options bag.
    **Note:** Added JSDoc comment above AGridApi interface in globals.d.ts documenting that full-width row options (isFullWidthRow, fullWidthCellRenderer, embedFullWidthRows) are passed via the options bag to agGrid.createGrid(), not as API methods. No type changes needed — Record<string, unknown> already accommodates these keys.
- [x] If the review in the previous step identifies any type gaps (e.g., the `fullWidthCellRenderer` class interface needs a structural type for AG Grid's imperative renderer contract), add the minimal type declaration. At minimum, add a JSDoc comment to the `agGrid.createGrid` declaration listing the supported full-width row option keys: `isFullWidthRow`, `fullWidthCellRenderer`, `embedFullWidthRows`.
    **Note:** Added JSDoc to agGrid.createGrid declaration in globals.d.ts listing supported full-width row option keys (isFullWidthRow, fullWidthCellRenderer, embedFullWidthRows). No structural type additions needed — the options bag is Record<string, unknown>. Pre-existing lint warning in grid.tsx (unused OverlayDescriptor import from Part B) is unrelated to this phase.

### Phase 2: descriptorsToGridRows() Adapter Function

Implement the pure function that converts `OverlayDescriptor[]` into AG Grid-compatible flat row data. This is where the rendering concern of null-padding lives — not in the engine. The function computes the superset column set (parent + all band columns), maps each descriptor to a row with the appropriate shape, and assigns `_bandTintIndex` for consistent color assignment.

- [x] Add imports to `SRC/preact/ui/grid.tsx`: add `OverlayDescriptor`, `BandResultSet`, `DetailBandSpec` to the type import from `../types`; add `import { buildOverlayDescriptors } from '../report/overlay-grouping';`.
    **Note:** Added `OverlayDescriptor` to type import from '../types' (line 15). Added `buildOverlayDescriptors` import from '../report/overlay-grouping' (line 24) with eslint-disable-next-line comment since it's unused until Phase 4.
- [x] Implement `descriptorsToGridRows()` function in `grid.tsx` (place after the `BAND_ROW_TINTS` constant and before `createBandRowStyler`). Signature: `export function descriptorsToGridRows(descriptors: OverlayDescriptor[], parentCols: string[], bandColSets: Record<string, string[]>): Record<string, unknown>[]`. Include JSDoc explaining that this is the grid boundary where null-padding is applied as a rendering concern.
    **Note:** Implemented descriptorsToGridRows() function (lines 55-109) after BAND_ROW_TINTS and before createBandRowStyler. Exported for unit testing.
- [x] Inside `descriptorsToGridRows()`, compute the superset column list: `const allBandCols = Object.values(bandColSets).flat(); const supersetCols = [...parentCols, ...allBandCols];`. These are the data columns (no synthetic fields like `_band_id` or `_isBandHeader`).
    **Note:** Superset column computation at lines 71-72: allBandCols from Object.values(bandColSets).flat(), supersetCols = parentCols + allBandCols.
- [x] Inside `descriptorsToGridRows()`, build a band tint index map (order of first appearance) by scanning descriptors for `band-row` and `band-section` types: `const bandTintMap = new Map<string, number>();` — assign incrementing index for each new `bandId` encountered.
    **Note:** Band tint index map at lines 74-80: scans descriptors for band-row/band-section types, assigns incrementing index per new bandId.
- [x] Inside `descriptorsToGridRows()`, iterate descriptors and produce rows: for `ParentDescriptor` → spread `data` into a row object with all `supersetCols` keys populated (band columns default to empty string `''` for parent rows); for `BandSectionDescriptor` → produce a synthetic row `{ _isBandHeader: true, _band_id: bandId, _bandLabel: bandLabel, _bandTintIndex: bandTintMap.get(bandId) ?? 0 }` with all `supersetCols` keys set to empty string; for `BandRowDescriptor` → spread `data` into a row with all `supersetCols` keys populated (parent columns default to empty string `''` for band rows), plus `_band_id: bandId`.
    **Note:** Descriptor-to-row mapping at lines 82-108: parent rows get band cols padded to '', band-section rows get synthetic _isBandHeader/_bandLabel/_bandTintIndex with all supersetCols set to '', band-row rows get parent cols padded to '' plus _band_id.
- [x] Export `descriptorsToGridRows` from `grid.tsx` for unit testing (the `export` keyword on the function declaration is sufficient — it is already included in the implementation step above).
    **Note:** Function is exported via `export function descriptorsToGridRows` declaration — no additional export step needed.

### Phase 3: BandHeaderRenderer Class

Implement the AG Grid `fullWidthCellRenderer` class that renders band section headers. AG Grid's imperative cell renderer contract requires `init()`, `getGui()`, `refresh()`, and `destroy()` methods. The renderer displays the band label with a tinted background matching the band's color assignment.

- [x] Implement `BandHeaderRenderer` class in `grid.tsx` (place after `descriptorsToGridRows()` and before `createBandRowStyler`). The class has: `private eGui!: HTMLDivElement;` field; `init(params: { data: Record<string, unknown> })` method that creates a `<div>` element with inline styles (flex layout, tinted background from `BAND_ROW_TINTS[_bandTintIndex % BAND_ROW_TINTS.length]`, font-weight 600, font-size 13px, padding 4px 12px) and sets `textContent` to the band label (from `params.data._bandLabel`, falling back to `_band_id`); `getGui(): HTMLDivElement` returning `this.eGui`; `refresh(): boolean` returning `false`; `destroy(): void` as no-op.
    **Note:** Implemented BandHeaderRenderer class in grid.tsx (after descriptorsToGridRows(), before createBandRowStyler()). Class implements AG Grid's imperative fullWidthCellRenderer contract: init(params) creates a styled div with tinted background from BAND_ROW_TINTS using _bandTintIndex, getGui() returns the element, refresh() returns false, destroy() is no-op. Added eslint-disable-next-line for @typescript-eslint/no-unused-vars since the class will be consumed in Phase 4 (ResultGrid integration). JSDoc documents the AG Grid contract and the params.data shape (_bandLabel, _band_id, _bandTintIndex from descriptorsToGridRows synthetic rows).
- [x] Add JSDoc to `BandHeaderRenderer` explaining it is an AG Grid imperative cell renderer for full-width band section headers, describing the `init()` params shape (`_bandLabel`, `_bandTintIndex` from the synthetic row data produced by `descriptorsToGridRows()`).
    **Note:** JSDoc included as part of P3-S1 implementation. Documents: (1) AG Grid imperative cell renderer contract (init/getGui/refresh/destroy), (2) params.data shape — synthetic row from descriptorsToGridRows() with _bandLabel, _band_id, _bandTintIndex fields, (3) tinted background matching band color assignment via BAND_ROW_TINTS.

### Phase 4: ResultGrid Integration

Wire the overlay rendering path into the `ResultGrid` component. When `bandResult` is present on the result object, build descriptors, convert to grid rows, and configure AG Grid with full-width row options. When `bandResult` is absent, existing behavior is unchanged. Also update `createBandRowStyler` to guard against `_isBandHeader` rows and update `run-bar.tsx` to pass `bandResult` through.

- [x] Update `createBandRowStyler()` in `grid.tsx` to return `undefined` for rows where `_isBandHeader === true`. Add a guard at the top of the returned callback: `if (data._isBandHeader === true) return undefined;`. This is defensive — AG Grid should not call `getRowStyle` for full-width rows, but the guard prevents unexpected tinting if behavior changes.
    **Note:** Added `if (data._isBandHeader === true) return undefined;` guard after the `if (!data) return undefined;` check in the callback returned by `createBandRowStyler()`. This prevents band header rows from receiving tinted background styling.
- [x] Update the `_band_id` filter in `makeResultCols()` at `grid.tsx` line 462 to also filter `_isBandHeader`: change `cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id')` to `cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id' && c !== '_isBandHeader')`. This ensures synthetic marker fields never appear as visible columns even if they leak into the column list.
    **Note:** Added `&& c !== '_isBandHeader'` to the dataCols filter in `makeResultCols()` so the synthetic marker field never appears as a visible grid column.
- [x] Update `ResultGrid` component's `useEffect` in `grid.tsx` to detect and handle the overlay path. After the existing destructuring `const { rows, totalsRow, cols } = result as {...}`, add: `const bandResult = (result as Record<string, unknown>).bandResult as BandResultSet | undefined;`. When `bandResult` is present: (1) read `detailBands` from store via `getStore().getState().detailBands`; (2) call `buildOverlayDescriptors(bandResult, detailBands)` to get descriptors; (3) compute `bandColSets` from `bandResult.bandResults` as `Record<string, string[]>` mapping `band.id → br.cols`; (4) call `descriptorsToGridRows(descriptors, bandResult.parentCols, bandColSets)` to get `gridRows`; (5) use `gridRows` as `rowData` instead of `tableData`. When `bandResult` is absent, use existing `tableData` logic unchanged.
    **Note:** Added bandResult detection via `(result as Record<string, unknown>).bandResult as BandResultSet | undefined` in the useEffect. When bandResult is present, builds overlay descriptors via `buildOverlayDescriptors()`, computes bandColSets, calls `descriptorsToGridRows()`, and creates grid with full-width row options. When absent, follows existing standard path unchanged. Imported `BandResultSet` type from `../types` for the cast (deviation: used proper type import instead of inline structural type to satisfy tsc — the inline type was missing `parentKeyAliases` and `childKeyCols` from `BandResult`).
- [x] In the `ResultGrid` `useEffect`, when `bandResult` is present, add the full-width row options to the AG Grid options object: `isFullWidthRow: (params: { data: Record<string, unknown> }) => params.data?._isBandHeader === true`, `fullWidthCellRenderer: BandHeaderRenderer`, `embedFullWidthRows: true`. These options are added alongside the existing options (rowData, columnDefs, defaultColDef, getRowStyle, pagination, etc.).
    **Note:** Added `isFullWidthRow`, `fullWidthCellRenderer: BandHeaderRenderer`, and `embedFullWidthRows: true` to the AG Grid options object in the overlay band path branch. These are only present when bandResult is detected.
- [x] In the `ResultGrid` `useEffect`, when `bandResult` is present, compute the superset column list for `makeResultCols()`: `const supersetCols = [...bandResult.parentCols, ...bandResult.bandResults.flatMap(br => br.cols)];`. Pass `supersetCols` to `makeResultCols()` instead of `cols`. This ensures band columns appear in the grid's column definitions.
    **Note:** In the overlay band path, computed `supersetCols = [...bandResult.parentCols, ...bandResult.bandResults.flatMap(br => br.cols)]` and passed it to `makeResultCols()` instead of the original `cols`. This ensures band columns appear in the grid's column definitions alongside parent columns.
- [x] Update the `ResultGrid` component's render section (the JSX after `useEffect`) to show the correct row count when bands are active. When `bandResult` is present, the row count should reflect parent rows only (not band rows or section headers): use `bandResult.parentRows.length` instead of `rows.length` for the count display. The column count should reflect the superset columns.
    **Note:** Replaced the JSX-level destructuring with bandResult-aware display logic. When bandResult is present, `displayRows` uses `bandResult.parentRows` and `displayCols` uses the superset of parent + band columns. The row/column count display now correctly reflects parent row count and total column count for band reports.
- [x] Add `bandResult` pass-through in `SRC/preact/ui/sections/run-bar.tsx`. In the result object construction (around line 117–122), add `bandResult: resultSet.bandResult` to the object literal: `const result = { rows: resultSet.rows, totalsRow: resultSet.metadata.totalsRow || null, cols: resultSet.columns, hasSubtotals: hasSubs, bandResult: resultSet.bandResult };`. This makes `bandResult` available to `ResultGrid` via the `result` prop. **Note:** This is a one-line addition to the result object constructed after Part C's cleanup of `run-bar.tsx`.
    **Note:** Added `bandResult: resultSet.bandResult` to the result object constructed in run-bar.tsx (line 117). This passes the BandResultSet from the engine through to the ResultGrid component via the store.
  **Warning:** Part C removes `detailBandMode` from the `ReportSpec` construction (line 105) and simplifies the `executeReport` call. Ensure this step is applied after Part C's changes are in place. If Part C has not been executed yet, apply Part C first or coordinate the changes.

### Phase 5: Verification

Run all mandatory checks to confirm the overlay rendering integrates correctly without breaking existing functionality.

- [x] Run `npm run typecheck` from `SRC/` — zero errors required. Confirms all new imports, type annotations, and AG Grid option shapes are valid.
    **typecheck:** npm run typecheck — 0 errors. Confirm all new imports, type annotations, and AG Grid option shapes are valid.
- [x] Run `npm run lint` from `SRC/` — zero warnings required. Confirms no unused imports (especially the new type imports from `../types` and `../report/overlay-grouping`).
    **lint:** npm run lint — 0 warnings. No unused imports or other lint issues.
- [x] Run `npm test` from `SRC/` — all existing tests pass. Confirms `createBandRowStyler` changes are backward-compatible and no existing grid tests are broken by the new imports or the `_isBandHeader` filter addition.
    **test:** npm test — 990 passed, 1 skipped, 54 test files. createBandRowStyler changes backward-compatible, existing grid tests pass.
- [x] Verify non-band reports are unaffected: when `bandResult` is `undefined` on the result object, `ResultGrid` follows the existing code path with no behavioral change. Confirm by inspecting the conditional branch in the `useEffect`.
    **confirm:** Confirmed by code inspection: when bandResult is undefined (non-band reports), ResultGrid useEffect follows the standard path (lines 325+) with identical behavior — no changes to existing non-band report rendering.

## Completion Criteria

- `descriptorsToGridRows()` function exists in `grid.tsx`, is exported, and converts `OverlayDescriptor[]` into flat AG Grid-compatible rows with correct null-padding, `_isBandHeader` markers, and `_bandTintIndex` assignment
- `BandHeaderRenderer` class exists in `grid.tsx` implementing AG Grid's imperative cell renderer contract (`init`, `getGui`, `refresh`, `destroy`)
- `ResultGrid` detects `bandResult` on the result object and branches to the overlay path: builds descriptors via `buildOverlayDescriptors()`, converts to grid rows via `descriptorsToGridRows()`, configures `isFullWidthRow` + `fullWidthCellRenderer` + `embedFullWidthRows` in AG Grid options
- When `bandResult` is absent, `ResultGrid` behavior is identical to the pre-overlay implementation
- `createBandRowStyler` returns `undefined` for `_isBandHeader` rows (defensive guard)
- `makeResultCols` filters `_isBandHeader` from visible columns
- `run-bar.tsx` passes `bandResult` through to the result object stored in state
- `globals.d.ts` has documentation for full-width row options (at minimum a JSDoc comment)
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References

- Design doc: `artifacts/designs/pending/DD-detail-bands-rendering-overlay.md` — Phase 2 "Grid Overlay Rendering", "Grid Rendering" section in Design Details
- Parts README: `artifacts/designs/parts/detail-bands-overlay/README.md` — Part D scope definition
- Contracts: `artifacts/designs/parts/detail-bands-overlay/CONTRACTS.md` — "AG Grid full-width rows for section headers", "Null-padding at grid boundary only"
- Prerequisite plan: TASK-detail-bands-overlay-B (Grouping layer — provides `buildOverlayDescriptors`)
- Coordination: TASK-detail-bands-overlay-C (Stack mode UI removal — cleans `run-bar.tsx` before `bandResult` pass-through)
- Sibling plans: Part E (Export overlay rendering), Part F (Tests)
