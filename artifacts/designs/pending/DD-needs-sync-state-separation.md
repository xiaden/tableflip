# DD-needs-sync-state-separation — Design Document

## Overview

The pool-selection fields in AppState (`baseCols`, `selCols`, `colOrder`, `outputColumns`, and `DetailBandSpec.cols`) overload empty/zero states to mean multiple things: "nothing selected", "not yet derived", and "user hasn't touched it". There is no mechanism to distinguish stale data (upstream changed, needs recompute) from edited data (user explicitly modified) from auto-populated data (system filled in defaults). This design introduces a parallel `FieldFlags` tracking structure that marks each pool-selection field as stale, edited, or clean — without disrupting any existing consumer of those fields.

## Requirements

1. **Distinguish stale from edited.** When a base table changes, downstream fields (`selCols`, `colOrder`, `baseCols`) must be flagged as needing reconciliation. When a user explicitly toggles a column, that field must be flagged as user-edited so auto-reconciliation respects the edit.
2. **Resolve "project all" ambiguity.** On `outputColumns` (in `ReportSpec`), `[]` currently means both "project nothing" and "field was never populated — project everything". Introduce an explicit mechanism to disambiguate.
3. **Zero impact on existing consumers.** Components and query modules that read `baseCols`, `selCols`, `colOrder`, etc. must continue working without modification. Flags are metadata alongside the data, not wrappers around it.
4. **Backward compatible with existing .rcjson files.** Files saved before this change must load without data loss. Missing flags default to `{ stale: false, edited: false }`.
5. **Clean up remaining null type annotations.** Fix `alias-rename.ts` and `alias-rename.test.ts` where `selCols: null` and `colOrder: null` still appear despite the null→[] migration being complete.

## Current Architecture

### State Flow Today

```
User action (UI layer)
  → store.update(draft => { draft.selCols.add(col); })
  → _afterCombineChange()           [query layer]
    → invalidateValidation()
    → reconcile selCols (add new, remove stale)
    → reconcile colOrder (preserve order, append new)
    → _syncSubtotalByToLayout()
```

The reconciliation in `_afterCombineChange()` (`layout-selection.ts:226-249`) runs unconditionally every time the pipeline changes. It uses module-level cache globals (`_seenCols`, `_disabledCardCols`) to track which columns have been auto-added and which are intentionally hidden. There is no concept of "this field was user-edited, don't overwrite" or "this field is stale and needs recomputation".

### What's Broken

| Field | Current ambiguity | Concrete failure |
|-------|-------------------|------------------|
| `baseCols` | `[]` = "no columns" or "base just changed, not yet populated" | Hydrator populates from table, but can't tell if saved `[]` was intentional |
| `selCols` | `Set()` = "nothing selected" or "not yet derived" or "user deselected all" | `_afterCombineChange` auto-adds all new columns — can't distinguish "user hid these" from "these are new" |
| `colOrder` | `[]` = "use default order" or "not yet populated" | Hydrator defaults to `[...available]`, overwriting any intentional empty |
| `outputColumns` | `[]` = "project nothing" or "project all" | `buildQueryPlan` line 211: `colOrder.length > 0 ? ... : [...colMap.keys()]` — empty means "all" |
| `DetailBandSpec.cols` | `[]` = "no child columns" or "table just assigned, not yet populated" | `handleRightIdChange` populates with `[...rt.cols]`, but can't tell if user later emptied it |

### Existing Pattern Precedent

The `auto: boolean` field on `AggregateSpec` (`aggregation.ts:202-219`) already solves this exact problem for aggregates: `auto: true` means "system-generated default", `auto: false` means "user explicitly set this". The `touchAggregate()` function flips `auto` to `false` when the user edits. FieldFlags generalizes this pattern to all pool-selection fields.

## Design Goals

1. **Add metadata alongside data, not around it.** Flags live in a separate `fieldFlags` block on AppState. Existing code reads `draft.selCols` as before. Flag-aware code reads `draft.fieldFlags.selCols.edited` alongside it.
2. **Stale is runtime-only; edited is persisted.** Stale flags are set and cleared within a session — they're never saved to .rcjson. Edited flags survive save/load because they represent user intent that should persist.
3. **Resolution is centralized.** `_afterCombineChange()` is the single reconciliation function. It gains flag-awareness: check stale flags at the top, skip auto-reconciliation for fields flagged as edited.
4. **Incremental delivery.** The design decomposes into 6 phases (A–F) that can be implemented and tested independently. Phase A (types) and Phase D (serialization) are pure additions with zero behavioral change.

## Proposed Solution

### Approach: Parallel FieldFlags in AppState

Add a `fieldFlags` block to `AppState` that tracks `{ stale: boolean; edited: boolean }` for each pool-selection field. Add a parallel `detailBandFieldFlags` map keyed by band ID for detail band column tracking.

