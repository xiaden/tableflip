# Detail Bands Rendering Overlay System

**Status:** Draft  
**Author:** RnD-DDAuthor  
**Created:** 2026-06-15  

**Related Documents:**
- [Subreport Detail Rows — Design Document](artifacts/designs/completed/DD-subreport-detail-rows.md) — Original detail bands design — defines the data retrieval and interleaving architecture this document replaces at the rendering boundary.
- [Detail Bands Export Layout v2](artifacts/designs/completed/DD-band-export-v2.md) — Parent-column-aligned export layout — the `applyBandGroup()` / `buildBandColumnLayout()` pipeline this design supersedes.
- [Bands Feature Orientation Skill](.opencode/skills/bands-feature-orientation/SKILL.md) — Mental model, invariants, failure modes for the entire bands feature.
- [ResultSet interface](SRC/preact/report/result-set.ts) — Homogeneous columns/rows/metadata structure that the overlay model extends.
- [Report execution engine](SRC/preact/report/engine.ts) — `runDetailBandsMode()` at lines 404–524 — the data retrieval path that remains unchanged in its query execution but changes its output contract.
- [Export logic](SRC/preact/ui/export.ts) — `computeBandColSets()`, `applyBandGroup()`, `buildBandColumnLayout()` at lines 89–345 — replaced by overlay descriptor consumption.
- [AG Grid integration](SRC/preact/ui/grid.tsx) — `createBandRowStyler()` at lines 39–85, `ResultGrid` at lines 134–199 — extended with full-width row rendering for band section headers.

---

## Scope

### In Scope
- Engine output contract change: `runDetailBandsMode()` returns flat parent rows + separate band result sets (no interleaving)
- New `overlay-grouping.ts` module in the Report layer: group boundary detection, overlay descriptor construction
- New `OverlayDescriptor` type in Core types
- Grid rendering: full-width band section headers via AG Grid `isFullWidthRow` + `fullWidthCellRenderer`
- Export rendering: descriptor-driven section header and band data row construction (replaces `applyBandGroup()` / `buildBandColumnLayout()`)
- Validation updates: match column existence checks replace selCols membership checks
- ResultSet metadata extension: `bandResults` field for separate band data

### Out of Scope
- Band query generation (`sql-detail-bands.ts`) — unchanged
- Column catalog band prefixing (`column-catalog.ts`) — unchanged
- Band configuration UI (`ui/sections/detail-band-stage.tsx`) — unchanged
- State serialization/hydration — `detailBands` spec unchanged; `result` field is runtime-only
- Nested bands UI configuration — the overlay model supports nesting structurally, but the UI for configuring nested bands is deferred
- Stack mode — removed in Phase 1 (see "Stack Mode Removal" section below); not reintroduced
- AG Grid Enterprise features (master/detail, tree data) — not available in Community edition

---

## Problem Statement

Detail bands are currently implemented as **data interleaving**. `runDetailBandsMode()` in engine.ts runs parent + per-band queries, then `interleaveRows()` physically merges band rows into the result set as data rows with null-padding for parent/other-band columns. This produces a "wide" homogeneous ResultSet with `_band_id` as a row discriminator.

The export layer then calls `buildBandColumnLayout()` / `applyBandGroup()` to transform these interleaved wide rows into a compact match+band column layout. This is a band-aid over a fundamentally wrong architecture.

**Bands are treated as data when they are actually rendering artifacts.** This causes:

1. `applyBandGroup()` interleaves band rows into the data, making the data impure
2. Parent column aliases don't match label keys (the alias ≠ label bug)
3. Match columns must be visible in `selCols` to work
4. Band data repeats per row instead of per group
5. Architecture can't support hidden match columns or nested bands
6. Grid and export both operate on the same interleaved data but need different overlay representations

**Who has this problem:** Any future feature that touches band rendering — nested bands, collapsible sections, hidden match columns, per-band column visibility — must fight the interleaved data model. The export path already spends 200+ lines undoing the interleaving. The grid path can't show section headers at all.

---

## Options Considered

Three approaches were evaluated by RnD-Ideator and RnD-Architect subagents. A tradeoff matrix follows.

### Option A: Overlay-Aware Interleaving (Keep Interleaving, Add Markers)

The engine continues to interleave rows but adds `_group_boundary` markers and `_overlay_columns` metadata. Export uses markers instead of walking rows. Grid uses markers for section headers.

**Pros:** Minimal engine change. Low migration risk.  
**Cons:** Keeps wide rows with null-padded band columns. Band columns still pollute the homogeneous row space. Doesn't solve the fundamental data/rendering conflation — just makes it more explicit. Low flexibility for future features.

### Option B: Clean Separation (Engine Returns Flat Data, Each Consumer Groups Independently)

Engine stops interleaving entirely. Returns flat parent rows + separate band result sets. Each consumer (grid, export) independently detects group boundaries and renders overlays.

**Pros:** Cleanest data model. No null-padding overhead.  
**Cons:** Duplicates grouping logic across consumers. Risks inconsistency between grid and export. Highest regression risk — all band tests rewritten. 12 files touched, ~800 LOC.

### Option C: Hybrid — Structured Overlay Descriptors (SELECTED)

Engine returns flat parent rows + separate band result sets. A shared grouping module (`overlay-grouping.ts`) in the Report layer produces `OverlayDescriptor[]` — a declarative plan describing where overlays go and what they contain. Each consumer uses these descriptors to render in its own format.

**Pros:** Single source of truth for band structure. Shared grouping logic ensures consistency. Natural path to nested bands via recursive descriptors. 19 files touched, ~500 LOC.  
**Cons:** New module and type. Engine output contract changes. Medium regression risk.

### Tradeoff Matrix

| Dimension | Option A | Option B | Option C (Selected) |
|-----------|----------|----------|---------------------|
| Architecture fit | Good | Good | Best |
| Migration complexity | Low | High | Medium |
| Files touched | 6 | 12 | 19 |
| Estimated LOC | 150 | 800 | 500 |
| Regression risk | Low | High | Medium |
| Test complexity | Low | High | Medium |
| Flexibility | Low | Medium | High |
| Nested bands support | Awkward | Natural | Natural |
| Grid/export consistency | Manual | Risk | By construction |
| Null-padding eliminated | No | Yes | Yes |

