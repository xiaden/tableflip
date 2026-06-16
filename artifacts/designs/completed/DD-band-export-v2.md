# Detail Bands Export Layout — Design Document (v2)
Status: Draft  
Author: rnd-dd-author  
Created: 2026-06-14  
Revised: 2026-06-15  

Related Documents:
- [Subreport Detail Rows — Design Document](artifacts/designs/completed/DD-subreport-detail-rows.md) — Original detail bands design — Section 9 covers export basics (section headers, row kind 4, _band_id filtering). This document defines the parent-column-aligned layout for band exports.
- [Export Bands Test Suite](SRC/preact/tests/ui/export-bands.test.ts) — Test file covering export band behavior.
- [Export Logic Module](SRC/preact/ui/export.ts) — Main export module — contains `enrichRowsWithBandHeaders()`, `styleExportSheet()`, `applyExportMerges()`, and `exportAs()`.

## Scope

### In Scope
- `buildBandColumnLayout()` pure function in `export.ts` — transforms interleaved result rows into parent-column-aligned layout with band section headers and data rows
- `computeBandColSets()` helper in `export.ts` — extracts per-band column alias arrays from superset columns
- `applyBandGroup()` pure function in `export.ts` — composable per-band-group row transformation
- Integration in `exportAs()` — dispatches to band layout when detail bands are present
- Row kind 5 in `styleExportSheet()` — styling for band parent rows
- Tests in `export-bands.test.ts` — covering all band export functions and integration

### Out of Scope
- Engine or query layer changes (no changes to `engine.ts`, `sql-detail-bands.ts`, or result set shape)
- Catalog layer changes (no changes to column catalog or column source map)
- UI component changes (no new toggles, preferences, or state properties)
- Multi-sheet export (deferred to future design)
- AG Grid rendering changes (grid display is unchanged)
- `applyExportMerges()` modifications (match column is not merged — see OQ-4)

## Problem Statement

The current XLSX export for detail band reports uses a compact column layout with a match column followed by band column labels. This removes parent column context from the exported sheet — parent rows are collapsed to just the match value, and the sheet header shows band column names instead of the original parent column names. Users lose the ability to see parent column values (like Company, Amount) aligned with their original column headers.

The correct approach preserves parent columns as the organizing frame of the sheet. Parent rows pass through with all columns populated under their original headers. Band data is inserted into the same column positions (columns 2+), with band section headers relabeling those positions to show band column names. This maintains the parent column context while clearly communicating the parent-child relationship through section headers and visual styling.

## Architecture

### Approach: Parent-Column-Aligned Layout with Composable Band Group Transformations

The band export layout preserves parent columns as the sheet header and organizing frame. Band data is overlaid into parent column positions through a "relabeling" concept:

