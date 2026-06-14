---
name: ui-composition-orientation
description: Use when working with the Preact UI layer — understanding the app shell composition, card/section/component hierarchy, store subscription pattern, ownership boundaries with core/query/report layers, AG Grid and XLSX vendor integration, export pipeline, or debugging UI behavior bugs. Also covers shared components (Modal, Chip, ContextMenu, RenameModal), tab switching, file loading UX, and the aggregation state management in ui/aggregation.ts.
---

# UI Composition Orientation

## Mental Model

The UI is a **thin reactive shell** over a five-layer architecture. It subscribes to a single flat `AppState` store (pub/sub), renders JSX, and calls domain functions on events. No business logic (SQL generation, validation, catalog building, result computation) lives in the UI layer — instead, UI components invoke pure functions from `catalog/`, `query/`, `report/`, and `core/` layers, then write results back through `store.update(draft => ...)`. The composition is **card-oriented** (PipelineCard, LayoutCard, FilterSortCard) within a three-tab shell (Query Builder, Browse Sheet, Report), with shared components (Modal, Chip, ContextMenu) rendered via `createPortal` or inline.

Three non-Preact surfaces are managed from UI code:
- **AG Grid** (grid.tsx) — created imperatively via `agGrid.createGrid(el, options)` inside useEffect refs
- **XLSX export** (export.ts) — data transformation + styling using the `XLSX` global
- **File loading** (loader.ts) — XLSX/CSV parsing via the `XLSX` global, SQLite writes via `core/sqldb`

## Coverage

**Documented:** app shell composition (App → tabs → cards → sections → components), store subscription pattern, ownership boundaries per layer, AG Grid integration lifecycle, XLSX export pipeline, file loading flow, aggregation mode state management, shared components (Modal, Chip, ContextMenu, RenameModal), tab switching, key interaction points with catalog/query/report layers, investigation entrypoints for common bug classes, known pitfalls (window assignments, grid instance tracking, `_afterCombineChange` coupling, deferred imports).

**Not yet documented:** drag-and-drop details within ColumnChips, calc-builder sub-components (MathBuilder/TextEditBuilder/CompareBuilder/DateBuilder), individual sort/filter row editing internals, tooltip engine lifecycle in app.ts, CSS class layout/style system.

**Last extended:** 2026-06-14

## Key Files

| Area | Canonical File |
|---|---|
| App entry + bootstrap | `SRC/preact/app.ts` |
| Root App component | `SRC/preact/ui/app.tsx` |
| Sidebar | `SRC/preact/ui/sidebar.tsx` |
| File loader UI (drop/overlay/modal) | `SRC/preact/ui/file-loader.tsx` |
| File loader logic (ingest) | `SRC/preact/ui/loader.ts` |
| Tab switching | `SRC/preact/ui/tabs.ts` |
| Pipeline card (base, stacks, lookups, calcs, bands) | `SRC/preact/ui/cards/pipeline-card.tsx` |
| Layout card (mode, column chips, aggregates, merges) | `SRC/preact/ui/cards/layout-card.tsx` |
| Filter/sort card | `SRC/preact/ui/cards/filter-sort-card.tsx` |
| Run bar + report execution trigger | `SRC/preact/ui/sections/run-bar.tsx` |
| Column chips (draggable, reorderable) | `SRC/preact/ui/sections/column-chips.tsx` |
| AG Grid integration (result + preview) | `SRC/preact/ui/grid.tsx` |
| Export (XLSX/CSV) | `SRC/preact/ui/export.ts` |
| Aggregation mode state management | `SRC/preact/ui/aggregation.ts` |
| Modal (portal) | `SRC/preact/ui/components/modal.tsx` |
| Context menu (portal) | `SRC/preact/ui/components/context-menu.tsx` |
| Rename modal | `SRC/preact/ui/components/rename-modal.tsx` |
| Chip component | `SRC/preact/ui/components/chip.tsx` |
| Base stage (table selector + columns) | `SRC/preact/ui/sections/base-stage.tsx` |
| Stack sheets (UNION ALL) | `SRC/preact/ui/sections/stack-sheets.tsx` |
| Lookup stage (join) | `SRC/preact/ui/sections/lookup-stage.tsx` |
| Detail band stage (1:N child rows) | `SRC/preact/ui/sections/detail-band-stage.tsx` |
| Calc stage | `SRC/preact/ui/sections/calc-stage.tsx` |
| Filter list | `SRC/preact/ui/sections/filter-list.tsx` |
| Sort list | `SRC/preact/ui/sections/sort-list.tsx` |
| Merge toggles | `SRC/preact/ui/sections/merge-toggles.tsx` |
| Reactive store | `SRC/preact/core/store.ts` |
| AppState types | `SRC/preact/types.ts` |
| Column layout/selection logic | `SRC/preact/query/layout-selection.ts` |
| Report validation | `SRC/preact/report/validation.ts` |
| Report engine | `SRC/preact/report/engine.ts` |
| Column catalog | `SRC/preact/catalog/column-catalog.ts` |
| Source catalog | `SRC/preact/catalog/source-catalog.ts` |
| Barrel exports | `SRC/preact/index.ts` |

