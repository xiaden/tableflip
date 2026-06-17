---
name: state-lifecycle-orientation
description: 'Core state lifecycle: store, load, serialize, hydrate, apply, validate, and the reactive pub/sub pattern for app state in TableFlip React.'
---

# State Lifecycle Orientation

## Mental Model

The application state is a single `AppState` object managed by a reactive pub/sub store (`Store`). All mutation goes through `store.update(draft => ...)` or `store.set(key, value)`. State is the **source of truth** for the report configuration (base table, lookups, filters, sorts, aggregates, calc columns, detail bands, etc.), while the **data** (actual SQLite tables) lives in a separate SQL.js WASM database. The two are kept consistent by the loader/ingester when data files are loaded.

State flows through distinct phases: **creation** (defaults) → **loading** (file ingestion or config load) → **hydration** (validating and reshaping external payloads) → **application** (pushing to store) → **consumption** (validation, query planning, report execution) → **serialization** (back to external .rcjson). Between mutations, validation caches are invalidated to stay fresh.

## Coverage

**Documented:** Core store module, state factory defaults, the load/hydrate/apply/serialize pipeline, state schema versioning, aggregate mode state persistence, invalidation contracts, key consumer patterns.

**Not yet documented:** Detailed shape of `WorkspaceState` (multi-report workspace), runtime state (results cache, grid state), report-graph dependency resolution, the full catalog layer relationship to state (source-catalog / column-catalog).

**Last extended:** 2026-06-14

## Key Findings

### 1. Store: The Single Mutation Gate

- **Location:** `SRC/preact/core/store.ts`
- **What:** A simple reactive store with `getState()`, `subscribe()`, `update()`, and `set()`.
- **Why it matters:** All state mutations must flow through `update()` (multi-field draft with deep clone, like Immer) or `set()` (single top-level key with shallow clone). Direct mutation of `getState()` output is forbidden — it returns the current reference, but the store is replaced on each update.
- **Invariant:** After `update()`, `draft` is a deep clone preserving `Set` objects (custom `deepClone` handles Sets, arrays, objects). Listeners receive `(newState, prevState)`. The singleton is managed by `initStore()` / `getStore()`.

### 2. State Factory: Defaults and `buildReportSpecFromState`

- **Location:** `SRC/preact/core/state.ts`
- **What:** `createAppState(overrides?)` returns a complete `AppState` with sensible defaults (empty tables, no base, aggMode 'none', etc.). `createWorkspaceState()`, `createReportSpec()`, `createLookupSpec()`, `createDetailBandSpec()`, `createFilterSpec()`, `createSortSpec()`, `createOutputColumnSpec()` each produce their respective type defaults.
- **Why it matters:** `buildReportSpecFromState(state)` consolidates the 6 fields (`base`, `baseCols`, `stacks`, `lookups`, `calcStages`, `detailBands`) into a shape the catalog layer expects — had 13 ad-hoc constructions before this helper.
- **Invariant:** `selCols` is `Set<string> | null` in AppState (not array). `excludedRows` is `Record<string, Set<number>>`. These `Set` types are converted to arrays during serialization and back to Sets during hydration.

### 3. Load → Hydrate → Apply Pipeline

- **Location:** `state-loader.ts` → `state-hydrator.ts` → `state-applier.ts`
- **What:** The full pipeline for loading a `.rcjson` file:
  1. **`loadState(file, store)`** — FileReader → JSON.parse → `isRecognizableConfig(payload)` check → version check → loads current `tables` from store → calls `hydrateState()` → calls `applyState()`.
  2. **`hydrateState(payload, loadedTables)`** — Pure function. Builds a `sourceCatalog`, then validates every reference (base, stacks, lookups, calc stages, filters, sorts, group-by, aggregates, totals, subtotals, detail bands) against loaded tables, producing `{ next, brokenRefs, nextExcludedRows }`. Broken refs are **reported but not blocking** — the user can see/fix them.
  3. **`applyState(next, nextExcludedRows)`** — Writes to the store via `store.update()`, then calls `invalidateValidation()` and `resetLayoutSelection()`.
- **Why it matters:** The loader never directly mutates the store — it builds a `next` object and applies atomically. `brokenRefs` are string warnings, not thrown errors. The version check in `loadState` rejects mismatched versions.

### 4. Serializer: Store → .rcjson Payload

- **Location:** `SRC/preact/core/state-serializer.ts`
- **What:** `buildPayload(state)` converts the entire `AppState` to a plain JSON-serializable object. `Set→array` conversions for `selCols` and `excludedRows`. `saveState()` is the UI entry point — reads state, syncs agg mode state, prompts user, triggers download.
- **Why it matters:** `saveActiveAggModeState()` and `ensureAggModeState()` are called **before** serialization to persist the current aggregation mode's UI state into `aggModeState`. Deep clones on nested objects prevent reference sharing.
- **Invariant:** Payload includes `v: STATE_VERSION` (currently `2`).

### 5. State Schema Versioning

