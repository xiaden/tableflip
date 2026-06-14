# Preact Rebuild — Contracts Ledger

**Design doc:** `artifacts/designs/pending/DD-preact-rebuild-architecture.md`
**Last updated:** 2026-06-12 (after Plan C — report engine)

---

## Architectural Rules

- `SRC/preact/` is self-contained — zero imports from `SRC/js/` except vendor/wasm
- All local imports require `.js` extensions (`moduleResolution: "bundler"`)
- Vendor libs (sql.js, AG Grid, xlsx-js-style) loaded via `<script>` tags in `preact_index.html`
- SQL identifiers: always use `quoteId()`, never concatenate directly
- State changes: use `store.update()` with draft-mutator pattern, not direct mutation
- Store API: `update(updater: (draft: AppState) => void)` for mutations, `set<K>(key, value)` for key-value
- CSS from `css/style.css` reused as-is — no new CSS
- Preact with `jsxImportSource: 'preact'`, NOT React
- Window globals avoided — Preact event handlers instead

---

## Module Contracts

### Core Layer (Plan A — COMPLETE)

#### `core/state.ts`

| Function | Signature |
| ---------- | ----------- |
| `createAppState` | `(overrides?: Partial<AppState>): AppState` |
| `createWorkspaceState` | `(overrides?: Partial<WorkspaceState>): WorkspaceState` |
| `createReportSpec` | `(overrides?: Partial<ReportSpec>): ReportSpec` |
| `createLookupSpec` | `(overrides?: Partial<LookupSpec>): LookupSpec` |
| `createFilterSpec` | `(overrides?: Partial<FilterSpec>): FilterSpec` |
| `createSortSpec` | `(overrides?: Partial<SortSpec>): SortSpec` |
| `createOutputColumnSpec` | `(overrides?: Partial<OutputColumnSpec>): OutputColumnSpec` |

#### `core/store.ts`

| Export | Signature |
| -------- | ----------- |
| `Store` (interface) | `getState(): AppState`, `subscribe(listener: Listener): () => void`, `update(updater: (draft: AppState) => void): void`, `set<K extends keyof AppState>(key: K, value: AppState[K]): void` |
| `createStore` | `(initial?: Partial<AppState>): Store` |
| `initStore` | `(initial?: Partial<AppState>): Store` |
| `getStore` | `(): Store` |

#### `core/sqldb.ts`

| Function | Signature |
| ---------- | ----------- |
| `initDb` | `(): Promise<void>` |
| `quoteId` | `(name: string): string` |
| `createTable` | `(sqlName: string, cols: string[]): void` |
| `insertRows` | `(sqlName: string, cols: string[], data: Array<Record<string, unknown>>): void` |
| `execQuery` | `(sql: string, params?: unknown[]): Record<string, unknown>[]` |
| `dropTable` | `(sqlName: string): void` |
| `tableRowCount` | `(sqlName: string): number` |

#### `core/utils.ts`

| Function | Signature |
| ---------- | ----------- |
| `h` | `(s: unknown): string` |
| `stripExt` | `(fn: string): string` |
| `dl` | `(blob: Blob, name: string): void` |
| `toast` | `(msg: string, type?: string): void` |
| `stickyToast` | `(msg: string, type?: string, onAccept?: () => void, acceptLabel?: string): void` |
| `toggleSidebar` | `(): void` |
| `getTableColor` | `(tid: string): string` |
| `getTableColorClass` | `(tid: string): string` |
| `chipFgColor` | `(bg: string): string` |
| `tableShortName` | `(tid: string): string` |
| `colUserLabel` | `(tid: string, physCol: string): string` |
| `setColLabel` | `(tid: string, physCol: string, label: string): void` |
| `renameProjectedColumn` | `(alias: string): Promise<boolean>` |
| `colDisplayLabel` | `(alias: string, map?: Map<string, ColSourceEntry>): Promise<string>` |
| `colExportLabel` | `(alias: string, map?: Map<string, ColSourceEntry>): Promise<string>` |
| `buildExportHeaderMap` | `(cols: string[], map?: Map<string, ColSourceEntry>): Promise<Record<string, string>>` |
| `smartDefaultFn` | `(colName: string): string` |
| `defaultAggAlias` | `(fn: string, colLabel: string): string` |
| `TABLE_PALETTE` | `string[]` (constant, 16 hex colors) |

#### `core/date-format.ts`

