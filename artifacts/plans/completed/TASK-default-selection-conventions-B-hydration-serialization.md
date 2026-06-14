# Task: State Hydration & Serialization

## Problem Statement

The default-selection-conventions refactoring (Part A) removes `| null` from 7 pool-selection type fields and changes factory defaults from `null` to empty arrays/Sets. Part B updates the hydration and serialization layer to match.

**Current hydration** uses a binary pattern: if the payload has an array, use it; otherwise set `null`. This produces `null` values that consumers interpret as "ALL" — the inverted convention being refactored.

**New hydration** uses an overlay strategy: pre-populate with the full list (when the pool is available), then overlay the saved payload if it's an explicit array. If the payload is `null` or missing, the full list is kept — preserving backward compatibility with old `.rcjson` files where `null` meant "all."

**Current serialization** uses truthy-null guards (`state.baseCols ? [...state.baseCols] : null`). After Part A's type changes, these fields are always arrays, so the null branches become dead code.

**Scope:** `core/state-hydrator.ts` (overlay algorithm for 5 directly-hydrated fields + 3 aggModeState sub-selections), `core/state-serializer.ts` (remove null branches). Test fixture updates are OUT OF SCOPE (Part E). Consumer/UI fixes are OUT OF SCOPE (Parts C/D).

**Prerequisite:** Part A (non-nullable types, factory defaults).

## Phases

### Phase 1: baseCols Overlay Hydration
Replace the binary null/Array pattern at `state-hydrator.ts:56-62` with the overlay strategy: pre-populate from the base table's full column list, then overlay the saved array if present.

- [ ] At `state-hydrator.ts:56`, BEFORE the existing `if (Array.isArray(payload.baseCols))` check, insert pre-population: `if (baseLoaded) { next.baseCols = [...loadedTables[savedBase].cols]; }` — this fills baseCols with the full base table column list when the base table is loaded
- [ ] Change the `else` branch at `state-hydrator.ts:60-61` from `next.baseCols = null;` to a no-op (delete the else branch entirely) — when payload.baseCols is null/missing, the pre-populated full list is kept
- [ ] Keep the existing `if (Array.isArray(payload.baseCols))` block at lines 56-59 intact (validation of dropped columns + `next.baseCols = [...payload.baseCols]`) — this overlays the saved selection on top of the pre-populated full list
- [ ] Verify the resulting logic: (1) baseLoaded + payload null → full list, (2) baseLoaded + payload array → saved array, (3) !baseLoaded + payload null → `[]` (from factory), (4) !baseLoaded + payload array → saved array

### Phase 2: selCols and colOrder Overlay Hydration
Replace the null/Array pattern at `state-hydrator.ts:185-194` with the overlay strategy. Pre-populate with full projected column list, then overlay saved selections if present.

- [ ] At `state-hydrator.ts:183`, AFTER `const available = nextAvailableCols();`, insert pre-population: `next.selCols = new Set(available);` — fills selCols with all projected columns
- [ ] Replace the three-way branch at `state-hydrator.ts:185-193` (`payload.selCols === null` → null; `Array.isArray` → Set; else → null) with: `if (Array.isArray(payload.selCols)) { ... }` — only overlay when payload is an explicit array
- [ ] Inside the new `if (Array.isArray(payload.selCols))` block, keep the existing validation (dropped column check at old lines 188-189) and assignment `next.selCols = new Set(payload.selCols);` (old line 190)
- [ ] Remove the `payload.selCols === null` branch (old lines 185-186) that set `next.selCols = null` — the pre-populated full Set is kept instead
- [ ] Remove the `else` branch (old lines 191-192) that set `next.selCols = null` — the pre-populated full Set is kept instead
- [ ] Replace `state-hydrator.ts:194` (`next.colOrder = Array.isArray(payload.colOrder) ? [...payload.colOrder] : null;`) with: pre-populate `next.colOrder = [...available];` then overlay `if (Array.isArray(payload.colOrder)) { next.colOrder = [...payload.colOrder]; }`
- [ ] Verify the resulting selCols logic: (1) payload null → full Set, (2) payload array → saved Set, (3) payload missing → full Set, (4) payload empty array → empty Set (new capability: "none selected")
- [ ] Verify the resulting colOrder logic: (1) payload array → saved order, (2) payload null/missing → full natural order

### Phase 3: aggModeState Sub-selection Overlay Hydration
Replace null defaults with empty arrays for the three `selCols` sub-selections inside `aggModeState` at `state-hydrator.ts:272, 281, 285`. These are `aggModeState.none.selCols`, `aggModeState.totals.selCols`, and `aggModeState.subtotals.selCols`.

- [ ] At `state-hydrator.ts:272`, change `selCols: Array.isArray(rawNone.selCols) ? [...rawNone.selCols] : null` to `selCols: Array.isArray(rawNone.selCols) ? [...rawNone.selCols] : []`
- [ ] At `state-hydrator.ts:281`, change `selCols: Array.isArray(rawTotals.selCols) ? [...rawTotals.selCols] : null` to `selCols: Array.isArray(rawTotals.selCols) ? [...rawTotals.selCols] : []`
- [ ] At `state-hydrator.ts:285`, change `selCols: Array.isArray(rawSubtotals.selCols) ? [...rawSubtotals.selCols] : null` to `selCols: Array.isArray(rawSubtotals.selCols) ? [...rawSubtotals.selCols] : []`
- [ ] Note: The outer sub-objects (`none`, `totals`, `subtotals`) can still be `null` when not configured — this is unchanged. Only the inner `selCols` field changes from `null` to `[]` as the default. Full overlay population for aggModeState sub-selections (using projected columns) is deferred to Part D which handles `ui/aggregation.ts`

