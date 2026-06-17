# Temp-Table Pipeline — Implementation Parts

## Parts

| Part | Title | Depends On | Layers |
| --- | --- | --- | --- |
| A | Data Model & Serialization | None | Core, Types |
| B | Pipeline Stage Functions | A | Report, Query |
| C | Pipeline Engine & Integration | A, B | Report, Query, Catalog |
| D | Cleanup — Delete Old Code | C | Query, Report |
| E | UI for Source Column & Stack Aliases | C | UI |

## Dependency Graph

```
A
│
▼
B
│
▼
C
│
├──────────┐
▼          ▼
D          E
```

## Execution Rounds

Round 1: A (no deps — foundation types, serialization, defaults)
Round 2: B (depends on A for types — stage functions)
Round 3: C (depends on A, B for types + stage functions — engine + integration)
Round 4: D, E (both depend on C — D deletes old code, E adds UI now that pipeline works)

## Per-Part Scope

### Part A: Data Model & Serialization

Adds the three new fields (`includeSourceColumn`, `sourceColumnName`, `stackAliases`) to both `AppState` and `ReportSpec.pipeline`. Updates state factory defaults, serialization, hydration, and schema versioning. All changes are additive — existing `.rcjson` files load with safe defaults (`false`, `"Source Sheet"`, `{}`). No behavior changes — the pipeline doesn't use these fields yet.

**Files touched:** `types.ts`, `core/state.ts`, `core/state-serializer.ts`, `core/state-hydrator.ts`, `core/state-schema.ts`

**Contracts exposed downstream:** Type definitions for `includeSourceColumn: boolean`, `sourceColumnName: string`, `stackAliases: Record<string, string>` on both `AppState` and `ReportSpec.pipeline`.

### Part B: Pipeline Stage Functions

Creates the `report/pipeline-stages/` directory with six stage modules: `base.ts` (UNION ALL across base + stacks, source column literal injection), `lookups.ts` (LEFT/INNER JOINs against temp table), `calcs.ts` (calculated column expressions in SELECT), `filters.ts` (WHERE clause application), `sorts.ts` (ORDER BY application), `aggregation.ts` (group/totals/subtotals mode dispatch). Each stage is a pure function: `(StageContext) => StageResult`. Unit-tested independently — each test provides a mock temp table and verifies the stage's output. These modules import from the Query layer (`buildWhere`, `buildCalcExpressions`, `resolveRef`, `renderAggregateExpr`) and Catalog layer (`buildColumnCatalog`, `buildSourceCatalog`) — they live in Report layer but lean on existing Query/Catalog utilities.

**Files created:** `report/pipeline-stages/base.ts`, `report/pipeline-stages/lookups.ts`, `report/pipeline-stages/calcs.ts`, `report/pipeline-stages/filters.ts`, `report/pipeline-stages/sorts.ts`, `report/pipeline-stages/aggregation.ts`

**Contracts exposed downstream:** `StageContext` interface, `StageResult` interface, `StageFunction` type, each stage function's signature.

### Part C: Pipeline Engine & Integration

Creates `PipelineEngine` class in `report/pipeline-engine.ts` with `execute()`, `invalidateFromStage()`, and `cleanup()`. Refactors `buildQueryPlan()` into a config-builder that returns stage configs (source plan, join plans, calc expressions, filters, sorts, aggregation config) instead of composed SQL. Updates `runReport()` to use `PipelineEngine` instead of `buildQueryPlan()` + mode dispatch. Simplifies `preview-builder.ts` to do `SELECT * FROM temp_table LIMIT 5` instead of rebuilding catalogs. Migrates `validation.ts` to read temp table schemas via `PRAGMA table_info()` instead of predicting composed query output. Detail bands integration: band execution reads from `_pipeline_stage_4` instead of executing its own parent query. Pipeline state is module-level transient state (not serialized).

**Files created:** `report/pipeline-engine.ts`
**Files modified:** `report/engine.ts` (runReport integration), `query/query-plan.ts` (refactored to config-builder), `report/preview-builder.ts` (simplified), `report/validation.ts` (temp-table schema reading)

**Contracts exposed downstream:** `PipelineEngine` class API (`execute()`, `invalidateFromStage()`, `cleanup()`), `PipelineState` interface, temp table naming convention (`_pipeline_stage_0` through `_pipeline_stage_5`).

### Part D: Cleanup — Delete Old Code

Deletes the four old SQL generators (`sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts`) and their five test files (`sql-detail.test.ts`, `sql-grouped.test.ts`, `sql-totals.test.ts`, `sql-subtotals.test.ts`, `calc-columns-execution.test.ts`). Removes dead barrel exports from `index.ts` (8 export lines referencing deleted module symbols). Verifies no dangling references via `npm run typecheck`, `npm run lint`, and `npm test`. (Dead code removal from `query-plan.ts`, `preview-builder.ts`, `validation.ts`, and `engine.ts` mode dispatch was already done by Part C.)

**Files deleted:** `query/sql-detail.ts`, `query/sql-grouped.ts`, `query/sql-totals.ts`, `query/sql-subtotals.ts`, `tests/query/sql-detail.test.ts`, `tests/query/sql-grouped.test.ts`, `tests/query/sql-totals.test.ts`, `tests/query/sql-subtotals.test.ts`, `tests/query/calc-columns-execution.test.ts`
**Files modified:** `index.ts`

**Contracts exposed downstream:** None. This is purely removal.

### Part E: UI for Source Column & Stack Aliases

Adds a checkbox "Show source sheet column" in `pipeline-card.tsx` (in the stack section). When checked, reveals a text input for `sourceColumnName` (default "Source Sheet"). Adds a per-stack alias text input next to each stack chip in `stack-sheets.tsx` — shows when source column is enabled. Updates the `StackSheets` component to read/write `stackAliases` from the store. Adds integration tests for the new UI elements (checkbox toggles, alias editing, defaults).

**Files modified:** `ui/cards/pipeline-card.tsx`, `ui/sections/stack-sheets.tsx`
**Contracts exposed downstream:** None. UI-only, reads/writes store state defined in Part A.
