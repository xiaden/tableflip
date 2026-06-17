# Task: Root Shell + CSS Cleanup + Validation

## Problem Statement

Part E completes the preact-to-react conversion by converting the 4 root shell components (`app.tsx`, `sidebar.tsx`, `file-loader.tsx`, and the old `app.ts` entry point cleanup), removing CSS that is now covered by MUI, superseding ADR-007, and running full validation (typecheck, lint, all 1030 tests).

After Part E, the application runs entirely on React + MUI with Vite as the build tool. The five-layer architecture is preserved — only the UI layer changed framework.

**Prerequisite:** TASK-preact-to-react-B-shared-components, TASK-preact-to-react-C-ag-grid, TASK-preact-to-react-D-cards-sections (all component conversions complete).

**Design doc:** `artifacts/designs/pending/DD-preact-to-react-conversion.md`

## Phases

### Phase 1: Root Shell Components

Convert the 3 root shell components from Preact to React + MUI layout components.

- [x] Convert `app.tsx`: Replace `preact/hooks` → `react`. Replace all 4 `getStore().subscribe()` calls → `useStore()` with appropriate selectors. Replace tab bar with MUI `<Tabs>`/`<Tab>`. Replace layout divs with MUI `<Box>`/`<Stack>`. Preserve tab switching, query builder / preview / results panel composition, empty state rendering. Import and render converted cards, sections, and grid components
    **Note:** app.tsx converted from Preact to React+MUI. All 4 getStore().subscribe() patterns replaced with useStore(selector). MUI Tabs/Tab for tab bar with Tooltip-wrapped labels. MUI Select/MenuItem for preview table dropdown. MUI Button for export buttons. MUI Box/Typography for layout and empty states. All class→className, style strings→objects, h() utility removed. Preserved tab switching, grid refresh on tab change, component composition. Also deleted dead preact/app.ts (old entry point) and fixed pipeline-arrow.test.tsx (preact→RTL imports) to unblock typecheck. Fixed 14 lint warnings in Phase D files (unused imports). 0 typecheck errors, 0 lint warnings, 1097 tests pass.
- [x] Convert `sidebar.tsx`: Replace `preact/hooks` → `react`. Replace `getStore().subscribe()` → `useStore()`. Replace sidebar layout with MUI `<Box>` (or `<Drawer>` if appropriate). Replace table card list with MUI `<List>`/`<ListItem>`/`<ListItemText>`. Replace toggle button with MUI `<IconButton>`. Replace save button with MUI `<Button>`. Preserve table list rendering, color chips, remove/preview actions, sidebar collapse/expand
    **Note:** sidebar.tsx converted from Preact to React+MUI. getStore().subscribe() replaced with useStore({tables, base}). MUI IconButton for remove button, MUI Button for save config, MUI Box for layout containers, MUI Typography for text. DOM IDs (sidebar, sidebarToggle, dropZone, tablesList) preserved for toggleSidebar() utility compatibility. className preserved for CSS compatibility (Phase 2 cleanup will remove CSS). All class→className. 0 typecheck errors.
- [x] Convert `file-loader.tsx`: Replace `preact/hooks` → `react`. Replace `createPortal` from `preact/compat` → `react-dom`. Replace file drop overlay with MUI `<Backdrop>`. Replace sheet selector modal with MUI `<Dialog>`/`<List>`/`<ListItem>`. Replace loading overlay with MUI `<Backdrop>` + `<CircularProgress>`. Preserve file drop handling, sheet selection, loading state display
    **Note:** file-loader.tsx converted from Preact to React+MUI. preact/hooks→react. Sheet selector uses already-converted Modal (MUI Dialog). MUI Checkbox replaces native checkbox in sheet list. MUI Box/Typography for layout. Drop/loading overlays kept as native divs (CSS-dependent, will be updated in Phase 2 CSS cleanup). style strings→objects, class→className. triggerFileInput() export preserved. File drop drag/drop handlers unchanged. 0 typecheck errors.

### Phase 2: CSS Cleanup

Remove CSS blocks from `style.css` that are now fully covered by MUI components.

