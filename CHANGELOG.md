# Changelog

## 0.2.0 — 2026-11-16

- Admin-owned persistent custom supergraphic SVG override with upload, reset and sandboxed image response.
- Spreadsheet-like edit modes for Timesheet and Task Tracking: inline edits, keyboard navigation and TSV paste.
- Admin All engineers timesheet grid with Engineer / Status / Task ID / Role / day columns.
- Exact 32-column Task Tracking table, migration of existing catalog databases and historical actual baselines.
- Wide month-specific Timesheet Excel import/export, 32-column Task Tracking import/export and detailed notes export; legacy import compatibility.
- New overview charts for effort composition, weekly EX/QC/support mix, projects and task statuses.
- Preview checks for note-bearing cell collisions and preservation of existing tracking columns on legacy imports.

**Validation:** pure-domain tests pass and TS/TSX syntax checked. Full npm build and browser/API integration tests still need a network-enabled environment.

# Changelog

## 0.1.0 — 2026-11-16

- New Aventics Suite-branded web-only team timesheet scaffold.
- Shared task register and per-engineer SQLite effort databases.
- Authentication, administrator account setup, task editing, daily time entry and deletion.
- Overview, monthly grid, team capacity and task variance screens.
- Excel template, preview validation, task and effort import, monthly workbook exports.
- Documentation of deployment, storage isolation, and current limitations.

**Validation:** four domain tests pass offline. npm installation/browser integration/release verification not executed.
