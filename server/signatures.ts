import type { Context } from "hono";
import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import type { Db } from "./db";
import { DATA_DIR } from "./db";
import { getAuthUser, revokeSessionsForUser } from "./auth";

export const SIGNATURES_DIR = join(DATA_DIR, "signatures");

export const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024; // 2MB
export const SIGNATURE_MAX_DIM = 2000; // px

const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
};

function hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Magic-byte validation for the three allowed formats. */
export function detectMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Read image dimensions when cheaply parseable (PNG IHDR / JPEG SOF / WebP VP8).
 * Returns null when the layout is not parseable — callers accept those (the
 * canvas enrollment path always produces standard PNGs).
 */
export function readDimensions(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buf.length >= 24) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }
    if (mime === "image/jpeg") {
      // Scan markers for SOF0..SOF15 (except SOF markers 4,8,C which are DHT/JPG/DAC).
      let off = 2;
      while (off + 9 <= buf.length) {
        if (buf[off] !== 0xff) {
          off += 1;
          continue;
        }
        const marker = buf[off + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          off += 2;
          continue;
        }
        const len = buf.readUInt16BE(off + 2);
        if (len < 2) return null;
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          const height = buf.readUInt16BE(off + 5);
          const width = buf.readUInt16BE(off + 7);
          return { width, height };
        }
        off += 2 + len;
      }
      return null;
    }
    if (mime === "image/webp" && buf.length >= 30) {
      // VP8 lossy: 10-byte chunk header + 3-byte frame tag + 14-bit width/height
      // VP8L lossless: 5-byte header with 14-bit width/height packed
      const fourcc = buf.subarray(12, 16).toString("ascii");
      if (fourcc === "VP8 ") {
        const w = buf.readUInt16LE(26) & 0x3fff;
        const h = buf.readUInt16LE(28) & 0x3fff;
        return { width: w, height: h };
      }
      if (fourcc === "VP8L") {
        const b0 = buf[21];
        const b1 = buf[22];
        const b2 = buf[23];
        const b3 = buf[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width, height };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Strip EXIF / metadata chunks so no device data rides along:
 * - JPEG: remove APP1 (EXIF) segments.
 * - PNG: remove eXIf, tEXt, zTXt, iTXt chunks (camera make/model/software).
 * - WebP: pass through (no EXIF in base VP8/VP8L; extended VP8X not enrolled).
 */
export function stripMetadata(buf: Buffer, mime: string): Buffer {
  if (mime === "image/jpeg") {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
    const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])];
    let off = 2;
    while (off + 4 <= buf.length) {
      if (buf[off] !== 0xff) {
        chunks.push(buf.subarray(off));
        break;
      }
      const marker = buf[off + 1];
      // Standalone markers have no length field.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        chunks.push(buf.subarray(off, off + 2));
        off += 2;
        continue;
      }
      if (off + 4 > buf.length) break;
      const len = buf.readUInt16BE(off + 2);
      if (len < 2) break;
      const isExif = marker === 0xe1; // APP1 — EXIF/XMP lives here
      if (!isExif) {
        chunks.push(buf.subarray(off, off + 2 + len));
      }
      off += 2 + len;
    }
    if (chunks.length < 2) return buf;
    return Buffer.concat(chunks);
  }

  if (mime === "image/png") {
    if (buf.length < 8 || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return buf;
    }
    const chunks: Buffer[] = [Buffer.from(buf.subarray(0, 8))];
    let off = 8;
    while (off + 12 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.subarray(off + 4, off + 8).toString("ascii");
      if (off + 12 + len > buf.length) break;
      const keep = !["eXIf", "tEXt", "zTXt", "iTXt"].includes(type);
      if (keep) {
        chunks.push(buf.subarray(off, off + 12 + len));
      }
      off += 12 + len;
    }
    return Buffer.concat(chunks);
  }

  return buf;
}

export function validateSignatureImage(buf: Buffer): { ok: boolean; mime?: string; error?: string } {
  if (buf.length === 0) return { ok: false, error: "Empty image" };
  if (buf.length > SIGNATURE_MAX_BYTES) {
    return { ok: false, error: `Image exceeds the ${SIGNATURE_MAX_BYTES / 1024 / 1024}MB limit` };
  }
  const mime = detectMime(buf);
  if (!mime) return { ok: false, error: "Unsupported image type — use PNG, WebP, or JPEG" };
  const dims = readDimensions(buf, mime);
  if (dims && (dims.width > SIGNATURE_MAX_DIM || dims.height > SIGNATURE_MAX_DIM)) {
    return { ok: false, error: `Image exceeds ${SIGNATURE_MAX_DIM}x${SIGNATURE_MAX_DIM}px limit` };
  }
  return { ok: true, mime };
}

async function verifyUserPassword(userRow: Record<string, unknown> | null, password: string): Promise<boolean> {
  if (!userRow) return false;
  try {
    return await Bun.password.verify(password, String(userRow.password_hash));
  } catch {
    return password === String(userRow.password_hash);
  }
}

