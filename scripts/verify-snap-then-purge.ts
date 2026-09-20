/**
 * Dual-Shield verify → purge (PROD).
 *
 * For each pending R2 zip under prod/prod/:
 *  1. Checkpoint staging SQLite
 *  2. zo-snapshot create --scope custom covering DB + that serve's photo files
 *  3. Prove serve id + files are in the snap (info + sqlite query + path check)
 *  4. Only then delete the R2 object
 *
 * Accepts both hex UUID serve ids and non-hex test ids (e.g. ds_mock_*), so all
 * Dual-Shield archives purge after snap verify — fully automated.
 *
 * Heartbeat: /dev/shm/purge-prod.heartbeat (same file the purge-watch expects)
 * State:     data/dualshield-snap-state.json
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  assertProdDualShieldPrefix,
  deleteArchiveKey,
  dualshieldPrefix,
  listArchiveKeys,
  loadR2Env,
  localPhotoPath,
} from "../server/lib/hotBuffer";
import { DB_PATH, DATA_DIR, UPLOADS_DIR } from "../server/db";

const HEARTBEAT = "/dev/shm/purge-prod.heartbeat";
const PROD_ROOT = process.env.DUALSHIELD_ROOT || "/home/workspace/Projects/PDFUSAEDIT-zo";
const ZO_SNAP = "/usr/local/bin/zo-snapshot";
const SNAP_DATA = "/root/.zo_snapshots/data";

/** Staging may set DATA_DIR=./data — always resolve under the staging root. */
const ABS_DB_PATH = resolve(PROD_ROOT, DB_PATH);
const ABS_DATA_DIR = resolve(PROD_ROOT, DATA_DIR);
const ABS_UPLOADS_DIR = resolve(PROD_ROOT, UPLOADS_DIR);
const STATE_PATH = join(ABS_DATA_DIR, "dualshield-snap-state.json");

type ServeState = {
  snapId: string;
  verifiedAt: string;
  purgedAt?: string;
  photoPaths: string[];
};

type StateFile = {
  serves: Record<string, ServeState>;
  lastSnapId?: string;
};