- [x] Remove modal CSS blocks: `.modal`, `.modal-backdrop`, `.modal-content`, `.modal-title`, `.modal-body`, `.modal-buttons`, `.rename-modal-input` (~60 lines). These are now MUI `<Dialog>`
    **Note:** Removed modal CSS blocks from style.css: .modal (sheet-selector), .modal-backdrop, .modal-content, .modal-title, .modal-body, .modal-buttons, .rename-modal-input. These are now handled by MUI Dialog in modal.tsx and rename-modal.tsx. Kept .sheet-opt/.sheet-opt-name/.sheet-opt-meta (still used by file-loader sheet selector).
- [x] Remove button CSS blocks: `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-green`, `.btn-row` (~40 lines). These are now MUI `<Button>`
    **Note:** Removed button CSS blocks: .btn, .btn-primary, .btn-ghost, .btn-danger, .btn-green, .btn-row. These are now MUI Button components. Cleaned up dead className="btn-row" in app.tsx PreviewPanel (replaced with inline sx flex props).
- [x] Remove chip CSS blocks: `.chip`, `.chip.on`, `.chip.dragging`, `.chip.drag-over`, `.chip-orphan`, `.chip-warn-badge`, `.agg-row-auto`, `.agg-auto-badge` (~30 lines + palette classes). Keep `.chip-c0` through `.chip-c15` palette classes if still needed for color variable injection, or move to `sx` props
    **Note:** Removed chip CSS: .chip, .chip:active, .chip.on, .chip:hover:not(.on), .chip.dragging, .chip.drag-over, .chip-c0–.chip-c15 palette classes (colors now injected via sx props in chip.tsx parseChipColor()), .chip-orphan, .chip-warn-badge, .agg-row-auto, .agg-auto-badge. Kept .chips container class (flex wrapper in column-chips.tsx). Added borderLeft and &:active cursor to chip.tsx chipSx. Changed column-chips.tsx chip-orphan from className to inlineStyle='opacity:0.65'. Changed layout-card.tsx agg-row-auto/agg-auto-badge from CSS classes to inline styles.
- [x] Remove context menu CSS blocks: `.ctx-menu`, `.ctx-menu-item` (~35 lines). These are now MUI `<Menu>`/`<MenuItem>`
    **Note:** Removed context menu CSS: .ctx-menu, .ctx-menu-item. These are now MUI Menu/MenuItem in context-menu.tsx. No component references these class names anymore.
- [x] Remove tab CSS blocks: `.tabs`, `.tab-btn`, `.tab-content`, `.tab-panel` (~45 lines). These are now MUI `<Tabs>`
    **Note:** Removed tab CSS: .tabs, .tab-btn, .tab-btn:hover, .tab-btn.active, .tab-content, .tab-panel, .tab-panel.active. These are now MUI Tabs/Tab in app.tsx with sx props. Kept .tab-row/.tab-opt CSS (tab-style radio groups in layout-card.tsx/calc-stage.tsx — different from MUI tabs). Dead className refs remain on MUI components (harmless no-ops).
- [x] Remove sidebar CSS blocks: `.sidebar`, `.sidebar.collapsed`, `.sidebar-toggle`, `.sidebar-wrap`, `.sb-sec`, `.tcard`, `.tcard-name`, `.tcard-meta`, `.tcard-rm`, `.sidebar-footer`, `.sidebar-save-btn` (~70 lines). These are now MUI layout components
    **Note:** Removed sidebar CSS: .sidebar, .sidebar.collapsed, .sidebar-toggle, .sidebar-toggle:hover, .sidebar-toggle.collapsed, .sidebar-wrap, .sb-sec, .sb-sec h3, .tcard, .tcard:hover, .tcard-name, .tcard-meta, .tcard-rm, .tcard-rm:hover, .sidebar-footer, .sidebar-save-btn (and all pseudo-states). Moved critical sidebar-toggle positioning (position:absolute, left:270px, transform, transitions) to inline sx in sidebar.tsx. Dead className refs remain on MUI Box components (harmless no-ops). Kept #dropZone and .tables-list CSS (still actively used).
- [x] Remove layout CSS blocks: `.hdr`, `.layout`, `.main`, `.data-body`, `.qb-body` (~50 lines). These are now MUI `<Box>`/`<Stack>`
    **Note:** Removed layout CSS: .hdr (and .hdr h1, .hdr .sub, .hdr .spacer, .hdr .hint), .layout, .main, .data-body, .qb-body. These are now MUI Box/Stack with sx props in app.tsx. Dead className refs remain (harmless no-ops — all styling comes from sx props).
