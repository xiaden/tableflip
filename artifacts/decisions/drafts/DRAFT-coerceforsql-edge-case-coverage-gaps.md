# ADR-DRAFT: coerceForSQL edge case coverage gaps

**Status:** Proposed  
**Date:** 2026-06-14  
**Tags:** observation, test-coverage  

## Context

During analysis of the Column-Type-Aware WHERE Foundations plan, several edge cases in coerceForSQL (sqldb.ts) were found to lack explicit test coverage. The plan updated existing test assertions for string storage but did not add new edge case tests.

## Decision

Accept the pre-existing coverage gaps as low-to-medium severity. The core string storage change is verified correct and all 887 tests pass. Flag the gaps for future improvement rather than blocking the plan.

## Consequences

- 0, empty string, and whitespace edge cases remain untested but functionally correct
- columnTypeOverrides default not explicitly asserted in state.test.ts
- These are non-blocking — the plan's scope was narrow (update existing assertions)
