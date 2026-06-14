# Preact Rebuild — Completion Manifest

**Completed:** 2026-06-13
**Design doc:** `DD-preact-rebuild-architecture.md`
**Parts README:** `preact/README.md`
**Contracts ledger:** `preact/CONTRACTS.md`

---

## Execution Summary

| Plan | Title | Review Rounds | Fix Plans | Status |
|------|-------|---------------|-----------|--------|
| A | Foundation: Build Config + Core Layer | 2 | — | PASS |
| B | Catalog + Query Generation | 2 | — | PASS |
| B2 | Fix Missing Shared Modules | 2 | — | PASS |
| C | Report Execution Engine | 2 | — | PASS |
| D | Data + State Loading | 2 | — | PASS |
| E | UI Components + Sections | 1 | — | PASS |
| F | Testing + Integration | 2 | — | PASS |

## Design Deviations

| Deviation | Rationale |
|-----------|-----------|
| Extracted shared `resolveRef()` utility | Eliminated duplication across 9 query modules |
| Build verification deferred to Phase E | `app.ts` entry point created in Plan E, not Plan A |
| `file-loader.tsx` named differently from plan's `loader.tsx` | Avoids conflict with `ui/loader.ts` (data ingestion module) |
| `calcModeRenderers` uses string-returning HTML builders | Matches old codebase pattern; avoids re-render overhead |
| `invalidateValidation()` imported by state-applier from report/validation | Architecturally required — state changes must invalidate validation cache |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Draft-mutator pattern for `store.update()` | Immer-style immutable updates, matches design doc spec |
| Dynamic imports for future-phase modules in utils.ts | Keeps Phase A self-contained without stubs |
| `.js` extensions on all local imports | Required by `moduleResolution: "bundler"` |
| Vendor type declarations in `types/globals.d.ts` | Prevents `any` leakage for sql.js, XLSX, AG Grid |
| Bug fix in `sql-calcs.ts` cycle detection | `trail.add(alias)` was called before `trail.has(alias)` check, causing all calc columns to produce NULL |

## Files Created/Modified

### Core Layer (8 files)
- `SRC/preact/core/state.ts` — state constructors
- `SRC/preact/core/store.ts` — reactive pub/sub store
- `SRC/preact/core/sqldb.ts` — SQLite WASM wrapper
- `SRC/preact/core/utils.ts` — utility functions
- `SRC/preact/core/date-format.ts` — date formatting SQL
- `SRC/preact/core/state-schema.ts` — state version detection
- `SRC/preact/core/state-hydrator.ts` — state hydration from JSON
- `SRC/preact/core/state-applier.ts` — state application to store
- `SRC/preact/core/state-loader.ts` — .rcjson file loading

### Types (2 files)
- `SRC/preact/types.ts` — shared type declarations
- `SRC/preact/types/globals.d.ts` — vendor type declarations

### Catalog Layer (2 files)
- `SRC/preact/catalog/source-catalog.ts` — table metadata
- `SRC/preact/catalog/column-catalog.ts` — column projection/resolution

### Query Layer (12 files)
- `SRC/preact/query/sql-where.ts` — WHERE clause builder
- `SRC/preact/query/sql-joins.ts` — JOIN clause builder
- `SRC/preact/query/sql-aggregates.ts` — aggregate expressions
- `SRC/preact/query/sql-detail.ts` — detail query generation
- `SRC/preact/query/sql-grouped.ts` — grouped query generation
- `SRC/preact/query/sql-calcs.ts` — calculated columns SQL
- `SRC/preact/query/sql-totals.ts` — totals query generation
- `SRC/preact/query/sql-subtotals.ts` — subtotals query generation
- `SRC/preact/query/lookup-resolver.ts` — lookup expansion/validation
- `SRC/preact/query/query-plan.ts` — query plan orchestrator
- `SRC/preact/query/resolve-ref.ts` — shared reference resolver
- `SRC/preact/query/alias-ref-updater.ts` — alias rename propagation
- `SRC/preact/query/layout-selection.ts` — column layout/visibility

### Report Layer (9 files)
- `SRC/preact/report/aggregation-constants.ts` — aggregate function constants
- `SRC/preact/report/result-set.ts` — result set construction
- `SRC/preact/report/output-layout.ts` — output column layout
- `SRC/preact/report/report-output.ts` — report output publishing
- `SRC/preact/report/report-graph.ts` — report dependency graph
- `SRC/preact/report/calc-validator.ts` — calc stage validation
- `SRC/preact/report/validation.ts` — full state validation
- `SRC/preact/report/engine.ts` — report execution orchestrator

