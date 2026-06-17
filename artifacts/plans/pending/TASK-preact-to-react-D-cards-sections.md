# Task: Cards and Sections Conversion

## Problem Statement

Part D converts the 3 card components and 11 section components from Preact to React + MUI. Cards (`pipeline-card.tsx`, `layout-card.tsx`, `filter-sort-card.tsx`) are medium-complexity composites that orchestrate sections. Sections (`base-stage.tsx`, `calc-stage.tsx`, `column-chips.tsx`, `detail-band-stage.tsx`, `filter-list.tsx`, `lookup-stage.tsx`, `merge-toggles.tsx`, `pipeline-arrow.tsx`, `run-bar.tsx`, `sort-list.tsx`, `stack-sheets.tsx`) are lower-complexity form-heavy components.

All 14 files follow the same conversion pattern: replace `preact/hooks` with `react`, replace the `getStore().subscribe()` pattern with the `useStore()` hook from `./useStore`, replace `class` with `className` or MUI `sx`, and replace custom styled elements with MUI equivalents.

**Prerequisite:** TASK-preact-to-react-A-foundation (useStore hook), TASK-preact-to-react-B-shared-components (MUI Chip, Modal, ContextMenu, Tip available for use in cards/sections).

**Design doc:** `artifacts/designs/pending/DD-preact-to-react-conversion.md`

## Phases

### Phase 1: Section Components (11 files)

Convert all 11 section files from Preact to React + MUI form controls.

- [x] Convert `sections/base-stage.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace `<select>` with MUI `<Select>`/`<MenuItem>`. Replace `.pl-stage` div with MUI `<Card>` or `<Box>` with `sx` styling. Preserve base table selection and stack sheet toggle behavior
    **Note:** Converted base-stage.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), native <select>→MUI Select/MenuItem/FormControl, native buttons→MUI Button variant="text". All logic preserved.
- [x] Convert `sections/stack-sheets.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace stack chip list with MUI `<Chip>` components. Preserve add/remove stack table behavior
    **Note:** Converted stack-sheets.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), stack chip spans→MUI Chip with onDelete, hidden native select preserved for add-stack UX.
- [x] Convert `sections/pipeline-arrow.tsx`: Replace `preact/hooks` → `react`. Keep custom CSS arrow rendering (pipeline arrows are among the ~120 lines of specialized CSS retained per DD). Replace `class` → `className`. Preserve horizontal/vertical arrow switching and preview button
    **Note:** Converted pipeline-arrow.tsx from Preact to React. preact/hooks→react, class→className, string styles→object styles. Custom CSS arrow classes preserved (pl-arrow, pl-arrow-line, etc.) as they are among the ~120 lines of specialized CSS retained per DD.
- [x] Convert `sections/lookup-stage.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace form controls with MUI `<Select>`, `<TextField>`, `<Checkbox>`. Preserve lookup configuration (table selection, key pairs, column selection, required toggle, duplicate policy)
    **Note:** Converted lookup-stage.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), native selects→MUI Select/MenuItem/FormControl, native checkboxes→MUI Checkbox/FormControlLabel, radio buttons→MUI RadioGroup/Radio/FormControlLabel, buttons→MUI Button/IconButton. All lookup config logic preserved.
- [x] Convert `sections/calc-stage.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace form controls with MUI equivalents. Preserve calculation mode switching and expression editing
    **Note:** Converted calc-stage.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), native checkbox→MUI Checkbox/FormControlLabel, native text input→MUI TextField, mode radio tabs→MUI ToggleButtonGroup/ToggleButton, buttons→MUI Button. Calc builder integration preserved (already React from Plan B).
- [x] Convert `sections/column-chips.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace chip rendering with MUI `<Chip>` from Part B. Preserve drag-reorder behavior and column selection toggling
    **Note:** Converted column-chips.tsx from Preact to React. preact/hooks→react, getStore().subscribe()→useStore(s=>s), class→className, string styles→object styles, DragEvent types updated to React.DragEvent. All drag-reorder and column selection logic preserved. Chip component already React from Plan B.
- [x] Convert `sections/detail-band-stage.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace form controls with MUI equivalents. Preserve band configuration (table selection, key pairs, column selection, sorts, label)
    **Note:** Converted detail-band-stage.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), native selects→MUI Select/MenuItem/FormControl, native checkbox→MUI Checkbox/FormControlLabel, native text input→MUI TextField, buttons→MUI Button/IconButton. Band config logic (key pairs, columns, sorts, label) fully preserved.
- [x] Convert `sections/filter-list.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace form controls with MUI `<Select>`, `<TextField>`, `<IconButton>`. Preserve filter row add/remove/edit behavior
    **Note:** Converted filter-list.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), native selects→MUI Select/MenuItem/FormControl, native checkbox→MUI Checkbox/FormControlLabel, native text input→MUI TextField, buttons→MUI Button. Filter row add/remove/edit behavior preserved. onInput→onChange for React text input.
- [x] Convert `sections/sort-list.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace form controls with MUI `<Select>`, `<IconButton>`. Preserve sort level ordering and direction toggling
    **Note:** Converted sort-list.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), native selects→MUI Select/MenuItem/FormControl, native checkbox→MUI Checkbox/FormControlLabel, buttons→MUI Button. Sort level ordering and direction toggling preserved.
