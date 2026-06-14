# Pipeline Preview — Design Document

**Status:** Draft  
**Author:** R&D (rnd-dd-author)  
**Created:** 2026-06-14  
**Slug:** dd-pipeline-preview

**Related Documents:**
- [CONTRACTS.md](artifacts/designs/completed/preact/CONTRACTS.md) — Module contracts — PipelineArrow contract at line 424 declares `buildPreviewHTML` prop that was never implemented
- [Pipeline arrow component](SRC/preact/ui/sections/pipeline-arrow.tsx) — Current stub — 45-line component with toggle state but hardcoded placeholder
- [Pipeline card component](SRC/preact/ui/cards/pipeline-card.tsx) — Parent composer — renders all PipelineArrow instances, stale comment at line 12
- [Query plan builder](SRC/preact/query/query-plan.ts) — SQL generation orchestrator — pure function `buildQueryPlan(reportSpec, tables)` returning `BuiltQueryPlan`
- [SQL detail query](SRC/preact/query/sql-detail.ts) — Detail SQL generator — `buildDetailQuery(spec, colMap, sourceCatalog, calcExprs)` producing `{ sql, params, cols }`
- [SQL band query](SRC/preact/query/sql-detail-bands.ts) — Band SQL generator — `buildBandQuery(band, parentKeyValues, bandColMap, sourceCatalog)` for child table queries
- [Report execution engine](SRC/preact/report/engine.ts) — Report runner — pattern reference for `buildQueryPlan` → `execQuery` → result shaping
- [Core state](SRC/preact/core/state.ts) — State factories — `buildReportSpecFromState(state)` extracts flat pipeline fields (base, lookups, calcStages, detailBands) from state; returns `Record<string, unknown>`, **not** a `ReportSpec`
- [SQL execution](SRC/preact/core/sqldb.ts) — SQLite wrapper — `execQuery(sql, params)` synchronous, `quoteId(name)` for safe identifiers
- [Column catalog](SRC/preact/catalog/column-catalog.ts) — Column mapping — `buildColSourceMap()` sync alias→source mapping
- [Source catalog](SRC/preact/catalog/source-catalog.ts) — Table metadata — `buildSourceCatalog(tables)` returns `Map<string, SourceTableEntry>`
- [Core utilities](SRC/preact/core/utils.ts) — `colUserLabel(tid, col)` sync label lookup (line 200)
- [Layout selection](SRC/preact/query/layout-selection.ts) — `_previewOpen: Set<string>` toggle tracker (line 23)
- [Type definitions](SRC/preact/types.ts) — `ReportSpec` interface (line 214), `AppState` (line 163)
- [Report pipeline orientation skill](.opencode/skills/report-pipeline-orientation/SKILL.md) — Five-layer architecture and data flow
- [Query layer orientation skill](.opencode/skills/query-layer-orientation/SKILL.md) — SQL generation module responsibilities

---

## Problem Statement

PipelineArrow in `SRC/preact/ui/sections/pipeline-arrow.tsx:40` renders a hardcoded `<em>Preview not available yet</em>` placeholder when users click the "▼ Preview" button on pipeline stage arrows. The toggle state machinery works correctly — `_previewOpen` in `query/layout-selection.ts` tracks which arrows are open, and the component re-renders on toggle — but no preview data is generated or displayed.

This was never implemented during the JS→Preact migration. The old implementation existed in `SRC/js/ui/views/query-builder.tsx` (commit `46d15d7`) as two functions: `_buildPreviewSQL(key)` which built partial ReportSpecs and generated SQL, and `_buildPreviewHTML(key)` which executed the SQL and returned an HTML table string rendered via `dangerouslySetInnerHTML`. Neither function was ported.

Additionally, CONTRACTS.md (line 424) declares that PipelineArrow accepts a `buildPreviewHTML` prop, but the actual component only accepts `{ id: string }`. The contract was written for an implementation that never materialized.

**Who has this problem:** Every user who configures a multi-stage pipeline (lookups, calculated columns, detail bands) and wants to verify intermediate results before running the full report. The preview button is visible and clickable but produces no useful output.

---

## Root Cause Analysis

The preview feature was deferred during the Preact migration for two compounding reasons:

1. **The old implementation used `dangerouslySetInnerHTML`** — The old `_buildPreviewHTML` returned raw HTML strings. AGENTS.md explicitly forbids `dangerouslySetInnerHTML` in the Preact codebase, so a direct port was impossible. A JSX-based rendering approach was needed but never designed.

