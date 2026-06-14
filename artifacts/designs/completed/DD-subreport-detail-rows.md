# Subreport Detail Rows — Design Document

**Status:** Draft  
**Author:** R&D  
**Created:** 2026-06-13  

**Related Documents:**
- [ResultSet interface](preact/report/result-set.ts) — ResultSet interface — homogeneous columns/rows/metadata structure that detail bands must preserve
- [Report execution engine](preact/report/engine.ts) — Report execution engine — runTotalsMode stitching pattern to follow, mode dispatch switch to extend
- [Query plan builder](preact/query/query-plan.ts) — Query plan builder — 11-step pipeline with mode dispatch switch at lines 229-260
- [SQL subtotals query generation](preact/query/sql-subtotals.ts) — SQL subtotals — UNION ALL with _row_type band tagging (reference pattern)
- [SQL JOIN clause generation](preact/query/sql-joins.ts) — SQL JOIN clause generation — key pair matching and ON clause building (reference for key matching)
- [LookupStage UI component](preact/ui/sections/lookup-stage.tsx) — Lookup stage UI — 275-line component that serves as the template for DetailBandStage
- [Export logic](preact/ui/export.ts) — Export system — row-kind-aware styling, merge handling, column filtering to extend
- [Column catalog](preact/catalog/column-catalog.ts) — Column catalog — colMap builder with tablePrefix() collision handling to extend with band prefix
- [State serializer](preact/core/state-serializer.ts) — State serializer — buildPayload() must add detailBands serialization
- [State hydrator](preact/core/state-hydrator.ts) — State hydrator — hydrateState() must add detailBands hydration with reference validation
- [Type definitions](preact/types.ts) — AppState and ReportSpec interfaces — must add detailBands and detailBandMode fields
- [Pipeline card](preact/ui/cards/pipeline-card.tsx) — Pipeline card — stage composition where DetailBandStage will be added
- [Report validation](preact/report/validation.ts) — Report validation — deriveValidation() must add detail band validation items
- [Report output publishing](preact/report/report-output.ts) — Published output — createResultTable() must handle _band_id in row filtering
- [AG Grid integration](preact/ui/grid.tsx) — AG Grid integration — ResultGrid component that will render band rows
- [State schema version](preact/core/state-schema.ts) — State schema — STATE_VERSION bump and RECOGNIZABLE_KEYS update
- [State defaults](preact/core/state.ts) — Default state factories — createAppState() and createReportSpec() must add band defaults
- [Column alias resolution](preact/query/resolve-ref.ts) — Column alias resolution — resolveRef() works unchanged for band colMap entries
- [Barrel exports](preact/index.ts) — Public API surface — must add DetailBandSpec, buildBandQuery, BandQueryResult, DetailBandStage, createDetailBandSpec exports
- [Run bar](preact/ui/sections/run-bar.tsx) — Report execution trigger — runQuery callback constructs ReportSpec from AppState; must include detailBands and detailBandMode
- [Report dependency graph](preact/report/report-graph.ts) — Cross-report dependency tracking — buildReportGraph() must include detailBands[].rightId in dependency refs
- [Alias ref updater](preact/query/alias-ref-updater.ts) — Column rename propagation — _renameProjectedAliasRefs() must update detailBands[].keyPairs[].left and detailBands[].cols
- [Grid column filter](preact/ui/grid.tsx) — AG Grid column definitions — makeResultCols() must filter _band_id from visible columns
- [Merge toggles](preact/ui/sections/merge-toggles.tsx) — Merge column display — must filter _band_id from display columns
- [Column chips](preact/ui/sections/column-chips.tsx) — Column selection UI — 7 sites construct partial ReportSpec; must include detailBands or use shared helper
- [Sort list](preact/ui/sections/sort-list.tsx) — Sort configuration — constructs partial ReportSpec at line 92
- [Filter list](preact/ui/sections/filter-list.tsx) — Filter configuration — constructs partial ReportSpec at line 161
- [Layout card](preact/ui/cards/layout-card.tsx) — Output layout — constructs partial ReportSpec at line 301
- [Calc stage](preact/ui/sections/calc-stage.tsx) — Calculated columns — constructs partial ReportSpec at lines 48 and 287
- [Lookup stage](preact/ui/sections/lookup-stage.tsx) — Lookup configuration — constructs partial ReportSpec at line 73

---

## Scope

This feature adds "detail bands" (also called "related details" or "subreport detail rows") to the tableflip report engine. A detail band is a 1:N relationship from the parent report's rows to a child table — for each parent row, zero or more child rows are displayed beneath it. Multiple bands can be configured per report, with two display modes: interleaved (each parent row followed by its children from each band) or stacked (Cartesian cross-product of children across bands). The feature touches all five layers: new types in Core, column catalog extensions in Catalog, a new query builder in Query, a new execution mode in Report, and new UI components plus export enhancements in UI.

---

## Problem Statement

Reports in tableflip currently produce flat, homogeneous result sets — every row has the same columns from the same tables. Users who need to show 1:N related data (e.g., an order with its line items, a customer with their orders) must either:

1. Use lookups, which pull columns horizontally but cannot represent multiple child rows per parent
2. Create separate reports for parent and child data, manually correlating them offline
3. Stack child data via UNION ALL, which requires identical schemas

There is no way to produce a report where each parent row is followed by its related child rows from a different table — the "subreport" or "detail band" pattern common in reporting tools like Crystal Reports, SSRS, and Jaspersoft.

**Who has this problem**: Anyone building operational reports that combine a summary view with detailed transactional data. Examples: sales orders with line items, invoices with payment history, employees with certifications, projects with milestones.

---

## Architecture

## Architecture Overview

### Data Flow

```
User configures DetailBandSpec[] in UI
        │
        ▼
PipelineCard renders DetailBandStage per band
        │
        ▼
runReport() dispatches to runDetailBandsMode()
        │
        ├── 1. Run parent query (existing detail/totals/subtotals SQL)
        │       → parentRows: Record<string, unknown>[]
        │       → parentCols: string[]
        │
        ├── 2. Extract parent key values from parentRows
        │       → keyValues: Set<unknown> (deduplicated)
        │
        ├── 3. For each DetailBandSpec:
        │       ├── Build band query:
        │       │   SELECT band_cols FROM band_table
        │       │   WHERE child_key IN (?, ?, ...)
        │       │   [ORDER BY band_sorts]
        │       ├── Execute with batched key params
        │       └── Tag rows with _band_id
        │
        ├── 4. Stitch in JS:
        │       ├── Compute superset columns (parent ∪ all band cols)
        │       ├── Null-pad parent rows for band columns
        │       ├── Null-pad band rows for parent/non-band columns
        │       ├── Interleave: for each parent row, insert its band rows
        │       └── (Stacking mode) Cross-product variant
        │
        └── 5. Return ResultSet with superset columns + _band_id
```

### Layer Mapping

| Component | Layer | File | Responsibility |
|-----------|-------|------|----------------|
| `DetailBandSpec` type | types.ts | `preact/types.ts` | Interface definition for band configuration |
| `state.detailBands` | Core (state) | `preact/core/state.ts` | Default state factory with empty detailBands array |
| `buildPayload()` extension | Core (serialization) | `preact/core/state-serializer.ts` | Serialize detailBands to .rcjson |
| `hydrateState()` extension | Core (hydration) | `preact/core/state-hydrator.ts` | Hydrate detailBands from .rcjson with reference validation |
| `buildColumnCatalog()` extension | Catalog | `preact/catalog/column-catalog.ts` | Add band columns to colMap with band prefix |
| `buildBandQuery()` | Query | `preact/query/sql-detail-bands.ts` (new) | Generate per-band SQL with WHERE IN |
| `runDetailBandsMode()` | Report | `preact/report/engine.ts` (extended) | Orchestrate parent query + band queries + JS stitching |
| `buildResultSet()` extension | Report | `preact/report/result-set.ts` | Metadata extension for bandCount, bandIds |
| `DetailBandStage` | UI | `preact/ui/sections/detail-band-stage.tsx` (new) | Pipeline stage component for band configuration |
| `PipelineCard` extension | UI | `preact/ui/cards/pipeline-card.tsx` | Render DetailBandStage instances + add button |
| `exportAs()` extension | UI | `preact/ui/export.ts` | Band-aware export with section headers |
| `deriveValidation()` extension | Report | `preact/report/validation.ts` | Validate band specs (table exists, keys valid, cols available) |
| `createResultTable()` extension | Report | `preact/report/report-output.ts` | Handle _band_id in published output |
| `ResultGrid` extension | UI | `preact/ui/grid.tsx` | Band-aware row styling (optional, phase 4); filter `_band_id` from visible columns |
| `index.ts` barrel exports | All | `preact/index.ts` | Re-export `DetailBandSpec`, `buildBandQuery`, `BandQueryResult`, `DetailBandStage`, `createDetailBandSpec` |
| `runQuery` ReportSpec | UI → Report | `preact/ui/sections/run-bar.tsx` | Map `detailBands` and `detailBandMode` into ReportSpec from AppState |
| `buildReportGraph` refs | Report | `preact/report/report-graph.ts` | Include `pipeline.detailBands[].rightId` in dependency edge refs |
| `_renameProjectedAliasRefs` extension | Query | `preact/query/alias-ref-updater.ts` | Propagate column renames into `detailBands[].keyPairs[].left` and `detailBands[].cols` |
| `makeResultCols` filter | UI | `preact/ui/grid.tsx` | Add `_band_id` to internal-column filter alongside `_rowno`, `_row_type`, `_isTotalsRow` |
| `MergeToggles` filter | UI | `preact/ui/sections/merge-toggles.tsx` | Add `_band_id` to display-column filter |
| `buildReportSpecFromState` helper | UI (shared) | `preact/core/state.ts` (or new `preact/ui/report-spec-helper.ts`) | Single function to build complete ReportSpec from AppState, used by 8+ UI components |

