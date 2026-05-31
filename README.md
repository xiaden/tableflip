## TableFlip

TableFlip is a browser-based report builder for spreadsheet data (`.xlsx`, `.xls`, `.csv`).

### What it does

- Load one or more sheets/files
- Build report layouts with selected columns
- Filter, sort, summarize, and subtotal
- Merge duplicate cells for grouped display
- Export report output to Excel/CSV

### Project structure (minimal)

- `SRC/index.html` — app entry page
- `SRC/style.css` — app styles
- `SRC/js/` — application logic modules + bundled xlsx runtime
- `SRC/THIRD-PARTY-NOTICES.txt` — third-party notices

### Local run

This is a static web app. Serve `SRC/` with any static file server, then open the served URL.

Examples:

- VS Code Live Server on `SRC/index.html`
- Python: `python -m http.server` (from `SRC/`)

> Note: opening `index.html` directly from `file://` may break some browser/runtime behaviors.

### Status

V2 product snapshot.
