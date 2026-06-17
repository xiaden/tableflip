---
name: report-pipeline-orientation
description: End-to-end report pipeline from data ingestion through SQL generation, report execution, result shaping, output layout, and export. Covers layer responsibilities, entrypoints, invariants, and navigation tips for the five-layer architecture.
---

# Report Pipeline Orientation

## Mental Model

The report pipeline transforms user-configurable report specifications into query results, then shapes those results for display and export. It is a linear data flow through five layers — **core** (infrastructure) → **catalog** (column resolution) → **query** (SQL generation) → **report** (execution & shaping) → **UI** (consumption) — with validation cross-cutting all layers. The pipeline is driven by a reactive state store: UI components mutate `AppState` via `store.update()`, the `RunBar` dispatches `runReport()`, and the result flows back into the grid and export components.

## Coverage

**Documented:** Layer responsibilities, major entrypoints/chokepoints, key data structures, flow across layers, stable invariants, investigation starting points for common pipeline issues, pitfalls.
**Not yet documented:** Test helpers for pipeline fixtures (e.g., `spec()` in integration tests), individual UI card/component internals.
**Last extended:** 2026-06-14

## Subsystem Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│  UI Layer  (SRC/preact/ui/)                                            │
│  PipelineCard → RunBar → ResultGrid / exportAs                          │
│  Aggregation mode switching via setAggMode()/loadAggModeState()          │
└───────────┬─────────────────────────────────────────────────────┬───────┘
            │ store.getState() / store.update()                    │
            ▼                                                     ▼
┌───────────────────────────────┐  ┌──────────────────────────────────┐
│  Catalog Layer                 │  │  Report Layer                     │
│  (preact/catalog/)             │  │  (preact/report/)                 │
│  buildSourceCatalog()          │  │  runReport()          ◄── chokepoint
│  buildColumnCatalog()  ◄── CP  │  │    ├─ buildQueryPlan()  ◄── CP   │
│  buildColSourceMap()           │  │    ├─ runDetailBandsMode()        │
└───────────┬───────────────────┘  │    ├─ runDetailMode()              │
            │                      │    ├─ runTotalsMode()              │
            ▼                      │    ├─ runSubtotalsMode()           │
┌───────────────────────────────┐  │    └─ runGroupedMode()             │
│  Query Layer                    │  │  buildResultSet()  ───→ ResultSet │
│  (preact/query/)                │  │  publishReportOutput()           │
│  buildQueryPlan()    ◄── CP     │  │  deriveValidation()              │
│    ├─ sql-detail.ts             │  └──────────────────────────────────┘
│    ├─ sql-grouped.ts            │
│    ├─ sql-totals.ts             │
│    ├─ sql-subtotals.ts          │
│    ├─ sql-detail-bands.ts       │
│    ├─ sql-where.ts              │
│    ├─ sql-joins.ts              │
│    ├─ sql-calcs.ts              │
│    ├─ sql-aggregates.ts         │
│    ├─ resolve-ref.ts            │
│    └─ lookup-resolver.ts        │
└───────────────────────────────┘
            │
            ▼
