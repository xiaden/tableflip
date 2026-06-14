# Design: Default Selection Conventions Refactoring

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | rnd-dd-author |
| **Created** | 2026-06-14 |
| **Scope** | Codebase-wide refactoring of null/empty = ALL convention |
| **Layers touched** | Core, Catalog, Query, Report, UI |
| **Files affected** | 16+ files across 7 type fields |

---

## Overview

This document describes a codebase-wide refactoring to eliminate the inverted `null`/empty = "ALL items" convention that pervades TableFlip's selection and column fields. The current convention is semantically backwards (null means "everything" instead of "nothing"), makes the "no columns selected" state unrepresentable, diverges from the existing `LookupSpec.cols` pattern, and causes developer confusion. The refactoring establishes two clear categories — pool-selection defaults (full populated list) and constraint-accumulation defaults (empty array = nothing) — and migrates all 7 affected type fields to the correct convention with full backward compatibility for existing `.rcjson` files.

---

## Problem Statement

### The Inverted Convention

Seven type fields across the codebase use `null` or empty array (`[]`) to mean "select ALL items from the pool." This is semantically inverted:

- `null` should mean "nothing" or "not configured"
- `[]` should mean "empty selection" or "no items"
- Neither should mean "everything"

### Concrete Bugs and Issues

1. **Unrepresentable "None" state**: In `detail-band-stage.tsx`, the `selectNoneCols` handler sets `band.cols = []`, but the column catalog consumer at `column-catalog.ts:241` treats `null` and `[]` identically — both resolve to all columns. The UI explicitly disabled a "None" button because the catalog semantic made it impossible.

2. **Inconsistency with LookupSpec**: `LookupSpec.cols` uses `string[]` (non-nullable) where empty = no projection. `DetailBandSpec.cols` diverges with `string[] | null` where null = all columns. Two similar concepts, two opposite conventions.

3. **Materialization cascade**: The UI layer (`column-chips.tsx`) must constantly check for null and "materialize" it to the full list on first interaction. This creates a hidden state transition: the store says "all" (null), but the first user action silently converts it to an explicit list. This makes debugging selection issues difficult.

4. **Developer confusion**: Every new contributor must learn that `null` means "all" in these fields. The convention is never documented — it's discovered by reading consumer code.

5. **Type safety erosion**: Nullable types (`string[] | null`) force null checks at every consumer site. With 15+ consumer locations, this is a significant surface area for bugs.

### Affected Fields

| # | Field | Type | Location | Current null meaning |
|---|-------|------|----------|---------------------|
| 1 | `DetailBandSpec.cols` | `string[] \| null` | types.ts:57 | All columns from child table |
| 2 | `AppState.baseCols` | `string[] \| null` | types.ts:169 | All columns from base table |
| 3 | `AppState.selCols` | `Set<string> \| null` | types.ts:173 | All output columns selected |
| 4 | `AppState.colOrder` | `string[] \| null` | types.ts:174 | Default natural order |
| 5 | `ReportSpec.pipeline.baseCols` | `string[] \| null` | types.ts:220 | All base columns |
| 6 | `ReportSpec.outputColumns` | `string[] \| null` | types.ts:226 | Auto/project all columns |
| 7 | `ResultSetMetadata.displayCols` | `string[] \| null` | result-set.ts:29 | Use columns array as-is |

---

## Scope

### In Scope

- All 7 type fields listed above
- State creation functions (`createAppState`, `createReportSpec`, `createDetailBandSpec`)
- State hydration (`core/state-hydrator.ts`) — backward compatibility for old `.rcjson` files
- State serialization (`core/state-serializer.ts`)
- All consumer sites (catalog, query plan, SQL generation, validation, UI, report output)
- `aggModeState` sub-selections (same null=ALL pattern in `state-hydrator.ts:272/281/285` and `ui/aggregation.ts:124/132/139/151`)

### Out of Scope

- `LookupSpec.cols` — already uses correct `string[]` convention (empty = no projection)
- Constraint-accumulation fields (`filters`, `sorts`, `aggregates`, `groupBy`, etc.) — already use `[]` = nothing correctly
- State version bump — this refactoring is internal; the serialized format remains compatible

---

## Architecture

### Category Model

The refactoring establishes two clearly separated categories:

#### Category A: Pool-Selection Defaults

Fields that *select* from a pool of available items. These default to the **FULL POPULATED LIST**. `null`/`[]` means "nothing selected" or "not yet configured":

| Field | Pool source | Default value |
|-------|-------------|---------------|
| `DetailBandSpec.cols` | Child table columns (`tables[rightId].cols`) | Full list of child table columns |
| `AppState.baseCols` | Base table columns (`tables[base].cols`) | Full list of base table columns |
| `AppState.selCols` | Projected output columns | `Set` of all projected columns |
| `ReportSpec.pipeline.baseCols` | Base table columns | Full list of base table columns |
| `ReportSpec.outputColumns` | All projected column aliases | Full list of projected aliases |
| `ResultSetMetadata.displayCols` | Result set columns | Full list of result columns |

