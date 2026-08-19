declare const Bun: any;
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { createHash, randomBytes, randomUUID } from "crypto";
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
      path.startsWith("/uploads/")
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

export async function handleLogin(c: Context) {
  const body = (await c.req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  const username = (body.username || "").trim();
  const password = body.password || "";
  const adminPassword = process.env.APP_PASSWORD || "Password";
  const rateKey = (username || "admin").toLowerCase();

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

  // 1. Check if user specified a username
  if (username && username.toLowerCase() !== "admin") {
    const userRow = db
      .query("SELECT id, username, password_hash, display_name, role, is_active, must_change_password FROM users WHERE username = ? COLLATE NOCASE")
      .get(username) as {
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
      return c.json({ success: false, message: "Invalid username or password" }, 401);
    }

    let isMatch = false;
    try {
      isMatch = await Bun.password.verify(password, userRow.password_hash);
    } catch {
      // Fallback in case of raw password or legacy hash
      isMatch = password === userRow.password_hash;
    }

    if (!isMatch) {
      recordLoginFailure(rateKey);
      return c.json({ success: false, message: "Invalid username or password" }, 401);
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

    const token = createSession(authUser);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC,
    });

    return c.json({
      success: true,
      token,
      user: authUser,
    });
  }

  // 2. Admin login (either username is 'admin' or username was omitted)
  // Check against env APP_PASSWORD or admin user in users table
  let adminMatched = password === adminPassword;
  let adminDisplayName = "Admin";
  let adminId = "usr_admin_default";

  const adminRow = db
    .query("SELECT id, username, password_hash, display_name FROM users WHERE username = 'admin' COLLATE NOCASE")
    .get() as { id: string; username: string; password_hash: string; display_name: string } | null;

  if (!adminMatched && adminRow) {
    try {
      adminMatched = await Bun.password.verify(password, adminRow.password_hash);
    } catch {
      adminMatched = password === adminRow.password_hash;
    }
  }

  if (adminRow) {
    adminId = adminRow.id;
    adminDisplayName = adminRow.display_name;
  }

  if (!adminMatched) {
    recordLoginFailure(rateKey);
    return c.json({ success: false, message: "Incorrect password" }, 401);
  }

  clearLoginFailures(rateKey);
  db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [new Date().toISOString(), adminId]);

  const authUser: AuthUser = {
    id: adminId,
    username: "admin",
    displayName: adminDisplayName,
    role: "admin",
    mustChangePassword: false,
  };

  const token = createSession(authUser);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
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
    database.query("DELETE FROM user_signature_assets WHERE user_id = ?").run(id);
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
    if (updates.length === 0) {
      return c.json({ error: "No editable fields provided (displayName, email, phone)" }, 400);
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
    try {
      ok = await Bun.password.verify(currentPassword, String(row.password_hash));
    } catch {
      ok = currentPassword === String(row.password_hash);
    }
    // Admin fallback: env APP_PASSWORD also validates for the admin account.
    if (!ok && String(row.username || "").toLowerCase() === "admin") {
      ok = currentPassword === (process.env.APP_PASSWORD || "Password");
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
         FROM sessions WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(authUser.id) as { session_id?: string; created_at?: string; expires_at?: string; last_seen_at?: string; revoked_at?: string }[];

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
      revokeSessionsForUser(authUser.id, authUser.id, currentHash || undefined);
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
}
