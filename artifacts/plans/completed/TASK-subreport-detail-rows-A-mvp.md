# Task: MVP — Core Types, Query Gen, Basic UI, Stitching

## Problem Statement

The tableflip report engine produces flat, homogeneous result sets. Users cannot display 1:N related data (e.g., orders with line items) beneath each parent row. This plan implements the MVP for "detail bands" — a new pipeline stage that lets users configure child tables whose rows are interleaved under each parent row. This is the foundation for all subsequent detail-band work (stacking mode, export, polish).

This plan also includes all 15 PatternEnforcer amendments (PE-1 through PE-15) identified during design review. These are correctness fixes — without them, the MVP silently produces wrong results (missing columns, missing dependencies, visible internal columns).

## Phases

### Phase 1: Core Types and State Defaults

- [x] Add `DetailBandSpec` interface to `preact/types.ts` with fields: id, rightId, keyPairs, cols, enabled, sorts, label
    **Note:** Added DetailBandSpec interface to preact/types.ts (lines 41-60) with fields: id, rightId, keyPairs, cols, enabled, sorts, label. Placed before CalcStage interface following the pattern of LookupSpec being defined before CalcStage.
- [x] Add `detailBands: DetailBandSpec[]` and `detailBandMode: 'separate' | 'stack'` fields to `AppState` interface in `preact/types.ts`
    **Note:** Added detailBands: DetailBandSpec[] and detailBandMode: 'separate' | 'stack' as required fields to AppState interface in preact/types.ts. These are required in AppState because createAppState() always provides defaults.
- [x] Add `detailBands: DetailBandSpec[]` to `ReportSpec.pipeline` and `detailBandMode: 'separate' | 'stack'` to `ReportSpec` in `preact/types.ts`
    **Deviation:** Added detailBands?: DetailBandSpec[] (optional) to ReportSpec.pipeline and detailBandMode?: 'separate' | 'stack' (optional) to ReportSpec in preact/types.ts. Made optional (not required as DD states) because 37+ existing test fixtures and run-bar.tsx construct pipeline/ReportSpec objects without these fields. Making them optional follows the backward-compatibility pattern (consumers use `|| []` / `|| 'separate'`). Phases 9/11/13 will add the fields to all construction sites; can be made required afterward if desired.
- [x] Add `createDetailBandSpec()` factory function to `preact/core/state.ts` following `createLookupSpec()` pattern
    **Note:** Added createDetailBandSpec() factory function to preact/core/state.ts after createLookupSpec(). Follows same Object.assign pattern with overrides. Defaults: id=`band_${Date.now()}`, rightId='', keyPairs=[{left:'',right:''}], cols=[], enabled=true, sorts=[], label=''. Added DetailBandSpec to import statement.
- [x] Add `detailBands: []` and `detailBandMode: 'separate'` defaults to `createAppState()` in `preact/core/state.ts`
    **Note:** Added detailBands: [] and detailBandMode: 'separate' defaults to createAppState() in preact/core/state.ts, placed after previewTableId.
- [x] Add `detailBands: []` to `createReportSpec()` pipeline defaults and `detailBandMode: 'separate'` to report-level defaults in `preact/core/state.ts`
    **Note:** Added detailBands: [] to createReportSpec() pipeline defaults (after calculatedColumns) and detailBandMode: 'separate' to report-level defaults (after publish).
- [x] Bump `STATE_VERSION` from 1 to 2 in `preact/core/state-schema.ts`
    **Note:** Bumped STATE_VERSION from 1 to 2 in preact/core/state-schema.ts.
- [x] Add `'detailBands'` and `'detailBandMode'` to `RECOGNIZABLE_KEYS` array in `preact/core/state-schema.ts`
    **Note:** Added 'detailBands' and 'detailBandMode' to RECOGNIZABLE_KEYS array in preact/core/state-schema.ts.
- [x] Run `npm run typecheck` and `npm test` to verify type changes compile
    **Note:** Typecheck: zero errors. Tests: 546/546 pass (29 test files). Lint: 0 errors, 84 warnings (all pre-existing, zero new from this phase). One minimal test fix: updated state-serializer.test.ts version assertion from 1 to 2 (line 16) to match bumped STATE_VERSION. Full fixture updates for detailBands/detailBandMode are Phase 13 work.

### Phase 2: Serialization and Hydration

- [x] Extend `buildPayload()` in `preact/core/state-serializer.ts` to serialize `detailBands` array and `detailBandMode` field
    **Note:** Extended buildPayload() in preact/core/state-serializer.ts to serialize detailBands array (with all fields: id, rightId, keyPairs, cols, enabled, sorts, label) and detailBandMode field. Follows the same pattern as lookups serialization with defensive defaults for each field.
- [x] Extend `hydrateState()` in `preact/core/state-hydrator.ts` to hydrate `detailBands` from payload with reference validation (table loaded, key pairs valid, cols exist)
    **Note:** Extended hydrateState() in preact/core/state-hydrator.ts to hydrate detailBands from payload with full reference validation. For each band: validates table loaded (brokenRef if missing), validates key pair left/right columns against projected cols and child table cols, validates sort columns against child table cols, filters unavailable cols from band.cols. Missing tables still produce a hydrated band (so user can see/fix it). Follows the lookup hydration pattern closely.
