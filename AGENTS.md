# AGENTS.md

## Commands

All from `tableflip/SRC/` (where `package.json` lives):

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Dev (tsc watch → js-dev/) | `npm run dev` |
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

- **Imports need `.js` extensions** — `import { foo } from './bar.js'` (required by `moduleResolution: "bundler"`)
- **HTML onclick handlers** — functions must be assigned to `window.*` (e.g., `window.myFn = myFn;`)
- **SQL identifiers** — always use `quoteId()` from `sqldb.ts`, never concatenate directly
- **State changes** — call `invalidateValidation()` after modifying db state, or validation stays stale
- **Vendored CJS modules** — use `// @ts-expect-error - vendored CJS module` before `import()` of files in `js/wasm/` and `js/vendor/`
- **window/document access** — always guard with `typeof window !== 'undefined'` / `typeof document !== 'undefined'`

## Testing

- Uses Vitest (not node:test) with jsdom environment
- Tests auto-discover `tests/cases/*.test.ts` (prefixed `a-` through `ac-`)
- Each test gets fresh SQLite DB with `Orders` + `Contacts` fixtures (`tests/fixtures.ts`)
- `resetDbState()` resets `db` object between tests
- Helpers in `tests/helpers.ts`: `runReportPipeline()`, `expectReportHealthy()`, `expectRowsEqual()`, `normalizeSql()`
- Use `expect` from Vitest, never `node:assert/strict`
- DOM elements are created in `vitest-setup.ts` before app modules are loaded

## UI Architecture

- **`js/ui/components/`** — Pure rendering functions (HTML strings), no DOM mutation, testable without jsdom
  - `chip.ts` — Column chip rendering
  - `card.ts` — Card/section containers
  - `calc-builder.ts` — Calc stage mode builders (math, text, compare, date)
  - `aggregation-constants.ts` — AGG/TOTAL/SUBTOTAL function constants and validators
  - `select.ts`, `button.ts`, `modal.ts` — Form control components
- **`js/ui/views/`** — Stateful view controllers, import from components, bind DOM events
  - `pipeline-card.ts` — Report pipeline stage UI
  - `output-card.ts` — Column chip + merge toggle UI
  - `filter-sort-card.ts` — Filter/sort row UI
  - `query-builder.ts` — Query builder orchestrator
- **`js/ui/utils/`** — DOM utilities and event delegation helpers
  - `dom.ts` — Cached element getters, createElement, styles, event binding
  - `events.ts` — Event delegation (delegate, onClick, onChange, onDragDrop)
- **`js/query/`** — SQL generation and query logic (no direct DOM access)
- **`js/core/`** — State management (100% covered)
- **`js/report/`** — Report execution engine (+97% covered)
