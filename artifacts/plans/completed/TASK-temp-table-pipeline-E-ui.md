# Task: UI for Source Column & Stack Aliases

## Problem Statement

The temp-table pipeline design (DD-temp-table-pipeline) introduces three new state fields: `includeSourceColumn` (boolean), `sourceColumnName` (string), and `stackAliases` (Record<string, string>). Part A added these fields to `AppState`, `ReportSpec.pipeline`, serialization, and hydration with safe defaults (`false`, `"Source Sheet"`, `{}`). Part C built the `PipelineEngine` that actually uses these fields — `executeBaseStage` injects a source column literal into the UNION ALL when `includeSourceColumn` is true, and reads `stackAliases[tableId]` for the literal value.

This plan adds the user-facing controls that let users configure these fields. The UI must come AFTER Part C because the feature is useless until the pipeline engine actually generates the source column — users need to run a report and see the "Source Sheet" column in the output to understand what the checkbox does.

**Controls to add:**
1. A checkbox "Show source sheet column" in the pipeline card's stack section — toggles `includeSourceColumn`.
2. A text input for `sourceColumnName` — visible when checkbox is checked, default "Source Sheet".
3. Per-stack alias text inputs next to each stack chip in `stack-sheets.tsx` — visible when source column is enabled, reads/writes `stackAliases[tableId]`.

**Prerequisite:** TASK-temp-table-pipeline-C-engine-integration (Part C) must be executed first. Part C provides the working `PipelineEngine`, `getPipelineEngine()`, `getPipelineState()`, and the `runReport()` integration that makes the source column feature actually produce output.

## Phases

### Phase 1: Source Column Controls in pipeline-card.tsx

- [x] Add MUI imports to `SRC/preact/ui/cards/pipeline-card.tsx`: `Checkbox` from `@mui/material/Checkbox`, `FormControlLabel` from `@mui/material/FormControlLabel`, `TextField` from `@mui/material/TextField`. Add `includeSourceColumn` and `sourceColumnName` to the `useStore` selector (lines 51-58): extend the destructured object with `includeSourceColumn: s.includeSourceColumn` and `sourceColumnName: s.sourceColumnName`.
    **Note:** Added 3 MUI imports (Checkbox, FormControlLabel, TextField) after existing MUI imports (line 33-35). Extended useStore selector with `includeSourceColumn: s.includeSourceColumn` and `sourceColumnName: s.sourceColumnName` (lines 61-62).
- [x] Add a `FormControlLabel` with a `Checkbox` below the `<StackSheets>` component inside the stack section `<div className="pl-stage">` (after line 151, before the closing `</div>` of the stack section). The checkbox reads `includeSourceColumn` and writes via `getStore().update(draft => { draft.includeSourceColumn = e.target.checked; })`. Label text: "Show source sheet column". Use `size="small"` and `sx={{ py: 0, px: 0.5 }}` on the Checkbox to match the existing pattern in `filter-list.tsx` (lines 107-118) and `merge-toggles.tsx` (lines 70-82). Wrap in a `<div>` with `style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}`.
    **Note:** Added FormControlLabel with Checkbox inside a wrapper div after <StackSheets> in the stack section (lines 157-168). Uses `!!includeSourceColumn` for checked state, writes via getStore().update(). Label: "Show source sheet column". Checkbox uses size="small" and sx={{ py: 0, px: 0.5 }} matching filter-list.tsx pattern. Added flexWrap:'wrap' to wrapper div to handle narrow widths.
- [x] Add a conditional `TextField` for `sourceColumnName` directly below the checkbox, rendered only when `includeSourceColumn === true`. The field reads `sourceColumnName || 'Source Sheet'` (fallback for empty string), writes via `getStore().update(draft => { draft.sourceColumnName = e.target.value; })`. Use `size="small"`, `placeholder="Source Sheet"`, `sx={{ mt: 0.5, minWidth: 180, '& .MuiInputBase-input': { fontSize: '0.82rem' } } }` to match the existing TextField pattern in `calc-stage.tsx` (line 330). Place it inside the same wrapper `<div>` as the checkbox.
    **Note:** Added conditional TextField (lines 169-177) rendered only when includeSourceColumn is true. Value reads `sourceColumnName || 'Source Sheet'` (fallback for empty/undefined). Writes via getStore().update(). Uses size="small", placeholder="Source Sheet", sx matching calc-stage.tsx TextField pattern (fontSize 0.82rem, minWidth 180).