### Dependency Direction (validated)

All dependencies flow downward:
- UI → Report → Query → Catalog → Core (no upward imports)
- `runDetailBandsMode()` calls `buildBandQuery()` (Report → Query) ✓
- `buildBandQuery()` calls `quoteId()` (Query → Core) ✓
- `DetailBandStage` calls `getStore()` (UI → Core) ✓
- `DetailBandStage` calls `buildColSourceMap()` (UI → Catalog) ✓
- `DetailBandStage` calls `getValidation()` (UI → Report) ✓

### Stitching Algorithm (detail)

```
function runDetailBandsMode(plan, reportSpec, tables):
  // 1. Execute parent query
  parentRows = execQuery(plan.sql, plan.params)
  parentCols = plan.cols

  // 2. For each band, build and execute query
  bandResults = []
  allBandCols = []
  for each band in reportSpec.detailBands:
    if !band.enabled: continue

    // Extract parent key values
    keyValues = new Set()
    for row in parentRows:
      keyValues.add(row[band.parentKey])

    if keyValues.size == 0: continue

    // Build band query
    bandQuery = buildBandQuery(band, keyValues, tables)

    // Execute
    bandRows = execQuery(bandQuery.sql, bandQuery.params)

    // Tag with _band_id
    for row in bandRows:
      row._band_id = band.id

    bandResults.push({ band, rows: bandRows, cols: bandQuery.cols })
    allBandCols.push(...bandQuery.cols)

  // 3. Compute superset columns
  supersetCols = [...parentCols]
  for col in allBandCols:
    if !supersetCols.includes(col):
      supersetCols.push(col)
  supersetCols.push('_band_id')

  // 4. Null-pad parent rows
  paddedParent = parentRows.map(row => {
    padded = { ...row }
    for col in allBandCols:
      if !(col in padded): padded[col] = null
    padded._band_id = null
    return padded
  })

  // 5. Null-pad band rows
  paddedBands = bandResults.map(({ band, rows, cols }) => {
    return rows.map(row => {
      padded = {}
      for col in supersetCols:
        padded[col] = col in row ? row[col] : null
      padded._band_id = band.id
      return padded
    })
  })

  // 6. Interleave (multi-band mode)
  resultRows = []
  for each parentRow in paddedParent:
    resultRows.push(parentRow)
    for each bandResult in paddedBands:
      bandRows = bandResult.filter(r => r[band.childKey] == parentRow[band.parentKey])
      resultRows.push(...bandRows)

  // 7. Build result set
  return buildResultSet(supersetCols, resultRows, {
    aggMode: plan.aggMode,
    bandCount: bandResults.length,
    bandIds: bandResults.map(b => b.band.id),
  })
```

### Stacking Mode Variant

In stacking mode, the cross-product is computed differently:

```
  // Instead of interleaving per-parent-row:
  // Each band's rows are repeated for every parent row (Cartesian product)
  // Capped at 10,000 total rows

  resultRows = []
  for each parentRow in paddedParent:
    for each bandResult in paddedBands:
      for each bandRow in bandResult:
        merged = { ...parentRow, ...bandRow, _band_id: band.id }
        resultRows.push(merged)
        if resultRows.length > STACK_LIMIT: throw rowExplosionError()
```

---

## Design Goals

1. **Intuitive UX**: Users configure detail bands through a familiar pipeline stage — same interaction patterns as lookups (table picker, key pair matching, column chips). The UI label "Related Details" matches existing vocabulary ("Include rows from" for stacks, "Look up" for joins).
2. **Explicit stacking choice**: When multiple detail bands are configured, users choose between "Separate bands" (interleaved under each parent row) and "Stack side-by-side" (Cartesian cross-product). This is an explicit toggle per report, not an implicit behavior.
3. **Export flexibility**: Export produces a single sheet with visually distinct band sections (v1), with a clear path to multi-sheet export (v2). Band section headers are styled differently from data rows.
4. **No silent explosions**: Row count explosion from cross-products is caught before execution. A configurable hard limit (default 10,000 rows for stacking mode) with an explicit override prevents runaway queries.

---

## Constraints

1. Five-layer architecture boundaries must be respected — no upward imports (UI code in query layer, etc.)
2. SQL identifiers must use `quoteId()` from `sqldb.ts` — never concatenate raw strings into SQL
3. `invalidateValidation()` must be called after any state mutation that affects validation
4. `window`/`document` access must be guarded with `typeof window !== 'undefined'`
5. Vendored CJS modules require `// @ts-expect-error - vendored CJS module` before `import()`
6. No `dangerouslySetInnerHTML` — use Preact components with JSX
7. Tests use Vitest with jsdom environment, fresh SQLite DB per test via `vitest-setup.ts`
8. STATE_VERSION must be bumped when .rcjson format changes
9. Existing `_row_type` consumers (6 total) must not break — additive changes only
10. `hydrateState()` takes `loadedTables` as `Record<string, DbTable>`, not `string[]`
11. Calc columns in detail queries have a known bug (log L34) — detail bands should not depend on calc columns until this is fixed

---

## Requirements

## 3. Requirements

### Functional Requirements

1. **FR-1: Detail Band Configuration** — Users can add one or more "Related Details" bands to a report. Each band specifies:
   - A child table (from loaded tables)
   - Key pairs mapping parent columns to child columns (1:N relationship)
   - Selected columns from the child table
   - An enabled/disabled toggle
   - An optional sort order for child rows

2. **FR-2: Multi-Band Modes** — When multiple bands are configured, users choose between:
   - **Separate bands** (default): Each parent row is followed by its matching child rows from each band, interleaved sequentially
   - **Stack side-by-side**: Child rows from all bands are cross-joined per parent row (Cartesian product), capped at a configurable limit

3. **FR-3: Result Set Shape** — The result set preserves the homogeneous `ResultSet` contract:
   - Single `columns` array (superset of parent + all band columns)
   - All rows have the same keys, with `null` for inapplicable columns
   - A `_band_id` column tags each row with its source band (null for parent rows)

4. **FR-4: Export** — Export produces:
   - **v1**: Single XLSX/CSV sheet with band section headers styled distinctly
   - **v2** (future): Optional multi-sheet export (one sheet per band + parent summary)

5. **FR-5: Row Explosion Protection** — Stacking mode enforces a hard row limit (default 10,000). If the cross-product exceeds the limit, execution halts with a clear error message and an override option.

6. **FR-6: Validation** — Each detail band is validated independently:
   - Child table must be loaded
   - Key pairs must reference valid columns on both sides
   - At least one complete key pair must exist
   - Selected columns must exist in the child table

### Non-Functional Requirements

7. **NFR-1: Performance** — Band queries use batched `WHERE IN` (one query per band, not one per parent row). Typical reports with 1-3 bands and <5,000 parent rows should complete in <2 seconds.

8. **NFR-2: Backward Compatibility** — Existing `.rcjson` files without `detailBands` must load without error. The `detailBands` field defaults to `[]` when absent.

9. **NFR-3: Test Coverage** — All new public functions must have unit tests. Target: 80% line coverage on new files (`sql-detail-bands.ts`, `detail-band-stage.tsx`). The existing 0% coverage on engine functions must not regress.

10. **NFR-4: No Regression** — Existing `_row_type` consumers (export styling, grid rendering, published output filtering) must continue to work unchanged. The `_band_id` column is additive.

---

## Data Model

## 6. Data Model

### DetailBandSpec Interface

New type in `preact/types.ts`:

```typescript
/**
 * Defines a detail band — a 1:N child table that produces sub-rows
 * under each parent row. Modeled on LookupSpec but produces vertical
 * fan-out instead of horizontal column extension.
 *
 * @property id - Unique band identifier (generated on creation, e.g. "band_0")
 * @property rightId - Child table ID
 * @property keyPairs - Parent→child column mappings (left=parent alias, right=child column)
 * @property cols - Columns to include from the child table
 * @property enabled - Whether this band is active in the pipeline
 * @property sorts - Sort specifications for child rows within each band
 * @property label - User-visible band label for section headers (defaults to table name)
 */
export interface DetailBandSpec {
  id: string;
  rightId: string;
  keyPairs: Array<{ left: string; right: string }>;
  cols: string[];
  enabled: boolean;
  sorts: Array<{ col: string; dir: 'ASC' | 'DESC'; enabled: boolean }>;
  label: string;
}
```

