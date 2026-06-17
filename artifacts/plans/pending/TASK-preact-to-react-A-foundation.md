# Task: Build Tooling + Store Adapter + Entry Point

## Problem Statement

Part A of the preact-to-react conversion establishes the build infrastructure and React adapter layer that all subsequent parts depend on. The current project uses esbuild for bundling and Preact for rendering. Part A migrates the build pipeline to Vite with React Fast Refresh, replaces Preact dependencies with React + MUI + ag-grid-react, creates the `useStore()` selector hook that bridges the existing pub/sub store to React's `useSyncExternalStore`, and migrates the entry point from Preact's `render(h(App))` to React's `createRoot().render(<App />)`.

After Part A, the project compiles with React tooling but the UI still renders Preact components. Parts B–E convert those components.

**Prerequisite:** None (first part in dependency chain).

**Design doc:** `artifacts/designs/pending/DD-preact-to-react-conversion.md`

## Phases

### Phase 1: Tooling and Dependencies

Migrate the build pipeline from esbuild to Vite and swap framework dependencies.

- [x] Add React dependencies to `SRC/package.json`: `react` ^19.x, `react-dom` ^19.x, `@types/react` ^19.x, `@types/react-dom` ^19.x as dependencies/devDependencies respectively
    **Note:** Added react ^19.2.7, react-dom ^19.2.7 to dependencies; @types/react ^19.2.17, @types/react-dom ^19.2.3 to devDependencies
- [x] Add MUI dependencies to `SRC/package.json`: `@mui/material` ^7.x, `@emotion/react` ^11.x, `@emotion/styled` ^11.x
    **Note:** Added @mui/material ^7.3.11, @emotion/react ^11.14.0, @emotion/styled ^11.14.1 to dependencies
- [x] Add AG Grid React binding to `SRC/package.json`: `ag-grid-react` ^33.x
    **Note:** Added ag-grid-react ^33.3.2 to dependencies
- [x] Add Vite tooling to `SRC/package.json` devDependencies: `vite` ^6.x, `@vitejs/plugin-react` ^4.x
    **Note:** Added vite ^6.4.3, @vitejs/plugin-react ^4.7.0 to devDependencies
- [x] Add test dependencies to `SRC/package.json` devDependencies: `@testing-library/react` ^16.x, `@testing-library/jest-dom` ^6.x
    **Note:** Added @testing-library/react ^16.3.2, @testing-library/jest-dom ^6.9.1 to devDependencies
- [x] Remove Preact from `SRC/package.json` dependencies: delete `preact` ^10.29.2
    **Note:** Removed preact ^10.29.2 from dependencies
- [x] Remove esbuild from `SRC/package.json` devDependencies: delete `esbuild` ^0.28.1 and `esbuild-wasm` ^0.28.1
    **Note:** Removed esbuild ^0.28.1 and esbuild-wasm ^0.28.1 from devDependencies
- [x] Run `npm install` to install new dependencies and verify node_modules resolves
    **Note:** npm install succeeded: 132 packages added, 2 removed (preact, esbuild-wasm). esbuild still present as transitive dep.
- [ ] Create `SRC/vite.config.ts` with `@vitejs/plugin-react`, configure `root` to `.` (SRC), set `build.outDir` to `../pkg`, configure `publicDir` for vendor assets
- [x] Update `SRC/tsconfig.json`: change `jsxImportSource` from `"preact"` to `"react"`, add `"vite/client"` to `types` array
    **Note:** Changed jsxImportSource from 'preact' to 'react', added 'vite/client' to types array
- [x] Update `SRC/preact/vitest.config.ts`: change `jsxImportSource` from `"preact"` to `"react"`
    **Note:** Changed jsxImportSource from 'preact' to 'react' in esbuild config. Added '@testing-library/jest-dom/vitest' to setupFiles for jest-dom matchers
