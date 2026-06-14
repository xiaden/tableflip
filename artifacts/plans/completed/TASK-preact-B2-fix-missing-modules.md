# Task: Phase B Fix — Missing Shared Modules

## Problem Statement

Phase B (Catalog + Query) was completed and QA-passed, but the shared modules it creates have gaps that downstream phases need. Specifically:

1. `query/layout-selection.ts` was not created — needed by validation (Phase C) and UI (Phase E)
2. `report/aggregation-constants.ts` was not created — needed by validation (Phase C) and aggregation UI (Phase E)

These modules are referenced by the old codebase at `SRC/js/query/layout-selection.ts` and `SRC/js/ui/components/aggregation-constants.ts` respectively.

## Phases

### Phase 1: Layout Selection Module

- [ ] Create `SRC/preact/query/layout-selection.ts` — port column layout/selection logic from `SRC/js/query/layout-selection.ts`. Must provide `_isSourceVisibleInLayout`, `_showLayoutAliasesForSource`, `_hideLayoutAliasesForSource`, `_hideLookupLayoutAliasesSafely`, `_sampleTipFor`, `_seenCols`, `_previewOpen`, `_disabledCardCols`, `_afterCombineChange`, `_syncSubtotalByToLayout`, `_isAliasVisibleInLayout`. Uses store instead of global `db`.
- [ ] Verify typecheck passes

### Phase 2: Aggregation Constants Module

- [ ] Create `SRC/preact/report/aggregation-constants.ts` — port aggregation function constants from `SRC/js/ui/components/aggregation-constants.ts`. Must export `AGG_FNS`, `AGG_LABELS`, `AGG_NEEDS_COL`, `TOTAL_FNS`, `TOTAL_LABELS`, `SUBTOTAL_FNS`, `SUBTOTAL_LABELS`, `AGG_MODES`, `getAggregateLabel`, `getTotalLabel`, `getSubtotalLabel`, `isValidAggregateFn`, `isValidTotalFn`, `isValidSubtotalFn`, `aggregateNeedsColumn`.
- [ ] Verify typecheck passes

### Phase 3: Verification

- [ ] Run `npm run typecheck:preact` — zero errors
- [ ] Run `npm test` — all 914 tests pass
- [ ] Run `npm run build:preact` — verify clean build (blocked on app.ts, note expected)

## Completion Criteria

- Both new files compile with zero errors
- No imports from old codebase (`SRC/js/`)
- `npm run typecheck:preact` passes
- All 914 existing tests still pass

## References

- Old layout selection: `SRC/js/query/layout-selection.ts`
- Old aggregation constants: `SRC/js/ui/components/aggregation-constants.ts`
- Phase B plan: `artifacts/plans/pending/TASK-preact-B-catalog-query.md`
- Design doc: `artifacts/designs/pending/DD-preact-rebuild-architecture.md`
