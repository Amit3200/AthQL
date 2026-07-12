# Changelog

All notable changes to AthQL are documented here. Version numbers follow [SemVer](https://semver.org/).

Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.3] - 2026-07-13

Improve SQL editor execution, repeat-run results, and Athena-aware autocomplete.

### Added

- **Run selected SQL** — Run or format only the highlighted block in the editor (Cmd/Ctrl+Enter / Format)
- **Mid-query autocomplete** — Suggest columns from tables already in `FROM`/`JOIN`, including alias (`mkv.`) and `database.table` (`dataops.`) notation

### Fixed

- **Repeat-run results** — Clear stale query cache and refresh the results grid on every new execution
- **Autocomplete stability** — Only the active tab drives suggestions; Tab indents instead of inserting `__v`
- **Results panel states** — Show running/loading feedback and surface errors when preview fetch fails

## [1.1.2] - 2026-06-08

Restore past query results from S3 and inspect complex row data as JSON.

### Added

- **Result persistence** — store Athena `output_location` (S3 path) on successful runs in query history
- **Restore last results** — load prior results from **History** or **Saved queries** without re-running SQL
- **Saved query last result** — link latest successful run + S3 path when executing from a saved query tab
- **S3 fallback APIs** — fetch preview rows and download URLs by stored `s3://` path when execution IDs expire
- **Row JSON viewer** — `{}` button on each result row opens a modal with expandable **Tree** and **Raw** JSON views
- **Nested JSON parsing** — string fields containing JSON objects/arrays are parsed for drill-down in the viewer
- **Copy JSON toast** — confirmation when row JSON is copied to clipboard

### Fixed

- Results grid scroll height now accounts for table header and horizontal scrollbar (last row no longer clipped)

## [1.1.1] - 2026-06-08

Custom local dev domain support for `/etc/hosts` setups.

### Added

- **`ATHQL_DEV_HOST`** and **`ATHQL_DEV_ORIGINS`** — allow dev UI on custom hostnames that resolve to `127.0.0.1` (e.g. `http://athql.local:5173`)
- **`ATHQL_DEV_PORT`** — optional Vite port override
- Dev startup prints custom UI URL when configured

### Changed

- Vite listens on all local interfaces when a custom dev host is set (fixes IPv4 `/etc/hosts` → `127.0.0.1` access)
- HMR and `server.origin` configured for custom hostnames
- Backend CORS reads allowed origins from settings instead of hardcoded localhost list

## [1.1.0] - 2026-06-08

UI polish and saved-query organization improvements.

### Added

- **Collapsible sidebar** — icon strip when collapsed; expand to the last active tab
- **About panel** — app version from `/api/health`, links to docs site and GitHub
- **SQL editor themes** — VS Dark/Light plus Cobalt, Monokai, Solarized Dark, and GitHub Light (persisted per browser)
- **Draggable editor/results split** — resize the results pane with a drag handle
- **Empty results state** — hint to run with Cmd/Ctrl+Enter before the first query
- **Folder reorder** — drag-and-drop saved-query folders; new `POST /api/queries/folders/reorder` API
- **Loading splash** — branded placeholder while the React app boots

### Changed

- Saved-query folders default to **expanded**; order follows user-defined `sort_order` instead of alphabetical
- Query history SQL snippets use the same truncated preview styling as saved queries
- Dark-mode tag pill colors softened for readability
- Sidebar footer with author link (`@amit3200`)

### Fixed

- Athena CSV result preview now uses Python's `csv` module (handles quoted commas and escapes correctly)
- SQL autocomplete dot-context regex (`table.column`) matching

## [1.0.0] - 2026-06-07

First stable release — local-first Athena query manager ready for daily use.

### Added

- Multi-tab SQL editor with Monaco, format SQL, and database picker
- Glue catalog explorer and query execution with polling + results grid
- Saved queries with folders, tags, search, and overwrite confirmation
- Query history and CSV download via pre-signed S3 URLs
- Settings UI for AWS profile, region, and workgroup (`config/athql.env`)
- Local SQLite metadata store (`~/.athql/metadata.db`)
- Structured AWS error handling and opt-in debug logging (`ATHQL_DEBUG=1`)
- GitHub Pages site and README documentation

[1.1.3]: https://github.com/Amit3200/AthQL/releases/tag/v1.1.3
[1.1.2]: https://github.com/Amit3200/AthQL/releases/tag/v1.1.2
[1.1.1]: https://github.com/Amit3200/AthQL/releases/tag/v1.1.1
[1.1.0]: https://github.com/Amit3200/AthQL/releases/tag/v1.1.0
[1.0.0]: https://github.com/Amit3200/AthQL/releases/tag/v1.0.0
