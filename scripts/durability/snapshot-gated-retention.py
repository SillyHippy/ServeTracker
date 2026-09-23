#!/usr/bin/env python3
"""Snapshot-gated R2 retention for ServeTracker JLS and SaaS.

The worker is deliberately fail-closed: R2 deletion is possible only when the
same local bytes are present in consecutive, hash-verified custom zo-snapshots.
It never touches Litestream, Dual-Shield archives, tombstones, database backup
prefixes, or keys not explicitly represented in the verified manifest.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
from typing import Any

ZO_SNAPSHOT = Path("/usr/local/bin/zo-snapshot")
SNAPSHOT_ROOT = Path("/root/.zo_snapshots")
AWS = Path("/usr/local/bin/aws")


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(ts: dt.datetime | None = None) -> str:
    return (ts or utcnow()).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text().splitlines():
        s = raw.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def run(cmd: list[str], *, env: dict[str, str] | None = None, timeout: int = 900,
        capture: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        check=True,
        text=True,
        capture_output=capture,
        env=env,
        timeout=timeout,
    )


def parse_time(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.fromtimestamp(0, dt.timezone.utc)
    s = value.replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(s)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


class Config:
    def __init__(self, instance: str):
        if instance not in {"jls", "saas"}:
            raise ValueError("instance must be jls or saas")
        self.instance = instance
        if instance == "jls":
            self.project = Path("/home/workspace/Projects/PDFUSAEDIT-zo")
            self.uploads = self.project / "data/uploads"
            self.backup_root = Path("/home/workspace/Documents/Backups/servetracker/snapshot-gated/jls")
            self.state_path = self.backup_root / "state.json"
            self.env = parse_env(Path("/etc/zo/litestream-prod.env"))
            self.bucket = self.env.get("LITESTREAM_BUCKET", "")
            self.endpoint = self.env.get("LITESTREAM_ENDPOINT", "")
            self.prefix = self.env.get("UPLOADS_PREFIX", "uploads-prod").strip("/")
            self.db = self.project / "data/pdfusaedit.db"
        else:
            self.project = Path("/home/workspace/Projects/servetracker-saas")
            self.uploads = self.project / "data/uploads"
            self.backup_root = Path("/home/workspace/Documents/Backups/servetracker/snapshot-gated/saas")
            self.state_path = self.backup_root / "state.json"
            self.env = parse_env(self.project / ".env")
            self.bucket = self.env.get("R2_BUCKET", "")
            self.endpoint = self.env.get("R2_ENDPOINT", "")
            self.prefix = "tenants"
            self.db = None
        self.lock_path = Path(f"/dev/shm/servetracker-{instance}-snapshot-gated.lock")
        self.heartbeat = Path(f"/dev/shm/servetracker-{instance}-snapshot-gated.json")

    def aws_env(self) -> dict[str, str]:
        env = dict(os.environ)
        if self.instance == "jls":
            env["AWS_ACCESS_KEY_ID"] = self.env.get("LITESTREAM_ACCESS_KEY_ID", "")
            env["AWS_SECRET_ACCESS_KEY"] = self.env.get("LITESTREAM_SECRET_ACCESS_KEY", "")
            env["AWS_DEFAULT_REGION"] = self.env.get("LITESTREAM_REGION", "auto")
        else:
            env["AWS_ACCESS_KEY_ID"] = self.env.get("R2_ACCESS_KEY_ID", "")
            env["AWS_SECRET_ACCESS_KEY"] = self.env.get("R2_SECRET_ACCESS_KEY", "")
            env["AWS_DEFAULT_REGION"] = self.env.get("R2_REGION", "auto")
        return env

    def pg_env(self) -> dict[str, str]:
        env = dict(os.environ)
        for key in ("DATABASE_URL", "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"):
            if self.env.get(key):
                env[key] = self.env[key]
        env["PGOPTIONS"] = "-c app.auth_lookup=1"
        return env


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, path)


def manifest_key() -> bytes:
    path = Path("/etc/zo/servetracker-manifest.key")
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(fd, os.urandom(32).hex().encode())
        finally:
            os.close(fd)
    mode = path.stat().st_mode & 0o777
    if mode & 0o077:
        raise RuntimeError(f"manifest signing key permissions are too broad: {oct(mode)}")
    return bytes.fromhex(path.read_text().strip())


def manifest_signature(value: dict[str, Any]) -> str:
    unsigned = dict(value)
    unsigned.pop("signature", None)
    unsigned.pop("signature_alg", None)
    canonical = json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode()
    return hmac.new(manifest_key(), canonical, hashlib.sha256).hexdigest()


def verify_manifest_signature(value: dict[str, Any]) -> None:
    if value.get("signature_alg") != "hmac-sha256":
        raise RuntimeError("manifest signature algorithm missing or invalid")
    expected = manifest_signature(value)
    if not hmac.compare_digest(str(value.get("signature", "")), expected):
        raise RuntimeError("manifest HMAC verification failed")


def load_state(cfg: Config) -> dict[str, Any]:
    if not cfg.state_path.exists():
        return {"version": 1, "verified_runs": []}
    return json.loads(cfg.state_path.read_text())


def sqlite_backup(cfg: Config, dest: Path) -> dict[str, Any]:
    assert cfg.db is not None
    src = sqlite3.connect(f"file:{cfg.db}?mode=ro", uri=True, timeout=60)
    out = sqlite3.connect(str(dest))
    try:
        src.backup(out)
        result = out.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"SQLite backup integrity failed: {result}")
        counts = {}
        for table in ("clients", "client_cases", "serve_attempts", "serve_attempt_photos"):
            try:
                counts[table] = out.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.Error:
                counts[table] = None
    finally:
        out.close()
        src.close()
    return {"path": str(dest), "sha256": sha256_file(dest), "size": dest.stat().st_size, "counts": counts}


def pg_backup(cfg: Config, dest: Path) -> dict[str, Any]:
    env = cfg.pg_env()
    dburl = cfg.env.get("DATABASE_URL", "")
    cmd = ["pg_dump"]
    if dburl:
        cmd.append(dburl)
    cmd += ["--enable-row-security", "--format=custom", "--no-owner", "--no-acl", f"--file={dest}"]
    run(cmd, env=env, timeout=900)
    toc = run(["pg_restore", "--list", str(dest)], env=env).stdout
    if "TABLE DATA" not in toc or "organizations" not in toc:
        raise RuntimeError("PostgreSQL dump verification failed: missing table data")
    query = (
        "SET app.auth_lookup='1'; SELECT json_build_object("
        "'organizations',(SELECT count(*) FROM organizations),"
        "'clients',(SELECT count(*) FROM clients),"
        "'client_cases',(SELECT count(*) FROM client_cases),"
        "'serve_attempts',(SELECT count(*) FROM serve_attempts));"
    )
    cmd2 = ["psql"] + ([dburl] if dburl else []) + ["-At", "-v", "ON_ERROR_STOP=1", "-c", query]
    raw = run(cmd2, env=env).stdout.strip().splitlines()[-1]
    return {"path": str(dest), "sha256": sha256_file(dest), "size": dest.stat().st_size,
            "counts": json.loads(raw), "toc_sha256": hashlib.sha256(toc.encode()).hexdigest()}


def pg_query_json(cfg: Config, sql: str) -> list[dict[str, Any]]:
    env = cfg.pg_env()
    dburl = cfg.env.get("DATABASE_URL", "")
    wrapped = (
        "SET app.auth_lookup='1'; SELECT COALESCE(json_agg(row_to_json(q)),'[]'::json) "
        f"FROM ({sql}) q;"
    )
    cmd = ["psql"] + ([dburl] if dburl else []) + ["-At", "-v", "ON_ERROR_STOP=1", "-c", wrapped]
    lines = run(cmd, env=env).stdout.strip().splitlines()
    return json.loads(lines[-1]) if lines else []


def pg_exec(cfg: Config, sql: str) -> None:
    env = cfg.pg_env()
    dburl = cfg.env.get("DATABASE_URL", "")
    cmd = ["psql"] + ([dburl] if dburl else []) + ["-v", "ON_ERROR_STOP=1", "-c", "SET app.auth_lookup='1'; " + sql]
    run(cmd, env=env)


def inventory(cfg: Config) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    if cfg.instance == "saas":
        rows = pg_query_json(cfg, """
            SELECT id, org_id, object_type, local_path, r2_key, sha256,
                   size_bytes, created_at, r2_verified_at, status
              FROM storage_objects
             WHERE COALESCE(deleted_at,'') = ''
               AND COALESCE(r2_verified_at,'') <> ''
               AND COALESCE(r2_key,'') <> ''
        """)
        for row in rows:
            path = Path(str(row["local_path"]))
            if not path.is_absolute() or not path.exists() or not path.is_file():
                continue
            actual_size = path.stat().st_size
            actual_hash = sha256_file(path)
            if actual_size != int(row["size_bytes"]) or actual_hash != row["sha256"]:
                raise RuntimeError(f"local object changed since R2 verification: {row['id']}")
            key = str(row["r2_key"])
            if not key.startswith("tenants/"):
                raise RuntimeError(f"refusing non-tenant SaaS key: {key}")
            objects.append({**row, "local_path": str(path), "size_bytes": actual_size, "sha256": actual_hash})
    else:
        if not cfg.uploads.exists():
            return []
        for path in sorted(p for p in cfg.uploads.rglob("*") if p.is_file() and not p.is_symlink()):
            rel = path.relative_to(cfg.uploads).as_posix()
            objects.append({
                "id": hashlib.sha256(rel.encode()).hexdigest()[:32],
                "org_id": "jls",
                "object_type": "upload",
                "local_path": str(path),
                "r2_key": f"{cfg.prefix}/{rel}",
                "sha256": sha256_file(path),
                "size_bytes": path.stat().st_size,
                "created_at": iso(dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc)),
                "r2_verified_at": "watcher-managed",
                "status": "r2_verified",
            })
    return objects


def make_manifest(cfg: Config, run_id: str, run_dir: Path, dbinfo: dict[str, Any], objects: list[dict[str, Any]]) -> dict[str, Any]:
    manifest = {
        "version": 1,
        "instance": cfg.instance,
        "run_id": run_id,
        "created_at": iso(),
        "bucket": cfg.bucket,
        "allowed_prefix": cfg.prefix + "/",
        "database": dbinfo,
        "objects": objects,
        "policy": {"required_verified_snapshots": 2, "default_grace_seconds": 21600},
    }
    manifest["signature_alg"] = "hmac-sha256"
    manifest["signature"] = manifest_signature(manifest)
    atomic_json(run_dir / "retention-manifest.json", manifest)
    return manifest


def create_snapshot(cfg: Config, run_id: str, run_dir: Path) -> str:
    cmd = [str(ZO_SNAPSHOT), "create", f"servetracker-{cfg.instance}-retention-{run_id}",
           "--scope", "custom", "--paths", str(run_dir), str(cfg.uploads), "--json"]
    out = json.loads(run(cmd, timeout=1800).stdout)
    snap_id = out.get("id") or out.get("snapshot_id")
    if not snap_id or int(out.get("warnings_count", 0)) != 0:
        raise RuntimeError(f"snapshot create incomplete: {out}")
    return str(snap_id)


def verify_snapshot(cfg: Config, snap_id: str, manifest_path: Path) -> dict[str, Any]:
    snap_dir = SNAPSHOT_ROOT / "data" / snap_id
    native_manifest_path = snap_dir / "manifest.json"
    if not native_manifest_path.exists():
        raise RuntimeError("snapshot native manifest missing")
    native = json.loads(native_manifest_path.read_text())
    if native.get("warnings"):
        raise RuntimeError(f"snapshot has warnings: {len(native['warnings'])}")
    expected = json.loads(manifest_path.read_text())
    verify_manifest_signature(expected)
    candidates = [expected["database"]] + expected["objects"] + [{
        "path": str(manifest_path), "sha256": sha256_file(manifest_path), "size": manifest_path.stat().st_size
    }]
    checked = 0
    for item in candidates:
        source = Path(str(item.get("local_path") or item.get("path")))
        meta = native.get("files", {}).get(str(source))
        if not meta:
            raise RuntimeError(f"snapshot omitted required path: {source}")
        expected_hash = str(item["sha256"])
        expected_size = int(item.get("size_bytes", item.get("size", 0)))
        if meta.get("sha256") != expected_hash or int(meta.get("size", -1)) != expected_size:
            raise RuntimeError(f"snapshot manifest mismatch: {source}")
        snap_copy = snap_dir / source.relative_to("/")
        if not snap_copy.exists() or snap_copy.stat().st_size != expected_size or sha256_file(snap_copy) != expected_hash:
            raise RuntimeError(f"snapshot CAS bytes mismatch: {source}")
        cas_copy = SNAPSHOT_ROOT / "objects" / expected_hash[:2] / expected_hash[2:]
        if not cas_copy.exists():
            raise RuntimeError(f"snapshot CAS object missing: {source}")
        if snap_copy.stat().st_ino != cas_copy.stat().st_ino or snap_copy.stat().st_nlink < 2:
            raise RuntimeError(f"snapshot file is not linked to immutable CAS object: {source}")
        checked += 1
    # Deep-check the database payload copied into the snapshot without opening
    # the production file or invoking in-place restore.
    snap_db = snap_dir / Path(str(expected["database"]["path"])).relative_to("/")
    instance = getattr(cfg, "instance", "")
    if instance == "jls":
        with tempfile.TemporaryDirectory(prefix="servetracker-snap-verify-") as td:
            isolated_db = Path(td) / "pdfusaedit.db"
            isolated_db.write_bytes(snap_db.read_bytes())
            con = sqlite3.connect(f"file:{isolated_db}?mode=ro&immutable=1", uri=True)
            try:
                if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("snapshot SQLite integrity check failed")
            finally:
                con.close()
    elif instance == "saas":
        toc = run(["pg_restore", "--list", str(snap_db)]).stdout
        if "TABLE DATA" not in toc or "organizations" not in toc:
            raise RuntimeError("snapshot PostgreSQL dump logical verification failed")
    return {"snapshot_id": snap_id, "verified_at": iso(), "files_checked": checked,
            "verification_mode": "zo-cas-inode-byte-hash-and-database-check"}


def exclude_list_path(cfg: Config) -> Path:
    return cfg.backup_root / "pruned-excludes.lst"


def prune_lock_path() -> Path:
    return Path("/dev/shm/servetracker-uploads-prune.lock")


def remember_pruned(cfg: Config, state: dict[str, Any], keys: list[str]) -> None:
    """Persist pruned R2 keys so the local→R2 uploads watcher cannot re-put them."""
    existing = [str(k) for k in (state.get("pruned_keys") or []) if str(k).strip()]
    for key in keys:
        if key and key not in existing:
            existing.append(key)
    state["pruned_keys"] = existing[-20000:]
    prefix = f"{cfg.prefix}/"
    rels: list[str] = []
    for key in existing:
        if key.startswith(prefix):
            rels.append(key[len(prefix):])
        elif cfg.instance == "saas" and key.startswith("tenants/"):
            rels.append(key[len("tenants/"):])
    path = exclude_list_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(sorted(set(rels))) + ("\n" if rels else ""))


def aws_delete(cfg: Config, key: str) -> None:
    if not cfg.bucket or not cfg.endpoint:
        raise RuntimeError("R2 configuration incomplete")
    if cfg.instance == "jls" and not key.startswith(cfg.prefix + "/"):
        raise RuntimeError(f"refusing key outside {cfg.prefix}: {key}")
    if cfg.instance == "saas" and not key.startswith("tenants/"):
        raise RuntimeError(f"refusing key outside tenants/: {key}")
    target = f"s3://{cfg.bucket}/{key}"
    last_err = "object still exists"
    # Delete, verify absence, and re-delete if the uploads watcher races a put back.
    for attempt in range(8):
        run([str(AWS), "--endpoint-url", cfg.endpoint, "s3", "rm", target, "--only-show-errors"], env=cfg.aws_env())
        time.sleep(1)
        verify = subprocess.run(
            [str(AWS), "--endpoint-url", cfg.endpoint, "s3api", "head-object", "--bucket", cfg.bucket, "--key", key],
            env=cfg.aws_env(), text=True, capture_output=True, timeout=60,
        )
        if verify.returncode != 0:
            return
        last_err = f"object still exists after delete attempt {attempt + 1}: {key}"
    raise RuntimeError(f"R2 delete verification failed; {last_err}")


def mark_pruned(cfg: Config, object_id: str, snap_id: str) -> None:
    if cfg.instance != "saas":
        return
    safe_id = object_id.replace("'", "")
    safe_snap = snap_id.replace("'", "")
    pg_exec(cfg, f"UPDATE storage_objects SET status='r2_pruned', r2_pruned_at='{iso()}', snapshot_id='{safe_snap}' WHERE id='{safe_id}'")


def signed_verified_runs(state: dict[str, Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    signed_runs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for entry in state.get("verified_runs", []):
        try:
            manifest = json.loads(Path(entry["manifest_path"]).read_text())
            verify_manifest_signature(manifest)
            signed_runs.append((entry, manifest))
        except Exception:
            continue
    return signed_runs


def ensure_pair_ready_at(state: dict[str, Any], signed_runs: list[tuple[dict[str, Any], dict[str, Any]]],
                         required: int) -> str | None:
    """Grace starts when the required pair first exists. Later cycles must not slide it."""
    if len(signed_runs) < required:
        state.pop("pair_ready_at", None)
        return None
    existing = str(state.get("pair_ready_at") or "").strip()
    if existing:
        return existing
    ready = str(signed_runs[required - 1][0].get("verified_at") or "")
    if ready:
        state["pair_ready_at"] = ready
    return ready or None


def prune(cfg: Config, state: dict[str, Any], *, required: int, grace: int, dry_run: bool) -> dict[str, Any]:
    signed_runs = signed_verified_runs(state)
    if len(signed_runs) < required:
        return {"eligible": 0, "deleted": 0, "reason": f"need {required} signed verified snapshots"}
    pair_ready_at = ensure_pair_ready_at(state, signed_runs, required)
    chosen_pairs = signed_runs[-required:]
    chosen = [pair[0] for pair in chosen_pairs]
    manifests = [pair[1] for pair in chosen_pairs]
    maps = [{o["r2_key"]: o for o in m["objects"]} for m in manifests]
    common = set(maps[0])
    for m in maps[1:]:
        common &= set(m)
    oldest_verified = min(parse_time(r["verified_at"]) for r in chosen)
    age_cutoff = utcnow() - dt.timedelta(seconds=grace)
    pair_ready = parse_time(pair_ready_at)
    if pair_ready > age_cutoff:
        wait_seconds = max(0, int((pair_ready - age_cutoff).total_seconds()))
        return {"eligible": 0, "deleted": 0, "reason": "verified snapshot grace not elapsed",
                "wait_seconds": wait_seconds, "pair_ready_at": pair_ready_at,
                "snapshots": [r["snapshot_id"] for r in chosen]}
    eligible: list[dict[str, Any]] = []
    for key in sorted(common):
        records = [m[key] for m in maps]
        if len({r["sha256"] for r in records}) != 1 or len({int(r["size_bytes"]) for r in records}) != 1:
            continue
        row = records[-1]
        path = Path(row["local_path"])
        if not path.exists() or path.stat().st_size != int(row["size_bytes"]) or sha256_file(path) != row["sha256"]:
            continue
        created = parse_time(str(row.get("created_at") or ""))
        if created >= oldest_verified or created >= age_cutoff:
            continue
        eligible.append(row)
    deleted = 0
    if eligible and not dry_run:
        remember_pruned(cfg, state, [str(row["r2_key"]) for row in eligible])
        atomic_json(cfg.state_path, state)
        lock = prune_lock_path()
        lock.write_text(iso())
        try:
            # Give any in-flight uploads-watch walk time to notice the lock/excludes.
            time.sleep(8)
            for row in eligible:
                aws_delete(cfg, row["r2_key"])
                mark_pruned(cfg, str(row["id"]), str(chosen[-1]["snapshot_id"]))
                deleted += 1
        finally:
            lock.unlink(missing_ok=True)
    elif dry_run:
        deleted = 0
    return {"eligible": len(eligible), "deleted": deleted, "dry_run": dry_run,
            "snapshots": [r["snapshot_id"] for r in chosen]}


def list_prefix_keys(cfg: Config, prefix: str) -> list[str]:
    out = run(
        [str(AWS), "--endpoint-url", cfg.endpoint, "s3", "ls", f"s3://{cfg.bucket}/{prefix}", "--recursive"],
        env=cfg.aws_env(),
    ).stdout
    keys: list[str] = []
    for ln in out.splitlines():
        parts = ln.split(None, 3)
        if len(parts) >= 4:
            keys.append(parts[3])
    return keys


def hydrate_saas_r2_orphans(cfg: Config) -> dict[str, Any]:
    """Download tenant R2 objects onto Zo and ledger them so they can enter snapshots.

    Never deletes R2. Existing local files are hashed in place. New ledger rows
    use the on-disk SHA-256 so the next two verified snapshots can prune later.
    """
    if cfg.instance != "saas":
        return {"downloaded": 0, "ledgered": 0, "already_local": 0}
    existing = {
        str(row["r2_key"])
        for row in pg_query_json(cfg, "SELECT r2_key FROM storage_objects WHERE COALESCE(r2_key,'') LIKE 'tenants/%'")
    }
    keys = [k for k in list_prefix_keys(cfg, "tenants/") if k.startswith("tenants/")]
    downloaded = 0
    ledgered = 0
    already_local = 0
    for key in keys:
        dest = cfg.uploads / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.is_file():
            tmp = dest.with_suffix(dest.suffix + ".hydrate")
            run(
                [str(AWS), "--endpoint-url", cfg.endpoint, "s3", "cp",
                 f"s3://{cfg.bucket}/{key}", str(tmp), "--only-show-errors"],
                env=cfg.aws_env(), timeout=180,
            )
            os.replace(tmp, dest)
            downloaded += 1
        else:
            already_local += 1
        if key in existing:
            continue
        digest = sha256_file(dest)
        size = dest.stat().st_size
        parts = key.split("/")
        org = parts[1] if len(parts) > 1 else ""
        fname = parts[-1]
        serve_id = fname.split("_")[0][:64]
        oid = hashlib.sha256(key.encode()).hexdigest()[:32]
        esc = lambda s: str(s).replace("'", "''")
        pg_exec(cfg, f"""
          INSERT INTO storage_objects
            (id, org_id, object_type, local_path, r2_key, sha256, size_bytes,
             created_at, local_verified_at, r2_verified_at, status, serve_id, photo_id)
          SELECT '{esc(oid)}','{esc(org)}','serve_photo','{esc(str(dest))}','{esc(key)}',
                 '{esc(digest)}',{int(size)},'{iso()}','{iso()}','{iso()}','r2_verified',
                 '{esc(serve_id)}',''
          WHERE NOT EXISTS (SELECT 1 FROM storage_objects WHERE r2_key='{esc(key)}')
        """)
        ledgered += 1
        existing.add(key)
    return {"downloaded": downloaded, "ledgered": ledgered, "already_local": already_local, "r2_keys": len(keys)}


def reapply_pruned(cfg: Config, *, dry_run: bool) -> dict[str, Any]:
    """Delete R2 keys that were already pruned and then re-uploaded by the watcher.

    Only keys already in pruned_keys, still on R2, and still present locally.
    Never touches litestream/ or Dual-Shield prefixes.
    """
    if cfg.instance != "jls":
        raise RuntimeError("reapply-pruned is JLS uploads-prod only")
    state = load_state(cfg)
    pruned = {str(k) for k in (state.get("pruned_keys") or []) if str(k).startswith(cfg.prefix + "/")}
    live = set(list_prefix_keys(cfg, cfg.prefix + "/"))
    deleted = 0
    skipped_no_local = 0
    candidates = sorted(pruned & live)
    remember_pruned(cfg, state, [])
    atomic_json(cfg.state_path, state)
    lock = prune_lock_path()
    lock.write_text(iso())
    try:
        time.sleep(8)
        for key in candidates:
            rel = key[len(cfg.prefix) + 1:]
            local = cfg.uploads / rel
            if not local.is_file():
                skipped_no_local += 1
                continue
            if not dry_run:
                aws_delete(cfg, key)
            deleted += 1
        remember_pruned(cfg, state, [])
        atomic_json(cfg.state_path, state)
    finally:
        lock.unlink(missing_ok=True)
    return {
        "ok": True,
        "instance": cfg.instance,
        "candidates": len(candidates),
        "deleted": deleted,
        "skipped_no_local": skipped_no_local,
        "dry_run": dry_run,
    }


def record_snapshot_pg(cfg: Config, run_id: str, snap_id: str, status: str, manifest: Path,
                       verification: dict[str, Any] | None, error: str = "") -> None:
    if cfg.instance != "saas":
        return
    esc = lambda s: str(s).replace("'", "''")
    verified_at = verification.get("verified_at", "") if verification else ""
    pg_exec(cfg, f"""
      INSERT INTO snapshot_runs
        (id, snapshot_id, status, manifest_path, created_at, verified_at, verification_json, error)
      VALUES ('{esc(run_id)}','{esc(snap_id)}','{esc(status)}','{esc(str(manifest))}',
              '{iso()}','{esc(verified_at)}','{esc(json.dumps(verification or {}))}','{esc(error)}')
      ON CONFLICT (id) DO UPDATE SET snapshot_id=EXCLUDED.snapshot_id, status=EXCLUDED.status,
        manifest_path=EXCLUDED.manifest_path, verified_at=EXCLUDED.verified_at,
        verification_json=EXCLUDED.verification_json, error=EXCLUDED.error
    """)


def cycle(cfg: Config, args: argparse.Namespace) -> dict[str, Any]:
    cfg.backup_root.mkdir(parents=True, exist_ok=True)
    hydrate = hydrate_saas_r2_orphans(cfg) if cfg.instance == "saas" else {}
    run_id = utcnow().strftime("%Y%m%dT%H%M%SZ")
    run_dir = cfg.backup_root / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    db_dest = run_dir / ("pdfusaedit.db" if cfg.instance == "jls" else "servetracker-saas.dump")
    dbinfo = sqlite_backup(cfg, db_dest) if cfg.instance == "jls" else pg_backup(cfg, db_dest)
    objects = inventory(cfg)
    manifest = make_manifest(cfg, run_id, run_dir, dbinfo, objects)
    manifest_path = run_dir / "retention-manifest.json"
    snap_id = ""
    try:
        snap_id = create_snapshot(cfg, run_id, run_dir)
        verification = verify_snapshot(cfg, snap_id, manifest_path)
        record_snapshot_pg(cfg, run_id, snap_id, "verified", manifest_path, verification)
    except Exception as exc:
        with contextlib.suppress(Exception):
            record_snapshot_pg(cfg, run_id, snap_id, "failed", manifest_path, None, str(exc))
        raise
    state = load_state(cfg)
    state.setdefault("verified_runs", []).append({
        "run_id": run_id,
        "snapshot_id": snap_id,
        "manifest_path": str(manifest_path),
        "verified_at": verification["verified_at"],
        "object_count": len(objects),
    })
    state["verified_runs"] = state["verified_runs"][-32:]
    state["last_success"] = iso()
    ensure_pair_ready_at(state, signed_verified_runs(state), args.required_snapshots)
    atomic_json(cfg.state_path, state)
    pruned = prune(cfg, state, required=args.required_snapshots, grace=args.grace_seconds, dry_run=args.dry_run)
    atomic_json(cfg.state_path, state)
    result = {"ok": True, "instance": cfg.instance, "run_id": run_id, "snapshot_id": snap_id,
              "objects": len(objects), "files_checked": verification["files_checked"], "prune": pruned}
    if hydrate:
        result["hydrate"] = hydrate
    return result


def audit(cfg: Config) -> dict[str, Any]:
    state = load_state(cfg)
    runs = state.get("verified_runs", [])
    if not runs:
        raise RuntimeError("no verified snapshot-gated run exists")
    latest = runs[-1]
    manifest = Path(latest["manifest_path"])
    verification = verify_snapshot(cfg, latest["snapshot_id"], manifest)
    return {"ok": True, "instance": cfg.instance, "snapshot_id": latest["snapshot_id"],
            "files_checked": verification["files_checked"], "audited_at": iso()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--instance", choices=["jls", "saas"], required=True)
    ap.add_argument("--action", choices=["cycle", "audit", "prune", "hydrate", "reapply-pruned"], default="cycle")
    ap.add_argument("--required-snapshots", type=int, default=2)
    ap.add_argument("--grace-seconds", type=int, default=21600)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if args.required_snapshots < 1 or args.grace_seconds < 0:
        ap.error("invalid retention policy")
    cfg = Config(args.instance)
    cfg.lock_path.parent.mkdir(parents=True, exist_ok=True)
    with cfg.lock_path.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"ok": True, "skipped": "already running", "instance": args.instance}))
            return 0
        try:
            if args.action == "cycle":
                result = cycle(cfg, args)
            elif args.action == "audit":
                result = audit(cfg)
            elif args.action == "hydrate":
                result = {"ok": True, "instance": cfg.instance, **hydrate_saas_r2_orphans(cfg)}
            elif args.action == "reapply-pruned":
                result = reapply_pruned(cfg, dry_run=args.dry_run)
            else:
                state = load_state(cfg)
                result = prune(cfg, state, required=args.required_snapshots,
                               grace=args.grace_seconds, dry_run=args.dry_run)
                atomic_json(cfg.state_path, state)
                result.update({"ok": True, "instance": args.instance})
            atomic_json(cfg.heartbeat, result)
            print(json.dumps(result, sort_keys=True))
            return 0
        except Exception as exc:
            failure = {"ok": False, "instance": args.instance, "action": args.action,
                       "failed_at": iso(), "error": str(exc)}
            atomic_json(cfg.heartbeat, failure)
            print(json.dumps(failure, sort_keys=True), file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