### State Shape Changes

**AppState** (`types.ts:139-170`) — add one field:

```typescript
export interface AppState {
  // ... existing fields ...
  detailBands: DetailBandSpec[];   // NEW: detail band configurations
  detailBandMode: 'separate' | 'stack';  // NEW: multi-band mode
}
```

**ReportSpec** (`types.ts:186-221`) — add to `pipeline`:

```typescript
export interface ReportSpec {
  // ... existing fields ...
  pipeline: {
    // ... existing fields ...
    detailBands: DetailBandSpec[];  // NEW
  };
  detailBandMode: 'separate' | 'stack';  // NEW: at report level
}
```

**createAppState()** (`core/state.ts`) — add defaults:

```typescript
detailBands: [],
detailBandMode: 'separate',
```

**createDetailBandSpec()** (`core/state.ts`) — new factory function:

```typescript
/**
 * Create a default DetailBandSpec with sensible defaults.
 * Called when the user adds a new detail band in the UI.
 */
export function createDetailBandSpec(): DetailBandSpec {
  return {
    id: `band_${Date.now()}`,
    rightId: '',
    keyPairs: [{ left: '', right: '' }],
    cols: [],
    enabled: true,
    sorts: [],
    label: '',
  };
}
```

**createReportSpec()** (`core/state.ts`) — add to pipeline defaults:

```typescript
pipeline: {
  // ... existing ...
  detailBands: [],
},
detailBandMode: 'separate',
```

### ResultSet Extensions

**ResultSetMetadata** (`result-set.ts:22-30`) — add optional fields:

```typescript
export interface ResultSetMetadata {
  // ... existing fields ...
  bandCount?: number;       // NEW: number of active detail bands
  bandIds?: string[];       // NEW: ordered band IDs in the result
  bandLabels?: Record<string, string>;  // NEW: band ID → label map
}
```

**Row shape** — every row gains an optional `_band_id` field:

```typescript
// Parent row:
{ col1: 'a', col2: 'b', ..., _band_id: null }

// Band row:
{ col1: null, col2: null, ..., bandCol1: 'x', bandCol2: 'y', ..., _band_id: 'band_0' }
```

### Serialization Format

In `.rcjson`, `detailBands` serializes as:

```json
{
  "detailBands": [
    {
      "id": "band_0",
      "rightId": "table-abc-123",
      "keyPairs": [{ "left": "OrderID", "right": "OrderID" }],
      "cols": ["ProductName", "Quantity", "UnitPrice"],
      "enabled": true,
      "sorts": [{ "col": "ProductName", "dir": "ASC", "enabled": true }],
      "label": "Line Items"
    }
  ],
  "detailBandMode": "separate"
}
```

### Column Catalog Extension

Band columns are added to the global `colMap` with a band-specific prefix (following the lookup pattern from `column-catalog.ts:140-157`):

```typescript
// In buildColumnCatalog(), after lookup columns:
for (const band of detailBands) {
  if (band.enabled === false || !band.rightId) continue;
  const rtCols = tableColumns(band.rightId);
  if (!rtCols) continue;
  const rName = tableName(band.rightId);
  const prefix = `_${band.id}_`;
  for (const c of (band.cols || rtCols)) {
    const alias = prefix + c;
    if (!colMap.has(alias)) {
      colMap.set(alias, { tid: band.rightId, col: c });
    }
  }
}
```

This ensures band columns never collide with parent or lookup columns, and the `resolveRef()` function works unchanged because band entries are standard `PhysicalColEntry` objects.

---

## Query Generation

## 7. Query Generation

### Strategy: Batched WHERE IN

For each enabled detail band, the system generates a single SQL query that fetches all child rows for all parent keys at once, rather than one query per parent row.

**Example**: Parent report has 1,500 orders. Band "Line Items" joins on `OrderID`.

❌ Naive: 1,500 queries (`SELECT ... FROM line_items WHERE OrderID = ?`)
✅ Batched: 1 query (`SELECT ... FROM line_items WHERE OrderID IN (?, ?, ..., ?)`)

### buildBandQuery() — New Module

New file: `preact/query/sql-detail-bands.ts`

```typescript
import type { DetailBandSpec } from '../types';
import type { ColMapEntry } from '../catalog/column-catalog';
import type { SourceTableEntry } from '../catalog/source-catalog';
import { quoteId } from '../core/sqldb';

export interface BandQueryResult {
  sql: string;
  params: unknown[];
  cols: string[];          // Band column aliases (with prefix)
  parentKeyAlias: string;  // Parent-side key column alias
  childKeyCol: string;     // Child-side key column name
}

/**
 * Build a batched query for a single detail band.
 *
 * Generates: SELECT child_cols FROM child_table
 *            WHERE child_key IN (?, ?, ...)
 *            [ORDER BY sort_cols]
 *
 * @param band - The detail band specification
 * @param parentKeyValues - Deduplicated set of parent key values
 * @param bandColMap - Column map entries for this band's columns
 * @param sourceCatalog - Table metadata catalog
 * @returns BandQueryResult with SQL, params, and column metadata
 */
export function buildBandQuery(
  band: DetailBandSpec,
  parentKeyValues: Set<unknown>,
  bandColMap: Map<string, ColMapEntry>,
  sourceCatalog: Map<string, SourceTableEntry>,
): BandQueryResult {
  const childTable = quoteId(band.rightId);

  // SELECT clause — band columns with their aliases
  const selParts: string[] = [];
  const cols: string[] = [];
  for (const [alias, entry] of bandColMap) {
    if (entry.kind === 'calc') continue;  // No calc support in v1
    selParts.push(`${childTable}.${quoteId(entry.col)} AS ${quoteId(alias)}`);
    cols.push(alias);
  }

  // Also select the child key column (for JS-side parent matching)
  const childKeyCol = band.keyPairs[0].right;
  selParts.push(`${childTable}.${quoteId(childKeyCol)} AS ${quoteId(childKeyCol)}`);

  // WHERE clause — batched IN
  const placeholders = Array.from(parentKeyValues).map(() => '?').join(', ');
  const whereClause = `${childTable}.${quoteId(childKeyCol)} IN (${placeholders})`;

  // ORDER BY clause
  const sortParts = (band.sorts || [])
    .filter(s => s.enabled !== false && s.col)
    .map(s => `${childTable}.${quoteId(s.col)} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`);

  let sql = `SELECT ${selParts.join(', ')}\nFROM ${childTable}\nWHERE ${whereClause}`;
  if (sortParts.length) sql += `\nORDER BY ${sortParts.join(', ')}`;

  const params = Array.from(parentKeyValues);

  return {
    sql,
    params,
    cols,
    parentKeyAlias: band.keyPairs[0].left,
    childKeyCol,
  };
}
```

### Multi-Key Support

For bands with multiple key pairs (composite keys), the WHERE clause uses concatenation:

```sql
WHERE (child_key1 || '|||' || child_key2) IN ('val1|||val2', 'val3|||val4', ...)
```

This follows the pattern used in `sql-joins.ts:79-84` for multi-pair ON conditions, adapted for IN semantics. The `|||` separator is chosen to be unlikely in real data.

### Parameter Management

Each band query has its own parameter array (the key values for the IN clause). Parameters are NOT shared across bands — each band query is independent. The engine collects them per-band during execution.

### Stacking Mode Query

In stacking mode, each band query is identical to separate mode. The difference is entirely in the JS stitching phase — the cross-product is computed in JavaScript, not SQL. This keeps the query layer simple and mode-agnostic.

---

## Result Set Construction

## 8. Result Set Construction

### Superset Column Computation

The result set columns are the union of parent columns and all active band columns, plus `_band_id`:

```typescript
function computeSupersetCols(
  parentCols: string[],
  bandResults: Array<{ cols: string[] }>,
): string[] {
  const superset = [...parentCols];
  const seen = new Set(parentCols);
  for (const br of bandResults) {
    for (const col of br.cols) {
      if (!seen.has(col)) {
        superset.push(col);
        seen.add(col);
      }
    }
  }
  superset.push('_band_id');
  return superset;
}
```

Because band columns use the `_{bandId}_` prefix from the column catalog, collisions with parent columns are structurally impossible. The superset computation is a straightforward union.

### Null Padding

**Parent rows**: All band-specific columns are set to `null`. `_band_id` is `null`.

```typescript
function padParentRow(
  row: Record<string, unknown>,
  supersetCols: string[],
): Record<string, unknown> {
  const padded = { ...row };
  for (const col of supersetCols) {
    if (!(col in padded)) padded[col] = null;
  }
  padded._band_id = null;
  return padded;
}
```

**Band rows**: All parent columns and other bands' columns are set to `null`.

```typescript
function padBandRow(
  row: Record<string, unknown>,
  bandCols: string[],
  supersetCols: string[],
  bandId: string,
): Record<string, unknown> {
  const padded: Record<string, unknown> = {};
  for (const col of supersetCols) {
    padded[col] = col in row ? row[col] : null;
  }
  padded._band_id = bandId;
  return padded;
}
```

