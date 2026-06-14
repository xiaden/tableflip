---
name: query-layer-orientation
description: Architectural orientation for the SQL query construction layer. Covers module responsibilities, data flow, invariants, and debugging guidance. Use before modifying any SQL generation code.
---

# Query Layer Orientation

## Mental Model

The query layer translates a `ReportSpec` (high-level report definition: base table, lookups, filters, sorts, aggregation config) into parameterized SQL queries that execute against sql.js (SQLite). It sits between the **catalog layer** (which builds column metadata from the report spec) and the **report engine** (which runs the SQL and builds result sets).

The central entry point is `buildQueryPlan()` in `query-plan.ts`. This function is a **pure orchestrator** — it takes a `ReportSpec` + `DbTable` records, calls catalog builders, delegates SQL generation to mode-specific query builders, and returns a `BuiltQueryPlan` (containing intermediate plan data + final SQL + params + projected columns). The report engine calls `buildQueryPlan()` once per report execution.

All query modules are **pure functions** (no global state, no store access). They receive explicit parameters (`colMap`, `sourceCatalog`, `calcExprs`) and return structured results. The `colMap` (column alias → physical/calc/band source) is the universal connector — every SQL generator resolves aliases through it via `resolveRef()`.

## Coverage

**Documented:** Module ownership boundaries, orchestration hierarchy, stable data-flow invariants (alias resolution, calc expression passing, grouped/detail divergence, band column handling), practical debugging guidance, and change-risk zones.

**Not yet documented:** The relationship between query-layer types and the UI aggregation state (how user interactions with the AggregationCard map to `aggregation` config fields). Also not covered: the `stacks`/UNION feature path (only filtering to known tables happens in query-plan.ts — actual UNION generation is elsewhere).

**Last extended:** 2026-06-14

## Source Files

All files referenced here are in `SRC/preact/query/`.

| File | Role | Type |
|------|------|------|
| `query-plan.ts` | Overall orchestrator — calls catalog, resolves lookups, dispatches to query builders | Orchestrator |
| `sql-detail.ts` | Builds SELECT for non-aggregated mode (aggMode='none') | Query builder |
| `sql-grouped.ts` | Builds SELECT with GROUP BY + aggregates (aggMode='group') | Query builder |
| `sql-totals.ts` | Builds single aggregate row (aggMode='totals') | Query builder |
| `sql-subtotals.ts` | Builds UNION ALL of detail + subtotal + spacer + grand total (aggMode='subtotals') | Query builder |
| `sql-detail-bands.ts` | Builds per-band batched queries for child rows (band feature) | Query builder |
| `sql-joins.ts` | Builds JOIN clauses from `LookupSpec[]` (INNER/LEFT, multi-pair AND) | Leaf helper |
| `sql-where.ts` | Builds WHERE clause from `FilterSpec[]` (AND across filters, OR within vals) | Leaf helper |
| `sql-calcs.ts` | Builds SQL expressions for calculated columns (math/compare/text/date modes) | Leaf helper |
| `sql-aggregates.ts` | Renders aggregate function SQL (SUM, COUNT, AVG, etc.) | Leaf helper |
| `resolve-ref.ts` | Shared alias→SQL reference resolution (`"tid"."col"` for physical, `"alias"` for calc/band) | Shared helper |
| `alias-ref-updater.ts` | Post-rename alias fixup in global `db` object (legacy bridge, not part of pure pipeline) | Bridge helper |
| `lookup-resolver.ts` | Lookup validation, expansion, duplicate detection, combine policy application | Leaf helper |
| `layout-selection.ts` | Column visibility management, post-combine layout sync, calls store directly | Store-aware |

## Key Findings

### Orchestration Hierarchy

```
buildQueryPlan()                           ← pure orchestrator, call once per report run
  ├─ buildSourceCatalog()                  ← from catalog layer
  ├─ buildColumnCatalog()                  ← from catalog layer: produces colMap
  ├─ buildCalcExpressions()                ← sql-calcs.ts: produces calcExprs map
  ├─ buildJoins()                          ← sql-joins.ts: called by each query builder
  ├─ buildWhere()                          ← sql-where.ts: called by each query builder
  └─ ONE OF:                              ← dispatch on aggMode
       ├─ buildDetailQuery()               ← aggMode='none'
       ├─ buildGroupedQuery()              ← aggMode='group'
       ├─ buildTotalsQuery()               ← aggMode='totals'
       └─ buildSubtotalsQuery()            ← aggMode='subtotals'
```

