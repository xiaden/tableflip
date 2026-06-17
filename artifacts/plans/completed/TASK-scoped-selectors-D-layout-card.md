# Task: Replace useStore(s => s) with scoped selectors in layout-card.tsx

## Problem Statement

`cards/layout-card.tsx` contains four `useStore(s => s)` calls across four sub-components, subscribing each to the entire AppState and causing unnecessary re-renders on any state change. This is the most complex component in the UI layer — LayoutCard alone reads 11 fields and passes full state to `buildReportSpecFromState()` and `getHint()`. This violates the selector-based design decision resolved in Open Question #2 of the Preact-to-React conversion DD.

Each sub-component must switch to a scoped selector covering only the fields it reads reactively. Calls that pass full state to helper functions (`buildReportSpecFromState`, `getHint`) switch to `getStore().getState()` for imperative access.

**File in scope:**
- `SRC/preact/ui/cards/layout-card.tsx` — four sub-components:
  - **TotalsSection** (L92): fields `selCols`, `colTotals`
  - **SubtotalsSection** (L139): fields `subtotalBy`, `selCols`, `subtotalFns`
  - **AggregateItems** (L226): fields `selCols`, `aggregates`, `groupBy`
  - **LayoutCard** (L347): fields `base`, `aggMode`, `tables`, `colOrder`, `selCols`, `groupBy`, `subtotalGrandTotal`, `subtotalSpacer`, `subtotalOnTop`, `subtotalStrategy`, `mergeGroupUnderline`

**Pattern to apply:**
- Reactive: `const { selCols, colTotals } = useStore(s => ({ selCols: s.selCols, colTotals: s.colTotals }));`
- Imperative: `buildReportSpecFromState(getStore().getState())` instead of `buildReportSpecFromState(state)`
- All `state.xxx` references must be replaced with destructured local variables

## Phases

### Phase 1: Scope selectors in sub-components (TotalsSection, SubtotalsSection, AggregateItems)
- [x] In `SRC/preact/ui/cards/layout-card.tsx`, replace `const state = useStore(s => s)` in TotalsSection (L92) with `const { selCols, colTotals } = useStore(s => ({ selCols: s.selCols, colTotals: s.colTotals }))`, then update `state.selCols` (L95) → `selCols` and `state.colTotals` (L112) → `colTotals`
    **Note:** Replaced `useStore(s => s)` with scoped selector `useStore(s => ({ selCols: s.selCols, colTotals: s.colTotals }))` in TotalsSection (L92). Updated `state.selCols` → `selCols` (L95) and `state.colTotals[col]` → `colTotals[col]` (L112).
- [x] In `SRC/preact/ui/cards/layout-card.tsx`, replace `const state = useStore(s => s)` in SubtotalsSection (L139) with `const { subtotalBy, selCols, subtotalFns } = useStore(s => ({ subtotalBy: s.subtotalBy, selCols: s.selCols, subtotalFns: s.subtotalFns }))`, then update `state.subtotalBy` (L142) → `subtotalBy`, `state.selCols` (L143) → `selCols`, and `state.subtotalFns` (L197) → `subtotalFns`
    **Note:** Replaced `useStore(s => s)` with scoped selector `useStore(s => ({ subtotalBy: s.subtotalBy, selCols: s.selCols, subtotalFns: s.subtotalFns }))` in SubtotalsSection (L139). Used local `subBy = subtotalBy || []` to avoid redeclaration conflict with destructured name. Updated `state.subtotalBy` → `subBy` (L142, L176, L180), `state.selCols` → `selCols` (L143), `state.subtotalFns[col]` → `subtotalFns[col]` (L197).
- [x] In `SRC/preact/ui/cards/layout-card.tsx`, replace `const state = useStore(s => s)` in AggregateItems (L226) with `const { selCols, aggregates, groupBy } = useStore(s => ({ selCols: s.selCols, aggregates: s.aggregates, groupBy: s.groupBy }))`, then update `state.selCols` (L229) → `selCols`, `state.aggregates` (L231) → `aggregates`, and `state.groupBy` (L232) → `groupBy`
    **Note:** Replaced `useStore(s => s)` with scoped selector `useStore(s => ({ selCols: s.selCols, aggregates: s.aggregates, groupBy: s.groupBy }))` in AggregateItems (L226). Removed local `const aggregates = state.aggregates` and `const groupBy = state.groupBy` assignments — now destructured directly. Updated `state.selCols` → `selCols` (L229).
