# Aventics WorkTrack v0.4.0 — Upgrade and rollback

## Pre-deployment (required)

1. Stop any writers to the live v0.3.0 databases and confirm that the API process is shut down.
2. Locate your configured `DATA_ROOT`. Back up **all** files under `shared/` and `users/`, not only the catalog. Copy the snapshot to separate secured storage and test restoring it into an isolated directory. Treat user DBs and the shared catalog as one logical dataset.
3. Preserve your `.env` and the `DATA_ROOT` location; do not overwrite it with `.env.example`.
4. Ensure the internal host is running Node.js 22 or newer, with enough free disk for an online backup set plus a copy of the databases.
5. Make a test copy of DATA_ROOT, run v0.4.0 against that copy, and compare task counts, engineer counts, EX/QC totals and a sampled historical import. Confirm the backup manifest verifies and the browser tests/UX behave on the internal Windows host.
6. Get approval for a production maintenance window; do not combine a schema migration with uncontrolled historical Excel imports.

## Update source

```powershell
git pull origin main
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

On startup, v0.4.0 adds schema migration/audit/import/view tables to shared and engineer SQLite files. Existing task IDs and dated entries are preserved by the intended migration. Test on a copy before using production data.

## Smoke-test the upgraded server

- Log in with an existing account. Verify admins and engineers see only authorized operations.
- Open a 2026 full-year Timesheet, scroll horizontally and vertically, select cells, copy/paste and undo/redo.
- Open a task, compare detail EX/QC totals against the original workbook. Verify `historical baseline + dated entries` is not double-counted.
- Save/reload a personal Task Tracking layout and check annotation persistence.
- Generate an admin backup and inspect the manifest, hashes, and per-file integrity. Copy backup archives to separate storage.
- Preview a legacy workbook, review alias matches and changed-record counts, and test a re-import **only against the copy of DATA_ROOT** before approving production import.

## Rollback

1. Stop the v0.4.0 API and all database writers.
2. Restore the **entire coordinated pre-upgrade DATA_ROOT set** to its original paths, including the shared catalog and every engineer DB; do not mix restored and upgraded SQLite files.
3. Check permissions and run SQLite integrity validation for each restored DB.
4. Return to the last v0.3.0 source commit `5ed579fc53e6a19aaef74ee636acd879b5a87cc0` (or its tagged release), reinstall/build and restart.
5. Compare record counts and the historical EX/QC totals before reopening editing.

Note: The admin backup implementation copies SQLite files sequentially using SQLite's online backup API. Each individual file is consistent, but cross-file activity may happen between files. For precise restore, quiesce writers before backup or restore, and perform reconciliations. There is no one-click restoration in the web UI.

## Known limitations

- `release/v0.4.0` CI uses a synthetic dataset, not the actual internal server database.
- Corporate SSO, independent penetration testing, and large real-data performance tests are not yet complete.
- The source repo currently remains named `aventics-timesheet` until the repository owner renames it through GitHub Settings.
- Bulk imports across engineer SQLite files are journaled and backed up, but not one atomic transaction across all engineer databases.