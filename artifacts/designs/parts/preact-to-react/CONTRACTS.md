# Preact-to-React Conversion — Contracts Ledger

**Design doc:** `artifacts/designs/pending/DD-preact-to-react-conversion.md`
**Last updated:** 2026-06-16 (Plan A–E created)

---

## Architectural Rules

- Only `SRC/preact/ui/` changes — Core, Catalog, Query, Report layers are untouched
- Store (`core/store.ts`) is NOT modified — a thin adapter hook (`useStore`) wraps it
- No behavioral changes — pixel-perfect visual conversion, not redesign
- No `dangerouslySetInnerHTML` — use MUI components with JSX
- `typeof window/document` guards for SSR safety
- Vendored CJS modules need `@ts-expect-error` before `import()`
- All 1030 tests must pass after conversion
- TypeScript `strict: true` preserved — no `any` types for framework bridging

---

## Collections & Methods

### useStore.ts (UI — NEW in Part A)

**Created:**
- `useStore<T>(selector: (state: AppState) => T): T` — selector-based hook using `useSyncExternalStore`. Bridges `getStore()` pub/sub to React rendering. Uses shallow equality on selected slice to prevent unnecessary re-renders.

**Calls:**
- `getStore().getState(): AppState` — from `core/store.ts` (unchanged)
- `getStore().subscribe(listener: (state, prev) => void): () => void` — from `core/store.ts` (unchanged)

### main.tsx (UI — NEW in Part A)

**Created:**
- Entry point replacing `app.ts`. Uses `createRoot` from `react-dom/client`. Calls `initDb()`, `initStore()`, then `root.render(<App />)`.

**Calls:**
- `initDb()` — from `core/sqldb` (unchanged)
- `initStore()` — from `core/store` (unchanged)

### Components (UI — converted in Parts B–E)

**Converted from Preact to React (25 files):**

Root shell (Part E):
- `app.tsx` — React FC with MUI Tabs/Box/Stack
- `sidebar.tsx` — React FC with MUI List/Button
- `file-loader.tsx` — React FC with MUI Dialog/Backdrop

AG Grid (Part C):
- `grid.tsx` — `<AgGridReact>` declarative, `ColumnHeader` React FC

Shared components (Part B):
- `components/modal.tsx` → MUI Dialog
- `components/chip.tsx` → MUI Chip
- `components/context-menu.tsx` → MUI Menu/MenuItem
- `components/tip.tsx` → MUI Tooltip
- `components/rename-modal.tsx` → MUI Dialog + TextField
- `components/calc-builder.tsx` → MUI form controls

Cards (Part D):
- `cards/pipeline-card.tsx` → MUI Card/Stack/Button
- `cards/layout-card.tsx` → MUI Card/form controls
- `cards/filter-sort-card.tsx` → MUI Card/form controls

Sections (Part D):
- `sections/base-stage.tsx` → MUI Select/Card
- `sections/calc-stage.tsx` → MUI form controls
- `sections/column-chips.tsx` → MUI Chip/Stack
- `sections/detail-band-stage.tsx` → MUI form controls
- `sections/filter-list.tsx` → MUI form controls
- `sections/lookup-stage.tsx` → MUI form controls
- `sections/merge-toggles.tsx` → MUI ToggleButton
- `sections/pipeline-arrow.tsx` → Custom CSS arrows (retained)
- `sections/run-bar.tsx` → MUI Button/Toolbar
- `sections/sort-list.tsx` → MUI form controls
- `sections/stack-sheets.tsx` → MUI Select/Checkbox

**Unchanged (pure logic, zero framework imports):**
- `loader.ts` — File data ingestion
- `export.ts` — Export trigger logic
- `tabs.ts` — Tab switching (single store mutation)
- `aggregation.ts` — Aggregation mode state management

---

## Dependencies

### Added (Part A)

| Package | Version | Purpose |
|---|---|---|
| `react` | ^19.x | UI framework |
| `react-dom` | ^19.x | DOM rendering |
| `@mui/material` | ^7.x | Component library |
| `@emotion/react` | ^11.x | MUI CSS-in-JS engine |
| `@emotion/styled` | ^11.x | MUI styled components |
| `ag-grid-react` | ^33.x | Declarative AG Grid binding |
| `vite` | ^6.x | Dev server + build tool |
| `@vitejs/plugin-react` | ^4.x | React Fast Refresh + JSX transform |
| `@types/react` | ^19.x | TypeScript types |
| `@types/react-dom` | ^19.x | TypeScript types |
| `@testing-library/react` | ^16.x | UI test utilities |
| `@testing-library/jest-dom` | ^6.x | DOM matchers |

### Removed (Part A)

| Package | Reason |
|---|---|
| `preact` ^10.29.2 | Replaced by React |
| `esbuild` ^0.28.1 | Replaced by Vite |
| `esbuild-wasm` ^0.28.1 | Replaced by Vite production build |

---

## Build Configuration Changes

| File | Change |
|---|---|
| `tsconfig.json` | `jsxImportSource`: `"preact"` → `"react"`, add `"vite/client"` to `types` |
| `vitest.config.ts` | `jsxImportSource`: `"preact"` → `"react"` |
| `package.json` scripts | `dev` → `vite`, `build` → `vite build` |
| `vite.config.ts` | New file — `@vitejs/plugin-react`, `build.outDir: ../pkg` |
| `scripts/build.mjs` | Deleted (replaced by `vite build`) |