**Key invariant**: These fields are **never null** after initialization. They are always populated with the full list or an explicit subset.

#### Category B: Ordering Default

`colOrder` is ordering, not selection. It defaults to the **full list in natural order**. `null`/`[]` means "no custom order" → use default ordering:

| Field | Default value | null/[] meaning |
|-------|---------------|-----------------|
| `AppState.colOrder` | Full list in natural order | Use default ordering (same as current `\|\| cols` fallback) |

**Key invariant**: `colOrder` is **never null** after initialization. It is always populated with the full list in natural order or an explicit reorder.

#### Category C: Constraint-Accumulation Defaults (unchanged)

Filters, sorts, aggregates, groupBy, etc. already use `[]` to mean "nothing configured." No change needed.

### Type Changes

#### Before

```typescript
// types.ts
export interface DetailBandSpec {
  cols: string[] | null;  // null = all columns
  // ...
}

export interface AppState {
  baseCols: string[] | null;   // null = all base columns
  selCols: Set<string> | null; // null = all selected
  colOrder: string[] | null;   // null = default order
  // ...
}

export interface ReportSpec {
  pipeline: {
    baseCols: string[] | null;  // null = all base columns
    // ...
  };
  outputColumns: string[] | null; // null = project all
  // ...
}

// result-set.ts
export interface ResultSetMetadata {
  displayCols: string[] | null; // null = use columns as-is
  // ...
}
```

#### After

```typescript
// types.ts
export interface DetailBandSpec {
  cols: string[];  // [] = no columns selected (never null)
  // ...
}

export interface AppState {
  baseCols: string[];   // [] = no base columns selected (never null)
  selCols: Set<string>; // empty Set = nothing selected (never null)
  colOrder: string[];   // [] = use default ordering (never null)
  // ...
}

export interface ReportSpec {
  pipeline: {
    baseCols: string[];  // [] = no base columns selected (never null)
    // ...
  };
  outputColumns: string[]; // [] = project nothing (never null)
  // ...
}

// result-set.ts
export interface ResultSetMetadata {
  displayCols: string[]; // [] = use columns as-is (never null)
  // ...
}
```

### State Creation Changes

#### Before

```typescript
// core/state.ts
export function createAppState(overrides?: Partial<AppState>): AppState {
  return Object.assign({
    // ...
    baseCols: null,
    selCols: null,
    colOrder: null,
    // ...
  }, overrides || {});
}

export function createReportSpec(overrides?: Partial<ReportSpec>): ReportSpec {
  return Object.assign({
    // ...
    pipeline: {
      baseCols: null,
      // ...
    },
    outputColumns: null,
    // ...
  }, overrides || {});
}

export function createDetailBandSpec(overrides?: Partial<DetailBandSpec>): DetailBandSpec {
  return Object.assign({
    // ...
    cols: [],  // Already correct — but inconsistent with null=ALL elsewhere
    // ...
  }, overrides || {});
}
```

#### After

State creation functions cannot populate defaults at creation time because the pool (table columns) is not yet known. Instead, defaults are populated **lazily** when the pool becomes available:

```typescript
// core/state.ts
export function createAppState(overrides?: Partial<AppState>): AppState {
  return Object.assign({
    // ...
    baseCols: [],   // Empty until base table is set
    selCols: new Set(), // Empty until projected columns are known
    colOrder: [],   // Empty until projected columns are known
    // ...
  }, overrides || {});
}

export function createReportSpec(overrides?: Partial<ReportSpec>): ReportSpec {
  return Object.assign({
    // ...
    pipeline: {
      baseCols: [],  // Empty until base table is set
      // ...
    },
    outputColumns: [], // Empty until projected columns are known
    // ...
  }, overrides || {});
}

export function createDetailBandSpec(overrides?: Partial<DetailBandSpec>): DetailBandSpec {
  return Object.assign({
    // ...
    cols: [],  // Empty until child table is set
    // ...
  }, overrides || {});
}
```

**Population trigger**: When a base table or child table is assigned, the corresponding selection fields are populated with the full column list. This happens in the UI layer (table selection handlers) and in state hydration.

### State Overlay Strategy

The key insight: **start with all-defaults (full lists), then overlay saved state on top**.

#### Hydration Algorithm