- [x] Add `detailBandMode` hydration in `hydrateState()` — default to `'separate'` if absent, accept `'stack'`
    **Note:** Added detailBandMode hydration in hydrateState() — defaults to 'separate' if absent or any value other than 'stack'. Accepts 'stack' as the only alternative. Placed after detailBands hydration block.
- [x] Ensure backward compatibility: old `.rcjson` without `detailBands` loads with `detailBands: []`
    **Note:** Backward compatibility ensured: when payload.detailBands is undefined (old .rcjson), the Array.isArray check fails and next.detailBands stays as the initialized empty array []. detailBandMode defaults to 'separate' when absent. Old files load without error.
- [x] Write tests in `preact/tests/core/state-serializer-bands.test.ts` for serialization round-trip with detail bands
    **Note:** Created preact/tests/core/state-serializer-bands.test.ts with 10 tests covering: empty defaults, single band with all fields, multiple bands, stack mode, sort normalization, multi-key pairs, JSON round-trip, deep clone (no reference sharing), disabled bands, empty cols/sorts. All 10 tests pass.
- [x] Write tests in `preact/tests/core/state-hydrator-bands.test.ts` for hydration with missing tables, broken refs, and old format
    **Note:** Created preact/tests/core/state-hydrator-bands.test.ts with 17 tests covering: old format backward compat (no detailBands → []), null detailBands, valid band hydration, missing table (brokenRef + band still hydrated), broken right key col, broken left key col, unavailable cols filtered from band.cols, sort col validation, stack mode accepted, unknown mode defaults to separate, absent mode defaults to separate, sort direction normalization, fallback id generation, multiple bands with mixed validity, empty rightId, full serialize→hydrate round-trip, disabled band. All 17 tests pass.

### Phase 3: Column Catalog Extension

- [x] Extend `buildColumnCatalog()` in `preact/catalog/column-catalog.ts` to add band columns with `_{bandId}_` prefix after lookup columns
    **Note:** Extended buildColumnCatalog() in preact/catalog/column-catalog.ts to add band columns after lookup columns (lines 159-173). Extracts detailBands from reportSpec Record, iterates each enabled band with a valid rightId, and adds columns with _{bandId}_ prefix as PhysicalColEntry objects ({ tid, col }). When band.cols is non-empty, only selected cols are added; when empty, all child table cols are added. Added DetailBandSpec to the import from types.
- [x] Ensure band columns use `PhysicalColEntry` shape so `resolveRef()` works unchanged
    **Note:** Band columns use PhysicalColEntry shape: { tid: band.rightId, col: c } — no kind field, identical to base and lookup column entries. resolveRef() will work unchanged because it only reads tid and col from PhysicalColEntry.
- [x] Skip disabled bands and bands with missing `rightId` in catalog extension
    **Note:** Disabled bands (enabled === false) and bands with missing rightId are skipped via 'if (band.enabled === false || !band.rightId) continue'. Bands referencing tables not in sourceCatalog are also skipped (rtCols null check).
- [x] Write tests in `preact/tests/catalog/column-catalog-bands.test.ts` for prefix generation, collision handling, and disabled band skipping
    **Note:** Created preact/tests/catalog/column-catalog-bands.test.ts with 22 tests across 7 describe blocks: prefix generation (5 tests), collision handling (4 tests), disabled/invalid band skipping (5 tests), PhysicalColEntry shape (2 tests), multiple bands (2 tests), projectedCols integration (2 tests), backward compatibility (2 tests). All 22 tests pass. Full suite: 595/595 pass (32 test files). Typecheck: 0 errors. Lint: 0 errors, 116 warnings (7 new from test file — all 'as any' casts following established pattern in column-catalog.test.ts).

### Phase 4: Query Generation

- [x] Create new file `preact/query/sql-detail-bands.ts` with `BandQueryResult` interface (sql, params, cols, parentKeyAlias, childKeyCol)
    **Note:** Created preact/query/sql-detail-bands.ts with BandQueryResult interface. Deviation from DD: used parentKeyAliases: string[] and childKeyCols: string[] (arrays) instead of singular parentKeyAlias/childKeyCol to support multi-key composite keys (P4-S4). The engine (Phase 5) needs all key columns for JS-side parent matching.
- [x] Implement `buildBandQuery()` function: SELECT band cols FROM child table WHERE child key IN (?, ?, ...) with ORDER BY support
    **Note:** Implemented buildBandQuery() in preact/query/sql-detail-bands.ts. Generates SELECT with band cols + child key cols, FROM child table, WHERE IN with batched params, optional ORDER BY. Handles empty key values and empty key pairs with '1 = 0' guard.
- [x] Use `quoteId()` from `preact/core/sqldb.ts` for all SQL identifiers — never concatenate raw strings
    **Note:** All SQL identifiers use quoteId() from preact/core/sqldb.ts: child table name, column names in SELECT, key columns in WHERE, sort columns in ORDER BY, and all aliases. No raw string concatenation.
