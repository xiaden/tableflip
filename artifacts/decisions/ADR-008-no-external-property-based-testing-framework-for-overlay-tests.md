# ADR-008: No external property-based testing framework for overlay tests

**Status:** Accepted  
**Date:** 2026-06-15  
**Tags:** detail-bands-overlay, testing, part-F, vitest  

## Context

Part F of detail-bands-overlay feature requires writing comprehensive tests encoding the spec's expected behavior as ground truth (TDD approach). The existing test suite has 98 export-bands tests, 37 engine-bands tests, and ~200+ band-specific tests across 15 files. Parts A-E implement the overlay architecture; Part F writes tests against the actual implementations.

## Decision

Use standard Vitest describe/it/expect for property-like tests rather than adding fast-check as a dependency. The codebase has no existing property-based testing precedent, and the properties to verify (descriptor structure, section header content, band data content) are straightforward enough to express with parameterized tests and targeted assertions.

## Consequences

Tests encode spec behavior as ground truth. If a test fails after Parts A-E are implemented, the implementation is wrong — tests are never modified to accommodate broken code. Property-based tests use standard Vitest assertions (no external framework) to avoid adding dependencies.
