# Task: Data Model & Serialization for Temp-Table Pipeline

## Problem Statement

The temp-table pipeline feature requires three new configuration fields — `includeSourceColumn`, `sourceColumnName`, and `stackAliases` — on both `AppState` (flat state used by UI/store) and `ReportSpec.pipeline` (serializable report spec used by the pipeline engine). These fields control whether a "Source Sheet" column is added to UNION ALL output, what that column is named, and what display aliases are used for stacked sheet names.

This plan (Part A) adds the fields to the type system, factory defaults, serialization, hydration, and schema versioning. All changes are additive — existing `.rcjson` files load with safe defaults (`false`, `"Source Sheet"`, `{}`). No behavior changes — the pipeline does not consume these fields yet (that happens in Parts B and C).

Downstream plans (B, C, E) depend on these type definitions and serialization contracts being in place.

## Phases

### Phase 1: Type Definitions, Factory Defaults, Serialization & Schema

- [x] Add three optional fields to `AppState` interface in `SRC/preact/types.ts` after `detailBands` (line 199): `includeSourceColumn: boolean`, `sourceColumnName: string`, `stackAliases: Record<string, string>`
    **Note:** Added three required fields to AppState interface in SRC/preact/types.ts after detailBands: `includeSourceColumn: boolean`, `sourceColumnName: string`, `stackAliases: Record<string, string>`.
- [x] Add three optional fields to `ReportSpec.pipeline` inline type in `SRC/preact/types.ts` after `detailBands?` (line 228): `includeSourceColumn?: boolean`, `sourceColumnName?: string`, `stackAliases?: Record<string, string>`
    **Note:** Added three optional fields to ReportSpec.pipeline inline type in SRC/preact/types.ts after detailBands?: `includeSourceColumn?: boolean`, `sourceColumnName?: string`, `stackAliases?: Record<string, string>`.
- [x] Add defaults for the three new fields in `createAppState()` in `SRC/preact/core/state.ts` after `columnTypeOverrides: {}` (line 42): `includeSourceColumn: false`, `sourceColumnName: 'Source Sheet'`, `stackAliases: {}`
    **Note:** Added defaults in createAppState() in SRC/preact/core/state.ts after columnTypeOverrides: {}: `includeSourceColumn: false`, `sourceColumnName: 'Source Sheet'`, `stackAliases: {}`.
- [x] Add defaults for the three new fields in `createReportSpec()` pipeline object in `SRC/preact/core/state.ts` after `detailBands: []` (line 82): `includeSourceColumn: false`, `sourceColumnName: 'Source Sheet'`, `stackAliases: {}`
    **Note:** Added defaults in createReportSpec() pipeline object in SRC/preact/core/state.ts after detailBands: []: `includeSourceColumn: false`, `sourceColumnName: 'Source Sheet'`, `stackAliases: {}`.
- [x] Add the three new fields to `buildReportSpecFromState()` return object in `SRC/preact/core/state.ts` (after `detailBands` line 165): `includeSourceColumn: state.includeSourceColumn`, `sourceColumnName: state.sourceColumnName`, `stackAliases: state.stackAliases || {}`
    **Note:** Added three fields to buildReportSpecFromState() return in SRC/preact/core/state.ts after detailBands: `includeSourceColumn: state.includeSourceColumn`, `sourceColumnName: state.sourceColumnName`, `stackAliases: state.stackAliases || {}`.
- [x] Add three fields to `buildPayload()` return object in `SRC/preact/core/state-serializer.ts` (after `columnTypeOverrides` line 88): `includeSourceColumn: !!state.includeSourceColumn`, `sourceColumnName: state.sourceColumnName || 'Source Sheet'`, `stackAliases: { ...(state.stackAliases || {}) }`
    **Note:** Added three fields to buildPayload() return in SRC/preact/core/state-serializer.ts after columnTypeOverrides: `includeSourceColumn: !!state.includeSourceColumn`, `sourceColumnName: state.sourceColumnName || 'Source Sheet'`, `stackAliases: { ...(state.stackAliases || {}) }`.