### UI Layer (18 files)
- `SRC/preact/ui/components/tip.tsx` — tooltip component
- `SRC/preact/ui/components/modal.tsx` — modal dialog
- `SRC/preact/ui/components/context-menu.tsx` — context menu
- `SRC/preact/ui/components/chip.tsx` — column chip
- `SRC/preact/ui/components/rename-modal.tsx` — rename dialog
- `SRC/preact/ui/components/calc-builder.ts` — calc mode builders
- `SRC/preact/ui/sections/pipeline-arrow.tsx` — pipeline connector
- `SRC/preact/ui/sections/base-stage.tsx` — base table selector
- `SRC/preact/ui/sections/stack-sheets.tsx` — UNION ALL sheets
- `SRC/preact/ui/sections/lookup-stage.tsx` — lookup config
- `SRC/preact/ui/sections/calc-stage.tsx` — calc column config
- `SRC/preact/ui/sections/column-chips.tsx` — draggable column chips
- `SRC/preact/ui/sections/run-bar.tsx` — run button + validation
- `SRC/preact/ui/sections/filter-list.tsx` — filter rows
- `SRC/preact/ui/sections/sort-list.tsx` — sort rows
- `SRC/preact/ui/sections/merge-toggles.tsx` — merge display toggles
- `SRC/preact/ui/cards/pipeline-card.tsx` — pipeline card
- `SRC/preact/ui/cards/layout-card.tsx` — layout/aggregation card
- `SRC/preact/ui/cards/filter-sort-card.tsx` — filter/sort card
- `SRC/preact/ui/aggregation.ts` — aggregation mode management
- `SRC/preact/ui/sidebar.tsx` — table list sidebar
- `SRC/preact/ui/file-loader.tsx` — file drop/loader UI
- `SRC/preact/ui/loader.ts` — data ingestion (XLSX/CSV)
- `SRC/preact/ui/grid.ts` — AG Grid integration
- `SRC/preact/ui/export.ts` — XLSX/CSV export
- `SRC/preact/ui/tabs.ts` — tab switching
- `SRC/preact/ui/app.tsx` — root App component

### Entry Point + Barrel (2 files)
- `SRC/preact/app.ts` — esbuild entry point
- `SRC/preact/index.ts` — barrel re-exports

### Build Config (2 files)
- `SRC/preact/tsconfig.json` — TypeScript config
- `SRC/preact/vitest.config.ts` — test config

### Tests (28 files)
- `SRC/preact/tests/vitest-setup.ts` — test environment setup
- `SRC/preact/tests/core/store.test.ts` (19 tests)
- `SRC/preact/tests/core/state.test.ts` (15 tests)
- `SRC/preact/tests/core/sqldb.test.ts` (24 tests)
- `SRC/preact/tests/core/utils.test.ts` (40 tests)
- `SRC/preact/tests/core/date-format.test.ts` (24 tests)
- `SRC/preact/tests/catalog/source-catalog.test.ts`
- `SRC/preact/tests/catalog/column-catalog.test.ts`
- `SRC/preact/tests/query/helpers.ts` — shared test helpers
- `SRC/preact/tests/query/sql-where.test.ts`
- `SRC/preact/tests/query/sql-joins.test.ts`
- `SRC/preact/tests/query/sql-aggregates.test.ts`
- `SRC/preact/tests/query/sql-detail.test.ts`
- `SRC/preact/tests/query/sql-grouped.test.ts`
- `SRC/preact/tests/query/sql-calcs.test.ts`
- `SRC/preact/tests/query/sql-totals.test.ts`
- `SRC/preact/tests/query/sql-subtotals.test.ts`
- `SRC/preact/tests/query/query-plan.test.ts`
- `SRC/preact/tests/query/lookup-resolver.test.ts`
- `SRC/preact/tests/query/resolve-ref.test.ts`
- `SRC/preact/tests/report/result-set.test.ts`
- `SRC/preact/tests/report/validation.test.ts`
- `SRC/preact/tests/report/calc-validator.test.ts`
- `SRC/preact/tests/report/engine.test.ts`
- `SRC/preact/tests/report/output-layout.test.ts`
- `SRC/preact/tests/report/report-output.test.ts`
- `SRC/preact/tests/report/report-graph.test.ts`
- `SRC/preact/tests/report/aggregation-constants.test.ts`
- `SRC/preact/tests/integration/full-pipeline.test.ts`
- `SRC/preact/tests/integration/state-loading.test.ts`

**Total: 82 files created/modified**

## Final Verification Status

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ Zero errors |
| `npm run build` | ✅ Clean bundle at `pkg/js/app.bundle.js` |
| `npm test` | ✅ 531 tests passing across 28 files |
| Old codebase (`SRC/js/`) | ✅ Deleted (vendor/wasm retained) |
| Old tests (`SRC/tests/`) | ✅ Deleted (786 tests replaced by 531 preact tests) |
| `preact_index.html` | ✅ Renamed to `index.html` |
| Calc builders | ✅ Converted from string HTML to Preact components |
| `.js` extensions | ✅ Removed from all imports |