async function spawn(cmd: string[]) {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env as Record<string, string>,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function loadState(): StateFile {
  try {
    if (!existsSync(STATE_PATH)) return { serves: {} };
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as StateFile;
    return { serves: raw.serves || {}, lastSnapId: raw.lastSnapId };
  } catch {
    return { serves: {} };
  }
}

function saveState(state: StateFile) {
  mkdirSync(ABS_DATA_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function writeHeartbeat(payload: Record<string, unknown>) {
  writeFileSync(HEARTBEAT, JSON.stringify({ ts: new Date().toISOString(), ...payload }) + "\n");
}

function serveIdFromKey(key: string): string {
  return key.split("/").pop()?.replace(/\.zip$/, "") || "";
}

/**
 * Any Dual-Shield archive basename: 32-char hex UUIDs and non-hex ids such as
 * ds_mock_*. Reject path traversal / empty names.
 */
function isArchiveServeId(serveId: string): boolean {
  if (!serveId || serveId.includes("/") || serveId.includes("..") || serveId.includes("\\")) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(serveId);
}

function assertProdPath(p: string) {
  const abs = resolve(p);
  if (!abs.startsWith(PROD_ROOT + "/") && abs !== PROD_ROOT) {
    throw new Error(`refusing non-prod path: ${p} → ${abs}`);
  }
  return abs;
}

function absPhotoFromUrl(imageUrl: string): string | null {
  const relOrAbs = localPhotoPath(imageUrl);
  if (!relOrAbs) return null;
  // localPhotoPath may return data/uploads/... when DATA_DIR=./data
  if (relOrAbs.startsWith("/uploads/")) {
    return resolve(ABS_UPLOADS_DIR, relOrAbs.replace(/^\/uploads\//, ""));
  }
  if (relOrAbs.startsWith(ABS_UPLOADS_DIR)) return relOrAbs;
  if (relOrAbs.includes("/uploads/")) {
    return resolve(PROD_ROOT, relOrAbs.replace(/^\.\//, ""));
  }
  return resolve(PROD_ROOT, relOrAbs);
}

async function checkpointDb() {
  const r = await spawn(["sqlite3", ABS_DB_PATH, "PRAGMA wal_checkpoint(TRUNCATE);"]);
  if (r.code !== 0) {
    console.warn("[verify-snap] wal_checkpoint warn:", r.stderr || r.stdout);
  }
}

function serveExistsInLiveDb(serveId: string): boolean {
  const db = new Database(ABS_DB_PATH, { readonly: true });
  try {
    const row = db.query("SELECT id FROM serve_attempts WHERE id = ?").get(serveId) as { id: string } | null;
    return Boolean(row?.id);
  } finally {
    db.close();
  }
}

function photoPathsForServe(serveId: string): string[] {
  const db = new Database(ABS_DB_PATH, { readonly: true });
  try {
    const row = db.query("SELECT image_url FROM serve_attempts WHERE id = ?").get(serveId) as
      | { image_url?: string }
      | null;
    const photos = db
      .query("SELECT image_url FROM serve_attempt_photos WHERE serve_id = ?")
      .all(serveId) as { image_url?: string }[];
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (url: unknown) => {
      const src = absPhotoFromUrl(String(url || ""));
      if (!src || seen.has(src) || !existsSync(src)) return;
      assertProdPath(src);
      seen.add(src);
      out.push(src);
    };
    if (row) add(row.image_url);
    for (const p of photos) add(p.image_url);
    return out;
  } finally {
    db.close();
  }
}

async function createProdSnap(label: string, paths: string[]): Promise<{ id: string; file_count: number }> {
  const absPaths = paths.map((p) => assertProdPath(p));
  const cmd = [ZO_SNAP, "create", label, "--scope", "custom", "--paths", ...absPaths, "--json"];
  const r = await spawn(cmd);
  if (r.code !== 0) {
    throw new Error(`zo-snapshot create failed: ${r.stderr || r.stdout}`);
  }
  const parsed = JSON.parse(r.stdout.trim()) as { id: string; file_count: number };
  if (!parsed?.id?.startsWith("snap_")) throw new Error(`bad snap create output: ${r.stdout}`);
  return parsed;
}

async function inspectSnap(snapId: string): Promise<{ files: Record<string, unknown>; roots: string[] }> {
  const r = await spawn([ZO_SNAP, "info", snapId, "--json"]);
  if (r.code !== 0) throw new Error(`zo-snapshot info failed: ${r.stderr || r.stdout}`);
  const info = JSON.parse(r.stdout.trim()) as { metadata_json?: string };
  const meta = JSON.parse(info.metadata_json || "{}") as {
    files?: Record<string, unknown>;
    roots?: string[];
  };
  return { files: meta.files || {}, roots: meta.roots || [] };
}

function snapDbPath(snapId: string): string {
  return join(SNAP_DATA, snapId, PROD_ROOT.replace(/^\//, ""), "data", "pdfusaedit.db");
}

function verifyServeInSnap(
  snapId: string,
  serveId: string,
  photoPaths: string[],
  requireDbRow: boolean,
): string[] {
  const problems: string[] = [];
  const dbCopy = snapDbPath(snapId);
  if (!existsSync(dbCopy)) {
    problems.push("snap-db-missing");
    return problems;
  }
  if (requireDbRow) {
    const db = new Database(dbCopy, { readonly: true });
    try {
      const row = db.query("SELECT id FROM serve_attempts WHERE id = ?").get(serveId) as { id: string } | null;
      if (!row?.id) problems.push(`serve-id-missing-in-snap-db:${serveId}`);
    } finally {
      db.close();
    }
  } else {
    console.log(
      `[verify-snap] ${serveId}: no live DB row (mock/orphan) — snap DB + photo path proof only`,
    );
  }
  for (const live of photoPaths) {
    const abs = resolve(live);
    const rel = abs.replace(/^\//, "");
    const inSnap = join(SNAP_DATA, snapId, rel);
    if (!existsSync(inSnap)) problems.push(`photo-missing-in-snap:${abs.split("/").pop()}`);
  }
  return problems;
}

async function maybeDiff(prevSnapId: string | undefined, newSnapId: string) {
  if (!prevSnapId || prevSnapId === newSnapId) return;
  const r = await spawn([ZO_SNAP, "diff", prevSnapId, newSnapId, "--stat", "--json"]);
  if (r.code !== 0) {
    console.warn("[verify-snap] diff warn:", r.stderr || r.stdout);
    return;
  }
  try {
    const d = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    const added = (d.added as string[] | undefined)?.length ?? d.added_count ?? "?";
    const modified = (d.modified as string[] | undefined)?.length ?? d.modified_count ?? "?";
    const deleted = (d.deleted as string[] | undefined)?.length ?? d.deleted_count ?? "?";
    console.log(`[verify-snap] diff ${prevSnapId} → ${newSnapId}: added=${added} modified=${modified} deleted=${deleted}`);
  } catch {
    console.log("[verify-snap] diff stat:\n" + r.stdout.trim().slice(0, 500));
  }
}

async function main() {
  loadR2Env();
  process.env.DUALSHIELD_PREFIX = process.env.DUALSHIELD_PREFIX || "prod/prod/";
  assertProdDualShieldPrefix();

  if (!existsSync(PROD_ROOT) || !existsSync(ABS_DB_PATH)) {
    throw new Error(`prod tree/db missing — abort db=${ABS_DB_PATH}`);
  }

  const prefix = dualshieldPrefix();
  const state = loadState();
  let keys: string[] = [];
  try {
    keys = await listArchiveKeys();
  } catch (err) {
    writeHeartbeat({ prefix, ok: false, error: "r2-list-failed", detail: String(err) });
    console.error("[verify-snap] list failed:", err);
    process.exit(1);
  }

  const pending = keys
    .map((k) => ({ key: k, serveId: serveIdFromKey(k) }))
    .filter((x) => isArchiveServeId(x.serveId));

  if (!pending.length) {
    writeHeartbeat({ prefix, ok: true, pending: 0, verified: 0, purged: 0, kept: 0 });
    console.log("[verify-snap] no pending Dual-Shield archives");
    return;
  }

  let purged = 0;
  let verified = 0;
  const needSnap: { key: string; serveId: string; photos: string[]; requireDbRow: boolean }[] = [];

  for (const item of pending) {
    const st = state.serves[item.serveId];
    // SAFETY: R2 is the ONLY copy once the local row is gone. Never purge an
    // archive whose serve row is missing from the live DB - let the reconcile
    // (boot hook + 2-minute cron) restore it first, then a later run purges.
    if (!serveExistsInLiveDb(item.serveId)) {
      console.warn(`[verify-snap] KEEPING ${item.key}: serve row missing from live db - reconcile must restore it first`);
      continue;
    }
    if (st?.snapId && st.verifiedAt && !st.purgedAt) {
      try {
        await deleteArchiveKey(item.key);
        st.purgedAt = new Date().toISOString();
        state.serves[item.serveId] = st;
        purged += 1;
        console.log(`[verify-snap] purged already-verified ${item.key} (snap ${st.snapId})`);
      } catch (err) {
        console.error("[verify-snap] purge failed", item.key, err);
      }
      continue;
    }
    if (st?.purgedAt) {
      delete st.purgedAt;
    }
    const photos = photoPathsForServe(item.serveId);
    const requireDbRow = serveExistsInLiveDb(item.serveId);
    needSnap.push({ ...item, photos, requireDbRow });
  }

  if (needSnap.length) {
    await checkpointDb();
    assertProdPath(ABS_DB_PATH);
    const pathSet = new Set<string>([ABS_DB_PATH]);
    for (const n of needSnap) for (const p of n.photos) pathSet.add(p);
    const paths = [...pathSet];
    const label = `dualshield-prod-${needSnap
      .map((n) => n.serveId.slice(0, 8))
      .join("-")
      .slice(0, 48)}-${Date.now()}`;
    console.log(`[verify-snap] creating snap for ${needSnap.length} serve(s), paths=${paths.length}`);
    const created = await createProdSnap(label, paths);
    const inspected = await inspectSnap(created.id);
    for (const p of paths) {
      if (!(p in inspected.files)) {
        writeHeartbeat({
          prefix,
          ok: false,
          error: "snap-missing-path",
          snapId: created.id,
          path: p,
        });
        throw new Error(`snap ${created.id} missing path ${p}`);
      }
    }
    await maybeDiff(state.lastSnapId, created.id);

    for (const n of needSnap) {
      const problems = verifyServeInSnap(created.id, n.serveId, n.photos, n.requireDbRow);
      if (problems.length) {
        console.error(`[verify-snap] VERIFY FAILED ${n.serveId}:`, problems.join(" "));
        writeHeartbeat({
          prefix,
          ok: false,
          error: "verify-failed",
          serveId: n.serveId,
          snapId: created.id,
          problems,
        });
        continue;
      }
      verified += 1;
      state.serves[n.serveId] = {
        snapId: created.id,
        verifiedAt: new Date().toISOString(),
        photoPaths: n.photos,
      };
      console.log(`[verify-snap] verified serve ${n.serveId} in ${created.id}`);
      try {
        if (!serveExistsInLiveDb(n.serveId)) {
          console.warn(`[verify-snap] KEEPING ${n.key}: serve row missing from live db - reconcile must restore it first`);
        } else {
          await deleteArchiveKey(n.key);
          state.serves[n.serveId].purgedAt = new Date().toISOString();
          purged += 1;
          console.log(`[Lifecycle] Purged staging archive after Zo snap verify: ${n.key}`);
        }
      } catch (err) {
        console.error("[verify-snap] purge after verify failed", n.key, err);
      }
    }
    state.lastSnapId = created.id;
  }

  saveState(state);
  const remaining = (await listArchiveKeys()).filter((k) => {
    const name = k.split("/").pop() || "";
    if (!name.endsWith(".zip")) return false;
    return isArchiveServeId(name.replace(/\.zip$/, ""));
  });
  writeHeartbeat({
    prefix,
    ok: true,
    pending: pending.length,
    verified,
    purged,
    kept: remaining.length,
    lastSnapId: state.lastSnapId || null,
    uploads: ABS_UPLOADS_DIR,
  });
  console.log(`[verify-snap] done verified=${verified} purged=${purged} kept=${remaining.length}`);
}

await main();
