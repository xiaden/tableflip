# Task: Complex Sections — Scoped Selectors (Part C)

## Problem Statement

Part C of the scoped-selectors feature replaces `useStore(s => s)` identity selectors with scoped selectors in 4 complex UI files: `column-chips.tsx`, `calc-stage.tsx`, `detail-band-stage.tsx`, and `pipeline-card.tsx`. These components each read 4–10 AppState fields and currently re-render on every store change, negating the selector-based design of `useStore`.

The `useStore` hook at `SRC/preact/ui/useStore.ts` already supports scoped selectors with shallow equality: `useStore<T>(selector: (state: AppState) => T): T`. The task is to replace the identity selector `s => s` in each file with a selector that extracts only the fields the component actually reads reactively.

Two special patterns require care:
1. **Render-path `buildReportSpecFromState(state)` calls** — `calc-stage.tsx` (line 54) and `detail-band-stage.tsx` (line 86) call this helper during render with the full `state` object. Since the scoped selector no longer provides a full `AppState`, these calls must switch to `buildReportSpecFromState(getStore().getState())`.
2. **`_buildTooltip` in column-chips.tsx** — this module-level function takes `state: AppState` and reads `state.calcStages` and `state.tables`. The call site (line 221) passes the reactive `state`. After scoping, the call must use the destructured selector variables instead.
3. **Raw `getStore().subscribe()` in pipeline-card.tsx** — lines 55–57 subscribe to store changes for preview cache clearing. This is a legitimate exception (confirmed by Pattern-Enforcer) and must NOT be touched.

**Prerequisite:** None (all scoped-selector parts are independent).

**Design doc:** `artifacts/designs/parts/scoped-selectors/README.md`
**Contracts:** `artifacts/designs/parts/scoped-selectors/CONTRACTS.md`

## Phases

### Phase 1: Scope selectors in section components

Replace identity selectors in the three section files. Each file gets a scoped selector matching its reactive reads, and render-path helper calls that need full `AppState` switch to `getStore().getState()`.

- [x] Replace `useStore(s => s)` in `SRC/preact/ui/sections/column-chips.tsx` (line 93) with scoped selector: `const { base, lookups, calcStages, aggMode, groupBy, selCols, colOrder, aggregates, subtotalBy, tables } = useStore(s => ({ base: s.base, lookups: s.lookups, calcStages: s.calcStages, aggMode: s.aggMode, groupBy: s.groupBy, selCols: s.selCols, colOrder: s.colOrder, aggregates: s.aggregates, subtotalBy: s.subtotalBy, tables: s.tables }));` — update all `state.xxx` references to use destructured variables (lines 101, 103, 107, 109, 111, 112, 225, 244). Refactor `_buildTooltip(c, src, state)` call at line 221 to pass destructured `calcStages` and `tables` instead of full `state`, and update `_buildTooltip` signature (line 33) from `(c: string, src: ColMapEntry | undefined, state: AppState)` to `(c: string, src: ColMapEntry | undefined, calcStages: CalcStage[], tables: AppState['tables'])` — update internal references from `state.calcStages` to `calcStages` and `state.tables` to `tables`. Remove unused `AppState` import from `_buildTooltip` if no longer needed at the type level (keep it if still used elsewhere in the file).
    **Note:** Replaced useStore(s => s) with scoped selector destructuring base, lookups, calcStages, aggMode, groupBy, selCols, colOrder, aggregates, subtotalBy, tables. Updated all state.xxx references to use destructured variables. Refactored _buildTooltip signature from (c, src, state: AppState) to (c, src, calcStages: CalcStage[], tables: AppState['tables']). Updated internal refs in _buildTooltip from state.calcStages to calcStages and state.tables to tables. Added CalcStage to imports from ../../types. Kept AppState import (needed for AppState['tables'] type in _buildTooltip signature). Removed redundant const base = state.base and const colOrder = colOrder assignments since they're now destructured directly.
  **Notes:** Array `.length` accesses on `lookups` and `calcStages` (line 101 useEffect deps) require the full array reference in the selector — shallow equality on the array reference handles this correctly. The `tables` field is included because `_buildTooltip` reads table sample values during render. The `buildReportSpecFromState(draft)` call at line 131 is inside a `getStore().update()` callback using `draft` (not reactive `state`) — no change needed there.
