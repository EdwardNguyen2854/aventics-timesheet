# Aventics Timesheet

**Aventics Suite** · internal web application · v0.1.0 (development starter)

A browser-based engineering effort tracker that links daily time entries to a shared task register by **Task ID**. React + TypeScript frontend, Fastify + TypeScript API, SQLite file storage on a single internal server. **No Electron, no desktop client.**

> Status: functional source implementation, **not a production-certified release**. Four pure-domain tests pass. Package installation and browser/API integration tests could not be run in the offline build environment; finish the checklist before production use.

## Features

- Login with individually managed engineer accounts; administrators can create engineers and reset passwords.
- Overview: team effort, EX/QC/non-project hours, daily distribution, task status summary.
- Timesheet: click any date and log hours per task, role, or absence category; delete and re-enter corrections.
- Task register: serial number, IP number, task name, Task ID, status, start/completion dates, EX/QC estimates, email subject; compare against lifetime actual effort.
- Team capacity: daily 8-hour reference, weekend shading, exceptions, breakdown by engineer.
- Excel: download workbook template; validate and preview Tasks or Effort sheet before import; export catalog (including per-engineer EX/QC breakout and totals), individual month, or all engineers' month.
- Data separation: shared task catalog + SQLite database per engineer under a configurable internal server data root.

## Run locally (Windows PowerShell or Bash)

Requires **Node.js 22+** and a working npm registry / internal package mirror, including native `better-sqlite3` installation prerequisites.

```powershell
# From the repository root
Copy-Item .env.example .env
# Edit .env: set a LONG BOOTSTRAP_ADMIN_PASSWORD, a local DATA_ROOT, HOST, PORT
npm install
npm run dev
```

Open **http://127.0.0.1:5173** for development. Initial username comes from `BOOTSTRAP_ADMIN_USERNAME` (default `admin`), password from `.env`.

Production build:

```powershell
npm run build
npm start
```

Build output is served by the API at **http://127.0.0.1:4177**, or via an HTTPS reverse proxy. `.env` is only used to bootstrap or configure the service; never commit it. When starting through npm workspaces, use an **absolute** `DATA_ROOT` (recommended) so working-directory changes cannot move data unexpectedly.

## Data model and storage

Example with the **Node application deployed on the internal server machine** and `DATA_ROOT=D:\AventicsData\Timesheet`:

```text
D:\AventicsData\Timesheet\
  shared\
    catalog.sqlite               # users, sessions, shared tasks
    imports\                     # archived task workbook imports
  users\
    duynk\
      effort.sqlite               # this engineer's daily entries
      imports\                   # uploaded workbook archives
      exports\                   # reserved for optional archived exports
    hieudc\
      effort.sqlite
      imports\
      exports\
```

**Important:** SQLite databases must be on a filesystem local to the one and only API server, not opened by many machines over SMB/UNC. Team members connect by browser; the Node server alone reads/writes SQLite. If your corporate network exposes a remote share, run the API on that file server or use server-local SQLite plus scheduled export/backup to the share. Do not use a second API process pointed at the same databases.

The directory name is the engineer's immutable slug-style username. Personnel cannot request/write another engineer's records via the API; administrators can manage all engineers. Passwords are salted and scrypt-hashed, session tokens stored hashed in the shared DB. Cookies are HttpOnly, SameSite=Strict; enable Secure behind HTTPS. Restrict reverse-proxy and firewall access to your internal LAN/VPN; the app does not include enterprise SSO.

## Excel workflow

1. From **Import / Export**, download the template or use [`docs/aventics-timesheet-template.xlsx`](docs/aventics-timesheet-template.xlsx).
2. Fill **Tasks** first (admin), with unique stable `Task ID`, `IP No.`, `Serial No.`, status, estimates.
3. Fill **Effort**: one row per `Date`, `Engineer`, `Task ID`, `Kind`, `Role`, `Hours`, `Note`.
4. Preview the workbook in the corresponding import mode. Confirm only when validation is clean.
5. Re-importing the same date / task / kind / role / note combination **updates** hours; other entries remain unchanged. Import does not automatically delete missing rows.
6. Export task data and monthly efforts back into .xlsx.

**Example rows are illustrative, not real data**. Delete them before importing.

Daily grid columns from an older Excel workbook must first be flattened into individual dated Effort rows. The task table from a legacy workbook is accepted if headers match, but time-grid cell coordinates cannot safely be used without their engineer/date/role context. Historical aggregate actual hours without dates cannot become daily timesheet records. Excel day/month inputs such as `05.01` without a year are intentionally rejected.

