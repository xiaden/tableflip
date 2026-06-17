# Temp-Table Pipeline — Completion Manifest

**Feature:** temp-table-pipeline
**Completed:** 2026-06-17

## Execution Summary

| Part | Plan | Steps | Review Rounds | Status |
|------|------|-------|---------------|--------|
| A | Data Model & Serialization | 10 | 1 | DONE |
| B | Pipeline Stage Functions | 8 | 1 (1 bug fix) | DONE |
| C | Pipeline Engine & Integration | 8 | 2 | DONE |
| D | Cleanup — Delete Old Code | 5 | 1 | DONE |
| E | UI for Source Column & Stack Aliases | 7 | 1 | DONE |
| **Total** | | **38** | | |

## Design Deviations

| Decision | Rationale |
|----------|-----------|
| Stage functions use `quoteId(alias)` instead of `resolveRef()` | Query utilities produce source-qualified refs that don't work with flat temp tables |
| Part C absorbed deletion of mode-runners and SQL dispatch | Tightly coupled to buildQueryPlan refactoring — isolating would create broken intermediate state |
| Filter stage gained operator aliases (=, !=, <>, >, <, >=, <=, in, not in) | Needed for temp-table WHERE generation — `buildWhere` wasn't usable directly in flat table context |
| Calc stage strips table prefixes from calc expressions | buildCalcExpressions produces qualified refs; temp table context needs unqualified column names |

## Key Decisions

- Pipeline invalidation: invalidate self + all downstream on any state change
- Totals mode: single temp table with `_row_type` marker (0=detail, 1=totals, same as subtotals)
- Source column: literal in SELECT clause of each UNION ALL branch (not ALTER TABLE + UPDATE)
- Stack aliases: stored in ReportSpec.pipeline (per-report config)
- Pipeline state: module-level transient (like validation cache), not serialized
- Detail bands: separate execution path, reads from `_pipeline_stage_4`

## Files Created/Modified

**Core layer:**
- `SRC/preact/types.ts` — modified (3 new fields on AppState + ReportSpec.pipeline)
- `SRC/preact/core/state.ts` — modified (defaults in createAppState, createReportSpec, buildReportSpecFromState)
- `SRC/preact/core/state-serializer.ts` — modified (serialization of new fields)
- `SRC/preact/core/state-hydrator.ts` — modified (hydration with safe fallbacks)
- `SRC/preact/core/state-schema.ts` — modified (STATE_VERSION 2→3)

**Report layer:**
- `SRC/preact/report/pipeline-engine.ts` — created (PipelineEngine class + module-level singleton)
- `SRC/preact/report/pipeline-stages/base.ts` — created (StageContext, StageResult, StageFunction, executeBaseStage)
- `SRC/preact/report/pipeline-stages/lookups.ts` — created (executeLookupStage)
- `SRC/preact/report/pipeline-stages/calcs.ts` — created (executeCalcStage)
- `SRC/preact/report/pipeline-stages/filters.ts` — created (executeFilterStage)
- `SRC/preact/report/pipeline-stages/sorts.ts` — created (executeSortStage)
- `SRC/preact/report/pipeline-stages/aggregation.ts` — created (executeAggregationStage + 3 mode helpers)
- `SRC/preact/report/engine.ts` — modified (runReport→PipelineEngine, mode-runners deleted, detail bands integration)
- `SRC/preact/report/preview-builder.ts` — modified (365→98 lines, SELECT from temp tables)
- `SRC/preact/report/validation.ts` — modified (PRAGMA table_info() with colMap fallback)

**Query layer:**
- `SRC/preact/query/query-plan.ts` — modified (BuiltQueryPlan→QueryPlanConfigs, SQL dispatch removed)
- `SRC/preact/query/sql-detail.ts` — deleted
- `SRC/preact/query/sql-grouped.ts` — deleted
- `SRC/preact/query/sql-totals.ts` — deleted
- `SRC/preact/query/sql-subtotals.ts` — deleted

**UI layer:**
- `SRC/preact/ui/cards/pipeline-card.tsx` — modified (source column checkbox + name input)
- `SRC/preact/ui/sections/stack-sheets.tsx` — modified (per-stack alias TextField)

**Tests (created by QA):**
- `SRC/preact/tests/report/pipeline-stages/base.test.ts`
- `SRC/preact/tests/report/pipeline-stages/lookups.test.ts`
- `SRC/preact/tests/report/pipeline-stages/calcs.test.ts`
- `SRC/preact/tests/report/pipeline-stages/filters.test.ts`
- `SRC/preact/tests/report/pipeline-stages/sorts.test.ts`
- `SRC/preact/tests/report/pipeline-stages/aggregation.test.ts`
- `SRC/preact/tests/report/pipeline-stages/pipeline-integration.test.ts`
- `SRC/preact/tests/report/pipeline-engine.test.ts`
- `SRC/preact/tests/report/validation-pipeline-state.test.ts`
- `SRC/preact/tests/ui/pipeline-card.test.tsx`
- `SRC/preact/tests/ui/stack-sheets.test.tsx`
- `SRC/preact/tests/core/state-serializer.test.ts` — modified
- `SRC/preact/tests/core/state.test.ts` — modified
- `SRC/preact/tests/query/query-plan.test.ts` — modified
- `SRC/preact/tests/query/query-plan-bands.test.ts` — modified
- `SRC/preact/tests/integration/full-pipeline.test.ts` — modified
- `SRC/preact/tests/integration/band-columns-catalog.test.ts` — modified
- `SRC/preact/tests/report/preview-builder.test.ts` — modified

**Deleted:**
- `SRC/preact/tests/query/sql-detail.test.ts`
- `SRC/preact/tests/query/sql-grouped.test.ts`
- `SRC/preact/tests/query/sql-totals.test.ts`
- `SRC/preact/tests/query/sql-subtotals.test.ts`
- `SRC/preact/tests/query/calc-columns-execution.test.ts`

## Final Lint Status

| Check | Result |
|-------|--------|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 warnings |
| `npm test` | 1282 tests passing |