| Function | Signature |
| ---------- | ----------- |
| `normalizeDateExpr` | `(colExpr: string, format: DateInputFormat \| null \| undefined): string` |
| `getDateInputFormat` | `(date: { inputFormat?: DateInputFormat } \| undefined): DateInputFormat \| null` |
| `isISODate` | `(values: string[]): boolean` |
| `getColumnSamples` | `(tid: string, col: string): string[]` |

#### `types.ts` — Key Exports

| Export | Kind | Definition |
| -------- | ------ | ------------ |
| `CalcMode` | type alias | `'math' \| 'text' \| 'compare' \| 'date'` |
| `AggMode` | type alias | `'none' \| 'totals' \| 'subtotals' \| 'group'` |
| `DateComponent` | type alias | `'D' \| 'DD' \| 'M' \| 'MM' \| 'MMM' \| 'YY' \| 'YYYY'` |
| `ColSourceEntry` | type alias | `{ kind?: never; tid: string; col: string } \| { kind: 'calc'; idx: number; alias?: string }` |
| `DbTable` | interface | `id, name, cols, rowCount` |
| `LookupSpec` | interface | `rightId, keyPairs, cols, required, enabled, duplicatePolicy, [key: string]: unknown` |
| `CalcStage` | interface | `alias, mode, math?, compare?, text?, date?, enabled?, [key: string]: unknown` |
| `FilterSpec` | interface | `col, op, val?, vals, enabled?, [key: string]: unknown` |
| `SortSpec` | interface | `col, dir, enabled, [key: string]: unknown` |
| `AggregateSpec` | interface | `col, fn, alias, enabled?, [key: string]: unknown` |
| `AppState` | interface | Full application state (tables, excludedRows, tableColors, columnLabels, base, baseCols, stacks, lookups, calcStages, selCols, colOrder, filters, groupBy, aggregates, aggMode, aggModeState, colTotals, subtotalBy, subtotalFns, subtotalGrandTotal, subtotalSpacer, subtotalOnTop, subtotalStrategy, mergedCols, mergeGroupUnderline, colState, sorts, result) |
| `ReportSpec` | interface | `id, name, enabled, pipeline, outputColumns, filters, sorts, aggregation, mergeDisplay, outputDefinition, publish` |
| `WorkspaceState` | interface | `version, sourceTables, reports, activeReportId, runtime` |
| `OutputColumnSpec` | interface | `alias, label, visible, width` |
| `DateInputFormat` | interface | `first, second, third` (DateComponent fields) |

---

### Catalog Layer (Plan B — COMPLETE)

#### `catalog/source-catalog.ts`

| Export | Signature |
| -------- | ----------- |
| `SourceTableEntry` (interface) | `id: string`, `name: string`, `cols: string[]`, `kind: 'imported'`, `source: DbTable` |
| `buildSourceCatalog` | `(tables: Record<string, DbTable>): Map<string, SourceTableEntry>` |

#### `catalog/column-catalog.ts`

| Export | Signature |
| -------- | ----------- |
| `PhysicalColEntry` (interface) | `kind?: undefined`, `tid: string`, `col: string` |
| `CalcColEntry` (interface) | `kind: 'calc'`, `idx: number`, `mode?: string`, `alias?: string`, `calc?: unknown` |
| `ColMapEntry` (type) | `PhysicalColEntry \| CalcColEntry` |
| `tablePrefix` | `(name: string): string` |
| `buildColSourceMap` | `(): Map<string, ColMapEntry>` |
| `buildColumnCatalog` | `(reportSpec: Record<string, unknown>, sourceCatalog: Map<string, SourceTableEntry>): ColumnCatalog` |
| `projectedCols` | `(reportSpec: Record<string, unknown>, sourceCatalog: Map<string, SourceTableEntry>): string[]` |
| `projectedColsUpToLookup` | `(upTo: number, reportSpec: Record<string, unknown>, sourceCatalog: Map<string, SourceTableEntry>): string[]` |

---

### Query Layer (Plan B — COMPLETE)

#### `query/sql-where.ts`

| Export | Signature |
| -------- | ----------- |
| `WhereResult` (interface) | `where: string`, `params: unknown[]` |
| `ColStateEntry` (interface) | `type?: string`, `numericHint?: boolean`, `[key: string]: unknown` |
| `buildWhere` | `(filters: FilterSpec[], colMap: Map<string, ColMapEntry>, colState?: Record<string, ColStateEntry> \| null): WhereResult` |