- [x] Run `npm run typecheck && npm run lint` from `SRC/` — zero errors, zero warnings. Verify the checkbox renders in the pipeline card's stack section and the text input appears/disappears with the checkbox toggle.
    **Note:** typecheck: 0 errors. lint: 0 warnings. Both clean.

### Phase 2: Stack Alias Inputs in stack-sheets.tsx

- [x] In `SRC/preact/ui/sections/stack-sheets.tsx`, add `TextField` import from `@mui/material/TextField`. Extend the `useStore` selector (line 29) to include `includeSourceColumn: s.includeSourceColumn` and `stackAliases: s.stackAliases`. Inside the existing `stacks.filter(id => tables[id]).map(id => ...)` loop (lines 68-81), wrap each `<Chip>` and a conditional `<TextField>` in a `<span>` with `style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}`. The TextField is rendered only when `includeSourceColumn === true`. It reads `stackAliases?.[id] ?? ''`, uses `placeholder={tables[id].name}`, `size="small"`, `sx={{ width: 90, '& .MuiInputBase-input': { fontSize: '0.76rem', py: '2px' } } }`, and `variant="outlined"`.
    **Note:** Added TextField import from @mui/material/TextField (line 18). Extended useStore selector with includeSourceColumn: s.includeSourceColumn and stackAliases: s.stackAliases (line 30). Wrapped each stack Chip + conditional TextField in a <span> with inline-flex layout (lines 78-100). TextField renders only when includeSourceColumn === true, reads stackAliases?.[id] ?? '', uses placeholder={tables[id].name}, size="small", variant="outlined", sx matching spec (width 90, fontSize 0.76rem, py 2px).
- [x] Add an `onAliasChange` callback in `StackSheets` using `useCallback`: `(id: string, value: string) => { getStore().update(draft => { if (!draft.stackAliases) draft.stackAliases = {}; draft.stackAliases[id] = value; }); _afterCombineChange(); }`. Wire it to the TextField's `onChange` handler via `onChange={e => onAliasChange(id, e.target.value)}`. The `_afterCombineChange()` call follows the existing pattern used by `addStack` and `removeStack`.
    **Note:** Added onAliasChange callback (lines 48-54) using useCallback with empty deps []. Updates draft.stackAliases[id] = value via getStore().update(), initializing draft.stackAliases = {} if needed. Calls _afterCombineChange() following the same pattern as addStack and removeStack. Wired to TextField onChange via e => onAliasChange(id, e.target.value) (line 93).
- [x] Run `npm run typecheck && npm run lint && npm test` from `SRC/` — zero typecheck errors, zero lint warnings, all tests pass. Fix any issues found before proceeding.
    **Note:** typecheck: 0 errors. lint: 0 warnings. tests: 65 files, 1282 tests, all passed. All three gates clean.

## Completion Criteria

- `pipeline-card.tsx` renders a "Show source sheet column" checkbox in the stack section that toggles `includeSourceColumn` in the store
- `pipeline-card.tsx` renders a text input for `sourceColumnName` that appears only when the checkbox is checked, with placeholder "Source Sheet"
- `stack-sheets.tsx` renders a per-stack alias text input next to each stack chip when `includeSourceColumn` is true
- Alias text inputs read from and write to `stackAliases[tableId]` in the store, with the table name as placeholder when no alias is set
- `_afterCombineChange()` is called after alias writes, following the existing pattern for stack add/remove
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References

- Design doc: `artifacts/designs/pending/DD-temp-table-pipeline.md` — Source Column Support section, Key Decision #3 (source column implementation), Key Decision #4 (stack aliases storage)
- Part scope: `artifacts/designs/parts/temp-table-pipeline/README.md` — Part E
- Contracts: `artifacts/designs/parts/temp-table-pipeline/CONTRACTS.md` — UI Contracts section
- Prerequisites: TASK-temp-table-pipeline-A-data-model (types, defaults), TASK-temp-table-pipeline-B-stage-functions (executeBaseStage uses the fields), TASK-temp-table-pipeline-C-engine-integration (PipelineEngine wires it all together)
- Existing checkbox pattern: `SRC/preact/ui/sections/filter-list.tsx` lines 107-118, `SRC/preact/ui/sections/merge-toggles.tsx` lines 70-82
- Existing TextField pattern: `SRC/preact/ui/sections/calc-stage.tsx` line 330, `SRC/preact/ui/sections/detail-band-stage.tsx` line 367
- Store pattern: `useStore()` for reads, `getStore().update()` for writes, `_afterCombineChange()` after pipeline state changes
