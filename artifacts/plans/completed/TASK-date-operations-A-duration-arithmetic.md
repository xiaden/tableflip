# Task: Date Operations — Duration & Arithmetic

## Problem Statement
The calculated columns date mode currently only supports **extraction** (year, month, day, dow, week, quarter, julian). Missing are duration calculations (date - date) and date arithmetic (date + N days/months/years).

**User needs:**
1. Duration: Calculate days/months/years between two date columns
2. Date arithmetic: Add/subtract days/months/years from a date column

**Current state:**
- Date mode has `operation: 'extract'` with `source`, `part`, `output`, `inputFormat`
- SQL uses `strftime()` for extraction
- No support for date differences or arithmetic

**Target state:**
- Add `operation: 'duration'` for date differences
- Add `operation: 'add'` and `operation: 'subtract'` for date arithmetic
- Support units: days, months, years
- Allow second operand to be a column reference or literal number

## Phases

### Phase 1: Type definitions
- [x] Extend `CalcStage.date` type to support `duration`, `add`, `subtract` operations
- [x] Define `DurationOp` interface: `{ operation: 'duration'; source: DateSource; source2: DateSource; unit: 'days' | 'months' | 'years' }`
- [x] Define `AddSubtractOp` interface: `{ operation: 'add' | 'subtract'; source: DateSource; operand: { type: 'column' | 'number'; value: string }; unit: 'days' | 'months' | 'years' }`
- [x] Update `DateSource` type to allow column or text (for literal dates)

### Phase 2: SQL generation
- [x] Add `renderModeDuration()` in `sql-calcs.ts`
- [x] Generate SQL for duration: `CAST(julianday(end) - julianday(start) AS INTEGER)` for days
- [x] Generate SQL for months: year*12 + month difference
- [x] Generate SQL for years: year difference
- [x] Add `renderModeAddSubtract()` in `sql-calcs.ts`
- [x] Generate SQL for add: `date(source, '+' || operand || ' ' || unit)`
- [x] Generate SQL for subtract: `date(source, '-' || operand || ' ' || unit)`
- [x] Handle column vs number operand types
- [x] Integrate new operations into `renderCalcExpr()` dispatcher

### Phase 3: Validation
- [x] Add `validateDurationMode()` in `calc-validator.ts`
- [x] Validate `source` and `source2` are valid date columns
- [x] Validate `unit` is one of: days, months, years
- [x] Add `validateAddSubtractMode()` in `calc-validator.ts`
- [x] Validate `source` is a valid date column
- [x] Validate `operand` is valid (column exists or number is parseable)
- [x] Validate `unit` is one of: days, months, years
- [x] Update validator dispatcher to call new validators

### Phase 4: UI components
- [x] Add Duration builder component in `calc-builder.tsx`
- [x] Two source column selectors (end date, start date)
- [x] Unit selector (days/months/years)
- [x] Add AddSubtract builder component in `calc-builder.tsx`
- [x] Source column selector
- [x] Operand input (column selector or number field)
- [x] Unit selector (days/months/years)
- [x] Add operation selector to DateBuilder (extract/duration/add/subtract)
- [x] Wire up new handlers in `calc-stage.tsx`

### Phase 5: State management
- [x] Add `handleDateOperationChange()` to switch between extract/duration/add/subtract
- [x] Add `handleDurationSource2Change()` for second date column
- [x] Add `handleDurationUnitChange()` for duration unit
- [x] Add `handleAddSubtractOperandChange()` for operand type/value
- [x] Add `handleAddSubtractUnitChange()` for arithmetic unit
- [x] Update `handleModeChange()` defaults for new operations

### Phase 6: Tests
- [x] Add SQL generation tests for duration (days/months/years)
- [x] Add SQL generation tests for add/subtract (column/number operands)
- [x] Add validation tests for new operations
- [x] Add UI tests for duration builder
- [x] Add UI tests for add/subtract builder
- [x] Add integration tests for date operations in query plan

## Completion Criteria
- Duration operation calculates days/months/years between two dates
- Add/subtract operations add/subtract days/months/years from a date
- Operand can be a column reference or literal number
- All new operations pass validation
- UI components allow configuration of all new operations
- All tests pass (typecheck, lint, unit tests)

## References
- SQLite date functions: `julianday()`, `date()`, `strftime()`
- Current date mode implementation: `sql-calcs.ts:renderModeDate()`
- Current date validation: `calc-validator.ts:validateDateMode()`
- Current date UI: `calc-builder.tsx:DateBuilder`
