# Task: Stack Mode UI Removal

## Problem Statement

The detail-bands-overlay feature replaces the interleaving data model with an overlay descriptor model. Stack mode (Cartesian cross-product rendering) fundamentally conflicts with the overlay model's "one band section per group boundary" design and is being deleted entirely — not hidden, not disabled.

Part A (Core types + engine contract + stack removal) removes stack mode from the engine layer: deletes `crossProductRows()`, `RowExplosionError`, `STACK_ROW_LIMIT`, the `if (mode === 'stack')` branch, and the `detailBandMode` type from `types.ts`, `ReportSpec`, state defaults, schema, serialization, and hydration.

Part C removes the **UI layer** remnants of stack mode that still reference the now-deleted engine exports and types. Three files are affected: `pipeline-card.tsx` (mode toggle radio buttons), `row-explosion-dialog.tsx` (entire file), and `run-bar.tsx` (error handler + dialog rendering). Two export lines in `index.ts` reference the deleted dialog file.

**Prerequisite:** TASK-detail-bands-overlay-A (Core types + engine contract + stack removal) must be completed first — Part A deletes `RowExplosionError`, `STACK_ROW_LIMIT`, `detailBandMode` type, and `stackRowLimit` parameter from `runReport()`. Part C removes the UI code that imports and uses these now-gone symbols.

## Phases

### Phase 1: Delete Row Explosion Dialog

The dialog component and its test file are entirely dead code — the error they respond to (`RowExplosionError`) is deleted by Part A.

- [x] Delete `SRC/preact/ui/components/row-explosion-dialog.tsx` (60 lines: `RowExplosionDialog` component + `RowExplosionDialogProps` interface)
    **Note:** Deleted SRC/preact/ui/components/row-explosion-dialog.tsx (60 lines: RowExplosionDialog component + RowExplosionDialogProps interface). File confirmed removed from disk.
- [x] Delete `SRC/preact/tests/ui/row-explosion-dialog.test.ts` (302 lines: tests for `crossProductRows`, `RowExplosionError`, `STACK_ROW_LIMIT`, dialog component, elevated limit calculation — all test stack mode behavior that no longer exists)
    **Note:** Deleted SRC/preact/tests/ui/row-explosion-dialog.test.ts (302 lines: tests for crossProductRows, RowExplosionError, STACK_ROW_LIMIT, dialog component, elevated limit calculation). File confirmed removed from disk.
- [x] Remove `RowExplosionDialog` value export from `SRC/preact/index.ts` line 100: `export { RowExplosionDialog } from './ui/components/row-explosion-dialog';`
    **Note:** Removed `export { RowExplosionDialog } from './ui/components/row-explosion-dialog';` from SRC/preact/index.ts (was line 100). index.ts went from 147 to 145 lines.
- [x] Remove `RowExplosionDialogProps` type export from `SRC/preact/index.ts` line 101: `export type { RowExplosionDialogProps } from './ui/components/row-explosion-dialog';`
    **Note:** Removed `export type { RowExplosionDialogProps } from './ui/components/row-explosion-dialog';` from SRC/preact/index.ts (was line 101). Both dialog exports now fully removed. Note: run-bar.tsx still imports RowExplosionDialog from the deleted file — expected, will be fixed in Phase 3.
  **Notes:** Part A removes `RowExplosionError` and `STACK_ROW_LIMIT` exports from `index.ts` line 70. If those exports are still present after Part A, this is a Part A gap — do NOT remove them here. This plan only removes the dialog-related exports (lines 100–101).

### Phase 2: Remove Mode Toggle from Pipeline Card

The mode toggle radio buttons let users switch between "Separate bands" and "Stack side-by-side" rendering. With `detailBandMode` type removed by Part A, this UI is dead code.

- [x] Remove `setBandMode` callback from `SRC/preact/ui/cards/pipeline-card.tsx` lines 101–106 (the `useCallback` that sets `draft.detailBandMode` and calls `invalidateValidation()`)
    **Note:** setBandMode callback was already absent from pipeline-card.tsx (removed by Part A). No action needed.
- [x] Remove `enabledBandCount` variable from `SRC/preact/ui/cards/pipeline-card.tsx` line 115 (`const enabledBandCount = detailBands.filter(b => b.enabled !== false).length;`) — only used by the mode toggle JSX
    **Note:** Removed `const enabledBandCount = detailBands.filter(b => b.enabled !== false).length;` from pipeline-card.tsx (was line 108). Only consumer was the mode toggle JSX.