#### `query/sql-joins.ts`

| Export | Signature |
| -------- | ----------- |
| `JoinResult` (interface) | `joins: string`, `params: unknown[]` |
| `buildJoins` | `(lookups: LookupSpec[], colMap: Map<string, ColMapEntry>, sourceCatalog: Map<string, SourceTableEntry>): JoinResult` |

#### `query/sql-aggregates.ts`

| Export | Signature |
| -------- | ----------- |
| `AggregateResult` (interface) | `selects: string[]`, `groupBy: string[]`, `having: string` |
| `renderAggregateExpr` | `(fn: string, colRef: string): string` |
| `buildAggregates` | `(aggregates: AggregateSpec[], aggMode: AggMode, colMap: Map<string, ColMapEntry>): AggregateResult` |

#### `query/sql-detail.ts`

| Export | Signature |
| -------- | ----------- |
| `DetailQueryResult` (interface) | `sql: string`, `params: unknown[]`, `cols: string[]` |
| `buildDetailQuery` | `(reportSpec: ReportSpec, colMap: Map<string, ColMapEntry>, sourceCatalog: Map<string, SourceTableEntry>): DetailQueryResult` |

#### `query/sql-grouped.ts`

| Export | Signature |
| -------- | ----------- |
| `GroupedQueryResult` (interface) | `sql: string`, `params: unknown[]`, `cols: string[]` |
| `buildGroupedQuery` | `(reportSpec: ReportSpec, colMap: Map<string, ColMapEntry>, sourceCatalog: Map<string, SourceTableEntry>): GroupedQueryResult` |

#### `query/sql-calcs.ts`

| Export | Signature |
| -------- | ----------- |
| `buildCalcExpressions` | `(calcStages: CalcStage[], colMap: Map<string, ColMapEntry>): Array<{ alias: string; sql: string }>` |

#### `query/sql-totals.ts`

| Export | Signature |
| -------- | ----------- |
| `TotalsQueryResult` (interface) | `sql: string`, `params: unknown[]`, `cols: string[]` |
| `buildTotalsQuery` | `(reportSpec: ReportSpec, colMap: Map<string, ColMapEntry>, sourceCatalog: Map<string, SourceTableEntry>): TotalsQueryResult \| null` |

#### `query/sql-subtotals.ts`

| Export | Signature |
| -------- | ----------- |
| `SubtotalStrategy` (type) | `'nested' \| 'combined'` |
| `SubtotalsQueryResult` (interface) | `sql: string`, `params: unknown[]`, `cols: string[]` |
| `buildSubtotalsQuery` | `(reportSpec: ReportSpec, colMap: Map<string, ColMapEntry>, sourceCatalog: Map<string, SourceTableEntry>): SubtotalsQueryResult \| null` |

#### `query/lookup-resolver.ts`

| Export | Signature |
| -------- | ----------- |
| `ResolvedLookup` (interface) | `lookup: LookupSpec`, `resolved: { rightTable: SourceTableEntry; pairs: Array<{ left: string; right: string }> }` |
| `DuplicateResult` (interface) | `hasDuplicates: boolean`, `duplicateCount: number`, `duplicateKeys: string[]` |
| `ValidationIssue` (interface) | `code: string`, `message: string`, `missingTableId?: string`, `missingColumn?: string` |
| `DuplicatePolicy` (interface) | `mode?: string`, `combine?: { separator?: string; unique?: boolean; includeBlank?: boolean; sort?: boolean }` |
| `validateLookupSpec` | `(lookupSpec: LookupSpec, lookupIndex: number, sourceCatalog: Map<string, SourceTableEntry>): ValidationIssue[]` |
| `expandLookups` | `(lookups: LookupSpec[], sourceCatalog: Map<string, SourceTableEntry>): ResolvedLookup[]` |
| `detectDuplicateLookupKeys` | `(rightRows: Record<string, unknown>[], keyPairs: Array<{ right: string }>): DuplicateResult` |
| `applyDuplicatePolicy` | `(rightRows: Record<string, unknown>[], keyPairs: Array<{ right: string }>, policy: DuplicatePolicy): Record<string, unknown>[]` |

#### `query/query-plan.ts`

