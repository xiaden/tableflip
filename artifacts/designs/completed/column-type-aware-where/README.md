# Column-Type-Aware SQL WHERE — Implementation Parts

**Design doc:** `artifacts/designs/pending/DD-dd-column-type-aware-where.md`
**Foundations plan:** `artifacts/plans/pending/TASK-column-type-aware-where-foundations.md` — NOT YET EXECUTED. Types, state defaults, and string storage changes do not exist in source code yet.

## Parts

| Part | Title | Depends On | Layers |
| --- | --- | --- | --- |
| foundations | Type Definitions + String Storage | — | Core (types.ts, globals.d.ts, state.ts, sqldb.ts, index.ts) |
| A | Cell Metadata Capture at Ingestion | foundations | UI (loader.ts) |
| B | Catalog Type Propagation | foundations | Catalog (column-catalog.ts) |
| C | Type-Aware SQL Generation + Tests | B | Query (sql-where.ts + tests) |
| D | Persistence of Column Type Overrides | foundations | Core (serializer, hydrator, schema) |
| E | User Override UI via Context Menu | B, D | UI (grid.tsx, context-menu.tsx) |

## Dependency Graph

```
foundations (PLAN EXISTS — NOT EXECUTED)
  ├── A (Ingestion) ──┐
  ├── B (Catalog) ────┤
  ├── D (Persistence) ─┤
  │                    ├── C (SQL Generation) — depends on B
  │                    └── E (Context Menu UI) — depends on B + D
```

## Execution Order

Round 0: foundations (MUST execute first — all parts depend on it)
Round 1: A, B, D (parallel — all depend only on foundations)
Round 2: C (depends on B)
Round 3: E (depends on B + D)

## Per-Part Scope

### Part A: Cell Metadata Capture
**Files:** `ui/loader.ts`
**Description:** Add `scanCellTypes(ws)` function that reads the dense worksheet array, counts `cell.t` per column, applies date-format override for majority-numeric columns, returns `Record<string, ColumnType>`. Call after `expandMerges()` in `ingestSheet()`. Store result on `DbTable.colTypes` in the `store.update()` call. Skip `_rowno`. CSV files have no cell metadata → no colTypes stored.

### Part B: Catalog Type Propagation
**Files:** `catalog/column-catalog.ts`
**Description:** Add `colType?: ColumnType` to `PhysicalColEntry` and `BandColEntry`. In `buildColSourceMap()`, read `state.tables[tid].colTypes?.[col]` and `state.columnTypeOverrides?.[tid]?.[col]`, set `colType: override ?? auto`. In `buildColumnCatalog()`, propagate similarly for base, lookup, and band columns. Calc columns get no `colType` field. Update `tests/query/helpers.ts` test fixtures.

### Part C: Type-Aware SQL Generation
**Files:** `query/sql-where.ts`, `tests/query/sql-where.test.ts`
**Description:** Remove `isNumericCalc()`. Add `getColumnType()` helper that returns `ColumnType` from `colMap` entry (physical/band colType, calc mode derivation, `_rowno` special case). Update `renderFilter()` and `renderClause()` to use `colType` instead of `numericHint`. Fix comparison operators to use TEXT cast for string/default columns. Add ~15 test cases.

### Part D: Persistence
**Files:** `core/state-serializer.ts`, `core/state-hydrator.ts`, `core/state-schema.ts`
**Description:** Add `columnTypeOverrides` to `buildPayload()` serialization. Add `columnTypeOverrides` hydration in `hydrateState()` — default to `{}` if absent. No STATE_VERSION bump — field is optional with safe default. Does NOT add to `RECOGNIZABLE_KEYS` (field is optional user config, not required for recognition).

### Part E: User Override UI
**Files:** `ui/grid.tsx`, `ui/components/context-menu.tsx`
**Description:** Add "Change column type" flat items to the column header context menu in the preview grid. Four items: "Type: String", "Type: Number", "Type: Date", "Type: Boolean". Active type gets a checkmark. On selection, update `draft.columnTypeOverrides[tid][col]` and call `invalidateValidation()`. No submenu support needed — flat items per the user's decision.
