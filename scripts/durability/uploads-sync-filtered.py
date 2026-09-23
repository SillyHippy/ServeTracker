#!/usr/bin/env python3
"""Local→R2 photo sync that never re-puts snapshot-gated pruned keys.

aws s3 sync --exclude with hundreds of argv patterns silently fails to match
serve photo paths, so previously pruned objects get put back. This walks the
local uploads tree and skips any relative path listed in pruned-excludes.lst.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ENVF = Path(os.environ.get("LITESTREAM_ENV", "/etc/zo/litestream-prod.env"))
SRC = Path(os.environ.get("UPLOADS_SRC", "/home/workspace/Projects/PDFUSAEDIT-zo/data/uploads"))
PREFIX = os.environ.get("UPLOADS_PREFIX", "uploads-prod")
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


def sync_once() -> dict[str, int]:
    if LOCK.exists():
        return {"skipped": 1, "uploaded": 0, "excluded": 0}
    env = load_env()
    skip = excluded_rels()
    remote = list_remote(env)
    uploaded = 0
    excluded = 0
    endpoint = env.get("LITESTREAM_ENDPOINT", "")
    bucket = env.get("LITESTREAM_BUCKET", "")
    if not SRC.exists():
        return {"skipped": 0, "uploaded": 0, "excluded": 0}
    for path in SRC.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        # Re-check every file: prune can write the lock + exclude list mid-walk.
        if LOCK.exists():
            return {"skipped": 1, "uploaded": uploaded, "excluded": excluded}
        skip = excluded_rels()
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
    return {"skipped": 0, "uploaded": uploaded, "excluded": excluded}


def main() -> int:
    loop = "--loop" in sys.argv
    interval = int(os.environ.get("UPLOADS_SYNC_INTERVAL", "3"))
    while True:
        try:
            result = sync_once()
            if result.get("uploaded"):
                with LOG.open("a") as fh:
                    fh.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} uploaded={result['uploaded']} excluded={result['excluded']}\n")
        except Exception as exc:
            with LOG.open("a") as fh:
                fh.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} sync_error={exc}\n")
        if not loop:
            return 0
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