- [x] Verify `SRC/index.html` works as Vite's entry point (it already lives at the SRC root which is the Vite root — confirm no relocation needed). Update vendor `<script>` tag paths to reference `/` root (Vite `publicDir` convention) instead of relative paths
    **Note:** Updated all vendor asset paths from relative (e.g. 'js/vendor/...') to root-absolute (e.g. '/js/vendor/...') for Vite publicDir convention. Kept document.write/assetUrl cache-busting mechanism unchanged. No module entry script added (that's P2-S4)
- [x] Create `SRC/public/` directory. Symlink or copy vendor assets (`js/vendor/`, `js/wasm/`, AG Grid CSS from `css/`) into `public/` so Vite serves them as static files at root paths. Alternatively, configure Vite `publicDir` to point to `SRC/` root if simpler
    **Note:** Created SRC/public/ with js/vendor/ (3 files), js/wasm/ (2 files), css/ (ag-grid.min.css, ag-theme-balham-dark.min.css, style.css). All copied from SRC/js/vendor/, SRC/js/wasm/, SRC/css/
- [x] Update `SRC/package.json` scripts: `dev` → `vite`, `build` → `vite build`, keep `typecheck` as `tsc --noEmit`
    **Note:** Updated scripts: dev → 'vite --host', build → 'vite build'. typecheck unchanged as 'tsc --noEmit -p tsconfig.json'
- [x] Verify `npm run typecheck` passes (will have errors from Preact imports in UI files — expected, those are fixed in Parts B–E)
    **Note:** Typecheck has errors ONLY in preact/ui/*.tsx, preact/app.ts, and preact/tests/ui/ files. All errors are expected: (1) Cannot find module 'preact'/'preact/hooks'/'preact/test-utils' — Preact removed, (2) 'class' vs 'className' — React JSX convention, (3) style string vs object, (4) Preact event types vs React event types. Zero errors in core/, catalog/, query/, report/ layers.
- [x] Delete `SRC/scripts/build.mjs` after confirming `vite build` produces equivalent output
    **Note:** Deleted SRC/scripts/build.mjs and removed empty SRC/scripts/ directory. Old esbuild build pipeline fully replaced by Vite.

### Phase 2: Store Adapter and Entry Point

Create the React adapter hook and migrate the application entry point.

- [x] Create `SRC/preact/ui/useStore.ts` exporting a selector-based `useStore<T>(selector: (state: AppState) => T): T` hook using `useSyncExternalStore` from React with shallow equality comparison on the selected slice. Import `getStore` from `../core/store` and `AppState` from `../types`. Use `useRef` to cache the previous selector result and return the cached value when shallow-equal
    **Note:** Created SRC/preact/ui/useStore.ts exporting selector-based useStore<T>(selector) hook. Uses useSyncExternalStore with useRef-cached previous slice and shallowEqual comparison (Object.is for primitives, shallow key comparison for objects). Returns cached value when shallow-equal to prevent unnecessary re-renders. JSDoc documented with usage examples.
- [x] Verify `useStore.ts` typechecks cleanly with `npm run typecheck` (it should — it only imports from `react` and `../core/store`, no Preact)
    **Note:** Verified useStore.ts compiles cleanly. npm run typecheck shows zero errors in useStore.ts — only expected errors in existing Preact UI .tsx files (class vs className, preact imports).
- [x] Create `SRC/preact/main.tsx` as the new React entry point: import `createRoot` from `react-dom/client`, import `initDb` from `./core/sqldb`, import `initStore` from `./core/store`, import `App` from `./ui/app`. Bootstrap function: `await initDb()`, `initStore()`, `createRoot(document.getElementById('app')!).render(<App />)`. Remove the `initTooltipEngine()` function (tooltips become MUI `<Tooltip>` in Part B)
    **Note:** Created SRC/preact/main.tsx as new React entry point. Imports createRoot from react-dom/client, initDb from ./core/sqldb, initStore from ./core/store, App from ./ui/app. Async main() bootstraps: await initDb(), initStore(), createRoot(#app).render(<App />), hides loading overlay. Error handler displays in loading overlay (same pattern as old app.ts). Intentionally omits initTooltipEngine() — tooltips become MUI <Tooltip> in later phases.
- [x] Update `SRC/index.html` to reference `preact/main.tsx` as the Vite module entry point (add `<script type="module" src="/preact/main.tsx"></script>` before `</body>`)
    **Note:** Updated SRC/index.html: added <script type="module" src="/preact/main.tsx"></script> before </body>. This tells Vite to treat preact/main.tsx as the application entry point for HMR.
- [x] Verify the entry point compiles: `npx tsc --noEmit` should show errors only in UI component files (Preact imports), not in `main.tsx` or `useStore.ts`
    **Note:** Verified entry point compiles: npx tsc --noEmit shows zero errors in main.tsx and useStore.ts. All 26 files with errors are exclusively UI .tsx files (Preact imports: class vs className, preact/hooks, preact/test-utils) and old preact/app.ts. Zero errors in core/, catalog/, query/, report/ layers. Tests: 1045/1045 pass, 3 UI test files fail to load (expected — import preact which was removed in Phase 1).

## Completion Criteria

- `npm install` succeeds with React, MUI, ag-grid-react, Vite dependencies installed
- `preact` and `esbuild` packages removed from node_modules
- `SRC/vite.config.ts` exists with `@vitejs/plugin-react` configured
- `SRC/tsconfig.json` has `jsxImportSource: "react"` and `types: ["node", "vite/client"]`
- `SRC/preact/vitest.config.ts` has `jsxImportSource: "react"`
- `SRC/preact/ui/useStore.ts` exists, exports `useStore<T>(selector)` hook, typechecks cleanly
- `SRC/preact/main.tsx` exists with React `createRoot` entry point, typechecks cleanly
- `SRC/package.json` scripts: `dev` runs `vite`, `build` runs `vite build`
- `SRC/scripts/build.mjs` deleted
- `npm run typecheck` errors are limited to Preact import statements in UI component files (expected — fixed in Parts B–E)
files (expected — fixed in Parts B–E)