2. **The old implementation used async `colDisplayLabel`** — The old code called `colDisplayLabel(c, pvMap)` for column headers, which is async in the Preact codebase. Preview execution must be synchronous (it runs during render), so a sync alternative was needed but never implemented.

These two blockers caused the feature to be stubbed with a placeholder, with the intention of revisiting it. The stale CONTRACTS.md entry and the incorrect comment at `pipeline-card.tsx:12` ("Preview HTML builder is passed as a prop to PipelineArrow") are artifacts of that incomplete migration.

---

## Scope

### In Scope

- **New file:** `SRC/preact/report/preview-builder.ts` — Pure function module for generating preview data per pipeline stage
- **Modified:** `SRC/preact/ui/sections/pipeline-arrow.tsx` — Add `result` prop, replace placeholder with JSX `<table>` rendering
- **Modified:** `SRC/preact/ui/cards/pipeline-card.tsx` — Add preview state management, compute and pass `PreviewResult` to each arrow, fix stale comment at line 12
- **New test:** `SRC/preact/tests/report/preview-builder.test.ts` — Unit tests for `buildPreview()`
- **New test:** `SRC/preact/tests/ui/pipeline-arrow.test.tsx` — Component rendering tests for PipelineArrow with preview data

### Out of Scope

- Band preview with parent context (band preview shows raw child table only)
- Preview caching across state changes (preview recomputes on each open)
- Preview for aggregation modes (group, totals, subtotals) — preview always shows detail mode
- Changes to `_previewOpen` toggle mechanism (works correctly as-is)
- CONTRACTS.md update (separate task — this DD supersedes the old contract)

---

## Design Goals

1. **Layer purity** — SQL generation and execution in the report layer, rendering in the UI layer. No SQL logic in UI components.
2. **Synchronous execution** — Preview must complete synchronously. `execQuery` is sync; no async/await in the preview path.
3. **Error isolation** — All errors caught in `buildPreview()`, returned as structured data, rendered inline. No uncaught exceptions during render.
4. **Testability** — `buildPreview(key, state)` is a pure function returning structured `PreviewResult` data. No DOM, no store dependency in the builder.
5. **No `dangerouslySetInnerHTML`** — All rendering uses JSX `<table>` elements.
6. **Sync column labels** — Use `colUserLabel(tid, col)` and `buildColSourceMap()` for headers. Never call async `colDisplayLabel`.
7. **No filters or sorts in preview** — Preview shows raw stage output, not post-filtered/sorted results.
8. **Backward-compatible interface** — PipelineArrow's existing `id` prop continues to work. New `result` prop is optional (renders placeholder when absent).

---

## Architecture

### Layer Mapping

| Component | Layer | Responsibility |
|-----------|-------|----------------|
| `preview-builder.ts` | Report | Pure function: stage key → SQL → execute → structured result |
| `pipeline-card.tsx` | UI (card) | State owner: computes PreviewResult per arrow, passes as prop |
| `pipeline-arrow.tsx` | UI (section) | Presentational: renders toggle button + JSX table from result prop |

### Data Flow

```
User clicks "▼ Preview" on PipelineArrow(id="lk1")
        │
        ▼
PipelineArrow toggles _previewOpen, sets local state open=true
        │
        ▼
PipelineCard re-renders (subscribed to store)
        │
        ├── For each arrow with open=true:
        │     buildPreview(arrowId, state) → PreviewResult
        │
        ▼
PipelineCard passes result prop to PipelineArrow
        │
        ▼
PipelineArrow renders JSX <table> from PreviewResult
```

### State Ownership

PipelineCard owns a `Record<string, PreviewResult>` that maps arrow IDs to their computed preview data. This record is recomputed when:
- The store state changes (new tables, lookups, calcs, bands)
- An arrow's preview is opened (lazy computation)

Previews are computed lazily — only for arrows that are currently open. When an arrow is closed, its cached result is retained (no recomputation on re-open unless state changed).

---

## Detailed Design

### 1. `report/preview-builder.ts` — New Module

#### Types

