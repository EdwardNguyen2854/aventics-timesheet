# Changelog

## 0.3.0 — 2026-11-16

- Renamed the product to **Aventics Work Desk** to reflect tasks, timesheets, estimation and team capacity.
- Added an annual, all-months-default Timesheet view with a year/month filter and positive-effort-only green intensity scale.
- Added personal Task Tracking row/column/cell highlights, text color, and pins stored per user.
- Added a separate shared Effort Lookup rate catalog, task-linked estimate items, experience factors and explicit apply-to-task action.
- Added admin import of private JSON estimation rates, full-workbook import preview/commit with canonical Task ID matching, and inactive engineer provisioning.
- Added administration controls to activate provisioned accounts and reset passwords.
- Added data-model documentation, privacy rules and Suite manifest capability updates.

**Data privacy:** User-supplied internal workbook and reference-rate data are not committed to the public source repository.

# Changelog

## 0.2.1 — 2026-11-16

- Fixed the 32-column Task Tracking table shrinking to the viewport instead of scrolling horizontally.
- Added drag-resizable and keyboard-resizable Task Tracking columns, double-click auto-fit, Reset widths, and persisted browser-local column preferences.
- Kept Serial no. and Project ID sticky during horizontal scrolling, with the Project ID sticky offset following Serial no. resize.
- Added horizontal scroll buttons and a more visible scrollbar.
- Added persistent collapse/expand of the sidebar, including icon tooltips and accessible controls.
- CI validation: tests, TypeScript typecheck, and build are checked by GitHub Actions.


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