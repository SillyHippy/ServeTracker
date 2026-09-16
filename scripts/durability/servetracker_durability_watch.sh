#!/bin/bash
# ServeTracker durability watchdog (silent on success; prints + exit 1 on problems).
#
# Guards the fix for the 2026-09-16 data loss: prod SQLite on the 9p rootfs lost committed
# rows when the container hard-restarted. Litestream now streams prod's WAL to Cloudflare R2
# within ~1s and /usr/local/bin/servetracker-restore-from-r2 replays it at boot.
# This job alerts if the replicator is down, if replication has stalled, or if the WAL is
# growing without bound (checkpointing broken).
set -u
CONF=/etc/zo/supervisord-user.conf
SUP="supervisorctl -c $CONF"
ENVF=/etc/zo/litestream-prod.env
DB=/home/workspace/Projects/PDFUSAEDIT-zo/data/pdfusaedit.db
ENVF2=$ENVF
problems=""
NOW=$(date -u +%s)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

state=$($SUP status litestream-prod 2>/dev/null | awk '{print $2}')
[ "$state" = "RUNNING" ] || problems="$problems litestream-prod=${state:-missing}"

# replicate lag: newest object in R2 vs newest write in the DB
if [ -f "$ENVF2" ]; then
  set -a; . "$ENVF2"; set +a
  export AWS_ACCESS_KEY_ID="${LITESTREAM_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${LITESTREAM_SECRET_ACCESS_KEY}"
  newest_obj=$(/usr/local/bin/aws --endpoint-url "$LITESTREAM_ENDPOINT" s3 ls \
      "s3://${LITESTREAM_BUCKET}/litestream/prod/generations/" --recursive 2>/dev/null \
      | sort | tail -1 | awk '{print $1" "$2}')
  if [ -z "$newest_obj" ]; then
    problems="$problems no-replica-objects"
  else
    obj_epoch=$(date -u -d "$(echo "$newest_obj" | awk '{print $1"T"$2}')" +%s 2>/dev/null || echo 0)
    lag=$(( NOW - obj_epoch ))
    [ "$lag" -gt 600 ] && problems="$problems replication-stalled(${lag}s)"
  fi
fi

# DB activity vs WAL size: a runaway WAL means checkpoints are not landing
if [ -f "$DB" ]; then
  db_new=$(timeout 30 sqlite3 "file:$DB?mode=ro" "select coalesce(max(entered_at),'') from serve_attempts;" 2>/dev/null | head -1)
  wal_sz=$(stat -c%s "$DB-wal" 2>/dev/null || echo 0)
  [ "$wal_sz" -gt 52428800 ] && problems="$problems wal-oversized(${wal_sz}B)"
  if [ -n "${db_new:-}" ]; then
    db_new_epoch=$(date -u -d "$db_new" +%s 2>/dev/null || echo 0)
    if [ $(( NOW - db_new_epoch )) -lt 600 ] && [ -n "${lag:-}" ] && [ "$lag" -gt 300 ]; then
      problems="$problems backfill-lagging(attempt=${db_new:0:19} lag=${lag}s)"
    fi
  fi
fi

if [ -n "$problems" ]; then
  printf '%s ServeTracker durability WATCH:%s\n' "$STAMP" "$problems"
  printf '  litestream=%s db=%s wal=%s replica_lag=%ss\n' "${state:-?}" "${db_new:-none}" "${wal_sz:-?}" "${lag:-?}"
  exit 1
fi
exit 0
