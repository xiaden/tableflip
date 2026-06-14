# Task: Phase F — Testing + Integration

## Problem Statement

Phases A through E are complete — the full application is rebuilt in `SRC/preact/`. Phase F rebuilds the test suite and verifies the new application works end-to-end. The old test suite (`SRC/tests/`) has 40 test files / 914 tests covering core, query, report, and UI layers.

The new tests must use the same Vitest setup but test the new preact modules instead of the old ones.

## Phases

### Phase 1: Test Infrastructure

- [ ] Create `SRC/preact/tests/vitest-setup.ts` — test environment setup (SQLite mock, DOM setup, global vendor mocks). Port from `SRC/tests/vitest-setup.ts` but adapted for preact store.
- [ ] Update `SRC/preact/vitest.config.ts` — configure test discovery, environment, setup file.

### Phase 2: Core Tests

- [ ] Create `SRC/preact/tests/core/store.test.ts` — test reactive store (createStore, getState, subscribe, update, set).
- [ ] Create `SRC/preact/tests/core/state.test.ts` — test state constructors (createAppState, createWorkspaceState, createReportSpec).
- [ ] Create `SRC/preact/tests/core/sqldb.test.ts` — test SQLite wrapper (initDb, quoteId, execQuery, createTable, insertRows, dropTable).
- [ ] Create `SRC/preact/tests/core/utils.test.ts` — test utility functions (h, stripExt, toast, TABLE_PALETTE, colUserLabel, etc.).
- [ ] Create `SRC/preact/tests/core/date-format.test.ts` — test date format functions (normalizeDateExpr, isISODate, getDateInputFormat).

### Phase 3: Catalog Tests

- [ ] Create `SRC/preact/tests/catalog/source-catalog.test.ts` — test buildSourceCatalog.
- [ ] Create `SRC/preact/tests/catalog/column-catalog.test.ts` — test buildColSourceMap, buildColumnCatalog, projectedCols, projectedColsUpToLookup.

### Phase 4: Query Tests

- [ ] Create `SRC/preact/tests/query/sql-where.test.ts` — test all filter operators and AND/OR logic.
- [ ] Create `SRC/preact/tests/query/sql-joins.test.ts` — test INNER/LEFT joins, key pairs, prefix aliasing.
- [ ] Create `SRC/preact/tests/query/sql-aggregates.test.ts` — test aggregate functions.
- [ ] Create `SRC/preact/tests/query/sql-detail.test.ts` — test detail query generation.
- [ ] Create `SRC/preact/tests/query/sql-grouped.test.ts` — test grouped query generation.
- [ ] Create `SRC/preact/tests/query/sql-calcs.test.ts` — test calc column SQL generation.
- [ ] Create `SRC/preact/tests/query/sql-totals.test.ts` — test totals query generation.
- [ ] Create `SRC/preact/tests/query/sql-subtotals.test.ts` — test subtotals query generation.
- [ ] Create `SRC/preact/tests/query/query-plan.test.ts` — test query plan orchestration.
- [ ] Create `SRC/preact/tests/query/lookup-resolver.test.ts` — test lookup expansion.

### Phase 5: Report Tests

- [ ] Create `SRC/preact/tests/report/result-set.test.ts` — test buildResultSet.
- [ ] Create `SRC/preact/tests/report/validation.test.ts` — test deriveValidation with various state configurations.
- [ ] Create `SRC/preact/tests/report/calc-validator.test.ts` — test checkCalcError for all calc modes.
- [ ] Create `SRC/preact/tests/report/engine.test.ts` — test runReport with detail/grouped/totals/subtotals modes.

### Phase 6: Integration Tests

- [ ] Create `SRC/preact/tests/integration/full-pipeline.test.ts` — end-to-end: load data → configure report → run report → verify results.
- [ ] Create `SRC/preact/tests/integration/state-loading.test.ts` — test .rcjson load → validate → apply → verify state.

### Phase 7: Test Verification

