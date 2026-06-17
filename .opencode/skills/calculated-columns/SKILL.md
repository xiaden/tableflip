---
name: calculated-columns
description: Calculated column pipeline — types, SQL generation, cycle detection, chaining, validation, catalog building, and UI components. Use when modifying calc stage behavior, expression generation, or the calc builder UI.
---

# Calculated Columns

## Mental Model

Calculated columns are virtual columns defined as sequential stages in the report pipeline. Each stage has a mode (math/text/compare/date) and a mode-specific configuration object. Stages are processed in order — a later stage can reference an earlier stage's alias. At SQL generation time, each calc stage produces a SQL expression that gets projected in the SELECT clause. The colMap acts as a shared visibility context: calc aliases are added sequentially, making earlier calcs visible to later ones.

The system has **intentional cycle detection** via a `trail` Set passed through the recursive `renderCalcExpr` calls. Circular references (A→B→A) result in `NULL` in the SQL output rather than infinite recursion.

## Coverage

**Documented:** Data types (CalcStage, CalcMode, CalcColEntry), SQL expression generation (sql-calcs.ts, all 4 modes), cycle detection (trail pattern), chaining behavior (math inlines, others alias-ref), catalog/colMap registration, validation (calc-validator.ts), UI components (calc-builder.tsx, calc-stage.tsx), alias rename propagation (alias-rename.ts), test coverage, and known limitations.

**Not yet documented:** Interaction with report dependency graph (report-graph.ts), published output chaining (different feature from calc chaining).

**Last extended:** 2026-06-16

## Key Files and Roles

| File | Role |
|---|---|
| `SRC/preact/types.ts` | `CalcStage`, `CalcMode`, `ColSourceEntry` (calc variant) type definitions |
| `SRC/preact/catalog/column-catalog.ts` | `CalcColEntry` interface; adds calc aliases to colMap in stage order |
| `SRC/preact/query/sql-calcs.ts` | Core SQL expression generator; `buildCalcExpressions()` entry point; `renderCalcExpr()` recursive renderer with `trail` cycle detection |
| `SRC/preact/query/resolve-ref.ts` | Column alias → SQL reference resolution; calc/band cols get quoted alias only |
| `SRC/preact/query/query-plan.ts` | Orchestrator: calls `buildCalcExpressions()`, builds `calcExprs` Map, passes to query builders |
| `SRC/preact/report/engine.ts` | Execution engine: passes calcExprs through to query builders |
| `SRC/preact/report/calc-validator.ts` | Validates a single CalcStage: alias not empty, mode valid, mode-specific fields OK, referenced columns exist |
| `SRC/preact/report/validation.ts` | Full report validation: iterates calc stages, calls calc-validator, checks alias uniqueness and resolution |
| `SRC/preact/report/preview-builder.ts` | Preview building for calc pipeline arrows |
| `SRC/preact/core/alias-rename.ts` | Propagates calc alias renames across all state fields (filters, sorts, groups, other calcs, etc.) |
| `SRC/preact/core/state.ts` | State init: `calcStages: []` |
| `SRC/preact/ui/sections/calc-stage.tsx` | Calc stage UI section component; `CalcStageSection` with mode tabs, alias input, builder component |
| `SRC/preact/ui/components/calc-builder.tsx` | Four mode-specific builder components: `MathBuilder`, `TextEditBuilder`, `CompareBuilder`, `DateBuilder` |
| `SRC/preact/query/sql-detail.ts` | Detail query: uses calcExprs for SELECT projection and ORDER BY |
| `SRC/preact/query/sql-grouped.ts` | Grouped query: uses calcExprs for group columns and aggregate inner refs |
| `SRC/preact/query/sql-totals.ts` | Totals query: uses calcExprs as inner refs for aggregate expressions |
| `SRC/preact/query/sql-subtotals.ts` | Subtotals query: uses calcExprs across all UNION ALL branches |
| `SRC/preact/tests/query/sql-calcs.test.ts` | Tests for all 4 modes, skip conditions, self-reference, mutual reference, transitive cycle (510 lines) |
| `SRC/preact/tests/report/calc-validator.test.ts` | Tests for calc validation (307 lines) |
| `SRC/preact/tests/query/query-plan.test.ts` | Plan-level calc integration test (line 120-145) |
| `SRC/preact/tests/integration/full-pipeline.test.ts` | End-to-end calc pipeline test (line 234-278) |
| `SRC/preact/tests/report/validation.test.ts` | Validation-level calc tests (lines 103-129) |

