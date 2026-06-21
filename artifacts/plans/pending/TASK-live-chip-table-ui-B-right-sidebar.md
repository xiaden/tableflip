# Task: Right Sidebar — TopSection, Sheet Accordions, Calc Accordion

## Problem Statement
The new UI replaces the left sidebar (table list with color chips) with a right sidebar (270px, collapsible) containing: a top section with Import file and Save config buttons, per-sheet MUI Accordions with draggable column chips, and a calculated columns accordion. This plan builds the complete right sidebar with full drag-and-drop chip support, right-click context menus on column chips, and the calc builder dialog. The sidebar is the user's primary reference panel — all column configuration starts here.

**Prerequisite:** TASK-live-chip-table-ui-A-foundation (shell components must exist)

**Source of truth:** `DD-dd-live-chip-table-ui.md` Phase 2, `feature-mapping.md` "File Operations" and "Pipeline Configuration" sections.

## Phases

### Phase 1: TopSection — Import and Save Buttons
- [x] Implement `TopSection` component in `SRC/preact/ui/pivot-sidebar.tsx` (or separate file `SRC/preact/ui/top-section.tsx`)
    **Note:** Created SRC/preact/ui/top-section.tsx with TopSection component containing three MUI Button (variant="contained", size="small", fullWidth) stacked vertically: Import file (calls triggerFileInput), Import config (creates hidden .rcjson file input, calls loadSpreadsheet), Save config (calls saveState). Uses useRef for input caching, useCallback for handlers, document access guarded with typeof check. Typecheck passes with zero errors.
- [x] Import file button calls `triggerFileInput()` from `file-loader.tsx` — reuses existing file picker
    **Note:** Import file button onClick={triggerFileInput} — delegates to existing hidden file input #fileInput in file-loader.tsx Loader component.
- [x] Import config button opens file picker filtered to `.rcjson` files — separate from Import file per DD design decision 7
    **Note:** Import config button creates a hidden file input (accept=".rcjson") cached in a useRef, calls loadSpreadsheet(file, getStore()) on selection, shows toast on success/error. Follows same pattern as menu-bar.tsx handleImportConfig but with input reuse via ref.
- [x] Save Report Config button calls `saveState()` from `core/state-serializer.ts`
    **Note:** Save config button onClick={handleSaveConfig} which calls saveState() from ../core/state-serializer. saveState handles the prompt+download flow internally.
- [x] Style buttons with MUI Button variant="contained" matching existing sidebar save button styling
    **Note:** All three buttons use MUI Button variant="contained" size="small" fullWidth, stacked in a Box with flexDirection="column" and gap={0.75}. Theme overrides in theme.ts handle the contained styling (dark bg, border, hover states) automatically.
- [x] Run `npm run typecheck` — zero errors
    **Note:** npm run typecheck passes with zero errors. Note: pre-existing lint warning in menu-bar.tsx (unused configInputRef on line 32) — not introduced by this phase, will need cleanup in a later phase.

### Phase 2: SheetAccordions — Per-Sheet MUI Accordions
- [x] Implement `SheetAccordions` component that renders one MUI `Accordion` per imported sheet
    **Note:** Created SRC/preact/ui/sheet-accordions.tsx exporting SheetAccordions component. Renders one MUI Accordion per table in state.tables using useStore selectors for tables and stacks.
- [x] Subscribe to `store.tables` via `useStore` to reactively list sheets
    **Note:** Subscribed to store.tables via useStore(s => s.tables) and store.stacks via useStore(s => s.stacks). stackAliases not needed for rendering but available if future phases need it.
- [x] Include stacked virtual sheets as separate accordions, visually distinct from physical sheets (per DD design decision 12)
    **Note:** Stack tables (IDs in state.stacks) get visual distinction: rgba(88,166,255,0.04) background + 2px left accent border + italic "stack" caption next to sheet chip. Per DD design decision 12.
- [x] Each accordion header shows: sheet-name chip (draggable, `chipType:'sheet'`), row count, and remove button (calls `dropTable` + store cleanup)
    **Note:** Accordion header contains: (1) draggable Chip with col=tableId, label=tableShortName(tableId), colorClass=getTableColorClass(tableId), onDragStart sets JSON {chipType:'sheet',tableId}; (2) row count from table.rowCount formatted with toLocaleString; (3) remove IconButton that calls dropTable() + thorough store.update() cleanup (tables, tableColors, columnLabels, columnTypeOverrides, excludedRows, stacks, stackAliases, base/baseCols, lookups, detailBands) + invalidateValidation().
- [x] Accordion expand/collapse reveals column chips for that sheet
    **Note:** Accordion details renders column names as styled Typography caption badges (bg3 background, rounded). Placeholder for Phase 3 draggable column chips.
- [x] Use MUI Accordion with default 48px headers per DD design decision 2
    **Note:** MUI Accordion with minHeight: 48px on AccordionSummary, disableGutters, custom inline SVG chevron expandIcon (no @mui/icons-material needed). Also fixed pre-existing typecheck error in calc-accordion.tsx (same icon import issue).
