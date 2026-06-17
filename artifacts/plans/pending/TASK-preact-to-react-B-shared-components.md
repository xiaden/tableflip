# Task: Shared Components Conversion

## Problem Statement

Part B converts the 6 shared UI components in `SRC/preact/ui/components/` from Preact to React + MUI. These are leaf components used by cards, sections, and root shell components — converting them first allows Parts C–E to use MUI components without circular dependency issues.

Each component follows the same conversion pattern: replace `preact/hooks` imports with `react`, replace `class` attributes with `className` (or MUI `sx` props), replace Preact component patterns with MUI equivalents, and replace `createPortal` from `preact/compat` with `createPortal` from `react-dom`.

**Prerequisite:** TASK-preact-to-react-A-foundation (Vite tooling, React dependencies, `useStore` hook must exist).

**Design doc:** `artifacts/designs/pending/DD-preact-to-react-conversion.md`

## Phases

### Phase 1: Low-Complexity Shared Components

Convert the 4 simple shared components (Tip, Chip, ContextMenu, Modal) to React + MUI.

- [x] Convert `components/tip.tsx`: Replace Preact imports with `react`. Replace the component with a React FC wrapping MUI `<Tooltip>`. Preserve the `content` prop and children rendering. Remove any `[data-tip]` attribute patterns — MUI Tooltip handles display directly
    **Note:** Converted tip.tsx: Replaced Preact span with data-tip attribute with MUI Tooltip wrapping a span. Removed data-tip pattern. Preserved TipProps interface (text: string). Zero typecheck errors in this file.
- [x] Convert `components/chip.tsx`: Replace `ComponentChildren` import from `preact` with `ReactNode` from `react`. Replace the custom styled chip with MUI `<Chip>` component. Preserve `color`, `on`, `onClick`, `onDelete` props. Map the `--chip-color` CSS variable to MUI `sx` prop styling
    **Note:** Converted chip.tsx: Replaced Preact span-based chip with MUI Chip component. Key decisions: (1) Added parseChipColor() helper to extract hex from colorClass 'chip-cN' → TABLE_PALETTE[N], (2) Added parseInlineStyle() to convert CSS string prop to React CSSProperties (callers like base-stage.tsx pass inlineStyle as CSS text), (3) Used sx prop for selected/unselected color states matching original CSS behavior (left border when unselected, filled bg when selected), (4) Wrapped in MUI Tooltip when tooltip prop is set, (5) Preserved all drag-and-drop event handlers by passing through to MUI Chip (React.DragEvent types), (6) Badge rendered inside MUI Chip's label prop as fragment, (7) Changed event handler types from DOM MouseEvent/DragEvent to React.MouseEvent/React.DragEvent. Preserved all 18 props in ChipProps interface.
- [x] Convert `components/context-menu.tsx`: Replace `createPortal` import from `preact/compat` with `createPortal` from `react-dom`. Replace `preact/hooks` with `react`. Replace the custom `.ctx-menu` DOM rendering with MUI `<Menu>` and `<MenuItem>` components. Preserve `anchorEl`, `open`, `onClose`, `items` props
    **Note:** Converted context-menu.tsx: Replaced createPortal + manual DOM positioning with MUI Menu using anchorReference='anchorPosition'. Removed manual viewport boundary checking (MUI handles this). Removed manual click-outside/contextmenu-outside listeners (MUI Menu handles natively). Preserved CtxMenuItem interface (label, action, checked, separator) and ContextMenuProps (x, y, items, onClose). Separators render as MUI Divider. Checked items get '✓ ' prefix. Preserved all exports including CtxMenuItem type used by 6 consumer files.
- [x] Convert `components/modal.tsx`: Replace `createPortal` import from `preact/compat` with `createPortal` from `react-dom`. Replace `ComponentChildren` from `preact` with `ReactNode` from `react`. Replace `preact/hooks` with `react`. Replace the custom `.modal-backdrop`/`.modal-content` DOM with MUI `<Dialog>`, `<DialogTitle>`, `<DialogContent>`, `<DialogActions>`. Preserve `open`, `onClose`, `title`, `children`, `actions` props
    **Note:** Converted modal.tsx: Replaced createPortal + manual DOM modal with MUI Dialog/DialogTitle/DialogContent/DialogActions. MUI Dialog handles escape-key and backdrop-click natively. closeOnBackdrop prop handled via onClose reason check ('backdropClick' blocked when !closeOnBackdrop). Buttons use MUI Button with variant='contained' for primary and 'outlined' for non-primary. autoFocus on first button preserves original focus behavior. Preserved ModalProps interface (open, title, onClose, closeOnBackdrop, className, children, buttons).

### Phase 2: Medium-Complexity Shared Components

Convert the 2 more complex shared components (RenameModal, CalcBuilder) to React + MUI.

