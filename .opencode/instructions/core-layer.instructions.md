---
name: Core Layer
description: Infrastructure services — SQLite, reactive store, state management, utilities. Applies when editing files in preact/core/.
applyTo: SRC/preact/core/**
---

# Core Layer

**Purpose:** Provide infrastructure services (SQLite access, reactive state store, state serialization/hydration, date utilities, and general helpers) that all other layers depend on.

## File Naming

- `sql*.ts` — database initialization and query execution
- `store.ts` — reactive pub/sub state store (singleton)
- `state*.ts` — state factory functions, serialization, loading, hydration, application, schema versioning
- `date-format.ts` — date parsing/normalization utilities
- `utils.ts` — general-purpose helpers (DOM toasts, HTML escaping, color management, column label utilities)

## Allowed Imports

Core files may import from:

| Source | Examples | Notes |
|---|---|---|
| `../types` | `AppState`, `ReportSpec`, etc. | Shared type definitions |
| Core siblings (`./`) | `./store`, `./state`, `./utils` | Within-layer references only |
| `../catalog/` | `source-catalog`, `column-catalog` | Rare — only `state-hydrator.ts` needs column projection during hydration |
| `../report/validation` | `invalidateValidation` | Only `state-applier.ts` |
| `../query/` | `layout-selection` | Cross-layer, only for resetting layout on state apply |
| `../ui/` | `aggregation` | Rare — `state-serializer.ts` needs agg mode state sync |

**Never import** from `../report/` other than `validation`, or from `../ui/` other than the specific `aggregation` module used by the serializer.

## Forbidden Patterns

1. **No direct `getState()` mutation** — Never mutate the return value of `getState()` directly. All mutations go through `store.update()` or `store.set()`. The cloned draft inside `update()` is the only mutable reference.

2. **No raw SQL identifier concatenation** — Always use `quoteId()` from `sqldb.ts` when building SQL strings with table or column names. Never do `"SELECT * FROM " + tableName`.

3. **No unguarded DOM access** — Any code touching `window`, `document`, `FileReader`, `Blob`, `URL`, `setTimeout`, `prompt`, or `alert` must be guarded with `typeof window !== 'undefined'` or equivalent. Core layer code may run in non-browser environments (tests, SSR).

4. **No UI rendering logic** — Core must not import Preact components, create DOM elements for display, or manage rendering. The `utils.ts` toast helpers are an allowed exception — they create ephemeral DOM elements for notification, not persistent UI.

5. **No business logic** — Core layer does not resolve columns (Catalog), generate SQL (Query), execute reports (Report), or orchestrate user workflows.

6. **No direct `window.sqlDb` assignment** outside `sqldb.ts` — Database init is `sqldb.ts`'s responsibility. Other core files use `execQuery`, `insertRows`, etc.

## Required Patterns

1. **All state mutations go through `store.update()` or `store.set()`** — Never mutate `getState()` return value directly. Use the draft pattern inside `update()`.

2. **`invalidateValidation()` must be called after any DB-affecting or config-changing state mutation** — See `state-applier.ts` for the canonical pattern. Without this, validation results stay stale.

3. **SQL identifiers must use `quoteId()` from `sqldb.ts`** — Never concatenate identifiers directly into SQL strings. This prevents SQL injection and handles special characters.

4. **`typeof window !== 'undefined'` guards required for browser-specific code** — Wrap `window`, `document`, `Blob`, `FileReader`, `prompt`, `URL`, `setTimeout`, and other browser APIs in a guard. Tests and future non-browser environments execute these files.

5. **State factory functions go in `state.ts`** — `createAppState`, `createReportSpec`, `createLookupSpec`, `createDetailBandSpec`, `createFilterSpec`, `createSortSpec`, `createOutputColumnSpec`. Each returns a complete default object that callers partially override.

6. **Set values serialize explicitly** — State includes `Set` objects (e.g., `selCols`, `excludedRows`). Serialization code must convert these to arrays (`[...set]`) and back (`new Set(arr)`). See `state-serializer.ts` and `state-hydrator.ts` for the pattern.

## Validation

After editing any core layer file, run:

```sh
npm run typecheck   # zero errors required
npm run lint        # zero warnings required
npm test            # all tests must pass
```