- [x] Add hydration section in `hydrateState()` in `SRC/preact/core/state-hydrator.ts` (before the `return` statement, after the column type overrides section ~line 395): read `payload.includeSourceColumn` (default `false`), `payload.sourceColumnName` (default `'Source Sheet'`), `payload.stackAliases` (default `{}`) into `next` with type-safe fallbacks for old configs missing these fields
    **Note:** Added hydration section in hydrateState() in SRC/preact/core/state-hydrator.ts before the return statement. Reads payload.includeSourceColumn (default false via ===true), payload.sourceColumnName (default 'Source Sheet' with string+non-empty check), payload.stackAliases (default {} with type-safe iteration filtering to string values only). Handles old configs missing these fields gracefully.
- [x] Bump `STATE_VERSION` from 2 to 3 in `SRC/preact/core/state-schema.ts` and add `'includeSourceColumn'`, `'sourceColumnName'`, `'stackAliases'` to the `RECOGNIZABLE_KEYS` array
    **Note:** Bumped STATE_VERSION from 2 to 3 in SRC/preact/core/state-schema.ts. Added 'includeSourceColumn', 'sourceColumnName', 'stackAliases' to RECOGNIZABLE_KEYS array.

### Phase 2: Existing Test Updates & Verification Gate

- [x] Update existing test assertions: in `SRC/preact/tests/core/state.test.ts` add default checks for the 3 new fields in `createAppState()` test (after line 46), add pipeline default checks in `createReportSpec()` test (after line 101), update `buildReportSpecFromState()` key-count assertion from 6 to 9 keys (line 232-234) with pass-through assertions; in `SRC/preact/tests/core/state-serializer.test.ts` add `includeSourceColumn`, `sourceColumnName`, `stackAliases` checks to the "serialize a minimal state with defaults" test (after line 43)
    **Note:** Updated test assertions in two files for the 3 new pipeline fields (includeSourceColumn, sourceColumnName, stackAliases). In state.test.ts: added 3 default checks in createAppState() test after detailBands assertion, added 3 pipeline default checks in createReportSpec() test after pipeline.detailBands assertion, updated buildReportSpecFromState() key-count test from 6 to 9 fields with expanded keys array including includeSourceColumn, sourceColumnName, stackAliases, and added 3 pass-through assertions in the value-correctness test. In state-serializer.test.ts: updated version assertion from 2 to 3 (payload.v) and added 3 default checks for the new fields after detailBands assertion.
- [x] Run `npm run typecheck`, `npm run lint`, and `npm test` from `SRC/` — zero typecheck errors, zero lint warnings, all tests pass
    **Note:** Verification gate passed with all three checks clean: typecheck 0 errors, lint 0 warnings, all 1195 tests across 61 files pass. The two previously-failing tests (state-serializer.test.ts version assertion and state.test.ts key-count assertion) now pass.

## Completion Criteria

- `AppState` interface has `includeSourceColumn: boolean`, `sourceColumnName: string`, `stackAliases: Record<string, string>` with JSDoc
- `ReportSpec.pipeline` inline type has the same three fields as optional
- `createAppState()` returns `includeSourceColumn: false`, `sourceColumnName: 'Source Sheet'`, `stackAliases: {}`
- `createReportSpec()` pipeline includes the same three defaults
- `buildReportSpecFromState()` propagates all three fields from AppState to its return object
- `buildPayload()` serializes all three fields with defensive defaults
- `hydrateState()` reads all three fields from payload with safe fallbacks for old configs
- `STATE_VERSION` is 3; `RECOGNIZABLE_KEYS` includes the three new field names
- Existing tests updated to assert new defaults and payload fields
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green

## References

- Design doc: `artifacts/designs/pending/DD-temp-table-pipeline.md` — Section "Source Column Support" and "Key Decisions §4: Stack Aliases Storage"
- Parts breakdown: `artifacts/designs/parts/temp-table-pipeline/README.md` — Part A scope
- Contracts ledger: `artifacts/designs/parts/temp-table-pipeline/CONTRACTS.md` — Data Model Contracts table
- Downstream consumers: Parts B (stage functions read `reportSpec.pipeline.includeSourceColumn`), C (pipeline engine), E (UI for source column checkbox and alias inputs)