```
hydrateState(payload, loadedTables):
  1. Create fresh AppState with empty arrays/Sets
  2. Set base table → populate baseCols with full base table column list
  3. Process lookups/calcs → compute projected columns
  4. Overlay saved selections:
     - If payload.baseCols is array → use it (replaces full list)
     - If payload.baseCols is null/missing → keep full list (already set)
     - Same for selCols, colOrder, outputColumns, band.cols
  5. Result: saved state overlays on top of all-defaults
```

#### Before (current)

```typescript
// state-hydrator.ts:56-62
if (Array.isArray(payload.baseCols)) {
  next.baseCols = [...payload.baseCols];
} else {
  next.baseCols = null;  // ← loses to null, consumer must interpret null=ALL
}
```

#### After

```typescript
// state-hydrator.ts (proposed)
// Pre-populate with full list when base table is set
if (baseLoaded) {
  next.baseCols = [...loadedTables[savedBase].cols];
}

// Overlay saved selection if present
if (Array.isArray(payload.baseCols)) {
  const dropped = baseLoaded
    ? payload.baseCols.filter((c: string) => !loadedTables[savedBase].cols.includes(c))
    : [];
  if (dropped.length) brokenRefs.push(`Base columns not available: ${dropped.join(', ')}`);
  next.baseCols = [...payload.baseCols];  // ← overlays on top of full list
}
// If payload.baseCols is null/missing → keep full list (already populated above)
```

### Consumer Changes

All consumers that currently check for null/empty and interpret it as "all" must change to lenient-zero checks:

#### Before

```typescript
// column-catalog.ts:241
const bandCols = (band.cols != null && band.cols.length > 0) ? band.cols : rtCols;

// query-plan.ts:164
baseCols: reportSpec.pipeline.baseCols ?? (tablesById.has(...) ? ...cols : null)

// query-plan.ts:209-211
const orderedAliases = colOrder && colOrder.length > 0
  ? colOrder.filter(a => colMap.has(a) || aggAliases.includes(a))
  : [...colMap.keys(), ...aggAliases];

// sql-detail.ts:72-74
const projected: string[] = (outputCols && outputCols.length > 0)
  ? outputCols.filter(alias => colMap.has(alias))
  : [...colMap.keys()];

// validation.ts:625
const inSelCols = state.selCols instanceof Set ? state.selCols.has(col) : true;

// report-output.ts:53
const cols = (resultSet.metadata && resultSet.metadata.displayCols) || resultSet.columns;
```

#### After

```typescript
// column-catalog.ts:241
const bandCols = band.cols.length > 0 ? band.cols : rtCols;
// ← null check removed; empty array = no selection, fallback to all

// query-plan.ts:164
baseCols: reportSpec.pipeline.baseCols.length > 0
  ? reportSpec.pipeline.baseCols
  : (tablesById.has(...) ? tablesById.get(...)!.cols : [])

// query-plan.ts:209-211
const orderedAliases = colOrder.length > 0
  ? colOrder.filter(a => colMap.has(a) || aggAliases.includes(a))
  : [...colMap.keys(), ...aggAliases];

// sql-detail.ts:72-74
const projected: string[] = outputCols.length > 0
  ? outputCols.filter(alias => colMap.has(alias))
  : [...colMap.keys()];

// validation.ts:625
const inSelCols = state.selCols.size > 0 ? state.selCols.has(col) : true;
// ← empty Set = nothing selected, treat as implicitly selected (backward compat)

// report-output.ts:53
const cols = (resultSet.metadata && resultSet.metadata.displayCols.length > 0)
  ? resultSet.metadata.displayCols
  : resultSet.columns;
```

### UI Changes

#### detail-band-stage.tsx

**Before**:
```typescript
// Line 120: on rightId change → reset to null
bandDraft.cols = null;

// Lines 172-173: toggleCol → materialize null to all
let cols = bandDraft.cols == null ? [...rtCols] : [...bandDraft.cols];

// Line 187: selectAllCols → set to null
bandDraft.cols = null;

// Line 194: selectNoneCols → set to []
bandDraft.cols = [];

// Line 297: chip selected state → null means all selected
const isSelected = band.cols == null || band.cols!.includes(c);
```

**After**:
```typescript
// Line 120: on rightId change → populate with full child table column list
bandDraft.cols = rt ? [...rt.cols] : [];

// Lines 172-173: toggleCol → no materialization needed, cols is always populated
let cols = [...bandDraft.cols];

// Line 187: selectAllCols → set to full list
bandDraft.cols = [...rtCols];

// Line 194: selectNoneCols → set to empty array
bandDraft.cols = [];

// Line 297: chip selected state → check array directly
const isSelected = band.cols.includes(c);
```

#### column-chips.tsx

