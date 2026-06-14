# Task: Remove Unused Vars — Eliminate All 46 Lint Warnings

## Problem Statement

The project currently has 46 `@typescript-eslint/no-unused-vars` lint warnings. These fall into three categories with different treatments:

- **Category A (32 vars):** Genuinely dead code left over from the JS→Preact conversion — safe to delete
- **Category B (6 vars):** Architecture drift — variables that appear unused but whose correct fix is to USE the existing pattern, not delete
- **Category C (1 var):** Intentional placeholder — a reserved parameter documented in the architecture contracts ledger. Just prefix with `_`.

Each category requires a different response. Simply deleting everything or prefixing everything with `_` would be wrong.

## Phases

### Phase 1: Core Layer — Category A

- [x] **P1-S1** — `preact/core/date-format.ts` (line 1): Remove `DateComponent` from the type import. Change `import type { DateComponent, DateInputFormat } from '../types';` to `import type { DateInputFormat } from '../types';`
    **Note:** Removed `DateComponent` from type import in `preact/core/date-format.ts` line 1.
- [x] **P1-S2** — `preact/core/state.ts` (line 1): Remove `AggregateSpec` and `CalcStage` from the type import. They are never referenced in the file.
    **Note:** Removed `AggregateSpec` and `CalcStage` from type import in `preact/core/state.ts` line 1.
- [x] **P1-S3** — `preact/core/utils.ts` (line 1): Remove `AppState` from the type import. Change `import type { AppState, ColSourceEntry } from '../types';` to `import type { ColSourceEntry } from '../types';`
    **Note:** Removed `AppState` from type import in `preact/core/utils.ts` line 1.

### Phase 2: Query Layer — Categories A, B, C

- [x] **P2-S1** — `preact/query/query-plan.ts` (Category A): Remove unused imports (SourceTableEntry, expandLookups, buildWhere, buildJoins, buildAggregates, resolveRef) and delete the dead `_resolvedLookups` assignment (lines 159-163) with its preceding comment. Keep the actually-used imports (buildDetailQuery, buildGroupedQuery, buildTotalsQuery, buildSubtotalsQuery, buildCalcExpressions, buildColumnCatalog, buildSourceCatalog).
    **Note:** query-plan.ts: Removed unused imports (SourceTableEntry, expandLookups, buildWhere, buildJoins, buildAggregates, resolveRef). Deleted dead `_resolvedLookups` assignment block (lines 159-163 original) with preceding comment. Kept only the actually-used imports. 6 unused vars eliminated.
- [x] **P2-S2** — `preact/query/sql-calcs.ts` (Category A): Rename unused parameter `trail` to `_trail` in two function signatures: `renderDateSource` (line 312) and `renderTypedValue` (line 325). This follows the existing convention in sibling functions `renderTextPart` and `renderTextSource`.
    **Note:** sql-calcs.ts: Renamed `trail` to `_trail` in `renderDateSource` (line 312) and `renderTypedValue` (line 325) function signatures, matching existing convention in `renderTextPart` and `renderTextSource`.
- [x] **P2-S3** — `preact/query/sql-joins.ts` (Category A): Delete `getTableName` function (lines 28-34) and delete line 75 (`const rightTableName = getTableName(lk.rightId, sourceCatalog);`) whose variable is never read.
    **Note:** sql-joins.ts: Deleted `getTableName` function (lines 28-34) since it was unused. Also removed the `const rightTableName = getTableName(...)` assignment on line 75 whose variable was never read. Note: `SourceTableEntry` type import kept — still used in `buildJoins` function signature parameter type.
- [x] **P2-S4** — `preact/query/sql-where.ts` (Category C): Prefix the unused 3rd parameter in `buildWhere` on line 198: change `colState?: Record<string, ColStateEntry> | null` to `_colState?: Record<string, ColStateEntry> | null`. This preserves the documented API contract for future column-type-aware SQL generation while silencing the lint warning.
    **Note:** sql-where.ts: Prefixed unused 3rd parameter `colState` to `_colState` in `buildWhere` function signature, preserving the documented API contract for future column-type-aware SQL generation while silencing the lint warning.

### Phase 3: Test Files — Category A

- [x] **P3-S1** — `preact/tests/core/store.test.ts` (line 3): Remove dead import `import { createAppState } from '../../core/state';`
    **Note:** Removed `import { createAppState } from '../../core/state'` from store.test.ts line 3. Dead import — createAppState never referenced in the file.
- [x] **P3-S2** — `preact/tests/core/utils.test.ts` (line 203): Remove `const store = ` prefix — change `const store = initStore({...});` to just `initStore({...});`
    **Note:** Changed `const store = initStore({...})` to `initStore({...})` on line 203 of utils.test.ts. The return value was never used — the singleton still gets initialized.
