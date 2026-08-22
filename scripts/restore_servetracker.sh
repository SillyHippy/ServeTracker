#!/bin/bash
set -euo pipefail

# ServeTracker Disaster Recovery Fast Restore Script
# Restores Database, Signatures, and Full Uploads Evidence Archive
# Usage: ./scripts/restore_servetracker.sh [path-to-tar-gz]

PROJ_DIR="/home/workspace/Projects/PDFUSAEDIT-zo"
DATA_DIR="$PROJ_DIR/data"
BACKUP_DIR="/home/workspace/Documents/Backups/servetracker"
TIMESTAMP="$(date +%s)"
RESTORE_TMP="/tmp/servetracker_restore_$TIMESTAMP"

echo "=== ServeTracker Disaster Recovery Restore ==="

if [ -n "${1:-}" ]; then
  ARCHIVE="$1"
else
  ARCHIVE=$(ls -t "$BACKUP_DIR"/servetracker-prod-backup-*.tar.gz 2>/dev/null | head -n 1 || true)
fi

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "[!] Error: No backup archive found to restore."
  exit 1
fi

echo "[*] Target Backup Archive: $ARCHIVE"
echo "[*] Checksum: $(sha256sum "$ARCHIVE" | awk '{print $1}')"

mkdir -p "$RESTORE_TMP"
echo "[*] Unpacking archive to temporary workspace..."
tar -xzf "$ARCHIVE" -C "$RESTORE_TMP"

if [ ! -f "$RESTORE_TMP/pdfusaedit.db" ]; then
  echo "[!] Error: Corrupt archive: pdfusaedit.db not found in backup."
  rm -rf "$RESTORE_TMP"
  exit 1
fi

# Validate DB integrity before touching production
echo "[*] Validating SQLite integrity check on backup file..."
INTEGRITY_CHECK=$(sqlite3 "$RESTORE_TMP/pdfusaedit.db" "PRAGMA integrity_check;" || echo "FAILED")
if [ "$INTEGRITY_CHECK" != "ok" ]; then
  echo "[!] Error: Integrity check failed: $INTEGRITY_CHECK"
  rm -rf "$RESTORE_TMP"
  exit 1
fi
echo "[+] Database integrity verified: OK"

echo "[*] Stopping production process (servetracker-proc)..."
supervisorctl -c /etc/zo/supervisord-user.conf stop servetracker-proc || true

echo "[*] Preserving pre-restore safety snapshots..."
mkdir -p "$DATA_DIR"
if [ -f "$DATA_DIR/pdfusaedit.db" ]; then
  cp "$DATA_DIR/pdfusaedit.db" "$DATA_DIR/pdfusaedit-pre-restore-$TIMESTAMP.db"
fi

echo "[*] Restoring database file..."
cp "$RESTORE_TMP/pdfusaedit.db" "$DATA_DIR/pdfusaedit.db"

if [ -d "$RESTORE_TMP/signatures" ]; then
  echo "[*] Restoring signatures directory..."
  mkdir -p "$DATA_DIR/signatures"
  cp -r "$RESTORE_TMP/signatures/"* "$DATA_DIR/signatures/" 2>/dev/null || true
fi

if [ -d "$RESTORE_TMP/uploads" ]; then
  echo "[*] Restoring uploads evidence archive..."
  mkdir -p "$DATA_DIR/uploads"
  cp -r "$RESTORE_TMP/uploads/"* "$DATA_DIR/uploads/" 2>/dev/null || true
fi

echo "[*] Starting production process (servetracker-proc)..."
supervisorctl -c /etc/zo/supervisord-user.conf start servetracker-proc

echo "[*] Waiting for API health check..."
sleep 2
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3150/api/health || echo "FAILED")
echo "[+] Health check status: $HEALTH"

if [ "$HEALTH" == "200" ]; then
  echo "[✓] ServeTracker restored and fully healthy!"
else
  echo "[!] Warning: Health check returned $HEALTH, inspect logs with supervisorctl."
fi

rm -rf "$RESTORE_TMP"
echo "[✓] Restoration runbook completed."
