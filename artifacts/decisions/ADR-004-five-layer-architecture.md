# ADR-004: Five-Layer Architecture

**Status:** Proposed  
**Date:** 2026-06-14  
**Tags:** architecture, layers, structure  

## Context

TableFlip's codebase initially had no formal structure for where logic should live. SQL generation appeared in UI event handlers. Column resolution was duplicated across components. The architecture was extracted from working code — five natural seams emerged from the data transformation pipeline, then were documented and consolidated. This ADR formalizes the layer boundaries that now define the project.

## Decision

1. **Five layers with defined ownership.** Each layer is the canonical home for a coherent set of responsibilities. The dependency direction is: Core ← Catalog ← Query ← Report ← UI.

| Layer | Owns | Depends on |
|---|---|---|
| **Core** | State store (pub/sub), SQLite wrapper, utilities, date formatting | (vendor libs only) |
| **Catalog** | Source and column catalog building, column projection, alias resolution | Core |
| **Query** | SQL generation (WHERE, JOINs, GROUP BY, aggregates, totals, subtotals, calculated columns), query plan builder, lookup resolver | Core, Catalog |
| **Report** | Report execution engine, validation, result set construction, output layout, export formatting | Core, Catalog, Query |
| **UI** | Preact component tree, AG Grid integration, export triggers | Core, Catalog, Query, Report |

2. **Not a fixed number.** If a sixth layer were needed, it would be added. A new layer is warranted when a cohesive set of responsibilities emerges that: (a) has a clear dependency boundary, (b) is consumed by multiple higher layers, and (c) would create circular dependencies or excessive coupling if placed in any existing layer.

3. **Boundaries enforced by convention and code review.** Per-layer instruction files in `.opencode/instructions/` define allowed and forbidden imports. No automated tooling enforces these — the boundaries have been maintained through code-review discipline.

4. **UI is the hardest boundary.** Keeping business logic out of components requires continuous vigilance. When logic appears in a component, the question is: does this belong in Report, Query, Catalog, or Core?

5. **New code placement heuristic:**
- Does it touch the DOM or Preact vnodes? → **UI**
- Does it execute SQL or validate report configs? → **Report**
- Does it generate SQL strings? → **Query**
- Does it resolve column aliases to physical sources? → **Catalog**
- Everything else (state, utilities, SQLite primitives) → **Core**

## Consequences

**Positive:**
- Clear home for every concern — no ambiguity about where logic belongs
- Catalog and Query layers are largely pure functions, independently testable
- Data flows linearly through the pipeline, matching the layer structure

**Rejected alternative:**
- **Vertical slices (feature-folders).** Rejected because data flows linearly (ingest → catalog → query → execute → present) and features cut across this pipeline. A feature-folder layout would duplicate cross-cutting catalog/query/report logic per feature, or require sharing it across slices — defeating the purpose. Horizontal layers match the transformation pipeline and let features compose through it.

**Non-goals:**
- Does not mandate module decomposition within layers
- Does not prescribe testing strategy per layer
- Does not define a formal dependency rule with automated enforcement
