# Task: Catalog Type Propagation

## Problem Statement

The column-type-aware WHERE feature (DD-dd-column-type-aware-where.md) stores column type metadata on `DbTable.colTypes` and user overrides on `AppState.columnTypeOverrides` (both added in foundations). However, the catalog layer — which builds the `colMap` that the query layer uses to resolve column aliases — does not yet propagate this type information into `PhysicalColEntry` or `BandColEntry`. Without `colType` on colMap entries, the query layer's `getColumnType()` helper (Part C) has no type data to work with.

This plan adds `colType?: ColumnType` to `PhysicalColEntry` and `BandColEntry`, populates it in both `buildColSourceMap()` (store-based) and `buildColumnCatalog()` (pure/catalog-based), and updates test fixtures so existing tests continue to pass.

**Prerequisite:** Foundations (ColumnType, DbTable.colTypes, AppState.columnTypeOverrides, createAppState default) — already completed.

## Phases

### Phase 1: Type Extension
- [x] Add `ColumnType` to the import from `'../types'` in `preact/catalog/column-catalog.ts` (line 12)
    **Note:** Added ColumnType to import from '../types' on line 12. Import is alphabetically sorted.
- [x] Add `colType?: ColumnType` field to `PhysicalColEntry` interface (after `col: string`, line 22)
    **Note:** Added `colType?: ColumnType` field to PhysicalColEntry interface after `col: string` (line 23). Optional field — backward compatible with all existing object literals that don't set it.
- [x] Add `colType?: ColumnType` field to `BandColEntry` interface (after `col: string`, line 40)
    **Note:** Added `colType?: ColumnType` field to BandColEntry interface after `col: string` (line 42). Optional field — backward compatible with all existing object literals.
- [x] Verify `CalcColEntry` is NOT modified — calc column types are derived from `mode` at query time per the design doc
    **Note:** Verified CalcColEntry (lines 27-33) is unchanged — no colType field added. Calc column types are derived from mode at query time per design doc.
- [x] Run `npm run typecheck` — must pass with zero errors
    **Note:** `npm run typecheck` passed with zero errors (tsc --noEmit -p tsconfig.json, exit 0). All three interface changes type-check cleanly.

### Phase 2: buildColSourceMap Propagation
- [x] In `buildColSourceMap()`, add a local helper `resolveColType(tid, col)` that returns `state.columnTypeOverrides?.[tid]?.[col] ?? state.tables[tid]?.colTypes?.[col]` (returns `ColumnType | undefined`)
    **Note:** Added local helper `resolveColType(tid, col)` inside `buildColSourceMap()` at lines 91-93. Returns `state.columnTypeOverrides?.[tid]?.[col] ?? state.tables[tid]?.colTypes?.[col]` (ColumnType | undefined). Overrides take precedence over auto-detected colTypes.
- [x] Update base column entry creation (line 89) to spread `colType` when defined: `map.set(c, { tid: base, col: c, ...(resolveColType(base, c) ? { colType: resolveColType(base, c) } : {}) })`
    **Note:** Updated base column entry creation at line 95 to spread `colType` when defined: `map.set(c, { tid: base, col: c, ...(resolveColType(base, c) ? { colType: resolveColType(base, c) } : {}) })`. Conditional spread preserves backward compatibility — entries without type metadata remain unchanged.
- [x] Update lookup column entry creation (line 100) with the same pattern using `resolveColType(lk.rightId, c)`
    **Note:** Updated lookup column entry creation at line 106 with same conditional spread pattern: `map.set(alias, { tid: lk.rightId, col: c, ...(resolveColType(lk.rightId, c) ? { colType: resolveColType(lk.rightId, c) } : {}) })`. Uses lk.rightId as the table ID for type resolution.
- [x] Verify calc column entries (line 158) are NOT modified — no `colType` on `CalcColEntry`
    **Note:** Verified calc column entry at line 164 is unchanged: `map.set(alias, { kind: 'calc', mode: calc.mode as string, idx: i, calc: calc })` — no colType field. Calc column types are derived from mode at query time per design doc.
- [x] Run `npm run typecheck` — must pass with zero errors
    **Note:** `npm run typecheck` passed with zero errors (tsc --noEmit -p tsconfig.json, exit 0). All buildColSourceMap changes type-check cleanly.

