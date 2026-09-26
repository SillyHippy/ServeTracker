#!/usr/bin/env bash
set -euo pipefail

# ServeTracker 1-Click Intraday Disaster Recovery Restore Script
# Restores the newest SQLite snapshot and uploads from local intraday store or Google Drive.

BASE_DIR="/home/workspace/Projects/PDFUSAEDIT-zo"
DATA_DIR="${BASE_DIR}/data"
LOCAL_INTRADAY_DIR="/home/workspace/Documents/Backups/servetracker/intraday"
GAPI_SCRIPT="/root/.hermes/skills/productivity/google-workspace/scripts/google_api.py"
GDRIVE_BACKUP_FOLDER_ID="1VgwMsphaV1yZM-wo6dPBFSF7T-hxVgm0"

echo "[*] ServeTracker Intraday Disaster Recovery Restore"
TARGET_TAR=""

if [[ "${1:-}" == "--from-gdrive" ]] || [[ ! -d "${LOCAL_INTRADAY_DIR}" ]] || [[ $(ls -1 "${LOCAL_INTRADAY_DIR}"/servetracker-intraday-*.tar.gz 2>/dev/null | wc -l) -eq 0 ]]; then
  echo "[*] Fetching latest intraday delta from Google Drive..."
  mkdir -p "${LOCAL_INTRADAY_DIR}"
  SEARCH_OUT=$(python3 "${GAPI_SCRIPT}" drive search --raw-query "'${GDRIVE_BACKUP_FOLDER_ID}' in parents and name contains 'servetracker-intraday-' and trashed = false" 2>/dev/null || echo "{}")
  FILE_ID=$(python3 -c "import sys, json; data=json.loads(sys.argv[1]); files=sorted(data.get('files',[]), key=lambda x: x.get('createdTime',''), reverse=True); print(files[0]['id'] if files else '')" "${SEARCH_OUT}")
  FILE_NAME=$(python3 -c "import sys, json; data=json.loads(sys.argv[1]); files=sorted(data.get('files',[]), key=lambda x: x.get('createdTime',''), reverse=True); print(files[0]['name'] if files else '')" "${SEARCH_OUT}")

  if [[ -n "${FILE_ID}" && -n "${FILE_NAME}" ]]; then
    echo "[+] Found newest Google Drive delta: ${FILE_NAME} (${FILE_ID})"
    TARGET_TAR="${LOCAL_INTRADAY_DIR}/${FILE_NAME}"
    python3 "${GAPI_SCRIPT}" drive download "${FILE_ID}" --output "${TARGET_TAR}"
  else
    echo "[!] No intraday delta found on Google Drive."
  fi
fi

if [[ -z "${TARGET_TAR}" ]]; then
  TARGET_TAR=$(ls -t "${LOCAL_INTRADAY_DIR}"/servetracker-intraday-*.tar.gz 2>/dev/null | head -n 1 || true)
fi

if [[ -z "${TARGET_TAR}" || ! -f "${TARGET_TAR}" ]]; then
  echo "[!] Error: No intraday backup archive found to restore."
  exit 1
fi

echo "[*] Restoring from archive: ${TARGET_TAR}"
RESTORE_TMP="/tmp/servetracker_restore_$(date +%s)"
mkdir -p "${RESTORE_TMP}"
tar -xzf "${TARGET_TAR}" -C "${RESTORE_TMP}"

# Restore database
if [[ -f "${RESTORE_TMP}/pdfusaedit.db" ]]; then
  echo "[*] Restoring database to ${DATA_DIR}/pdfusaedit.db..."
  mkdir -p "${DATA_DIR}"
  cp -f "${RESTORE_TMP}/pdfusaedit.db" "${DATA_DIR}/pdfusaedit.db"
  # Clean up stale WAL/SHM to avoid schema/state mismatch
  rm -f "${DATA_DIR}/pdfusaedit.db-wal" "${DATA_DIR}/pdfusaedit.db-shm"
  echo "[+] Database restored successfully."
fi

# Restore uploads
if [[ -d "${RESTORE_TMP}/uploads" ]]; then
  echo "[*] Syncing restored uploads into ${DATA_DIR}/uploads..."
  mkdir -p "${DATA_DIR}/uploads"
  cp -rn "${RESTORE_TMP}/uploads/"* "${DATA_DIR}/uploads/" 2>/dev/null || true
  echo "[+] Uploads synced."
fi

# Integrity check
echo "[*] Running SQLite integrity check..."
INTEGRITY=$(sqlite3 "${DATA_DIR}/pdfusaedit.db" "PRAGMA integrity_check;")
echo "[+] Integrity result: ${INTEGRITY}"

rm -rf "${RESTORE_TMP}"
echo "[✓] Disaster recovery restore completed successfully."