| Export | Signature |
| -------- | ----------- |
| `SourcePlan` (interface) | `base, stacks, baseCols, excludedRows, tablesById` |
| `JoinPlan` (interface) | `rightId, keyPairs, required, duplicatePolicy, excludedRows, rightColumns, rightTableName` |
| `BuiltQueryPlan` (interface) | `source, joins, calculatedColumns, filters, selectedColumns, groupBy, aggregates, sorts, colTotals, subtotalBy, subtotalFns, subtotalGrandTotal, subtotalSpacer, subtotalOnTop, subtotalStrategy, aggMode, colMap, sql, params, cols` |
| `buildQueryPlan` | `(reportSpec: ReportSpec, tables: Record<string, DbTable>): BuiltQueryPlan` |

#### `query/resolve-ref.ts`

| Export | Signature |
| -------- | ----------- |
| `resolveRef` | `(alias: string, colMap: Map<string, ColMapEntry>): string` |

#### `query/alias-ref-updater.ts`

| Export | Signature |
| -------- | ----------- |
| `_renameProjectedAliasRefs` | `(oldAlias: string, newAlias: string): void` |

---

### Report Layer (Plan B2 — COMPLETE, Plan C — COMPLETE)

#### `query/layout-selection.ts`

| Export | Signature |
| -------- | ----------- |
| `_seenCols` | `Set<string>` (module-level, tracks seen columns) |
| `_previewOpen` | `Set<string>` (module-level, tracks open previews) |
| `_disabledCardCols` | `Set<string>` (module-level, tracks disabled card columns) |
| `_sampleTipFor` | `(tid: string, col: string, extra?: string[]): string` |
| `_isSourceVisibleInLayout` | `(tid: string, col: string, colMap: Map<string, ColMapEntry>, _mode: string): boolean` |
| `_showLayoutAliasesForSource` | `(tid: string, col?: string \| null): void` |
| `_hideLayoutAliasesForSource` | `(tid: string, col?: string \| null): void` |
| `_hideLookupLayoutAliasesSafely` | `(tid: string, col?: string \| null, excludeLookupIndex?: number): void` |
| `_isAliasVisibleInLayout` | `(alias: string, _mode: string): boolean` |
| `_syncSubtotalByToLayout` | `(): void` |
| `_afterCombineChange` | `(): void` |

#### `report/aggregation-constants.ts`

| Export | Signature |
| -------- | ----------- |
| `AGG_FNS` | `readonly string[]` (constant: SUM, AVG, MIN, MAX, COUNT ROWS, etc.) |
| `AGG_LABELS` | `Record<string, string>` |
| `AGG_NEEDS_COL` | `(fn: string): boolean` |
| `TOTAL_FNS` | `readonly string[]` (constant: skip, SUM, AVG, etc.) |
| `TOTAL_LABELS` | `Record<string, string>` |
| `SUBTOTAL_FNS` | `readonly string[]` (constant: skip, SUM, AVG, etc.) |
| `SUBTOTAL_LABELS` | `Record<string, string>` |
| `AGG_MODES` | `readonly AggMode[]` (constant: none, group, totals, subtotals) |
| `getAggregateLabel` | `(fn: string): string` |
| `getTotalLabel` | `(fn: string): string` |
| `getSubtotalLabel` | `(fn: string): string` |
| `isValidAggregateFn` | `(fn: string): boolean` |
| `isValidTotalFn` | `(fn: string): boolean` |
| `isValidSubtotalFn` | `(fn: string): boolean` |
| `aggregateNeedsColumn` | `(fn: string): boolean` |

#### `report/result-set.ts`

| Export | Signature |
| -------- | ----------- |
| `ResultSetMetadata` (interface) | `rowCount: number`, `generatedAt: number`, `aggMode: string`, `displayCols: string[] \| null`, `totalsRow?: Record<string, unknown> \| null`, `hasSubtotals?: boolean`, `allCols?: string[]` |
| `ResultSet` (interface) | `columns: string[]`, `rows: Record<string, unknown>[]`, `metadata: ResultSetMetadata` |
| `buildResultSet` | `(columns: string[], rows: Record<string, unknown>[], metadata?: Partial<ResultSetMetadata>): ResultSet` |

#### `report/output-layout.ts`

