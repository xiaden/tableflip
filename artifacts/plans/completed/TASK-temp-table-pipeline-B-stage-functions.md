# Task: Pipeline Stage Functions

## Problem Statement

The temp-table pipeline architecture (DD-temp-table-pipeline) replaces the current monolithic SQL-composed query approach with six sequential stage functions, each creating a temp table that the next stage reads from. This plan (Part B) creates the `SRC/preact/report/pipeline-stages/` directory with shared types (`StageContext`, `StageResult`, `StageFunction`) and six stage modules: `base.ts`, `lookups.ts`, `calcs.ts`, `filters.ts`, `sorts.ts`, and `aggregation.ts`.

Each stage is a pure function `(ctx: StageContext) => StageResult`. It reads from `ctx.prevTableName` (the output of the previous stage), creates a new temp table via `CREATE TEMP TABLE ... AS SELECT ...`, and returns the output table name plus column list. No-op stages (e.g., no lookups configured) pass through `prevTableName` without creating a new table.

Part A (`TASK-temp-table-pipeline-A-data-model`) must be executed first — it adds `includeSourceColumn`, `sourceColumnName`, and `stackAliases` to `ReportSpec.pipeline`, which `executeBaseStage()` reads for optional source column literal injection.

## Phases

### Phase 1: Shared Types, Base, Lookups, and Calcs Stages

- [x] Create `SRC/preact/report/pipeline-stages/base.ts` exporting: (1) `StageContext` interface with fields `reportSpec: ReportSpec`, `tables: Record<string, DbTable>`, `colMap: Map<string, ColMapEntry>`, `sourceCatalog: Map<string, SourceTableEntry>`, `prevTableName: string`, `stageIndex: number`, `outputColumns: string[]`; (2) `StageResult` interface with fields `outputTableName: string`, `outputColumns: string[]`; (3) `StageFunction` type alias `(ctx: StageContext) => StageResult`; (4) `executeBaseStage(ctx: StageContext): StageResult` function. `executeBaseStage` builds a UNION ALL across `reportSpec.pipeline.base` + `reportSpec.pipeline.stacks`, projecting `baseCols` (or all table cols if `baseCols` is empty) with NULL fallback for missing columns per stack, and optionally appends a source column literal (`JSON.stringify(alias) AS "Source Sheet"`) when `reportSpec.pipeline.includeSourceColumn` is true. Output table is `_pipeline_stage_0`. Pass-through is not possible (base stage always creates the initial temp table). Import `quoteId`, `execQuery` from `core/sqldb`; import types `ReportSpec`, `DbTable` from `types`; import `ColMapEntry` from `catalog/column-catalog`; import `SourceTableEntry` from `catalog/source-catalog`
    **Note:** Created base.ts with shared types (StageContext, StageResult, StageFunction) and executeBaseStage. UNION ALL across base + stacks with NULL fallback for missing columns. Source column support via includeSourceColumn/stackAliases/sourceColumnName.
- [x] Create `SRC/preact/report/pipeline-stages/lookups.ts` exporting `executeLookupStage(ctx: StageContext): StageResult`. When `reportSpec.pipeline.lookups` is empty or all lookups are disabled, return `{ outputTableName: ctx.prevTableName, outputColumns: ctx.outputColumns }` (pass-through). Otherwise, import and call `buildJoins(lookups, colMap, sourceCatalog)` from `query/sql-joins` to get JOIN clauses, then execute `CREATE TEMP TABLE "_pipeline_stage_1" AS SELECT * FROM "<prevTableName>" <joins>`. Return new table name. Import `buildJoins` from `query/sql-joins`; import `quoteId`, `execQuery` from `core/sqldb`
    **Note:** Created lookups.ts with executeLookupStage. Manual JOIN construction (no buildJoins import) — left side uses unqualified temp table column refs, right side uses qualified rightId.col. LEFT/INNER join based on lk.required. Pass-through when no enabled lookups.
- [x] Create `SRC/preact/report/pipeline-stages/calcs.ts` exporting `executeCalcStage(ctx: StageContext): StageResult`. When `reportSpec.pipeline.calculatedColumns` is empty or all calcs are disabled, return pass-through. Otherwise, import and call `buildCalcExpressions(calcStages, colMap)` from `query/sql-calcs` to get `{ alias, sql }[]`. If the result is empty, pass-through. Otherwise, build `SELECT *, <sql> AS "<alias>", ... FROM "<prevTableName>"` and create `_pipeline_stage_2`. Return new table name with augmented `outputColumns`. Import `buildCalcExpressions` from `query/sql-calcs`; import `quoteId`, `execQuery` from `core/sqldb`
    **Note:** Created calcs.ts with executeCalcStage. Uses buildCalcExpressions from query layer, then post-processes SQL with regex /\"(?:[^\"]|\"\")*\"\\./g to strip "tableName". prefixes for flat temp table context. Pass-through when no enabled calcs or no valid expressions.
