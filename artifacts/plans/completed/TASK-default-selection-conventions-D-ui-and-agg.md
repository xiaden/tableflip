# Task: UI Layer & aggModeState

## Problem Statement

TableFlip's UI layer uses a "null means ALL" convention for pool-selection fields (`DetailBandSpec.cols`, `AppState.selCols`, `AppState.colOrder`). This manifests as **materialization cascades** — hidden state transitions where the first user interaction silently converts `null` to a full column list. Part A of this refactoring has already changed the type definitions to non-nullable (`string[]`, `Set<string>`). This plan (Part D) updates the three UI/Report-layer files that actively assign `null` or rely on null-materialization patterns, making them compile under the new types and eliminating the cascades.

`ui/aggregation.ts` is the highest-priority file: it actively assigns `null` to `draft.selCols` inside `loadAggModeState()` (lines 124, 132, 139, 151), which will be a TypeError after Part A's type change. `detail-band-stage.tsx` and `column-chips.tsx` contain materialization cascades and null-check patterns that must be replaced with direct operations on always-populated data structures.

**Prerequisite:** TASK-default-selection-conventions-A-types-and-state (Part A — non-nullable type definitions).

## Phases

### Phase 1: aggregation.ts — aggModeState null assignments
Fix `ui/aggregation.ts` which actively assigns `null` to `draft.selCols` and returns `null` from `_selColsToArray`. These are TypeErrors under the new non-nullable `Set<string>` type.

- [ ] Change `_selColsToArray` return type from `string[] | null` to `string[]` at `SRC/preact/ui/aggregation.ts` line 21
- [ ] Change `_selColsToArray` fallback return from `return null` to `return []` at `SRC/preact/ui/aggregation.ts` line 24
- [ ] Change `loadAggModeState` group-mode branch: `draft.selCols = Array.isArray(savedState.selCols) ? new Set(savedState.selCols as string[]) : null` → replace `: null` with `: new Set()` at `SRC/preact/ui/aggregation.ts` line 124
- [ ] Change `loadAggModeState` totals-mode branch: same pattern `: null` → `: new Set()` at `SRC/preact/ui/aggregation.ts` line 132
- [ ] Change `loadAggModeState` subtotals-mode branch: same pattern `: null` → `: new Set()` at `SRC/preact/ui/aggregation.ts` line 139
- [ ] Change `loadAggModeState` none-mode branch: same pattern `: null` → `: new Set()` at `SRC/preact/ui/aggregation.ts` line 151

### Phase 2: detail-band-stage.tsx — band column selection
Remove all null-materialization patterns from the detail band column selection handlers. Under the new convention, `bandDraft.cols` is always a `string[]` — populate with the full child table column list on table assignment, never use `null` for "all."

- [ ] Change `handleRightIdChange`: `bandDraft.cols = null` → `bandDraft.cols = rt ? [...rt.cols] : []` at `SRC/preact/ui/sections/detail-band-stage.tsx` line 120, where `rt` is the resolved child table from `bandDraft.rightId` (lookup via `_draft.tables[bandDraft.rightId]`; note that inside the `updateBand` callback, `rt` is not in scope so the table must be resolved from `_draft.tables`)
- [ ] Remove null materialization in `toggleCol`: change `let cols = bandDraft.cols == null ? [...rtCols] : [...bandDraft.cols]` → `let cols = [...bandDraft.cols]` at `SRC/preact/ui/sections/detail-band-stage.tsx` lines 172-173, and delete the comment on line 172 (`// null means "all selected" — materialize as all except the one being deselected`)
- [ ] Change `selectAllCols`: `bandDraft.cols = null` → `bandDraft.cols = [...rtCols]` at `SRC/preact/ui/sections/detail-band-stage.tsx` line 187, where `rtCols` is computed the same way as in `toggleCol` (from `_draft.tables[bandDraft.rightId].cols`)
- [ ] Verify `selectNoneCols` at `SRC/preact/ui/sections/detail-band-stage.tsx` line 194 already sets `bandDraft.cols = []` — no change needed
- [ ] Change chip `isSelected` computation: `band.cols == null || band.cols!.includes(c)` → `band.cols.includes(c)` at `SRC/preact/ui/sections/detail-band-stage.tsx` line 297

