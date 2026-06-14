# Preact Rebuild — Implementation Parts

## Parts

| Part | Title | Depends On | Layers |
|------|-------|------------|--------|
| A | Foundation: Build Config + Core Layer | None | core |
| B | Catalog + Query Generation | A | catalog, query |
| B2 | Fix Missing Shared Modules | B | query, report |
| C | Report Execution Engine | B, B2 | report |
| D | Data + State Loading | B2, C | core, ui |
| E | UI Components + Sections | B2, C, D | ui |
| F | Testing + Integration | A, B, B2, C, D, E | tests |

## Dependency Graph

```
A (Foundation)
│
└──► B (Catalog + Query)
     │
     └──► B2 (Fix Missing Modules)
          │
          ├──► C (Report Engine)
          │    │
          │    └──► D (Data + State Loading)
          │         │
          │         └──► E (UI Components) ──► F (Testing)
          │
          └──► E (UI Components) [also needs C, D]
```

## Execution Rounds

| Round | Plans | Rationale |
|-------|-------|-----------|
| 1 | A | No dependencies — core layer foundation |
| 2 | B | Depends on A — catalog + query modules |
| 3 | B2 | Depends on B — fills gaps in shared modules |
| 4 | C | Depends on B, B2 — report engine needs catalog/query + layout-selection |
| 5 | D | Depends on C — data loading uses report engine |
| 6 | E | Depends on B2, C, D — UI wires everything together |
| 7 | F | Depends on all — integration tests require full implementation |

## Per-Part Scope

### Part A: Foundation — Build Config + Core Layer
**Status: COMPLETE** — All phases done, 128 unit tests passing.

Sets up build infrastructure (tsconfig, esbuild, package.json scripts) and the core layer: reactive pub/sub store, SQLite WASM wrapper, utility functions, date formatting, and all shared type declarations. Also creates vendor type declarations (globals.d.ts) and JSDoc documentation for all exports.

**Files:** `core/state.ts`, `core/store.ts`, `core/sqldb.ts`, `core/utils.ts`, `core/date-format.ts`, `types.ts`, `types/globals.d.ts`, `tsconfig.json`

### Part B: Catalog + Query Generation
**Status: NEARLY COMPLETE** — All catalog/query modules implemented. Build step blocked on `app.ts` (Phase E).

Builds the business logic layer: source catalog (table metadata), column catalog (column projection/resolution), and all SQL generation modules (WHERE, JOIN, aggregates, detail, grouped, totals, subtotals, calculated columns). Also includes query plan builder and lookup resolver.

**Files:** `catalog/source-catalog.ts`, `catalog/column-catalog.ts`, `query/sql-where.ts`, `query/sql-joins.ts`, `query/sql-aggregates.ts`, `query/sql-detail.ts`, `query/sql-grouped.ts`, `query/sql-calcs.ts`, `query/sql-totals.ts`, `query/sql-subtotals.ts`, `query/lookup-resolver.ts`, `query/query-plan.ts`, `query/resolve-ref.ts`, `query/alias-ref-updater.ts`

### Part B2: Fix Missing Shared Modules
**Status: NOT STARTED** — Two modules needed by downstream phases.

Creates `query/layout-selection.ts` (column layout/visibility logic needed by validation and UI) and `report/aggregation-constants.ts` (aggregate function definitions needed by validation and aggregation UI).

**Files:** `query/layout-selection.ts`, `report/aggregation-constants.ts`

### Part C: Report Execution Engine
**Status: NOT STARTED** — Blocked on B2.

Builds the report execution orchestrator: result set construction, output layout, report output publishing, report dependency graph, calc validation, state validation, and the main engine that coordinates query plan → SQL execution → result set.

**Files:** `report/result-set.ts`, `report/output-layout.ts`, `report/report-output.ts`, `report/report-graph.ts`, `report/calc-validator.ts`, `report/validation.ts`, `report/engine.ts`

### Part D: Data + State Loading
**Status: NOT STARTED** — Blocked on C.

Builds data loading infrastructure: state schema validation, state hydration from .rcjson files, state application to the store, state file loading, and XLSX/CSV spreadsheet ingestion into SQLite.

**Files:** `core/state-schema.ts`, `core/state-hydrator.ts`, `core/state-applier.ts`, `core/state-loader.ts`, `ui/loader.ts`

### Part E: UI Components + Sections
**Status: NOT STARTED** — Blocked on B2, C, D.

Builds the full Preact component tree: shared components (Chip, Tip, Modal, ContextMenu, RenameModal, CalcBuilder), pipeline sections (BaseStage, StackSheets, PipelineArrow, LookupStage, CalcStage), layout sections (ColChips, RunBar, FilterList, SortList, MergeToggles), cards (PipelineCard, LayoutCard, FilterSortCard), app shell (Sidebar, Loader, Grid, Export, Tabs), and entry point (app.ts).

**Files:** ~25 files in `ui/components/`, `ui/sections/`, `ui/cards/`, `ui/`, plus `app.ts` and `index.ts`

### Part F: Testing + Integration
**Status: NOT STARTED** — Blocked on all prior parts.

Rebuilds the test suite for all new preact modules. Creates unit tests for catalog, query, report, and UI layers. Adds integration tests for full pipeline and state loading. Verifies all 914+ original tests still pass.

**Files:** ~20 test files in `tests/catalog/`, `tests/query/`, `tests/report/`, `tests/integration/`
