# Task: Fix Calc Column Execution and Enable Band Columns in Main Query Catalog

## Problem Statement

Two deferred issues from the detail bands feature (Plans A-D) remain unresolved:

**Issue 1 (PE-13/PE-14):** Adding band columns to `catalogCtx` in `buildQueryPlan()` and `runTotalsMode()` breaks the main query SQL. Band columns appear in the SELECT clause but have no JOIN in the FROM clause, causing `no such column` errors. This was deliberately skipped during Plan A execution.

**Issue 2 (Calc columns in bands):** Calc columns return alias strings instead of computed values in all non-aggregated queries. The root cause: `resolveRef()` returns `quoteId(alias)` for calc entries, producing SQL like `"DoubleAmount" AS "DoubleAmount"`. SQLite's default DQS behavior treats unmatched double-quoted identifiers as string literals, so every row gets the alias string instead of the computed value. The actual SQL expressions exist in `plan.calculatedColumns` but are never injected into the query builders.

Both issues stem from the same architectural gap: the four query builders (`sql-detail.ts`, `sql-totals.ts`, `sql-subtotals.ts`, `sql-grouped.ts`) receive a `colMap` that conflates physical columns, calc columns, and band columns, but have no mechanism to distinguish them during SELECT clause generation.

**Impact:**
- Issue 1: Band columns cannot be added to the catalog context, limiting UI column picker functionality
- Issue 2: Calc columns silently return wrong values in detail/totals/subtotals/grouped queries — a data corruption bug affecting all reports using calculated columns

## Phases

### Phase 1: Fix Calc Column Execution in Query Builders

- [x] Add `calcExprs: Map<string, string>` parameter to `buildDetailQuery()` in `SRC/preact/query/sql-detail.ts` (line 48)
    **Note:** Added calcExprs: Map&lt;string, string&gt; = new Map() parameter to buildDetailQuery() in sql-detail.ts (line 61). Default empty map preserves backward compatibility.
- [x] In `buildDetailQuery()` SELECT loop (lines 74-77), check `calcExprs.get(alias)` before calling `resolveRef()` — if found, use the calc expression SQL directly
    **Note:** In buildDetailQuery() SELECT loop, added calcExprs.get(alias) check before resolveRef(). Also updated ORDER BY to use calc expressions for calc column sorts.
- [x] Add `calcExprs: Map<string, string>` parameter to `buildTotalsQuery()` in `SRC/preact/query/sql-totals.ts` (line 52)
    **Note:** Added calcExprs parameter to buildTotalsQuery(). In SELECT loop, calc expression is used as the inner ref for renderAggregateExpr() — e.g. SUM(&lt;calc_expr&gt;) AS alias.
- [x] In `buildTotalsQuery()` SELECT loop (lines 78-85), apply the same calc expression check before `resolveRef()`
    **Note:** In buildTotalsQuery() SELECT loop, used calcExpr ?? resolveRef() pattern for the inner ref of aggregate expressions.
- [x] Add `calcExprs: Map<string, string>` parameter to `buildSubtotalsQuery()` in `SRC/preact/query/sql-subtotals.ts` (line 89)
    **Note:** Added calcExprs parameter to buildSubtotalsQuery(). Added local ref() helper that checks calcExprs before resolveRef(). Updated all 3 SELECT builders (detail, subtotal via makeSubSel, grand total via subAggExpr), null filter, spacer SELECT, and all 3 GROUP BY clauses to use ref() instead of resolveRef().
- [x] In `buildSubtotalsQuery()`, apply calc expression check in all three SELECT builders: detail (line 137), subtotal (line 168), and grand total (line 199)
    **Note:** All three SELECT builders (detail, subtotal, grand total) plus spacer SELECT, null filter, and GROUP BY clauses now use the ref() helper which checks calcExprs first.
- [x] Add `calcExprs: Map<string, string>` parameter to `buildGroupedQuery()` in `SRC/preact/query/sql-grouped.ts` (line 56)
    **Note:** Added calcExprs parameter to buildGroupedQuery(). Updated all three SELECT paths: group columns, aggregate expressions (inner ref), and no-aggregation fallback. Also updated ORDER BY to use calc expressions.