- [x] Remove the mode toggle JSX block from `SRC/preact/ui/cards/pipeline-card.tsx` lines 167–193 (the `{enabledBandCount >= 2 && (...)}` conditional containing radio buttons for "Separate bands" and "Stack side-by-side")
    **Note:** Removed the entire mode toggle JSX block (27 lines: `{enabledBandCount >= 2 && (...)}` with radio buttons for 'Separate bands' and 'Stack side-by-side'). Also removed references to undefined `setBandMode` and deleted `state.detailBandMode`. File went from 218 to 188 lines.
- [x] Remove unused `invalidateValidation` import from `SRC/preact/ui/cards/pipeline-card.tsx` line 25 — only usage was inside `setBandMode` (line 105), which is now deleted
    **Note:** Removed `import { invalidateValidation } from '../../report/validation';` from pipeline-card.tsx. Only usage was inside the already-deleted setBandMode callback. Grep confirms zero remaining references to setBandMode, enabledBandCount, detailBandMode, bandMode, or invalidateValidation in pipeline-card.tsx.
  **Notes:** After removal, verify no other code in pipeline-card.tsx references `invalidateValidation`, `enabledBandCount`, `setBandMode`, or `detailBandMode`. The `detailBands` variable (line 45) is still used by the band stages rendering (lines 196–207) — keep it.

### Phase 3: Remove RowExplosionError Handler from Run Bar

The run bar catches `RowExplosionError` from the engine and shows the explosion dialog. Both the error type and the dialog are deleted. The `overrideLimit` parameter flow (used to re-run with elevated limit after dialog "Proceed") is also dead code.

- [x] Remove `RowExplosionDialog` import from `SRC/preact/ui/sections/run-bar.tsx` line 14: `import { RowExplosionDialog } from '../components/row-explosion-dialog';`
    **Note:** Removed `import { RowExplosionDialog } from '../components/row-explosion-dialog';` from run-bar.tsx (was line 14). File now has no dialog import.
- [x] Remove `RowExplosionError` from the engine import at `SRC/preact/ui/sections/run-bar.tsx` line 16 — change `import { runReport as executeReport, RowExplosionError } from '../../report/engine';` to `import { runReport as executeReport } from '../../report/engine';`
    **Note:** Changed engine import from `import { runReport as executeReport, RowExplosionError } from '../../report/engine'` to `import { runReport as executeReport } from '../../report/engine'`. RowExplosionError no longer imported.
- [x] Remove `explosionDialog` state declaration from `SRC/preact/ui/sections/run-bar.tsx` line 27: `const [explosionDialog, setExplosionDialog] = useState<{ projectedCount: number; limit: number } | null>(null);`
    **Note:** Removed `const [explosionDialog, setExplosionDialog] = useState<...>(null)` state declaration from run-bar.tsx.
- [x] Remove `detailBandMode` field from `ReportSpec` construction in `SRC/preact/ui/sections/run-bar.tsx` line 105: `detailBandMode: currentState.detailBandMode || 'separate',` — the field no longer exists on `ReportSpec` (removed by Part A)
    **Note:** Skipped — `detailBandMode` field was already absent from ReportSpec construction in run-bar.tsx (removed by Part A P5-S6). No action needed.
- [x] Remove `overrideLimit` parameter from `runQuery` callback in `SRC/preact/ui/sections/run-bar.tsx` line 47 — change `const runQuery = useCallback((overrideLimit?: number) => {` to `const runQuery = useCallback(() => {`
    **Note:** Changed `const runQuery = useCallback((overrideLimit?: number) => {` to `const runQuery = useCallback(() => {`. No dependency array references to overrideLimit existed.
- [x] Simplify `executeReport` call in `SRC/preact/ui/sections/run-bar.tsx` lines 108–110 — replace the conditional `const resultSet = overrideLimit != null ? executeReport(reportSpec, currentState.tables, overrideLimit) : executeReport(reportSpec, currentState.tables);` with `const resultSet = executeReport(reportSpec, currentState.tables);` — the `stackRowLimit` parameter no longer exists on `runReport()` (removed by Part A)
    **Note:** Replaced conditional `overrideLimit != null ? executeReport(reportSpec, currentState.tables, overrideLimit) : executeReport(reportSpec, currentState.tables)` with single call `executeReport(reportSpec, currentState.tables)`. The stackRowLimit parameter no longer exists on runReport().
