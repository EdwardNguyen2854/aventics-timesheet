# Data contract v1

## Keys

`users.id`: immutable slug identifier, also the per-engineer folder name. `tasks.id`: full external Task ID string such as `4032-ip1767_tm5_r12` (not Serial No). `entries.id`: generated UUID. Entry references `task_id` by stable external key; the link is validated in the API against the shared catalog.

## Task columns

`id`, `serial_no`, `ip_no`, `name`, `status`, `estimated_ex`, `estimated_qc`, `email_subject`, `start_date`, `completion_date`, `updated_at`. Status: `Not started`, `In progress`, `Sent to QC`, `Completed`, `On hold`, `Cancelled`.

## Daily effort columns

`id`, `date` (ISO), `task_id` (blank for non-task), `kind`, `role`, `hours`, `note`, `created_at`, `updated_at`.

Uniqueness: `(date, task_id, kind, role, note)` **within each engineer database**. Reimport/upsert uses the same compound key; change the note intentionally to represent a distinct entry. Hours are multiples of 0.25 and 0.25–24. A person may have 8+ hours in a day; the UI displays a warning, not a blocker.

## Derived values

Actual EX effort per task = sum(hours) over all users and all dates where `kind='Task'` and `role='EX'`. QC analogous. Variance = lifetime EX+QC actual − (estimated EX+QC). The Task Register displays the actuals only across the **visible engineers** (all for admin, self for member) and labels this explicitly. Monthly dashboard uses only entries within the chosen month. Non-project categories never add to EX/QC actual.

## XLSX schema

- Tasks header: `Status`, `Serial No.`, `IP No.`, `Task Name`, `Task ID`, `Start Date`, `Completion Date`, `Estimated EX Effort`, `Estimated QC Effort`, `Email Subject`.
- Effort header: `Date`, `Engineer`, `Task ID`, `Kind`, `Role`, `Hours`, `Note`.
- Notes: `YYYY-MM-DD` dates, engineer login ID, exact Task ID, quarter-hour hours, statuses and categories per template.

## Cross-database guarantees

The `Tasks` sheet import has a single SQLite transaction. `Effort` imports are one transaction per engineer; mixed-user imports can partially commit if a later user's database operation fails. Input files are archived after successful commit. Import preview validates row schemas, memberships, existing task references and basic integrity; it does not perform a complex all-user transaction dry run. Production migration should add audit and recovery checkpoints.