- **Location:** `SRC/preact/core/state-schema.ts`
- **What:** `STATE_VERSION = 2`. `RECOGNIZABLE_KEYS` list. `isRecognizableConfig(payload)` checks the payload is an object with >= 2 of the recognizable keys.
- **Why it matters:** This is a heuristic guard, not a rigorous schema validator. It distinguishes .rcjson files from arbitrary JSON. The version check in `loadState` rejects mismatched versions with an error.

### 6. Validation Cache and Invalidation Protocol

- **Location:** `SRC/preact/report/validation.ts`
- **What:** `invalidateValidation()` nulls the cache. `getValidation()` recomputes when state has changed (reference comparison `_validationCacheState !== currentState`).
- **Why it matters:** Any state mutation that could affect validation **must** be followed by `invalidateValidation()`. Currently called by:
  - `applyState()` (after loading config)
  - `layout-selection.ts` `_afterCombineChange()` and related functions
  - UI mutation functions in the aggregation module and others
- **Invariant:** `getValidation()` is the canonical entry point — it reads `getStore().getState()` internally. `deriveValidation()` exists as a testable pure function.

### 7. Aggregate Mode State Persistence

- **Location:** `SRC/preact/ui/aggregation.ts`
- **What:** When switching between agg modes (none/group/totals/subtotals), `saveActiveAggModeState()` stores the current mode's config into `state.aggModeState[mode]`. `loadAggModeState(mode)` restores it. `setAggMode(mode)` does save → switch → load.
- **Why it matters:** `aggModeState` is a `Record<string, unknown> | null` in AppState — it's schema-free JSON. Each mode saves its relevant fields (`groupBy`, `aggregates`, `colTotals`, `subtotalBy`, etc.) under its mode key. The serializer includes this as opaque JSON (`JSON.parse(JSON.stringify(...))`).
- **Invariant:** `saveActiveAggModeState()` is called before `buildPayload()` (in save flow) AND before mode switch. `ensureAggModeState()` guarantees all 4 modes have entries.

### 8. SQLite Database and State Boundaries

- **Location:** `SRC/preact/core/sqldb.ts`
- **What:** sql.js WASM database via CDN. `initDb()` loads the WASM, creates `window.sqlDb`. Tables are created/inserted/dropped via `createTable`, `insertRows`, `dropTable`.
- **Why it matters:** The SQLite database holds raw table data — it is **not** the app state. The app state holds table *metadata* (`DbTable` shape: id, name, cols, rowCount, samples). State and database are kept consistent by the loader (`loadSheets` → `ingestSheet` → creates table in SQLite + updates `store.getState().tables[id]`). The report engine reads state for configuration but executes queries against SQLite.
- **Caveat:** `sqlDb` is a global on `window` — there is no multi-DB or connection pooling.

### 9. Layout Selection Side Effects

- **Location:** `SRC/preact/query/layout-selection.ts`
- **What:** Manages column visibility toggles (`selCols`), preview panels, and disabled card columns through module-level `Set`s (`_seenCols`, `_previewOpen`, `_disabledCardCols`).
- **Why it matters:** `resetLayoutSelection()` must be called when loading new state (done in `applyState()`). These are **not** in the store — they are module-level mutable state that must be reset on config load to prevent stale UI state. This is a potential source of bugs if code paths miss calling `resetLayoutSelection()`.

### 10. Query Plan and Report Engine: Pure Consumers

- **Location:** `SRC/preact/query/query-plan.ts`, `SRC/preact/report/engine.ts`
- **What:** `buildQueryPlan(reportSpec, tables)` is pure — takes a `ReportSpec` and `DbTable` map, returns a `BuiltQueryPlan`. `runReport()` orchestrates plan → SQL → results.
- **Why it matters:** These layers do **not** read from the store directly. They receive their data explicitly (from `getStore().getState()` in the UI event handler, or from `WorkspaceState` in the multi-report context). This makes them testable without a store instance.

## Key Files Reference

| File | Role |
|------|------|
| `SRC/preact/core/store.ts` | Reactive store singleton, `getState()`, `update()`, `set()`, `subscribe()` |
| `SRC/preact/core/state.ts` | AppState/WorkspaceState factory defaults, `buildReportSpecFromState()` |
| `SRC/preact/core/state-loader.ts` | File → parse → validate → hydrate → apply pipeline |
| `SRC/preact/core/state-hydrator.ts` | Payload → validated+hydrated `next` object with `brokenRefs` |
| `SRC/preact/core/state-applier.ts` | Hydrated state → store, + `invalidateValidation()` |
| `SRC/preact/core/state-serializer.ts` | AppState → .rcjson payload, `saveState()` download trigger |
| `SRC/preact/core/state-schema.ts` | `STATE_VERSION`, `isRecognizableConfig()` heuristic |
| `SRC/preact/core/sqldb.ts` | SQLite WASM wrapper, `quoteId()`, `execQuery()`, `insertRows()` |
| `SRC/preact/report/validation.ts` | Validation cache, `invalidateValidation()`, `getValidation()` |
| `SRC/preact/ui/aggregation.ts` | Agg mode state save/load/switch (`setAggMode`, `loadAggModeState`) |
| `SRC/preact/ui/loader.ts` | XLSX/CSV ingestion pipeline, `ingestSheet()`, `loadSpreadsheet()` |
| `SRC/preact/query/layout-selection.ts` | Column visibility toggles, `resetLayoutSelection()` |
| `SRC/preact/types.ts` | AppState, WorkspaceState, ReportSpec, and all sub-spec interfaces |
| `SRC/preact/index.ts` | Barrel exports for all public modules |

