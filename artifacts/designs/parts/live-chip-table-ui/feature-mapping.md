# Live Chip-Table UI — Feature Mapping Reference

**Companion to:** `DD-dd-live-chip-table-ui.md`  
**Purpose:** Maps every current feature to its location in the new design. Nothing is lost.

---

## Tabs

| Current (3 tabs) | New (2 tabs) |
|------------------|--------------|
| Query Builder tab | **Eliminated** — merged into Report tab |
| Browse Sheet tab | **Retained** — source data viewer; needs slight rework, mostly fine as-is |
| Report tab | **Report tab** — Live Chip-Table view (menu bar + 3-row header grid + right sidebar) |

---

## File Operations

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Import spreadsheets (XLSX/CSV) | `sidebar.tsx` drop zone + `file-loader.tsx` | File → **Import file** (opens file picker filtered to spreadsheet types). Drop zone also accepts. |
| Import config (.rcjson) | Same loader, auto-detected | File → **Import config** (opens file picker for .rcjson). **Separate menu item** from Import file. Drop zone also accepts. |
| Multi-sheet workbook selector | `file-loader.tsx` MUI Dialog | Unchanged — reused as-is |
| Table list with row counts | `sidebar.tsx` table cards | Per-sheet MUI Accordions in right sidebar (sheet name + row count in header) |
| Table removal | `sidebar.tsx` X button per card | Each sheet accordion header remove action |
| Table preview / source data | `sidebar.tsx` click table name | **Browse Sheet tab** — existing preview grid |
| Save config (.rcjson) | `sidebar.tsx` Save button | Right sidebar TopSection Save button |
| Auto-detect totals rows in source | `loader.ts` during ingest | Unchanged — ingestion pipeline untouched |

---

## Pipeline Configuration

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Base table selection | `cards/pipeline-card.tsx` → `BaseStage` | **Implicit** — first chip dropped on any header row sets the base sheet |
| Stack sheets (UNION ALL) | `cards/pipeline-card.tsx` → `StackSheets` | Format → **Stacks modal**. Creates virtual sheet accordion in sidebar. Multiple stacks supported. |
| Lookups / JOINs | `cards/pipeline-card.tsx` → `LookupStage` | **Drag-pair** — drop chip from Sheet B onto occupied top row of a column. Chips appear side-by-side with gear ⚙. |
| Join type (inner/left/right) | `LookupStage` join type selector | Gear ⚙ popup on join pair → "if no match" option |
| Duplicate key handling | `LookupStage` option | Gear ⚙ popup on join pair → "duplicate keys" option |
| Multi-key joins | Multiple `LookupStage` entries on same table pair | Drop extra chips in **bottom row** — adds join conditions without adding to output. Column position doesn't matter for semantics. |
| Calculated columns | `cards/pipeline-card.tsx` → `CalcStage` | **CalcAccordion** in right sidebar → dashed "+ add calculation" chip → MUI Dialog with CalcBuilder |
| Calc types (math/text/compare/date) | `calc-builder.tsx` sub-builders | Unchanged — CalcBuilder reused as-is in dialog |
| Calc editing | `CalcStage` click chip to edit | Right-click calc chip → Edit... (reopens CalcBuilder dialog with existing config) |
| Calc rename | `CalcStage` right-click → rename | Right-click calc chip → Rename |
| Detail bands (1:N expansion) | `cards/pipeline-card.tsx` → `DetailBandStage` | Drop **sheet-name chip** into **middle row** of a column. Gear ⚙ opens band config modal. |
| Band match keys | `DetailBandStage` key pair selectors | Band config modal (opened from gear ⚙) |
| Band column selection (child columns) | `DetailBandStage` child column checkboxes | Band config modal |
| Multiple bands in same column | `DetailBandStage` multiple band entries | Sheet chips reorderable by dragging within middle row. Order determines display order. |
| Pipeline stage reordering | `cards/pipeline-card.tsx` drag to reorder stages | Not applicable — pipeline order is implicit from AppState arrays. Lookups and bands are ordered by their configuration order. |

---

## Grouping & Aggregation

