/**
 * On successful personal service, upload attempt photos into the Google Drive
 * case folder under Site Upload (folder named by case number).
 *
 * Uses google_api.py (same path Hermes intake uses). Failures are logged —
 * they must never block the serve save / email path.
 */

import { spawn } from "child_process";
import { join } from "path";
import { UPLOADS_DIR } from "./db";

const SITE_UPLOAD =
  process.env.DRIVE_SITE_UPLOAD_FOLDER_ID || "1ZB7XTSC_eD6m3F-6_yI2VP065cKEQzVq";
const GAPI =
  process.env.GOOGLE_API_PY ||
  "/home/workspace/Projects/hermes-zo-skills/hermes-agent/productivity/google-workspace/scripts/google_api.py";

function run(cmd: string, args: string[], timeoutMs = 60000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: -1, out, err: err + "\n[timeout]" });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out, err });
    });
  });
}

async function findCaseFolder(caseNumber: string): Promise<string | null> {
  const safe = caseNumber.replace(/'/g, "\\'");
  const q = `name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and '${SITE_UPLOAD}' in parents and trashed = false`;
  const res = await run("python3", [GAPI, "drive", "search", "--raw-query", q, "--max", "5"]);
  if (res.code !== 0) {
    console.error("[drive] search failed:", res.err || res.out);
    return null;
  }
  try {
    const rows = JSON.parse(res.out.trim() || "[]");
    if (Array.isArray(rows) && rows[0]?.id) return String(rows[0].id);
  } catch (e) {
    console.error("[drive] search parse failed:", e, res.out);
  }
  return null;
}

async function createCaseFolder(caseNumber: string): Promise<string | null> {
  const res = await run("python3", [GAPI, "drive", "create-folder", caseNumber, "--parent", SITE_UPLOAD]);
  if (res.code !== 0) {
    console.error("[drive] create-folder failed:", res.err || res.out);
    return null;
  }
  try {
    const row = JSON.parse(res.out.trim() || "{}");
    return row.id ? String(row.id) : null;
  } catch {
    // Some CLI versions print plain text id=
    const m = res.out.match(/[a-zA-Z0-9_-]{20,}/);
    return m ? m[0] : null;
  }
}

function localPathFromUrl(imageUrl: string): string | null {
  if (!imageUrl) return null;
  const name = imageUrl.includes("/") ? imageUrl.split("/").pop()! : imageUrl;
  if (!name || name.includes("..")) return null;
  return join(UPLOADS_DIR, "serves", name);
}

export async function uploadSuccessfulServeToDrive(opts: {
  caseNumber: string;
  serveId: string;
  personBeingServed?: string;
  photos: Array<{ image_url?: string; imageUrl?: string; position?: number }>;
}): Promise<{ ok: boolean; folderId?: string; uploaded: number; error?: string }> {
  const caseNumber = (opts.caseNumber || "").trim();
  if (!caseNumber) return { ok: false, uploaded: 0, error: "missing case number" };

  let folderId = await findCaseFolder(caseNumber);
  if (!folderId) {
    folderId = await createCaseFolder(caseNumber);
  }
  if (!folderId) {
    return { ok: false, uploaded: 0, error: "could not create/find Drive folder" };
  }

  let uploaded = 0;
  const stamp = new Date().toISOString().slice(0, 10);
  for (const p of opts.photos || []) {
    const url = String(p.image_url || p.imageUrl || "");
    const local = localPathFromUrl(url);
    if (!local) continue;
    const pos = p.position || uploaded + 1;
    const remoteName = `${caseNumber}_serve_${opts.serveId.slice(0, 8)}_photo${pos}_${stamp}.jpg`;
    const res = await run("python3", [GAPI, "drive", "upload", local, "--name", remoteName, "--parent", folderId]);
    if (res.code === 0) {
      uploaded++;
    } else {
      console.error("[drive] upload failed:", remoteName, res.err || res.out);
    }
  }

  return { ok: uploaded > 0 || (opts.photos || []).length === 0, folderId, uploaded };
}
