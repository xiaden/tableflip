---
name: Query Layer
description: SQL generation — query builders, column resolution, calc expressions, aggregates. All pure functions. Applies when editing files in SRC/preact/query/.
applyTo: SRC/preact/query/**
---

# Query Layer

**Purpose:** Generate complete SQL queries from report specifications — SELECT, JOINs, WHERE, GROUP BY, ORDER BY, aggregates, and calculated column expressions — as pure functions with no side effects.

## File Naming

- **`resolve-ref.ts`** — Column alias → SQL reference resolution
- **`sql-calcs.ts`** — Calculated column SQL expression generation (math, compare, text, date modes)
- **`sql-joins.ts`** — JOIN clause generation from lookup specifications
- **`sql-where.ts`** — WHERE clause generation from filter specifications
- **`sql-aggregates.ts`** — Aggregate function expression rendering (SUM, COUNT, AVG, etc.)
- **`sql-detail.ts`** — Detail (non-aggregated) query builder
- **`sql-grouped.ts`** — Grouped (GROUP BY) query builder
- **`sql-totals.ts`** — Totals-only query builder
- **`sql-subtotals.ts`** — Subtotal branches query builder
- **`sql-detail-bands.ts`** — Detail band (child row) query builder
- **`query-plan.ts`** — Query plan orchestrator (top-level entry point)
- **`lookup-resolver.ts`** — Lookup validation, expansion, duplicate detection
- **`layout-selection.ts`** — Column layout/visibility management (EXCEPTION: impure, accesses store)
- **`alias-ref-updater.ts`** — Rename alias references across pipeline state (EXCEPTION: impure, accesses `window.__db`)

## Allowed Imports

Query modules may import from:
- `../types` — shared type definitions (`ReportSpec`, `DbTable`, `AggMode`, etc.)
- `../catalog/*` — source catalog (`SourceTableEntry`) and column catalog (`ColMapEntry`)
- `../core/sqldb` — SQLite wrapper, `quoteId()` function
- `../core/date-format` — date normalization and formatting (for date calc mode expressions)
- `../core/utils` — shared utilities (e.g., `defaultAggAlias`)
- `./` — peer query modules (e.g., `resolve-ref`, `sql-joins`, `sql-where`, `sql-aggregates`)

### Forbidden Imports

- **No `../report/*` imports** — query layer does not execute queries, construct result sets, or validate reports. (Exception: `layout-selection.ts` is the sole file that imports `invalidateValidation` from `../report/validation` — this is a known impurity.)
- **No `../ui/*` imports** — query layer has no UI dependencies.
- **No `../core/store` imports** — query modules must NOT read from the reactive store. (Exception: `layout-selection.ts` and `alias-ref-updater.ts` access store/global state.)

## Forbidden Patterns

- **No store/global state reads in SQL-generating modules** — `sql-*` files, `resolve-ref.ts`, `sql-calcs.ts`, `lookup-resolver.ts`, and `query-plan.ts` must be pure functions. Do not call `getStore()`, access `window.__db`, or read global variables.
- **No SQL identifier concatenation** — Always use `quoteId()` from `core/sqldb.ts`. Never write `"${tid}.${col}"` or backtick-quoted identifiers directly.
- **No `dangerouslySetInnerHTML`** — This is a UI-layer concern, but applies project-wide (see AGENTS.md).
- **No report execution logic** — Do not call `buildReport`, execute queries, or shape result sets. That is the Report layer's responsibility.
- **No catalog construction** — Do not call `buildSourceCatalog()` or `buildColumnCatalog()` directly in query builders. The plan orchestrator (`query-plan.ts`) constructs catalogs and passes them in as parameters.

## Required Patterns

### 1. All SQL-generating modules are pure functions

Every public function in `sql-*`, `resolve-ref.ts`, `sql-calcs.ts`, and `lookup-resolver.ts` takes explicit parameters and returns a result. No closures over global state, no store reads, no mutations.

```typescript
// Good — pure function, explicit parameters
export function buildDetailQuery(
  reportSpec: ReportSpec,
  colMap: Map<string, ColMapEntry>,
  sourceCatalog: Map<string, SourceTableEntry>,
  calcExprs: Map<string, string> = new Map(),
): DetailQueryResult { ... }

// Bad — implicit store dependency
export function buildDetailQuery(): DetailQueryResult {
  const store = getStore(); // FORBIDDEN
  ...
}
```

### 2. `calcExprs` takes priority over `resolveRef()`

Always check `calcExprs.get(alias)` before calling `resolveRef(alias, colMap)`. If a calc expression exists for the alias, use it directly instead of resolving to a physical column reference.

```typescript
// Good — calc priority
const calcExpr = calcExprs.get(alias);
const ref = calcExpr ?? resolveRef(alias, colMap);

// Bad — resolveRef used directly, ignoring calcs
const ref = resolveRef(alias, colMap);
```

### 3. Band columns are always filtered from main query SELECT

Columns with `kind === 'band'` in the `colMap` have no JOIN in the parent FROM clause. They must be filtered out of the main query's SELECT, ORDER BY, and GROUP BY. Band-specific queries are built separately in `sql-detail-bands.ts`.

```typescript
// Good — filter band columns
const filteredProjected = projected.filter(alias => {
  const entry = colMap.get(alias);
  return !entry || entry.kind !== 'band';
});
```

### 4. `resolveRef()` resolution rules

- **Physical columns** → returns `"tid"."col"` via `quoteId()` quoting
- **Calc columns** → returns `"alias"` (quoted alias only, no table prefix)
- **Band columns** → returns `"alias"` (quoted alias only, no table prefix)

```typescript
export function resolveRef(alias: string, colMap: Map<string, ColMapEntry>): string {
  const entry = colMap.get(alias);
  if (!entry || entry.kind === 'calc' || entry.kind === 'band') return quoteId(alias);
  return `${quoteId(entry.tid)}.${quoteId(entry.col)}`;
}
```

### 5. Each query builder builds its own JOINs and WHERE

Do not pass pre-built JOIN/WHERE clauses into query builders. Each builder (`sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts`) calls `buildJoins()` and `buildWhere()` internally using the report spec and colMap it receives.

### 6. SQL identifiers must use `quoteId()`

All table names, column names, and aliases must be wrapped in `quoteId()` from `core/sqldb.ts`. Never concatenate identifiers directly into SQL strings.

```typescript
import { quoteId } from '../core/sqldb';

// Good
const ref = `${quoteId(entry.tid)}.${quoteId(entry.col)}`;

// Bad — direct concatenation
const ref = `"${entry.tid}"."${entry.col}"`;   // FORBIDDEN
const ref = `${entry.tid}.${entry.col}`;       // FORBIDDEN (no quoting)
```

### 7. Parameterized queries

All user-supplied values must use `?` placeholders with params arrays. Never interpolate values directly into SQL strings.

## Known Impurities

Two files in the query layer intentionally break the pure-function rule and access global state:

| File | Impurity | Reason |
|------|----------|--------|
| `layout-selection.ts` | Reads/writes `getStore()` state; imports `invalidateValidation` from report layer | Column visibility is inherently stateful; toggles `selCols` on the store |
| `alias-ref-updater.ts` | Reads/writes `window.__db` directly | Legacy migration of alias references across pipeline state objects |

These files are legacy/transitional. New query modules must NOT follow their pattern.

## Validation

After editing any file in this layer, run:

```bash
npm run typecheck   # zero errors required
npm run lint        # zero warnings required
npm test            # all tests must pass
```
