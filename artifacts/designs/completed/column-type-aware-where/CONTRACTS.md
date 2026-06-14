# Column-Type-Aware SQL WHERE — Contracts Ledger

**Design doc:** `artifacts/designs/pending/DD-dd-column-type-aware-where.md`
**Last updated:** 2026-06-14 (ALL PLANS EXECUTED)

---

## Architectural Rules

- Five-layer architecture: Core → Catalog → Query → Report → UI. No upward imports (UI → Query forbidden)
- `buildWhere` API must stay exactly `buildWhere(filters: FilterSpec[], colMap: Map<string, ColMapEntry>): WhereResult` — 2 params, no placeholders
- SQL identifiers must use `quoteId()` from `sqldb.ts` — never concatenate raw strings into SQL
- State changes that affect query results must call `invalidateValidation()`
- All values stored as strings in SQLite via `coerceForSQL()` (foundation change)
- `_ROWNO` goes through normal `coerceForSQL()` path — special-cased only in `getColumnType()` as `'number'`
- Calc column `mode: 'compare'` treated as `'string'` type (heterogeneous return type)
- No STATE_VERSION bump for `columnTypeOverrides` — field is optional with safe default `{}`

---

## Types & Interfaces (foundations plan — ✅ EXECUTED)

### `ColumnType` (Plan foundations — `types.ts`)

```typescript
export type ColumnType = 'string' | 'number' | 'date' | 'boolean';
```

### `DbTable.colTypes` (Plan foundations — `types.ts`)

```typescript
export interface DbTable {
  // ... existing fields
  colTypes?: Record<string, ColumnType>;
}
```

### `AppState.columnTypeOverrides` (Plan foundations — `types.ts`)

```typescript
export interface AppState {
  // ... existing fields
  columnTypeOverrides: Record<string, Record<string, ColumnType>>;
}
```

### `XLSXSheet.!data` (Plan foundations — `globals.d.ts`)

```typescript
interface XLSXSheet {
  '!data'?: unknown[][];
}
```

### `coerceForSQL` (Plan foundations — `sqldb.ts`)

- **Signature:** `(v: unknown) -> string | null`
- **Behavior:** All values stringified. Numbers → `String(v)`, Booleans → `'1'`/`'0'`, Dates → ISO string, null → null, numeric strings stay as strings.

---

## Decisions Made