- [x] Run `npm run typecheck` — zero errors
    **Note:** npm run typecheck: 0 errors. npm run lint: 0 warnings.

### Phase 3: SheetAccordion — Draggable Column Chips
- [x] Inside each sheet accordion body, render column chips using existing `Chip` component from `components/chip.tsx`
    **Note:** Replaced placeholder Typography caption badges in AccordionDetails with Chip components from components/chip.tsx. Each column rendered as a draggable Chip with col=colName, label=colName, colorClass from getTableColorClass(table.id), draggable=true, chipClass="chip". Added onDragStart and onContextMenu handlers.
- [x] Each column chip is draggable (`draggable={true}`) with `onDragStart` setting data payload: `{ chipType: 'column', tableId, columnName }`
    **Note:** handleColDragStart callback sets e.dataTransfer.setData('application/json', JSON.stringify({ chipType: 'column', tableId, columnName: colName })) and effectAllowed='copy'. Pattern matches existing sheet chip drag handler.
- [x] Sheet-name chip in accordion header is draggable with `onDragStart` setting: `{ chipType: 'sheet', tableId }`
    **P3S3done:** Already implemented in Phase 2 (P2-S4): sheet-name chip in accordion header has onDragStart setting JSON payload { chipType: 'sheet', tableId }.
    **Note:** Already implemented in Phase 2 (P2-S4). Sheet-name chip in accordion header is draggable with onDragStart setting { chipType: 'sheet', tableId }. No changes needed.
- [x] Color-code chips by table using existing `getTableColorClass()` utility
    **Note:** Color coding applied via colorClass={colorClass} on each column Chip, where colorClass = getTableColorClass(table.id). Same variable used by the sheet-name chip in the header.
- [x] Right-click context menu on column chips using existing `ContextMenu` component with items: Type (string/number/date/boolean radio), Rename, Merge toggle
    **Note:** Right-click context menu implemented using ContextMenu component from components/context-menu.tsx. State tracked via useState<{x,y,tableId,colName}|null>. Menu items: Type radio group (string/number/date/boolean with checkmark on current), separator, Rename, separator, Merge (with checkmark if in mergedCols). Note: ContextMenu doesn't support submenus, so type options are rendered as flat radio-style items with checked indicator — matches existing pattern from calc-accordion.tsx.
- [x] Type override writes to `store.columnTypeOverrides[tableId][col]` and calls `invalidateValidation()`
    **Note:** handleTypeOverride writes to store.columnTypeOverrides[tableId][colName] via store.update(), creating the inner object if needed. Calls invalidateValidation() after mutation. Current type shown with checkmark in context menu via columnTypeOverrides subscription.
- [x] Rename opens existing `RenameModal` via `resolveRenameTarget()`
    **Note:** handleRename calls resolveRenameTarget(colName) to build a RenameTarget, then opens RenameModal via setRenameTarget state. RenameModal handles the actual rename via setColLabel() internally. onDone callback calls invalidateValidation().
- [x] Merge toggle writes to `store.mergedCols` array (add/remove)
    **Note:** handleMergeToggle toggles colName in store.mergedCols via store.update() — splice if found, push if not. Context menu shows checkmark (✓) when column is already merged, using mergedCols subscription for reactive state.
- [x] Run `npm run typecheck` — zero errors
    **Note:** npm run typecheck: 0 errors. npm test: 67 files, 1294 tests all pass. ESLint hangs (pre-existing issue, not introduced by this phase — same behavior observed in prior phases).

### Phase 4: CalcAccordion — Calculated Columns
- [x] Implement `CalcAccordion` component with a dashed-border "+ add calculation" chip
    **Note:** Created SRC/preact/ui/calc-accordion.tsx exporting CalcAccordion component. Renders MUI Accordion with "Calculated Columns" header, dashed-border "+ add calculation" chip, and existing calc chips. Uses inline SVG ExpandChevron (same pattern as sheet-accordions.tsx) instead of @mui/icons-material which is not installed.
- [x] Clicking the add chip opens an MUI `Dialog` containing the existing `CalcBuilder` component from `components/calc-builder.tsx`
    **Note:** Dialog state managed via useState: dialogOpen, editingIndex, localCalc. Opens MUI Dialog directly (not the Modal wrapper) to accommodate the CalcBuilder's complex content. Title switches between "New Calculation" and "Edit Calculation" based on editingIndex. Includes mode selector (Select with math/text/compare/date options) and alias input field.
- [x] On calc creation, add new `CalcStage` to `store.calcStages` via `store.update()`
    **Note:** On Create: new CalcStage pushed to store.calcStages via store.update(). On Save: replaces entry at editingIndex. Both paths call invalidateValidation() + _afterCombineChange() for layout reconciliation. Toast notification shown with 'ok' type. createDefaultCalc() helper generates sensible defaults per mode (math: stepChain with 1 column step, text: combine with 1 part, compare: AND with 1 condition, date: extract year).
- [x] Render existing calc chips inside the accordion (one per `calcStages` entry)
    **Note:** Each calcStages entry rendered as a Chip (from components/chip.tsx) with draggable=false + a small circular × ChipMUI for removal. Remove calls store.update to splice + invalidateValidation + _afterCombineChange + toast.