## Key Findings

### 1. CalcStage Data Model

```typescript
interface CalcStage {
  alias: string;        // Output column name
  mode: CalcMode;       // 'math' | 'text' | 'compare' | 'date'
  math?: unknown;       // Mode-specific config (typed in sql-calcs.ts)
  compare?: unknown;
  text?: unknown;
  date?: unknown;
  enabled?: boolean;
}
```

- **Math mode** (`strategy: 'stepChain'`): array of `{ type: 'column'|'number'|'text', value, op? }` steps. First step has no operator; subsequent steps have `+|-|*|/%`. Also supports `mathOp: 'ROLLAVG' | 'PCTTOTAL'` for window functions.
- **Compare mode**: conditions array `{ col, op, val }` + `trueValue`/`falseValue` typed values `{ type, value }`.
- **Text mode**: operations `combine|left|right|substring` with typed parts/sources.
- **Date mode**: operation `extract` with source column, part (`year|month|day|dow|week|quarter|julian`), output format.

### 2. SQL Expression Generation Pipeline

```
buildQueryPlan() → buildColumnCatalog() → colMap → buildCalcExpressions() → calcExprs Map → query builders (detail/grouped/totals/subtotals)
```

1. `buildColumnCatalog()` iterates calc stages in order, validates structure, and adds each valid alias to the colMap as `{ kind: 'calc', idx, mode, calc }`
2. `buildCalcExpressions()` (sql-calcs.ts) iterates stages, renders each via `renderCalcExpr()` → mode-specific renderer → returns `{ alias, sql }[]`
3. `calcExprs` Map (`alias → sql`) is passed to query builders
4. Query builders check `calcExprs.get(alias)` before calling `resolveRef(alias, colMap)` — if found, the calc SQL expression is used directly in the SELECT clause

### 3. Chaining: YES, Supported

**How it works:**
- The colMap is built sequentially — calc stage 0 is added before calc stage 1, so stage 1 can reference stage 0's alias
- `projectedCols()` returns all colMap keys including all prior calc aliases
- The validator (`checkCalcError`) checks column references against the full `projectedCols` list
- The UI's `colOptsFor` in `calc-stage.tsx` filters out only the *current* calc's alias (not prior calcs): `cols.filter(c => c !== alias)`
- The alias rename system (`renameAliasRefsInternal`) propagates alias changes across all calc stages

**Two chaining strategies — mode-dependent:**

| Mode | Chaining mechanism |
|---|---|
| **Math** | **Inlines** the prior calc's SQL expression via recursive `renderCalcExpr()` call, wrapped in `toNum()` |
| **Compare** | References by alias only (`resolveRef` returns `"Alias"`) — works because calc SQL is already projected in SELECT |
| **Text** | References by alias only |
| **Date** | References by alias only |

### 4. Cycle Detection: YES, Built-in

- Uses a `trail: Set<string>` passed through `renderCalcExpr()` recursion
- At entry: `if (trail.has(alias)) return 'NULL'` — breaks cycles
- At entry: `trail.add(alias)` — adds current calc to trail
- The trail is scoped per-stage (fresh `new Set()` per stage in `buildCalcExpressions`)
- Detects: self-reference, mutual (A→B→A), transitive (A→B→C→A)
- Tested in `sql-calcs.test.ts` (lines 397-508)

