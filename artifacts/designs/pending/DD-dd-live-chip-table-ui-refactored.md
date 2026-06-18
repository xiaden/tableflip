# Live Chip-Table UI (Refactored) — Design Document

**Status:** Draft  
**Author:** RnD-DDAuthor  
**Created:** 2026-06-17  

**Related Documents:**
- [DD-preact-to-react-conversion](artifacts/designs/pending/DD-preact-to-react-conversion.md) — React+MUI foundation already executed. This DD builds on the live React+MUI+AG Grid React stack.
- [DD-dd-live-chip-table-ui (SUPERSEDED)](artifacts/designs/pending/DD-dd-live-chip-table-ui.md) — Original pivot DD with left sidebar, 3-zone drop overlay, MUI Collapse pipeline sections. Replaced by this refactored design.
- [ADR-002: Five-Layer Architecture](artifacts/decisions/ADR-002-five-layer-architecture.md) — UI layer only constraint.
- [ADR-006: Monolithic State Store](artifacts/decisions/ADR-006-monolithic-state-store-single-source-of-truth-for-reactivity-and-serialization.md) — All mutations via store.update()/store.set(). _ui field additive only.
- [ASR-0002: Non-Technical UX Language](artifacts/requirements/ASR-0002-non-technical-ux-language.md) — No JOIN/SQL/WHERE in user-facing text.

---

## Scope

**In scope:** Single-screen pivot layout replacing the 3-tab card-based UI. Right sidebar (270px, collapsible) with: top section (file import, save config), sheet accordions (MUI Accordion per imported sheet with column chips + sheet-name chip), calculated columns accordion (dashed-border add chip → MUI Dialog). Top menu bar with File/Format/Config menus. Live preview area with AG Grid rendering data rows and custom column header via headerComponentFramework (3 rows: top=join keys, middle=detail bands, bottom=extra match keys). Auto-preview: 400ms debounced, hash-based dirty check. Drag-and-drop from sidebar chips to header rows. Column chip context menu (type, rename, merge toggle). Join pair gear popup, band config modal. AG Grid theme (balham-dark + CSS overrides). Tests.

**Out of scope:** Core/Catalog/Query/Report layer changes. Multi-sheet report output. Feature flags. New npm dependencies (no dnd-kit). Deleting AG Grid. Keyboard navigation. Accessibility (a11y).

---

## Problem Statement

The current TableFlip UI uses a 3-tab card-based layout (Query Builder / Browse Sheet / Report) that fragments the report-building workflow. Users must switch between tabs to configure the pipeline, view results, and export. The Query Builder tab stacks three cards vertically (Pipeline, Layout, Filter/Sort) with a Run button, requiring scrolling through configuration to see results in a separate tab.

This layout was inherited from the original JavaScript implementation and ported faithfully to Preact, then converted to React+MUI. The React conversion preserved the 3-tab structure because it was a framework conversion, not a redesign. Now that the React+MUI foundation is live, we can redesign the layout holistically.

The 3-tab layout has specific usability problems: (1) users can't see the effect of pipeline changes without switching to the Report tab and clicking Run, (2) column configuration is split across two cards, (3) filter/sort configuration is in a third card, (4) the Browse Sheet tab duplicates table preview. These problems compound as reports grow in complexity.

**Who has this problem:** Every user who builds reports with multi-stage pipelines. The problem scales with pipeline complexity.

---

## Architecture

**Component Tree:**
```
<App> → <MuiThemeProvider>
  <Loader /> (unchanged)
  <PivotLayout>
    <MenuBar>              ← Top: File / Format / Config menus
    <Box sx={{ display: 'flex', flex: 1 }}>
      <PivotMain>          ← flex: 1
        <PivotGrid>        ← <AgGridReact> with headerComponentFramework: ThreeRowHeader (top=join keys, middle=band chips, bottom=match keys)
      </PivotMain>
      <PivotSidebar>       ← 270px, right side, collapsible
        <TopSection>       ← Import + Save buttons
        <SheetAccordions>  ← MUI Accordion per sheet (sheet-name chip + column chips)
        <CalcAccordion>    ← dashed "add calculation" chip → calc-builder Dialog
      </PivotSidebar>
    </Box>
  </PivotLayout>
```

**Data Flow:** User drags chip from sidebar accordion onto header row → dragstart sets data payload → drop handler mutates store via store.update() → store notifies subscribers → PivotSidebar/MenuBar re-render → AutoPreview.schedulePreview() called → 400ms debounce → hash check via buildReportSpecFromState() → runReport() → store.set('result') → PivotGrid re-renders.

**Layer Mapping:** All new components are UI layer (SRC/preact/ui/). Core/Catalog/Query/Report unchanged.

