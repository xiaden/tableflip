# Task: User Override UI via Context Menu

## Problem Statement

Part E of the "Column-Type-Aware SQL WHERE" feature. Parts B (catalog) and D (persistence) have added `colType` to colMap entries and made `columnTypeOverrides` survive save/load. However, there is no user-facing way to set these overrides. This plan adds "Change column type" items to the column header context menu in the preview grid (and result grid), allowing users to override the auto-detected column type for any physical column.

**What:** Extend `CtxMenuItem` with an optional `checked` property for checkmark rendering. Modify `_makeHeaderComponent` in `grid.tsx` to accept an `onContextMenu` callback. Add four flat type-selection items ("Type: String", "Type: Number", "Type: Date", "Type: Boolean") with a checkmark on the active type. On selection, update `draft.columnTypeOverrides[tid][col]` in the store and call `invalidateValidation()`.

**Why:** Without a UI, users cannot correct auto-detection mistakes (e.g., a zip code column detected as `'number'` when it should be `'string'`). The context menu is the natural location — it already exists for column operations (rename). Flat items (no submenu) per the user decision documented in the contracts ledger.

**Scope:**
- `preact/ui/components/context-menu.tsx` — extend `CtxMenuItem` with `checked?: boolean`, render checkmark indicator
- `preact/ui/grid.tsx` — add `onContextMenu` parameter to `_makeHeaderComponent`, add context menu state management to `PreviewGrid` and `ResultGrid`, build type-change items, wire store update + `invalidateValidation()`

**Out of scope:** Submenu support in ContextMenu (explicitly rejected). Type-change for calc columns (their type is derived from mode, not overridable). Type-change for `_rowno` (synthetic column, always numeric). CSS styling for checkmarks (using Unicode ✓ character inline — consistent with existing label-based approach).

**Prerequisite:** Part B (catalog — `colType` on `PhysicalColEntry`/`BandColEntry`, `buildColSourceMap` resolves effective type from `columnTypeOverrides ?? colTypes`). Part D (persistence — `columnTypeOverrides` survives save/load). If these are not yet in source, this plan is BLOCKED.

## Phases

### Phase 1: Context Menu Checked Item Support
- [x] Add optional `checked?: boolean` property to `CtxMenuItem` interface in `preact/ui/components/context-menu.tsx` (after `action`, line 6)
    **Note:** Added `checked?: boolean` property to CtxMenuItem interface in SRC/preact/ui/components/context-menu.tsx (line 7), after `action`.
- [x] Update the button rendering in `ContextMenu` component (line 42-49) to prepend a checkmark indicator when `item.checked` is true — use `'✓ '` prefix before `item.label`, or render a `<span>` with the checkmark character before the label text
    **Note:** Updated button rendering in ContextMenu component (line 49) to use ternary: `item.checked ? '✓ ' + item.label : item.label`. Uses Unicode ✓ character with trailing space prefix, not a styled element.
- [x] Verify existing callers (base-stage.tsx, column-chips.tsx, lookup-stage.tsx, calc-stage.tsx, detail-band-stage.tsx) are unaffected — `checked` is optional, existing items without it render unchanged
    **Note:** Verified all 5 existing callers (base-stage.tsx, column-chips.tsx, lookup-stage.tsx, calc-stage.tsx, detail-band-stage.tsx) import CtxMenuItem but none pass `checked`. All `checked` usages in those files are for HTML checkbox/radio inputs, unrelated to CtxMenuItem. Backward compatibility confirmed.
- [x] Run `npm run typecheck` — must pass with zero errors
    **Note:** `npm run typecheck` passed with zero errors (tsc --noEmit -p tsconfig.json, exit 0).

### Phase 2: Grid Header Context Menu for Column Type
- [x] Add `ColumnType` to the import from `'../types'` in `preact/ui/grid.tsx` (line 15)
    **Note:** Added ColumnType to import from '../types' in grid.tsx line 15.
- [x] Add `invalidateValidation` to imports from `'../report/validation'` — add new import line: `import { invalidateValidation } from '../report/validation';`
    **Note:** Added imports: invalidateValidation from '../report/validation', useState from 'preact/hooks' (merged with existing useRef/useEffect), ContextMenu and CtxMenuItem from './components/context-menu'. Consolidated into clean import block (lines 14-22).
