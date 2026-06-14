# Violation Report: ADR-001 — Local-Only Data Storage and Immutable Source Tables

**Proposed artifact:** ADR-001
**Audited by:** support-pattern-enforcer
**Date:** 2026-06-14
**Codebase:** `/workspace/report-thingy/tableflip/SRC/preact/`

---

## VIOLATION: `sidebar.tsx` drops source tables outside `ingestSheet()`

**Severity:** MINOR — user-facing feature; ADR may need clarification

**File:** `ui/sidebar.tsx`, line 37

**ADR-001 states:**

> **Decision 2:** Source tables are immutable after ingestion. ingestSheet() (createTable + insertRows) is an atomic ingestion transaction. After it returns: **no INSERT, UPDATE, DELETE, DROP, ALTER, or CREATE INDEX on source tables.**

**What the code does:** When a user clicks the "remove" button on a loaded table in the sidebar, `handleRemove` calls `dropTable(id)` directly on the source table:

```typescript
// sidebar.tsx:36-49
const handleRemove = useCallback((id: string) => {
  dropTable(id);   // ← DROP on source table, outside ingestSheet()
  getStore().update(draft => {
    delete draft.tables[id];
    delete draft.excludedRows[id];
    delete draft.tableColors[id];
    if (draft.base === id) {
      draft.base = '';
      draft.selCols = null;
      draft.groupBy = [];
      draft.aggregates = [];
      draft.filters = [];
    }
  });
}, []);
```

This is a `DROP TABLE` operation on a user data table that occurs entirely outside of `ingestSheet()` — a direct violation of the letter of ADR-001's immutability guarantee.

**Context:** This is an intentional user-facing feature. A user loads a spreadsheet, then decides they no longer need it and clicks ✕ to remove it. The DROP is the intended behavior — the table should be gone.

**Impact:** The violation is minimal in practice because:
- The action is user-initiated (not automated business logic)
- The table is fully removed, not partially mutated
- Re-importing the same file via `ingestSheet()` would re-create it atomically

However, it means ADR-001's blanket statement is inaccurate. The system currently permits one selective write operation on source tables: user-initiated deletion.

---

## Discussion point: `dropTable` as public API

**File:** `core/sqldb.ts`, line 112; exported via `index.ts:14`

`dropTable` is exported as a public API from the sqldb module. Any consumer (current or future) could call it. Currently only `ui/loader.ts` (during re-ingestion) and `ui/sidebar.tsx` (user removal) use it, but the exposed API creates a latent risk of broader violation.

---

## Areas confirmed compliant

| Requirement | Status | Evidence |
|---|---|---|
| All user data stays browser-local | ✅ PASS | No `fetch()`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon` found in any preact `.ts`/`.tsx` file |
| Zero network calls carry user data | ✅ PASS | Only CDN fetch for sql.js WASM in `core/sqldb.ts:12` (vendor library, no user data); XLSX loaded from local vendored bundle (`index.html:18`) |
| No INSERT/UPDATE/DELETE on source tables outside ingestSheet() | ✅ PASS | Application code (non-test) only does INSERT in `core/sqldb.ts:72` (called from `ui/loader.ts:102` inside `ingestSheet`) |
| No ALTER TABLE or CREATE INDEX anywhere | ✅ PASS | Not found in any preact/ file |
| Report/query layers are read-only | ✅ PASS | `report/engine.ts` only calls `execQuery()` (SELECT); `query/*.ts` only builds SQL strings, never executes |
| Export pipeline is read-only | ✅ PASS | `ui/export.ts` reads from in-memory `state.result`, never queries SQLite |
| excludedRows stored in-memory, not SQLite | ✅ PASS | `draft.excludedRows[id]` in store (reactive state), never written to SQLite |

---

## Recommendation

**Amend ADR-001** to explicitly permit user-initiated table removal. Suggested wording:

> **Decision 2 (amended):** Source tables are immutable after ingestion, with one exception: user-initiated table removal via the sidebar's delete action. This is a full DROP TABLE — not a partial mutation — and is equivalent to the "re-ingestion replacement" model. Programmatic mutations (INSERT, UPDATE, DELETE, ALTER, CREATE INDEX) by any other code path remain prohibited.

Alternatively, if stronger guarantees are desired, change the sidebar to use a UI-only hide mechanism (mark the table as hidden in state) and never DROP the SQLite table. The current approach (DROP) risks data loss if the user accidentally removes a table without reimporting.