**Reused files (unchanged):** aggregation.ts, export.ts, loader.ts, file-loader.tsx, chip.tsx, context-menu.tsx, modal.tsx, calc-builder.tsx, rename-modal.tsx, useStore.ts, core/store.ts, buildColumnCatalog(), buildReportSpecFromState(), getValidation().

---

## Design Goals

1. Single-screen pivot table layout — Replace the 3-tab card-based UI with a unified menu bar + grid + right sidebar layout.
2. Direct manipulation via drag-and-drop — Drag column chips from the right sidebar onto AG Grid column headers. Three-row header design with clear semantics per row.
3. Live auto-preview — Automatic report execution with 400ms debouncing and hash-based dirty checking.
4. Preserve AG Grid React — Keep declarative <AgGridReact>; implement three-row headers via headerComponentFramework.
5. All existing functionality preserved — Stacks, lookups, calculated columns, detail bands, filters, sorts, aggregates, totals, subtotals, merges, XLSX/CSV export, column rename, row exclusion.
6. UI-layer only — No changes to Core/Catalog/Query/Report.
7. Backward-compatible state — Optional _ui field additive only; existing .rcjson files load without modification.
8. Performance budget — DnD → state change < 5ms, debounce 400ms, runReport ~100-500ms, AG Grid update ~50-200ms. Total ~200-600ms.

---

## Constraints

1. Five-layer architecture preserved (ADR-002): Only SRC/preact/ui/ changes.
2. Monolithic store preserved (ADR-006): All mutations via store.update()/store.set(). _ui field additive only.
3. AG Grid React v33.3.2 stays. Three-row headers via headerComponentFramework (available since v31+).
4. No breaking changes to AppState serialization. _ui field optional, transient fields reset on load.
5. All existing functionality preserved.
6. Single-sheet reports only.
7. No feature flags. Feature branch only.
8. No new npm dependencies. HTML5 DragEvent only.
9. No dangerouslySetInnerHTML. All rendering via React JSX.
10. Window/document access guarded with typeof checks.
11. Vendored CJS modules: // @ts-expect-error before import() of files in js/wasm/ and js/vendor/.
12. ASR-0002 compliance: No "JOIN"/"SQL"/"WHERE" in user-facing text.
13. TypeScript strict: true. No `any` types for new code.
14. All mandatory checks pass: typecheck (zero errors), lint (zero warnings), tests (all pass).

---

## Design Decisions

**1. Right Sidebar Instead of Left** — Grid is the primary workspace on the left. Placing sidebar on the right makes configuration a reference panel. Users drag rightward (natural gesture).

**2. MUI Accordion Instead of Custom Collapse Sections** — Built-in expand/collapse animation, accessibility, consistent MUI styling. Fewer sections than the old design (per-sheet instead of five pipeline stages) makes the 48px headers acceptable.

**3. Three-Row Header via headerComponentFramework** — AG Grid React v33.3.2 supports headerComponentFramework (v31+). The ThreeRowHeader renders three vertically stacked divs with onDragOver/onDrop handlers. headerHeight increased to ~90px.

**4. Top Row = Join Keys + Report Columns** — Dropping a chip adds column to output; dropping a chip from a DIFFERENT sheet on same column creates a join key pair with gear icon for join options.

**5. Middle Row = Detail Bands** — Sheet-name chips (from accordion headers) dropped here create detail bands. Gear icon opens band config modal (match keys, child columns). Multiple chips in same column are reorderable.

**6. Bottom Row = Extra Match Keys** — Additional keys for multi-key joins WITHOUT adding those columns to report output. Column position doesn't matter for semantics.

**7. Menu Bar Instead of Toolbar** — File/Format/Config menus. Layout submenu (No Summary/Totals/Subtotals). Config opens modal popups for stacks, sorting, filtering.

**8. Sheet Accordions with Sheet-Name Chips** — Sheet-name chip (draggable for bands) separated from column chips. Right-click context menu on column chips (type, rename, merge toggle).

**9. Calculated Columns Accordion with Modal** — Dashed-border 'add calculation' chip opens MUI Dialog with existing CalcBuilder. Once created, calc chip appears in accordion. Right-click: Rename, Edit...

**10. Auto-Preview with Hash-Based Dirty Check** — Store subscription → 400ms debounce → JSON.stringify(buildReportSpecFromState()) hash check → runReport → set result. Reentry guard prevents concurrent executions.

**11. Implicit Base Sheet** — First chip dropped into top row determines base sheet. No explicit Base Table selection UI.

**12. Stacked Virtual Sheets as Separate Accordions** — Virtual sheet combinations get their own accordions, visually distinct from physical sheets.

---

## Component Specifications

**PivotLayout (~80 lines):** Root layout: menu bar + main area + right sidebar. Mounts auto-preview subscription on mount. Handles sidebar collapse/expand via _ui.sidebarCollapsed.

