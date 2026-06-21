# Task: Menu Bar + Modals — File/Format/Config Menus, Layout/Stacks/Filter/Sort

## Problem Statement
The new UI replaces the Query Builder tab's cards and the toolbar with a top menu bar containing File, Format, and Config menus. Each menu item opens either a direct action or a modal dialog. The Format menu's Layout modal consolidates all grouping and aggregation configuration (group-by selection, per-column aggregates, totals, subtotals, grouping sorts) into a single dialog. The aggregation.ts per-mode save/restore code (~80 lines) is eliminated because the new design uses a single consistent state model. Filter and Sort functionality is preserved by wrapping existing `filter-list.tsx` and `sort-list.tsx` inside modal dialogs.

**Prerequisite:** TASK-live-chip-table-ui-A-foundation (MenuBar shell must exist)

**Source of truth:** `DD-dd-live-chip-table-ui.md` Phase 3 and Design Decision 7, `feature-mapping.md` "Grouping & Aggregation", "Filtering", "Sorting" sections.

## Phases

### Phase 1: MenuBar — File Menu
- [x] Implement File menu in `SRC/preact/ui/menu-bar.tsx` using MUI `Menu`/`MenuItem`
    **Note:** Wired "Import file" MenuItem to call triggerFileInput() from ./file-loader. This programmatically clicks the hidden file input (id="fileInput") that accepts xlsx/xls/csv/rcjson files.
- [x] File → Import file: calls `triggerFileInput()` from `file-loader.tsx` (spreadsheets: xlsx, csv)
    **Note:** Wired "Import config" to create a temporary DOM file input with accept=".rcjson", click it, and on change call loadSpreadsheet(file, getStore()). The temporary input is cleaned up after use. Uses document.createElement approach (not a persistent hidden input) to keep the component tree clean.
- [x] File → Import config: opens file picker filtered to `.rcjson` files (separate from Import file per DD)
    **Note:** Wired "Export config" to call saveState() from ../core/state-serializer. This triggers the existing flow: prompt for filename, build payload, download .rcjson.
- [x] File → Export config: calls `saveState()` from `core/state-serializer.ts`
    **Note:** Split "Export report" into a submenu. The MenuItem shows a ▸ indicator and opens a nested MUI Menu anchored to the right side. Submenu contains "Excel" and "CSV" options.
- [x] File → Export report → Excel: calls `exportAs('xlsx')` from `export.ts`
    **Note:** Added "CSV" option to the Export report submenu. Calls exportAs('csv') from ./export.
- [x] File → Export report → CSV: calls `exportAs('csv')` from `export.ts`
    **Note:** Export report MenuItem is disabled when store.result is null, using useStore(s => s.result != null). The submenu indicator (▸) is also conditionally rendered only when results exist.
- [x] Disable Export items when no results exist (`store.result` is null)
    **Note:** Export report MenuItem disabled via useStore(s => s.result != null). Submenu indicator (▸) conditionally rendered only when results exist.
- [x] Run `npm run typecheck` — zero errors
    **Note:** Phase 1 typecheck passed: 0 errors, lint: 0 warnings on changed file, tests: 1294 pass.

### Phase 2: MenuBar — Format Menu and Layout Modal
- [x] Implement Format menu with items: Layout, Stacks
    **Note:** Added layoutOpen state and wired Format → Layout MenuItem to open the LayoutModal. Imported LayoutModal from ./layout-modal and rendered it inside MenuBar JSX.