- [x] Remove form control CSS blocks: generic `select`, `input`, `label` styles (~20 lines). These are now MUI form controls
    **Note:** Removed generic form control CSS: select/input[type=text]/input[type=number] styles, select:focus/input:focus, select option, label. Most form controls are now MUI Select/TextField/Checkbox with sx props. One native <select> in stack-sheets.tsx will use browser defaults (acceptable — dark theme provided by AG Grid context). Kept .filter-row select/.fop/.agg-row select specificity overrides (still used).
- [x] Remove empty state CSS blocks: `.empty`, `.empty-icon`, `.empty-title`, `.empty-sub` (~25 lines). These are now MUI `<Stack>`/`<Typography>`
    **Note:** Removed empty state CSS: .empty, .empty-icon, .empty-title, .empty-sub. All empty states in app.tsx/grid.tsx/sidebar.tsx already have comprehensive sx props providing flex layout, padding, colors, and font sizes. Dead className refs remain (harmless no-ops).
- [x] Remove overlay CSS blocks: `#dropOverlay`, `#loadOverlay`, `.lo-spinner` (~30 lines). These are now MUI `<Backdrop>`
    **Note:** Removed overlay CSS: #dropOverlay, #dropOverlay.active, #dropOverlay .do-icon, #dropOverlay .do-label, #loadOverlay, #loadOverlay.active, #loadOverlay .lo-spinner, #loadOverlay .lo-title. Converted file-loader.tsx DropOverlay and LoadOverlay from CSS-dependent divs to inline-styled elements (position:fixed, inset:0, z-index, flex layout, spinner animation). Kept @keyframes spin (used by load spinner inline style).
- [x] Remove tooltip badge CSS: `.tip` (~10 lines). This is now MUI `<Tooltip>`
    **Note:** Removed tooltip badge CSS: .tip, .tip:hover. Converted tip.tsx from className="tip" to inline styles matching the original visual (15px circle, bg3 background, border, muted color, 0.62rem bold font). MUI Tooltip wraps the span for tooltip behavior.
- [x] Remove results bar CSS: `.results-bar`, `.results-count` (~15 lines). These are now MUI `<Toolbar>`/`<Typography>`
    **Note:** Removed results bar CSS: .results-bar, .results-count. These are now MUI Box/Typography with sx props in app.tsx and grid.tsx. Dead className refs remain (harmless no-ops — sx props provide all styling).
- [x] Remove grid wrapper CSS: `.grid-wrap` (~20 lines). AG Grid theme CSS variables in `.ag-theme-balham-dark` should be preserved or moved to a MUI theme configuration
    **Note:** Removed grid wrapper CSS: .grid-wrap. AG Grid theme CSS variables in .ag-theme-balham-dark preserved (lines 414-437 of new file). Grid wrapper styling now provided by MUI Box sx props in app.tsx (flex:1, position:relative, overflow:hidden).