- [x] Add `onContextMenu: ((e: MouseEvent) => void) | null` parameter to `_makeHeaderComponent` function signature (after `onClear`, line 486). Default `null` for backward compatibility.
    **Note:** Added onContextMenu: ((e: MouseEvent) => void) | null = null as 7th parameter to _makeHeaderComponent (line 527). Default null for backward compatibility.
- [x] In `_makeHeaderComponent.init()`, add `contextmenu` event handler to the "⋯" more-button (alongside the existing `click` handler at line 514): `more.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); if (onContextMenu) onContextMenu(e); });`
    **Note:** Added contextmenu event handler on the more-button (line 557). Also changed button creation condition from 'if (onRename)' to 'if (onRename || onContextMenu)' so the button appears even when only context menu is available. Click handler now guards with 'if (onRename)' to handle the case where onRename is null but onContextMenu is set.
- [x] Update `makePreviewCols` function signature to accept `onTypeContextMenu: ((e: MouseEvent, tid: string, col: string) => void) | null` parameter. Pass it to `_makeHeaderComponent` as the `onContextMenu` argument, wrapping it: `onContextMenu: onTypeContextMenu ? (e) => onTypeContextMenu(e, tid, c) : null`
    **Note:** Updated makePreviewCols signature to accept onTypeContextMenu as 4th param (line 474). Updated _makeHeaderComponent call to pass wrapped onContextMenu (line 508): 'onTypeContextMenu ? (e) => onTypeContextMenu(e, tid, c) : null'.
- [x] Update `makeResultCols` function signature to accept the same `onTypeContextMenu` parameter. For each column, look up `colMap.get(c)` to get the source entry. Only pass `onContextMenu` for physical/band columns (where `src` has `tid`). Calc columns get `null`.
    **Note:** Updated makeResultCols signature to accept onTypeContextMenu as 3rd param (line 421). Added 7th arg to _makeHeaderComponent call (line 460): only passes onContextMenu for physical/band columns (src.kind !== 'calc'), null for calc columns.
- [x] Add context menu state to `PreviewGrid` component: `const [ctxMenu, setCtxMenu] = useState<{x: number; y: number; items: CtxMenuItem[]} | null>(null);` — add `useState` to the preact/hooks import (line 14). Import `ContextMenu` and `CtxMenuItem` from `'./components/context-menu'`.
    **Note:** Added useState for ctxMenu state in PreviewGrid (line 250). Imports for useState, ContextMenu, and CtxMenuItem were already added in P2-S2.
- [x] In `PreviewGrid`, create the `onTypeContextMenu` callback that: (1) reads current state via `getStore().getState()`, (2) gets current effective type from `state.columnTypeOverrides?.[tid]?.[col] ?? state.tables[tid]?.colTypes?.[col] ?? 'string'`, (3) builds four `CtxMenuItem` entries — one per `ColumnType` value (`'string'`, `'number'`, `'date'`, `'boolean'`) — each with `label: 'Type: ' + type.charAt(0).toUpperCase() + type.slice(1)`, `checked: currentType === type`, and `action: () => { getStore().update(draft => { if (!draft.columnTypeOverrides[tid]) draft.columnTypeOverrides[tid] = {}; draft.columnTypeOverrides[tid][col] = type; }); invalidateValidation(); }`. (4) Calls `setCtxMenu({ x: e.clientX, y: e.clientY, items })`.
    **Note:** Added onTypeContextMenu callback in PreviewGrid (lines 252-267). Reads current effective type from columnTypeOverrides ?? colTypes ?? 'string', builds 4 CtxMenuItem entries with checked indicator, updates store and calls invalidateValidation on selection.
- [x] Pass `setCtxMenu`-based callback to `makePreviewCols` call at line 289 as the new last argument
    **Note:** Updated makePreviewCols call in PreviewGrid useEffect to pass onTypeContextMenu as 4th arg (line 328).
- [x] Add `ContextMenu` render to `PreviewGrid` JSX: after the grid `<div>`, add `{ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}`
    **Note:** Added ContextMenu render in PreviewGrid JSX after grid div (line 410): '{ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}'.
