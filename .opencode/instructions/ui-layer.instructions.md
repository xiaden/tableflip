---
name: UI Layer
description: Preact components, grid rendering, export, file loading — thin reactive shell over domain layers. Applies when editing files in SRC/preact/ui/.
applyTo: SRC/preact/ui/**
---

# UI Layer

**Purpose:** Provide the Preact component tree, AG Grid integration, export formatting, and file loading UX — a thin reactive shell that subscribes to store state, renders JSX, dispatches domain-layer calls, and writes results back through store mutations.

## File Naming

- **Component files** — PascalCase matching export: `app.tsx`, `sidebar.tsx`, `file-loader.tsx`
- **Sections** — `sections/{feature}.tsx` (e.g., `base-stage.tsx`, `column-chips.tsx`, `run-bar.tsx`)
- **Cards** — `cards/{feature}-card.tsx` (e.g., `pipeline-card.tsx`, `layout-card.tsx`)
- **Shared components** — `components/{component}.tsx` (e.g., `modal.tsx`, `chip.tsx`, `rename-modal.tsx`)
- **Non-component logic** — kebab-case: `export.ts`, `loader.ts`, `aggregation.ts`, `tabs.ts`, `grid.tsx`

## Allowed Imports

UI components may import from any other layer, but the flow must be unidirectional:

- **Core layer** (`../core/`) — `getStore`, utilities (`colUserLabel`, `tableShortName`, `toast`, `dl`, etc.), state helpers (`buildReportSpecFromState`, `setColLabel`), SQLite (`dropTable`, `quoteId`, `execQuery`)
- **Catalog layer** (`../catalog/`) — `buildColSourceMap`, `projectedCols`, `buildSourceCatalog` (display-only — column metadata for rendering)
- **Query layer** (`../query/`) — `_afterCombineChange`, `_previewOpen`, `_showLayoutAliasesForSource`, `_hideLayoutAliasesForSource`, `_renameProjectedAliasRefs`
- **Report layer** (`../report/`) — `getValidation`, `invalidateValidation`, `runReport`, aggregation constants

**Never import** from `ui/` into any other layer — UI is the top of the dependency chain.

## Forbidden Patterns

- **No business logic** — SQL generation, validation rules, catalog building, result computation must NOT live in `ui/`. Delegate to `core/`, `catalog/`, `query/`, or `report/`.
- **No direct `getState()` mutation** — never mutate the object returned by `getStore().getState()` directly. Use `getStore().update(draft => { ... })` or `store.set(key, value)`.
- **No `dangerouslySetInnerHTML`** — use Preact JSX components instead.
- **No unguarded browser globals** — `typeof window !== 'undefined'` guard required before accessing `window`, `document`, or vendor globals.
- **No string-concatenated SQL** — use `quoteId()` from `core/sqldb.ts` for all table/column identifiers.
- **No AG Grid instance leaks** — do not create additional `gridResult` or `gridPreview` module-level variables. Use the existing singletons in `grid.tsx`.

## Required Patterns

### Store Subscription (every reactive component)

```typescript
const [state, setState] = useState<AppState>(getStore().getState());
useEffect(() => getStore().subscribe(s => setState(s)), []);
```

### State Mutations

```typescript
// Complex mutations — draft is a writable copy
getStore().update(draft => { draft.someField = newValue; });

// Single-field writes (more efficient)
getStore().set(key, value); // only for StoreKey-typed fields
```

### Pipeline State Changes

After every mutation that changes the pipeline (base table, lookups, calcs, stacks, columns, filters, sorts):

```typescript
import { _afterCombineChange } from '../../query/layout-selection';
import { invalidateValidation } from '../../report/validation';

// ...
getStore().update(draft => { /* mutation */ });
_afterCombineChange();          // syncs colSourceMap, selCols, colOrder, subtotalBy
invalidateValidation();         // marks validation cache stale
```

Detail bands call `invalidateValidation()` directly after every mutation (they do NOT use `_afterCombineChange()`).

### AG Grid Instance Management

Two module-level singleton variables in `grid.tsx` — do not create additional ones:

```typescript
let gridResult: GridApi | null = null;   // Result tab grid (singleton)
let gridPreview: GridApi | null = null;  // Browse Sheet tab grid (singleton)
```

Create grids in `useEffect` via the vendor global:
```typescript
gridResult = agGrid.createGrid(el, options);
return () => { gridResult?.destroy(); gridResult = null; };
```

## Validation

After editing files in `SRC/preact/ui/`, run:
- `npm run typecheck` — zero errors required
- `npm run lint` — zero warnings required  
- `npm test` — all tests must pass
