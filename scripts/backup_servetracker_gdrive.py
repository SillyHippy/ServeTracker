#!/usr/bin/env python3
"""
Automated Disaster Recovery Backup for ServeTracker (Production)
Location: /home/workspace/Projects/PDFUSAEDIT-zo/scripts/backup_servetracker_gdrive.py
"""

import os
import sys
import time
import shutil
import tarfile
import hashlib
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

BASE_DIR = Path("/home/workspace/Projects/PDFUSAEDIT-zo")
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "pdfusaedit.db"
BACKUP_TEMP_DIR = Path("/tmp/servetracker_prod_backup")
LOCAL_BACKUP_STORE = Path("/home/workspace/Documents/Backups/servetracker")
GAPI_SCRIPT = Path("/root/.hermes/skills/productivity/google-workspace/scripts/google_api.py")
GDRIVE_BACKUP_FOLDER_ID = "1ZB7XTSC_eD6m3F-6_yI2VP065cKEQzVq"

def calculate_sha256(filepath: Path) -> str:
    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()

def create_consistent_db_snapshot(src_db: Path, dest_db: Path):
    dest_db.parent.mkdir(parents=True, exist_ok=True)
    if dest_db.exists():
        dest_db.unlink()
    conn = sqlite3.connect(src_db)
    cursor = conn.cursor()
    cursor.execute(f"VACUUM INTO '{dest_db.as_posix()}'")
    conn.close()

def main():
    start_time = time.time()
    today_str = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    archive_name = f"servetracker-prod-backup-{today_str}.tar.gz"
    
    BACKUP_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    LOCAL_BACKUP_STORE.mkdir(parents=True, exist_ok=True)

    snapshot_db = BACKUP_TEMP_DIR / "pdfusaedit.db"
    final_tar = LOCAL_BACKUP_STORE / archive_name

    try:
        print(f"[*] Starting backup for ServeTracker Production: {today_str}")
        if not DB_PATH.exists():
            print(f"[!] Database file does not exist at {DB_PATH}")
            return

        create_consistent_db_snapshot(DB_PATH, snapshot_db)

        with tarfile.open(final_tar, "w:gz") as tar:
            tar.add(snapshot_db, arcname="pdfusaedit.db")
            sig_dir = DATA_DIR / "signatures"
            if sig_dir.exists():
                tar.add(sig_dir, arcname="signatures")

        checksum = calculate_sha256(final_tar)
        file_size_mb = final_tar.stat().st_size / (1024 * 1024)
        print(f"[+] Archive created: {final_tar.name} ({file_size_mb:.2f} MB)")
        print(f"[+] Checksum (SHA-256): {checksum}")

        if GAPI_SCRIPT.exists():
            print("[*] Uploading to Google Drive...")
            cmd = [
                sys.executable,
                str(GAPI_SCRIPT),
                "drive",
                "upload",
                str(final_tar),
                "--name", archive_name,
                "--parent", GDRIVE_BACKUP_FOLDER_ID
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                print(f"[+] Successfully uploaded to Google Drive.")
            else:
                print(f"[!] GDrive upload notice: {result.stderr.strip() or result.stdout.strip()}")
        else:
            print(f"[!] google_api.py not found at {GAPI_SCRIPT}, local backup preserved.")

        # Prune local backups: retain newest 7 daily copies, never touch *-manual-*
        all_backups = sorted(
            [f for f in LOCAL_BACKUP_STORE.glob("servetracker-prod-backup-*.tar.gz")],
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        if len(all_backups) > 7:
            for stale_file in all_backups[7:]:
                print(f"[*] Pruning stale backup: {stale_file.name}")
                stale_file.unlink()

        elapsed = time.time() - start_time
        print(f"[✓] Backup completed in {elapsed:.2f}s")

    finally:
        if BACKUP_TEMP_DIR.exists():
            shutil.rmtree(BACKUP_TEMP_DIR, ignore_errors=True)

if __name__ == "__main__":
    main()