**Before**:
```typescript
// Lines 102-114: selCols init → materialize null to all projected
if (!st.selCols) {
  const currentCols = projectedCols(reportSpec, sourceCatalog);
  getStore().update(draft => {
    draft.selCols = new Set(currentCols);
  });
}

// Lines 122-123: colOrder init → materialize null to all
if (!st.colOrder) {
  getStore().update(draft => { draft.colOrder = [...currentCols]; });
}

// Line 153: null fallback
const colOrder = state.colOrder || cols;

// Lines 192-199: dblClick handler → materialize null
if (!draft.selCols) {
  draft.selCols = new Set(projectedCols(rs, sc));
}

// Lines 235-238: drop handler → materialize null
if (!draft.colOrder) {
  draft.colOrder = projectedCols(rs, sc);
}
```

**After**:
```typescript
// Lines 102-114: selCols init → no materialization needed
// selCols is always populated (empty Set or full Set)
// Remove the null check entirely

// Lines 122-123: colOrder init → no materialization needed
// colOrder is always populated (empty array or full list)
// Remove the null check entirely

// Line 153: direct use
const colOrder = state.colOrder;

// Lines 192-199: dblClick handler → direct toggle
// No materialization needed
const s = draft.selCols;
if (s.has(col)) s.delete(col);
else s.add(col);

// Lines 235-238: drop handler → direct reorder
// No materialization needed
const from = draft.colOrder.indexOf(dragCol);
const to = draft.colOrder.indexOf((nearest as HTMLElement).dataset.col!);
```

### Serialization Changes

#### Before

```typescript
// state-serializer.ts:34
baseCols: state.baseCols ? [...state.baseCols] : null,

// state-serializer.ts:53-54
selCols: state.selCols ? [...state.selCols] : null,
colOrder: state.colOrder ? [...state.colOrder] : null,

// state-serializer.ts:83
cols: [...(b.cols || [])],  // Note: serializes as array, different from others!
```

#### After

```typescript
// state-serializer.ts:34
baseCols: [...state.baseCols],  // Always an array, never null

// state-serializer.ts:53-54
selCols: [...state.selCols],    // Always an array, never null
colOrder: [...state.colOrder],  // Always an array, never null

// state-serializer.ts:83
cols: [...b.cols],              // Always an array, never null
```

**Backward compatibility**: Old `.rcjson` files with `null` values will hydrate correctly because the hydration algorithm overlays saved state on top of all-defaults. If `payload.baseCols` is `null`, the full list (already populated) is kept.

---

## Migration Strategy

### Backward Compatibility for Old .rcjson Files

Existing `.rcjson` files (STATE_VERSION 2) use `null` values extensively. The migration is **transparent** — no version bump required.

#### Hydration Overlay Algorithm

```typescript
function hydrateState(payload, loadedTables, sourceCatalog):
  // 1. Create fresh state with empty arrays
  next = createAppState()
  
  // 2. Set base table
  next.base = payload.base || ''
  const baseLoaded = !!(payload.base && loadedTables[payload.base])
  
  // 3. Populate baseCols with full list if base table is loaded
  if (baseLoaded) {
    next.baseCols = [...loadedTables[payload.base].cols]
  }
  
  // 4. Overlay saved baseCols if present
  if (Array.isArray(payload.baseCols)) {
    // Validate columns exist
    const dropped = baseLoaded
      ? payload.baseCols.filter(c => !loadedTables[payload.base].cols.includes(c))
      : []
    if (dropped.length) brokenRefs.push(`Base columns not available: ${dropped.join(', ')}`)
    next.baseCols = [...payload.baseCols]  // ← overlays on top of full list
  }
  // If payload.baseCols is null/missing → keep full list (already set above)
  
  // 5. Process lookups, calcs → compute projected columns
  // ... (existing logic)
  
  // 6. Populate selCols with full projected list
  const available = nextAvailableCols()
  next.selCols = new Set(available)
  
  // 7. Overlay saved selCols if present
  if (payload.selCols === null) {
    // Keep full list (already set above)
  } else if (Array.isArray(payload.selCols)) {
    const dropped = baseLoaded
      ? payload.selCols.filter(c => !available.has(c))
      : []
    if (dropped.length) brokenRefs.push(`Selected columns not available: ${dropped.join(', ')}`)
    next.selCols = new Set(payload.selCols)  // ← overlays on top of full list
  }
  
  // 8. Populate colOrder with full projected list
  next.colOrder = [...available]
  
  // 9. Overlay saved colOrder if present
  if (Array.isArray(payload.colOrder)) {
    next.colOrder = [...payload.colOrder]  // ← overlays on top of full list
  }
  
  // 10. Same pattern for outputColumns, band.cols, displayCols
  // ...
```

#### Edge Cases