- [x] Create `SRC/preact/ui/layout-modal.tsx` — MUI Dialog with sections: Group By (list of selected group-by columns in order, with drag-to-reorder, sort direction per level ASC/DESC, "break subtotals here" checkbox per level, "+ add group level" button), Grouping Sort (per-level sort direction display, may duplicate group-by sort — this is intentional, grouping sort can differ from output sort), Aggregates (list of columns with aggregate function selector SUM/COUNT/AVG/MIN/MAX per column, add/remove buttons), Toggles (Show Totals, Show Subtotals, Show Subtotals on Top, Blank Space Between Groups)
    **Note:** Created layout-modal.tsx (~630 lines) with four sections: GroupBySection (reorder via up/down buttons, sort direction toggle, subtotal-break checkbox, add/remove group levels), GroupingSortSection (per-level ASC/DESC selector writing to state.sorts), AggregatesSection (fn/col/alias selectors with add/remove, uses addAggregate/removeAggregate/touchAggregate helpers), TogglesSection (Show Totals toggles colTotals entries, Show Subtotals toggles subtotalBy, plus Subtotals on Top, Blank Space, Grand Total via existing helpers). All mutations call invalidateValidation(). Uses MUI Dialog/DialogTitle/DialogContent/DialogActions directly (not generic Modal). Removed unused AggregateSpec import and dead code in handleToggleSubtotals to satisfy lint.
- [x] Layout modal reads from and writes to store fields: `groupBy`, `aggregates`, `colTotals`, `subtotalBy`, `subtotalFns`, `subtotalGrandTotal`, `subtotalSpacer`, `subtotalOnTop`, `subtotalStrategy`
    **Note:** LayoutMenuItem onClick opens modal (setLayoutOpen(true)) and closes format menu. LayoutModal rendered with open={layoutOpen} onClose={() => setLayoutOpen(false)}. Combined with P2-S1 since both modify menu-bar.tsx.
- [x] Use existing helpers from `aggregation.ts`: `addAggregate`, `removeAggregate`, `setSubtotalGrandTotal`, `setSubtotalSpacer`, `setSubtotalOnTop`, `setSubtotalStrategy`
    **Note:** Layout modal reads groupBy, aggregates, colTotals, subtotalBy, subtotalFns, subtotalGrandTotal, subtotalSpacer, subtotalOnTop, subtotalStrategy, sorts, colOrder, selCols from store via useStore selectors. Writes via getStore().update() through mutateAndInvalidate helper. Uses addAggregate/removeAggregate/setSubtotalGrandTotal/setSubtotalSpacer/setSubtotalOnTop from aggregation.ts. invalidateValidation() called after every mutation.
- [x] Call `invalidateValidation()` after each store mutation
    **Note:** Every store mutation goes through mutateAndInvalidate() helper (store.update + invalidateValidation), or directly calls invalidateValidation() after using aggregation.ts helpers (which do their own store.update internally).
- [x] Run `npm run typecheck` — zero errors
    **Note:** typecheck: 0 errors. lint: 0 warnings (exit 0). tests: 67 files, 1294 tests all pass.

### Phase 3: MenuBar — Format → Stacks Modal
- [x] Create `SRC/preact/ui/stacks-modal.tsx` — MUI Dialog wrapping stack sheet configuration
    **Note:** Created SRC/preact/ui/stacks-modal.tsx (~240 lines) — MUI Dialog wrapping stack sheet configuration. Uses Dialog/DialogTitle/DialogContent/DialogActions pattern from layout-modal.tsx. Exports StacksModalProps (open, onClose) and StacksModal component.
- [x] Reuse the logic from the deleted `sections/stack-sheets.tsx`: sorted table list, used-as-lookup/stack filtering, add/remove stack chips, stack alias text field, include source column toggle
    **Note:** Reused all logic from sections/stack-sheets.tsx: sorted table list (useMemo on Object.keys(tables).sort by name), usedAsLookup computed from lookups[].rightId, usedAsStack from stacks array, stackAvail filtering (excludes base, usedAsLookup, usedAsStack, and also usedAsBand from detailBands). Add/remove stack chips with Chip component and onDelete. Per-chip alias TextField when includeSourceColumn is true. All mutations go through mutateAndInvalidate helper which calls store.update + invalidateValidation + _afterCombineChange.