### Row Interleaving (Separate Bands Mode)

For each parent row, matching child rows from each band are inserted immediately after:

```
Parent Row 1
  ├─ Band 0: Child Row A (matches parent key)
  ├─ Band 0: Child Row B (matches parent key)
  └─ Band 1: Child Row X (matches parent key)
Parent Row 2
  └─ Band 0: Child Row C (matches parent key)
Parent Row 3
  ├─ Band 0: Child Row D
  ├─ Band 1: Child Row Y
  └─ Band 1: Child Row Z
```

The matching is done in JS using a Map for O(1) lookup:

```typescript
function interleaveRows(
  parentRows: Record<string, unknown>[],
  bandResults: BandResult[],
  supersetCols: string[],
): Record<string, unknown>[] {
  // Index band rows by parent key value
  const bandIndex = new Map<string, Map<unknown, Record<string, unknown>[]>>();
  for (const br of bandResults) {
    const idx = new Map<unknown, Record<string, unknown>[]>();
    for (const row of br.rows) {
      const key = row[br.childKeyCol];
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key)!.push(row);
    }
    bandIndex.set(br.band.id, idx);
  }

  const result: Record<string, unknown>[] = [];
  for (const parentRow of parentRows) {
    result.push(padParentRow(parentRow, supersetCols));
    for (const br of bandResults) {
      const key = parentRow[br.parentKeyAlias];
      const children = bandIndex.get(br.band.id)?.get(key) || [];
      for (const child of children) {
        result.push(padBandRow(child, br.cols, supersetCols, br.band.id));
      }
    }
  }
  return result;
}
```

### Cross-Product (Stacking Mode)

In stacking mode, each parent row is combined with every combination of band rows:

```
Parent Row 1 × Band 0 Row A × Band 1 Row X
Parent Row 1 × Band 0 Row A × Band 1 Row Y
Parent Row 1 × Band 0 Row B × Band 1 Row X
Parent Row 1 × Band 0 Row B × Band 1 Row Y
```

**Row explosion protection**: The cross-product is capped at `STACK_ROW_LIMIT` (default 10,000). If the limit is exceeded, execution throws a `RowExplosionError` with the projected count.

```typescript
const STACK_ROW_LIMIT = 10_000;

function crossProductRows(
  parentRow: Record<string, unknown>,
  bandResults: BandResult[],
): Record<string, unknown>[] {
  // Start with [parentRow]
  let combinations = [parentRow];
  for (const br of bandResults) {
    const key = parentRow[br.parentKeyAlias];
    const children = br.rows.filter(r => r[br.childKeyCol] === key);
    if (children.length === 0) continue;
    const next: Record<string, unknown>[] = [];
    for (const combo of combinations) {
      for (const child of children) {
        next.push({ ...combo, ...child, _band_id: br.band.id });
      }
    }
    if (next.length > STACK_ROW_LIMIT) {
      throw new RowExplosionError(next.length, STACK_ROW_LIMIT);
    }
    combinations = next;
  }
  return combinations;
}
```

### Interaction with Existing _row_type

Detail band rows have `_row_type = 0` (detail) and `_band_id = 'band_N'`. This means:

- **Export**: Band rows are treated as detail rows by default. Section header styling is added via `_band_id` detection in phase 3.
- **Published output**: `createResultTable()` filters `_row_type != 0` — band rows pass through correctly.
- **AG Grid**: Band rows render as normal data rows. Null cells show as empty (existing `cellRenderer` handles `null → ''`).

---

## Export Design

## 9. Export Design

### Phase 1: Single Sheet with Section Headers

Band rows are included in the same sheet as parent rows. The `_band_id` column is used to detect band transitions and insert visual section headers.

**Column filtering**: `_band_id` is added to the export column filter list alongside `_rowno`, `_row_type`, etc. (`export.ts:46-52`).

**Section header rows**: When `_band_id` changes from one row to the next (or from `null` to a band ID), a section header row is inserted:

```typescript
// In exportAs(), after building clean rows:
const enrichedRows = [];
let prevBandId = undefined;
for (const row of dataRows) {
  const bandId = row._band_id;
  if (bandId && bandId !== prevBandId) {
    // Insert section header row
    const headerRow = {};
    for (const col of exportCols) headerRow[col] = '';
    headerRow[exportHeaders[0]] = bandLabels[bandId] || bandId;
    headerRow._isBandHeader = true;
    enrichedRows.push(headerRow);
  }
  enrichedRows.push(row);
  prevBandId = bandId;
}
```

**Styling**: Section header rows get distinct styling in `styleExportSheet()`:

```typescript
// New row kind for band headers
if (r._isBandHeader) {
  cell.s = {
    font: { ...fontBase, bold: true, italic: true, color: { rgb: 'FF1E40AF' } },
    fill: { fgColor: { rgb: 'FFDBEAFE' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { bottom: { style: 'thin', color: borderColor } },
  };
}
```

**Row kind extension**: The `rowKinds` array (`export.ts:70-74`) gains a new value:

```typescript
const rowKinds = dataRows.map(r => {
  if (r._isBandHeader) return 4;  // NEW: band header
  if (r._isTotalsRow) return 3;
  const t = Number(r._row_type);
  return Number.isFinite(t) ? t : 0;
});
```

Existing styling code handles kinds 0-3. Kind 4 is handled by the new band header branch.

### Phase 2: Multi-Sheet Export (future)

Each band gets its own sheet. The parent summary is repeated as the first sheet. This is a pure addition to `exportAs()` — no changes to the stitching or query layers.

### CSV Export

CSV export includes `_band_id` as a regular column (not filtered). Section headers are not inserted in CSV mode — the `_band_id` column provides the grouping information for downstream consumers.

---

## UI Design

## 10. UI Design

### DetailBandStage Component

New file: `preact/ui/sections/detail-band-stage.tsx`

Modeled on `LookupStage` (`lookup-stage.tsx:47-321`) with these differences:

| LookupStage | DetailBandStage |
|-------------|----------------|
| "Look up columns from" | "Related Details from" |
| Horizontal join (adds columns) | Vertical fan-out (adds rows) |
| "If no match: Leave blank / Skip row" | "If no match: Show parent only" (always) |
| "Duplicate keys: Block / Combine" | Not applicable (1:N is expected) |
| Key pairs: left=parent col, right=lookup col | Key pairs: left=parent col, right=child col |
| Column chips from right table | Column chips from child table |
| No sort config | Sort config for child row ordering |
| No label | Band label (defaults to table name) |

**Component structure** (following LookupStage pattern):

```tsx
export interface DetailBandStageProps {
  i: number;                    // Index in detailBands array
  sortedIds: string[];          // All table IDs sorted by name
  usedAsLookup: Set<string>;    // Tables already used as lookups
  usedAsStack: Set<string>;     // Tables already used as stacks
  usedAsBase: string;           // Base table ID (excluded from band table picker)
}

export function DetailBandStage({ i, sortedIds, usedAsLookup, usedAsStack, usedAsBase }: DetailBandStageProps) {
  // State subscription (same pattern as LookupStage)
  const [state, setState] = useState<AppState>(getStore().getState());
  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const band = state.detailBands[i];
  if (!band) return null;

  // ... table picker, key pair config, column chips, sort config, enable/disable, remove
}
```

**Key UI elements**:

1. **Stage label**: `"Related Details from" [tooltip]` with enable/disable toggle
2. **Table picker**: `<select>` filtered to exclude base, stack, and already-used band tables
3. **Key pair config**: Same as LookupStage — "Where [parent col] = [child col]" with "+ AND" for multi-key
4. **Column chips**: Same chip toggle pattern as LookupStage, with All/None buttons
5. **Sort config**: NEW — simple sort list (column + direction) for child row ordering
6. **Band label**: Text input for the section header label (defaults to table name)
7. **Remove button**: Same as LookupStage

### PipelineCard Integration

In `pipeline-card.tsx`, add after calc stages:

```tsx
{/* Detail band stages */}
{(state.detailBands || []).map((_band, i) => (
  <div key={`band-${i}`}>
    <DetailBandStage
      i={i}
      sortedIds={sortedIds}
      usedAsLookup={usedAsLookup}
      usedAsStack={usedAsStack}
      usedAsBase={base}
    />
    <PipelineArrow id={`band${i}`} />
  </div>
))}

{/* Add button */}
{hasBase && (
  <div class="pl-add-btn" onClick={addDetailBand}>
    {'＋'} Add related details from another sheet
  </div>
)}
```

### Mode Toggle

When 2+ bands are configured, a mode toggle appears above the band stages:

