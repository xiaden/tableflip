# Detail Bands Export Layout — Design Document
Status: Draft  
Author: rnd-dd-author  
Created: 2026-06-14  

Related Documents:
- [Subreport Detail Rows — Design Document](artifacts/designs/completed/DD-subreport-detail-rows.md) — Original detail bands design — Section 9 covers export basics (section headers, row kind 4, _band_id filtering). This document defines the compact column layout for band exports.
- [Export Bands Test Suite](SRC/preact/tests/ui/export-bands.test.ts) — Test file covering export band behavior. New tests are added alongside existing ones.
- [Export Logic Module](SRC/preact/ui/export.ts) — Main export module — contains `enrichRowsWithBandHeaders()`, `styleExportSheet()`, `applyExportMerges()`, and `exportAs()`. All band export layout changes are in this file.

## Scope

### In Scope
- New `buildBandColumnLayout()` pure function in `export.ts` — transforms flat result rows into compact column layout (match column + band columns per row)
- New `computeBandColSets()` helper in `export.ts` — extracts per-band column alias arrays from superset columns
- New `applyBandGroup()` pure function in `export.ts` — composable per-band-group row transformation
- Integration in `exportAs()` — dispatches to band layout when detail bands are present
- New row kind 5 in `styleExportSheet()` — styling for band parent rows
- New tests in `export-bands.test.ts` — covering all new functions and the band export integration

### Out of Scope
- Engine or query layer changes (no changes to `engine.ts`, `sql-detail-bands.ts`, or result set shape)
- Catalog layer changes (no changes to column catalog or column source map)
- UI component changes (no new toggles, preferences, or state properties)
- Multi-sheet export (deferred to future design)
- AG Grid rendering changes (grid display is unchanged)
- `applyExportMerges()` modifications (match column is not merged — see OQ-4)

## Problem Statement

The current XLSX export for detail band reports produces a wide, sparse sheet. Every row has the superset of parent + all band columns, with null-padded cells where columns don't apply. A report with 5 parent columns and 3 bands of 4 columns each produces a 17-column sheet where parent rows have 12 null cells and each band row has 13 null cells. The exported file is hard to read, wastes horizontal space, and doesn't clearly communicate the parent-child relationship — the section header row puts the band label in the first parent column, which is visually ambiguous.

Users expect a compact, readable layout: one column for the parent key value (repeated on every row to maintain context), followed by only the band's own columns. This is the "match + band cols" layout common in subreport-style exports from tools like Crystal Reports and SSRS.

## Architecture

### Approach: Composable Band Group Transformations

The band export layout is produced by a pipeline of pure transformations. Each enabled band group is a pure function that takes an array of rows and returns a transformed array:

```
Each band group: (rows: Row[]) → Row[]
Multiple bands:  result = bandB(bandA(initialRows))
```

The input is the raw interleaved result from the engine's `interleaveRows()`: parent rows (with `_band_id == null`) followed by their matching band rows (with `_band_id` set). Each band group transformation:

1. Walks through all rows, tracking the parent's match column value (from `keyPairs[0].left`)
2. Collects its own band rows (identified by `_band_id === thisBandId`)
3. At group boundaries (when a different row type is encountered after collecting band rows), inserts:
   - A **section header row**: match value + this band's column display names
   - **Band data rows**: match value + this band's column values
4. Converts parent rows to compact format (match column populated, band columns empty)
5. Passes through rows from other band groups unchanged (marked as processed to prevent re-processing)

The original wide-format band rows from the engine are **replaced** by compact-format rows. The composition of all band group transformations produces the final layout.

### Layer Mapping

| Component | Layer | File | Responsibility |
|-----------|-------|------|----------------|
| `applyBandGroup()` | UI (export) | `preact/ui/export.ts` (new function) | Per-band-group row transformation — replaces wide band rows with compact format, inserts section headers |
| `buildBandColumnLayout()` | UI (export) | `preact/ui/export.ts` (new function) | Orchestrates composition of all band group transformations, builds header array |
| `exportAs()` integration | UI (export) | `preact/ui/export.ts:131` (modified) | Detect band presence, dispatch to band layout path |
| `styleExportSheet()` extension | UI (export) | `preact/ui/export.ts:276` (modified) | Handle new row kind 5 (band parent row) styling |
| `computeBandColSets()` | UI (export) | `preact/ui/export.ts` (new helper) | Extract per-band ordered column alias arrays from superset columns |