| Scenario | Behavior |
|----------|----------|
| **New report** (no saved state) | All fields default to empty arrays/Sets. When base table is set, fields are populated with full list. |
| **Loaded report with null values** (old .rcjson) | Hydration populates full list, then overlays null (no-op). Result: full list. |
| **Loaded report with explicit selections** | Hydration populates full list, then overlays saved selection. Result: saved selection. |
| **Loaded report with empty arrays** | Hydration populates full list, then overlays empty array. Result: empty (no columns selected). |
| **aggModeState sub-selections** | Same overlay pattern: populate full list, then overlay saved selection if present. |
| **Empty tables** (no columns) | Fields remain empty arrays/Sets. No error. |
| **Broken table references** | Fields remain empty arrays/Sets. Broken refs are reported. |

### State Version

**No version bump required.** The serialized format is backward compatible:
- Old files with `null` → hydrate to full list (preserving intended behavior)
- New files with arrays → hydrate to saved selection (preserving intended behavior)
- The semantic meaning of `null` changes from "all" to "nothing," but old files with `null` are interpreted as "use defaults" (which is the full list).

---

## Implementation Plan Outline

### Phase 1: Type System and State Creation

1. **Update type definitions** (`types.ts`):
   - Change all 7 fields from `T | null` to `T` (non-nullable)
   - Update JSDoc comments to reflect new convention

2. **Update state creation functions** (`core/state.ts`):
   - `createAppState`: `baseCols: []`, `selCols: new Set()`, `colOrder: []`
   - `createReportSpec`: `pipeline.baseCols: []`, `outputColumns: []`
   - `createDetailBandSpec`: `cols: []` (already correct)

3. **Update result-set builder** (`report/result-set.ts`):
   - `buildResultSet`: `displayCols: []` (instead of `null`)

4. **Fix TypeScript errors** across the codebase (expect 50-100 errors from null checks; at least 50 of these will come from test file fixtures using `null` in `baseCols`, `outputColumns`, `displayCols`, and `cols` — see Test Strategy § Test Fixture Updates)

### Phase 2: State Hydration

5. **Refactor hydration algorithm** (`core/state-hydrator.ts`):
   - Implement overlay strategy: populate full list → overlay saved state
   - Handle all 7 fields + aggModeState sub-selections
   - Ensure backward compatibility with old `.rcjson` files

6. **Test hydration migration**:
   - Old file with `null` values → hydrates to full list
   - Old file with explicit selections → hydrates to saved selection
   - New file with arrays → hydrates correctly

### Phase 3: State Serialization

7. **Update serialization** (`core/state-serializer.ts`):
   - Remove null checks: `[...state.baseCols]` instead of `state.baseCols ? [...state.baseCols] : null`
   - All fields serialize as arrays, never null

8. **Test serialization round-trip**:
   - Serialize → deserialize → verify state is identical
   - Old file → load → save → load → verify state is identical

### Phase 4: Consumer Sites

9. **Update catalog consumer** (`catalog/column-catalog.ts:241`):
   - Remove null check: `band.cols.length > 0 ? band.cols : rtCols`

10. **Update query plan consumers** (`query/query-plan.ts`):
     - Line 37: `SourcePlan.baseCols` type from `string[] | null` → `string[]`
     - Line 164: `baseCols` null coalesce → length check
     - Lines 209-211: `colOrder` null check → length check

11. **Update SQL detail consumer** (`query/sql-detail.ts:72-74`):
     - `outputCols` null check → length check

12. **Update validation consumer** (`report/validation.ts:625`):
     - `selCols instanceof Set` → `selCols.size > 0`

13. **Update report output consumer** (`report/report-output.ts:53`):
     - `displayCols` null fallback → length check

14. **Update preview builder** (`report/preview-builder.ts`):
     - Line 269: `baseCols: state.baseCols ?? null` → `baseCols: state.baseCols` (dead null coalesce; `state.baseCols` is already `string[]`)
     - Line 275: `outputColumns: null` → `outputColumns: []`

15. **Update report engine pass-through** (`report/engine.ts`):
     - Lines 61, 417: `baseCols: reportSpec.pipeline.baseCols` — trivial pass-through into `catalogCtx`, no logic change needed but must compile under new type

### Phase 5: UI Layer

16. **Update detail-band-stage.tsx**:
    - `handleRightIdChange`: populate with full child table column list (not null)
    - `toggleCol`: remove null materialization
    - `selectAllCols`: set to full list (not null)
    - `selectNoneCols`: set to empty array (already correct)
    - Chip selected state: remove null check

17. **Update column-chips.tsx**:
    - Remove selCols materialization (lines 102-114)
    - Remove colOrder materialization (lines 122-123)
    - Remove null fallback (line 153)
    - Remove dblClick materialization (lines 192-199)
    - Remove drop handler materialization (lines 235-238)

18. **Test UI interactions**:
    - New band → columns default to all selected
    - Toggle column → correctly adds/removes from selection
    - Select all → all columns selected
    - Select none → no columns selected
    - Drag reorder → works without materialization
    - Double-click → toggles selection without materialization

