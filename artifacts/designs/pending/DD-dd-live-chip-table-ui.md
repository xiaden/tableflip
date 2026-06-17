# Live Chip-Table UI — Pivot-Style Layout on React + MUI + AG Grid React — Design Document

**Status:** Draft  
**Author:** RnD-DDAuthor  
**Created:** 2026-06-17  

**Related Documents:**
- [DD-preact-to-react-conversion](artifacts/designs/pending/DD-preact-to-react-conversion.md) — The React+MUI foundation. Already executed. This DD builds on the live React+MUI+AG Grid React stack (useStore hook, MUI ThemeProvider, Vite build, <AgGridReact> integration).
- [DD-pivot-table-ui-redesign](artifacts/designs/pending/DD-pivot-table-ui-redesign.md) — OBSOLETE. Preact-era pivot redesign (768 lines). Specified custom virtual-scrolling grid, deleting AG Grid, column resize via mousedown overlays. UX thinking (3-zone drop, auto-preview, _ui field) transfers but all implementation details are WRONG for the current React+MUI+AG Grid React stack. Superseded by this DD.
- [DD-pivot-table-ui-redesign-react](artifacts/designs/pending/DD-pivot-table-ui-redesign-react.md) — OBSOLETE. 56-line stub that said to DELETE grid.tsx — WRONG, AG Grid React stays. Deferred all architecture decisions. Superseded by this DD which provides the full architecture.
- [ADR-004: Five-Layer Architecture](artifacts/decisions/ADR-004-five-layer-architecture.md) — Five-layer architecture: UI layer only changes. Core/Catalog/Query/Report untouched. All new components in this DD are UI layer.
- [ADR-006: Monolithic State Store](artifacts/decisions/ADR-006-monolithic-state-store-single-source-of-truth-for-reactivity-and-serialization.md) — Monolithic store: AppState is single source of truth, all mutations via store.update/store.set. The optional _ui field in this DD is additive only, backward-compatible.

---

## Scope

**In scope:**

- Single-screen pivot layout replacing the 3-tab card-based UI (Query Builder / Browse Sheet / Report)
- Left sidebar (270px, collapsible): column chip palette + pipeline configuration (base table, stacks, lookups, calcs, detail bands) in collapsible MUI Collapse sections
- Toolbar row: aggregation mode selector (MUI ToggleButtonGroup), filter/sort chip row (MUI Chips with inline editors), Export button (MUI Button), validation pill (MUI Chip)
- Main area: AG Grid React grid with live auto-preview (400ms debounced report execution)
- Drag-and-drop from column palette to grid column headers with 3-zone drop detection (top = aggregation key, middle = add/reorder column, bottom = detail band)
- Dynamic drop zone overlay (React portal, created on dragstart, destroyed on drop)
- Format options as context menu (MUI Menu) on column header right-click
- Auto-preview: 400ms debounced report execution on every state change, hash-based dirty check using `buildReportSpecFromState()` output
- Calc column editor in MUI Dialog (reuses existing calc-builder component)
- Filter/sort as MUI Chip row in toolbar with inline editors
- Column reorder sync: AG Grid's `onColumnMoved` → `colOrder` in AppState
- AppState `_ui` field for UI-only state (column widths, preview dirty flag, sidebar collapsed state)
- AG Grid theme: `ag-theme-balham-dark` + CSS variable overrides for MUI dark theme alignment
- File management sidebar: table import (via file-loader Dialog), table list display with color indicators, table removal (X button per table), table preview (click table name), save report config (.rcjson) — all housed in a `FileBar` component at the top of PivotSidebar
- Component and unit tests for new components

**Out of scope:**

- Core layer changes (store, sqldb, utils, state) — zero changes. The store (`core/store.ts`) is NOT modified.
- Catalog layer changes (source-catalog, column-catalog) — zero changes
- Query layer changes (SQL generation, query plan) — zero changes
- Report layer changes (engine, validation, result-set, export) — zero changes
- Data model changes (AppState fields beyond optional `_ui`) — additive only, backward-compatible
- Serialization format changes — backward-compatible only, existing `.rcjson` files load without modification
- Multi-sheet report output — single-sheet reports only
- Feature flags or conditional old/new UI rendering — feature branch, no feature flags
- New npm dependencies beyond what the React conversion DD adds — no dnd-kit, no react-dnd, no new state library
- Deleting AG Grid — `<AgGridReact>` stays, drop zones are overlays
- Custom virtual-scrolling grid — AG Grid provides virtualization out of the box
- Keyboard navigation — defer to follow-up
- Accessibility (a11y) improvements — defer to follow-up

---

## Problem Statement

The current TableFlip UI uses a 3-tab card-based layout (Query Builder / Browse Sheet / Report) that fragments the report-building workflow. Users must switch between tabs to configure the pipeline, view results, and export — configuration and feedback are separated by tab boundaries. The Query Builder tab stacks three cards vertically (Pipeline, Layout, Filter/Sort) with a Run button, requiring scrolling through configuration to see results in a separate tab.

This layout was inherited from the original JavaScript implementation and ported faithfully to Preact, then converted to React+MUI by DD-preact-to-react-conversion. The React conversion preserved the 3-tab structure because it was a framework conversion, not a redesign. Now that the React+MUI foundation is live (useStore hook, MUI ThemeProvider, Vite build, <AgGridReact> integration), we can redesign the layout holistically.

The 3-tab layout has specific usability problems: (1) users can't see the effect of pipeline changes without switching to the Report tab and clicking Run, (2) column configuration (selection, ordering, aggregation) is split across two cards requiring scroll, (3) filter/sort configuration is in a third card further down, (4) the Browse Sheet tab duplicates table preview that could be integrated into the main view. These problems compound as reports grow in complexity — a report with 3 lookups, 2 calcs, and a detail band requires significant scrolling and tab-switching to configure and verify.

**Who has this problem:** Every user who builds reports with multi-stage pipelines. The problem scales with pipeline complexity — simple single-table reports work fine in the current layout, but anything with lookups, calcs, or bands requires constant context-switching.

This design document specifies the replacement of the 3-tab layout with a single-screen Live Chip-Table pivot layout: a collapsible sidebar for pipeline configuration and column palette, a toolbar for aggregation/filter/sort/export controls, and an AG Grid React grid with live auto-preview. The design preserves AG Grid React (already live from the React conversion), implements drop zones as dynamic overlays (React portals), and adds auto-preview with 400ms debouncing and hash-based dirty checking.

---

## Architecture

## Component Tree

```
<App> → <MuiThemeProvider>
  <Loader /> (unchanged)
  <PivotLayout>
    <PivotSidebar>     ← 270px, collapsible
      <FileBar>        ← Table import, table list, table preview, save button
      <ColumnPalette>  ← MUI Chips with HTML5 draggable, from buildColumnCatalog()
      <PipelineStages> ← MUI Collapse sections wrapping existing stage components
        BaseStage, StackSheets, LookupStage[], CalcStage[], DetailBandStage[]
    </PivotSidebar>
    <PivotMain>        ← flex: 1
      <PivotToolbar>   ← AggMode ToggleButtonGroup, FilterChips, SortChips, Export Button, Validation Pill
      <PivotGrid>      ← <AgGridReact> + dynamic DropZoneOverlay (portal, created on dragstart)
    </PivotMain>
```

## Data Flow

### User Interaction → Grid Update

```
User drags column chip from palette onto grid header
        │
        ▼
dragstart: dataTransfer.setData('text/plain', JSON.stringify({ colKey, colType }))
        │
        ▼
DropZoneOverlay mounts via React portal (created on dragstart, destroyed on drop)
        │
        ▼
User drops on header zone (top/middle/bottom detected via getBoundingClientRect)
        │
        ▼
store.update(draft => {
  // zone-specific mutation: add column, set agg key, or assign band
})
        │
        ▼
Store notifies all subscribers (synchronous)
        │
        ├── PivotSidebar re-renders (column palette updates)
        ├── PivotToolbar re-renders (validation updates)
        └── AutoPreview.schedulePreview() is called
                │
                ▼
            400ms debounce timer starts
                │
                ▼ (400ms later)
            buildReportSpecFromState(state) → full ReportSpec
            JSON.stringify(spec) → hash
            hash !== lastHash → proceed
                │
                ▼
            runReport(spec, tables) → resultSet
                │
                ├── Success → store.set('result', resultSet)
                │              PivotGrid re-renders with new data via <AgGridReact>
                │              lastResultHash = hash
                │
                └── Error → validation error displayed
                            grid shows last successful result
```

### File Load Flow

```
User clicks "Import" button in FileBar
        │
        ▼
triggerFileInput() called (reused from file-loader.tsx)
  — opens hidden <input type="file"> or triggers drop zone
        │
        ▼
file-loader.tsx processFiles() handles selected file(s)
  — calls loadSpreadsheet() / loadSheets() from loader.ts
  — if multi-sheet workbook: MUI Dialog (sheet selector modal) opens
    — user selects sheet(s) → confirm → processFiles() continues
        │
        ▼
loader.ts ingestSheet() processes the data
  — creates table in SQLite via sqldb
  — populates tables[tid] in AppState
        │
        ▼
store.update(draft => {
  draft.tables[tid] = { name, rowCount, cols, ... };
  if (!draft.base) draft.base = tid;  // auto-set base if first table
})
        │
        ▼
Store notifies all subscribers (synchronous)
        │
        ├── FileBar re-renders (table list updates, new table appears)
        ├── ColumnPalette re-renders (new columns available)
        ├── PivotToolbar re-renders (validation updates)
        └── AutoPreview.schedulePreview() is called → grid updates
```

**Note:** `file-loader.tsx` is reused as-is. The file import is triggered from FileBar's import button, which calls `triggerFileInput()` — the same function used by the current sidebar's drop zone. The sheet selector modal (MUI Dialog) and loading overlay are handled internally by `file-loader.tsx`. No modifications to `file-loader.tsx` are needed.

### Store Interaction

**Existing patterns preserved:**
- `useStore(selector)` hook with shallow equality — unchanged
- `store.update(draft => { ... })` for mutations — unchanged
- `store.set(key, value)` for direct assignments — unchanged
- `store.subscribe(listener)` for side effects — unchanged

**New selectors for Live Chip-Table:**
```typescript
// Sidebar collapsed state
const sidebarCollapsed = useStore(s => s._ui?.sidebarCollapsed ?? false);

// Preview dirty flag (transient, not serialized)
const previewDirty = useStore(s => s._ui?.previewDirty ?? false);

// Column widths (persisted)
const columnWidths = useStore(s => s._ui?.columnWidths ?? {});
```

**New _ui field in AppState:**
```typescript
interface AppState {
  // ... all existing fields unchanged ...
  _ui?: {
    sidebarCollapsed?: boolean;
    columnWidths?: Record<string, number>;
    previewDirty?: boolean;      // transient, reset on load
    lastResultHash?: string;     // transient, reset on load
  };
}
```

## Layer Mapping

