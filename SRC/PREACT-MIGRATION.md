# Preact Migration Plan

## Status: In Progress

## Phase 1: Build Pipeline
- [x] Install `preact` dependency
- [x] Configure JSX in `tsconfig.json` + `tsconfig.dev.json`
- [x] Configure JSX transform in `scripts/build.mjs`
- [x] Configure JSX in `vitest.config.ts`
- [x] Update `eslint.config.js` for `.tsx` files
- [x] Verify: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass

## Phase 2: First Components (<Chip> + <Tip>)
- [x] Convert `chip.ts` → `chip.tsx` with Preact `<Chip>` component
- [x] Convert `tip.ts` → `tip.tsx` with Preact `<Tip>` component
- [x] Keep `renderChip`/`renderTip` as legacy bridges (delete when views migrate)
- [ ] Wire `<Chip>` into output-card (convert output-card to Preact)
- [ ] Wire `<Chip>` into pipeline-card (convert pipeline-card to Preact)
- [ ] Verify tests pass

## Phase 3: Modal + Context Menu
- [ ] Convert `modal.ts` from imperative DOM to Preact `<Modal>` portal
- [ ] Convert `context-menu.ts` from imperative DOM to Preact `<ContextMenu>`
- [ ] Convert `rename-modal.ts` to use `<Modal>` + `<RenameForm>`
- [ ] Verify rename flow works end-to-end

## Phase 4: Filter + Sort Views
- [ ] Convert `filter-sort-card.ts` to `<Filters>` + `<Sorts>` components
- [ ] Events become JSX props (no more `delegate()`)
- [ ] Verify filter/sort functionality

## Phase 5: Output Card
- [ ] Convert `output-card.ts` to `<ColChips>` + `<MergeToggles>`
- [ ] Drag-and-drop via `useRef` + imperative DOM
- [ ] Context menu via `<ContextMenu>` component
- [ ] Verify chip interactions (click, dblclick, drag, right-click)

## Phase 6: Pipeline Card
- [ ] Convert `pipeline-card.ts` to `<Pipeline>` component
- [ ] Sub-components: `<BaseStage>`, `<LookupStage>`, `<CalcStage>`, `<StackStage>`
- [ ] Calc builder sub-components from `calc-builder.ts`
- [ ] Verify all pipeline interactions

## Phase 7: Query Builder Orchestrator
- [ ] Convert `query-builder.ts` to `<QueryBuilder>` component
- [ ] Replaces `renderQueryBuilder()` with state-driven re-renders
- [ ] Wires up all sub-components
- [ ] Verify full query builder flow

## Phase 8: AG Grid Integration
- [ ] Wrap grid init in `useRef` + `useEffect`
- [ ] Grid header rename components become Preact
- [ ] Verify result + preview grids

## Phase 9: Global Systems
- [ ] Tooltip system becomes `<TooltipProvider>` with context
- [ ] Tab switching becomes declarative
- [ ] Toast system becomes Preact component
- [ ] Sidebar becomes Preact component

## Phase 10: Cleanup
- [ ] Delete `dom.ts` (replaced by Preact)
- [ ] Delete `events.ts` (replaced by Preact)
- [ ] Delete dormant `button.ts`, `select.ts`, `card.ts` (or convert if useful)
- [ ] Update tests for new component signatures
- [ ] Remove `window.*` assignments for onclick handlers

## Architecture Notes

### State Strategy
- `db` stays as mutable global object
- Preact components read from `db` directly
- Mutations trigger `setState` to force re-render
- Pattern: `const [tick, setTick] = useState(0); const forceUpdate = () => setTick(t => t + 1);`
- Or: wrap `db` in a Preact context that components subscribe to

### File Naming
- Preact components use `.tsx` extension
- Pure logic/utils keep `.ts` extension
- Components in `js/ui/components/` become `.tsx`
- Views in `js/ui/views/` become `.tsx`

### Testing
- Pure logic tests (SQL, validation, state) — unchanged
- Component tests — add `@testing-library/preact` later if needed
- Calc builder tests — update if render signature changes
- Vitest needs JSX support via esbuild transform

### AG Grid
- Grid stays imperative (agGrid.createGrid)
- Container div managed by Preact via useRef
- Grid init/destroy in useEffect
- Header components rendered by AG Grid stay as classes (not Preact)
