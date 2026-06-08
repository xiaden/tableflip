import { db } from '../core/state.js';
import { buildColumnCatalog, ColMapEntry } from '../catalog/column-catalog.js';
import { getValidation } from '../report/validation.js';

export interface QueryPlan {
  source: {
    base: string;
    stacks: string[];
    baseCols: string[] | null;
    excludedRows: Record<string, Set<number>>;
    tablesById: Map<string, { cols: string[]; name: string }>;
  };
  joins: Array<{
    rightId: string;
    keyPairs: Array<{ left: string; right: string }>;
    required: boolean;
    excludedRows: Set<number> | null;
    rightColumns: string[];
    rightTableName: string;
    duplicatePolicy: { mode: string; combine?: { separator?: string; unique?: boolean; includeBlank?: boolean; sort?: boolean } };
  }>;
  calculatedColumns: ColMapEntry[];
  filters: FilterSpec[];
  selectedColumns: string[];
  groupBy: string[];
  aggregates: AggregateSpec[];
  sorts: SortSpec[];
  colTotals: Record<string, string>;
  subtotalBy: string[];
  subtotalFns: Record<string, string>;
  subtotalGrandTotal: boolean;
  subtotalSpacer: boolean;
  subtotalOnTop: boolean;
  subtotalStrategy: string;
  aggMode: string;
  colMap: Map<string, ColMapEntry>;
  validation: Record<string, unknown> | null;
}

export function buildQueryPlan(
  reportSpec?: Record<string, unknown> | DbState | null,
  columnCatalog?: { colMap: Map<string, ColMapEntry> } | null,
  validation?: Record<string, unknown> | null,
  sourceCatalog?: Map<string, { cols?: string[]; name?: string }>
): QueryPlan {
  if (!(sourceCatalog instanceof Map)) throw new Error('buildQueryPlan: sourceCatalog (Map) is required');
  const ctx: Record<string, unknown> = (reportSpec as Record<string, unknown> | undefined) || (db as unknown as Record<string, unknown>);
  columnCatalog = columnCatalog || buildColumnCatalog(ctx, sourceCatalog);
  validation    = validation    || ((typeof getValidation === 'function' ? getValidation() : null) as Record<string, unknown> | null);

  const colMap = columnCatalog.colMap;

  // Build tablesById from sourceCatalog
  const tablesById = new Map<string, { cols: string[]; name: string }>();
  if (sourceCatalog instanceof Map) {
    for (const [tid, entry] of sourceCatalog) {
      tablesById.set(tid, { cols: entry.cols || [], name: entry.name || tid });
    }
  }

  // Source
  const base = (ctx.base as string) || '';
  const stacks = ((ctx.stacks as string[]) || []).filter((id: string) => tablesById.has(id));
  const baseCols = (ctx.baseCols as string[] | null) || (tablesById.has(base) ? tablesById.get(base)!.cols : null);
  const source = {
    base,
    stacks,
    baseCols,
    excludedRows: (ctx.excludedRows as Record<string, Set<number>>) || {},
    tablesById,
  };

  // Joins — enabled lookups with complete key pairs and loaded right table
  const lookups = (ctx.lookups as LookupSpec[]) || [];
  const joins = lookups
    .filter((lk: LookupSpec) => lk.enabled !== false && lk.rightId && tablesById.has(lk.rightId))
    .map((lk: LookupSpec) => {
      const rtMeta = tablesById.get(lk.rightId);
      return {
        rightId:     lk.rightId,
        rightColumns: rtMeta ? rtMeta.cols : [],
        rightTableName: rtMeta ? rtMeta.name : lk.rightId,
        keyPairs:    (lk.keyPairs || []).filter((p: { left: string; right: string }) => p.left && p.right),
        required:    !!lk.required,
        duplicatePolicy: lk.duplicatePolicy || { mode: 'block' },
        excludedRows: ((ctx.excludedRows as Record<string, Set<number>>) || {})[lk.rightId] || null,
      };
    })
    .filter(j => j.keyPairs.length > 0);

  // Calculated columns from colMap (kind === 'calc')
  const calculatedColumns = [...colMap.values()].filter((e: ColMapEntry) => e.kind === 'calc');

  // Filters — enabled only
  const filters = ((ctx.filters as FilterSpec[]) || []).filter((f: FilterSpec) => f.enabled !== false && f.col);

  // Selected columns in colOrder, filtered by selCols when set
  const colOrder = ctx.colOrder as string[] | null;
  const aggMode = (ctx.aggMode as string) || 'none';
  const aggregates = (ctx.aggregates as AggregateSpec[]) || [];
  const aggAliases = aggMode === 'group' ? aggregates.map((a: AggregateSpec) => a.alias).filter((a: string) => a) : [];
  const orderedAliases = colOrder
    ? colOrder.filter((a: string) => colMap.has(a) || aggAliases.includes(a))
    : [...colMap.keys(), ...aggAliases];
  const rawSelCols = ctx.selCols;
  const selCols = rawSelCols instanceof Set ? (rawSelCols as Set<string>) : null;
  const selectedColumns = selCols
    ? orderedAliases.filter((a: string) => selCols.has(a))
    : orderedAliases;

  // Sorts — enabled only
  const sorts = ((ctx.sorts as SortSpec[]) || []).filter((s: SortSpec) => s.enabled !== false && s.col && colMap.has(s.col));

  return {
    source,
    joins,
    calculatedColumns,
    filters,
    selectedColumns,
    groupBy:            (ctx.groupBy as string[])         || [],
    aggregates:         (ctx.aggregates as AggregateSpec[]) || [],
    sorts,
    colTotals:          (ctx.colTotals as Record<string, string>)         || {},
    subtotalBy:         (ctx.subtotalBy as string[])        || [],
    subtotalFns:        (ctx.subtotalFns as Record<string, string>)        || {},
    subtotalGrandTotal: (ctx.subtotalGrandTotal as boolean) !== false,
    subtotalSpacer:     !!(ctx.subtotalSpacer as boolean),
    subtotalOnTop:      !!(ctx.subtotalOnTop as boolean),
    subtotalStrategy:   (ctx.subtotalStrategy as string) || 'combined',
    aggMode:            (ctx.aggMode as string)           || 'none',
    colMap,
    validation: validation as Record<string, unknown> | null,
  };
}