- [x] Convert `sections/merge-toggles.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace checkbox toggles with MUI `<ToggleButton>` or `<Checkbox>`. Preserve column merge toggling
    **Note:** Converted merge-toggles.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), native checkboxes→MUI Checkbox/FormControlLabel. Column merge toggling logic preserved.
- [x] Convert `sections/run-bar.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace buttons with MUI `<Button>`. Wrap in MUI `<Toolbar>`. Preserve run/cancel/export trigger behavior
    **Note:** Converted run-bar.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s), native button→MUI Button variant="contained", wrapper div→MUI Box with sx. Run/cancel/export trigger behavior and status pill rendering preserved.

### Phase 2: Card Components (3 files)

Convert the 3 card components from Preact to React + MUI Card/Stack.

- [x] Convert `cards/pipeline-card.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace `.card` div with MUI `<Card>`/`<CardContent>`. Replace layout with MUI `<Stack>`. Replace buttons with MUI `<Button>`. Preserve pipeline stage composition (base, stacks, lookups, calcs, detail bands) and add-stage behavior
    **Note:** Converted pipeline-card.tsx from Preact to React+MUI. preact/hooks→react, getStore().subscribe()→useStore(s=>s) for main state, class→className, string styles→object styles, pl-add-btn divs→MUI Button variant="text", add-button wrapper div→MUI Box with sx. Preview cache clearing retained as useEffect+subscribe (side-effect, not state subscription). All pipeline stage composition (BaseStage, StackSheets, PipelineArrow, LookupStage, CalcStageSection, DetailBandStage) and add-stage callbacks (addLookup, addCalcStage, addDetailBand) preserved exactly. Zero typecheck errors in cards/.
- [x] Convert `cards/layout-card.tsx`: Replace `preact/hooks` → `react`. Replace all 4 `getStore().subscribe()` calls → `useStore()` with appropriate selectors. Replace `.card` div with MUI `<Card>`. Replace aggregation mode radios with MUI `<ToggleButtonGroup>` or `<Radio>`. Replace form controls with MUI `<Select>`, `<Checkbox>`. Preserve column chip rendering, aggregation config, totals/subtotals configuration
    **Note:** Converted layout-card.tsx from Preact to React+MUI. All 4 getStore().subscribe() patterns (main LayoutCard + TotalsSection + SubtotalsSection + AggregateItems) replaced with useStore(s=>s). .card div→MUI Card/CardContent, aggregation mode radios→MUI ToggleButtonGroup/ToggleButton (exclusive), subtotal strategy radios→MUI ToggleButtonGroup/ToggleButton, native selects→MUI Select/MenuItem/FormControl, native text input→MUI TextField, native checkboxes→MUI Checkbox/FormControlLabel, buttons→MUI Button. All class→className, string styles→object styles or sx props. Column chip rendering (ColumnChips), merge toggles (MergeToggles), aggregation config (AggregateItems, TotalsSection, SubtotalsSection), and all mode-specific sections preserved exactly. Zero typecheck errors in cards/.
- [x] Convert `cards/filter-sort-card.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace `.card` div with MUI `<Card>`. Preserve sort list, filter list, and merge toggles composition
    **Note:** Converted filter-sort-card.tsx from Preact to React+MUI. preact/hooks removed (no local state needed), getStore().subscribe()→useStore(s=>s), .card div→MUI Card/CardContent, label+button wrappers→MUI Box with sx, label text→MUI Typography, buttons→MUI Button variant="text". All class→className, string styles→sx props. Sort list, filter list, and add-filter/add-sort button composition preserved exactly. Zero typecheck errors in cards/.

### Phase 3: Verification

Validate that all 14 converted files typecheck and lint cleanly.

- [ ] Run `npm run typecheck` and verify zero errors in all `sections/*.tsx` and `cards/*.tsx` files
- [ ] Run `npm run lint` on `sections/` and `cards/` directories and fix any warnings
- [ ] Verify no `from 'preact'` imports remain in any `sections/` or `cards/` file
- [ ] Verify no raw `getStore().subscribe()` calls remain — all replaced with `useStore()` hook

## Completion Criteria

- All 11 files in `SRC/preact/ui/sections/` use React imports (zero `from 'preact'` imports)
- All 3 files in `SRC/preact/ui/cards/` use React imports (zero `from 'preact'` imports)
- All `getStore().subscribe()` patterns replaced with `useStore()` selector hook (21 instances across these 14 files)
- Cards use MUI `<Card>`, `<Stack>`, `<Button>` for layout
- Sections use MUI form controls (`<Select>`, `<TextField>`, `<Checkbox>`, `<ToggleButton>`)
- `pipeline-arrow.tsx` retains custom CSS arrow rendering (specialized CSS preserved per DD)
- `npm run typecheck` shows zero errors in `sections/*.tsx` and `cards/*.tsx`
- `npm run lint` shows zero warnings in these directories