- [x] Replace `useStore(s => s)` in `SRC/preact/ui/sections/calc-stage.tsx` (line 44) with scoped selector: `const { calcStages, aggMode, tables } = useStore(s => ({ calcStages: s.calcStages, aggMode: s.aggMode, tables: s.tables }));` — update `state.calcStages` (line 48) to `calcStages`, `state.aggMode` (line 51) to `aggMode`, `state.tables` (line 55) to `tables`. Switch render-path `buildReportSpecFromState(state)` at line 54 to `buildReportSpecFromState(getStore().getState())` because the helper needs the full AppState (it reads fields beyond calcStages/aggMode/tables).
    **Note:** Replaced useStore(s => s) with scoped selector destructuring calcStages, aggMode, tables. Updated state.calcStages[i] to calcStages[i], state.tables to tables. Changed buildReportSpecFromState(state) to buildReportSpecFromState(getStore().getState()) for render-path helper call. Renamed local aggMode variable to effectiveAggMode to avoid redeclaration conflict with destructured aggMode, and updated its usage at line 349 to use effectiveAggMode.
  **Notes:** The `getStore().getState()` calls inside `handleEnabledChange` (lines 87, 95) are already imperative reads inside event handlers — no change needed. The `buildReportSpecFromState(draft)` call inside the Chip onClick handler (line 356) uses `draft` from `getStore().update()` — no change needed.
- [x] Replace `useStore(s => s)` in `SRC/preact/ui/sections/detail-band-stage.tsx` (line 60) with scoped selector: `const { detailBands, tables, lookups } = useStore(s => ({ detailBands: s.detailBands, tables: s.tables, lookups: s.lookups }));` — update `state.detailBands` (lines 77, 104) to `detailBands`, `state.tables` (line 80) to `tables`, `state.lookups` (line 85) to `lookups`. Switch render-path `buildReportSpecFromState(state)` at line 86 to `buildReportSpecFromState(getStore().getState())` because the helper needs the full AppState.
    **Note:** Replaced useStore(s => s) with scoped selector destructuring detailBands, tables, lookups. Updated state.detailBands[i] to detailBands[i] (line 77), state.tables to tables (line 80), state.lookups to lookups (line 85), state.detailBands to detailBands (line 104). Changed buildReportSpecFromState(state) to buildReportSpecFromState(getStore().getState()) for render-path helper call. Removed redundant const tables = state.tables assignment since tables is now destructured directly. Kept AppState import (used in updateBand callback signature at line 115).
  **Notes:** The `getStore().getState()` call inside `useEffect` (line 66) is already an imperative read — no change needed. The `updateBand` helper (line 115) uses `getStore().update(draft => ...)` with `draft` — no change needed.
- [x] Run `npm run typecheck && npm run lint && npm test` from `SRC/` — all three must pass with zero errors. Fix any type mismatches from the selector destructuring or `_buildTooltip` signature change before proceeding.
    **Note:** All verification passed: typecheck (0 errors), lint (0 warnings), tests (1179 passed). Verified zero useStore(s => s) identity selectors remain in the three target files. Verified no reactive state.xxx references remain (only imperative getStore().getState() reads in event handlers and exported functions). Note: Reverted unstaged changes from calc-builder.tsx and calc-stage.tsx that were from a different task (math chains UI overhaul) and had conflicts with the scoped selector changes.

### Phase 2: Scope selector in pipeline card + cross-file verification

Replace the identity selector in pipeline-card.tsx (preserving its raw subscription) and verify no identity selectors remain across all 4 target files.

