# Store-Based Column Alias Rename Propagation — Design Document

**Status:** Draft  
**Author:** RnD-DDAuthor  
**Created:** 2026-06-14  

**Related Documents:**
- [AppState type definition](SRC/preact/types.ts) — AppState interface with all alias-bearing fields (filters, sorts, aggregates, groupBy, subtotalBy, mergedCols, selCols, colOrder, detailBands, lookups, calcStages, colTotals, subtotalFns, aggModeState)
- [Store API](SRC/preact/core/store.ts) — Reactive store with getStore().update(draft => {...}) pattern, deep-clone with Set preservation
- [_afterCombineChange()](SRC/preact/query/layout-selection.ts) — Post-combine layout reconciliation: selCols/colOrder update, validation invalidation, subtotal sync
- [Validation cache](SRC/preact/report/validation.ts) — invalidateValidation() cache clearing function; iterates colTotals (line 505) and subtotalFns (line 569) by alias keys
- [SQL calc expression generation](SRC/preact/query/sql-calcs.ts) — Calc stage SQL generation — defines typed-value reference shapes ({ type: 'column', value: '<alias>' })
- [Calc validator](SRC/preact/report/calc-validator.ts) — Calc stage validation — confirms reference shapes and self-reference prevention
- [State applier](SRC/preact/core/state-applier.ts) — State applier — existing pattern of core → query dependency (_afterCombineChange import)
- [SQL totals builder](SRC/preact/query/sql-totals.ts) — Total row SQL generation — looks up colTotals by column alias (line 84, 90)
- [SQL subtotals builder](SRC/preact/query/sql-subtotals.ts) — Subtotal SQL generation — looks up subtotalFns by column alias (line 123)
- [State hydrator](SRC/preact/core/state-hydrator.ts) — State hydration — builds colTotals (line 239-243), subtotalFns (line 250-254), and aggModeState (line 262-293) with alias keys
- [Aggregation mode management](SRC/preact/ui/aggregation.ts) — Agg mode save/load — _readAggModeState snapshots alias-bearing fields per mode; loadAggModeState restores them

---

## Scope

preact/core/ + 3 call sites (calc-stage.tsx, rename-modal.tsx, utils.ts). New module: preact/core/alias-rename.ts. Propagation covers all alias-bearing AppState fields and calc-internal typed-value references.

---

## Problem Statement

When a calculated column's alias is renamed (e.g., "MyCalc" → "NewName"), all references to the old alias throughout the application state must be updated. The previous implementation (alias-ref-updater.ts) read from window.__db — a global that was never populated in the Preact codebase. Alias rename propagation has been broken since the Preact migration. That file has been deleted. This design specifies a clean-slate, store-based replacement.

Three call sites trigger alias renames but only update the alias field itself:
1. calc-stage.tsx:99-101 — inline alias input handler
2. rename-modal.tsx:44-55 — rename modal calc branch
3. utils.ts:236-238 — renameProjectedColumn calc branch

All alias-bearing fields in AppState (filters, sorts, aggregates, groupBy, subtotalBy, mergedCols, detailBands, lookups, calc-internal expressions, selCols, colOrder, colTotals, subtotalFns, aggModeState) retain stale references after rename, silently breaking reports.

---

## Architecture

## Two-Layer Design: Orchestrator + Pure Draft Helper

### Layer 1: Orchestrator — `renameCalcAlias(idx, newAlias)`

The orchestrator is the public API. It lives in `preact/core/alias-rename.ts` and is the only function call sites import.

**Responsibilities:**
1. Open a single `getStore().update()` transaction
2. Read the old alias from `draft.calcStages[idx].alias` before mutation
3. Guard against no-op renames (old === new, empty new, missing calc stage)
4. Write `draft.calcStages[idx].alias = newAlias`
5. Delegate to `renameAliasRefsInternal(draft, oldAlias, newAlias)` for propagation
6. Close the update
7. Call `_afterCombineChange()` which handles selCols/colOrder reconciliation, subtotal sync, and validation invalidation

**Why the orchestrator doesn't update selCols/colOrder directly:**
`_afterCombineChange()` (in `query/layout-selection.ts:226`) already rebuilds selCols and colOrder from `buildColSourceMap()`, which reads the current calcStages. After our rename, the colMap reflects the new alias, so `_afterCombineChange()` correctly adds the new alias and removes the old. Duplicating this logic would create two sources of truth.

**Why the orchestrator doesn't call `invalidateValidation()` directly:**
`_afterCombineChange()` calls `invalidateValidation()` internally at line 227 of `layout-selection.ts`. Calling it again would be harmless but redundant.

### Layer 2: Pure Draft Helper — `renameAliasRefsInternal(draft, oldAlias, newAlias)`

A pure function that operates on an `AppState` draft. No store access, no side effects, no DOM. Exported for direct use in batch/multi-alias operations and unit testing.

**Responsibilities:** Walk every alias-bearing field in the draft and replace exact matches of `oldAlias` with `newAlias`.

**Field walk specification:**

#### A. Simple string fields (exact match, replace if equal)

| Field Path | Guard |
|------------|-------|
| `filters[].col` | Skip if `filters` is undefined/empty |
| `sorts[].col` | Skip if `sorts` is undefined/empty |
| `aggregates[].col` | Skip if `aggregates` is undefined/empty |
| `detailBands[].sorts[].col` | Skip if `detailBands` is undefined/empty |

#### B. String array fields (find and replace elements)

| Field Path | Guard |
|------------|-------|
| `groupBy[]` | Skip if undefined/empty |
| `subtotalBy[]` | Skip if undefined/empty |
| `mergedCols[]` | Skip if undefined/empty |

#### C. KeyPair left fields (exact match on `.left`)

| Field Path | Guard |
|------------|-------|
| `detailBands[].keyPairs[].left` | Skip if `detailBands` or `keyPairs` is undefined/empty |
| `lookups[].keyPairs[].left` | Skip if `lookups` or `keyPairs` is undefined/empty |

