#!/bin/bash
set -euo pipefail

# ServeTracker Disaster Recovery Fast Restore Script
# Usage: ./scripts/restore_servetracker.sh [path-to-tar-gz]

PROJ_DIR="/home/workspace/Projects/PDFUSAEDIT-zo"
BACKUP_DIR="/home/workspace/Documents/Backups/servetracker"
RESTORE_TMP="/tmp/servetracker_restore_$(date +%s)"

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
tar -xzf "$ARCHIVE" -C "$RESTORE_TMP"

if [ ! -f "$RESTORE_TMP/pdfusaedit.db" ]; then
  echo "[!] Error: Corrupt archive: pdfusaedit.db not found in backup."
  rm -rf "$RESTORE_TMP"
  exit 1
fi

echo "[*] Stopping production process (servetracker-proc)..."
supervisorctl -c /etc/zo/supervisord-user.conf stop servetracker-proc

echo "[*] Backing up current database prior to overwrite..."
if [ -f "$PROJ_DIR/data/pdfusaedit.db" ]; then
  cp "$PROJ_DIR/data/pdfusaedit.db" "$PROJ_DIR/data/pdfusaedit-pre-restore-$(date +%s).db"
fi

echo "[*] Restoring database file..."
cp "$RESTORE_TMP/pdfusaedit.db" "$PROJ_DIR/data/pdfusaedit.db"

if [ -d "$RESTORE_TMP/signatures" ]; then
  echo "[*] Restoring signatures directory..."
  mkdir -p "$PROJ_DIR/data/signatures"
  cp -r "$RESTORE_TMP/signatures/"* "$PROJ_DIR/data/signatures/" 2>/dev/null || true
fi

echo "[*] Starting production process (servetracker-proc)..."
supervisorctl -c /etc/zo/supervisord-user.conf start servetracker-proc

sleep 2
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3150/api/health || echo "FAILED")
echo "[+] Health check status: $HEALTH"

rm -rf "$RESTORE_TMP"
echo "[✓] Restoration complete and verified."
