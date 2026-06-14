# Subreport Detail Rows — Plan Index

## Feature Overview

Adds "detail bands" (subreport detail rows) to the tableflip report engine. Users can configure 1:N child tables whose rows are displayed beneath each parent row, with two display modes: interleaved (separate bands) or cross-product (stacking).

## Design Document

`artifacts/designs/pending/DD-subreport-detail-rows.md`

## Plans

| Plan | Title | Phases | Steps | Dependencies |
|------|-------|--------|-------|--------------|
| [A](pending/TASK-subreport-detail-rows-A-mvp.md) | MVP — Core Types, Query Gen, Basic UI, Stitching (incl. stacking & mode toggle) | 14 | 72 | None |
| [B](pending/TASK-subreport-detail-rows-B-export.md) | Export Enhancements — Section Headers, Band Styling | 5 | 19 | Plan A |
| [C](pending/TASK-subreport-detail-rows-C-polish.md) | Polish — Grid Styling, Reorder, Warning Dialog, Performance | 6 | 29 | Plans A, B |

## Dependency Graph

```
A (MVP + stacking)
├── B (Export)
└── C (Polish) ← requires A and B
```

## Execution Order

1. **Plan A** — Foundation: types, state, serialization, catalog, query gen, engine, validation, UI, all PE amendments, test fixtures. Also includes stacking mode, mode toggle, and crossProductRows (originally a separate B plan, consolidated during implementation).
2. **Plan B** — Export: section headers, band styling, CSV handling
3. **Plan C** — Polish: grid styling, reorder, warning dialog, performance, published output

## Contracts

See [CONTRACTS.md](CONTRACTS.md) for all new types, functions, and state shape changes.