## Composition Map

```
app.ts (bootstrap: initDb → initStore → render(App))
└── App (ui/app.tsx)
    ├── Loader (file-loader.tsx) — drag/drop overlay + sheet selector modal
    ├── Sidebar (sidebar.tsx) — table list + remove/preview actions
    └── Tab bar (ui/app.tsx inline)
        ├── "Report Setup" tab → QueryBuilderTab
        │   └── PipelineCard (cards/pipeline-card.tsx)
        │       ├── BaseStage (sections/base-stage.tsx)
        │       ├── StackSheets (sections/stack-sheets.tsx)
        │       ├── PipelineArrow (sections/pipeline-arrow.tsx)
        │       ├── [LookupStage × n] (sections/lookup-stage.tsx)
        │       ├── [CalcStageSection × n] (sections/calc-stage.tsx)
        │       └── [DetailBandStage × n] (sections/detail-band-stage.tsx)
        │   ├── LayoutCard (cards/layout-card.tsx)
        │   │   ├── ColumnChips (sections/column-chips.tsx)
        │   │   ├── AggregateItems | TotalsSection | SubtotalsSection (inline)
        │   │   └── MergeToggles (sections/merge-toggles.tsx)
        │   ├── FilterSortCard (cards/filter-sort-card.tsx)
        │   │   ├── FilterList (sections/filter-list.tsx)
        │   │   └── SortList (sections/sort-list.tsx)
        │   └── RunBar (sections/run-bar.tsx)
        │       └── RowExplosionDialog (components/row-explosion-dialog.tsx)
        ├── "Browse Sheet" tab → PreviewPanel
        │   └── PreviewGrid (grid.tsx)
        └── "Report" tab → ResultsPanel
            ├── ResultGrid (grid.tsx)
            └── Export buttons (export.ts)

Shared components (used by sections):
  ├── Chip (components/chip.tsx)
  ├── ContextMenu (components/context-menu.tsx) — rendered via createPortal
  ├── RenameModal (components/rename-modal.tsx) — uses Modal
  ├── Modal (components/modal.tsx) — rendered via createPortal
  ├── Tip (components/tip.tsx) — [data-tip] attribute based
  └── CalcBuilder variants (components/calc-builder.tsx)
```

## Ownership Boundaries

**UI owns:**
- Component rendering, store subscription lifecycle, event handlers
- Drag-and-drop reordering (column-chips, pipeline-card detail bands)
- AG Grid instance lifecycle (create/destroy in useEffect)
- File loading UX (drop zone, loading overlay, sheet selector modal)
- Export button dispatching (delegates to export.ts)
- Tab switching state (`activeTab` in store)
- Column rename UI (RenameModal → `setColLabel` in core/utils)
- Aggregation mode transition (save/restore per-mode state — see aggregation.ts)

**UI does NOT own:**
- SQL generation — that's `query/sql-where.ts`, `query/sql-joins.ts`, `query/sql-aggregates.ts`, `query/sql-detail.ts`, `query/sql-grouped.ts`, `query/sql-totals.ts`, `query/sql-subtotals.ts`, `query/sql-calcs.ts`, `query/sql-detail-bands.ts`
- Report execution — that's `report/engine.ts` (called from RunBar)
- Validation — that's `report/validation.ts` (called throughout UI via `invalidateValidation()` / `getValidation()`)
- Catalog building — that's `catalog/column-catalog.ts` and `catalog/source-catalog.ts` (called from UI for display only)
- Column visibility logic — that's `query/layout-selection.ts` (called from UI chips)
- SQLite operations — that's `core/sqldb.ts` (called or delegated by UI actions)
- State serialization/loading — that's `core/state-serializer.ts` and `core/state-loader.ts`

**Borderline (logic that lives in `ui/` but has domain character):**
- `ui/aggregation.ts` — manages per-mode state save/restore, mode switching. Could arguably live in `report/` or `core/`. The mode-transition logic (save current → switch → load new) is inherently state-management logic.
- `ui/export.ts` — data transformation (band header insertion, column filtering, merge application, styling). The export pipeline calls `XLSX` globals directly from the UI layer, but the heavy styling logic (`styleExportSheet`) is arguably a UI concern since it's formatting.
- `ui/grid.tsx` — `_displayLabel()` is a sync display label helper that reaches into store for calc stage aliases. This is a rendering concern but touches domain data.