- [x] In `buildGroupedQuery()` SELECT loop (lines 86-113), apply calc expression check before `resolveRef()`
    **Note:** All SELECT loops in buildGroupedQuery() now check calcExprs.get(alias) before resolveRef(). Group columns use calc expr directly; aggregate expressions use calc expr as inner ref; no-agg fallback uses calc expr in place of resolveRef.
- [x] In `buildQueryPlan()` (`SRC/preact/query/query-plan.ts`), build `calcExprs` map from `plan.calculatedColumns` array (lines 201-202) and pass it to the dispatched query builder
    **Note:** In buildQueryPlan(), built calcExprs Map from calculatedColumns array (alias→sql) right after buildCalcExpressions() call. Passed calcExprs as 4th arg to all four query builder dispatches in the switch statement.
- [x] In `runTotalsMode()` (`SRC/preact/report/engine.ts`), build `calcExprs` map from `reportSpec.pipeline.calculatedColumns` and pass it to `buildTotalsQuery()` and `buildSubtotalsQuery()` calls
    **Note:** In runTotalsMode(), added import for buildCalcExpressions. Built calcExprs map from reportSpec.pipeline.calculatedColumns + colMap, passed it to the rebuilt buildDetailQuery() call. Note: the totals query SQL comes from plan.sql (already has calcExprs applied via P1-S9), so only the detail query rebuild needed calcExprs.
- [x] Write execution tests in `SRC/preact/tests/query/calc-columns-execution.test.ts` that verify calc column values in actual query results (not just plan structure)
    **Note:** Created calc-columns-execution.test.ts with 9 tests covering: buildDetailQuery with math/compare calcs + execution verification, buildTotalsQuery with calc in aggregate + execution, buildGroupedQuery with calc as group col and as aggregate inner ref + execution, buildSubtotalsQuery with calc in detail/subtotal/grand total + execution. All tests verify actual SQL execution against test DB.
- [x] Write execution tests in `SRC/preact/tests/report/engine-calc.test.ts` that verify calc columns work in `runReport()` for detail, totals, subtotals, and grouped modes
    **Note:** Created engine-calc.test.ts with 6 tests covering: runReport() detail mode with math and compare calcs, totals mode with aggregate of calc, subtotals mode with calc in detail+subtotal+grand total, grouped mode grouping by calc, grouped mode aggregating calc. All tests verify end-to-end execution through runReport().

### Phase 2: Enable Band Columns in Main Query Catalog Context

- [x] Add `BandColEntry` interface with `kind: 'band'` to the `ColMapEntry` union in `SRC/preact/catalog/column-catalog.ts` (after line 35)
    **Note:** Added BandColEntry interface with kind: 'band' to ColMapEntry union in column-catalog.ts. Also updated ColSourceEntry in types.ts to include band variant, and fixed column-chips.tsx tooltip builder to handle band entries (removed redundant kind !== 'calc' check after calc narrowing).
- [x] Update `buildColumnCatalog()` (lines 159-173) to tag band entries as `{ kind: 'band', tid: band.rightId, col: c }` instead of plain physical entries
    **Note:** Changed buildColumnCatalog() detail band loop to emit { kind: 'band', tid: band.rightId, col: c } instead of plain { tid, col }. Updated existing tests in column-catalog-bands.test.ts to expect kind: 'band' (3 tests updated).
- [x] Update `resolveRef()` in `SRC/preact/query/resolve-ref.ts` to handle `kind: 'band'` — return `quoteId(alias)` (same as calc, since band columns should not be resolved in main queries)
    **Note:** Updated resolveRef() to handle kind: 'band' — returns quoteId(alias) same as calc entries, since band columns have no JOIN in the main query FROM clause.
- [x] Update all four query builders to skip `kind: 'band'` entries in SELECT projection loops — add `if (entry.kind === 'band') continue` before calling `resolveRef()`
    **Note:** Updated all 4 query builders to skip kind: 'band' entries in SELECT projection: sql-detail.ts (filteredProjected + sort filter), sql-totals.ts (filteredProjected), sql-subtotals.ts (toShow filter), sql-grouped.ts (isBand helper + filter in all 3 SELECT paths + sort filter).
