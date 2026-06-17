# Task: Cleanup — Delete Old SQL Generators

## Problem Statement

The temp-table pipeline (Parts A–C) replaces the old SQL-composed query approach with sequential stage functions executed by `PipelineEngine`. Part C removed the `switch(aggMode)` dispatch from `engine.ts`, deleted the mode-runner functions (`runDetailMode`, etc.), refactored `buildQueryPlan()` to return `QueryPlanConfigs` instead of composed SQL, simplified `preview-builder.ts`, and migrated `validation.ts`. After Part C, the four old SQL generator modules — `sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts` — are no longer called by any production code. Part D deletes these dead modules, removes all remaining imports/exports that reference them, and deletes the five test files that exclusively test the deleted code (these files would fail to compile after the source modules are removed).

**Prerequisite:** TASK-temp-table-pipeline-C-engine-integration (Part C) must be executed first.

## Phases

### Phase 1: Delete dead modules and remove all references

- [x] Delete the four old SQL generator source files: `SRC/preact/query/sql-detail.ts`, `SRC/preact/query/sql-grouped.ts`, `SRC/preact/query/sql-totals.ts`, `SRC/preact/query/sql-subtotals.ts`
    **DONE:** Deleted 4 old SQL generator source files: sql-detail.ts, sql-grouped.ts, sql-totals.ts, sql-subtotals.ts
    **Note:** Deleted 4 source files: sql-detail.ts, sql-grouped.ts, sql-totals.ts, sql-subtotals.ts from SRC/preact/query/. Verified none exist on disk.
  **Verification:** None of the four files exist on disk
- [x] Delete the five test files that exclusively test the deleted SQL generators: `SRC/preact/tests/query/sql-detail.test.ts`, `SRC/preact/tests/query/sql-grouped.test.ts`, `SRC/preact/tests/query/sql-totals.test.ts`, `SRC/preact/tests/query/sql-subtotals.test.ts`, `SRC/preact/tests/query/calc-columns-execution.test.ts` (every test in this file calls `buildDetailQuery`/`buildTotalsQuery`/`buildGroupedQuery`/`buildSubtotalsQuery` — no tests survive the deletion)
    **DONE:** Deleted 5 test files: sql-detail.test.ts, sql-grouped.test.ts, sql-totals.test.ts, sql-subtotals.test.ts, calc-columns-execution.test.ts
    **Note:** Deleted 5 test files: sql-detail.test.ts, sql-grouped.test.ts, sql-totals.test.ts, sql-subtotals.test.ts, calc-columns-execution.test.ts from SRC/preact/tests/query/. Verified none exist on disk.
  **Verification:** None of the five files exist on disk
- [x] Remove all exports of deleted module symbols from `SRC/preact/index.ts`: delete lines 38–39 (`buildDetailQuery`, `DetailQueryResult`), lines 40–41 (`buildGroupedQuery`, `GroupedQueryResult`), lines 43–44 (`buildTotalsQuery`, `TotalsQueryResult`), lines 45–46 (`buildSubtotalsQuery`, `SubtotalsQueryResult`, `SubtotalStrategy`). Keep line 42 (`buildCalcExpressions`) and lines 47–48 (`buildBandQuery`) — these are not deleted
    **DONE:** Removed 8 dead export lines from index.ts (lines 38-41, 43-46). Kept buildCalcExpressions and buildBandQuery/BandQueryResult.
    **Note:** Removed 8 dead export lines from SRC/preact/index.ts (lines 38-41, 43-46): buildDetailQuery, DetailQueryResult, buildGroupedQuery, GroupedQueryResult, buildTotalsQuery, TotalsQueryResult, buildSubtotalsQuery, SubtotalsQueryResult, SubtotalStrategy. Kept buildCalcExpressions (line 42), buildBandQuery/BandQueryResult (lines 47-48). Verified zero matches for deleted module names and symbols in index.ts.
  **Verification:** `grep -n 'sql-detail\|sql-grouped\|sql-totals\|sql-subtotals' SRC/preact/index.ts` returns zero matches; `grep -n 'buildDetailQuery\|buildGroupedQuery\|buildTotalsQuery\|buildSubtotalsQuery\|DetailQueryResult\|GroupedQueryResult\|TotalsQueryResult\|SubtotalsQueryResult\|SubtotalStrategy' SRC/preact/index.ts` returns zero matches