All grouping and aggregation configuration lives in a single modal: **Format → Layout**.

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Group mode / group-by column selection | Toolbar agg mode + `ColumnChips` double-click | Layout modal → select group-by columns **in order** with drag-to-reorder |
| Per-column aggregate function (sum/count/avg/min/max) | `cards/layout-card.tsx` AggregateItems per-column selectors | Layout modal → per-column aggregate selector in the aggregates list |
| Totals mode (grand total row) | Toolbar agg mode toggle | Layout modal → ☐ Show Totals toggle |
| Subtotals mode | Toolbar agg mode toggle | Layout modal → ☑ Show Subtotals toggle |
| Subtotal strategy (which columns drive breaks) | `LayoutCard` subtotalBy selector | Layout modal → ☐ break subtotals here checkbox per group-by level |
| Show subtotals on top | `LayoutCard` subtotalOnTop toggle | Layout modal → ☐ Show Subtotals on Top toggle |
| Blank space between groups | `LayoutCard` subtotalSpacer toggle | Layout modal → ☐ Blank Space Between Groups toggle |
| Grouping sorts (separate from output sorts) | Not exposed in current UI | Layout modal → sort direction per group-by level. Grouping sort may differ from Config → Sorting. |
| `aggregation.ts` per-mode state save/restore | `aggregation.ts` save/restore on mode switch | **Eliminated** — not needed. Single consistent state. |

**Layout modal structure:**
```
Group By:
  [column] ▲▼  ☐ break subtotals here
  [column] ▲▼  ☑ break subtotals here
  [+ add group level]

Grouping Sort: [per-level sort direction]

Aggregates:
  [column]  [sum ▾]
  [column]  [avg ▾]

☐ Show Totals
☑ Show Subtotals
☐ Show Subtotals on Top
☐ Blank Space Between Groups
```

---

## Column Header Interactions

The three-row header is rendered via AG Grid `headerComponentFramework`. Each row area has specific drop semantics.

| Row | What you drop | Result | Gear ⚙ | Clear (×) |
|-----|---------------|--------|--------|-----------|
| **Top** | Column chip (empty cell) | Adds column to output | None — column config via sidebar right-click + Layout modal | **× on hover** clears ALL content in that column's header area |
| **Top** | Column chip from different sheet (onto occupied cell) | Creates join pair, chips side-by-side | Opens join options: "if no match", "duplicate keys" | **× on hover** clears ALL content in that column's header area |
| **Middle** | Sheet-name chip | Creates detail band | Opens band config modal (match keys, child columns) | **× on hover** clears ALL content in that column's header area |
| **Bottom** | Column chip (any sheet) | Extra join key — contributes silently to join definition | None | **× on hover** clears ALL content in that column's header area |

**× button:** Every column header area shows an **× on hover** that clears all chips and configuration for that column. One × per column (not per row). Clears join pairs, band assignments, match keys — everything in that column's header — in one action.

**Red column state:** If a chip is dropped where no relationship can be resolved (unrelatable sheets, no shared columns), the column header area shows red and no data populates in that column. Hovering shows a tooltip. The × clears the error state.

---

## Column Configuration

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Column selection (add to output) | `cards/layout-card.tsx` → `ColumnChips` click-to-toggle | Drag column chip to **top row** of any column header |
| Column ordering | `ColumnChips` drag-to-reorder | AG Grid built-in column reorder → `onColumnMoved` syncs `colOrder` in AppState |
| Column rename | `ColumnChips` right-click / grid header double-click | Right-click chip in sidebar → Rename |
| Column type override (string/number/date) | `ColumnChips` / grid header menu | Right-click chip in sidebar → type options |
| Color-coded by source table | Chip CSS class from table palette | Inherent — chips live inside their sheet's accordion; color is implicit |
| Remove column from output | `ColumnChips` toggle off / grid header close | × on column header area clears the column |
| Merge display toggle | `cards/layout-card.tsx` → `MergeToggles` per-column | Right-click column chip in sidebar → **Merge toggle** |
| Column width persistence | AG Grid `onColumnResized` → `colState` | AG Grid `onColumnResized` → `_ui.columnWidths` in AppState |

---

## Filtering

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Add/remove filters | `cards/filter-sort-card.tsx` → `FilterList` | Config → **Filtering modal** |
| Filter operators (equals, contains, >, <, etc.) | `FilterList` per-filter operator dropdown | Unchanged — reused from `filter-list.tsx` inside modal |
| Filter enable/disable toggle | `FilterList` per-filter checkbox | Unchanged |
| Multiple filters (AND logic) | `FilterList` multiple rows | Unchanged |
| Column type-aware operators | `FilterList` filters available operators by column type | Unchanged |

---

## Sorting

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Add/remove sorts | `cards/filter-sort-card.tsx` → `SortList` | Config → **Sorting modal** |
| Sort direction (asc/desc) | `SortList` per-sort toggle | Unchanged — reused from `sort-list.tsx` inside modal |
| Sort enable/disable toggle | `SortList` per-sort checkbox | Unchanged |
| Multiple sort levels | `SortList` multiple rows | Unchanged |

