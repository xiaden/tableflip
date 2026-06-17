# Scoped Selectors — Completion Manifest

**Feature:** scoped-selectors  
**Date completed:** 2026-06-17  
**Refinement of:** DD-preact-to-react-conversion (resolved Open Question #2)

---

## Execution Summary

| Plan | Title | Files | Review Rounds | Fix Cycles | QA Status |
| --- | --- | --- | --- | --- | --- |
| A | simple-sections | base-stage, run-bar, stack-sheets, filter-sort-card | 1 | 0 | PASS |
| B | medium-sections | lookup-stage, sort-list, merge-toggles, filter-list | 1 | 0 | PASS |
| C | complex-sections | column-chips, calc-stage, detail-band-stage, pipeline-card | 1 | 0 | PASS |
| D | layout-card | layout-card (4 sub-components) | 1 | 0 | PASS |

**Total:** 13 files, 16 `useStore(s => s)` calls → scoped selectors

---

## Design Deviations

None — all plans followed the design exactly.

---

## Key Decisions

| Decision | Rationale | Plan |
| --- | --- | --- |
| `_buildTooltip` signature refactored from `(c, src, state: AppState)` to `(c, src, calcStages, tables)` | Avoids pulling full AppState through the reactive selector for a tooltip helper that only reads two specific fields | C |
| `pipeline-card.tsx` raw `getStore().subscribe()` preserved | Clears preview cache on any store change — using `useStore` would cause unnecessary re-renders. Confirmed legitimate exception by Pattern-Enforcer | C |
| `buildReportSpecFromState(state)` → `buildReportSpecFromState(getStore().getState())` in render-paths | These need full AppState but are render-path calls, not event-handler calls. Switching to imperative read prevents extra subscription dependencies | B, C, D |
| Default values inlined in selectors | `aggMode \|\| 'none'`, `stacks \|\| []`, `colOrder \|\| []` — preserves original defensive defaults in the scoped selector pattern | A, B |

---

## Files Modified

| Layer | Files |
| --- | --- |
| UI — sections | base-stage.tsx, run-bar.tsx, stack-sheets.tsx, lookup-stage.tsx, sort-list.tsx, merge-toggles.tsx, filter-list.tsx, column-chips.tsx, calc-stage.tsx, detail-band-stage.tsx |
| UI — cards | filter-sort-card.tsx, pipeline-card.tsx, layout-card.tsx |

**Non-UI layers:** Zero changes

---

## Final Quality

| Gate | Result |
| --- | --- |
| TypeScript | 0 errors in scoped files (12 pre-existing in calc-builder.test.tsx) |
| ESLint | 0 errors, 1 pre-existing warning (calc-builder.test.tsx) |
| Tests | 1189/1195 passed (6 pre-existing failures in calc-builder.test.tsx) |
| Identity selectors | **Zero `useStore(s => s)` remaining in entire UI layer** |
