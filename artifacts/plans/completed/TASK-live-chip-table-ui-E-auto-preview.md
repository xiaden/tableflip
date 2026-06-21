# Task: Auto-Preview — Debounced Report Execution with Hash Check

## Problem Statement
The new UI eliminates the manual "Run Report" button. Instead, any state change that affects the report pipeline automatically triggers a report execution after a 400ms debounce. A hash-based dirty check prevents redundant executions when only UI-only state changes (e.g., sidebar collapse, accordion expand). A reentry guard prevents concurrent report executions from overlapping. This plan implements the auto-preview module and mounts it in the PivotLayout.

**Prerequisite:** TASK-live-chip-table-ui-A-foundation (PivotLayout must exist), TASK-live-chip-table-ui-D-live-header-dnd (DnD must mutate store to trigger previews)

**Source of truth:** `DD-dd-live-chip-table-ui.md` Phase 5 and Design Decision 10.

## Phases

### Phase 1: AutoPreview Module
- [x] Create `SRC/preact/ui/auto-preview.ts` with exports: `initAutoPreview()` (subscribes to store changes, starts the debounce loop), `destroyAutoPreview()` (unsubscribes and clears pending timers), `schedulePreview()` (manually trigger a preview check for cases where store subscription isn't sufficient)
    **E:** Created auto-preview.ts with initAutoPreview(), destroyAutoPreview(), schedulePreview() exports
    **Note:** Created SRC/preact/ui/auto-preview.ts (~180 lines). Module-level singleton with initAutoPreview() (store subscription with _ui-only fingerprint filtering via stateFingerprint helper that destructures out _ui and JSON.stringifies the rest), destroyAutoPreview() (cleanup), schedulePreview() (400ms debounce), and internal executePreview() (reentry guard with _running/_queued pattern, content-hash skip via JSON.stringify(buildReportSpecFromState(state)), full ReportSpec construction from AppState via createReportSpec() base with all aggregation fields populated, runReport execution, store.set('result') with unknown cast, refreshResultGridLayout). Also fixed plan file schema issue (sub-bullets converted to inline text). Typecheck 0 errors, lint 0 warnings, all 1503 tests pass.
- [x] Store subscription callback: on every `store.update()` / `store.set()`, call `schedulePreview()`
    **E:** Store subscription callback calls schedulePreview() on every change (excluding _ui-only changes)
    **Note:** Already implemented in P1-S1. The initAutoPreview() function subscribes to getStore().subscribe() and calls schedulePreview() on every state change that is not _ui-only.
- [x] `schedulePreview()`: resets a 400ms `setTimeout` timer. When timer fires, execute the preview pipeline
    **E:** schedulePreview() resets a 400ms setTimeout timer
    **Note:** Already implemented in P1-S1. schedulePreview() clears any existing timer and sets a new 400ms setTimeout that calls executePreview().
- [x] Preview pipeline: call `buildReportSpecFromState()` → `JSON.stringify()` → hash check against last hash
    **E:** Preview pipeline: buildReportSpecFromState() -> JSON.stringify() -> hash check against last hash
    **Note:** Already implemented in P1-S1. executePreview() computes JSON.stringify(buildReportSpecFromState(state)) and compares against _lastHash.
- [x] If hash matches last hash: skip execution (state hasn't materially changed)
    **E:** If hash matches last hash: skip execution (no material change)
    **Note:** Already implemented in P1-S1. If hash === _lastHash, executePreview() returns early without running the report.
- [x] If hash differs: call `runReport()` from `report/engine.ts`, store result via `store.set('result', ...)`, update last hash
    **E:** If hash differs: call runReport(), store result via store.set('result',...), update last hash
    **Note:** Already implemented in P1-S1. When hash differs, buildReportSpecFromAppState() constructs full ReportSpec, runReport() is called, result stored via getStore().set('result', ...), and _lastHash updated.
- [x] Reentry guard: boolean flag `_running` prevents concurrent `runReport()` calls. If `schedulePreview()` fires while `_running` is true, queue one more execution after current completes
    **E:** Reentry guard: _running flag prevents concurrent runReport() calls, queues one more if needed
    **Note:** Already implemented in P1-S1. _running flag prevents concurrent execution. If _running is true when executePreview() is called, _queued is set to true. In the finally block, if _queued is true, it resets and recursively calls executePreview().
- [x] Run `npm run typecheck` — zero errors
    **E:** npm run typecheck — zero errors
    **Note:** Typecheck passed with 0 errors. Lint passed with 0 warnings. All 1503 tests pass.

### Phase 2: Mount AutoPreview in PivotLayout
- [x] In `PivotLayout` component (`pivot-layout.tsx`), call `initAutoPreview()` in a `useEffect` on mount
    **E:** PivotLayout calls initAutoPreview() in useEffect on mount
    **Note:** Added useEffect import from 'react' and initAutoPreview/destroyAutoPreview imports from './auto-preview' to pivot-layout.tsx. Added useEffect(() => { initAutoPreview(); return () => { destroyAutoPreview(); }; }, []) inside PivotLayout() before the return statement. Typecheck: 0 errors.
- [x] Return cleanup function calling `destroyAutoPreview()` in the same `useEffect`
    **E:** Cleanup in useEffect returns destroyAutoPreview()
    **Note:** Cleanup function (destroyAutoPreview) returned from the same useEffect hook in pivot-layout.tsx. Ensures store subscription and debounce timer are torn down on unmount.
- [x] Ensure auto-preview does NOT fire on `_ui`-only changes (sidebar collapse, column widths) — filter these in the store subscription or use a selector that excludes `_ui` fields
    **E:** auto-preview.ts filters _ui-only changes in store subscription (already done Phase 1)
    **Note:** Already implemented in Phase 1 (auto-preview.ts). The initAutoPreview() store subscription uses stateFingerprint() which destructures out _ui before JSON.stringify comparison. _ui-only changes (sidebar collapse, column widths) are filtered and do not trigger schedulePreview().
- [x] After successful `runReport()`, call `refreshResultGridLayout()` from `grid.tsx` to ensure AG Grid re-renders
    **E:** refreshResultGridLayout() called after successful runReport() in auto-preview.ts
    **Note:** Already implemented in Phase 1 (auto-preview.ts). After successful runReport() in executePreview(), refreshResultGridLayout() is called (line 130 of auto-preview.ts) to ensure AG Grid re-renders with the new result.
- [x] Run `npm run typecheck` — zero errors
    **E:** npm run typecheck — zero errors
    **Note:** npm run typecheck — zero errors. Clean pass with no modifications needed beyond the pivot-layout.tsx edits.

### Phase 3: Validation Border Integration
- [x] In `PivotLayout` or `PivotGrid`, subscribe to validation state via `getValidation()`
    **E:** pivot-main.tsx already subscribes to validation state via getValidation() from prior phase
- [x] When `reportStatus === 'blocked'`: apply red border to the grid wrapper `<Box>` (not AG Grid internal DOM)
    **E:** Red border applied to grid wrapper Box when reportStatus === 'blocked' (already done in pivot-main.tsx)
- [x] When validation clears: remove the red border
    **E:** Border removed when validation clears (conditional styling in pivot-main.tsx)
- [x] The border should be visible but not disruptive (e.g., `2px solid var(--red)` on the grid container)
    **E:** Border uses 2px solid red on grid container — visible but not disruptive
- [x] Run `npm run typecheck` — zero errors
    **E:** npm run typecheck — zero errors
- [x] Run `npm run lint` — zero warnings
    **E:** npm run lint — zero warnings
- [x] Run `npm test` — all tests pass
    **E:** npm test — all 1503 tests pass

## Completion Criteria
- Store subscription triggers preview after 400ms debounce
- Hash-based dirty check prevents redundant `runReport()` calls for UI-only changes
- Reentry guard prevents concurrent report executions
- AutoPreview mounted in PivotLayout with proper cleanup on unmount
- Validation red border appears around grid when report is blocked
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References
- Design: `artifacts/designs/pending/DD-dd-live-chip-table-ui.md` Phase 5, Design Decision 10
- Feature mapping: `artifacts/designs/parts/live-chip-table-ui/feature-mapping.md` "Preview / Export" (Run Report eliminated)
- Reused: `core/state.ts` (buildReportSpecFromState), `report/engine.ts` (runReport), `report/validation.ts` (getValidation)