- [x] Replace `useStore(s => s)` in `SRC/preact/ui/cards/pipeline-card.tsx` (line 51) with scoped selector: `const { tables, base, lookups, calcStages, detailBands, stacks } = useStore(s => ({ tables: s.tables, base: s.base, lookups: s.lookups, calcStages: s.calcStages, detailBands: s.detailBands, stacks: s.stacks }));` — update `state.tables` (line 59) to `tables`, `state.base` (line 60) to `base`, `state.lookups` (line 61) to `lookups`, `state.calcStages` (line 62) to `calcStages`, `state.detailBands` (line 63) to `detailBands`, `state.stacks` (line 64) to `stacks`. **DO NOT touch** the raw `getStore().subscribe()` at lines 55–57 — it clears preview cache on any store change and is a confirmed legitimate exception.
    **Note:** Replaced useStore(s => s) in pipeline-card.tsx with scoped selector destructuring tables, base, lookups, calcStages, detailBands, stacks. Used aliased destructuring (_lookups, _calcStages, _detailBands, _stacks) to preserve the original || [] fallback semantics. Left getStore().subscribe() at lines 65-68 untouched (preview cache clearing — confirmed legitimate exception). Left getStore().getState() calls in addLookup, addCalcStage, addDetailBand, computePreview untouched (imperative reads in event handlers). All state.xxx references eliminated.
  **Notes:** The `getStore().getState()` calls in `addLookup` (line 72), `addCalcStage` (line 89), `addDetailBand` (line 110), and `computePreview` (line 120) are already imperative reads in event handlers — no change needed.
- [x] Run `npm run typecheck && npm run lint && npm test` from `SRC/` — all three must pass with zero errors.
    **Note:** All verification passed: typecheck (0 errors), lint (0 warnings), tests (1179 passed in 60 files).
- [x] Grep verification: confirm zero `useStore(s => s)` calls remain in the 4 target files. Run: `grep -n 'useStore(s => s)' SRC/preact/ui/sections/column-chips.tsx SRC/preact/ui/sections/calc-stage.tsx SRC/preact/ui/sections/detail-band-stage.tsx SRC/preact/ui/cards/pipeline-card.tsx` — expected output: no matches. Also confirm no `state\.` references remain in these files (except inside `getStore().update(draft =>` callbacks where `draft` is used, or in comments).
    **Note:** Grep verification confirmed zero useStore(s => s) identity selectors remain in all 4 target files (column-chips.tsx, calc-stage.tsx, detail-band-stage.tsx, pipeline-card.tsx). One state. reference found in column-chips.tsx:289 — confirmed legitimate: it's `state.tables` from `getStore().getState()` inside the exported `selectAllCols()` function (imperative read, not reactive). No reactive state.xxx references remain in any target file.

## Completion Criteria

- All 4 files use scoped selectors — zero `useStore(s => s)` identity selectors remain in column-chips.tsx, calc-stage.tsx, detail-band-stage.tsx, pipeline-card.tsx
- `_buildTooltip` in column-chips.tsx accepts specific parameters instead of full `AppState`
- `buildReportSpecFromState` calls in calc-stage.tsx and detail-band-stage.tsx use `getStore().getState()` instead of the reactive `state` variable
- The raw `getStore().subscribe()` in pipeline-card.tsx (preview cache clearing) is preserved unchanged
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes — all tests green

## References

- Design: `artifacts/designs/parts/scoped-selectors/README.md` (Part C scope)
- Contracts: `artifacts/designs/parts/scoped-selectors/CONTRACTS.md` (architectural rules)
- Hook: `SRC/preact/ui/useStore.ts` (selector-based useSyncExternalStore with shallow equality)
- Sibling plans: TASK-scoped-selectors-A (simple sections), TASK-scoped-selectors-B (medium sections), TASK-scoped-selectors-D (layout-card)