| Decision | Rationale | Plan |
| --- | --- | --- |
| Store all values as strings in SQLite | Decouples storage from type decisions — no ALTER TABLE when types change | foundation |
| Capture XLSX cell types at import time via cell.t/cell.z | Authoritative metadata at near-zero cost — don't reconstruct discarded info | foundation |
| Default CSV columns to 'string' | CSV has no cell type metadata | foundation |
| User override via columnTypeOverrides | Metadata write, not data migration | foundation |
| `_ROWNO` stored as string, special-cased in getColumnType | Simplicity wins — CAST at query time handles conversion back to number | foundation |
| No STATE_VERSION bump for columnTypeOverrides | Field is optional with safe default `{}` — backward compatible | foundation |
| Flat context menu items (no submenu) for type change | "Fewer clicks, better clicks" per user decision | foundation |
| CSV imports store `colTypes` with all `'string'` values — redundant since `getColumnType()` defaults to `'string'`, but harmless. The conditional spread only excludes truly empty colTypes (non-dense or header-only sheets) | CSV cells are all `'s'` type — `scanCellTypes` returns a non-empty record of all-string values, which passes the `Object.keys(colTypes).length` check and is stored. Functionally equivalent to omitting it | Plan A |
| `scanCellTypes` exported for testability | Pure function with no side effects — exporting enables direct unit tests without going through `ingestSheet()` | Plan A |
| `_rowno` excluded from `colTypes` by header name check | `_rowno` is synthetic (added after `sheet_to_json`), has no XLSX cell origin, special-cased in `getColumnType()` as `'number'` | Plan A |
| `colType` only set when defined (conditional spread) | Preserves backward compatibility — existing tests with `toEqual` assertions pass unchanged when no colTypes metadata exists | Plan B |
| `buildColumnCatalog` gets optional `options` parameter for overrides | Keeps function pure (no store access) while allowing callers to pass `columnTypeOverrides` from AppState. Backward compatible — existing 2-arg callers unaffected | Plan B |
| `isNumericCalc()` removed entirely, replaced by `getColumnType()` | `isNumericCalc` only covered calc+math — too narrow. `getColumnType` covers all column types from colMap metadata + calc mode derivation | Plan C |
| `ColStateEntry` and `_colState` param removed as dead code | Never used by any caller. Design doc forbids reintroducing placeholder parameters. `buildWhere` cleaned to exactly 2 params | Plan C |
| Comparison operators default to TEXT cast (not REAL) | Fixes the leading-zero bug — zip codes, phone numbers, employee IDs need lexicographic comparison. Only number/boolean columns use REAL | Plan C |
| String columns use raw ref (no CAST) for IN/NOT IN | Same as pre-existing non-numeric behavior. TEXT cast unnecessary for equality set membership on string values | Plan C |
| Date columns use CAST AS TEXT for all operators | ISO 8601 strings sort lexicographically correct — no need for julianday in v1 | Plan C |
| `CtxMenuItem.checked` for checkmark rendering (not CSS classes or separate components) | Minimal interface extension — existing callers unaffected, ✓ character inline is consistent with label-based approach | Plan E |
| Right-click on "⋯" button opens type menu; left-click still opens rename | Preserves existing rename UX — contextmenu event on the same button, click handler unchanged | Plan E |
| Context menu state managed via useState in PreviewGrid/ResultGrid (not module-level or DOM-only) | Follows established pattern from base-stage.tsx, column-chips.tsx — ContextMenu component uses portals + hooks, must be rendered from Preact component tree | Plan E |
| Calc columns excluded from type-change menu | Their type is derived from `mode` at query time (Part C `getColumnType()`) — not user-overridable by design | Plan E |
| `_rowno` excluded from type-change menu | Synthetic column, always numeric per design doc point 6 | Plan E |

---

## Collections & Methods (Plan A — ✅ EXECUTED)

### `scanCellTypes` (Plan A — `ui/loader.ts`)

- **Signature:** `(ws: XLSXSheet) -> Record<string, ColumnType>`
- **Exported:** Yes (for testability)
- **Behavior:** Reads dense worksheet array (`ws['!data']` or `Array.isArray(ws)`). Counts `cell.t` per column across data rows (r >= 1). Majority vote determines column type. For majority-`'n'` columns, applies date-format override if >50% of numeric cells have date-like `cell.z` patterns. Skips `_rowno` column. Returns empty object for non-dense sheets.
- **Cell type mapping:** `'n'` → `'number'`, `'s'` → `'string'`, `'d'` → `'date'`, `'b'` → `'boolean'`, default → `'string'`
- **Skipped cells:** `t === 'z'` (stub), `v == null` (empty), `t === 'e'` (error)
- **Date format detection:** `isDateFormat(z)` returns true if `z.toLowerCase()` matches `/yyyy|yy|mm|dd|hh|ss/`
- **Calls:** None (pure function, no side effects)

### `isDateFormat` (Plan A — `ui/loader.ts`, internal)

- **Signature:** `(z: string) -> boolean`
- **Behavior:** Returns true if format string contains date patterns (yyyy, yy, mm, dd, hh, ss — case-insensitive)

### `sheetTypeToColumnType` (Plan A — `ui/loader.ts`, internal)

- **Signature:** `(t: string) -> ColumnType`
- **Behavior:** Maps SheetJS cell.t codes to ColumnType: `'n'`→`'number'`, `'s'`→`'string'`, `'d'`→`'date'`, `'b'`→`'boolean'`, default→`'string'`

### Ingestion Integration (Plan A — `ui/loader.ts`)