```
AppState
├── baseCols: string[]              ← unchanged, existing consumers read this
├── selCols: Set<string>            ← unchanged
├── colOrder: string[]              ← unchanged
├── fieldFlags: FieldFlags          ← NEW: metadata alongside
│   ├── baseCols: { stale, edited }
│   ├── selCols: { stale, edited }
│   ├── colOrder: { stale, edited }
│   └── outputColumns: { stale, edited }
├── detailBands: DetailBandSpec[]   ← unchanged
├── detailBandFieldFlags: Record<string, { stale, edited }>  ← NEW: keyed by band.id
```

**Why this approach won (from Architect analysis):**
- Zero impact on existing consumers — they still read raw `baseCols`/`selCols`/`colOrder`
- Single source of truth (ADR-006 compliant) — flags live in AppState, not a parallel registry
- Incremental — each phase adds value independently
- ~150 LOC for types + defaults, ~100 LOC for mutation site updates, ~150 LOC total infrastructure
- Lowest risk of the 5 approaches evaluated by the Ideator

**Approaches rejected:**
- *External FieldState Registry* — dual source of truth, synchronization burden
- *Provenance-Tagged Wrappers* — high-touch, every consumer must unwrap
- *Computed Derivation Layer* — aligns with ADR-007 (signals) but premature; ADR-007 not yet accepted
- *Inline provenance on each array element* — per-element tracking is overkill for pool-level decisions

## Type Changes

### New Types (in `types.ts`)

```typescript
/**
 * Tracks whether a pool-selection field is stale (upstream changed, needs
 * recompute) or edited (user explicitly modified vs auto-populated).
 *
 * - stale: Set by pipeline changes (base table change, lookup add/remove,
 *   calc toggle). Cleared by _afterCombineChange() after reconciliation.
 *   Runtime-only — never serialized to .rcjson.
 *
 * - edited: Set by user actions (column toggle, drag reorder, selectAll/None).
 *   Cleared by explicit user reset or hydrator defaults. Persisted in .rcjson
 *   so loaded state reflects prior user intent.
 */
export interface FieldFlag {
  stale: boolean;
  edited: boolean;
}

/**
 * Pool-selection fields tracked by the FieldFlags mechanism.
 * These are the fields where empty/zero states are ambiguous.
 */
export type TrackedField = 'baseCols' | 'selCols' | 'colOrder' | 'outputColumns';

/**
 * Parallel flag block on AppState — one FieldFlag per tracked field.
 * Added to AppState as `fieldFlags: FieldFlags`.
 */
export interface FieldFlags {
  baseCols: FieldFlag;
  selCols: FieldFlag;
  colOrder: FieldFlag;
  outputColumns: FieldFlag;
}
```

### AppState Changes

```typescript
export interface AppState {
  // ... existing fields unchanged ...

  /** Per-field stale/edited tracking for pool-selection fields. */
  fieldFlags: FieldFlags;

  /** Per-band stale/edited tracking for detail band column selections. Keyed by band.id. */
  detailBandFieldFlags: Record<string, FieldFlag>;
}
```

### ReportSpec Changes

```typescript
export interface ReportSpec {
  // ... existing fields unchanged ...

  /** Optional field flags for saved reports. Partial for backward compat. */
  fieldFlags?: Partial<FieldFlags>;
}
```

### Defaults (in `state.ts`)

```typescript
// In createAppState():
fieldFlags: {
  baseCols: { stale: false, edited: false },
  selCols: { stale: false, edited: false },
  colOrder: { stale: false, edited: false },
  outputColumns: { stale: false, edited: false },
},
detailBandFieldFlags: {},

// In createReportSpec():
// fieldFlags is optional — omitted from defaults (undefined = all clean)
```

### Null Annotation Fixes

In `alias-rename.ts`, lines 114, 119, 134, 143: change `string[] | null` to `string[]` in aggModeState sub-field type annotations. The aggModeState stores `selCols` as `string[]` (not Set), and the null→[] migration means these are always arrays.

In `alias-rename.test.ts`, lines 28-29: change `selCols: null` to `selCols: new Set()` and `colOrder: null` to `colOrder: []` in the `draft()` helper.

## Signal Mechanism

### How Flags Are Set

#### Stale Signals (set by pipeline changes, cleared by reconciliation)

| Trigger | File | Fields marked stale |
|---------|------|---------------------|
| Base table changed | `base-stage.tsx:51-58` | `baseCols`, `selCols`, `colOrder` |
| Base table deleted | `sidebar.tsx:42-48` | `baseCols`, `selCols`, `colOrder` |
| Lookup added/removed/enabled/disabled | `pipeline-card.tsx` (lookup stage) | `selCols`, `colOrder` |
| Calc stage added/removed/enabled/disabled | `calc-stage.tsx:67-73` | `selCols`, `colOrder` |
| Stack added/removed | `pipeline-card.tsx` (stack handling) | `selCols`, `colOrder` |
| Detail band rightId changed | `detail-band-stage.tsx:116-122` | `selCols`, `colOrder` (band columns are separate) |