**Selection rationale:** Option C provides the best balance of clean architecture, implementation feasibility, and future flexibility. The shared grouping module eliminates the consistency risk of Option B while achieving the same data model purity. The overlay descriptor is a declarative intermediate representation that both consumers can trust, making grid and export output consistent by construction rather than by convention.

---

## Architecture

### Three-Layer Separation

#### Data Layer (Engine — Modified Output Contract)

The engine's query execution is **unchanged**: parent query runs, per-band batched WHERE IN queries run, band rows are tagged with `_band_id`. What changes is the **output contract**: instead of calling `interleaveRows()` to produce a flat interleaved array, the engine returns a structured result with:

- **Flat parent rows** — no band columns, no `_band_id`, no null-padding
- **Separate band result sets** — per-band rows with their own columns (band columns + child key columns for matching)
- **Band metadata** — key pairs, labels, column sets, sort specs

The engine no longer computes superset columns or null-pads rows. This eliminates the memory overhead of wide rows (4×+ savings on band-heavy reports where band columns outnumber parent columns).

#### Grouping Layer (New — Report Layer)

A new module `report/overlay-grouping.ts` consumes the engine's structured output and produces `OverlayDescriptor[]` — a flat, ordered array of descriptors that declaratively describe the rendered output:

```
OverlayDescriptor =
  | { type: 'parent', data: Record<string, unknown>, columns: string[] }
  | { type: 'band-section', bandId: string, bandLabel: string, bandColumns: string[], matchValue: unknown }
  | { type: 'band-row', bandId: string, data: Record<string, unknown>, columns: string[] }
```

The grouping layer:
1. Walks parent rows sequentially
2. For each parent row, emits a `parent` descriptor
3. Detects group boundaries by comparing match key values against the previous parent row
4. At each group boundary, emits a `band-section` descriptor for each enabled band
5. Looks up matching band rows from the separate band result sets (using the same Map-based index from `buildBandChildIndex()`)
6. Emits `band-row` descriptors for each matching child

**Key insight:** Group boundaries are determined by match key transitions in the parent data, not by `_band_id` transitions in interleaved data. This means the match column doesn't need to be visible in `selCols` — it just needs to exist in the parent data (which it always does, since it's a parent column used for the band query's WHERE IN).

#### Rendering Layer (Grid + Export — Modified)

Each consumer iterates the `OverlayDescriptor[]` and renders in its own format:

**Grid:** 
- `parent` descriptors → regular AG Grid data rows
- `band-section` descriptors → full-width rows via `isFullWidthRow` + `fullWidthCellRenderer`
- `band-row` descriptors → regular data rows with band tinting via `getRowStyle`