```typescript
import type { AppState, DbTable } from '../types.js';

/** Structured preview result — either data or an error message. */
export interface PreviewResult {
  /** Column headers (display labels). */
  headers: string[];
  /** Row data — each row is a record of column alias → value. */
  rows: Record<string, unknown>[];
  /** Error message if preview generation failed. Null on success. */
  error: string | null;
}
```

#### Public API

```typescript
/**
 * Build a preview for a pipeline stage.
 *
 * Pure function — no global state dependency. Takes the stage key
 * and full AppState, returns structured preview data.
 *
 * @param key   - Arrow ID: "base", "lkN", "calcN", or "bandN"
 * @param state - Current AppState (tables, base, lookups, calcStages, etc.)
 * @returns PreviewResult with headers, rows, and optional error
 */
export function buildPreview(key: string, state: AppState): PreviewResult;
```

#### SQL Generation Strategy

| Key Pattern | Strategy |
|-------------|----------|
| `"base"` | Manual UNION ALL across base + stacked tables → `SELECT * FROM (...) LIMIT 5` |
| `"lkN"` | Full ReportSpec via `buildPreviewReportSpec` with lookups[0..N], no calcs, no filters/sorts → `buildQueryPlan` → strip ORDER BY → append `LIMIT 5` → `execQuery` |
| `"calcN"` | Full ReportSpec via `buildPreviewReportSpec` with all lookups + calcs[0..N], no filters/sorts → same flow as lkN |
| `"bandN"` | `SELECT * FROM child-table LIMIT 5` — raw child table, no parent context |

##### Base Preview (`key === "base"`)

```
1. Collect IDs: [state.base, ...state.stacks.filter(id => state.tables[id])]
2. Validate: every ID must exist in state.tables → else return error
3. Get baseCols: state.tables[state.base].cols
4. For each ID, build SELECT:
   - For each baseCol: if table has it → quoteId(col), else → NULL
   - SELECT col1, col2, NULL, ... FROM quoteId(tableId)
5. Join with UNION ALL
6. Wrap: SELECT * FROM (<union>) LIMIT 5
7. execQuery(sql) → rows
```

This mirrors the old implementation exactly. Stacked tables may have different column sets; missing columns become NULL.

##### Lookup/Calc Preview (`key matches /^lk(\d+)$/` or `/^calc(\d+)$/`)

```
1. Filter out disabled lookups: `state.lookups.filter(lk => lk.enabled !== false)`
2. Build a complete ReportSpec via buildPreviewReportSpec(state, options):
   - options.lookupsUpTo = N   (for lkN)
   - options.calcsUpTo = -1    (for lkN: no calcs)
   - options.lookupsUpTo = ∞   (for calcN: all lookups)
   - options.calcsUpTo = N     (for calcN)
3. buildQueryPlan(fullSpec, state.tables) → plan
4. Strip ORDER BY from plan.sql (regex: replace /\s*ORDER BY.+$/i with '')
5. Append ' LIMIT 5'
6. execQuery(sql, plan.params) → rows
7. Use plan.cols for column ordering
```

**Why a full ReportSpec?** `buildQueryPlan(reportSpec: ReportSpec, tables)` requires a *complete* `ReportSpec` — it accesses `reportSpec.aggregation.mode`, `reportSpec.aggregation.aggregates`, `reportSpec.outputColumns`, `reportSpec.mergeDisplay`, `reportSpec.publish`, etc. without optional chaining. Passing a partial object causes TypeScript errors and runtime crashes. The helper below fills every required field.

##### `buildPreviewReportSpec(state, options)` Helper