#### D. Compare condition columns

| Field Path | Guard |
|------------|-------|
| `calcStages[].compare.conditions[].col` | Skip if `compare` or `conditions` is undefined; skip if `col` is undefined/empty |

#### E. Calc-internal typed-value references (`{ type: 'column', value: '<alias>' }`)

These are nested inside calc stage mode-specific properties. Each must check `type === 'column'` before comparing `value`.

| Field Path | Guard |
|------------|-------|
| `calcStages[].math.steps[]` where `type === 'column'` → `.value` | Skip if `math` or `steps` is undefined |
| `calcStages[].compare.trueValue` where `type === 'column'` → `.value` | Skip if `trueValue` is undefined or `type !== 'column'` |
| `calcStages[].compare.falseValue` where `type === 'column'` → `.value` | Skip if `falseValue` is undefined or `type !== 'column'` |
| `calcStages[].text.parts[]` where `type === 'column'` → `.value` | Skip if `text` or `parts` is undefined |
| `calcStages[].text.source` where `type === 'column'` → `.value` | Skip if `text` or `source` is undefined or `type !== 'column'` |
| `calcStages[].date.source` where `type === 'column'` → `.value` | Skip if `date` or `source` is undefined or `type !== 'column'` |

#### F. selCols and colOrder

**Not handled by the pure draft helper.** These are managed by `_afterCombineChange()` after the orchestrator's update completes. The pure helper focuses on structural references that `_afterCombineChange()` doesn't know about.

**Rationale:** `_afterCombineChange()` rebuilds selCols/colOrder from the column catalog, which derives from calcStages. After the rename, the catalog reflects the new alias, so selCols/colOrder are reconciled automatically. Including them in the pure helper would duplicate logic and risk inconsistency.

#### G. Record-key fields (key = column alias, value = function name)

These are `Record<string, string>` where the **key** is a column alias. Migration means deleting the old key and inserting the same value under the new key.

| Field Path | Guard |
|------------|-------|
| `colTotals` | Skip if undefined/empty or `oldAlias` not in record |
| `subtotalFns` | Skip if undefined/empty or `oldAlias` not in record |

**Key migration pattern:**
```ts
if (draft.colTotals && oldAlias in draft.colTotals) {
  draft.colTotals[newAlias] = draft.colTotals[oldAlias];
  delete draft.colTotals[oldAlias];
}
```

**Why key migration, not value replacement:** The values are aggregate function names ('SUM', 'AVG', etc.), not aliases. Only the keys reference columns. A simple value replacement would be incorrect.

**Consumers that break with stale keys:**
- `validation.ts:505` — iterates `Object.entries(state.colTotals)`, keys are aliases
- `sql-totals.ts:84` — looks up `colTotals[alias]` by column alias
- `validation.ts:569` — iterates `Object.entries(state.subtotalFns)`, keys are aliases
- `sql-subtotals.ts:123` — looks up `subtotalFns[alias]` by column alias
- `state-hydrator.ts:242,253` — builds both records with alias keys from payload

#### H. aggModeState — nested alias-bearing fields across all modes

`aggModeState: Record<string, unknown> | null` contains per-mode UI state snapshots. Each mode stores a subset of alias-bearing fields. If a calc is renamed while one mode is active, the **saved snapshots for other modes** retain stale aliases. When the user later switches modes, `loadAggModeState()` restores stale aliases into the live state fields, silently breaking aggregation.

**Structure by mode** (from `_readAggModeState` in `ui/aggregation.ts` and `state-hydrator.ts:270-293`):

| Mode | Alias-bearing fields | Type |
|------|---------------------|------|
| `none` | `selCols` | `string[] \| null` |
| `group` | `selCols`, `groupBy`, `aggregates[].col` | `string[] \| null`, `string[]`, `Array<{ col: string }>` |
| `totals` | `selCols`, `colTotals` (Record keys) | `string[] \| null`, `Record<string, string>` |
| `subtotals` | `selCols`, `subtotalBy`, `subtotalFns` (Record keys) | `string[] \| null`, `string[]`, `Record<string, string>` |

**Guard:** Skip if `aggModeState` is null/undefined. For each mode sub-object, skip if null/undefined.

**Note on selCols within aggModeState:** These are serialized arrays (not Sets), unlike the top-level `selCols: Set<string> | null`. They are NOT handled by `_afterCombineChange()` because that function only reconciles the live `draft.selCols`, not the saved snapshots. The pure draft helper must update them.

### Replacement semantics

- **Exact match only**: `oldAlias === fieldValue` → replace. No substring matching. Prevents "MyCalc" from matching "MyCalcTotal".
- **All occurrences**: Every matching field is updated in a single pass. No early exit.
- **Type-safe guards**: Every access is guarded against null/undefined. The function must not throw on any valid AppState shape, including partially-initialized states.
- **No self-rename collision**: The orchestrator reads oldAlias BEFORE writing newAlias. The pure helper never reads from calcStages[idx].alias — it only receives oldAlias/newAlias as parameters.

---

## Design Goals

1. **Atomicity**: The rename and all reference propagation happen in a single store update. No listener ever sees a partially-renamed state.
2. **Testability**: The pure draft helper can be tested with plain objects — no store initialization, no DOM, no side effects.
3. **Simplicity**: Two functions, one file. No event system, no subscriber pattern, no configuration. The orchestrator calls the helper; call sites call the orchestrator.
4. **Completeness**: Every alias-bearing field in AppState is covered. No field is silently skipped.
5. **Safety**: Null/undefined guards on every field access. The function never throws on valid AppState shapes.

---

## Constraints

