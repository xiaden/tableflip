---
name: Report Layer
description: Report execution, result shaping, validation — engine, result sets, validation, output publishing. Applies when editing files in preact/report/.
applyTo: SRC/preact/report/**
---

# Report Layer

**Purpose:** Orchestrate report execution — build query plans, execute SQL via the database layer, construct result sets, validate configurations, publish output, and manage the report dependency graph.

## File Naming

- `engine.ts` — Single entry point `runReport()`; mode dispatchers (`runDetailMode`, `runTotalsMode`, `runSubtotalsMode`, `runGroupedMode`); detail bands stitching (`runDetailBandsMode`, `interleaveRows`, `crossProductRows`)
- `result-set.ts` — `buildResultSet()` and the `ResultSet` / `ResultSetMetadata` types
- `validation.ts` — `deriveValidation()`, `getValidation()`, `invalidateValidation()`, and all validation types
- `calc-validator.ts` — `checkCalcError()` for per-stage calc validation (pure, delegates to mode validators)
- `aggregation-constants.ts` — Aggregate/total/subtotal function constants, labels, and validators
- `report-output.ts` — `publishReportOutput()`, `buildPublishedOutputCatalog()`
- `report-graph.ts` — `buildReportGraph()`, `getRunOrder()`, `getWorkspaceRunOrder()`
- `output-layout.ts` — `createOutputLayout()`, `addBlock()`, `removeBlock()`, `updateBlock()`, `getBlock()`

## Allowed Imports

| Source | Allowed? | Notes |
|--------|----------|-------|
| `../types` | ✅ | Shared types: `ReportSpec`, `DbTable`, `AggMode`, `CalcStage`, `DetailBandSpec`, `AppState`, `WorkspaceState` |
| `../core/store` | ✅ | Only `validation.ts` — `getStore()` used in `getValidation()` cache pattern |
| `../core/sqldb` | ✅ | Only `engine.ts` — `execQuery()` for SQL execution |
| `../catalog/` | ✅ | `buildSourceCatalog`, `buildColumnCatalog`, `buildColSourceMap` — used by `engine.ts` and `validation.ts` for column resolution |
| `../query/` | ✅ | `buildQueryPlan`, `buildDetailQuery`, `buildBandQuery`, `buildCalcExpressions`, `validateLookupSpec` — used by `engine.ts` and `validation.ts` |
| Siblings (`./`) | ✅ | e.g., `engine.ts` → `./result-set`; `validation.ts` → `./calc-validator`, `./aggregation-constants` |
| `../ui/` | ❌ | Report layer must not import UI components or rendering logic |
| Node builtins / vendor libs | ❌ | No filesystem, no XLSX, no AG Grid |

## Forbidden Patterns

1. **SQL generation** — Do not produce `SELECT`, `JOIN`, `WHERE`, `GROUP BY`, or `UNION ALL` fragments outside the Query layer. The `runReport()` entry point calls `buildQueryPlan()` and mode-specific SQL builders from `../query/`. No function in this layer should hand-write SQL strings.

2. **UI rendering** — No Preact components, no DOM manipulation, no JSX. Output publishing produces data structures (`PublishedOutput`), not rendered views.

3. **State mutation outside validation cache** — The only mutable state in this layer is the validation cache (`_validationCache` / `_validationCacheState` in `validation.ts`). No other module should hold mutable module-level state.

4. **Calling `execQuery()` outside `engine.ts`** — SQL execution is the engine's responsibility. No other file in this layer (or any other layer) should call `execQuery()` for report results.

5. **Direct store mutation** — This layer reads state (via `getValidation()` → `getStore()`) but never writes to the store.

6. **Importing from catalog/query in non-engine/non-validation files** — Catalog and query imports are limited to `engine.ts` (for execution) and `validation.ts` (for validation). Other files (`result-set.ts`, `report-output.ts`, `report-graph.ts`, `output-layout.ts`, `aggregation-constants.ts`) must not import from `../catalog/` or `../query/`.

## Required Patterns

1. **`runReport()` is the only execution entry point** — No other function should call `execQuery()` for report results. All report SQL execution flows through `engine.ts`'s public API. Mode dispatchers are private helpers called by `runReport()`.

2. **`buildResultSet()` is the only result set constructor** — Every mode handler (`runDetailMode`, `runTotalsMode`, `runSubtotalsMode`, `runGroupedMode`, `runDetailBandsMode`) calls `buildResultSet()` to produce its final `ResultSet`. Do not construct `ResultSet` objects inline.

3. **`invalidateValidation()` must be called after any state mutation** — After any DB-affecting or config-changing state change, call `invalidateValidation()` or validation results stay stale. See `state-applier.ts` in the Core layer for the canonical pattern.

4. **`deriveValidation()` is pure** — Takes explicit parameters (`state`, `projectedColsList`, `colMap`, `sourceCatalog`) for testability. The store-caching wrapper `getValidation()` reads state, builds catalogs, then delegates to `deriveValidation()`.

5. **Validation result shape** — `ValidationResult` must always have:
   - `reportStatus: 'healthy' | 'blocked'` — overall report health
   - `cards: Record<string, ValidationCard>` — per-card status with `{ status: 'healthy' | 'blocked', issues: ValidationIssue[] }`
   - `items: Record<string, ValidationItem>` — per-pipeline-item breakdown with `{ enabled, resolved, blocking, issues }`

6. **Export checks validation before proceeding** — Any export flow must call `getValidation()` first. Blocked reports (`reportStatus === 'blocked'`) must not be allowed to export. The validation result provides the per-item breakdown for surfacing errors to the user.

7. **Pure functions by default** — Functions in `result-set.ts`, `report-output.ts`, `report-graph.ts`, `output-layout.ts`, `calc-validator.ts`, and `aggregation-constants.ts` must be pure: they accept explicit parameters and return new objects rather than reading global state or mutating inputs. `engine.ts` and `validation.ts` are the only modules with side-effect dependencies (SQL execution, store reads).

## Validation

After editing any file in `SRC/preact/report/`, run:

```sh
npm run typecheck   # zero errors required
npm run lint        # zero warnings required
npm test            # all tests must pass
```