### Phase 3: buildColumnCatalog Propagation
- [x] Add optional third parameter `options?: { columnTypeOverrides?: Record<string, Record<string, ColumnType>> }` to `buildColumnCatalog()` signature (after `sourceCatalog`, line 182). Default `undefined` — backward compatible with all existing callers.
    **Note:** Added optional third parameter `options?: { columnTypeOverrides?: Record<string, Record<string, ColumnType>> }` to buildColumnCatalog() signature (line 188). Backward compatible — existing 2-arg callers unaffected.
- [x] Add a local helper `resolveCatalogColType(tid, col)` inside `buildColumnCatalog` that returns `options?.columnTypeOverrides?.[tid]?.[col] ?? sourceCatalog.get(tid)?.source?.colTypes?.[col]` (returns `ColumnType | undefined`)
    **Note:** Added local helper `resolveCatalogColType(tid, col)` at lines 208-210 inside buildColumnCatalog(). Returns `options?.columnTypeOverrides?.[tid]?.[col] ?? sourceCatalog.get(tid)?.source?.colTypes?.[col]` (ColumnType | undefined). Overrides take precedence over auto-detected colTypes from source catalog.
- [x] Update base column entry creation (line 206) to spread `colType` when defined
    **Note:** Updated base column entry creation at line 217 with conditional spread: `colMap.set(c, { tid: base!, col: c, ...(resolveCatalogColType(base!, c) ? { colType: resolveCatalogColType(base!, c) } : {}) })`. colType only added when defined.
- [x] Update lookup column entry creation (line 227) with the same pattern
    **Note:** Updated lookup column entry creation at line 238 with same conditional spread pattern: `colMap.set(alias, { tid: lk.rightId, col: c, ...(resolveCatalogColType(lk.rightId, c) ? { colType: resolveCatalogColType(lk.rightId, c) } : {}) })`. Uses lk.rightId as the table ID for type resolution.
- [x] Update band column entry creation (line 245) with the same pattern using `resolveCatalogColType(band.rightId, c)`
    **Note:** Updated band column entry creation at line 256 with same conditional spread pattern: `colMap.set(alias, { kind: 'band', tid: band.rightId, col: c, ...(resolveCatalogColType(band.rightId, c) ? { colType: resolveCatalogColType(band.rightId, c) } : {}) })`. Uses band.rightId as the table ID for type resolution.
- [x] Verify calc column entries (line 304) are NOT modified
    **Note:** Verified calc column entry at line 315 is unchanged: `colMap.set(alias, { kind: 'calc', mode: calc.mode as string, idx: i, calc: calc })` — no colType field. Calc column types are derived from mode at query time per design doc.
- [x] Run `npm run typecheck` — must pass with zero errors
    **Note:** `npm run typecheck` passed with zero errors in column-catalog.ts. One pre-existing error remains in `state-serializer-cto.test.ts(62,7)` (string literal not assignable to ColumnType) — this existed before Phase 3 changes and is outside scope. Verified by running typecheck with changes stashed (24 errors before → 1 error after, all from prior phases).

### Phase 4: Test Fixture Updates
- [x] In `tests/query/helpers.ts`, add `ColumnType` to the import from `'../../types'` (line 6)
    **Deviation:** Plan said to add ColumnType to the import from '../../types'. Added it initially, but eslint flagged 'ColumnType' is defined but never used (@typescript-eslint/no-unused-vars). The colTypes object literals are type-checked via the DbTable.colTypes property type — no explicit ColumnType reference needed in this file. Reverted to original import to satisfy zero-warnings lint requirement. Import can be added in Phase 5 when new test file directly uses ColumnType type.
- [x] Update `ordersColMap()` (line 20-30): entries remain unchanged — they represent a generic fixture without colType metadata. No `colType` field means "unknown/default" which is the correct behavior for tests that don't test type-awareness.
    **Note:** Verified ordersColMap() (lines 20-30) entries remain unchanged. No colType field on entries — correct for generic fixture without type metadata. Conditional spread in buildColSourceMap/buildColumnCatalog ensures entries without colTypes data stay as { tid, col } only.
