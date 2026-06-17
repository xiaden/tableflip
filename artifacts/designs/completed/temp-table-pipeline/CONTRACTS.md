# Temp-Table Pipeline — Contracts Ledger

**Feature:** temp-table-pipeline
**Design Doc:** `artifacts/designs/pending/DD-temp-table-pipeline.md`
**Created:** 2026-06-17

## Architecture Rules

- Pipeline engine and stage functions live in **Report layer** (`report/`)
- Stage functions import from **Query layer** (`buildWhere`, `buildCalcExpressions`, `resolveRef`, `renderAggregateExpr`) and **Catalog layer** (`buildColumnCatalog`, `buildSourceCatalog`)
- No upward imports (Report → UI forbidden)
- SQL identifiers always use `quoteId()` from `core/sqldb.ts`
- Source tables are immutable — temp tables are derived, not source mutations
- All SQL execution goes through `execQuery()` from `core/sqldb.ts`
- Temp tables use SQLite `CREATE TEMP TABLE ... AS SELECT ...` syntax
- Pipeline state is module-level transient (not serialized to `.rcjson`)
- Existing `.rcjson` files must load correctly — new fields have safe defaults
- Mandatory checks after every change: `npm run typecheck` (zero errors), `npm run lint` (zero warnings), `npm test` (all pass)

---

## Data Model Contracts

| Item | Signature | Defined In | Status |
|------|-----------|-----------|--------|
| **includeSourceColumn** | `boolean` on `AppState` and `ReportSpec.pipeline` — default `false` | Part A (`TASK-temp-table-pipeline-A-data-model`) | Active |
| **sourceColumnName** | `string` on `AppState` and `ReportSpec.pipeline` — default `"Source Sheet"` | Part A (`TASK-temp-table-pipeline-A-data-model`) | Active |
| **stackAliases** | `Record<string, string>` on `AppState` and `ReportSpec.pipeline` — default `{}` | Part A (`TASK-temp-table-pipeline-A-data-model`) | Active |
| **buildReportSpecFromState()** | Now propagates `includeSourceColumn`, `sourceColumnName`, `stackAliases` from `AppState` | Part A (`TASK-temp-table-pipeline-A-data-model`) | Active |
| **STATE_VERSION** | Bumped from 2 → 3; `RECOGNIZABLE_KEYS` gains three new entries | Part A (`TASK-temp-table-pipeline-A-data-model`) | Active |

## Stage Function Contracts

| Item | Signature | Defined In | Status |
|------|-----------|-----------|--------|
| **StageContext** | `{ reportSpec: ReportSpec; tables: Record<string, DbTable>; colMap: Map<string, ColMapEntry>; sourceCatalog: Map<string, SourceTableEntry>; prevTableName: string; stageIndex: number; outputColumns: string[] }` — defined in `base.ts` | Part B | Implemented |
| **StageResult** | `{ outputTableName: string; outputColumns: string[] }` — defined in `base.ts` | Part B | Implemented |
| **StageFunction** | `(ctx: StageContext) => StageResult` — defined in `base.ts` | Part B | Implemented |
| **executeBaseStage** | `(ctx: StageContext) => StageResult` — UNION ALL via `quoteId()` refs (NOT resolveRef), source column literal injection, `_pipeline_stage_0` | Part B | Implemented |
| **executeLookupStage** | `(ctx: StageContext) => StageResult` — manual JOIN construction (LEFT/INNER), `_pipeline_stage_1`; pass-through when no lookups | Part B | Implemented |
| **executeCalcStage** | `(ctx: StageContext) => StageResult` — uses `buildCalcExpressions()`, strips table prefixes for flat temp table, `_pipeline_stage_2` | Part B | Implemented |
| **executeFilterStage** | `(ctx: StageContext) => StageResult` — manual WHERE builder with 10 operators, param queries, `_pipeline_stage_3` | Part B | Implemented |
| **executeSortStage** | `(ctx: StageContext) => StageResult` — ORDER BY with ASC/DESC, `_pipeline_stage_4`; pass-through when no sorts | Part B | Implemented |
| **executeAggregationStage** | `(ctx: StageContext) => StageResult` — mode dispatch: detail (pass-through), group, totals (_row_type marker), subtotals (UNION ALL adapted from sql-subtotals), `_pipeline_stage_5` | Part B | Implemented |

## Query Layer Calls (Existing — Used by Part B)

| Item | Signature | Called By |
|------|-----------|----------|
| **buildJoins** | `(lookups: LookupSpec[], colMap: Map<string, ColMapEntry>, sourceCatalog: Map<string, SourceTableEntry>) => JoinResult` | `executeLookupStage` |
| **buildCalcExpressions** | `(calcStages: CalcStage[], colMap: Map<string, ColMapEntry>) => Array<{ alias: string; sql: string }>` | `executeCalcStage` |
| **buildWhere** | `(filters: FilterSpec[], colMap: Map<string, ColMapEntry>) => WhereResult` | `executeFilterStage` |
| **resolveRef** | `(alias: string, colMap: Map<string, ColMapEntry>) => string` | `executeSortStage`, `executeAggregationStage` |
| **renderAggregateExpr** | `(fn: string, colRef: string) => string` | `executeAggregationStage` (group, totals, subtotals) |
| **quoteId** | `(name: string) => string` | All stage functions |
| **execQuery** | `(sql: string, params?: unknown[]) => Record<string, unknown>[]` | All stage functions |

## Engine Contracts

