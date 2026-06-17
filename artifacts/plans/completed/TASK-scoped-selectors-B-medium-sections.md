# Task: Replace useStore(s => s) with scoped selectors in medium-complexity sections

## Problem Statement

Four UI section components use `useStore(s => s)` which subscribes to the entire AppState, causing unnecessary re-renders on any state change. This violates the selector-based design decision resolved in Open Question #2 of the Preact-to-React conversion DD. These four files have moderate complexity (3-5 fields each, plus `buildReportSpecFromState` calls that need the full state object). Each component must switch to a scoped selector for reactive reads and use `getStore().getState()` for imperative full-state access in `buildReportSpecFromState`.

**Files in scope:**
- `SRC/preact/ui/sections/lookup-stage.tsx` — fields: lookups, tables, base, aggMode
- `SRC/preact/ui/sections/sort-list.tsx` — fields: selCols, tables, colOrder, sorts
- `SRC/preact/ui/sections/merge-toggles.tsx` — fields: result, tables, selCols, colOrder, mergedCols
- `SRC/preact/ui/sections/filter-list.tsx` — fields: tables, filters

**Pattern to apply:**
- Reactive: `const { tables, filters } = useStore(s => ({ tables: s.tables, filters: s.filters }));`
- Imperative: `buildReportSpecFromState(getStore().getState())` instead of `buildReportSpecFromState(state)`
- All `state.xxx` references must be replaced with destructured local variables

## Phases

### Phase 1: Scope selectors in filter-list.tsx and merge-toggles.tsx
- [x] In `SRC/preact/ui/sections/filter-list.tsx`, replace `const state = useStore(s => s)` (L187) with `const { tables, filters } = useStore(s => ({ tables: s.tables, filters: s.filters }))`, then replace `buildReportSpecFromState(state)` with `buildReportSpecFromState(getStore().getState())` and update `state.tables` → `tables` and `state.filters` → `filters`
    **Note:** Replaced `useStore(s => s)` with scoped selector `useStore(s => ({ tables: s.tables, filters: s.filters }))`. Replaced `buildReportSpecFromState(state)` with `buildReportSpecFromState(getStore().getState())`. Removed redundant `const filters = state.filters` line. Updated `state.tables` → `tables`. Zero typecheck/lint errors in this file.
- [x] In `SRC/preact/ui/sections/merge-toggles.tsx`, replace `const state = useStore(s => s)` (L21) with `const { result, tables, selCols, colOrder, mergedCols } = useStore(s => ({ result: s.result, tables: s.tables, selCols: s.selCols, colOrder: s.colOrder, mergedCols: s.mergedCols }))`, then replace `buildReportSpecFromState(state)` with `buildReportSpecFromState(getStore().getState())` and update all `state.xxx` references to use destructured locals
    **Note:** Replaced `useStore(s => s)` with scoped selector destructuring 5 fields (result, tables, selCols, colOrder, mergedCols). Replaced `buildReportSpecFromState(state)` with `buildReportSpecFromState(getStore().getState())`. Removed redundant `const selCols = state.selCols`, `const colOrder = state.colOrder`, and `const mergedCols = state.mergedCols || []` lines — all now use destructured locals directly. `mergedSet` uses `new Set(mergedCols || [])` inline. Zero typecheck/lint errors in this file.
- [x] Run `npm run typecheck && npm run lint && npm test` from SRC/ — all must pass with zero errors
    **Note:** Typecheck: 0 errors in modified files (3 pre-existing errors in column-chips.tsx from Plan C scope — not in this plan's files). Lint: 0 warnings. Tests: 60 files, 1179 tests all pass.

### Phase 2: Scope selectors in lookup-stage.tsx and sort-list.tsx
- [x] In `SRC/preact/ui/sections/lookup-stage.tsx`, replace `const state = useStore(s => s)` (L59) with `const { lookups, tables, base, aggMode } = useStore(s => ({ lookups: s.lookups, tables: s.tables, base: s.base, aggMode: s.aggMode }))`, then replace `buildReportSpecFromState(state)` (L82) with `buildReportSpecFromState(getStore().getState())` and update all `state.xxx` references (L75 `state.lookups` → `lookups`, L78 `state.tables` → `tables`, L79 `state.base` → `base`, L80 `state.aggMode` → `aggMode`)
    **Note:** Replaced `useStore(s => s)` with scoped selector `useStore(s => ({ lookups: s.lookups, tables: s.tables, base: s.base, aggMode: s.aggMode }))`. Replaced `buildReportSpecFromState(state)` with `buildReportSpecFromState(getStore().getState())`. Removed redundant `const tables = state.tables`, `const base = state.base`, and `const aggMode = state.aggMode || 'none'` lines — tables and base use destructured locals directly; aggMode fallback `|| 'none'` inlined at two usage sites (L324, L339). Zero typecheck/lint errors in this file.
- [x] In `SRC/preact/ui/sections/sort-list.tsx`, replace `const state = useStore(s => s)` (L110) with `const { selCols, tables, colOrder, sorts } = useStore(s => ({ selCols: s.selCols, tables: s.tables, colOrder: s.colOrder, sorts: s.sorts }))`, then replace `buildReportSpecFromState(state)` (L113) with `buildReportSpecFromState(getStore().getState())` and update all `state.xxx` references (L112 `state.selCols` → `selCols`, L114 `state.tables` → `tables`, L116 `state.colOrder` → `colOrder`, L119 `state.sorts` → `sorts`)
    **Note:** Replaced `useStore(s => s)` with scoped selector `useStore(s => ({ selCols: s.selCols, tables: s.tables, colOrder: s.colOrder, sorts: s.sorts }))`. Replaced `buildReportSpecFromState(state)` with `buildReportSpecFromState(getStore().getState())`. Removed redundant `const selCols = state.selCols`, `const colOrder = state.colOrder || allCols`, and `const sorts = state.sorts` lines — selCols and sorts use destructured locals directly; colOrder fallback `|| allCols` inlined at filter expression (L115). Updated `buildSourceCatalog(state.tables)` → `buildSourceCatalog(tables)`. Zero typecheck/lint errors in this file.
- [x] Run `npm run typecheck && npm run lint && npm test` from SRC/ — all must pass with zero errors
    **Note:** Typecheck: 0 errors in modified files (4 pre-existing errors in calc-builder.tsx from Plan C scope — not in this plan's files). Lint: 0 warnings. Tests: 60 files, 1179 tests all pass.

## Completion Criteria
- All four files use scoped `useStore` selectors instead of `useStore(s => s)`
- Zero remaining `state.` property accesses derived from the old `useStore(s => s)` call in any of the four files
- All `buildReportSpecFromState()` calls use `getStore().getState()` instead of the local `state` variable
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes all tests

## References
- Design: `artifacts/designs/parts/scoped-selectors/README.md` (Part B scope)
- Contracts: `artifacts/designs/parts/scoped-selectors/CONTRACTS.md` (architectural rules)
- Hook: `SRC/preact/ui/useStore.ts` — `function useStore<T>(selector: (state: AppState) => T): T`
- Sibling plans: TASK-scoped-selectors-A (simple sections), TASK-scoped-selectors-C (complex sections), TASK-scoped-selectors-D (layout-card)