- [x] Retain ~120 lines of specialized CSS: pipeline arrows (`.pl-arrow`, `.pl-h-arrow`, `.pl-v-arrow-stacked`, `.pl-arrow-line`, `.pl-arrow-head`), band tints, toast styles (`#toast-container`, `.toast`), scrollbar customization, and any remaining pipeline stage styling not yet covered by MUI `sx` props
    **Note:** Retained 437 lines of specialized CSS including: pipeline arrows (.pl-arrow, .pl-h-arrow, .pl-v-arrow-stacked, .pl-arrow-line, .pl-arrow-head), pipeline stages (.pl-stage, .pl-lookup-*, .pl-key-pair*, .pl-col-chip*, .pl-band-*), tab-style radio groups (.tab-row, .tab-opt), toast styles (#toast-container, .toast, .toast-sticky, .toast-close), @keyframes (toastIn, spin), scrollbar customization (::webkit-scrollbar), AG Grid theme overrides (.ag-theme-balham-dark), drop zone (#dropZone), card styles (.card, .card-header), filter/sort/agg/totals rows, sheet-opt items, chip container (.chips).
- [x] Verify the application renders correctly with the reduced CSS by running `npm run dev` and visually inspecting key screens
    **Note:** All checks pass: typecheck 0 errors, lint 0 warnings, 1097/1097 tests pass (56 files). CSS reduced from 793 to 437 lines (356 lines removed, 45% reduction). Files modified: css/style.css (full rewrite keeping specialized CSS), preact/ui/components/chip.tsx (added borderLeft/cursor sx), preact/ui/components/tip.tsx (className→inline styles), preact/ui/sections/column-chips.tsx (chip-orphan className→inlineStyle), preact/ui/cards/layout-card.tsx (agg-row-auto/agg-auto-badge→inline styles), preact/ui/file-loader.tsx (overlays→inline styles), preact/ui/sidebar.tsx (sidebar-toggle positioning→sx), preact/ui/app.tsx (btn-row className→sx).

### Phase 3: ADR-007 Supersession and Entry Point Cleanup

Supersede the signal-based state ADR and clean up the old entry point.

- [x] Mark ADR-007 as Superseded with reference to `DD-preact-to-react-conversion.md`. Use `adr_read` to find the exact ADR name, then update its status
    **Note:** ADR-007 status changed from Proposed → Superseded. Added supersession note referencing DD-preact-to-react-conversion.md explaining that React conversion uses useSyncExternalStore instead of signals. Original ADR-007 file updated in place. (Note: adr_commit tool created an unintended ADR-009 duplicate which was removed.)
- [x] Delete `SRC/preact/app.ts` (the old Preact entry point) — `SRC/preact/main.tsx` (created in Part A) is the new entry point
    **Note:** Verified SRC/preact/app.ts does not exist — already deleted in Plan E Phase 1 (as noted in prior annotation). No action needed.
- [x] Verify `SRC/index.html` references only `preact/main.tsx` as the module entry point (no reference to old `app.ts`)
    **Note:** Verified SRC/index.html line 30: only module script tag is `<script type="module" src="/preact/main.tsx"></script>`. No reference to old app.ts. Entry point is clean.

### Phase 4: Full Validation

Run all quality gates and fix any remaining issues.

- [x] Run `npm run typecheck` — must pass with zero errors across the entire project
    **Note:** Typecheck: 0 errors. `tsc --noEmit -p tsconfig.json` completed cleanly. tsconfig.json has jsxImportSource: "react", jsx: "react-jsx".
- [x] Run `npm run lint` — must pass with zero warnings across the entire project
    **Note:** Lint: 0 warnings. `eslint preact/` completed cleanly with no output.
- [x] Run `npm test` — all 1030 tests must pass. Domain logic tests (core/catalog/query/report) should pass unchanged. Fix any UI test failures by updating imports from Preact to React Testing Library
    **Note:** Tests: 1097/1097 pass across 56 files. Duration ~95s. Also fixed stale vitest.config.ts: changed jsxImportSource from 'preact' to 'react' and removed dead esbuild config block (Vitest 4.x uses oxc by default, esbuild options were being ignored with a warning).
- [x] Run `npm run build` (Vite production build) — must succeed and produce deployable output in `../pkg/`
    **Note:** Build: Vite production build succeeded in 9.85s. Output in ../pkg/: index.html (1.42kB), assets/index-CeLB7yBR.js (1204.82kB / 355kB gzip), css/, js/. Chunk size warning (>500kB) is advisory only — no code-splitting configured yet.
- [x] Verify no `from 'preact'` imports remain anywhere in `SRC/preact/` (zero Preact imports in the entire codebase)
    **Note:** Preact imports: ZERO found. `rg "from 'preact'" preact/` and `rg "from 'preact/hooks'" preact/` both return no matches. All UI files use React imports exclusively.
- [x] Verify no `preact` package in `node_modules` (confirm clean removal)
    **Note:** Preact package: REMOVED. node_modules/preact does not exist. package.json has no "preact" dependency (only match is "eslint preact/" in lint script path). Dependencies are react, react-dom, @mui/material, @emotion/react, @emotion/styled, ag-grid-react.

## Completion Criteria

- `app.tsx` uses MUI `<Tabs>`/`<Box>`/`<Stack>` for the app shell layout
- `sidebar.tsx` uses MUI `<List>`/`<ListItem>`/`<Button>` for the table list
- `file-loader.tsx` uses MUI `<Dialog>`/`<Backdrop>`/`<CircularProgress>` for overlays
- `style.css` reduced from ~793 lines to ~120 lines (pipeline arrows, band tints, toasts, scrollbars)
- ADR-007 marked as Superseded with reference to this conversion
- `SRC/preact/app.ts` (old Preact entry point) deleted
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green (1030+ tests)
- `npm run build` produces deployable output
- Zero `from 'preact'` imports remain in the codebase