**Export:**
- `parent` descriptors → parent rows with all columns populated
- `band-section` descriptors → section header rows (match value + band column display names)
- `band-row` descriptors → band data rows (empty col 0 + band values in parent column positions)

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ENGINE (Report Layer)                        │
│                                                                     │
│  runDetailBandsMode()                                               │
│    ├─ Execute parent SQL → parentRows[]                             │
│    ├─ For each band:                                                │
│    │    ├─ Extract parent key values                                │
│    │    ├─ buildBandQuery() → SQL with WHERE IN                     │
│    │    ├─ execQuery() → bandRows[]                                 │
│    │    └─ Tag with _band_id                                        │
│    └─ Return BandResultSet:                                         │
│         { parentRows, parentCols,                                   │
│           bandResults: [{ band, rows, cols,                         │
│                           parentKeyAliases, childKeyCols }],         │
│           bandLabels }                                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   GROUPING LAYER (Report Layer)                     │
│                                                                     │
│  buildOverlayDescriptors(bandResultSet)                             │
│    ├─ Build BandChildIndex (O(1) child lookup)                      │
│    ├─ Walk parent rows:                                             │
│    │    ├─ Emit ParentDescriptor                                    │
│    │    ├─ Detect group boundary (match key changed?)               │
│    │    └─ At boundary:                                             │
│    │         ├─ Emit BandSectionDescriptor per band                 │
│    │         └─ Emit BandRowDescriptors for matching children       │
│    └─ Return OverlayDescriptor[]                                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                      ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│   GRID (UI Layer)        │  │   EXPORT (UI Layer)      │
│                          │  │                          │
│ Iterate descriptors:     │  │ Iterate descriptors:     │
│  parent → data row       │  │  parent → parent row     │
│  band-section →          │  │  band-section → section  │
│    full-width row        │  │    header row             │
│  band-row → tinted row   │  │  band-row → band data    │
│                          │  │    row                   │
│ AG Grid options:         │  │                          │
│  isFullWidthRow          │  │ buildBandColumnLayout()  │
│  fullWidthCellRenderer   │  │ replaced by descriptor   │
│  getRowStyle (tinting)   │  │ consumer                 │
└──────────────────────────┘  └──────────────────────────┘
```

### Layer Mapping

| Component | Layer | File | Responsibility |
|-----------|-------|------|----------------|
| `runDetailBandsMode()` | Report | `preact/report/engine.ts` | Execute parent + band queries, return `BandResultSet` (no interleaving) |
| `BandResultSet` type | Core | `preact/types.ts` | Structured engine output: parent rows + band results + metadata |
| `buildOverlayDescriptors()` | Report | `preact/report/overlay-grouping.ts` | Walk parent rows, detect group boundaries, produce `OverlayDescriptor[]` |
| `OverlayDescriptor` type | Core | `preact/types.ts` | Union type: `parent` \| `band-section` \| `band-row` |
| `GroupBoundaryDetector` | Report | `preact/report/overlay-grouping.ts` | Track match key transitions, emit boundary signals |
| `ResultGrid` (band path) | UI | `preact/ui/grid.tsx` | Consume descriptors: full-width section headers + tinted band rows |
| `BandHeaderRenderer` | UI | `preact/ui/grid.tsx` | AG Grid `fullWidthCellRenderer` for band section headers |
| `exportAs()` (band path) | UI | `preact/ui/export.ts` | Consume descriptors: section headers + band data rows in parent-column-aligned layout |
| `deriveValidation()` | Report | `preact/report/validation.ts` | Validate match column existence in parent data (not selCols membership) |
| `publishReportOutput()` | Report | `preact/report/report-output.ts` | Pass through `bandResult` to `PublishedOutput`; stop injecting `_band_id` into published columns |

### Dependency Direction (validated)

- `overlay-grouping.ts` imports from `types.ts` (Core) ✓
- `overlay-grouping.ts` imports `buildBandChildIndex` from `engine.ts` (Report → Report) ✓
- `grid.tsx` imports `OverlayDescriptor` from `types.ts` (UI → Core) ✓
- `grid.tsx` imports `buildOverlayDescriptors` from `overlay-grouping.ts` (UI → Report) ✓
- `export.ts` imports `OverlayDescriptor` from `types.ts` (UI → Core) ✓
- `export.ts` imports `buildOverlayDescriptors` from `overlay-grouping.ts` (UI → Report) ✓
- No upward imports. No query/catalog changes.

---

## Design Details

### Engine Changes

#### BandResultSet Type

```typescript
/** Structured output from runDetailBandsMode(). */
interface BandResultSet {
  /** Flat parent rows — no band columns, no _band_id, no null-padding. */
  parentRows: Record<string, unknown>[];
  /** Parent column names (from actual row data). */
  parentCols: string[];
  /** Per-band query results with metadata. */
  bandResults: BandResult[];
  /** Map from band ID to user-visible label. */
  bandLabels: Record<string, string>;
}
```

#### runDetailBandsMode() Changes

1. **Remove** the `interleaveRows()` call and `computeSupersetCols()` computation
2. **Return** `BandResultSet` instead of `ResultSet` with interleaved rows
3. **Keep** all query execution logic unchanged (parent SQL, per-band WHERE IN, key extraction)
4. **Keep** `buildBandChildIndex()` available for the grouping layer to reuse

The engine still builds the column catalog and processes band specs — this is data retrieval, not rendering. What it no longer does is stitch rows together.

#### ResultSet Extension

The `ResultSet` interface gains an optional `bandResult` field:

```typescript
interface ResultSet {
  columns: string[];           // Parent columns only (no band columns)
  rows: Record<string, unknown>[];  // Parent rows only (no interleaving)
  metadata: ResultSetMetadata;
  bandResult?: BandResultSet;  // Present when detail bands are active
}
```

When `bandResult` is present, `columns` and `rows` contain only parent data. The band data lives in `bandResult.bandResults[]`. Downstream consumers check `bandResult` to decide whether to use the overlay path.

**Backward compatibility:** When no bands are active, `bandResult` is `undefined` and the ResultSet is identical to today's output. Non-band reports are unaffected.

#### Stack Mode Removal

Stack mode is **fully present** in the current codebase and is removed as part of Phase 1. The following components are deleted:

| Component | File | Action |
|-----------|------|--------|
| `crossProductRows()` | `report/engine.ts` (line 333) | Deleted |
| `RowExplosionError` class | `report/engine.ts` (line 137) | Deleted |
| `STACK_ROW_LIMIT` constant | `report/engine.ts` (line 130) | Deleted |
| `if (mode === 'stack')` branch | `report/engine.ts` (lines 493–505) | Deleted — only the `else` (separate/interleave) path remains, which is then replaced by `BandResultSet` return |
| `stackRowLimit` parameter | `runDetailBandsMode()`, `runReport()` | Removed from signatures |
| `detailBandMode` field | `types.ts` (`DetailBandSpec`, `WorkspaceState`) | Removed |
| `detailBandMode` default values | `core/state.ts` (`createAppState()`, `createReportSpec()`) | Removed `detailBandMode: 'separate'` from both default state factories |
| `detailBandMode` in schema keys | `core/state-schema.ts` (`RECOGNIZABLE_KEYS`) | Removed `'detailBandMode'` from recognisable keys list |
| Mode toggle UI | `ui/cards/pipeline-card.tsx` (lines 169–186) | Removed — `setBandMode()` callback and radio buttons deleted |
| `RowExplosionDialog` | `ui/components/row-explosion-dialog.tsx` | Deleted |
| `RowExplosionError` handler | `ui/sections/run-bar.tsx` (line 133) | Removed — error type no longer thrown |
| `detailBandMode` hydration | `core/state-hydrator.ts` (line 389) | Removed |
| `detailBandMode` serialization | `core/state-serializer.ts` | Removed if present |
| `detailBandMode` in preview spec | `report/preview-builder.ts` | Removed `detailBandMode: 'separate'` from `ReportSpec` construction |
| Stale exports for removed items | `index.ts` | Remove exports: `RowExplosionError`, `STACK_ROW_LIMIT`, `RowExplosionDialog`, `RowExplosionDialogProps`. Keep `buildBandChildIndex` export (reused by grouping layer) |

**Test files deleted or updated:**
- `engine-perf.test.ts` — `crossProductRows()` performance tests deleted; `interleaveRows()` tests deleted (function removed when engine stops interleaving); new perf tests for `buildOverlayDescriptors()` at scale
- `row-explosion-dialog.test.ts` — entire file deleted (tests stack mode dialog)
- `engine-bands.test.ts` — stack mode test cases removed; `RowExplosionError` tests removed
- `tests/core/state-hydrator-bands.test.ts` — `detailBandMode` hydration test cases removed
- `tests/core/state-serializer-bands.test.ts` — `detailBandMode` serialization test cases removed
- `tests/core/store.test.ts` — `detailBandMode` default assertion removed
- `tests/core/state.test.ts` — `detailBandMode` default assertions removed
- `tests/query/helpers.ts` — `detailBandMode` field removed from test helper
- `tests/integration/full-pipeline.test.ts` — `detailBandMode` field removed from spec helper
- `tests/report/engine.test.ts` — updated if `runReport()` output contract changes affect assertions

**Rationale:** The overlay model produces group-based rendering (one band section per group boundary). Stack mode's Cartesian cross-product is an alternative rendering strategy that the overlay model does not support — it fundamentally conflicts with the "one band section per group" design. Rather than maintaining two rendering paradigms, stack mode is removed. If cross-product behavior is needed in the future, it can be computed from the `BandResultSet.bandResults[]` data by a consumer, not by the engine.

### Grouping Layer

#### overlay-grouping.ts (New Module)

This is the core of the overlay system. It lives in the Report layer (`preact/report/overlay-grouping.ts`) and exports one primary function:

```typescript
/**
 * Build overlay descriptors from a BandResultSet.
 * 
 * Walks parent rows sequentially, detects group boundaries by comparing
 * match key values, and produces a flat array of OverlayDescriptors that
 * declaratively describe the rendered output.
 * 
 * Pure function — no global state dependency.
 */