```typescript
/**
 * Build a complete ReportSpec for preview SQL generation.
 *
 * Produces a full ReportSpec with all required fields populated.
 * Pipeline fields (lookups, calcs) are sliced according to options.
 * Preview-specific defaults: no filters, no sorts, aggMode 'none',
 * outputColumns null (project all), bands excluded.
 *
 * Reference: tests/query/helpers.ts:53-87 makeReportSpec() for the
 * canonical full-spec shape.
 */
function buildPreviewReportSpec(
  state: AppState,
  options: { lookupsUpTo: number; calcsUpTo: number },
): ReportSpec {
  // Filter disabled lookups before slicing — disabled stages should not
  // contribute JOINs to the preview query.
  const enabledLookups = (state.lookups || []).filter(lk => lk.enabled !== false);

  const slicedLookups = options.lookupsUpTo < 0
    ? []
    : enabledLookups.slice(0, options.lookupsUpTo + 1);

  const slicedCalcs = options.calcsUpTo < 0
    ? []
    : (state.calcStages || []).slice(0, options.calcsUpTo + 1);

  return {
    id: null,
    name: 'preview',
    enabled: true,
    pipeline: {
      base: state.base,
      baseCols: state.baseCols ?? null,
      stacks: state.stacks || [],
      lookups: slicedLookups,
      calculatedColumns: slicedCalcs,
      detailBands: [],  // exclude bands from preview
    },
    outputColumns: null,        // project all columns
    filters: [],                // no filtering in preview
    sorts: [],                  // no sorting in preview
    aggregation: {
      mode: 'none',
      groupBy: [],
      aggregates: [],
      colTotals: {},
      subtotalBy: [],
      subtotalFns: {},
      subtotalGrandTotal: false,
      subtotalSpacer: false,
      subtotalOnTop: false,
      subtotalStrategy: 'combined',
    },
    mergeDisplay: { mergedCols: [], mergeGroupUnderline: false },
    outputDefinition: null,
    publish: { enabled: false, tableName: '' },
  };
}
```

**Disabled lookup handling:** The helper filters `lk.enabled !== false` *before* slicing. This means a disabled lookup at index 1 does not count toward the `lookupsUpTo` limit — only enabled lookups are included. This matches the behavior of `buildQueryPlan` itself, which filters `lk.enabled !== false` at line 174 of `query-plan.ts`.

The full ReportSpec excludes filters, sorts, and aggregation because preview shows raw stage output. Detail bands are excluded because they produce child rows that don't belong in the parent preview.

Key difference from old implementation: the old code used `renderDetailSql(plan)` (a function that no longer exists). The new code uses `plan.sql` directly from `buildQueryPlan`, which already produces a complete detail query when `aggMode === 'none'`.

##### Band Preview (`key matches /^band(\d+)$/`)

```
1. Parse N from key
2. Get band = state.detailBands[N]
3. Validate: band exists, band.rightId exists, state.tables[band.rightId] exists
4. Build SQL: SELECT * FROM quoteId(band.rightId) LIMIT 5
5. execQuery(sql) → rows
6. Headers: physical column names from state.tables[band.rightId].cols
   (no alias resolution — band preview is raw table data)
```

Band preview is intentionally simple. Without parent row context, a meaningful joined preview is impossible. The raw child table gives the user a sense of what data the band will pull from.

#### Column Label Computation

All labels computed synchronously:

```typescript
function buildHeaders(cols: string[], state: AppState): string[] {
  const colMap = buildColSourceMapFromState(state);  // sync, pure variant
  return cols.map(alias => {
    const src = colMap.get(alias);
    if (!src) return alias;
    if (src.kind === 'calc') return alias;
    if (src.kind === 'band') return alias;
    return colUserLabelFromState(src.tid, src.col, state);  // sync
  });
}
```

**Important:** The existing `buildColSourceMap()` and `colUserLabel()` read from `getStore().getState()`. Since `buildPreview` receives `state` as a parameter (pure function), we need store-free variants. Two approaches:

- **Option A:** Inline the logic — `buildColSourceMap` is ~80 lines, `colUserLabel` is 3 lines. Duplicate them as pure functions in preview-builder.ts.
- **Option B:** Temporarily set the store state before calling the existing functions.

**Decision: Option A.** The functions are small, and duplicating them as pure variants avoids coupling preview-builder to the global store. The pure variants take `state: AppState` as a parameter.

```typescript
/** Pure variant of buildColSourceMap — takes state instead of reading store. */
function buildColSourceMapForState(state: AppState): Map<string, ColMapEntry> {
  // Same logic as catalog/column-catalog.ts:buildColSourceMap()
  // but reads from `state` parameter instead of getStore().getState()
}

/** Pure variant of colUserLabel — takes state instead of reading store. */
function colUserLabelForState(tid: string, physCol: string, state: AppState): string {
  return state.columnLabels?.[tid]?.[physCol] ?? physCol;
}
```

On closer inspection, `buildColSourceMap()` (column-catalog.ts:79-162) directly iterates `state.tables` (registering each physical column from the base table with `{ tid, col }` entries), `state.lookups` (registering lookup columns with `tablePrefix()` collision avoidance), and `state.calcStages` (registering validated calc aliases with `kind: 'calc'` metadata). It does **not** call `buildReportSpecFromState()` or `buildColumnCatalog()`. The pure variant simply replaces `getStore().getState()` with the `state` parameter — the iteration logic is identical and trivially duplicated at approximately 84 lines (including calc validation logic), not 20 lines as the old comment suggested.