### Dependency Direction (validated)

- `applyBandGroup()` reads `DetailBandSpec` from state (UI → types) ✓
- `buildBandColumnLayout()` calls `hdrMap` lookups (UI → core/utils) ✓
- `exportAs()` calls `buildBandColumnLayout()` (within UI layer) ✓
- No upward imports. No engine/query/catalog changes.

### Per-Band Match Column Resolution

Each band group has its own match column, determined by `keyPairs[0].left` on that band's `DetailBandSpec`. Different bands may use different match columns — this is not a constraint. Each band group independently resolves its match column alias and tracks transition points in the parent data.

```
Band A: keyPairs[0].left = 'OrderId'    → match column is OrderId
Band B: keyPairs[0].left = 'CustomerId' → match column is CustomerId
```

Each band group transformation reads the match value from parent rows (where `_band_id == null`). Since parent rows carry all parent column values (they are not null-padded), the match value is always available directly on the parent row.

**Important**: Band rows from the engine have `null` for ALL parent columns (including the match column alias) due to `padBandRow()` in engine.ts. The match value must be read from the preceding parent row, not from the band row itself.

### Data Flow

```
result.rows (superset cols, _band_id tagged, null-padded band rows)
  │
  ├── computeBandColSets(detailBands, cols) → per-band ordered alias arrays
  │     band_0: ['_band_0_Product', '_band_0_Quantity']
  │     band_1: ['_band_1_Note']
  │
  ├── Build header array:
  │     matchLabel = hdrMap[bandA.matchAlias] (or first band's match alias)
  │     allBandLabels = unique union of all band column labels (via hdrMap)
  │     headers = [matchLabel, ...allBandLabels]
  │
  ├── Compose band group transformations:
  │     rows = initialRows (from engine, with totals row appended if present)
  │     for each enabled band:
  │       rows = applyBandGroup(rows, band, matchAlias, bandColAliases, allBandLabels, hdrMap)
  │
  ├── Result: { cleanRows, rowKinds, headers, bandIds }
  │
  ├── json_to_sheet(cleanRows, { header: headers })
  │
  ├── applyExportMerges(ws, cleanRows, rowKinds, headers, mergeHeaderSet)
  │     └── Match column NOT merged (see OQ-4) — explicit value on every row
  │
  └── styleExportSheet(ws, cleanRows, rowKinds, mergeHeaderSet, bandIds)
        └── Kind 5 (parent): bold, subtle fill
            Kind 4 (band section header): existing bold italic blue
            Kind 0 (band data): existing band tint
```

### Format Consistency

The exported data structure is identical regardless of output format (CSV, XLSX, or any future format). The `buildBandColumnLayout()` function produces the same `cleanRows`, `rowKinds`, `headers`, and `bandIds` arrays for all formats. There is no format-specific branching in the data structure.

`_band_id` is NOT an output column in any format. It exists only internally on band data rows for tint color assignment in `styleExportSheet()`. The `bandIds` array is extracted from these internal markers for the styling function, but `_band_id` does not appear in the `headers` array or the `cleanRows` output. Visual grouping is achieved through section headers (kind 4) and repeated match values, not through a `_band_id` column.

Format-specific behavior is limited to serialization:
- **XLSX**: Styling and merges are applied via `styleExportSheet()` and `applyExportMerges()`.
- **CSV**: No styling or merges. The same compact row structure is serialized as comma-separated values.

## Algorithm

### applyBandGroup()

The core transformation function. Takes the current row array and produces a new array where this band group's rows are in compact format.

```typescript
function applyBandGroup(
  rows: Record<string, unknown>[],
  bandId: string,
  matchAlias: string,
  bandColAliases: string[],
  allBandLabels: string[],
  hdrMap: Record<string, string>,
): Record<string, unknown>[]
```

