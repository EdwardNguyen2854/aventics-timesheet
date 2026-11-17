# Internal server deployment checklist

1. Provision dedicated Windows/Linux server and firewall allow-list (internal LAN/VPN only). Do not expose the API directly to the Internet.
2. Install Node 22+ and a package mirror; run `npm ci` after generating/committing a lock file, or `npm install` on first setup.
3. Set environment root `.env` with server-local absolute `DATA_ROOT`, `BOOTSTRAP_ADMIN_PASSWORD`, `HOST=127.0.0.1`, `PORT=4177`, `SESSION_SECURE=true`.
4. `npm run build`, then start with a process manager as a single instance; only it can access SQLite files.
5. Front with HTTPS IIS/Caddy/nginx proxy and valid internal TLS certificate. Never serve raw port 4177 to untrusted clients.
6. Check `GET /api/health`, sign in, create a user, import sample tasks, import sample efforts, export round-trip, test a member denied access to another's records.
7. Set restricted NTFS/Unix ACLs for data root, backups and service account; do not let web clients access SQLite directly.
8. Schedule SQLite online backups, retention and tested restores. Back up the shared catalog and every user DB, then verify each file and record the backup manifest. The current backups are consistent **per SQLite file** but not atomic across files; quiesce writers for a coordinated production restore point and copy backups off-host.
9. Verify server clock/time zone and workbook dates; all stored dates are ISO without TZ shifts.
10. Complete SSO, authentication rate limits, audit-retention policy, a tested restore rehearsal, and large real-data performance testing before wider organizational rollout.

Caddy example (requires a resolvable *internal* DNS name and TLS):

```caddyfile
worktrack.intranet.example {
    reverse_proxy 127.0.0.1:4177
}
```

This is an example host only, not a configured DNS name or deployment.