## Critical Invariants

1. **All mutations go through `store.update()` or `store.set()`** — never mutate `getState()` return value directly.
2. **`invalidateValidation()` after any DB-affecting or config-changing state mutation** — validation cache uses reference equality; stale state won't recompute.
3. **`resetLayoutSelection()` after loading any `.rcjson` config** — the module-level `Set`s (`_seenCols`, etc.) accumulate across loads and will show stale UI state.
4. **`selCols` is `Set<string> | null` in AppState, not array** — serialization converts to array, hydration converts back to Set (or null).
5. **`excludedRows` is `Record<string, Set<number>>`** — same Set↔array conversion during serialize/hydrate.
6. **Deep clone preserves Sets** — the custom `deepClone` in `store.ts` handles `Set` objects explicitly. `JSON.parse(JSON.stringify(...))` does NOT — use `buildPayload()` for serialization.
7. **Agg mode state is opaque JSON** — `aggModeState` has no schema enforcement. Only `ui/aggregation.ts` knows how to read/write its shape.
8. **SQL identifiers always quoted** — use `quoteId()` from `sqldb.ts`, never concatenate identifiers directly.
9. **State and SQLite DB are separate concerns** — state holds metadata/config, SQLite holds data rows. `ingestSheet()` is the bridge that keeps them consistent.

## Investigation Entrypoints

### Bug: Stale state / UI not reflecting changes
- Check if `invalidateValidation()` was called after the mutation.
- Check if `resetLayoutSelection()` was called (for column visibility issues).
- Check store subscription wiring — listeners fire on every `update()`/`set()` call.
- Look at `getValidation()` cache invalidation — it compares `_validationCacheState !== currentState`.

### Bug: Load failure / .rcjson not loading
- Check `isRecognizableConfig()` — are at least 2 of `RECOGNIZABLE_KEYS` present?
- Check version mismatch in `loadState` — it logs a warning but proceeds.
- Check `brokenRefs` in `hydrateState()` return — they are surfaced as warnings, not errors.
- Check that `tables` exist in the store before loading — `hydrateState` uses `loadedTables` from `store.getState().tables`.

### Bug: Serialization / hydration mismatch
- Round-trip test: `buildPayload(state)` → `JSON.parse(JSON.stringify(...))` → `hydrateState(payload, tables)` → `applyState(...)`. Check Set↔array conversion for `selCols` and `excludedRows`.
- Check `aggModeState` deep clone in buildPayload — uses `JSON.parse(JSON.stringify(...))`.
- Check `saveActiveAggModeState()` was called before serialization.

### Bug: State reverts after mode switch
- Check `saveActiveAggModeState()` is called in `setAggMode()` before the mode key is changed.
- Check `aggModeState[mode]` exists and has the right shape — `ensureAggModeState()` creates defaults for missing modes.

### Bug: Data inconsistency after file load
- Check `ingestSheet()` — does it `dropTable` and recreate for re-imports? (Yes, lines 95-98.)
- Check `excludedRows` for the re-imported table — stale excluded rows are deleted on re-import (line 97).
- Check `tableColors` — new table gets a color via `getTableColor()`.

## Proven Pitfalls

- **SSR / test environments:** `saveState()` accesses `window.prompt` and `document.createElement` — guard with `typeof window !== 'undefined'` (done). `toast()` accesses the DOM — must not be called in non-browser contexts.
- **`_seenCols` global set:** Accumulates across config loads — `resetLayoutSelection()` clears it, but if a code path skips this call, columns from previous configs remain "seen" and affect auto-selection behavior.
- **No strict validation:** Hydration does not enforce that every required field exists — missing fields get defaults. `isRecognizableConfig` is a heuristic (>=2 keys), not a JSON Schema.

## Sources

- All files in `SRC/preact/core/`
- `SRC/preact/report/validation.ts`
- `SRC/preact/ui/aggregation.ts`
- `SRC/preact/ui/loader.ts`
- `SRC/preact/query/layout-selection.ts`
- `SRC/preact/query/query-plan.ts`
- `SRC/preact/report/engine.ts`
- `SRC/preact/types.ts`
- `SRC/preact/index.ts`
- Tests: `SRC/preact/tests/core/store.test.ts`, `state.test.ts`, `state-serializer.test.ts`, `state-serializer-bands.test.ts`, `state-hydrator-bands.test.ts`, `SRC/preact/tests/integration/state-loading.test.ts`
