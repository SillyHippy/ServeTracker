#!/usr/bin/env python3
"""Local↔R2 serve-photo sync.

- Upload local files that are not on R2 (or size-mismatch).
- Never skip a path still referenced by live serve_attempt(s)/photos, even if
  it is listed in pruned-excludes.lst. Guest-snapshot prune + 9p recycle is
  what dropped Hopkins/Baig/Stroud JPGs on 2026-09-24.
- Restore live-referenced files from R2 when the local primary is missing.
- Promote any /dev/shm/servetracker-photo-pending copies onto disk first.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ENVF = Path(os.environ.get("LITESTREAM_ENV", "/etc/zo/litestream-prod.env"))
SRC = Path(os.environ.get("UPLOADS_SRC", "/home/workspace/Projects/PDFUSAEDIT-zo/data/uploads"))
PREFIX = os.environ.get("UPLOADS_PREFIX", "uploads-prod")
DB = Path(os.environ.get("SERVETRACKER_DB", "/home/workspace/Projects/PDFUSAEDIT-zo/data/pdfusaedit.db"))
PENDING = Path(os.environ.get("PHOTO_PENDING_DIR", "/dev/shm/servetracker-photo-pending"))
EXCL_FILE = Path(
    os.environ.get(
        "PRUNED_EXCLUDES",
        "/home/workspace/Documents/Backups/servetracker/snapshot-gated/jls/pruned-excludes.lst",
    )
)
LOCK = Path("/dev/shm/servetracker-uploads-prune.lock")
AWS = Path("/usr/local/bin/aws")
LOG = Path(os.environ.get("UPLOADS_SYNC_LOG", "/dev/shm/uploads-watch.log"))


def load_env() -> dict[str, str]:
    env = os.environ.copy()
    if ENVF.is_file():
        for raw in ENVF.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            env[key] = val.strip().strip('"').strip("'")
    env["AWS_ACCESS_KEY_ID"] = env.get("LITESTREAM_ACCESS_KEY_ID") or env.get("AWS_ACCESS_KEY_ID", "")
    env["AWS_SECRET_ACCESS_KEY"] = env.get("LITESTREAM_SECRET_ACCESS_KEY") or env.get("AWS_SECRET_ACCESS_KEY", "")
    return env


def url_to_rel(url: str) -> str | None:
    u = (url or "").strip()
    if "/uploads/" in u:
        return u.split("/uploads/", 1)[1].lstrip("/")
    return None


def live_serve_photo_rels(db: Path = DB) -> set[str]:
    if not db.is_file():
        return set()
    rels: set[str] = set()
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        for sql in (
            "SELECT image_url FROM serve_attempt_photos",
            "SELECT thumbnail_url FROM serve_attempt_photos",
            "SELECT image_url FROM serve_attempts",
            "SELECT thumbnail_url FROM serve_attempts",
        ):
            try:
                for (url,) in con.execute(sql):
                    rel = url_to_rel(str(url or ""))
                    if rel:
                        rels.add(rel)
            except sqlite3.Error:
                continue
    finally:
        con.close()
    return rels


def excluded_rels() -> set[str]:
    if not EXCL_FILE.is_file():
        return set()
    return {ln.strip() for ln in EXCL_FILE.read_text().splitlines() if ln.strip()}


def list_remote(env: dict[str, str]) -> dict[str, int]:
    endpoint = env.get("LITESTREAM_ENDPOINT", "")
    bucket = env.get("LITESTREAM_BUCKET", "")
    out = subprocess.run(
        [str(AWS), "--endpoint-url", endpoint, "s3", "ls", f"s3://{bucket}/{PREFIX}/", "--recursive"],
        env=env, capture_output=True, text=True, timeout=180,
    )
    sizes: dict[str, int] = {}
    if out.returncode != 0:
        return sizes
    for ln in out.stdout.splitlines():
        parts = ln.split(None, 3)
        if len(parts) < 4:
            continue
        try:
            sizes[parts[3]] = int(parts[2])
        except ValueError:
            continue
    return sizes


def promote_pending() -> int:
    if not PENDING.is_dir():
        return 0
    promoted = 0
    dest_dir = SRC / "serves"
    dest_dir.mkdir(parents=True, exist_ok=True)
    for src in PENDING.rglob("*"):
        if not src.is_file():
            continue
        dest = dest_dir / src.name
        if dest.exists() and dest.stat().st_size > 0:
            continue
        shutil.copy2(src, dest)
        promoted += 1
    return promoted


def sync_once() -> dict[str, int]:
    if LOCK.exists():
        return {"skipped": 1, "uploaded": 0, "excluded": 0, "restored": 0, "missing": 0, "promoted": 0}
    env = load_env()
    live = live_serve_photo_rels()
    skip = excluded_rels()
    remote = list_remote(env)
    uploaded = 0
    excluded = 0
    restored = 0
    missing = 0
    promoted = promote_pending()
    endpoint = env.get("LITESTREAM_ENDPOINT", "")
    bucket = env.get("LITESTREAM_BUCKET", "")
    if not SRC.exists():
        return {"skipped": 0, "uploaded": 0, "excluded": 0, "restored": 0, "missing": 0, "promoted": promoted}
    for path in SRC.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if LOCK.exists():
            return {"skipped": 1, "uploaded": uploaded, "excluded": excluded,
                    "restored": restored, "missing": missing, "promoted": promoted}
        rel = path.relative_to(SRC).as_posix()
        if rel in skip:
            excluded += 1
            continue
        key = f"{PREFIX}/{rel}"
        if remote.get(key) == path.stat().st_size:
            continue
        target = f"s3://{bucket}/{key}"
        subprocess.run(
            [str(AWS), "--endpoint-url", endpoint, "s3", "cp", str(path), target, "--only-show-errors"],
            env=env, check=True, timeout=120, capture_output=True, text=True,
        )
        uploaded += 1
        remote[key] = path.stat().st_size
    for rel in sorted(live):
        local = SRC / rel
        if local.is_file() and local.stat().st_size > 0:
            continue
        key = f"{PREFIX}/{rel}"
        if key not in remote:
            missing += 1
            continue
        local.parent.mkdir(parents=True, exist_ok=True)
        tmp = local.with_suffix(local.suffix + ".restore")
        subprocess.run(
            [str(AWS), "--endpoint-url", endpoint, "s3", "cp",
             f"s3://{bucket}/{key}", str(tmp), "--only-show-errors"],
            env=env, check=True, timeout=120, capture_output=True, text=True,
        )
        os.replace(tmp, local)
        restored += 1
    return {"skipped": 0, "uploaded": uploaded, "excluded": excluded,
            "restored": restored, "missing": missing, "promoted": promoted}


def main() -> int:
    loop = "--loop" in sys.argv
    interval = int(os.environ.get("UPLOADS_SYNC_INTERVAL", "3"))
    while True:
        try:
            result = sync_once()
            if any(result.get(k) for k in ("uploaded", "restored", "missing", "promoted")):
                with LOG.open("a") as fh:
                    fh.write(
                        f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} "
                        f"uploaded={result['uploaded']} excluded={result['excluded']} "
                        f"restored={result.get('restored', 0)} missing={result.get('missing', 0)} "
                        f"promoted={result.get('promoted', 0)}\n"
                    )
        except Exception as exc:
            with LOG.open("a") as fh:
                fh.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} sync_error={exc}\n")
        if not loop:
            return 0
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