### Phase 6: aggModeState Sub-selections

19. **Update aggModeState hydration** (`core/state-hydrator.ts:272/281/285`):
     - Same overlay pattern: populate full list → overlay saved selection

20. **Update `ui/aggregation.ts`** (HIGH — actively assigns `null` to `draft.selCols`):
     - `_selColsToArray()` (line 21): return type `string[] | null` → `string[]`; fallback `return null` → `return []`
     - Lines 31, 38, 44, 54: callers of `_selColsToArray(state.selCols)` — no longer need to handle `null` return
     - `loadAggModeState()` lines 124, 132, 139, 151: `draft.selCols = Array.isArray(savedState.selCols) ? new Set(...) : null` → change `null` fallback to `new Set()` (empty Set). After the type change, assigning `null` to `draft.selCols` will be a TypeError.

21. **Update remaining aggModeState consumers**:
     - Find all consumers of `aggModeState.none.selCols`, `aggModeState.totals.selCols`, `aggModeState.subtotals.selCols`
     - Remove null checks, use length/size checks

### Phase 7: Test Fixture Updates and Validation

22. **Update test file fixtures** (at least 50 of the expected TypeScript errors come from these):
     - Replace `baseCols: null` → `baseCols: []` in: `tests/query/query-plan.test.ts`, `tests/query/query-plan-bands.test.ts`, `tests/query/sql-detail.test.ts`, `tests/query/sql-grouped.test.ts`, `tests/query/sql-totals.test.ts`, `tests/query/sql-subtotals.test.ts`, `tests/query/calc-columns-execution.test.ts` (8 locations), `tests/query/helpers.ts`, `tests/report/engine.test.ts`, `tests/report/engine-calc.test.ts`, `tests/report/report-graph.test.ts` (~17 locations), `tests/integration/state-loading.test.ts`, `tests/ui/row-explosion-dialog.test.ts`
     - Replace `outputColumns: null` → `outputColumns: []` in: `tests/query/helpers.ts`, `tests/integration/full-pipeline.test.ts`
     - Replace `displayCols: null` → `displayCols: []` in: `tests/report/report-output.test.ts`, `tests/report/result-set.test.ts`
     - Replace `cols: null` → `cols: []` (band.cols) in: `tests/core/state.test.ts`
     - **Note**: These are mechanical replacements — no test logic changes, just fixture type alignment

23. **Run full test suite**:
     - `npm run typecheck` — zero errors
     - `npm run lint` — zero warnings
     - `npm test` — all tests pass

24. **Manual testing**:
     - Create new report → verify defaults
     - Load old `.rcjson` file → verify backward compatibility
     - Save → reload → verify state is identical
     - Test all UI interactions (toggle, select all, select none, drag, double-click)
     - Test aggregation mode switching (none → group → totals → subtotals) → verify selCols preserved correctly

---

## Test Strategy

### Unit Tests

#### Hydration Migration Tests

1. **Old file with null values**:
   - Create `.rcjson` with `baseCols: null`, `selCols: null`, `colOrder: null`
   - Hydrate → verify all fields are populated with full lists
   - Verify behavior matches old "null = ALL" semantic

2. **Old file with explicit selections**:
   - Create `.rcjson` with `baseCols: ['A', 'B']`, `selCols: ['A']`, `colOrder: ['B', 'A']`
   - Hydrate → verify fields match saved selections
   - Verify behavior matches old semantic

3. **Old file with empty arrays**:
   - Create `.rcjson` with `baseCols: []`, `selCols: []`, `colOrder: []`
   - Hydrate → verify fields are empty (no columns selected)
   - Verify this is a new capability (was unrepresentable before)

4. **Broken table references**:
   - Create `.rcjson` with `base: 'missing_table'`, `baseCols: ['A', 'B']`
   - Hydrate → verify `baseCols` is empty, broken ref is reported

5. **aggModeState sub-selections**:
   - Create `.rcjson` with `aggModeState.none.selCols: null`
   - Hydrate → verify `selCols` is populated with full list
   - Create `.rcjson` with `aggModeState.none.selCols: ['A']`
   - Hydrate → verify `selCols` is `['A']`

#### Serialization Round-Trip Tests

1. **Serialize → deserialize**:
   - Create state with explicit selections
   - Serialize → deserialize → verify state is identical

2. **Old file → load → save → load**:
   - Load old `.rcjson` with null values
   - Save → verify serialized file has arrays (not null)
   - Reload → verify state is identical

3. **Empty selections**:
   - Create state with `baseCols: []`, `selCols: new Set()`
   - Serialize → deserialize → verify fields are empty

#### UI Interaction Tests

