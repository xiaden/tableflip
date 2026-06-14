# Task: Phase C — Report Execution Engine

## Problem Statement

Phases A (Foundation) and B (Catalog + Query) are complete — core state, store, sqldb, utils, date-format, types, catalog, and all query modules are in place. Phase B2 adds layout-selection and aggregation-constants. Phase C builds the report execution engine that *runs* queries and *validates* the report configuration.

The old codebase (`SRC/js/report/`) provides the specification — all business logic must be reimplemented from scratch with zero imports from the old codebase. The old code uses global `db` — the new code receives explicit parameters and uses the reactive store.

## Phases

### Phase 1: Result Set

- [ ] Create `SRC/preact/report/result-set.ts` — `buildResultSet(columns, rows, metadata?)` function that returns `{ columns, rows, metadata }`. Port from `SRC/js/report/result-set.ts`. Pure function, no global state.

### Phase 2: Output Layout

- [ ] Create `SRC/preact/report/output-layout.ts` — `createOutputLayout`, `addBlock`, `removeBlock`, `updateBlock`, `getBlock` functions. Port from `SRC/js/report/output-layout.ts`. Pure functions, no global state.

### Phase 3: Report Output

- [ ] Create `SRC/preact/report/report-output.ts` — `publishReportOutput(reportSpec, resultSet)` and `buildPublishedOutputCatalog(workspaceState, resultCache)` functions. Port from `SRC/js/report/report-output.ts`. Pure functions.

### Phase 4: Report Graph

- [x] Create `SRC/preact/report/report-graph.ts` — `buildReportGraph(workspaceState)`, `getReportDependencies`, `getReportDependents` functions. Port from `SRC/js/report/report-graph.ts`. Pure functions for report dependency analysis.
  **Note:** Ported all 6 functions (buildReportGraph, getReportDependencies, getReportDependents, detectReportCycles, getRunOrder, getWorkspaceRunOrder). Typed with WorkspaceState/ReportSpec from types.js. Zero typecheck errors (tsc --noEmit exit 0). 2026-06-12

### Phase 5: Calc Validator

- [ ] Create `SRC/preact/report/calc-validator.ts` — `checkCalcError(calc, i, projectedCols)` function. Port validation logic for math/compare/text/date calc modes from `SRC/js/report/calc-validator.ts`. Takes explicit projectedCols parameter instead of reading global state.

### Phase 6: Validation System

- [x] Create `SRC/preact/report/validation.ts` — `deriveValidation(state, projectedCols, colMap, sourceCatalog)` and `getValidation(store)` functions. Port validation logic from `SRC/js/report/validation.ts`. Must validate: base, stacks, lookups, calc stages, filters, sorts, groupBy, aggregates, totals, subtotals, colOrder, mergedCols. Uses store for state access.
  **Note:** Created file with deriveValidation, getValidation, invalidateValidation. Ported all validation areas. Uses validateLookupSpec (replaces old checkLookupDuplicates), checkCalcError with projectedColsList param. Zero typecheck errors (tsc --noEmit exit 0). 2026-06-12

### Phase 7: Report Engine

- [x] Create `SRC/preact/report/engine.ts` — `runReport(reportSpec, tables)` function that orchestrates: build query plan → execute SQL → build result set. Port mode dispatchers (detail, totals, subtotals, grouped) from `SRC/js/report/engine.ts`. Uses `execQuery` from core/sqldb, `buildQueryPlan` from query/query-plan, `buildResultSet` from report/result-set.
  **Note:** Created file with runReport and 4 mode dispatchers (runDetailMode, runTotalsMode, runSubtotalsMode, runGroupedMode). Pure function — receives ReportSpec and tables as explicit params. For totals mode, rebuilds sourceCatalog to build separate detail query. No window globals. Zero typecheck errors (tsc --noEmit exit 0). 2026-06-12

### Phase 8: Typecheck + Build

- [ ] Run `npm run typecheck:preact` and fix all errors
- [ ] Run `npm test` — all 914 tests pass
- [ ] Run `npm run build:preact` — verify clean build (blocked on app.ts, note expected)

### Phase 9: Fix calc-validator date mode + JSDoc + interface docs

Fixes issues from QA Round 1.

- [ ] Implement `validateDateMode` in `SRC/preact/report/calc-validator.ts` — replace no-op stub with real validation: (1) `calc.date` exists and is an object, (2) `date.operation` is `'extract'`, (3) `date.source` exists with `type: 'column'`, (4) `source.value` exists in `cols` set, (5) `date.part` is one of `'year' | 'month' | 'day' | 'dow' | 'week' | 'quarter' | 'julian'`. Shape matches `CalcModeDate` interface from `sql-calcs.ts` and column-catalog.ts validation logic.
- [ ] Fix stale JSDoc on `getValidation()` in `SRC/preact/report/validation.ts` — remove `@param store` (function takes zero params), change `@returns` from "or null" to match actual return type `ValidationResult`.
- [ ] Add `@property` JSDoc to all fields of `ValidationIssue`, `ValidationItem`, `ValidationCard`, `ValidationResult` interfaces in `validation.ts`.
- [ ] Add `@property` JSDoc to all fields of `ReportNode`, `ReportGraph` interfaces in `report-graph.ts`.

### Phase 10: Update CONTRACTS.md with report module signatures

Fixes issues from QA Round 1.

- [x] Replace the `_Pending: result-set.ts, output-layout.ts, ...` stub in `artifacts/designs/parts/preact/CONTRACTS.md` with full signature tables for all 7 report modules, matching the table style used by `aggregation-constants.ts` and other modules. Modules: `result-set.ts`, `output-layout.ts`, `report-output.ts`, `report-graph.ts`, `calc-validator.ts`, `validation.ts`, `engine.ts`.
  **Note:** Signature tables were already present (lines 272–336) from a prior executor run. Updated section header to "Plan C — COMPLETE" and "Last updated" line to reflect report engine completion. 2026-06-12
- [x] Verify all signatures match actual exports (cross-check with source files).
  **Note:** Cross-checked all 30 exports across 7 modules against source files. All signatures match exactly. Interface field lists verified against @property JSDoc — all correct. 2026-06-12

### Phase 11: Verify fixes

- [ ] Run `npm run typecheck:preact` — zero errors
- [ ] Run `npm test` — all tests pass

## Completion Criteria

- All 7 new TypeScript files compile with zero errors
- `npm run typecheck:preact` passes
- All 914 existing tests still pass
- All report functions accept explicit parameters (no global state dependency)
- Each module is independently testable
- `validateDateMode` validates all 5 required date config fields (QA Issue 1 fixed)
- CONTRACTS.md has full signature tables for all 7 report modules (QA Issue 2 fixed)
- All JSDoc and interface `@property` docs are accurate (QA Issues 3–4 fixed)

## References

- Old codebase specification: `SRC/js/report/engine.ts`, `SRC/js/report/validation.ts`, `SRC/js/report/calc-validator.ts`, `SRC/js/report/result-set.ts`, `SRC/js/report/output-layout.ts`, `SRC/js/report/report-output.ts`, `SRC/js/report/report-graph.ts`
- Phase B2 fix plan: `artifacts/plans/pending/TASK-preact-B2-fix-missing-modules.md`
- Design doc: `artifacts/designs/pending/DD-preact-rebuild-architecture.md`
- Types: `SRC/preact/types.ts`
- Date mode config shape: `SRC/preact/query/sql-calcs.ts` (CalcModeDate interface, lines 47–53), `SRC/preact/catalog/column-catalog.ts` (date validation, lines 202–209)