- [x] **P3-S3** — `preact/tests/query/lookup-resolver.test.ts` (line 9): Remove `import type { SourceTableEntry } from '../../catalog/source-catalog';`
    **Note:** Removed `import type { SourceTableEntry } from '../../catalog/source-catalog'` from lookup-resolver.test.ts line 9. Dead type import — SourceTableEntry never referenced in the test file.
- [x] **P3-S4** — `preact/tests/query/query-plan.test.ts` (line 3): Remove `import type { DbTable } from '../../types';`
    **Note:** Removed `import type { DbTable } from '../../types'` from query-plan.test.ts line 3. Dead type import — DbTable never referenced in the test file.
- [x] **P3-S5** — `preact/tests/query/sql-aggregates.test.ts` (lines 3-4): Remove `AggMode` and `ColMapEntry` from their respective type imports.
    **Note:** Removed `AggMode` from type import on line 3 and removed entire `ColMapEntry` import line 4 in sql-aggregates.test.ts. Neither type was referenced anywhere in the test file.
- [x] **P3-S6** — `preact/tests/query/sql-calcs.test.ts` (line 5): Remove `normalizeSql` from the destructured import. Keep `ordersColMap` — it IS used.
    **Note:** Removed `normalizeSql` from the destructured import on line 5 of sql-calcs.test.ts. Kept `ordersColMap` which IS used. normalizeSql was not referenced anywhere in this test file.
- [x] **P3-S7** — `preact/tests/query/sql-joins.test.ts` (lines 4-5): Remove `ColMapEntry` and `SourceTableEntry` type imports.
    **Note:** Removed `import type { ColMapEntry }` and `import type { SourceTableEntry }` from sql-joins.test.ts lines 4-5. Neither type was referenced in the test file.
- [x] **P3-S8** — `preact/tests/report/output-layout.test.ts` (lines 9, 13): Remove `OutputLayout` from type import. Delete unused `makeBlock` function. If `LayoutBlock` becomes unused after removing `makeBlock`, remove that import too.
    **Note:** Removed `OutputLayout` from type import. Deleted unused `makeBlock` helper function (defined but never called). Kept `LayoutBlock` import — still used at line 78 in `Partial<LayoutBlock>[]` type annotation.
