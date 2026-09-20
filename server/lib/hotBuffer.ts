import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import type { Db } from "../db";
import { UPLOADS_DIR } from "../db";

const ENVF = "/etc/zo/litestream-prod.env";

/**
 * Scratch directory for Dual-Shield staging and mock archives.
 *
 * It is derived from DATA_DIR so a test run (which points DATA_DIR at its own
 * mkdtemp) can never write into production's scratch space. Sharing that
 * directory previously let `bun test` drop mock_*.zip archives into the exact
 * folder the production reconciler scans, which then restored test serves into
 * the live database.
 */
export function hotBufferTmpDir(): string {
  const base = process.env.HOTBUFFER_TMP_DIR;
  if (base) return base;
  const dataDir = process.env.DATA_DIR;
  if (dataDir) return join(dataDir, "dualshield");
  return "/dev/shm/dualshield-prod";
}

export function isHotBufferMock(): boolean {
  return (
    process.env.HOTBUFFER_MOCK === "true" ||
    process.env.DUALSHIELD_MOCK === "true" ||
    process.env.MOCK_R2 === "true"
  );
}

export function loadR2Env(): void {
  if (isHotBufferMock()) return;
  let text = "";
  try {
    text = readFileSync(ENVF, "utf8");
  } catch (err) {
    throw new Error(`loadR2Env: credentials file ${ENVF} missing or unreadable; refusing to continue outside mock mode: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i);
    let v = t.slice(i + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
  if (!process.env.LITESTREAM_ACCESS_KEY_ID && !process.env.AWS_ACCESS_KEY_ID) {
    throw new Error(`loadR2Env: credentials file ${ENVF} missing access key; refusing to continue outside mock mode`);
  }
}

export function dualshieldPrefix(): string {
  return (process.env.DUALSHIELD_PREFIX || "prod/prod/").replace(/\/?$/, "/");
}

export function tombstonePrefix(): string {
  return (process.env.TOMBSTONE_PREFIX || "prod/tombstones/").replace(/\/?$/, "/");
}

/** Prod Dual-Shield only — refuse non-prod prefixes. */
export function assertProdDualShieldPrefix(prefix = dualshieldPrefix()) {
  if (isHotBufferMock()) return;
  if (prefix !== "prod/prod/") {
    throw new Error(`dualshield: refusing non-prod prefix ${prefix}`);
  }
}

/** @deprecated — use assertProdDualShieldPrefix */
export function assertStagingDualShieldPrefix(prefix = dualshieldPrefix()) {
  return assertProdDualShieldPrefix(prefix);
}

function awsEnv(): Record<string, string> {
  loadR2Env();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && v.length >= 0) env[k] = v;
  }
  env.PATH = env.PATH || "/usr/local/bin:/usr/bin:/bin";
  env.HOME = env.HOME || "/root";
  env.LANG = env.LANG || "C.UTF-8";
  env.LC_ALL = env.LC_ALL || "C.UTF-8";
  env.AWS_ACCESS_KEY_ID = process.env.LITESTREAM_ACCESS_KEY_ID || "";
  env.AWS_SECRET_ACCESS_KEY = process.env.LITESTREAM_SECRET_ACCESS_KEY || "";
  env.AWS_DEFAULT_REGION = process.env.LITESTREAM_REGION || process.env.R2_REGION || "auto";
  env.AWS_EC2_METADATA_DISABLED = "true";
  env.AWS_PAGER = "";
  return env;
}

/** aws s3 ls of an empty prefix returns HTTP 200 KeyCount=0 but CLI exit 1 with empty streams. */
export function isEmptyPrefixLs(listed: { code: number; stdout: string; stderr: string }) {
  return listed.code !== 0 && !listed.stdout.trim() && !listed.stderr.trim();
}

/** True when list succeeded or the prefix is empty (aws CLI quirk). */
export function isSuccessfulLs(listed: { code: number; stdout: string; stderr: string }) {
  return listed.code === 0 || isEmptyPrefixLs(listed);
}

function awsArgv(rest: string[]): string[] {
  return ["/usr/local/bin/python", "/usr/local/bin/aws", ...rest];
}

async function run(cmd: string[], env?: Record<string, string>, stdin?: string) {
  const proc = Bun.spawn(cmd, {
    env: env || awsEnv(),
    stdin: stdin ? new TextEncoder().encode(stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function localPhotoPath(imageUrl: string): string | null {
  if (!imageUrl || !imageUrl.startsWith("/uploads/")) return null;
  const uploadsDir = resolve(process.env.DATA_DIR ? `${process.env.DATA_DIR}/uploads` : UPLOADS_DIR);
  return join(uploadsDir, imageUrl.replace(/^\/uploads\//, ""));
}

export type ServeArchiveFile = { arc: string; src: string };
export type ServeArchiveManifest = {
  serve: Record<string, unknown>;
  photos: Record<string, unknown>[];
};

export type ServeTombstone = {
  version: number;
  serve_id: string;
  deleted_at: string;
  actor: {
    id: string;
    role: string;
    username?: string;
  };
  reason: string;
  archive_key?: string;
  payload_fingerprint?: string;
};

export type MockArchiveEntry = {
  key: string;
  zipPath: string;
  manifest: ServeArchiveManifest;
  files: ServeArchiveFile[];
};

// In-memory mock storage for testing without live R2 credentials
export const mockArchives = new Map<string, MockArchiveEntry>();
export const mockTombstones = new Map<string, ServeTombstone>();
let mockTombstoneFailure = false;
let mockR2Failure = false;

export function setMockTombstoneFailure(fail: boolean): void {
  mockTombstoneFailure = fail;
}

export function setMockR2Failure(fail: boolean): void {
  mockR2Failure = fail;
}

export function resetHotBufferMock(): void {
  mockArchives.clear();
  mockTombstones.clear();
  mockTombstoneFailure = false;
  mockR2Failure = false;
}

/** Pack + upload from in-memory payload (R2-first create path; no DB required). */
export async function putServeArchivePayload(
  serveId: string,
  manifest: ServeArchiveManifest,
  files: ServeArchiveFile[],
): Promise<void> {
  if (mockR2Failure) {
    throw new Error("Forced mock R2 failure");
  }

  loadR2Env();
  assertProdDualShieldPrefix();
  const bucket = process.env.LITESTREAM_BUCKET || "servetracker-saas";
  const endpoint = process.env.LITESTREAM_ENDPOINT || "";
  const prefix = dualshieldPrefix();

  const tmpDir = hotBufferTmpDir();
  mkdirSync(tmpDir, { recursive: true });
  const zipPath = join(tmpDir, `${serveId}.zip`);
  const packScript = join(import.meta.dir, "..", "..", "scripts", "dualshield_pack.py");
  const packed = await run(
    ["python3", packScript],
    awsEnv(),
    JSON.stringify({ zip_path: zipPath, manifest, files }),
  );
  if (packed.code !== 0) {
    throw new Error(`hotBuffer pack failed: ${packed.stderr || packed.stdout}`);
  }

  const key = `${prefix}${serveId}.zip`;

  if (isHotBufferMock()) {
    // Preserve copy in a MOCK-ONLY store for reconciler/purge tests.
    // CRITICAL: mock archives must never land in the directory the real prod
    // reconciler scans (/dev/shm/dualshield-prod), or a `bun test` run would
    // inject test serves into production on the next reconcile.
    const mockDir = join(tmpDir, "mock-archives");
    mkdirSync(mockDir, { recursive: true });
    const mockCopy = join(mockDir, `mock_${serveId}.zip`);
    try {
      copyFileSync(zipPath, mockCopy);
      mockArchives.set(key, { key, zipPath: mockCopy, manifest, files });
      unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    return;
  }

  const put = await run(
    awsArgv(["--endpoint-url", endpoint, "s3", "cp", zipPath, `s3://${bucket}/${key}`, "--only-show-errors"]),
    awsEnv(),
  );
  try {
    unlinkSync(zipPath);
  } catch {
    /* ignore */
  }
  if (put.code !== 0) {
    throw new Error(`hotBuffer put failed: ${put.stderr || put.stdout}`);
  }
}

/** DB-backed put when row already exists. Prefer putServeArchivePayload on create. */
export async function putServeArchive(db: Db, serveId: string): Promise<void> {
  loadR2Env();
  assertProdDualShieldPrefix();
  const row = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(serveId) as Record<string, unknown> | null;
  if (!row) throw new Error(`hotBuffer: serve ${serveId} not in db`);
  const photos = db
    .query("SELECT * FROM serve_attempt_photos WHERE serve_id = ? ORDER BY position")
    .all(serveId) as Record<string, unknown>[];

  const files: ServeArchiveFile[] = [];
  const seen = new Set<string>();
  const addUrl = (url: unknown) => {
    const u = String(url || "");
    const src = localPhotoPath(u);
    if (!src || !existsSync(src)) return;
    const name = src.split("/").pop() || "photo.jpg";
    if (seen.has(name)) return;
    seen.add(name);
    files.push({ arc: `photos/${name}`, src });
  };
  addUrl(row.image_url);
  for (const p of photos) addUrl(p.image_url);

  await putServeArchivePayload(serveId, { serve: row, photos }, files);
}

export async function listArchiveKeys(): Promise<string[]> {
  if (mockR2Failure) {
    throw new Error("Forced mock R2 failure");
  }
  if (isHotBufferMock()) {
    return Array.from(mockArchives.keys());
  }

  loadR2Env();
  assertProdDualShieldPrefix();
  const bucket = process.env.LITESTREAM_BUCKET || "servetracker-saas";
  const endpoint = process.env.LITESTREAM_ENDPOINT || "";
  const prefix = dualshieldPrefix();
  const listed = await run(
    awsArgv(["--endpoint-url", endpoint, "s3", "ls", `s3://${bucket}/${prefix}`]),
    awsEnv(),
  );
  if (!isSuccessfulLs(listed)) {
    throw new Error(`hotBuffer list failed: ${listed.stderr || listed.stdout}`);
  }
  const keys: string[] = [];
  for (const line of listed.stdout.split("\n")) {
    const name = line.trim().split(/\s+/).pop() || "";
    if (name.endsWith(".zip")) keys.push(`${prefix}${name}`);
  }
  return keys;
}

export async function downloadArchive(key: string, destZip: string): Promise<void> {
  if (mockR2Failure) {
    throw new Error("Forced mock R2 failure");
  }
  if (isHotBufferMock()) {
    const entry = mockArchives.get(key);
    if (!entry || !existsSync(entry.zipPath)) {
      throw new Error(`hotBuffer get failed (mock): key ${key} not found`);
    }
    copyFileSync(entry.zipPath, destZip);
    return;
  }

  loadR2Env();
  assertProdDualShieldPrefix();
  const bucket = process.env.LITESTREAM_BUCKET || "servetracker-saas";
  const endpoint = process.env.LITESTREAM_ENDPOINT || "";
  const got = await run(
    awsArgv(["--endpoint-url", endpoint, "s3", "cp", `s3://${bucket}/${key}`, destZip, "--only-show-errors"]),
    awsEnv(),
  );
  if (got.code !== 0) throw new Error(`hotBuffer get failed: ${got.stderr || got.stdout}`);
}

export async function deleteArchiveKey(key: string): Promise<void> {
  if (mockR2Failure) {
    throw new Error("Forced mock R2 failure");
  }
  if (isHotBufferMock()) {
    const entry = mockArchives.get(key);
    if (entry) {
      try { unlinkSync(entry.zipPath); } catch {}
      mockArchives.delete(key);
    }
    return;
  }

  loadR2Env();
  assertProdDualShieldPrefix();
  const bucket = process.env.LITESTREAM_BUCKET || "servetracker-saas";
  const endpoint = process.env.LITESTREAM_ENDPOINT || "";
  const rm = await run(
    awsArgv(["--endpoint-url", endpoint, "s3", "rm", `s3://${bucket}/${key}`]),
    awsEnv(),
  );
  if (rm.code !== 0) {
    throw new Error(`hotBuffer rm failed: ${rm.stderr || rm.stdout}`);
  }
}

// ---------------------------------------------------------------------------
// Tombstone Support (Off-box permanent deletion markers)
// Convention: prod/tombstones/<serveId>.json
// ---------------------------------------------------------------------------

export function tombstoneKeyForServe(serveId: string): string {
  return `${tombstonePrefix()}${serveId}.json`;
}

export async function writeTombstone(tombstone: ServeTombstone): Promise<void> {
  if (mockTombstoneFailure) {
    throw new Error("Forced mock tombstone failure");
  }
  const serveId = tombstone.serve_id;
  if (!serveId) throw new Error("writeTombstone: missing serve_id");

  if (isHotBufferMock()) {
    mockTombstones.set(serveId, { ...tombstone });
    return;
  }

  loadR2Env();
  const bucket = process.env.LITESTREAM_BUCKET || "servetracker-saas";
  const endpoint = process.env.LITESTREAM_ENDPOINT || "";
  const key = tombstoneKeyForServe(serveId);

  const tmpDir = hotBufferTmpDir();
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, `tombstone_${serveId}.json`);
  writeFileSync(tmpFile, JSON.stringify(tombstone, null, 2) + "\n");

  try {
    const put = await run(
      awsArgv(["--endpoint-url", endpoint, "s3", "cp", tmpFile, `s3://${bucket}/${key}`, "--only-show-errors"]),
      awsEnv(),
    );
    if (put.code !== 0) {
      throw new Error(`writeTombstone failed: ${put.stderr || put.stdout}`);
    }
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export async function getTombstone(serveId: string): Promise<ServeTombstone | null> {
  if (mockR2Failure) {
    throw new Error("Forced mock R2 failure");
  }
  if (isHotBufferMock()) {
    return mockTombstones.get(serveId) || null;
  }

  loadR2Env();
  const bucket = process.env.LITESTREAM_BUCKET || "servetracker-saas";
  const endpoint = process.env.LITESTREAM_ENDPOINT || "";
  const key = tombstoneKeyForServe(serveId);

  const tmpDir = hotBufferTmpDir();
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, `get_tombstone_${serveId}.json`);

  try {
    const got = await run(
      awsArgv(["--endpoint-url", endpoint, "s3", "cp", `s3://${bucket}/${key}`, tmpFile, "--only-show-errors"]),
      awsEnv(),
    );
    if (got.code !== 0) return null;
    const text = readFileSync(tmpFile, "utf8");
    return JSON.parse(text) as ServeTombstone;
  } catch {
    return null;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export async function hasTombstone(serveId: string): Promise<boolean> {
  if (isHotBufferMock()) {
    return mockTombstones.has(serveId);
  }
  const tomb = await getTombstone(serveId);
  return Boolean(tomb);
}

export async function listTombstones(): Promise<string[]> {
  if (mockR2Failure) {
    throw new Error("Forced mock R2 failure");
  }
  if (isHotBufferMock()) {
    return Array.from(mockTombstones.keys());
  }

  loadR2Env();
  const bucket = process.env.LITESTREAM_BUCKET || "servetracker-saas";
  const endpoint = process.env.LITESTREAM_ENDPOINT || "";
  const prefix = tombstonePrefix();
  const listed = await run(
    awsArgv(["--endpoint-url", endpoint, "s3", "ls", `s3://${bucket}/${prefix}`]),
    awsEnv(),
  );
  if (!isSuccessfulLs(listed)) {
    throw new Error(`listTombstones failed: ${listed.stderr || listed.stdout}`);
  }
  const keys: string[] = [];
  for (const line of listed.stdout.split("\n")) {
    const name = line.trim().split(/\s+/).pop() || "";
    if (name.endsWith(".json")) {
      const serveId = name.replace(/\.json$/, "");
      if (serveId) keys.push(serveId);
    }
  }
  return keys;
}

export { awsEnv, localPhotoPath };