```tsx
{state.detailBands.filter(b => b.enabled !== false).length >= 2 && (
  <div class="pl-band-mode-toggle">
    <span>Multiple bands:</span>
    <label>
      <input type="radio" name="bandMode" value="separate"
        checked={state.detailBandMode === 'separate'}
        onChange={() => setBandMode('separate')} />
      Separate bands (under each row)
    </label>
    <label>
      <input type="radio" name="bandMode" value="stack"
        checked={state.detailBandMode === 'stack'}
        onChange={() => setBandMode('stack')} />
      Stack side-by-side (cross-product)
    </label>
    <Tip text="Separate: each parent row is followed by its matching child rows from each band.\n\nStack: child rows from all bands are combined for each parent row (like a cross-product). Warning: this can produce many rows." />
  </div>
)}
```

### Band Ordering (v1)

Bands are ordered by their position in the `detailBands` array. Reordering is not in v1 but the array-based state shape supports it in v2 via drag-and-drop (same pattern as future lookup reordering).

---

## Validation

## 11. Validation

### What to Validate

Each detail band is validated as item `detailband_{i}` in the validation system, following the same pattern as `lookup_{i}` (`validation.ts:239-302`).

| Check | Item ID | Severity | Message |
|-------|---------|----------|---------|
| Child table loaded | `detailband_{i}_missing_table` | blocked | `"Related details sheet "{name}" is not loaded"` |
| Key pair left column available | `detailband_{i}_kp{pi}_left` | blocked | `"Match column "{col}" is not available"` |
| Key pair right column exists | `detailband_{i}_kp{pi}_right` | blocked | `"Match column "{col}" not found in "{table}""` |
| At least one complete key pair | `detailband_{i}_no_key_pairs` | blocked | `"Related details "{table}" has no complete match column pair"` |
| Sort column exists in child table | `detailband_{i}_sort_{si}_missing` | warning | `"Sort column "{col}" not found in "{table}""` |

### When to Validate

Validation runs on every state change via the existing cache-invalidation pattern:

1. User mutates `detailBands` through `DetailBandStage` UI
2. `getStore().update(draft => { ... })` triggers listeners
3. `invalidateValidation()` is called (must be added to DetailBandStage mutation handlers)
4. Next `getValidation()` call recomputes from scratch

### Card Mapping

Detail band validation items map to the `'pipeline'` card:

```typescript
// In cardFor() (validation.ts:580-589):
if (itemId.startsWith('detailband_')) return 'pipeline';
```

### Integration with deriveValidation()

New section after the lookup validation block (`validation.ts:302`):

```typescript
// ── Detail Bands ──────────────────────────────────────────────
for (let i = 0; i < (state.detailBands || []).length; i++) {
  const band = state.detailBands[i];
  const enabled = band.enabled !== false;
  const issues: ValidationIssue[] = [];
  let resolved = true;

  const ct = band.rightId && state.tables[band.rightId];
  if (!ct) {
    resolved = false;
    issues.push(mkIssue(
      `detailband_${i}_missing_table`, 'detailBand', 'pipeline', `detailband_${i}`,
      `Related details sheet "${band.rightId || '(none)'}" is not loaded`,
      { missingTableId: band.rightId || null, repairHint: 'Load the file containing this sheet.' },
    ));
  } else if (baseOk) {
    // Validate key pairs
    for (let pi = 0; pi < (band.keyPairs || []).length; pi++) {
      const p = band.keyPairs[pi];
      if (p.left && !projected.has(p.left)) {
        resolved = false;
        issues.push(mkIssue(
          `detailband_${i}_kp${pi}_left`, 'detailBand', 'pipeline', `detailband_${i}`,
          `Match column "${p.left}" is not available`,
          { missingColumn: p.left },
        ));
      }
      if (p.right && !ct.cols.includes(p.right)) {
        resolved = false;
        issues.push(mkIssue(
          `detailband_${i}_kp${pi}_right`, 'detailBand', 'pipeline', `detailband_${i}`,
          `Match column "${p.right}" not found in "${ct.name}"`,
          { missingColumn: p.right },
        ));
      }
    }
    const hasCompleteKeyPair = (band.keyPairs || []).some(p => p && p.left && p.right);
    if (!hasCompleteKeyPair) {
      resolved = false;
      issues.push(mkIssue(
        `detailband_${i}_no_key_pairs`, 'detailBand', 'pipeline', `detailband_${i}`,
        `Related details "${ct.name}" has no complete match column pair`,
      ));
    }
  }
  mkItem(`detailband_${i}`, enabled, resolved, issues);
}
```

---

## Migration Path

## 12. Migration Path

### STATE_VERSION Bump

Current: `STATE_VERSION = 1` (`state-schema.ts:5`).

The `detailBands` and `detailBandMode` fields are **additive** — they don't change the shape of any existing field. However, the convention is to bump the version when any new field is added so that older clients can detect the format change.

**Decision**: Bump to `STATE_VERSION = 2` when detail bands are implemented.

### Backward Compatibility (loading old .rcjson files)

Old `.rcjson` files (v1) will not have `detailBands` or `detailBandMode` fields. The hydrator handles this gracefully:

```typescript
// In hydrateState() — add after subtotal hydration:
next.detailBands = [];
if (Array.isArray(payload.detailBands)) {
  for (const band of payload.detailBands) {
    // Validate and hydrate each band (same pattern as lookups)
    const rt = band.rightId && loadedTables[band.rightId];
    if (!rt) {
      brokenRefs.push(`Related details sheet "${band.rightId || '(none)'}" is not loaded`);
    }
    // ... validate key pairs, cols, sorts ...
    next.detailBands.push({
      id: band.id || `band_${next.detailBands.length}`,
      rightId: band.rightId || '',
      keyPairs: Array.isArray(band.keyPairs) ? band.keyPairs.map(p => ({ left: p.left || '', right: p.right || '' })) : [],
      cols: Array.isArray(band.cols) ? [...band.cols] : [],
      enabled: band.enabled !== false,
      sorts: Array.isArray(band.sorts) ? band.sorts.map(s => ({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC', enabled: s.enabled !== false })) : [],
      label: typeof band.label === 'string' ? band.label : '',
    });
  }
}
next.detailBandMode = payload.detailBandMode === 'stack' ? 'stack' : 'separate';
```

Old files load with `detailBands: []` — no behavior change.

### Forward Compatibility (loading new .rcjson in old client)

An old client loading a v2 `.rcjson` will see unknown fields (`detailBands`, `detailBandMode`). Since the hydrator only reads known fields, these are silently ignored. No error, no data loss.

### RECOGNIZABLE_KEYS Update

Add `'detailBands'` and `'detailBandMode'` to `RECOGNIZABLE_KEYS` in `state-schema.ts:12-16` so that new config files are still recognized.

### Feature Flags

No feature flags are needed. The feature is additive:
- `detailBands: []` is a no-op — the engine takes the existing code path
- The UI add button is always visible when a base table is set
- Validation handles empty bands gracefully

If a kill switch is desired, a simple check at the engine level suffices:

```typescript
if (reportSpec.detailBands?.length > 0 && DETAIL_BANDS_ENABLED) {
  return runDetailBandsMode(plan, reportSpec, tables);
}
```

---

## Testing Strategy

## 13. Testing Strategy

### Test Files

#### New Test Files (detail-band-specific)

| File | Tests | Coverage Target |
|------|-------|------------------|
| `preact/tests/query/sql-detail-bands.test.ts` | `buildBandQuery()` — single key, multi-key, empty keys, sort, disabled band | 90% |
| `preact/tests/report/engine-bands.test.ts` | `runDetailBandsMode()` — single band, multi-band separate, multi-band stack, null padding, interleaving, explosion limit | 85% |
| `preact/tests/report/result-set-bands.test.ts` | `buildResultSet()` with band metadata, superset columns | 80% |
| `preact/tests/core/state-serializer-bands.test.ts` | `buildPayload()` with detailBands, round-trip serialize→hydrate | 90% |
| `preact/tests/core/state-hydrator-bands.test.ts` | `hydrateState()` with detailBands, missing tables, broken refs, old format | 90% |
| `preact/tests/report/validation-bands.test.ts` | `deriveValidation()` with detail bands — table missing, key pair invalid, no key pairs | 85% |
| `preact/tests/catalog/column-catalog-bands.test.ts` | `buildColumnCatalog()` with band columns — prefix generation, collision handling | 80% |
| `preact/tests/ui/export-bands.test.ts` | Band section headers, row kind 4, _band_id filtering | 75% |

#### Existing Test Files Requiring Fixture Updates (PE-15)

These 11 test files construct `AppState` or `ReportSpec` objects in fixtures. The state shape changes (new `detailBands` and `detailBandMode` fields) require updates to avoid type errors and ensure backward compatibility:

| File | Update Required |
|------|-----------------|
| `preact/tests/core/state.test.ts` | Add `detailBands: []` and `detailBandMode: 'separate'` to expected default state assertions |
| `preact/tests/core/store.test.ts` | Verify new fields present in initial store state; test `createDetailBandSpec()` factory |
| `preact/tests/core/state-serializer.test.ts` | Add `detailBands` and `detailBandMode` to serialization round-trip test payloads |
| `preact/tests/report/engine.test.ts` | Add `detailBands: []` to `ReportSpec.pipeline` in all test fixtures; add `detailBandMode` to ReportSpec |
| `preact/tests/report/result-set.test.ts` | Update `ResultSetMetadata` assertions if testing metadata shape; optional band fields are backward-compatible |
| `preact/tests/report/validation.test.ts` | Add `detailBands: []` to state fixtures used in `deriveValidation()` tests |
| `preact/tests/report/report-output.test.ts` | Add `detailBands: []` to state fixtures used in published output tests |
| `preact/tests/query/query-plan.test.ts` | Add `detailBands: []` to `ReportSpec.pipeline` in all `buildQueryPlan()` test fixtures |
| `preact/tests/catalog/column-catalog.test.ts` | Add `detailBands` field to `catalogCtx` objects passed to `buildColumnCatalog()` |
| `preact/tests/integration/full-pipeline.test.ts` | Add `detailBands: []` and `detailBandMode: 'separate'` to full AppState/ReportSpec fixtures |
| `preact/tests/integration/state-loading.test.ts` | Add test: old `.rcjson` without `detailBands` loads correctly with defaults; new `.rcjson` with `detailBands` round-trips |

**Update strategy**: Update `createAppState()` and `createReportSpec()` defaults first. Then run `npm test` — TypeScript will flag every fixture missing the new fields, making updates mechanical. Each file above needs only the minimum addition of `detailBands: []` to existing fixtures; no test logic changes required.

### Test Patterns

Following existing test conventions:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { buildBandQuery } from '../../query/sql-detail-bands';
import { buildColumnCatalog } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import type { DetailBandSpec, DbTable } from '../../types';

describe('buildBandQuery', () => {
  let tables: Record<string, DbTable>;
  let sourceCatalog: Map<string, SourceTableEntry>;

  beforeEach(() => {
    tables = {
      'orders': { id: 'orders', name: 'Orders', cols: ['OrderID', 'Customer', 'Date'], rowCount: 100 },
      'items': { id: 'items', name: 'Line Items', cols: ['ItemID', 'OrderID', 'Product', 'Qty'], rowCount: 500 },
    };
    sourceCatalog = buildSourceCatalog(tables);
  });

  it('generates WHERE IN with parent key values', () => {
    const band: DetailBandSpec = {
      id: 'band_0', rightId: 'items',
      keyPairs: [{ left: 'OrderID', right: 'OrderID' }],
      cols: ['Product', 'Qty'], enabled: true, sorts: [], label: 'Items',
    };
    const keys = new Set([1, 2, 3]);
    const bandColMap = new Map([
      ['_band_0_Product', { tid: 'items', col: 'Product' }],
      ['_band_0_Qty', { tid: 'items', col: 'Qty' }],
    ]);
    const result = buildBandQuery(band, keys, bandColMap, sourceCatalog);
    expect(result.sql).toContain('IN (?, ?, ?)');
    expect(result.params).toEqual([1, 2, 3]);
    expect(result.cols).toEqual(['_band_0_Product', '_band_0_Qty']);
  });
});
```

### Integration Test

One end-to-end test that exercises the full path:

```typescript
describe('detail bands end-to-end', () => {
  it('produces interleaved result set from parent + band', () => {
    // 1. Set up store with orders + items tables
    // 2. Configure base=orders, detailBands=[{rightId:items, keyPairs:[{left:OrderID, right:OrderID}]}]
    // 3. Call runReport(reportSpec, tables)
    // 4. Assert: result.columns includes parent + band cols + _band_id
    // 5. Assert: parent rows have _band_id=null, band rows have _band_id='band_0'
    // 6. Assert: band rows follow their parent row
  });
});
```

---

## Phasing

## 14. Phasing

### Phase 1: MVP (MEDIUM effort)

**Deliverables**:
- `DetailBandSpec` type in `types.ts`
- `state.detailBands` and `state.detailBandMode` in AppState
- `createDetailBandSpec()` factory in `core/state.ts`
- `buildReportSpecFromState()` helper in `core/state.ts` (PE-6–11)
- `buildBandQuery()` in new `sql-detail-bands.ts`
- `runDetailBandsMode()` in `engine.ts` (separate bands mode only)
- `DetailBandStage` component (basic: table picker, key pairs, column chips)
- `PipelineCard` integration (render stages + add button)
- Serialization/hydration for `detailBands`
- Validation for detail bands
- Tests for all new functions
- **PatternEnforcer amendments** (all assigned to Phase 1):
  - PE-1: Barrel exports in `index.ts` — add `DetailBandSpec`, `buildBandQuery`, `BandQueryResult`, `DetailBandStage`, `createDetailBandSpec`
  - PE-2: `run-bar.tsx` — add `detailBands` and `detailBandMode` to ReportSpec construction
  - PE-3: `report-graph.ts` — add `detailBands[].rightId` to dependency refs
  - PE-4: `grid.tsx` — filter `_band_id` from `makeResultCols()`
  - PE-5: `merge-toggles.tsx` — filter `_band_id` from display columns
  - PE-6–11: Replace 13 partial ReportSpec constructions with `buildReportSpecFromState()` across `column-chips.tsx`, `sort-list.tsx`, `filter-list.tsx`, `layout-card.tsx`, `calc-stage.tsx`, `lookup-stage.tsx`
  - PE-12: `alias-ref-updater.ts` — propagate renames to `detailBands[].keyPairs[].left` and `detailBands[].cols`
  - PE-13: `query-plan.ts` — add `detailBands` to `catalogCtx`
  - PE-14: `engine.ts` — add `detailBands` to `catalogCtx` in `runTotalsMode()`
  - PE-15: Update 11 existing test fixtures with `detailBands: []` and `detailBandMode: 'separate'`

**Does NOT include**:
- Stacking mode (cross-product)
- Export section headers
- Band sorting in UI
- Band labels
- AG Grid band styling

**Exit criteria**: User can add a detail band, run the report, see interleaved rows in the grid.

### Phase 2: Multi-Band Mode (MEDIUM effort)

**Deliverables**:
- Stacking mode (cross-product) in `runDetailBandsMode()`
- Mode toggle UI in `PipelineCard`
- Row explosion protection with `STACK_ROW_LIMIT`
- Band sorting configuration in `DetailBandStage`
- Band labels in `DetailBandStage`
- Tests for stacking mode and explosion limit

**Exit criteria**: User can configure 2+ bands, choose separate/stack mode, see cross-product results.

### Phase 3: Export Enhancements (SMALL-MEDIUM effort)

**Deliverables**:
- Band section headers in XLSX export
- Row kind 4 styling in `styleExportSheet()`
- `_band_id` column filtering in export
- CSV export with `_band_id` column
- Tests for band-aware export

**Exit criteria**: Exported XLSX has visually distinct band sections.

### Phase 4: Polish (SMALL effort)

**Deliverables**:
- AG Grid band row styling (background color by band)
- Band reorder drag-and-drop in `PipelineCard`
- Row explosion warning dialog with override button
- Performance optimization (Web Worker for large cross-products)
- Published output handling for `_band_id`
- Tests for grid styling and published output

**Exit criteria**: Full feature parity with design doc. No known UX rough edges.

---

## Pattern Enforcer Review Amendments

This section addresses 15 gaps identified by PatternEnforcer after the initial design review. Each gap states the problem, the fix, affected files, and any new code required.

### PE-1: Missing Barrel Exports in `preact/index.ts`

**Gap**: The public API surface (`preact/index.ts`) does not export any of the new types, functions, or components introduced by this feature. External consumers and the test harness cannot access them.

**Fix**: Add four export lines to the appropriate layer sections of `preact/index.ts`:

**Files**: `preact/index.ts`

**Changes**:

In the **Core Layer** section (after line 11):
```typescript
export { createDetailBandSpec } from './core/state';
```

In the **Query Layer** section (after line 46):
```typescript
export { buildBandQuery } from './query/sql-detail-bands';
export type { BandQueryResult } from './query/sql-detail-bands';
```

In the **UI Layer** section (after line 88):
```typescript
export { DetailBandStage } from './ui/sections/detail-band-stage';
```

In the **Types** section (after line 131):
```typescript
export type { DetailBandSpec } from './types';
```

---

### PE-2: ReportSpec Missing `detailBands` in `run-bar.tsx`

**Gap**: The `runQuery` callback in `preact/ui/sections/run-bar.tsx` (lines 68-100) constructs a `ReportSpec` from `AppState` but does NOT map `detailBands` or `detailBandMode` into it. The engine will never receive the detail band configuration, so detail bands will silently produce no output even when configured.

**Fix**: Add two fields to the ReportSpec literal in `run-bar.tsx`.

**Files**: `preact/ui/sections/run-bar.tsx` (lines 72-78)

**Changes**:

```typescript
// In the pipeline object (after line 77):
pipeline: {
  base: currentState.base,
  baseCols: currentState.baseCols,
  stacks: currentState.stacks,
  lookups: currentState.lookups,
  calculatedColumns: currentState.calcStages,
  detailBands: currentState.detailBands || [],    // NEW
},
// At report level (after line 98):
detailBandMode: currentState.detailBandMode || 'separate',  // NEW
```

---

### PE-3: Missing Dependency Edges in `report-graph.ts`

**Gap**: `buildReportGraph()` in `preact/report/report-graph.ts` (lines 77-81) builds dependency edges from `pipeline.base`, `pipeline.stacks`, and `pipeline.lookups[].rightId`, but NOT from `pipeline.detailBands[].rightId`. If a detail band references a published output from another report, the dependency graph will not detect it, leading to incorrect run order or undetected cycles.

**Fix**: Add `detailBands[].rightId` to the refs array.

**Files**: `preact/report/report-graph.ts` (lines 77-81)

**Changes**:

```typescript
const refs: string[] = [
  pipeline.base,
  ...pipeline.stacks,
  ...pipeline.lookups.map(l => l.rightId),
  ...(pipeline.detailBands || []).map(b => b.rightId),  // NEW
].filter(Boolean) as string[];
```

---

### PE-4: `_band_id` Visible in Grid Columns

**Gap**: `makeResultCols()` in `preact/ui/grid.tsx` (line 334) filters internal columns `_rowno`, `_row_type`, `_isTotalsRow` from the AG Grid column definitions but does NOT filter `_band_id`. The internal band-tagging column will appear as a visible grid column with meaningless values (`null` for parent rows, `"band_0"` for band rows).

**Fix**: Add `_band_id` to the filter predicate.

**Files**: `preact/ui/grid.tsx` (line 334)

**Changes**:

```typescript
const dataCols = cols.filter(c =>
  c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id'
);
```

---

### PE-5: `_band_id` Visible in Merge Toggles

**Gap**: `preact/ui/sections/merge-toggles.tsx` (line 30) applies the same internal-column filter as `grid.tsx` but also omits `_band_id`. The merge toggles UI will show `_band_id` as a mergeable column, which is incorrect — it's an internal tagging column, not user data.

**Fix**: Add `_band_id` to the filter predicate.

**Files**: `preact/ui/sections/merge-toggles.tsx` (line 30)

**Changes**:

```typescript
const baseDisplayCols = cols.filter(c =>
  c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow' && c !== '_band_id'
);
```

---

### PE-6 through PE-11: Partial ReportSpec Construction in 8+ UI Components

**Gap**: Eight UI components construct a partial `ReportSpec`-shaped object `{ base, lookups, calcStages }` to pass to `projectedCols()` or `projectedColsUpToLookup()`. None of them include `detailBands`, which means column projection will not account for band columns. Affected call sites:

| File | Line(s) | Call Sites |
|------|---------|------------|
| `preact/ui/sections/column-chips.tsx` | 104, 118, 143, 170, 192, 235, 340 | 7 |
| `preact/ui/sections/sort-list.tsx` | 92 | 1 |
| `preact/ui/sections/filter-list.tsx` | 161 | 1 |
| `preact/ui/cards/layout-card.tsx` | 301 | 1 |
| `preact/ui/sections/calc-stage.tsx` | 48, 287 | 2 |
| `preact/ui/sections/lookup-stage.tsx` | 73 | 1 |

**Total**: 13 call sites across 6 files.

**Fix**: Extract a shared helper function `buildReportSpecFromState()` that constructs a complete ReportSpec-shaped object from `AppState`, including `detailBands`. Replace all 13 inline constructions with calls to this helper.

**Files**: New helper + 6 consumer files

**Helper location**: `preact/core/state.ts` (alongside `createReportSpec`) — this keeps it in the Core layer where state shape knowledge belongs. Alternatively, `preact/ui/report-spec-helper.ts` if the team prefers UI-only utilities outside Core.

**Recommended**: Place in `preact/core/state.ts` because it reads `AppState` directly and the function is a pure projection of state shape — not UI logic.

**Helper function**:

```typescript
/**
 * Build a ReportSpec-shaped object from AppState for use with
 * projectedCols(), projectedColsUpToLookup(), and similar functions.
 *
 * This is NOT a full ReportSpec (it omits outputColumns, filters, etc.)
 * but contains all pipeline fields needed for column projection.
 */