**Convention exception — `execQuery()` call:** The report layer's architecture rules state that `execQuery()` should only be called from `engine.ts` ("Calling `execQuery()` outside `engine.ts` — SQL execution is the engine's responsibility"). Preview-builder calls `execQuery()` directly, which is a deliberate exception. Rationale: preview results are not "report results" — they are transient, capped-at-5-rows preview data that doesn't need the full `ResultSet` structure. Routing preview SQL through `runReport()` would add unnecessary overhead (result set construction, metadata, band stitching) for data that is immediately rendered as a small JSX table. This follows the existing pattern in `engine.ts` itself, where `runDetailMode()` calls `execQuery(plan.sql, plan.params)` directly at line 37. The preview-builder is effectively a lightweight sibling of `runDetailMode` — same `buildQueryPlan` → `execQuery` → shape result flow, but without `buildResultSet()`. Preview results are temporary preview data that doesn't need the full `ResultSet` structure — they are rendered inline as JSX `<table>` elements, never stored or exported.

#### Error Handling

All errors caught at the top level of `buildPreview()`:

```typescript
export function buildPreview(key: string, state: AppState): PreviewResult {
  try {
    // ... generation logic ...
    return { headers, rows, error: null };
  } catch (ex) {
    return { headers: [], rows: [], error: (ex as Error).message };
  }
}
```

Specific error cases:
- No base table → `{ error: 'No base table selected' }`
- Invalid key pattern → `{ error: 'Unknown stage' }`
- SQL execution failure → `{ error: <sql.js error message> }`
- Missing table reference → `{ error: 'Table not found' }`

#### Imports

```typescript
import type { AppState, DbTable, ReportSpec } from '../types.js';
import type { ColMapEntry } from '../catalog/column-catalog.js';
import { buildSourceCatalog } from '../catalog/source-catalog.js';
import { buildColumnCatalog } from '../catalog/column-catalog.js';
import { buildQueryPlan } from '../query/query-plan.js';
import { execQuery, quoteId } from '../core/sqldb.js';
```

Note: preview-builder is in the **report layer** and imports from **catalog**, **query**, and **core** layers. This is valid — report layer depends downward on all lower layers.

**Exports:** `buildPreview` and `PreviewResult` are exported from `preview-builder.ts` and should also be re-exported from the top-level barrel at `SRC/preact/index.ts` (line 57-72, Report Layer section — alongside existing report exports like `runReport`, `buildResultSet`, etc.). Add the following export line to the Report Layer section:

```typescript
export { buildPreview } from './report/preview-builder';
export type { PreviewResult } from './report/preview-builder';
```

This ensures consistent import paths for consumers (`import { buildPreview } from '../index.js'` instead of deep `'../report/preview-builder.js'` imports) and follows the pattern established by all other report modules.

---

### 2. `ui/cards/pipeline-card.tsx` — Modifications

#### New State

Add a previews record to PipelineCard's component state:

```typescript
interface PipelineCardState {
  state: AppState;
  previews: Record<string, PreviewResult>;
}
```

Or, using separate `useState` calls (matching existing pattern):

```typescript
const [state, setState] = useState<AppState>(getStore().getState());
const [previews, setPreviews] = useState<Record<string, PreviewResult>>({});
```

#### Preview Computation

When an arrow's preview is opened, compute the preview and cache it:

```typescript
const computePreview = useCallback((id: string) => {
  if (previews[id]) return;  // Already cached
  const currentState = getStore().getState();
  const result = buildPreview(id, currentState);
  setPreviews(prev => ({ ...prev, [id]: result }));
}, [previews]);
```

**Cache invalidation:** When store state changes (detected via `useEffect` + store subscription), clear the previews cache so they recompute on next open:

```typescript
useEffect(() => {
  return getStore().subscribe(s => {
    setState(s);
    setPreviews({});  // Clear cache on any state change
  });
}, []);
```

This is simple and correct. Max previews per report: ~16 (1 base + 5 lookups + 5 calcs + 5 bands). Each preview holds ≤5 rows of data. Memory impact is negligible.