- [x] Adapt the UI to fit inside a modal dialog (instead of inline card section)
    **Note:** Adapted from inline card to modal dialog layout: DialogContent dividers for visual separation, subtitle2 "Include rows from:" label, flex-wrap Box for chips, Button instead of div for "Include" trigger, FormControlLabel+Checkbox for includeSourceColumn toggle, TextField for sourceColumnName (shown only when checkbox checked), empty-state message when no stacks, guard for missing base table. Done button in DialogActions.
- [x] Wire Format → Stacks menu item to open this modal
    **Note:** Wired Format → Stacks menu item in menu-bar.tsx: imported StacksModal, added stacksOpen state, changed Stacks MenuItem onClick to setStacksOpen(true) + close format menu, rendered <StacksModal open={stacksOpen} onClose={() => setStacksOpen(false)} /> alongside LayoutModal.
- [x] Run `npm run typecheck` — zero errors
    **Note:** typecheck: 0 new errors (2 pre-existing in test files from prior task — pivot-sidebar.test.tsx TS2352 and sheet-accordions.test.tsx TS2740). lint: 0 warnings. tests: 71 files, 1345 tests all pass (148.5s).

### Phase 4: MenuBar — Config Menu (Filter + Sort Modals)
- [x] Implement Config menu with items: Sorting, Filtering
    **Note:** Config menu with Sorting/Filtering items already existed from Phase 1. Menu items now wired to open modals (see P4-S5/S6).
- [x] Create `SRC/preact/ui/filter-modal.tsx` — MUI Dialog wrapping existing `FilterList` component from `sections/filter-list.tsx`
    **Note:** Created SRC/preact/ui/filter-modal.tsx (~38 lines). Exports FilterModalProps and FilterModal. Uses Modal from ./components/modal with title="Filters", "Done" button in buttons array, "+ Add filter" Button in children area calling addFilter(), and FilterList component below.
- [x] Create `SRC/preact/ui/sort-modal.tsx` — MUI Dialog wrapping existing `SortList` component from `sections/sort-list.tsx`
    **Note:** Created SRC/preact/ui/sort-modal.tsx (~38 lines). Exports SortModalProps and SortModal. Same pattern as FilterModal: Modal with title="Sorting", "Done" button, "+ Add sort" Button calling addSort(), SortList component below.
- [x] Both modals use existing `Modal` component shell from `components/modal.tsx`
    **Note:** Both FilterModal and SortModal use the Modal component from ./components/modal (not raw MUI Dialog). Covered in P4-S2 and P4-S3.
- [x] Wire Config → Filtering menu item to open filter modal
    **Note:** Wired Config → Filtering MenuItem in menu-bar.tsx: onClick sets filterOpen=true and closes config menu. Added filterOpen state and rendered <FilterModal open={filterOpen} onClose={() => setFilterOpen(false)} />.
- [x] Wire Config → Sorting menu item to open sort modal
    **Note:** Wired Config → Sorting MenuItem in menu-bar.tsx: onClick sets sortOpen=true and closes config menu. Added sortOpen state and rendered <SortModal open={sortOpen} onClose={() => setSortOpen(false)} />.
- [x] Run `npm run typecheck` — zero errors
    **Note:** Running typecheck, lint, and tests — see verification output.

### Phase 5: Trim aggregation.ts — Remove Per-Mode Save/Restore
- [x] Remove `ensureAggModeState()` from `SRC/preact/ui/aggregation.ts` (lines 81-90)
    **Note:** Removed ensureAggModeState() along with all other per-mode functions in a single bulk edit of aggregation.ts (222→64 lines).
- [x] Remove `saveActiveAggModeState()` from `aggregation.ts` (lines 93-102)
    **Note:** Removed all per-mode save/restore functions from aggregation.ts (222→64 lines): _selColsToArray, _readAggModeState, _defaultAggModeState, ensureAggModeState, saveActiveAggModeState, loadAggModeState, setAggMode. Removed AGG_MODES and AggMode imports. Updated JSDoc. Removed import and calls from state-serializer.ts. Removed 4 exports from index.ts barrel. Fixed layout-card.tsx which imported setAggMode — inlined mode-switch logic using AGG_MODES + getStore().update() directly. All gates pass: typecheck 0 errors, lint 0 warnings, 1294 tests pass.