**Algorithm:**

```
matchLabel = hdrMap[matchAlias] || matchAlias

// Build a lookup: bandLabel → bandColAlias for THIS band's columns
thisBandLabelToAlias = {}
for colAlias in bandColAliases:
  label = hdrMap[colAlias] || colAlias
  thisBandLabelToAlias[label] = colAlias

result = []
currentMatchValue = null
collectedBandRows = []

function flushCollected():
  if collectedBandRows.length == 0: return

  // Section header row: match value + this band's display names
  headerRow = { _processed: true, _rowKind: 4 }
  headerRow[matchLabel] = currentMatchValue
  for label in allBandLabels:
    headerRow[label] = thisBandLabelToAlias[label]
      ? (hdrMap[thisBandLabelToAlias[label]] || thisBandLabelToAlias[label])
      : ''
  result.push(headerRow)

  // Band data rows: match value + this band's values
  for row in collectedBandRows:
    dataRow = { _processed: true, _rowKind: 0, _band_id: bandId }
    dataRow[matchLabel] = currentMatchValue
    for label in allBandLabels:
      colAlias = thisBandLabelToAlias[label]
      dataRow[label] = colAlias ? (row[colAlias] ?? '') : ''
    result.push(dataRow)

  collectedBandRows = []

for each row in rows:
  if row._processed:
    // Already transformed by a previous band group — pass through
    result.push(row)
    continue

  if row._band_id == null:
    // Parent row — flush any collected band rows, then emit compact parent
    flushCollected()
    currentMatchValue = row[matchAlias]
    parentRow = { _processed: true, _rowKind: 5 }
    parentRow[matchLabel] = currentMatchValue
    for label in allBandLabels:
      parentRow[label] = ''
    result.push(parentRow)

  else if String(row._band_id) === bandId:
    // This band's row — collect for deferred emission
    collectedBandRows.push(row)

  else:
    // Other band's row — flush collected rows first, then pass through
    flushCollected()
    result.push(row)

// End of input — flush any remaining collected rows
flushCollected()

return result
```

**Key properties:**

1. **`_processed` flag**: Synthetic rows (parent compact, section header, band data) are marked `_processed: true`. Subsequent band group transformations pass these through unchanged. This is what makes composition work — each transformation only touches its own rows.

2. **Deferred emission**: Band rows are collected until the group boundary is reached (a non-this-band row or end of input). Then the section header + data rows are emitted in a batch. This ensures the section header appears before the first data row of each group.

3. **Match value tracking**: `currentMatchValue` is set when a parent row is encountered. All subsequent band rows (until the next parent) use this value. This works because `interleaveRows()` guarantees band rows follow their parent.

4. **Column position mapping**: Each band's columns are mapped to their positions in the `allBandLabels` array. Band A's columns might occupy positions 1,2,3 while Band B's occupy position 4. Rows from Band A leave position 4 empty; rows from Band B leave positions 1,2,3 empty.

5. **`_band_id` on data rows**: Band data rows carry `_band_id` for tint color assignment in `styleExportSheet()`. The `bandIds` array is derived from these.

6. **`_rowKind` on synthetic rows**: Row kind codes are embedded on synthetic rows for extraction after composition:
   - Kind 5: band parent row (new)
   - Kind 4: band section header (existing)
   - Kind 0: band data row (existing)

### buildBandColumnLayout()

The orchestrator function. Builds the header array, composes all band group transformations, and extracts the final output arrays.

```typescript
function buildBandColumnLayout(
  dataRows: Record<string, unknown>[],
  detailBands: DetailBandSpec[],
  allCols: string[],
  hdrMap: Record<string, string>,
): { cleanRows: Record<string, unknown>[]; rowKinds: number[]; headers: string[]; bandIds: string[] }
```

**Algorithm:**

