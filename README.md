# TableFlip

TableFlip is a browser-based spreadsheet reporting tool for teams who need to turn messy Excel/CSV data into clean, exportable report views quickly.

Built for practical ops workflows: load files, shape data, merge/group rows visually, and export polished output without writing formulas or macros.

## ✨ Features

- Multi-file ingest (`.xlsx`, `.xls`, `.csv`)
- Visual report layout builder
- Filter and sort pipeline
- Grouping modes:
	- no summary
	- summarize
	- keep all rows + totals
	- group rows + subtotals
- Merge-duplicate rendering for grouped readability
- Styled Excel and CSV export
- Browser-only runtime (no backend required)
- Fully bundled third-party runtimes for offline environments

## 🧱 Tech stack

- AG Grid Community (table rendering)
- sql.js (in-browser SQLite query engine)
- SheetJS/xlsx runtime (spreadsheet import/export)

See `SRC/THIRD-PARTY-NOTICES.txt` for full third-party license notices.

## 🚀 Quick start

This is a static web app.

1. Serve the `SRC/` directory with any static file server.
2. Open the served URL in your browser.
3. Load spreadsheet files and build reports.

> Opening directly via `file://` is not recommended.

## 📁 Repository layout

- `SRC/index.html` — app entry page
- `SRC/style.css` — app styles
- `SRC/js/` — app modules and bundled third-party runtimes
- `SRC/THIRD-PARTY-NOTICES.txt` — third-party attribution and license notices

## 🔒 Privacy model

TableFlip runs entirely in the browser.

- No server-side processing is required
- Data stays on the client machine during normal use

If you deploy it behind a server/proxy, your deployment environment policies apply.

## 🧭 Roadmap (near-term)

- App packaging (desktop distribution)
- Additional UX polish for large-report workflows
- Documentation/examples for common report patterns

## 🤝 Contributing

Contributions and issue reports are welcome.

Please read `CONTRIBUTING.md` before opening pull requests.

## 🛡️ Security

If you discover a security issue, please follow `SECURITY.md`.

## 📜 License

This project is licensed under the MIT License. See `LICENSE`.