- [x] Add `detailBands: reportSpec.pipeline.detailBands || []` to `catalogCtx` in `buildQueryPlan()` (`SRC/preact/query/query-plan.ts` line 149) — this is PE-13
    **Note:** Added detailBands: reportSpec.pipeline.detailBands || [] to catalogCtx in buildQueryPlan() (PE-13).
- [x] Add `detailBands: reportSpec.pipeline.detailBands || []` to `catalogCtx` in `runTotalsMode()` (`SRC/preact/report/engine.ts` line 58) — this is PE-14
    **Note:** Added detailBands: reportSpec.pipeline.detailBands || [] to catalogCtx in runTotalsMode() (PE-14).
- [x] Update `runDetailBandsMode()` band colMap extraction (`SRC/preact/report/engine.ts` lines 436-441) to handle the new `kind: 'band'` tag — ensure band queries still receive physical column references
    **Note:** Updated runDetailBandsMode() band colMap extraction to filter entry.kind === 'band' instead of entry.kind !== 'calc'. This ensures band queries receive only the physical column references tagged for that band.
- [x] Write tests in `SRC/preact/tests/catalog/column-catalog-bands-kind.test.ts` verifying band entries have `kind: 'band'` and are distinguishable from lookup entries
    **Note:** Created column-catalog-bands-kind.test.ts with 12 tests verifying: band entries have kind: 'band', distinguishable from physical (kind: undefined) and calc (kind: 'calc') entries, resolveRef() returns quoted alias for band entries, multiple bands all tagged correctly.
- [x] Write tests in `SRC/preact/tests/query/query-plan-bands.test.ts` verifying `buildQueryPlan()` includes band columns in `plan.colMap` but does not project them in `plan.sql`
    **Note:** Created query-plan-bands.test.ts with 9 tests verifying: band columns in plan.colMap with kind: 'band', band columns NOT in plan.sql/plan.cols across all 4 agg modes (detail, totals, subtotals, grouped), base columns still projected, disabled bands skipped, band column sorts excluded from ORDER BY.
- [x] Write integration test in `SRC/preact/tests/integration/band-columns-catalog.test.ts` verifying end-to-end: band columns available in UI column picker, main query SQL valid, band queries execute correctly
    **Note:** Created band-columns-catalog.test.ts with 8 integration tests verifying: band columns in projectedCols (UI picker), main query SQL valid without band columns, main query executes without errors, band colMap extraction from plan.colMap, buildBandQuery produces valid SQL from extracted entries, full pipeline consistency, buildColumnCatalog with/without detailBands.

## Completion Criteria

- All four query builders accept and use `calcExprs` parameter
- Calc columns return computed values (not alias strings) in detail, totals, subtotals, and grouped queries
- `buildQueryPlan()` includes `detailBands` in `catalogCtx` without breaking main query SQL
- `runTotalsMode()` includes `detailBands` in `catalogCtx` without breaking totals/subtotals SQL
- Band columns are tagged with `kind: 'band'` in colMap and distinguishable from lookup columns
- All four query builders skip `kind: 'band'` entries in SELECT projection
- `runDetailBandsMode()` band queries still work correctly with the new band entry type
- Existing tests pass (no regressions)
- New execution tests verify calc column values in query results
- New tests verify band columns in catalog context without SQL errors
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References

- Design Document: `artifacts/designs/pending/DD-subreport-detail-rows.md`
- Prior Plans: TASK-subreport-detail-rows-A-mvp (PE-13/PE-14 skipped), TASK-subreport-detail-rows-B-multi-band, TASK-subreport-detail-rows-C-export, TASK-subreport-detail-rows-D-polish
- Dead-end logs: L40 (band columns break SQL), L2 (PE-13/PE-14 skipped)
- Research findings: Calc column bug exists in all 4 query builders; no execution tests caught it; `resolveRef()` returns bare alias for calc entries; SQLite DQS behavior masks the bug
