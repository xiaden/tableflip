# ADR-DRAFT: Pool-selection fields use non-nullable types with full-list defaults; null/empty means nothing

**Status:** Proposed  
**Date:** 2026-06-14  
**Tags:** selection-convention, null-semantics, type-safety, refactoring, state-management  

## Context

Seven type fields across the codebase use null or empty array to mean "select ALL items from the pool": DetailBandSpec.cols, AppState.baseCols, AppState.selCols, AppState.colOrder, ReportSpec.pipeline.baseCols, ReportSpec.outputColumns, and ResultSetMetadata.displayCols. This convention is semantically inverted (null should mean "nothing"), makes "no columns selected" unrepresentable, diverges from LookupSpec.cols (which correctly uses string[] where empty = no projection), and causes developer confusion. The convention was inherited from the original JS codebase and never formally decided — no ADR exists.

## Decision

Pool-selection fields (fields that select from a pool of available items) must default to the full populated list and use non-nullable types. null/empty array means "nothing selected" or "not yet configured," never "everything." Ordering fields (colOrder) default to the full list in natural order. Constraint-accumulation fields (filters, sorts, aggregates) already use [] = nothing correctly and are unchanged. State hydration uses an overlay strategy: populate full list first, then overlay saved state on top, ensuring backward compatibility with old .rcjson files that use null values.

## Consequences

- All 7 existing nullable selection fields become non-nullable (string[], Set<string>)
- ~40 change sites across 12 files in all 5 layers
- Null checks replaced with length/size checks at consumer sites
- State hydration uses overlay strategy: populate full list → overlay saved state
- Backward compatible with existing .rcjson files (no state version bump)
- "No columns selected" becomes representable (was previously unrepresentable)
- UI materialization cascade eliminated (no more null → full list on first interaction)
- New selection fields must follow this convention: non-nullable, empty = nothing, full list = all

## References

- Design document: artifacts/designs/pending/DD-default-selection-conventions.md
- LookupSpec.cols pattern: types.ts (string[] where empty = no projection)
- State hydration: core/state-hydrator.ts
- Column catalog consumer: catalog/column-catalog.ts:241
