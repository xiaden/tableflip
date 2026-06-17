# Temp-Table Pipeline Architecture — Design Document

**Slug:** temp-table-pipeline  
**Status:** Draft  
**Author:** agent

## Problem Statement

The current TableFlip report pipeline uses a compiled-query approach where all pipeline cards (base, stacks, lookups, calcs, filters, aggregation) are composed into a single complex SQL query. This architecture has four critical problems:

1. **Stacks are broken in full report execution**: The "Include rows from" feature has working UI, working validation, and working preview — but the actual SQL generators (`sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts`) ignore stacks entirely. Only the preview builder (`preview-builder.ts`) generates the UNION ALL. Full report execution never includes stacked rows. This is the single biggest bug in the current architecture.

2. **Previews require duplicate logic**: The `preview-builder.ts` (365 lines) partially duplicates catalog-building and query-construction logic just to show a preview of intermediate pipeline stages. For each stage, it rebuilds the source catalog, column catalog, and calc expressions from scratch, then calls `buildQueryPlan()` independently. This is wasteful and fragile.

3. **Feature friction**: Adding a "source sheet" column (showing which stacked sheet each row came from) requires threading a literal string through all four SQL generators, plus the catalog, plus validation, plus the query plan. The current architecture makes simple features expensive.

4. **Four SQL generators to maintain**: Detail, grouped, totals, and subtotals modes each have their own SQL builder (total ~700 lines). Adding any feature to the pipeline requires touching all four. The compiled-query approach conflates orthogonal concerns (stacks, lookups, calcs, filters, aggregation) into a single monolithic query.

Additionally, the current architecture has code smells:
- `runTotalsMode()` in `engine.ts` rebuilds catalogs from scratch even though `buildQueryPlan()` already computed them
- Debugging is difficult because the composed SQL is opaque — you can't inspect intermediate results
- The column catalog predicts what the composed query will produce, rather than reading actual output schemas

## Scope

**In scope:**
- `SRC/preact/report/pipeline-engine.ts` — New pipeline engine that orchestrates temp table creation and tracks stage validity
- `SRC/preact/report/pipeline-stages/` — New directory with stage modules: `base.ts`, `lookups.ts`, `calcs.ts`, `filters.ts`, `sorts.ts`, `aggregation.ts`
- `SRC/preact/report/preview-builder.ts` — Simplified to SELECT from appropriate temp table (delete 300+ lines of duplicate logic)
- `SRC/preact/query/query-plan.ts` — Refactored to return stage configs instead of composed SQL (or deleted if pipeline engine replaces it entirely)
- `SRC/preact/query/sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts` — Deleted once pipeline stages fully replace them
- `SRC/preact/catalog/column-catalog.ts` — Retained for column resolution during pipeline construction (not replaced)
- `SRC/preact/types.ts` — New types: `PipelineState`, `StageContext`, `StageResult`, `StackAlias`
- `SRC/preact/core/state.ts` — New state fields: `includeSourceColumn`, `sourceColumnName`, `stackAliases`
- `SRC/preact/core/state-serializer.ts`, `state-hydrator.ts` — Serialization for new fields
- `SRC/preact/ui/sections/stack-sheets.tsx` — Alias editing UI (text input next to each stack)
- `SRC/preact/ui/cards/pipeline-card.tsx` — Source column checkbox
- `SRC/preact/report/validation.ts` — Updated to read temp table schemas instead of predicting composed query output
- `SRC/preact/tests/` — New integration tests for pipeline engine, unit tests for each stage

**Out of scope:**
- Changing the store/state management pattern (ADR-006: monolithic state store remains)
- Changing vendor integrations (AG Grid, xlsx-js-style, sql.js)
- Changing the React/MUI component architecture
- Changing export (XLSX/CSV) except where temp tables change the result shape
- CSS changes
- Detail bands refactoring (they already have a separate execution path that works)
- Web Worker migration (pipeline execution remains synchronous)
- Memory management / WASM heap monitoring (not needed at spreadsheet data scales)

## Architecture

### Layer Mapping

| Component | Layer | Responsibility |
|-----------|-------|----------------|
| `pipeline-engine.ts` | Report | Orchestrates temp table creation, tracks stage validity, manages lifecycle |
| `pipeline-stages/base.ts` | Report | Creates initial temp table from base + stacks (UNION ALL) |
| `pipeline-stages/lookups.ts` | Report | JOINs lookup tables into pipeline temp table |
| `pipeline-stages/calcs.ts` | Report | Adds calculated columns via SELECT with expressions |
| `pipeline-stages/filters.ts` | Report | Applies WHERE filters, creates filtered temp table |
| `pipeline-stages/sorts.ts` | Report | Applies ORDER BY, creates sorted temp table |
| `pipeline-stages/aggregation.ts` | Report | Handles group/totals/subtotals modes |
| `query-plan.ts` | Query | **Refactored**: Returns stage configs instead of composed SQL |
| `sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts` | Query | **Deleted**: Replaced by pipeline stages |
| `preview-builder.ts` | Report | **Simplified**: SELECT from appropriate temp table |
| `validation.ts` | Report | Reads temp table schemas instead of predicting composed query output |
| `column-catalog.ts` | Catalog | **Retained**: Still needed for column resolution during pipeline construction |

### Data Flow