### 5. Mixing User Input and Column References: YES

Every mode's expression model supports both:
- **User input** via `type: 'number'` or `type: 'text'` parts
- **Column references** via `type: 'column'` parts

Examples:
- **Math**: `{ type: 'column', value: 'Amount' }` mixed with `{ type: 'number', value: '2', op: '*' }`
- **Compare**: conditions reference columns; trueValue/falseValue can be `{ type: 'number'|'text'|'column' }`
- **Text combine**: parts can mix `column`, `text`, `number` types
- **Date**: source must be a column; but can reference any projected column including other calcs

### 6. ColMap Registration

In both `buildColSourceMap()` and `buildColumnCatalog()`:
- Calc stages are iterated in **array order** (sequential)
- Each stage's structure is validated locally — column references are checked against **the current colMap** (which already includes earlier calcs)
- If `colMap.has(alias)` (duplicate alias), the calc entry is **skipped** (not added)
- The calc entry is stored as `{ kind: 'calc', idx, mode, calc: <full CalcStage object> }`
- The `calc` field stores the entire CalcStage for later inline-rendering by sql-calcs.ts

### 7. Validation

`checkCalcError()` (calc-validator.ts):
- Structural: alias not empty, mode valid, mode-specific config present
- Semantic: referenced columns exist in `projectedCols` list
- Self-reference prevention: math mode checks `step.value === alias`; compare mode checks `cond.col === alias`
- Cross-calc validation: `projectedCols` includes all prior calc aliases, so references to earlier calcs are valid

`deriveValidation()` (validation.ts, lines 368-403):
- Checks alias is not empty
- Checks alias resolves to a projected column
- Calls `checkCalcError()` for mode-specific validation
- Produces `calc_N` items with blocking status

### 8. Key Invariants

- **Calc stages are processed in order** — order determines chaining visibility
- **Duplicate aliases are silently skipped** (first-calc-wins in colMap)
- **Self-reference is blocked** by both the validator AND the cycle detector
- **Cycle detector returns NULL** rather than throwing — graceful degradation
- **Disabled stages (`enabled: false`) are skipped everywhere** — not in colMap, not in SQL, not in validation
- **Band columns are never in calc column dropdowns** — they have no presence in the main query's FROM clause
- **Alias rename propagates to all state fields** via `renameAliasRefsInternal` including other calc's internal references

### 9. SQL Generation Details per Mode

**Math mode SQL transforms:**
- First step: the accumulator value (column → `toNum(resolveRef)`, number → literal, text → string literal)
- Subsequent steps: wrap in `(expr op val)` with `/` and `%` protected by `CASE WHEN divisor=0 THEN NULL`
- Advanced: `ROLLAVG` → `AVG(expr) OVER (ORDER BY _rowno ROWS BETWEEN N-1 PRECEDING AND CURRENT ROW)`
- Advanced: `PCTTOTAL` → `expr * 100.0 / NULLIF(SUM(expr) OVER (), 0)`

**Compare mode SQL:** `CASE WHEN conditions THEN trueValue ELSE falseValue END`

**Text mode SQL:** `SUBSTR` operations or `||` concatenation

**Date mode SQL:** `strftime` calls with `CASE` expressions for month/DOW names

## Critical Invariants
- Calc stages are ORDER DEPENDENT — don't reorder them without checking downstream references
- Math mode INLINES prior calcs; other modes ALIAS-REF — this means math-mode chaining can produce deeply nested SQL expressions
- The `trail` Set is the only cycle protection — if it's removed, recursive rendering will stack-overflow
- When adding a new calc mode, you must update: types.ts (CalcMode union), sql-calcs.ts (renderer), calc-validator.ts (validator), calc-builder.tsx (component), calc-stage.tsx (mode defaults), column-catalog.ts (validation logic) — at minimum
- Alias rename touches 11+ different state fields — adding a new alias-bearing field means updating `renameAliasRefsInternal`