1. **Sheet header** = parent column labels (from `buildExportHeaderMap`)
2. **Parent rows** pass through with all parent columns populated
3. **Band section headers**: column 0 = match value (from parent's first column), columns 1+ = band column display names (relabeling parent column positions)
4. **Band data rows**: column 0 = empty, columns 1+ = band column values (in parent column positions)
5. **Sheet width** = number of parent columns (P), unless a band has more columns than P-1, in which case extra columns are appended (total width = 1 + N where N is the widest band's column count)

The **relabeling concept** means that during a band section, the parent column headers at positions 1+ are temporarily replaced by band column names in the section header row. For example, if parent columns are [Order ID, Company, Amount] and a band has columns [Product, Qty], the section header row shows [ORD-1, Product, Qty] — the "Company" and "Amount" positions are relabeled with "Product" and "Qty". The sheet header row (first row) always shows the original parent column names.

The band export layout is produced by a pipeline of pure transformations. Each enabled band group is a pure function that takes an array of rows and returns a transformed array:

```
Each band group: (rows: Row[]) → Row[]
Multiple bands:  result = bandB(bandA(initialRows))
```

The input is the raw interleaved result from the engine's `interleaveRows()`: parent rows (with `_band_id == null`) followed by their matching band rows (with `_band_id` set). Each band group transformation:

1. Walks through all rows, tracking the parent's match column value (from `keyPairs[0].left`)
2. Collects its own band rows (identified by `_band_id === thisBandId`)
3. At group boundaries, inserts:
   - A **section header row**: match value in col 0 + band column display names in cols 1+
   - **Band data rows**: empty in col 0 + band column values in cols 1+
4. Passes parent rows through with all parent column values (marked as processed)
5. Passes through rows from other band groups unchanged (marked as processed to prevent re-processing)

### Layer Mapping

| Component | Layer | File | Responsibility |
|-----------|-------|------|----------------|
| `applyBandGroup()` | UI (export) | `preact/ui/export.ts` | Per-band-group row transformation — inserts section headers and band data rows relabeled into parent column positions, passes parent rows through |
| `buildBandColumnLayout()` | UI (export) | `preact/ui/export.ts` | Orchestrates composition of all band group transformations, builds parent-column-aligned header array |
| `exportAs()` integration | UI (export) | `preact/ui/export.ts` | Detect band presence, dispatch to band layout path |
| `styleExportSheet()` extension | UI (export) | `preact/ui/export.ts` | Handle row kind 5 (band parent row) styling |
| `computeBandColSets()` | UI (export) | `preact/ui/export.ts` | Extract per-band ordered column alias arrays from superset columns |

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
  ├── Identify parent column aliases (non-band, non-internal cols from allCols)
  │     parentCols: ['OrderId', 'Company', 'Amount']
  │
  ├── Build header array:
  │     parentLabels = parentCols.map(c => hdrMap[c] || c)
  │     headers = [...parentLabels]
  │     maxBandWidth = max of all enabled band column counts
  │     if maxBandWidth > parentLabels.length - 1:
  │       extraLabels = widest band's cols beyond (P-1), mapped via hdrMap
  │       headers.push(...extraLabels)
  │
  ├── Compose band group transformations:
  │     rows = initialRows (from engine, with totals row appended if present)
  │     for each enabled band:
  │       rows = applyBandGroup(rows, band, matchAlias, bandColAliases, headers, hdrMap)
  │
  ├── Result: { cleanRows, rowKinds, headers, bandIds }
  │
  ├── json_to_sheet(cleanRows, { header: headers })
  │
  ├── applyExportMerges(ws, cleanRows, rowKinds, headers, mergeHeaderSet)
  │
  └── styleExportSheet(ws, cleanRows, rowKinds, mergeHeaderSet, bandIds)
        └── Kind 5 (parent): bold, subtle fill
            Kind 4 (band section header): existing bold italic blue
            Kind 0 (band data): existing band tint
```

### Format Consistency

The exported data structure is identical regardless of output format (CSV, XLSX, or any future format). The `buildBandColumnLayout()` function produces the same `cleanRows`, `rowKinds`, `headers`, and `bandIds` arrays for all formats. There is no format-specific branching in the data structure.

`_band_id` is NOT an output column in any format. It exists only internally on band data rows for tint color assignment in `styleExportSheet()`. The `bandIds` array is extracted from these internal markers for the styling function, but `_band_id` does not appear in the `headers` array or the `cleanRows` output. Visual grouping is achieved through section headers (kind 4) and match values on section headers, not through a `_band_id` column.

Format-specific behavior is limited to serialization:
- **XLSX**: Styling and merges are applied via `styleExportSheet()` and `applyExportMerges()`.
- **CSV**: No styling or merges. The same row structure is serialized as comma-separated values.

## Algorithm

### applyBandGroup()

The core transformation function. Takes the current row array and produces a new array where this band group's rows are in parent-column-aligned format.

```typescript
function applyBandGroup(
  rows: Record<string, unknown>[],
  bandId: string,
  matchAlias: string,
  bandColAliases: string[],
  allHeaders: string[],
  hdrMap: Record<string, string>,
): Record<string, unknown>[]
```

**Algorithm:**

```
matchLabel = allHeaders[0]  // first header is always the match column

// Build lookup: band column index → band col alias
// Band columns fill header positions 1, 2, 3, ... in order
thisBandColByPosition = {}
for i, colAlias in enumerate(bandColAliases):
  label = hdrMap[colAlias] || colAlias
  // Strip _band_N_ prefix if hdrMap returned identity for band column
  if label starts with '_band_':
    label = label with prefix stripped
  thisBandColByPosition[i] = colAlias

result = []
currentMatchValue = null
collectedBandRows = []

function flushCollected():
  if collectedBandRows.length == 0: return

  // Section header row: match value + band display names in parent positions
  headerRow = { _processed: true, _rowKind: 4 }
  headerRow[matchLabel] = currentMatchValue
  for i, colAlias in enumerate(bandColAliases):
    headerPosition = i + 1  // cols 1+ (0-indexed)
    if headerPosition < allHeaders.length:
      displayLabel = hdrMap[colAlias] || colAlias
      if displayLabel starts with '_band_':
        displayLabel = displayLabel with prefix stripped
      headerRow[allHeaders[headerPosition]] = displayLabel
  result.push(headerRow)

  // Band data rows: empty col 0 + band values in parent positions
  for row in collectedBandRows:
    dataRow = { _processed: true, _rowKind: 0, _band_id: bandId }
    dataRow[matchLabel] = ''  // empty first column
    for i, colAlias in enumerate(bandColAliases):
      headerPosition = i + 1
      if headerPosition < allHeaders.length:
        dataRow[allHeaders[headerPosition]] = row[colAlias] ?? ''
    result.push(dataRow)

  collectedBandRows = []

for each row in rows:
  if row._processed:
    // Already transformed by a previous band group — pass through
    if row._rowKind === 5:
      // Parent row from previous band — flush and update match value
      flushCollected()
      val = row[matchLabel] ?? row[matchAlias]
      if val != null: currentMatchValue = val
    result.push(row)
    continue

  if row._isTotalsRow:
    flushCollected()
    result.push(row)
    continue

  if row._band_id == null:
    // Parent row — flush collected, pass through with all columns
    flushCollected()
    currentMatchValue = row[matchAlias]
    row._processed = true
    row._rowKind = 5
    // Fill appended columns (beyond parent width) with empty
    for h in allHeaders:
      if row[h] == null: row[h] = ''
    result.push(row)

  else if String(row._band_id) === bandId:
    collectedBandRows.push(row)

  else:
    flushCollected()
    result.push(row)

flushCollected()
return result
```

**Key properties:**

1. **`_processed` flag**: Synthetic rows (section header, band data) and marked parent rows carry `_processed: true`. Subsequent band group transformations pass these through unchanged. This is what makes composition work.

2. **Deferred emission**: Band rows are collected until the group boundary is reached. Then the section header + data rows are emitted in a batch.

3. **Match value tracking**: `currentMatchValue` is set when a parent row is encountered. All subsequent section headers use this value.

4. **Parent row pass-through**: Parent rows retain all their original column values. They are marked with `_processed: true` and `_rowKind: 5` but otherwise unchanged. Appended columns (beyond parent width) are filled with empty strings.

5. **Positional band column mapping**: Band columns fill header positions 1, 2, 3, ... in order. Band col 0 → header position 1, band col 1 → header position 2, etc.

6. **`_band_id` on data rows**: Band data rows carry `_band_id` for tint color assignment in `styleExportSheet()`.

7. **`_rowKind` on synthetic rows**: Kind 5 = band parent row, Kind 4 = band section header, Kind 0 = band data row.

### buildBandColumnLayout()

The orchestrator function. Builds the parent-column-aligned header array, composes all band group transformations, and extracts the final output arrays.

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
if enabledBands.length == 0:
  return { cleanRows: dataRows, rowKinds: [0, 0, ...], headers: [], bandIds: ['', ...] }

bandColSets = computeBandColSets(detailBands, allCols)

// Identify parent column aliases (non-band, non-internal columns)
bandPrefixes = enabledBands.map(b => '_' + b.id + '_')
internalPrefixes = ['_rowno', '_row_type', '_isTotalsRow', '_band_id', '_sort_row_type']
parentColAliases = allCols.filter(c =>
  !bandPrefixes.some(p => c.startsWith(p)) &&
  !internalPrefixes.includes(c) &&
  !c.startsWith('_sort_group_')
)

// Build header array from parent column labels
parentLabels = parentColAliases.map(c => hdrMap[c] || c)
headers = [...parentLabels]

// Determine if any band is wider than parent positions available
P = parentLabels.length
maxBandWidth = max of bandColSets[band.id].length for all enabled bands
if maxBandWidth > P - 1:
  widestBand = enabled band with most columns
  widestBandCols = bandColSets[widestBand.id]
  for i from (P - 1) to widestBandCols.length - 1:
    colAlias = widestBandCols[i]
    label = hdrMap[colAlias] || colAlias
    if label starts with '_band_': label = label with prefix stripped
    headers.push(label)

matchAlias = enabledBands[0].keyPairs[0]?.left

rows = dataRows
for each band in enabledBands:
  bandColAliases = bandColSets[band.id] || []
  bandMatchAlias = band.keyPairs[0].left || matchAlias || ''
  rows = applyBandGroup(rows, band.id, bandMatchAlias, bandColAliases, headers, hdrMap)

cleanRows = rows.map(row => {
  out = {}
  for h in headers: out[h] = row[h] ?? ''
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

**Note on parent column identification**: Parent columns are identified by excluding band-prefixed columns (`_{bandId}_`), internal system columns, and sort/group columns. The remaining columns are parent columns in their original order from `allCols`.

**Note on header extension**: When a band has more columns than P-1, extra columns are appended to the header array. The extra column labels come from the widest band's column display names (via hdrMap).

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
  ordered = band.cols.map(c => prefix + c).filter(c => bandCols.includes(c))
  for c in bandCols:
    if !ordered.includes(c): ordered.push(c)
  result[band.id] = ordered
return result
```

### exportAs() Integration

The band layout path in `exportAs()` activates when detail bands are present. There is no fallback logic — the band layout is the only export path for band reports.

```typescript
const enabledBands = (state.detailBands || []).filter(b => b.enabled !== false && b.rightId);

if (enabledBands.length > 0) {
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
  return;
}
```

**Note on `mergeHeaderSet` in the band path**: The band path passes `mergeHeaderSet` to `applyExportMerges()` and `styleExportSheet()` for API consistency. In the parent-column-aligned layout, parent column headers may overlap with user-configured merged columns. The merge logic applies to kind-0 rows only.

## Export Layout

### Column Structure

The exported sheet has `P` columns where P is the number of parent columns, or `1 + N` columns if the widest band has N columns where N > P-1:

| Column 0 | Column 1 | Column 2 | ... | Column P-1 | [Column P] | ... |
|----------|----------|----------|-----|------------|------------|-----|
| First parent col | Second parent col | Third parent col | ... | Last parent col | [Appended if band wider] | ... |

- **Column 0**: The first parent column — shows the parent key value on parent rows and section header rows, empty on band data rows
- **Columns 1..P-1**: Remaining parent columns — show parent values on parent rows, band display names on section headers, band values on data rows
- **Columns P+**: Appended columns (only if a band has more columns than P-1) — show band display names on section headers, band values on data rows

### Row Types

| Row Type | Kind | Column 0 (First Parent) | Columns 1+ (Remaining Parent / Appended) |
|----------|------|--------------------------|-------------------------------------------|
| Header row | — | First parent column label | Remaining parent column labels [+ appended band labels] |
| Parent row | 5 | First parent column value | Remaining parent column values [+ empty for appended] |
| Section header | 4 | Match value | Band column display names (relabeling parent positions) [+ appended band labels] |
| Band data row | 0 | Empty | Band column values (in parent positions) [+ appended band values] |
| Grand total | 3 | Empty or 'TOTAL' | Empty or aggregate values |

### Example: Single Band, 3 Parent Cols

Parent cols: `[OrderId, Company, Amount]`
Band A (`band_0`): 2 cols `[_band_0_Quantity, _band_0_Price]`

**Sheet** (3 columns = parent column count):
```
| Order ID | Company  | Amount |
| ORD-1    | Acme     | 100    |  ← parent row (kind 5, all columns populated)
| ORD-1    | Quantity | Price  |  ← section header (kind 4, band col names in parent positions)
|          | 5        | 10.00  |  ← band data (kind 0, band values in parent positions)
| ORD-2    | BetaCorp | 200    |  ← parent row (kind 5)
| ORD-2    | Quantity | Price  |  ← section header (kind 4)
|          | 3        | 22.50  |  ← band data (kind 0)
```

### Example: Band Wider Than Parent (3 Parent Cols, Band Has 4 Cols)

Parent cols: `[OrderId, Company, Amount]`
Band A (`band_0`): 4 cols `[_band_0_Product, _band_0_Qty, _band_0_Price, _band_0_Note]`

**Sheet** (5 columns = 1 + 4, because band has 4 cols > P-1 = 2):
```
| Order ID | Company | Amount | Price | Note |
| ORD-1    | Acme    | 100    |       |      |  ← parent (kind 5, appended cols empty)
| ORD-1    | Product | Qty    | Price | Note |  ← section header (band labels fill cols 1-2, cols 3-4 appended)
|          | Widget  | 5      | 10.00 | Rush |  ← band data (band values in cols 1-4)
```

Note: The first 2 band columns (Product, Qty) fill parent column positions 1-2 (Company, Amount). The remaining 2 band columns (Price, Note) are appended as extra columns beyond the parent width.

### Example: 2 Bands

Parent cols: `[OrderId, Company, Amount]`
Band A (`band_0`): 2 cols `[_band_0_Product, _band_0_Qty]`
Band B (`band_1`): 1 col `[_band_1_Note]`

**Sheet** (3 columns = parent column count, since max band width 2 ≤ P-1 = 2):
```
| Order ID | Company  | Amount |
| ORD-1    | Acme     | 100    |  ← parent (kind 5)
| ORD-1    | Product  | Qty    |  ← band_0 section header (kind 4)
|          | Widget   | 5      |  ← band_0 data (kind 0, tint 0)
| ORD-1    | Note     |        |  ← band_1 section header (kind 4)
|          | Rush     |        |  ← band_1 data (kind 0, tint 1)
| ORD-2    | BetaCorp | 200    |  ← parent (kind 5)
| ORD-2    | Product  | Qty    |  ← band_0 section header (kind 4)
|          | Sprocket | 1      |  ← band_0 data (kind 0, tint 0)
| ORD-2    | Note     |        |  ← band_1 section header (kind 4)
|          | Standard |        |  ← band_1 data (kind 0, tint 1)
```

Note: Band B has only 1 column, so its section header shows "Note" in position 1 and leaves position 2 empty. Band data rows similarly have empty cells for positions beyond the band's column count.

### Example: Bands with Different Match Columns

Band A: `keyPairs[0].left = 'OrderId'`
Band B: `keyPairs[0].left = 'CustomerId'`

This works because each band group independently reads its own match column from parent rows. The sheet header uses the first parent column. Each band group's section headers show the match value from that band's key column in column 0.

## Styling: Row Kind 5 (Band Parent Row)

Parent rows in the band layout are group headers — they introduce a new parent entity and are followed by its band rows. They need visual weight between the band section header (kind 4, bold italic blue) and band data rows (kind 0, normal with tint).

**Kind 5 styling:**
- Font: bold, normal weight (not italic), base color (`FF111827`)
- Fill: very subtle gray (`FFF8FAFC` — slate-50, already in the band tint palette)
- Border: thin bottom border (same as kind 4)
- Alignment: left/center

This gives parent rows a subtle "header" feel without the blue color reserved for band section headers. The visual hierarchy is:

```
Kind 5 (parent):   bold, slate-50 fill, bottom border     ← group header (all parent cols populated)
Kind 4 (section):  bold italic blue, blue-100 fill        ← column name row (band labels relabeled)
Kind 0 (data):     normal, band tint fill                  ← data values (band values in parent positions)
```

### Merge Logic for Match Column

**Decision: Do NOT merge the match column** (see OQ-4). Each section header row explicitly shows the match value, which improves readability when scrolling through a long band section. The match value on section header rows reinforces which parent the band belongs to.

This means `applyExportMerges()` does NOT need modification for the match column. The existing merge logic continues to work for any user-configured merged columns within kind-0 rows.

## Design Goals

1. **Parent column context**: The exported sheet preserves parent column headers and values, so users can see parent data (Company, Amount, etc.) aligned with their original column names.
2. **Visual hierarchy**: Three distinct row styles (parent group header, band section header, band data) make the parent-child structure immediately scannable.
3. **Zero configuration**: The band layout activates automatically when detail bands are present. No toggle, no preference, no user action required.
4. **Format consistency**: The same row structure is produced regardless of output format. CSV, XLSX, and any future format all receive the same parent-column-aligned layout.
5. **Composable transformations**: Each band group is an independent pure function. Multiple bands compose sequentially without coordination.
6. **Test isolation**: New code is fully covered by new tests. Existing tests are not modified — they validate the non-band export path.

## Constraints

1. No engine, query, catalog, or UI component changes — pure export formatting in `export.ts`
2. Existing export must not break for non-band reports (reports without detail bands take the same code path as today)
3. All existing tests in `export-bands.test.ts` must continue passing
4. `styleExportSheet()` changes are additive — new kind 5 handling does not alter kinds 0-4
5. `applyExportMerges()` is NOT modified for match column merging (see OQ-4)
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
| Single band, single parent | 1 parent + 2 band rows → parent passes through + section header + data rows |
| Multiple parents, single band | 2 parents each with band rows → match value changes correctly |
| Multiple bands, only this band transformed | Band A rows transformed, Band B rows pass through unchanged |
| Parent rows pass through with all columns | Parent row retains all parent column values, `_processed: true`, kind 5 |
| Section header has display names in parent positions | Section header → col 0 = match value, cols 1+ = band column display names |
| Band data rows have values in parent positions | Data row → col 0 = empty, cols 1+ = band column values |
| Match value propagates to section headers | Section headers use parent's match value (not null) |
| Other band rows pass through | Rows with different `_band_id` are not modified |
| Already-processed rows pass through | Rows with `_processed: true` are not re-processed |
| Empty band (no rows for this band) | No section headers or data rows emitted for this band |

#### buildBandColumnLayout() — ~10 tests
| Test | Description |
|------|-------------|
| Single band, single parent | Headers = parent column labels, correct row structure |
| Multiple parents, single band | Match value changes correctly across parents |
| Multiple bands, same parent | Parent with band_0 and band_1 rows → section headers for each |
| Sheet width = parent column count | 3 parent cols, 2-col band → 3 columns |
| Parent rows have all parent column values | Parent row → all parent cols populated, appended cols empty |
| Band section header has display names | Section header → col 0 = match value, cols 1+ = band display names |
| Band data rows have values in parent positions | Data row → col 0 = empty, cols 1+ = band values |
| Band wider than parent appends columns | 3 parent cols, 4-col band → 5 columns (1 + 4) |
| Totals row handling | Totals row at end → kind 3 |
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
| Band layout activates for valid band config | Mock store with bands → parent-column-aligned layout produced |
| Band layout for CSV | CSV format → same layout, no `_band_id` column in output |
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

**Question**: When Band A has 2 columns and Band B has 1 column, Band B's section header shows its column name in position 1, leaving position 2 empty. Should Band B's column name span all available columns instead?

**Current design**: Each band's column names appear starting at position 1 (after the match column). Band B's column name is in position 1, matching where Band B's data values appear. Remaining positions are empty strings.

**Alternative**: Merge the section header cells across all available columns for narrow bands, centering the label. This is more visually distinct but adds merge complexity.

**Recommendation**: Position-aligned (current design). Simpler, consistent with how band data is positioned, and the kind 4 styling already makes section headers visually distinct.

### OQ-2: Totals Row in Band Layout

**Question**: How should the grand totals row appear in the band layout? The totals row in the non-band export has values in aggregate columns. In the band layout, the column set is parent columns (not band columns). Totals for parent columns may or may not be meaningful.

**Options**:
- A) Show totals row with whatever values the engine provides in parent column positions
- B) Omit totals row in band layout (totals don't make sense for detail band data)
- C) Show totals row only for the first parent column (count of parents, etc.)