function buildOverlayDescriptors(
  bandResult: BandResultSet,
  detailBands: DetailBandSpec[],
): OverlayDescriptor[];
```

#### OverlayDescriptor Type

```typescript
/** Declarative description of a rendered output row. */
type OverlayDescriptor =
  | ParentDescriptor
  | BandSectionDescriptor
  | BandRowDescriptor;

interface ParentDescriptor {
  type: 'parent';
  /** Parent column values. */
  data: Record<string, unknown>;
  /** Parent column names. */
  columns: string[];
}

interface BandSectionDescriptor {
  type: 'band-section';
  /** Band identifier. */
  bandId: string;
  /** User-visible band label. */
  bandLabel: string;
  /** Band column names (display order). */
  bandColumns: string[];
  /** Match key value from the preceding parent row (for section header display). */
  matchValue: unknown;
  /** Nesting depth (0 for top-level bands). */
  depth: number;
}

interface BandRowDescriptor {
  type: 'band-row';
  /** Band identifier. */
  bandId: string;
  /** Band column values. */
  data: Record<string, unknown>;
  /** Band column names (display order). */
  columns: string[];
  /** Nesting depth (0 for top-level bands). */
  depth: number;
}
```

#### GroupBoundaryDetector

The boundary detector is an internal helper within `overlay-grouping.ts`. It tracks match key values as it walks parent rows and signals when a group boundary is crossed:

```typescript
class GroupBoundaryDetector {
  private prevMatchValue: unknown = undefined;
  private readonly keyAliases: string[];
  
  constructor(keyAliases: string[]) {
    this.keyAliases = keyAliases;
  }
  
  /**
   * Check if this parent row starts a new group.
   * A new group begins when the match key value differs from the previous row.
   * The first row always starts a new group.
   */
  isNewGroup(parentRow: Record<string, unknown>): boolean {
    const currentValue = makeKeyValue(parentRow, this.keyAliases);
    if (this.prevMatchValue === undefined || currentValue !== this.prevMatchValue) {
      this.prevMatchValue = currentValue;
      return true;
    }
    return false;
  }
  
  /** Get the current match value (from the most recently processed parent row). */
  getCurrentMatchValue(parentRow: Record<string, unknown>): unknown {
    return makeKeyValue(parentRow, this.keyAliases);
  }
}
```

**Key design decision:** Group boundaries are determined by match key transitions, not by `_band_id` transitions. This is fundamentally different from the current `applyBandGroup()` which walks interleaved rows and detects `_band_id` changes. The overlay model detects groups in the parent data, which is where they logically exist.

#### Match Key Resolution

Each band has its own match column(s), determined by `keyPairs[0].left` (and additional pairs for composite keys). The grouping layer:

1. Reads `keyPairs` from each band's `DetailBandSpec`
2. Uses the `left` aliases to extract match values from parent rows
3. Match columns are parent columns — they always exist in parent data regardless of `selCols`
4. Match values are passed to `BandSectionDescriptor.matchValue` for section header display

**This resolves the "match columns must be in selCols" problem.** The match column is used for grouping detection, not for display. It doesn't need to be in the output column set.

#### One Band Per Group

The current interleaving produces one band row per matching child — if there are 5 order line items from `band_0`, there are 5 consecutive `band_0` rows after each parent row. The overlay model produces:

```
ParentDescriptor (Order 1, Company A)
ParentDescriptor (Order 2, Company A)
ParentDescriptor (Order 3, Company A)
BandSectionDescriptor (band_0, "Order Details", matchValue="Company A")
BandRowDescriptor (band_0, { Product: "Widget", Qty: 5 })
BandRowDescriptor (band_0, { Product: "Gadget", Qty: 3 })
BandRowDescriptor (band_0, { Product: "Doohickey", Qty: 1 })
ParentDescriptor (Order 4, Company B)
ParentDescriptor (Order 5, Company B)
BandSectionDescriptor (band_0, "Order Details", matchValue="Company B")
BandRowDescriptor (band_0, { Product: "Thingamajig", Qty: 2 })
```

Band rows are emitted once at the END of each group (when the match key changes or at the end of parent data), not after every parent row. This is implemented by collecting band rows during the walk and flushing them at group boundaries.

#### Nested Group Detection

Nested bands are supported structurally through the `depth` field on descriptors. A nested band (Band B within Band A's context) would produce:

```
ParentDescriptor (depth=0)
BandSectionDescriptor (band_0, depth=0)
BandRowDescriptor (band_0, depth=0)
  BandSectionDescriptor (band_1, depth=1)
  BandRowDescriptor (band_1, depth=1)
