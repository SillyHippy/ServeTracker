declare const Bun: any;
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { createHash, randomBytes, randomUUID, randomInt } from "crypto";
import type { Db } from "./db";
import {
  computeLicenseStatus,
  invalidateExecutionsForCase,
  invalidateForServerChanges,
} from "./affidavitExecution";

export const SESSION_COOKIE = (process.env.SESSION_COOKIE_NAME as string) || "serve_tracker_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

let db: Db | null = null;

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "server";
  mustChangePassword?: boolean;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const PUBLIC_RESET_HOST = "servetracker.justlegalsolutions.org";

function publicResetUrl(_c: Context, rawToken: string): string {
  const env = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const bad = /localhost|127\.0\.0\.1|:3150|:3153|0\.0\.0\.0/i;
  const base = env && !bad.test(env) ? env : `https://${PUBLIC_RESET_HOST}`;
  return `${base}/reset-password?token=${rawToken}`;
}

export function initAuth(database: Db) {
  db = database;
  purgeExpiredSessions();
}

function purgeExpiredSessions() {
  if (!db) return;
  db.run("DELETE FROM sessions WHERE expires_at <= ?", [new Date().toISOString()]);
}

export function createSession(user: AuthUser): string {
  if (!db) throw new Error("Auth not initialized");

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SEC * 1000);
  const sessionId = randomUUID();

  db.run(
    "INSERT INTO sessions (token_hash, user_id, role, username, display_name, session_id, last_seen_at, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [tokenHash, user.id, user.role, user.username, user.displayName, sessionId, now.toISOString(), now.toISOString(), expiresAt.toISOString()]
  );

  return token;
}

export function destroySession(token: string | undefined) {
  if (!token || !db) return;
  db.run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
}

/** Mark every non-revoked session for a user as revoked (retained for audit). */
export function revokeSessionsForUser(userId: string, actorUserId: string, exceptTokenHash?: string) {
  if (!db) return;
  if (exceptTokenHash) {
    db.run(
      "UPDATE sessions SET revoked_at = ?, revoked_by_user_id = ? WHERE user_id = ? AND token_hash != ? AND (revoked_at = '' OR revoked_at IS NULL)",
      [new Date().toISOString(), actorUserId, userId, exceptTokenHash]
    );
  } else {
    db.run(
      "UPDATE sessions SET revoked_at = ?, revoked_by_user_id = ? WHERE user_id = ? AND (revoked_at = '' OR revoked_at IS NULL)",
      [new Date().toISOString(), actorUserId, userId]
    );
  }
}

/** Look up the raw users row for a user id (no password hash included by default). */
export function getUserRow(userId: string): Record<string, unknown> | null {
  if (!db) return null;
  return db.query("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown> | null;
}

const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

export function getSessionUser(token: string | undefined): AuthUser | null {
  if (!token || !db) return null;

  const sessionRow = db
    .query(
      "SELECT user_id, role, username, display_name, last_seen_at, revoked_at FROM sessions WHERE token_hash = ? AND expires_at > ?"
    )
    .get(hashToken(token), new Date().toISOString()) as {
      user_id?: string;
      role?: string;
      username?: string;
      display_name?: string;
      last_seen_at?: string;
      revoked_at?: string;
    } | null;

  if (!sessionRow) return null;
  if (sessionRow.revoked_at && sessionRow.revoked_at !== "") return null;

  let user: AuthUser | null = null;

  // Prefer the live users row (enforces is_active + must_change_password).
  if (sessionRow.user_id) {
    const userRow = db
      .query("SELECT id, username, display_name, role, is_active, must_change_password FROM users WHERE id = ?")
      .get(sessionRow.user_id) as {
        id: string;
        username: string;
        display_name: string;
        role: string;
        is_active: number;
        must_change_password: number;
      } | null;

    if (userRow) {
      if (userRow.is_active === 0) return null;
      user = {
        id: userRow.id,
        username: userRow.username,
        displayName: userRow.display_name,
        role: (userRow.role as "admin" | "server") || "server",
        mustChangePassword: userRow.must_change_password === 1,
      };
    }
  }

  // Legacy/fallback: admin session rows whose user_id no longer resolves.
  if (!user) {
    user = {
      id: sessionRow.user_id || "usr_admin_default",
      username: sessionRow.username || "admin",
      displayName: sessionRow.display_name || "Admin",
      role: (sessionRow.role as "admin" | "server") || "admin",
    };
  }

  // Throttled last_seen_at / last_activity_at write (max once per 15 min).
  const lastSeen = sessionRow.last_seen_at || "";
  const nowIso = new Date().toISOString();
  const stale =
    !lastSeen || Number.isNaN(new Date(lastSeen).getTime()) || Date.now() - new Date(lastSeen).getTime() > LAST_SEEN_THROTTLE_MS;
  if (stale) {
    try {
      db.run("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", [nowIso, hashToken(token)]);
      if (user.id) db.run("UPDATE users SET last_activity_at = ? WHERE id = ?", [nowIso, user.id]);
    } catch {
      // Non-fatal: activity tracking is best-effort.
    }
  }

  return user;
}

export function getAuthUser(c: Context): AuthUser | null {
  const fromContext = c.get("user") as AuthUser | undefined;
  if (fromContext) return fromContext;

  let token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    const auth = c.req.header("Authorization");
    if (auth?.startsWith("Bearer ")) {
      token = auth.slice(7);
    }
  }
  return getSessionUser(token);
}

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const path = c.req.path;
    if (
      path === "/api/health" ||
      path === "/api/auth/login" ||
      path === "/api/auth/me" ||
      path === "/api/auth/register-server" ||
      path === "/api/auth/forgot-password" ||
      path === "/api/auth/verify-reset-token" ||
      path === "/api/auth/reset-password" ||
      path === "/api/push/vapid-public-key" ||
      path.startsWith("/uploads/serves/")
    ) {
      return next();
    }

    if (path.startsWith("/api/")) {
      let token = getCookie(c, SESSION_COOKIE);
      if (!token) {
        const auth = c.req.header("Authorization");
        if (auth?.startsWith("Bearer ")) {
          token = auth.slice(7);
        }
      }

      const user = getSessionUser(token);
      if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      // First-login gate: must change password before reaching the app.
      if (user.mustChangePassword) {
        const allowed =
          path === "/api/auth/me" ||
          path === "/api/auth/logout" ||
          path === "/api/me/change-password" ||
          (path === "/api/me/profile" && c.req.method === "GET");
        if (!allowed) {
          return c.json(
            { error: "Password change required", code: "PASSWORD_CHANGE_REQUIRED" },
            403
          );
        }
      }

      c.set("user", user);
    }

    return next();
  };
}

