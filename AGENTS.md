# AGENTS.md

## Commands

All from `tableflip/SRC/` (where `package.json` lives):

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Dev (tsc watch → preact-dev/) | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Test | `npm test` |
| Build (bundle to ../pkg/) | `npm run build` |

Rebuild xlsx vendor bundle: `cd build_resources/xlsx-js-style-fork && npm run ship`, then copy `xlsx.bundle.js` to `tableflip/SRC/js/vendor/`.

## Mandatory checks (run these without prompting)

After any code change, run:

- `npm run typecheck` — zero errors required
- `npm run lint` — zero warnings required
- `npm test` — all tests must pass

## Traps

- **SQL identifiers** — always use `quoteId()` from `sqldb.ts`, never concatenate directly
- **State changes** — call `invalidateValidation()` after modifying db state, or validation stays stale
- **Vendored CJS modules** — use `// @ts-expect-error - vendored CJS module` before `import()` of files in `js/wasm/` and `js/vendor/`
- **window/document access** — always guard with `typeof window !== 'undefined'` / `typeof document !== 'undefined'`
- **No `dangerouslySetInnerHTML`** — use Preact components with JSX, never string HTML builders

## Testing

- Uses Vitest with jsdom environment
- Tests live in `preact/tests/` and are auto-discovered by `vitest.config.ts`
- Each test gets fresh SQLite DB via `preact/tests/vitest-setup.ts`
- Use `expect` from Vitest, never `node:assert/strict`

## Architecture (SRC/preact/)

Five-layer architecture — vendor/wasm libs from `js/vendor/` and `js/wasm/` are the only external deps:

1. **Core Layer** (`preact/core/`) — State store (pub/sub), SQLite wrapper, utilities, date formatting
2. **Catalog Layer** (`preact/catalog/`) — Source and column catalog building, column projection
3. **Query Layer** (`preact/query/`) — SQL generation (WHERE, JOINs, GROUP BY, aggregates, totals, subtotals, calculated columns), query plan builder, lookup resolver, alias ref management
4. **Report Layer** (`preact/report/`) — Report execution engine, validation, result set construction, output layout, export formatting
5. **UI Layer** (`preact/ui/`) — Preact component tree (App shell → Cards → Sections → Elements), AG Grid integration, export

- **Vendor libs** (sql.js, AG Grid, xlsx-js-style) loaded via `<script>` tags in `index.html`
- **State management** uses reactive store: `store.getState()`, `store.update(draft => { ... })`, `store.set(key, value)`, `store.subscribe(listener)`
- **Type declarations** in `preact/types/` (globals.d.ts for vendor types) and `preact/types.ts` (shared interfaces)
- **Tests** in `preact/tests/` — same Vitest runner, auto-discovered