- `ingestSheet()` calls `scanCellTypes(ws)` after `expandMerges(ws)` (line 215)
- Result stored on `DbTable.colTypes` via conditional spread: only included if non-empty (CSV imports store all-'string' colTypes — redundant since `getColumnType()` defaults to `'string'`, but harmless)
- `store.update()` at line 290 now includes `colTypes` when present

---

## Catalog Layer (Plan B — ✅ EXECUTED)

### `PhysicalColEntry.colType` (Plan B — `catalog/column-catalog.ts`)

```typescript
export interface PhysicalColEntry {
  kind?: undefined;
  tid: string;
  col: string;
  colType?: ColumnType;  // NEW — from DbTable.colTypes or columnTypeOverrides
}
```

### `BandColEntry.colType` (Plan B — `catalog/column-catalog.ts`)

```typescript
export interface BandColEntry {
  kind: 'band';
  tid: string;
  col: string;
  colType?: ColumnType;  // NEW — from DbTable.colTypes or columnTypeOverrides
}
```

### `buildColSourceMap` colType propagation (Plan B — `catalog/column-catalog.ts`)

- **Behavior:** For each physical/lookup column, resolves `colType` as `state.columnTypeOverrides?.[tid]?.[col] ?? state.tables[tid]?.colTypes?.[col]`. Field is only set when a value is defined (conditional spread) — entries without type metadata remain unchanged.
- **Calc columns:** No `colType` field — type derived from `mode` at query time

### `buildColumnCatalog` colType propagation (Plan B — `catalog/column-catalog.ts`)

- **Signature change:** `(reportSpec, sourceCatalog, options?)` — optional third parameter `{ columnTypeOverrides?: Record<string, Record<string, ColumnType>> }`
- **Behavior:** For each base/lookup/band column, resolves `colType` as `options?.columnTypeOverrides?.[tid]?.[col] ?? sourceCatalog.get(tid)?.source?.colTypes?.[col]`. Field only set when defined.
- **Backward compatible:** Existing 2-arg callers work unchanged — no options means no overrides, colType only from source catalog
- **Calc columns:** No `colType` field — unchanged

### `resolveColType` (Plan B — `catalog/column-catalog.ts`, internal)

- **Signature:** `(tid: string, col: string) -> ColumnType | undefined`
- **Scope:** Local helper inside `buildColSourceMap()`
- **Behavior:** Returns `state.columnTypeOverrides?.[tid]?.[col] ?? state.tables[tid]?.colTypes?.[col]`

### `resolveCatalogColType` (Plan B — `catalog/column-catalog.ts`, internal)

- **Signature:** `(tid: string, col: string) -> ColumnType | undefined`
- **Scope:** Local helper inside `buildColumnCatalog()`
- **Behavior:** Returns `options?.columnTypeOverrides?.[tid]?.[col] ?? sourceCatalog.get(tid)?.source?.colTypes?.[col]`

---

## Persistence Layer (Plan D — ✅ EXECUTED)

### `buildPayload` columnTypeOverrides serialization (Plan D — `core/state-serializer.ts`)

- **Behavior:** Adds `columnTypeOverrides` to the payload return object. Deep-cloned via `JSON.parse(JSON.stringify(state.columnTypeOverrides || {}))` to prevent reference sharing.
- **Default:** Empty object `{}` when state has no overrides
- **Position:** After `detailBandMode` in the return object

### `hydrateState` columnTypeOverrides hydration (Plan D — `core/state-hydrator.ts`)

- **Behavior:** Reads `payload.columnTypeOverrides`. If it is a non-null object, deep-clones inner records into `next.columnTypeOverrides`. If absent, null, or non-object, defaults to `{}`.
- **Default:** `{}` (safe backward-compatible default for old .rcjson files)
- **Position:** After detail band mode block, before return statement
- **No reference validation:** Keys are table/column names — no brokenRefs generated for unknown tables (overrides are inert until the table is loaded)

### `state-schema.ts` — No changes (Plan D)

- `STATE_VERSION` stays at 2
- `columnTypeOverrides` NOT added to `RECOGNIZABLE_KEYS` (optional user config, not required for recognition)
- Rationale: Field is optional with safe default `{}` — backward compatible without version bump