Each query builder receives the same four parameters: `(reportSpec, colMap, sourceCatalog, calcExprs)`. They are structurally symmetric — same signatures, same parameter semantics.

### The colMap — Universal Connector

`colMap: Map<string, ColMapEntry>` is produced by `buildColumnCatalog()` in the catalog layer. It maps every available column alias to its source:
- **Physical:** `{ tid: "Orders", col: "Amount" }` → resolves to `"Orders"."Amount"`
- **Calc:** `{ kind: "calc", idx: 0, mode: "math" }` → resolves to its SQL expression (used via `calcExprs`)
- **Band:** `{ kind: "band", tid: "Items", col: "Price" }` → resolves to quoted alias only (no JOIN in parent FROM)

Every SQL generator calls `resolveRef(alias, colMap)` to get a table-qualified SQL reference for physical columns. Calc columns are short-circuited (the `calcExprs` map provides the inline SQL expression instead). Band columns are filtered out of the main query SELECT entirely; they only appear in band-specific queries.

### Calc Expression Passing Pattern

Calculated columns follow a **two-phase** approach:
1. `buildCalcExpressions()` in `sql-calcs.ts` produces `Array<{alias, sql}>` — the SQL expression strings.
2. These are assembled into `calcExprs: Map<string, string>` by `query-plan.ts`.

Each query builder checks `calcExprs.get(alias)` before calling `resolveRef()`. When found, the calc SQL is used directly in SELECT, ORDER BY, GROUP BY, and aggregate inner references. Calc expressions can reference other calc expressions (traversal tracked via `trail: Set<string>` in `sql-calcs.ts`).

### Grouped vs Detail Behavior Divergence

**sql-detail.ts:**
- Projects all (or filtered) columns as individual SELECT items
- ORDER BY from reportSpec.sorts
- No GROUP BY, no HAVING
- Simpler assembly: SELECT → FROM → JOIN → WHERE → ORDER BY

**sql-grouped.ts:**
- Two sub-phases within SELECT: GROUP BY columns first, then aggregate expressions
- Builds `groupRefs[]` for GROUP BY clause (same references as SELECT items)
- Skips band columns (same pattern as detail)
- When no groupBy/aggregates are configured (`hasAgg = false`), falls back to projecting all columns (same as detail mode)
- ORDER BY uses `resolveRef()` (not alias) to avoid ambiguity in grouped queries
- HAVING clause is reserved but currently unused (empty string)

**sql-totals.ts:**
- Each column either gets an aggregate expression or `NULL AS alias`
- Returns `null` if no column has a configured total function (caller throws)
- No ORDER BY (single row)

**sql-subtotals.ts:**
- Produces UNION ALL of multiple SELECT branches with internal marker columns (`_row_type`, `_sort_row_type`, `_sort_group_N`)
- `_row_type`: 0=detail, 1=subtotal, 2=spacer, 3=grand total
- Two strategies: `nested` (one GROUP BY per prefix depth) or `combined` (single GROUP BY)
- Null filter on subtotal branches: excludes rows where ALL subtotalBy columns are NULL
- Subtotals on top swaps sort type markers (0↔1) so subtotals sort before detail

### Band Column Handling

Band columns (`kind: 'band'`) are injected into the `colMap` by `buildColumnCatalog()` with a `_{bandId}_` prefix. They represent columns from child tables in a detail-band relationship (1:N fan-out).

**Critical invariant:** Band columns have no JOIN in the main query's FROM clause. Every query builder (detail, grouped, totals, subtotals) filters them out of the main SELECT projection using `entry.kind !== 'band'`. This is checked in:
- `sql-detail.ts` line 77-80
- `sql-grouped.ts` line 85-88 (via `isBand()` helper)
- `sql-totals.ts` line 78-81
- `sql-subtotals.ts` line 88-91

Band-specific queries are built separately by `sql-detail-bands.ts` and executed by the report engine (which stitches parent and child results together in JS).

### `buildWhere()` — Filter Semantics