All new components are UI layer. No changes to Core, Catalog, Query, or Report layers.

| Component | Layer | Responsibility |
|-----------|-------|----------------|
| PivotLayout | UI | Root layout: sidebar + main area |
| PivotSidebar | UI | Sidebar shell: file bar + column palette + pipeline stages |
| FileBar | UI | Table import, table list with color indicators, table removal, table preview, save button |
| ColumnPalette | UI | Draggable column chips from buildColumnCatalog() |
| PipelineStages | UI | MUI Collapse sections wrapping existing stage components |
| PivotToolbar | UI | AggMode selector, filter/sort chips, export, validation |
| PivotGrid | UI | <AgGridReact> wrapper + overlay lifecycle |
| DropZoneOverlay | UI | Dynamic portal with 3-zone drop detection |
| AutoPreview | UI | Debounce + hash check + runReport integration |

## Reused UI-Layer Files (Unchanged)

The following UI-layer files are **reused as-is** by the new pivot layout components. No modifications are needed:

| File | Lines | Reused By | Purpose |
|------|-------|-----------|---------|
| `ui/aggregation.ts` | ~222 | PivotToolbar | Aggregation mode selection logic (none/group/totals/subtotals). PivotToolbar's ToggleButtonGroup calls into this module. |
| `ui/export.ts` | ~100 | PivotToolbar | Export trigger logic (XLSX/CSV). PivotToolbar's Export button calls `exportAs()` from this module. |
| `ui/loader.ts` | ~200 | FileBar (via file-loader.tsx) | File data ingestion — `loadSpreadsheet()`, `loadSheets()`, `ingestSheet()`. Called by `file-loader.tsx` when user imports a file. |
| `ui/file-loader.tsx` | ~357 | FileBar | File loading UX — drop zone, sheet selector MUI Dialog, loading overlay. Reused as-is: FileBar's import button calls `triggerFileInput()` which opens the file picker; `file-loader.tsx` handles the rest internally (sheet selection via MUI Dialog, data ingestion via `loader.ts`). No modifications needed. |
| `ui/components/chip.tsx` | ~80 | ColumnPalette | Custom Chip component with color class support. ColumnPalette renders these as draggable chips. |
| `ui/components/context-menu.tsx` | ~60 | PivotGrid | MUI Menu wrapper for right-click context menus. PivotGrid reuses this for header right-click menu. |
| `ui/components/modal.tsx` | ~50 | file-loader.tsx | MUI Dialog wrapper used by file-loader's sheet selector. |

