# Task: Replace useStore(s => s) with scoped selectors in 4 simple section files

## Problem Statement

Four UI components use `useStore(s => s)` which subscribes to the entire AppState, causing unnecessary re-renders on any state change. This violates the selector-based design decision resolved in Open Question #2 of the Preact-to-React conversion DD. These four files are the simplest cases — each reads only 1-3 state fields and none call `buildReportSpecFromState(state)`, so the change is purely replacing the hook call and updating property access references.

**Files in scope:**
- `SRC/preact/ui/sections/base-stage.tsx` — fields: base, tables, aggMode
- `SRC/preact/ui/sections/run-bar.tsx` — fields: base
- `SRC/preact/ui/sections/stack-sheets.tsx` — fields: base, tables, stacks
- `SRC/preact/ui/cards/filter-sort-card.tsx` — fields: base

**Pattern to apply:**
- Reactive: `const { base, tables } = useStore(s => ({ base: s.base, tables: s.tables }));`
- All `state.xxx` references replaced with destructured local variables
- No `buildReportSpecFromState` calls in these files — no imperative-read changes needed
- `getStore().update()` mutation calls remain unchanged

## Phases

### Phase 1: Scope selectors in base-stage.tsx and run-bar.tsx
- [x] In `SRC/preact/ui/sections/base-stage.tsx`, replace `const state = useStore(s => s)` (L43) with `const { base, tables, aggMode } = useStore(s => ({ base: s.base, tables: s.tables, aggMode: s.aggMode }))`, remove the three `const base = state.base` / `const tables = state.tables` / `const aggMode = state.aggMode` lines (L47-48, L51), and update all remaining `state.base` → `base`, `state.tables` → `tables`, `state.aggMode` → `aggMode` references throughout the component
    **Note:** base-stage.tsx: replaced useStore(s => s) with scoped selector { base, tables, aggMode: s.aggMode || 'none' }, removed redundant const base/tables/aggMode lines. No state.xxx refs remain.
- [x] In `SRC/preact/ui/sections/run-bar.tsx`, replace `const state = useStore(s => s)` (L27) with `const { base } = useStore(s => ({ base: s.base }))`, remove the `const base = state.base` line (L30), and verify no other `state.` references remain (the `runQuery` callback already uses `getStore().getState()` for imperative reads)
    **Note:** run-bar.tsx: replaced useStore(s => s) with scoped selector { base }, removed redundant const base line. No state.xxx refs remain (runQuery callback correctly uses getStore().getState() for imperative reads).
- [x] Run `npm run typecheck && npm run lint && npm test` from SRC/ — all must pass with zero errors
    **Note:** Validation passed: typecheck 0 errors, lint 0 warnings, 1179 tests pass (60 files). Note: stash/pop incident during execution required restoring working tree from stash — all files verified correct after restore.

### Phase 2: Scope selectors in stack-sheets.tsx and filter-sort-card.tsx
- [x] In `SRC/preact/ui/sections/stack-sheets.tsx`, replace `const state = useStore(s => s)` (L29) with `const { base, tables, stacks } = useStore(s => ({ base: s.base, tables: s.tables, stacks: s.stacks }))`, remove the three `const base = state.base` / `const tables = state.tables` / `const stacks = state.stacks` lines (L32-34), and update all remaining `state.base` → `base`, `state.tables` → `tables`, `state.stacks` → `stacks` references throughout the component
    **Note:** stack-sheets.tsx: replaced useStore(s => s) with scoped selector { base, tables, stacks: s.stacks || [] }, removed redundant const base/tables/stacks lines (L32-34). No state.xxx refs remain. Default empty array for stacks inlined in selector.
- [x] In `SRC/preact/ui/cards/filter-sort-card.tsx`, replace `const state = useStore(s => s)` (L33) with `const { base } = useStore(s => ({ base: s.base }))`, remove the `const base = state.base` line (L35), and verify no other `state.` references remain
    **Note:** filter-sort-card.tsx: replaced useStore(s => s) with scoped selector { base }, removed redundant const base line. No state.xxx refs remain.
- [x] Run `npm run typecheck && npm run lint && npm test` from SRC/ — all must pass with zero errors
    **Note:** Validation: lint 0 errors (verified on both modified files), 1179 tests pass (60 files). Typecheck has 1 pre-existing error in calc-stage.tsx(358) from Plan C (onMathStepChange prop missing from CalcBuilderProps) — NOT caused by Phase 2 changes.

## Completion Criteria
- All four files use scoped `useStore` selectors instead of `useStore(s => s)`
- Zero remaining `state.` property accesses derived from the old `useStore(s => s)` call in any of the four files
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes all tests

## References
- Design: `artifacts/designs/parts/scoped-selectors/README.md` (Part A scope)
- Contracts: `artifacts/designs/parts/scoped-selectors/CONTRACTS.md` (architectural rules)
- Hook: `SRC/preact/ui/useStore.ts` — `function useStore<T>(selector: (state: AppState) => T): T`
- Sibling plans: TASK-scoped-selectors-B (medium sections), TASK-scoped-selectors-C (complex sections), TASK-scoped-selectors-D (layout-card)