1. **New band creation**:
   - Add new detail band → verify `cols` is populated with full child table column list

2. **Toggle column**:
   - Toggle column off → verify it's removed from `cols`
   - Toggle column on → verify it's added back to `cols`

3. **Select all / select none**:
   - Click "Select All" → verify `cols` is full list
   - Click "Select None" → verify `cols` is empty array

4. **Drag reorder**:
   - Drag column to new position → verify `colOrder` is updated
   - Verify no materialization occurs (colOrder was already populated)

5. **Double-click toggle**:
    - Double-click column → verify it's toggled in `selCols`
    - Verify no materialization occurs (selCols was already populated)

#### Test Fixture Updates

At least 50 of the expected TypeScript errors from the type changes will come from test file fixtures that use `null` for `baseCols`, `outputColumns`, `displayCols`, and `cols`. These are mechanical replacements — no test logic changes, just fixture type alignment.

| Test file | Fields to update | Approximate locations |
|-----------|-----------------|----------------------|
| `tests/core/state.test.ts` | `band.cols: null` → `[]` | 1+ |
| `tests/query/query-plan.test.ts` | `baseCols: null` | 3+ |
| `tests/query/query-plan-bands.test.ts` | `baseCols: null` | 6+ |
| `tests/query/sql-detail.test.ts` | `baseCols: null` | 2+ |
| `tests/query/sql-grouped.test.ts` | `baseCols: null` | 2+ |
| `tests/query/sql-totals.test.ts` | `baseCols: null` | 2+ |
| `tests/query/sql-subtotals.test.ts` | `baseCols: null` | 2+ |
| `tests/query/calc-columns-execution.test.ts` | `baseCols: null` | 8 |
| `tests/query/helpers.ts` | `baseCols: null`, `outputColumns: null` | 2+ |
| `tests/report/engine.test.ts` | `baseCols: null` | 2+ |
| `tests/report/engine-calc.test.ts` | `baseCols: null` | 2+ |
| `tests/report/report-graph.test.ts` | `baseCols: null` | ~17 |
| `tests/report/report-output.test.ts` | `displayCols: null` | 1+ |
| `tests/report/result-set.test.ts` | `displayCols: null` | 1+ |
| `tests/integration/state-loading.test.ts` | `baseCols: null` | 1+ |
| `tests/integration/full-pipeline.test.ts` | `outputColumns: null` | 1+ |
| `tests/ui/row-explosion-dialog.test.ts` | `baseCols: null` | 1+ |

**Total**: 17 test files, ~50+ fixture locations.

### Integration Tests

1. **Full workflow**:
   - Create new report → load data → configure selections → save → reload → verify state

2. **Backward compatibility**:
   - Load 5 different old `.rcjson` files (with various null patterns)
   - Verify all load correctly and behave as expected

3. **Edge cases**:
   - Empty table (no columns) → verify no errors
   - Table with 1 column → verify selection works
   - Table with 100 columns → verify performance is acceptable

---

## Constraints

### Performance

- **No performance regression**: The refactoring should not introduce additional computation. The overlay strategy (populate full list → overlay saved state) is O(n) where n is the number of columns — same as current materialization.
- **Memory**: Non-nullable types may use slightly more memory (empty arrays instead of null), but the difference is negligible.

### Compatibility

- **Backward compatible**: Old `.rcjson` files must load correctly. The overlay strategy ensures this.
- **No state version bump**: The serialized format is compatible. Old files with `null` are interpreted as "use defaults" (full list).

### Testing

- **Zero test failures**: All existing tests must pass after the refactoring.
- **New tests required**: Hydration migration, serialization round-trip, UI interactions.

### Developer Experience

- **Type safety**: Non-nullable types eliminate null checks at 15+ consumer sites.
- **Clarity**: The new convention (empty = nothing, full list = all) is intuitive and matches `LookupSpec.cols`.

---

## Open Questions

1. **Should we bump STATE_VERSION to 3?**
   - **Decision**: No. The refactoring is backward compatible. Old files with `null` hydrate correctly.
   - **Rationale**: Version bumps force users to re-save files. Since the semantic is compatible, no bump is needed.

2. **Should we add a migration script to update old `.rcjson` files?**
   - **Decision**: No. The hydration overlay strategy handles old files transparently.
   - **Rationale**: Users don't need to manually migrate. Old files work as-is.

3. **Should we add runtime assertions to catch null values?**
   - **Decision**: Yes, in development mode only.
   - **Rationale**: TypeScript ensures compile-time safety, but runtime assertions catch bugs from dynamic data (e.g., hand-edited `.rcjson` files).

4. **Should we update the JSDoc comments to document the new convention?**
   - **Decision**: Yes.
   - **Rationale**: The convention should be documented in the type definitions to prevent future confusion.