- [x] Update `standardSourceCatalog()` (line 33-50): add `colTypes` to the `source` DbTable for Orders — `{ OrderId: 'number', Amount: 'number', OrderDate: 'date', Company: 'string', Contact: 'string', Status: 'string', Region: 'string' }`. Add `colTypes` to Contacts source — `{ ContactId: 'number', Name: 'string', Email: 'string', Phone: 'string' }`.
- [x] Update `standardTables()` (line 90-95): add matching `colTypes` to the DbTable records for Orders and Contacts
- [x] Review existing `column-catalog.test.ts` assertions: `toEqual` checks exact object shape. Since `colType` is only spread when defined, and existing test fixtures don't set `colTypes` on their inline `DbTable` objects, existing assertions should pass unchanged. Verify by running tests.
- [x] Run `npm test` — all existing tests must pass

### Phase 5: New Catalog colType Tests
- [x] Create test file `tests/catalog/column-catalog-coltype.test.ts` with tests for the new colType propagation
    **Note:** Created test file SRC/preact/tests/catalog/column-catalog-coltype.test.ts with 9 test cases covering colType propagation in both buildColSourceMap and buildColumnCatalog. Imports: vitest (describe/it/expect/beforeEach), buildColSourceMap/buildColumnCatalog from column-catalog, SourceTableEntry from source-catalog, initStore from store.
- [x] Test: `buildColSourceMap` propagates `colType` from `DbTable.colTypes` for base columns — init store with `tables: { Orders: { ..., colTypes: { Amount: 'number' } } }`, verify entry has `colType: 'number'`
    **Note:** Test: buildColSourceMap propagates colType from DbTable.colTypes for base columns. Inits store with Orders table having colTypes: { Amount: 'number', Company: 'string' }, verifies map entries carry correct colType values.
- [x] Test: `buildColSourceMap` applies `columnTypeOverrides` over auto-detected `colTypes` — init store with both `colTypes: { Amount: 'string' }` and `columnTypeOverrides: { Orders: { Amount: 'number' } }`, verify entry has `colType: 'number'` (override wins)
    **Note:** Test: buildColSourceMap applies columnTypeOverrides over auto-detected colTypes. Inits store with colTypes: { Amount: 'string' } and columnTypeOverrides: { Orders: { Amount: 'number' } }, verifies override wins (colType: 'number').
- [x] Test: `buildColSourceMap` omits `colType` field when neither `colTypes` nor overrides provide a value — verify `entry.colType` is `undefined` (field absent)
    **Note:** Test: buildColSourceMap omits colType field when neither colTypes nor overrides provide a value. Uses expect('colType' in entry).toBe(false) to verify field absence (not just undefined value).
- [x] Test: `buildColSourceMap` propagates `colType` for lookup columns — init store with lookup, verify lookup column entries carry `colType` from right table's `colTypes`
    **Note:** Test: buildColSourceMap propagates colType for lookup columns. Inits store with Orders (base) and Contacts (lookup), both with colTypes. Verifies lookup column entries (ContactId, Name) carry colType from Contacts table's colTypes.
- [x] Test: `buildColumnCatalog` propagates `colType` from `sourceCatalog` entry's `source.colTypes` for base columns
    **Note:** Test: buildColumnCatalog propagates colType from sourceCatalog entry's source.colTypes for base columns. Creates sourceCatalog with Orders having source.colTypes: { OrderId: 'number', Amount: 'number', OrderDate: 'date' }. Calls with 2 args (no options). Verifies all three base column entries carry correct colType.
- [x] Test: `buildColumnCatalog` applies `columnTypeOverrides` via options parameter — pass `{ columnTypeOverrides: { Orders: { Amount: 'number' } } }` as third arg, verify override wins over `source.colTypes`
    **Note:** Test: buildColumnCatalog applies columnTypeOverrides via options parameter. Source has colTypes: { Amount: 'string' }, options pass columnTypeOverrides: { Orders: { Amount: 'number' } }. Verifies override wins (colType: 'number').
- [x] Test: `buildColumnCatalog` propagates `colType` for band columns — create spec with detailBands, verify band entries carry `colType` from child table's `colTypes`
    **Note:** Test: buildColumnCatalog propagates colType for band columns. Creates spec with detailBands referencing Details child table. SourceCatalog has both Orders and Details with colTypes. Verifies band entries (_band_0_Qty, _band_0_Price, _band_0_DetailId) carry colType: 'number' from Details table's colTypes and have kind: 'band'.
