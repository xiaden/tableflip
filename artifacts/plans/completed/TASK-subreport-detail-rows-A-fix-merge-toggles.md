# Task: Fix merge-toggles.tsx inline ReportSpec construction

## Problem Statement
PatternEnforcer found that `merge-toggles.tsx` line 23 still constructs a partial ReportSpec inline (`{ base, lookups, calcStages }`) instead of using the canonical `buildReportSpecFromState(state)` helper. This was missed during Plan A's 15 PE amendments. The inline construction is also incomplete — it omits `baseCols`, `stacks`, and `detailBands` fields that `buildReportSpecFromState` includes, meaning `projectedCols` may operate on a stale spec.

Fixes issues from Plan A Round 1 — PatternEnforcer review.

## Phases

### Phase 1: Replace inline ReportSpec with buildReportSpecFromState
- [x] In `SRC/preact/ui/sections/merge-toggles.tsx`, add import `import { buildReportSpecFromState } from '../../core/state';` and replace line 23 (`const reportSpec = { base: state.base, lookups: state.lookups, calcStages: state.calcStages };`) with `const reportSpec = buildReportSpecFromState(state);`
    **Note:** Added `import { buildReportSpecFromState } from '../../core/state';` at line 12 and replaced inline `{ base, lookups, calcStages }` construction at line 23 with `buildReportSpecFromState(state)`. This was the last remaining call site missed by PE-6–11.
- [x] Run `npm run typecheck` from `SRC/` — must pass with zero errors
    **Note:** `npm run typecheck` — zero errors.
- [x] Run `npm test` from `SRC/` — all tests must pass
    **Note:** `npm test` — 672/672 tests passed across 36 test files.

## Completion Criteria
- `merge-toggles.tsx` no longer contains inline ReportSpec construction
- `buildReportSpecFromState` is imported from `../../core/state`
- Typecheck and tests pass cleanly