**Recommendation**: Option A — include the totals row if present, with whatever values the engine provides. The existing kind 3 styling applies. This preserves existing behavior without special-casing.

### OQ-4: Match Column Vertical Merge Behavior

**Question**: Should the first column (match column) be vertically merged? The match value repeats on parent rows and section header rows for the same parent. Merging would reduce visual repetition.

**Consideration**: The existing `applyExportMerges()` merges cells with the same value in consecutive kind-0 rows. For the first column, the same value appears on kind 5 (parent) and kind 4 (section header) rows, but these are not kind 0, so they are not merged by the existing logic.

**Recommendation**: Do NOT merge the first column. Each section header explicitly shows the match value, which improves readability when scrolling through a long band section. The match value on section header rows reinforces which parent the band belongs to. This also simplifies implementation — no changes to `applyExportMerges()`.

### OQ-5: Multiple Key Pairs

**Question**: When a band has multiple key pairs (composite key), the band layout uses only `keyPairs[0].left` for the match column. Is this sufficient?

**Current design**: Yes — column 0 shows the first key pair's parent value on section header rows. Additional key pairs are not shown in the match column.

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
| Parent column identification may include unexpected columns | Medium | Parent columns are identified by excluding band-prefixed, internal, and sort-group columns. If new internal column patterns are added, the exclusion list must be updated. |