| Export | Signature |
| -------- | ----------- |
| `LayoutBlock` (interface) | `id: string`, `type: string`, `source: { reportId: string \| null; resultRef: string \| null }`, `position: { row: number; col: number; width: number; height: number }`, `config: Record<string, unknown>` |
| `OutputLayout` (interface) | `blocks: LayoutBlock[]` |
| `createOutputLayout` | `(blocks?: Partial<LayoutBlock>[]): OutputLayout` |
| `addBlock` | `(layout: OutputLayout, block: Partial<LayoutBlock>): OutputLayout` |
| `removeBlock` | `(layout: OutputLayout, blockId: string): OutputLayout` |
| `updateBlock` | `(layout: OutputLayout, blockId: string, updates: Partial<LayoutBlock>): OutputLayout` |
| `getBlock` | `(layout: OutputLayout, blockId: string): LayoutBlock \| null` |

#### `report/report-output.ts`

| Export | Signature |
| -------- | ----------- |
| `PublishedOutput` (interface) | `reportId: string`, `outputId: string`, `name: string`, `columns: string[]`, `rows: Record<string, unknown>[]`, `source: string`, `publishedAt: number` |
| `publishReportOutput` | `(reportSpec: ReportSpec, resultSet: ResultSet): PublishedOutput` |
| `buildPublishedOutputCatalog` | `(workspaceState: WorkspaceState, resultCache: Map<string, ResultSet>): Map<string, PublishedOutput>` |

#### `report/report-graph.ts`

| Export | Signature |
| -------- | ----------- |
| `ReportNode` (interface) | `report: ReportSpec`, `dependencies: string[]`, `dependents: string[]` |
| `ReportGraph` (interface) | `nodes: Map<string, ReportNode>`, `cycles: string[][]` |
| `buildReportGraph` | `(workspaceState?: WorkspaceState \| null): ReportGraph` |
| `getReportDependencies` | `(graph: ReportGraph, reportId: string): string[]` |
| `getReportDependents` | `(graph: ReportGraph, reportId: string): string[]` |
| `detectReportCycles` | `(graph: ReportGraph): string[][]` |
| `getRunOrder` | `(graph: ReportGraph, reportId: string): string[]` |
| `getWorkspaceRunOrder` | `(graph: ReportGraph): string[]` |

#### `report/calc-validator.ts`

| Export | Signature |
| -------- | ----------- |
| `checkCalcError` | `(calc: CalcStage, i: number, projectedCols: string[]): string \| null` |

#### `report/validation.ts`

| Export | Signature |
| -------- | ----------- |
| `ValidationIssue` (interface) | `id: string`, `severity: string`, `area: string`, `cardId: string`, `itemId: string`, `message: string`, `missingTableId?: string \| null`, `missingColumn?: string`, `repairHint?: string`, `lookupIndex?: number`, `calcIndex?: number` |
| `ValidationItem` (interface) | `enabled: boolean`, `resolved: boolean`, `blocking: boolean`, `issues: ValidationIssue[]` |
| `ValidationCard` (interface) | `status: string`, `issues: ValidationIssue[]` |
| `ValidationResult` (interface) | `reportStatus: 'healthy' \| 'blocked'`, `cards: Record<string, ValidationCard>`, `items: Record<string, ValidationItem>` |
| `invalidateValidation` | `(): void` |
| `getValidation` | `(): ValidationResult` |
| `deriveValidation` | `(state: AppState, projectedColsList: string[], colMap: Map<string, ColMapEntry>, sourceCatalog: Map<string, SourceTableEntry>): ValidationResult` |

#### `report/engine.ts`

| Export | Signature |
| -------- | ----------- |
| `runReport` | `(reportSpec: ReportSpec, tables: Record<string, DbTable>): ResultSet` |

---

### UI Layer (Plan D, E — COMPLETE)

#### `core/state-schema.ts`

| Export | Signature |
| -------- | ----------- |
| `STATE_VERSION` | `number` (constant) |
| `RECOGNIZABLE_KEYS` | `string[]` (constant) |
| `isRecognizableConfig` | `(payload: unknown): boolean` |

#### `core/state-hydrator.ts`

| Export | Signature |
| -------- | ----------- |
| `hydrateState` | `(payload: Record<string, unknown>, loadedTables: string[]): { next: Partial<AppState>; brokenRefs: string[]; nextExcludedRows: Record<string, Set<number>> }` |

#### `core/state-applier.ts`

| Export | Signature |
| -------- | ----------- |
| `applyState` | `(store: Store, next: Partial<AppState>, nextExcludedRows?: Record<string, Set<number>>): void` |

#### `core/state-loader.ts`

