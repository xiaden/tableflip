# ADR-009: UX Feedback Channel Hierarchy: Errors, Warnings, Information, Help

**Status:** Accepted  
**Date:** 2026-06-21  
**Tags:** ux, feedback, toast, tooltip, error-handling  

## Context

The Live Chip-Table UI implementation surfaced a recurring question: which UX channel should be used for which kind of feedback? The ThreeRowHeader currently uses MUI Tooltip for column-level errors (unresolvable sheet relationships), but the intended pattern is that tooltips are for help/guidance, not for error reporting.

Without an explicit taxonomy, different components and different agents will pick different channels for the same category of feedback, leading to inconsistent UX.

## Decision

All user-facing feedback MUST use the following channel hierarchy based on category:

| Category | Channel | Rationale |
|----------|---------|-----------|
| **Errors** (blocking, user must resolve) | **Toast** (auto-dismiss or dismissible) | Errors demand attention but shouldn't block interaction. A toast surfaces the message prominently without hijacking focus. |
| **Warnings** (non-blocking, user should know) | **Inline text** (adjacent to the relevant UI element) | Warnings are contextual — they only make sense in proximity to what triggered them. Inline text keeps the warning scoped. |
| **Information** (status updates, confirmations) | **Toast** (auto-dismiss) | Transient status messages ("Config saved", "Report exported") are temporal, not spatial. A toast that fades is appropriate. |
| **Help** (guidance, explanations) | **Tooltip** (hover-activated) | Help is on-demand — the user seeks it when they need it. Tooltips reveal help without cluttering the UI. |

**Anti-patterns prohibited by this ADR:**
- Using tooltip for error messages (error information should be visible without hover)
- Using toast for contextual warnings (warnings should be inline with what triggered them)
- Using inline text for transient status updates (spatial permanence for temporal events is noise)

## Consequences

**Positive:**
- Consistent feedback UX across all components
- Error messages are always visible (no hover-to-see-what's-wrong)
- Warning placement is always contextual (no hunting for what triggered the warning)

**Negative:**
- Requires a toast infrastructure — the codebase already has `toast()` from `core/utils.ts`, but it's currently only used for save/load confirmations. It may need enhancement for error-specific styling.
- Existing tooltip-based error patterns (ThreeRowHeader red error state) must be migrated to toast.
- Tooltip usage must be audited across the UI to ensure no errors are hiding behind hover.

## References

- DD-dd-live-chip-table-ui.md — ThreeRowHeader error state specification
- feature-mapping.md — "Hovering shows a tooltip" for red column state (violates this ADR)
