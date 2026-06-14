# ADR-001: Local-Only Data Storage and Immutable Source Tables

**Status:** Proposed  
**Date:** 2026-06-14  
**Tags:** privacy, data-integrity, architecture, storage  

## Context

TableFlip ingests financial spreadsheets. Any server-side storage or network transmission of user data creates privacy and legal exposure (GDPR, financial compliance). The system must guarantee that source data is never mutated by the application. This ADR defines the storage boundaries and immutability contract.

## Decision

1. **All user data stays browser-local.** Zero network calls carry user data. "User data" includes spreadsheet rows, .rcjson config, column labels, excluded row sets, and any derived values. The only network traffic permitted is CDN fetches of vendor library code (AG Grid, etc.), which carry no user data in request or response.

2. **Source tables are immutable after ingestion.** The ingestSheet() function (createTable + insertRows) constitutes an atomic ingestion transaction. After it returns, no system-initiated INSERT, UPDATE, DELETE, DROP, ALTER, or CREATE INDEX on source tables is permitted.

3. **User-initiated source table removal and re-import are permitted.** Dropping a table via the UI and re-importing a spreadsheet are user actions, not system mutations. These are the only valid write paths to source tables outside of initial ingestion.

4. **User operations act on representations, never source tables.** Representations are query-time transformations (filters, calculated columns, aggregations) or in-memory overrides (excludedRows, column labels). Never cloned copies of source tables. Future cell-edit features must operate on overrides or derived tables, never UPDATE source tables.

## Consequences

**Accepted constraints:**
- Browser memory limits — large spreadsheets may exhaust WASM heap; no server-side spillover
- No multi-tab sync — each tab has independent SQL.js instance and store
- Exports produce derived views, not byte-identical source files (merged cell structure, type coercion artifacts may differ)

**Rejected alternatives:**
- Server-based storage — rejected for privacy and legal compliance. No backend, no auth, no data-at-rest exposure.
- Convention-only immutability — rejected as insufficient. Structural enforcement (a SourceTableRegistry or read-only transaction mechanism) is preferred over code-review discipline.
