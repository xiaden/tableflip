# Preact-to-React UI Layer Conversion — Design Document

**Status:** Draft  
**Author:** RnD-DDAuthor  
**Created:** 2026-06-15  

**Related Documents:**
- [ADR-002: Five-Layer Architecture](artifacts/decisions/ADR-002-five-layer-architecture.md) — Five-layer architecture — establishes that only the UI layer changes. Core/Catalog/Query/Report are untouched.
- [ADR-006: Monolithic State Store](artifacts/decisions/ADR-006-monolithic-state-store-single-source-of-truth-for-reactivity-and-serialization.md) — Monolithic state store — the store is preserved as-is. The React adapter hook wraps it without modification.
- [ADR-007: Signal-Based State (to be superseded)](artifacts/decisions/ADR-007-signal-based-state-with-explicit-serialization-subscriber.md) — Signal-based state — PROPOSED, must be SUPERSEDED if React conversion proceeds. Opposite direction.
- [DD-pivot-table-ui-redesign](artifacts/designs/pending/DD-pivot-table-ui-redesign.md) — Pivot-table UI redesign — touches the same ~25 UI files. Sequencing must be coordinated to avoid double work.
- [DD-pipeline-preview](artifacts/designs/pending/DD-pipeline-preview.md) — Pipeline preview — modifies pipeline-card.tsx and pipeline-arrow.tsx (in conversion scope). Must coordinate timing.
- [DD-store-alias-rename](artifacts/designs/pending/DD-store-alias-rename.md) — Store alias rename — modifies calc-stage.tsx, rename-modal.tsx (in conversion scope). Small changes, should land first.
- [DD-needs-sync-state-separation](artifacts/designs/pending/DD-needs-sync-state-separation.md) — State separation — proposes fieldFlags on AppState. Compatible but coordinate type changes.
- [DD-preact-rebuild-architecture](artifacts/designs/completed/DD-preact-rebuild-architecture.md) — The original Preact rebuild design. This conversion replaces the UI layer it specified while preserving all lower layers.

---

## Scope

## Scope