**Implicit ordering dependency — `_previewOpen.clear()` timing:** In `base-stage.tsx:51-61`, `handleBaseChange` calls `getStore().update(draft => { ... })` first (lines 52-58), then `_previewOpen.clear()` at line 59. This ordering is important: the store update triggers subscribers (which clear the preview cache via `setPreviews({})`), and only then are the `_previewOpen` toggle states reset. If the order were reversed, a subscriber could read stale `_previewOpen` values before they're cleared. The existing code gets this right — `store.update()` publishes the new state synchronously, so by the time `_previewOpen.clear()` runs, all subscribers have already received the updated state and invalidated their caches. Preview-builder does not need to worry about this ordering; it simply receives whatever state is current when `buildPreview()` is called.

#### Passing Results to PipelineArrow

Each `<PipelineArrow>` call site gains a `result` prop:

```tsx
<PipelineArrow id="base" result={previews['base']} onOpen={computePreview} />
{lookups.map((_lk, i) => (
  <div key={`lk-${i}`}>
    <LookupStage ... />
    <PipelineArrow id={`lk${i}`} result={previews[`lk${i}`]} onOpen={computePreview} />
  </div>
))}
// Same pattern for calcN and bandN
```

#### Stale Comment Fix

Replace line 12:
```
- * - Preview HTML builder is passed as a prop to PipelineArrow
```
With:
```
- * - Preview results are computed via buildPreview() and passed as a prop to PipelineArrow
```

---

### 3. `ui/sections/pipeline-arrow.tsx` — Modifications

#### New Props

```typescript
import type { PreviewResult } from '../../report/preview-builder.js';

export interface PipelineArrowProps {
  /** Unique ID for this arrow (e.g. "base", "lk0", "calc1"). */
  id: string;
  /** Precomputed preview result. Null/undefined shows placeholder. */
  result?: PreviewResult | null;
  /** Callback when preview is opened — triggers computation in parent. */
  onOpen?: (id: string) => void;
}
```

#### Toggle Handler

```typescript
const toggle = () => {
  const next = !open;
  setOpen(next);
  if (next) {
    _previewOpen.add(id);
    onOpen?.(id);  // Notify parent to compute preview
  } else {
    _previewOpen.delete(id);
  }
};
```

#### Rendering

Replace the stub placeholder with conditional rendering:

```tsx
{open && (
  <div class="pl-mini-preview">
    {!result ? (
      <em style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Loading...</em>
    ) : result.error ? (
      <em style={{ fontSize: '0.72rem', color: 'var(--red)' }}>
        Error: {result.error}
      </em>
    ) : result.rows.length === 0 ? (
      <em style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>No rows</em>
    ) : (
      <table>
        <thead>
          <tr>
            {result.headers.map(h => (
              <th key={h} title={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {result.headers.map(h => (
                <td key={h} title={String(row[h] ?? '')}>
                  {String(row[h] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
)}
```

The `result` prop is optional. When absent (e.g., during initial render before computation), shows "Loading...". When computation completes, shows the table or error.

---

## Constraints

1. **No `dangerouslySetInnerHTML`** — All rendering must be JSX (per AGENTS.md). The old implementation returned HTML strings; the new one returns structured data rendered as JSX `<table>`.

2. **No async operations** — Preview must be synchronous. `execQuery` is sync, `buildQueryPlan` is sync, `colUserLabel` is sync. No `await` anywhere in the preview path.

3. **No filters or sorts in preview** — Preview shows raw stage output. Filters and sorts are report-level concerns; preview is a "what does the data look like at this stage" tool.

4. **Band preview is raw child table** — No parent context is available during preview. Band preview shows `SELECT * FROM child-table LIMIT 5`, not a joined result. This is a known limitation.

5. **Stacks are UNIONed manually** — `buildDetailQuery` does not handle UNION ALL for stacked tables. Base preview must build the UNION ALL query manually (matching the old implementation).

6. **Sync column labels only** — Use `colUserLabel(tid, col)` for physical columns. Calculated columns use their alias. No async `colDisplayLabel`.

7. **LIMIT 5** — All previews are capped at 5 rows. This is a UI preview, not a data export.

8. **Pure builder function** — `buildPreview(key, state)` takes state as a parameter. No `getStore()` calls inside the builder. This makes it testable without store initialization.

---

## Open Questions