BandSectionDescriptor (band_0, depth=0)
BandRowDescriptor (band_0, depth=0)
```

The grouping layer would need a recursive boundary detector that tracks multiple match key hierarchies. This is deferred to Phase 4 — the type system and descriptor format support it, but the implementation is not in the initial scope.

### Grid Rendering

#### AG Grid Integration Strategy

AG Grid Community v32.1.0 (loaded as global script bundle) supports **full-width rows** via `isFullWidthRow` + `fullWidthCellRenderer`. This is the only alternative row rendering available in Community edition. Master/detail, tree data, and row grouping are Enterprise-only.

**Strategy:** Pre-stitch descriptors into AG Grid row data. Band section headers become full-width rows. Band data rows become regular rows with tinting.

#### Pre-Stitching for AG Grid

AG Grid Community requires a flat `rowData` array where all rows share the same column definitions. We cannot give band rows their own column set (that would require Enterprise master/detail). Therefore:

1. Convert `OverlayDescriptor[]` into a flat row array for AG Grid
2. `ParentDescriptor` → regular row with parent column values
3. `BandSectionDescriptor` → synthetic row with `_isBandHeader: true`, `_band_id`, `_bandLabel`
4. `BandRowDescriptor` → regular row with band column values mapped into the superset column positions (same null-padding as today, but done at the grid boundary, not the engine)

The null-padding is **reintroduced at the grid boundary** — not in the engine. This is a deliberate choice: the engine produces clean data, the grouping layer produces clean descriptors, and the grid adapter produces AG Grid-compatible rows. The null-padding is a rendering concern, not a data concern.

#### Full-Width Band Section Headers

```typescript
// In grid.tsx ResultGrid component:
const options = {
  rowData: gridRows,  // Pre-stitched from descriptors
  columnDefs: colDefs,
  isFullWidthRow: (params: { data: Record<string, unknown> }) => 
    params.data._isBandHeader === true,
  fullWidthCellRenderer: BandHeaderRenderer,
  embedFullWidthRows: true,
  getRowStyle: (params: { data: Record<string, unknown> }) => bandStyler(params),
  // ... existing options
};
```

#### BandHeaderRenderer

A class-based AG Grid cell renderer (required by AG Grid's imperative API):

```typescript
class BandHeaderRenderer {
  private eGui!: HTMLDivElement;
  
  init(params: { data: Record<string, unknown> }) {
    this.eGui = document.createElement('div');
    const bandId = String(params.data._band_id || '');
    const label = String(params.data._bandLabel || bandId);
    const tintIndex = params.data._bandTintIndex ?? 0;
    const color = BAND_ROW_TINTS[tintIndex % BAND_ROW_TINTS.length];
    
    this.eGui.style.cssText = `
      display: flex; align-items: center; height: 100%;
      padding: 4px 12px; background: ${color};
      border-top: 1px solid rgba(255,255,255,0.1);
      font-weight: 600; font-size: 13px;
    `;
    this.eGui.textContent = label;
  }
  
  getGui() { return this.eGui; }
  refresh() { return false; }
  destroy() {}
}
```

#### Grid Column Definitions

The grid's column definitions include the **superset of parent + all band columns** (same as today). Parent rows have band columns as empty strings. Band rows have parent columns as empty strings. The full-width section headers span all columns.

**Key difference from today:** The column superset is computed from the `OverlayDescriptor[]` at the grid boundary, not from the engine's interleaved rows. The grid adapter function `descriptorsToGridRows()` handles this.

#### _band_id Filter Preservation

The `_band_id` column filter in `makeResultCols()` (`grid.tsx` line 462) and `merge-toggles.tsx` (line 31) is **preserved unchanged**:

```typescript
// grid.tsx:462
const dataCols = cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id');

// merge-toggles.tsx:31
const baseDisplayCols = cols.filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id');
```

Under the overlay model, pre-stitched grid rows produced by `descriptorsToGridRows()` still carry `_band_id` on band rows (used by `createBandRowStyler()` for tinting and by `isFullWidthRow` for section header detection). The filter remains necessary to exclude `_band_id` from the user-visible column definitions. No changes to these filter expressions are required in any phase.

#### descriptorsToGridRows() Adapter

```typescript
/**
 * Convert OverlayDescriptor[] into AG Grid-compatible row data.
 * Computes superset columns, null-pads rows, inserts band header markers.
 * This is where the rendering concern of null-padding lives — not in the engine.
 */
function descriptorsToGridRows(
  descriptors: OverlayDescriptor[],
  parentCols: string[],
  bandColSets: Record<string, string[]>,
): Record<string, unknown>[];
```

### Export Rendering

#### Descriptor-Driven Export

The export's band layout path is rewritten to consume `OverlayDescriptor[]` instead of calling `applyBandGroup()` / `buildBandColumnLayout()`. The new function `buildExportFromDescriptors()` produces the same parent-column-aligned layout but driven by the declarative descriptor array:

```typescript
/**
 * Build export layout from overlay descriptors.
 * Produces parent-column-aligned output: parent rows pass through with all
 * columns, band section headers relabel parent positions, band data rows
 * have empty col 0 + band values in parent column positions.
 * 
 * Replaces buildBandColumnLayout() + applyBandGroup().
 */
function buildExportFromDescriptors(
  descriptors: OverlayDescriptor[],
  parentCols: string[],
  hdrMap: Record<string, string>,
): { cleanRows: Record<string, unknown>[]; rowKinds: number[]; headers: string[]; bandIds: string[] };
```

#### Label Resolution Coordination

The overlay model must coordinate with the export label resolution system to avoid raw internal aliases leaking to headers. Currently, `applyBandGroup()` strips the `_{bandId}_` prefix from band column aliases when producing section headers:

```typescript
const displayLabel = rawLabel.startsWith('_band_')
  ? rawLabel.replace(/^_band_\d+_/, '')
  : rawLabel;
