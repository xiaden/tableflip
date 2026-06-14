# ADR-002: Five-Layer Architecture

**Status:** Accepted  
**Date:** 2026-06-14  
**Tags:** architecture, layers, code-organization  

## Context

TableFlip's code organization emerged naturally during early development as the problem domain — spreadsheets ingested into SQLite, queried, and rendered as interactive reports — pushed logic into distinct ownership zones. What started as loose conventions hardened into clear boundaries: a Core layer for foundational state and data access, a Catalog layer for column/source metadata, a Query layer for SQL generation, a Report layer for execution and output shaping, and a UI layer for Preact components and export.

This structure was documented and consolidated after the fact, not designed upfront. It reflects the natural seams of the problem: each stage of the pipeline (ingest → catalog → query → execute → present) maps to a layer. No formal dependency rule is enforced, but in practice no cross-layer violations are known.

## Decision

Adopt and canonize the five-layer architecture as the project's code organization:

1. **Core Layer** (`preact/core/`) — State store (pub/sub), SQLite wrapper, utilities, date formatting. Everything foundational lives here.
2. **Catalog Layer** (`preact/catalog/`) — Source and column catalog building, column projection. Owns all metadata about what columns exist and where they come from.
3. **Query Layer** (`preact/query/`) — SQL generation (WHERE, JOINs, GROUP BY, aggregates, totals, subtotals, calculated columns), query plan builder, lookup resolver, alias ref management. Owns the SQL generation pipeline.
4. **Report Layer** (`preact/report/`) — Report execution engine, validation, result set construction, output layout, export formatting. Owns turning a query into a rendered result.
5. **UI Layer** (`preact/ui/`) — Preact component tree (App shell → Cards → Sections → Elements), AG Grid integration, export triggers. Owns the user interface.

Key structural rules:
- A layer rejects something only because a lower layer already owns it — never as an arbitrary prohibition.
- The number of layers is not sacred; if a sixth layer is warranted by ownership, one will be added.
- The UI layer is the hardest boundary to protect — keeping business logic out of components requires continuous attention.

## Consequences

**Positive:**
- Each layer has a well-understood ownership zone, making it easy to find where a concern lives and where to add new code.
- The pipeline maps intuitively to the five stages, reducing onboarding friction.
- Vertical features that touch all layers are straightforward: each layer does its part, and the data flows through.

**Risks:**
- The UI layer is the most porous boundary; business logic tends to creep into components. This requires vigilance during code review.
- No mechanical enforcement of layer isolation exists — the architecture relies on team discipline and the natural enforcement of the state store pattern (UI subscribes to state, does not own it).
- Adding a sixth layer would require refactoring existing boundaries, though the decision explicitly permits it when ownership warrants.

**Rejected alternatives:**
- Vertical slice (feature-folder) organization was explicitly considered and rejected. The pipeline cuts across features, and vertical slices would duplicate layer logic per feature rather than sharing it through the stage-based architecture.

## Layer Boundaries in Practice

Core depends on nothing in `preact/` — only vendor/wasm libs from `js/vendor/` and `js/wasm/`. Catalog depends on Core. Query depends on Catalog and Core. Report depends on Query, Catalog, and Core. UI depends on Report and all lower layers. Data flows down through imports; reactivity flows up through the state store (store.subscribe).

## Maintenance

This ADR should be consulted when proposing a new module or refactoring an existing one. The question to ask: "Which layer owns this concern?" If the answer is unclear, either the concern is cross-cutting (and belongs in Core or a shared utility), or a new layer boundary may be needed.