---

## Query Layer (Plan C — ✅ EXECUTED)

### `getColumnType` (Plan C — `query/sql-where.ts`, internal)

- **Signature:** `(alias: string, colMap: Map<string, ColMapEntry>) -> ColumnType`
- **Exported:** No (internal helper)
- **Behavior:** Derives `ColumnType` for a column alias from the colMap. Rules in priority order: (1) `_rowno`/`_ROWNO` → `'number'`; (2) alias not in colMap → `'string'`; (3) `entry.kind === 'calc'` → derive from mode: `'math'` → `'number'`, `'date'` → `'date'`, `'text'`/`'compare'`/unknown → `'string'`; (4) physical/band entry → return `entry.colType ?? 'string'`.
- **Calls:** None (pure lookup + derivation)

### `renderClause` signature change (Plan C — `query/sql-where.ts`)

- **Old signature:** `(op, txt, num, val, params, numericHint: boolean, alias, colMap) -> string | null`
- **New signature:** `(op, txt, num, val, params, colType: ColumnType, alias, colMap) -> string | null`
- **Behavior change:** `numericHint: boolean` replaced by `colType: ColumnType`. All operator cases use `colType` to select CAST expression:
  - `=` / `!=`: `CAST(ref AS REAL)` for `'number'`/`'boolean'` (with numeric param), `CAST(ref AS TEXT)` for `'string'`/`'date'` (with string param)
  - `>` / `<` / `>=` / `<=`: `CAST(ref AS REAL)` for `'number'`/`'boolean'`, `CAST(ref AS TEXT)` for `'string'`/`'date'`/default
  - `IN` / `NOT IN`: `CAST(ref AS REAL) IN (...)` for `'number'`/`'boolean'`, `CAST(ref AS TEXT) IN (...)` for `'date'`, raw `ref IN (...)` for `'string'`
  - `contains` / `starts_with` / `ends_with`: always `CAST(ref AS TEXT) LIKE ?` (unchanged)
  - `is_null` / `is_not_null`: always `CAST(ref AS TEXT)` (unchanged)

### `buildWhere` signature change (Plan C — `query/sql-where.ts`)

- **Old signature:** `buildWhere(filters: FilterSpec[], colMap: Map<string, ColMapEntry>, _colState?: Record<string, ColStateEntry> | null) -> WhereResult`
- **New signature:** `buildWhere(filters: FilterSpec[], colMap: Map<string, ColMapEntry>) -> WhereResult`
- **Change:** Removed dead `_colState` parameter. All 4 callers (sql-detail.ts:105, sql-grouped.ts:148, sql-totals.ts:110, sql-subtotals.ts:140) already pass exactly 2 args — no caller changes needed.

### `ColStateEntry` removal (Plan C — `query/sql-where.ts`, `index.ts`)

- **Removed from:** `sql-where.ts` (interface definition, lines 26-30), `index.ts` (type export, line 33)
- **Rationale:** Dead code from Preact conversion. Never used by any caller. Design doc explicitly says "Do NOT reintroduce ColStateEntry or any placeholder parameter."

### `columnRefs` — unchanged (Plan C)

- **Signature:** `(alias: string, colMap: Map<string, ColMapEntry>) -> { txt: string; num: string }`
- **Status:** Retained as-is. `renderClause()` selects between `txt` and `num` based on `colType` instead of `numericHint`.

---

## UI Layer (Plan E — ✅ EXECUTED)

### `CtxMenuItem.checked` (Plan E — `ui/components/context-menu.tsx`)

```typescript
export interface CtxMenuItem {
  label: string;
  action: () => void;
  checked?: boolean;  // NEW — renders ✓ indicator when true
}
```

### `_makeHeaderComponent` signature change (Plan E — `ui/grid.tsx`)

