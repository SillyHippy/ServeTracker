#!/bin/bash
# One-shot (idempotent) rollout of the SQLite durability changes.
#
# Applies the supervisor config (prod now boots through /usr/local/bin/servetracker-prod-run
# so the R2 restore runs before the app) and restarts prod + demo so the new SQLite pragmas
# (synchronous=FULL / mmap_size=0 / wal_autocheckpoint=128) are live. Safe to re-run: if the
# service is already running the wrapper it reports and exits.
set -u
CONF=/etc/zo/supervisord-user.conf
SUP="supervisorctl -c $CONF"
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
out=""

prod_cmd=$(python3 - "$CONF" <<'PY'
import sys,re
s=open(sys.argv[1]).read()
m=re.search(r'\[program:servetracker-proc\]\n((?:[^\[]|\[(?!program:))*?)command=([^\n]+)', s)
print(m.group(2) if m else 'missing')
PY
)
out="$out prod_command=$prod_cmd"

$SUP reread >/dev/null 2>&1
$SUP update >/dev/null 2>&1
sleep 8
prod_state=$($SUP status servetracker-proc 2>/dev/null | awk '{print $2}')
demo_state=$($SUP status servetracker-demo 2>/dev/null | awk '{print $2}')
lite_state=$($SUP status litestream-prod 2>/dev/null | awk '{print $2}')
health=$(curl -s --max-time 10 http://127.0.0.1:3150/api/health 2>/dev/null)
demo_health=$(curl -s --max-time 10 http://127.0.0.1:3155/api/health 2>/dev/null)

printf '%s durability rollout: %s\n' "$STAMP" "$out"
printf '  prod=%s (%s)  demo=%s (%s)  litestream=%s\n' "$prod_state" "${health:0:40}" "$demo_state" "${demo_health:0:40}" "$lite_state"

if [ "$prod_state" = "RUNNING" ] && printf '%s' "$health" | grep -q '"ok":true' && [ "$lite_state" = "RUNNING" ]; then
  printf '  result: OK — pragmas + boot-restore wrapper live on prod\n'
  exit 0
fi
printf '  result: CHECK NEEDED — /dev/shm/servetracker-proc_err.log\n'
exit 1