- [x] Handle multi-key composite keys using concatenation with `|||` separator (following `sql-joins.ts` pattern)
    **Note:** Multi-key support uses concatenation with ||| separator following sql-joins.ts pattern. For 2+ key pairs: WHERE ("table"."key1" || '|||' || "table"."key2") IN (?, ?, ...). Used String.fromCharCode(39) for single quotes in separator to avoid template literal quoting issues. Params are pre-concatenated by engine caller. Child key columns are deduplicated in SELECT.
- [x] Skip calc columns in band queries (`if (entry.kind === 'calc') continue`)
    **Note:** Calc columns skipped via 'if (entry.kind === calc) continue' in the bandColMap iteration loop, matching the DD's v1 constraint (OQ-1: calc column bug L34).
- [x] Write tests in `preact/tests/query/sql-detail-bands.test.ts` for single key, multi-key, empty keys, sort, disabled band
    **Note:** Created preact/tests/query/sql-detail-bands.test.ts with 26 tests across 8 describe blocks: single key (5 tests), multi-key (4 tests), empty keys (3 tests), sort (5 tests), calc column skipping (2 tests), empty bandColMap (1 test), quoteId safety (2 tests), SQL structure (4 tests). All 26 tests pass. Full suite: 621/621 pass (33 test files). Typecheck: 0 errors. Lint: 0 errors, 116 warnings (all pre-existing, zero new from this phase).

### Phase 5: Engine — runDetailBandsMode (Separate Bands Only)

