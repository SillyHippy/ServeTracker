import { createHash, randomBytes } from "crypto";
import type { Context, Next } from "hono";
import type { Database } from "bun:sqlite";

export interface ApiKeyRecord {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string;
  last_used_at?: string;
  expires_at?: string;
  revoked_at?: string;
  created_at: string;
  org_name?: string;
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(
  db: Database,
  params: { orgId?: string; userId: string; name: string; scopes?: string[]; expiresAt?: string }
): { rawKey: string; keyRecord: ApiKeyRecord } {
  const entropy = randomBytes(24).toString("hex");
  const rawKey = `st_live_${entropy}`;
  const keyPrefix = `st_live_${entropy.slice(0, 6)}...${entropy.slice(-4)}`;
  const keyHash = hashApiKey(rawKey);
  const id = `apk_${randomBytes(12).toString("hex")}`;
  const now = new Date().toISOString();
  const scopesStr = JSON.stringify(params.scopes || ["all"]);
  const orgId = params.orgId || "default";

  db.query(
    `INSERT INTO api_keys (id, org_id, user_id, name, key_prefix, key_hash, scopes, last_used_at, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`
  ).run(
    id,
    orgId,
    params.userId,
    params.name,
    keyPrefix,
    keyHash,
    scopesStr,
    params.expiresAt || null,
    now
  );

  const keyRecord: ApiKeyRecord = {
    id,
    org_id: orgId,
    user_id: params.userId,
    name: params.name,
    key_prefix: keyPrefix,
    key_hash: keyHash,
    scopes: scopesStr,
    expires_at: params.expiresAt,
    created_at: now,
  };

  return { rawKey, keyRecord };
}

export function verifyApiKey(db: Database, rawKey: string): ApiKeyRecord | null {
  if (!rawKey || !rawKey.startsWith("st_live_")) return null;
  const hash = hashApiKey(rawKey);
  const row = db.query(
    `SELECT k.*, 'Default Organization' as org_name
     FROM api_keys k
     WHERE k.key_hash = ? AND k.revoked_at IS NULL`
  ).get(hash) as ApiKeyRecord | null;

  if (!row) return null;

  if (row.expires_at) {
    const exp = new Date(row.expires_at).getTime();
    if (!Number.isNaN(exp) && Date.now() > exp) {
      return null;
    }
  }

  try {
    const now = new Date().toISOString();
    db.query("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now, row.id);
  } catch {}

  return row;
}

export function apiKeyAuthMiddleware(db: Database) {
  return async (c: Context, next: Next) => {
    const path = new URL(c.req.url).pathname;
    if (path.endsWith("/docs") || path.endsWith("/openapi.json")) {
      return next();
    }

    const authHeader = c.req.header("Authorization") || "";
    let rawKey = "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      rawKey = authHeader.slice(7).trim();
    } else if (c.req.header("x-api-key")) {
      rawKey = String(c.req.header("x-api-key")).trim();
    }

    if (!rawKey) {
      return c.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Missing API Key. Provide 'Authorization: Bearer st_live_...' or 'x-api-key' header.",
          },
        },
        401
      );
    }

    const key = verifyApiKey(db, rawKey);
    if (!key) {
      return c.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid, expired, or revoked API key.",
          },
        },
        401
      );
    }

    c.set("apiKey", key);
    c.set("orgId", key.org_id);

    await next();
  };
}
