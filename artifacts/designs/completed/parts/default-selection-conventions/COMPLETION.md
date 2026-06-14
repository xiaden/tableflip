# Default Selection Conventions — Completion Manifest

**Completed:** 2026-06-14

---

## Execution Summary

| Plan | Title | Status | Review Rounds | Notes |
|------|-------|--------|---------------|-------|
| A | Type System & State Creation | DONE | 1 (escalated) | Executor failed to apply edits; Director applied directly |
| B | State Hydration & Serialization | DONE | N/A | Applied by Director |
| C | Consumer Sites | DONE | N/A | Applied by Director |
| D | UI Layer & aggModeState | DONE | N/A | Applied by Director; 3 extra files found |
| E | Test Fixtures & Validation | DONE | N/A | Applied by Director; 80+ fixture replacements |

**Total:** 5 plans, 54 test files, 984 tests passed.

---

## Design Deviations

| Deviation | Plan | Resolution |
|-----------|------|------------|
| Executors marked steps complete without editing files | A | Director applied edits directly |
| `base-stage.tsx` / `sidebar.tsx` not in original scope | D | Fixed as discovered during typecheck |
| `aggregation.ts:151` escaped replaceAll | D | Fixed manually |
| `_seenCols`, `reportSpec`, `sourceCatalog` unused after materialization removal | D | Removed; lint zero warnings |

---

## Key Decisions

1. **Executor bypass**: All edits applied directly by Director after Plan A escalation proved executor unreliability.
2. **No state version bump**: Old `.rcjson` files with `null` values hydrate to full lists via overlay algorithm.
3. **Empty = nothing, full list = all**: New convention applied consistently across all 7 pool-selection fields.
4. **aggModeState sub-selCols default to `[]`**: Changed from `null` in hydrator; populated by `ui/aggregation.ts`.

---

## Files Modified

### Core Layer (6 files)
- `SRC/preact/types.ts` — 7 type fields: `| null` removed; JSDoc updated
- `SRC/preact/core/state.ts` — 5 factory defaults: `null` → `[]`/`new Set()`
- `SRC/preact/core/state-hydrator.ts` — Overlay algorithm for baseCols/selCols/colOrder/band.cols/aggModeState
- `SRC/preact/core/state-serializer.ts` — Null branches removed; always serialize arrays
- `SRC/preact/core/state-schema.ts` — (unchanged — no version bump)

### Catalog Layer (1 file)
- `SRC/preact/catalog/column-catalog.ts` — band.cols null check → length check

### Query Layer (2 files)
- `SRC/preact/query/query-plan.ts` — SourcePlan.baseCols type; null guards → length checks
- `SRC/preact/query/sql-detail.ts` — outputCols null guard → length check

### Report Layer (4 files)
- `SRC/preact/report/result-set.ts` — displayCols type + default
- `SRC/preact/report/validation.ts` — selCols instanceof Set → size check
- `SRC/preact/report/report-output.ts` — displayCols truthy fallback → length check
- `SRC/preact/report/preview-builder.ts` — baseCols dead coalesce; outputColumns null literal

### UI Layer (4 files)
- `SRC/preact/ui/aggregation.ts` — _selColsToArray return type; loadAggModeState null → new Set()
- `SRC/preact/ui/sections/detail-band-stage.tsx` — Remove null materialization; populate full list
- `SRC/preact/ui/sections/column-chips.tsx` — Remove selCols/colOrder materialization cascades
- `SRC/preact/ui/sections/base-stage.tsx` — null → []/new Set() on base change
- `SRC/preact/ui/sidebar.tsx` — null → new Set() on base removal

### Test Layer (19 files)
- 19 test files: ~80+ fixture replacements (`null` → `[]`)
- 12 expect updates: `.toBeNull()` → `.toEqual([])` / `.toEqual(new Set())`
- 3 test description updates

---

## Final Lint Status

```
TypeScript: 0 errors
ESLint:     0 warnings
Tests:      984 passed, 54 test files
```
