# Aventics Timesheet — Agent Notes

Suite agent baseline: 2 (2026-11)

- Component: `aventics.timesheet` · `app` · `incubating`
- Version source of truth: root `package.json`, app package versions, `aventics.manifest.json`, `component.json`.

## Read first

- `README.md` for functionality, storage, and local development.
- `docs/` for import template and data contracts.
- `aventics.manifest.json` for identity and capabilities.
- Aventics Suite baseline and UI Skill in sister repository `aventics-suite`.

## Product invariants

- **Web only**: React frontend served by Node API; never Electron.
- Store all data on one configured internal server `DATA_ROOT`. The central catalog lives in `shared/`; engineer logs live in `users/{engineerId}/effort.sqlite`.
- Never open SQLite DBs over SMB from multiple host machines. Only one API process writes databases.
- Use stable `Task ID` as reference key. Distinguish EX vs QC actual hours; never treat estimate as actual.
- No undated legacy totals may be fabricated into daily records.
- Import is preview-first; do not write until explicit confirm.
- Non-admin users can change only their own daily entries.
- Keep data, secrets, .env, logs, and workbook archives outside source control.
- Preserve Aventics UI Skill: light, square, compact, Bosch logo section and supergraphic, one Bosch blue accent.

## Suite alignment

- App builds and runs without Aventics Suite clone or Suite Host.
- Its manifest and package descriptor are app-owned.
- Writes and destructive actions are explicit; read-only screens never imply writes.
- No automatic cross-repo writes.

## Commands

```text
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm start
```

## Release

- Kind: `web`; production entry point `node apps/server/dist/index.js` behind reverse proxy.
- Node.js is still an external runtime in this development package; not yet a standalone certified portable distribution.
- Future release must package Node runtime, hash artifact, preserve external DATA_ROOT, retain rollback version, and pass suite certification.
- Always keep internal server paths and update destinations configurable.

## Definition of done

- Browser UI compiles; API boots and authorizes correctly; test import preview/commit and round-trip export.
- One engineer cannot read/write another's entries; multi-engineer DBs remain isolated.
- Brand and version metadata consistent; backup/restore verified before production deployment.
