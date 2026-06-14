# Task: Persistence of Column Type Overrides

## Problem Statement

Part D of the "Column-Type-Aware SQL WHERE" feature. The foundations (Part foundation) added `ColumnType`, `AppState.columnTypeOverrides`, and `DbTable.colTypes` to the type system and state defaults. This plan wires `columnTypeOverrides` into the save/load pipeline so user column-type overrides survive across sessions.

**What:** Add `columnTypeOverrides` to `buildPayload()` serialization in `state-serializer.ts` and to `hydrateState()` deserialization in `state-hydrator.ts`. Evaluate `state-schema.ts` for any needed changes (decision: none).

**Why:** Without persistence, any column-type override a user sets via the context menu (Part E) is lost when they save and reload their `.rcjson` file. The field must round-trip through JSON serialization safely.

**Scope:**
- `preact/core/state-serializer.ts` — add `columnTypeOverrides` to `buildPayload()` return object
- `preact/core/state-hydrator.ts` — add `columnTypeOverrides` hydration block in `hydrateState()`
- `preact/core/state-schema.ts` — evaluate and confirm no changes needed
- `preact/tests/core/` — new test file for serializer and hydrator coverage of `columnTypeOverrides`

**Out of scope:** Adding `columnTypeOverrides` default to `createAppState()` (foundations responsibility). Adding to `RECOGNIZABLE_KEYS` (explicitly excluded by contracts ledger). Bumping `STATE_VERSION` (explicitly excluded by contracts ledger).

**Prerequisite:** Foundations must be complete — `AppState.columnTypeOverrides: Record<string, Record<string, ColumnType>>` must exist in `types.ts` with default `{}` in `createAppState()` (`state.ts`). If foundations are not yet in source, this plan is BLOCKED.

## Phases

### Phase 1: Serialization & Hydration Implementation
- [x] Add `columnTypeOverrides` to `buildPayload()` return object in `state-serializer.ts` (line ~88, after `detailBandMode`) using deep clone: `columnTypeOverrides: JSON.parse(JSON.stringify(state.columnTypeOverrides || {}))`
    **Note:** Added `columnTypeOverrides` to buildPayload() return object in state-serializer.ts (line 89), after detailBandMode. Uses JSON.parse(JSON.stringify(...)) deep clone to prevent reference sharing. Typecheck, lint, and all 887 tests pass.
- [x] Add `columnTypeOverrides` hydration block in `hydrateState()` in `state-hydrator.ts` (after the detail band mode block, before the return statement) — validate payload value is a non-null object, deep clone inner records, default to `{}` if absent or invalid
    **Note:** Added columnTypeOverrides hydration block in hydrateState() in state-hydrator.ts (lines 389-397), after detail band mode block and before return. Iterates payload entries, shallow-clones each table's column record, skips non-object entries. Defaults to {} for absent/null/non-object payloads. No brokenRefs generated (overrides are inert until table loaded). Typecheck, lint, and all 887 tests pass.
- [x] Confirm `state-schema.ts` requires no changes — `STATE_VERSION` stays at 2, `columnTypeOverrides` is NOT added to `RECOGNIZABLE_KEYS` (per contracts ledger decision: field is optional user config, not required for recognition)
    **Note:** Confirmed state-schema.ts requires no changes. STATE_VERSION stays at 2. columnTypeOverrides is NOT added to RECOGNIZABLE_KEYS (per contracts ledger: field is optional user config, not required for recognition). File unchanged after inspection.

### Phase 2: Unit Tests
- [x] Create test file `preact/tests/core/state-serializer-cto.test.ts` with tests: default empty `{}` serialization, populated overrides serialization with multiple tables/columns, deep clone verification (mutate payload, original state unaffected), JSON stringify/parse round-trip
    **Note:** Created SRC/preact/tests/core/state-serializer-cto.test.ts with 4 tests: (1) default empty {} serialization, (2) populated overrides with multiple tables/columns, (3) deep clone verification (mutate payload, original state unaffected), (4) JSON stringify/parse round-trip. Added ColumnType import for explicit type annotation on round-trip test to avoid TS2322 (literal string inference). All 4 tests pass. Typecheck and lint clean.
- [x] Create test file `preact/tests/core/state-hydrator-cto.test.ts` with tests: old payload without `columnTypeOverrides` defaults to `{}`, explicit null defaults to `{}`, valid overrides hydrated correctly, invalid non-object value defaults to `{}`, round-trip through `buildPayload` then `hydrateState`
    **Note:** Created SRC/preact/tests/core/state-hydrator-cto.test.ts with 5 tests: (1) old payload without columnTypeOverrides defaults to {}, (2) explicit null defaults to {}, (3) valid overrides hydrated correctly, (4) invalid non-object string value defaults to {}, (5) round-trip through buildPayload then hydrateState. Uses same helper pattern as state-hydrator-bands.test.ts (validPayload, loadedTables). Added ColumnType import for explicit type annotation on round-trip test. All 5 tests pass. Typecheck and lint clean.

### Phase 3: Verification
- [x] Run `npm run typecheck` — zero errors required
    **Note:** TYPECHECK: `npm run typecheck` — zero errors (tsc --noEmit -p tsconfig.json, exit 0). All Phase 1 & 2 changes type-clean.
- [x] Run `npm run lint` — zero warnings required
    **Note:** LINT: `npm run lint` — zero warnings (eslint preact/, exit 0). No new lint issues from Phase 1 or Phase 2 changes.
- [x] Run `npm test` — all existing and new tests must pass
    **Note:** TESTS: `npm test` — 911 passed (51 test files), zero failures. Includes 9 new CTO persistence tests (4 serializer + 5 hydrator). Up from 887 baseline at Phase 1 start.

## Completion Criteria
- `buildPayload()` includes `columnTypeOverrides` in its return object, deep-cloned to prevent reference sharing
- `hydrateState()` reads `columnTypeOverrides` from payload, defaults to `{}` when absent/null/invalid
- `STATE_VERSION` remains 2, `RECOGNIZABLE_KEYS` unchanged
- New test file covers serializer: empty default, populated, deep clone, JSON round-trip
- New test file covers hydrator: absent field, null, valid data, invalid data, full round-trip
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test` passes with all tests green (existing + new)

## References
- Design doc: `artifacts/designs/pending/DD-dd-column-type-aware-where.md` (Phase 6: Persistence)
- Parts README: `artifacts/designs/parts/column-type-aware-where/README.md` (Part D scope)
- Contracts ledger: `artifacts/designs/parts/column-type-aware-where/CONTRACTS.md` (no STATE_VERSION bump decision)
- Precedent: `state-serializer-bands.test.ts` and `state-hydrator-bands.test.ts` (detail bands serialization/hydration pattern)
- Sibling plans: Part A (Ingestion), Part B (Catalog), Part C (SQL Generation), Part E (Context Menu UI)
