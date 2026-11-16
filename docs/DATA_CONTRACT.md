# Data contract v2 — Aventics Timesheet

## Stable identity

- `users.id`: immutable engineer slug and folder key. `tasks.id`: full Task ID; unique across projects.
- `entries.id`: UUID; uniqueness `(date, task_id, kind, role, note)` within each engineer SQLite database.
- `shared/catalog.sqlite` stores Task Tracking; `users/<id>/effort.sqlite` stores daily logs.
- Catalog migration is additive and idempotent; schema upgrades via `PRAGMA table_info` and `ALTER TABLE`.

## Task Tracking — 32 columns

The exact ordered headers are defined in `apps/server/src/excel.ts` (`TRACKING_COLUMNS`), and the client mirrors them in `apps/web/src/api.ts`.

| Spreadsheet | Database / calculation |
|---|---|
| Serial no., Project ID, Series, Revision, Task ID, Task Name, Mail Subject | `serial_no`, `ip_no`, `series`, `revision`, `id`, `name`, `email_subject` |
| Engineer, QC Engineer | `engineer`, `qc_engineer` (text, not logins for access control) |
| Estimation Effort, Estimation time for QC | `estimated_ex`, `estimated_qc` |
| Actual effort, QC effort | `actual_ex_baseline + recorded EX`, `actual_qc_baseline + recorded QC` |
| Rework effort, Status | `rework_effort` (text), `status` |
| Planned Start Date, Actual Start Date, Planned completion Date, Actual completion Date | `planned_start_date`, `start_date`, `planned_completion_date`, `completion_date` |
| Activity code, Required Internal (Sent for Peer QC), Task Completion date with Self QC | `activity_code`, `required_internal`, `self_qc_completion_date` |
| No of Internal Error, Flexibility, Customer Approval date | `internal_errors`, `flexibility`, `customer_approval_date` |
| Type of task, Code no. ADD, Code no. UPDATE | `task_type`, `code_add`, `code_update` |
| Total Estimation Effort, Total Actual effort | Calculated EX + QC (not persisted) |
| MU-Execution, MU-QC | `mu_execution`, `mu_qc` |

All task dates use ISO `YYYY-MM-DD` internally. Excel date serials and `DD.MM.YYYY` are recognized on import.

### Actual effort reconciliation

Historical totals loaded via Task Tracking are **baselines**. Timesheet EX/QC entries are added to them. Reimporting an unchanged app-generated Task Tracking export preserves the previous baseline when exported totals match the current baseline + logged time; changed imported totals produce a warning if entries are already logged. Avoid importing the same historical work as daily logs and baseline hours.

## Timesheet grid — month-dependent

Header: `Engineer | Status | Task ID | Role | 01.01.2026 | ...` (all days of selected month).

- Task: `Task ID` nonblank, role `EX` or `QC`, Status informational (taken from task catalog on export).
- Non-task: blank Task ID, Status equal to entry category, Role `NA`.
- Each nonempty day cell creates/updates an effort entry with `note=''`. Zero / blank on import does not delete existing entries.
- Existing entries with notes in the target cell are **protected**: a wide-grid import with colliding cells is rejected; edit them in the detail editor.
- Older `Tasks` and row-based `Effort` sheets remain importable.
- Exported `Effort Details` sheet preserves notes and individual records. A wide grid has aggregated cells, not all note metadata.

## Authorization and transactions

- Engineers can read/update only their own daily entries. Admins can view/edit all engineers using the Timesheet `All engineers` selector.
- Task editing, bulk task paste, branding and shared catalog imports are admin-only.
- Bulk changes are validated before writes; one transaction per engineer DB. Cross-engineer batches are not atomic across files.
- Imports are preview-first. Excel exported task totals are derived, never directly stored.

## Custom SVG supergraphic

- Admin `POST /api/branding/supergraphic` replaces `shared/branding/supergraphic.svg`, and `DELETE` restores the fallback.
- Served via read-only SVG image endpoint with a sandboxed CSP. The upload validator blocks active/external references and limits size to 256 KB.
- SVG data is outside the app/repo and survives code upgrades; do not commit custom internal brand assets to the public repo.
