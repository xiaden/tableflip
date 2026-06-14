# Task: Phase E — UI Components + Sections

## Problem Statement

Phases A through D are complete. Phase E builds the Preact UI components and sections that render the query builder interface. The old codebase (`SRC/js/ui/components/`, `SRC/js/ui/views/`) provides the specification. The new code uses Preact with reactive store subscriptions instead of imperative re-render calls.

The old code uses `db` global + `renderQueryBuilder()` for updates. The new code uses `store.subscribe()` in `useEffect` hooks and `store.update()` for mutations.

## Phases

### Phase 1: Shared Components

- [ ] Create `SRC/preact/ui/components/tip.tsx` — `Tip({ text })` component. Port from `SRC/js/ui/components/tip.tsx`.
- [ ] Create `SRC/preact/ui/components/modal.tsx` — `Modal({ open, title, onClose, buttons, children })` component. Port from `SRC/js/ui/components/modal.tsx`. Uses createPortal.
- [ ] Create `SRC/preact/ui/components/context-menu.tsx` — `ContextMenu({ x, y, items, onClose })` component. Port from `SRC/js/ui/components/context-menu.tsx`. Uses createPortal.
- [ ] Create `SRC/preact/ui/components/chip.tsx` — `Chip({ col, label, colorClass, selected, ... })` component. Port from `SRC/js/ui/components/chip.tsx`.

### Phase 2: Rename Modal

- [ ] Create `SRC/preact/ui/components/rename-modal.tsx` — `RenameModal({ target, onDone, onClose })` component and `resolveRenameTarget(alias)` helper. Port from `SRC/js/ui/components/rename-modal.tsx`. Uses store for state access.

### Phase 3: Calc Builder

- [ ] Create `SRC/preact/ui/components/calc-builder.ts` — `renderMathBuilder`, `renderTextBuilder`, `renderCompareBuilder`, `renderDateBuilder` functions and `calcModeRenderers` map. Port from `SRC/js/ui/components/calc-builder.ts`. These are string-returning HTML builders, not Preact components.

### Phase 4: Pipeline Section

- [ ] Create `SRC/preact/ui/sections/pipeline-arrow.tsx` — Pipeline arrow connector component.
- [ ] Create `SRC/preact/ui/sections/base-stage.tsx` — Base table selector stage.
- [ ] Create `SRC/preact/ui/sections/stack-sheets.tsx` — Stacked sheets (UNION ALL) section.
- [ ] Create `SRC/preact/ui/sections/lookup-stage.tsx` — Lookup configuration section.
- [ ] Create `SRC/preact/ui/sections/calc-stage.tsx` — Calculated column configuration section.

### Phase 5: Layout Section

- [ ] Create `SRC/preact/ui/sections/column-chips.tsx` — Draggable column chips for layout ordering.
- [ ] Create `SRC/preact/ui/sections/run-bar.tsx` — Run button and status display.
- [ ] Create `SRC/preact/ui/sections/filter-list.tsx` — Filter rows UI.
- [ ] Create `SRC/preact/ui/sections/sort-list.tsx` — Sort rows UI.
- [ ] Create `SRC/preact/ui/sections/merge-toggles.tsx` — Merge display toggles.

### Phase 6: Cards + Aggregation

- [ ] Create `SRC/preact/ui/cards/pipeline-card.tsx` — Pipeline card combining all pipeline stages.
- [ ] Create `SRC/preact/ui/cards/layout-card.tsx` — Layout card with agg mode radios and column chips.
- [ ] Create `SRC/preact/ui/cards/filter-sort-card.tsx` — Filter and sort configuration card.
- [ ] Create `SRC/preact/ui/aggregation.ts` — Aggregation mode management (setAggMode, renderAggregation, renderSubtotalsSection, renderMergeToggles, loadAggModeState, _readAggModeState,_defaultAggModeState). Port from `SRC/js/ui/aggregation.ts`.

### Phase 7: App Shell + Sidebar + Loader

- [ ] Create `SRC/preact/ui/sidebar.tsx` — `Sidebar` component with table list, remove table, preview table. Port from `SRC/js/ui/sidebar.ts`.
- [ ] Create `SRC/preact/ui/loader.tsx` — File drop handler, sheet selector modal, XLSX/CSV loading orchestration. Port from `SRC/js/ui/loader.ts`.
- [ ] Create `SRC/preact/ui/grid.ts` — AG Grid integration: `renderResults`, `loadPreview`, `renderPreviewDropdown`, `refreshResultGridLayout`, `refreshPreviewGridLayout`. Port from `SRC/js/ui/grid.ts`.
- [ ] Create `SRC/preact/ui/export.ts` — `exportAs(fmt)` function for XLSX/CSV export. Port from `SRC/js/ui/export.ts`.
- [ ] Create `SRC/preact/ui/tabs.ts` — `switchTab(name)` function. Port from `SRC/js/ui/tabs.ts`.

### Phase 8: Root App + Entry Point

- [ ] Create `SRC/preact/ui/app.tsx` — Root `<App>` component combining Sidebar, QueryBuilder, PreviewPanel, ResultsPanel. Port from `SRC/js/ui/views/query-builder.tsx`.
- [ ] Create `SRC/preact/app.ts` — Entry point: initDb, initStore, render App to DOM. Wire up global event handlers.
- [ ] Create `SRC/preact/index.ts` — Barrel exports for all public modules.

### Phase 9: Build Verification

- [ ] Run `npm run typecheck:preact` and fix all errors
- [ ] Run `npm run build:preact` and verify clean bundle
- [ ] Run `npm test` — all 914 tests pass
- [ ] Verify `preact_index.html` loads the bundle correctly

## Completion Criteria

- All new TypeScript/TSX files compile with zero errors
- `npm run typecheck:preact` passes
- `npm run build:preact` produces clean bundle
- All 914 existing tests still pass
- UI renders correctly in browser
- No window globals for event handling (Preact event handlers)
- No imports from old codebase (`SRC/js/`)

## References

- Old components: `SRC/js/ui/components/*.tsx`, `SRC/js/ui/views/*.tsx`
- Old app shell: `SRC/js/ui/sidebar.ts`, `SRC/js/ui/loader.ts`, `SRC/js/ui/grid.ts`, `SRC/js/ui/export.ts`, `SRC/js/ui/tabs.ts`, `SRC/js/ui/aggregation.ts`
- Phase C plan: `artifacts/plans/pending/TASK-preact-C-report-engine.md`
- Phase D plan: `artifacts/plans/pending/TASK-preact-D-data-state-loading.md`
- Design doc: `artifacts/designs/pending/DD-preact-rebuild-architecture.md`