- [x] Add the same context menu state and rendering to `ResultGrid` component: `useState` for `ctxMenu`, `onTypeContextMenu` callback builder, pass to `makeResultCols`, render `<ContextMenu>` in JSX. The callback resolves `tid` from `colMap.get(c)` for physical/band columns.
    **Note:** Added same context menu pattern to ResultGrid: useState for ctxMenu (line 134), onTypeContextMenu callback (lines 136-151), passed to makeResultCols (line 169), ContextMenu render in JSX (line 225).
- [x] Run `npm run typecheck` — must pass with zero errors
    **Note:** npm run typecheck passed with zero errors (tsc --noEmit -p tsconfig.json, exit 0). File grew from 532 to 575 lines.

### Phase 3: Verification
- [x] Run `npm run lint` — zero warnings required
    **Note:** npm run lint passed with zero warnings (eslint preact/, exit 0, no output)
- [x] Run `npm test` — all existing tests must pass (no new test file — this is pure UI wiring with no testable business logic beyond what Parts B/C/D already cover)
    **Note:** npm test passed — all 948 tests across 53 test files passed (vitest run, 67.49s)
- [x] Manual verification checklist: right-click a column header "⋯" button in the preview grid → context menu appears with four "Type: ..." items; the auto-detected type shows a ✓ checkmark; clicking a different type updates the store and triggers re-validation; saving and reloading preserves the override
    **complete:** PLAN E COMPLETE — 3 phases, 19 steps, 0 fix cycles. QA Review Round 1: PASS. All 10 contracts verified. Typecheck/lint/test pass.
    **Note:** SKIPPED (manual verification) — requires interactive UI testing: right-click column header ⋯ button, verify context menu appears with four Type: items, checkmark on active type, store update + re-validation on selection, persistence across save/reload

## Completion Criteria
- `CtxMenuItem` has optional `checked?: boolean` property; `ContextMenu` renders a ✓ indicator for checked items
- `_makeHeaderComponent` accepts `onContextMenu` callback and wires it to the "⋯" button's `contextmenu` event
- `PreviewGrid` shows a context menu with four type items on right-click of column header "⋯" button
- `ResultGrid` shows the same context menu for physical/band columns (calc columns excluded)
- Active type shows a ✓ checkmark in the menu
- Selecting a type updates `store.columnTypeOverrides[tid][col]` and calls `invalidateValidation()`
- Left-click on "⋯" still triggers rename (existing behavior preserved)
- Existing context menu callers (base-stage, column-chips, lookup-stage, calc-stage, detail-band-stage) are unaffected by the `CtxMenuItem` interface extension
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## Contracts

### Created
- `CtxMenuItem.checked?: boolean` — optional field added to existing interface in `context-menu.tsx`
- `_makeHeaderComponent` — new `onContextMenu` parameter (7th parameter, `((e: MouseEvent) => void) | null`)
- `makePreviewCols` — new `onTypeContextMenu` parameter (4th parameter)
- `makeResultCols` — new `onTypeContextMenu` parameter (3rd parameter)

### Called (from Part B)
- `buildColSourceMap() -> Map<string, ColSourceEntry>` — used to resolve column source (tid, col) for result grid columns
- `ColSourceEntry` with `tid` and `col` for physical/band entries — used to determine table ID for override

### Called (from foundations)
- `AppState.columnTypeOverrides: Record<string, Record<string, ColumnType>>` — written via `store.update()`
- `ColumnType = 'string' | 'number' | 'date' | 'boolean'` — used to build menu items
- `DbTable.colTypes?: Record<string, ColumnType>` — read to determine current effective type for checkmark

### Called (from report layer)
- `invalidateValidation()` — called after every type override change to force re-validation

## References
- Design doc: `artifacts/designs/pending/DD-dd-column-type-aware-where.md` (Phase 7, point 5)
- Parts README: `artifacts/designs/parts/column-type-aware-where/README.md` (Part E)
- Contracts ledger: `artifacts/designs/parts/column-type-aware-where/CONTRACTS.md` (flat items decision)
- UI layer instructions: `.opencode/instructions/ui-layer.instructions.md`
- Context menu pattern precedent: `base-stage.tsx` lines 104-117, `column-chips.tsx` lines 286-288
- Sibling plans: Part B (Catalog), Part C (SQL Generation), Part D (Persistence)