### Phase 3: column-chips.tsx — selCols and colOrder materialization removal
Remove all materialization cascades from `column-chips.tsx`. Under the new convention, `state.selCols` is always a `Set<string>` and `state.colOrder` is always a `string[]` — no null checks or lazy population needed.

- [ ] Remove the entire `selCols` null-init `useEffect` block at `SRC/preact/ui/sections/column-chips.tsx` lines 101-114 (the `if (!st.selCols) { ... }` block that populates `draft.selCols = new Set(currentCols)` and updates `_seenCols`)
- [ ] Remove the `colOrder` null-init branch at `SRC/preact/ui/sections/column-chips.tsx` lines 122-123 (the `if (!st.colOrder) { ... }` block inside the sync `useEffect`), keeping the `else` branch logic (lines 124-138) as the unconditional sync path
- [ ] Change `colOrder` fallback: `const colOrder = state.colOrder || cols` → `const colOrder = state.colOrder` at `SRC/preact/ui/sections/column-chips.tsx` line 153
- [ ] Remove null materialization in `handleDblClick` (none-mode branch): delete the `if (!draft.selCols) { ... }` guard at `SRC/preact/ui/sections/column-chips.tsx` lines 192-196, keeping only the direct toggle logic (`const s = draft.selCols; if (s.has(col)) s.delete(col); else s.add(col);`) at lines 197-199
- [ ] Remove null materialization in `onDrop` handler: delete the `if (!draft.colOrder) { ... }` guard at `SRC/preact/ui/sections/column-chips.tsx` lines 235-239, and change non-null assertions `draft.colOrder!.indexOf(...)` → `draft.colOrder.indexOf(...)` at lines 240-244

### Phase 4: Compilation verification
Run typecheck to confirm all three modified files compile cleanly under the non-nullable types from Part A.

- [ ] Run `npm run typecheck` from `SRC/` and capture error output
- [ ] Verify zero errors in `SRC/preact/ui/aggregation.ts`
- [ ] Verify zero errors in `SRC/preact/ui/sections/detail-band-stage.tsx`
- [ ] Verify zero errors in `SRC/preact/ui/sections/column-chips.tsx`
- [ ] Log any unexpected errors to the agent log with category `discovery`

## Completion Criteria

- `_selColsToArray` returns `string[]` (never `null`); fallback is `[]`
- All four `loadAggModeState` branches assign `new Set()` instead of `null` when `savedState.selCols` is not an array
- `handleRightIdChange` populates `bandDraft.cols` with full child table column list (not `null`)
- `toggleCol` uses direct array spread without null materialization
- `selectAllCols` sets `bandDraft.cols = [...rtCols]` (not `null`)
- Chip `isSelected` uses `band.cols.includes(c)` without null guard
- `column-chips.tsx` has zero `if (!st.selCols)` or `if (!st.colOrder)` materialization blocks
- `colOrder` local variable is `state.colOrder` without `|| cols` fallback
- `handleDblClick` and `onDrop` perform direct Set/array operations without null guards
- `npm run typecheck` produces zero errors in all three modified files
- No test files are modified (Part E scope)
- No hydration or serialization files are modified (Part B scope)

## References

- Design doc: `artifacts/designs/pending/DD-default-selection-conventions.md`
- Parts README: `artifacts/designs/parts/default-selection-conventions/README.md`
- Contracts ledger: `artifacts/designs/parts/default-selection-conventions/CONTRACTS.md`
- Upstream plan: TASK-default-selection-conventions-A-types-and-state.md (Part A)
- Sibling plans: Part B (Hydration & Serialization), Part C (Consumer Sites), Part E (Test Fixtures)