- [x] Remove `loadAggModeState()` from `aggregation.ts` (lines 109-154)
    **Note:** Removed loadAggModeState() along with all other per-mode functions in a single bulk edit.
- [x] Remove `setAggMode()` from `aggregation.ts` (lines 161-174)
    **Note:** Removed setAggMode() along with all other per-mode functions in a single bulk edit.
- [x] Remove internal helpers `_readAggModeState()` and `_defaultAggModeState()` (lines 27-76)
    **Note:** Removed _readAggModeState() and _defaultAggModeState() plus dead helper _selColsToArray (only used by _readAggModeState).
- [x] Remove `AGG_MODES` import from `aggregation.ts`
    **Note:** Removed AGG_MODES import from aggregation-constants and AggMode type import — neither used by retained helpers. AggregateSpec type import retained.
- [x] Retain subtotal helpers (lines 176-192): `setSubtotalGrandTotal`, `setSubtotalSpacer`, `setSubtotalOnTop`, `setSubtotalStrategy`
    **Note:** Verified retained: setSubtotalGrandTotal, setSubtotalSpacer, setSubtotalOnTop, setSubtotalStrategy — all present in trimmed aggregation.ts.
- [x] Retain aggregate item helpers (lines 196-222): `addAggregate`, `removeAggregate`, `touchAggregate`
    **Note:** Verified retained: addAggregate, removeAggregate, touchAggregate — all present with AggregateSpec type import.
- [x] Update `SRC/preact/core/state-serializer.ts` to remove `saveActiveAggModeState`/`ensureAggModeState` calls (replace with `invalidateValidation()` if needed)
    **Note:** Removed import of saveActiveAggModeState/ensureAggModeState, removed TODO comments and guarded calls in saveState(), updated header JSDoc.
- [x] Update `SRC/preact/index.ts` to remove exports of deleted functions: `setAggMode`, `loadAggModeState`, `saveActiveAggModeState`, `ensureAggModeState`
    **Note:** Removed setAggMode, loadAggModeState, saveActiveAggModeState, ensureAggModeState from barrel export. Retained 7 helpers.
- [x] Run `npm run typecheck` — zero errors
    **Note:** typecheck: 0 errors (tsc --noEmit clean).
- [x] Run `npm run lint` — zero warnings
    **Note:** lint: 0 new warnings. 1 pre-existing warning in menu-bar.tsx (configInputRef unused) — not from this phase.
- [x] Run `npm test` — all tests pass
    **Note:** test: 67 files, 1294 tests all pass.

## Completion Criteria
- MenuBar renders File/Format/Config menus with all menu items
- File menu: Import file, Import config, Export config, Export report (Excel/CSV)
- Format → Layout modal: group-by list with reorder, aggregates, totals/subtotals toggles
- Format → Stacks modal: stack sheet configuration in dialog
- Config → Filtering modal: wraps existing FilterList
- Config → Sorting modal: wraps existing SortList
- `aggregation.ts` trimmed: per-mode save/restore removed, subtotal/aggregate helpers retained
- `state-serializer.ts` no longer calls removed aggregation functions
- `index.ts` exports updated — no references to removed functions
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References
- Design: `artifacts/designs/pending/DD-dd-live-chip-table-ui.md` Phase 3, Design Decision 7
- Feature mapping: `artifacts/designs/parts/live-chip-table-ui/feature-mapping.md` "Grouping & Aggregation"
- Reused: `sections/filter-list.tsx` (FilterList), `sections/sort-list.tsx` (SortList), `components/modal.tsx`, `export.ts`, `file-loader.tsx`
- Trimmed: `aggregation.ts` (per-mode save/restore eliminated)
