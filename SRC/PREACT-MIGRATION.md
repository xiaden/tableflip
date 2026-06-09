# Preact Migration Plan

## Status: Complete

## Phase 1: Build Pipeline
- [x] Install `preact` dependency
- [x] Configure JSX in `tsconfig.json` + `tsconfig.dev.json`
- [x] Configure JSX transform in `scripts/build.mjs`
- [x] Configure JSX in `vitest.config.ts`
- [x] Update `eslint.config.js` for `.tsx` files
- [x] Verify: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass

## Phase 2: Component Conversions
- [x] `chip.ts` → `chip.tsx` — Preact `<Chip>` component, no legacy code
- [x] `tip.ts` → `tip.tsx` — Preact `<Tip>` component, no legacy code
- [x] `modal.ts` → `modal.tsx` — Preact `<Modal>` component with createPortal, no legacy code
- [x] `context-menu.ts` → `context-menu.tsx` — Preact `<ContextMenu>` component with createPortal, no legacy code
- [x] `rename-modal.ts` → `rename-modal.tsx` — Preact `<RenameModal>` component, no legacy code

## Phase 3: View Conversions
- [x] `output-card.ts` → `output-card.tsx` — `<ColChips>`, `<MergeToggles>` with state-driven `<ContextMenu>` and `<RenameModal>`
- [x] `pipeline-card.ts` → `pipeline-card.tsx` — `<Pipeline>` with sub-components `<BaseStage>`, `<StackSheets>`, `<LookupStage>`, `<CalcStageComponent>`, `<PipelineArrow>`
- [x] `filter-sort-card.ts` → `filter-sort-card.tsx` — `<Filters>`, `<Sorts>` with per-row components
- [x] `query-builder.ts` → `query-builder.tsx` — `<QueryBuilder>` orchestrator composing all sub-components
- [x] `grid.ts` — removed `$()` import, uses `document.getElementById()` directly (AG Grid stays imperative)

## Phase 4: Cleanup
- [x] Deleted `dom.ts` — replaced by Preact refs and JSX
- [x] Deleted `events.ts` — replaced by Preact synthetic events
- [x] Deleted `button.ts` — dormant, unused
- [x] Deleted `select.ts` — dormant, unused
- [x] Deleted `card.ts` — dormant, unused

## Architecture

### State Pattern
- `db` stays as mutable global object
- Preact components read from `db` during render
- Event handlers mutate `db` then call `renderQueryBuilder()` which calls `render(<QueryBuilder />, root)` to re-render the tree
- This is the "global state with imperative re-render" pattern — simple, no state management library needed

### Component Hierarchy
```
QueryBuilder
├── Pipeline
│   ├── BaseStage (base sheet selector + column chips)
│   ├── StackSheets (stack sheet chips)
│   ├── LookupStage[] (lookup config + column chips)
│   ├── CalcStageComponent[] (calc config + output chip)
│   └── PipelineArrow[] (preview toggles)
├── ColChips (report layout chips + drag-and-drop)
│   └── ContextMenu / RenameModal (state-driven overlays)
├── Filters (filter rows)
├── Sorts (sort rows)
└── MergeToggles (merge duplicate cells)
```

### AG Grid
- Stays imperative (`agGrid.createGrid`)
- Grid header components use `render()` from preact/compat to mount `<RenameModal>` (non-Preact context)
- Container div managed by `document.getElementById()`

### Remaining Non-Preact Code
- `aggregation.ts` — still uses innerHTML rendering (not yet converted)
- `sidebar.ts` — still uses innerHTML rendering (not yet converted)
- `loader.ts` — file loading modal uses innerHTML (not yet converted)
- `export.ts` — export logic, no rendering
- `tabs.ts` — tab switching, minimal DOM
- `app.ts` — tooltip system uses document-level event listeners