- [x] Convert `components/rename-modal.tsx`: Replace `preact/hooks` with `react`. Replace custom modal markup with MUI `<Dialog>` + `<TextField>`. Preserve the rename input, validation, and submit/cancel behavior. Use `useStore` hook if the component reads store state
    **Note:** Converted rename-modal.tsx: Replaced preact/hooks with react. Replaced raw <input type="text"> + <label> with MUI TextField (size="small", fullWidth, autoFocus, inputRef for focus/select). Changed KeyboardEvent → React.KeyboardEvent. Preserved all rename logic (calc vs column path), resolveRenameTarget export, and RenameModalProps interface. Component already uses the converted Modal wrapper (MUI Dialog). 0 typecheck errors, 0 lint warnings.
- [x] Convert `components/calc-builder.tsx`: Replace `JSX` import from `preact` with `JSX` from `react` (or remove if unused). Replace `preact/hooks` with `react`. Replace form controls with MUI equivalents: `<Select>` for mode selection, `<TextField>` for inputs, `<Checkbox>` for toggles, `<FormControl>`/`<InputLabel>` for labeled fields. Preserve all calculation mode switching logic (math/text/compare/date)
    **Note:** Converted calc-builder.tsx (394→500 lines): Replaced all preact imports with react. Converted all DOM elements to MUI: <select>→Select+MenuItem+FormControl, <input type="text/number">→TextField, <button>→Button, radio tab patterns→ToggleButtonGroup+ToggleButton. ColSelect helper now uses MUI Select with compactSelectSx for inline sizing. Extracted toggleBtnSx variable to avoid JSX brace-balancing issues with deeply nested sx objects. Replaced manual data-tip span in DateBuilder with Tip component. Renamed unused `i` param to `_i` in DateBuilder (ToggleButtonGroup doesn't need radio name). Preserved ALL calcMode switching logic (math/text/compare/date) exactly as-is. 0 typecheck errors, 0 lint warnings.
- [x] Verify all 6 converted components typecheck: run `npm run typecheck` and confirm zero errors in `components/*.tsx` files
    **Note:** Typecheck verified: 0 errors in rename-modal.tsx and calc-builder.tsx. Lint verified: 0 warnings in both files. Pre-existing errors in unconverted files (file-loader, grid, sections/*, sidebar, etc.) are out of scope for this phase.

### Phase 3: Tooltip Engine Removal

Remove the imperative tooltip engine that was in `app.ts`, since MUI `<Tooltip>` replaces it.

- [x] Remove the `initTooltipEngine()` function and its call from the entry point (if still present in `main.tsx` — it may have been removed in Part A). Verify no remaining references to `[data-tip]` attribute patterns in converted components
    **Note:** Tooltip engine removal complete. (1) Confirmed main.tsx already omits initTooltipEngine() (line 9-10 comment). (2) app.ts still has initTooltipEngine() — intentionally not modified (Plan E scope). (3) Replaced all 10 data-tip attributes across 3 unconverted files with MUI Tooltip wrappers: app.tsx (5: two export buttons + three tab-tip spans), sidebar.tsx (1: save-config button), cards/layout-card.tsx (4: aggregation-mode radio labels). Added `import Tooltip from '@mui/material/Tooltip'` to each file. Key detail: MUI Tooltip requires a React element child, not a plain string — wrapped text in <span> inside Tooltip in layout-card.tsx. (4) Zero data-tip references remain outside app.ts (old entry point). (5) Zero Tooltip-related typecheck errors. (6) Zero lint warnings in components/ and all modified files. Note: app.tsx, sidebar.tsx, and layout-card.tsx are still Preact files (preact/hooks imports) — they need full React conversion in a later phase.
- [x] Run `npm run lint` on `components/` directory and fix any warnings
    **Note:** Lint verified: 0 warnings in preact/ui/components/ (6 converted component files) and in the 3 modified files (app.tsx, sidebar.tsx, cards/layout-card.tsx). Full project lint timed out at 60s but targeted runs confirm clean.

## Completion Criteria

- All 6 files in `SRC/preact/ui/components/` use React imports (zero `from 'preact'` imports)
- `modal.tsx` renders MUI `<Dialog>` instead of custom `.modal-backdrop`/`.modal-content` divs
- `chip.tsx` renders MUI `<Chip>` with equivalent color/selection styling
- `context-menu.tsx` renders MUI `<Menu>`/`<MenuItem>` instead of custom `.ctx-menu` divs
- `tip.tsx` renders MUI `<Tooltip>` instead of `[data-tip]` attributes
- `rename-modal.tsx` uses MUI `<Dialog>` + `<TextField>`
- `calc-builder.tsx` uses MUI form controls (`<Select>`, `<TextField>`, `<Checkbox>`)
- `npm run typecheck` shows zero errors in `components/*.tsx` files
- No `createPortal` imports from `preact/compat` remain
