# Scoped Selectors — Implementation Parts

Refinement of DD-preact-to-react-conversion, resolved Open Question #2: "Store Adapter: Selector-based from the start."

Currently 17 `useStore(s => s)` calls across 13 components negate the selector hook — every component re-renders on every state change, identical to the old Preact pattern.

## Parts

 | Part | Title | Depends On | Layers |
 | --- | --- | --- | --- |
 | A | Simple sections | None | UI |
 | B | Medium sections | None | UI |
 | C | Complex sections + pipeline-card | None | UI |
 | D | layout-card | None | UI |

## Dependency Graph

```
None — all parts are independent (scoping a selector in one component does not affect any other component).

A (simple-sections) ──┐
B (medium-sections) ──┼── Round 1 (parallel dispatch)
C (complex-sections) ─┤
D (layout-card) ──────┘
```

## Execution Rounds

Round 1: A, B, C, D (no deps — all dispatched in parallel)

## Per-Part Scope

### Part A: Simple Sections (4 files, low complexity)

Files: `sections/base-stage.tsx`, `sections/run-bar.tsx`, `sections/stack-sheets.tsx`, `cards/filter-sort-card.tsx`

Each component reads 1-3 AppState fields. Replace `useStore(s => s)` with scoped selectors matching exact fields used. Components that pass `state` to `buildReportSpecFromState()` in event handlers switch to `getStore().getState()`. Verify no stale references remain.

Fields per file:
- **base-stage.tsx**: `base`, `tables`, `aggMode`
- **run-bar.tsx**: `base`
- **stack-sheets.tsx**: `base`, `tables`, `stacks`
- **filter-sort-card.tsx**: `base`

### Part B: Medium Sections (4 files, moderate complexity)

Files: `sections/lookup-stage.tsx`, `sections/sort-list.tsx`, `sections/merge-toggles.tsx`, `sections/filter-list.tsx`

Each component reads 3-5 fields. Several pass `state` to `buildReportSpecFromState()` in event handlers — switch to `getStore().getState()`. Verify `state.xxx` references are all covered by the new selector.

Fields per file:
- **lookup-stage.tsx**: `lookups`, `tables`, `base`, `aggMode` + passes `state` to `buildReportSpecFromState`
- **sort-list.tsx**: `selCols`, `tables`, `colOrder`, `sorts` + passes `state` to `buildReportSpecFromState`
- **merge-toggles.tsx**: `result`, `tables`, `selCols`, `colOrder`, `mergedCols` + passes `state` to `buildReportSpecFromState`
- **filter-list.tsx**: `tables`, `filters` + passes `state` to `buildReportSpecFromState`

### Part C: Complex Sections + Pipeline Card (4 files, high complexity)

Files: `sections/column-chips.tsx`, `sections/calc-stage.tsx`, `sections/detail-band-stage.tsx`, `cards/pipeline-card.tsx`

Each component reads 4-10 fields. Multiple `getStore()` direct calls for mutations. The `state` object is often passed to helpers or builders. Scoping requires careful analysis of which reads are reactive (render path) vs imperative (event handler path).

Fields per file:
- **column-chips.tsx**: `base`, `lookups` (`.length` only), `calcStages` (`.length` only), `aggMode`, `groupBy`, `selCols`, `colOrder`, `aggregates`, `subtotalBy` + internal `_buildTooltip` reads `calcStages`, `tables` from state
- **calc-stage.tsx**: `calcStages`, `aggMode`, `tables` + passes `state` to `buildReportSpecFromState`
- **detail-band-stage.tsx**: `detailBands`, `tables`, `lookups` + passes `state` to `buildReportSpecFromState`
- **pipeline-card.tsx**: `tables`, `base`, `lookups`, `calcStages`, `detailBands`, `stacks` + raw `getStore().subscribe()` for preview cache clearing

### Part D: Layout Card (1 file, 4 sub-components, highest complexity)

File: `cards/layout-card.tsx`

Four `useStore(s => s)` calls across four sub-components. Most complex component in the UI layer. Each sub-component reads different subsets:

- **LayoutCard** (L92): `base`, `aggMode`, `tables`, `colOrder`, `selCols`, `groupBy`, `subtotalGrandTotal`, `subtotalSpacer`, `subtotalOnTop`, `subtotalStrategy`, `mergeGroupUnderline` + passes `state` to `buildReportSpecFromState` and `getHint`
- **TotalsSection** (L142): `selCols`, `colTotals`
- **SubtotalsSection** (L232): `subtotalBy`, `selCols`, `subtotalFns`
- **AggregateItems** (L364): `selCols`, `aggregates`, `groupBy`

Each sub-component gets its own scoped selector. `state` passed to `buildReportSpecFromState()` in event handlers switches to `getStore().getState()`. 8 `getStore()` direct calls for mutations remain unchanged.