#### Edited Signals (set by user actions, persisted)

| Trigger | File | Fields marked edited |
|---------|------|----------------------|
| Column toggled in base stage chip click | `base-stage.tsx:97-103` | `selCols` |
| "All" / "None" buttons in base stage | `base-stage.tsx:125-133` | `selCols` |
| Column double-clicked in column chips | `column-chips.tsx:132-175` | `selCols` (in 'none' mode) |
| Column dragged to reorder | `column-chips.tsx:198-215` | `colOrder` |
| selectAllCols() called | `column-chips.tsx:306-314` | `selCols` |
| selectNoneCols() called | `column-chips.tsx:317-319` | `selCols` |
| Band column toggled | `detail-band-stage.tsx:168-179` | `detailBandFieldFlags[bandId]` |
| Band "All" / "None" buttons | `detail-band-stage.tsx:182-196` | `detailBandFieldFlags[bandId]` |

#### Auto-populated (neither stale nor edited)

| Trigger | File | Behavior |
|---------|------|----------|
| Band rightId assigned → cols populated with `[...rt.cols]` | `detail-band-stage.tsx:121` | `detailBandFieldFlags[bandId] = { stale: false, edited: false }` |
| Hydrator populates selCols from available | `state-hydrator.ts:186` | `fieldFlags.selCols = { stale: false, edited: false }` |
| Hydrator populates colOrder from available | `state-hydrator.ts:193` | `fieldFlags.colOrder = { stale: false, edited: false }` |
| `loadAggModeState()` restores selCols | `aggregation.ts:124-151` | `fieldFlags.selCols = { stale: false, edited: false }` (system restore, not user edit) |

### How Flags Are Cleared

| Event | Cleared fields | Mechanism |
|-------|----------------|-----------|
| `_afterCombineChange()` completes reconciliation | All `stale` flags | New `resolveStaleFields(draft)` helper called at top of `_afterCombineChange` |
| User explicitly resets a field | That field's `edited` flag | UI action sets `{ stale: false, edited: false }` |
| Fresh hydration from .rcjson | All flags | Hydrator defaults missing flags to `{ stale: false, edited: false }` |

### Resolution Logic: `_afterCombineChange()` Enhancement

The existing `_afterCombineChange()` in `layout-selection.ts:226-249` reconciles `selCols` and `colOrder` unconditionally. The enhanced version:

```
_afterCombineChange():
  1. invalidateValidation()                          ← preserved
  2. resolveStaleFields(draft)                        ← NEW
     a. Read fieldFlags.selCols.stale
     b. If stale AND NOT edited:
        - Run existing auto-add/auto-remove logic for selCols
     c. If stale AND edited:
        - Run auto-add for truly new columns (not in _seenCols)
        - Do NOT auto-remove columns the user explicitly hid
     d. If NOT stale:
        - Skip selCols reconciliation entirely
     e. Clear stale flag
  3. Same pattern for colOrder:
     a. If stale AND NOT edited: full reorder to natural order
     b. If stale AND edited: preserve user order, append new columns at end
     c. If NOT stale: skip
     d. Clear stale flag
  4. _syncSubtotalByToLayout()                        ← preserved
```

**Key invariant:** The `_seenCols`, `_previewOpen`, and `_disabledCardCols` module globals continue working alongside flags. Flags add a higher-level "should I even run?" gate; the globals handle within-reconciliation tracking.

### "Project All" Resolution for outputColumns

The ambiguity: `outputColumns: []` in `ReportSpec` currently means "project all projected columns" (see `query-plan.ts:211-213`: `colOrder.length > 0 ? ... : [...colMap.keys()]`). But it could also mean "project nothing".

**Solution: `'__ALL__'` sentinel.**

- When the user has never explicitly set output columns (edited=false), serialize as `outputColumns: ['__ALL__']`
- When the user has explicitly selected/deselected columns (edited=true), serialize the explicit list
- In `buildQueryPlan()` (`query-plan.ts:210-213`), check for `'__ALL__'`:
  ```typescript
  const colOrder = reportSpec.outputColumns;
  const orderedAliases = (colOrder.length === 1 && colOrder[0] === '__ALL__')
    ? [...colMap.keys(), ...aggAliases]    // project all
    : colOrder.length > 0
      ? colOrder.filter(a => colMap.has(a) || aggAliases.includes(a))
      : [];                                 // project nothing (explicit empty)
  ```
