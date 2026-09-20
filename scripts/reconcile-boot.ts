/**
 * Dual-Shield boot reconcile (prod). Restore missing serve_attempts + photos
 * from s3://servetracker-saas/prod/prod/<id>.zip before bun listens.
 */
import { mkdirSync, copyFileSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { createDb, UPLOADS_DIR } from "../server/db";
import { downloadArchive, listArchiveKeys } from "../server/lib/hotBuffer";

const UNPACK = join(import.meta.dir, "dualshield_unpack.py");

async function spawn(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function insertIgnore(db: ReturnType<typeof createDb>, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  if (!cols.length) return;
  const placeholders = cols.map(() => "?").join(", ");
  const sql = `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
  db.query(sql).run(...cols.map((k) => row[k] as string | number | null));
}

/**
 * An archived serve whose parent case / recipient no longer exists cannot be
 * restored (SQLite FOREIGN KEY). That is not a transient error: retrying it every
 * boot just crash-loops the restore. Record it as unresolvable and move on.
 */
function parentStillExists(db: ReturnType<typeof createDb>, serve: Record<string, unknown>): boolean {
  const caseId = serve.case_id;
  if (caseId) {
    const c = db.query("SELECT id FROM client_cases WHERE id = ?").get(caseId as string);
    if (!c) return false;
  }
  const recipientId = serve.recipient_id;
  if (recipientId) {
    const r = db.query("SELECT id FROM serve_recipients WHERE id = ?").get(recipientId as string);
    if (!r) return false;
  }
  return true;
}

async function restoreOne(db: ReturnType<typeof createDb>, key: string) {
  const filename = key.split("/").pop() || "";
  const serveId = filename.replace(/\.zip$/, "");
  if (!serveId) return;
  // Test-suite artifacts must never be restored into the live database. Mock
  // archives are written as mock_<id>.zip.
  if (filename.startsWith("mock_")) {
    console.log(`[Boot Reconcile] skipping mock archive: ${filename}`);
    return;
  }
  const existing = db.query("SELECT id FROM serve_attempts WHERE id = ?").get(serveId) as { id: string } | null;
  if (existing) {
    console.log(`[Boot Reconcile] already present: ${serveId}`);
    return;
  }
  console.warn(`[Boot Reconcile] RECOVERING LOST RECORD: ${serveId} from R2`);
  const tmp = `/dev/shm/dualshield-restore-${serveId}`;
  const zipPath = `${tmp}.zip`;
  mkdirSync(tmp, { recursive: true });
  await downloadArchive(key, zipPath);
  const unpacked = await spawn(["python3", UNPACK, zipPath, tmp]);
  if (unpacked.code !== 0) throw new Error(`unpack failed: ${unpacked.stderr}`);
  const manifest = JSON.parse(readFileSync(join(tmp, "manifest.json"), "utf8")) as {
    serve: Record<string, unknown>;
    photos: Record<string, unknown>[];
  };

  // Refuse to restore an orphan: without its case/recipient the insert dies on
  // the FK constraint and the archive would be re-downloaded on every boot.
  const serve = manifest.serve || {};
  if (!parentStillExists(db, serve)) {
    console.error(
      `[Boot Reconcile] UNRESOLVABLE ${serveId}: parent case/recipient no longer exists ` +
        `(case_id=${String(serve.case_id ?? "<none>")}). Archive kept in R2 for manual review.`,
    );
    try {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(zipPath, { force: true });
    } catch {
      /* ignore */
    }
    return;
  }

  const photosDir = join(tmp, "photos");
  mkdirSync(join(UPLOADS_DIR, "serves"), { recursive: true });
  if (existsSync(photosDir)) {
    const glob = new Bun.Glob("*");
    for await (const name of glob.scan({ cwd: photosDir, onlyFiles: true })) {
      copyFileSync(join(photosDir, name), join(UPLOADS_DIR, "serves", name));
    }
  }
  insertIgnore(db, "serve_attempts", manifest.serve || {});
  for (const p of manifest.photos || []) insertIgnore(db, "serve_attempt_photos", p);
  try {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(zipPath, { force: true });
  } catch {
    /* ignore */
  }
  console.log(`[Boot Reconcile] Successfully recovered serve ${serveId}`);
}

async function main() {
  console.log("[Boot Reconcile] Checking prod/prod/ for unrecovered serve records...");
  const db = createDb();
  let keys: string[] = [];
  try {
    keys = await listArchiveKeys();
  } catch (err) {
    console.error("[Boot Reconcile] list failed (continuing):", err);
    return;
  }
  if (!keys.length) {
    console.log("[Boot Reconcile] Prod Dual-Shield buffer is clean. No recovery needed.");
    return;
  }
  for (const key of keys) {
    try {
      await restoreOne(db, key);
    } catch (err) {
      console.error(`[Boot Reconcile] failed ${key}:`, err);
    }
  }
}

await main();