1. **No global state**: Must not access `window.__db`, `window.__store`, or any global. All state access goes through `getStore()`.
2. **Store-only mutation**: All state changes happen inside `getStore().update()` drafts. No direct mutation of `getState()` return values.
3. **Null-safe**: Every field access must guard against null/undefined. AppState fields like `filters`, `sorts`, `detailBands`, `lookups` may be empty arrays; `selCols` and `colOrder` may be null; `colTotals`, `subtotalFns` may be empty records; `aggModeState` may be null or have null mode sub-objects; calc mode properties (`math`, `compare`, `text`, `date`) may be undefined.
4. **Atomic**: The rename and all propagation happen in a single `store.update()` call. Listeners see either the old state or the fully-renamed state, never an intermediate state where the alias changed but references didn't.
5. **No substring matching**: Replacement is exact-match only. "MyCalc" must not match "MyCalcTotal" or "PrefixMyCalc".
6. **Idempotent**: Renaming "A" → "A" (same name) is a no-op. The orchestrator short-circuits when oldAlias === newAlias.
7. **Post-mutation hooks**: `_afterCombineChange()` must be called after the store update to reconcile selCols, colOrder, subtotalBy, and validation cache.
8. **Layer compliance**: The new file lives in `preact/core/` (alongside store.ts, utils.ts). It imports from `preact/query/layout-selection.ts` for `_afterCombineChange()` — this is a downward dependency (core → query) that already exists in `state-applier.ts`.
9. **No new dependencies**: The implementation uses only existing imports (store, types, layout-selection). No new packages or modules.

---

## Open Questions

1. Should renameAliasRefsInternal walk ALL calc stages for internal references, or only downstream ones (optimization)?
2. Should the duplicate _afterCombineChange() call in calc-stage.tsx:313 onDone callback be removed?
3. Should the pure helper also handle selCols/colOrder for batch-operation self-containment, or leave them to _afterCombineChange()?

---

## Overview + Metadata + Problem + Scope + Requirements

## Overview

When a calculated column's alias is renamed (e.g., "MyCalc" → "NewName"), all references to the old alias throughout the application state must be updated to the new name. These references exist in filters, sorts, aggregates, group-by columns, subtotal columns, merged columns, detail band key pairs, lookup key pairs, calc-internal expressions (math steps, compare conditions/values, text parts/sources, date sources), selected columns, column order, total function records (`colTotals`), subtotal function records (`subtotalFns`), and persisted aggregation mode state snapshots (`aggModeState`) that contain nested alias references across all four modes (none, group, totals, subtotals).

The previous implementation (`alias-ref-updater.ts`) read from `window.__db` — a global that was never populated in the Preact codebase. Alias rename propagation has been broken since the Preact migration. That file has been deleted. This design specifies a clean-slate, store-based replacement that operates entirely through the reactive store's `update()` mechanism.

---

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | rnd-dd-author |
| **Created** | 2026-06-14 |
| **Scope** | `preact/core/` + 3 call sites |
| **Layers touched** | Core (new module), UI (3 call sites) |
| **Files affected** | 1 new file, 3 modified files |

---

## Problem Statement

### What's Broken

The previous alias rename propagation mechanism (`preact/query/alias-ref-updater.ts`) depended on `window.__db` — a global database reference from the legacy jQuery architecture. In the Preact codebase, `window.__db` is never populated. The result:

1. **Silent data corruption**: When a user renames a calculated column alias, the alias field updates but all references in filters, sorts, aggregates, group-by, lookups, detail bands, and calc-internal expressions retain the old alias. The report silently breaks — filters target nonexistent columns, sorts reference ghosts, aggregates compute against nothing.

2. **No error signal**: Validation may or may not catch the stale references depending on timing. The user sees broken output with no clear indication that a rename caused it.

3. **Dead code**: The old `alias-ref-updater.ts` was already deleted. There is no propagation mechanism at all. The three call sites that trigger alias renames (calc-stage input, rename modal, renameProjectedColumn utility) only update the alias field itself.

### Root Cause

The legacy architecture used a global `window.__db` object as the single source of truth. The Preact architecture uses a reactive store (`preact/core/store.ts`). The propagation mechanism was never rewritten to use the store.

---

## Scope

### In Scope

- New module `preact/core/alias-rename.ts` with two exports:
  - `renameCalcAlias(idx: number, newAlias: string): void` — orchestrator
  - `renameAliasRefsInternal(draft: AppState, oldAlias: string, newAlias: string): void` — pure draft helper
- Migration of 3 call sites to use `renameCalcAlias`:
  - `preact/ui/sections/calc-stage.tsx:99-101` — inline alias input handler
  - `preact/ui/components/rename-modal.tsx:44-55` — rename modal calc branch
  - `preact/core/utils.ts:236-238` — `renameProjectedColumn` calc branch
- Propagation to all alias-bearing AppState fields (see Detailed Design)
- Propagation to calc-internal typed-value references (math steps, compare conditions/values, text parts/sources, date sources)
- Propagation to Record-key fields: `colTotals` and `subtotalFns` (key migration, not value replacement)
- Propagation to nested alias-bearing fields within `aggModeState` snapshots (all four modes: none, group, totals, subtotals)

### Out of Scope