```
enabledBands = detailBands.filter(b => b.enabled !== false)

// Per-band column alias arrays
bandColSets = computeBandColSets(detailBands, allCols)

// Match column: use first enabled band's keyPairs[0].left
// (All parent rows carry all parent columns, so any band's match alias works
//  for reading parent row values. Each band group uses its OWN match alias
//  internally for tracking transition points.)
matchAlias = enabledBands[0].keyPairs[0]?.left
matchLabel = hdrMap[matchAlias] || matchAlias

// Collect all unique band column labels across all bands, in band order
allBandLabels = []
for bandId in bandColSets (insertion order):
  for colAlias in bandColSets[bandId]:
    label = hdrMap[colAlias] || colAlias
    if label not in allBandLabels:
      allBandLabels.push(label)

headers = [matchLabel, ...allBandLabels]

// Compose band group transformations
rows = dataRows
for each band in enabledBands:
  bandColAliases = bandColSets[band.id] || []
  rows = applyBandGroup(rows, band.id, band.keyPairs[0].left, bandColAliases, allBandLabels, hdrMap)

// Extract output arrays
cleanRows = rows.map(row => {
  out = {}
  for h in headers:
    out[h] = row[h] ?? ''
  return out
})

rowKinds = rows.map(row => {
  if row._rowKind != null: return row._rowKind
  if row._isTotalsRow: return 3
  return 0
})

bandIds = rows.map(row => row._band_id != null ? String(row._band_id) : '')

return { cleanRows, rowKinds, headers, bandIds }
```

**Note on match column for header**: The header row uses the first enabled band's match alias for the match column label. Since all parent rows carry all parent columns, the match value on parent rows is the same regardless of which band's alias is used. However, each band group internally uses its OWN `keyPairs[0].left` for tracking transition points. If bands have different match columns, the header label comes from the first band, but each band group reads its own match value from parent rows.

**Note on label deduplication**: When multiple bands share column names (e.g., both bands have a "Date" column), `buildExportHeaderMap()` already deduplicates with numeric suffixes via `hdrMap`. The `allBandLabels` array uses these deduplicated labels.

### computeBandColSets()

```typescript
function computeBandColSets(
  detailBands: DetailBandSpec[] | undefined,
  allCols: string[],
): Record<string, string[]>
```

```
result = {}
for each band in detailBands:
  if band.enabled === false: continue
  prefix = '_' + band.id + '_'
  bandCols = allCols.filter(c => c.startsWith(prefix))
  // Sort by the band's cols order (preserves user's column selection order)
  ordered = band.cols.map(c => prefix + c).filter(c => bandCols.includes(c))
  // Append any band cols not in band.cols (defensive — shouldn't happen)
  for c in bandCols:
    if !ordered.includes(c): ordered.push(c)
  result[band.id] = ordered
return result
```

### exportAs() Integration

The band layout path in `exportAs()` activates when detail bands are present. There is no fallback logic — the band layout is the only export path for band reports.

```typescript
// After building dataRows (with totals row appended if present):
const enabledBands = (state.detailBands || []).filter(b => b.enabled !== false && b.rightId);

if (enabledBands.length > 0) {
  // ── Band layout path ─────────────────────────────────────────
  const { cleanRows, rowKinds, headers, bandIds } =
    buildBandColumnLayout(dataRows, state.detailBands || [], cols || [], hdrMap || {});

  if (isCsv) {
    const ws = XLSX.utils.json_to_sheet(cleanRows, { header: headers, skipHeader: false });
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    dl(blob, fn + '.csv');
  } else {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(cleanRows, { header: headers, skipHeader: false });
    applyExportMerges(ws, cleanRows, rowKinds, headers, mergeHeaderSet);
    styleExportSheet(ws, cleanRows, rowKinds, mergeHeaderSet, bandIds);
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    XLSX.writeFile(wb, fn + '.xlsx');
  }
  toast('Exported ' + cleanRows.length.toLocaleString() + ' rows as ' + fmt.toUpperCase(), 'ok');
  return; // early return — band path is mutually exclusive with non-band path
}

// ── Non-band path (existing code, unchanged) ───────────────────
// When no detail bands are configured, the existing export pipeline runs.
// This is not a "fallback" — it's the normal export path for non-band reports.
const { enrichedRows, rowKinds } = enrichRowsWithBandHeaders(...);
// ... rest of existing code ...
```