| Export | Signature |
| -------- | ----------- |
| `LoadResult` (interface) | `success: boolean`, `brokenRefs: string[]`, `error?: string` |
| `loadState` | `(file: File, store: Store): Promise<LoadResult>` |

#### `ui/loader.ts`

| Export | Signature |
| -------- | ----------- |
| `ingestSheet` | `(wb: XLSXWorkbook, sheetName: string, label: string, store: Store): void` |
| `loadSheets` | `(wb: XLSXWorkbook, sheetNames: string[], store: Store): void` |
| `loadSpreadsheet` | `(file: File, store: Store): Promise<void>` |

#### `ui/components/tip.tsx`

| Export | Signature |
| -------- | ----------- |
| `Tip` | `(props: { text: string }) => JSX.Element` |

#### `ui/components/modal.tsx`

| Export | Signature |
| -------- | ----------- |
| `Modal` | `(props: { open: boolean; title?: string; onClose?: () => void; closeOnBackdrop?: boolean; className?: string; children?: ComponentChildren; buttons?: { label: string; action: () => void; primary?: boolean; className?: string }[] }) => JSX.Element` |

#### `ui/components/context-menu.tsx`

| Export | Signature |
| -------- | ----------- |
| `ContextMenu` | `(props: { x: number; y: number; items: { label: string; action: () => void }[]; onClose: () => void }) => JSX.Element` |

#### `ui/components/chip.tsx`

| Export | Signature |
| -------- | ----------- |
| `Chip` | `(props: ChipProps) => JSX.Element` — ChipProps has col, label, colorClass?, selected?, draggable?, tooltip?, badge?, onClick?, onContextMenu?, onDblClick?, drag handlers |

#### `ui/components/rename-modal.tsx`

| Export | Signature |
| -------- | ----------- |
| `RenameTarget` (interface) | `alias: string`, `tid?: string`, `col?: string`, `calcIdx?: number` |
| `resolveRenameTarget` | `(alias: string): RenameTarget \| null` |
| `RenameModal` | `(props: { target: RenameTarget; onDone?: () => void; onClose: () => void }) => JSX.Element` |

#### `ui/components/calc-builder.tsx`

| Export | Signature |
| -------- | ----------- |
| `CalcBuilderProps` (interface) | `calc: CalcStage`, `i: number`, `cols: string[]`, `colOptsFor: (sel: string) => ColOption[]` |
| `ColOption` (type) | `{ value: string; label: string; selected: boolean }` |
| `MathBuilder` | `(props: CalcBuilderProps) => JSX.Element` |
| `TextEditBuilder` | `(props: CalcBuilderProps) => JSX.Element` |
| `CompareBuilder` | `(props: CalcBuilderProps) => JSX.Element` |
| `DateBuilder` | `(props: CalcBuilderProps) => JSX.Element` |
| `calcModeComponents` | `Record<string, (props: CalcBuilderProps) => JSX.Element>` |

#### `ui/sections/` — Pipeline + Layout Components

| Component | Props | Returns |
| ----------- | ------- | --------- |
| `PipelineArrow` | `{ id: string; buildPreviewHTML: (id: string) => string }` | JSX arrow connector with preview toggle |
| `BaseStage` | `{ sortedIds: string[] }` | JSX base table selector with column chips |
| `StackSheets` | `{ sortedIds: string[]; usedAsLookup: Set<string>; usedAsStack: Set<string> }` | JSX stacked sheets with add/remove |
| `LookupStage` | `{ i: number; sortedIds: string[]; usedAsLookup: Set<string>; usedAsStack: Set<string> }` | JSX lookup config (table, keys, columns, policy) |
| `CalcStageSection` | `{ i: number }` | JSX calc column config (alias, mode, options) |
| `ColumnChips` | `()` | JSX draggable column chips for layout ordering |
| `RunBar` | `{ onResult?: (result: Record<string, unknown>) => void }` | JSX validation status + run button |
| `FilterList` | `()` | JSX filter condition rows |
| `SortList` | `()` | JSX sort condition rows |
| `MergeToggles` | `()` | JSX merge display toggles |

| Exported Function | Signature |
| ------------------- | ----------- |
| `selectAllCols` | `(): void` |
| `selectNoneCols` | `(): void` |
| `addFilter` | `(): void` |
| `addSort` | `(): void` |
| `setMergeGroupUnderline` | `(checked: boolean): void` |

#### `ui/cards/` — Card Components