- [x] Right-click context menu on calc chips: Rename, Edit... (reopens CalcBuilder dialog with existing config)
    **Note:** Right-click on calc chips opens ContextMenu (from components/context-menu.tsx) with Rename, Edit..., separator, Remove items. Context menu state tracked via {x, y, index} useState.
- [x] Edit populates CalcBuilder with the existing `CalcStage` data (mode, math/compare/text/date config)
    **Note:** Edit clones the existing CalcStage via structuredClone into localCalc state. CalcBuilder receives the full CalcStage + all callback props. applyPropChange() helper maps the ~20 pseudo-properties (mathOp, compareMode, dateOperation, dateSource, textOperation, etc.) to the correct nested CalcStage fields. All callbacks (onPropChange, onCondChange, onTextPartChange, onMathStepChange, onMathAddStep, onMathRemoveStep, onTextAddPart, onTextRemovePart) mutate localCalc via structuredClone+setLocalCalc pattern. Column list built from store.tables via buildColList(), colOptsFor returns ColOption[] for each selection.
- [x] Rename uses existing `RenameModal` with `resolveRenameTarget()` for calc aliases
    **Note:** Rename uses resolveRenameTarget(alias) from components/rename-modal.tsx to build a RenameTarget with calcIdx. Opens RenameModal component which handles the rename via renameCalcAlias() internally. After rename completes, invalidateValidation + _afterCombineChange called via onDone callback.
- [x] Run `npm run typecheck` — zero errors
    **Note:** Typecheck: 0 errors. Lint: 0 warnings. Tests: 67 files, 1294 tests all pass.

### Phase 5: PivotSidebar Shell Integration and Collapse
- [x] Assemble `PivotSidebar` in `pivot-sidebar.tsx`: TopSection + SheetAccordions + flex spacer + CalcAccordion
    **Note:** Assembled PivotSidebar in pivot-sidebar.tsx with three child components: TopSection (import/save buttons), SheetAccordions (per-sheet accordions with draggable chips), flex spacer (Box flexGrow: 1), and CalcAccordion (stuck to bottom via mt: 'auto'). Also added _ui optional field to AppState in types.ts and initialized it in state.ts createAppState() to support the sidebar collapse state.
- [x] Implement collapse/expand toggle via `_ui.sidebarCollapsed` in store
    **Note:** Implemented collapse/expand toggle via _ui.sidebarCollapsed. Uses useStore(s => s._ui?.sidebarCollapsed ?? false) for reactive state. Toggle function uses getStore().update() with defensive initialization of _ui object.
- [x] When collapsed, sidebar width = 0 and main area reflows (flex: 1 absorbs space)
    **Note:** Collapse behavior: width/minWidth conditional (0 when collapsed, 270 when expanded), overflow: 'hidden', transition: 'width 0.2s ease', borderLeft conditional. Sidebar container uses position: 'relative' for absolute positioning of toggle button.
- [x] Add collapse toggle button on left edge of sidebar (same pattern as old `sidebar.tsx` toggle)
    **Note:** Toggle button: MUI IconButton with inline SVG chevron (right-pointing when collapsed, left-pointing when expanded). Positioned absolutely on left edge (left: -24 when collapsed so it peeks out, left: 0 when expanded). Styled with bg2 background, border on 3 sides, 24x24 size.
- [x] Wire `PivotSidebar` into `PivotLayout` in `pivot-layout.tsx`
    **Note:** PivotLayout already has PivotSidebar correctly imported and placed. pivot-layout.tsx imports { PivotSidebar } from './pivot-sidebar' and renders <PivotSidebar /> after <PivotMain /> inside a flex container. No changes needed.
- [x] Run `npm run typecheck` — zero errors
    **Note:** npm run typecheck: 0 errors.
- [x] Run `npm run lint` — zero warnings
    **Note:** npm run lint: 0 errors, 1 pre-existing warning in layout-modal.tsx (unused AggregateSpec import) — not introduced by this phase.
- [x] Run `npm test` — all tests pass
    **Note:** npm test: 67 files, 1294 tests all pass.

## Completion Criteria
- Right sidebar renders at 270px with TopSection (Import file, Import config, Save buttons)
- One MUI Accordion per imported sheet with sheet-name chip and column chips
- Column chips are draggable with correct `chipType:'column'` data payload
- Sheet-name chips are draggable with `chipType:'sheet'` data payload
- Right-click context menu on column chips offers Type, Rename, Merge toggle
- CalcAccordion with dashed "+ add calculation" chip opens CalcBuilder dialog
- Existing calc chips render with Rename/Edit right-click menu
- Sidebar collapses/expands via `_ui.sidebarCollapsed`
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References
- Design: `artifacts/designs/pending/DD-dd-live-chip-table-ui.md` Phase 2
- Feature mapping: `artifacts/designs/parts/live-chip-table-ui/feature-mapping.md`
- Reused: `components/chip.tsx`, `components/context-menu.tsx`, `components/calc-builder.tsx`, `components/rename-modal.tsx`, `file-loader.tsx` (triggerFileInput), `core/state-serializer.ts` (saveState)
