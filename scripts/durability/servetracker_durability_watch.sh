#!/bin/bash
# ServeTracker durability watchdog (silent on success; prints + exit 1 on problems).
#
# Guards the fix for the 2026-09-16 data loss: prod SQLite on the 9p rootfs lost committed
# rows when the container hard-restarted. Litestream streams prod's WAL to Cloudflare R2
# within ~1s and /usr/local/bin/servetracker-restore-from-r2 replays it at boot.
#
# IMPORTANT: an idle database writes nothing, so "no new replica objects" is NOT a fault.
# Rules:
#   1. replicator not RUNNING                       -> alert
#   2. no replica objects at all                    -> alert
#   3. recent DB writes + replica older than 5 min  -> alert (real stall)
#   4. recent DB writes + WAL larger than 50 MB     -> alert (checkpointing not landing)
#   5. idle DB (no writes for 30 min)               -> no stall check, stay silent
set -u
CONF=/etc/zo/supervisord-user.conf
SUP="supervisorctl -c $CONF"
ENVF=/etc/zo/litestream-prod.env
DB=/home/workspace/Projects/PDFUSAEDIT-zo/data/pdfusaedit.db
ACTIVE_WINDOW=1800
STALL_LIMIT=300
WAL_LIMIT=52428800
problems=""
NOW=$(date -u +%s)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
lag="n/a"

state=$($SUP status litestream-prod 2>/dev/null | awk '{print $2}')
[ "$state" = "RUNNING" ] || problems="$problems litestream-prod=${state:-missing}"

# How long since prod last wrote anything? WAL mtime catches every write (including tables
# this script does not sample); the row timestamps below catch writes not yet flushed.
idle=999999
if [ -f "$DB-wal" ]; then
  m=$(stat -c%Y "$DB-wal" 2>/dev/null || echo 0); idle=$(( NOW - m ))
elif [ -f "$DB" ]; then
  m=$(stat -c%Y "$DB" 2>/dev/null || echo 0); idle=$(( NOW - m ))
fi
db_new=$(timeout 30 sqlite3 "file:$DB?mode=ro" "
  SELECT COALESCE(MAX(t),'') FROM (
    SELECT MAX(entered_at) FROM serve_attempts
    UNION ALL SELECT MAX(created_at) FROM audit_logs
    UNION ALL SELECT MAX(updated_at) FROM client_cases
    UNION ALL SELECT MAX(updated_at) FROM clients
    UNION ALL SELECT MAX(created_at) FROM sms_logs
  );" 2>/dev/null | head -1)
if [ -n "${db_new:-}" ]; then
  e=$(date -u -d "$db_new" +%s 2>/dev/null || echo 0)
  if [ "$e" -gt 0 ]; then d=$(( NOW - e )); [ "$d" -lt "$idle" ] && idle=$d; fi
fi

if [ -f "$ENVF" ]; then
  set -a; . "$ENVF"; set +a
  export AWS_ACCESS_KEY_ID="${LITESTREAM_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${LITESTREAM_SECRET_ACCESS_KEY}"
  newest_obj=$(/usr/local/bin/aws --endpoint-url "$LITESTREAM_ENDPOINT" s3 ls \
      "s3://${LITESTREAM_BUCKET}/litestream/prod/generations/" --recursive 2>/dev/null \
      | sort | tail -1 | awk '{print $1" "$2}')
  if [ -z "$newest_obj" ]; then
    problems="$problems no-replica-objects"
  else
    obj_epoch=$(date -u -d "$(echo "$newest_obj" | awk '{print $1"T"$2}')" +%s 2>/dev/null || echo 0)
    lag=$(( NOW - obj_epoch ))
    if [ "$idle" -lt "$ACTIVE_WINDOW" ] && [ "$lag" -gt "$STALL_LIMIT" ]; then
      problems="$problems replication-stalled(backlog=${lag}s,last_write=${idle}s ago)"
    fi
  fi
fi

wal_sz=$(stat -c%s "$DB-wal" 2>/dev/null || echo 0)
if [ "$idle" -lt "$ACTIVE_WINDOW" ] && [ "$wal_sz" -gt "$WAL_LIMIT" ]; then
  problems="$problems wal-oversized(${wal_sz}B)"
fi

if [ -n "$problems" ]; then
  printf '%s ServeTracker durability WATCH:%s\n' "$STAMP" "$problems"
  printf '  litestream=%s last_db_write=%s (%ss ago) replica_lag=%ss wal=%sB\n' \
    "${state:-?}" "${db_new:-none}" "$idle" "$lag" "$wal_sz"
  exit 1
fi
exit 0
