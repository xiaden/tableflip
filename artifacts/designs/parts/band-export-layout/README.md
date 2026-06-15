# Band Export Layout — Implementation Parts

## Parts

| Part | Title | Depends On | Layers |
| --- | --- | --- | --- |
| A | Band export layout functions + integration + styling + tests | None | UI (export) |

## Dependency Graph

```
A (single plan — all in export.ts + tests)
```

## Execution Rounds

Round 1: A (no deps)

## Per-Part Scope

### Part A: Band export layout functions + integration + styling + tests

Creates three new pure functions in `export.ts`: `computeBandColSets()` (extracts per-band column alias arrays from superset columns), `applyBandGroup()` (composable per-band-group row transformation that replaces wide band rows with compact format and inserts section headers), and `buildBandColumnLayout()` (orchestrates composition of all band group transformations and builds the header array). Integrates the band layout path into `exportAs()` — activates when detail bands are present, producing compact match+band-cols output for all formats (CSV and XLSX). Adds row kind 5 styling in `styleExportSheet()` for band parent rows (bold, slate-50 fill, bottom border). Adds ~32 new tests in `export-bands.test.ts` covering all new functions and the band export integration path. No engine, query, catalog, or UI component changes.
