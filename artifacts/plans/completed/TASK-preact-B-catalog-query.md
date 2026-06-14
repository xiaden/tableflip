# Task: Phase B — Catalog + Query Generation

## Problem Statement

Phase A (Foundation) is complete — core state, store, sqldb, utils, date-format, types, and globals are all in place. Phase B builds the business logic that understands *what columns exist* and *how to generate SQL queries* from a report specification.

This is the query engine brain: given a `WorkspaceState` (base table, lookups, filters, groupBy, aggregates, calc stages), it must produce correct SQL that SQLite can execute. The old codebase (`SRC/js/query/` and `SRC/js/catalog/`) provides the specification — all business logic must be reimplemented from scratch with zero imports from the old codebase.

The old codebase uses a single mutable `db` global. The new code receives explicit parameters (state, sourceCatalog) and returns pure data — no side effects.

## Phases

### Phase 1: Source Catalog

- [x] Create `catalog/source-catalog.ts` — `buildSourceCatalog(tables)` function that takes `Record<string, TableInfo>` (from AppState) and returns `Map<string, SourceTableEntry>` with `{ id, name, cols, kind, source }` for each table. Port logic from `SRC/js/catalog/source-catalog.ts`.

### Phase 2: Column Catalog Expansion

- [x] Expand `catalog/column-catalog.ts` — add `buildColumnCatalog(reportSpec, sourceCatalog)` that returns `{ colMap, lookupBoundaries, reportSpec }`. This is the catalog-based API (distinct from the simpler `buildColSourceMap`). Port validation logic for calc stages from `SRC/js/catalog/column-catalog.ts`.
- [x] Add `projectedCols(ctx)` and `projectedColsUpToLookup(upTo, ctx)` functions to `catalog/column-catalog.ts`.

### Phase 3: SQL Where Clause

- [x] Create `query/sql-where.ts` — `buildWhere(filters, colMap, colState)` function. Port all filter operators (=, !=, >, >=, <, <=, contains, starts_with, ends_with, in, not_in, is_null, is_not_null) and AND/OR logic from `SRC/js/query/sql-where.ts`.

### Phase 4: SQL Joins

- [x] Create `query/sql-joins.ts` — `buildJoins(lookups, colMap, sourceCatalog)` function. Handles INNER/LEFT joins, key pair conditions, multi-pair AND logic, prefix-based aliasing. Port from `SRC/js/query/sql-joins.ts`.

### Phase 5: SQL Aggregates

- [x] Create `query/sql-aggregates.ts` — `buildAggregates(aggregates, aggMode, colMap)` function. Returns `{ selects, groupBy }` with SQLite aggregate expressions (SUM, COUNT, AVG, MIN, MAX, GROUP_CONCAT). Port from `SRC/js/query/sql-aggregates.ts`.

### Phase 6: SQL Detail Query

- [x] Create `query/sql-detail.ts` — `buildDetailQuery(reportSpec, colMap)` function. Generates full SELECT with all projected columns, aliases, WHERE, JOINs, ORDER BY. Port from `SRC/js/query/sql-detail.ts`.

### Phase 7: SQL Grouped Query

- [x] Create `query/sql-grouped.ts` — `buildGroupedQuery(reportSpec, colMap)` function. Generates GROUP BY query with aggregates, HAVING, and group column projections. Port from `SRC/js/query/sql-grouped.ts`.

### Phase 8: Calculated Columns SQL

- [x] Create `query/sql-calcs.ts` — `buildCalcExpressions(calcStages, colMap)` function. Returns array of `{ alias, sql }` for each valid calc stage. Port math/compare/text/date calc SQL generation from `SRC/js/query/sql-calcs.ts`.

### Phase 9: SQL Totals

- [x] Create `query/sql-totals.ts` — `buildTotalsQuery(reportSpec, colMap)` function. Generates totals/subtotals SQL with GROUP BY ROLLUP or UNION ALL patterns. Port from `SRC/js/query/sql-totals.ts`.

### Phase 10: SQL Subtotals