- [x] Run `npm run typecheck && npm run lint && npm test` from SRC/ — all must pass with zero errors
    **Note:** Verification: typecheck 0 errors in layout-card.tsx (9 pre-existing errors in calc-stage.tsx/column-chips.tsx from other plans), lint 0 warnings in layout-card.tsx (2 pre-existing in detail-band-stage.tsx), all 1179 tests pass.

### Phase 2: Scope selector in LayoutCard and switch imperative reads
- [x] In `SRC/preact/ui/cards/layout-card.tsx`, replace `const state = useStore(s => s)` in LayoutCard (L347) with `const { base, aggMode, tables, colOrder, selCols, groupBy, subtotalGrandTotal, subtotalSpacer, subtotalOnTop, subtotalStrategy, mergeGroupUnderline } = useStore(s => ({ base: s.base, aggMode: s.aggMode, tables: s.tables, colOrder: s.colOrder, selCols: s.selCols, groupBy: s.groupBy, subtotalGrandTotal: s.subtotalGrandTotal, subtotalSpacer: s.subtotalSpacer, subtotalOnTop: s.subtotalOnTop, subtotalStrategy: s.subtotalStrategy, mergeGroupUnderline: s.mergeGroupUnderline }))`, then update all `state.xxx` references: L349 `state.base` → `base`, L352 `state.aggMode` → `aggMode`, L354 `state.tables` → `tables`, L356 `state.colOrder` → `colOrder`, L359 `state.selCols` → `selCols`, L426 `state.groupBy` → `groupBy`, L467 `state.subtotalGrandTotal` → `subtotalGrandTotal`, L479 `state.subtotalSpacer` → `subtotalSpacer`, L491 `state.subtotalOnTop` → `subtotalOnTop`, L506 `state.subtotalStrategy` → `subtotalStrategy`, L533 `state.mergeGroupUnderline` → `mergeGroupUnderline`
    **Note:** Replaced `useStore(s => s)` with scoped selector destructuring 11 fields (base, aggMode, tables, colOrder, selCols, groupBy, subtotalGrandTotal, subtotalSpacer, subtotalOnTop, subtotalStrategy, mergeGroupUnderline) in LayoutCard (L345). Updated all 11 `state.xxx` references to destructured names: L347 `base`, L349 `aggMode`, L351 `tables`, L353 `colOrder`, L356 `selCols`, L424 `groupBy`, L465 `subtotalGrandTotal`, L477 `subtotalSpacer`, L489 `subtotalOnTop`, L504 `subtotalStrategy`, L531 `mergeGroupUnderline`.
- [x] Switch `buildReportSpecFromState(state)` (L353) to `buildReportSpecFromState(getStore().getState())` and `getHint(mode, state)` (L362) to `getHint(mode, getStore().getState())` — these are render-path calls that need the full state object but should not create subscription dependencies beyond the scoped selector
    **Note:** Switched `buildReportSpecFromState(state)` → `buildReportSpecFromState(getStore().getState())` (L350) and `getHint(mode, state)` → `getHint(mode, getStore().getState())` (L359). These are render-path calls needing the full state object — using imperative read avoids creating subscription dependencies beyond the scoped selector.
- [x] Run `npm run typecheck && npm run lint && npm test` from SRC/ — all must pass with zero errors
    **Note:** Verification: typecheck 0 errors, lint 0 warnings (full eslint clean), all 1179 tests pass (60 test files).

## Completion Criteria
- All four `useStore(s => s)` calls in layout-card.tsx replaced with scoped selectors
- Zero remaining `state.` property accesses derived from the old `useStore(s => s)` calls
- Both `buildReportSpecFromState()` and `getHint()` calls use `getStore().getState()` instead of the local `state` variable
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes all tests

## References
- Design: `artifacts/designs/parts/scoped-selectors/README.md` (Part D scope)
- Contracts: `artifacts/designs/parts/scoped-selectors/CONTRACTS.md` (architectural rules)
- Hook: `SRC/preact/ui/useStore.ts` — `function useStore<T>(selector: (state: AppState) => T): T`
- Sibling plans: TASK-scoped-selectors-A (simple sections), TASK-scoped-selectors-B (medium sections), TASK-scoped-selectors-C (complex sections)