- [x] Remove dead imports from `SRC/preact/query/query-plan.ts` and `SRC/preact/report/engine.ts`. In `query-plan.ts`: remove imports of `buildDetailQuery` (line 23), `buildGroupedQuery` (line 24), `buildTotalsQuery` (line 25), `buildSubtotalsQuery` (line 26) — Part C should have removed these during the `buildQueryPlan()` refactoring, but verify and remove if still present. In `engine.ts`: remove import of `buildDetailQuery` (line 23) — Part C should have removed this during `runReport()` integration, but verify and remove if still present. Search for any other files in `SRC/preact/` that still reference the four deleted modules or their exported symbols and remove those references
    **DONE:** Verified no dead imports remain in query-plan.ts, engine.ts, or any other production file. Part C already cleaned these.
    **Note:** Verified no dead imports remain. Broader grep across SRC/preact/ shows only: (1) sql-detail-bands references (module stays), (2) setSubtotalStrategy from ui/aggregation.ts (stays), (3) provenance comment in aggregation.ts line 121 (stays). query-plan.ts and engine.ts are clean — no imports of deleted modules.
  **Verification:** `grep -rn 'sql-detail\|sql-grouped\|sql-totals\|sql-subtotals' SRC/preact/ --include='*.ts'` returns zero matches (excluding `sql-detail-bands` which is a separate module and stays)
- [x] Run `npm run typecheck && npm run lint && npm test` from `SRC/` — zero typecheck errors, zero lint warnings, all tests pass. Fix any dangling references discovered (e.g., a file that imported a type from a deleted module)
    **DONE:** typecheck: 0 errors, lint: 0 warnings, test: 1282/1282 passing. QA-Reviewer PASS with TestAnalyzer + DocsAnalyzer sub-reviews.
    **Note:** All verification gates pass: typecheck 0 errors, lint 0 warnings, tests 65 files / 1282 tests all passing. No dangling references found.
  **Notes:** Watch for: (a) `SubtotalStrategy` type was re-exported from `index.ts` — verify no UI file imports it from the barrel export; (b) `calc-columns-execution.test.ts` imports `buildCalcExpressions` and `execQuery` alongside the deleted builders — the whole file is deleted so this is moot, but verify no other test file imports from the deleted modules

## Completion Criteria

- Files `sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts` do not exist in `SRC/preact/query/`
- Test files `sql-detail.test.ts`, `sql-grouped.test.ts`, `sql-totals.test.ts`, `sql-subtotals.test.ts`, `calc-columns-execution.test.ts` do not exist in `SRC/preact/tests/query/`
- `SRC/preact/index.ts` has zero exports referencing the four deleted modules or their types
- No file in `SRC/preact/` contains an import of `buildDetailQuery`, `buildGroupedQuery`, `buildTotalsQuery`, or `buildSubtotalsQuery` (excluding `sql-detail-bands.ts` which is a separate module)
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References

- Design doc: `artifacts/designs/pending/DD-temp-table-pipeline.md`
- Parts breakdown: `artifacts/designs/parts/temp-table-pipeline/README.md` — Part D scope
- Contracts ledger: `artifacts/designs/parts/temp-table-pipeline/CONTRACTS.md` — Deletion Contracts table
- Prerequisite plan: `TASK-temp-table-pipeline-C-engine-integration` (Part C) — removed mode dispatch, mode runners, and `buildQueryPlan()` SQL composition
- Retained module: `query/sql-detail-bands.ts` — NOT deleted; used by `runDetailBandsMode()` in `engine.ts`