### Phase 4: Detail Band cols Normalization
Change `band.cols` hydration to preserve empty arrays as empty (instead of normalizing to `null`). This affects two code paths: the broken-table fallback and the normal validation path.

- [ ] At `state-hydrator.ts:347` (broken-table fallback), change `cols: Array.isArray(band.cols) ? (band.cols.length > 0 ? [...band.cols] : null) : null` to `cols: Array.isArray(band.cols) ? [...band.cols] : []` — preserves empty arrays as empty, uses empty array for missing data
- [ ] At `state-hydrator.ts:364` (normal path), change `const cols = Array.isArray(band.cols) ? band.cols.filter((c: string) => rt.cols.includes(c)) : null` to `const cols = Array.isArray(band.cols) ? band.cols.filter((c: string) => rt.cols.includes(c)) : []` — preserves empty filter results as empty, uses empty array for missing data
- [ ] Verify: Under the new convention, `band.cols = []` means "no columns selected" (not "all columns"). Old files with `band.cols = null` will now hydrate to `[]` via the `: []` fallback. Old files with explicit arrays hydrate to those arrays (filtered for availability). This is a behavior change for the `null` case — consumers (Part C) must use `band.cols.length > 0 ? band.cols : rtCols` instead of `band.cols != null ? band.cols : rtCols`

### Phase 5: Serializer Null Branch Removal
Remove all null-producing ternary branches from `state-serializer.ts`. After Part A's type changes, these fields are always arrays/Sets — the null branches are dead code.

- [ ] At `state-serializer.ts:34`, change `baseCols: state.baseCols ? [...state.baseCols] : null` to `baseCols: [...state.baseCols]`
- [ ] At `state-serializer.ts:53`, change `selCols: state.selCols ? [...state.selCols] : null` to `selCols: [...state.selCols]`
- [ ] At `state-serializer.ts:54`, change `colOrder: state.colOrder ? [...state.colOrder] : null` to `colOrder: [...state.colOrder]`
- [ ] At `state-serializer.ts:83`, change `cols: [...(b.cols || [])]` to `cols: [...b.cols]`
- [ ] Note: `aggModeState` serialization at line 65 (`JSON.parse(JSON.stringify(state.aggModeState || {}))`) is unchanged — aggModeState sub-selCols null→array conversion is Part D scope (ui/aggregation.ts)
- [ ] Note: `outputColumns` and `pipeline.baseCols` are NOT serialized by `buildPayload()` — they are computed at runtime by `buildReportSpecFromState()`. Their consumer-side fixes are Part C scope

### Phase 6: Compilation Verification
Run typecheck to verify that hydration and serializer files compile cleanly. Remaining errors are expected in test files (Part E), consumer files (Part C), and UI files (Part D).

- [ ] Run `npm run typecheck` from `SRC/` and capture error output
- [ ] Verify that NO errors exist in `core/state-hydrator.ts` or `core/state-serializer.ts` (files modified by this plan)
- [ ] Verify that remaining errors are ONLY in files claimed by other parts: test files (Part E), consumer files like `query-plan.ts`, `sql-detail.ts`, `validation.ts`, `report-output.ts`, `preview-builder.ts`, `engine.ts` (Part C), UI files like `detail-band-stage.tsx`, `column-chips.tsx`, `aggregation.ts` (Part D)
- [ ] Log any unexpected errors to the agent log with category `discovery`

## Completion Criteria

- `baseCols` hydration uses overlay: pre-populate full list → overlay saved array. Null/missing payload keeps full list
- `selCols` hydration uses overlay: pre-populate full Set → overlay saved array. Null/missing payload keeps full Set. Empty array payload produces empty Set
- `colOrder` hydration uses overlay: pre-populate full list → overlay saved array. Null/missing payload keeps full list
- `aggModeState.none.selCols`, `aggModeState.totals.selCols`, `aggModeState.subtotals.selCols` default to `[]` instead of `null` when payload sub-selection is null/missing
- `band.cols` hydration preserves empty arrays as `[]` (not normalized to `null`) in both broken-table and normal code paths
- Serializer produces arrays-only output: `baseCols`, `selCols`, `colOrder`, `band.cols` never serialize as `null`
- Old `.rcjson` files with `null` values hydrate to full lists (backward compatible)
- Old `.rcjson` files with explicit arrays hydrate to those arrays (user selections preserved)
- `npm run typecheck` produces zero errors in `core/state-hydrator.ts` and `core/state-serializer.ts`
- No consumer logic is changed — that is explicitly scoped to Parts C and D

## References

- Design doc: `artifacts/designs/pending/DD-default-selection-conventions.md`
- Parts README: `artifacts/designs/parts/default-selection-conventions/README.md`
- Contracts ledger: `artifacts/designs/parts/default-selection-conventions/CONTRACTS.md`
- Upstream plan: `TASK-default-selection-conventions-A-types-and-state.md`
- Sibling plans: Part C (Consumer Sites), Part D (UI & aggModeState), Part E (Test Fixtures)