```
runReport(reportSpec, tables)
    │
    ▼
PipelineEngine.execute(reportSpec, tables)
    │
    ├── Stage 0: Base + Stacks
    │     CREATE TEMP TABLE _pipeline_stage_0 AS
    │       SELECT *, 'Orders' AS "Source Sheet" FROM base_table
    │       UNION ALL
    │       SELECT *, 'Backorders' AS "Source Sheet" FROM stack_table_1
    │       UNION ALL
    │       SELECT *, 'BO' AS "Source Sheet" FROM stack_table_2
    │
    ├── Stage 1: Lookups
    │     CREATE TEMP TABLE _pipeline_stage_1 AS
    │       SELECT * FROM _pipeline_stage_0
    │       LEFT JOIN lookup_table_1 ON ...
    │       LEFT JOIN lookup_table_2 ON ...
    │
    ├── Stage 2: Calculated Columns
    │     CREATE TEMP TABLE _pipeline_stage_2 AS
    │       SELECT *, <calc_expr_1> AS calc_1, <calc_expr_2> AS calc_2
    │       FROM _pipeline_stage_1
    │
    ├── Stage 3: Filters
    │     CREATE TEMP TABLE _pipeline_stage_3 AS
    │       SELECT * FROM _pipeline_stage_2
    │       WHERE <filter_conditions>
    │
    ├── Stage 4: Sorts
    │     CREATE TEMP TABLE _pipeline_stage_4 AS
    │       SELECT * FROM _pipeline_stage_3
    │       ORDER BY <sort_columns>
    │
    └── Stage 5: Aggregation (mode-dependent)
          │
          ├── Detail Mode (aggMode='none')
          │     SELECT * FROM _pipeline_stage_4
          │
          ├── Grouped Mode (aggMode='group')
          │     CREATE TEMP TABLE _pipeline_stage_5 AS
          │       SELECT <group_cols>, <aggregate_exprs>
          │       FROM _pipeline_stage_4
          │       GROUP BY <group_cols>
          │
          ├── Totals Mode (aggMode='totals')
          │     CREATE TEMP TABLE _pipeline_stage_5 AS
          │       SELECT *, 0 AS _row_type FROM _pipeline_stage_4
          │       UNION ALL
          │       SELECT <aggregate_exprs>, 1 AS _row_type FROM _pipeline_stage_4
          │
          └── Subtotals Mode (aggMode='subtotals')
                CREATE TEMP TABLE _pipeline_stage_5 AS
                  SELECT <detail_cols>, 0 AS _row_type, ... FROM _pipeline_stage_4
                  UNION ALL
                  SELECT <subtotal_cols>, 1 AS _row_type, ... FROM _pipeline_stage_4 GROUP BY ...
                  UNION ALL
                  [Optional: spacer rows with _row_type = 2]
                  UNION ALL
                  [Optional: grand total row with _row_type = 3]
                ORDER BY <sort_markers>
    │
    ▼
buildResultSet(cols, rows, metadata)
    │
    ▼
Return ResultSet to UI
```

### Temp Table Naming Convention

All pipeline temp tables use the prefix `_pipeline_` to avoid collisions with source tables:

- `_pipeline_stage_0` — Base + stacks
- `_pipeline_stage_1` — After lookups
- `_pipeline_stage_2` — After calculated columns
- `_pipeline_stage_3` — After filters
- `_pipeline_stage_4` — After sorts
- `_pipeline_stage_5` — After aggregation (final output)

All identifiers use `quoteId()` from `sqldb.ts` to prevent SQL injection.

### Temp Table Lifecycle

**Creation**: Each stage creates its output temp table via `CREATE TEMP TABLE ... AS SELECT ...`. SQLite TEMP tables are automatically dropped when the database connection closes.

**Invalidation**: When a user changes card N, stages N+1 and beyond must be rebuilt. The pipeline engine tracks which stages are valid:

```typescript
interface PipelineState {
  validUpToStage: number;  // Stages 0..validUpToStage are current
  tempTableNames: string[];  // _pipeline_stage_0, _pipeline_stage_1, ...
}
```

When stage N is invalidated:
1. DROP all temp tables from stage N+1 onward
2. Re-execute stages N+1, N+2, ... to rebuild
3. Update `validUpToStage`

**Cleanup**: On report completion or state reset, DROP all `_pipeline_*` temp tables explicitly. This prevents accumulation across multiple report executions.

### Stage Functions

Each stage is a pure function that takes the previous stage's output table name and configuration, and returns the new temp table name:

```typescript
interface StageContext {
  reportSpec: ReportSpec;
  tables: Record<string, DbTable>;
  colMap: Map<string, ColMapEntry>;
  sourceCatalog: Map<string, SourceTableEntry>;
  prevTableName: string;  // Output from previous stage
  stageIndex: number;
}

interface StageResult {
  outputTableName: string;
  outputColumns: string[];
}

type StageFunction = (ctx: StageContext) => StageResult;
```

### Stage 0: Base + Stacks

