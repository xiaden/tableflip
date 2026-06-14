# ADR-003: WASM SQLite (sql.js) as the Query Engine

**Status:** Accepted  
**Date:** 2026-06-14  
**Tags:** architecture, query-engine, sqlite, wasm

## Context

TableFlip ingests spreadsheet data and transforms it into interactive reports. The core product requirement — join multiple sheets, filter rows, group and aggregate, compute subtotals and totals, support calculated columns, and eventually subqueries and window functions — demands a query engine with full relational algebra. Early in development, the team evaluated three approaches to determine how data would be queried in the browser.

Three criteria mattered most:

1. **Query power** — must support JOINs, GROUP BY, aggregations, WHERE filters, subqueries, CTEs, and window functions.
2. **Browser portability** — must run in the browser without a server.
3. **Privacy** — must keep all user data browser-local (per ADR-001).

## Decision

Use **sql.js** — a full build of SQLite 3 compiled to WebAssembly — as the sole query engine. All spreadsheet data is loaded into in-memory SQLite tables at ingestion time (one table per sheet), and all query processing (filtering, joining, aggregating, sorting) is performed through SQL SELECT statements executed against those tables.

The SQL query construction pipeline lives in the Query Layer (`preact/query/`), which generates SQL strings from a report configuration (column selections, filters, aggregations, groupings, joins between source tables). The generated SQL is executed against the sql.js WASM instance, and the result sets are passed to the Report Layer for rendering.

## Consequences

**Enabled capabilities:**
- Full SQL feature surface: JOINs, subqueries, CTEs, window functions, GROUP BY with HAVING, arbitrary expressions — all available on day one without building any of them in TypeScript.
- Mature query optimizer: SQLite's planner handles join ordering, index selection, and query rewriting. The team does not need to build or maintain a query optimizer.
- Privacy by construction: all data stays in the browser WASM heap. Consistent with ADR-001's requirement that no user data leaves the client.

**Accepted costs:**
- **~1.2 MB WASM bundle** — the sql.js binary must be loaded from a CDN (or locally hosted WASM file). The application cannot function as a fully offline single HTML file without pre-loading and caching the WASM binary. This limits deployment to environments where the WASM file is accessible at runtime.
- **WASM heap memory** — all data resides in the sql.js WASM heap, which competes for memory with the Preact UI, AG Grid, and the xlsx parser. Large spreadsheets (millions of cells) may exhaust the heap; there is no spill-to-disk or streaming query option.
- **Serialization overhead** — row data crossing the WASM/JS boundary passes through JSON serialization (sql.js `resultToArray` or `getRowObject`). For large result sets this is a measurable cost, but acceptable given SQLite's processing speed inside WASM.

**Risks:**
- WASM loading failure (CDN outage, incompatible browser) renders the application non-functional. Mitigation: the UI should surface a clear error if sql.js fails to initialize.
- No alternative query path exists — all report operations depend on sql.js. If a future feature requires a query capability SQLite does not support (e.g., streaming joins across HTTP sources), a hybrid approach would require significant architectural change.

## Rejected Alternatives

### JSON-side query processing (TypeScript query engine)

Build a query engine in TypeScript that operates on plain JavaScript arrays and objects. JOINs would be implemented as nested loops or hash maps, GROUP BY as reduce operations, filters as array `.filter()` calls, etc.

**Rejected because:** A side-by-side comparison during early prototyping showed that implementing even basic JOINs and GROUP BY in TypeScript required significant code, and more advanced features (subqueries, CTEs, window functions) would require building a SQL parser, query planner, and execution engine from scratch. Every new report feature would require both a SQL implementation (in the Query Layer) and a matching JS implementation (in the execution engine), doubling maintenance. SQLite already has a battle-tested implementation of all these features. The JSON-side approach offered no advantage — it was neither faster (SQLite in WASM is competitive for in-memory workloads) nor simpler (it would require more code, not less).

### IndexedDB

Store spreadsheet data in IndexedDB object stores and query using IndexedDB's cursor-based API.

**Rejected because:** IndexedDB has no JOIN support, no GROUP BY, no aggregations beyond simple counts. Building a report query on IndexedDB would require extracting all relevant data into JS memory and processing it there — effectively the JSON-side approach with an added IndexedDB round-trip. IndexedDB is designed for key-value and simple indexed lookups, not for a SQL-generating report builder.

## Open Questions

A NoSQL or hybrid approach (e.g., storing some data in SQLite and some in JS memory, or using a document store for unstructured data while keeping relational data in SQLite) was discussed but never explored deeply. Thus far all ingested data has been tabular (rows and columns) and fits naturally in SQLite. If future features require processing non-tabular or semi-structured data, a hybrid architecture may warrant re-evaluation.

## References

- ADR-001: Local-Only Data Storage and Immutable Source Tables
- sql.js project: https://github.com/sql-js/sql.js/