export function buildReportSpecFromState(state: AppState): Pick<ReportSpec, 'pipeline'> & { calcStages: CalcStage[] } {
  return {
    pipeline: {
      base: state.base,
      baseCols: state.baseCols,
      stacks: state.stacks,
      lookups: state.lookups,
      calculatedColumns: state.calcStages,
      detailBands: state.detailBands || [],
    },
    calcStages: state.calcStages,
  };
}
```

**Consumer changes** (example for `column-chips.tsx`):

```typescript
// BEFORE (line 104):
const reportSpec = { base: st.base, lookups: st.lookups, calcStages: st.calcStages };

// AFTER:
const reportSpec = buildReportSpecFromState(st);
```

All 13 call sites follow the same substitution pattern. The `projectedCols()` and `projectedColsUpToLookup()` function signatures accept this shape already (they read `pipeline.base`, `pipeline.lookups`, `pipeline.calculatedColumns`, and now `pipeline.detailBands`).

**Note**: The `run-bar.tsx` construction (PE-2) builds a *full* `ReportSpec` with output columns, filters, sorts, aggregation, etc. — it should NOT use `buildReportSpecFromState()`. That helper is specifically for the column-projection use case.

---

### PE-12: Column Renames Don't Propagate to Detail Bands

**Gap**: `_renameProjectedAliasRefs()` in `preact/query/alias-ref-updater.ts` (lines 1-32) updates `filters[].col`, `sorts[].col`, `groupBy[]`, and `aggregates[].col` when a column alias is renamed, but does NOT update `detailBands[].keyPairs[].left` or `detailBands[].cols`. After a rename, detail bands will reference stale alias names, causing validation failures and query errors.

**Fix**: Add two loops to update detail band references.

**Files**: `preact/query/alias-ref-updater.ts` (after line 31)

**Changes**:

```typescript
// ── Detail band key pairs and columns ──────────────────────────────
const detailBands = db.detailBands as Array<Record<string, unknown>> | undefined;
if (detailBands) {
  for (const band of detailBands) {
    // Update keyPairs[].left (parent-side alias references)
    const keyPairs = band.keyPairs as Array<Record<string, unknown>> | undefined;
    if (keyPairs) {
      for (const kp of keyPairs) {
        if (kp.left === oldAlias) kp.left = newAlias;
      }
    }
    // Update cols (band column selections that may reference aliases)
    const cols = band.cols as string[] | undefined;
    if (cols) {
      for (let i = 0; i < cols.length; i++) {
        if (cols[i] === oldAlias) cols[i] = newAlias;
      }
    }
  }
}
```

---

### PE-13: `catalogCtx` Missing `detailBands` in `query-plan.ts`

**Gap**: `buildQueryPlan()` in `preact/query/query-plan.ts` (lines 149-155) builds a `catalogCtx` object and passes it to `buildColumnCatalog()`. The context includes `base`, `baseCols`, `stacks`, `lookups`, and `calcStages` but NOT `detailBands`. As a result, band columns will not appear in the `colMap`, and `buildBandQuery()` will receive an empty column map — producing SELECT clauses with no columns.

**Fix**: Add `detailBands` to the `catalogCtx` object.

**Files**: `preact/query/query-plan.ts` (lines 149-155)

**Changes**:

```typescript
const catalogCtx: Record<string, unknown> = {
  base: reportSpec.pipeline.base,
  baseCols: reportSpec.pipeline.baseCols,
  stacks: reportSpec.pipeline.stacks,
  lookups: reportSpec.pipeline.lookups,
  calcStages: reportSpec.pipeline.calculatedColumns,
  detailBands: reportSpec.pipeline.detailBands || [],  // NEW
};
```

---

### PE-14: `catalogCtx` Missing `detailBands` in `engine.ts` `runTotalsMode()`

**Gap**: `runTotalsMode()` in `preact/report/engine.ts` (lines 54-60) rebuilds `catalogCtx` independently (because `buildQueryPlan` doesn't expose intermediate catalog objects). Same omission as PE-13 — band columns missing from `colMap`.

**Fix**: Add `detailBands` to the `catalogCtx` object.

**Files**: `preact/report/engine.ts` (lines 54-60)

**Changes**:

```typescript
const catalogCtx: Record<string, unknown> = {
  base: reportSpec.pipeline.base,
  baseCols: reportSpec.pipeline.baseCols,
  stacks: reportSpec.pipeline.stacks,
  lookups: reportSpec.pipeline.lookups,
  calcStages: reportSpec.pipeline.calculatedColumns,
  detailBands: reportSpec.pipeline.detailBands || [],  // NEW
};
```

---

### PE-15: Existing Test Files Need Fixture Updates

**Gap**: The state shape is changing — `AppState` gains `detailBands: DetailBandSpec[]` and `detailBandMode: 'separate' | 'stack'`. Eleven existing test files construct `AppState` or `ReportSpec` objects in their fixtures and will fail type-checking or produce incorrect results without the new fields.

**Affected test files**:

| File | What Needs Updating |
|------|---------------------|
| `preact/tests/core/state.test.ts` | `createAppState()` assertions — add `detailBands: []` and `detailBandMode: 'separate'` to expected defaults |
| `preact/tests/core/store.test.ts` | Store initialization tests — verify new fields present in initial state |
| `preact/tests/core/state-serializer.test.ts` | Serialization round-trip — add `detailBands` and `detailBandMode` to test payloads and expected output |
| `preact/tests/report/engine.test.ts` | `runReport()` test fixtures — add `detailBands: []` to ReportSpec.pipeline; add `detailBandMode` to ReportSpec |
| `preact/tests/report/result-set.test.ts` | `buildResultSet()` tests — metadata interface gains optional band fields |
| `preact/tests/report/validation.test.ts` | `deriveValidation()` tests — state fixtures need `detailBands` field |
| `preact/tests/report/report-output.test.ts` | Published output tests — state fixtures need `detailBands` field |
| `preact/tests/query/query-plan.test.ts` | `buildQueryPlan()` tests — ReportSpec.pipeline needs `detailBands: []` |
| `preact/tests/catalog/column-catalog.test.ts` | `buildColumnCatalog()` tests — catalogCtx needs `detailBands` field |
| `preact/tests/integration/full-pipeline.test.ts` | End-to-end tests — full AppState and ReportSpec fixtures need new fields |
| `preact/tests/integration/state-loading.test.ts` | State loading tests — verify backward compatibility (old .rcjson without detailBands loads correctly) |

**Fix strategy**: For each test file, add `detailBands: []` and `detailBandMode: 'separate'` to every `AppState` or `ReportSpec` fixture. This is the minimum change — tests that specifically exercise detail band behavior belong in new test files (see Testing Strategy section).

**Recommended approach**: Update `createAppState()` and `createReportSpec()` defaults first (Phase 1). Then run `npm test` — the TypeScript compiler will flag every fixture that's missing the new fields, making the updates mechanical.

---

### Amendment Summary

| Gap | Severity | Phase | Files | Effort |
|-----|----------|-------|-------|--------|
| PE-1: Barrel exports | Critical | Phase 1 | `index.ts` | TRIVIAL |
| PE-2: ReportSpec in run-bar | Critical | Phase 1 | `run-bar.tsx` | TRIVIAL |
| PE-3: Dependency edges | Critical | Phase 1 | `report-graph.ts` | TRIVIAL |
| PE-4: _band_id in grid | Important | Phase 1 | `grid.tsx` | TRIVIAL |
| PE-5: _band_id in merge-toggles | Important | Phase 1 | `merge-toggles.tsx` | TRIVIAL |
| PE-6–11: Partial ReportSpec | Important | Phase 1 | 6 UI files + `core/state.ts` | SMALL |
| PE-12: Alias rename propagation | Important | Phase 1 | `alias-ref-updater.ts` | TRIVIAL |
| PE-13: catalogCtx in query-plan | Important | Phase 1 | `query-plan.ts` | TRIVIAL |
| PE-14: catalogCtx in engine | Important | Phase 1 | `engine.ts` | TRIVIAL |
| PE-15: Test fixture updates | Important | Phase 1 | 11 test files | SMALL |

All amendments are assigned to **Phase 1** because they are correctness fixes — without them, the MVP will silently produce wrong results (missing columns, missing dependencies, visible internal columns). None of them add new functionality; they close gaps where the original design didn't account for existing integration points.

---

## Open Questions

## 15. Open Questions

These decisions are intentionally deferred to implementation. They are surfaced here so the implementer knows they exist and can resolve them with the user.

### OQ-1: Calculated Columns in Detail Bands

**Question**: Should calc columns be supported in detail band queries?

**Context**: The existing calc column system has a known bug where detail queries return alias strings instead of computed values (log L34). This affects all calc columns in non-aggregated queries, not just bands.

**Recommendation**: Defer until the calc column bug is fixed. In the meantime, `buildBandQuery()` skips calc columns (`if (entry.kind === 'calc') continue`). The UI should disable calc column selection for bands until this is resolved.

### OQ-2: Detail Bands with Aggregation Modes

**Question**: Should detail bands work with aggregation modes other than 'none'?

**Context**: Currently, detail bands are designed for `aggMode: 'none'`. Combining bands with subtotals or group mode raises questions: do bands appear inside each group? After all groups? The semantics are unclear.

**Recommendation**: v1 restricts detail bands to `aggMode: 'none'`. Validation should warn if bands are configured with a non-none agg mode. Future versions can define the interaction.

### OQ-3: AG Grid Null Cell UX

**Question**: How should AG Grid render rows where most cells are null (the superset-column approach)?

**Context**: With 3 bands of 5 columns each and 10 parent columns, a band row has 10 null parent columns and 15 null other-band columns. The grid will show many empty cells.

**Options**:
- A) Accept the nulls — simple, consistent with existing null handling
- B) Hide null columns per-row using AG Grid cell styling (grey background)
- C) Use AG Grid row grouping to collapse band rows under parent rows

**Recommendation**: Option A for v1. Option B or C for phase 4 polish.

### OQ-4: _band_id Type

**Question**: Should `_band_id` be a string (band label or generated ID) or an integer (band index)?

**Context**: String IDs are stable across reordering. Integer indices are simpler but shift when bands are reordered.

**Recommendation**: Use string IDs (`"band_0"`, `"band_1"`, etc.) generated at creation time. These survive reordering and are human-readable in exports.

### OQ-5: Row Explosion Threshold

**Question**: What is the exact row count threshold for the stacking mode explosion warning?

**Context**: The design specifies 10,000 as a default. Should this be configurable? Should there be a warning before the hard limit?

**Recommendation**: Hard limit at 10,000 for v1 with an override button. Make configurable in v2 if users request it.

### OQ-6: Export Discriminator Column

**Question**: Should the `_band_id` column be opt-in or automatic in exports?

**Context**: In single-sheet export, `_band_id` is filtered out (like `_row_type`). Section headers provide the visual grouping. But some users may want the raw band ID for downstream processing.

**Recommendation**: Automatic filtering for v1. Add an "Include band ID column" checkbox in export options for v2.

---

## Appendix: Research Findings

## 16. Appendix: Research Findings

### Key Patterns Discovered

1. **runTotalsMode stitching pattern** (`engine.ts:45-86`): The exact pattern detail bands will follow — separate queries, JS combination, null padding for mismatched columns. This validates the JS stitching approach as idiomatic for this codebase.

2. **UNION ALL with band tagging** (`sql-subtotals.ts:67-250`): Subtotals use UNION ALL with `_row_type` markers. This pattern cannot be directly reused for detail bands (different column sets), but the band-tagging concept inspires the `_band_id` column.

3. **tablePrefix() collision handling** (`column-catalog.ts:55-57`): The existing prefix mechanism for lookup columns is the model for band column prefixes. Using `_{bandId}_` as prefix ensures no collisions.

4. **LookupStage as UI template** (`lookup-stage.tsx:47-321`): 275-line component with table picker, key pair config, column chips, enable/disable, remove. DetailBandStage will be structurally identical with minor differences (sort config, label, no duplicate policy).

5. **Pipeline card composition** (`pipeline-card.tsx:83-145`): Stages are composed linearly with PipelineArrow separators. Adding DetailBandStage is a straightforward append after calc stages.

6. **Validation cache pattern** (`validation.ts:95-134`): Cache invalidation via `invalidateValidation()` after state mutations. DetailBandStage must call this after every `store.update()`.

7. **Export row-kind styling** (`export.ts:255-331`): The `rowKinds` array drives per-row styling. Adding kind 4 (band header) is additive — existing kinds 0-3 are unaffected.

### Reusable Components

| Component | Location | Reuse For |
|-----------|----------|----------|
| `Chip` | `ui/components/chip.tsx` | Band column picker |
| `Tip` | `ui/components/tip.tsx` | Tooltips on band config |
| `ContextMenu` | `ui/components/context-menu.tsx` | Band column rename |
| `RenameModal` | `ui/components/rename-modal.tsx` | Band column rename |
| `PipelineArrow` | `ui/sections/pipeline-arrow.tsx` | Arrow between band stages |
| `quoteId()` | `core/sqldb.ts` | All SQL identifier quoting |
| `resolveRef()` | `query/resolve-ref.ts` | Column alias to SQL reference |
| `buildWhere()` | `query/sql-where.ts` | Potential reuse for band-level filters |
| `buildColSourceMap()` | `catalog/column-catalog.ts` | UI column label resolution |
| `projectedColsUpToLookup()` | `catalog/column-catalog.ts` | Left-side key column validation |

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Calc column bug (L34) blocks calc in bands | Medium | Skip calc columns in band queries; fix bug separately |
| Large cross-products in stacking mode | High | Hard limit at 10K rows with override |
| Null-heavy rows confuse users | Low | Phase 4: AG Grid styling to de-emphasize null cells |
| STATE_VERSION bump breaks old clients | Low | Additive fields only; old clients ignore unknown fields |
| 0% test coverage on engine functions | Medium | New code gets tests; don't touch existing untested functions |

---
