# Aventics Work Desk

**Aventics Suite** · internal engineering work management · v0.3.0 (development build)

A standalone web application for **Task Tracking**, **Timesheet**, **Estimation & Effort Lookup**, and **Team Capacity**. React + TypeScript, Node/Fastify API, SQLite. No Electron or client-side database access.

## What is connected

The canonical **Task ID** links shared Task Tracking records to dated effort entries and saved estimation lines. The employee directory links authenticated users to their own SQLite databases. Reference rates, manual task estimates, actual EX/QC hours, historical baseline hours, and visual pin/highlight annotations are distinct data sources. See [Data Model](docs/DATA_MODEL.md).

## Run on your internal server

Requires Node.js >=22, access to npm dependencies, and a **local disk** for SQLite on the API host.

```powershell
git pull origin main
Copy-Item .env.example .env  # first install only; do not overwrite existing .env
# Configure a secure BOOTSTRAP_ADMIN_PASSWORD on the initial setup and absolute DATA_ROOT.
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

Open **http://127.0.0.1:5173** for development. Production API can serve the built UI at port 4177. Run it behind a restricted corporate HTTPS reverse proxy; set `SESSION_SECURE=true`. Use a single API process and host SQLite on the same machine, never over SMB/UNC.

**Important:** Back up `DATA_ROOT/shared/catalog.sqlite` and every `DATA_ROOT/users/*/effort.sqlite` before running the new schema migrations. Store `.env`, databases, workbook archives and proprietary reference tables outside Git and the web directory.

## Load your private uploaded data

Use **Import / Export → Full workbook** and select your private Excel workbook containing `Task Tracking` + `Timesheet` sheets. The preview validates both and reconciles long legacy task labels using unique `Serial no.-Project ID` Task ID prefixes.

1. Sign in as an administrator, select **Full workbook**, and check **Provision missing engineers as inactive accounts** if needed.
2. Select the original workbook; click **Preview import**. Review errors/warnings and the task/effort counts.
3. Click **Confirm import**. The app writes task metadata to `shared/catalog.sqlite` and dated entries to `users/<username>/effort.sqlite`.
4. In **Administration → Engineer access**, reset passwords and activate provisioned accounts.
5. In **Estimation & Lookup**, upload your private `aventics-work-desk-private-effort-lookup.json` file, or add/edit rates manually.

**No raw internal data is committed in this public GitHub repository.** The GitHub deployment cannot directly modify a SQLite database on your workstation or corporate server; this import runs on the server after your explicit confirmation.

Re-imports update matching daily records. Dates without positive effort are not converted into entries. Exact duplicate task IDs are rejected. Ambiguous task references or conflicting historical statuses are warned/blocked, never guessed.

## UI workflows

- **Timesheet**: defaults to **All months** for the selected year, with month filter and year selector, Excel-style frozen identifiers, horizontal/vertical scrolling, inline edit/paste, and green intensity only for positive logged hours (0.25–2 / 2–4 / 4–6 / 6–8 / 8+).
- **Task Tracking**: 32-column register, editable cells, adjustable column widths, freeze the first two identifiers, personal right-click marks for cells/rows/columns, and row/column pins. Only admins edit shared task fields.
- **Estimation & Lookup**: import private rate JSON, select activity/difficulty, set quantity and experience (Beginner 1.00 / Intermediate 0.90 / Expert 0.80), preview EX/QC hours, save estimate items to a task, then explicitly **Apply to Task Tracking**.
- **Overview and Team capacity**: selected-month summaries of actual work and project status.
- **Import / Export**: preview-first full/partial workbook imports; Task Tracking and monthly Timesheet exports.
- **Administration**: accounts, password resets and activation, optional custom supergraphic SVG.

## Data and safety

- `shared/catalog.sqlite`: tasks, users, sessions, estimation rates, estimate lines and per-user annotations.
- `users/<id>/effort.sqlite`: engineer-specific dated effort entries.
- `shared/branding/supergraphic.svg`: optional uploaded SVG override.
- Existing actual EX/QC baselines are kept separate from dated logs. Task actuals = baseline + logs; task estimates are never actuals.
- User annotations are personal; they cannot modify the Task Tracking source data.
- GitHub Actions runs unit tests, TypeScript typecheck and production build. Browser/API integration with your internal database remains a separate acceptance step.

## Source repository rename

Product name and manifest have been updated to **Aventics Work Desk** (desired repository: `EdwardNguyen2854/aventics-work-desk`). The connected GitHub API does not include repository-administration/rename. The owner must rename the existing repository under GitHub **Settings → General → Repository name**. GitHub normally redirects existing clone URLs, but update your local `origin` after renaming:

```powershell
git remote set-url origin https://github.com/EdwardNguyen2854/aventics-work-desk.git
```

Do not create a second independent copy: rename the existing repository to preserve history, issues and Actions.

## Development commands

```
npm run dev
npm run typecheck
npm test
npm run build
npm start
```

This app is a development build, not yet production-certified for company-wide use. Add corporate SSO, audit logs, automated SQLite online backups, restore rehearsals, and browser integration tests before broad rollout.