**In scope:**
- All 25 component/UI files in `SRC/preact/ui/` (app.tsx, sidebar.tsx, grid.tsx, file-loader.tsx, cards/*, sections/*, components/*)
- Store adapter hook (`useStore`) bridging existing `core/store.ts` to React — NO changes to the store itself
- Build pipeline migration: esbuild → Vite + @vitejs/plugin-react
- tsconfig.json: `jsxImportSource` from `preact` to `react`
- package.json: replace `preact` with `react`, `react-dom`, `@mui/material`, `@emotion/react`, `@emotion/styled`, `ag-grid-react`, `vite`, `@vitejs/plugin-react`
- Entry point migration: `preact/app.ts` (using `render`/`h`) → React `main.tsx` (using `createRoot`)
- CSS phased replacement: style.css → MUI components + sx props
- AG Grid migration: imperative `agGrid.createGrid()` → declarative `<AgGridReact>`
- ADR-007 supersession (if this design is accepted)
- Test environment setup: `@testing-library/react` for any UI tests

**Out of scope:**
- `SRC/preact/core/` — EXCEPT the thin adapter hook that wraps `getStore()` for React. The store itself (`core/store.ts`) is NOT modified.
- `SRC/preact/catalog/` — Zero changes
- `SRC/preact/query/` — Zero changes
- `SRC/preact/report/` — Zero changes
- `SRC/preact/types/` — Zero changes (AppState type unchanged)
- `SRC/preact/tests/` — Domain logic tests unchanged. Only UI tests (if any) are updated for React Testing Library.
- `SRC/js/` — Legacy JavaScript code, not part of this conversion
- `SRC/js/vendor/` and `SRC/js/wasm/` — Vendor globals unchanged
- UI redesign or new features — this is a framework conversion, not a redesign
- Pivot-table redesign (DD-pivot-table-ui-redesign) — separate effort, must be coordinated (see Open Questions)

---

## Problem Statement

The TableFlip UI layer is built on Preact with a custom CSS stylesheet (~900 lines) and imperative AG Grid integration. The project has decided to migrate the UI layer from Preact to React + Material UI (MUI) to gain access to the React ecosystem, a mature component library, and standard tooling (Vite, React DevTools, React Testing Library). This conversion must preserve the existing five-layer architecture (ADR-002), keep the monolithic state store unchanged (ADR-006), introduce zero behavioral changes to the UI, and maintain all 1030 passing tests. The conversion touches ~25 component files in `SRC/preact/ui/` while leaving Core, Catalog, Query, and Report layers completely untouched.

---

## Architecture

## Architecture

### Layer Mapping

The five-layer architecture (ADR-002) is preserved. Only the UI layer changes framework — all lower layers remain untouched.

| Component | Layer | Current (Preact) | Target (React + MUI) | Responsibility |
|---|---|---|---|---|
| `app.tsx` | UI | Preact FC | React FC | App shell, tab switching, panel composition |
| `sidebar.tsx` | UI | Preact FC | React FC + MUI List | Table list, color chips, remove/preview |
| `grid.tsx` | UI | Imperative `agGrid.createGrid()` | `<AgGridReact>` declarative | Result/preview grid rendering |
| `file-loader.tsx` | UI | Preact FC + `createPortal` | React FC + MUI Dialog | File drop, sheet selector, loading overlay |
| `cards/*` (3 files) | UI | Preact FCs | React FCs + MUI Card/Paper | Pipeline, layout, filter/sort cards |
| `sections/*` (11 files) | UI | Preact FCs | React FCs + MUI form controls | Pipeline stages, filter/sort lists |
| `components/*` (7 files) | UI | Preact FCs | React FCs + MUI equivalents | Modal→Dialog, Chip→Chip, ContextMenu→Menu, Tip→Tooltip |
| `aggregation.ts` | UI (logic) | Pure store mutations | **Unchanged** | Aggregation mode state management |
| `tabs.ts` | UI (logic) | Pure store mutation | **Unchanged** | Tab switching |
| `export.ts` | UI (logic) | Pure logic | **Unchanged** | Export triggers |
| `loader.ts` | UI (logic) | Pure logic | **Unchanged** | File data ingestion |
| `core/store.ts` | Core | Pub/sub store | **Unchanged** (adapter in UI) | State management |
| `core/*` (other) | Core | Pure TypeScript | **Unchanged** | DB, utils, state |
| `catalog/*` | Catalog | Pure TypeScript | **Unchanged** | Column/source metadata |
| `query/*` | Query | Pure TypeScript | **Unchanged** | SQL generation |
| `report/*` | Report | Pure TypeScript | **Unchanged** | Execution, validation, export |

### Store Adapter Layer

The existing store (`core/store.ts`, 116 lines) is framework-agnostic pub/sub. Every UI component currently uses an identical subscription pattern:

```tsx
// Current Preact pattern (repeated in ~20 components)
const [state, setState] = useState<AppState>(getStore().getState());
useEffect(() => {
  const unsub = getStore().subscribe(s => setState(s));
  return unsub;
}, []);
```

This maps directly to React's `useSyncExternalStore` — the API designed for exactly this pattern. A single custom hook replaces all instances:

```tsx
// New React pattern
import { useSyncExternalStore } from 'react';
import { getStore } from '../core/store';

function useStore(): AppState {
  return useSyncExternalStore(
    (cb) => getStore().subscribe(cb),
    () => getStore().getState()
  );
}
```

**Why `useSyncExternalStore` over alternatives:**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `useSyncExternalStore` | Built into React 18+, designed for external stores, tear-free reads | Requires `getSnapshot` to return stable reference | **Recommended** — store already returns stable reference from `getState()` |
| Custom `useStore` hook wrapping `useState`+`useEffect` | Simple, familiar | Broadcast re-renders on every change (same as today), no concurrent-mode safety | Rejected — same problems as current pattern |
| Zustand | Selector-based granular subscriptions, middleware ecosystem | New dependency, wraps the existing store in another abstraction, serialization adapter needed | Rejected — store already works, adding Zustand duplicates it |
| Preact signals (ADR-007) | Granular reactivity | Opposite framework direction, serialization adapter needed, Set preservation issues | Rejected — ADR-007 superseded by this conversion |

**Broadcast cost mitigation:** The current store notifies ALL subscribers on every change. With `useSyncExternalStore`, React will re-render any component that calls `useStore()` on every state change — same as today. Components must continue using their own change detection (comparing specific fields) to avoid unnecessary re-renders. This is unchanged from the Preact version. Future optimization (selector-based subscriptions) can be added without changing the store.

### Build Pipeline

**Decision: Adopt Vite with `@vitejs/plugin-react`**

| Aspect | Current (esbuild) | Target (Vite) |
|---|---|---|
| Dev command | `tsc --watch` (typecheck only, no HMR, no bundle) | `vite` (dev server + HMR + React Fast Refresh) |
| Dev experience | Edit → manual browser refresh | Edit → instant HMR with component state preservation |
| Production build | Custom `scripts/build.mjs` (esbuild-wasm) | `vite build` (Rollup-based, tree-shaken) |
| JSX transform | esbuild `jsxImportSource: preact` | `@vitejs/plugin-react` (React automatic JSX) |
| TypeScript | `tsc --noEmit` for typecheck | `vite-plugin-checker` or keep `tsc --noEmit` separately |
| Vendor globals | `<script>` tags in index.html | `public/` directory (unchanged loading mechanism) |
| CSS | `style.css` via `<link>` in index.html | Vite CSS handling + MUI Emotion CSS-in-JS |

**Why Vite over esbuild reconfig:**
1. **HMR** — The current dev workflow has NO hot module replacement. `tsc --watch` only typechecks. Vite provides instant HMR with React Fast Refresh (component state preserved across edits). This is a qualitative DX improvement.
2. **React Fast Refresh** — Vite's `@vitejs/plugin-react` includes the React Refresh runtime. esbuild does not support this.
3. **Standard tooling** — Vite is the standard React development toolchain. Future contributors will be familiar with it.
4. **Production parity** — Vite's production build (Rollup) produces well-optimized bundles with tree-shaking. esbuild's bundle is fast but less optimized.

**Migration path for build:**
1. Add `vite.config.ts` with `@vitejs/plugin-react`
2. Move `index.html` to project root (Vite convention) or configure `root`
3. Move vendor assets to `public/` directory (served as-is)
4. Update `package.json` scripts: `dev` → `vite`, `build` → `vite build`
5. Keep `typecheck` script as `tsc --noEmit` (Vite does not typecheck)
6. Remove `scripts/build.mjs` after validation

**tsconfig.json changes:**
```diff
- "jsxImportSource": "preact",
+ "jsxImportSource": "react",
+ "types": ["node", "vite/client"],
```

### AG Grid Integration Migration

**Current pattern (imperative):**
- Module-level singletons: `let gridResult: AGridApi | null` and `let gridPreview: AGridApi | null`
- `useEffect` creates grid via `agGrid.createGrid(el, options)` on mount, destroys on cleanup
- Anonymous class-based header components (`_makeHeaderComponent`) implementing AG Grid's `init()/getGui()/destroy()/refresh()` interface
- Double-RAF hacks for layout refresh: `requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()))`
- External refresh functions (`refreshResultGridLayout`, `refreshPreviewGridLayout`) reach into module singletons

**Target pattern (declarative with `ag-grid-react`):**

```tsx
import { AgGridReact } from 'ag-grid-react';

function ResultGrid({ result, onRenameDone }: ResultGridProps) {
  const gridRef = useRef<AgGridReact>(null);
  
  const columnDefs = useMemo(() => makeResultCols(cols, ...), [cols]);
  const rowData = useMemo(() => result.rows, [result]);
  
  return (
    <AgGridReact
      ref={gridRef}
      rowData={rowData}
      columnDefs={columnDefs}
      defaultColDef={defaultColDef}
      pagination={true}
      onColumnMoved={saveColState}
      // ... other options
    />
  );
}
```

**Key changes:**
1. **No module singletons** — Grid API accessed via `gridRef.current.api`
2. **No anonymous classes** — Header components become React functional components rendered via `headerComponentFramework`
3. **No double-RAF hacks** — `ag-grid-react` handles layout lifecycle
4. **Refresh functions** — Become ref-based: `gridRef.current?.api.resetRowHeights()` etc.
5. **Column state persistence** — `onColumnMoved`/`onColumnResized` callbacks unchanged, just access API via ref

**Header component migration:**
The current `_makeHeaderComponent` returns an anonymous class with `init()` that builds DOM via `document.createElement`. This becomes a React functional component:

```tsx
function ColumnHeader({ label, color, renamed, onRename, onClear, onContextMenu }: HeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '3px', width: '100%', overflow: 'hidden' }}>
      {color && <Box sx={{ width: 3, flexShrink: 0, alignSelf: 'stretch', background: color, borderRadius: '1px' }} />}
      <Typography noWrap sx={{ flex: 1, cursor: 'pointer' }} onClick={...}>{label}</Typography>
      {onRename && <IconButton size="small" onClick={onRename} onContextMenu={onContextMenu}>⋯</IconButton>}
      {onClear && <IconButton size="small" onClick={onClear}>×</IconButton>}
    </Box>
  );
}
```

AG Grid React supports React components as header components via `frameworkComponents` or inline `headerComponent` props.

### CSS Replacement Strategy

**Current state:** ~900 lines of custom CSS in `style.css` covering layout, cards, sections, components, grid, modals, tooltips, and responsive behavior.

**MUI component mapping:**

| Current CSS/Component | MUI Equivalent | CSS Lines Eliminated |
|---|---|---|
| `.modal`, `.modal-backdrop`, `.modal-content`, `.modal-title`, `.modal-body`, `.modal-buttons` | `<Dialog>`, `<DialogTitle>`, `<DialogContent>`, `<DialogActions>` | ~60 lines |
| `.btn`, `.btn-primary`, `.btn-ghost` | `<Button variant="contained|outlined|text">` | ~40 lines |
| `.chip`, `.chip-remove` | `<Chip>` with `onDelete` | ~30 lines |
| `.ctx-menu`, `.ctx-menu-item` | `<Menu>`, `<MenuItem>` | ~35 lines |
| `.tabs`, `.tab-btn`, `.tab-content`, `.tab-panel` | `<Tabs>`, `<Tab>`, `<TabPanel>` (custom) | ~45 lines |
| `.pipeline`, `.pl-stage`, `.pl-h-arrow`, `.pl-v-arrow-stacked`, `.pl-add-btn` | `<Card>`, `<Stack>`, custom arrow components | ~80 lines |
| `.sidebar`, `.sidebar-wrap`, `.tcard`, `.tcard-name`, `.tcard-meta`, `.tcard-rm` | `<Drawer>` or `<Box>`, `<List>`, `<ListItem>` | ~70 lines |
| `.hdr`, `.layout`, `.main`, `.data-body`, `.qb-body` | `<AppBar>`, `<Box>`, `<Stack>` | ~50 lines |
| `.empty`, `.empty-icon`, `.empty-title`, `.empty-sub` | Custom component with MUI Typography + Stack | ~25 lines |
| `[data-tip]` tooltip engine (JS + CSS) | `<Tooltip>` | ~30 lines CSS + 30 lines JS |
| `select`, `input[type=checkbox]`, `input[type=radio]` | `<Select>`, `<Checkbox>`, `<Radio>` | ~20 lines |
| `.sheet-opt`, `.sheet-opt-name`, `.sheet-opt-meta` | `<ListItem>` with `<ListItemText>` | ~15 lines |
| `.drop-overlay`, `.load-overlay`, `.lo-spinner` | `<Backdrop>` with `<CircularProgress>` | ~30 lines |
| `.sidebar-footer`, `.sidebar-save-btn` | `<Box>` + `<Button>` | ~10 lines |
| `.results-bar`, `.results-count` | `<Toolbar>` + `<Typography>` | ~15 lines |
| `.grid-wrap`, `.ag-theme-balham-dark` overrides | AG Grid theme + MUI Box | ~20 lines |
| Various responsive/media queries | MUI `sx` responsive syntax | ~40 lines |
| **Remaining custom CSS** | Pipeline arrows, band tints, specialized layouts | ~120 lines |

**Phased approach:**
1. **Phase 1 (tooling):** Add MUI, keep `style.css` entirely. MUI components coexist with custom CSS.
2. **Phase 2 (components):** Replace Modal, Chip, ContextMenu, Tip with MUI equivalents. Remove corresponding CSS blocks.
3. **Phase 3 (layout):** Replace layout CSS (`.hdr`, `.layout`, `.main`, `.sidebar`, `.tabs`) with MUI layout components. Remove corresponding CSS blocks.
4. **Phase 4 (cards/sections):** Replace card and section styling with MUI Card/Paper/Stack. Remove corresponding CSS blocks.
5. **Phase 5 (cleanup):** Remove `style.css` entirely. Remaining ~120 lines of specialized CSS (pipeline arrows, band tints) move to inline `sx` props or a minimal `theme.css`.

### Data Model

**No changes.** The `AppState` type, store shape, `.rcjson` serialization format, and all data flow remain identical. The store adapter reads the same `AppState` object. The only addition is the `useStore()` hook in the UI layer.

### API Surface

**No changes.** There are no API endpoints — this is a client-side application. The internal module APIs (`getStore()`, `initStore()`, `store.update()`, `store.subscribe()`) remain unchanged.

### Workflows

**Component conversion workflow (per file):**
1. Change imports: `preact/hooks` → `react`, `preact` → `react`
2. Replace `class` → `className` (or use MUI `sx` prop)
3. Replace `getStore().subscribe()` pattern with `useStore()` hook
4. Replace Preact components with MUI equivalents
5. Replace `createPortal` with React's `createPortal` (same API)
6. Replace `h()` utility with React JSX (automatic with `jsxImportSource: "react"`)
7. Replace `ref` types: `useRef<HTMLDivElement>` unchanged (React refs work the same)
8. Run typecheck + lint + tests

**Entry point migration (`app.ts` → `main.tsx`):**
```tsx
// Current (Preact)
import { render, h } from 'preact';
render(h(App, null), root);

// Target (React)
import { createRoot } from 'react-dom/client';
const root = createRoot(document.getElementById('app')!);
root.render(<App />);
```

---

## Design Goals

1. **Zero behavioral changes** — pixel-perfect UI conversion, not redesign. Every interaction, layout, color, and animation must match the current Preact UI.
2. **All 1030 tests still pass** — domain logic tests are framework-agnostic. UI tests (if any) are updated to React Testing Library.
3. **TypeScript strictness preserved** — `strict: true`, no `any` types for framework bridging.
4. **Minimal new dependencies** — react, react-dom, @mui/material, @emotion/react, @emotion/styled, ag-grid-react. No Zustand, no React Router, no other state/routing libraries.
5. **Five-layer architecture unchanged** — Core, Catalog, Query, Report layers are untouched. Only UI layer changes framework.
6. **Store unchanged** — The 116-line pub/sub store (`core/store.ts`) is preserved as-is. A thin adapter hook (`useStore`) bridges it to React.
7. **Build tooling improved** — Add Vite for HMR + React Fast Refresh (current `npm run dev` is `tsc --watch` with no HMR).

---

## Constraints

1. **Five-layer architecture preserved (ADR-002):** Only `SRC/preact/ui/` changes. Core, Catalog, Query, Report layers are untouched. The store (`core/store.ts`) is NOT replaced — a thin adapter hook wraps it.
2. **Monolithic store preserved (ADR-006):** The pub/sub store pattern, deep-clone-on-mutation, and `AppState` shape are unchanged. The adapter hook (`useStore`) bridges the existing store to React's rendering model without modifying the store itself.
3. **ADR-007 superseded:** The proposed signal-based state migration is incompatible with React conversion. If this design is accepted, ADR-007 must be marked Superseded.
4. **No behavioral changes:** This is a framework conversion, not a redesign. Every UI element, interaction, and visual appearance must be preserved pixel-for-pixel. MUI theming must match the current dark theme.
5. **All 1030 tests must pass:** Domain logic tests (core/catalog/query/report) are framework-agnostic and should pass unchanged. UI tests (if any) must be updated for React Testing Library.
6. **TypeScript strictness preserved:** `strict: true` in tsconfig. No `any` types introduced for framework bridging.
7. **Vendor globals unchanged:** AG Grid, XLSX, sql.js continue loading via `<script>` tags. `ag-grid-react` wraps the same global AG Grid module.
8. **AGENTS.md rules preserved:** No `dangerouslySetInnerHTML`, `typeof window/document` guards for SSR safety, vendored CJS modules need `@ts-expect-error`.
9. **Pivot-table redesign coordination (CRITICAL):** DD-pivot-table-ui-redesign plans to rewrite the same ~25 UI files. Sequencing decision required (see Open Questions). If React conversion proceeds first, pivot redesign must be updated to target React+MUI.
10. **Pending feature coordination:** DD-pipeline-preview (modifies pipeline-card.tsx, pipeline-arrow.tsx), DD-store-alias-rename (modifies calc-stage.tsx, rename-modal.tsx, utils.ts), DD-needs-sync-state-separation (proposes fieldFlags on AppState) — all touch files in conversion scope. These must either land before conversion or be re-targeted post-conversion.

---

## Open Questions

## Open Questions

### 1. Pivot-Table Redesign Sequencing (CRITICAL — must resolve before starting)

DD-pivot-table-ui-redesign plans to rewrite the same ~25 UI files this conversion touches. Three options:

- **Option A: React conversion first, then pivot redesign in React+MUI.** Pivot builds on the new React foundation. No double work. The old 3-tab layout exists temporarily in React before pivot replaces it with the single-screen layout. **Recommended** — mechanical work first, creative work second.
- **Option B: Pivot redesign first in Preact, then re-convert everything to React.** Double work on ~25 files (~2 extra weeks). The pivot's new Preact components must be mechanically re-converted.
- **Option C: Merge both efforts into one.** Combine React conversion + pivot redesign. Higher risk (two large changes simultaneously), but avoids the intermediate "old layout in React" state.

**Decision needed:** Which option? This determines whether the pivot DD needs to be updated to target React+MUI before either effort starts.

### 2. Build Tooling: Vite vs. esbuild Reconfig

**Recommended: Vite** (see Architecture section). Alternative: reconfigure esbuild for React JSX transform (change `jsxImportSource` to `"react"`, add React deps). This avoids adding Vite but provides NO HMR and NO React Fast Refresh — the dev experience remains "edit → manual refresh."

**Decision needed:** Vite (recommended) or esbuild-only?

### 3. Store Adapter: `useSyncExternalStore` vs. Custom Hook with Selectors

**Recommended: Plain `useSyncExternalStore`** wrapping the existing store. Every component that currently subscribes to the full state continues to receive the full state. Change detection remains the component's responsibility (same as today).

**Alternative:** Add a selector parameter to `useStore(selector)` for granular subscriptions. This reduces re-renders but adds complexity and deviates from the current pattern. Can be added later as an optimization without changing the store.

**Decision needed:** Plain subscription (recommended) or selector-based from the start?

### 4. CSS Strategy: Full MUI vs. Hybrid

**Recommended: Phased full MUI** (see CSS Replacement Strategy section). All custom CSS eventually replaced by MUI components + `sx` props. ~120 lines of specialized CSS (pipeline arrows, band tints) may remain as inline `sx` or a minimal theme CSS file.

**Alternative: Hybrid** — keep `style.css` for layout, use MUI only for form controls and shared components. Less conversion work but two styling systems coexist permanently.

**Decision needed:** Full MUI (recommended) or hybrid?

### 5. Pending Feature Coordination

Three pending design documents touch files in the conversion scope:
- DD-pipeline-preview (pipeline-card.tsx, pipeline-arrow.tsx)
- DD-store-alias-rename (calc-stage.tsx, rename-modal.tsx)
- DD-needs-sync-state-separation (AppState type)

**Decision needed:** Should these land BEFORE the React conversion (so we convert their finished output), or should they be deferred and re-targeted post-conversion?

### 6. MUI Theme Fidelity

The current UI uses a custom dark theme with CSS variables (`--bg`, `--bg2`, `--text`, `--muted`, `--border`, etc.). MUI uses its own theme system. Two approaches:

- **Map CSS variables to MUI palette:** Create a MUI theme that matches current colors exactly. MUI components render with the same visual appearance.
- **Accept MUI's default dark theme:** Let MUI's dark theme replace the current custom theme. Visual appearance changes but MUI components look consistent.

**Decision needed:** Pixel-perfect theme mapping (recommended for "zero behavioral changes" goal) or accept MUI default dark theme?

---

## Implementation Options Considered

### ADR-007 Supersession

ADR-007 (Proposed) recommends migrating to Preact signals for granular reactivity. This design goes in the opposite direction — replacing Preact entirely with React. If this design is accepted:

- ADR-007 must be marked **Superseded** with reference to this design document
- The signal migration path described in ADR-007 (signal-by-signal replacement of the monolith store) is abandoned
- React's `useSyncExternalStore` provides the bridge from the existing monolith store to React's rendering model — achieving the same goal (framework-native reactivity) without signals

### Component Conversion Inventory

**25 files in conversion scope:**

| File | Lines | Type | MUI Mapping | Complexity |
|---|---|---|---|---|
| `app.tsx` | 299 | Root shell | MUI Tabs, Box, Stack | Medium |
| `sidebar.tsx` | 129 | Root shell | MUI Drawer/List, Button | Medium |
| `grid.tsx` | 593 | AG Grid wrapper | ag-grid-react, React header components | **High** |
| `file-loader.tsx` | 329 | Root shell | MUI Dialog, Backdrop, Button | Medium |
| `loader.ts` | ~200 | Pure logic | **No conversion needed** | None |
| `export.ts` | ~100 | Pure logic | **No conversion needed** | None |
| `tabs.ts` | 11 | Pure logic | **No conversion needed** | None |
| `aggregation.ts` | 222 | Pure logic | **No conversion needed** | None |
| `components/modal.tsx` | 66 | Shared component | MUI Dialog | Low |
| `components/chip.tsx` | ~40 | Shared component | MUI Chip | Low |
| `components/context-menu.tsx` | ~60 | Shared component | MUI Menu/MenuItem | Low |
| `components/tip.tsx` | ~30 | Shared component | MUI Tooltip | Low |
| `components/calc-builder.tsx` | ~200 | Shared component | MUI form controls | Medium |
| `components/rename-modal.tsx` | ~80 | Shared component | MUI Dialog + TextField | Low |
| `components/row-explosion-dialog.tsx` | ~100 | Shared component | MUI Dialog | Low |
| `cards/pipeline-card.tsx` | 225 | Card | MUI Card, Stack, Button | Medium |
| `cards/layout-card.tsx` | ~200 | Card | MUI Card, form controls | Medium |
| `cards/filter-sort-card.tsx` | ~200 | Card | MUI Card, form controls | Medium |
| `sections/base-stage.tsx` | ~100 | Section | MUI Select, Card | Low |
| `sections/calc-stage.tsx` | ~150 | Section | MUI form controls | Medium |
| `sections/column-chips.tsx` | ~80 | Section | MUI Chip, Stack | Low |
| `sections/detail-band-stage.tsx` | ~200 | Section | MUI form controls | Medium |
| `sections/filter-list.tsx` | ~150 | Section | MUI form controls | Medium |
| `sections/lookup-stage.tsx` | ~200 | Section | MUI form controls | Medium |
| `sections/merge-toggles.tsx` | ~60 | Section | MUI ToggleButton | Low |
| `sections/pipeline-arrow.tsx` | ~120 | Section | Custom CSS arrows (kept) | Low |
| `sections/run-bar.tsx` | ~80 | Section | MUI Button, Toolbar | Low |
| `sections/sort-list.tsx` | ~120 | Section | MUI form controls | Medium |
| `sections/stack-sheets.tsx` | ~100 | Section | MUI Select, Checkbox | Low |

**Files requiring NO conversion** (pure logic, zero framework imports):
- `loader.ts` — File data ingestion
- `export.ts` — Export trigger logic
- `tabs.ts` — Tab switching (single store mutation)
- `aggregation.ts` — Aggregation mode state management (222 lines of pure store mutations)

### Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| AG Grid imperative → declarative breaks column state persistence | High | Test column state save/restore early in Phase 4. The `onColumnMoved`/`onColumnResized` callbacks are identical in ag-grid-react. |
| MUI dark theme doesn't match current CSS dark theme | Medium | Create MUI theme object mapping current CSS variables (`--bg`, `--text`, `--border`, etc.) to MUI palette. Test visually after Phase 2. |
| Pivot-table redesign scope conflict | **Critical** | Resolve sequencing in Open Questions before starting. Double work risk is ~25 files × ~2 weeks. |
| Pending features touch files in conversion scope | High | Land or defer pending DDs before starting Phase 3. See Open Questions. |
| `useSyncExternalStore` broadcast re-renders cause performance regression | Medium | Monitor with React DevTools Profiler. If needed, add selector-based subscription wrapper (still uses same store, just filters updates). |
| Vendor global loading breaks with Vite | Low | Vite `public/` directory serves files as-is. `<script>` tags in index.html work unchanged. Test early in Phase 1. |
| Test environment needs React setup | Low | Add `@testing-library/react` and `jsdom` environment config to Vitest. Most tests don't render UI. |

### Dependencies Added/Removed

**Added:**
- `react` ^19.x
- `react-dom` ^19.x
- `@mui/material` ^7.x
- `@emotion/react` ^11.x
- `@emotion/styled` ^11.x
- `ag-grid-react` ^33.x
- `@types/react` ^19.x
- `@types/react-dom` ^19.x
- `vite` ^6.x
- `@vitejs/plugin-react` ^4.x

**Removed:**
- `preact` ^10.29.2
- `esbuild` ^0.28.1 (dev dependency — replaced by Vite's built-in esbuild for dev transforms)
- `esbuild-wasm` ^0.28.1 (dev dependency — no longer needed for production build)

**Unchanged:**
- `typescript`, `vitest`, `eslint`, `jsdom`, `typedoc`, `tsx` — all remain
- AG Grid Community (vendor global) — unchanged, `ag-grid-react` wraps it
- XLSX (vendor global) — unchanged
- sql.js WASM — unchanged

---

## Appendix: Research Findings

## Appendix: Research Findings

### Store Pattern Analysis

Every UI component uses the identical subscription pattern:
```tsx
const [state, setState] = useState<AppState>(getStore().getState());
useEffect(() => {
  const unsub = getStore().subscribe(s => setState(s));
  return unsub;
}, []);
```

This is a textbook case for `useSyncExternalStore`. The store's `getState()` returns a stable reference (the same object until `update()` or `set()` is called), satisfying React's referential stability requirement for `getSnapshot`.

**Broadcast cost:** The store notifies ALL listeners on every change. With `useSyncExternalStore`, every component calling `useStore()` will be scheduled for re-render on every state change. React 18+ batches these updates and deduplicates within the same render cycle, but each component's render function still executes. This is the SAME cost as the current Preact pattern — every component calls `setState(s)` on every change, triggering re-render. The optimization path (selector-based subscriptions) is available later without changing the store.

### AG Grid Integration Analysis

Current `grid.tsx` (593 lines) has three distinct concerns:
1. **Grid lifecycle** (imperative create/destroy via `agGrid.createGrid`) — ~100 lines
2. **Column definition builders** (`makeResultCols`, `makePreviewCols`) — ~100 lines
3. **Header component factory** (`_makeHeaderComponent` returning anonymous class) — ~55 lines

The column definition builders are pure functions that return config objects — they need minimal changes (just the header component reference changes from class to React component). The lifecycle code is entirely replaced by `<AgGridReact>`. The header component factory is replaced by a React functional component.

**Module-level singletons** (`gridResult`, `gridPreview`) exist because external code (`refreshResultGridLayout`, `refreshPreviewGridLayout`) needs to reach into the grid from outside the component. With `ag-grid-react`, these become ref-based: the parent component holds the ref and passes refresh callbacks down, or uses a context/store-based approach.

**Double-RAF hack:** `requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()))` exists because AG Grid needs two frames to finish layout after becoming visible. With `ag-grid-react`, the component handles this internally via its own lifecycle. The `onGridReady` callback can be used for any post-mount layout adjustments.

### Build Pipeline Analysis

Current dev workflow:
- `npm run dev` → `tsc --watch -p tsconfig.json` → typechecks and emits to `../preact-dev/`
- Developer manually refreshes browser
- No source maps, no HMR, no Fast Refresh

Current production build:
- `npm run build` → `node scripts/build.mjs` → esbuild-wasm bundles to `../pkg/js/app.bundle.js`
- Static assets (CSS, vendor, WASM) copied manually
- index.html patched to inject bundle script

Vite replaces both:
- `npm run dev` → `vite` → dev server on :5173 with HMR + React Fast Refresh
- `npm run build` → `vite build` → optimized bundle to `dist/`
- Vendor assets in `public/` served as-is
- index.html is the Vite entry point (no patching needed)

**Output directory:** Current build outputs to `../pkg/`. Vite defaults to `dist/`. Configure `build.outDir` in `vite.config.ts` to maintain `../pkg/` output if needed for deployment.

### Pivot-Table Redesign Overlap

DD-pivot-table-ui-redesign (pending, 768 lines) plans:
- DELETE `grid.tsx` entirely (replace AG Grid with custom virtual-scrolling grid)
- Rewrite all 25 UI files in a new single-screen pivot layout
- New component hierarchy: PivotLayout → PivotSidebar + PivotToolbar + PivotGrid
- New CSS file: `pivot-layout.css`
- AppState `_ui` field for UI-only state

**Overlap with React conversion:**
- Both touch all 25 UI files
- Both replace grid.tsx (React conversion migrates to ag-grid-react; pivot deletes AG Grid entirely)
- Both replace the 3-tab layout (React conversion preserves it; pivot replaces with single-screen)

**Sequencing options:**
1. **React first, then pivot in React+MUI** — Pivot redesign builds on the new React foundation. No double work. Pivot's custom grid replaces ag-grid-react (which was a stepping stone).
2. **Pivot first in Preact, then re-convert to React** — Double work on ~25 files. The pivot's new components must be converted from Preact to React after.
3. **Merge into one effort** — Combine React conversion + pivot redesign into a single larger effort. Higher risk, but avoids intermediate state where the old 3-tab layout exists in React temporarily.

**Recommendation:** Option 1 (React first, then pivot). The React conversion is mechanical and low-risk (framework swap, same UI). The pivot redesign is creative and high-risk (new layout, new grid, new interactions). Doing the mechanical work first gives the pivot redesign a stable React+MUI foundation to build on.

### Pending Feature Coordination

| Pending DD | Files Touched | Impact on React Conversion |
|---|---|---|
| DD-pipeline-preview | pipeline-card.tsx, pipeline-arrow.tsx | Land before conversion, or re-target post-conversion |
| DD-store-alias-rename | calc-stage.tsx, rename-modal.tsx, utils.ts | Small changes — land before conversion |
| DD-needs-sync-state-separation | AppState type (core/state.ts) | Adds fieldFlags to AppState — compatible, but coordinate type changes |

### Test Strategy

Current: 1030 tests across 54 files, Vitest + jsdom.

**Impact analysis:**
- ~90% of tests are in `preact/tests/` testing core/catalog/query/report logic — **zero framework imports, unchanged**
- UI component tests (if any) would import from `preact/test-utils` — these need migration to `@testing-library/react`
- Test setup (`vitest-setup.ts`) creates fresh SQLite DB per test — **unchanged**
- Vitest config may need `@testing-library/jest-dom` matchers added

**Action items:**
1. Add `@testing-library/react` and `@testing-library/jest-dom` to devDependencies
2. Update any UI test imports from `preact` to `react`
3. Verify all 1030 tests pass after conversion

---