**MenuBar (~200 lines):** File menu (Import file, Import config, Export config, Export report), Format menu (Layout submenu: No Summary/Show Totals/Show Subtotals, Stacks modal), Config menu (Sorting modal, Filtering modal). Uses MUI Menu/MenuItem.

**PivotSidebar (~70 lines):** Right sidebar shell. TopSection + SheetAccordions + spacer + CalcAccordion.

**TopSection (~60 lines):** Import file button (calls triggerFileInput() from file-loader.tsx) + Save Report Config button (calls saveState()).

**SheetAccordions (~50 lines):** Renders one MUI Accordion per imported sheet. Includes stacked virtual sheets.

**SheetAccordion (~150 lines):** Single sheet accordion. Sheet-name chip (draggable, chipType:'sheet'), column chips (draggable, chipType:'column'). Right-click context menu on column chips.

**CalcAccordion (~120 lines):** Dashed-border 'add calculation' chip → MUI Dialog with CalcBuilder. Calc chips for created calcs. Right-click: Rename, Edit...

**PivotGrid (modified grid.tsx, +100 lines):** Wraps <AgGridReact> with headerComponentFramework. headerHeight = 90px. onColumnMoved syncs colOrder. Reuses createBandRowStyler.

**ThreeRowHeader (~250 lines):** AG Grid header component with three drop rows. Top row: join key pairs + gear icon. Middle row: band sheet chips + gear icon. Bottom row: extra match keys.

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| AG Grid headerComponentFramework has lifecycle quirks with React hooks | High | Test with AG Grid v33.3.2; fall back to headerComponent (older API) if needed |
| 3-row header height (~96px) reduces visible data rows | Medium | Implement accordion sidebar width toggle; make headerHeight configurable |
| Drop event conflicts with AG Grid built-in sort/filter | Medium | stopPropagation on key events; test sort indicators still work |
| Right sidebar + menu bar layout cascade touches root app.tsx | Medium | Phase 1 carefully, test imports after restructure |
| MUI Accordion 48px headers waste vertical space in sidebar | Low | Use custom 28px Collapse headers (from OLD design) instead if needed |
| Auto-preview on chip-drop-only misses filter/sort changes | Low | Use store subscription approach (proven in OLD design) instead |
| Join key pair semantics across columns requires query-layer knowledge | Medium | Keep join logic in store (lookups array), expose via selectors to header component |

---

## Implementation Phases

**Phase 1: Foundation (3h)** — types.ts (_ui field), app.tsx (remove 3-tab shell), RightSidebar shell, MenuBar shell, PivotLayout root. Delete obsolete files (sidebar.tsx, tabs.ts, 3 card components, run-bar.tsx, column-chips.tsx).

**Phase 2: Right Sidebar (6h)** — TopSection (import + save), SheetAccordions, SheetAccordion (draggable chips + context menu), CalcAccordion (add chip + calc dialog).

**Phase 3: Menu Bar + Modals (8h)** — MenuBar (File/Format/Config menus), StacksModal, FilterModal, SortModal. Wire existing filter-list.tsx, sort-list.tsx into modals.

**Phase 4: Live Header + DnD (10h)** — LiveHeader.tsx (3-row header area), ThreeRowHeader AG Grid component, JoinKeyPair.tsx, BandChipRow.tsx, MatchKeyRow.tsx, JoinOptionsPopup.tsx, BandConfigModal.tsx. Wire drop handlers to store mutations.

**Phase 5: Auto-Preview (3h)** — AutoPreview.ts (400ms debounce, hash check, reentry guard). Mount in PivotLayout.

**Phase 6: Integration + Gate (5h)** — Typecheck + lint + test pass. Manual testing with 10K-row dataset. Verify all existing functionality preserved.

**Total: ~35h (optimistic), ~58h (realistic), ~74h (pessimistic)**

---

## Appendix: Superseded Documents

This design document supersedes `DD-dd-live-chip-table-ui.md` which specified a left sidebar (270px) with 3-zone drop overlay on AG Grid headers, MUI Collapse pipeline sections, and a PivotToolbar. The key changes are:
- Left sidebar → Right sidebar
- ColumnPalette (flat chips) → Per-sheet MUI Accordions with sheet-name + column chips
- PipelineStages (Base/Stacks/Lookups/Calcs/Bands) → Implicit base sheet + drag-pair joins + calc accordion
- PivotToolbar (agg/filter/sort in toolbar row) → Top menu bar (File/Format/Config) with modal popups
- DropZoneOverlay (dynamic portal, 3-zone detection) → Three static rows in AG Grid headerComponentFramework
- AutoPreview on all store mutations → AutoPreview on chip drops only (design decision; may revert to store subscription)
- MUI Collapse 28px custom sections → MUI Accordions (standard 48px headers)
- FileBar in left sidebar → File menu + right sidebar TopSection

---