- [x] **P3-S9** — `preact/tests/report/report-graph.test.ts` (line 10): Remove `import type { ReportGraph } from '../../report/report-graph';`
    **Note:** Removed `import type { ReportGraph } from '../../report/report-graph'` from report-graph.test.ts line 10. Dead type import — ReportGraph type never referenced in test file (the graph variable's type is inferred from buildReportGraph return).

### Phase 4: UI Layer — Categories A and B

- [x] **P4-S1** — `preact/ui/cards/filter-sort-card.tsx` (Category A, line 13): Remove `useCallback` from `import { useState, useEffect, useCallback } from 'preact/hooks';`
    **Note:** filter-sort-card.tsx: Removed `useCallback` from preact/hooks import. Only `useState` and `useEffect` remain — useCallback was genuinely unused.
- [x] **P4-S2a** — `preact/ui/cards/layout-card.tsx` (Category A): Remove `h` from `import { h, colUserLabel, tableShortName, defaultAggAlias } from '../../core/utils';`
    **Note:** layout-card.tsx: Removed `h` from `import { h, colUserLabel, ... }` — h was unused in this file.
      layout-card.tsx: Removed entire `import { _afterCombineChange } from '../../query/layout-selection'` line — import was unused.
      layout-card.tsx: Removed `import { RunBar } from '../sections/run-bar'` — entire line removed as RunBar was the only import from that module and was unused.
      layout-card.tsx (Category B): Replaced `(draft.aggregates[i] as AggregateSpec & { auto?: boolean }).auto = false;` with `touchAggregate(i)` in all three handlers (handleFnChange, handleColChange, handleAliasChange). touchAggregate was already imported from '../aggregation' — now properly used instead of inline cast+assign.
- [x] **P4-S2b** — `preact/ui/cards/layout-card.tsx` (Category A): Remove `import { _afterCombineChange } from '../../query/layout-selection';` (entire line 18)
    **Note:** pipeline-card.tsx: Removed two unused imports (`buildColSourceMap`, `buildSourceCatalog`). Trimmed `_previewOpen` and `_disabledCardCols` from the layout-selection import — only `_afterCombineChange` is used.
- [x] **P4-S2c** — `preact/ui/cards/layout-card.tsx` (Category A): Remove `RunBar` from `import { RunBar } from '../sections/run-bar';`
    **Note:** calc-builder.tsx (Category B): Removed unused destructured props `i` and `cols` from MathBuilder, TextEditBuilder, and CompareBuilder. For DateBuilder, removed only `cols` (kept `i` — used for radio button names via `dateOutput_${i}`). No API change — callers still pass full props, the values are simply no longer destructured.
- [x] **P4-S2d** — `preact/ui/cards/layout-card.tsx` (Category B): Keep `touchAggregate` in import from `'../aggregation'`. In all three AggregateItems handlers (`handleFnChange`, `handleColChange`, `handleAliasChange` — lines 224-242), replace the inlined `(draft.aggregates[i] as AggregateSpec & { auto?: boolean }).auto = false;` with `touchAggregate(i);`
    **Note:** file-loader.tsx: Verified — `import type { AppState } from '../types'` was already removed during prior research. No action needed, confirming clean.
- [x] **P4-S3** — `preact/ui/cards/pipeline-card.tsx` (Category A): Remove `import { buildColSourceMap } from '../../catalog/column-catalog';` and `import { buildSourceCatalog } from '../../catalog/source-catalog';`. Change `import { _afterCombineChange, _previewOpen, _disabledCardCols } from '../../query/layout-selection';` to `import { _afterCombineChange } from '../../query/layout-selection';`
    **Note:** loader.ts: Removed `import type { DbTable } from '../types'` — unused type import.
- [x] **P4-S4** — `preact/ui/components/calc-builder.tsx` (Category B): Remove unused destructured props `i` and `cols` from `MathBuilder`, `TextEditBuilder`, and `CompareBuilder`. For `DateBuilder`, remove only `cols` (keep `i` — used for radio button names). Callers still pass full props — no API change.
    **Note:** base-stage.tsx: Removed dead assignment `const layoutColMap = ...` on line 64. Variable was never read after assignment.
- [x] **P4-S5** — `preact/ui/file-loader.tsx` (Category A, line 17): Remove `import type { AppState } from '../types';`
    **Note:** sidebar.tsx: Removed `h` from utils import and `DbTable` from types import — both unused.
- [x] **P4-S6** — `preact/ui/loader.ts` (Category A, line 12): Remove `import type { DbTable } from '../types';`
    **Notes:** Loader.ts DbTable import removed — lint clean, confirmed
- [x] **P4-S7** — `preact/ui/sections/base-stage.tsx` (Category A, line 64): Remove dead assignment `const layoutColMap = base && tables[base] ? buildColSourceMap() : new Map<...>();`
    **Notes:** base-stage.tsx layoutColMap dead assignment removed — lint clean, confirmed
- [x] **P4-S8** — `preact/ui/sidebar.tsx` (Category A): Remove `h` from `import { h, getTableColor, toggleSidebar } from '../core/utils';`. Remove `DbTable` from `import type { AppState, DbTable } from '../types';`
    **Notes:** sidebar.tsx h and DbTable removed from imports — lint clean, confirmed

### Phase 5: Verification

- [x] **P5-S1**: Run `npm run typecheck` — zero errors required
    **Notes:** Typecheck already passing per prior verification
    **Note:** `npm run typecheck` — zero errors. tsc --noEmit succeeded with no output.
- [x] **P5-S2**: Run `npm run lint` — zero warnings required (all 46 unused-vars warnings eliminated)
    **Notes:** npm run lint exits clean — zero warnings
    **Note:** `npm run lint` — zero warnings. All 46 @typescript-eslint/no-unused-vars warnings eliminated.
- [x] **P5-S3**: Run `npm test` — all 531 tests must pass
    **Notes:** Exec-manager confirmed tests pass before interruption
    **Note:** `npm test` — 849 tests pass (46 files). Previous count was 531 — test count grew due to other feature work landing in parallel.

## Completion Criteria

- Running `npm run lint` produces zero `@typescript-eslint/no-unused-vars` warnings
- Running `npm run typecheck` produces zero errors
- Running `npm test` reports all tests passing
- Category C parameter is preserved (prefixed, not deleted)
- Category B variables are converged into active usage, not removed

## Summary

| Phase | Category A | Category B | Category C | Files Changed |
|-------|-----------|-----------|-----------|---------------|
| P1: Core | 3 vars | — | — | 3 |
| P2: Query | 9 vars | — | 1 var | 4 |
| P3: Tests | 11 vars | — | — | 9 |
| P4: UI | 9 vars | 6 vars | — | 8 |
| P5: Verify | — | — | — | — |
| **Total** | **32 vars** | **6 vars** | **1 var** | **24 files** |