```

The descriptor-driven export must perform the same prefix stripping when building section headers from `BandSectionDescriptor.bandColumns`. The `hdrMap` lookup happens on the raw alias; the prefix stripping happens on the result.

**Invariant:** Band column aliases in descriptors always carry the `_{bandId}_` prefix. Display labels are derived by stripping the prefix and looking up in `hdrMap`. This matches the current behavior.

#### Match Value in Section Headers

The `BandSectionDescriptor.matchValue` provides the match value for section header display (column 0). This value comes from the preceding parent row's match key columns — not from band rows (which have null for all parent columns).

**Invariant preserved:** The match value is always read from parent data, never from band data. The grouping layer captures it at group boundary detection time and stores it in the descriptor.

#### Row Kind Assignment

| Descriptor Type | Row Kind | Notes |
|----------------|----------|-------|
| `ParentDescriptor` | 5 | Band parent row (same as current kind 5) |
| `BandSectionDescriptor` | 4 | Section header row (same as current kind 4) |
| `BandRowDescriptor` | 0 | Band data row (same as current kind 0) |

#### CSV Export

CSV export retains `_band_id` on band data rows (same as today). Section headers are not inserted for CSV (same as today — CSV has no row-kind styling). The descriptor consumer checks the export format and skips section header insertion for CSV.

### Validation Updates

Current validation checks whether match columns are in `selCols`. The overlay model changes this:

**Old rule:** "Match column must be in selCols"  
**New rule:** "Match column must exist in parent data"

The match column is a parent column used for group boundary detection. It always exists in parent data (it's a column from the base table or a lookup). It doesn't need to be in `selCols` because it's not projected into the output — it's used internally for grouping.

Validation changes in `deriveValidation()`:
- **Remove:** Check that match column alias is in `selCols`
- **Add:** Check that match column alias resolves to a valid parent column (exists in base table or lookup output)
- **Keep:** All other band validation (table exists, key columns exist, sort columns exist)

### Report Output Publishing

#### The Problem

`createResultTable()` in `report-output.ts` (lines 52–71) checks `resultSet.columns.includes('_band_id')` to ensure `_band_id` is included in published output columns even when `displayCols` omits it. Under the overlay model:

- `ResultSet.columns` contains **only parent columns** (no `_band_id`, no band columns)
- `_band_id` exists only inside `bandResult.bandResults[*].rows`
- `PublishedOutput` has no `bandResult` field — it's a flat `{ columns, rows }` contract

This means `createResultTable()` would see no `_band_id` in `resultSet.columns` and publish a band-unaware output, breaking any downstream consumer that relies on `_band_id` for row classification.

#### Solution: PublishedOutput Gains bandResult Field

`PublishedOutput` is extended to carry band data alongside the flat parent output:

```typescript
export interface PublishedOutput {
  reportId: string;
  outputId: string;
  name: string;
  columns: string[];           // Parent columns only
  rows: Record<string, unknown>[];  // Parent rows only
  source: string;
  publishedAt: number;
  bandResult?: BandResultSet;  // Present when detail bands are active
}
```

`createResultTable()` is updated to:
1. Pass through `bandResult` from the `ResultSet` to the `PublishedOutput`
2. Stop checking for `_band_id` in `resultSet.columns` (it's no longer there — band data lives in `bandResult.bandResults[]`)
3. Downstream consumers that need band data read from `output.bandResult` instead of scanning rows for `_band_id`

Tests in `report-output.test.ts` that assert `_band_id` in published columns are rewritten to assert `bandResult` presence and structure. The `_band_id` column-injection logic is removed from `createResultTable()`.

---

## Implementation Structure

> **All phases ship together in a single commit.** Phases exist to organize the implementation into logical groups of changes within one PR — they are not staged deliveries. There is no transition period, no partial implementation state, and no incremental deployment. The codebase moves from the old interleaving architecture to the overlay architecture atomically.

### Phase 1: Engine + Grouping Layer + Stack Mode Removal

**Scope:** Engine returns `BandResultSet`, grouping layer produces `OverlayDescriptor[]`, stack mode deleted.

**Changes:**
1. Add `BandResultSet`, `OverlayDescriptor` types to `types.ts`
2. Create `report/overlay-grouping.ts` with `buildOverlayDescriptors()`
3. Modify `runDetailBandsMode()` to return `BandResultSet` (no interleaving)
4. Update `ResultSet` to include optional `bandResult` field (in `result-set.ts`)
5. Remove stack mode: delete `crossProductRows()`, `RowExplosionError`, `STACK_ROW_LIMIT`, `if (mode === 'stack')` branch in `report/engine.ts`; remove `detailBandMode` field from `types.ts`; remove mode toggle UI from `ui/cards/pipeline-card.tsx`; delete `ui/components/row-explosion-dialog.tsx`; remove `RowExplosionError` handler from `ui/sections/run-bar.tsx`
6. Remove `detailBandMode` from state infrastructure: remove default values from `core/state.ts` (`createAppState()`, `createReportSpec()`); remove from `RECOGNIZABLE_KEYS` in `core/state-schema.ts`; remove hydration in `core/state-hydrator.ts`; remove serialization in `core/state-serializer.ts`; remove from `ReportSpec` in `report/preview-builder.ts`
7. Remove stale exports from `index.ts`: `RowExplosionError`, `STACK_ROW_LIMIT`, `RowExplosionDialog`, `RowExplosionDialogProps` (keep `buildBandChildIndex` export — reused by grouping layer)
8. Update `report-output.ts`: extend `PublishedOutput` with `bandResult`, update `createResultTable()` to pass through `bandResult` and stop injecting `_band_id` into published columns
9. Update tests for new engine output, grouping layer, report output, stack mode removal, and `detailBandMode` cleanup across core/state, query helpers, and integration tests

**Validation:** New tests for `buildOverlayDescriptors()` verify correct group boundary detection and descriptor emission per the spec. Engine tests verify `BandResultSet` structure. Report output tests verify `bandResult` pass-through.

**Risk:** Low–Medium. Stack mode removal is straightforward deletion but touches UI components (`ui/cards/pipeline-card.tsx`, `ui/components/row-explosion-dialog.tsx`, `ui/sections/run-bar.tsx`), state infrastructure (`core/state.ts`, `core/state-schema.ts`, `core/state-hydrator.ts`, `core/state-serializer.ts`), module exports (`index.ts`), and preview builder (`report/preview-builder.ts`) — requires careful test cleanup across 10+ test files.

### Phase 2: Grid Overlay Rendering

**Scope:** Grid consumes `OverlayDescriptor[]` directly. Full-width band section headers.

**Changes:**
1. Add `BandHeaderRenderer` class to `grid.tsx`
2. Add `descriptorsToGridRows()` adapter in `grid.tsx`
3. Update `ResultGrid` to use descriptors when `bandResult` is present
4. Configure `isFullWidthRow`, `fullWidthCellRenderer`, `embedFullWidthRows` in AG Grid options
5. Extend `AGridApi` type declarations for new options (in `types/globals.d.ts`)
6. Update grid band tests

**Validation:** Visual testing of band section headers in AG Grid. Tinting preserved for band data rows. Grid band tests verify descriptor-driven row structure per the spec.

**Risk:** Medium. AG Grid full-width row integration requires testing with sorting, filtering, pagination, and column state persistence.

### Phase 3: Export Overlay Rendering

**Scope:** Export consumes `OverlayDescriptor[]` directly. `applyBandGroup()` and `buildBandColumnLayout()` removed.

**Changes:**
1. Add `buildExportFromDescriptors()` to `export.ts`
2. Update `exportAs()` band dispatch to use descriptor consumer
3. Remove `applyBandGroup()`, `buildBandColumnLayout()`, `computeBandColSets()` (replaced by descriptor consumer)
4. Update export band tests (98 tests — significant rewrite)

**Validation:** All 98 export band tests rewritten to validate descriptor-driven output against the spec — correct parent-column-aligned layout, section header content, row kind assignment, and CSV path.

**Risk:** High. 98 tests rewritten. Export output must conform to the spec's parent-column-aligned layout.

### Phase 4: Nested Bands + Hidden Match Columns

**Scope:** Enable nested band configuration and hidden match columns.

**Changes:**
1. Add `parentBandId` field to `DetailBandSpec` for nesting
2. Extend `buildOverlayDescriptors()` with recursive boundary detection
3. Add UI for configuring nested bands in `ui/sections/detail-band-stage.tsx`
4. Add option to hide match columns from grid/export display
5. Update validation for nested band rules

**Validation:** Integration tests for nested band scenarios. Visual testing of nested section headers.

**Risk:** Medium. Structurally supported by the descriptor model, but UI and validation are new.

---

## Testing Strategy

> **TDD approach:** Tests are written first, encoding the spec's expected behavior. The implementation makes tests pass. Tests are never modified to accommodate broken code — the spec is the ground truth. If a test fails, the implementation is wrong, not the test.

### Unit Tests

| Module | Test File | Coverage |
|--------|-----------|----------|
| `overlay-grouping.ts` | `preact/tests/report/overlay-grouping.test.ts` | Group boundary detection, descriptor emission, match key resolution, multi-band ordering, empty bands, single-row groups |
| `engine.ts` (modified) | `preact/tests/report/engine-bands.test.ts` (updated) | `BandResultSet` output, no interleaving, band result structure |
| `result-set.ts` (extended) | `preact/tests/report/result-set-bands.test.ts` (updated) | `bandResult` field on `ResultSet`, `buildResultSet()` with band metadata, backward compatibility when `bandResult` is undefined |
| `grid.tsx` (band path) | `preact/tests/ui/grid-bands.test.ts` (updated) | `descriptorsToGridRows()`, full-width row markers, tint index assignment |
| `export.ts` (band path) | `preact/tests/ui/export-bands.test.ts` (rewritten) | `buildExportFromDescriptors()`, section header construction, label resolution, row kind assignment, CSV path |
| `engine.ts` (stack removal) | `preact/tests/report/engine-perf.test.ts` (updated) | `crossProductRows()` perf tests deleted; `interleaveRows()` perf tests deleted (function removed); new perf tests for `buildOverlayDescriptors()` at scale |
| Stack mode UI (deleted) | `preact/tests/ui/row-explosion-dialog.test.ts` (deleted) | Entire file deleted in Phase 1 — tests stack mode dialog which no longer exists |

### Integration Tests

| Scenario | Test File | Coverage |
|----------|-----------|----------|
| End-to-end band rendering | `preact/tests/integration/band-overlay-e2e.test.ts` | Engine → grouping → grid rows, Engine → grouping → export rows |
| Export correctness | `preact/tests/integration/band-export-parity.test.ts` | Descriptor-driven export produces correct parent-column-aligned layout per the spec |
| Validation | `preact/tests/report/validation-bands.test.ts` (updated) | Match column existence check, hidden match column support |
| Band column catalog integration | `preact/tests/integration/band-columns-catalog.test.ts` (updated) | Verifies column catalog band prefixing works correctly with `BandResultSet` output; ensures band columns are properly prefixed and resolved through the overlay pipeline |

### Property-Based Tests

- **Descriptor structure:** For any valid `BandResultSet` with grouped parent rows, `buildOverlayDescriptors()` produces parent descriptors followed by band-section descriptors at group boundaries.
- **Section header content:** Section header descriptors contain match value + band column display names in parent column positions.
- **Band data content:** Band data row descriptors contain match value + band column values.

---

## Constraints

1. **Five-layer architecture (ADR-002/004):** The overlay grouping module lives in the Report layer. It imports from Core (types) and Report (engine). UI imports from Report (grouping) and Core (types). No upward imports.

2. **sql.js WASM as sole query engine (ADR-003/005):** Band queries remain per-band batched WHERE IN. The overlay model doesn't change data acquisition — only the output contract and post-query processing.

3. **Monolithic state store (ADR-006):** `BandResultSet` is stored in `result.bandResult` on the AppState `result` field. The `result` field is runtime-only (not serialized). `OverlayDescriptor[]` is computed on demand from `bandResult` — not stored in state.

4. **`_band_id` stays as separate column:** The overlay model uses `_band_id` on band result rows for identification. It's not merged into `_row_type`. The descriptor model makes `_band_id` an implementation detail of the band result sets, not a concern of the parent data.

5. **JS stitching with batched WHERE IN:** Band queries remain per-band batched. The `buildBandChildIndex()` function is reused by the grouping layer for O(1) child lookup.

6. **Stack mode removed in Phase 1:** `crossProductRows()`, `RowExplosionError`, `STACK_ROW_LIMIT`, the `if (mode === 'stack')` branch, the UI mode toggle, and `detailBandMode` state field are all deleted in Phase 1. The overlay model only supports group-based rendering (one band section per group boundary). Not reintroduced.

7. **Band column aliases use `_{bandId}_` prefix:** Preserved in the descriptor model. `BandSectionDescriptor.bandColumns` and `BandRowDescriptor.columns` carry the prefixed aliases. Display label derivation strips the prefix.

8. **PE-13/PE-14 dead end avoided:** The overlay model does NOT project band columns into the parent SELECT. Band columns remain in separate band result sets. The parent query's FROM clause has no JOIN to band tables.

9. **Source tables immutable (ADR-001):** The overlay model operates on in-memory result rows. No source table mutation.

10. **Band columns tagged `kind: 'band'` in colMap:** Unchanged. Query builders skip these in SELECT. The overlay model doesn't alter catalog behavior.

---

## Open Questions

### OQ-1: AG Grid full-width row interaction with sorting/filtering

Full-width rows don't participate in AG Grid's sorting/filtering. When a user sorts or filters the grid, full-width band section headers remain in their original positions. This could produce confusing output where section headers appear between unrelated parent rows after sorting.

**Options:**
- A: Disable sorting/filtering when bands are active (simplest, most predictable)
- B: Accept the visual inconsistency (section headers stay at group boundaries, sorted data flows around them)
- C: Remove section headers when sorting/filtering is active, fall back to tinted rows only

**Leaning:** Option A for Phase 2. Revisit in Phase 4 if user feedback demands more sophistication.

### OQ-2: Band section header content

What should the full-width band section header display? Options:
- A: Band label only (e.g., "Order Details")
- B: Band label + match value (e.g., "Company A — Order Details")
- C: Band label + match value + band column count (e.g., "Company A — Order Details (3 columns)")

**Leaning:** Option B. The match value provides context for which group the band belongs to, matching the current export section header behavior.

### OQ-3: Performance at scale

The descriptor model adds an extra iteration over parent rows (for boundary detection) compared to the current interleaving. For very large reports (50K+ parent rows, 10+ bands), this could add measurable overhead.

**Mitigation:** The boundary detection is O(n) with O(1) lookups (same as current interleaving). The overhead is one additional pass. Profile with realistic data volumes before Phase 2.

### OQ-4: `result` field serialization

The `result` field on AppState is currently runtime-only (not serialized). If `bandResult` is added to `result`, it inherits this behavior. Confirm that `bandResult` doesn't need to survive serialization/hydration cycles.

**Leaning:** `bandResult` is recomputed on every report run. It doesn't need serialization. The `detailBands` spec (which IS serialized) provides all the information needed to reconstruct `bandResult`.

### OQ-5: Collapsible band sections

Should band sections be collapsible in the grid? Full-width row renderers could implement expand/collapse via a button that removes/adds the following band data rows via `applyTransaction`.

**Leaning:** Defer to Phase 4 or later. The descriptor model supports it (filter out `band-row` descriptors for collapsed sections), but the AG Grid integration adds complexity.

### OQ-6: Totals row interaction with overlays

The current `_isTotalsRow` passes through the band export path unchanged. In the descriptor model, a totals row would appear as a `ParentDescriptor` with `_isTotalsRow: true`. The grouping layer should emit it after flushing all pending band rows.

**Leaning:** Totals row is a special `ParentDescriptor` that triggers a final flush of all pending band groups. No band section follows the totals row.

---

## Appendix: Research Findings

### AG Grid Community v32.1.0 Capabilities

| Feature | Available | Notes |
|---------|-----------|-------|
| Full-width rows (`isFullWidthRow` + `fullWidthCellRenderer`) | ✅ Community | Recommended for band section headers |
| `embedFullWidthRows` | ✅ Community | Horizontal scroll sync with data rows |
| `applyTransaction` | ✅ Community | Programmatic row insertion/removal |
| `getRowStyle` | ✅ Community | Per-row tinting (already used) |
| `cellRendererSelector` | ✅ Community | Per-row cell rendering variation |
| Master/detail (`isRowMaster` + `detailCellRenderer`) | ❌ Enterprise | Would be ideal but not available |
| Tree data (`getDataPath`) | ❌ Enterprise | Not available |
| Row grouping (`rowGroup` on column defs) | ❌ Enterprise | Not available |
| Row pinning at arbitrary positions | ❌ Not supported | Pinning only at top/bottom of grid |

**Conclusion:** Full-width rows are the correct AG Grid Community approach for band section headers. Band data rows must share the unified column set (pre-stitching required).

### Key Patterns Discovered

1. **`buildBandChildIndex()` is reusable.** The O(1) child lookup index built in `engine.ts` can be shared with the grouping layer. No need to rebuild it.

2. **`makeKeyValue()` is the canonical key function.** Both parent-side and child-side key computation use this function. The grouping layer reuses it for boundary detection.

3. **Export label resolution is a two-step process.** First, look up the raw alias in `hdrMap`. Second, strip the `_{bandId}_` prefix from the result. The overlay model must preserve this two-step process.

4. **`_processed` flag is a rendering concern.** The current `applyBandGroup()` marks rows as `_processed` to prevent re-processing by subsequent band groups. The descriptor model eliminates this — each descriptor is processed exactly once by construction.

5. **Row kind 5 (band parent row) is an export concept.** It marks parent rows that have been remapped from alias keys to label keys. The descriptor model doesn't need this — `ParentDescriptor` is inherently a parent row, and the export adapter handles key remapping.

### Files Affected by Migration

| Phase | Files | Risk |
|-------|-------|------|
| Phase 1 | `types.ts`, `report/engine.ts`, `result-set.ts`, new `report/overlay-grouping.ts`, `report/report-output.ts`, `report/preview-builder.ts`, `core/state.ts`, `core/state-schema.ts`, `core/state-hydrator.ts`, `core/state-serializer.ts`, `ui/cards/pipeline-card.tsx`, `ui/components/row-explosion-dialog.tsx` (deleted), `ui/sections/run-bar.tsx`, `index.ts`, test files (10+) | Low–Medium (stack mode removal touches UI, state infrastructure, exports, and preview builder) |
| Phase 2 | `ui/grid.tsx`, `types/globals.d.ts`, test files | Medium |
| Phase 3 | `ui/export.ts`, test files (98 tests rewritten) | High |
| Phase 4 | `types.ts`, `report/overlay-grouping.ts`, `ui/sections/detail-band-stage.tsx`, `report/validation.ts`, test files | Medium |