- **Old signature:** `(label, color, renamed, origCol, onRename, onClear) -> unknown`
- **New signature:** `(label, color, renamed, origCol, onRename, onClear, onContextMenu: ((e: MouseEvent) => void) | null) -> unknown`
- **Behavior:** Added `onContextMenu` parameter (7th position, default `null`). When provided, the "⋯" button listens for `contextmenu` events (right-click) in addition to `click` events (left-click for rename). Right-click triggers `onContextMenu(e)` instead of opening the rename modal.

### `makePreviewCols` signature change (Plan E — `ui/grid.tsx`)

- **Old signature:** `(tid, physCols, onRenameDone?) -> Record<string, unknown>[]`
- **New signature:** `(tid, physCols, onRenameDone?, onTypeContextMenu?) -> Record<string, unknown>[]`
- **`onTypeContextMenu`:** `((e: MouseEvent, tid: string, col: string) => void) | null` — optional callback for type-change context menu
- **Behavior:** Passes `onContextMenu` to `_makeHeaderComponent` for each column, wrapping `onTypeContextMenu` with `(tid, col)` context

### `makeResultCols` signature change (Plan E — `ui/grid.tsx`)

- **Old signature:** `(cols, onRenameDone?) -> Record<string, unknown>[]`
- **New signature:** `(cols, onRenameDone?, onTypeContextMenu?) -> Record<string, unknown>[]`
- **`onTypeContextMenu`:** `((e: MouseEvent, tid: string, col: string) => void) | null` — optional callback
- **Behavior:** For each column, looks up `colMap.get(c)` to resolve the source entry. Only passes `onContextMenu` for physical/band columns (where `src` has `tid`). Calc columns get `null` (type derived from mode, not overridable).

### `PreviewGrid` context menu state (Plan E — `ui/grid.tsx`)

- **State:** `const [ctxMenu, setCtxMenu] = useState<{x: number; y: number; items: CtxMenuItem[]} | null>(null);`
- **`onTypeContextMenu` callback:** (1) reads `state.columnTypeOverrides?.[tid]?.[col] ?? state.tables[tid]?.colTypes?.[col] ?? 'string'` to determine current effective type; (2) builds four `CtxMenuItem` entries for `'string'`, `'number'`, `'date'`, `'boolean'` with `label: 'Type: ' + capitalized`, `checked: currentType === type`, and `action: () => { store.update(draft => { draft.columnTypeOverrides[tid][col] = type; }); invalidateValidation(); }`; (3) calls `setCtxMenu({ x, y, items })`
- **Render:** `{ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}`

### `ResultGrid` context menu state (Plan E — `ui/grid.tsx`)

- Same pattern as `PreviewGrid` — `useState` for `ctxMenu`, `onTypeContextMenu` callback builder, `<ContextMenu>` render
- **Difference:** Resolves `tid` from `colMap.get(c)` for each column (result columns come from multiple tables)

### Type-change store update (Plan E — `ui/grid.tsx`)

- **Behavior:** `getStore().update(draft => { if (!draft.columnTypeOverrides[tid]) draft.columnTypeOverrides[tid] = {}; draft.columnTypeOverrides[tid][col] = type; }); invalidateValidation();`
- **Calls:** `invalidateValidation()` from `../report/validation` — forces re-validation with new column type

---

## API Contracts

*(None — this feature is entirely internal, no API endpoints)*

---

## DTOs Created

### Foundations (types + state + storage)

- **`ColumnType`** — `types.ts:5`: `'string' | 'number' | 'date' | 'boolean'`
- **`DbTable.colTypes?`** — `types.ts:24`: `Record<string, ColumnType>`
- **`AppState.columnTypeOverrides`** — `types.ts:202`: `Record<string, Record<string, ColumnType>>`
- **`XLSXSheet['!data']?`** — `globals.d.ts:54`: `unknown[][]`
- **`coerceForSQL`** — `sqldb.ts:44`: `(v: unknown) => string | null` — all values stringified, no more numeric output
- **`columnTypeOverrides: {}`** — `state.ts:43` default in `createAppState()`
- **`ColumnType` barrel export** — `index.ts:125`