**Note on `mergeHeaderSet` in the band path**: The band path passes `mergeHeaderSet` to `applyExportMerges()` and `styleExportSheet()` for API consistency, but column merges are not applicable in the band layout. The band layout's column set (match label + band column labels) is constructed by `buildBandColumnLayout()` and does not correspond to user-configurable merged columns in `state.mergedCols`. Any entries in `mergeHeaderSet` will not match band layout headers, so `applyExportMerges()` is effectively a no-op for band exports. This is by design — band layout columns are not user-mergeable.

## Export Layout

### Column Structure

The exported sheet has `1 + N` columns where N is the number of unique band column labels across all enabled bands:

| Column 0 | Column 1 | Column 2 | ... | Column N |
|----------|----------|----------|-----|----------|
| Match Col | Band Col 1 | Band Col 2 | ... | Band Col N |

- **Column 0**: The match column — shows the parent key value on every row
- **Columns 1..N**: The union of all enabled bands' column labels, deduplicated

### Row Types

| Row Type | Kind | Column 0 (Match) | Columns 1..N (Band Cols) |
|----------|------|-------------------|---------------------------|
| Header row | — | Match column label | Band column labels |
| Parent row | 5 | Match value | Empty |
| Section header | 4 | Match value | This band's column display names (others empty) |
| Band data row | 0 | Match value | This band's column values (others empty) |
| Grand total | 3 | Empty or 'TOTAL' | Empty or aggregate values |

### Example: 2 Bands, Different Widths

Parent cols: `[OrderId, Company, Date]`
Band A (`band_0`): 3 cols `[_band_0_Product, _band_0_Quantity, _band_0_Price]`
Band B (`band_1`): 1 col `[_band_1_Note]`

**Sheet** (5 columns = 1 match + 4 unique band labels):
```
| Order ID | Product | Quantity | Price | Note |
| ORD-1    |         |          |       |      |  ← parent (kind 5)
| ORD-1    | Product | Quantity | Price |      |  ← section header band_0 (kind 4)
| ORD-1    | Widget  | 5        | 10.00 |      |  ← band data (kind 0, tint 0)
| ORD-1    | Gadget  | 2        | 15.00 |      |  ← band data (kind 0, tint 0)
| ORD-1    |         |          |       | Note |  ← section header band_1 (kind 4)
| ORD-1    |         |          |       | Rush |  ← band data (kind 0, tint 1)
| ORD-2    |         |          |       |      |  ← parent (kind 5)
| ORD-2    | Product | Quantity | Price |      |  ← section header band_0 (kind 4)
| ORD-2    | Sprocket| 1        | 22.50 |      |  ← band data (kind 0, tint 0)
| ORD-2    |         |          |       | Note |  ← section header band_1 (kind 4)
| ORD-2    |         |          |       | Rush |  ← band data (kind 0, tint 1)
```

Note: Band B's section header shows "Note" in position 4 (its column's position in the header). Positions 1-3 are empty on Band B's rows because Band B only has 1 column.

### Example: Bands with Different Match Columns

Band A: `keyPairs[0].left = 'OrderId'`
Band B: `keyPairs[0].left = 'CustomerId'`

This works because each band group independently reads its own match column from parent rows. The header uses the first band's match alias label. Each band group's section headers and data rows show the match value from that band's key column.

## Styling: Row Kind 5 (Band Parent Row)

Parent rows in the band layout are group headers — they introduce a new parent entity and are followed by its band rows. They need visual weight between the band section header (kind 4, bold italic blue) and band data rows (kind 0, normal with tint).

**Kind 5 styling:**
- Font: bold, normal weight (not italic), base color (`FF111827`)
- Fill: very subtle gray (`FFF8FAFC` — slate-50, already in the band tint palette)
- Border: thin bottom border (same as kind 4)
- Alignment: left/center

This gives parent rows a subtle "header" feel without the blue color reserved for band section headers. The visual hierarchy is:

```
Kind 5 (parent):   bold, slate-50 fill, bottom border     ← group header
Kind 4 (section):  bold italic blue, blue-100 fill        ← column name row
Kind 0 (data):     normal, band tint fill                  ← data values
```