```typescript
function executeBaseStage(ctx: StageContext): StageResult {
  const { reportSpec, tables } = ctx;
  const baseId = reportSpec.pipeline.base;
  const stackIds = reportSpec.pipeline.stacks || [];
  
  // Build UNION ALL across base + stacks with source column literals
  const selects = [baseId, ...stackIds].map(tid => {
    const table = tables[tid];
    if (!table) throw new Error(`Table ${tid} not found`);
    
    // Select base columns if they exist, else NULL
    const cols = reportSpec.pipeline.baseCols.length > 0
      ? reportSpec.pipeline.baseCols
      : table.cols;
    
    const proj = cols.map(c => 
      table.cols.includes(c) ? quoteId(c) : 'NULL'
    ).join(', ');
    
    // Add source column literal if enabled
    const alias = reportSpec.pipeline.stackAliases?.[tid] ?? table.name;
    const sourceCol = reportSpec.pipeline.includeSourceColumn
      ? `, ${JSON.stringify(alias)} AS ${quoteId(reportSpec.pipeline.sourceColumnName || 'Source Sheet')}`
      : '';
    
    return `SELECT ${proj}${sourceCol} FROM ${quoteId(tid)}`;
  });
  
  const unionSql = selects.join(' UNION ALL ');
  const outputTable = `_pipeline_stage_0`;
  
  execQuery(`CREATE TEMP TABLE ${quoteId(outputTable)} AS ${unionSql}`);
  
  const outputColumns = [...reportSpec.pipeline.baseCols];
  if (reportSpec.pipeline.includeSourceColumn) {
    outputColumns.push(reportSpec.pipeline.sourceColumnName || 'Source Sheet');
  }
  
  return {
    outputTableName: outputTable,
    outputColumns
  };
}
```

**Key decision**: Source column is a literal in the SELECT clause of each UNION ALL branch. This is correct because:
- SQLite doesn't guarantee UNION ALL row ordering in temp tables
- ALTER TABLE + UPDATE with _rowno would be unreliable
- One pass, no additional queries, guaranteed correct

### Stage 1: Lookups

```typescript
function executeLookupStage(ctx: StageContext): StageResult {
  const { reportSpec, colMap, sourceCatalog, prevTableName } = ctx;
  const lookups = reportSpec.pipeline.lookups || [];
  
  if (lookups.length === 0) {
    // No lookups — pass through
    return { outputTableName: prevTableName, outputColumns: ctx.outputColumns };
  }
  
  // Build JOIN clauses
  const joinParts = lookups
    .filter(lk => lk.enabled !== false && lk.rightId)
    .map(lk => {
      const jType = lk.required ? 'INNER' : 'LEFT';
      const rightTable = quoteId(lk.rightId);
      
      const onConditions = lk.keyPairs
        .filter(p => p.left && p.right)
        .map(p => {
          const leftRef = resolveRef(p.left, colMap);
          const rightRef = `${rightTable}.${quoteId(p.right)}`;
          return `${leftRef} = ${rightRef}`;
        })
        .join(' AND ');
      
      return `${jType} JOIN ${rightTable} ON ${onConditions}`;
    });
  
  const outputTable = `_pipeline_stage_1`;
  const sql = `CREATE TEMP TABLE ${quoteId(outputTable)} AS SELECT * FROM ${quoteId(prevTableName)} ${joinParts.join(' ')}`;
  
  execQuery(sql);
  
  return {
    outputTableName: outputTable,
    outputColumns: ctx.outputColumns  // Expanded by lookups
  };
}
```

### Stage 2: Calculated Columns

```typescript
function executeCalcStage(ctx: StageContext): StageResult {
  const { reportSpec, colMap, prevTableName } = ctx;
  const calcStages = reportSpec.pipeline.calculatedColumns || [];
  
  if (calcStages.length === 0) {
    return { outputTableName: prevTableName, outputColumns: ctx.outputColumns };
  }
  
  // Build calc expressions
  const calcExprs = buildCalcExpressions(calcStages, colMap);
  
  if (calcExprs.length === 0) {
    return { outputTableName: prevTableName, outputColumns: ctx.outputColumns };
  }
  
  // Add calc columns via SELECT
  const calcSelects = calcExprs.map(c => `${c.sql} AS ${quoteId(c.alias)}`).join(', ');
  const outputTable = `_pipeline_stage_2`;
  
  const sql = `CREATE TEMP TABLE ${quoteId(outputTable)} AS SELECT *, ${calcSelects} FROM ${quoteId(prevTableName)}`;
  execQuery(sql);
  
  return {
    outputTableName: outputTable,
    outputColumns: [...ctx.outputColumns, ...calcExprs.map(c => c.alias)]
  };
}
```

### Stage 3: Filters

```typescript
function executeFilterStage(ctx: StageContext): StageResult {
  const { reportSpec, colMap, prevTableName } = ctx;
  const filters = reportSpec.filters || [];
  
  if (filters.length === 0) {
    return { outputTableName: prevTableName, outputColumns: ctx.outputColumns };
  }
  
  const { where, params } = buildWhere(filters, colMap);
  const outputTable = `_pipeline_stage_3`;
  
  const sql = `CREATE TEMP TABLE ${quoteId(outputTable)} AS SELECT * FROM ${quoteId(prevTableName)} WHERE ${where}`;
  execQuery(sql, params);
  
  return { outputTableName: outputTable, outputColumns: ctx.outputColumns };
}
```

### Stage 4: Sorts

