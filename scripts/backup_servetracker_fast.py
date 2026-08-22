#!/usr/bin/env python3
"""
ServeTracker High-Frequency DB Snapshot Script (RPO <= 30 Minutes)
Creates a crash-consistent SQLite snapshot using VACUUM INTO, validates integrity,
and maintains a rolling 48-hour local history (96 snapshots).
"""

import gzip
import hashlib
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

BASE_DIR = Path("/home/workspace/Projects/PDFUSAEDIT-zo")
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "pdfusaedit.db"
SNAPSHOT_DIR = Path("/home/workspace/Documents/Backups/servetracker/snapshots")
RETENTION_COUNT = 96  # 48 hours at 30-min intervals

def calculate_sha256(filepath: Path) -> str:
    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()

def main():
    t0 = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    
    if not DB_PATH.exists():
        print(f"[!] Database file does not exist at {DB_PATH}")
        sys.exit(1)

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    temp_raw_snap = SNAPSHOT_DIR / f".tmp_snap_{now_str}.db"
    final_gz_snap = SNAPSHOT_DIR / f"pdfusaedit-snap-{now_str}.db.gz"

    try:
        # Step 1: Safe non-blocking hot snapshot
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute(f"VACUUM INTO '{temp_raw_snap.as_posix()}'")
        conn.close()

        # Step 2: Integrity verification on snapshot
        verify_conn = sqlite3.connect(temp_raw_snap)
        verify_cur = verify_conn.cursor()
        verify_cur.execute("PRAGMA integrity_check;")
        check_result = verify_cur.fetchall()
        verify_conn.close()

        if not check_result or check_result[0][0] != "ok":
            print(f"[!] Snapshot integrity check failed: {check_result}")
            if temp_raw_snap.exists():
                temp_raw_snap.unlink()
            sys.exit(2)

        # Step 3: Compress to .gz
        with open(temp_raw_snap, "rb") as f_in:
            with gzip.open(final_gz_snap, "wb", compresslevel=6) as f_out:
                shutil.copyfileobj(f_in, f_out)

        temp_raw_snap.unlink()

        checksum = calculate_sha256(final_gz_snap)
        size_kb = final_gz_snap.stat().st_size / 1024
        elapsed = time.time() - t0

        print(f"[✓] 30-min snapshot created: {final_gz_snap.name} ({size_kb:.1f} KB) in {elapsed:.3f}s [SHA256: {checksum[:12]}...]")

        # Step 4: Prune older snapshots beyond 48 hours
        all_snaps = sorted(
            [f for f in SNAPSHOT_DIR.glob("pdfusaedit-snap-*.db.gz")],
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        if len(all_snaps) > RETENTION_COUNT:
            for old_file in all_snaps[RETENTION_COUNT:]:
                old_file.unlink()

    except Exception as e:
        print(f"[!] Fast snapshot error: {e}")
        if temp_raw_snap.exists():
            temp_raw_snap.unlink()
        sys.exit(1)

if __name__ == "__main__":
    main()
