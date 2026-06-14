# Design Document: Preact+TypeScript Ground-Up Rebuild

**Slug:** preact-rebuild-architecture
**Status:** Draft
**Author:** agent

## Problem Statement

The entire TableFlip application must be rebuilt from scratch in `SRC/preact/` using Preact+TypeScript. Zero imports from the old codebase (`SRC/js/core/`, `query/`, `report/`, `ui/`, `catalog/`) are allowed. Only vendor libs from `SRC/js/wasm/` (sql.js) and `SRC/js/vendor/` (AG Grid, xlsx-js-style) are valid. The old codebase serves as specification — every module's behavior must be reimplemented.

## Scope

**In scope:** Complete rebuild in `SRC/preact/`:
- Build configuration (tsconfig, esbuild, package.json scripts)
- Reactive state management
- SQLite WASM wrapper
- Utility functions
- SQL query generation (detail, grouped, totals, subtotals, calculated columns)
- Query plan builder
- Report execution engine
- Validation system
- Column/source catalog
- Data loading (XLSX/CSV via SheetJS)
- AG Grid integration (preview + results tables)
- Export (XLSX/CSV)
- Full Preact component tree
- Testing (Vitest + jsdom)

**Out of scope:**
- Old codebase `SRC/js/` — remains as reference only, not modified
- CSS — `css/style.css` reused as-is
- Vendor libs — loaded via preexisting script tags in `preact_index.html`

## Architecture

### Four-Layer Architecture (preserved from original)

```
┌──────────────────────────────────────────────┐
│  UI Layer (SRC/preact/ui/)                    │
│  Preact components, App shell, AG Grid        │
├──────────────────────────────────────────────┤
│  Report Layer (SRC/preact/report/)            │
│  Engine, validation, result set, export       │
├──────────────────────────────────────────────┤
│  Query Layer (SRC/preact/query/)              │
│  SQL generation, query plan, lookups          │
├──────────────────────────────────────────────┤
│  Catalog Layer (SRC/preact/catalog/)          │
│  Source catalog, column catalog               │
├──────────────────────────────────────────────┤
│  Core Layer (SRC/preact/core/)                │
│  Store, SQLite wrapper, utils, date-format    │
└──────────────────────────────────────────────┘
```

### Directory Structure

```
SRC/preact/
├── tsconfig.json
├── core/
│   ├── store.ts           — Reactive state store (pub/sub)
│   ├── state.ts           — State shape + constructor fns
│   ├── sqldb.ts           — SQLite WASM wrapper
│   ├── utils.ts           — Shared utilities
│   └── date-format.ts     — Date handling SQL
├── catalog/
│   ├── source-catalog.ts  — Table/column source mapping
│   └── column-catalog.ts  — Column projection & resolution
├── query/
│   ├── query-plan.ts      — Query plan builder
│   ├── sql-detail.ts      — Detail mode SQL
│   ├── sql-grouped.ts     — Grouped mode SQL
│   ├── sql-where.ts       — WHERE clause builder
│   ├── sql-joins.ts       — FROM/JOIN clause builder
│   ├── sql-totals.ts      — Totals mode SQL
│   ├── sql-subtotals.ts   — Subtotals mode SQL
│   ├── sql-calcs.ts       — Calculated columns SQL
│   ├── sql-aggregates.ts  — Aggregate expression builder
│   ├── lookup-resolver.ts — Lookup validation & planning
│   └── alias-ref-updater.ts — Alias rename propagation
├── report/
│   ├── engine.ts          — Report execution orchestrator
│   ├── validation.ts      — State/configuration validation
│   ├── calc-validator.ts  — Calc stage validation
│   ├── result-set.ts      — Result set construction
│   ├── output-layout.ts   — Output column layout
│   └── aggregation-constants.ts — Agg function definitions
├── ui/
│   ├── components/
│   │   ├── chip.tsx
│   │   ├── tip.tsx
│   │   ├── modal.tsx
│   │   ├── context-menu.tsx
│   │   ├── rename-modal.tsx
│   │   └── calc-builder.tsx
│   ├── sections/
│   │   ├── base-stage.tsx
│   │   ├── stack-sheets.tsx
│   │   ├── pipeline-arrow.tsx
│   │   ├── lookup-stage.tsx
│   │   ├── calc-stage.tsx
│   │   ├── column-chips.tsx
│   │   ├── run-bar.tsx
│   │   ├── filter-list.tsx
│   │   ├── sort-list.tsx
│   │   └── merge-toggles.tsx
│   ├── cards/
│   │   ├── pipeline-card.tsx
│   │   ├── layout-card.tsx
│   │   └── filter-sort-card.tsx
│   ├── app.tsx             — Root App component
│   ├── sidebar.tsx         — Table list & file loading
│   ├── loader.tsx          — File drop & sheet selector
│   ├── grid.ts             — AG Grid integration
│   ├── export.ts           — Export logic
│   └── tabs.ts             — Tab switching
├── app.ts                  — Entry point
├── types.ts                — Shared type declarations
└── index.ts                — Barrel exports
```