- [x] Run `npm run typecheck` from `SRC/` — zero errors required. Fix any type issues in the three stage modules before proceeding
    **Note:** Typecheck passed: 0 errors. All three new modules (base.ts, lookups.ts, calcs.ts) compile cleanly under strict mode.
  **Notes:** Part A must be executed before this verification. The three new fields on `ReportSpec.pipeline` (`includeSourceColumn`, `sourceColumnName`, `stackAliases`) must exist for `base.ts` to typecheck.

### Phase 2: Filters, Sorts, and Aggregation Stages

- [x] Create `SRC/preact/report/pipeline-stages/filters.ts` exporting `executeFilterStage(ctx: StageContext): StageResult`. When `reportSpec.filters` is empty or all filters are disabled, return pass-through. Otherwise, import and call `buildWhere(filters, colMap)` from `query/sql-where` to get `{ where, params }`. If `where` is empty string, pass-through. Otherwise, execute `CREATE TEMP TABLE "_pipeline_stage_3" AS SELECT * FROM "<prevTableName>" WHERE <where>` with params. Return new table name. Import `buildWhere` from `query/sql-where`; import `quoteId`, `execQuery` from `core/sqldb`
    **Note:** Created filters.ts with executeFilterStage. Manual WHERE clause building (no buildWhere import) — all column refs use quoteId(alias) for flat temp table context. Handles 10 operators: equals, not equals, contains, not contains, starts with, ends with, greater than, less than, is empty, is not empty. Multi-value filters OR'd together, filters AND'd together. Parameterized query via execQuery(sql, params). LIKE wildcards escaped. Pass-through when no enabled filters.
- [x] Create `SRC/preact/report/pipeline-stages/sorts.ts` exporting `executeSortStage(ctx: StageContext): StageResult`. When `reportSpec.sorts` is empty or all sorts are disabled, return pass-through. Otherwise, build ORDER BY clause by mapping each enabled sort to `resolveRef(s.col, colMap) + ' ' + (s.dir === 'DESC' ? 'DESC' : 'ASC')`, joined with `, `. Execute `CREATE TEMP TABLE "_pipeline_stage_4" AS SELECT * FROM "<prevTableName>" ORDER BY <parts>`. Return new table name. Import `resolveRef` from `query/resolve-ref`; import `quoteId`, `execQuery` from `core/sqldb`
    **Note:** Created sorts.ts with executeSortStage. Simple ORDER BY builder using quoteId(sort.col) + ASC/DESC. Pass-through when no enabled sorts. Creates _pipeline_stage_4.
- [x] Create `SRC/preact/report/pipeline-stages/aggregation.ts` exporting `executeAggregationStage(ctx: StageContext): StageResult` plus three internal helpers. The dispatcher reads `reportSpec.aggregation.mode` (default `'none'`) and routes to: (a) detail mode (`'none'`) — pass-through; (b) `executeGroupedAggregation(ctx)` — builds `SELECT <groupRefs>, <aggExprs> FROM <prev> GROUP BY <groupRefs>` using `resolveRef()` and `renderAggregateExpr()` from `query/sql-aggregates`, creates `_pipeline_stage_5`; (c) `executeTotalsAggregation(ctx)` — builds UNION ALL of detail rows (with `0 AS "_row_type"`) and a totals row (with `1 AS "_row_type"`) using `renderAggregateExpr()` per column based on `reportSpec.aggregation.colTotals`; (d) `executeSubtotalsAggregation(ctx)` — adapts the pattern from `query/sql-subtotals.ts` `buildSubtotalsQuery()` to read from `ctx.prevTableName` instead of composing FROM/JOIN/WHERE. Produces UNION ALL of detail (`_row_type=0`), subtotal branches (`_row_type=1`), optional spacer (`_row_type=2`), optional grand total (`_row_type=3`) with internal `_sort_row_type` and `_sort_group_N` marker columns. Supports both `'nested'` and `'combined'` subtotal strategies. Returns null-equivalent pass-through when `subtotalBy` is empty. Import `resolveRef` from `query/resolve-ref`; import `renderAggregateExpr` from `query/sql-aggregates`; import `quoteId`, `execQuery` from `core/sqldb`
    **Note:** Created aggregation.ts with executeAggregationStage dispatcher + 4 internal helpers. Modes: 'none' (pass-through), 'group' (GROUP BY with renderAggregateExpr), 'totals' (UNION ALL detail+totals with _row_type marker), 'subtotals' (adapted from sql-subtotals.ts — UNION ALL detail+subtotal+spacer+grand total with _row_type, _sort_row_type, _sort_group_N markers). All column refs use quoteId(alias), no resolveRef. Nested and combined subtotal strategies supported. Creates _pipeline_stage_5 for non-detail modes.
