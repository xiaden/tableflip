---
name: Catalog Layer
description: Column resolution and metadata building — source catalogs, column catalogs, projection helpers. Applies when editing files in preact/catalog/.
applyTo: SRC/preact/catalog/**
---

# Catalog Layer

**Purpose:** Build and resolve column metadata — mapping column aliases to their physical table columns, calculated column definitions, or detail band columns — so the Query layer can generate SQL without owning column discovery logic.

## File Naming

- `kebab-case.descriptive.ts` — e.g., `source-catalog.ts`, `column-catalog.ts`
- One conceptual unit per file (source catalog, column catalog, projection)
- Exported types live alongside their building functions in the same file

## Allowed Imports

| Source | Allowed? | Notes |
|--------|----------|-------|
| `../types` | ✅ | Shared interfaces: `DbTable`, `CalcStage`, `LookupSpec`, `DetailBandSpec` |
| `../core/store` | ✅ | Only for store-based convenience wrappers (e.g., `buildColSourceMap()`). Pure catalog functions must NOT import store. |
| Siblings (`./source-catalog`) | ✅ | e.g., `column-catalog.ts` imports `SourceTableEntry` from `source-catalog` |
| Node builtins / vendor libs | ❌ | No filesystem, no XLSX, no AG Grid |
| Query layer (`../query/`) | ❌ | Catalog builds metadata; Query consumes it. No reverse imports. |
| Report layer (`../report/`) | ❌ | Same directional rule — catalog is upstream of report. |
| UI layer (`../ui/`) | ❌ | Catalog knows nothing about rendering. |

## Forbidden Patterns

1. **SQL generation** — Do not produce `SELECT`, `JOIN`, `WHERE`, `GROUP BY`, or any SQL fragment. That is the Query layer's job.
2. **Global state reads in pure functions** — Functions like `buildColumnCatalog()`, `buildSourceCatalog()`, `projectedCols()`, and `projectedColsUpToLookup()` must accept all data as explicit parameters. Store access via `getStore()` is allowed only in explicitly named convenience wrappers (e.g., `buildColSourceMap()`).
3. **State mutation** — Catalog modules return data (Maps, arrays, objects). They never write to the store or modify `AppState`.
4. **Report execution** — Do not execute queries, validate reports, or format output. That is the Report layer's responsibility.

## Required Patterns

1. **Catalog modules are pure functions** — no store/global state reads in the primary builder functions. All inputs arrive as parameters.
2. **`buildColumnCatalog()` produces the `colMap`** — a `Map<string, ColMapEntry>` that maps every column alias to its physical/calc/band source. This map is the backbone the Query layer uses to resolve column references.
3. **Lookup column prefixing** — use `tablePrefix(rightTableName)` for collision avoidance when a right-table column name matches an already-registered alias:
   ```ts
   const prefix = tablePrefix(rName);
   const alias = colMap.has(c) ? prefix + c : c;
   ```
4. **Detail band columns** — get `_{bandId}_` prefix and `kind: 'band'` tag so the Query layer can distinguish them from main-table columns:
   ```ts
   const prefix = `_${band.id}_`;
   colMap.set(alias, { kind: 'band', tid: band.rightId, col: c });
   ```
5. **Export types at module boundary** — Expose `ColMapEntry`, `PhysicalColEntry`, `CalcColEntry`, `BandColEntry`, `SourceTableEntry` so consumers can discriminate on `kind`.
6. **Favor catalog-based API over store-based API** — Default to the pure `(reportSpec, sourceCatalog) => ColumnCatalog` signature. The store-based `buildColSourceMap()` exists as a thin convenience layer only.

## Validation

After editing any file in `SRC/preact/catalog/`, run:

```sh
npm run typecheck   # zero errors required
npm run lint        # zero warnings required
npm test            # all tests must pass
```