```typescript
function executeSortStage(ctx: StageContext): StageResult {
  const { reportSpec, colMap, prevTableName } = ctx;
  const sorts = reportSpec.sorts || [];
  
  if (sorts.length === 0) {
    return { outputTableName: prevTableName, outputColumns: ctx.outputColumns };
  }
  
  const sortParts = sorts
    .filter(s => s.enabled !== false)
    .map(s => {
      const ref = resolveRef(s.col, colMap);
      return `${ref} ${s.dir === 'DESC' ? 'DESC' : 'ASC'}`;
    });
  
  const outputTable = `_pipeline_stage_4`;
  const sql = `CREATE TEMP TABLE ${quoteId(outputTable)} AS SELECT * FROM ${quoteId(prevTableName)} ORDER BY ${sortParts.join(', ')}`;
  
  execQuery(sql);
  
  return { outputTableName: outputTable, outputColumns: ctx.outputColumns };
}
```

### Stage 5: Aggregation (Mode-Dependent)

```typescript
function executeAggregationStage(ctx: StageContext): StageResult {
  const { reportSpec, prevTableName } = ctx;
  const aggMode = reportSpec.aggregation.mode || 'none';
  
  switch (aggMode) {
    case 'group':
      return executeGroupedAggregation(ctx);
    case 'totals':
      return executeTotalsAggregation(ctx);
    case 'subtotals':
      return executeSubtotalsAggregation(ctx);
    default:
      // Detail mode — no aggregation
      return { outputTableName: prevTableName, outputColumns: ctx.outputColumns };
  }
}

function executeGroupedAggregation(ctx: StageContext): StageResult {
  const { reportSpec, colMap, prevTableName } = ctx;
  const groupBy = reportSpec.aggregation.groupBy || [];
  const aggregates = reportSpec.aggregation.aggregates || [];
  
  const groupRefs = groupBy.map(a => resolveRef(a, colMap));
  const aggExprs = aggregates.map(agg => {
    const colRef = agg.col && agg.col !== '*' ? resolveRef(agg.col, colMap) : '*';
    const expr = renderAggregateExpr(agg.fn, colRef);
    return `${expr} AS ${quoteId(agg.alias)}`;
  });
  
  const outputTable = `_pipeline_stage_5`;
  const sql = `CREATE TEMP TABLE ${quoteId(outputTable)} AS SELECT ${groupRefs.join(', ')}, ${aggExprs.join(', ')} FROM ${quoteId(prevTableName)} GROUP BY ${groupRefs.join(', ')}`;
  
  execQuery(sql);
  
  return {
    outputTableName: outputTable,
    outputColumns: [...groupBy, ...aggregates.map(a => a.alias)]
  };
}

function executeTotalsAggregation(ctx: StageContext): StageResult {
  const { reportSpec, colMap, prevTableName } = ctx;
  const colTotals = reportSpec.aggregation.colTotals || {};
  
  // Build detail rows with _row_type = 0
  const detailExprs = ctx.outputColumns.map(col => {
    const ref = resolveRef(col, colMap);
    return `${ref} AS ${quoteId(col)}`;
  }).join(', ');
  
  // Build totals row with _row_type = 1
  const totalsExprs = ctx.outputColumns.map(col => {
    const fn = colTotals[col];
    if (!fn || fn === 'skip') {
      return `NULL AS ${quoteId(col)}`;
    }
    const ref = resolveRef(col, colMap);
    return `${renderAggregateExpr(fn, ref)} AS ${quoteId(col)}`;
  }).join(', ');
  
  const outputTable = `_pipeline_stage_5`;
  const sql = `CREATE TEMP TABLE ${quoteId(outputTable)} AS 
    SELECT ${detailExprs}, 0 AS _row_type FROM ${quoteId(prevTableName)}
    UNION ALL
    SELECT ${totalsExprs}, 1 AS _row_type FROM ${quoteId(prevTableName)}`;
  
  execQuery(sql);
  
  return {
    outputTableName: outputTable,
    outputColumns: [...ctx.outputColumns, '_row_type']
  };
}

function executeSubtotalsAggregation(ctx: StageContext): StageResult {
  // Similar to current sql-subtotals.ts but reads from prevTableName instead of base
  // UNION ALL of detail + subtotal branches + spacer + grand total
  // All with _row_type markers (0=detail, 1=subtotal, 2=spacer, 3=grand total)
  // Implementation follows current pattern, adapted for temp tables
  // ... (full implementation in actual code)
}
```

### Pipeline Engine