`sql-where.ts` has a specific AND/OR nesting pattern:
- **Filters are ANDed:** each enabled filter in the array becomes a conjunct
- **Values are ORed:** multiple values in a single filter's `vals` array produce OR-connected sub-expressions
- **Operator normalization:** legacy string operators ("equals", "not equals", "starts with", "ends with", "is empty", "not empty") are normalized to canonical forms
- **Numeric hint:** calc columns in `math` mode use `CAST(... AS REAL)` for comparison operators; text columns are cast for `=` / `!=` / `IN`
- **LIKE escaping:** `%` and `_` in user values are escaped for LIKE patterns
- **Division safety:** `IN` with no values returns null (skipped)
- **is_null/is_not_null:** check both IS NULL and empty string

### Lookup Resolver (lookup-resolver.ts)

This module is a **validation and enrichment** layer, not part of the SQL generation pipeline. It:
- Validates that `rightId` exists in the source catalog
- Filters key pairs to complete pairs (both left+right specified)
- Validates right-side columns exist in the referenced table
- Detects duplicate key combinations in right-table rows (for the combine policy)
- Applies combine policy to merge duplicate rows into one

`expandLookups()` is called separately by the report engine for validation purposes. `buildQueryPlan()` builds join plans directly from `reportSpec.pipeline.lookups`, not from the resolved lookups.

### alias-ref-updater.ts — Legacy Bridge

This module is **not** part of the pure query pipeline. It accesses `window.__db` directly to update filter/sort/group/aggregate/band column references after a column rename. It's a mutation-based bridge for the legacy global state that coexists with the reactive store. New code should not add dependencies on this module.

### layout-selection.ts — Store-Aware Mutations

This module manages column visibility (`selCols`), tooltip samples, and post-combine synchronization. It reads/writes the reactive store via `getStore()`. It is called by UI event handlers (add/remove source table, add/remove lookup), not by the SQL generation pipeline. Key responsibilities:
- Toggle columns visible/invisible in output
- Sync `subtotalBy` to match current column order
- Handle post-combine cleanup (add new columns, remove stale ones)
- Safely hide lookup columns only when no other lookup references them

## Critical Invariants

1. **Query modules are pure.** No query module (`sql-*.ts`, `resolve-ref.ts`, `lookup-resolver.ts`) accesses the store, `window`, or global state. They receive everything they need as parameters.

2. **calcExprs takes priority over resolveRef.** Every query builder checks `calcExprs.get(alias)` before calling `resolveRef()`. Breaking this order breaks calculated column support everywhere.

3. **Band columns are always filtered from main queries.** Every query builder filters `kind === 'band'` from SELECT, ORDER BY, and GROUP BY. If you add a new query mode or modify an existing one, you must apply the same filter.

4. **column order = params order.** Query builders assemble params in a predictable order: JOIN params first, then WHERE params. The subtotals builder duplicates filter params for each UNION ALL branch. Breaking this order breaks parameterized query execution.

5. **resolveRef returns `"tid"."col"` for physical, `"alias"` for calc/band.** Calc columns have no physical table to qualify against; band columns have no parent FROM join to reference. Using `resolveRef()` output in a context that expects a physical table reference (e.g., JOIN ON clause) will produce wrong SQL for calc/band columns.

6. **Each query builder builds its own JOINs and WHERE.** They are not passed pre-built; they call `buildJoins()` and `buildWhere()` internally. If you change how JOINs or WHERE are built, all four mode builders are affected.

## Investigation Entrypoints

### Incorrect SQL output

1. **Check the aggMode.** The `buildQueryPlan()` switch statement dispatches to exactly one query builder. If the wrong mode is active, the wrong builder runs. Verify `reportSpec.aggregation.mode`.

2. **Check colMap contents.** Many SQL bugs come from missing or wrong colMap entries. `buildColumnCatalog()` in the catalog layer is the source of truth. Verify that the expected aliases exist and point to the right table/column.

3. **Check calcExprs resolution.** If a calc expression produces wrong SQL, trace through `sql-calcs.ts` → `renderCalcExpr()` → the mode-specific renderer (math/compare/text/date). The `trail` set prevents infinite recursion between mutually referencing calcs.

4. **Check filter operator semantics.** `buildWhere()` normalizes operator names. If a filter produces no WHERE clause, check whether `renderClause()` returned null (e.g., empty IN list, unrecognized operator).