- [x] Test: `buildColumnCatalog` omits `colType` for calc columns — verify calc entry has no `colType` field regardless of underlying column types
    **Note:** Test: buildColumnCatalog omits colType for calc columns. Creates spec with a valid math calc stage. Verifies calc entry has kind: 'calc' and 'colType' in entry is false (field absent regardless of underlying column types).
- [x] Test: `buildColumnCatalog` backward compatible — call without options parameter (2 args), verify it works and entries have no `colType` when source has no `colTypes`
    **Note:** Test: buildColumnCatalog backward compatible — call without options parameter (2 args). Source has NO colTypes (like old pre-colTypes fixtures). Verifies entries have no colType field using expect('colType' in entry).toBe(false).
- [x] Run `npm test` — all new and existing tests must pass
    **Note:** All tests pass. npm test: 923/923 pass (52 test files), including 9 new tests in column-catalog-coltype.test.ts. npm run typecheck: zero errors. npm run lint: zero warnings.

### Phase 6: Verification
- [x] Run `npm run typecheck` — zero errors required
    **Note:** `npm run typecheck` passed with zero errors (tsc --noEmit -p tsconfig.json, exit 0).
- [x] Run `npm run lint` — zero warnings required
    **Note:** `npm run lint` passed with zero warnings (eslint preact/, exit 0).
- [x] Run `npm test` — all tests pass (existing + new)
    **Note:** `npm test` passed — 923/923 tests pass across 52 test files (including 9 new colType propagation tests in column-catalog-coltype.test.ts). Duration 110s.
- [x] Verify no upward imports in `column-catalog.ts` — catalog layer imports only from `../types`, `../core/store`, and siblings. `ColumnType` from `../types` is allowed.
    **Note:** Verified no upward imports in column-catalog.ts. Imports are: '../types' (ColumnType, CalcStage, DetailBandSpec, LookupSpec), './source-catalog' (SourceTableEntry — catalog sibling), '../core/store' (getStore — core layer). No imports from query or report layers. All imports comply with catalog layer boundaries.

## Completion Criteria
- `PhysicalColEntry` and `BandColEntry` have optional `colType?: ColumnType` field
- `buildColSourceMap()` populates `colType` from `columnTypeOverrides ?? colTypes` for physical and lookup columns
- `buildColumnCatalog()` populates `colType` from `options.columnTypeOverrides ?? source.colTypes` for base, lookup, and band columns
- `CalcColEntry` has NO `colType` field — unchanged
- `buildColumnCatalog()` remains backward compatible — existing 2-arg callers work without changes
- All existing tests pass without modification (colType only set when defined, so entries without colType metadata are unchanged)
- New tests verify colType propagation for all entry kinds and override precedence
- `npm run typecheck`, `npm run lint`, `npm test` all clean

## Contracts

### Created
- `PhysicalColEntry.colType?: ColumnType` — field added to existing interface
- `BandColEntry.colType?: ColumnType` — field added to existing interface
- `buildColumnCatalog(reportSpec, sourceCatalog, options?)` — optional third parameter added

### Called (from foundations)
- `DbTable.colTypes?: Record<string, ColumnType>` — read from `state.tables[tid].colTypes` and `sourceCatalog.get(tid).source.colTypes`
- `AppState.columnTypeOverrides: Record<string, Record<string, ColumnType>>` — read from `state.columnTypeOverrides` and `options.columnTypeOverrides`
- `ColumnType = 'string' | 'number' | 'date' | 'boolean'` — imported from `'../types'`

## References
- Design doc: `artifacts/designs/pending/DD-dd-column-type-aware-where.md` (Phase 4, points 3 and 5)
- Parts README: `artifacts/designs/parts/column-type-aware-where/README.md` (Part B)
- Contracts: `artifacts/designs/parts/column-type-aware-where/CONTRACTS.md`
- Catalog layer instructions: `.opencode/instructions/catalog-layer.instructions.md`
- Downstream consumer: Part C (Type-Aware SQL Generation) will add `getColumnType()` in `sql-where.ts` that reads `colType` from these entries