```typescript
export class PipelineEngine {
  private state: PipelineState = {
    validUpToStage: -1,
    tempTableNames: []
  };
  
  execute(reportSpec: ReportSpec, tables: Record<string, DbTable>): ResultSet {
    // Build catalogs
    const sourceCatalog = buildSourceCatalog(tables);
    const catalogCtx = {
      base: reportSpec.pipeline.base,
      baseCols: reportSpec.pipeline.baseCols,
      stacks: reportSpec.pipeline.stacks,
      lookups: reportSpec.pipeline.lookups,
      calcStages: reportSpec.pipeline.calculatedColumns,
      detailBands: reportSpec.pipeline.detailBands || []
    };
    const { colMap } = buildColumnCatalog(catalogCtx, sourceCatalog);
    
    // Execute stages sequentially
    const stages = [
      executeBaseStage,
      executeLookupStage,
      executeCalcStage,
      executeFilterStage,
      executeSortStage,
      executeAggregationStage
    ];
    
    let prevTableName = '';
    let outputColumns: string[] = [];
    
    for (let i = 0; i < stages.length; i++) {
      if (i <= this.state.validUpToStage) {
        // Stage is valid — reuse existing temp table
        prevTableName = this.state.tempTableNames[i];
        continue;
      }
      
      // Execute stage
      const ctx: StageContext = {
        reportSpec,
        tables,
        colMap,
        sourceCatalog,
        prevTableName,
        stageIndex: i,
        outputColumns
      };
      
      const result = stages[i](ctx);
      prevTableName = result.outputTableName;
      outputColumns = result.outputColumns;
      
      // Track new temp table
      this.state.tempTableNames[i] = prevTableName;
      this.state.validUpToStage = i;
    }
    
    // Fetch final results
    const finalTable = this.state.tempTableNames[5];
    const rows = execQuery(`SELECT * FROM ${quoteId(finalTable)}`);
    
    return buildResultSet(outputColumns, rows, {
      aggMode: reportSpec.aggregation.mode || 'none'
    });
  }
  
  invalidateFromStage(stageIndex: number): void {
    // DROP all temp tables from stageIndex+1 onward
    for (let i = stageIndex + 1; i < this.state.tempTableNames.length; i++) {
      const tableName = this.state.tempTableNames[i];
      if (tableName) {
        execQuery(`DROP TABLE IF EXISTS ${quoteId(tableName)}`);
      }
    }
    this.state.validUpToStage = Math.min(this.state.validUpToStage, stageIndex);
  }
  
  cleanup(): void {
    // DROP all pipeline temp tables
    for (const tableName of this.state.tempTableNames) {
      if (tableName) {
        execQuery(`DROP TABLE IF EXISTS ${quoteId(tableName)}`);
      }
    }
    this.state = { validUpToStage: -1, tempTableNames: [] };
  }
}
```

### Preview System

Replace `preview-builder.ts` with direct SELECT from the appropriate temp table:

```typescript
export function buildPreview(key: string, pipelineState: PipelineState): PreviewResult {
  try {
    // Map stage key to temp table
    const stageMap: Record<string, number> = {
      'base': 0,
      'lk0': 1, 'lk1': 1, 'lk2': 1,  // All lookups → stage 1
      'calc0': 2, 'calc1': 2, 'calc2': 2,  // All calcs → stage 2
      // ... etc
    };
    
    const stageIndex = stageMap[key];
    if (stageIndex === undefined || stageIndex > pipelineState.validUpToStage) {
      return { headers: [], rows: [], error: 'Stage not yet executed' };
    }
    
    const tableName = pipelineState.tempTableNames[stageIndex];
    const rows = execQuery(`SELECT * FROM ${quoteId(tableName)} LIMIT 5`);
    
    // Build headers from temp table schema
    const headers = Object.keys(rows[0] || {});
    
    return { headers, rows, error: null };
  } catch (ex) {
    return { headers: [], rows: [], error: (ex as Error).message };
  }
}
```

**Benefits:**
- No duplicate catalog-building logic
- No need to rebuild ReportSpec or call buildQueryPlan
- Just SELECT from the temp table — trivially cheap
- Shows actual intermediate results, not re-simulated results

### Source Column Support

When `reportSpec.pipeline.includeSourceColumn` is true, the base stage adds a source column with a literal value in each UNION ALL branch:

```typescript
// In executeBaseStage:
const alias = reportSpec.pipeline.stackAliases?.[tid] ?? table.name;
const sourceCol = reportSpec.pipeline.includeSourceColumn
  ? `, ${JSON.stringify(alias)} AS ${quoteId(reportSpec.pipeline.sourceColumnName || 'Source Sheet')}`
  : '';
```

**Stack Aliases**: Users can alias stacked sheet names for display:

```typescript
interface ReportSpec {
  pipeline: {
    // ...
    includeSourceColumn?: boolean;  // default: false
    sourceColumnName?: string;      // default: "Source Sheet"
    stackAliases?: Record<string, string>;  // tableId → display name, default: table name
  };
}
```

UI: Add a text input next to each stack in `stack-sheets.tsx` for the alias. The base sheet also gets an alias (defaults to its table name).

### Validation Integration

Validation currently predicts what the composed query would produce. With temp tables, it can read actual schemas:

```typescript
export function deriveValidation(
  state: AppState,
  pipelineState: PipelineState,
  // ... other params
): ValidationResult {
  // Instead of predicting column availability from colMap,
  // read actual temp table schemas
  
  const stage0Cols = getTempTableColumns('_pipeline_stage_0');
  const stage1Cols = getTempTableColumns('_pipeline_stage_1');
  // ... etc
  
  // Validate that filters reference columns that exist in stage 3
  // Validate that sorts reference columns that exist in stage 4
  // ...
}

function getTempTableColumns(tableName: string): string[] {
  try {
    const result = execQuery(`PRAGMA table_info(${quoteId(tableName)})`);
    return result.map(row => row.name as string);
  } catch {
    return [];
  }
}
```

**Benefits:**
- No more predicting what the composed query would produce
- Validation reads actual schemas — always accurate
- Simpler validation logic

### Detail Bands Integration

Detail bands already have a separate execution path (`runDetailBandsMode` in `engine.ts`). They do multi-query execution + JS stitching and don't use the SQL generators being replaced.

**Decision**: Detail bands stay as-is and are NOT refactored into the temp-table pipeline in this feature.

**Integration point**: The band execution path reads from the pipeline's final output table (`_pipeline_stage_4` for detail mode, before aggregation) instead of executing its own parent query. This is a clean boundary — the band logic remains separate but consumes pipeline output.

```typescript
// In runDetailBandsMode:
// Instead of: const parentRows = execQuery(plan.sql, plan.params);
// Use: const parentRows = execQuery(`SELECT * FROM ${quoteId(pipelineState.tempTableNames[4])}`);
```

