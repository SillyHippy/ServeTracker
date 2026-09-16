# SQLite durability (prod) — survives a hard container restart

## The problem

Production ServeTracker stores its SQLite database (`data/pdfusaedit.db` + `data/pdfusaedit.db-wal`)
on the container's root filesystem, which on this host is a **9p network mount** (`mount | grep ' / '`).
A hard container restart can drop write-back-cached WAL tail frames, so **committed rows silently
disappear** even though the request already returned 200.

Real incident, 2026-09-16: a serve attempt for `35-2026-DR-001132-AXXX-01` was logged at 18:37:57Z;
the server inserted it and dispatched the client email (Resend, delivered 18:37:57Z) and the
notification SMS (18:38:25Z). The container restarted at 18:49Z. When it came back, the attempt row,
its `audit_logs` entry, its notification and its `sms_logs` row were all gone — the DB's newest
surviving write was 17:28Z. 30-minute local snapshots and the nightly backup did not help.

## The fix (four layers)

1. **Write-path hardening** — `server/db.ts`, `server/sms.ts`:
   `PRAGMA synchronous = FULL`, `PRAGMA wal_autocheckpoint = 128`, `PRAGMA mmap_size = 0`.
   Plus a 60s `wal_checkpoint(TRUNCATE)` timer and a `checkpointWal()` call after every
   `POST /api/serves`, so the newest writes land in the base DB file (the part that survives a
   restart) instead of only in a long-lived WAL tail.
2. **Off-box replication (the real guarantee)** — **Litestream** streams the prod WAL to
   **Cloudflare R2** within ~1s (`litestream/prod/` prefix in the `servetracker-saas` bucket).
   The sandbox can now be destroyed and the DB restored anywhere, at ~1s RPO.
   Launcher: `scripts/durability/litestream-prod-run` (supervisor program `litestream-prod`).
3. **Boot recovery** — `scripts/durability/servetracker-restore-from-r2` runs before the app
   starts (prod boots through `scripts/durability/servetracker-prod-run`). It refuses to touch a
   DB while the app is listening, probes the replica, and only keeps the replica copy when the
   replica is newer than the local DB (backing the local file up first). Idempotent.
4. **Detection** — `scripts/durability/servetracker_durability_watch.sh` runs every 15 min
   (Hermes cron, script-only): alerts if the replicator is down, if replication lags >10 min, or
   if the WAL grows past 50 MB (checkpointing broken). Silent when healthy.

## Install / rollout

```
install -m 700 scripts/durability/litestream-prod-run          /usr/local/bin/
install -m 700 scripts/durability/servetracker-restore-from-r2 /usr/local/bin/
install -m 700 scripts/durability/servetracker-prod-run        /usr/local/bin/
install -m 600 <r2 creds>                                      /etc/zo/litestream-prod.env
# supervisor: [program:litestream-prod] command=/usr/local/bin/litestream-prod-run
#             [program:servetracker-proc] command=/usr/local/bin/servetracker-prod-run
supervisorctl -c /etc/zo/supervisord-user.conf update
```

`/etc/zo/litestream-prod.env` must define `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`,
`LITESTREAM_ENDPOINT`, `LITESTREAM_BUCKET` (never commit real values).

## Verify (drills that must pass)

```
# replica exists and is current
aws --endpoint-url "$LITESTREAM_ENDPOINT" s3 ls s3://$LITESTREAM_BUCKET/litestream/prod/ --recursive

# restore drill into a scratch path, then integrity + row counts
litestream restore -config /dev/shm/litestream-prod.yml -o /tmp/restore-test.db <db path>
sqlite3 /tmp/restore-test.db "PRAGMA quick_check; select count(*) from serve_attempts;"

# recovery drill: run the recovery script against a stale DB copy and confirm it keeps the
# newer replica copy (and backs the local one up)
SERVETRACKER_DB=/tmp/old-copy.db SERVETRACKER_PORT=3199 servetracker-restore-from-r2
```

## Cost (free tier)

Litestream to R2 stays on Cloudflare's free tier: this DB is ~1.4 MB, writes ship as compressed
WAL frames (~hundreds of KB/day), well inside 10 GB storage and 1M Class-A ops/month. The
Postgres cluster's 16 MB WAL segments (~1.3 GB/day) are the part that needs a lifecycle rule —
not this.
