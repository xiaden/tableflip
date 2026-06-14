---
name: column-catalog-conventions
description: Column catalog building, buildColSourceMap vs buildColumnCatalog, and the known issue with duplicate column names across sheets. Use when working with column resolution, the catalog layer, or UI column display.
---

# Column Catalog Conventions

## Mental Model

The column catalog is the backbone of column resolution in TableFlip. There are **two parallel APIs** with very different behavior:

1. **`buildColSourceMap()`** — Store-based, UI-facing. Iterates ALL loaded tables, creating a flat `alias → {tid, col}` map. **Does NOT prefix duplicate column names** — last table wins.
2. **`buildColumnCatalog()`** — Pure, query-plan-facing. Takes explicit `reportSpec` + `sourceCatalog`, processes only base + lookup + detail-band + calc columns. **Prefixes lookup column names** on collision via `tablePrefix()`.

## Coverage

**Documented:** The two parallel APIs, the known `buildColSourceMap` overwrite bug, callers of each, test gaps.
**Not yet documented:** None known.
**Last extended:** 2026-06-14

## Key Findings

### 1. `buildColSourceMap()` overwrites duplicate column names

- **Location:** `SRC/preact/catalog/column-catalog.ts:L79-L98`
- **What:** Iterates `Object.keys(state.tables)` and calls `map.set(col, { tid, col })` for every column. If two tables have a column called "Amount", only the last-processed table survives.
- **Why it matters:** Every UI component that shows sheet attribution (grid headers, chip labels, tooltips, color stripes, filter/sort dropdowns) depends on this map. They all show the wrong source sheet for duplicate-named columns.

### 2. Old code (`ecdd777`) handled this correctly

- **Location:** `ecdd777:SRC/js/catalog/column-catalog.ts`
- **What:** The old `buildColSourceMap()` accepted an optional `ctx` with `{ base, lookups, calcStages }` and only processed base-table + lookup columns. Lookup columns got a `tablePrefix()` when their name collided with an existing entry.
- **Why it matters:** This was correct because only columns reachable via the current report config (base + lookups) appeared in the column map — unrelated tables never polluted it.

### 3. `buildColumnCatalog()` still handles prefixing correctly

- **Location:** `SRC/preact/catalog/column-catalog.ts:L115-L244`
- **What:** The pure-function version takes an explicit report spec and source catalog. It prefixes lookup columns (`tablePrefix()`) and detail-band columns (`_{bandId}_`).
- **Why it matters:** Query generation is correct. The bug is only in the UI display path.

### 4. All UI components use `buildColSourceMap()` for display

Callers include:
- `column-chips.tsx:L147` — chip labels, tooltips, color classes
- `layout-card.tsx:L80,125,132,210` — totals/subtotals/aggregate dropdowns
- `grid.tsx:L382,442` — AG Grid column headers with "Table → Column" labels
- `filter-list.tsx:L165`, `sort-list.tsx:L98` — filter/sort dropdowns
- `merge-toggles.tsx:L51` — merge display
- `lookup-stage.tsx:L82,124,289,298` — lookup key pickers
- `detail-band-stage.tsx:L83` — detail band pickers
- `calc-stage.tsx:L52`, `calc-builder.tsx:L232` — calc column pickers
- `export.ts:L152` — export header map
- `validation.ts:L122` — report validation
- `layout-selection.ts:L97,208,229` — column visibility management
- `utils.ts:L236` — `renameProjectedColumn()`

### 5. No tests cover the duplicate-column-name scenario

- The test `buildColSourceMap` should map columns from multiple tables (line 57) uses two tables with NON-overlapping column names («OrderId» and «Name»).
- There is no test where two tables share a column name like «Amount».
- The test for `buildColumnCatalog` covers prefixing (`Contacts__Company`), but the UI path is not tested.

## Critical Invariants

1. `buildColSourceMap()` MUST NOT be used for any display path that needs accurate sheet attribution when multiple tables have same-named columns.
2. The `colMap` from `buildColSourceMap()` has a 1:1 relationship between alias and source — it cannot represent two tables with the same column name.
3. `buildColumnCatalog()` DOES handle collisions via prefixing — it's the correct API for any context-aware column resolution.

## Known Bug

**Root cause:** In commit `19f869b`, the signature and behavior of `buildColSourceMap()` changed:
- Lost the context parameter (base/lookups/calcStages)
- Changed from "base + lookups only" to "all loaded tables"
- Removed lookup column prefixing

**Impact:** Any time a user imports two or more sheets that share a column name, the UI misattributes the column to the wrong sheet. This affects:
- The "From sheet:" tooltip on column chips
- The "TableName → Column" label in grid headers
- The color stripe on grid columns (wrong table color)
- Filter/sort dropdown labels

**Fix direction:** Either:
A. Restore context-awareness to `buildColSourceMap()` (add base/lookups params, only process relevant tables)
B. Add a disambiguation mechanism to the flat map (prefix duplicate names from non-base tables)
C. Switch UI callers to use `buildColumnCatalog()` with `buildReportSpecFromState()` instead

## Sources
- `SRC/preact/catalog/column-catalog.ts` — both implementations
- `SRC/preact/types.ts` — `ColSourceEntry` and `DbTable` types
- `SRC/preact/core/state.ts` — `buildReportSpecFromState()`
- `ecdd777:SRC/js/catalog/column-catalog.ts` — old correct implementation
- `SRC/preact/tests/catalog/column-catalog.test.ts` — tests (missing duplicate-name case)