### State Management

Reactive pub/sub store. No direct `db` mutation.

```typescript
interface PreactStore {
  getState(): AppState;
  subscribe(listener: (state: AppState) => void): () => void;
  update(updater: (draft: AppState) => void): void;
  set<K extends keyof AppState>(key: K, value: AppState[K]): void;
}
```

- `getState()` returns current state snapshot
- `subscribe()` returns unsubscribe fn (call in useEffect cleanup)
- `update()` applies mutation, marks validation stale, notifies
- Components read state in render, subscribe in useEffect for side effects

### Component Tree

```
<App>
├── <Sidebar>           tables list, file upload
├── <QueryBuilder>      main tab content
│   ├── <PipelineCard>
│   │   ├── <BaseStage> + <StackSheets>
│   │   ├── <PipelineArrow>[]
│   │   ├── <LookupStage>[]
│   │   └── <CalcStage>[]
│   ├── <LayoutCard>
│   │   ├── agg mode radios
│   │   ├── <ColChips>  drag-reorderable
│   │   └── agg/totals/subtotals sections
│   ├── <FilterSortCard>
│   │   ├── <SortList> + <FilterList>
│   │   └── <MergeToggles>
│   └── <RunBar>
├── <PreviewPanel>      AG Grid preview
└── <ResultsPanel>      AG Grid results
```

### Build Pipeline

- Separate tsconfig for `SRC/preact/`
- esbuild entry: `SRC/preact/app.ts` → output to `pkg/js/preact.bundle.js`
- Build script copies `preact_index.html` to `pkg/` and rewrites script tag
- `npm run build:preact` script in package.json

## Implementation Order

**Phase 1: Foundation** — Build config + Core layer
1. tsconfig, types.ts, package.json scripts
2. State shape + store
3. SQLite wrapper
4. Utility functions
5. State constructor functions

**Phase 2: Core Business Logic** — Catalog + Query generation
6. Source catalog
7. Column catalog
8. SQL WHERE builder
9. SQL JOIN builder
10. SQL aggregate expressions
11. SQL detail mode
12. SQL grouped mode
13. Query plan builder
14. SQL totals mode
15. SQL subtotals mode
16. SQL calc columns
17. Lookup resolver
18. Alias ref updater
19. Validation system
20. Calc validator
21. Report engine
22. Result set
23. Output layout
24. Export logic

**Phase 3: UI Layer**
25. Shared components (Chip, Tip, Modal, ContextMenu, RenameModal)
26. CalcBuilder component
27. RunBar section
28. MergeToggles section
29. ColChips section
30. FilterList + SortList sections
31. BaseStage + StackSheets + PipelineArrow sections
32. LookupStage + CalcStage sections
33. PipelineCard
34. LayoutCard
35. FilterSortCard
36. Sidebar + Loader
37. App shell + tabs
38. Grid integration (AG Grid)
39. Entry point (app.ts)

**Phase 4: Testing**
40. Rebuild core tests
41. Rebuild query layer tests
42. Rebuild report layer tests
43. Integration tests

## Design Goals
- Clean TypeScript with strict types throughout
- Zero dependencies on old codebase
- Reactive state management (no imperative re-render calls)
- Preact components with proper lifecycle, minimal dangerouslySetInnerHTML
- Window globals eliminated (Preact event handlers instead)
- Full test coverage matching existing 35 test files / 786 tests

## Constraints
1. `SRC/preact/` must be self-contained — no imports from `SRC/js/` except vendor/wasm
2. `.js` extension required on all local imports (moduleResolution: bundler)
3. Vendor libs loaded via script tags in `preact_index.html`
4. esbuild for bundling
5. CSS from `css/style.css` reused directly
6. Preact with `jsxImportSource: 'preact'`, NOT React
