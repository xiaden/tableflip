# Task: Math Calc Step Chains — UI Overhaul

## Problem Statement
The SQL backend (`sql-calcs.ts`) and validator (`calc-validator.ts`) already support multi-step math chains with mixed column/number/text types per step. The backend can produce SQL like `(Amount + 100) * 2` via arbitrary-length `steps[]` arrays with per-step type annotations.

However, the `MathBuilder` component in `calc-builder.tsx` hardcodes exactly 2 column-only dropdowns (`leftCol` / `rightCol`), both forced to `type: 'column'`. There is no way to:
- Select a step type (Column vs Number vs Text)
- Add more than 2 steps
- Combine column references with literal values in the same expression

The Text "combine" builder already demonstrates the exact UI pattern needed: per-part type selectors with add/remove buttons. The MathBuilder should follow the same pattern.

No backend changes are needed. The data model (`CalcStage.math.steps[]`), SQL renderer, and validator are all ready.

## Phases

### Phase 1: Update CalcBuilderProps and MathBuilder component
- [x] Add `onMathStepChange`, `onMathAddStep`, `onMathRemoveStep` callbacks to `CalcBuilderProps` interface (optional, undefined for non-math builders)
- [x] Rewrite `MathBuilder` to render variable-length step chain UI instead of hardcoded leftCol/rightCol
- [x] Each step row: type selector (Column/Number/Text), value input (ColSelect for column, TextField for number/text), operator selector (only for steps after index 0), remove button (only when steps.length > 1)
- [x] Render "+ Add Step" button below all step rows
- [x] Keep ROLLAVG and PCTTOTAL sub-modes working (they use step[0] only, which still works with the new pattern)

### Phase 2: Update calc-stage handlers
- [x] Add `handleMathStepChange(stepIdx, prop, value)` callback — updates step[stepIdx][prop]
- [x] Add `handleMathAddStep()` callback — appends `{ type: 'column', value: '', op: '+' }` to steps
- [x] Add `handleMathRemoveStep(stepIdx)` callback — removes step at index (guard: steps.length > 1)
- [x] Remove `leftCol`, `rightCol`, `mathOperator` cases from `handlePropChange` switch
- [x] Pass new callbacks to `Builder` component

### Phase 3: Write UI tests for MathBuilder
- [x] Test renders all steps from the math.steps array
- [x] Test step type selector switches column → number → text and updates value input
- [x] Test add step button appends a new row
- [x] Test remove step button removes a row (disabled when only 1 step)
- [x] Test operator selector only appears on steps after index 0
- [x] Test ROLLAVG and PCTTOTAL sub-modes still render correctly

### Phase 4: Integration verification
- [x] Run `npm run typecheck` — zero errors
- [x] Run `npm run lint` — zero warnings
- [x] Run `npm test` — all tests pass (existing + new)

## Completion Criteria
- MathBuilder renders all steps from `calc.math.steps[]` with correct type/value/operator
- User can add/remove steps and switch step types between Column, Number, and Text
- ROLLAVG and PCTTOTAL sub-modes are unaffected
- All typecheck, lint, and test suites pass
- Existing calc validation tests still pass (no backend changes)

## References
- `SRC/preact/query/sql-calcs.ts` — backend step chain renderer (lines 163-176)
- `SRC/preact/report/calc-validator.ts` — validator already accepts multi-step mixed types (lines 26-47)
- `SRC/preact/tests/query/sql-calcs.test.ts` — test "column + number steps" (line 106) exercises 3-step chain