- In `preview-builder.ts:275`, change `outputColumns: []` to `outputColumns: ['__ALL__']` (preview always projects all)
- In `run-bar.tsx:82-84`, the outputColumns derivation from `selCols`/`colOrder` already produces explicit lists — no change needed there
- **Backward compat:** Old .rcjson files with `outputColumns: []` are interpreted as `'__ALL__'` by the hydrator (since `[]` was the old "project all" convention). The hydrator sets `outputColumns: ['__ALL__']` when the payload has `outputColumns: []` or missing `outputColumns`.

## Migration Plan

### Phase A: Types & Defaults (Core Layer)
**Estimated size: SMALL (~50 LOC)**

| File | Change |
|------|--------|
| `SRC/preact/types.ts` | Add `FieldFlag`, `TrackedField`, `FieldFlags` types. Add `fieldFlags` and `detailBandFieldFlags` to `AppState`. Add optional `fieldFlags` to `ReportSpec`. |
| `SRC/preact/core/state.ts` | Add defaults for `fieldFlags` and `detailBandFieldFlags` in `createAppState()`. |
| `SRC/preact/core/alias-rename.ts` | Fix null type annotations in aggModeState casts (lines 114, 119, 134, 143): `string[] \| null` → `string[]`. |
| `SRC/preact/tests/core/alias-rename.test.ts` | Fix `draft()` helper: `selCols: null` → `selCols: new Set()`, `colOrder: null` → `colOrder: []`. Add `fieldFlags` and `detailBandFieldFlags` to draft object. |

**Validation:** `npm run typecheck` passes. Existing tests pass with updated fixtures.

### Phase B: Signal Sinks (UI Mutation Sites)
**Estimated size: MEDIUM (~100 LOC)**

| File | Change |
|------|--------|
| `SRC/preact/ui/sections/base-stage.tsx` | In `handleBaseChange` (line 52-58): set `fieldFlags.baseCols = { stale: true, edited: false }`, `fieldFlags.selCols = { stale: true, edited: false }`, `fieldFlags.colOrder = { stale: true, edited: false }`. In chip click handler (line 97-103): set `fieldFlags.selCols = { stale: false, edited: true }`. In All/None buttons (lines 125-133): set `fieldFlags.selCols = { stale: false, edited: true }`. |
| `SRC/preact/ui/sections/detail-band-stage.tsx` | In `handleRightIdChange` (line 116-122): set `detailBandFieldFlags[val] = { stale: false, edited: false }` (auto-populated). In `toggleCol` (line 168-179): set `detailBandFieldFlags[band.id] = { stale: false, edited: true }`. In `selectAllCols`/`selectNoneCols` (lines 182-196): set `detailBandFieldFlags[band.id] = { stale: false, edited: true }`. |
| `SRC/preact/ui/sections/column-chips.tsx` | In `handleDblClick` for 'none' mode (line 167-173): set `fieldFlags.selCols = { stale: false, edited: true }`. In `onDrop` (line 206-213): set `fieldFlags.colOrder = { stale: false, edited: true }`. In `selectAllCols()` (line 310-312): set `fieldFlags.selCols = { stale: false, edited: true }`. In `selectNoneCols()` (line 318): set `fieldFlags.selCols = { stale: false, edited: true }`. |
| `SRC/preact/ui/sections/calc-stage.tsx` | In `updateCalc` wrapper (line 67-73): when calc is added/removed/enabled/disabled, set `fieldFlags.selCols = { stale: true, edited: false }` and `fieldFlags.colOrder = { stale: true, edited: false }`. |
| `SRC/preact/ui/aggregation.ts` | In `loadAggModeState` (lines 124-151): set `fieldFlags.selCols = { stale: false, edited: false }` — this is a system restore, not a user edit. |
| `SRC/preact/ui/sidebar.tsx` | In `handleRemove` (line 42-48): when base table is deleted, set `fieldFlags.baseCols = { stale: true, edited: false }`, `fieldFlags.selCols = { stale: true, edited: false }`, `fieldFlags.colOrder = { stale: true, edited: false }`. |

**Validation:** Manual testing of each mutation site. Flag state inspected via devtools or temporary logging.

### Phase C: Resolution Logic (Query Layer)
**Estimated size: MEDIUM (~100 LOC)**

| File | Change |
|------|--------|
| `SRC/preact/query/layout-selection.ts` | Add `resolveStaleFields(draft)` helper. Modify `_afterCombineChange()` to call it before existing reconciliation. Respect `edited` flags: if `selCols.edited = true`, skip auto-remove of columns (only auto-add new ones). If `colOrder.edited = true`, preserve user order, append new at end. Clear stale flags after resolution. |