// In-memory login rate limiter: 5 failures per identity per 15 min → 429.
const loginFailures = new Map<string, { count: number; firstAt: number }>();
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function checkLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry) return true;
  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return true;
  }
  return entry.count < LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function clearLoginFailures(key: string) {
  loginFailures.delete(key);
}

function clientIp(c: Context): string {
  const cf = (c.req.header("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const xff = (c.req.header("x-forwarded-for") || "").split(",")[0].trim();
  return xff || "127.0.0.1";
}

const resetFailures = new Map<string, { count: number; firstAt: number }>();
const RESET_MAX_FAILURES = 3;
const RESET_VERIFY_MAX = 10;
const RESET_WINDOW_MS = 15 * 60 * 1000;

function checkKeyedRateLimit(store: Map<string, { count: number; firstAt: number }>, key: string, max: number): boolean {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) return true;
  if (now - entry.firstAt > RESET_WINDOW_MS) {
    store.delete(key);
    return true;
  }
  return entry.count < max;
}

function recordKeyedFailure(store: Map<string, { count: number; firstAt: number }>, key: string) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now - entry.firstAt > RESET_WINDOW_MS) {
    store.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function logAuthAudit(event: {
  event_type: string;
  actor_user_id?: string;
  actor_role?: string;
  target_resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  details?: Record<string, unknown>;
}) {
  if (!db) return;
  try {
    const id = "aud_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    db.query(
      `INSERT INTO audit_logs (id, event_type, actor_user_id, actor_role, target_resource_id, ip_address, user_agent, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      event.event_type,
      event.actor_user_id || "",
      event.actor_role || "",
      event.target_resource_id || "",
      event.ip_address || "",
      event.user_agent || "",
      JSON.stringify(event.details || {}),
      new Date().toISOString()
    );
  } catch (err) {
    console.error("Audit log error:", err);
  }
}

function recordUserConsent(database: Db, opts: {
  userId: string;
  documentType: string;
  version: string;
  ip: string;
  userAgent: string;
}) {
  const now = nowIso();
  const id = "cs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  database
    .query(
      `INSERT INTO user_consents (id, user_id, document_type, version, accepted_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, opts.userId, opts.documentType, opts.version, now, opts.ip, opts.userAgent);
  if (opts.documentType === "tos") {
    database.query("UPDATE users SET tos_accepted_at = ?, tos_version = ?, tos_ip = ? WHERE id = ?").run(now, opts.version, opts.ip, opts.userId);
  }
}

export async function handleLogin(c: Context) {
  const body = (await c.req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  const username = (body.username || "").trim();
  const password = body.password || "";
  const ip = clientIp(c);
  const rateKey = (ip + ":" + (username || "admin")).toLowerCase();
  const userAgent = c.req.header("user-agent") || "";

  if (!password) {
    return c.json({ success: false, message: "Password is required" }, 400);
  }

  if (!checkLoginRateLimit(rateKey)) {
    return c.json(
      { success: false, message: "Too many failed attempts. Please try again later." },
      429
    );
  }

  if (!db) {
    return c.json({ success: false, message: "Database not initialized" }, 500);
  }

  const loginIdentifier = username || "admin";
  const userRow = db
    .query(
      `SELECT id, username, password_hash, display_name, role, is_active, must_change_password 
       FROM users 
       WHERE (username = ? COLLATE NOCASE OR (email = ? COLLATE NOCASE AND email != ''))`
    )
    .get(loginIdentifier, loginIdentifier) as {
      id: string;
      username: string;
      password_hash: string;
      display_name: string;
      role: string;
      is_active: number;
      must_change_password: number;
    } | null;

  if (!userRow || userRow.is_active === 0) {
    recordLoginFailure(rateKey);
    logAuthAudit({
      event_type: "auth.login_failure",
      ip_address: ip,
      user_agent: userAgent,
      details: { reason: "unknown_or_inactive", identifier: loginIdentifier },
    });
    return c.json({ success: false, message: "Invalid username, email, or password" }, 401);
  }

  let isMatch = false;
  try {
    isMatch = await Bun.password.verify(password, userRow.password_hash);
  } catch {
    isMatch = false;
  }

  if (!isMatch) {
    recordLoginFailure(rateKey);
    logAuthAudit({
      event_type: "auth.login_failure",
      actor_user_id: userRow.id,
      actor_role: userRow.role,
      ip_address: ip,
      user_agent: userAgent,
      details: { reason: "bad_password" },
    });
    return c.json({ success: false, message: "Invalid username, email, or password" }, 401);
  }

  clearLoginFailures(rateKey);
  db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [new Date().toISOString(), userRow.id]);

  const authUser: AuthUser = {
    id: userRow.id,
    username: userRow.username,
    displayName: userRow.display_name,
    role: (userRow.role as "admin" | "server") || "server",
    mustChangePassword: userRow.must_change_password === 1,
  };

  const isHttps = c.req.header("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  const token = createSession(authUser);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps,
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });

  logAuthAudit({
    event_type: "auth.login_success",
    actor_user_id: authUser.id,
    actor_role: authUser.role,
    ip_address: ip,
    user_agent: userAgent,
  });

  return c.json({
    success: true,
    token,
    user: authUser,
  });
}

export function handleLogout(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  destroySession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ success: true });
}

