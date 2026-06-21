# Task: Foundation — Types, App Shell, Obsolete File Cleanup

## Problem Statement
The Live Chip-Table UI refactor replaces the current 3-tab card-based layout (Query Builder / Browse Sheet / Report) with a 2-tab pivot layout (Report + Browse Sheet). The Report tab uses a menu bar + AG Grid + right sidebar design. This plan establishes the foundation: adds the `_ui` transient state field to `AppState`, restructures `app.tsx` to the new 2-tab layout, creates empty shell components for subsequent plans to fill, and deletes the 13 obsolete files that the new design replaces. All lower layers (Core/Catalog/Query/Report) remain unchanged.

**Source of truth:** `DD-dd-live-chip-table-ui.md` Phase 1, `feature-mapping.md` "What's Eliminated Entirely" section.

## Phases

### Phase 1: Add _ui Field to AppState
- [x] Add optional `_ui` field to `AppState` interface in `SRC/preact/types.ts` with shape `{ sidebarCollapsed?: boolean; columnWidths?: Record<string, number>; activeMenu?: string | null }`
  > **Annotation:** Added AppUIState interface and _ui?: AppUIState field to AppState.
- [x] Ensure `_ui` is excluded from serialization in `SRC/preact/core/state-serializer.ts` (buildPayload must not include `_ui` in the output)
  > **Annotation:** Added comment documenting _ui is intentionally excluded. buildPayload constructs explicit fields so _ui never leaks in.
- [x] Ensure `_ui` is reset to defaults on state load in `SRC/preact/core/state-hydrator.ts` or `state-applier.ts`
  > **Annotation:** Added draft._ui = undefined in applyState store.update callback.
- [x] Run `npm run typecheck` — zero errors
  > **Annotation:** Typecheck: 0 errors. Lint: 0 warnings.

### Phase 2: Restructure app.tsx to 2-Tab Layout
- [x] Replace 3-tab structure (query/preview/results) with 2-tab structure (report/preview) in `SRC/preact/ui/app.tsx`
  > **Annotation:** Restructured app.tsx to 2-tab layout (Report + Browse Sheet).
- [x] Remove imports of `PipelineCard`, `LayoutCard`, `FilterSortCard`, `RunBar`, `Sidebar`, `switchTab` from `app.tsx`
  > **Annotation:** Removed all obsolete imports from app.tsx.
- [x] Remove `QueryBuilderTab` and `ResultsPanel` components from `app.tsx`
  > **Annotation:** Removed QueryBuilderTab and ResultsPanel components.
- [x] Replace Report tab content with `<PivotLayout />` placeholder component (import from `./pivot-layout`)
  > **Annotation:** Report tab now renders PivotLayout shell.
- [x] Retain `PreviewPanel` (Browse Sheet tab) with minor adjustments — remove dependency on 3-tab `switchTab`
  > **Annotation:** PreviewPanel retained and updated for 2-tab layout.
- [x] Update `switchTab` in `tabs.ts` to accept only `'report' | 'preview'` instead of `'query' | 'preview' | 'results'`
  > **Annotation:** switchTab signature narrowed to 'report' | 'preview'. Exported TabName type.
- [x] Create `SRC/preact/ui/pivot-layout.tsx` with empty shell
  > **Annotation:** Created PivotLayout shell (MenuBar + PivotMain + PivotSidebar).
- [x] Create `SRC/preact/ui/menu-bar.tsx` with empty shell
  > **Annotation:** Created MenuBar shell with File/Format/Config menus.
- [x] Create `SRC/preact/ui/pivot-sidebar.tsx` with empty shell
  > **Annotation:** Created PivotSidebar shell (270px, right side).
- [x] Create `SRC/preact/ui/pivot-main.tsx` with empty shell
  > **Annotation:** Created PivotMain shell (flex: 1, grid placeholder).
- [x] Run `npm run typecheck` — zero errors
  > **Annotation:** Typecheck: 0 errors. Lint: 0 warnings. Tests: 1294 pass.