5. **Should we add a lint rule to prevent nullable selection fields?**
   - **Decision**: No. TypeScript's type system is sufficient.
   - **Rationale**: A lint rule would be redundant with TypeScript's null checks.

---

## Appendix: Research Findings

### Key Patterns Discovered

1. **LookupSpec.cols is the correct pattern**: `LookupSpec.cols` uses `string[]` (non-nullable) where empty = no projection. This is the pattern we're aligning to.

2. **Materialization cascade is a hidden state transition**: The UI layer silently converts null to full list on first interaction. This makes debugging difficult and violates the principle of least surprise.

3. **State hydration already normalizes band.cols**: At `state-hydrator.ts:347`, null and empty array are already treated identically (both become null). This confirms that the distinction between null and [] is already blurred.

4. **buildReportSpecFromState has zero direct unit tests**: Despite 11 UI call sites, this function has no dedicated tests. This is a risk area for the refactoring.

5. **aggModeState sub-selections follow the same pattern**: `aggModeState.none.selCols`, `aggModeState.totals.selCols`, `aggModeState.subtotals.selCols` all use null = ALL. These must be refactored too.

6. **`ui/aggregation.ts` actively assigns `null` to `draft.selCols`** (discovered during scope validation): `loadAggModeState()` at lines 124, 132, 139, 151 uses the pattern `draft.selCols = Array.isArray(savedState.selCols) ? new Set(...) : null`. After the type change, this will be a TypeError. Additionally, `_selColsToArray()` (line 21) returns `string[] | null` — the `null` return path must become `[]`. This file is the highest-priority aggModeState consumer to update.

### Reusable Components

1. **Overlay algorithm**: The "populate full list → overlay saved state" pattern is reusable across all 7 fields. Implement as a helper function.

2. **Length/size checks**: Replace null checks with `array.length > 0` or `set.size > 0`. This is a mechanical transformation.

3. **JSDoc template**: Document the new convention in type definitions:
   ```typescript
   /**
    * Selected columns from the pool. Empty array = no columns selected.
    * @default [] (populated with full list when pool becomes available)
    */
   cols: string[];
   ```

### Files Affected (Complete List)

| File | Lines | Change type |
|------|-------|-------------|
| `preact/types.ts` | 57, 169, 173, 174, 220, 226 | Type definition |
| `preact/report/result-set.ts` | 29 | Type definition |
| `preact/core/state.ts` | 16, 20, 21, 78, 84, 141 | State creation |
| `preact/core/state-hydrator.ts` | 56-62, 185-194, 272, 281, 285, 347, 364 | Hydration |
| `preact/core/state-serializer.ts` | 34, 53, 54, 83 | Serialization |
| `preact/catalog/column-catalog.ts` | 241 | Consumer |
| `preact/query/query-plan.ts` | 37, 164, 209-211 | Type definition (SourcePlan.baseCols) + Consumer |
| `preact/query/sql-detail.ts` | 72-74 | Consumer |
| `preact/report/validation.ts` | 625 | Consumer |
| `preact/report/report-output.ts` | 53 | Consumer |
| `preact/report/preview-builder.ts` | 269, 275 | Consumer (dead null coalesce + null literal) |
| `preact/report/engine.ts` | 61, 417 | Consumer (pass-through to catalogCtx) |
| `preact/ui/sections/detail-band-stage.tsx` | 120, 172-173, 187, 194, 297 | UI |
| `preact/ui/sections/column-chips.tsx` | 102-114, 122-123, 153, 192-199, 235-238 | UI |
| `preact/ui/aggregation.ts` | 21, 31, 38, 44, 54, 124, 132, 139, 151 | aggModeState consumer (HIGH — actively assigns null) |

**Total**: 16 files, ~55 change sites.

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| **Non-nullable types** | Eliminates null checks at 15+ consumer sites. Matches `LookupSpec.cols` pattern. |
| **Overlay strategy for hydration** | Backward compatible with old `.rcjson` files. No version bump required. |
| **No state version bump** | Old files with `null` hydrate correctly (interpreted as "use defaults"). |
| **Empty array = nothing** | Intuitive semantic. Matches constraint-accumulation fields. |
| **Full list = all** | Intuitive semantic. Matches user expectation. |
| **Lazy population** | State creation functions can't populate defaults (pool not yet known). UI handlers populate when pool becomes available. |

---

## Conclusion

This refactoring eliminates a long-standing source of confusion and bugs in TableFlip. The new convention is intuitive, type-safe, and backward compatible. The implementation is mechanical (type changes + null check removal) with one key algorithmic change (hydration overlay). The risk is low because the semantic is compatible — old files behave identically, new files are clearer.

The refactoring is a net positive for developer experience, type safety, and code clarity. It should be done.