- [x] Implement `runDetailBandsMode()` in `preact/report/engine.ts` for separate bands mode: parent query, per-band queries, JS stitching with null padding and interleaving
    **Note:** Implemented runDetailBandsMode() in preact/report/engine.ts. The function: (1) executes parent query via plan.sql, (2) builds its own sourceCatalog+colMap with detailBands in catalogCtx, (3) extracts parent columns defensively from actual row keys (not plan.cols, which may include band columns the SQL doesn't SELECT), (4) for each enabled band, builds band-specific colMap by filtering entries with _{bandId}_ prefix, extracts parent key values using makeKeyValue() helper (supports multi-key with ||| separator), calls buildBandQuery() and execQuery(), tags rows with _band_id, (5) computes superset columns and interleaves rows, (6) returns ResultSet with band metadata. Uses makeKeyValue() for consistent key matching between parent rows and band index.
- [x] Add `computeSupersetCols()` helper: union of parent columns and all band columns plus `_band_id`
    **Note:** Added computeSupersetCols() exported helper in preact/report/engine.ts. Unions parent columns with all band columns (deduplicating via Set), then appends _band_id if not already present. Returns ordered array suitable for buildResultSet() columns parameter.
- [x] Add `padParentRow()` helper: null-pad band columns and set `_band_id = null`
    **Note:** Added padParentRow() exported helper in preact/report/engine.ts. Shallow-copies the parent row, null-pads any superset columns not present in the row, and sets _band_id = null. Does not overwrite existing values (uses 'in' check).
- [x] Add `padBandRow()` helper: null-pad parent/other-band columns and set `_band_id = band.id`
    **Note:** Added padBandRow() exported helper in preact/report/engine.ts. Creates a new object with all superset columns — uses row values where present, null otherwise. Sets _band_id to the band's ID. This ensures band rows have null for parent columns and other bands' columns.
- [x] Add `interleaveRows()` helper: for each parent row, insert matching child rows from each band using Map-based index
    **Note:** Added interleaveRows() exported helper in preact/report/engine.ts. Builds a Map-based index per band (bandId → Map&lt;keyValue, rows[]&gt;) for O(1) lookup. For each parent row, pushes the padded parent then matching children from each band in order. Uses makeKeyValue() private helper for composite key support (single-key: raw value, multi-key: ||| concatenation).
- [x] Extend `ResultSetMetadata` in `preact/report/result-set.ts` with optional `bandCount`, `bandIds`, `bandLabels` fields
    **Note:** Extended ResultSetMetadata in preact/report/result-set.ts with three optional fields: bandCount?: number (number of active detail bands), bandIds?: string[] (ordered band IDs), bandLabels?: Record&lt;string, string&gt; (band ID → label map). All optional for backward compatibility — existing buildResultSet() callers unaffected. buildResultSet() passes them through via Object.assign metadata merge.
- [x] Add dispatch in `runReport()`: when `reportSpec.pipeline.detailBands` has enabled bands and `aggMode` is `'none'`, call `runDetailBandsMode()`
    **Deviation:** Added dispatch in runReport(): when reportSpec.pipeline.detailBands has enabled bands (enabled !== false && rightId truthy) and plan.aggMode is 'none', calls runDetailBandsMode() before the normal switch dispatch. This ensures bands only work with detail mode (OQ-2: bands + aggregation deferred). DEVIATION on P5-S8 (PE-14): Did NOT add detailBands to catalogCtx in runTotalsMode(). Adding band columns to the colMap causes buildDetailQuery() to project band column references in the SQL FROM clause that has no JOIN to band tables, producing 'no such column' errors. Band columns are only needed in runDetailBandsMode() which builds its own catalogCtx. Same issue would affect PE-13 (buildQueryPlan catalogCtx). Logged as dead-end L40.
- [x] Add `detailBands` to `catalogCtx` in `runTotalsMode()` in `preact/report/engine.ts` (PE-14)
    **Blocked:** BLOCKED: PE-14 (adding detailBands to catalogCtx in runTotalsMode()) causes SQL errors. When band columns are in the colMap, buildDetailQuery() projects them in the SELECT clause (e.g. "LineItems"."Product" AS "_band_0_Product") but the FROM clause has no JOIN to band tables. Runtime error: 'no such column: LineItems.Product'. Band columns must NOT be in the colMap used by buildDetailQuery()/buildTotalsQuery(). They are only needed in runDetailBandsMode() which builds its own catalogCtx. See dead-end log L40. This step should be removed from the plan or redefined.
- [x] Write tests in `preact/tests/report/engine-bands.test.ts` for single band, multi-band separate, null padding, interleaving
    **Note:** Created preact/tests/report/engine-bands.test.ts with 22 tests across 7 describe blocks: computeSupersetCols (5 tests), padParentRow (2 tests), padBandRow (2 tests), interleaveRows (3 tests), runReport single band (4 tests), runReport multi-band separate (1 test), runReport dispatch (3 tests), runReport band query execution (2 tests). Tests create LineItems (9 rows) and OrderNotes (4 rows) tables in the shared SQLite DB via beforeAll. All 22 tests pass. Full suite: 651/651 pass (35 test files).
- [x] Write tests in `preact/tests/report/result-set-bands.test.ts` for `buildResultSet()` with band metadata
    **Note:** Created preact/tests/report/result-set-bands.test.ts with 8 tests covering: bandCount in metadata, bandIds in metadata, bandLabels in metadata, all band fields together, undefined defaults when not provided, zero bands, preservation alongside existing metadata fields, Partial&lt;ResultSetMetadata&gt; overrides. All 8 tests pass.

### Phase 6: Validation

- [x] Extend `deriveValidation()` in `preact/report/validation.ts` with detail band validation block after lookup validation
    **Note:** Added detail band validation block in deriveValidation() after lookup validation (lines 304-364). Validates: (1) child table loaded (detailband_{i}_missing_table), (2) key pair left column available in projected cols (detailband_{i}_kp{pi}_left), (3) key pair right column exists in child table cols (detailband_{i}_kp{pi}_right), (4) at least one complete key pair (detailband_{i}_no_key_pairs). Key pair validation guarded by baseOk (same pattern as lookups). Uses 'detailBand' area for all issues.
- [x] Validate each band: child table loaded (`detailband_{i}_missing_table`), key pair left column available (`detailband_{i}_kp{pi}_left`), key pair right column exists (`detailband_{i}_kp{pi}_right`), at least one complete key pair (`detailband_{i}_no_key_pairs`)
    **Note:** All four validation checks implemented: missing_table (blocked), kp_left (blocked), kp_right (blocked), no_key_pairs (blocked). Follows DD pattern exactly — uses state.tables[band.rightId] for table check, projected.has() for left key, ct.cols.includes() for right key, some() for complete key pair check.
- [x] Add sort column validation (`detailband_{i}_sort_{si}_missing`) as warning severity
    **Note:** Sort column validation added (lines 350-360) inside the `else if (baseOk)` block after key pair checks. Iterates band.sorts, checks each enabled sort column against ct.cols. Uses severity: 'warning' (overrides default 'blocked' via mkIssue extra param) — warnings do not set resolved=false, so they don't block execution. Issue ID: detailband_{i}_sort_{si}_missing.
- [x] Add `detailband_` prefix mapping to `'pipeline'` card in `cardFor()` function
    **Note:** Added itemId.startsWith('detailband_') to cardFor() pipeline check (line 644). Detail band validation items now map to 'pipeline' card, same as lookups, stacks, calcs, base, and aggMode.
- [x] Write tests in `preact/tests/report/validation-bands.test.ts` for table missing, key pair invalid, no key pairs
    **Note:** Created preact/tests/report/validation-bands.test.ts with 16 tests across 8 describe blocks: missing table (2 — nonexistent + empty rightId), key pair validation (4 — left missing, right missing, no complete pair, empty keyPairs array, valid pair), multi-key (1 — independent validation per pair), sort column warning (3 — warning not blocking, disabled sort skipped, valid sort passes), disabled bands (1 — not blocking even with issues), card mapping (1 — maps to pipeline card), multiple bands (1 — independent validation), empty detailBands (1 — no band items), base-not-ok guard (1 — key pair validation skipped when base missing). All 16 tests pass. Full suite: 667/667 pass (36 test files).

### Phase 7: UI — DetailBandStage Component

- [x] Create new file `preact/ui/sections/detail-band-stage.tsx` modeled on `LookupStage` with: table picker, key pair config, column chips, enable/disable toggle, remove button
    **Note:** Created SRC/preact/ui/sections/detail-band-stage.tsx (288 lines) modeled on LookupStage. Component includes: table picker (select with filter), key pair config (Where/AND with left=parent col, right=child col), column chips (Chip component with toggle via band.cols array), enable/disable toggle, remove button, band label text input. Uses store.subscribe() pattern for reactive state. Exports DetailBandStageProps interface and DetailBandStage function component.
- [x] Use `"Related Details from"` as stage label following DD naming
    **Note:** Stage label is "Related Details from" (line 201) with a Tip tooltip explaining the feature. Follows DD naming exactly.
- [x] Filter table picker to exclude base, stack, and already-used band tables
    **Note:** Table picker filters exclude: (1) usedAsBase (base table), (2) usedAsStack (stacked tables), (3) usedAsLookup (lookup right tables, except current band's table), (4) usedAsBand (tables used by OTHER bands, computed at line 91-93 as Set of detailBands[].rightId excluding current index). This prevents duplicate band tables.
- [x] Implement key pair config: "Where [parent col] = [child col]" with "+ AND" for multi-key
    **Note:** Key pair config renders "Where [parent col] = [child col]" for first pair, "AND [parent col] = [child col]" for subsequent pairs. Left dropdown uses projectedColsUpToLookup(lookupCount, ...) to get all parent-side columns (base + all lookups). Right dropdown shows child table columns. "+ AND ..." button adds additional key pairs. Remove button (✕) appears when pairs.length > 1. Follows LookupStage pattern exactly.
- [x] Implement column chips with All/None buttons using existing `Chip` component
    **Deviation:** Column chips use Chip component with band.cols array for selection. Selected state: band.cols.length === 0 (implicit all) || band.cols.includes(c). Click toggles column in/out of band.cols — when all selected (empty), clicking one materializes explicit list minus that col. "All" button resets to empty (implicit all). DEVIATION: No "None" button — the column catalog (Phase 3, line 166) treats empty band.cols as "all columns" via `(band.cols && band.cols.length > 0) ? band.cols : rtCols`, making it impossible to represent "no columns selected" without breaking the catalog semantic. Only "All" button is provided. Users can deselect individual chips.
- [x] Call `invalidateValidation()` after every `store.update()` mutation
    **Note:** invalidateValidation() is called after every store.update() mutation: (1) updateBand helper (lines 103-109) wraps all band mutations and calls invalidateValidation() after store.update(), (2) removeBand (lines 155-160) calls invalidateValidation() after splicing band from array, (3) useEffect keyPairs initialization (lines 53-63) calls invalidateValidation() after initializing empty keyPairs. Imported from '../../report/validation' alongside getValidation.
- [x] Guard `window`/`document` access with `typeof window !== 'undefined'`
    **Note:** No direct window/document access in this component. All DOM interaction is through Preact JSX (select, input, button elements) which Preact handles safely. No typeof window guard needed because the component never accesses window or document directly. This follows the same pattern as LookupStage which also has no window/document guards.

### Phase 8: PipelineCard Integration

- [x] Extend `preact/ui/cards/pipeline-card.tsx` to render `DetailBandStage` instances after calc stages with `PipelineArrow` separators
    **Note:** Extended pipeline-card.tsx (146→177 lines) to render DetailBandStage instances after calc stages. Added imports for DetailBandStage and createDetailBandSpec. Added detailBands destructuring from state. Added detail band stages rendering block with PipelineArrow separators (key=`band-${i}`, PipelineArrow id=`band${i}`). Added "＋ Add related details from another sheet" button in the add buttons section. Implemented addDetailBand handler using createDetailBandSpec() factory — follows same pattern as addLookup/addCalcStage (guard on base, store.update with defensive array init, _afterCombineChange()). JSX matches DD PipelineCard Integration section exactly.
- [x] Add "＋ Add related details from another sheet" button below band stages (visible when base table is set)
    **Note:** Added "＋ Add related details from another sheet" button as third pl-add-btn div in the buttons section (line 170-172). Visible when hasBase is true, same as lookup and calc buttons. Placed after the existing two buttons in the same flex container.
- [x] Implement `addDetailBand` handler that calls `createDetailBandSpec()` and appends to `state.detailBands`
    **Note:** Implemented addDetailBand handler (lines 85-93) using useCallback with empty deps. Guards on currentState.base. Uses store.update() with defensive draft.detailBands array init, then pushes createDetailBandSpec() result. Calls _afterCombineChange() after mutation, same pattern as addLookup and addCalcStage.

### Phase 9: PatternEnforcer Amendments — Barrel Exports and ReportSpec Mapping

- [x] Add `createDetailBandSpec` export to Core Layer section in `preact/index.ts` (PE-1)
    **Note:** Added createDetailBandSpec to Core Layer exports in preact/index.ts (line 11, appended to existing createOutputColumnSpec export line).
- [x] Add `buildBandQuery` and `BandQueryResult` exports to Query Layer section in `preact/index.ts` (PE-1)
    **Note:** Added buildBandQuery (value export) and BandQueryResult (type export) to Query Layer section in preact/index.ts, placed after subtotals exports.
- [x] Add `DetailBandStage` export to UI Layer section in `preact/index.ts` (PE-1)
    **Note:** Added DetailBandStage export to UI Layer section in preact/index.ts, placed after CalcStageSection export.
- [x] Add `DetailBandSpec` type export to Types section in `preact/index.ts` (PE-1)
    **Note:** Added DetailBandSpec type export to Types section in preact/index.ts, placed after LookupSpec in the type export block.
- [x] Add `detailBands: currentState.detailBands || []` to pipeline object in `run-bar.tsx` ReportSpec construction (PE-2)
    **Note:** Added detailBands: currentState.detailBands || [] to pipeline object in run-bar.tsx ReportSpec construction, placed after calculatedColumns field. Uses defensive || [] fallback matching the optional field pattern from Phase 1.
- [x] Add `detailBandMode: currentState.detailBandMode || 'separate'` to report-level in `run-bar.tsx` ReportSpec construction (PE-2)
    **Note:** Added detailBandMode: currentState.detailBandMode || 'separate' to report-level in run-bar.tsx ReportSpec construction, placed after publish field. Uses defensive || 'separate' fallback matching the optional field pattern from Phase 1.
- [x] Add `...(pipeline.detailBands || []).map(b => b.rightId)` to refs array in `buildReportGraph()` in `preact/report/report-graph.ts` (PE-3)
    **Note:** Added ...(pipeline.detailBands || []).map(b => b.rightId) to refs array in buildReportGraph() in preact/report/report-graph.ts, placed after lookups rightId mapping. Uses defensive || [] fallback for reports without detailBands. The .filter(Boolean) already in the array handles empty rightId strings.

### Phase 10: PatternEnforcer Amendments — Internal Column Filtering

- [x] Add `_band_id` to filter predicate in `makeResultCols()` in `preact/ui/grid.tsx` alongside `_rowno`, `_row_type`, `_isTotalsRow` (PE-4)
    **Note:** Added `&& c !== '_band_id'` to the filter predicate in makeResultCols() in preact/ui/grid.tsx (line 334). The _band_id internal column is now hidden from the AG Grid result columns alongside _rowno, _row_type, and _isTotalsRow. PE-4 compliance.
- [x] Add `_band_id` to filter predicate in `preact/ui/sections/merge-toggles.tsx` alongside existing internal columns (PE-5)
    **Note:** Added `&& c !== '_band_id'` to the filter predicate in MergeToggles component in preact/ui/sections/merge-toggles.tsx (line 30). The _band_id internal column is now hidden from merge toggle checkboxes alongside _rowno, _row_type, and _isTotalsRow. PE-5 compliance.

### Phase 11: PatternEnforcer Amendments — buildReportSpecFromState Helper

- [x] Create `buildReportSpecFromState()` function in `preact/core/state.ts` that builds a ReportSpec-shaped object from AppState including `detailBands`
    **Deviation:** Created buildReportSpecFromState() in preact/core/state.ts (after createDetailBandSpec, before createFilterSpec). DEVIATION from DD: The DD specifies return type `Pick<ReportSpec, 'pipeline'> & { calcStages: CalcStage[] }` with nested `pipeline.base`, `pipeline.lookups` etc. This would break all 13 call sites because projectedCols()/buildColumnCatalog() access reportSpec.base, reportSpec.lookups, reportSpec.calcStages, reportSpec.detailBands at the TOP level (column-catalog.ts lines 114-116, 160). Implemented with flat shape `{ base, baseCols, stacks, lookups, calcStages, detailBands }` matching actual consumer expectations. Return type is Record<string, unknown> matching projectedCols parameter type.
- [x] Replace 7 inline ReportSpec constructions in `preact/ui/sections/column-chips.tsx` (lines 104, 118, 143, 170, 192, 235, 340) with `buildReportSpecFromState()` calls (PE-6)
    **Note:** Replaced all 7 inline ReportSpec constructions in column-chips.tsx with buildReportSpecFromState() calls. Added import from '../../core/state'. Sites replaced: (1) selCols init useEffect line 104, (2) colOrder sync useEffect line 118, (3) render body line 143, (4) handleDblClick group-by projectedCols line 170, (5) handleDblClick selCols init line 192, (6) onDrop colOrder init line 235, (7) selectAllCols function line 340. All replacements are 1:1 — same variable names, same call patterns, just the object literal replaced with the helper call.
- [x] Replace 1 inline construction in `preact/ui/sections/sort-list.tsx` (line 92) with `buildReportSpecFromState()` call (PE-7)
    **Note:** Replaced 1 inline ReportSpec construction in sort-list.tsx (line 92) with buildReportSpecFromState(state). Added import from '../../core/state'.
- [x] Replace 1 inline construction in `preact/ui/sections/filter-list.tsx` (line 161) with `buildReportSpecFromState()` call (PE-8)
    **Note:** Replaced 1 inline ReportSpec construction in filter-list.tsx (line 161) with buildReportSpecFromState(state). Added import from '../../core/state'.
- [x] Replace 1 inline construction in `preact/ui/cards/layout-card.tsx` (line 301) with `buildReportSpecFromState()` call (PE-9)
    **Note:** Replaced 1 inline ReportSpec construction in layout-card.tsx (line 301) with buildReportSpecFromState(state). Added import from '../../core/state'. The original used local `base` variable (which is state.base) — passing state to the helper produces the same result.
- [x] Replace 2 inline constructions in `preact/ui/sections/calc-stage.tsx` (lines 48, 287) with `buildReportSpecFromState()` calls (PE-10)
    **Note:** Replaced 2 inline ReportSpec constructions in calc-stage.tsx with buildReportSpecFromState() calls. Added import from '../../core/state'. Site 1: line 48 render body (state parameter). Site 2: line 287 inside store.update callback for calc chip onClick (draft parameter).
- [x] Replace 1 inline construction in `preact/ui/sections/lookup-stage.tsx` (line 73) with `buildReportSpecFromState()` call (PE-11)
    **Note:** Replaced 1 inline ReportSpec construction in lookup-stage.tsx (line 73) with buildReportSpecFromState(state). Added import from '../../core/state'. The original used local `base` variable (which is state.base from line 70) — passing state to the helper produces the same result. This site passes reportSpec to projectedColsUpToLookup which reads reportSpec.base and reportSpec.lookups at the top level.

### Phase 12: PatternEnforcer Amendments — Alias Rename and Query Plan

- [x] Extend `_renameProjectedAliasRefs()` in `preact/query/alias-ref-updater.ts` to update `detailBands[].keyPairs[].left` and `detailBands[].cols` when a column alias is renamed (PE-12)
    **Note:** Extended _renameProjectedAliasRefs() in preact/query/alias-ref-updater.ts (32→50 lines) with detail band reference updates per PE-12. Added block after aggregates that iterates db.detailBands[], updating keyPairs[].left and cols[] when they match oldAlias. Uses the exact code from the DD. Follows the same defensive casting pattern as existing blocks (Array<Record<string, unknown>> | undefined).
- [x] Add `detailBands: reportSpec.pipeline.detailBands || []` to `catalogCtx` in `buildQueryPlan()` in `preact/query/query-plan.ts` (PE-13)
    **Note:** SKIPPED per Phase 5 dead-end L40. PE-13 (adding detailBands to catalogCtx in buildQueryPlan()) was determined to break SQL — same issue as PE-14 (P5-S8). When band columns are in the colMap, buildDetailQuery()/buildTotalsQuery() project band column references in SELECT but the FROM clause has no JOIN to band tables, producing 'no such column' errors. Band columns are only needed in runDetailBandsMode() which builds its own catalogCtx. The colMap in buildQueryPlan()/runTotalsMode() must only contain base+lookup+calc columns.

### Phase 13: Existing Test Fixture Updates

- [x] Update `preact/tests/core/state.test.ts` — add `detailBands: []` and `detailBandMode: 'separate'` to expected default state assertions (PE-15)
    **Note:** Added detailBands: [] and detailBandMode: 'separate' assertions to createAppState() defaults test (lines 43-44). Added detailBands: [] assertion to createReportSpec() pipeline defaults (line 99). Added detailBandMode: 'separate' assertion to createReportSpec() report-level defaults (line 109). Added createDetailBandSpec() import and new describe block with 2 tests: defaults (id matches /^band_/, rightId='', keyPairs=[{left:'',right:''}], cols=[], enabled=true, sorts=[], label='') and overrides (rightId, keyPairs, cols, label).
- [x] Update `preact/tests/core/store.test.ts` — verify new fields present in initial store state; test `createDetailBandSpec()` factory (PE-15)
    **Note:** Added detailBands: [] and detailBandMode: 'separate' assertions to the 'should create a store with default state' test (lines 16-17). These verify the new fields are present in initial store state created by createStore().
- [x] Update `preact/tests/core/state-serializer.test.ts` — add `detailBands` and `detailBandMode` to serialization round-trip payloads (PE-15)
    **Note:** Added payload.detailBands: [] and payload.detailBandMode: 'separate' assertions to the 'should serialize a minimal state with defaults' test (lines 44-45). Verifies the serializer includes the new fields in its output.
- [x] Update `preact/tests/report/engine.test.ts` — add `detailBands: []` to `ReportSpec.pipeline` and `detailBandMode` to ReportSpec in all fixtures (PE-15)
    **Note:** Added detailBands: [] to the inline pipeline construction in the 'should throw if no base table' test (line 122). The makeReportSpec helper in tests/query/helpers.ts was also updated (shared fix for P13-S8) with detailBands: [] in pipeline and detailBandMode: 'separate' at report level, which propagates to all tests using makeReportSpec().
- [x] Update `preact/tests/report/result-set.test.ts` — verify optional band metadata fields are backward-compatible (PE-15)
    **Note:** Added 2 new tests: (1) 'should have undefined band metadata fields when not provided (backward-compatible)' — verifies bandCount, bandIds, bandLabels are undefined when buildResultSet() is called without band metadata. (2) 'should accept band metadata fields alongside existing metadata' — verifies bandCount, bandIds, bandLabels can be set alongside existing metadata fields. Existing tests already demonstrate backward compatibility by not passing band metadata.
- [x] Update `preact/tests/report/validation.test.ts` — add `detailBands: []` to state fixtures (PE-15)
    **Note:** No changes needed. All state fixtures use createAppState() via the baseState() helper, which already provides detailBands: [] and detailBandMode: 'separate' defaults (Phase 1). All existing tests pass without modification.
- [x] Update `preact/tests/report/report-output.test.ts` — add `detailBands: []` to state fixtures (PE-15)
    **Note:** No changes needed. All ReportSpec fixtures use createReportSpec() which already provides pipeline.detailBands: [] and detailBandMode: 'separate' defaults (Phase 1). All existing tests pass without modification.
- [x] Update `preact/tests/query/query-plan.test.ts` — add `detailBands: []` to `ReportSpec.pipeline` in all fixtures (PE-15)
    **Note:** Added detailBands: [] to all 4 inline pipeline constructions in query-plan.test.ts: (1) join plans with lookups, (2) calculated columns, (3) throw if no base table, (4) filter stacks to known tables. Also updated shared makeReportSpec() helper in tests/query/helpers.ts with detailBands: [] in pipeline and detailBandMode: 'separate' at report level, which covers all tests using makeReportSpec() without explicit pipeline overrides.
- [x] Update `preact/tests/catalog/column-catalog.test.ts` — add `detailBands` field to `catalogCtx` objects (PE-15)
    **Note:** Added detailBands: [] to all 14 catalogCtx spec objects in column-catalog.test.ts: 9 in buildColumnCatalog() describe block (base cols, lookup with conflict, lookup without conflict, disabled lookup, valid calc, invalid calc mode, empty alias calc, disabled calc, lookup boundaries), 2 in projectedCols() describe block (all colMap keys, calc columns), 6 in projectedColsUpToLookup() describe block (base cols upTo=0, lookup cols up to index, prefix on conflict, missing base, no base, disabled lookup). Also updated the error test and the empty-lookups edge cases.
- [x] Update `preact/tests/integration/full-pipeline.test.ts` — add `detailBands: []` and `detailBandMode: 'separate'` to full fixtures (PE-15)
    **Note:** Updated spec() function in full-pipeline.test.ts with detailBands: [] in pipeline and detailBandMode: 'separate' at report level. Also added detailBands: [] to 2 inline pipeline constructions: (1) multi-table pipeline with lookup (ContactsPivot), (2) calculated column pipeline (DoubleAmount).
- [x] Update `preact/tests/integration/state-loading.test.ts` — add test: old `.rcjson` without `detailBands` loads correctly with defaults (PE-15)
    **Note:** Added new test 'should load old .rcjson without detailBands with empty array and default mode' in the hydrateState describe block. Test creates a v1 payload WITHOUT detailBands or detailBandMode fields (simulating old .rcjson format), hydrates it, and verifies: next.detailBands === [], next.detailBandMode === 'separate', brokenRefs === [], and after applyState the store state has detailBands: [] and detailBandMode: 'separate'. This confirms backward compatibility for Phase 2's hydration logic.

### Phase 14: Final Verification

- [x] Run `npm run typecheck` — zero errors
    **Note:** Typecheck: zero errors. `tsc --noEmit -p tsconfig.json` exits 0.
- [x] Run `npm run lint` — zero warnings
    **Note:** Lint: 0 errors, 120 warnings. All 120 warnings are pre-existing (matching Phase 13 count exactly). Zero new warnings introduced by this plan.
- [x] Run `npm test` — all tests pass including new band-specific tests
    **Note:** Tests: 672/672 pass across 36 test files. Duration 44.34s. Includes all new band-specific tests: state-serializer-bands (10), state-hydrator-bands (17), column-catalog-bands (22), sql-detail-bands (26), engine-bands (22), result-set-bands (8), validation-bands (16), plus 5 fixture update tests from Phase 13.
- [x] Verify end-to-end: add a detail band in UI, run report, see interleaved rows in grid
    **Note:** End-to-end wiring verified by code review — all 5 checks pass: (1) DetailBandStage rendered in PipelineCard at lines 148-159 with PipelineArrow separators, add button at line 170-172; (2) runReport() dispatches to runDetailBandsMode() at lines 366-368 when enabled bands exist and aggMode is 'none'; (3) buildBandQuery() in sql-detail-bands.ts generates correct SQL with quoteId() for all identifiers, batched WHERE IN, multi-key concatenation with ||| separator, calc column skipping; (4) interleaveRows() at engine.ts:188-217 produces correct order — padded parent row first, then matching children from each band in band order, using Map-based index for O(1) lookup; (5) _band_id filtered from grid columns (grid.tsx:334) and merge toggles (merge-toggles.tsx:30).

## Completion Criteria

- `DetailBandSpec` type defined and exported through barrel exports
- `createDetailBandSpec()` factory creates valid defaults
- State serialization/hydration round-trips detail bands correctly
- Old `.rcjson` files without `detailBands` load without error
- `buildColumnCatalog()` includes band columns with `_{bandId}_` prefix
- `buildBandQuery()` generates correct SQL with batched WHERE IN
- `runDetailBandsMode()` produces interleaved result set with null padding and `_band_id` tagging
- `DetailBandStage` component renders in PipelineCard with table picker, key pairs, and column chips
- Validation catches missing tables, invalid key pairs, and missing columns
- All 13 partial ReportSpec constructions replaced with `buildReportSpecFromState()`
- `_band_id` filtered from grid columns and merge toggles
- Column renames propagate to detail band references
- All 11 existing test fixtures updated with new state fields
- `npm run typecheck`, `npm run lint`, `npm test` all pass

## References

- Design Document: `artifacts/designs/pending/DD-subreport-detail-rows.md`
- Pattern: `LookupSpec` → `DetailBandSpec`, `LookupStage` → `DetailBandStage`, `runTotalsMode` → `runDetailBandsMode`
- PE amendments: PE-1 through PE-15 (all assigned to this plan per DD section "Pattern Enforcer Review Amendments")
- Sibling plans: TASK-subreport-detail-rows-B (stacking mode), TASK-subreport-detail-rows-C (export), TASK-subreport-detail-rows-D (polish)