### Phase 3: Delete Obsolete Files
- [x] Delete `SRC/preact/ui/sidebar.tsx`
  > **Annotation:** Deleted — replaced by pivot-sidebar.tsx.
- [x] Delete `SRC/preact/ui/cards/pipeline-card.tsx`
  > **Annotation:** Deleted — replaced by drag-pair joins + sheet accordions.
- [x] Delete `SRC/preact/ui/cards/layout-card.tsx`
  > **Annotation:** Deleted — replaced by 3-row header + Layout modal.
- [x] Delete `SRC/preact/ui/cards/filter-sort-card.tsx`
  > **Annotation:** Deleted — replaced by Config menu modals.
- [x] Delete `SRC/preact/ui/sections/run-bar.tsx`
  > **Annotation:** Deleted — replaced by auto-preview.
- [x] Delete `SRC/preact/ui/sections/column-chips.tsx`
  > **Annotation:** Deleted — replaced by SheetAccordion column chips.
- [x] Delete `SRC/preact/ui/sections/base-stage.tsx`
  > **Annotation:** Deleted — replaced by implicit base sheet.
- [x] Delete `SRC/preact/ui/sections/lookup-stage.tsx`
  > **Annotation:** Deleted — replaced by drag-pair join key pairs.
- [x] Delete `SRC/preact/ui/sections/detail-band-stage.tsx`
  > **Annotation:** Deleted — replaced by middle header row band chips.
- [x] Delete `SRC/preact/ui/sections/stack-sheets.tsx`
  > **Annotation:** Deleted — replaced by Stacks modal.
- [x] Delete `SRC/preact/ui/sections/merge-toggles.tsx`
  > **Annotation:** Deleted — replaced by right-click chip merge toggle.
- [x] Delete `SRC/preact/ui/sections/calc-stage.tsx`
  > **Annotation:** Deleted — replaced by CalcAccordion dialog.
- [x] Delete `SRC/preact/ui/sections/pipeline-arrow.tsx`
  > **Annotation:** Deleted — visual connector no longer needed.
- [x] Delete test files for removed components
  > **Annotation:** Deleted pipeline-card.test.tsx, stack-sheets.test.tsx, pipeline-arrow.test.tsx.

### Phase 4: Update Barrel Exports and Cross-References
- [x] Remove deleted-file exports from `SRC/preact/index.ts`
  > **Annotation:** Removed 13 exports for deleted files from index.ts.
- [x] Add new exports to `SRC/preact/index.ts` for shell components (PivotLayout, MenuBar, PivotSidebar, PivotMain)
  > **Annotation:** Added 4 new shell component exports + AppUIState type export.
- [x] Update `SRC/preact/core/state-serializer.ts` to guard `saveActiveAggModeState`/`ensureAggModeState` calls
  > **Annotation:** Wrapped calls in typeof guards with TODO comment for Plan C.
- [x] Run `npm run typecheck` — zero errors
  > **Annotation:** 0 errors.
- [x] Run `npm run lint` — zero warnings
  > **Annotation:** 0 warnings.
- [x] Run `npm test` — all remaining tests pass
  > **Annotation:** 1268 tests pass (64 test files).

## Completion Criteria
- `AppState` has an optional `_ui` field that is excluded from serialization
- `app.tsx` renders a 2-tab layout (Report + Browse Sheet) with the Report tab showing PivotLayout
- All 13 obsolete files are deleted with no dangling imports
- `index.ts` barrel exports are updated — no references to deleted files
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all remaining tests green
- Shell components exist for MenuBar, PivotLayout, PivotSidebar, PivotMain (empty but importable)

## References
- Design: `artifacts/designs/pending/DD-dd-live-chip-table-ui.md` Phase 1
- Feature mapping: `artifacts/designs/parts/live-chip-table-ui/feature-mapping.md`
- ADR-002: Five-layer architecture (UI layer only)
- ADR-006: Monolithic store (_ui field additive only)