## Integration Points

### Store Interaction Pattern (canonical)
Every UI component follows this pattern exactly:
```typescript
const [state, setState] = useState<AppState>(getStore().getState());
useEffect(() => getStore().subscribe(s => setState(s)), []);
```
Mutations use `getStore().update(draft => { draft.someField = newValue; })`. For single fields, `store.set(key, value)` is more efficient. The store is a pub/sub with deep-clone-on-write (preserves Set objects).

### AG Grid Integration
Two grid instances tracked via module-level variables (`gridResult`, `gridPreview`). Components use `useRef<HTMLDivElement>` and create grids in useEffect via `agGrid.createGrid(el, options)` (vendor global). Column definitions built by `makeResultCols()` / `makePreviewCols()`. Grid lifecycle: destroy on effect cleanup, re-create on changed props. Layout refresh uses `requestAnimationFrame(() => requestAnimationFrame(...))` double-RAF hack for timing.

### Query Layer Coupling
The function `_afterCombineChange()` from `query/layout-selection.ts` is called from nearly every UI mutation that changes the pipeline (add/remove lookup, toggle column visibility, change base table, reorder columns, etc.). It: (1) invalidates validation, (2) rebuilds colSourceMap, (3) auto-adds new columns to selCols, (4) removes stale columns, (5) syncs colOrder, (6) syncs subtotalBy. This is the **primary coupling point** between UI and query layers.