export function handleAuthMe(c: Context) {
  let token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    const auth = c.req.header("Authorization");
    if (auth?.startsWith("Bearer ")) {
      token = auth.slice(7);
    }
  }

  const user = getSessionUser(token);
  if (!user) {
    // A dead/revoked/expired session is an authentication failure, same as
    // any other endpoint — lets clients distinguish "logged out" from "ok".
    return c.json({ authenticated: false, user: null }, 401);
  }
  return c.json({
    authenticated: true,
    user,
  });
}

// User Management Handlers (Admin Only) + self-service profile/session endpoints
function newId() {
  return randomUUID().replace(/-/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function isValidLicenseDate(value: unknown): boolean {
  const s = String(value || "").trim();
  if (!s) return true; // empty allowed (incomplete state)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
}

function normalizeTerritory(value: unknown): { ok: boolean; value?: string[]; error?: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: "serviceTerritory must be an array of county names" };
  if (value.length > 100) return { ok: false, error: "serviceTerritory has too many entries" };
  const clean = value.map((v) => String(v).trim()).filter(Boolean);
  for (const v of clean) {
    if (v.length > 100) return { ok: false, error: "serviceTerritory entries are too long" };
  }
  return { ok: true, value: clean };
}

function validEmail(v: unknown): string {
  const s = String(v || "").trim();
  if (!s) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

function licenseStatusOf(row: Record<string, unknown>) {
  return computeLicenseStatus(row.license_number, row.license_jurisdiction, row.license_expires_at);
}

function signatureStatusFor(db: Database, row: Record<string, unknown>) {
  const assetId = String(row.signature_asset_id || "");
  if (!assetId) return { enrolled: false, revoked: false, updatedAt: "" };
  const asset = db
    .query("SELECT status, updated_at FROM user_signature_assets WHERE id = ?")
    .get(assetId) as { status?: string; updated_at?: string } | null;
  if (!asset) return { enrolled: false, revoked: false, updatedAt: "" };
  return {
    enrolled: asset.status === "active",
    revoked: asset.status === "revoked",
    updatedAt: asset.updated_at || "",
  };
}

function activeCaseCountFor(db: Database, userId: string): number {
  const row = db
    .query(
      `SELECT COUNT(*) as c FROM client_cases
       WHERE assigned_to = ? AND lower(COALESCE(status,'')) NOT IN ('closed','completed')`
    )
    .get(userId) as { c: number };
  return Number(row?.c || 0);
}

function territoryOf(row: Record<string, unknown>): string[] {
  try {
    const parsed = JSON.parse(String(row.service_territory_json || "[]"));
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function adminUserRow(db: Database, row: Record<string, unknown>) {
  const sig = signatureStatusFor(db, row);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    legalName: row.legal_name || "",
    role: row.role,
    isActive: row.is_active === 1 || row.is_active === true,
    email: row.email || "",
    phone: row.phone || "",
    licenseNumber: row.license_number || "",
    licenseJurisdiction: row.license_jurisdiction || "",
    licenseExpiresAt: row.license_expires_at || "",
    licenseStatus: licenseStatusOf(row),
    serviceTerritory: territoryOf(row),
    onboardingStatus: row.onboarding_status || "pending",
    mustChangePassword: row.must_change_password === 1 || row.must_change_password === true,
    profileNotes: row.profile_notes || "",
    signatureStatus: sig,
    activeCaseCount: activeCaseCountFor(db, String(row.id)),
    lastLoginAt: row.last_login_at || "",
    lastActivityAt: row.last_activity_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function selfUserRow(db: Database, row: Record<string, unknown>) {
  const sig = signatureStatusFor(db, row);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    legalName: row.legal_name || "",
    role: row.role,
    email: row.email || "",
    phone: row.phone || "",
    licenseNumber: row.license_number || "",
    licenseJurisdiction: row.license_jurisdiction || "",
    licenseExpiresAt: row.license_expires_at || "",
    licenseStatus: licenseStatusOf(row),
    serviceTerritory: territoryOf(row),
    profileNotes: row.profile_notes || "",
    onboardingStatus: row.onboarding_status || "pending",
    mustChangePassword: row.must_change_password === 1 || row.must_change_password === true,
    signatureStatus: sig,
    lastLoginAt: row.last_login_at || "",
    lastActivityAt: row.last_activity_at || "",
    createdAt: row.created_at,
  };
}

export function registerUserRoutes(app: any, database: Database) {
  // GET /api/users - List all users (servers + admins) with profile/workload facts
  app.get("/api/users", (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser || authUser.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }

    const rows = database
      .query("SELECT * FROM users ORDER BY created_at ASC")
      .all() as Record<string, unknown>[];

    return c.json(rows.map((r) => adminUserRow(database, r)));
  });

  // GET /api/users/:id - Admin detail view
  app.get("/api/users/:id", (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser || authUser.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const row = database.query("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return c.json({ error: "User not found" }, 404);
    return c.json(adminUserRow(database, row));
  });

  // POST /api/users - Create field server with full intake profile.
  // The Add Field Server workflow ALWAYS creates a server role account.
  app.post("/api/users", async (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser || authUser.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const displayName = String(body.displayName || body.display_name || username).trim();
    const role = "server"; // intake workflow cannot create admins

    if (!username || !password) {
      return c.json({ error: "Username and password are required" }, 400);
    }
    if (username.length < 2) {
      return c.json({ error: "Username must be at least 2 characters" }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }

    const existing = database
      .query("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
      .get(username);
    if (existing) {
      return c.json({ error: "Username already exists" }, 400);
    }

    if (body.licenseExpiresAt !== undefined && !isValidLicenseDate(body.licenseExpiresAt)) {
      return c.json({ error: "licenseExpiresAt must be YYYY-MM-DD" }, 400);
    }
    const territory = normalizeTerritory(body.serviceTerritory);
    if (!territory.ok) return c.json({ error: territory.error }, 400);

    const userId = "usr_" + newId().slice(0, 16);
    const pwdHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const ts = nowIso();

    database
      .query(
        `INSERT INTO users (
          id, username, password_hash, display_name, role, is_active,
          email, phone, legal_name, license_number, license_jurisdiction, license_expires_at,
          service_territory_json, onboarding_status, must_change_password, profile_notes,
          signature_asset_id, signature_updated_at, last_login_at, last_activity_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, '', '', '', '', ?, ?)`
      )
      .run(
        userId,
        username,
        pwdHash,
        displayName,
        role,
        String(body.email || "").trim(),
        String(body.phone || "").trim(),
        String(body.legalName || body.legal_name || displayName).trim(),
        String(body.licenseNumber || body.license_number || "").trim(),
        String(body.licenseJurisdiction || body.license_jurisdiction || "").trim(),
        String(body.licenseExpiresAt || body.license_expires_at || "").trim(),
        JSON.stringify(territory.value || []),
        String(body.profileNotes || "").trim(),
        ts,
        ts
      );

    const row = database.query("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown>;
    return c.json(
      {
        success: true,
        user: adminUserRow(database, row),
      },
      201
    );
  });

  // PUT /api/users/:id - Admin profile/onboarding/password/activation updates
  app.put("/api/users/:id", async (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser || authUser.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }

    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const userRow = database.query("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | null;

    if (!userRow) {
      return c.json({ error: "User not found" }, 404);
    }

    const isPrimaryAdmin = id === "usr_admin_default" || String(userRow.username || "").toLowerCase() === "admin";
    const ts = nowIso();

    if (body.isActive !== undefined) {
      const wanted = body.isActive ? 1 : 0;
      if (wanted === 0 && isPrimaryAdmin) {
        return c.json({ error: "Cannot deactivate the primary administrator account" }, 400);
      }
      if (wanted === 0 && String(userRow.is_active) === "1") {
        // Deactivation: revoke sessions + void signed affidavits on assigned cases.
        revokeSessionsForUser(id, authUser.id);
        invalidateForServerChanges(database, id, "server_deactivated");
      }
    }

    if (body.password && String(body.password).trim()) {
      const pwdHash = await Bun.password.hash(String(body.password).trim(), { algorithm: "argon2id" });
      database
        .query("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?")
        .run(pwdHash, ts, id);
      // Reset invalidates every existing session for that user.
      revokeSessionsForUser(id, authUser.id);
    }

    if (body.licenseExpiresAt !== undefined && !isValidLicenseDate(body.licenseExpiresAt)) {
      return c.json({ error: "licenseExpiresAt must be YYYY-MM-DD" }, 400);
    }
    const territory = normalizeTerritory(body.serviceTerritory);
    if (!territory.ok) return c.json({ error: territory.error }, 400);

    const licenseChanged =
      (body.licenseNumber !== undefined && String(body.licenseNumber) !== String(userRow.license_number || "")) ||
      (body.licenseJurisdiction !== undefined &&
        String(body.licenseJurisdiction) !== String(userRow.license_jurisdiction || "")) ||
      (body.licenseExpiresAt !== undefined &&
        String(body.licenseExpiresAt) !== String(userRow.license_expires_at || ""));

    const displayName = body.displayName !== undefined ? String(body.displayName).trim() : userRow.display_name;
    const legalName =
      body.legalName !== undefined || body.legal_name !== undefined
        ? String(body.legalName || body.legal_name).trim()
        : (userRow.legal_name || "");
    const email = body.email !== undefined ? String(body.email).trim() : (userRow.email || "");
    const phone = body.phone !== undefined ? String(body.phone).trim() : (userRow.phone || "");
    const licenseNumber =
      body.licenseNumber !== undefined || body.license_number !== undefined
        ? String(body.licenseNumber || body.license_number || "").trim()
        : (userRow.license_number || "");
    const licenseJurisdiction =
      body.licenseJurisdiction !== undefined || body.license_jurisdiction !== undefined
        ? String(body.licenseJurisdiction || body.license_jurisdiction || "").trim()
        : (userRow.license_jurisdiction || "");
    const licenseExpiresAt =
      body.licenseExpiresAt !== undefined || body.license_expires_at !== undefined
        ? String(body.licenseExpiresAt || body.license_expires_at || "").trim()
        : (userRow.license_expires_at || "");
    const profileNotes =
      body.profileNotes !== undefined || body.profile_notes !== undefined
        ? String(body.profileNotes || body.profile_notes || "").trim()
        : (userRow.profile_notes || "");
    const onboardingStatus =
      body.onboardingStatus !== undefined || body.onboarding_status !== undefined
        ? String(body.onboardingStatus || body.onboarding_status || "").trim()
        : (userRow.onboarding_status || "");
    const isActive = body.isActive !== undefined ? (body.isActive ? 1 : 0) : userRow.is_active;

    const territoryValue =
      body.serviceTerritory !== undefined || body.service_territory !== undefined
        ? territory.value
        : territoryOf(userRow);

    database
      .query(
        `UPDATE users SET
          display_name = ?, legal_name = ?, email = ?, phone = ?,
          license_number = ?, license_jurisdiction = ?, license_expires_at = ?,
          service_territory_json = ?, profile_notes = ?, onboarding_status = ?,
          is_active = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        displayName,
        legalName,
        email,
        phone,
        licenseNumber,
        licenseJurisdiction,
        licenseExpiresAt,
        JSON.stringify(territoryValue || []),
        profileNotes,
        onboardingStatus,
        isActive,
        ts,
        id
      );

    // License/credential edits invalidate signed affidavits for that server's cases.
    if (licenseChanged) {
      invalidateForServerChanges(database, id, "server_credential_changed");
    }

    const row = database.query("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json({ success: true, user: adminUserRow(database, row) });
  });

  // POST /api/users/:id/revoke-sessions - Admin revokes every session for a user
  app.post("/api/users/:id/revoke-sessions", (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser || authUser.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const userRow = database.query("SELECT id FROM users WHERE id = ?").get(id);
    if (!userRow) return c.json({ error: "User not found" }, 404);

    revokeSessionsForUser(id, authUser.id);
    return c.json({ success: true });
  });

  // DELETE /api/users/:id - Delete a user (also cleans assignments + signature assets)
  app.delete("/api/users/:id", async (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser || authUser.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }

    const id = c.req.param("id");
    if (id === "usr_admin_default" || id === authUser.id) {
      return c.json({ error: "Cannot delete current or primary admin account" }, 400);
    }

    const userRow = database.query("SELECT signature_asset_id FROM users WHERE id = ?").get(id) as
      | { signature_asset_id?: string }
      | null;
    if (!userRow) return c.json({ error: "User not found" }, 404);

    // Release assigned cases and void signed affidavits.
    const cases = database.query("SELECT id FROM client_cases WHERE assigned_to = ?").all(id) as { id: string }[];
    for (const cse of cases) {
      invalidateExecutionsForCase(database, cse.id, "server_removed");
      database
        .query("UPDATE client_cases SET assigned_to = '', assigned_name = '', updated_at = ? WHERE id = ?")
        .run(nowIso(), cse.id);
    }

    const assets = database.query("SELECT storage_key FROM user_signature_assets WHERE user_id = ?").all(id) as {
      storage_key: string;
    }[];
    for (const a of assets) {
      try {
        const { deleteSignatureFile } = await import("./signatures");
        await deleteSignatureFile(a.storage_key);
      } catch {
        // best-effort
      }
    }

    database.query("DELETE FROM sessions WHERE user_id = ?").run(id);
    database.query("DELETE FROM notifications WHERE user_id = ?").run(id);
    database.query("DELETE FROM password_reset_tokens WHERE user_id = ?").run(id);
    database.query("DELETE FROM user_signature_assets WHERE user_id = ?").run(id);
    database.query("UPDATE affidavit_executions SET signed_by_user_id = '', applied_by_user_id = '' WHERE signed_by_user_id = ? OR applied_by_user_id = ?").run(id, id);
    database.query("UPDATE serve_attempts SET logged_by = '' WHERE logged_by = ?").run(id);
    database.query("DELETE FROM users WHERE id = ?").run(id);

    return c.json({ success: true });
  });

  // ---------- Self-service endpoints ----------

  // GET /api/me/profile - own safe profile (never notes, never hashes)
  app.get("/api/me/profile", (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser) return c.json({ error: "Unauthorized" }, 401);
    const row = database.query("SELECT * FROM users WHERE id = ?").get(authUser.id) as Record<string, unknown> | null;
    if (!row) return c.json({ error: "User not found" }, 404);
    return c.json(selfUserRow(database, row));
  });

  // PUT /api/me/profile - self edits limited to contact/display fields
  app.put("/api/me/profile", async (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json().catch(() => ({}));

    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.displayName !== undefined) {
      const v = String(body.displayName).trim();
      if (!v) return c.json({ error: "displayName cannot be empty" }, 400);
      updates.push("display_name = ?");
      values.push(v);
    }
    if (body.email !== undefined) {
      const v = validEmail(body.email);
      updates.push("email = ?");
      values.push(v);
    }
    if (body.phone !== undefined) {
      updates.push("phone = ?");
      values.push(String(body.phone).trim());
    }
    if (body.serviceTerritory !== undefined || body.service_territory !== undefined) {
      const raw = body.serviceTerritory || body.service_territory;
      const list = Array.isArray(raw)
        ? raw.map((s: unknown) => String(s).trim()).filter(Boolean)
        : typeof raw === "string"
        ? raw.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      updates.push("service_territory_json = ?");
      values.push(JSON.stringify(list));
    }
    if (body.profileNotes !== undefined || body.profile_notes !== undefined) {
      updates.push("profile_notes = ?");
      values.push(String(body.profileNotes || body.profile_notes || "").trim());
    }
    if (updates.length === 0) {
      return c.json({ error: "No editable fields provided (displayName, email, phone, serviceTerritory, profileNotes)" }, 400);
    }
    values.push(nowIso(), authUser.id);
    database.query(`UPDATE users SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`).run(...values);

    const row = database.query("SELECT * FROM users WHERE id = ?").get(authUser.id) as Record<string, unknown>;
    return c.json({ success: true, user: selfUserRow(database, row) });
  });

  // POST /api/me/change-password - first-login / voluntary password change
  app.post("/api/me/change-password", async (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const currentPassword = String(body.currentPassword || body.current_password || "");
    const newPassword = String(body.newPassword || body.new_password || "");

    if (!currentPassword || !newPassword) {
      return c.json({ error: "Current and new password are required" }, 400);
    }
    if (newPassword.length < 8) {
      return c.json({ error: "New password must be at least 8 characters" }, 400);
    }

    const row = database.query("SELECT * FROM users WHERE id = ?").get(authUser.id) as Record<string, unknown> | null;
    if (!row) return c.json({ error: "User not found" }, 404);

    let ok = false;
    const hash = String(row.password_hash || "");
    if (hash && hash.startsWith("$argon2")) {
      try {
        ok = await Bun.password.verify(currentPassword, hash);
      } catch {
        ok = false;
      }
    }
    if (!ok) return c.json({ error: "Current password is incorrect" }, 400);

    const pwdHash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
    database
      .query("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
      .run(pwdHash, nowIso(), authUser.id);

    // Revoke all OTHER sessions; current device stays logged in.
    const token = getCookie(c, SESSION_COOKIE);
    revokeSessionsForUser(authUser.id, authUser.id, token ? hashToken(token) : undefined);

    return c.json({ success: true, mustChangePassword: false });
  });

  // GET /api/me/sessions - list own sessions (session ids, never tokens)
  app.get("/api/me/sessions", (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser) return c.json({ error: "Unauthorized" }, 401);

    const token = getCookie(c, SESSION_COOKIE);
    let currentSessionId = "";
    if (token) {
      const cur = database
        .query("SELECT session_id FROM sessions WHERE token_hash = ?")
        .get(hashToken(token)) as { session_id?: string } | null;
      currentSessionId = cur?.session_id || "";
    }

    const rows = database
      .query(
        `SELECT session_id, created_at, expires_at, last_seen_at, revoked_at
         FROM sessions
         WHERE user_id = ?
           AND (revoked_at IS NULL OR revoked_at = '')
           AND expires_at > ?
         ORDER BY created_at DESC`
      )
      .all(authUser.id, new Date().toISOString()) as {
        session_id?: string;
        created_at?: string;
        expires_at?: string;
        last_seen_at?: string;
        revoked_at?: string;
      }[];

    return c.json(
      rows.map((r) => ({
        sessionId: r.session_id || "",
        createdAt: r.created_at || "",
        expiresAt: r.expires_at || "",
        lastSeenAt: r.last_seen_at || "",
        revoked: Boolean(r.revoked_at && r.revoked_at !== ""),
        current: r.session_id === currentSessionId,
      }))
    );
  });

  // POST /api/me/sessions/revoke-other - revoke one other session or all others
  app.post("/api/me/sessions/revoke-other", async (c: Context) => {
    const authUser = getAuthUser(c);
    if (!authUser) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "").trim();

    const token = getCookie(c, SESSION_COOKIE);
    const currentHash = token ? hashToken(token) : "";

    if (sessionId) {
      const target = database
        .query("SELECT token_hash FROM sessions WHERE session_id = ? AND user_id = ?")
        .get(sessionId, authUser.id) as { token_hash?: string } | null;
      if (!target) return c.json({ error: "Session not found" }, 404);
      if (target.token_hash === currentHash) {
        return c.json({ error: "Use logout-current to end this device's session" }, 400);
      }
      database
        .query(
          "UPDATE sessions SET revoked_at = ?, revoked_by_user_id = ? WHERE session_id = ? AND user_id = ?"
        )
        .run(nowIso(), authUser.id, sessionId, authUser.id);
    } else {
      // Prefer except-by-session-id so a cookie encoding mismatch cannot revoke this device too.
      const cur = currentHash
        ? (database
            .query("SELECT session_id FROM sessions WHERE token_hash = ? AND user_id = ?")
            .get(currentHash, authUser.id) as { session_id?: string } | null)
        : null;
      if (cur?.session_id) {
        database
          .query(
            `UPDATE sessions SET revoked_at = ?, revoked_by_user_id = ?
             WHERE user_id = ? AND session_id != ? AND (revoked_at = '' OR revoked_at IS NULL)`
          )
          .run(nowIso(), authUser.id, authUser.id, cur.session_id);
      } else {
        revokeSessionsForUser(authUser.id, authUser.id, currentHash || undefined);
      }
    }
    return c.json({ success: true });
  });

  // POST /api/me/sessions/logout-current - end the current device session
  app.post("/api/me/sessions/logout-current", (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    destroySession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ success: true });
  });

  // =========================================================================
  // PUBLIC FIELD SERVER REGISTRATION & PASSWORD RESET
  // =========================================================================

  // POST /api/auth/register-server - Public field server self-onboarding
  app.post("/api/auth/register-server", async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const displayName = String(body.displayName || body.display_name || body.legalName || body.legal_name || username).trim();
    const legalName = String(body.legalName || body.legal_name || displayName).trim();
    const email = validEmail(body.email);
    const phone = String(body.phone || "").trim();
    const licenseNumber = String(body.licenseNumber || body.license_number || "").trim();
    const licenseJurisdiction = String(body.licenseJurisdiction || body.license_jurisdiction || "Oklahoma").trim();
    const licenseExpiresAt = String(body.licenseExpiresAt || body.license_expires_at || "").trim();
    const territoryRaw = body.serviceTerritory || body.service_territory || [];
    const territory = Array.isArray(territoryRaw)
      ? territoryRaw.map((s: unknown) => String(s).trim()).filter(Boolean)
      : typeof territoryRaw === "string"
      ? territoryRaw.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];

    // Service Areas & Pricing Notes
    const standardRate = String(body.standardRate || body.standard_rate || "").trim();
    const rushRate = String(body.rushRate || body.rush_rate || "").trim();
    const rateNotes = String(body.rateNotes || body.rate_notes || "").trim();
    const customNotes = String(body.profileNotes || body.profile_notes || "").trim();

    let combinedNotes = "";
    if (standardRate || rushRate) {
      combinedNotes += `Rates: Standard ${standardRate ? `$${standardRate.replace(/^\$/, '')}` : 'N/A'} | Rush ${rushRate ? `$${rushRate.replace(/^\$/, '')}` : 'N/A'}\n`;
    }
    if (rateNotes) {
      combinedNotes += `Pricing Details: ${rateNotes}\n`;
    }
    if (customNotes) {
      combinedNotes += `Notes: ${customNotes}`;
    }
    combinedNotes = combinedNotes.trim();

    if (!username || username.length < 2) {
      return c.json({ error: "Username is required (minimum 2 characters)" }, 400);
    }
    if (!password || password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }
    if (!displayName) {
      return c.json({ error: "Display name or legal name is required" }, 400);
    }

    const acceptedTos = body.accepted_tos === true || body.acceptedTos === true || String(body.accepted_tos || "").toLowerCase() === "true";
    const tosVersion = String(body.tos_version || body.tosVersion || "2026.1").trim() || "2026.1";
    if (!acceptedTos) {
      return c.json({ error: "You must accept the Terms of Service and Privacy Policy" }, 400);
    }

    const existing = database.query("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username);
    if (existing) {
      return c.json({ error: `Username "${username}" is already taken` }, 409);
    }

    if (licenseExpiresAt && !isValidLicenseDate(licenseExpiresAt)) {
      return c.json({ error: "Invalid license expiration date" }, 400);
    }

    const userId = "usr_" + randomUUID().replace(/-/g, "").slice(0, 16);
    const pwdHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const ts = nowIso();

    database
      .query(
        `INSERT INTO users (
          id, username, password_hash, display_name, role, is_active,
          email, phone, legal_name, license_number, license_jurisdiction, license_expires_at,
          service_territory_json, onboarding_status, must_change_password, profile_notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'server', 1, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`
      )
      .run(
        userId,
        username,
        pwdHash,
        displayName,
        email,
        phone,
        legalName,
        licenseNumber,
        licenseJurisdiction,
        licenseExpiresAt,
        JSON.stringify(territory),
        combinedNotes,
        ts,
        ts
      );

    try {
      const ip = clientIp(c);
      const userAgent = c.req.header("user-agent") || "";
      recordUserConsent(database, { userId, documentType: "tos", version: tosVersion, ip, userAgent });
      recordUserConsent(database, { userId, documentType: "privacy", version: tosVersion, ip, userAgent });
      logAuthAudit({
        event_type: "legal.consent_accepted",
        actor_user_id: userId,
        actor_role: "server",
        ip_address: ip,
        user_agent: userAgent,
        details: { document_type: "tos", version: tosVersion, source: "register-server" },
      });
    } catch (err) {
      console.warn("Could not record registration consent:", err);
    }

    // Save e-signature if provided during signup
    const signatureData = body.signatureData || body.signature_data;
    if (typeof signatureData === "string" && signatureData.startsWith("data:image/png;base64,")) {
      try {
        const { SIGNATURES_DIR } = await import("./signatures");
        const b64 = signatureData.replace(/^data:image\/png;base64,/, "");
        const buf = Buffer.from(b64, "base64");
        if (buf.length >= 200) {
          const sha = createHash("sha256").update(buf).digest("hex");
          const assetId = "sig_" + randomUUID().replace(/-/g, "").slice(0, 20);
          const storageKey = `${assetId}.png`;
          const filePath = `${SIGNATURES_DIR}/${storageKey}`;
          await Bun.write(filePath, buf);

          database.query(
            `INSERT INTO user_signature_assets (
              id, user_id, storage_key, mime_type, sha256, width, height, status, created_at, updated_at, revoked_at
            ) VALUES (?, ?, ?, 'image/png', ?, 800, 200, 'active', ?, ?, '')`
          ).run(assetId, userId, storageKey, sha, ts, ts);

          database.query("UPDATE users SET signature_asset_id = ?, signature_updated_at = ? WHERE id = ?").run(assetId, ts, userId);
        }
      } catch (err) {
        console.warn("Could not save initial signature during registration:", err);
      }
    }

    // Create an Admin Notification (in-app only)
    try {
      const { createNotification } = await import("./notifications");
      const adminUsers = database.query("SELECT id FROM users WHERE role = 'admin'").all() as { id: string }[];
      for (const admin of adminUsers) {
        await createNotification(database as any, {
          userId: admin.id,
          type: "broadcast",
          priority: "normal",
          title: `New Field Server: ${displayName}`,
          body: `${displayName} (${licenseNumber || 'No PSL'}) self-enrolled. Territory: ${territory.join(', ') || 'None stated'}.`,
          actionUrl: "/servers",
        });
      }
    } catch {
      // ignore
    }

    // Send Welcome & PWA Setup Email to the newly registered server
    if (email && email.includes("@")) {
      try {
        const { sendWelcomeOnboardingEmail } = await import("./email");
        await sendWelcomeOnboardingEmail(email, displayName, username);
      } catch (err) {
        console.warn("Could not dispatch welcome email to server:", err);
      }
    }

    // Auto-login newly registered server
    const token = createSession({
      id: userId,
      role: "server",
      username,
      displayName,
      mustChangePassword: false,
    });

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    const row = database.query("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown>;
    return c.json({ success: true, user: selfUserRow(database, row) }, 201);
  });

  // POST /api/auth/forgot-password - Request password reset link / code
  app.post("/api/auth/forgot-password", async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const identifier = String(body.email || body.username || "").trim();
    if (!identifier) {
      return c.json({ error: "Email or username is required" }, 400);
    }

    const ip = clientIp(c);
    const resetKey = (ip + ":" + identifier.toLowerCase());
    if (!checkKeyedRateLimit(resetFailures, resetKey, RESET_MAX_FAILURES)) {
      return c.json({ error: "Too many reset requests. Please try again later." }, 429);
    }
    recordKeyedFailure(resetFailures, resetKey);

    const user = database
      .query("SELECT id, username, email, display_name FROM users WHERE (email = ? OR username = ? COLLATE NOCASE) AND is_active = 1")
      .get(identifier, identifier) as { id: string; username: string; email: string; display_name: string } | null;

    if (user && user.email && user.email.includes("@")) {
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const code = String(randomInt(100000, 999999));
      const codeHash = hashToken(code);
      const tokenId = "prt_" + randomUUID().replace(/-/g, "").slice(0, 16);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 mins
      const ts = nowIso();
      const ip = clientIp(c);

      // Invalidate any existing unused reset tokens for this user
      database
        .query("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND (used_at = '' OR used_at IS NULL)")
        .run(ts, user.id);

      database
        .query(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, code_hash, expires_at, used_at, ip_address, created_at)
           VALUES (?, ?, ?, ?, ?, '', ?, ?)`
        )
        .run(tokenId, user.id, tokenHash, codeHash, expiresAt, ip, ts);

      const resetLink = publicResetUrl(c, rawToken);

      const { sendPasswordResetEmail } = await import("./email");
      await sendPasswordResetEmail(user.email, resetLink, code).catch((err) => {
        console.warn("Could not dispatch password reset email:", err);
      });
    }

    // Always return success to prevent user enumeration
    return c.json({
      success: true,
      message: "If an active account exists with that email/username, a password reset email has been sent.",
    });
  });

  // POST /api/auth/verify-reset-token - Check if reset token or code is valid
  app.post("/api/auth/verify-reset-token", async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const code = String(body.code || "").trim();

    if (!token && !code) {
      return c.json({ valid: false, error: "Reset token or 6-digit code required" }, 400);
    }

    const ip = clientIp(c);
    const verifyKey = ip + ":verify";
    if (!checkKeyedRateLimit(resetFailures, verifyKey, RESET_VERIFY_MAX)) {
      return c.json({ valid: false, error: "Too many attempts. Please try again later." }, 429);
    }
    recordKeyedFailure(resetFailures, verifyKey);

    const tokenHash = token ? hashToken(token) : "";
    const codeHash = code ? hashToken(code) : "";
    const now = nowIso();

    const record = database
      .query(
        `SELECT id, user_id, expires_at FROM password_reset_tokens
         WHERE (token_hash = ? OR code_hash = ?) AND (used_at = '' OR used_at IS NULL) AND expires_at > ?`
      )
      .get(tokenHash || "none", codeHash || "none", now) as { id: string; user_id: string } | null;

    if (!record) {
      return c.json({ valid: false, error: "Invalid, expired, or already used reset token" }, 400);
    }

    return c.json({ valid: true });
  });

  // POST /api/auth/reset-password - Apply new password and revoke old sessions
  app.post("/api/auth/reset-password", async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const code = String(body.code || "").trim();
    const newPassword = String(body.newPassword || body.password || "").trim();

    if (!token && !code) {
      return c.json({ error: "Reset token or 6-digit code is required" }, 400);
    }
    if (!newPassword || newPassword.length < 8) {
      return c.json({ error: "New password must be at least 8 characters" }, 400);
    }

    const ip = clientIp(c);
    const applyKey = ip + ":reset-apply";
    if (!checkKeyedRateLimit(resetFailures, applyKey, RESET_VERIFY_MAX)) {
      return c.json({ error: "Too many attempts. Please try again later." }, 429);
    }
    recordKeyedFailure(resetFailures, applyKey);

    const tokenHash = token ? hashToken(token) : "";
    const codeHash = code ? hashToken(code) : "";
    const now = nowIso();

    const record = database
      .query(
        `SELECT id, user_id, expires_at FROM password_reset_tokens
         WHERE (token_hash = ? OR code_hash = ?) AND (used_at = '' OR used_at IS NULL) AND expires_at > ?`
      )
      .get(tokenHash || "none", codeHash || "none", now) as { id: string; user_id: string } | null;

    if (!record) {
      return c.json({ error: "Invalid, expired, or already used reset token" }, 400);
    }

    const pwdHash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
    const ts = nowIso();

    database
      .query("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
      .run(pwdHash, ts, record.user_id);

    database.query("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ?").run(ts, record.user_id);

    // Revoke all sessions for security lockdown
    revokeSessionsForUser(record.user_id, record.user_id);

    logAuthAudit({
      event_type: "auth.password_changed",
      actor_user_id: record.user_id,
      ip_address: clientIp(c),
      user_agent: c.req.header("user-agent") || "",
      details: { source: "reset-password" },
    });

    return c.json({ success: true, message: "Password updated successfully. Please log in with your new password." });
  });
}