| Item | Signature | Defined In | Status |
|------|-----------|-----------|--------|
| **PipelineState** | `{ validUpToStage: number; tempTableNames: string[] }` — module-level transient | Part C | Implemented |
| **PipelineEngine** | Class with `execute()`, `invalidateFromStage()`, `cleanup()`, `getState()` | Part C | Implemented |
| **PipelineEngine.execute()** | `(reportSpec: ReportSpec, tables: Record<string, DbTable>, prebuiltConfigs?: QueryPlanConfigs) => ResultSet` | Part C | Implemented |
| **PipelineEngine.invalidateFromStage()** | `(stageIndex: number) => void` — drops downstream temp tables, updates validUpToStage | Part C | Implemented |
| **PipelineEngine.cleanup()** | `() => void` — drops all `_pipeline_*` temp tables, resets state | Part C | Implemented |
| **PipelineEngine.getState()** | `() => PipelineState` — returns current pipeline state | Part C | Implemented |
| **getPipelineState()** | `() => PipelineState` — module-level accessor for singleton state | Part C | Implemented |
| **getPipelineEngine()** | `() => PipelineEngine` — module-level accessor for singleton instance | Part C | Implemented |
| **QueryPlanConfigs** | Replaces `BuiltQueryPlan` — no `sql`/`params`/`cols`; has `sourceCatalog: Map<string, SourceTableEntry>` | Part C | Implemented |
| **getTempTableColumns()** | `(tableName: string) => string[]` — reads actual columns via `PRAGMA table_info()` | Part C | Implemented |

## Integration Contracts

| Item | Signature | Defined In | Status |
|------|-----------|-----------|--------|
| **runReport() updated** | Uses `getPipelineEngine().execute()`; mode-runner functions deleted | Part C | Implemented |
| **buildQueryPlan() refactored** | Returns `QueryPlanConfigs` — no `sql`/`params`/`cols`; has `sourceCatalog` | Part C | Implemented |
| **preview-builder.ts simplified** | `SELECT * FROM _pipeline_stage_N LIMIT 5` via `getPipelineState()` — 98 lines (down from 365) | Part C | Implemented |
| **validation.ts migrated** | `deriveValidation()` accepts `pipelineState?: PipelineState`; reads `PRAGMA table_info()` when available; colMap fallback | Part C | Implemented |
| **Detail bands integration** | `runDetailBandsMode()` reads parent rows from `pipelineState.tempTableNames[4]` | Part C | Implemented |

## Deletion Contracts

| Item | Action | Defined In | Status |
|------|--------|-----------|--------|
| `sql-detail.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `sql-grouped.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `sql-totals.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `sql-subtotals.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `sql-detail.test.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `sql-grouped.test.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `sql-totals.test.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `sql-subtotals.test.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `calc-columns-execution.test.ts` | Delete | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `index.ts` barrel exports | Remove 8 dead export lines referencing deleted module symbols | Part D (`TASK-temp-table-pipeline-D-cleanup`) | Done |
| `query-plan.ts` SQL imports | Remove unused imports of `buildDetailQuery`, `buildGroupedQuery`, `buildTotalsQuery`, `buildSubtotalsQuery` | Part C | Done |
| `engine.ts` mode runners | Delete `runDetailMode`, `runTotalsMode`, `runSubtotalsMode`, `runGroupedMode` functions | Part C | Done |
| `preview-builder.ts` catalog logic | Remove `buildColSourceMapForState`, `buildHeaders`, `buildBasePreview`, `buildPreviewReportSpec`, `buildStagePreview` | Part C | Done |
| `engine.ts` mode dispatch | Remove `switch(aggMode)` that called old SQL generators | Part C | Done |

## UI Contracts

| Item | Signature | Defined In | Status |
|------|-----------|-----------|--------|
| Source column checkbox | `includeSourceColumn` toggle in pipeline-card.tsx stack section | Part E (`TASK-temp-table-pipeline-E-ui`) | Implemented |
| Source column name input | Text input for `sourceColumnName`, visible when checkbox is checked | Part E (`TASK-temp-table-pipeline-E-ui`) | Implemented |
| Stack alias inputs | Text input per stack chip in stack-sheets.tsx, reads/writes `stackAliases` | Part E (`TASK-temp-table-pipeline-E-ui`) | Implemented |

## Decisions

| Date | Plan | Decision | Rationale |
|------|------|----------|-----------|
| 2026-06-17 | Part C | `PipelineEngine.execute()` accepts optional `prebuiltConfigs` parameter | Avoids double catalog building when `runReport()` needs configs for detail bands — passes pre-built configs to engine instead of engine rebuilding them |
| 2026-06-17 | Part C | `runReport()` calls `engine.cleanup()` before `engine.execute()` on every call | Simplest correct approach — stage caching across calls is a future optimization; ensures fresh results on every report run |
| 2026-06-17 | Part C | Part C removes mode-runner functions and SQL dispatch (originally scoped to Part D) | These are tightly coupled to the `buildQueryPlan()` refactoring — removing them in Part C avoids a broken intermediate state where `buildQueryPlan` returns configs but mode runners still expect SQL |
| 2026-06-17 | Part C | `deriveValidation()` takes optional `pipelineState` parameter with colMap fallback | Preserves backward compatibility — validation works before first report run (no temp tables) and after (reads actual schemas) |
| 2026-06-17 | Part E | Part E depends on Part C (not just Part A) for the UI plan | The source column feature is useless until the pipeline engine actually generates the column — users need to run a report and see the output to understand the checkbox. Part C provides the working `PipelineEngine` and `runReport()` integration |
