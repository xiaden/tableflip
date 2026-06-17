# Scoped Selectors — Contracts Ledger

**Design doc:** `artifacts/designs/pending/DD-preact-to-react-conversion.md` (resolved Open Question #2)
**Last updated:** 2026-06-17 (after Plans A, B, C, D validated)

---

## Architectural Rules

- Only `SRC/preact/ui/` changes — Core/Catalog/Query/Report layers untouched
- `useStore(selector)` is the canonical hook: `function useStore<T>(selector: (state: AppState) => T): T`
- `useStore` uses `useSyncExternalStore` internally with shallow equality comparison
- `getStore().getState()` for imperative reads in event handlers (not reactive)
- `getStore().update()` for mutations — unchanged
- No `dangerouslySetInnerHTML`, no `class` attribute (use `className` or MUI `sx`)
- Run `npm run typecheck && npm run lint && npm test` after all edits

---

## Collections & Methods

N/A — no database changes. `useStore` hook already exists at `SRC/preact/ui/useStore.ts`.

**Existing hook signature (unchanged):**
| Method | Signature |
| --- | --- |
| useStore | `function useStore<T>(selector: (state: AppState) => T): T` |

## Plans

| Plan | Files | Fields Scoped | Verified |
| --- | --- | --- | --- |
| A — simple-sections | base-stage, run-bar, stack-sheets, filter-sort-card | base, tables, aggMode, stacks | plan_read ✅ |
| B — medium-sections | lookup-stage, sort-list, merge-toggles, filter-list | lookups, tables, base, aggMode, selCols, colOrder, sorts, result, mergedCols, filters | plan_read ✅ |
| C — complex-sections | column-chips, calc-stage, detail-band-stage, pipeline-card | base, lookups, calcStages, aggMode, groupBy, selCols, colOrder, aggregates, subtotalBy, tables, detailBands, stacks | plan_read ✅ |
| D — layout-card | layout-card (4 sub-components) | base, aggMode, tables, colOrder, selCols, groupBy, subtotalGrandTotal, subtotalSpacer, subtotalOnTop, subtotalStrategy, mergeGroupUnderline, colTotals, subtotalBy, subtotalFns, aggregates | plan_read ✅ |

---

## API Contracts

N/A — no API changes. This is a client-side UI refinement.

---

## DTOs Created

N/A — `AppState` type unchanged.

---

## Decisions Made

 | Decision | Rationale | Plan |
 | --- | --- | --- |
 | `useStore(s => s)` is a violation of the selector-based design decision | DD resolved question #2 explicitly chose "selector-based from the start" | — |
 | `buildReportSpecFromState(state)` in event handlers → `buildReportSpecFromState(getStore().getState())` | These are imperative reads triggered by user actions, not reactive state subscriptions | — |
 | `pipeline-card.tsx` raw `getStore().subscribe()` kept as-is | Clears preview cache on any store change — using `useStore` would cause unnecessary re-renders. Legitimate exception confirmed by Pattern-Enforcer | — |