### Validation
`invalidateValidation()` from `report/validation.ts` is called after any state change that could affect report validity. `getValidation()` returns the cached result. The RunBar reads validation status to show a "Blocked" vs "Healthy" pill and disable the run button. Detail bands call `invalidateValidation()` after every mutation (they don't use `_afterCombineChange()`).

### Export Pipeline
`exportAs(fmt)` reads `store.getState().result`, validates, builds column maps via `catalog/column-catalog`, applies band header enrichment, applies merge logic, styles the worksheet, and triggers a file download via the `dl()` utility. Uses `XLSX.utils.json_to_sheet`, `XLSX.utils.book_new`, `XLSX.writeFile`.

### File Loading Pipeline
`loadSpreadsheet(file, store)` → delegates to `loadState()` for `.rcjson`, or to `XLSX.read()` + `ingestSheet()` for spreadsheets. `ingestSheet()` expands merged cells, converts to JSON, creates SQLite table, inserts rows, detects potential totals rows, collects column samples, and updates store. UI shows overlays during loading and a sheet-selector modal for multi-sheet workbooks.

## Investigation Entrypoints

| Bug Symptom | Start Here |
|---|---|
| **Results don't match expectations** | `SRC/preact/report/engine.ts` — trace `runReport()` → `buildQueryPlan()` → SQL execution |
| **Validation says blocked but shouldn't be** | `SRC/preact/report/validation.ts` — `deriveValidation()` traverses pipeline items |
| **UI not reacting to state change** | Check store subscription in the component — missing `useEffect` or stale `state` value |
| **Column not showing/hiding on click** | `SRC/preact/query/layout-selection.ts` — `_isSourceVisibleInLayout()`, `_showLayoutAliasesForSource()`, `_hideLayoutAliasesForSource()` |
| **Column order lost after pipeline change** | `SRC/preact/query/layout-selection.ts` — `_afterCombineChange()` syncs `colOrder` |
| **Grid blank or not rendering** | `SRC/preact/ui/grid.tsx` — check AG Grid instance creation and DOM ref. Look for `gridResult`/`gridPreview` module-level variables |
| **Grid column state not restoring** | `SRC/preact/ui/grid.tsx` — `colState` applied after grid creation; check `_saveResultColState()` |
| **Export wrong/missing columns or headers** | `SRC/preact/ui/export.ts` — `filterExportCols()`, `buildExportHeaderMap()`, `enrichRowsWithBandHeaders()` |
| **File not loading or wrong data** | `SRC/preact/ui/loader.ts` — `loadSpreadsheet()` → `ingestSheet()` → SQLite insert chain |
| **Modal not appearing/behaving** | `SRC/preact/ui/components/modal.tsx` — uses `createPortal` to `document.body` |
| **Aggregation mode state loss** | `SRC/preact/ui/aggregation.ts` — `saveActiveAggModeState()` / `loadAggModeState()` |
| **Detail band not producing rows** | `SRC/preact/query/sql-detail-bands.ts` — `buildBandQuery()`, also check `engine.ts` band stitching |

### Tracing a Bug without Rereading the Tree
1. **Find the UI component** — the symptom tells you the UI area (sidebar, grid, pipeline card, etc.)
2. **Check its store subscription** — every component subscribes in a useEffect; if the subscription is stale or missing, the component won't react to state changes
3. **Find the event handler** — every user action (click, drag, select change) either calls `store.update()` directly, or calls a domain function (from core/query/report) that may call `store.update()` internally
4. **Check `_afterCombineChange()`** — if the mutation changed the pipeline, this is called after; it may auto-adjust selCols/colOrder in ways that look like bugs
5. **Read domain code** — if the UI reads a value that looks wrong, find where that value is computed in catalog/query/report

## Critical Invariants

- **Never mutate store state directly** — always use `getStore().update(draft => { ... })` or `store.set(key, value)`. The store clones the state before each update; mutations to the reference returned by `getState()` are silently lost.
- **AG Grid instances are module-level singletons** — `gridResult` and `gridPreview` in `grid.tsx`. Only one result grid and one preview grid can exist at a time. Creating a second destroys the first.
- **`_afterCombineChange()` must be called after every pipeline state change** — this includes base table changes, lookup add/remove/toggle, calc stage add/remove, column visibility changes, column reordering, stack add/remove. Missing this call causes stale column state.
- **`invalidateValidation()` must be called after any domain state change** — validation is cached and stale until invalidated. Detail bands always call it directly (they don't use `_afterCombineChange()`).
- **`window.__loaderResolve`** — the file-loader.tsx uses this window property as a promise resolver for the sheet selector modal. This is the only window assignment in the UI layer. Its presence is a code smell — if the modal is dismissed and re-opened, stale or missing resolvers break the flow.
- **SQL identifiers must use `quoteId()`** — never concatenate table/column names into SQL strings. See AGENTS.md trap.
- **`typeof window !== 'undefined'` guards for SSR** — though the app is client-side rendered, vendor globals and DOM access must be guarded per project convention.

## Pitfalls

### `_afterCombineChange()` coupling
Nearly every UI action calls `_afterCombineChange()` after mutation. This function does a lot of implicit work (adjusts selCols, colOrder, subtotalBy, invalidates validation). It is the single most common source of "why did my columns change" confusion when investigating bugs. Trace through this function when column visibility or order behaves unexpectedly.

### AG Grid lifecycle fragility
Grids are created imperatively in useEffect hooks. The `gridResult`/`gridPreview` module-level variables mean only one instance of each type exists. If a React re-render triggers the effect cleanup without a corresponding creation (e.g., the grid container is hidden but not destroyed), the module-level variable can be stale. The double-`requestAnimationFrame` refresh hack is a sign of timing issues.

### Grid header components are untestable
`_makeHeaderComponent()` returns anonymous classes — no way to unit test them outside of AG Grid integration tests.

### Module-level mutable state in query layer
`_seenCols`, `_previewOpen`, `_disabledCardCols` in `query/layout-selection.ts` are module-level Sets with side effects. These are **not** in the store but are mutated eagerly as columns are toggled. `resetLayoutSelection()` clears them on state load. Missing a reset call can cause stale column state when loading a saved configuration.

### ColumnChips has the most mode-specific business logic
The `handleDblClick()` function in `column-chips.tsx` is 40+ lines with three branches (group mode, subtotals mode, none mode) including auto-aggregate creation and subtotal sync. This is the thickest "logic in UI" code — if aggregation behavior is wrong, the answer is likely here rather than in the report layer.

### Deferred async imports in core/utils
`core/utils.ts` imports `buildColSourceMap` from `../catalog/column-catalog.js` for catalog functions.

### XLSX export has format-specific column filtering
`filterExportCols()` keeps `_band_id` for CSV but removes it for XLSX. This means the same data exported in two formats produces structurally different rows. Band headers are inserted for XLSX but not CSV. Any downstream consumer parsing both formats must handle this asymmetry.

### Aggregation state save/restore is side-effect heavy
`setAggMode()` in `aggregation.ts` saves current mode state, switches mode, then loads saved state — all in sequence with `store.update()` calls. If the store state is partially invalid during the transition, intermediate reads (e.g., `_readAggModeState()` accessing `state.colTotals`) can produce undefined behavior.

## Sources

No ADRs or design documents exist for this subsystem. This skill was derived from reading the full `SRC/preact/ui/`, `SRC/preact/core/store.ts`, `SRC/preact/types.ts`, `SRC/preact/app.ts`, `SRC/preact/query/layout-selection.ts`, `SRC/preact/report/validation.ts`, and `SRC/preact/report/engine.ts` source trees.