export function registerSignatureRoutes(app: {
  get: Function;
  post: Function;
  delete: Function;
}, db: Db) {
  // POST /api/me/signature — server enrolls/replaces own signature (password + ack required)
  app.post("/api/me/signature", async (c: Context) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (user.role !== "server") {
      return c.json({ error: "Only field servers can enroll a signature" }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const password = String(body.password || "");
    const mimeType = String(body.mime_type || body.mimeType || "");
    const ack = body.ack === true || body.acknowledged === true;
    let imageData = String(body.image_data || "");

    if (!password) return c.json({ error: "Current password is required" }, 400);
    if (!ack) {
      return c.json({ error: "You must confirm this is your signature before saving" }, 400);
    }

    const userRow = db.query("SELECT * FROM users WHERE id = ?").get(user.id) as Record<string, unknown> | null;
    if (!userRow) return c.json({ error: "User not found" }, 404);

    const okPass = await verifyUserPassword(userRow, password);
    if (!okPass) return c.json({ error: "Invalid password" }, 401);

    if (!imageData) return c.json({ error: "Signature image is required" }, 400);
    if (imageData.includes("base64,")) {
      imageData = imageData.split("base64,")[1];
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(imageData, "base64");
    } catch {
      return c.json({ error: "Invalid image encoding" }, 400);
    }

    const detected = validateSignatureImage(buf);
    if (!detected.ok || !detected.mime) return c.json({ error: detected.error || "Invalid image" }, 400);
    const mime = detected.mime;
    const ext = ALLOWED_MIME[mime];
    if (!ext) return c.json({ error: "Unsupported image type" }, 400);

    const normalized = stripMetadata(buf, mime);
    const sha = hex(normalized);

    await mkdir(SIGNATURES_DIR, { recursive: true });
    const assetId = "sig_" + randomUUID().replace(/-/g, "").slice(0, 20);
    const storageKey = `${assetId}${ext}`;
    await writeFile(join(SIGNATURES_DIR, storageKey), normalized);

    const dims = readDimensions(normalized, mime);
    const ts = new Date().toISOString();

    // Revoke previous active asset (retained for audit).
    const prev = db
      .query("SELECT id FROM user_signature_assets WHERE user_id = ? AND status = 'active'")
      .all(user.id) as { id: string }[];
    for (const p of prev) {
      db.query("UPDATE user_signature_assets SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ?").run(
        ts,
        ts,
        p.id
      );
    }

    db.query(
      `INSERT INTO user_signature_assets (id, user_id, storage_key, mime_type, sha256, width, height, status, created_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, '')`
    ).run(assetId, user.id, storageKey, mime, sha, dims?.width || 0, dims?.height || 0, ts, ts);

    db.query("UPDATE users SET signature_asset_id = ?, signature_updated_at = ? WHERE id = ?").run(assetId, ts, user.id);

    return c.json({ success: true, status: "enrolled", assetId, updatedAt: ts }, 201);
  });

  // DELETE /api/me/signature — server removes own signature (password required)
  app.delete("/api/me/signature", async (c: Context) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json().catch(() => ({}));
    const password = String(body.password || "");
    if (!password) return c.json({ error: "Current password is required" }, 400);

    const userRow = db.query("SELECT * FROM users WHERE id = ?").get(user.id) as Record<string, unknown> | null;
    const okPass = await verifyUserPassword(userRow, password);
    if (!okPass) return c.json({ error: "Invalid password" }, 401);

    const ts = new Date().toISOString();
    db.query("UPDATE user_signature_assets SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE user_id = ? AND status = 'active'").run(
      ts,
      ts,
      user.id
    );
    db.query("UPDATE users SET signature_asset_id = '', signature_updated_at = ? WHERE id = ?").run(ts, user.id);

    return c.json({ success: true, status: "revoked" });
  });

  // POST /api/users/:id/signature/revoke — admin revokes a server's signature
  app.post("/api/users/:id/signature/revoke", (c: Context) => {
    const user = getAuthUser(c);
    if (!user || user.role !== "admin") return c.json({ error: "Forbidden: Admin access required" }, 403);

    const id = c.req.param("id");
    const target = db.query("SELECT id FROM users WHERE id = ?").get(id) as { id: string } | null;
    if (!target) return c.json({ error: "User not found" }, 404);

    const ts = new Date().toISOString();
    db.query(
      "UPDATE user_signature_assets SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE user_id = ? AND status = 'active'"
    ).run(ts, ts, id);
    db.query("UPDATE users SET signature_asset_id = '', signature_updated_at = ? WHERE id = ?").run(ts, id);

    return c.json({ success: true, status: "revoked" });
  });

  // GET /api/signatures/:assetId/render — owner or admin only; bytes never public
  app.get("/api/signatures/:assetId/render", async (c: Context) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const assetId = c.req.param("assetId");
    const asset = db.query("SELECT * FROM user_signature_assets WHERE id = ?").get(assetId) as
      | Record<string, unknown>
      | null;
    if (!asset || asset.status !== "active") {
      return c.json({ error: "Signature not found" }, 404);
    }
    if (user.role !== "admin" && String(asset.user_id) !== user.id) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const { readFile } = await import("fs/promises");
      const buf = await readFile(join(SIGNATURES_DIR, String(asset.storage_key)));
      const mime = String(asset.mime_type || "image/png");
      return c.json({
        assetId: asset.id,
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
        mimeType: mime,
        width: asset.width,
        height: asset.height,
        updatedAt: asset.updated_at,
      });
    } catch {
      return c.json({ error: "Signature file unavailable" }, 404);
    }
  });
}

/** Delete an asset's file from disk (best-effort; used when users are deleted). */
export async function deleteSignatureFile(storageKey: string) {
  try {
    await unlink(join(SIGNATURES_DIR, storageKey));
  } catch {
    // file may not exist
  }
}

export { ALLOWED_MIME, revokeSessionsForUser };