## Design Goals

1. **Fix the stacks bug** — Stacks must be included in full report execution, not just preview. The temp-table pipeline naturally handles stacks as UNION ALL in stage 0.

2. **Eliminate preview duplication** — Preview should be a simple SELECT from the appropriate temp table, not a duplicate of catalog-building and query-construction logic.

3. **Simplify feature addition** — Adding a "source sheet" column should require changes in one place (the base stage), not threading through four SQL generators plus catalog plus validation.

4. **Reduce SQL generator maintenance** — Replace four SQL generators (detail, grouped, totals, subtotals) with independent stage functions. Each stage is simple and testable.

5. **Enable debugging** — Users and developers can inspect any intermediate temp table to see what the data looks like at that stage. No more opaque composed SQL.

6. **Preserve performance** — At spreadsheet data scales (tens of thousands of rows, 20-30 columns), the overhead of multiple temp tables is negligible. Each temp table is a few MB; five stages = ~20-30 MB peak memory.

7. **Maintain backward compatibility** — Existing `.rcjson` save files must load correctly. Existing report configurations must produce the same outputs. New features (source column, stack aliases) are additive.

8. **Respect five-layer architecture** — Pipeline engine and stage functions live in the Report layer. They import from Query and Catalog layers. No upward imports.

## Constraints

1. **Five-layer architecture** — Pipeline engine lives in Report layer. Stage functions are Report layer. They import from Query layer (buildWhere, buildCalcExpressions, resolveRef, renderAggregateExpr) and Catalog layer (buildColumnCatalog, buildSourceCatalog). No upward imports (Report → UI forbidden).

2. **SQL identifiers use quoteId()** — All temp table names, column names, and SQL fragments use `quoteId()` from `sqldb.ts`. Never concatenate identifiers directly.

3. **Source tables are immutable** — ADR-001. Temp tables are derived, not source mutations. No INSERT/UPDATE/DELETE on source tables.

4. **sql.js is the sole query engine** — ADR-003/005. All SQL execution goes through `execQuery()` in `sqldb.ts`. Temp tables use SQLite TEMP TABLE syntax.

5. **Data value fidelity** — ASR-0001. Temp tables must preserve original values. No silent type coercion during CREATE TABLE AS SELECT.

6. **Synchronous execution** — All SQL execution is synchronous. No async/await in the pipeline path. This may cause UI jank for large datasets — future work could move pipeline execution to a Web Worker.

7. **Backward compatibility** — Existing `.rcjson` save files must load correctly. New fields (`includeSourceColumn`, `sourceColumnName`, `stackAliases`) are optional with safe defaults.

8. **No breaking changes to ReportSpec** — Existing fields remain. New fields are additive. Old reports without `includeSourceColumn` work as before.

9. **Validation cache invalidation** — After pipeline execution, call `invalidateValidation()` so validation recomputes against new temp table schemas.

10. **No `dangerouslySetInnerHTML`** — All UI rendering uses React JSX. No string HTML builders.

11. **window/document access guarded** — All DOM access guarded with `typeof window !== 'undefined'` / `typeof document !== 'undefined'`.

12. **Vendored CJS modules** — Use `// @ts-expect-error - vendored CJS module` before `import()` of files in `js/wasm/` and `js/vendor/`.

13. **State changes call invalidateValidation()** — After modifying db state (creating/dropping temp tables), call `invalidateValidation()` or validation stays stale.

14. **Mandatory checks** — After any code change, run `npm run typecheck` (zero errors), `npm run lint` (zero warnings), `npm test` (all pass).

## Key Decisions

### 1. Pipeline Invalidation Strategy

**Decision**: Invalidate self and all downstream stages on any state change.

**Rationale**: Simple, correct, cheap at spreadsheet data scales. The pipeline re-executes quickly (tens of thousands of rows, not millions). Precise dependency tracking would add complexity without meaningful performance gain. If optimization is needed later, it can be added without changing the API.

### 2. Totals Mode Implementation

**Decision**: Produce a single temp table with a `_row_type` marker column (same pattern as subtotals). Detail rows get `_row_type = 0`, the totals row gets `_row_type = 1`.

**Rationale**: The result set builder already handles `_row_type` markers from subtotals mode — totals uses the same mechanism. No JS-side combination of separate tables. This is simpler and more consistent than the current approach of creating two temp tables and combining in JS.

### 3. Source Column Implementation

**Decision**: Use a literal in the SELECT clause of each UNION ALL branch.

**Rationale**: SQLite doesn't guarantee UNION ALL row ordering in temp tables. The ALTER TABLE + UPDATE approach using _rowno would be unreliable. The literal approach is one pass, no additional queries, and guaranteed correct. Each branch uses `stackAliases[tid] ?? tableName` as the literal value.

### 4. Stack Aliases Storage

**Decision**: Store `stackAliases` in `ReportSpec.pipeline` (per-report), not in `AppState` (global).

**Rationale**: Aliases are report-specific configuration, not global state. Different reports may want different display names for the same stacked sheet. This follows the existing pattern where all pipeline configuration lives in `ReportSpec.pipeline`.

### 5. Pipeline State Ownership

**Decision**: Pipeline state (tracking valid stages and temp table names) lives in the Report layer as module-level state, like the validation cache. It is transient runtime data, not user configuration, and should not be serialized to `.rcjson` files.

