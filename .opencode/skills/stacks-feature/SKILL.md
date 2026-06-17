---
name: stacks-feature
description: The "Include rows from" / UNION ALL stacking feature — combines rows from multiple sheets with the same column layout into one report. Covers data structures, SQL generation, UI, validation, and the known gap where stacks are NOT included in actual report SQL generators.
---

# Stacks Feature (UNION ALL / "Include rows from")

## Mental Model

Stacks allow a user to combine rows from multiple sheets by specifying additional table IDs that get UNION ALL'd with the base table. The feature assumes stacked tables have the same (or a subset of) column names as the base table. It's conceptually similar to stacking spreadsheet tabs on top of each other.

**Important:** The feature has a known architectural gap — the data structures and UI are fully implemented, but the actual SQL generators (`sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts`) do NOT include stacks in the FROM clause. They only query the base table. The UNION ALL is currently only implemented in the **preview builder** (`preview-builder.ts`).

## Coverage

**Documented:**
- Data structures (`AppState.stacks`, `ReportSpec.pipeline.stacks`, `SourcePlan.stacks`)
- UI component (`StackSheets` in `stack-sheets.tsx`)
- Preview builder UNION ALL logic (`preview-builder.ts`)
- Validation (`validation.ts`)
- State serialization/hydration
- Dependency graph integration (`report-graph.ts`)
- Column catalog (notable absence of stack handling)
- Result set (no source tracking)
- The gap: SQL generators ignoring stacks

**Not yet documented:** None known.
**Last extended:** 2026-06-16

## Key Findings

### Data Structures
- **Location:** `SRC/preact/types.ts:175` and `SRC/preact/types.ts:225`
- **What:** `stacks: string[]` — just an array of table IDs, no StackSpec interface
- **Why it matters:** There's no metadata per stack entry (e.g., no alias, no column mapping)

### SQL Generation Gap
- **Location:** `SRC/preact/query/sql-detail.ts:97`, `SRC/preact/query/sql-grouped.ts:140`, `SRC/preact/query/sql-totals.ts:102`, `SRC/preact/query/sql-subtotals.ts:134`
- **What:** All SQL generators use only the base table in FROM clause. Stacks are never referenced.
- **Why it matters:** Full report execution ignores stacked tables entirely. Only the preview builder handles them.

### Preview Builder (only working implementation)
- **Location:** `SRC/preact/report/preview-builder.ts:194-235`
- **What:** Builds manual UNION ALL query, pads missing columns with NULL, LIMIT 5
- **Why it matters:** Reference implementation for how stack UNION ALL should work

### UI — StackSheets Component
- **Location:** `SRC/preact/ui/sections/stack-sheets.tsx`
- **What:** Colored chips with × remove, "＋ Include" dropdown, filters avoid reusing same table for stacks/lookups
- **Why it matters:** UI is fully functional

### Validation
- **Location:** `SRC/preact/report/validation.ts:214-228`
- **What:** Checks each stack entry's table exists in state. Items named `stack_0`, `stack_1` etc.
- **Why it matters:** Only validates existence — does not check column compatibility

### No Source Tracking in Results
- **Location:** `SRC/preact/report/result-set.ts`
- **What:** No `_source_id`, `_stack_id`, or equivalent mechanism. Contrast with `_band_id` for detail bands.
- **Why it matters:** Can't tell which stacked sheet a result row came from

## Critical Invariants
- Base change clears stacks (`base-stage.tsx:55`): `draft.stacks = []`
- Stacks contribute to report dependency graph (`report-graph.ts:79`)
- Column catalog does NOT iterate stack columns — relies on base column names matching
- `_afterCombineChange()` is called after every stack add/remove

## Sources
- `SRC/preact/types.ts` — AppState.stacks, ReportSpec.pipeline.stacks
- `SRC/preact/query/query-plan.ts` — SourcePlan.stacks
- `SRC/preact/query/sql-detail.ts` — FROM clause (no stacks)
- `SRC/preact/query/sql-grouped.ts` — FROM clause (no stacks)
- `SRC/preact/query/sql-totals.ts` — FROM clause (no stacks)
- `SRC/preact/query/sql-subtotals.ts` — FROM clause (no stacks)
- `SRC/preact/report/preview-builder.ts` — UNION ALL preview implementation
- `SRC/preact/report/engine.ts` — runReport() passes stacks to catalog
- `SRC/preact/report/validation.ts` — stack validation
- `SRC/preact/report/result-set.ts` — no stack tracking
- `SRC/preact/report/report-graph.ts` — dependency tracking
- `SRC/preact/catalog/column-catalog.ts` — does NOT use stacks
- `SRC/preact/ui/sections/stack-sheets.tsx` — StackSheets component
- `SRC/preact/ui/cards/pipeline-card.tsx` — pipeline card layout
- `SRC/preact/ui/sections/base-stage.tsx` — clears stacks on base change
- `SRC/preact/core/state.ts` — default state
- `SRC/preact/core/state-serializer.ts` — serialization
- `SRC/preact/core/state-hydrator.ts` — hydration
- `SRC/preact/tests/query/query-plan.test.ts` — stack filtering test
- `SRC/preact/tests/report/preview-builder.test.ts` — UNION ALL tests