**Key implementation detail:**
```typescript
function resolveStaleFields(draft: AppState): void {
  const flags = draft.fieldFlags;

  // selCols reconciliation
  if (flags.selCols.stale) {
    const colMap = buildColSourceMap();
    const nowCols = [...colMap.keys()];
    const selCols = draft.selCols as unknown as Set<string>;

    if (selCols instanceof Set) {
      // Always auto-add new columns (not seen before)
      nowCols.forEach(c => {
        if (!_seenCols.has(c)) { selCols.add(c); _seenCols.add(c); }
      });

      // Only auto-remove if user hasn't edited selCols
      if (!flags.selCols.edited) {
        const nowSet = new Set(nowCols);
        for (const c of [...selCols]) {
          if (!nowSet.has(c) && !_disabledCardCols.has(c)) selCols.delete(c);
        }
      }
    }
    flags.selCols.stale = false;
  }

  // colOrder reconciliation
  if (flags.colOrder.stale) {
    const colMap = buildColSourceMap();
    const nowCols = [...colMap.keys()];

    if (!flags.colOrder.edited) {
      // User hasn't reordered — reset to natural order
      draft.colOrder = [...nowCols];
    } else {
      // User has reordered — preserve order, append new at end
      const nowSet = new Set(nowCols);
      draft.colOrder = [
        ...draft.colOrder.filter(c => nowSet.has(c)),
        ...nowCols.filter(c => !draft.colOrder.includes(c)),
      ];
    }
    flags.colOrder.stale = false;
  }

  // baseCols: always auto-reconcile (no user-edit concept for baseCols pool)
  if (flags.baseCols.stale) {
    // baseCols is populated by hydrator/handleBaseChange — just clear flag
    flags.baseCols.stale = false;
  }
}
```

**Validation:** Unit tests for `resolveStaleFields()` with various flag combinations. Existing `_afterCombineChange` tests still pass.

### Phase D: Serialization & Hydration
**Estimated size: SMALL (~50 LOC)**

| File | Change |
|------|--------|
| `SRC/preact/core/state-serializer.ts` | In `buildPayload()`: serialize `fieldFlags` with only `edited` (not `stale`). Add `fieldFlags` key to payload: `{ baseCols: { edited: ... }, selCols: { edited: ... }, ... }`. Serialize `detailBandFieldFlags` similarly (only `edited`). |
| `SRC/preact/core/state-hydrator.ts` | After existing hydration: read `payload.fieldFlags` if present, default missing flags to `{ stale: false, edited: false }`. Read `payload.detailBandFieldFlags` if present, default missing band flags. For `outputColumns`: if payload has `outputColumns: []` or missing, set to `['__ALL__']` for backward compat. |
| `SRC/preact/core/state-schema.ts` | **Decision needed (see Open Questions):** bump `STATE_VERSION` to 3, or keep at 2 since `fieldFlags` is an additive optional key? |

**Serialization shape:**
```json
{
  "v": 2,
  "base": "Orders",
  "baseCols": ["OrderId", "OrderDate", "Amount"],
  "selCols": ["OrderId", "Amount"],
  "colOrder": ["OrderId", "OrderDate", "Amount"],
  "fieldFlags": {
    "baseCols": { "edited": false },
    "selCols": { "edited": true },
    "colOrder": { "edited": false },
    "outputColumns": { "edited": false }
  },
  "detailBandFieldFlags": {
    "band_0": { "edited": true }
  },
  ...
}
```

Note: `stale` is omitted from serialization — it's runtime-only. The hydrator reconstructs `{ stale: false, edited: <from payload> }`.

**Validation:** Roundtrip test: serialize → deserialize → verify flags preserved. Backward compat test: load old .rcjson without fieldFlags → verify defaults applied.

### Phase E: "Project All" Fix
**Estimated size: SMALL (~50 LOC)**

| File | Change |
|------|--------|
| `SRC/preact/query/query-plan.ts` | In `buildQueryPlan()` lines 210-213: add `'__ALL__'` sentinel check. When `outputColumns` is `['__ALL__']`, resolve to `[...colMap.keys(), ...aggAliases]`. When `outputColumns` is `[]` (explicit empty), resolve to `[]`. |
| `SRC/preact/report/preview-builder.ts` | In `buildPreviewReportSpec()` line 275: change `outputColumns: []` to `outputColumns: ['__ALL__']`. |
| `SRC/preact/core/state-hydrator.ts` | When hydrating `outputColumns`: if payload has `[]` or missing, and `fieldFlags.outputColumns.edited` is false/missing, set to `['__ALL__']`. |
| `SRC/preact/ui/sections/run-bar.tsx` | In `runQuery()` lines 82-84: the outputColumns derivation already produces explicit lists from `selCols`/`colOrder` — no change needed. But if `selCols` is empty and `fieldFlags.selCols.edited` is false, could emit `['__ALL__']` instead. |