┌───────────────────────────────┐
│  Core Layer  (preact/core/)    │
│  store.ts   ── reactive pub/sub│
│  sqldb.ts   ── SQLite exec     │
│  utils.ts   ── formatting etc  │
│  state.ts   ── factory fns     │
└───────────────────────────────┘
```

### Layer Boundaries (Canonical Responsibilities)

| Layer | Owns | Does NOT own |
|-------|------|-------------|
| **Core** (`core/`) | SQLite init, query execution (`execQuery`), identifier quoting (`quoteId`), reactive store (`Store`), date format utils, state factories (`createAppState`) | Column resolution, SQL generation, business logic |
| **Catalog** (`catalog/`) | Building source table metadata (`source-catalog`), resolving column aliases to physical/calc/band entries (`column-catalog`), projection helpers (`projectedCols`, `projectedColsUpToLookup`) | SQL generation, report execution |
| **Query** (`query/`) | SQL generation (SELECT, JOINs, WHERE, GROUP BY, ORDER BY), column reference resolution (`resolveRef`), calc expression generation, lookup validation/expansion, aggregate rendering. All pure functions — no store dependency. | Report execution, result shaping |
| **Report** (`report/`) | Report execution engine (`runReport` → `buildQueryPlan` → `execQuery` → `buildResultSet`), result set construction, validation (`deriveValidation`), output publishing, report dependency graph, calc validation, aggregation constants | UI rendering, SQL generation details |
| **UI** (`ui/`) | React component tree, grid rendering (AG Grid), export (XLSX/CSV), pipeline card interactions, aggregation mode UI, tab switching, file loading | Report execution, SQL generation |

## Key Entrypoints / Chokepoints

### `runReport()` — `report/engine.ts:L544`
The single entry point for report execution. Takes `(reportSpec, tables, stackRowLimit?)` → `ResultSet`. Dispatches to mode-specific handlers (detail, totals, subtotals, group, detail-bands). This is the function the RunBar calls. **Start here when tracing a pipeline bug.**

### `buildQueryPlan()` — `query/query-plan.ts:L133`
The SQL orchestration hub. Builds source catalog → column catalog → source plan → join plans → calc expressions → filters → selected columns → sorts → dispatches to the appropriate SQL builder based on aggMode. Returns `{ sql, params, cols, colMap, ... }`. **Start here when tracing SQL generation issues.**

### `buildColumnCatalog()` — `catalog/column-catalog.ts:L115`
The column resolution backbone. Maps every column alias (base + lookup-prefixed + detail-band-prefixed + calc) to its physical source. Determines prefix generation for collision avoidance. **Start here when a column isn't in the output, or when prefix generation seems wrong.**

### `buildResultSet()` — `report/result-set.ts:L64`
The result set constructor. Simple but critical — every execution path funnels through it. Creates the `{ columns, rows, metadata }` structure. **Start here when output shape looks wrong.**

### `deriveValidation()` — `report/validation.ts:L151`
The single validation engine. Checks every pipeline stage (base table, stacks, lookups, detail bands, calcs, filters, sorts, group-by, aggregates, totals, subtotals, column order, merged columns). Called by `getValidation()` from UI components. **Start here to understand what blocks execution.**

## Data Flow: End-to-End Walkthrough

1. **User configures report** in PipelineCard/LayoutCard/FilterSortCard (mutates AppState via store.update)
2. **User clicks Run** (RunBar calls `runReport(spec, tables)`)
3. `runReport()` calls `buildQueryPlan()` which:
   - Builds `sourceCatalog` from raw table definitions
   - Builds `colMap` (column alias → physical/calc/band entry)
   - Builds join plans from lookups
   - Generates calc SQL expressions
   - Dispatches to `sql-detail`, `sql-grouped`, `sql-totals`, or `sql-subtotals`
4. The SQL + params are passed to `execQuery()` (SQLite WASM)
5. Raw rows go to `buildResultSet()` → typed `ResultSet`
6. If detail bands active and aggMode=none, JS-side stitching in `runDetailBandsMode()`
7. Result flows back to UI: `store.set('result', resultSet)` → ResultGrid re-renders
8. For export: `exportAs('xlsx'|'csv')` reads result from store, applies `createResultTable()` (filters internal rows), `enrichRowsWithBandHeaders()`, `styleExportSheet()`

## Stable Invariants

### Column Resolution

- **Physical columns** resolve to `"tid"."col"` via `resolveRef()`.
- **Calc columns** are quoted by alias — their SQL expression is substituted in the SELECT clause, referenced as `"alias"` in ORDER BY and GROUP BY.
- **Band columns** have `kind: 'band'` in the colMap and are **excluded from main query SELECT** (they have no JOIN in the parent FROM clause). They only participate in band-specific queries generated by `buildBandQuery()`.
- **Lookup column prefixing**: If a right-table column name already exists in the colMap, it's prefixed with `tablePrefix(rightTableName)` (strips em-dash content, appends `__`).
- **Detail band column prefixing**: All band columns get `_{bandId}_` prefix (e.g., `_band_0_Amount`).

### Query Layer

- All query modules are pure functions — no store/global state reads. They receive `colMap`, `sourceCatalog`, `calcExprs` explicitly.
- Parameterized queries: JOIN params come before WHERE params in the merged params array.
- `resolveRef()` is the single source of truth for turning aliases into SQL references. Every SQL module uses it.
- `calcExprs` map is built once in `buildQueryPlan()` from `buildCalcExpressions()` and passed down — calcs are SQL-substituted, not re-evaluated.

### Report Execution

- `runReport()` is the only execution entry point. No other function should call `execQuery()` for report results.
- `buildResultSet()` is the only result set constructor. Every mode handler calls it.
- `invalidateValidation()` must be called after any state mutation, or validation stays stale (trap in AGENTS.md).
- `STACK_ROW_LIMIT = 10_000` caps detail-band stacking mode cross-product rows.
- `RowExplosionError` is thrown for stacking mode overflow — the UI catches this and shows a dialog.

### Aggregation Modes

- **`none`**: Simple SELECT with WHERE/JOINs/ORDER BY. Handles detail bands (JS stitching).
- **`group`**: GROUP BY with aggregate expressions. Single SQL query.
- **`totals`**: Two queries — detail rows (no agg) + a single totals row. Combined in JS.
- **`subtotals`**: UNION ALL of detail + subtotal branches + optional spacers + grand total. Internal marker columns (`_row_type`, `_sort_row_type`, `_sort_group_N`) handle hierarchical ordering.
- Aggregation mode state is saved/restored per-mode via `aggModeState` in the store. Switching modes persists the previous mode's UI state.

### Validation

- `deriveValidation()` is pure — takes explicit params for testability.
- `getValidation()` wraps it with caching — recomputes only when store state reference changes.
- Validation result has `reportStatus: 'healthy' | 'blocked'` and per-card/per-item breakdown.
- First blocking issue prevents report execution and export.

### Output/Export

- `createResultTable()` filters subtotal/spacer rows (`_row_type` check) from published output.
- `_band_id` is always included in published output columns (even if displayCols omits it).
- XLSX export includes band section headers and styling; CSV keeps `_band_id` for downstream consumers.
- Export checks validation before proceeding — blocked reports cannot export.

## Investigation Starting Points

### "The report isn't showing the right columns"
1. Check `colMap` in `buildColumnCatalog()` — is the alias even registered?
2. Check lookup prefixing in `tablePrefix()` — is the column collision-avoiding correctly?
3. Check `buildDetailQuery()` / `buildGroupedQuery()` `filteredProjected` — are band columns being skipped correctly?
4. Check `outputColumns` in the report spec — is there a stale column order hiding the column?
5. Check `deriveValidation()` for stale-column-order warnings.

### "The SQL has wrong JOINs"
1. Start in `buildJoins()` — it generates per-lookup JOIN clauses.
2. Check `resolveRef()` output — wrong table-qualified refs indicate wrong colMap entries.
3. Check `buildColumnCatalog()` — if a column isn't in the colMap, the JOIN won't reference it.

### "The totals/subtotals are wrong"
1. Totals: check `runTotalsMode()` in `engine.ts` — it runs two queries and pads detail rows for new agg columns.
2. Subtotals: check `buildSubtotalsQuery()` — internal marker columns (`_row_type`, `_sort_group_*`) drive ordering.
3. Calc columns with `PCTTOTAL` or `ROLLAVG` ops produce incorrect totals/subtotals — validation warns about this.
4. Check `aggregation-constants.ts` for valid function names — wrong names silently produce no aggregation.

### "Detail bands aren't working"
1. First check `runDetailBandsMode()` in `engine.ts` — it executes parent query, then per-band batched queries.
2. Check `buildBandQuery()` — it generates `WHERE child_key IN (?, ?, ...)` for deduplicated parent key values.
3. Band columns `kind: 'band'` in colMap are skipped by main query builders — verify this filtering.
4. `interleaveRows()` (separate mode) vs `crossProductRows()` (stacking mode) handle the JS-side stitching.
5. Check `STACK_ROW_LIMIT` and `RowExplosionError` if stacking mode blows up.

### "The export looks wrong"
1. Check `createResultTable()` for row filtering (`_row_type` check).
2. Check `filterExportCols()` for which internal columns are filtered (XLSX vs CSV differ on `_band_id`).
3. Check `enrichRowsWithBandHeaders()` for band header insertion.
4. Check `styleExportSheet()` for row-kind styling.
5. If merge display is wrong, check `applyExportMerges()` for the merge logic.

## Pitfalls / Gotchas

- **`invalidateValidation()` must be called after any state mutation** — or validation won't re-run and the Run button stays disabled. This is listed in AGENTS.md but easy to forget.
- **SQL identifiers must use `quoteId()`** — never concatenate table/column names directly into SQL strings. The `sqldb.ts` `execQuery()` appends the SQL to error messages on failure.
- **Calc columns can't reference themselves** — the `trail` set in `buildCalcExpressions()` detects circular references and returns `NULL`.
- **Multi-key concatenation** uses `|||` separator consistently across `sql-joins.ts` (for JOIN ON conditions across two key pairs) and `sql-detail-bands.ts` (for batched WHERE IN with composite keys).
- **Empty filter values** (`vals` array) are treated as a single empty string — the `renderFilter()` function produces `CAST(...) = ''` for empty values.
- **Detail band columns are excluded from main query SELECT** — they have no JOIN. If you need a main-query reference to a child table, use a lookup instead of a detail band.
- **`outputColumns` can mask bugs** — if a column is missing from the result but present in the colMap, check whether `outputColumns` (the explicit column-order list) is filtering it.
- **`window`/`document` access must be guarded** — the React bundle runs in jsdom during tests, so `typeof window !== 'undefined'` checks are required around browser-specific code.

## Sources

- `SRC/preact/report/engine.ts` — Report execution engine, mode dispatchers
- `SRC/preact/query/query-plan.ts` — Query plan orchestrator
- `SRC/preact/catalog/column-catalog.ts` — Column alias resolution
- `SRC/preact/report/validation.ts` — Full validation logic
- `SRC/preact/report/result-set.ts` — Result set construction
- `SRC/preact/report/report-output.ts` — Output publishing
- `SRC/preact/query/sql-detail.ts` — Detail SQL gen (canonical example)
- `SRC/preact/query/sql-joins.ts` — JOIN clause generation
- `SRC/preact/query/sql-where.ts` — WHERE clause generation
- `SRC/preact/query/sql-calcs.ts` — Calc expression rendering
- `SRC/preact/query/sql-aggregates.ts` — Aggregate expression rendering
- `SRC/preact/query/sql-subtotals.ts` — Subtotals UNION ALL SQL
- `SRC/preact/query/sql-detail-bands.ts` — Band query generation
- `SRC/preact/query/resolve-ref.ts` — Shared alias→ref resolver
- `SRC/preact/query/lookup-resolver.ts` — Lookup validation/expansion
- `SRC/preact/report/aggregation-constants.ts` — Valid function names
- `SRC/preact/report/calc-validator.ts` — Per-calc-stage validation
- `SRC/preact/core/sqldb.ts` — SQLite wrapper
- `SRC/preact/types.ts` — All shared interfaces
- `SRC/preact/tests/integration/full-pipeline.test.ts` — Integration test fixture