- [ ] Run `npm run typecheck:preact` — zero errors
- [ ] Run all preact tests — all pass
- [ ] Run original tests (`npm test`) — all 914 still pass (no regressions)
- [ ] Verify test coverage meets minimum thresholds

### Phase 8: Missing Test Files (QA Review Amendments)

**Notes:** QA review identified 5 PLANNING_GAP issues — modules with zero test coverage. This phase adds those missing test files. Also adds cycle detection tests to the existing `sql-calcs.test.ts`.

- [ ] Create `SRC/preact/tests/query/resolve-ref.test.ts` — test `resolveRef()` from `query/resolve-ref.ts`. Cover: physical column resolution (`"tid"."col"` format), calc column resolution (quoted alias), missing alias handling. Source exports: `resolveRef(alias, colMap)`.
- [ ] Create `SRC/preact/tests/report/output-layout.test.ts` — test all 5 pure functions from `report/output-layout.ts`: `createOutputLayout` (empty + with initial blocks), `addBlock` (appends and normalizes), `removeBlock` (filters by id), `updateBlock` (merges partial fields, returns unchanged if id not found), `getBlock` (lookup by id, returns null if not found). Verify immutability — inputs not mutated.
- [ ] Create `SRC/preact/tests/report/report-output.test.ts` — test `publishReportOutput` and `buildPublishedOutputCatalog` from `report/report-output.ts`. Cover: output shape (reportId, outputId, name, columns, rows, source, publishedAt), subtotal/spacer row filtering (`_row_type` non-null/non-zero), catalog building from workspace with `publish.enabled` reports, catalog skipping disabled reports, catalog skipping reports without cached result sets.
- [ ] Create `SRC/preact/tests/report/report-graph.test.ts` — test all 7 functions from `report/report-graph.ts`: `buildReportGraph` (node creation, edge detection from pipeline refs, cycle detection via DFS), `getReportDependencies` / `getReportDependents` (direct edge queries), `detectReportCycles` (mutual A↔B, transitive A→B→C→A), `getRunOrder` (topological order for single report), `getWorkspaceRunOrder` (full workspace topo-sort excluding cycle participants). Use `makeReportSpec` from query helpers to build test workspace states.
- [ ] Create `SRC/preact/tests/report/aggregation-constants.test.ts` — test all 15 exported symbols from `report/aggregation-constants.ts`: `AGG_FNS` (array contents), `AGG_LABELS` (label map completeness), `AGG_NEEDS_COL` (returns false for COUNT ROWS, true for others), `TOTAL_FNS` / `TOTAL_LABELS`, `SUBTOTAL_FNS` / `SUBTOTAL_LABELS`, `AGG_MODES`, `getAggregateLabel` / `getTotalLabel` / `getSubtotalLabel` (known fn + unknown fallback), `isValidAggregateFn` / `isValidTotalFn` / `isValidSubtotalFn` (valid + invalid), `aggregateNeedsColumn` (delegates to AGG_NEEDS_COL).
- [ ] Add cycle detection tests to `SRC/preact/tests/query/sql-calcs.test.ts` — test calc column cycle detection in `buildCalcExpressions`: mutual cycle (A references B, B references A → both resolve to NULL), transitive cycle (A→B→C→A → all resolve to NULL). Use calc entries with `kind: 'calc'` in colMap to simulate cross-calc references.

## Completion Criteria

- All new test files pass
- Original 914 tests still pass
- `npm run typecheck:preact` passes
- Test coverage matches or exceeds old test suite coverage
- Integration tests verify full pipeline works end-to-end

## References

- Old test suite: `SRC/tests/*.test.ts`
- Old test helpers: `SRC/tests/helpers.ts`, `SRC/tests/fixtures.ts`
- Old test setup: `SRC/tests/vitest-setup.ts`
- All Phase A-E plans and implementations
- Design doc: `artifacts/designs/pending/DD-preact-rebuild-architecture.md`
- QA review findings: 5 PLANNING_GAP issues for modules with zero coverage
