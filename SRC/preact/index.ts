/**
 * Barrel exports for the Preact application.
 *
 * Re-exports all public modules from core/, catalog/, query/, report/, and ui/
 * layers. This is a convenience file for consumers that need to import from
 * multiple sub-modules.
 */

// ── Core Layer ────────────────────────────────────────────────────────────────

export { createAppState, createWorkspaceState, createReportSpec, createLookupSpec, createFilterSpec, createSortSpec, createOutputColumnSpec, createDetailBandSpec } from './core/state';
export { createStore, initStore, getStore } from './core/store';
export type { Store } from './core/store';
export { initDb, quoteId, createTable, insertRows, execQuery, dropTable, tableRowCount } from './core/sqldb';
export { h, stripExt, dl, toast, stickyToast, toggleSidebar, getTableColor, getTableColorClass, chipFgColor, tableShortName, colUserLabel, setColLabel, renameProjectedColumn, colDisplayLabel, colExportLabel, buildExportHeaderMap, smartDefaultFn, defaultAggAlias, TABLE_PALETTE } from './core/utils';
export { normalizeDateExpr, getDateInputFormat, isISODate, getColumnSamples } from './core/date-format';
export { loadState } from './core/state-loader';
export type { LoadResult } from './core/state-loader';
export { applyState } from './core/state-applier';
export { hydrateState } from './core/state-hydrator';
export { STATE_VERSION as STATE_SCHEMA_VERSION, isRecognizableConfig } from './core/state-schema';

// ── Catalog Layer ─────────────────────────────────────────────────────────────

export { buildSourceCatalog } from './catalog/source-catalog';
export type { SourceTableEntry } from './catalog/source-catalog';
export { buildColSourceMap, buildColumnCatalog, projectedCols, projectedColsUpToLookup, tablePrefix } from './catalog/column-catalog';
export type { PhysicalColEntry, CalcColEntry, ColMapEntry } from './catalog/column-catalog';

// ── Query Layer ───────────────────────────────────────────────────────────────

export { buildWhere } from './query/sql-where';
export type { WhereResult } from './query/sql-where';
export { buildJoins } from './query/sql-joins';
export type { JoinResult } from './query/sql-joins';
export { renderAggregateExpr, buildAggregates } from './query/sql-aggregates';
export type { AggregateResult } from './query/sql-aggregates';
export { buildDetailQuery } from './query/sql-detail';
export type { DetailQueryResult } from './query/sql-detail';
export { buildGroupedQuery } from './query/sql-grouped';
export type { GroupedQueryResult } from './query/sql-grouped';
export { buildCalcExpressions } from './query/sql-calcs';
export { buildTotalsQuery } from './query/sql-totals';
export type { TotalsQueryResult } from './query/sql-totals';
export { buildSubtotalsQuery } from './query/sql-subtotals';
export type { SubtotalsQueryResult, SubtotalStrategy } from './query/sql-subtotals';
export { buildBandQuery } from './query/sql-detail-bands';
export type { BandQueryResult } from './query/sql-detail-bands';
export { validateLookupSpec, expandLookups, detectDuplicateLookupKeys, applyDuplicatePolicy } from './query/lookup-resolver';
export type { ResolvedLookup, DuplicateResult, ValidationIssue as LookupValidationIssue, DuplicatePolicy } from './query/lookup-resolver';
export { buildQueryPlan } from './query/query-plan';
export type { SourcePlan, JoinPlan, BuiltQueryPlan } from './query/query-plan';
export { resolveRef } from './query/resolve-ref';
export { _seenCols, _previewOpen, _disabledCardCols, _sampleTipFor, _isSourceVisibleInLayout, _showLayoutAliasesForSource, _hideLayoutAliasesForSource, _hideLookupLayoutAliasesSafely, _isAliasVisibleInLayout, _syncSubtotalByToLayout, _afterCombineChange } from './query/layout-selection';

// ── Report Layer ──────────────────────────────────────────────────────────────

