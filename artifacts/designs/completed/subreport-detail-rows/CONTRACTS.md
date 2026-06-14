# Contracts — Subreport Detail Rows

## New Types

### `DetailBandSpec` (preact/types.ts)

```typescript
export interface DetailBandSpec {
  id: string;
  rightId: string;
  keyPairs: Array<{ left: string; right: string }>;
  cols: string[];
  enabled: boolean;
  sorts: Array<{ col: string; dir: 'ASC' | 'DESC'; enabled: boolean }>;
  label: string;
}
```

### `BandQueryResult` (preact/query/sql-detail-bands.ts)

```typescript
export interface BandQueryResult {
  sql: string;
  params: unknown[];
  cols: string[];
  parentKeyAlias: string;
  childKeyCol: string;
}
```

### `ResultSetMetadata` extensions (preact/report/result-set.ts)

```typescript
// Added optional fields:
bandCount?: number;
bandIds?: string[];
bandLabels?: Record<string, string>;
```

## New Functions

### Core Layer

- `createDetailBandSpec() -> DetailBandSpec` — preact/core/state.ts
- `buildReportSpecFromState(state: AppState) -> Pick<ReportSpec, 'pipeline'> & { calcStages: CalcStage[] }` — preact/core/state.ts

### Query Layer

- `buildBandQuery(band: DetailBandSpec, parentKeyValues: Set<unknown>, bandColMap: Map<string, ColMapEntry>, sourceCatalog: Map<string, SourceTableEntry>) -> BandQueryResult` — preact/query/sql-detail-bands.ts

### Report Layer

- `runDetailBandsMode(plan: BuiltQueryPlan, reportSpec: ReportSpec, tables: Record<string, DbTable>) -> ResultSet` — preact/report/engine.ts

### UI Layer

- `DetailBandStage(props: DetailBandStageProps) -> VNode` — preact/ui/sections/detail-band-stage.tsx

## Modified Functions

### Core Layer

- `createAppState()` — adds `detailBands: []` and `detailBandMode: 'separate'` defaults
- `createReportSpec()` — adds `detailBands: []` to pipeline and `detailBandMode: 'separate'`
- `buildPayload()` — serializes `detailBands` and `detailBandMode`
- `hydrateState()` — hydrates `detailBands` with reference validation

### Catalog Layer

- `buildColumnCatalog()` — adds band columns with `_{bandId}_` prefix

### Report Layer

- `runReport()` — dispatches to `runDetailBandsMode()` when detail bands are present
- `deriveValidation()` — validates detail band specs
- `buildResultSet()` — accepts band metadata extensions

### Query Layer

- `buildQueryPlan()` — adds `detailBands` to `catalogCtx`
- `_renameProjectedAliasRefs()` — propagates renames to `detailBands[].keyPairs[].left` and `detailBands[].cols`

### UI Layer

- `PipelineCard` — renders `DetailBandStage` instances and add button
- `RunBar` — maps `detailBands` and `detailBandMode` into ReportSpec
- `makeResultCols()` in grid.tsx — filters `_band_id` from visible columns
- `MergeToggles` — filters `_band_id` from display columns
- `exportAs()` — band-aware export with section headers (Plan C)

## State Shape Changes

### AppState

- `detailBands: DetailBandSpec[]` (default: `[]`)
- `detailBandMode: 'separate' | 'stack'` (default: `'separate'`)

### ReportSpec.pipeline

- `detailBands: DetailBandSpec[]` (default: `[]`)

### ReportSpec

- `detailBandMode: 'separate' | 'stack'` (default: `'separate'`)

## Schema Changes

- `STATE_VERSION`: 1 → 2
- `RECOGNIZABLE_KEYS`: adds `'detailBands'` and `'detailBandMode'`

## Plan Status

All plans complete. Stacking mode + mode toggle were consolidated into Plan A during implementation (no separate plan file was created; features exist in code and are tested).

| Plan | Title | Status |
|------|-------|--------|
| A | MVP — Core Types, Query Gen, Basic UI, Stitching (incl. stacking) | ✅ 83/83 |
| A-fix | Fix merge-toggles inline ReportSpec construction | ✅ 3/3 |
| B | Export Enhancements — Section Headers, Band Styling | ✅ 20/20 |
| C | Polish — Grid Styling, Reorder, Warning Dialog, Performance | ✅ 30/30 |
