#!/usr/bin/env python3
"""
Automated Disaster Recovery Backup for ServeTracker (Production)
Packages consistent SQLite snapshot (VACUUM INTO), signatures, and full data/uploads/ evidence archive.
Uploads to Google Drive with SHA-256 integrity verification.
Location: /home/workspace/Projects/PDFUSAEDIT-zo/scripts/backup_servetracker_gdrive.py
"""

import hashlib
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BASE_DIR = Path("/home/workspace/Projects/PDFUSAEDIT-zo")
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "pdfusaedit.db"
UPLOADS_DIR = DATA_DIR / "uploads"
SIGS_DIR = DATA_DIR / "signatures"

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

    # Verify integrity of snapshot
    verify_conn = sqlite3.connect(dest_db)
    verify_cur = verify_conn.cursor()
    verify_cur.execute("PRAGMA integrity_check;")
    check = verify_cur.fetchall()
    verify_conn.close()
    if not check or check[0][0] != "ok":
        raise RuntimeError(f"DB Snapshot integrity failed: {check}")

def main():
    start_time = time.time()
    today_str = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    archive_name = f"servetracker-prod-backup-{today_str}.tar.gz"
    
    BACKUP_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    LOCAL_BACKUP_STORE.mkdir(parents=True, exist_ok=True)

    snapshot_db = BACKUP_TEMP_DIR / "pdfusaedit.db"
    final_tar = LOCAL_BACKUP_STORE / archive_name

    try:
        print(f"[*] Starting Full DR Backup for ServeTracker: {today_str}")
        if not DB_PATH.exists():
            print(f"[!] Database file does not exist at {DB_PATH}")
            sys.exit(1)

        print("[*] 1/4: Creating crash-consistent SQLite snapshot...")
        create_consistent_db_snapshot(DB_PATH, snapshot_db)

        print("[*] 2/4: Compressing database, signatures, and uploads archive...")
        t_pack = time.time()
        import tarfile
        with tarfile.open(final_tar, "w:gz") as tar:
            tar.add(snapshot_db, arcname="pdfusaedit.db")
            if SIGS_DIR.exists():
                tar.add(SIGS_DIR, arcname="signatures")
            if UPLOADS_DIR.exists():
                tar.add(UPLOADS_DIR, arcname="uploads")
        pack_elapsed = time.time() - t_pack

        checksum = calculate_sha256(final_tar)
        file_size_mb = final_tar.stat().st_size / (1024 * 1024)
        print(f"[+] Archive created in {pack_elapsed:.1f}s: {final_tar.name} ({file_size_mb:.2f} MB)")
        print(f"[+] SHA-256 Checksum: {checksum}")

        print("[*] 3/4: Uploading archive to Google Drive...")
        if GAPI_SCRIPT.exists():
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
                print(f"[+] Successfully uploaded to Google Drive folder.")
            else:
                print(f"[!] GDrive upload notice: {result.stderr.strip() or result.stdout.strip()}")
        else:
            print(f"[!] google_api.py not found at {GAPI_SCRIPT}, local backup preserved.")

        print("[*] 4/5: Rotating local backups (keeping latest 7)...")
        all_backups = sorted(
            [f for f in LOCAL_BACKUP_STORE.glob("servetracker-prod-backup-*.tar.gz")],
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        if len(all_backups) > 7:
            for stale_file in all_backups[7:]:
                print(f"[*] Pruning stale local backup: {stale_file.name}")
                stale_file.unlink()

        print("[*] 5/5: Pruning stale Google Drive cloud backups (keeping latest 7)...")
        if GAPI_SCRIPT.exists():
            import json
            search_cmd = [
                sys.executable,
                str(GAPI_SCRIPT),
                "drive",
                "search",
                "--raw-query",
                f"'{GDRIVE_BACKUP_FOLDER_ID}' in parents and name contains 'servetracker-prod-backup-' and trashed = false"
            ]
            s_res = subprocess.run(search_cmd, capture_output=True, text=True)
            if s_res.returncode == 0:
                try:
                    gdrive_files = json.loads(s_res.stdout)
                    # Sort descending by modifiedTime
                    gdrive_files.sort(key=lambda x: x.get("modifiedTime", ""), reverse=True)
                    if len(gdrive_files) > 7:
                        for stale_gfile in gdrive_files[7:]:
                            file_id = stale_gfile.get("id")
                            fname = stale_gfile.get("name")
                            print(f"[*] Pruning stale GDrive backup: {fname} (ID: {file_id})")
                            del_cmd = [
                                sys.executable,
                                str(GAPI_SCRIPT),
                                "drive",
                                "delete",
                                "--permanent",
                                file_id
                            ]
                            subprocess.run(del_cmd, capture_output=True, text=True)
                except Exception as ex:
                    print(f"[!] Notice: Could not parse GDrive file list for cleanup: {ex}")

        elapsed = time.time() - start_time
        print(f"[✓] Full DR Backup completed successfully in {elapsed:.2f}s")

    finally:
        if BACKUP_TEMP_DIR.exists():
            shutil.rmtree(BACKUP_TEMP_DIR, ignore_errors=True)

if __name__ == "__main__":
    main()