---

## Output / Display

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Merge display (merge identical adjacent values) | `cards/layout-card.tsx` → `MergeToggles` per-column | Right-click column chip in sidebar → Merge toggle |
| Column width persistence | AG Grid `onColumnResized` | AG Grid `onColumnResized` → `_ui.columnWidths` |
| Band row tinting | `grid.tsx` `createBandRowStyler()` → `getRowStyle` | Unchanged — same callback |
| Totals row styling (bold, distinct background) | `grid.tsx` append to rowData + `getRowStyle` check `_row_type === 'totals'` | Unchanged |
| Subtotal row styling | `grid.tsx` `getRowStyle` check `_row_type === 'subtotal'` | Unchanged |
| Row exclusion | `grid.tsx` right-click row → exclude | **Browse Sheet tab** — right-click row in source data viewer |

---

## Preview / Export

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Run Report | `sections/run-bar.tsx` Run button | **Eliminated** — auto-preview on every state change (400ms debounce + hash check) |
| Validation status (healthy/blocked) | `run-bar.tsx` validation pill | **Report tab border** — full red border around grid area when blocked |
| Export to XLSX | `run-bar.tsx` Export → `export.ts` | File → Export report → Excel |
| Export to CSV | `run-bar.tsx` Export → `export.ts` | File → Export report → CSV |
| Result grid with virtual scrolling | `<AgGridReact>` in `grid.tsx` | Unchanged — same `<AgGridReact>` |

---

## UI State

| Current Feature | Current Location | New Location |
|-----------------|------------------|--------------|
| Sidebar collapse | `sidebar.tsx` toggle | PivotSidebar collapse → `_ui.sidebarCollapsed` |
| Active tab (3 tabs) | `tabs.ts` | Active tab (2 tabs: Report + Browse Sheet) — `activeTab` in AppState, reduced |
| Column widths | AG Grid `colState` | `_ui.columnWidths` per column alias |

---

## What's Eliminated Entirely

| Component | Lines | Reason |
|-----------|-------|--------|
| `sidebar.tsx` | ~237 | Replaced by right sidebar TopSection + sheet accordions |
| `cards/pipeline-card.tsx` | ~200 | Implicit base sheet + drag-pair joins + sheet-chip bands |
| `cards/layout-card.tsx` | ~150 | 3-row header drop zones + Layout modal + right-click chip menus |
| `cards/filter-sort-card.tsx` | ~100 | Config menu modals |
| `sections/column-chips.tsx` | ~300 | SheetAccordion column chips |
| `sections/run-bar.tsx` | ~162 | Auto-preview (no manual Run) |
| `sections/base-stage.tsx` | ~100 | Implicit base sheet |
| `sections/lookup-stage.tsx` | ~200 | Drag-pair join key pairs |
| `sections/detail-band-stage.tsx` | ~200 | Sheet chips in middle header row + band config modal |
| `sections/stack-sheets.tsx` | ~100 | Stacks modal (reused as content, wrapper eliminated) |
| `sections/merge-toggles.tsx` | ~60 | Right-click chip → Merge toggle |
| `aggregation.ts` state save/restore | ~80 (of 222) | Not needed — single consistent state. Core aggregation logic (setAggMode, addAggregate, etc.) may still be used by Layout modal. |

---

## What's Reused Unchanged

| File | Purpose |
|------|---------|
| `core/store.ts` | State management |
| `core/sqldb.ts` | SQLite wrapper |
| `catalog/*` | Source/column catalog building |
| `query/*` | SQL generation, query plan, layout selection |
| `report/*` | Engine, validation, result-set |
| `ui/export.ts` | XLSX/CSV export |
| `ui/loader.ts` | File data ingestion |
| `ui/file-loader.tsx` | File loading UX (drop zone, sheet selector dialog, multi-sheet modal) |
| `ui/components/chip.tsx` | Chip component |
| `ui/components/context-menu.tsx` | Right-click menu |
| `ui/components/modal.tsx` | Dialog wrapper |
| `ui/components/calc-builder.tsx` | Calculation builder |
| `ui/components/rename-modal.tsx` | Column rename |
| `ui/sections/filter-list.tsx` | Filter editor (reused inside Filtering modal) |
| `ui/sections/sort-list.tsx` | Sort editor (reused inside Sorting modal) |
| `grid.tsx` | Modified (+~100 lines) — headerComponentFramework integration |
