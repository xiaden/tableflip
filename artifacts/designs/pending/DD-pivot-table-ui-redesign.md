# Pivot Table UI Redesign — Design Document

**Status:** Draft  
**Author:** agent  
**Created:** 2026-06-15  

**Related Documents:**
- [ADR-002: Five-Layer Architecture](artifacts/decisions/ADR-002-five-layer-architecture.md) — Establishes the five-layer architecture. This redesign is UI-layer only — no changes to Core, Catalog, Query, or Report layers.
- [DD-preact-rebuild-architecture](artifacts/designs/completed/DD-preact-rebuild-architecture.md) — The original Preact rebuild design. This redesign replaces the UI layer it specified (app.tsx, grid.tsx, cards/*, tabs.ts) while preserving all lower layers.
- [DD-pipeline-preview](artifacts/designs/pending/DD-pipeline-preview.md) — Pipeline preview feature (currently pending). Parts of its preview-builder.ts may inform the auto-preview mechanism in the new UI, though the pivot grid's auto-preview uses runReport() not buildPreview().
- [DD-band-export-v2](artifacts/designs/pending/DD-band-export-v2.md) — Band export v2 design. The custom grid must render band rows with tinted backgrounds matching the export model.
- [DD-needs-sync-state-separation](artifacts/designs/pending/DD-needs-sync-state-separation.md) — State separation design. The _ui field addition in this design is compatible with the needsSync/FieldFlags model proposed there.
- [DD-store-alias-rename](artifacts/designs/pending/DD-store-alias-rename.md) — Store-based alias rename. The custom grid's context menu must integrate with the rename propagation model designed here.

---

## Scope

**In scope:**
- Complete UI layer rewrite: replace 3-tab card-based layout with single-screen pivot layout
- Custom virtual-scrolling grid replacing AG Grid (grid.tsx deleted)
- New component hierarchy: PivotLayout → PivotSidebar + PivotToolbar + PivotGrid
- Drag-and-drop from column palette to grid headers (3-zone detection)
- Column resize via header drag handles
- Auto-preview with debounced report execution
- Calc editor in modal (reusing existing Modal + CalcBuilder)
- Filter/sort chip row in toolbar
- New CSS file (pivot-layout.css) for pivot-specific styles
- AppState `_ui` field for UI-only state (column widths, preview dirty flag)
- Component and unit tests for new components

**Out of scope:**
- Core layer changes (store, sqldb, utils, state)
- Catalog layer changes (source-catalog, column-catalog)
- Query layer changes (SQL generation, query plan)
- Report layer changes (engine, validation, result-set, export)
- Data model changes (AppState fields beyond optional `_ui`, ReportSpec)
- Serialization format changes (backward-compatible only)
- Multi-sheet report output
- Feature flags or conditional old/new UI rendering
- New npm dependencies (no dnd-kit, no react-dnd, no new state library)

---

## Problem Statement

The current TableFlip UI uses a 3-tab card-based layout (Query Builder / Browse Sheet / Report) that fragments the report-building workflow. Users must switch between tabs to configure the pipeline, view results, and export — configuration and feedback are separated by tab boundaries. The Query Builder tab stacks three cards vertically (Pipeline, Layout, Filter/Sort) with a Run button, requiring scrolling through configuration to see results in a separate tab.

This layout was inherited from the original JavaScript implementation (`SRC/js/ui/views/query-builder.tsx`) and ported faithfully to Preact (`SRC/preact/ui/app.tsx`, 299 lines). The port preserved the AG Grid dependency (`SRC/preact/ui/grid.tsx`, 582 lines) for result rendering. AG Grid must now be removed as a dependency, requiring a custom grid implementation. This creates an opportunity to redesign the layout holistically rather than simply replacing AG Grid in-place within the existing 3-tab structure.

The 3-tab layout has specific usability problems: (1) users can't see the effect of pipeline changes without switching to the Report tab and clicking Run, (2) column configuration (selection, ordering, aggregation) is split across two cards requiring scroll, (3) filter/sort configuration is in a third card further down, (4) the Browse Sheet tab duplicates table preview that could be integrated into the main view. These problems compound as reports grow in complexity — a report with 3 lookups, 2 calcs, and a detail band requires significant scrolling and tab-switching to configure and verify.

**Who has this problem:** Every user who builds reports with multi-stage pipelines. The problem scales with pipeline complexity — simple single-table reports work fine in the current layout, but anything with lookups, calcs, or bands requires constant context-switching.

---

## Architecture

## 1. Layout Architecture

The single-screen pivot layout replaces the 3-tab card-based UI with three persistent regions:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Header: TableFlip logo + subtitle                                       │
├────────────┬─────────────────────────────────────────────────────────────┤
│            │  Toolbar                                                    │
│  Sidebar   │  ┌─────────┬──────────────────────┬────────┬────────────┐  │
│  (270px)   │  │ AggMode │ Filter/Sort chips    │ Export │ ValidPill  │  │
│            │  └─────────┴──────────────────────┴────────┴────────────┘  │
│  ┌──────┐  ├─────────────────────────────────────────────────────────────┤
│  │Import│  │  Custom Pivot Grid                                          │
│  │Files │  │  ┌──────────────────────────────────────────────────────┐  │
│  ├──────┤  │  │ Column Headers (3-zone drop targets)                 │  │
│  │Base  │  │  ├──────────────────────────────────────────────────────┤  │
│  │Stacks│  │  │ Data Rows (virtual scrolling, fixed 36px height)     │  │
│  │Lookups│ │  │                                                      │  │
│  │Bands │  │  │   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐               │  │
│  │Calcs │  │  │   │cell│ │cell│ │cell│ │cell│ │cell│ ← visible      │  │
│  ├──────┤  │  │   └────┘ └────┘ └────┘ └────┘ └────┘               │  │
│  │Column│  │  │   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐               │  │
│  │Chip  │  │  │   │cell│ │cell│ │cell│ │cell│ │cell│ ← visible      │  │
│  │Palette│ │  │   └────┘ └────┘ └────┘ └────┘ └────┘               │  │
│  └──────┘  │  │   ... (overscan buffer rows above/below viewport)    │  │
│            │  └──────────────────────────────────────────────────────┘  │
└────────────┴─────────────────────────────────────────────────────────────┘
```

## 2. Component Tree

```
<App>                                    ← app.tsx (rewritten)
├── <Loader />                           ← file-loader.tsx (unchanged)
├── <PivotLayout>                        ← pivot/pivot-layout.tsx (NEW)
│   ├── <PivotSidebar>                   ← pivot/pivot-sidebar.tsx (NEW)
│   │   ├── File import section          ← reuses drop zone from existing sidebar
│   │   ├── Table list                   ← reuses table cards from existing sidebar
│   │   └── <PivotPipeline>              ← pivot/pivot-pipeline.tsx (NEW)
│   │       ├── BaseStage                ← sections/base-stage.tsx (reused)
│   │       ├── StackSheets              ← sections/stack-sheets.tsx (reused)
│   │       ├── LookupStage[]            ← sections/lookup-stage.tsx (reused)
│   │       ├── CalcStage[]              ← sections/calc-stage.tsx (reused)
│   │       │   └── CalcBuilder (modal)  ← components/calc-builder.tsx (reused in Modal)
│   │       ├── DetailBandStage[]        ← sections/detail-band-stage.tsx (reused)
│   │       └── <ColumnPalette>          ← pivot/column-palette.tsx (NEW)
│   │           └── Draggable chips      ← extends column-chips.tsx DnD pattern
│   ├── <PivotToolbar>                   ← pivot/pivot-toolbar.tsx (NEW)
│   │   ├── AggMode selector             ← radios from layout-card.tsx
│   │   ├── <FilterChipRow>              ← pivot/pivot-filter-row.tsx (NEW)
│   │   │   ├── FilterChip[]             ← click to expand inline editor
│   │   │   └── SortChip[]               ← click to expand inline editor
│   │   ├── Export dropdown              ← calls exportAs() from export.ts
│   │   └── Validation pill              ← from run-bar.tsx logic
│   └── <PivotGrid>                      ← pivot/pivot-grid.tsx (NEW)
│       ├── <PivotGridHeader>            ← pivot/pivot-grid-header.tsx (NEW)
│       │   ├── Column header cells      ← 3-zone drop targets
│       │   └── Resize handles           ← right-edge grab zones
│       ├── <PivotGridRow>[]             ← pivot/pivot-grid-row.tsx (NEW)
│       │   └── Cell rendering           ← fixed 36px height, virtual
│       └── <PivotContextMenu>           ← pivot/pivot-context-menu.tsx (NEW)
│           └── wraps ContextMenu        ← components/context-menu.tsx (reused)
```

## 3. Design Decisions

### 3.1 Grid Virtualization

**Decision:** IntersectionObserver + fixed row height (36px) + overscan buffer (5 rows) + scroll rAF throttling. `transform: translateY` for row positioning.

**Rationale:** AG Grid provided virtualization out of the box. The replacement must match its scroll performance for 10K+ rows. Fixed row height eliminates the need for dynamic height measurement — the most complex part of virtual scrolling. IntersectionObserver is more efficient than scroll-event-based visibility detection because the browser batches intersection checks. The 5-row overscan prevents white-flash during fast scrolling. `transform: translateY` is GPU-accelerated and avoids layout thrashing.

**Implementation approach:**
- Container div with `overflow: auto` and known total height (`rowCount * 36px`)
- Row elements absolutely positioned via `transform: translateY(rowIndex * 36 + 'px')`
- IntersectionObserver watches a sentinel element at the scroll viewport edges
- On intersection change, compute visible range: `startRow = floor(scrollTop / 36) - 5`, `endRow = ceil((scrollTop + viewportHeight) / 36) + 5`
- Render only rows in `[startRow, endRow]` range
- Scroll handler throttled via `requestAnimationFrame` — at most one recompute per frame

**Fallback:** If IntersectionObserver proves unreliable for this use case, fall back to `onScroll` with rAF throttle. The rest of the virtualization logic is identical.

### 3.2 Column Resize

**Decision:** Mousedown on header right-edge 6px grab zone → mousemove/mouseup on document overlay. Store widths in `_ui.columnWidths` store field. Min 60px, max 600px.

**Rationale:** AG Grid had built-in column resize. The replacement needs equivalent UX. A transparent document overlay during drag prevents iframe/scroll-container interference and ensures mouse events are captured even when the cursor moves outside the header.

**Implementation approach:**
- Each header cell renders a 6px-wide resize handle on its right edge (`position: absolute; right: 0; width: 6px; cursor: col-resize`)
- `mousedown` on handle: record starting X, starting width, column alias
- Create a transparent `div` overlay covering the entire viewport (`position: fixed; inset: 0; z-index: 9999; cursor: col-resize`)
- `mousemove` on overlay: compute delta, clamp to [60, 600], update width in local state
- `mouseup` on overlay: commit width to `_ui.columnWidths[alias]`, remove overlay
- Grid reads widths: `_ui.columnWidths[alias] ?? 150` (default 150px)

### 3.3 Drag-and-Drop Architecture

**Decision:** Extend existing native HTML5 DragEvent from `column-chips.tsx`. Use `dataTransfer.setData/getData('text/plain')` for column alias. `effectAllowed: 'move'`. No new library.

**Rationale:** The existing `column-chips.tsx` already implements native HTML5 DnD for chip reordering (lines 177-215). The same pattern extends to:
1. Palette chip → grid header (add column)
2. Grid header → header reorder
3. Grid header → drop zone detection (agg key / add column / detail band)

Native DnD is sufficient for this use case — no cross-window drag, no complex multi-select, no touch support needed. Adding a library (dnd-kit, react-dnd) would increase bundle size and introduce a new dependency for a pattern that already works.

**Data contract:** `e.dataTransfer.setData('text/plain', columnAlias)` on dragstart. `e.dataTransfer.getData('text/plain')` on drop. The alias is the unique identifier for the column across all drop targets.

### 3.4 Header Drop Zone Detection

**Decision:** 33/33/33 proportional split of header cell height. `detectZone(e, headerEl)` returns `'top' | 'middle' | 'bottom'`. Visual highlight via CSS pseudo-elements during `dragover`.

**Rationale:** Column headers serve triple duty: aggregation key assignment (top), column addition/reorder (middle), and detail band assignment (bottom). A 3-zone split is the simplest model that supports all three operations without additional UI chrome.

**Implementation:**
```typescript
function detectZone(e: DragEvent, headerEl: HTMLElement): 'top' | 'middle' | 'bottom' {
  const rect = headerEl.getBoundingClientRect();
  const relativeY = e.clientY - rect.top;
  const third = rect.height / 3;
  if (relativeY < third) return 'top';
  if (relativeY < third * 2) return 'middle';
  return 'bottom';
}
```

**Visual feedback during `dragover`:**
- Top zone: `::before` pseudo-element, top border highlight (blue)
- Middle zone: `::after` pseudo-element, full cell background tint
- Bottom zone: `::before` pseudo-element, bottom border highlight (green)

**Zone semantics:**
- **Top (agg key):** In group/totals/subtotals mode, toggles column as group-by key. In 'none' mode, no-op.
- **Middle (add/reorder):** Adds column to output if not present, or reorders if already present.
- **Bottom (detail band):** In group mode, assigns column as band key pair. No-op in other modes.

### 3.5 Auto-Preview Debouncing

**Decision:** 400ms debounce with `JSON.stringify` hash of `buildReportSpecFromState()` output. Dirty indicator via `_ui.previewDirty` store field. Cancel pending on new change.

**Rationale:** The old UI required clicking "Run Report" to see results. The new UI auto-runs on every pipeline change with debouncing. The hash-based dirty check prevents redundant re-execution when state changes don't affect the report spec (e.g., sidebar collapse toggle).

**Implementation:**
```typescript
let _debounceTimer: number | null = null;
let _lastHash: string | null = null;

function schedulePreview() {
  // Cancel any pending preview
  if (_debounceTimer != null) clearTimeout(_debounceTimer);

  const spec = buildReportSpecFromState(getStore().getState());
  const hash = JSON.stringify(spec);

  // Skip if spec hasn't changed
  if (hash === _lastHash) return;

  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _lastHash = hash;
    runAutoPreview();
  }, 400);
}
```

**Trigger points:** Every `store.subscribe()` callback calls `schedulePreview()`. This covers all state mutations — pipeline changes, filter/sort edits, aggregation mode switches, column reorders.

**Error handling:** If `runAutoPreview()` throws, the error is caught and displayed as a validation message. The grid shows the last successful result until a new one succeeds.

### 3.6 Calc Column Editor Placement

**Decision:** Modal using existing `Modal` component (portal-based). Reuses `calc-builder.tsx` content. Opens from sidebar calc stage chip click.

**Rationale:** The calc builder is the most complex editor in the application — math steps, compare conditions, text operations, date operations. It needs maximum screen real estate. A modal provides focus isolation and doesn't compete with the grid for space. The existing `Modal` component already handles portal rendering, escape key, backdrop close, and focus management.

**Interaction flow:**
1. User clicks calc stage chip in sidebar → `setCalcEditorOpen(alias)`
2. Modal opens with `<CalcBuilder>` content, pre-populated with existing calc config
3. User edits calc configuration
4. On save: `store.update(draft => { draft.calcStages[idx] = updatedCalc })` → modal closes → auto-preview triggers
5. On cancel: modal closes, no state change

### 3.7 Filter/Sort Placement

**Decision:** Toolbar chip row. Chip element per active filter/sort. Click chip to expand inline editor from existing `filter-list.tsx`/`sort-list.tsx`. Clear via chip close button. Overflow: horizontal scroll.

**Rationale:** Filters and sorts are frequently adjusted during report building. Putting them in the toolbar (always visible) eliminates the tab-switching required in the current UI. Chip representation is compact — a typical report has 2-5 filters and 1-3 sorts, fitting easily in the toolbar row.

**Implementation:**
- Each active filter renders as a `<Chip>` showing `"ColumnName op value"` with a close button
- Each active sort renders as a `<Chip>` showing `"ColumnName ↑/↓"` with a close button
- Click on chip: expands an inline editor panel below the toolbar (not a modal — keeps context visible)
- The inline editor reuses the existing filter/sort editing UI from `filter-list.tsx`/`sort-list.tsx`
- Close button on chip: removes the filter/sort via `store.update()`
- Overflow: when chips exceed toolbar width, the chip row scrolls horizontally

### 3.8 State Management Pattern

**Decision:** Add `_ui?: { sidebarCollapsed?: boolean; columnWidths?: Record<string, number>; previewDirty?: boolean; lastResultHash?: string }` to AppState. All mutations via existing `store.update()` / `store.set()`. No new state management library.

**Rationale:** The existing pub/sub store pattern works well for the current application. Adding a parallel state system (Zustand, Redux, signals) would duplicate infrastructure and break the serialization model. The `_ui` field is optional and prefixed with underscore to signal "UI-only, not part of the report spec." This follows the convention established by `aggModeState` (UI state for aggregation mode).

**Serialization:** `_ui` is included in `saveState()` / `loadState()` serialization. Column widths persist across sessions. `previewDirty` and `lastResultHash` are transient — they are reset on load.

**No types.ts changes required:** The `_ui` field is added as an optional property on AppState. Existing code that doesn't reference `_ui` continues to work. New code accesses it via `state._ui?.columnWidths?.[alias] ?? 150`.

### 3.9 CSS Approach

**Decision:** New `pivot-layout.css` (~350 lines) reusing existing CSS custom properties. Keep `style.css` for shared component styles (buttons, chips, modals).

**Rationale:** The existing `style.css` (792 lines) contains styles for the current 3-tab layout that will be deleted. Shared component styles (`.btn`, `.chip`, `.modal`, `.ctx-menu`, `.tip`) must be preserved. New pivot-specific styles (grid layout, sidebar sections, toolbar, virtual rows) go in a separate file to keep concerns separated.

**CSS custom properties reused from `:root`:**
- `--bg`, `--bg2`, `--bg3` — backgrounds
- `--border` — borders
- `--text`, `--muted` — text colors
- `--accent`, `--accent2` — accent colors
- `--green`, `--red`, `--yellow` — status colors

**New CSS custom properties for pivot:**
- `--pivot-row-height: 36px` — fixed row height
- `--pivot-header-height: 40px` — header cell height
- `--pivot-sidebar-width: 270px` — sidebar width (matches existing)
- `--pivot-col-default-width: 150px` — default column width

**File loading:** `pivot-layout.css` is imported in `pivot-layout.tsx` via `import './pivot-layout.css'`. The build pipeline (esbuild) handles CSS bundling.

### 3.10 Testing Strategy

**Decision:** Hybrid — unit test pure logic (zone detection, debounce, hash), jsdom test components (DnD, column resize, context menu), manual/E2E for grid perf.

**Rationale:** The custom grid is the highest-risk component. Pure logic functions (detectZone, debounce hash, column width clamping) are trivially unit-testable. Component tests (jsdom) can verify DnD event handling, resize interaction, and context menu rendering. Grid scroll performance cannot be meaningfully tested in jsdom — it requires a real browser with real DOM layout.

**Test breakdown:**
- **Unit tests** (Vitest, no DOM):
  - `detectZone()` — all 3 zones, edge cases (top/bottom pixel)
  - `computeDebounceHash()` — spec changes → different hash, UI-only changes → same hash
  - `clampWidth()` — min 60, max 600, default 150
- **Component tests** (Vitest + jsdom):
  - `PivotGridHeader` — dragover events trigger zone highlights, drop triggers correct action
  - `PivotGrid` — renders correct number of rows for viewport, scroll updates visible range
  - `ColumnPalette` — dragstart sets dataTransfer, drop on header adds column
  - `PivotContextMenu` — right-click opens menu, items trigger actions
  - `PivotToolbar` — agg mode change updates store, filter chip close removes filter
- **Manual testing:**
  - Load 10K row dataset, verify scroll smoothness
  - Load 50K row dataset, verify no frame drops during scroll
  - Verify column resize works with fast mouse movements
  - Verify DnD works across all zone combinations

## 4. Data Flow

### 4.1 User Interaction → Grid Update

```
User edits pipeline (e.g., adds a lookup)
        │
        ▼
store.update(draft => { draft.lookups.push(newLookup) })
        │
        ▼
Store notifies all subscribers (synchronous)
        │
        ├── PivotSidebar re-renders (lookup stage appears)
        ├── PivotToolbar re-renders (validation updates)
        └── schedulePreview() is called
                │
                ▼
            400ms debounce timer starts
                │
                ▼ (400ms later)
            buildReportSpecFromState(state) → spec
            JSON.stringify(spec) → hash
            hash !== lastHash → proceed
                │
                ▼
            runReport(spec, tables) → resultSet
                │
                ├── Success → store.update(d => { d.result = resultSet })
                │              PivotGrid re-renders with new data
                │              lastResultHash = hash
                │
                └── Error → validation error displayed
                            grid shows last successful result
```

### 4.2 Column Header Drop → State Update

```
User drags column chip from palette onto grid header
        │
        ▼
dragstart: dataTransfer.setData('text/plain', 'columnAlias')
        │
        ▼
dragover on header cell: detectZone(e, headerEl) → 'middle'
        │
        ▼
CSS ::after pseudo-element highlights cell background
        │
        ▼
drop on header cell:
  zone === 'middle' → store.update(draft => {
    if (!draft.selCols.has(alias)) draft.selCols.add(alias);
    if (!draft.colOrder.includes(alias)) draft.colOrder.push(alias);
  })
        │
        ▼
schedulePreview() → auto-preview triggers → grid updates
```

### 4.3 Column Resize → Width Persistence

```
User mousedowns on header resize handle
        │
        ▼
Record startX, startWidth, alias. Create overlay div.
        │
        ▼
User mousemoves (with overlay capturing events)
        │
        ▼
delta = e.clientX - startX
newWidth = clamp(startWidth + delta, 60, 600)
Update local state → header and all visible rows re-render with new width
        │
        ▼
User mouseups
        │
        ▼
store.update(draft => {
  draft._ui = draft._ui || {};
  draft._ui.columnWidths = draft._ui.columnWidths || {};
  draft._ui.columnWidths[alias] = newWidth;
})
Remove overlay div.
```

## 5. Integration Points

### 5.1 Lower Layer Dependencies (Unchanged)

The pivot UI depends on existing lower layers. No changes to these layers are required:

| Layer | Module | Usage |
|-------|--------|-------|
| Core | `store.ts` | `getState()`, `update()`, `set()`, `subscribe()` |
| Core | `state.ts` | `buildReportSpecFromState()`, `createAppState()` |
| Core | `sqldb.ts` | `execQuery()`, `quoteId()` |
| Core | `utils.ts` | `colUserLabel()`, `toast()`, `dl()`, `h()` |
| Catalog | `column-catalog.ts` | `buildColSourceMap()`, `projectedCols()` |
| Catalog | `source-catalog.ts` | `buildSourceCatalog()` |
| Query | `query-plan.ts` | `buildQueryPlan()` |
| Query | `layout-selection.ts` | `_afterCombineChange()`, `_syncSubtotalByToLayout()` |
| Report | `engine.ts` | `runReport()` (aliased as `executeReport`) |
| Report | `validation.ts` | `getValidation()`, `invalidateValidation()` |
| UI | `export.ts` | `exportAs('xlsx')`, `exportAs('csv')` |
| UI | `components/modal.tsx` | Calc editor modal |
| UI | `components/context-menu.tsx` | Header right-click menu |
| UI | `components/chip.tsx` | Filter/sort chips |
| UI | `components/calc-builder.tsx` | Calc editor content |
| UI | `components/rename-modal.tsx` | Column rename |
| UI | `components/tip.tsx` | Tooltips |
| UI | `sections/base-stage.tsx` | Base table selector |
| UI | `sections/stack-sheets.tsx` | Stack table selector |
| UI | `sections/lookup-stage.tsx` | Lookup configuration |
| UI | `sections/calc-stage.tsx` | Calc stage chip (opens modal) |
| UI | `sections/detail-band-stage.tsx` | Band configuration |
| UI | `sections/filter-list.tsx` | Filter editor (inline in toolbar) |
| UI | `sections/sort-list.tsx` | Sort editor (inline in toolbar) |
| UI | `sections/merge-toggles.tsx` | Merge toggles (in sidebar or toolbar) |

### 5.2 State Contract

The pivot UI reads and writes the same `AppState` shape. No new required fields. The optional `_ui` field is the only addition:

```typescript
interface AppState {
  // ... all existing fields unchanged ...
  _ui?: {
    sidebarCollapsed?: boolean;
    columnWidths?: Record<string, number>;
    previewDirty?: boolean;
    lastResultHash?: string;
  };
}
```

### 5.3 Serialization Compatibility

`saveState()` and `loadState()` in `core/state-serializer.ts` serialize the full AppState. The `_ui` field is serialized as-is. On load, `_ui.previewDirty` and `_ui.lastResultHash` should be reset to defaults (false and null respectively) since they are transient.

## 6. Constraints

1. **No AG Grid** — The entire grid.tsx (582 lines) is deleted. All grid functionality is reimplemented as custom Preact components.
2. **No feature flags** — This runs on a feature branch. No conditional rendering of old vs. new UI.
3. **Single-sheet reports** — No multi-sheet output. Export produces one sheet per report.
4. **All functionality preserved** — Every feature in the current UI must work in the new UI: stacks, lookups, detail bands, calcs, filters, sorts, aggregates, totals, subtotals, merges, XLSX/CSV export, column rename, row exclusion.
5. **No breaking changes to data model** — AppState shape is additive only (`_ui` field). ReportSpec is unchanged. Serialization format is backward-compatible.
6. **No `dangerouslySetInnerHTML`** — All rendering uses Preact JSX.
7. **Existing store pattern** — `getState()`, `update(draft => ...)`, `set()`, `subscribe()`. No new state management.
8. **ASR-0002 compliance** — All user-facing text uses non-technical language. Tooltips explain features in plain English.
9. **Window/document guards** — All `window` and `document` access guarded with `typeof window !== 'undefined'` / `typeof document !== 'undefined'`.
10. **Vendored CJS modules** — `// @ts-expect-error - vendored CJS module` before `import()` of files in `js/wasm/` and `js/vendor/`.

## 7. Open Questions

1. **Band row rendering in custom grid** — The current AG Grid integration uses `createBandRowStyler()` (grid.tsx:63) for tinted band rows. The custom grid must replicate this. Should band rows be rendered inline (interleaved with parent rows) or as expandable sub-grids? **Current leaning:** Inline interleaved, matching the existing behavior. The `_band_id` field on each row determines tint color.

2. **Totals row rendering** — The current grid renders `totalsRow` as a pinned bottom row in AG Grid. The custom grid must render it as a fixed row at the bottom of the viewport (or at the end of the scrollable area). **Current leaning:** Fixed at the bottom of the visible grid area, visually distinct (bold, different background).

3. **Subtotal row rendering** — Subtotals produce `_row_type === 'subtotal'` rows interleaved in the result set. These render naturally in the virtual scroll (they're just rows with different styling). No special handling needed beyond band-row tinting.

4. **Column reorder via header drag** — When dragging a header to reorder (middle zone drop on another header), should the column also be removed from its original position? **Current leaning:** Yes — drag from position A to position B removes from A and inserts at B, matching the existing `column-chips.tsx` reorder behavior.

5. **Empty state UX** — When no tables are loaded, the current UI shows a "Drop files to get started" empty state. The new UI should show the same empty state in the grid area, with the sidebar showing the file import drop zone prominently.

6. **Grid keyboard navigation** — AG Grid supported arrow key navigation, Enter to edit, etc. The custom grid's initial implementation will not include keyboard navigation. This can be added in a follow-up.

## 8. Implementation Phases

### Phase 1: Grid Foundation (32 hours)
Build the custom virtual-scrolling grid — the highest-risk component.
- `pivot-grid.tsx` — Container with virtual scroll logic
- `pivot-grid-row.tsx` — Single row component
- `pivot-grid-header.tsx` — Column header without drop zones (basic rendering only)
- Unit tests for virtualization math (visible range calculation)
- Manual test: 10K rows, verify scroll smoothness

### Phase 2: Layout Shell (8 hours)
Assemble the three-region layout.
- `pivot-layout.tsx` — Root layout: sidebar + toolbar + grid
- `pivot-sidebar.tsx` — Sidebar with file import + table list (migrate from `sidebar.tsx`)
- `pivot-toolbar.tsx` — Toolbar with agg mode selector + export button + validation pill
- `pivot-layout.css` — Layout styles
- Rewrite `app.tsx` to render `<PivotLayout>` instead of 3-tab shell

### Phase 3: Pipeline Sidebar (10 hours)
Move pipeline configuration into collapsible sidebar sections.
- `pivot-pipeline.tsx` — Collapsible pipeline config sections
- Integrate existing stage components (base, stacks, lookups, bands, calcs)
- `column-palette.tsx` — Draggable column chip list
- Calc stage opens Modal with CalcBuilder

### Phase 4: Drag-and-Drop (12 hours)
Implement all DnD interactions.
- Header 3-zone drop detection
- Palette chip → header (add column)
- Header → header (reorder)
- Header drop zone visual feedback (CSS pseudo-elements)
- Zone-specific actions (agg key, add column, band key)

### Phase 5: Column Resize + Context Menu (8 hours)
- Resize handle on header right edge
- Document overlay during drag
- Width persistence in `_ui.columnWidths`
- `pivot-context-menu.tsx` — Header right-click menu
  - Rename column
  - Set column type
  - Set format
  - Hide column

### Phase 6: Live Preview (8 hours)
- Auto-preview debounce logic
- Hash-based dirty check
- Integration with `runReport()` from engine.ts
- Error handling and display
- Validation pill integration

### Phase 7: Filter/Sort Toolbar (6 hours)
- `pivot-filter-row.tsx` — Filter/sort chip row
- Inline editor expansion
- Chip close to remove
- Horizontal overflow scroll

### Phase 8: Polish + Testing (10 hours)
- Band row tinting in custom grid
- Totals row rendering
- Subtotal row rendering
- Export dropdown (Excel/CSV)
- Component tests (jsdom)
- Integration verification
- Delete old files (grid.tsx, cards/*, tabs.ts)

**Total estimated: ~94 hours (within the 70-120 hour EPIC range)**

## 9. File Manifest

### New Files (Create)

| File | Layer | Lines (est.) | Description |
|------|-------|-------------|-------------|
| `ui/pivot/pivot-layout.tsx` | UI | ~120 | Root pivot layout: sidebar + toolbar + grid |
| `ui/pivot/pivot-sidebar.tsx` | UI | ~100 | File import + collapsible pipeline sections |
| `ui/pivot/pivot-pipeline.tsx` | UI | ~180 | Base, stacks, lookups, bands, calcs config |
| `ui/pivot/pivot-toolbar.tsx` | UI | ~150 | Mode selector, filter/sort chips, export, validation |
| `ui/pivot/pivot-grid.tsx` | UI | ~350 | Custom grid with virtual scrolling |
| `ui/pivot/pivot-grid-header.tsx` | UI | ~200 | Column header with 3-zone drop targets |
| `ui/pivot/pivot-grid-row.tsx` | UI | ~80 | Single row component |
| `ui/pivot/pivot-filter-row.tsx` | UI | ~150 | Filter/sort chip row + inline editors |
| `ui/pivot/pivot-context-menu.tsx` | UI | ~100 | Header right-click menu (wraps ContextMenu) |
| `ui/pivot/column-palette.tsx` | UI | ~150 | Draggable column chip list |
| `ui/pivot/pivot-layout.css` | UI | ~350 | Pivot-specific styles |
| `tests/ui/pivot/detect-zone.test.ts` | Test | ~60 | Zone detection unit tests |
| `tests/ui/pivot/pivot-grid.test.tsx` | Test | ~120 | Grid virtualization component tests |
| `tests/ui/pivot/pivot-grid-header.test.tsx` | Test | ~100 | Header DnD component tests |
| `tests/ui/pivot/column-palette.test.tsx` | Test | ~80 | Palette DnD component tests |

### Modified Files

| File | Change | Description |
|------|--------|-------------|
| `ui/app.tsx` | Rewrite | Replace 3-tab shell with `<PivotLayout>` |
| `types.ts` | Add field | Add `_ui?` optional field to AppState |
| `core/state-serializer.ts` | Minor | Reset transient `_ui` fields on load |

### Deleted Files

| File | Lines | Reason |
|------|-------|--------|
| `ui/grid.tsx` | 582 | AG Grid integration — replaced by custom grid |
| `ui/cards/pipeline-card.tsx` | ~200 | Merged into pivot-sidebar + pivot-pipeline |
| `ui/cards/layout-card.tsx` | ~150 | Merged into pivot-toolbar + column-palette |
| `ui/cards/filter-sort-card.tsx` | ~100 | Merged into pivot-toolbar + pivot-filter-row |
| `ui/tabs.ts` | ~30 | Tab switching eliminated |
| `ui/aggregation.ts` | ~80 | Agg mode UI merged into pivot-toolbar |

### Unchanged Files (Referenced but not modified)

All files in `core/`, `catalog/`, `query/`, `report/` layers remain unchanged.
UI components reused as-is: `chip.tsx`, `modal.tsx`, `context-menu.tsx`, `rename-modal.tsx`, `calc-builder.tsx`, `tip.tsx`, `row-explosion-dialog.tsx`.
UI sections reused as-is: `base-stage.tsx`, `stack-sheets.tsx`, `lookup-stage.tsx`, `calc-stage.tsx`, `detail-band-stage.tsx`, `filter-list.tsx`, `sort-list.tsx`, `merge-toggles.tsx`.
`export.ts`, `file-loader.tsx`, `loader.ts`, `sidebar.tsx` (logic extracted into pivot-sidebar but file may be kept for reference during migration).

---

## Design Goals

1. Single-screen pivot table layout — replace 3-tab card-based UI with sidebar + toolbar + grid.
2. Custom virtual-scrolling grid — replace AG Grid with a Preact-native grid supporting 10K+ rows.
3. Direct manipulation — drag-and-drop column chips onto grid headers for aggregation, band assignment, and column selection.
4. Auto-preview — debounced automatic report execution on every pipeline change, eliminating the manual "Run Report" step.
5. All existing functionality preserved — every feature in the current UI must work in the new layout.
6. UI-layer only — no changes to Core, Catalog, Query, or Report layers.

---

## Constraints

1. No AG Grid — custom Preact grid with virtual scrolling replaces grid.tsx entirely.
2. No feature flags — feature branch, no conditional old/new UI rendering.
3. Single-sheet reports — no multi-sheet output support.
4. All existing functionality preserved — stacks, lookups, detail bands, calcs, filters, sorts, aggregates, totals, subtotals, merges, XLSX/CSV export, column rename, row exclusion.
5. No breaking changes to data model — AppState shape is additive only (_ui field). ReportSpec unchanged. Serialization backward-compatible.
6. No dangerouslySetInnerHTML — all rendering via Preact JSX.
7. Existing store pattern — getState(), update(draft => ...), set(), subscribe(). No new state management library.
8. ASR-0002 compliance — non-technical UX language for all user-facing text.
9. Window/document access guarded with typeof checks.
10. Vendored CJS modules use @ts-expect-error annotation before import().

---

## Open Questions

1. Band row rendering: inline interleaved (matching current AG Grid behavior) vs. expandable sub-grids. Leaning inline.
2. Totals row: pinned at viewport bottom vs. at end of scrollable area. Leaning pinned at bottom.
3. Column header drag reorder: should it also work for reordering within the grid (not just palette→grid)?
4. Empty state UX when no tables loaded — show in grid area or full-screen?
5. Keyboard navigation in custom grid — defer to follow-up or include in initial implementation?
6. Merge display toggles — place in sidebar pipeline section or toolbar?

---

## Overview

## Overview

This design document specifies the replacement of TableFlip's current 3-tab card-based UI (Query Builder / Browse Sheet / Report) with a single-screen pivot-table layout. The current UI requires users to switch between tabs to configure a pipeline, view results, and export — creating a fragmented workflow where configuration and feedback are separated. The new layout presents the entire report-building experience in one view: a collapsible sidebar for pipeline configuration, a toolbar for aggregation/filter/sort/export controls, and a custom virtual-scrolling grid that shows live results.

The primary driver is the removal of AG Grid as a dependency. AG Grid currently provides the result/preview grid via `ui/grid.tsx` (582 lines). The new custom grid must match AG Grid's scroll performance for large datasets while supporting new interaction patterns (column header drop zones for aggregation/band assignment, inline column resize, right-click context menus).

This design is grounded in extensive research: Librarian briefing (architectural constraints), Ideator analysis (Option A "Minimal Pivot" selected at 3.8/5 composite score), Architect tradeoff analysis (10 implementation decisions), and Estimator sizing (EPIC: 70-120 hours, ~14 files).

---

## Requirements

## Requirements

### Functional Requirements
1. **Single-screen layout** — Sidebar (270px) + toolbar row + custom grid, replacing 3-tab shell.
2. **Custom virtual-scrolling grid** — Fixed 36px row height, IntersectionObserver-based viewport tracking, 5-row overscan buffer. Must handle 10K+ rows without frame drops.
3. **Column header drop zones** — 3-zone detection (top=agg key, middle=add/reorder column, bottom=detail band). Visual feedback during dragover.
4. **Drag-and-drop from column palette** — Native HTML5 DragEvent extending existing `column-chips.tsx` pattern. `dataTransfer.setData('text/plain', alias)`.
5. **Column resize** — Mousedown on header right-edge 6px grab zone. Document overlay during drag. Widths persisted in `_ui.columnWidths`. Min 60px, max 600px.
6. **Auto-preview** — 400ms debounced report execution on state change. Hash-based dirty check via `JSON.stringify(buildReportSpecFromState())`. No manual "Run Report" button.
7. **Calc editor in modal** — Reuses existing `Modal` component and `calc-builder.tsx` content. Opens from sidebar calc stage chip.
8. **Filter/sort chip row in toolbar** — Chip per active filter/sort. Click to expand inline editor. Close button to remove. Horizontal scroll overflow.
9. **Export** — Single Export button with dropdown (Excel/CSV). Calls existing `exportAs()` from `export.ts`.
10. **Validation pill** — Shows healthy/blocked status in toolbar. Reuses existing `getValidation()` logic.

### Preservation Requirements
11. All pipeline stages work: base table, stacks, lookups, calculated columns, detail bands.
12. All aggregation modes work: none (detail), group, totals, subtotals.
13. All output features work: column selection, column ordering, column rename, column type override, merge display.
14. All filter/sort features work: filter operators, sort direction, enabled/disabled toggles.
15. Export works: XLSX with styling, CSV, band section headers, totals row, subtotal rows.
16. Row exclusion works: right-click row → exclude from results.
17. File loading works: drag-and-drop XLSX/CSV, sheet selector, table removal.

### Non-Functional Requirements
18. No AG Grid dependency — `grid.tsx` deleted entirely.
19. No new npm dependencies — native HTML5 DnD, no dnd-kit/react-dnd.
20. No breaking changes to AppState serialization format.
21. No changes to Core, Catalog, Query, or Report layers.
22. All `npm run typecheck`, `npm run lint`, `npm test` pass with zero errors/warnings.

---

## Appendix: Research Findings

## Appendix: Research Findings

### A. Existing Code Patterns Discovered

1. **Native HTML5 DnD in column-chips.tsx** — Lines 177-215 implement dragstart/dragend/dragover/drop with `dataTransfer.effectAllowed = 'move'`, `_chipAtPoint()` helper for nearest-chip detection, and `store.update()` for reorder. This pattern extends directly to grid header drops.

2. **Portal-based Modal** — `modal.tsx` uses `createPortal` to `document.body`, handles Escape key, backdrop close, and focus management. Ready for calc editor reuse.

3. **Portal-based ContextMenu** — `context-menu.tsx` uses `createPortal`, auto-repositions when menu would overflow viewport, closes on outside click. Ready for header right-click wrapping.

4. **Store subscription pattern** — Every component follows: `useState(getStore().getState())` + `useEffect(() => getStore().subscribe(s => setState(s)), [])`. This pattern works for the pivot layout without modification.

5. **CSS custom properties** — `:root` defines `--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--muted`, `--accent`, `--green`, `--red`, `--yellow`. All reusable for pivot styles.

6. **Sidebar width** — Existing `.sidebar` CSS is 270px (style.css:54). The new sidebar matches this exactly.

### B. AG Grid Features That Must Be Replicated

| AG Grid Feature | Current Usage | Custom Grid Replacement |
|----------------|---------------|------------------------|
| Virtual scrolling | 10K+ rows | IntersectionObserver + fixed row height |
| Column resize | Drag header edge | Mousedown/mousemove/mouseup on handle |
| Column reorder | Drag header | DnD with dataTransfer |
| Cell rendering | Value formatter | Preact JSX per cell |
| Row styling | getRowStyle callback | Inline style per row (band tints) |
| Pinned bottom row | Totals row | Fixed div at grid bottom |
| Context menu | Right-click header | Wrap existing ContextMenu component |
| Column hide/show | Column menu | Context menu item |

### C. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Custom grid scroll performance | HIGH | Fixed row height eliminates measurement. Prototype grid first (Phase 1). |
| DnD across sidebar→grid | MEDIUM | Native HTML5 DnD works across DOM trees. Test early. |
| Auto-preview thrashing | MEDIUM | 400ms debounce + hash check prevents redundant execution. |
| Calc modal complexity | LOW | Reuses existing Modal + CalcBuilder. No new editor logic. |
| CSS scope creep | LOW | Separate pivot-layout.css file. Shared styles stay in style.css. |

### D. Rejected Alternatives

1. **Option B (Spreadsheet Metaphor)** — Scored 3.2/5. Excel-like cell editing added complexity without user benefit. TableFlip is a report builder, not a spreadsheet.
2. **Option C (Dashboard Layout)** — Scored 2.8/5. Resizable panels added significant implementation complexity. Users don't need to customize layout.
3. **Virtual scroll with dynamic row heights** — Rejected. Band rows and subtotal rows have variable heights in theory, but in practice all rows are 36px. Fixed height simplifies implementation dramatically.
4. **dnd-kit library** — Rejected. Native HTML5 DnD already works in column-chips.tsx. Adding a library for one feature isn't justified.
5. **Separate state management (Zustand, signals)** — Rejected. The existing pub/sub store works. Adding a parallel system breaks serialization and duplicates infrastructure.

---