1. **Band preview usefulness** — Raw child table preview (without parent context) shows all rows from the child table, not just rows related to the current parent. Is this useful enough to implement, or should band previews show a "Configure key columns to see preview" message? **Decision: Implement raw preview.** It shows the user what data exists in the child table, which is informative even without parent context. Can be enhanced later.

2. **Preview cache granularity** — Currently, any state change clears all cached previews. Should we track dependencies per preview (e.g., "lk0" preview only depends on base + lookups[0]) and only invalidate affected previews? **Decision: No.** Simple invalidation (clear all) is correct and the performance impact is negligible for ≤16 previews of ≤5 rows each.

3. **Preview for disabled stages** — If a lookup or calc stage has `enabled: false`, should its arrow still show a preview? **Decision: Yes.** The preview spec builder (`buildPreviewReportSpec`) filters disabled lookups before slicing (matching `buildQueryPlan`'s own filtering at query-plan.ts:174), but the arrow's index still determines the slice point. A disabled lookup at index 2 still produces a preview showing what the data looks like with enabled lookups 0-2 applied. This matches user expectation — the arrow is visible, so the preview should work.

4. **ORDER BY stripping** — The old implementation used a regex to strip ORDER BY from generated SQL. Should we instead build a ReportSpec without sorts (which we already do) so ORDER BY is never generated? **Decision: The preview ReportSpec already has `sorts: []`, so `buildQueryPlan` should not generate ORDER BY.** However, as a safety measure, the preview builder should still strip any trailing ORDER BY before appending LIMIT 5, in case a future change introduces implicit sorting.

5. **Empty base table** — If `state.base` is empty string or `state.tables[state.base]` doesn't exist, `buildPreview("base", state)` returns an error. The "base" arrow is only rendered when `hasBase` is true (pipeline-card.tsx:173), so this case shouldn't occur in practice. But the error handling is there for safety.

---

## Implementation Plan

### Step 1: Create `report/preview-builder.ts`

**File:** `SRC/preact/report/preview-builder.ts`

- Define `PreviewResult` interface
- Implement `buildPreview(key, state)` with dispatch for base/lk/calc/band keys
- Implement pure helper variants: `buildColSourceMapForState()`, `colUserLabelForState()`
- Implement base preview: UNION ALL across base + stacks
- Implement lk/calc preview: `buildPreviewReportSpec(state, options)` → full ReportSpec → `buildQueryPlan` → strip ORDER BY → append LIMIT 5
- Implement band preview: raw `SELECT * FROM child-table LIMIT 5`
- Wrap all logic in try/catch returning structured errors

### Step 2: Modify `ui/sections/pipeline-arrow.tsx`

**File:** `SRC/preact/ui/sections/pipeline-arrow.tsx`

- Add `result?: PreviewResult | null` and `onOpen?: (id: string) => void` to props
- Call `onOpen?.(id)` when preview is opened
- Replace stub `<em>Preview not available yet</em>` with conditional rendering:
  - No result → "Loading..."
  - `result.error` → error message in red
  - `result.rows.length === 0` → "No rows"
  - Otherwise → JSX `<table>` with headers and rows

### Step 3: Modify `ui/cards/pipeline-card.tsx`

**File:** `SRC/preact/ui/cards/pipeline-card.tsx`

- Import `buildPreview` and `PreviewResult` from `report/preview-builder.js`
- Add `previews` state: `useState<Record<string, PreviewResult>>({})`
- Add `computePreview` callback that calls `buildPreview` and updates state
- Clear previews cache on store state change (in existing `useEffect` subscription)
- Pass `result={previews[id]}` and `onOpen={computePreview}` to each `<PipelineArrow>`
- Fix stale comment at line 12

### Step 4: Write tests for `preview-builder.ts`

**File:** `SRC/preact/tests/report/preview-builder.test.ts`

- Test base preview with single table
- Test base preview with stacked tables (UNION ALL)
- Test base preview with mismatched columns (NULL padding)
- Test lk0 preview with one lookup
- Test lk1 preview with two lookups (only first included)
- Test calc0 preview with one calculated column
- Test band0 preview with raw child table
- Test error handling: no base table, invalid key, SQL execution error
- Test column headers use sync labels
- Test LIMIT 5 is applied

### Step 5: Write tests for `pipeline-arrow.tsx`

**File:** `SRC/preact/tests/ui/pipeline-arrow.test.tsx`

- Test renders placeholder when no result prop
- Test renders table when result has rows
- Test renders error message when result has error
- Test renders "No rows" when result has empty rows
- Test calls onOpen when preview button is clicked
- Test toggle behavior (open/close)

### Step 6: Verify

- Run `npm run typecheck` — zero errors
- Run `npm run lint` — zero warnings
- Run `npm test` — all tests pass (existing + new)

---

## Appendix: Research Findings

### Old Implementation Analysis

The old `_buildPreviewSQL` (commit `46d15d7`, `SRC/js/ui/views/query-builder.tsx:144-172`):

```typescript
function _buildPreviewSQL(key: string): { sql: string; params: unknown[] } | null {
  const spec = {
    base: db.base, baseCols: db.baseCols, stacks: db.stacks, excludedRows: db.excludedRows,
    lookups: db.lookups, calcStages: db.calcStages, selCols: db.selCols, colOrder: db.colOrder,
    filters: [], sorts: [], groupBy: [], aggregates: [], aggMode: 'none',
    colTotals: {}, subtotalBy: [], subtotalFns: {},
  };
  if (key !== 'base') {
    const lkMatch = key.match(/^lk(\d+)$/);
    const calcMatch = key.match(/^calc(\d+)$/);
    if (!lkMatch && !calcMatch) return null;
    if (lkMatch) {
      const depth = +lkMatch[1];
      spec.lookups = (db.lookups || []).slice(0, depth + 1);
      spec.calcStages = [];
    } else {
      const depth = +calcMatch[1];
      spec.calcStages = (db.calcStages || []).slice(0, depth + 1);
    }
  }
  const srcCatalog = buildSourceCatalog();
  const colCatalog = buildColumnCatalog(spec, srcCatalog);
  const plan = buildQueryPlan(spec, colCatalog, null, srcCatalog);
  const result = renderDetailSql(plan);
  result.sql = result.sql.replace(/\s*(?:(?<!\()ORDER BY[^;]+)?$/, ' LIMIT 5');
  return result;
}
```

Key differences from new design:
- Old code used global `db` object; new code takes `state` parameter
- Old code called `renderDetailSql(plan)` which no longer exists; new code uses `plan.sql` directly
- Old code called `buildSourceCatalog()` and `buildColumnCatalog()` with different signatures; new code uses current API
- Old code had no band support (bands didn't exist)
- Old code used `colDisplayLabel` (async) for headers; new code uses `colUserLabel` (sync)

### CONTRACTS.md Mismatch

CONTRACTS.md line 424 declares:
```
PipelineArrow | { id: string; buildPreviewHTML: (id: string) => string } | JSX arrow connector with preview toggle
```

Actual code at `pipeline-arrow.tsx:13-16`:
```typescript
export interface PipelineArrowProps {
  id: string;
}
```

This DD supersedes the old contract. The new contract is:
```
PipelineArrow | { id: string; result?: PreviewResult | null; onOpen?: (id: string) => void } | JSX arrow connector with preview toggle
```

### Why `buildQueryPlan` Works for Preview

`buildQueryPlan(reportSpec, tables)` is a pure function that:
1. Builds source catalog from tables
2. Builds column catalog from reportSpec + source catalog
3. Resolves lookups
4. Generates calc expressions
5. Dispatches to `buildDetailQuery` when `aggMode === 'none'`
6. Returns `{ sql, params, cols }` in the `BuiltQueryPlan`

Since preview always uses `aggMode: 'none'`, `buildQueryPlan` always dispatches to `buildDetailQuery`, producing a clean SELECT with JOINs but no aggregation. This is exactly what preview needs.

### Why Not Reuse `runReport` from `engine.ts`

`runReport(reportSpec, tables)` returns a full `ResultSet` with metadata, row typing, and band stitching. Preview doesn't need any of that — it just needs raw rows and column names. Using `buildQueryPlan` + `execQuery` directly is simpler and avoids unnecessary overhead.

### Test Infrastructure

Existing test patterns (from `engine.test.ts`, `pipeline-card-reorder.test.ts`):
- `initStore()` in `beforeEach` for fresh store
- `makeReportSpec()` helper from `tests/query/helpers.ts` for ReportSpec construction
- Standard table fixtures (Orders, Contacts) defined in helper functions
- `insertRows()` from `core/sqldb.ts` for populating test data
- Vitest with jsdom environment
