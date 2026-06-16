---
name: ag-grid-preact-integration
description: How AG Grid Community is loaded, initialized, and bridged with Preact components. Covers the imperative createGrid API, vanilla JS/DOM renderers, module-level grid instance tracking, and the absence of a reactive wrapper layer.
---

# AG Grid + Preact Integration

## Mental Model
AG Grid Community is loaded as a vendored `<script>` bundle (not npm), exposed as a global `agGrid` object on `window`. Two Preact components (`ResultGrid` and `PreviewGrid`) manage AG Grid via refs + `useEffect`, calling the imperative `agGrid.createGrid(el, options)` API. All cell renderers and header components are vanilla JS/DOM (functions returning DOM elements, or classes with `getGui()`), **not** Preact components. There is no reactive bridging layer — grid instances are tracked via module-level variables (`gridResult`, `gridPreview`), and state reads happen inline via `getStore().getState()` inside renderer callbacks.

## Coverage
**Documented:** Loading mechanism, initialization pattern, renderer/header implementation, store interaction, grid instance lifecycle, module-level tracking.
**Not yet documented:** None known.
**Last extended:** 2026-06-15

## Key Findings

### AG Grid Loading
- **Location:** `SRC/index.html:L19-L22`
- **What:** AG Grid Community is loaded via `<script>` tag pointing to `js/vendor/ag-grid-community.min.js` (1.6MB local bundle). CSS is loaded via `<link>` from `css/ag-grid.min.css` and `css/ag-theme-balham-dark.min.css`.
- **Why it matters:** AG Grid is NOT an npm dependency — it's a global script. No Preact/React wrapper packages are used. The `agGrid` global is typed in `SRC/preact/types/globals.d.ts:L59-L61`.

### Grid Initialization (Imperative API)
- **Location:** `SRC/preact/ui/grid.tsx`
- **What:** Both `ResultGrid` (line 198) and `PreviewGrid` (line 335) call `agGrid.createGrid(el, options)` inside `useEffect` hooks. The grid is destroyed and re-created on every relevant prop change (`result` or `tableId`). Options are typed as `Record<string, unknown>` — no typed AG Grid options interface.
- **Why it matters:** Grids are fully torn down and rebuilt on each change, not updated reactively. The `AGridApi` interface in `globals.d.ts` is hand-written and incomplete (e.g., `resetRowHeights` and `redrawRows` are called via `unknown` casts).

### Cell Renderers — Vanilla JS/DOM
- **Location:** `SRC/preact/ui/grid.tsx:L183-L186`, `L303-L333`, `L344-L348`, `L478-L481`, `L526-L529`
- **What:** All cell renderers are simple functions returning strings (e.g., `v == null ? '' : String(v)`) or, for the exclusion button in PreviewGrid, functions that create DOM elements via `document.createElement`. These renderers read store state inline via `getStore().getState()`. **No Preact components are used as cell renderers.**
- **Why it matters:** Cell renderers are imperative DOM, not Preact JSX. They cannot use hooks or component state. Store mutations inside event handlers call `gridPreview.refreshCells()` etc. to update the grid.

### Header Components — Vanilla JS Classes
- **Location:** `SRC/preact/ui/grid.tsx:L538-L593`
- **What:** The `_makeHeaderComponent` function returns a class with `init(params)`, `getGui()`, `destroy()`, and `refresh()` methods — the vanilla AG Grid header component API. The class creates DOM elements imperatively (color stripe, label text, rename/clear buttons, context menu trigger).
- **Why it matters:** Header components are plain JS classes, not Preact components. They cannot use JSX or hooks.

### Store Interaction Pattern
- **Location:** `SRC/preact/ui/grid.tsx` and `SRC/preact/ui/app.tsx`
- **What:** The standard Preact pattern: `useState(getStore().getState())` + `useEffect(() => getStore().subscribe(s => setState(s)), [])`. Grid components read state inline via `getStore().getState()` inside their `useEffect` (one-time snapshot at grid creation). Cell renderers call `getStore().getState()` at render time for current values.
- **Why it matters:** After grid creation, state changes do NOT automatically propagate to the grid. The `ResultGrid` component re-creates the entire grid when its `result` prop changes. The `PreviewGrid` calls `refreshCells()` manually after store updates from exclusion toggle buttons.

### Grid Instance Tracking (Module-level)
- **Location:** `SRC/preact/ui/grid.tsx:L89-L90`
- **What:** Two module-level variables `let gridResult: AGridApi | null = null` and `let gridPreview: AGridApi | null = null` hold the active grid API references. They are used by `refreshResultGridLayout()`, `refreshPreviewGridLayout()`, and inline in event handlers.
- **Why it matters:** These are global singletons, not scoped to Preact component instances. This works because the app is a single-page app with one result grid and one preview grid at any time. Export functions (`exportAs`) also reach into the grid via `getStore().getState().result` rather than through grid APIs.

### No Reactive Abstraction Layer
- **What:** There is zero reactive bridging between the Preact state store and AG Grid. No wrapper, no HOC, no custom hook that maps store state to grid options. Grid options are constructed imperatively, grid instances are managed imperatively, and cell/header renderers use vanilla JS.
- **Why it matters:** Adding Preact-based cell renderers or reactive grid options would require building a new abstraction layer from scratch — there's nothing to extend.

## Critical Invariants
- AG Grid is a global (`window.agGrid`), not an npm import.
- Grid instances are destroyed and rebuilt on prop changes (not updated reactively).
- Cell/header renderers are vanilla JS — they cannot use Preact hooks or JSX.
- The `AGridApi` type in `globals.d.ts` must be extended if new API methods are called (currently `resetRowHeights` and `redrawRows` need it but are called via `unknown` casts).
- `gridResult`/`gridPreview` module variables MUST be kept in sync with Preact lifecycle — the `useEffect` cleanup function destroys the grid and nulls the variable.

## Sources
- `SRC/preact/ui/grid.tsx` (main grid integration file, 593 lines)
- `SRC/index.html:L19-L22` (script tag loading)
- `SRC/preact/types/globals.d.ts:L58-L77` (AG Grid type declarations)
- `SRC/preact/core/store.ts` (reactive store pattern)
- `SRC/preact/ui/app.tsx` (consumers: ResultGrid, PreviewGrid usage)
- `SRC/preact/ui/export.ts` (export pipeline — uses store result, not grid API)
- `SRC/preact/tests/ui/grid-bands.test.ts` (only tests `createBandRowStyler`)
- `SRC/js/vendor/ag-grid-community.min.js` (1.6MB vendored bundle)