- [x] Remove the `RowExplosionError` catch block from `SRC/preact/ui/sections/run-bar.tsx` lines 132–137 — replace the `if (ex instanceof RowExplosionError) { ... return; }` block with nothing (the general `catch` at line 132 should remain but without the RowExplosionError branch — keep the `setRunStatus('Error')` and `toast(...)` lines)
    **Note:** Removed 5-line `if (ex instanceof RowExplosionError) { ... return; }` block from catch handler. Catch block now contains only `setRunStatus('Error')` and `toast(...)` for all error types.
- [x] Remove `handleExplosionProceed` callback from `SRC/preact/ui/sections/run-bar.tsx` lines 144–149
    **Note:** Removed entire `handleExplosionProceed` callback (6 lines: useCallback with elevated limit calculation and runQuery(elevated) call).
- [x] Remove `handleExplosionCancel` callback from `SRC/preact/ui/sections/run-bar.tsx` lines 151–154
    **Note:** Removed entire `handleExplosionCancel` callback (4 lines: useCallback that cleared dialog and set 'Cancelled' status).
- [x] Remove `RowExplosionDialog` JSX rendering from `SRC/preact/ui/sections/run-bar.tsx` lines 175–182 (the `{explosionDialog && (<RowExplosionDialog .../>)}` block)
    **Note:** Verified zero remaining references in run-bar.tsx to: RowExplosionError, RowExplosionDialog, explosionDialog, handleExplosionProceed, handleExplosionCancel, overrideLimit, detailBandMode. File reduced from 184 to 155 lines (29 lines removed). Grep confirms clean.
  **Notes:** After removal, the catch block structure should be:
  ```
  } catch (ex: unknown) {
    setRunStatus('Error');
    toast('Query error: ' + (ex as Error).message, 'err');
  }
  ```
  Verify no remaining references to `RowExplosionError`, `RowExplosionDialog`, `explosionDialog`, `handleExplosionProceed`, `handleExplosionCancel`, `overrideLimit`, or `detailBandMode` in run-bar.tsx.

### Phase 4: Verification

- [ ] Run `npm run typecheck` from `SRC/` — zero errors required (confirms no dangling references to deleted symbols)
- [ ] Run `npm run lint` from `SRC/` — zero warnings required (confirms no unused imports or variables remain)
- [ ] Run `npm test` from `SRC/` — all tests pass (confirms deleted test file is not referenced by test runner and no remaining tests import deleted symbols)
  **Notes:** If typecheck fails on references to `RowExplosionError`, `STACK_ROW_LIMIT`, `crossProductRows`, `RowExplosionDialog`, `RowExplosionDialogProps`, or `detailBandMode` in files NOT listed in this plan, that indicates a Part A gap (engine/state layer removal was incomplete). Log the finding and report as blocked.

## Completion Criteria

- `SRC/preact/ui/components/row-explosion-dialog.tsx` does not exist on disk
- `SRC/preact/tests/ui/row-explosion-dialog.test.ts` does not exist on disk
- `pipeline-card.tsx` contains no references to `setBandMode`, `enabledBandCount`, `detailBandMode`, `bandMode`, or `invalidateValidation`
- `run-bar.tsx` contains no references to `RowExplosionError`, `RowExplosionDialog`, `explosionDialog`, `overrideLimit`, `handleExplosionProceed`, `handleExplosionCancel`, or `detailBandMode`
- `index.ts` contains no exports from `row-explosion-dialog`
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References

- Design doc: `artifacts/designs/pending/DD-detail-bands-rendering-overlay.md` — "Stack Mode Removal" table in Design Details section
- Parts README: `artifacts/designs/parts/detail-bands-overlay/README.md` — Part C scope definition
- Contracts: `artifacts/designs/parts/detail-bands-overlay/CONTRACTS.md` — "Stack mode removed entirely — not hidden, not disabled, deleted"
- Prerequisite plan: `TASK-detail-bands-overlay-A-core-types-engine-contract-stack-removal.md`
- Sibling plans: Part D (Grid overlay rendering), Part E (Export overlay rendering) — both depend on Part B, not Part C
