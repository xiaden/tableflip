# ADR-005: WASM SQLite (sql.js) as the Query Engine

**Status:** Proposed  
**Date:** 2026-06-14  
**Tags:** data, sqlite, wasm, query-engine  

## Context

TableFlip is a report builder that generates SQL queries against ingested spreadsheet data. The query layer produces JOINs, GROUP BY, window functions, CTEs, subqueries, and aggregates — the full SQL feature surface. These operations need a SQL engine. The only question was: which one, and how does it run in the browser?

## Decision

1. **sql.js (SQLite compiled to WASM) is the sole query engine.** All ingested spreadsheet data is loaded into in-memory SQLite tables. All query processing — including report execution, band expansion, lookups, totals, and subtotals — happens via SQL SELECT statements. No application-level query logic.

2. **CDN primary, vendored fallback.** The WASM binary (~653KB) and JS glue (~49KB) are served from CDN by default. A vendored copy exists in `SRC/js/wasm/` as a fallback when CORS or network conditions block the CDN. This gives resilience without requiring the app to bundle 702KB into every page load.

3. **sql.js was chosen over alternatives because the others required building and maintaining a query engine from scratch.** The comparison was not "SQLite vs. something similar" — nothing similar existed in-browser at the time of decision.

## Consequences

**Positive:**
- Full SQL feature surface available immediately (JOINs, GROUP BY, subqueries, CTEs, window functions, aggregates, HAVING)
- Mature, battle-tested query optimizer from SQLite
- Browser-local execution aligns with ADR-001's privacy guarantee — data never leaves the machine
- The Query layer can generate SQL declaratively without implementing execution logic

**Accepted costs:**
- ~702KB total WASM payload (653KB binary + 49KB JS glue) — requires HTTP fetch, cannot be inlined into HTML
- WASM heap is a fixed ceiling — large spreadsheets (100MB+ of source data) may exhaust memory; no disk-backed spillover
- All queries run on the main thread — no Web Worker offloading (future enhancement, not an architectural decision at this stage)

**Rejected alternatives:**
- **JSON-side processing (TypeScript query engine):** Would require building a SQL parser, planner, and execution engine in application code — thousands of lines with a long tail of edge cases. No performance advantage. Rejected immediately after side-by-side comparison.
- **IndexedDB:** Lacks JOINs, GROUP BY, and aggregations natively. Building these on top of IndexedDB reduces to the JSON-side approach with added I/O overhead. Rejected for the same reasons.
- **NoSQL / graph database:** Representing multi-sheet spreadsheet data as a graph (columns and rows as nodes, relationships as edges) would produce an explosion of edges with no clear query advantage. Interesting for discovery-based merging, but not a fit for a structured report builder.
- **DuckDB-WASM:** Considered but not tested. Larger binary (~4MB compressed). sql.js was already working and sufficient for spreadsheet-scale data.

## Open Question

A hybrid approach — some data in SQLite for query power, some in JS memory for flexibility — was discussed but never explored in depth. Currently out of scope; may warrant re-evaluation if non-tabular data becomes a requirement.
