# Pivot-Table UI Redesign (React+MUI) — Design Document

**Status:** Draft  
**Author:** RnD-DDAuthor  
**Created:** 2026-06-16  

**Related Documents:**
- [Preact-to-React Conversion Design](artifacts/designs/pending/DD-preact-to-react-conversion.md) — The React+MUI foundation that this pivot redesign builds upon. Must be complete and accepted before this DD is actionable.
- [Pivot-Table UI Redesign (Preact, now obsolete)](artifacts/designs/pending/DD-pivot-table-ui-redesign.md) — Original Preact pivot redesign design. Now obsolete — superseded by this React+MUI version.

---

## Scope

Reimplement the entire UI using React+MUI with a single-screen pivot layout. This replaces the existing Preact 3-tab layout AND the old Preact pivot redesign DD (DD-pivot-table-ui-redesign). ALL 25+ UI files will be rebuilt.

---

## Problem Statement

The current Preact UI uses a 3-tab layout (Source → Query → Report) that requires users to navigate between tabs to build a report. A single-screen pivot layout would provide a more intuitive experience where all manipulation happens on one screen. The previous Preact pivot redesign (DD-pivot-table-ui-redesign) planned this but must be re-targeted for React+MUI after the framework conversion (DD-preact-to-react-conversion) lands.

---

## Architecture

This DD is a STUB. Full architecture will be documented when the React+MUI conversion is complete. Key concepts carried forward from the old DD-pivot-table-ui-redesign:

1. **DELETE grid.tsx entirely** — Replace AG Grid with custom virtual-scrolling grid
2. **Single-screen pivot layout** — PivotLayout → PivotSidebar + PivotToolbar + PivotGrid component hierarchy
3. **AppState `_ui` field** — UI-only state tracked separately from the data store
4. **All 25+ UI files rewritten** — No Preact code remains in the pivot UI
5. **React+MUI foundation** — Built on top of DD-preact-to-react-conversion's React+MUI output

---

## Design Goals

STUB — to be defined during full design phase.

---

## Constraints

1. MUST NOT be executed until DD-preact-to-react-conversion is complete and accepted.
2. Builds on the React+MUI foundation from the conversion — never reintroduces Preact.
3. Old DD-pivot-table-ui-redesign is now obsolete — this React+MUI version supersedes it.
4. The custom virtual-scrolling grid replacement for AG Grid must handle the same column features (renaming, coloring, sorting, filtering, context menus, resize, reorder) that AG Grid currently provides.

---

## Open Questions

ALL OPEN QUESTIONS DEFERRED. This stub will be fully rewritten once DD-preact-to-react-conversion is accepted and complete.

---