5. **Check JOIN ON conditions.** `buildJoins()` uses `resolveRef()` for the left side but builds right-side references manually as `"rightId"."col"`. If the left-side alias maps to a calc expression, the JOIN ON clause will contain a calc expression, which is usually wrong.

### Incorrect query-plan behavior

1. **Trace the orchestration in `query-plan.ts`.** The function has numbered sections (1–11). Each section feeds into the next. Break at the dispatch point (step 10) to determine which query builder is responsible.

2. **Look for `filter` calls.** `query-plan.ts` filters lookups (line 174), filters (line 200), sorts (line 215), output columns (line 210). If something is unexpectedly missing from the plan, check whether an intermediate filter removed it.

3. **Check the subtotals null filter.** `sql-subtotals.ts` adds `AND (col IS NOT NULL OR ...)` to subtotal branches. If subtotal rows are unexpectedly missing, this filter may be overly aggressive (e.g., when all subtotalBy columns legitimately have nulls in the source data).

### Debugging session workflow

1. Run `npm test` to see if existing tests pass (tests in `SRC/preact/tests/query/`)
2. Add a failing test case that constructs the exact `ReportSpec` and checks `plan.sql`
3. Use the test helper `normalizeSql()` for whitespace-insensitive comparison
4. For subtotals: inspect the UNION ALL branches and the `_row_type` markers
5. For bands: trace through the report engine's band execution path (engine.ts → `buildBandQuery()` + JS stitching)

## Change-Risk Zones

### High Risk — Affects all query builders

- **Changing the `buildCalcExpressions()` return type** — all four mode builders depend on `calcExprs: Map<string, string>`.
- **Changing `resolveRef()` semantics** — used everywhere: SELECT, JOIN ON, WHERE, ORDER BY, GROUP BY, HAVING, aggregate inner refs.
- **Changing `colMap` or `ColMapEntry` type** — used by every query builder, every test helper, and the catalog layer.
- **Adding a new aggregation mode** — requires new dispatch branch in `query-plan.ts`, new query builder module, new engine handler in `report/engine.ts`, and new result-set handling.

### Medium Risk — Affects a sub-family

- **Adding/removing filter operators** — changes only `sql-where.ts` `renderClause()`, but every mode uses `buildWhere()`.
- **Changing JOIN generation** — changes only `sql-joins.ts`, but every mode uses `buildJoins()`.
- **Modifying subtotal strategy** — changes `sql-subtotals.ts`; both `nested` and `combined` modes must be kept consistent.

### Low Risk — Isolated to one builder

- **Detail-specific changes** (LIMIT/OFFSET, output column filtering) — only `sql-detail.ts`
- **Grouped-specific changes** (HAVING, group ref generation) — only `sql-grouped.ts`
- **Totals-specific changes** (NULL padding, totals function selection) — only `sql-totals.ts`
- **Band query changes** — only `sql-detail-bands.ts` (standalone module)

## Common Mistakes

1. **Forgetting to filter band columns** in a new query builder or modified SELECT projection. Without filtering, band columns produce invalid SQL since there's no JOIN for the child table.

2. **Using the alias in ORDER BY instead of resolveRef()** — in grouped queries, ORDER BY must use the same expression as SELECT (aliases in ORDER BY are valid but the query builder uses `resolveRef()` to be safe). Changing this can break cross-referencing.

3. **Mixing up `aggMode` strings** — the values are `'none'`, `'group'`, `'totals'`, `'subtotals'`. Typo `'groups'` silently falls through to default (detail mode).

4. **Assuming `buildTotalsQuery()` always returns a result** — it returns `null` when no column has a configured total. The caller (`query-plan.ts`) throws in that case.

5. **Modifying `calcExprs` inside a query builder** — it should be treated as read-only. The map is built once by `query-plan.ts` and passed to all builders.

6. **Accessing the store or global state in a query module** — this breaks the purity invariant and makes the code untestable. Use the catalog layer if you need store-derived data.

## Sources

- Files examined: All 14 modules in `SRC/preact/query/`, all types in `SRC/preact/types.ts`, `SRC/preact/catalog/column-catalog.ts`, `SRC/preact/catalog/source-catalog.ts`, `SRC/preact/report/engine.ts`, `SRC/preact/report/result-set.ts`, `SRC/preact/index.ts`, test helpers in `SRC/preact/tests/query/helpers.ts`, and `SRC/preact/tests/query/query-plan.test.ts`.