**Validation:** Test that old .rcjson with `outputColumns: []` still projects all columns. Test that explicit empty `[]` with `edited: true` projects nothing.

### Phase F: Tests
**Estimated size: MEDIUM (~200 LOC)**

| File | Change |
|------|--------|
| `SRC/preact/tests/core/alias-rename.test.ts` | Fix `draft()` helper: `selCols: null` → `new Set()`, `colOrder: null` → `[]`. Add `fieldFlags` and `detailBandFieldFlags` to draft. |
| `SRC/preact/tests/core/state.test.ts` | Add assertions: `createAppState()` produces correct default flags. |
| `SRC/preact/tests/core/state-serializer.test.ts` | Add test: flags serialized with only `edited` (no `stale`). Add test: `detailBandFieldFlags` serialized correctly. |
| `SRC/preact/tests/core/state-hydrator-bands.test.ts` | Add test: old payload without `fieldFlags` gets defaults. Add test: payload with `fieldFlags` preserves `edited`. |
| `SRC/preact/tests/query/query-plan.test.ts` | Add test: `outputColumns: ['__ALL__']` resolves to all projected columns. Add test: `outputColumns: []` resolves to empty. |
| `SRC/preact/tests/report/preview-builder.test.ts` | Add test: preview spec uses `['__ALL__']` sentinel. |
| ~14 test fixture files | Add `fieldFlags` and `detailBandFieldFlags` defaults to fixture state objects (where `createAppState()` isn't already used). |

**Fixture files likely needing updates** (files that construct AppState-like objects directly rather than via `createAppState()`):
- `tests/core/alias-rename.test.ts` (the `draft()` helper)
- `tests/report/validation.test.ts` (inline state objects at lines 228, 276)
- Any test that constructs `Partial<AppState>` objects with explicit `selCols`/`colOrder`

Tests that use `createAppState()` or `createReportSpec()` get flags automatically from defaults — no changes needed.

## Impact Assessment

### File-by-File Change Summary

| # | File | Layer | Change Type | Estimated LOC |
|---|------|-------|-------------|---------------|
| 1 | `SRC/preact/types.ts` | Core (types) | Add types, extend interfaces | +25 |
| 2 | `SRC/preact/core/state.ts` | Core | Add defaults | +10 |
| 3 | `SRC/preact/core/state-serializer.ts` | Core | Serialize edited flags | +15 |
| 4 | `SRC/preact/core/state-hydrator.ts` | Core | Default missing flags, handle `__ALL__` | +25 |
| 5 | `SRC/preact/core/state-schema.ts` | Core | Possibly bump STATE_VERSION | +1 |
| 6 | `SRC/preact/core/alias-rename.ts` | Core | Fix null annotations | ~4 (net change) |
| 7 | `SRC/preact/query/layout-selection.ts` | Query | Add `resolveStaleFields()`, update `_afterCombineChange()` | +60 |
| 8 | `SRC/preact/query/query-plan.ts` | Query | Handle `__ALL__` sentinel | +8 |
| 9 | `SRC/preact/report/preview-builder.ts` | Report | Use `__ALL__` in preview spec | ~2 |
| 10 | `SRC/preact/ui/sections/base-stage.tsx` | UI | Set stale/edited flags | +12 |
| 11 | `SRC/preact/ui/sections/detail-band-stage.tsx` | UI | Set detailBandFieldFlags | +10 |
| 12 | `SRC/preact/ui/sections/column-chips.tsx` | UI | Set edited flags | +8 |
| 13 | `SRC/preact/ui/sections/calc-stage.tsx` | UI | Set stale flags | +4 |
| 14 | `SRC/preact/ui/aggregation.ts` | UI | Set flags on mode restore | +6 |
| 15 | `SRC/preact/ui/sidebar.tsx` | UI | Set stale flags on base delete | +4 |
| 16 | `SRC/preact/ui/sections/run-bar.tsx` | UI | Possibly handle `__ALL__` in outputColumns derivation | +3 |
| 17 | `SRC/preact/tests/core/alias-rename.test.ts` | Test | Fix draft() helper | ~4 |
| 18 | `SRC/preact/tests/core/state.test.ts` | Test | Add flag default assertions | +15 |
| 19 | `SRC/preact/tests/core/state-serializer.test.ts` | Test | Add flag serialization tests | +30 |
| 20 | `SRC/preact/tests/core/state-hydrator-bands.test.ts` | Test | Add flag hydration tests | +25 |
| 21 | `SRC/preact/tests/query/query-plan.test.ts` | Test | Add `__ALL__` sentinel tests | +20 |
| 22 | `SRC/preact/tests/report/preview-builder.test.ts` | Test | Add preview spec test | +10 |
| ~14 | Various test fixture files | Test | Add flag defaults to fixture objects | ~50 |

**Total: ~25 files modified, ~34 files affected (including fixtures), ~600 LOC**

### Risk Areas

#### 1. AggModeState Interaction
`selCols` is snapshotted as `string[]` in `aggModeState` (not Set). When `loadAggModeState()` restores `selCols` via `draft.selCols = new Set(...)`, this is a system restore — it should NOT set `edited=true`. However, the preceding `saveActiveAggModeState()` captures the current `selCols` state including its flag context. When the user switches modes, the restored `selCols` should carry its prior `edited` status.

**Resolution:** `loadAggModeState()` sets `fieldFlags.selCols = { stale: false, edited: false }` unconditionally. The rationale: aggModeState is a snapshot mechanism — restoring a snapshot is a system action, not a user edit. If the user subsequently toggles columns in the new mode, that action sets `edited=true`.

#### 2. `_afterCombineChange` Call Sites
`_afterCombineChange()` is called from ~10 locations: `base-stage.tsx` (3), `column-chips.tsx` (4), `calc-stage.tsx` (1), `alias-rename.ts` (1), `column-chips.tsx` selectAll/None (2). Each call must now consider flags.

**Resolution:** The simplest approach — `_afterCombineChange()` checks stale flags at the top via `resolveStaleFields(draft)`. If a field's stale flag is not set, skip its auto-reconciliation. Callers don't need to change; they already set stale flags before calling `_afterCombineChange()`.

#### 3. Set Reactivity with Immer
`selCols.add()` and `.delete()` inside `store.update(draft => ...)` work with Immer's deep clone. But the edited flag must be set in the same update transaction to avoid a race where the flag update triggers a separate subscriber notification.

**Resolution:** All flag-setting code lives inside the same `store.update(draft => { ... })` transaction as the data mutation. No separate `store.update()` calls for flags.

#### 4. Hydration from Old .rcjson
Files saved before this change won't have `fieldFlags`. The hydrator must default missing flags to `{ stale: false, edited: false }`. This means the loaded state appears "clean" — no stale warnings, nothing flagged as edited. This is correct behavior: a freshly loaded file hasn't been edited in this session.

**Resolution:** Hydrator checks `payload.fieldFlags` existence. If missing, defaults all flags to `{ stale: false, edited: false }`. If present but incomplete (e.g., new field added in future), defaults missing fields.

#### 5. STATE_VERSION Decision
Adding `fieldFlags` to the serialized payload changes the shape. Two options:
- **Option A:** Keep `STATE_VERSION = 2`. `fieldFlags` is an additive optional key — old hydrators ignore it, new hydrators default it if missing. No migration needed.
- **Option B:** Bump to `STATE_VERSION = 3`. Add explicit v2→v3 migration in hydrator.

**Recommendation:** Option A. The `fieldFlags` key is purely additive and backward-compatible. Old code reading a new .rcjson will simply ignore the unknown key. New code reading an old .rcjson will default the missing key. No data loss either way. Bumping the version adds migration complexity for no functional benefit.

## Backward Compatibility

### .rcjson Files (Saved Configurations)

| Scenario | Behavior |
|----------|----------|
| Old .rcjson (no `fieldFlags`) loaded by new code | Hydrator defaults all flags to `{ stale: false, edited: false }`. State loads cleanly. |
| New .rcjson (with `fieldFlags`) loaded by old code | Old hydrator ignores unknown `fieldFlags` key. State loads cleanly (flags are lost, but old code doesn't use them). |
| Old .rcjson with `outputColumns: []` | Hydrator interprets as "project all" (existing behavior). Sets `outputColumns: ['__ALL__']` internally. |
| Old .rcjson with missing `outputColumns` | Same as above — hydrator defaults to `['__ALL__']`. |

### State Loading Pipeline

```
.rcjson file
  → parse JSON
  → hydrateState(payload, loadedTables)
    → existing hydration logic (unchanged)
    → NEW: read payload.fieldFlags, default missing
    → NEW: read payload.detailBandFieldFlags, default missing
    → NEW: if outputColumns is [] or missing, set to ['__ALL__']
  → apply to store via store.set()
  → all flags are { stale: false, edited: <from file or false> }
```

### No-Data-Loss Guarantee

- All existing fields in .rcjson continue to be read and written identically
- `fieldFlags` is additive — its absence doesn't affect any existing field
- `outputColumns: []` → `['__ALL__']` is semantically equivalent (both mean "project all" in the old system)
- Roundtrip fidelity preserved (ASR-0001): save → load → save produces identical payload (modulo the new `fieldFlags` key)

## Open Questions

### 1. STATE_VERSION bump: needed or not?
**Recommendation:** No bump (Option A). `fieldFlags` is additive and backward-compatible. Old code ignores unknown keys; new code defaults missing keys. No migration complexity.
**Decision needed from:** Project maintainer.
**Impact of decision:** If bump is chosen, add ~20 LOC for v2→v3 migration in hydrator. If not, save that work and keep version stable.

### 2. Should `edited` flags survive mode switches?
When the user switches from 'none' mode to 'group' mode and back, should `fieldFlags.selCols.edited` retain its value from the 'none' mode snapshot?
**Recommendation:** No. `loadAggModeState()` resets all flags to `{ stale: false, edited: false }`. Mode switching is a system action. User edits in the new mode set flags fresh.
**Decision needed from:** Product/design.
**Impact of decision:** If yes, `saveActiveAggModeState()` must also snapshot flags, and `loadAggModeState()` must restore them. Adds ~30 LOC and complexity to aggModeState shape.

### 3. UI indication of stale state?
Should the UI show a visual indicator when a field is stale (e.g., "Base table changed — column selection may be out of date")?
**Recommendation:** Defer to a follow-up. This design provides the mechanism (flags); UI indication is a separate feature.
**Decision needed from:** Product/design.

### 4. `__ALL__` sentinel: string in outputColumns or separate flag?
The `'__ALL__'` sentinel lives inside the `outputColumns` string array. Alternative: a separate `projectAll: boolean` field on ReportSpec.
**Recommendation:** Sentinel in array. It keeps the type simple (`string[]`) and avoids a new top-level field. The sentinel is an implementation detail — users never see it.
**Decision needed from:** Project maintainer.

## Effort Estimate

| Phase | Description | Files | LOC | Complexity |
|-------|-------------|-------|-----|------------|
| A | Types & Defaults | 4 | ~50 | Low — pure additions |
| B | Signal Sinks | 6 | ~100 | Medium — audit all mutation sites |
| C | Resolution Logic | 1 | ~100 | Medium — core behavioral change |
| D | Serialization & Hydration | 3 | ~50 | Low — additive, backward compat |
| E | "Project All" Fix | 3-4 | ~50 | Low — sentinel check |
| F | Tests | ~16 | ~200 | Medium — fixture updates + new tests |
| **Total** | | **~25 unique files** | **~600** | |

**Timeline estimate:**
- Phase A: 0.5 day (types are straightforward)
- Phase B: 1 day (mutation site audit requires careful reading of each handler)
- Phase C: 1 day (resolution logic is the core intellectual work)
- Phase D: 0.5 day (serialization is mechanical)
- Phase E: 0.5 day (sentinel is localized)
- Phase F: 1 day (tests + fixture updates)
- **Total: ~4.5 days**

**Recommended implementation order:** A → D → F(partial) → B → C → E → F(remaining)

Rationale: Types + serialization + basic tests first (proves the infrastructure works end-to-end with no behavioral change), then mutation sites + resolution (adds behavior), then project-all fix (independent concern), then remaining tests.

## Appendix: Research Findings

### Key Patterns Discovered

1. **`_afterCombineChange()` is the chokepoint.** All pipeline changes eventually call this function. Adding flag-awareness here captures all reconciliation in one place.

2. **`auto: boolean` on AggregateSpec is the precedent.** The codebase already uses a per-item boolean to track "system-generated vs user-set". FieldFlags generalizes this to pool-level tracking.

3. **Hydrator uses overlay algorithm.** `state-hydrator.ts` populates defaults first (e.g., `selCols = new Set(available)`), then overlays saved values. This naturally extends to flag hydration: default flags first, overlay saved flags.

4. **Serializer uses spread operators, not null guards.** `state-serializer.ts:34,53` uses `[...state.baseCols]`, `[...state.selCols]` — confirming the null→[] migration is complete. Adding `fieldFlags` serialization is a simple addition to `buildPayload()`.

5. **Test fixtures use `createAppState()` in most cases.** Tests that construct state via `createAppState({ ... })` get flag defaults automatically. Only tests that construct raw AppState objects (like `alias-rename.test.ts`'s `draft()` helper) need manual flag additions.

6. **`outputColumns` lives in ReportSpec, not AppState.** The `outputColumns` field is on `ReportSpec` (the serialized/saved shape), not `AppState` (the reactive shape). In `AppState`, the equivalent is `selCols` + `colOrder`. The `run-bar.tsx` derives `outputColumns` from `selCols`/`colOrder` at report execution time (line 82-84). The `fieldFlags.outputColumns` flag tracks whether the derived outputColumns was user-edited — but since outputColumns is derived, not stored, this flag is meaningful only in the ReportSpec context (saved reports).

### Reusable Components

- `createAppState()` — add flag defaults here, all consumers get them for free
- `buildPayload()` — add flag serialization here, all save flows get them
- `hydrateState()` — add flag hydration here, all load flows get them
- `_afterCombineChange()` — add flag resolution here, all reconciliation gets it