**Note on `column-chips.tsx` (sections/):** This file (~300 lines) is the current column chip UI for the layout card. It is **replaced** by `ColumnPalette.tsx`. Key differences:
- `column-chips.tsx` uses `buildColSourceMap()` (reads global store, doesn't handle band prefixing) → `ColumnPalette.tsx` uses `buildColumnCatalog()` (pure function, correct prefixing)
- `column-chips.tsx` has double-click visibility toggle and right-click rename context menu → `ColumnPalette.tsx` is DnD-only (rename is handled via grid header context menu in PivotGrid)
- `column-chips.tsx` imports `Chip` from `components/chip.tsx` → `ColumnPalette.tsx` reuses the same `Chip` component

**Note on `run-bar.tsx` (sections/):** This file (~162 lines) shows the "Run Report" button and validation status pill. It is **removed** — auto-preview eliminates the manual Run button, and the validation status pill is subsumed by PivotToolbar's validation pill Chip.

**Note on `sidebar.tsx`:** This file (~237 lines) handles file management (import, table list, remove, preview, save). It is **replaced** by `FileBar.tsx` inside `PivotSidebar`. All functionality is subsumed (see FileBar component specification above). The sidebar collapse toggle is handled by PivotSidebar's `collapsed` prop.

---

## Design Goals

1. **Single-screen pivot table layout** — Replace the 3-tab card-based UI (Query Builder / Browse Sheet / Report) with a unified sidebar + toolbar + grid layout. Configuration and feedback coexist on one screen.

2. **Direct manipulation via drag-and-drop** — Drag column chips from the sidebar palette onto grid column headers to add columns, set aggregation keys, or assign detail bands. Three-zone drop detection (top/middle/bottom) on headers.

3. **Live auto-preview** — Automatic report execution on every pipeline change with 400ms debouncing and hash-based dirty checking. No manual "Run Report" button — the grid always shows current results.

4. **Preserve AG Grid React** — Keep the declarative `<AgGridReact>` integration from the React conversion. Implement drop zones as dynamic overlays (React portals) rather than replacing AG Grid's component API.

5. **All existing functionality preserved** — Every feature in the current UI must work: stacks, lookups, calculated columns, detail bands, filters, sorts, aggregates, totals, subtotals, merges, XLSX/CSV export, column rename, row exclusion.

6. **UI-layer only** — No changes to Core, Catalog, Query, or Report layers. All new components are in `SRC/preact/ui/`.

7. **Backward-compatible state** — The optional `_ui` field in AppState is additive only. Existing `.rcjson` files load without modification.

8. **Performance budget** — DnD → state change < 5ms, debounce 400ms, runReport ~100-500ms, AG Grid update ~50-200ms. Total: ~200-600ms from interaction to visible grid update.

---

## Constraints

1. **Five-layer architecture preserved (ADR-004):** Only `SRC/preact/ui/` changes. Core, Catalog, Query, Report layers are untouched. The store (`core/store.ts`) is NOT modified — new components use the existing `useStore(selector)` hook.

2. **Monolithic store preserved (ADR-006):** The pub/sub store pattern, deep-clone-on-mutation, and `AppState` shape are unchanged. The optional `_ui` field is additive only. All mutations go through `store.update()` / `store.set()`.

3. **AG Grid React stays:** The declarative `<AgGridReact>` integration (already live from the React conversion) is preserved. Drop zones are implemented as dynamic overlays, not by replacing AG Grid's component API.

4. **No breaking changes to AppState serialization:** The `_ui` field is optional and backward-compatible. Transient fields (`previewDirty`, `lastResultHash`) are reset on load. Existing `.rcjson` files load without modification.

5. **All existing functionality preserved:** Stacks, lookups, calculated columns, detail bands, filters, sorts, aggregates, totals, subtotals, merges, XLSX/CSV export, column rename, row exclusion — all must work in the new layout.

6. **Single-sheet reports only:** No multi-sheet output support.

7. **No feature flags:** Feature branch, no conditional old/new UI rendering.

8. **No new npm dependencies beyond React conversion:** The React conversion DD already adds react, react-dom, @mui/material, @emotion/react, @emotion/styled, ag-grid-react. No dnd-kit, no react-dnd, no new state library.

9. **No `dangerouslySetInnerHTML`:** All rendering uses React JSX.

10. **Window/document access guarded:** All `window` and `document` access guarded with `typeof window !== 'undefined'` / `typeof document !== 'undefined'`.

11. **Vendored CJS modules:** `// @ts-expect-error - vendored CJS module` before `import()` of files in `js/wasm/` and `js/vendor/`.

12. **ASR-0002 compliance:** All user-facing text uses non-technical language. No "JOIN", "SQL", "WHERE" in labels, tooltips, or errors.

13. **TypeScript strictness preserved:** `strict: true` in tsconfig. No `any` types for new code.

14. **All mandatory checks pass:** `npm run typecheck` (zero errors), `npm run lint` (zero warnings), `npm test` (all tests pass).

---

## Design Decisions

## 1. Drop Zone Implementation

**Decision:** Dynamic overlays only during drag — portal on palette dragstart, destroyed on drop.

**Rationale:** Avoids AG Grid event conflicts. One-time position calculation at mount. No overlay when not dragging (zero overhead).

**Implementation:**
- `DropZoneOverlay` mounts via `createPortal` to `document.body` on `dragstart` event from `ColumnPalette`
- Measures AG Grid header positions once at mount using `getBoundingClientRect()` on header elements (accessed via `gridRef.current.api` column API)
- Renders absolutely-positioned divs over each header, split into 3 zones: top 30% / middle 50% / bottom 20%
- If headers are too short for reliable vertical zones (<25px height), use horizontal gesture-based alternative: left edge = agg key, center = add/reorder, right edge = band
- Zone detection: `elementFromPoint(e.clientX, e.clientY)` + `data-zone` attributes on overlay divs
- Visual feedback: CSS classes applied to overlay divs based on current hover zone (`.zone-top-active`, `.zone-middle-active`, `.zone-bottom-active`)
- Unmounts on `drop`, `dragend`, or `dragcancel` events

**Alternative rejected:** Embedding drop zones directly in AG Grid's `headerComponent` React component. This fights AG Grid's event model and requires custom header rendering that duplicates AG Grid's built-in header UX (sort indicators, filter icons, resize handles). Overlay approach is simpler and preserves AG Grid's native behavior.

## 2. DnD Mechanism

**Decision:** HTML5 DragEvent for palette→grid + AG Grid built-in for column reorder.

**Rationale:** Two systems with clear boundary. Extends existing `column-chips.tsx` pattern (already uses HTML5 DnD for chip reordering). AG Grid's built-in column reorder (via `columnDefs` + `onColumnMoved`) provides native UX for reordering columns within the grid.

**Implementation:**
- **Palette → Grid:** HTML5 `dragstart` on `ColumnPalette` chips sets `dataTransfer.setData('text/plain', JSON.stringify({ colKey, colType }))`. `DropZoneOverlay` handles `dragover` (visual feedback) and `drop` (zone-specific action).
- **Grid → Grid reorder:** AG Grid's native column drag (enabled by default with `suppressMovable: false` on column defs). `onColumnMoved` callback syncs `colOrder` in AppState.
- **Data payload:** `{ colKey: string, colType: 'raw' | 'calc' }` — colKey is the column alias, colType distinguishes physical columns from calculated columns.

**Boundary:** HTML5 DnD is used ONLY for palette→grid. Grid internal reorder uses AG Grid's built-in mechanism. No mixing.

## 3. 3-Zone vs Reorder Coexistence

**Decision:** AG Grid for middle zone (reorder), overlays for top/bottom zones (agg key, band).

**Rationale:** Native AG Grid column reorder UX is preserved (drag header to new position). Overlays handle special zones (top = agg key, bottom = band) that AG Grid doesn't support natively.

**Implementation:**
- **Top zone (agg key):** In group/totals/subtotals mode, toggles column as group-by key. Drops update `groupBy` in AppState.
- **Middle zone (add/reorder):** If the dragged column is NOT in `selCols` → add to `selCols` and `colOrder`. If it IS already in `selCols` → no-op (AG Grid handles reorder natively via header drag, not overlay drop).
- **Bottom zone (band):** In group mode, assigns column as band key pair. Drops update `detailBands` in AppState.

**Zone semantics are context-aware:** The overlay checks `aggMode` from AppState to determine which zones are active. In 'none' (detail) mode, top and bottom zones are disabled (no agg key or band assignment). In 'group' mode, all three zones are active.

## 4. Auto-Preview Lifecycle

**Decision:** Store subscription → 400ms debounce → hash check → runReport → set result.

**Rationale:** Proven pattern from the Preact pivot DD. Hash via `JSON.stringify(buildReportSpecFromState())` prevents redundant execution when state changes don't affect the report spec (e.g., sidebar collapse toggle).

**Implementation:**
```typescript
// AutoPreview.ts
let _debounceTimer: number | null = null;
let _lastHash: string | null = null;
let _running = false; // reentry guard

export function schedulePreview(): void {
  if (_debounceTimer != null) clearTimeout(_debounceTimer);
  
  const state = getStore().getState();
  const spec = buildReportSpecFromState(state);
  const hash = JSON.stringify(spec);
  
  if (hash === _lastHash) return; // spec unchanged
  
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    if (_running) return; // reentry guard
    _running = true;
    _lastHash = hash;
    
    try {
      const result = runReport(spec, state.tables);
      getStore().set('result', result);
    } catch (err) {
      // validation error — display in toolbar pill
      getStore().set('validationError', String(err));
    } finally {
      _running = false;
    }
  }, 400);
}

// Called from PivotLayout on mount:
// useEffect(() => {
//   const unsub = getStore().subscribe(() => schedulePreview());
//   return unsub;
// }, []);
```

**Hash scope:** `buildReportSpecFromState()` returns `{ base, baseCols, stacks, lookups, calcStages, detailBands, filters, sorts, aggregation, mergeDisplay }`. This covers all report-affecting state. UI-only state (`_ui.sidebarCollapsed`) is excluded.

**Reentry guard:** If a state mutation occurs while `runReport()` is executing (e.g., user drags another column during the 100-500ms execution), the mutation is ignored for preview purposes. The next mutation after `runReport()` completes will trigger a new preview.

**Grid flash prevention:** The grid maintains previous `rowData` until new data arrives. Conditional render: `{result ? <AgGridReact rowData={result.rows} ... /> : <EmptyState />}`. This prevents the grid from clearing and re-rendering during the 400ms debounce + 100-500ms execution window.

## 5. Band Row Tinting

**Decision:** `getRowStyle` callback (already proven via `createBandRowStyler`).

**Rationale:** Already implemented and tested in `grid.tsx` (lines 175-199). The function maps `_band_id` to tint colors via `BAND_ROW_TINTS` array. No changes needed — `PivotGrid` passes this callback to `<AgGridReact getRowStyle={...} />`.

## 6. Totals Row Rendering

**Decision:** Append to `rowData` + `getRowStyle` (current approach).

**Rationale:** Works well. `pinnedBottomRowData` has too many styling constraints (can't apply band tints, limited cell renderer access). Appending the totals row to the main `rowData` array and styling it via `getRowStyle` (checking `data._row_type === 'totals'`) is simpler and more flexible.

## 7. Header Context Menu

**Decision:** MUI Menu from ColumnHeader (existing ContextMenu component).

**Rationale:** Already MUI-based with `{x,y}` positioning (see `components/context-menu.tsx`). `onContextMenu` is already wired in the `ColumnHeader` component in `grid.tsx`. No changes needed — `PivotGrid` reuses the existing `ContextMenu` component.

**Menu items:** Rename column, set column type, set format, hide column, exclude row (if right-clicked on a cell). All actions already implemented in the current `ColumnHeader` — just move the menu rendering into `PivotGrid`.

## 8. Column Palette

**Decision:** `buildColumnCatalog()` via `buildReportSpecFromState()` — correct prefixing.

**Rationale:** Fixes the duplicate-column-name bug that plagues 15+ UI callers. `buildColumnCatalog()` is a pure function that takes a `ReportSpec` and `sourceCatalog` (Map) and returns `{ colMap, colList }` with correctly prefixed aliases for band columns (`_{bandId}_{colName}`).

**Implementation:**
```typescript
// ColumnPalette.tsx
const spec = buildReportSpecFromState(state);
const sourceCatalog = buildSourceCatalog(state.tables);
const { colMap, colList } = buildColumnCatalog(spec, sourceCatalog);

// Render chips for each column in colList
return (
  <Stack direction="row" flexWrap="wrap" gap={0.5}>
    {colList.map(alias => {
      const src = colMap.get(alias);
      const label = src?.kind === 'calc' 
        ? state.calcStages?.[src.idx]?.alias || alias
        : colLabel(src!.tid, src!.col);
      const colorClass = src?.kind === 'raw' 
        ? getTableColorClass(src.tid) 
        : '';
      return (
        <Chip
          key={alias}
          col={alias}
          label={label}
          colorClass={colorClass}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({
              colKey: alias,
              colType: src?.kind || 'raw'
            }));
          }}
        />
      );
    })}
  </Stack>
);
```

**Why not `buildColSourceMap()`:** That function reads from the global store and doesn't take explicit state. It also doesn't handle band column prefixing correctly. `buildColumnCatalog()` is the canonical pure function.

## 9. Pipeline Sidebar Sections

**Decision:** MUI Collapse + custom header bars — 28px slim headers.

**Rationale:** Saves ~50% vertical space vs MUI Accordion (which has 48px headers). Full control over styling. MUI Collapse provides smooth expand/collapse animation.

**Implementation:**
```typescript
// PivotSidebar.tsx
function PipelineSection({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ borderBottom: '1px solid var(--border)' }}>
      <Box
        onClick={() => setOpen(!open)}
        sx={{
          height: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          cursor: 'pointer',
          '&:hover': { backgroundColor: 'action.hover' }
        }}
      >
        {icon}
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }}>
          {title}
        </Typography>
        <IconButton size="small" sx={{ p: 0 }}>
          {open ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Box sx={{ p: 1 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

// Usage:
<PipelineSection title="Base Table" icon={<TableIcon />} defaultOpen={true}>
  <BaseStage />
</PipelineSection>
<PipelineSection title="Stack Sheets" icon={<StackIcon />}>
  <StackSheets />
</PipelineSection>
// ... etc
```

**Stage components reused as-is:** `BaseStage`, `StackSheets`, `LookupStage`, `CalcStage`, `DetailBandStage` are wrapped directly. No modifications needed — they already use `useStore(selector)` and MUI components from the React conversion.

**CalcStage opens MUI Dialog:** The existing `calc-stage.tsx` renders a chip that opens a modal. In the pivot layout, this becomes an MUI Dialog with the existing `CalcBuilder` component as content. No changes to `calc-builder.tsx`.

## 10. AG Grid Theme

**Decision:** `ag-theme-balham-dark` + CSS variable overrides (~50 lines).

**Rationale:** Best visual consistency with MUI dark theme. Already partially done in the React conversion (grid.tsx uses `ag-theme-balham-dark` class). A few CSS variable overrides align AG Grid's colors with MUI's palette.

**Implementation:**
```css
/* pivot-layout.css */
.ag-theme-balham-dark {
  --ag-background-color: var(--bg);
  --ag-header-background-color: var(--bg2);
  --ag-odd-row-background-color: var(--bg);
  --ag-row-hover-color: var(--bg3);
  --ag-selected-row-background-color: var(--bg3);
  --ag-border-color: var(--border);
  --ag-header-foreground-color: var(--text);
  --ag-foreground-color: var(--text);
  --ag-font-family: var(--font-family);
  --ag-font-size: 13px;
  --ag-header-height: 32px;
  --ag-row-height: 32px;
}
```

**Why not a custom AG Grid theme:** AG Grid's theme system is complex (SASS variables, theme builder). CSS variable overrides are simpler and sufficient for color alignment. The balham-dark theme already has the right structure (dark background, light text, subtle borders).

---

## Component Specifications

## PivotLayout

**File:** `SRC/preact/ui/PivotLayout.tsx` (~80 lines)

**Responsibilities:**
- Root layout component: sidebar (270px) + main area (flex: 1)
- Renders `<PivotSidebar>` and `<PivotMain>` (which contains `<PivotToolbar>` and `<PivotGrid>`)
- Mounts the auto-preview subscription on mount
- Handles sidebar collapse/expand state (stored in `_ui.sidebarCollapsed`)

**Props:** None (reads all state from store via `useStore`)

**Key code:**
```typescript
export function PivotLayout() {
  const sidebarCollapsed = useStore(s => s._ui?.sidebarCollapsed ?? false);
  
  useEffect(() => {
    const unsub = getStore().subscribe(() => schedulePreview());
    return unsub;
  }, []);
  
  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <PivotSidebar collapsed={sidebarCollapsed} />
      <PivotMain />
    </Box>
  );
}
```

## PivotSidebar

**File:** `SRC/preact/ui/PivotSidebar.tsx` (~70 lines + wrapping stages)

**Responsibilities:**
- Sidebar shell: 270px width, collapsible
- Renders `<FileBar>` at top (table import, table list, save)
- Renders `<ColumnPalette>` below FileBar
- Renders pipeline stages in collapsible sections: Base, Stacks, Lookups, Calcs, Detail Bands
- Each section is a `<PipelineSection>` (MUI Collapse + custom header bar)

**Props:**
- `collapsed: boolean` — controls sidebar visibility

**Key code:**
```typescript
export function PivotSidebar({ collapsed }: { collapsed: boolean }) {
  if (collapsed) return null;
  
  return (
    <Box sx={{ width: 270, borderRight: '1px solid var(--border)', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <FileBar />
      <ColumnPalette />
      <PipelineSection title="Base Table" defaultOpen={true}>
        <BaseStage />
      </PipelineSection>
      <PipelineSection title="Stack Sheets">
        <StackSheets />
      </PipelineSection>
      <PipelineSection title="Lookups">
        <LookupStage />
      </PipelineSection>
      <PipelineSection title="Calculated Columns">
        <CalcStage />
      </PipelineSection>
      <PipelineSection title="Detail Bands">
        <DetailBandStage />
      </PipelineSection>
    </Box>
  );
}
```

## FileBar

**File:** `SRC/preact/ui/FileBar.tsx` (~120 lines)

**Responsibilities:**
- Displays current base table as a colored MUI Chip with table name and row count
- Import button to load additional files (calls `triggerFileInput()` from `file-loader.tsx`)
- Expandable table list (MUI Collapse) showing all loaded tables with colored dot indicators
- Remove table button (X icon) per table in the list (calls `dropTable()` + store cleanup)
- Table preview on click (sets `previewTableId` + `activeTab` in store)
- Save Report Config button (calls `saveState()` from `state-serializer.ts`)

**Props:** None (reads state from store via `useStore`)

**Key code:**
```typescript
export function FileBar() {
  const { tables, base } = useStore(s => ({ tables: s.tables, base: s.base }));
  const [listOpen, setListOpen] = useState(false);
  
  const ids = Object.keys(tables).sort((a, b) =>
    tables[a].name.localeCompare(tables[b].name)
  );
  const baseTable = base ? tables[base] : null;
  const baseColor = base ? getTableColor(base) : 'var(--muted)';
  
  return (
    <Box sx={{ borderBottom: '1px solid var(--border)', p: 1 }}>
      {/* Current table chip + import button */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        {baseTable ? (
          <Chip
            label={`${baseTable.name} (${baseTable.rowCount.toLocaleString()} rows)`}
            size="small"
            sx={{ borderLeft: `3px solid ${baseColor}`, flex: 1 }}
            onClick={() => setListOpen(!listOpen)}
          />
        ) : (
          <Typography variant="body2" sx={{ color: 'var(--muted)', flex: 1 }}>
            No table loaded
          </Typography>
        )}
        <IconButton size="small" onClick={triggerFileInput} title="Import file">
          <AddIcon />
        </IconButton>
      </Box>
      
      {/* Expandable table list (shown when multiple tables or list toggled) */}
      <Collapse in={listOpen && ids.length > 0}>
        <List dense sx={{ py: 0 }}>
          {ids.map(id => {
            const t = tables[id];
            const color = getTableColor(id);
            return (
              <ListItem key={id} dense
                secondaryAction={
                  <IconButton edge="end" size="small"
                    onClick={() => handleRemove(id)}
                    title="Remove table"
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemIcon sx={{ minWidth: 20 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
                </ListItemIcon>
                <ListItemText
                  primary={t.name}
                  secondary={`${t.rowCount.toLocaleString()} rows · ${t.cols.length} cols`}
                  onClick={() => handlePreview(id)}
                  sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                />
              </ListItem>
            );
          })}
        </List>
      </Collapse>
      
      {/* Save button */}
      {base && (
        <Button
          variant="contained" size="small" fullWidth
          onClick={saveState}
          sx={{ mt: 0.5, textTransform: 'none', fontSize: '0.82rem' }}
        >
          Save Report Config
        </Button>
      )}
    </Box>
  );
}
```

**Relationship to existing `sidebar.tsx`:** FileBar extracts and consolidates all file management functionality from the existing `sidebar.tsx` (237 lines): the import drop zone (lines 86-96), table list (lines 106-173), table removal (lines 42-56), table preview (lines 58-63), and save button (lines 176-203). The existing `sidebar.tsx` is **replaced** by FileBar — its functionality is fully subsumed. The sidebar collapse toggle (lines 207-234) is handled by PivotSidebar's `collapsed` prop instead.

## ColumnPalette

**File:** `SRC/preact/ui/ColumnPalette.tsx` (~100 lines)

**Responsibilities:**
- Renders draggable MUI Chips for all available columns
- Uses `buildColumnCatalog()` to get the column list with correct prefixing
- Each chip has `draggable={true}` and `onDragStart` that sets the drag data payload
- Groups columns by source table (color-coded by table palette)

**Props:** None (reads state from store)

**Key code:** See Design Decision #8 above.

## PivotToolbar

**File:** `SRC/preact/ui/PivotToolbar.tsx` (~120 lines)

**Responsibilities:**
- Aggregation mode selector (MUI ToggleButtonGroup: None / Group / Totals / Subtotals)
- Filter chip row (MUI Chip per active filter, click to expand inline editor)
- Sort chip row (MUI Chip per active sort, click to expand inline editor)
- Export button (MUI Button with dropdown: Excel / CSV)
- Validation pill (MUI Chip showing healthy/blocked status)

**Props:** None (reads state from store)

**Key code:**
```typescript
export function PivotToolbar() {
  const aggMode = useStore(s => s.aggMode || 'none');
  const filters = useStore(s => s.filters || []);
  const sorts = useStore(s => s.sorts || []);
  const validation = useStore(s => getValidation());
  
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderBottom: '1px solid var(--border)' }}>
      <ToggleButtonGroup
        value={aggMode}
        exclusive
        onChange={(_, v) => v && setAggMode(v)}
        size="small"
      >
        <ToggleButton value="none">Detail</ToggleButton>
        <ToggleButton value="group">Group</ToggleButton>
        <ToggleButton value="totals">Totals</ToggleButton>
        <ToggleButton value="subtotals">Subtotals</ToggleButton>
      </ToggleButtonGroup>
      
      <Box sx={{ flex: 1, display: 'flex', gap: 0.5, overflow: 'auto' }}>
        {filters.map((f, i) => <FilterChip key={i} filter={f} />)}
        {sorts.map((s, i) => <SortChip key={i} sort={s} />)}
      </Box>
      
      <Button variant="contained" size="small" onClick={() => exportAs('xlsx')}>
        Export
      </Button>
      
      <Chip
        label={validation.healthy ? '✓ Valid' : '✗ Blocked'}
        color={validation.healthy ? 'success' : 'error'}
        size="small"
      />
    </Box>
  );
}
```

## DropZoneOverlay

**File:** `SRC/preact/ui/DropZoneOverlay.tsx` (~150 lines)

**Responsibilities:**
- Dynamic portal that mounts on `dragstart` from `ColumnPalette`, unmounts on `drop`/`dragend`/`dragcancel`
- Measures AG Grid header positions once at mount via `getBoundingClientRect()`
- Renders absolutely-positioned overlay divs over each header, split into 3 zones
- Handles `dragover` (visual feedback) and `drop` (zone-specific action)
- Zone detection: top 30% = agg key, middle 50% = add/reorder, bottom 20% = band

**Props:**
- `gridRef: RefObject<AgGridReact>` — reference to the AG Grid instance
- `onDrop: (zone: 'top' | 'middle' | 'bottom', colKey: string, colType: string) => void`

**Key code:**
```typescript
export function DropZoneOverlay({ gridRef, onDrop }: Props) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  
  useEffect(() => {
    // Measure header positions once at mount
    const api = gridRef.current?.api;
    if (!api) return;
    
    const columns = api.getAllGridColumns();
    const headerContainer = document.querySelector('.ag-header-container');
    if (!headerContainer) return;
    
    const measuredZones: Zone[] = columns.map(col => {
      const headerEl = headerContainer.querySelector(`[col-id="${col.getColId()}"]`);
      if (!headerEl) return null;
      const rect = headerEl.getBoundingClientRect();
      const height = rect.height;
      return {
        colId: col.getColId(),
        top: { x: rect.left, y: rect.top, width: rect.width, height: height * 0.3 },
        middle: { x: rect.left, y: rect.top + height * 0.3, width: rect.width, height: height * 0.5 },
        bottom: { x: rect.left, y: rect.top + height * 0.8, width: rect.width, height: height * 0.2 },
      };
    }).filter(Boolean) as Zone[];
    
    setZones(measuredZones);
  }, [gridRef]);
  
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const zone = el?.getAttribute('data-zone');
    setActiveZone(zone);
  };
  
  const handleDrop = (e: DragEvent, zone: 'top' | 'middle' | 'bottom', colId: string) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    onDrop(zone, data.colKey, data.colType);
  };
  
  return createPortal(
    <Box
      sx={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}
      onDragOver={handleDragOver}
    >
      {zones.map(zone => (
        <Fragment key={zone.colId}>
          <Box
            data-zone={`top-${zone.colId}`}
            onDrop={(e) => handleDrop(e, 'top', zone.colId)}
            className={activeZone === `top-${zone.colId}` ? 'zone-top-active' : ''}
            sx={{
              position: 'absolute',
              left: zone.top.x,
              top: zone.top.y,
              width: zone.top.width,
              height: zone.top.height,
              pointerEvents: 'auto',
            }}
          />
          {/* middle and bottom zones similarly */}
        </Fragment>
      ))}
    </Box>,
    document.body
  );
}
```

## AutoPreview

**File:** `SRC/preact/ui/AutoPreview.ts` (~60 lines)

**Responsibilities:**
- Debounce logic (400ms)
- Hash-based dirty check via `JSON.stringify(buildReportSpecFromState())`
- Reentry guard (prevents concurrent `runReport` calls)
- Calls `runReport()` and updates `result` in store

**Exports:**
- `schedulePreview(): void` — called from store subscription
- `resetPreview(): void` — clears debounce timer and hash (called on app reset)

**Key code:** See Design Decision #4 above.

## PivotGrid (modified)

**File:** `SRC/preact/ui/grid.tsx` (modified, ~50 lines added)

**Responsibilities:**
- Wraps `<AgGridReact>` with overlay lifecycle hooks
- Mounts `<DropZoneOverlay>` on `dragstart` from palette, unmounts on drop
- Syncs column reorder from AG Grid's `onColumnMoved` to `colOrder` in AppState
- Reuses existing `createBandRowStyler` for band row tinting
- Reuses existing `ContextMenu` for header right-click menu

**Props:**
- `result: ReportResult | null` — the report result to display
- `onRenameDone: () => void` — callback after column rename

**Key additions:**
```typescript
export function PivotGrid({ result, onRenameDone }: Props) {
  const gridRef = useRef<AgGridReact>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  
  // Mount overlay on palette dragstart
  useEffect(() => {
    const handleDragStart = () => setShowOverlay(true);
    const handleDrop = () => setShowOverlay(false);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);
  
  // Sync column reorder
  const handleColumnMoved = useCallback((e: ColumnMovedEvent) => {
    if (!e.finished) return;
    const api = e.api;
    const colState = api.getColumnState();
    const colOrder = colState.map(c => c.colId);
    getStore().update(draft => { draft.colOrder = colOrder; });
  }, []);
  
  const bandStyler = result ? createBandRowStyler(result.rows) : undefined;
  
  return (
    <Box sx={{ flex: 1, position: 'relative' }}>
      <AgGridReact
        ref={gridRef}
        rowData={result?.rows || []}
        columnDefs={makeResultCols(result, onRenameDone)}
        getRowStyle={bandStyler}
        onColumnMoved={handleColumnMoved}
        className="ag-theme-balham-dark"
      />
      {showOverlay && (
        <DropZoneOverlay
          gridRef={gridRef}
          onDrop={(zone, colKey, colType) => {
            // zone-specific state mutation
            handleDropAction(zone, colKey, colType);
          }}
        />
      )}
    </Box>
  );
}
```

## pivot-layout.css

**File:** `SRC/preact/ui/pivot-layout.css` (~120 lines)

**Responsibilities:**
- Layout styles (sidebar width, main area flex)
- AG Grid theme overrides (balham-dark → MUI dark theme alignment)
- Drop zone overlay styles (zone backgrounds, active states)
- Pipeline section styles (header bars, collapse animation)

**Key code:** See Design Decision #10 above.

---

## DnD Interaction Flow

## End-to-End Flow: Palette Drag → Grid Drop → Store Mutation → Auto-Preview

```
1. User mousedowns on a column chip in ColumnPalette
        │
        ▼
2. dragstart event fires on chip
   - dataTransfer.setData('text/plain', JSON.stringify({ colKey: 'Orders:OrderID', colType: 'raw' }))
   - dataTransfer.effectAllowed = 'move'
        │
        ▼
3. PivotGrid's dragstart listener fires → setShowOverlay(true)
        │
        ▼
4. DropZoneOverlay mounts via createPortal to document.body
   - useEffect measures AG Grid header positions via getBoundingClientRect()
   - Renders absolutely-positioned overlay divs for each header (3 zones per header)
        │
        ▼
5. User drags cursor over a grid header
        │
        ▼
6. dragover event fires on overlay div
   - elementFromPoint(e.clientX, e.clientY) → overlay div with data-zone attribute
   - setActiveZone(zone) → CSS class applied (e.g., .zone-middle-active)
   - Visual feedback: middle zone background tints blue
        │
        ▼
7. User releases mouse (drop event)
   - handleDrop(e, 'middle', 'Orders:OrderID') called
   - JSON.parse(e.dataTransfer.getData('text/plain')) → { colKey, colType }
   - onDrop('middle', 'Orders:OrderID', 'raw') called
        │
        ▼
8. handleDropAction in PivotGrid:
   - zone === 'middle' → add column to selCols and colOrder
   - store.update(draft => {
       if (!draft.selCols.has('Orders:OrderID')) {
         draft.selCols.add('Orders:OrderID');
         draft.colOrder.push('Orders:OrderID');
       }
     })
        │
        ▼
9. Store notifies all subscribers (synchronous)
   - ColumnPalette re-renders (chip may disappear if it's now in selCols)
   - PivotToolbar re-renders (validation updates)
   - AutoPreview.schedulePreview() is called
        │
        ▼
10. AutoPreview.schedulePreview():
    - clearTimeout(_debounceTimer) — cancel any pending preview
    - buildReportSpecFromState(state) → spec
    - JSON.stringify(spec) → hash
    - hash !== _lastHash → proceed
    - _debounceTimer = setTimeout(() => { ... }, 400)
        │
        ▼
11. 400ms later, timeout fires:
    - _running = true (reentry guard)
    - runReport(spec, state.tables) → result
    - store.set('result', result)
    - _running = false
        │
        ▼
12. Store notifies all subscribers:
    - PivotGrid re-renders with new rowData via <AgGridReact rowData={result.rows} />
    - AG Grid updates DOM (virtual scrolling, only visible rows rendered)
        │
        ▼
13. DropZoneOverlay unmounts (showOverlay = false after drop event)
        │
        ▼
14. User sees updated grid with new column added
    - Total latency: ~5ms (drag) + 400ms (debounce) + 100-500ms (runReport) + 50-200ms (AG Grid update)
    - Total: ~555-1105ms from mousedown to visible grid update
```

## Zone-Specific Actions

### Top Zone (Agg Key)

**Precondition:** `aggMode` is 'group', 'totals', or 'subtotals' (not 'none')

**Action:**
```typescript
store.update(draft => {
  if (!draft.groupBy.includes(colKey)) {
    draft.groupBy.push(colKey);
  }
});
```

**Visual feedback:** Top zone background tints green during dragover.

### Middle Zone (Add/Reorder)

**Precondition:** None (always active)

**Action:**
```typescript
store.update(draft => {
  if (!draft.selCols.has(colKey)) {
    draft.selCols.add(colKey);
    draft.colOrder.push(colKey);
  }
  // If already in selCols, no-op (AG Grid handles reorder natively)
});
```

**Visual feedback:** Middle zone background tints blue during dragover.

### Bottom Zone (Detail Band)

**Precondition:** `aggMode` is 'group' (bands only work in group mode)

**Action:**
```typescript
store.update(draft => {
  // Add column as band key pair (simplified — actual implementation is more complex)
  if (!draft.detailBands) draft.detailBands = [];
  const band = draft.detailBands.find(b => b.parentCol === parentCol);
  if (!band) {
    draft.detailBands.push({ parentCol, bandCols: [colKey] });
  } else if (!band.bandCols.includes(colKey)) {
    band.bandCols.push(colKey);
  }
});
```

**Visual feedback:** Bottom zone background tints orange during dragover.

## Error Handling

- **Invalid drop zone:** If user drops on a zone that's disabled (e.g., top zone in 'none' agg mode), the drop is ignored. No state mutation.
- **Duplicate column:** If user drops a column that's already in `selCols` on the middle zone, no-op. AG Grid handles reorder natively.
- **runReport failure:** If `runReport()` throws (e.g., invalid SQL), the error is caught and displayed in the validation pill. The grid shows the last successful result.

---

## Auto-Preview Flow

## Sequence Diagram (Text)

```
Store Mutation
      │
      ▼
store.update(draft => { ... })
      │
      ├──────────────────────────────────────────────────────┐
      │                                                      │
      ▼                                                      ▼
Store notifies all subscribers                    AutoPreview.schedulePreview()
      │                                                      │
      ├── PivotSidebar re-renders                            ▼
      │   (column palette updates)                   clearTimeout(_debounceTimer)
      │                                                      │
      ├── PivotToolbar re-renders                            ▼
      │   (validation updates)                       buildReportSpecFromState(state)
      │                                                      │
      └── PivotGrid re-renders                               ▼
          (if result changed)                        JSON.stringify(spec) → hash
                                                             │
                                                             ▼
                                                     hash === _lastHash?
                                                             │
                                                    ┌────────┴────────┐
                                                   YES               NO
                                                    │                 │
                                                    ▼                 ▼
                                                return          _debounceTimer = setTimeout(...)
                                                                (400ms debounce)
                                                                         │
                                                                         ▼
                                                                (400ms later)
                                                                         │
                                                                         ▼
                                                                 _running === true?
                                                                         │
                                                                ┌────────┴────────┐
                                                               YES               NO
                                                                │                 │
                                                                ▼                 ▼
                                                            return          _running = true
                                                                            │
                                                                            ▼
                                                                    runReport(spec, tables)
                                                                            │
                                                                   ┌────────┴────────┐
                                                                SUCCESS             ERROR
                                                                 │                   │
                                                                 ▼                   ▼
                                                        store.set('result',   store.set('validationError',
                                                         result)               err.message)
                                                                 │                   │
                                                                 ▼                   ▼
                                                        _lastHash = hash      (grid shows last
                                                                 │              successful result)
                                                                 ▼                   │
                                                        _running = false            │
                                                                 │                  │
                                                                 └──────────────────┘
                                                                         │
                                                                         ▼
                                                                 Store notifies subscribers
                                                                         │
                                                                         ▼
                                                                 PivotGrid re-renders
                                                                 with new rowData
```

## Hash Scope

The hash covers all report-affecting state:

```typescript
const spec = buildReportSpecFromState(state);
// spec = {
//   base: string,
//   baseCols: string[],
//   stacks: StackSpec[],
//   lookups: LookupSpec[],
//   calcStages: CalcStage[],
//   detailBands: DetailBandSpec[],
//   filters: FilterSpec[],
//   sorts: SortSpec[],
//   aggregation: AggregationSpec,
//   mergeDisplay: MergeDisplaySpec,
// }

const hash = JSON.stringify(spec);
```

**Excluded from hash:**
- `_ui.sidebarCollapsed` — UI-only, doesn't affect report
- `_ui.columnWidths` — UI-only, doesn't affect report
- `_ui.previewDirty` — transient flag
- `_ui.lastResultHash` — transient flag
- `tables` — source data, doesn't change during report building (only on file load)
- `activeTab` — UI-only (and irrelevant in pivot layout — no tabs)

## Reentry Guard

**Problem:** If a state mutation occurs while `runReport()` is executing (e.g., user drags another column during the 100-500ms execution), the mutation triggers another `schedulePreview()` call. Without a guard, this could lead to concurrent `runReport()` calls or infinite loops.

**Solution:** `_running` flag set before `runReport()`, cleared after. If `schedulePreview()` is called while `_running === true`, it returns immediately without scheduling a new preview. The next mutation after `runReport()` completes will trigger a new preview.

**Edge case:** If the user makes 5 rapid mutations during a single `runReport()` execution, only the last mutation's preview will run after the current execution completes. This is acceptable — the user sees the final state, not intermediate states.

## Grid Flash Prevention

**Problem:** When `runReport()` is executing (100-500ms), the grid could clear and show an empty state, then re-render with new data. This causes a visual "flash" that's jarring.

**Solution:** Maintain previous `rowData` until new data arrives. Conditional render:

```typescript
<AgGridReact
  rowData={result?.rows || previousRows || []}
  ...
/>
```

Where `previousRows` is stored in a ref:

```typescript
const previousRowsRef = useRef<Record<string, unknown>[]>([]);

useEffect(() => {
  if (result?.rows) {
    previousRowsRef.current = result.rows;
  }
}, [result]);
```

This ensures the grid always has data to display, even during the debounce + execution window.

---

## State Management

## _ui Field in AppState

**Purpose:** Store UI-only state that doesn't affect the report spec but should persist across sessions (e.g., column widths, sidebar collapse state).

**Schema:**
```typescript
interface AppState {
  // ... all existing fields unchanged ...
  _ui?: {
    sidebarCollapsed?: boolean;      // default: false
    columnWidths?: Record<string, number>;  // default: {}
    previewDirty?: boolean;          // transient, reset on load
    lastResultHash?: string;         // transient, reset on load
  };
}
```

**Serialization:**
- `_ui` is included in `saveState()` / `loadState()` serialization
- `columnWidths` persists across sessions (user's column width preferences)
- `sidebarCollapsed` persists across sessions
- `previewDirty` and `lastResultHash` are transient — reset to defaults on load:

```typescript
// In state-serializer.ts loadState():
if (state._ui) {
  state._ui.previewDirty = false;
  state._ui.lastResultHash = undefined;
}
```

**Backward compatibility:** Existing `.rcjson` files without `_ui` load without modification. The field is optional.

## New Selectors

**Sidebar collapsed state:**
```typescript
const sidebarCollapsed = useStore(s => s._ui?.sidebarCollapsed ?? false);
```

**Column widths:**
```typescript
const columnWidths = useStore(s => s._ui?.columnWidths ?? {});

// Usage in PivotGrid:
const width = columnWidths[alias] ?? 150; // default 150px
```

**Preview dirty flag (transient):**
```typescript
const previewDirty = useStore(s => s._ui?.previewDirty ?? false);
```

This flag is set to `true` when a state mutation occurs, and reset to `false` after `runReport()` completes. It can be used to show a loading indicator in the toolbar (e.g., a spinner next to the validation pill).

## State Mutations for _ui

**Sidebar collapse:**
```typescript
store.update(draft => {
  draft._ui = draft._ui || {};
  draft._ui.sidebarCollapsed = !draft._ui.sidebarCollapsed;
});
```

**Column width:**
```typescript
store.update(draft => {
  draft._ui = draft._ui || {};
  draft._ui.columnWidths = draft._ui.columnWidths || {};
  draft._ui.columnWidths[alias] = newWidth;
});
```

**Preview dirty:**
```typescript
// Set when state mutation occurs (in store.subscribe callback):
store.update(draft => {
  draft._ui = draft._ui || {};
  draft._ui.previewDirty = true;
});

// Reset after runReport completes:
store.update(draft => {
  draft._ui = draft._ui || {};
  draft._ui.previewDirty = false;
});
```

## Why _ui Instead of Separate State?

**Alternative rejected:** Separate state management for UI-only state (e.g., Zustand store, React context).

**Rationale for _ui:**
1. **Serialization simplicity:** `_ui` is serialized with the rest of AppState. No separate persistence mechanism needed.
2. **Single source of truth:** All state (report config + UI state) lives in one object. No synchronization logic.
3. **Consistency with existing patterns:** `aggModeState` is already UI-only state stored in AppState. `_ui` follows the same pattern.
4. **Backward compatibility:** Optional field, doesn't break existing `.rcjson` files.

**Tradeoff:** `_ui` changes trigger store notifications, which could cause unnecessary re-renders. Mitigated by selector-based subscriptions (components only re-render if their selected slice changes).

---

## AG Grid Theme & Styling

## Theme: ag-theme-balham-dark

**Rationale:** AG Grid's balham-dark theme provides a dark background, light text, and subtle borders — matching MUI's dark theme aesthetic. The theme is already applied in `grid.tsx` via the `className="ag-theme-balham-dark"` attribute on `<AgGridReact>`.

## CSS Variable Overrides

**Purpose:** Align AG Grid's colors with MUI's palette. MUI uses CSS variables for theming (e.g., `var(--bg)`, `var(--text)`, `var(--border)`). AG Grid uses its own CSS variables (e.g., `--ag-background-color`, `--ag-foreground-color`). We override AG Grid's variables to reference MUI's.

**Implementation:**
```css
/* pivot-layout.css */
.ag-theme-balham-dark {
  /* Background colors */
  --ag-background-color: var(--bg);
  --ag-header-background-color: var(--bg2);
  --ag-odd-row-background-color: var(--bg);
  --ag-row-hover-color: var(--bg3);
  --ag-selected-row-background-color: var(--bg3);
  
  /* Border colors */
  --ag-border-color: var(--border);
  --ag-row-border-color: var(--border);
  --ag-header-border-color: var(--border);
  
  /* Text colors */
  --ag-header-foreground-color: var(--text);
  --ag-foreground-color: var(--text);
  --ag-secondary-foreground-color: var(--muted);
  
  /* Font */
  --ag-font-family: var(--font-family);
  --ag-font-size: 13px;
  
  /* Dimensions */
  --ag-header-height: 32px;
  --ag-row-height: 32px;
  --ag-cell-horizontal-padding: 8px;
  
  /* Accent colors */
  --ag-accent-color: var(--accent);
  --ag-checkbox-checked-color: var(--accent);
}
```

## Drop Zone Overlay Styles

**Purpose:** Visual feedback during drag-and-drop. Each zone (top/middle/bottom) has a distinct color when active.

**Implementation:**
```css
/* pivot-layout.css */

/* Top zone (agg key) — green tint */
.zone-top-active {
  background-color: rgba(76, 175, 80, 0.3); /* MUI green[500] at 30% opacity */
  border-top: 2px solid #4caf50;
}

/* Middle zone (add/reorder) — blue tint */
.zone-middle-active {
  background-color: rgba(33, 150, 243, 0.3); /* MUI blue[500] at 30% opacity */
  border-left: 2px solid #2196f3;
  border-right: 2px solid #2196f3;
}

/* Bottom zone (band) — orange tint */
.zone-bottom-active {
  background-color: rgba(255, 152, 0, 0.3); /* MUI orange[500] at 30% opacity */
  border-bottom: 2px solid #ff9800;
}

/* Zone hover effect */
[data-zone]:hover {
  background-color: rgba(255, 255, 255, 0.05);
}
```

## Pipeline Section Styles

**Purpose:** Slim header bars (28px) for pipeline sections in the sidebar. MUI Accordion has 48px headers, which wastes vertical space.

**Implementation:**
```css
/* pivot-layout.css */

.pipeline-section-header {
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
}

.pipeline-section-header:hover {
  background-color: var(--bg3);
}

.pipeline-section-header .MuiTypography-root {
  flex: 1;
  font-size: 0.875rem;
  font-weight: 500;
}

.pipeline-section-content {
  padding: 8px;
}
```

## Layout Styles

**Purpose:** Sidebar + main area layout.

**Implementation:**
```css
/* pivot-layout.css */

.pivot-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.pivot-sidebar {
  width: 270px;
  border-right: 1px solid var(--border);
  overflow: auto;
  flex-shrink: 0;
}

.pivot-sidebar.collapsed {
  width: 0;
  border-right: none;
}

.pivot-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pivot-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.pivot-grid-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}
```

## Band Row Tint Colors

**Purpose:** Tinted backgrounds for band rows. Already defined in `grid.tsx` as `BAND_ROW_TINTS` array.

**Implementation:**
```typescript
// grid.tsx (existing)
const BAND_ROW_TINTS = [
  'rgba(33, 150, 243, 0.08)',  // blue
  'rgba(76, 175, 80, 0.08)',   // green
  'rgba(255, 152, 0, 0.08)',   // orange
  'rgba(156, 39, 176, 0.08)',  // purple
  'rgba(255, 87, 34, 0.08)',   // deep orange
];
```

These colors are applied via `getRowStyle` callback in `<AgGridReact>`. No CSS changes needed.

## Totals Row Styling

**Purpose:** Visual distinction for the totals row (appended to rowData).

**Implementation:**
```typescript
// In PivotGrid's getRowStyle callback:
const getRowStyle = (params: RowClassParams): RowStyle | undefined => {
  const data = params.data;
  if (!data) return undefined;
  
  // Totals row
  if (data._row_type === 'totals') {
    return {
      fontWeight: 'bold',
      backgroundColor: 'var(--bg2)',
      borderTop: '2px solid var(--border)',
    };
  }
  
  // Subtotal rows
  if (data._row_type === 'subtotal') {
    return {
      fontWeight: 500,
      backgroundColor: 'var(--bg3)',
    };
  }
  
  // Band rows (existing createBandRowStyler)
  return bandStyler?.(params);
};
```

---

## Implementation Phases

## Phase 1: Foundation (4 hours)

**Goal:** PivotLayout component tree, remove 3-tab shell, sidebar + main layout.

**Tasks:**
1. Create `PivotLayout.tsx` — root layout component (sidebar + main)
2. Create `PivotSidebar.tsx` — sidebar shell (270px, collapsible)
3. Create `FileBar.tsx` — file management bar (table import, table list, save)
4. Create `PivotToolbar.tsx` — toolbar row (agg mode, export, validation)
5. Modify `app.tsx` — replace 3-tab shell with `<PivotLayout>`
6. Create `pivot-layout.css` — layout styles (sidebar width, main flex)
7. Delete `tabs.ts` — tab switching eliminated
8. Run typecheck + lint + tests

**Dependencies:** None (foundation for all other phases)

**Deliverables:**
- Single-screen layout renders (sidebar with file bar + toolbar + empty grid area)
- 3-tab shell removed
- FileBar shows table list and import button
- All existing functionality still works (pipeline cards, layout card, filter/sort card still render in sidebar)

## Phase 2: Column Palette (3 hours)

**Goal:** ColumnPalette MUI Chips with buildColumnCatalog, HTML5 draggable.

**Tasks:**
1. Create `ColumnPalette.tsx` — draggable column chips
2. Use `buildColumnCatalog()` to get column list with correct prefixing
3. Each chip has `draggable={true}` and `onDragStart` that sets drag data payload
4. Group chips by source table (color-coded by table palette)
5. Integrate into `PivotSidebar.tsx` (render at top of sidebar)
6. Write unit tests for column palette rendering
7. Run typecheck + lint + tests

**Dependencies:** Phase 1 (PivotSidebar must exist)

**Deliverables:**
- Column palette renders in sidebar with all available columns
- Chips are draggable (dragstart event fires, data payload set)
- Chips are color-coded by source table

## Phase 3: Drop Zone Overlay (6 hours)

**Goal:** DropZoneOverlay dynamic portal, 3-zone detection, visual feedback.

**Tasks:**
1. Create `DropZoneOverlay.tsx` — dynamic portal with 3-zone drop detection
2. Mount overlay on `dragstart` from palette, unmount on `drop`/`dragend`/`dragcancel`
3. Measure AG Grid header positions via `getBoundingClientRect()` at mount
4. Render absolutely-positioned overlay divs for each header (3 zones per header)
5. Handle `dragover` (visual feedback) and `drop` (zone-specific action)
6. Implement zone detection: top 30% / middle 50% / bottom 20%
7. Add CSS styles for zone active states (green/blue/orange tints)
8. Integrate into `PivotGrid` (mount overlay on dragstart, handle drop actions)
9. Write unit tests for zone detection logic
10. Run typecheck + lint + tests

**Dependencies:** Phase 2 (palette must emit dragstart events)

**Deliverables:**
- Overlay renders during drag (portal to document.body)
- 3 zones per header (top/middle/bottom)
- Visual feedback during dragover (zone tints)
- Drop actions work (add column, set agg key, assign band)

## Phase 4: Sidebar Pipeline Sections (3 hours)

**Goal:** MUI Collapse wrapping existing stage components.

**Tasks:**
1. Create `PipelineSection` component — MUI Collapse + custom header bar (28px)
2. Wrap existing stage components in `PipelineSection`:
   - `<BaseStage />` (default open)
   - `<StackSheets />`
   - `<LookupStage />`
   - `<CalcStage />`
   - `<DetailBandStage />`
3. Integrate into `PivotSidebar.tsx` (render below column palette)
4. Add CSS styles for pipeline section headers
5. Run typecheck + lint + tests

**Dependencies:** Phase 1 (PivotSidebar must exist)

**Deliverables:**
- Pipeline stages render in collapsible sections
- Sections expand/collapse smoothly (MUI Collapse animation)
- All existing stage functionality works (base table selection, lookup config, etc.)

## Phase 5: Toolbar + Filter/Sort (4 hours)

**Goal:** AggMode, Export, Validation, filter/sort chip row with inline editor.

**Tasks:**
1. Implement agg mode selector in `PivotToolbar.tsx` (MUI ToggleButtonGroup)
2. Implement export button (MUI Button with dropdown: Excel / CSV)
3. Implement validation pill (MUI Chip showing healthy/blocked status)
4. Implement filter chip row (MUI Chip per active filter, click to expand inline editor)
5. Implement sort chip row (MUI Chip per active sort, click to expand inline editor)
6. Inline editor reuses existing filter/sort editing UI from `filter-list.tsx` / `sort-list.tsx`
7. Chip close button removes filter/sort
8. Horizontal scroll overflow for chip row
9. Run typecheck + lint + tests

**Dependencies:** Phase 1 (PivotToolbar must exist)

**Deliverables:**
- Agg mode selector works (switches between None/Group/Totals/Subtotals)
- Export button works (Excel/CSV export)
- Validation pill shows healthy/blocked status
- Filter/sort chips render in toolbar
- Click chip → inline editor expands
- Close button removes filter/sort

## Phase 6: Auto-Preview (4 hours)

**Goal:** 400ms debounce, hash dirty check, runReport, reentry guard.

**Tasks:**
1. Create `AutoPreview.ts` — debounce + hash logic
2. Implement `schedulePreview()` function (400ms debounce, hash check, runReport)
3. Implement reentry guard (_running flag)
4. Mount auto-preview subscription in `PivotLayout.tsx` (on mount)
5. Implement grid flash prevention (maintain previous rowData)
6. Write unit tests for debounce logic and hash comparison
7. Run typecheck + lint + tests

**Dependencies:** Phase 3 (drop zones must work — auto-preview triggers on drop)

**Deliverables:**
- Auto-preview triggers on every state change (400ms debounce)
- Hash-based dirty check prevents redundant execution
- Grid updates automatically after state changes
- No manual "Run Report" button needed

## Phase 7: Column Reorder Sync (2 hours)

**Goal:** onColumnMoved → colOrder sync with reentry guard.

**Tasks:**
1. Add `onColumnMoved` callback to `<AgGridReact>` in `PivotGrid`
2. Sync column reorder from AG Grid to `colOrder` in AppState
3. Implement reentry guard (prevent infinite loop: reorder → state change → re-preview → reorder)
4. Write unit tests for column reorder sync
5. Run typecheck + lint + tests

**Dependencies:** Phase 3 (drop zones must work — middle zone adds columns)

**Deliverables:**
- Column reorder in AG Grid syncs to `colOrder` in AppState
- No infinite loop (reentry guard prevents re-trigger)

## Phase 8: Cleanup & Polish (3 hours)

**Goal:** Empty states, loading, edge cases, theme overrides.

**Tasks:**
1. Implement empty state for grid (when no tables loaded)
2. Implement loading state for grid (during runReport execution)
3. Add AG Grid theme overrides (balham-dark → MUI dark theme alignment)
4. Handle edge cases:
   - Drop on disabled zone (e.g., top zone in 'none' agg mode) → ignore
   - Drop duplicate column (already in selCols) → no-op
   - runReport failure → display error in validation pill
5. Delete old files:
    - `cards/pipeline-card.tsx` (merged into sidebar)
    - `cards/layout-card.tsx` (merged into toolbar + palette)
    - `cards/filter-sort-card.tsx` (merged into toolbar)
    - `sections/column-chips.tsx` (replaced by `ColumnPalette.tsx` — ColumnPalette uses `buildColumnCatalog()` instead of `buildColSourceMap()`, and drops the double-click visibility toggle and right-click rename context menu in favor of DnD-only interaction; rename is handled via grid header context menu in PivotGrid)
    - `sections/run-bar.tsx` (removed — auto-preview eliminates the manual "Run Report" button; the validation status pill from run-bar is subsumed by PivotToolbar's validation pill Chip)
    - `tabs.ts` (tab switching eliminated)
    - `sidebar.tsx` (replaced by `FileBar.tsx` inside `PivotSidebar` — all file management functionality is subsumed; sidebar collapse toggle is handled by PivotSidebar's `collapsed` prop)
6. Run typecheck + lint + tests
7. Manual testing: load 10K row dataset, verify scroll smoothness

**Dependencies:** All previous phases

**Deliverables:**
- Empty state renders when no tables loaded
- Loading state renders during runReport execution
- AG Grid theme matches MUI dark theme
- Edge cases handled gracefully
- Old card components, column-chips, run-bar, and sidebar deleted
- All functionality works end-to-end

## Phase Dependency Graph

```
Phase 1 (Foundation)
    │
    ├── Phase 2 (Column Palette)
    │       │
    │       └── Phase 3 (Drop Zone Overlay)
    │               │
    │               ├── Phase 6 (Auto-Preview)
    │               │
    │               └── Phase 7 (Column Reorder Sync)
    │
    ├── Phase 4 (Sidebar Pipeline Sections)
    │
    └── Phase 5 (Toolbar + Filter/Sort)
            │
            └── Phase 8 (Cleanup & Polish)
```

**Total estimated effort:** 29 hours (~4 work days)

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| **AG Grid swallows drag events on header components** | High | Overlay approach already avoids this — overlays are outside AG Grid's DOM. Overlay divs capture drag events, not AG Grid headers. Tested in Phase 3. |
| **Auto-preview infinite loop (reorder sync → state change → re-preview → ...)** | High | Hash comparison prevents re-trigger if same spec. Reentry guard (_running flag) prevents execution during preview. Tested in Phase 6. |
| **Drop zones too narrow (14-28px headers split into 3 zones)** | Medium | Horizontal gesture alternative: left edge = agg key, center = add/reorder, right edge = band. Implemented as fallback in Phase 3 if vertical zones are unreliable. |
| **Removed cards break imports** | Low | Check imports before deletion in Phase 8. Tests import components by path, not barrel. Run typecheck after deletion to catch broken imports. |
| **buildColumnCatalog() doesn't handle all column types** | Medium | Verify that `buildColumnCatalog()` correctly prefixes band columns and handles calculated columns. Test in Phase 2 with a report that has bands and calcs. |
| **AG Grid column reorder doesn't sync with colOrder** | Medium | Implement `onColumnMoved` callback in Phase 7. Test with manual column drag in AG Grid. Verify `colOrder` updates in AppState. |
| **Auto-preview performance (runReport takes >500ms)** | Low | 400ms debounce + 100-500ms execution = 500-900ms total latency. Acceptable for interactive use. If latency exceeds 1s, consider optimizing `runReport()` or increasing debounce to 600ms. |
| **Drop zone overlay doesn't unmount on drag cancel** | Low | Add `dragcancel` event listener in addition to `drop` and `dragend`. Test in Phase 3 by pressing Escape during drag. |
| **MUI Collapse animation conflicts with sidebar scroll** | Low | Test in Phase 4. If animation causes scroll jitter, disable animation (`timeout={0}`) or use CSS transitions instead. |
| **Filter/sort inline editor is too complex for toolbar** | Low | If inline editor is too wide/complex, fall back to MUI Dialog (like calc editor). Test in Phase 5. |
| **_ui field breaks backward compatibility with old .rcjson files** | Low | `_ui` is optional. Existing files without `_ui` load without modification. Test in Phase 1 by loading an old `.rcjson` file. |
| **Column palette doesn't update when pipeline changes** | Low | Palette uses `buildColumnCatalog()` which reads from AppState. When pipeline changes (e.g., new lookup added), palette re-renders automatically via `useStore` subscription. Test in Phase 2. |
| **AG Grid theme overrides don't apply** | Low | Verify CSS variable names match AG Grid's expected variables. Test in Phase 8 by inspecting AG Grid in browser devtools. |

---

## Effort Estimate

## Overall Size: LARGE

**Confidence:** High (based on Architect's analysis and similar UI redesigns in the codebase)

## File Count

**New source files:** 8
- `PivotLayout.tsx` (~80 lines)
- `PivotSidebar.tsx` (~70 lines)
- `FileBar.tsx` (~120 lines)
- `ColumnPalette.tsx` (~100 lines)
- `PivotToolbar.tsx` (~120 lines)
- `DropZoneOverlay.tsx` (~150 lines)
- `AutoPreview.ts` (~60 lines)
- `pivot-layout.css` (~120 lines)

**Modified source files:** 2
- `app.tsx` (replace 3-tab shell with PivotLayout, ~20 lines changed)
- `grid.tsx` (add overlay lifecycle + column reorder sync, ~50 lines added)

**Deleted source files:** 7
- `cards/pipeline-card.tsx` (~200 lines)
- `cards/layout-card.tsx` (~150 lines)
- `cards/filter-sort-card.tsx` (~100 lines)
- `sections/column-chips.tsx` (~300 lines) — replaced by ColumnPalette.tsx
- `sections/run-bar.tsx` (~162 lines) — removed (auto-preview replaces Run button)
- `sidebar.tsx` (~237 lines) — replaced by FileBar.tsx
- `tabs.ts` (~30 lines)

**New test files:** 6
- `pivot-layout.test.tsx` (~80 lines)
- `column-palette.test.tsx` (~80 lines)
- `drop-zone-overlay.test.tsx` (~100 lines)
- `auto-preview.test.ts` (~60 lines)
- `pivot-toolbar.test.tsx` (~80 lines)
- `column-reorder-sync.test.tsx` (~60 lines)

**Total:** ~14 source files + ~6 test files

## Line Count

**New code:** ~870 lines
- Components: ~620 lines (includes FileBar ~120 lines)
- CSS: ~120 lines
- Logic (AutoPreview): ~60 lines
- Tests: ~460 lines

**Modified code:** ~70 lines
- app.tsx: ~20 lines
- grid.tsx: ~50 lines

**Deleted code:** ~1179 lines
- cards/pipeline-card.tsx: ~200 lines
- cards/layout-card.tsx: ~150 lines
- cards/filter-sort-card.tsx: ~100 lines
- sections/column-chips.tsx: ~300 lines
- sections/run-bar.tsx: ~162 lines
- sidebar.tsx: ~237 lines
- tabs.ts: ~30 lines

**Net change:** −239 lines (870 new - 1179 deleted + 70 modified)

## Effort Breakdown by Phase

| Phase | Estimated Hours | Complexity |
|-------|----------------|------------|
| Phase 1: Foundation | 4 | Low |
| Phase 2: Column Palette | 3 | Low |
| Phase 3: Drop Zone Overlay | 6 | **High** |
| Phase 4: Sidebar Pipeline Sections | 3 | Low |
| Phase 5: Toolbar + Filter/Sort | 4 | Medium |
| Phase 6: Auto-Preview | 4 | Medium |
| Phase 7: Column Reorder Sync | 2 | Low |
| Phase 8: Cleanup & Polish | 3 | Low |
| **Total** | **29 hours** | — |

**Phase 3 (Drop Zone Overlay) is the highest-risk phase** — it involves dynamic portals, AG Grid header measurement, 3-zone detection, and visual feedback. Allocate extra time for debugging.

## Complexity Drivers

1. **Drop zone overlay** — Dynamic portal, AG Grid header measurement, 3-zone detection, visual feedback. Highest complexity.
2. **Auto-preview** — Debounce, hash check, reentry guard, grid flash prevention. Medium complexity.
3. **Filter/sort inline editor** — Inline expansion, chip close, horizontal scroll. Medium complexity.
4. **Column reorder sync** — AG Grid `onColumnMoved` callback, reentry guard. Low complexity.
5. **Pipeline sections** — MUI Collapse, custom header bars. Low complexity.

## Risk-Adjusted Estimate

**Optimistic:** 24 hours (if drop zones and auto-preview work smoothly)
**Realistic:** 29 hours (based on phase breakdown)
**Pessimistic:** 40 hours (if drop zones require horizontal gesture fallback, auto-preview has edge cases)

**Recommendation:** Plan for 29 hours. If Phase 3 takes longer than 8 hours, switch to horizontal gesture fallback to save time.

---

## Open Questions

## 1. Horizontal vs Vertical Zone Detection

**Question:** Should drop zones use vertical split (top 30% / middle 50% / bottom 20%) or horizontal split (left edge / center / right edge)?

**Context:** AG Grid headers are 32px tall. Splitting vertically gives zones of ~10px / ~16px / ~6px. The top and bottom zones may be too narrow for reliable drop detection. Horizontal split (left 30% / center 40% / right 30%) gives wider zones (~45px / ~60px / ~45px for a 150px-wide column).

**Decision needed:** Test vertical zones in Phase 3. If users report difficulty hitting top/bottom zones, switch to horizontal zones. The overlay implementation should support both modes (configurable via prop).

**Recommendation:** Start with vertical zones. If usability testing shows >10% miss rate on top/bottom zones, switch to horizontal.

## 2. Filter/Sort Inline Editor Width

**Question:** How wide should the inline editor be when a filter/sort chip is clicked?

**Context:** The toolbar is ~800px wide (assuming 1920px viewport - 270px sidebar - margins). If the inline editor is too wide, it overlaps the grid. If too narrow, the filter/sort form controls are cramped.

**Options:**
- **Full-width toolbar:** Editor expands below the entire toolbar row. Simple, but may obscure the grid.
- **Fixed-width panel (400px):** Editor expands below the chip row, centered. Doesn't obscure grid, but may not fit all form controls.
- **MUI Dialog:** Fall back to a modal dialog (like calc editor). Maximum space, but loses context.

**Decision needed:** Test in Phase 5. If inline editor is too complex for toolbar, switch to Dialog.

**Recommendation:** Start with fixed-width panel (400px). If form controls don't fit, switch to Dialog.

## 3. Column Palette Grouping

**Question:** Should the column palette group columns by source table, or show a flat list?

**Context:** `buildColumnCatalog()` returns a flat list of columns with source metadata. Grouping by table makes it easier to find columns from a specific table, but adds visual complexity.

**Options:**
- **Flat list:** All columns in a single row, color-coded by table. Simple, but hard to find columns in large reports (50+ columns).
- **Grouped by table:** Columns grouped under table name headers. Easier to find columns, but takes more vertical space.
- **Searchable palette:** Add a search box to filter columns by name. Helps with large reports, but adds complexity.

**Decision needed:** Test in Phase 2 with a report that has 3+ tables and 50+ columns. If flat list is unusable, switch to grouped.

**Recommendation:** Start with flat list (color-coded by table). If usability testing shows difficulty finding columns, add grouping or search.

## 4. Sidebar Collapse Behavior

**Question:** When the sidebar is collapsed, should it disappear entirely, or collapse to a narrow icon bar?

**Context:** The sidebar is 270px wide. Collapsing it frees up space for the grid, but loses access to the column palette and pipeline stages.

**Options:**
- **Disappear entirely:** Sidebar width goes to 0. Grid expands to fill space. User must toggle sidebar to access palette/pipeline.
- **Icon bar (40px):** Sidebar collapses to a narrow bar with icons for each section. User can click icons to expand sections or toggle full sidebar.

**Decision needed:** Test in Phase 1. If icon bar is too complex, stick with disappear/expand toggle.

**Recommendation:** Start with disappear/expand toggle. If users report difficulty accessing palette, add icon bar in Phase 8.

## 5. Auto-Preview Debounce Timing

**Question:** Is 400ms the right debounce timing?

**Context:** 400ms is a balance between responsiveness (user sees results quickly) and performance (avoid excessive `runReport` calls). If the user makes rapid changes (e.g., dragging 5 columns in 2 seconds), we want to batch them into a single preview.

**Options:**
- **200ms:** More responsive, but more `runReport` calls. May cause performance issues with large reports.
- **400ms:** Balanced. User perceives results as "instant" (<500ms total latency).
- **600ms:** Less responsive, but fewer `runReport` calls. Better for large reports.

**Decision needed:** Test in Phase 6 with a large report (10K+ rows, 5+ lookups). If 400ms causes performance issues, increase to 600ms.

**Recommendation:** Start with 400ms. If performance testing shows >1s total latency, increase to 600ms.

## 6. Drop Zone Visual Feedback Intensity

**Question:** How prominent should the drop zone visual feedback be?

**Context:** During dragover, the active zone should be visually distinct. But if the feedback is too prominent (e.g., bright colors, thick borders), it may be distracting or ugly.

**Options:**
- **Subtle (10% opacity tint):** Zone background tints at 10% opacity. Minimal visual impact, but may be hard to see.
- **Moderate (30% opacity tint):** Zone background tints at 30% opacity. Clear visual feedback, not distracting.
- **Prominent (50% opacity tint + border):** Zone background tints at 50% opacity + 2px border. Very clear, but may be ugly.

**Decision needed:** Test in Phase 3. Get user feedback on visual preference.

**Recommendation:** Start with moderate (30% opacity tint). If users report difficulty seeing feedback, increase to prominent.

## 7. Keyboard Navigation

**Question:** Should the pivot layout support keyboard navigation (e.g., Tab to move between sidebar/toolbar/grid, Arrow keys to navigate grid cells)?

**Context:** AG Grid supports keyboard navigation out of the box (arrow keys, Enter to edit, etc.). But the sidebar and toolbar don't have keyboard navigation. Adding full keyboard support is complex.

**Options:**
- **No keyboard navigation:** Defer to follow-up. Users can use mouse for all interactions.
- **Basic keyboard navigation:** Tab key moves focus between sidebar/toolbar/grid. Arrow keys navigate grid cells (AG Grid built-in).
- **Full keyboard navigation:** All interactions (drag-and-drop, filter/sort editing, pipeline config) work via keyboard. Complex to implement.

**Decision needed:** Defer to follow-up. Keyboard navigation is not critical for initial release.

**Recommendation:** Defer. Add basic keyboard navigation (Tab between regions) in Phase 8 if time permits.

## 8. Accessibility (a11y)

**Question:** Should the pivot layout meet WCAG 2.1 AA accessibility standards?

**Context:** WCAG 2.1 AA requires keyboard navigation, screen reader support, color contrast, etc. The current UI doesn't meet these standards (no keyboard navigation, limited screen reader support).

**Options:**
- **No a11y improvements:** Defer to follow-up. Current UI doesn't meet standards, and users haven't complained.
- **Basic a11y:** Add ARIA labels to interactive elements (buttons, chips, grid). Ensure color contrast meets AA standards.
- **Full a11y:** Meet WCAG 2.1 AA standards. Complex to implement (keyboard navigation, screen reader support, focus management).

**Decision needed:** Defer to follow-up. A11y is not critical for initial release.

**Recommendation:** Defer. Add basic a11y (ARIA labels, color contrast) in Phase 8 if time permits.

---

## Appendix: Superseded Documents

## DD-pivot-table-ui-redesign.md (Preact version, 768 lines)

**Status:** OBSOLETE — superseded by this design document.

**What was wrong:**
1. **Specified custom virtual-scrolling grid replacing AG Grid** — This DD planned to delete `grid.tsx` entirely and build a custom grid with IntersectionObserver-based virtual scrolling. The React conversion DD (DD-preact-to-react-conversion) already converted `grid.tsx` to declarative `<AgGridReact>`, which works well. There's no reason to delete AG Grid.

2. **Column resize via mousedown overlays** — This DD planned to implement column resize with custom mousedown/mousemove/mouseup handlers and document overlays. AG Grid already provides column resize out of the box (`resizable: true` in column defs). No need to reimplement.

3. **Preact-specific implementation details** — All component code was written for Preact (e.g., `h()` function, `preact/hooks`). The React conversion DD migrated everything to React. The implementation details are wrong for the current React+MUI stack.

**What transfers:**
- **3-zone drop zone detection concept** — The idea of splitting column headers into 3 zones (top = agg key, middle = add/reorder, bottom = band) is sound. This DD adopts the concept but implements it with React portals and AG Grid header measurement, not Preact-specific code.
- **Auto-preview debounce pattern** — The 400ms debounce with hash-based dirty check is a proven pattern. This DD adopts it unchanged.
- **`_ui` field in AppState** — The idea of storing UI-only state in an optional `_ui` field is sound. This DD adopts it with the same schema.
- **UX thinking** — The single-screen pivot layout, column palette, pipeline sidebar, and toolbar are all good UX decisions. This DD adopts the UX vision but implements it with React+MUI+AG Grid React, not Preact+custom CSS+custom grid.

## DD-pivot-table-ui-redesign-react.md (56-line stub)

**Status:** OBSOLETE — superseded by this design document.

**What was wrong:**
1. **Said to DELETE grid.tsx entirely** — This stub DD said to replace AG Grid with a custom virtual-scrolling grid. Wrong. AG Grid React (`<AgGridReact>`) is already live from the React conversion DD and works well. No reason to delete it.

2. **Stub with no architecture** — This DD was a 56-line stub that deferred all architecture decisions until the React conversion was complete. The React conversion is now complete, and this DD provides the full architecture.

3. **No implementation details** — The stub had no component specifications, no DnD flow, no auto-preview logic, no state management details. This DD provides all of that.

**What transfers:**
- **Single-screen pivot layout concept** — The stub correctly identified that the 3-tab shell should be replaced with a single-screen layout. This DD adopts that vision.
- **PivotLayout → PivotSidebar + PivotToolbar + PivotGrid component tree** — The stub correctly identified the component hierarchy. This DD adopts it with detailed specifications for each component.
- **AppState `_ui` field** — The stub correctly identified the need for a `_ui` field. This DD adopts it with a detailed schema.

## Why Both Are Superseded

Both old DDs were written before the React conversion was complete. They specified implementation details for Preact (the first DD) or deferred all details (the second DD). The React conversion DD (DD-preact-to-react-conversion) has now landed, and the codebase is on React+MUI+AG Grid React. The implementation details in the old DDs are wrong for the current stack.

This DD provides the full architecture for the Live Chip-Table UI on the current React+MUI+AG Grid React stack. It supersedes both old DDs and should be the canonical design going forward.

## Lessons Learned

1. **Don't design against an imagined codebase** — The first DD (Preact version) specified a custom grid because it was written before the React conversion. If it had been written after the React conversion, it would have kept AG Grid.

2. **Don't defer all decisions** — The second DD (stub) deferred all architecture decisions, which meant it wasn't actionable. A design doc should be complete enough to hand off to an executor.

3. **Research the codebase before designing** — This DD is grounded in the actual codebase (verified that `useStore`, `AgGridReact`, `createBandRowStyler`, `ContextMenu`, etc. all exist and work). The old DDs weren't grounded in the codebase because the codebase was in flux (React conversion in progress).

4. **Supersede obsolete docs explicitly** — Both old DDs are now marked as obsolete in this DD's appendix. Future designers should reference this DD, not the old ones.

---
