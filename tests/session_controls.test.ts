import { test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

let admin: Client;
let s1: Client;
let s2: Client;
let serverId = "";
const USER = "sess_server";
const TEMP = "TemporaryPass1!";
const NEWP = "PermanentPass2!";

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");
  const created = await admin.post("/api/users", {
    username: USER,
    password: TEMP,
    displayName: "Session Server",
  });
  expectStatus(created, 201, "create server");
  serverId = created.data.user.id;
});

test("first login flags mustChangePassword and blocks dashboard APIs", async () => {
  s1 = new Client();
  const login = await s1.post("/api/auth/login", { username: USER, password: TEMP });
  expectStatus(login, 200, "login");
  expect(login.data.user.mustChangePassword).toBe(true);

  const me = await s1.get("/api/auth/me");
  expectStatus(me, 200, "me");
  expect(me.data.user.mustChangePassword).toBe(true);

  const blocked = await s1.get("/api/cases");
  expectStatus(blocked, 403, "dashboard blocked");
  expect(blocked.data.code).toBe("PASSWORD_CHANGE_REQUIRED");
});

test("login records last_login_at for admin view", async () => {
  const r = await admin.get(`/api/users/${serverId}`);
  expectStatus(r, 200, "user detail");
  expect(r.data.lastLoginAt).toBeTruthy();
});

test("change-password unlocks account and preserves current session", async () => {
  const ch = await s1.post("/api/me/change-password", { currentPassword: TEMP, newPassword: NEWP });
  expectStatus(ch, 200, "change password");

  const me = await s1.get("/api/auth/me");
  expect(me.data.user.mustChangePassword).toBe(false);

  const cases = await s1.get("/api/cases");
  expectStatus(cases, 200, "dashboard now accessible");

  const wrong = await s1.post("/api/me/change-password", { currentPassword: "nope", newPassword: "X" });
  expectStatus(wrong, 400, "wrong current password rejected");
});

test("persistent login survives new requests (30-day cookie)", async () => {
  const me = await s1.get("/api/auth/me");
  expectStatus(me, 200, "still authenticated");
  expect(me.data.authenticated).toBe(true);
});

test("self session list + revoke-other only kills other device", async () => {
  s2 = new Client();
  const login = await s2.post("/api/auth/login", { username: USER, password: NEWP });
  expectStatus(login, 200, "second login");

  const sessions = await s2.get("/api/me/sessions");
  expectStatus(sessions, 200, "session list");
  expect(Array.isArray(sessions.data)).toBe(true);
  expect(sessions.data.length).toBeGreaterThanOrEqual(2);

  const revoke = await s2.post("/api/me/sessions/revoke-other");
  expectStatus(revoke, 200, "revoke other");

  const s1Me = await s1.get("/api/auth/me");
  expectStatus(s1Me, 401, "first session revoked");
  const s2Me = await s2.get("/api/auth/me");
  expectStatus(s2Me, 200, "current session survives");

  const after = await s2.get("/api/me/sessions");
  expectStatus(after, 200, "session list after revoke");
  expect(Array.isArray(after.data)).toBe(true);
  expect(after.data.length).toBe(1);
  expect(after.data[0].current).toBe(true);
  expect(after.data[0].revoked).toBe(false);
});

test("logout-current revokes only the current session", async () => {
  const lo = await s2.post("/api/me/sessions/logout-current");
  expectStatus(lo, 200, "logout current");
  const after = await s2.get("/api/auth/me");
  expectStatus(after, 401, "logged out session dead");

  const again = new Client();
  const login = await again.post("/api/auth/login", { username: USER, password: NEWP });
  expectStatus(login, 200, "fresh login after logout-current");
  const me = await again.get("/api/auth/me");
  expectStatus(me, 200, "new session fine");
});

test("admin revoke-sessions kills every field-server session", async () => {
  const victim = new Client();
  const login = await victim.post("/api/auth/login", { username: USER, password: NEWP });
  expectStatus(login, 200, "victim login");

  const r = await admin.post(`/api/users/${serverId}/revoke-sessions`);
  expectStatus(r, 200, "admin revoke");

  const me = await victim.get("/api/auth/me");
  expectStatus(me, 401, "victim session revoked");
});

test("password reset forces change and revokes sessions", async () => {
  const victim = new Client();
  const login = await victim.post("/api/auth/login", { username: USER, password: NEWP });
  expectStatus(login, 200, "login before reset");

  const reset = await admin.put(`/api/users/${serverId}`, { password: "ResetPass3!" });
  expectStatus(reset, 200, "admin reset password");

  const me = await victim.get("/api/auth/me");
  expectStatus(me, 401, "old session dead after reset");

  const relogin = await victim.post("/api/auth/login", { username: USER, password: "ResetPass3!" });
  expectStatus(relogin, 200, "new password works");
  expect(relogin.data.user.mustChangePassword).toBe(true);

  const oldPass = await victim.post("/api/auth/login", { username: USER, password: NEWP });
  expectStatus(oldPass, 401, "old password rejected");
});

test("deactivation blocks access immediately and blocks login", async () => {
  const victim = new Client();
  const login = await victim.post("/api/auth/login", { username: USER, password: "ResetPass3!" });
  expectStatus(login, 200, "login before deactivation");

  const deact = await admin.put(`/api/users/${serverId}`, { isActive: false });
  expectStatus(deact, 200, "deactivate");

  const me = await victim.get("/api/auth/me");
  expectStatus(me, 401, "deactivated session dead");
  const relogin = await victim.post("/api/auth/login", { username: USER, password: "ResetPass3!" });
  expectStatus(relogin, 401, "deactivated login blocked");

  const react = await admin.put(`/api/users/${serverId}`, { isActive: true });
  expectStatus(react, 200, "reactivate");
});

test("admin cannot deactivate primary admin account", async () => {
  const r = await admin.put("/api/users/usr_admin_default", { isActive: false });
  expectStatus(r, 400, "protected admin");
});

test("server cannot revoke other users' sessions", async () => {
  const s = new Client();
  const login = await s.post("/api/auth/login", { username: USER, password: "ResetPass3!" });
  expectStatus(login, 200, "server login");
  const ch = await s.post("/api/me/change-password", { currentPassword: "ResetPass3!", newPassword: "FinalPass9!" });
  expectStatus(ch, 200, "unlock");
  const r = await s.post(`/api/users/usr_admin_default/revoke-sessions`);
  expectStatus(r, 403, "server cannot admin-revoke");
});
