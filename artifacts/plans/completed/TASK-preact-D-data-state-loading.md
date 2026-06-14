# Task: Phase D — Data + State Loading

## Problem Statement

Phases A, B, B2, and C are complete. Phase D builds the data loading infrastructure — how spreadsheet files (XLSX/CSV) get ingested into SQLite, and how report configuration files (.rcjson) are loaded and applied.

The old codebase (`SRC/js/core/state-loader.ts`, `SRC/js/core/state-schema.ts`, `SRC/js/core/state-hydrator.ts`, `SRC/js/core/state-applier.ts`, `SRC/js/ui/loader.ts`) provides the specification. The new code uses the reactive store instead of mutating global `db`.

## Phases

### Phase 1: State Schema ✅

- [x] Create `SRC/preact/core/state-schema.ts` — `STATE_VERSION`, `RECOGNIZABLE_KEYS`, `isRecognizableConfig(payload)` function. Port from `SRC/js/core/state-schema.ts`. Pure constants and function.

### Phase 2: State Hydrator ✅

- [x] Create `SRC/preact/core/state-hydrator.ts` — `hydrateState(payload, loadedTables)` function that takes a raw JSON payload and loaded table IDs, returns `{ next, brokenRefs, nextExcludedRows }`. Port from `SRC/js/core/state-hydrator.ts`. Uses `projectedColsUpToLookup` from catalog/column-catalog for validation. Uses `buildSourceCatalog` + new 3-arg `projectedColsUpToLookup` signature. All 26 hydration fields ported.

### Phase 3: State Applier ✅

- [x] Create `SRC/preact/core/state-applier.ts` — `applyState(next, nextExcludedRows)` function that applies hydrated state to the store. Uses `getStore().update()` instead of `Object.assign(db, next)`. Calls `invalidateValidation()` after mutation.

### Phase 4: State Loader ✅

- [x] Create `SRC/preact/core/state-loader.ts` — `loadState(file, store)` function that reads a .rcjson file via FileReader, validates it, hydrates it, and applies it. Returns `Promise<LoadResult>`. No window assignments, no DOM element creation.

### Phase 5: Data Loader (XLSX/CSV) ✅

- [x] Create `SRC/preact/ui/loader.ts` — `loadSpreadsheet(file, store)`, `loadSheets(wb, sheetNames, store)`, and `ingestSheet(wb, sheetName, label, store)` functions. Ported XLSX/CSV ingestion with stickyToast for total-row detection. Uses `store.update()` for state mutations.

### Phase 6: Typecheck + Build ✅

- [x] `npm run typecheck:preact` — zero errors
- [x] `npm test` — all 914 tests pass

## Completion Criteria

- All 5 new TypeScript files compile with zero errors
- `npm run typecheck:preact` passes
- All 914 existing tests still pass
- State loading uses store.update() not direct mutation
- Data loading uses sqldb module for SQLite operations

## References

- Old state loader: `SRC/js/core/state-loader.ts`, `SRC/js/core/state-schema.ts`, `SRC/js/core/state-hydrator.ts`, `SRC/js/core/state-applier.ts`
- Old data loader: `SRC/js/ui/loader.ts`
- Phase B2 fix plan: `artifacts/plans/pending/TASK-preact-B2-fix-missing-modules.md`
- Design doc: `artifacts/designs/pending/DD-preact-rebuild-architecture.md`

---

## Completion Summary

**Status:** COMPLETE — 2026-06-12

**Files created (5):**

| File | Lines | Purpose |
|------|-------|---------|
| `SRC/preact/core/state-schema.ts` | 32 | STATE_VERSION, RECOGNIZABLE_KEYS, isRecognizableConfig() |
| `SRC/preact/core/state-hydrator.ts` | 335 | hydrateState() — validates + hydrates .rcjson payloads |
| `SRC/preact/core/state-applier.ts` | 37 | applyState() — merges hydrated state into store |
| `SRC/preact/core/state-loader.ts` | 92 | loadState() — FileReader → validate → hydrate → apply |
| `SRC/preact/ui/loader.ts` | 237 | loadSpreadsheet(), loadSheets(), ingestSheet() — XLSX/CSV → SQLite |

**Files modified (2):**

| File | Change |
|------|--------|
| `SRC/preact/types.ts` | Added `samples?: Record<string, string[]>` to DbTable |
| `SRC/preact/types/globals.d.ts` | Added `encode_cell()` to XLSX.utils declaration |

**QA review:** 2 rounds. Round 1 found 5 MINOR issues (3 fixed, 2 accepted). Round 2 PASS.
**Fix cycles:** 1 (3 issues fixed: stickyToast notification, DbTable.samples type, XLSX.utils.encode_cell declaration)
**Typecheck:** Zero errors
**Tests:** 914/914 pass
