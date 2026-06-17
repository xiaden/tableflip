# Preact-to-React Conversion — Implementation Plans

**Design doc:** `artifacts/designs/pending/DD-preact-to-react-conversion.md`
**Delivery model:** Sequential execution — each part depends on prior parts.

## Plans

| Plan | Title | Depends On | Scope |
| --- | --- | --- | --- |
| A | Foundation: Tooling + Store Adapter + Entry Point | None | Build pipeline, dependencies, useStore hook, main.tsx |
| B | Shared Components | A | 6 components: Modal, Chip, ContextMenu, Tip, RenameModal, CalcBuilder |
| C | AG Grid Migration | A | grid.tsx: imperative → declarative, header components |
| D | Cards + Sections | A, B | 3 cards + 11 sections: MUI form controls and layout |
| E | Root Shell + CSS Cleanup + Validation | B, C, D | app.tsx, sidebar.tsx, file-loader.tsx, CSS reduction, ADR-007 supersession |

## Dependency Graph

```
A ───┬─── B ───┐
     │         ├─── D ─── E
     ├─── C ───┘
     │
     └─── (D also depends on B)
```

## Execution Order

1. **Plan A** — Foundation (no dependencies)
2. **Plan B** — Shared components (after A)
3. **Plan C** — AG Grid migration (after A, parallel with B)
4. **Plan D** — Cards + Sections (after A + B)
5. **Plan E** — Root shell + cleanup + validation (after B + C + D)

## Per-Plan Scope

### Plan A: Foundation
Adds Vite + React + MUI + ag-grid-react dependencies. Removes preact + esbuild. Creates `vite.config.ts`. Updates `tsconfig.json` and `vitest.config.ts` jsxImportSource to `"react"`. Creates `useStore.ts` (selector-based hook using `useSyncExternalStore`). Creates `main.tsx` (React entry point with `createRoot`). Deletes `scripts/build.mjs`. Files: `package.json`, `vite.config.ts` (new), `tsconfig.json`, `vitest.config.ts`, `preact/ui/useStore.ts` (new), `preact/main.tsx` (new), `scripts/build.mjs` (deleted).

### Plan B: Shared Components
Converts 6 shared components from Preact to React + MUI. Modal→Dialog, Chip→Chip, ContextMenu→Menu/MenuItem, Tip→Tooltip, RenameModal→Dialog+TextField, CalcBuilder→MUI form controls. Removes `createPortal` from `preact/compat` (uses `react-dom`). Files: `ui/components/modal.tsx`, `ui/components/chip.tsx`, `ui/components/context-menu.tsx`, `ui/components/tip.tsx`, `ui/components/rename-modal.tsx`, `ui/components/calc-builder.tsx`.

### Plan C: AG Grid Migration
Converts `grid.tsx` from imperative `agGrid.createGrid()` to declarative `<AgGridReact>`. Removes module-level singletons. Replaces anonymous class header components with React FC `ColumnHeader`. Removes double-RAF hacks. Files: `ui/grid.tsx`.

### Plan D: Cards + Sections
Converts 14 files: 3 cards (pipeline-card, layout-card, filter-sort-card) and 11 sections (base-stage, calc-stage, column-chips, detail-band-stage, filter-list, lookup-stage, merge-toggles, pipeline-arrow, run-bar, sort-list, stack-sheets). All `getStore().subscribe()` patterns → `useStore()` hook. Custom elements → MUI form controls. Files: `ui/cards/*.tsx`, `ui/sections/*.tsx`.

### Plan E: Root Shell + CSS Cleanup + Validation
Converts 3 root shell components (app.tsx, sidebar.tsx, file-loader.tsx). Removes ~670 lines of CSS from style.css (retains ~120 lines of specialized CSS). Supersedes ADR-007. Deletes old `app.ts` entry point. Runs full validation (typecheck, lint, 1030 tests, production build). Files: `ui/app.tsx`, `ui/sidebar.tsx`, `ui/file-loader.tsx`, `css/style.css`, `preact/app.ts` (deleted), ADR-007.