**Rationale**: Pipeline state is derived from the report configuration and source tables. It's recreated on every report execution. Serializing it would bloat save files with transient data that's invalid after reload (temp tables don't persist across sessions).

### 6. buildQueryPlan Evolution

**Decision**: Refactor `buildQueryPlan()` into a config-builder used by the pipeline engine. It returns stage configs (source plan, join plans, calc expressions, filters, sorts, aggregation config) instead of composed SQL. The pipeline engine uses these configs to execute stages.

**Rationale**: The catalog-building and validation logic in `buildQueryPlan()` is still needed. Throwing it away and duplicating it in the pipeline engine would be wasteful. Refactoring it to return configs preserves the work and gives the pipeline engine the information it needs.

### 7. Detail Bands Boundary

**Decision**: Detail bands stay as-is and are NOT refactored into the temp-table pipeline. They read from the pipeline's final output table instead of executing their own parent query.

**Rationale**: Detail bands already have a separate execution path that works. They do multi-query execution + JS stitching, which is fundamentally different from the pipeline's single-query-per-stage approach. Refactoring them in the same PR as the pipeline overhaul increases risk without clear benefit. The clean boundary is: pipeline produces parent rows, bands consume them.

## Migration Strategy

### Phase 1: Foundation (No Behavior Change)

1. Add new fields to `ReportSpec.pipeline` and `AppState`: `includeSourceColumn`, `sourceColumnName`, `stackAliases`
2. Update `state-serializer.ts` and `state-hydrator.ts` to handle new fields
3. Create `pipeline-engine.ts` and `pipeline-stages/` directory with stage modules
4. Add unit tests for each stage function

**Validation**: Existing tests pass. New tests verify stage functions produce correct SQL.

### Phase 2: Pipeline Engine Integration

1. Implement `PipelineEngine` class with `execute()`, `invalidateFromStage()`, `cleanup()`
2. Refactor `buildQueryPlan()` to return stage configs instead of composed SQL
3. Update `runReport()` to use `PipelineEngine` instead of `buildQueryPlan()` + mode dispatch
4. Update `preview-builder.ts` to SELECT from temp tables
5. Update `validation.ts` to read temp table schemas

**Validation**: All existing tests pass. Manual testing verifies reports produce identical output.

### Phase 3: Delete Old Code

1. Delete `sql-detail.ts`, `sql-grouped.ts`, `sql-totals.ts`, `sql-subtotals.ts`
2. Remove dead code from `query-plan.ts` (SQL generation logic)
3. Remove dead code from `preview-builder.ts` (catalog-building logic)
4. Remove dead code from `validation.ts` (colMap-based prediction logic)

**Validation**: `npm run typecheck` passes (no references to deleted modules). `npm test` passes. Manual testing verifies no regressions.

### Phase 4: UI for New Features

1. Add checkbox for `includeSourceColumn` in `pipeline-card.tsx`
2. Add text input for `sourceColumnName` (shown when checkbox is checked)
3. Add text input for stack aliases in `stack-sheets.tsx` (next to each stack)
4. Add integration tests for new UI elements

**Validation**: Manual testing verifies new features work. Existing reports load without new fields (safe defaults).

## Related Documents

- [DD-preact-rebuild-architecture](artifacts/designs/completed/DD-preact-rebuild-architecture.md) — Original architecture design that produced the current compiled-query approach. Plans B (Catalog + Query) and C (Report Engine) defined the current architecture.
- [DD-column-type-aware-where](artifacts/designs/completed/DD-dd-column-type-aware-where.md) — Column type awareness for filter SQL generation. Shows the pattern for extending SQL generators with new column metadata.
- [DD-pipeline-preview](artifacts/designs/pending/DD-pipeline-preview.md) — Preview system design. Superseded by this DD's preview section. Shows the current stage-by-stage query decomposition approach.
- [DD-subreport-detail-rows](artifacts/designs/completed/subreport-detail-rows/) — Detail bands design. Already uses multi-query execution + JS stitching. Shows the pattern for combining multiple query results.
- [ADR-001-local-only-data-storage](artifacts/decisions/ADR-001-local-only-data-storage.md) — Source tables are immutable. Temp tables are derived, not source mutations.
- [ADR-003-wasm-sqlite-query-engine](artifacts/decisions/ADR-003-wasm-sqlite-query-engine.md) — sql.js is the sole query engine. Temp tables still use sql.js.
- [ADR-002-five-layer-architecture](artifacts/decisions/ADR-002-five-layer-architecture.md) — Five-layer architecture with defined ownership boundaries. Pipeline engine lives in Report layer.
- [ASR-0001-data-value-fidelity](artifacts/requirements/ASR-0001-data-value-fidelity.md) — No silent type coercion, no source table mutations. Temp tables must preserve original values.

## Appendix: Research Findings

### Current Architecture Analysis

**runReport() flow (engine.ts:332-355):**
- Entry point: `runReport(reportSpec, tables)` → `buildQueryPlan()` → mode dispatch
- Mode dispatch: detail, totals, subtotals, group, detail bands
- All SQL execution goes through `execQuery()` in sqldb.ts

**buildQueryPlan() flow (query-plan.ts:133-282):**
- Builds source catalog → column catalog → source plan → join plans → calc expressions → filters → selected columns → sorts → dispatch to query builder
- Returns `BuiltQueryPlan` with sql, params, cols, plus all intermediate data
- **Does NOT handle stacks** — the FROM clause is always `quoteId(reportSpec.pipeline.base)` (a single table)

**The Stacks Gap:**
- All four SQL generators (`sql-detail.ts:97`, `sql-grouped.ts:140`, `sql-totals.ts:102`, `sql-subtotals.ts:134`) use `FROM quoteId(reportSpec.pipeline.base)` — single table, no UNION ALL
- Only `preview-builder.ts:201-235` handles stacks with manual UNION ALL
- This means **full report execution NEVER includes stacked rows** — critical bug

**Totals mode code smell (engine.ts:51-101):**
- `runTotalsMode()` rebuilds source catalog, column catalog, and calc expressions from scratch (lines 59-76)
- Even though `buildQueryPlan()` already computed them
- The `BuiltQueryPlan` doesn't expose intermediate catalogs
- A temp-table pipeline could share intermediate state between stages

**Detail bands execution (engine.ts:192-297):**
- Separate from main query flow
- Parent query runs first (same as detail mode)
- Then for each band: extract parent key values → `buildBandQuery()` → `execQuery()` → tag with `_band_id`
- Results stitched in JS via `BandResultSet`
- `_band_id` is the precedent for injecting literal columns

### Preview Builder Analysis (preview-builder.ts, 365 lines)

- Duplicates catalog-building logic (`buildColSourceMapForState` — pure variant, lines 90-172)
- For each stage, calls `buildQueryPlan()` independently — recomputes everything
- Base preview manually builds UNION ALL across base + stacks (lines 201-235)
- Lookup/calc previews build a full ReportSpec with sliced pipeline, run through buildQueryPlan
- Band preview is simple `SELECT * FROM child_table LIMIT 5`

### Column Catalog Analysis (column-catalog.ts, 396 lines)

- Two APIs: store-based (`buildColSourceMap`) and catalog-based (`buildColumnCatalog`)
- Maps aliases → physical sources (tid + col), calc sources, or band sources
- `ColMapEntry` union type: `PhysicalColEntry | CalcColEntry | BandColEntry`
- Lookup column prefixing via `tablePrefix()` for collision avoidance
- Band columns prefixed with `_{bandId}_` and tagged `kind: 'band'`
- **Still needed** for column resolution during pipeline construction

### SQL Generators Analysis

**sql-detail.ts (132 lines):**
- SELECT + FROM base + JOINs + WHERE + ORDER BY
- FROM clause: `quoteId(reportSpec.pipeline.base)` — single table
- No stack handling

**sql-grouped.ts (177 lines):**
- SELECT group cols + aggregates + FROM base + JOINs + WHERE + GROUP BY + ORDER BY
- FROM clause: `quoteId(reportSpec.pipeline.base)` — single table
- No stack handling

**sql-totals.ts (121 lines):**
- SELECT aggregates per col + FROM base + JOINs + WHERE → single row
- FROM clause: `quoteId(reportSpec.pipeline.base)` — single table
- No stack handling

**sql-subtotals.ts (267 lines):**
- UNION ALL of detail + subtotal branches + spacer + grand total
- Internal marker columns (_row_type, _sort_row_type, _sort_group_N)
- FROM clause: `quoteId(reportSpec.pipeline.base)` — single table
- No stack handling

### SQLite TEMP TABLE Support

- sql.js supports all SQLite TEMP TABLE syntax
- No existing usage in the codebase, but fully supported
- TEMP tables auto-cleanup on connection close
- For pipeline invalidation, need explicit DROP

### State Serialization Analysis

**buildPayload() (state-serializer.ts:25-90):**
- Serializes all state fields to plain object
- Handles Set→array conversion for selCols and excludedRows
- Adding new fields requires updating this function

**hydrateState() (state-hydrator.ts:29-398):**
- Takes raw JSON payload + loaded tables
- Produces hydrated state + broken reference warnings
- Adding new fields requires updating this function

### ADR Constraints

- **ADR-001**: Source tables are immutable — temp tables are derived, not source mutations ✓
- **ADR-003/005**: sql.js is the sole query engine — temp tables still use sql.js ✓
- **ADR-002/004**: Five-layer architecture — temp table creation blurs Query/Report boundary
- **ADR-006**: Monolithic state store — pipeline state must work within single-state-object
- **ASR-0001**: Data value fidelity — temp tables must preserve original values

### What Was Investigated and Rejected

- **Keeping the compiled-query approach and fixing stacks**: Rejected because it requires threading UNION ALL through all four SQL generators, plus catalog, plus validation. The temp-table approach is simpler and more maintainable.
- **Using regular tables instead of TEMP tables**: Rejected because TEMP tables auto-cleanup on connection close and are semantically clearer (they're transient, not persistent).
- **Integrating detail bands into the pipeline**: Rejected because bands already work with a separate execution path. Refactoring them in the same PR as the pipeline overhaul increases risk.
- **Replacing the column catalog with temp table schemas**: Rejected because the column catalog is still needed for column resolution during pipeline construction. Temp table schemas can supplement it for validation, but not replace it.
- **ALTER TABLE + UPDATE for source column**: Rejected because SQLite doesn't guarantee UNION ALL row ordering in temp tables. The literal-in-SELECT approach is correct and simpler.
- **Phased migration (v1/v2)**: Rejected because partial implementation creates maintenance burden and confusion. Full replacement in one PR is cleaner.