Categories: `Task`, `Meeting/Training`, `Public Holiday`, `Full-day Leave`, `Half-day Leave - 1st`, `Half-day Leave - 2nd`, `Other`. Task records require EX or QC and a known Task ID; non-task records must have Role=`NA` and blank Task ID. Hours are in quarter-hour increments, 0.25–24. Daily totals over 8h are flagged, not blocked.

## Task-tracking mapping

The **Task ID is the join key**, e.g. `4032-ip1767_tm5_r12` links all dated effort entries to one task. `IP No.` groups tasks by engineering project. `Serial No.` is an external serial/reference; it is not a generated numeric database key. Role totals are calculated from daily entries, not entered manually, so there is one source of truth for actual EX/QC.

For future integration with **Aventics Project Desk**, import/sync a task catalog export into the shared Tasks sheet. This starter does **not** access Project Desk's database or auto-sync its internal server folders; integration needs the Project Desk schema and a read-only task source contract. The time log itself remains authoritative here.

## Internal deployment

- Use a dedicated Windows/Linux internal server with a local volume for `DATA_ROOT`, service account permissions restricted to the data tree, and only one Node API process.
- Run an HTTPS reverse proxy (IIS, Caddy, nginx) to `127.0.0.1:4177`. Set `HOST=127.0.0.1` and `SESSION_SECURE=true`, plus corporate network/IP allow-lists and SSO proxy where approved. Never expose port 4177 publicly.
- Place data root **outside** the source, build, package, and public web directory. Never commit `.env` or `*.sqlite` or workbook archives.
- Back up `catalog.sqlite` and each `effort.sqlite` via SQLite's online backup API or during an application stop; copying a live WAL DB without accompanying state is unsafe. Test restoring all user DBs and shared catalog together.
- When rotating an admin password, use the protected admin reset API or initialize a new database with the chosen bootstrap password; changing `.env` alone does not reset an existing account.
- Imports validate first; **Tasks** import commits transactionally to shared DB. **Effort** import commits transactionally *per engineer*. A multi-engineer import is not atomic across all engineer DBs. Archive source workbooks for recovery.
- Secure access, audit/event logging, automated backups, and corporate SSO should be completed before company-wide deployment.

## Commands

| Action | Command |
|---|---|
| Develop | `npm run dev` |
| Build | `npm run build` |
| Test pure rules | `npm test` |
| Type-check after install | `npm run typecheck` |
| Production | `npm start` |

## API overview

| Route | Access | Meaning |
|---|---|---|
| `POST /api/auth/login`, `/logout` | User | Manage login session |
| `GET /api/auth/me` | User | Current identity |
| `GET /api/overview?month=YYYY-MM` | User | Tasks, visible engineer entries, all-time actual totals |
| `GET /api/tasks` | User | Read shared task catalog |
| `POST /api/tasks` | Admin | Create/update task |
| `GET /api/users` | User | Directory |
| `POST /api/users` | Admin | Provision engineer |
| `POST /api/users/:id/password` | Admin | Reset password, revoke sessions |
| `POST /api/entries` | Owner/Admin | Upsert daily time |
| `DELETE /api/entries/:id?userId=...` | Owner/Admin | Delete one entry |
| `GET /api/template` | User | Excel workbook template |
| `POST /api/import/preview?mode=tasks\|effort` | Admin/Owner | Validate without writes |
| `POST /api/import/commit?mode=tasks\|effort` | Admin/Owner | Revalidate and write |
| `GET /api/export?mode=tasks\|effort&month=...&userId=...` | Admin/Owner | Workbook export |

Non-GET requests require `X-Requested-With: aventics-timesheet` and an authenticated same-site session, except login. API origin is not made available through CORS.

## GitHub

The intended private repo is `EdwardNguyen2854/aventics-timesheet`. To publish from this source folder after signing in with the GitHub CLI:

```powershell
git init
git add .
git commit -m "feat: initialize Aventics Timesheet web app"
gh auth login
gh repo create EdwardNguyen2854/aventics-timesheet --private --source . --remote origin --push
```

The connected GitHub API in the current environment did not support **creating** a repository. The repo and a live deployment have not been created by this delivered source package.

## Planned next increments

- Read-only Project Desk task connector with incremental sync; task status conflict policy.
- Corporate SSO/identity integration and per-role audit trail.
- Bulk cell editing and inline edit with revision history.
- Approval/submission periods and admin locking.
- Scheduled online SQLite backup/restore and non-atomic multi-user import recovery.
- Playwright UI tests and live server/API integration tests; CI and release packaging.

This repository is standalone; Aventics Suite supplies its brand/standards but is not a runtime dependency.