### Merge Logic for Match Column

**Decision: Do NOT merge the match column** (see OQ-4). Each row explicitly shows the match value, which improves readability when scrolling through a long band section. The match value on section header rows reinforces which parent the band belongs to.

This means `applyExportMerges()` does NOT need modification. The existing merge logic continues to work for any user-configured merged columns within kind-0 rows.

## Design Goals

1. **Compact readability**: The exported sheet shows only the information that matters — the parent key value and the band's own columns — instead of a wide superset with many null cells.
2. **Visual hierarchy**: Three distinct row styles (parent group header, band section header, band data) make the parent-child structure immediately scannable.
3. **Zero configuration**: The band layout activates automatically when detail bands are present. No toggle, no preference, no user action required.
4. **Format consistency**: The same row structure is produced regardless of output format. CSV, XLSX, and any future format all receive the same compact layout.
5. **Composable transformations**: Each band group is an independent pure function. Multiple bands compose sequentially without coordination.
6. **Test isolation**: New code is fully covered by new tests. Existing tests are not modified — they validate the non-band export path.

## Constraints

1. No engine, query, catalog, or UI component changes — pure export formatting in `export.ts`
2. Existing export must not break for non-band reports (reports without detail bands take the same code path as today)
3. All existing tests in `export-bands.test.ts` must continue passing
4. `styleExportSheet()` changes are additive — new kind 5 handling does not alter kinds 0-4
5. `applyExportMerges()` is NOT modified — match column is not merged (see OQ-4)
6. Column labels resolve through existing `hdrMap` (from `buildExportHeaderMap`) — no new label resolution logic
7. The match column for each band group is always `keyPairs[0].left` — multi-key bands use only the first key pair's left alias for match value tracking
8. No new state properties, no serialization/hydration changes, no STATE_VERSION bump
9. Band rows from the engine have null for all parent columns (including the match alias) — match value must come from the preceding parent row
10. `_sort_group_*` columns (used for group/subtotal ordering in superset columns) are implicitly excluded from band column sets — the `_{bandId}_` prefix filter in `computeBandColSets()` only matches band-specific columns, not sort or grouping columns. Band layout only activates for detail bands, so these columns never appear in band results.

## Testing Strategy

### New Test Cases (in `export-bands.test.ts`)

#### computeBandColSets() — ~4 tests
| Test | Description |
|------|-------------|
| Returns per-band column arrays | Band with cols ['Product', 'Qty'] → `['_band_0_Product', '_band_0_Qty']` |
| Preserves column order from band.cols | Order matches `band.cols` array order |
| Skips disabled bands | Disabled band not in result |
| Handles empty cols | Band with `cols: []` → empty array for that band |

#### applyBandGroup() — ~10 tests
| Test | Description |
|------|-------------|
| Single band, single parent | 1 parent + 2 band rows → compact layout with section header |
| Multiple parents, single band | 2 parents each with band rows → match value changes correctly |
| Multiple bands, only this band transformed | Band A rows transformed, Band B rows pass through unchanged |
| Parent rows get compact format | Parent row → match col populated, band cols empty, `_processed: true` |
| Section header has display names | Section header → match col + band column display names in correct positions |
| Band data rows have values | Data row → match col + band column values in correct positions |
| Match value propagates to band rows | Band rows use parent's match value (not null) |
| Other band rows pass through | Rows with different `_band_id` are not modified |
| Already-processed rows pass through | Rows with `_processed: true` are not re-processed |
| Empty band (no rows for this band) | No section headers or data rows emitted for this band |