- Physical column label renames (handled by `setColLabel` — these don't affect alias references)
- Serialization/deserialization format changes (the rename happens at runtime; serialized state already uses aliases)
- Undo/redo support (no undo system exists in the codebase)
- Batch/multi-alias rename UI (the pure helper supports it, but no UI calls it yet)
- Validation of the new alias (uniqueness, empty-string, etc. — this is the caller's responsibility)

---

## Requirements

1. When a calc stage alias is renamed, all references to the old alias in other AppState fields must be updated to the new alias.
2. The rename and propagation must be atomic — a single store update.
3. The mechanism must operate entirely through the reactive store. No `window.__db`, no global state.
4. Calc-internal references (math steps, compare conditions/values, text parts/sources, date sources) that reference the old alias via `{ type: 'column', value: '<alias>' }` must be updated.
5. `selCols` and `colOrder` must be reconciled after rename (handled by existing `_afterCombineChange()`).
6. Validation must be invalidated after rename (handled by `_afterCombineChange()` which calls `invalidateValidation()` internally).
7. All three existing call sites must be migrated to the new function.
8. The pure draft helper must be independently testable without store initialization.
9. Record-key fields (`colTotals`, `subtotalFns`) must have their keys migrated from old alias to new alias, preserving the function-name values.
10. `aggModeState` snapshots for all four modes (none, group, totals, subtotals) must have nested alias references updated, preventing stale aliases from being restored on mode switch.

---

---

## Call Site Integration + Detailed Design + Edge Cases + Validation + Open Questions + Test Plan + Appendix

## Call Site Integration

### 1. `preact/ui/sections/calc-stage.tsx` (lines 99-101)

**Before:**
```ts
const handleAliasChange = useCallback((val: string) => {
  updateCalc(calcDraft => { calcDraft.alias = val; });
}, [i, updateCalc]);
```

**After:**
```ts
import { renameCalcAlias } from '../../core/alias-rename';

const handleAliasChange = useCallback((val: string) => {
  renameCalcAlias(i, val);
}, [i]);
```

**Notes:**
- `renameCalcAlias` replaces `updateCalc` for alias changes only. Other calc property changes (mode, enabled, math operators, etc.) continue to use `updateCalc`.
- The dependency array drops `updateCalc` since `renameCalcAlias` is a module-level import (stable reference).
- `_afterCombineChange()` is called inside `renameCalcAlias`, so the existing post-rename layout reconciliation is preserved.

### 2. `preact/ui/components/rename-modal.tsx` (lines 44-55)

**Before:**
```ts
if (isCalc) {
  if (newName && newName !== current) {
    const calcStages = getStore().getState().calcStages;
    const calc = Array.isArray(calcStages) ? calcStages[target.calcIdx!] : null;
    if (calc) {
      getStore().update(draft => {
        if (draft.calcStages[target.calcIdx!]) {
          draft.calcStages[target.calcIdx!].alias = newName;
        }
      });
    }
  }
}
```

**After:**
```ts
import { renameCalcAlias } from '../../core/alias-rename';

if (isCalc) {
  if (newName && newName !== current) {
    renameCalcAlias(target.calcIdx!, newName);
  }
}
```

**Notes:**
- The intermediate `calcStages`/`calc` existence check is subsumed by `renameCalcAlias`'s internal guard.
- The `onDone` callback in the parent (`calc-stage.tsx:313`) already calls `_afterCombineChange()`. After this change, `_afterCombineChange()` is called twice (once inside `renameCalcAlias`, once in `onDone`). This is harmless — `_afterCombineChange()` is idempotent for selCols/colOrder when no new columns appeared. The duplicate call can be removed in a follow-up if desired.

### 3. `preact/core/utils.ts` (lines 228-239, inside `renameProjectedColumn`)

**Before:**
```ts
if (src.kind === 'calc') {
  const calc = Array.isArray(getStore().getState().calcStages) ? getStore().getState().calcStages[src.idx] : null;
  if (!calc) return false;
  const current = (calc.alias || '').trim() || alias;
  const next = window.prompt('Rename column:', current);
  if (next === null) return false;
  const renamed = next.trim();
  if (!renamed || renamed === current) return false;
  getStore().update(draft => {
    if (draft.calcStages[src.idx]) draft.calcStages[src.idx].alias = renamed;
  });
  return true;
}
```

**After:**
```ts
import { renameCalcAlias } from './alias-rename';

if (src.kind === 'calc') {
  const calc = Array.isArray(getStore().getState().calcStages) ? getStore().getState().calcStages[src.idx] : null;
  if (!calc) return false;
  const current = (calc.alias || '').trim() || alias;
  const next = window.prompt('Rename column:', current);
  if (next === null) return false;
  const renamed = next.trim();
  if (!renamed || renamed === current) return false;
  renameCalcAlias(src.idx, renamed);
  return true;
}
```

**Notes:**
- Only the `getStore().update(...)` block is replaced. The `window.prompt` and guard logic remain unchanged.
- `renameProjectedColumn` does not currently call `_afterCombineChange()` after the rename. The new `renameCalcAlias` adds this call, which is a behavior improvement (layout reconciliation now happens for prompt-based renames too).

---

## Detailed Design

### Function Signatures

```ts
// preact/core/alias-rename.ts

import type { AppState } from '../types';
import { getStore } from './store';
import { _afterCombineChange } from '../query/layout-selection';

/**
 * Rename a calculated column's alias and propagate the change to all
 * referencing fields in the application state.
 *
 * Opens a single store.update() transaction, reads the old alias,
 * writes the new alias, delegates to renameAliasRefsInternal for
 * propagation, then calls _afterCombineChange() for layout reconciliation.
 *
 * @param idx - Index of the calc stage in AppState.calcStages
 * @param newAlias - The new alias string (trimmed, non-empty)
 */
export function renameCalcAlias(idx: number, newAlias: string): void;

/**
 * Pure draft helper: walk all alias-bearing fields in an AppState draft
 * and replace exact matches of oldAlias with newAlias.
 *
 * Does NOT access the store, DOM, or any global state.
 * Does NOT update selCols or colOrder (handled by _afterCombineChange).
 * Exported for batch/multi-alias operations and unit testing.
 *
 * @param draft - Mutable AppState draft
 * @param oldAlias - The alias to find (exact match)
 * @param newAlias - The replacement alias
 */
export function renameAliasRefsInternal(
  draft: AppState,
  oldAlias: string,
  newAlias: string,
): void;
```

### Orchestrator Implementation Sketch

```ts
export function renameCalcAlias(idx: number, newAlias: string): void {
  const trimmed = newAlias.trim();
  if (!trimmed) return;

  getStore().update(draft => {
    const calc = draft.calcStages[idx];
    if (!calc) return;
    const oldAlias = (calc.alias || '').trim();
    if (!oldAlias || oldAlias === trimmed) return;
    calc.alias = trimmed;
    renameAliasRefsInternal(draft, oldAlias, trimmed);
  });

  _afterCombineChange();
}
```

### Draft Helper Implementation Sketch

```ts
export function renameAliasRefsInternal(
  draft: AppState,
  oldAlias: string,
  newAlias: string,
): void {
  // A. Simple string fields
  for (const f of draft.filters ?? []) {
    if (f.col === oldAlias) f.col = newAlias;
  }
  for (const s of draft.sorts ?? []) {
    if (s.col === oldAlias) s.col = newAlias;
  }
  for (const a of draft.aggregates ?? []) {
    if (a.col === oldAlias) a.col = newAlias;
  }

  // B. String array fields
  replaceInArray(draft.groupBy, oldAlias, newAlias);
  replaceInArray(draft.subtotalBy, oldAlias, newAlias);
  replaceInArray(draft.mergedCols, oldAlias, newAlias);

  // C. KeyPair left fields
  for (const band of draft.detailBands ?? []) {
    for (const kp of band.keyPairs ?? []) {
      if (kp.left === oldAlias) kp.left = newAlias;
    }
    for (const s of band.sorts ?? []) {
      if (s.col === oldAlias) s.col = newAlias;
    }
  }
  for (const lu of draft.lookups ?? []) {
    for (const kp of lu.keyPairs ?? []) {
      if (kp.left === oldAlias) kp.left = newAlias;
    }
  }

  // D + E. Calc-internal references (all calc stages, not just the renamed one)
  for (const calc of draft.calcStages ?? []) {
    // D. Compare conditions
    const compare = calc.compare as { conditions?: Array<{ col?: string }> } | undefined;
    if (compare?.conditions) {
      for (const cond of compare.conditions) {
        if (cond.col === oldAlias) cond.col = newAlias;
      }
    }

    // E. Typed-value references
    renameTypedValueRefs(calc.math, oldAlias, newAlias);   // math.steps[].value
    renameCompareTypedValues(calc.compare, oldAlias, newAlias); // trueValue/falseValue
    renameTextTypedValueRefs(calc.text, oldAlias, newAlias);    // text.parts[].value, text.source.value
    renameDateTypedValueRefs(calc.date, oldAlias, newAlias);    // date.source.value
  }

  // G. Record-key fields (key = column alias)
  migrateRecordKey(draft.colTotals, oldAlias, newAlias);
  migrateRecordKey(draft.subtotalFns, oldAlias, newAlias);

  // H. aggModeState — nested alias-bearing fields across all modes
  if (draft.aggModeState && typeof draft.aggModeState === 'object') {
    // none mode: selCols
    const noneMode = draft.aggModeState.none as { selCols?: string[] | null } | null;
    if (noneMode?.selCols) replaceInArray(noneMode.selCols, oldAlias, newAlias);

    // group mode: selCols, groupBy, aggregates[].col
    const groupMode = draft.aggModeState.group as {
      selCols?: string[] | null; groupBy?: string[];
      aggregates?: Array<{ col?: string }>;
    } | null;
    if (groupMode) {
      if (groupMode.selCols) replaceInArray(groupMode.selCols, oldAlias, newAlias);
      replaceInArray(groupMode.groupBy, oldAlias, newAlias);
      if (groupMode.aggregates) {
        for (const ag of groupMode.aggregates) {
          if (ag.col === oldAlias) ag.col = newAlias;
        }
      }
    }

    // totals mode: selCols, colTotals (Record keys)
    const totalsMode = draft.aggModeState.totals as {
      selCols?: string[] | null; colTotals?: Record<string, string>;
    } | null;
    if (totalsMode) {
      if (totalsMode.selCols) replaceInArray(totalsMode.selCols, oldAlias, newAlias);
      migrateRecordKey(totalsMode.colTotals, oldAlias, newAlias);
    }

    // subtotals mode: selCols, subtotalBy, subtotalFns (Record keys)
    const subtotalsMode = draft.aggModeState.subtotals as {
      selCols?: string[] | null; subtotalBy?: string[];
      subtotalFns?: Record<string, string>;
    } | null;
    if (subtotalsMode) {
      if (subtotalsMode.selCols) replaceInArray(subtotalsMode.selCols, oldAlias, newAlias);
      replaceInArray(subtotalsMode.subtotalBy, oldAlias, newAlias);
      migrateRecordKey(subtotalsMode.subtotalFns, oldAlias, newAlias);
    }
  }
}
```

### Typed-Value Reference Helpers (internal to alias-rename.ts)

These are small private helpers that check `type === 'column'` before replacing `value`:

```ts
/** Replace in math steps where type === 'column' */
function renameTypedValueRefs(
  math: { steps?: Array<{ type?: string; value?: string }> } | undefined | unknown,
  oldAlias: string, newAlias: string,
): void {
  const m = math as { steps?: Array<{ type?: string; value?: string }> } | undefined;
  if (!m?.steps) return;
  for (const step of m.steps) {
    if (step.type === 'column' && step.value === oldAlias) step.value = newAlias;
  }
}

/** Replace in compare trueValue/falseValue where type === 'column' */
function renameCompareTypedValues(
  compare: { trueValue?: { type?: string; value?: string }; falseValue?: { type?: string; value?: string } } | undefined | unknown,
  oldAlias: string, newAlias: string,
): void {
  const c = compare as { trueValue?: { type?: string; value?: string }; falseValue?: { type?: string; value?: string } } | undefined;
  if (!c) return;
  if (c.trueValue?.type === 'column' && c.trueValue.value === oldAlias) c.trueValue.value = newAlias;
  if (c.falseValue?.type === 'column' && c.falseValue.value === oldAlias) c.falseValue.value = newAlias;
}

/** Replace in text parts[] and text.source where type === 'column' */
function renameTextTypedValueRefs(
  text: { parts?: Array<{ type?: string; value?: string }>; source?: { type?: string; value?: string } } | undefined | unknown,
  oldAlias: string, newAlias: string,
): void {
  const t = text as { parts?: Array<{ type?: string; value?: string }>; source?: { type?: string; value?: string } } | undefined;
  if (!t) return;
  if (t.parts) {
    for (const p of t.parts) {
      if (p.type === 'column' && p.value === oldAlias) p.value = newAlias;
    }
  }
  if (t.source?.type === 'column' && t.source.value === oldAlias) t.source.value = newAlias;
}

/** Replace in date.source where type === 'column' */
function renameDateTypedValueRefs(
  date: { source?: { type?: string; value?: string } } | undefined | unknown,
  oldAlias: string, newAlias: string,
): void {
  const d = date as { source?: { type?: string; value?: string } } | undefined;
  if (!d?.source) return;
  if (d.source.type === 'column' && d.source.value === oldAlias) d.source.value = newAlias;
}

/** Replace all occurrences of oldAlias with newAlias in a string array (in-place). */
function replaceInArray(arr: string[] | undefined, oldAlias: string, newAlias: string): void {
  if (!arr) return;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === oldAlias) arr[i] = newAlias;
  }
}

/** Migrate a Record key from oldAlias to newAlias, preserving the value. No-op if oldAlias not present. */
function migrateRecordKey(
  rec: Record<string, string> | undefined | null,
  oldAlias: string, newAlias: string,
): void {
  if (!rec || !(oldAlias in rec)) return;
  rec[newAlias] = rec[oldAlias];
  delete rec[oldAlias];
}
```

---

## Edge Cases

### 1. Null/undefined optional fields

All optional fields (`filters`, `sorts`, `aggregates`, `detailBands`, `lookups`, `calcStages`, `groupBy`, `subtotalBy`, `mergedCols`, `colTotals`, `subtotalFns`, `aggModeState`) are guarded with `?? []`, explicit null checks, or `in` operator guards. The function never throws on a valid AppState shape.

### 2. selCols is a Set

`selCols` is `Set<string> | null`. It is NOT updated by the pure draft helper. Instead, `_afterCombineChange()` reconciles it after the store update:
- The old alias is no longer in `buildColSourceMap()` → removed from selCols
- The new alias is now in `buildColSourceMap()` → added to selCols

### 3. colOrder is a nullable array

Same as selCols — handled by `_afterCombineChange()`, not the pure helper.

### 4. Non-matching aliases

If no fields reference the old alias, the function completes without modification (besides the alias field itself). This is the common case when a calc is renamed before being referenced.

### 5. Multiple occurrences

If the same alias appears in multiple fields (e.g., a filter AND a sort AND a math step), all occurrences are updated in a single pass. No early exit.

### 6. Self-referencing calc

A calc stage's internal references (math steps, compare conditions) typically reference OTHER columns, not its own alias. The validator already prevents self-references (`calc-validator.ts:43`). The rename function doesn't need special self-reference handling.

### 7. Empty or whitespace newAlias

The orchestrator trims and rejects empty strings. Callers should also guard, but the orchestrator is the final safety net.

### 8. Same alias (no-op rename)

The orchestrator short-circuits when `oldAlias === trimmedNewAlias`. No store update, no `_afterCombineChange()` call.

### 9. Calc stage index out of bounds

The orchestrator guards with `if (!calc) return` inside the draft. No throw, no side effects.

### 10. Calc-internal references in OTHER calc stages

When CalcA (alias "MyCalc") is renamed to "NewName", CalcB's math steps that reference "MyCalc" must be updated. The draft helper iterates ALL calcStages, not just the renamed one. This is correct.

### 11. Detail band sorts[].col

Detail band sorts reference child-table physical columns, not parent aliases. Updating them is harmless (the old alias wouldn't match a physical column name) but technically unnecessary. Included for completeness and consistency.

### 12. aggModeState cross-mode stale aliases

When a calc is renamed while the user is in "group" mode, the live `groupBy` and `aggregates` are updated by the pure helper. But `aggModeState.totals.colTotals` and `aggModeState.subtotals.subtotalFns` — saved snapshots from previous mode usage — also contain the old alias. If not updated, switching to "totals" or "subtotals" mode later would restore stale aliases via `loadAggModeState()`, silently breaking aggregation. The pure helper walks ALL mode snapshots, not just the active one.

### 13. Record-key migration preserves values

For `colTotals` and `subtotalFns`, the migration is a key rename, not a value replacement. The value (e.g., 'SUM', 'AVG') must be preserved exactly. The `migrateRecordKey` helper copies the value to the new key and deletes the old key in a single operation. If the old key doesn't exist, no mutation occurs.

---

## Validation & Layout Integration

### _afterCombineChange() (query/layout-selection.ts:226)

Called by the orchestrator after the store update. This function:

1. Calls `invalidateValidation()` — clears the validation cache so the next `getValidation()` recomputes
2. Rebuilds the column map from current state (reflecting the new alias)
3. Updates `selCols`: adds new columns, removes stale ones (unless in `_disabledCardCols`)
4. Updates `colOrder`: filters out stale columns, appends new ones
5. Calls `_syncSubtotalByToLayout()` — reconciles subtotalBy with current layout

This single call handles all post-rename reconciliation. No additional calls to `invalidateValidation()` are needed.

### Call ordering

```
renameCalcAlias(idx, newAlias)
  └─ getStore().update(draft => {
       ├─ read oldAlias from draft.calcStages[idx].alias
       ├─ write draft.calcStages[idx].alias = newAlias
       └─ renameAliasRefsInternal(draft, oldAlias, newAlias)
     })
  └─ _afterCombineChange()
       ├─ invalidateValidation()
       ├─ store.update(draft => { /* selCols/colOrder reconciliation */ })
       └─ _syncSubtotalByToLayout()
```

Two store updates occur: one for the rename + propagation, one for layout reconciliation. This is acceptable — listeners see two state transitions, but both are consistent. The first transition has the new alias and all propagated references; the second adjusts selCols/colOrder. No listener sees an inconsistent state.

---

## Open Questions

### 1. Calc-internal reference scope: should we walk ALL calc stages or only downstream ones?

**Current design**: Walk ALL calc stages. Any calc can reference any other calc's alias, so all must be checked.

**Alternative**: Only walk calc stages that appear AFTER the renamed one in the array (since calcs can only reference earlier calcs). This would be an optimization, not a correctness issue.

**Decision**: Walk all. The array is small (typically <10 calc stages), and the optimization adds complexity (index comparison) for negligible gain.

### 2. Rename modal: duplicate _afterCombineChange() call

After migration, `calc-stage.tsx:313` calls `_afterCombineChange()` in the `onDone` callback of `RenameModal`, AND `renameCalcAlias` also calls it internally. This results in two calls.

**Options**:
- A. Leave it — `_afterCombineChange()` is idempotent, double call is harmless
- B. Remove the `onDone` callback's `_afterCombineChange()` call from `calc-stage.tsx:313`
- C. Remove the `_afterCombineChange()` call from `renameCalcAlias` and require callers to call it

**Decision**: Option A for now. Option B is a clean-up that can be done in the same PR. Option C violates the design goal of self-contained orchestration.

### 3. Should renameAliasRefsInternal also handle selCols/colOrder?

**Current design**: No — `_afterCombineChange()` handles them.

**Trade-off**: Including selCols/colOrder in the pure helper makes it fully self-contained (useful for batch operations that don't call `_afterCombineChange()`). But it duplicates logic and risks inconsistency.

**Decision**: Exclude them. If batch operations need selCols/colOrder updates, they should call `_afterCombineChange()` themselves. The pure helper's job is structural reference propagation, not layout reconciliation.

---

## Test Plan

### Unit Tests for `renameAliasRefsInternal` (pure function, no store)

**File**: `preact/tests/core/alias-rename.test.ts`

1. **Basic propagation**: Create a draft with filters, sorts, aggregates referencing "MyCalc". Call `renameAliasRefsInternal(draft, 'MyCalc', 'NewName')`. Assert all references updated.

2. **Calc-internal math steps**: Draft with calcStages[0] (alias "MyCalc") and calcStages[1] (math steps referencing "MyCalc"). Rename. Assert calcStages[1].math.steps[].value updated.

3. **Calc-internal compare conditions**: Draft with compare.conditions[].col === "MyCalc". Rename. Assert updated.

4. **Calc-internal compare trueValue/falseValue**: Draft with compare.trueValue = { type: 'column', value: 'MyCalc' }. Rename. Assert updated. Verify { type: 'number', value: '42' } is NOT updated.

5. **Calc-internal text parts and source**: Draft with text.parts[].value and text.source.value referencing "MyCalc". Rename. Assert updated.

6. **Calc-internal date source**: Draft with date.source = { type: 'column', value: 'MyCalc' }. Rename. Assert updated.

7. **KeyPair left fields**: Draft with detailBands[].keyPairs[].left and lookups[].keyPairs[].left === "MyCalc". Rename. Assert updated.

8. **String array fields**: Draft with groupBy, subtotalBy, mergedCols containing "MyCalc". Rename. Assert updated.

9. **No false positives**: Draft with "MyCalcTotal" in filters[].col. Rename "MyCalc" → "NewName". Assert "MyCalcTotal" is NOT changed (exact match only).

10. **Null-safe**: Draft with all optional fields undefined/null. Call function. Assert no throw.

11. **Empty arrays**: Draft with filters=[], sorts=[], etc. Call function. Assert no throw, no changes.

12. **Multiple occurrences**: Draft with "MyCalc" in filters, sorts, AND aggregates. Rename. Assert all three updated.

13. **colTotals key migration**: Draft with `colTotals = { MyCalc: 'SUM', OtherCol: 'AVG' }`. Rename "MyCalc" → "NewName". Assert `colTotals = { NewName: 'SUM', OtherCol: 'AVG' }`. Verify old key "MyCalc" is deleted, value 'SUM' is preserved under new key.

14. **colTotals no-op when key absent**: Draft with `colTotals = { OtherCol: 'SUM' }`. Rename "MyCalc" → "NewName". Assert colTotals unchanged.

15. **subtotalFns key migration**: Draft with `subtotalFns = { MyCalc: 'SUM' }`. Rename "MyCalc" → "NewName". Assert `subtotalFns = { NewName: 'SUM' }`.

16. **aggModeState group mode**: Draft with `aggModeState.group = { groupBy: ['MyCalc'], aggregates: [{ fn: 'SUM', col: 'MyCalc' }], selCols: ['MyCalc', 'Other'] }`. Rename. Assert groupBy, aggregates[].col, and selCols all updated.

17. **aggModeState totals mode**: Draft with `aggModeState.totals = { colTotals: { MyCalc: 'SUM' }, selCols: ['MyCalc'] }`. Rename. Assert colTotals key migrated and selCols updated.

18. **aggModeState subtotals mode**: Draft with `aggModeState.subtotals = { subtotalBy: ['MyCalc'], subtotalFns: { MyCalc: 'AVG' }, selCols: ['MyCalc'] }`. Rename. Assert subtotalBy, subtotalFns key, and selCols all updated.

19. **aggModeState none mode**: Draft with `aggModeState.none = { selCols: ['MyCalc', 'Other'] }`. Rename. Assert selCols updated.

20. **aggModeState null-safe**: Draft with `aggModeState = null`. Call function. Assert no throw.

21. **aggModeState partial modes**: Draft with `aggModeState = { group: null, totals: { colTotals: { MyCalc: 'SUM' } } }` (subtotals and none missing). Rename. Assert totals.colTotals migrated, no throw for missing modes.

22. **aggModeState cross-mode consistency**: Draft with "MyCalc" in live `groupBy` AND in `aggModeState.group.groupBy` AND in `aggModeState.subtotals.subtotalBy`. Rename. Assert all three updated — live fields and saved snapshots.

### Integration Tests for `renameCalcAlias` (with store)

23. **End-to-end rename**: Initialize store with calcStages, filters referencing the calc alias. Call `renameCalcAlias(0, 'NewName')`. Assert store state has new alias everywhere.

24. **selCols reconciliation**: Initialize store with selCols = new Set(['MyCalc', 'OtherCol']). Call `renameCalcAlias(0, 'NewName')`. Assert selCols contains 'NewName' and not 'MyCalc' (via _afterCombineChange).

25. **colOrder reconciliation**: Initialize store with colOrder = ['MyCalc', 'OtherCol']. Call `renameCalcAlias(0, 'NewName')`. Assert colOrder contains 'NewName' and not 'MyCalc'.

26. **No-op rename**: Call `renameCalcAlias(0, 'MyCalc')` when alias is already 'MyCalc'. Assert no store update occurred (use subscribe to verify).

27. **Empty newAlias rejected**: Call `renameCalcAlias(0, '')`. Assert no store update.

28. **Out-of-bounds idx**: Call `renameCalcAlias(99, 'NewName')`. Assert no throw, no store update.

29. **End-to-end colTotals migration**: Initialize store with calcStages and `colTotals = { MyCalc: 'SUM' }`. Call `renameCalcAlias(0, 'NewName')`. Assert store state has `colTotals = { NewName: 'SUM' }`.

30. **End-to-end aggModeState migration**: Initialize store with calcStages and `aggModeState` containing "MyCalc" in group.groupBy and totals.colTotals. Call `renameCalcAlias(0, 'NewName')`. Assert all aggModeState snapshots updated.

---

## Appendix: Research Findings

### Store mechanics (preact/core/store.ts)

- `getStore().update(updater)` deep-clones state (preserving Set objects via custom `deepClone`), passes draft to updater, replaces state, notifies all listeners.
- Listeners receive `(newState, prevState)` — both are immutable snapshots.
- The store is a lazy singleton: `getStore()` creates it on first call if not initialized.

### _afterCombineChange() (preact/query/layout-selection.ts:226)

- Calls `invalidateValidation()` first (clears cache).
- Builds colMap from current state via `buildColSourceMap()`.
- Updates selCols: adds columns not in `_seenCols`, removes columns not in current colMap (unless in `_disabledCardCols`).
- Updates colOrder: filters to current columns, appends new ones.
- Calls `_syncSubtotalByToLayout()`.
- Already imported by `state-applier.ts` — the core → query dependency is established.

### Calc-internal reference shapes (from sql-calcs.ts and calc-validator.ts)

All calc-internal column references use the pattern `{ type: 'column', value: '<alias>' }`. The `type` field discriminates between column references, literal numbers, and literal text. Only entries with `type === 'column'` contain aliases that need propagation.

| Mode | Property | Shape | Alias location |
|------|----------|-------|----------------|
| math | steps[] | `{ type: 'column', value: '<alias>', op?: string }` | `.value` when `.type === 'column'` |
| compare | conditions[] | `{ col: '<alias>', op: string, val: string }` | `.col` (always a string, no type discriminant) |
| compare | trueValue/falseValue | `{ type: 'column', value: '<alias>' }` | `.value` when `.type === 'column'` |
| text | parts[] | `{ type: 'column', value: '<alias>' }` | `.value` when `.type === 'column'` |
| text | source | `{ type: 'column', value: '<alias>' }` | `.value` when `.type === 'column'` |
| date | source | `{ type: 'column', value: '<alias>' }` | `.value` when `.type === 'column'` |

Note: compare.conditions[].col is a bare string (no type discriminant). It's always a column alias. All other calc-internal references use the typed-value pattern.

### Record-key fields: colTotals and subtotalFns (from types.ts, validation.ts, sql-totals.ts, sql-subtotals.ts, state-hydrator.ts)

Both fields are `Record<string, string>` where the key is a column alias and the value is an aggregate function name ('SUM', 'AVG', 'COUNT', 'skip', etc.). They are NOT arrays — they require key migration (delete old key, insert new key with same value), not value replacement.

| Field | Type | Consumers that key on alias |
|-------|------|-----------------------------|
| `colTotals` | `Record<string, string>` | `validation.ts:505` (Object.entries), `sql-totals.ts:84,90` (lookup by alias), `state-hydrator.ts:240-242` (builds from payload) |
| `subtotalFns` | `Record<string, string>` | `validation.ts:569` (Object.entries), `sql-subtotals.ts:123,248` (lookup by alias), `state-hydrator.ts:251-253` (builds from payload) |

### aggModeState structure (from ui/aggregation.ts, core/state-hydrator.ts)

`aggModeState` is a per-mode snapshot dictionary. Each mode saves a subset of the live alias-bearing fields when the user switches away from that mode, and restores them when the user switches back. The snapshots are plain objects (not Sets), with serialized arrays for selCols.

| Mode key | Saved fields | Alias-bearing |
|----------|-------------|---------------|
| `none` | `selCols` | selCols (string[]) |
| `group` | `selCols`, `groupBy`, `aggregates` | selCols (string[]), groupBy (string[]), aggregates[].col (string) |
| `totals` | `selCols`, `colTotals` | selCols (string[]), colTotals (Record keys) |
| `subtotals` | `selCols`, `subtotalBy`, `subtotalFns`, `subtotalGrandTotal`, `subtotalSpacer`, `subtotalOnTop`, `subtotalStrategy` | selCols (string[]), subtotalBy (string[]), subtotalFns (Record keys) |

**Critical insight:** `_afterCombineChange()` only reconciles the LIVE `draft.selCols`, `draft.groupBy`, etc. It does NOT walk `aggModeState` snapshots. If a calc is renamed while in "group" mode, the "totals" and "subtotals" snapshots retain stale aliases. When the user later switches to those modes, `loadAggModeState()` copies stale aliases back into the live state, undoing the rename's effect for those fields.

---