| Component | Returns |
| ----------- | --------- |
| `PipelineCard` | JSX — composes BaseStage, StackSheets, PipelineArrow[], LookupStage[], CalcStageSection[] |
| `LayoutCard` | JSX — agg mode radios, ColumnChips, aggregate/totals/subtotals sections, MergeToggles, RunBar |
| `FilterSortCard` | JSX — FilterList + SortList with add buttons |

#### `ui/aggregation.ts`

| Export | Signature |
| -------- | ----------- |
| `ensureAggModeState` | `(): void` |
| `saveActiveAggModeState` | `(): void` |
| `loadAggModeState` | `(mode: string): void` |
| `setAggMode` | `(mode: string): void` |
| `setSubtotalGrandTotal` | `(checked: boolean): void` |
| `setSubtotalSpacer` | `(checked: boolean): void` |
| `setSubtotalOnTop` | `(checked: boolean): void` |
| `setSubtotalStrategy` | `(value: string): void` |
| `addAggregate` | `(): void` |
| `removeAggregate` | `(i: number): void` |
| `touchAggregate` | `(i: number): void` |

#### `ui/sidebar.tsx`

| Export | Signature |
| -------- | ----------- |
| `Sidebar` | `() => JSX.Element` — table list with color chips, metadata, remove, click-to-preview |

#### `ui/file-loader.tsx`

| Export | Signature |
| -------- | ----------- |
| `Loader` | `() => JSX.Element` — file drag-drop, loading overlay, sheet selector modal |

#### `ui/grid.ts`

| Export | Signature |
| -------- | ----------- |
| `refreshResultGridLayout` | `(): void` |
| `refreshPreviewGridLayout` | `(): void` |
| `renderResults` | `(result: Record<string, unknown>, wrapEl: HTMLElement, metaEl: HTMLElement, onRenameDone?: () => void): void` |
| `renderPreviewDropdown` | `(selEl: HTMLSelectElement): void` |
| `loadPreview` | `(tableId: string, wrapEl: HTMLElement, metaEl: HTMLElement, onRenameDone?: () => void): void` |
| `clearExclusions` | `(tableId: string, wrapEl: HTMLElement, metaEl: HTMLElement, onRenameDone?: () => void): void` |

#### `ui/export.ts`

| Export | Signature |
| -------- | ----------- |
| `exportAs` | `(fmt: string): Promise<void>` |

#### `ui/tabs.ts`

| Export | Signature |
| -------- | ----------- |
| `switchTab` | `(name: string): void` |

#### `ui/app.tsx`

| Export | Signature |
| -------- | ----------- |
| `App` | `() => JSX.Element` — root component: Loader, header, Sidebar, tabbed content (QueryBuilder, Preview, Results) |

#### `app.ts` (entry point)

No exports. Async `main()`: initDb → initStore → render `<App>` to DOM.

#### `index.ts` (barrel exports)

Re-exports all public symbols from core, catalog, query, report, and UI layers.

---

## Decisions Made

| Decision | Rationale | Plan |
| ---------- | ----------- | ------ |
| Draft-mutator pattern for `store.update()` | Immer-style immutable updates, matches design doc spec | A |
| Dynamic imports for future-phase modules in utils.ts | Keeps Phase A self-contained without stubs | A |
| Extracted shared `resolveRef()` utility | Eliminated duplication across 9 query modules | B |
| Vendor type declarations in `types/globals.d.ts` | Prevents `any` leakage for sql.js, XLSX, AG Grid | A |
| `invalidateValidation()` imported from report/validation by state-applier | Architecturally required — state changes must invalidate validation cache | D |
| `file-loader.tsx` named differently from plan's `loader.tsx` | Avoids conflict with `ui/loader.ts` (data ingestion module) | E |
| Calc builders converted from string HTML to Preact components | Original string-returning + `dangerouslySetInnerHTML` was the old pattern; Preact components use proper JSX + event handlers | Fix |
| `.js` extensions removed from all imports | Not needed with `moduleResolution: "bundler"`; was unnecessary convention carried over from Node ESM | Fix |
| Old `SRC/js/` codebase deleted | Migration complete; `js/vendor/` and `js/wasm/` retained for vendor libs | Cleanup |
| Old `SRC/tests/` deleted | 786 tests for old codebase; replaced by 531 preact tests | Cleanup |
| `preact_index.html` renamed to `index.html` | Preact is now the only codebase | Cleanup |