#### buildBandColumnLayout() — ~10 tests
| Test | Description |
|------|-------------|
| Single band, single parent | 1 parent + 2 band rows → correct column layout |
| Multiple parents, single band | 2 parents each with band rows → match value changes correctly |
| Multiple bands, same parent | Parent with band_0 and band_1 rows → section headers for each |
| Variable band widths | Band A: 3 cols, Band B: 1 col → sheet width = 5 (1 + 4 unique labels) |
| Parent rows have empty band columns | Parent row → col 0 = match value, cols 1+ = '' |
| Band section header has display names | Section header → col 0 = match value, band cols = display names |
| Band data rows have values | Data row → col 0 = match value, band cols = row values |
| Match value propagates to all band rows | All band rows use parent's match value (not null) |
| Totals row handling | Totals row at end → kind 3, all columns empty |
| Empty data rows | No rows → empty output |
| Column labels from hdrMap | Display names resolved via hdrMap, not raw aliases |
| Bands with different match columns | Band A uses OrderId, Band B uses CustomerId → both work independently |

#### styleExportSheet kind 5 — ~4 tests
| Test | Description |
|------|-------------|
| Kind 5 has bold font | Font is bold, not italic |
| Kind 5 has subtle fill | Fill is slate-50 (`FFF8FAFC`) |
| Kind 5 has bottom border | Thin bottom border like kind 4 |
| Kind 5 does not affect other kinds | Kind 0, 1, 3, 4 styling unchanged |

#### exportAs() band layout integration — ~4 tests
| Test | Description |
|------|-------------|
| Band layout activates for valid band config | Mock store with bands → compact layout produced |
| Band layout for CSV | CSV format → same compact layout, no `_band_id` column in output |
| Non-band path for no bands | No detail bands → existing non-band export path |
| Band layout with multiple bands | 2 bands → both section headers present in output |

### Test Pattern

All new tests follow the existing pattern in `export-bands.test.ts`:
- Pure function tests for `computeBandColSets`, `applyBandGroup`, `buildBandColumnLayout`
- Sheet-based tests for `styleExportSheet` kind 5 (using `makeSheet()` helper)
- Integration tests mock the store via `initStore()` + `getStore().update()`

### Verification

Run `npm test` — all existing + new tests pass.
Run `npm run typecheck` — zero errors.
Run `npm run lint` — zero warnings.

## Open Questions

### OQ-1: Band Section Header Column Alignment for Narrow Bands

**Question**: When Band A has 3 columns and Band B has 1 column, Band B's section header shows its column name in its position (e.g., position 4 if Band A occupies positions 1-3). Positions 1-3 are empty. Should Band B's column name span all available columns instead?

**Current design**: Each band's column names appear in their natural positions within the header. Band B's column name is in position 4, matching where Band B's data values appear. Positions 1-3 are empty strings.

**Alternative**: Merge the section header cells across all available columns for narrow bands, centering the label. This is more visually distinct but adds merge complexity.

**Recommendation**: Position-aligned (current design). Simpler, consistent with how band data is positioned, and the kind 4 styling already makes section headers visually distinct.

### OQ-2: Totals Row in Band Layout

**Question**: How should the grand totals row appear in the band layout? The totals row in the non-band export has values in aggregate columns. In the band layout, the column set is different (match + band cols, not parent cols). Totals for band columns may not make sense.

**Options**:
- A) Show totals row with match column = 'TOTAL' or empty, band columns = aggregated values if applicable
- B) Omit totals row in band layout (totals don't make sense for detail band data)
- C) Show totals row only for the match column (count of parents, etc.)

**Recommendation**: Option A — include the totals row if present, with whatever values the engine provides. The existing kind 3 styling applies. If the totals row has null for all band columns (likely), it will appear as a row with empty column 0 and empty cells elsewhere, styled as a grand total. This preserves existing behavior without special-casing.

### OQ-4: Match Column Vertical Merge Behavior

**Question**: Should the match column be vertically merged? The match value repeats on parent + section header + data rows for the same parent. Merging would reduce visual repetition.

**Consideration**: The existing `applyExportMerges()` merges cells with the same value in consecutive rows. For the match column, the same value appears on kind 5 (parent), kind 4 (section header), and kind 0 (data) rows. Merging across these row kinds would require extending the merge logic.

**Recommendation**: Do NOT merge the match column. Each row explicitly shows the match value, which improves readability when scrolling through a long band section. The match value on section header rows reinforces which parent the band belongs to. Merging would hide this context. This also simplifies implementation — no changes to `applyExportMerges()`.

### OQ-5: Multiple Key Pairs