- [x] Run `npm run typecheck && npm run lint && npm test` from `SRC/` — zero typecheck errors, zero lint warnings, all tests pass
    **Note:** Verification gate passed: typecheck 0 errors, lint 0 warnings, tests 1202/1202 passed. Also fixed pre-existing lint warning in base.ts (unused sourceCatalog destructuring on line 49).

## Completion Criteria

- `SRC/preact/report/pipeline-stages/` directory exists with six files: `base.ts`, `lookups.ts`, `calcs.ts`, `filters.ts`, `sorts.ts`, `aggregation.ts`
- `StageContext` interface exported from `base.ts` with all seven fields: `reportSpec`, `tables`, `colMap`, `sourceCatalog`, `prevTableName`, `stageIndex`, `outputColumns`
- `StageResult` interface exported from `base.ts` with `outputTableName: string` and `outputColumns: string[]`
- `StageFunction` type alias exported from `base.ts`
- Each of the six stage functions is a pure function `(ctx: StageContext) => StageResult`
- No-op stages (empty config) return `{ outputTableName: ctx.prevTableName, outputColumns: ctx.outputColumns }` without creating a temp table
- Active stages create temp tables named `_pipeline_stage_N` where N matches `ctx.stageIndex`
- All SQL identifiers use `quoteId()` — no string concatenation of identifiers
- All SQL execution goes through `execQuery()` from `core/sqldb`
- Stage functions import from Query layer (`buildJoins`, `buildCalcExpressions`, `buildWhere`, `resolveRef`, `renderAggregateExpr`) and Catalog layer types (`ColMapEntry`, `SourceTableEntry`) — no upward imports to UI layer
- `executeBaseStage` handles UNION ALL across base + stacks with optional source column literal injection reading `includeSourceColumn`, `sourceColumnName`, `stackAliases` from `reportSpec.pipeline`
- `executeAggregationStage` dispatches to grouped, totals, subtotals, or detail (pass-through) based on `reportSpec.aggregation.mode`
- `executeSubtotalsAggregation` adapts the `sql-subtotals.ts` pattern (UNION ALL of detail + subtotal branches + spacer + grand total with `_row_type` markers) to read from `ctx.prevTableName`
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References

- Design doc: `artifacts/designs/pending/DD-temp-table-pipeline.md` — Section "Stage Functions" (pseudocode for all six stages), "Temp Table Naming Convention", "Source Column Support"
- Parts breakdown: `artifacts/designs/parts/temp-table-pipeline/README.md` — Part B scope
- Contracts ledger: `artifacts/designs/parts/temp-table-pipeline/CONTRACTS.md` — Stage Function Contracts table
- Prerequisite plan: `TASK-temp-table-pipeline-A-data-model` — provides `includeSourceColumn`, `sourceColumnName`, `stackAliases` on `ReportSpec.pipeline`
- Query layer imports: `buildWhere()` in `query/sql-where.ts`, `buildCalcExpressions()` in `query/sql-calcs.ts`, `resolveRef()` in `query/resolve-ref.ts`, `renderAggregateExpr()` in `query/sql-aggregates.ts`, `buildJoins()` in `query/sql-joins.ts`
- Core imports: `quoteId()`, `execQuery()` in `core/sqldb.ts`
- Catalog types: `ColMapEntry` in `catalog/column-catalog.ts`, `SourceTableEntry` in `catalog/source-catalog.ts`
- Existing subtotals reference: `buildSubtotalsQuery()` in `query/sql-subtotals.ts` — pattern to adapt for `executeSubtotalsAggregation()`
- Downstream consumer: Part C (`pipeline-engine.ts`) will import all six stage functions and orchestrate them