- [x] Create `query/sql-subtotals.ts` — `buildSubtotalsQuery(reportSpec, colMap)` function. Handles subtotal strategies (spacer rows, merged groups, grand totals). Port from `SRC/js/query/sql-subtotals.ts`.

### Phase 11: Lookup Resolver

- [x] Create `query/lookup-resolver.ts` — `expandLookups(lookups, sourceCatalog)` function. Resolves lookup references to actual table metadata, validates key pairs, returns enriched lookup specs. Port from `SRC/js/query/lookup-resolver.ts`.

### Phase 12: Query Plan Builder

- [x] Create `query/query-plan.ts` — `buildQueryPlan(reportSpec, sourceCatalog)` function. Orchestrates all query modules: builds source catalog → column catalog → joins → where → aggregates → detail/grouped → totals/subtotals → final SQL. Port from `SRC/js/query/query-plan.ts`.

### Phase 13: Typecheck + Build

- [x] Run `npm run typecheck:preact` and fix all errors
- [ ] Run `npm run build:preact` and verify clean build

## Completion Criteria

- All 12 new/expanded TypeScript files compile with zero errors
- `npm run typecheck:preact` passes
- `npm run build:preact` produces clean bundle
- All SQL generation functions accept explicit parameters (no global state dependency)
- Each module is independently testable

## References

- Old codebase specification: `SRC/js/catalog/source-catalog.ts`, `SRC/js/catalog/column-catalog.ts`, `SRC/js/query/*.ts`
- Phase A foundation: `artifacts/plans/pending/TASK-preact-A-foundation.md` (completed)
- Design document: `artifacts/designs/pending/DD-preact-rebuild-architecture.md`
- Types: `SRC/preact/types.ts`
- Existing catalog: `SRC/preact/catalog/column-catalog.ts` (has `buildColSourceMap` + `tablePrefix`)
- Existing alias updater: `SRC/preact/query/alias-ref-updater.ts`

## Annotations

### Completion Summary

- **Phases:** 13 (12 implementation + 1 typecheck/build)
- **Files created:** 13 (12 original + 1 shared utility)
- **Fix rounds:** 1 (3 MINOR issues fixed in Round 2)
- **QA review:** PASS (Round 2)

### Files Created/Modified

| File | Action |
|------|--------|
| `catalog/source-catalog.ts` | created |
| `catalog/column-catalog.ts` | expanded (buildColumnCatalog, projectedCols, projectedColsUpToLookup) |
| `query/sql-where.ts` | created |
| `query/sql-joins.ts` | created |
| `query/sql-aggregates.ts` | created |
| `query/sql-detail.ts` | created |
| `query/sql-grouped.ts` | created |
| `query/sql-calcs.ts` | created |
| `query/sql-totals.ts` | created |
| `query/sql-subtotals.ts` | created |
| `query/lookup-resolver.ts` | created |
| `query/query-plan.ts` | created |
| `query/resolve-ref.ts` | created (shared utility, extracted from 9 files) |

### Decisions & Deviations

1. **Shared resolveRef utility:** Extracted `resolveRef(alias, colMap)` from 9 query modules into `query/resolve-ref.ts` to eliminate duplication. This is a minor deviation from the plan (not listed as a phase) but improves maintainability.
2. **Build verification deferred:** Step 13.2 (`npm run build:preact`) is blocked because `SRC/preact/app.ts` (entry point) does not exist yet — this is Phase D (UI Layer) work. Expected and not a defect.
3. **Stacks/duplicate-combine/excludedRows deferred:** The old `renderFromJoinWhere()` handles UNION ALL stacks and duplicate combine mode. These features are not yet implemented in the new `buildJoins()`. This is out of Phase B scope and should be tracked in a follow-up plan.
4. **Tests deferred to Phase 4:** No preact-specific tests exist yet. The old 786 tests validate the old codebase, not the new preact modules. Phase 4 must create preact-specific test files.

### Build Step Blocker

Step 13.2 (`npm run build:preact`) fails because `SRC/preact/app.ts` (entry point) does not exist yet. This is expected — `app.ts` is created in Phase D (UI Layer, step 39). The build step is correctly marked as incomplete in the plan.