**Question**: When a band has multiple key pairs (composite key), the band layout uses only `keyPairs[0].left` for the match column. Is this sufficient?

**Current design**: Yes — column 0 shows the first key pair's parent value. Additional key pairs are not shown in the match column. The band section header and data rows show only band columns.

**Recommendation**: Keep using `keyPairs[0].left` for column 0. Composite keys are rare in practice. If needed, additional key values could be added as extra columns before the band columns in a future iteration.

## Appendix: Research Findings

### Key Patterns Discovered

1. **`padBandRow()` null-pads parent columns** (`engine.ts:212-223`): Band rows have `null` for ALL parent columns, including the match column alias (`keyPairs[0].left`). The band layout must extract the match value from the preceding parent row during export formatting — it cannot be read from the band row itself.

2. **`interleaveRows()` ordering guarantee** (`engine.ts:231-260`): The engine guarantees the order: parent row → band A rows → band B rows → next parent row. This is what makes the per-band-group transformation algorithm work — band rows for a given parent are contiguous and follow their parent.

3. **Band column prefixes** (`engine.ts:447-453`): Band column aliases follow the `_{bandId}_` prefix pattern (e.g., `_band_0_Product`). `computeBandColSets()` uses this prefix to identify which columns belong to which band.

4. **`hdrMap` resolves band column labels correctly** (`utils.ts:274-282`): `colExportLabel()` for a band column alias like `_band_0_Product` resolves through the colMap to `colUserLabel(band.rightId, 'Product')`, producing a human-readable label. The existing `buildExportHeaderMap()` already handles this — no new label resolution needed.

5. **`applyExportMerges()` only merges kind-0 rows** (`export.ts:222-223`): The merge loop skips non-zero row kinds. Since we decided NOT to merge the match column (OQ-4), no changes to this function are needed.

6. **Row kind 4 already creates cells if missing** (`export.ts:379-382`): The kind 4 styling branch creates cells that don't exist (`if (!cell) { cell = { t: 's', v: '' }; ws[addr] = cell; }`). This pattern should be followed for kind 5 as well.

7. **Band tint palette has 5 colors** (`export.ts:71-77`): The `BAND_TINT_PALETTE` cycles through 5 subtle colors. Band data rows (kind 0) receive tints based on their band index.

8. **`enrichRowsWithBandHeaders()` is for the non-band path** (`export.ts:89-124`): This function inserts section headers into the superset-column row stream for non-band reports that happen to have `_band_id` tagged rows. The band layout path uses `buildBandColumnLayout()` instead — a separate code path for band reports.

### Reusable Components

| Component | Location | Reuse For |
|-----------|----------|----------|
| `buildExportHeaderMap()` | `core/utils.ts:291` | hdrMap for column labels (already used in exportAs) |
| `buildBandLabels()` | `ui/export.ts:55` | Band label resolution (already exists) |
| `BAND_TINT_PALETTE` | `ui/export.ts:71` | Band data row tints (already exists) |
| `filterExportCols()` | `ui/export.ts:44` | Column filtering (already exists) |
| `makeSheet()` test helper | `tests/ui/export-bands.test.ts:40` | Test sheet construction (already exists) |

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Match value not available for first row if it's a band row | Medium | Engine guarantees parent rows precede their band rows in interleaved mode. Defensive: if `currentMatchValue` is null on a band row, use empty string. |
| `band.cols` order doesn't match catalog order | Low | `computeBandColSets()` uses `band.cols` order (user's selection order), not catalog order. This matches the user's intent. |
| hdrMap collision for band columns across bands | Low | `buildExportHeaderMap()` already deduplicates with numeric suffixes. If Band A and Band B both have a 'Date' column, they become 'Date' and 'Date 2' in hdrMap. |
| Performance with many rows and wide bands | Low | O(rows × bandCount × maxBandWidth) is linear in each dimension. For 5,000 rows × 3 bands × 10 columns = 150,000 cell operations — negligible. |
| Composition order affects output | Low | Band groups are composed in `detailBands` array order (insertion order). Each band group's section headers appear in the order the bands are defined. This is deterministic and predictable. |