export { AGG_FNS, AGG_LABELS, AGG_NEEDS_COL, TOTAL_FNS, TOTAL_LABELS, SUBTOTAL_FNS, SUBTOTAL_LABELS, AGG_MODES, getAggregateLabel, getTotalLabel, getSubtotalLabel, isValidAggregateFn, isValidTotalFn, isValidSubtotalFn, aggregateNeedsColumn } from './report/aggregation-constants';
export { buildResultSet } from './report/result-set';
export type { ResultSet, ResultSetMetadata } from './report/result-set';
export { createOutputLayout, addBlock, removeBlock, updateBlock, getBlock } from './report/output-layout';
export type { LayoutBlock, OutputLayout } from './report/output-layout';
export { publishReportOutput, buildPublishedOutputCatalog } from './report/report-output';
export type { PublishedOutput } from './report/report-output';
export { buildReportGraph, getReportDependencies, getReportDependents, detectReportCycles, getRunOrder, getWorkspaceRunOrder } from './report/report-graph';
export type { ReportNode, ReportGraph } from './report/report-graph';
export { checkCalcError } from './report/calc-validator';
export { invalidateValidation, getValidation, deriveValidation } from './report/validation';
export type { ValidationIssue, ValidationItem, ValidationCard, ValidationResult } from './report/validation';
export { runReport, RowExplosionError, STACK_ROW_LIMIT, buildBandChildIndex, runPreviewQuery } from './report/engine';
export type { BandChildIndex } from './report/engine';
export { buildPreview } from './report/preview-builder';
export type { PreviewResult } from './report/preview-builder';

// ── UI Layer ──────────────────────────────────────────────────────────────────

export { App } from './ui/app';
export { Sidebar } from './ui/sidebar';
export { Loader } from './ui/file-loader';
export { loadSpreadsheet, loadSheets, ingestSheet } from './ui/loader';
export { PipelineCard } from './ui/cards/pipeline-card';
export { LayoutCard } from './ui/cards/layout-card';
export { FilterSortCard } from './ui/cards/filter-sort-card';
export { RunBar } from './ui/sections/run-bar';
export { ColumnChips, selectAllCols, selectNoneCols } from './ui/sections/column-chips';
export { MergeToggles, setMergeGroupUnderline } from './ui/sections/merge-toggles';
export { FilterList, addFilter } from './ui/sections/filter-list';
export { SortList, addSort } from './ui/sections/sort-list';
export { BaseStage } from './ui/sections/base-stage';
export { StackSheets } from './ui/sections/stack-sheets';
export { PipelineArrow } from './ui/sections/pipeline-arrow';
export { LookupStage } from './ui/sections/lookup-stage';
export { CalcStageSection } from './ui/sections/calc-stage';
export { DetailBandStage } from './ui/sections/detail-band-stage';
export { Tip } from './ui/components/tip';
export { Modal } from './ui/components/modal';
export { ContextMenu } from './ui/components/context-menu';
export { Chip } from './ui/components/chip';
export { RenameModal, resolveRenameTarget } from './ui/components/rename-modal';
export { RowExplosionDialog } from './ui/components/row-explosion-dialog';
export type { RowExplosionDialogProps } from './ui/components/row-explosion-dialog';
export { MathBuilder, TextEditBuilder, CompareBuilder, DateBuilder, calcModeComponents } from './ui/components/calc-builder';
export type { CalcBuilderProps, ColOption } from './ui/components/calc-builder';
export { switchTab } from './ui/tabs';
export { ResultGrid, PreviewGrid, refreshResultGridLayout, refreshPreviewGridLayout } from './ui/grid';
export { exportAs } from './ui/export';
export {
  setAggMode,
  addAggregate,
  removeAggregate,
  touchAggregate,
  setSubtotalGrandTotal,
  setSubtotalSpacer,
  setSubtotalOnTop,
  setSubtotalStrategy,
  loadAggModeState,
  saveActiveAggModeState,
  ensureAggModeState,
} from './ui/aggregation';

// ── Types ─────────────────────────────────────────────────────────────────────

export type {
  CalcMode,
  ColumnType,
  AggMode,
  DbTable,
  LookupSpec,
  DetailBandSpec,
  CalcStage,
  FilterSpec,
  SortSpec,
  AggregateSpec,
  AppState,
  ReportSpec,
  WorkspaceState,
  OutputColumnSpec,
  DateComponent,
  DateInputFormat,
  ColSourceEntry,
} from './types';
