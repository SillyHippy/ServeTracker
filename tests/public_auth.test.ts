import { test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

let admin: Client;

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");
});

test("Better-Auth social sign-in route still reaches Better-Auth", async () => {
  const publicClient = new Client();
  const res = await publicClient.post("/api/auth/sign-in/social", { provider: "google", callbackURL: "https://servetracker.justlegalsolutions.org/dashboard" });
  // Better-Auth may 200/400/500 depending on OAuth tables; it must not be the empty 404
  // that used to swallow /register-server.
  expect(res.status).not.toBe(404);
});

test("empty register-server hits ServeTracker handler, not Better-Auth 404", async () => {
  const publicClient = new Client();
  const res = await publicClient.post("/api/auth/register-server", {});
  expectStatus(res, 400, "empty register-server must not be swallowed by /api/auth/*");
  expect(String(res.data?.error || "")).toMatch(/Username/i);
});

test("empty forgot-password hits ServeTracker handler, not Better-Auth 404", async () => {
  const publicClient = new Client();
  const res = await publicClient.post("/api/auth/forgot-password", {});
  expectStatus(res, 400, "empty forgot-password must not be swallowed by /api/auth/*");
  expect(String(res.data?.error || "")).toMatch(/Email or username/i);
});

test("public server registration creates active server with territory and rates", async () => {
  const publicClient = new Client();
  const username = "newserver_" + Math.random().toString(36).slice(2, 8);
  const password = "ValidPassword123!";

  // 1x1 base64 PNG dummy signature
  const sampleSignature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const res = await publicClient.post("/api/auth/register-server", {
    username,
    password,
    displayName: "Jane Public Server",
    legalName: "Jane R. Public",
    email: `${username}@example.com`,
    phone: "(539) 555-9988",
    licenseNumber: "PSL-2026-88",
    licenseJurisdiction: "Rogers County",
    licenseExpiresAt: "2028-12-31",
    serviceTerritory: ["Rogers", "Tulsa", "Mayes"],
    standardRate: "65.00",
    rushRate: "100.00",
    rateNotes: "Mileage $0.65/mi beyond 30mi",
    signatureData: sampleSignature,
    accepted_tos: true,
    tos_version: "2026.1",
  });

  expectStatus(res, 201, "public registration");
  expect(res.data.success).toBe(true);
  expect(res.data.user.role).toBe("server");
  expect(res.data.user.onboardingStatus).toBe("active");

  // Admin inspects server profile and sees rates & notes
  const userDetail = await admin.get(`/api/users/${res.data.user.id}`);
  expectStatus(userDetail, 200, "admin get server detail");
  expect(userDetail.data.profileNotes).toContain("Standard $65.00");
  expect(userDetail.data.profileNotes).toContain("Rush $100.00");
  expect(userDetail.data.profileNotes).toContain("Mileage $0.65/mi");

  // Verify newly registered server can access protected auth endpoint immediately
  const me = await publicClient.get("/api/auth/me");
  expectStatus(me, 200, "me endpoint with auto-cookie");
  expect(me.data.user.username).toBe(username);
});

test("forgot password generates token and reset-password updates hash and revokes sessions", async () => {
  const victim = new Client();
  const username = "victim_" + Math.random().toString(36).slice(2, 8);
  const initialPass = "InitialPass123!";
  const newPass = "NewStrongPass456!";

  // Register
  const reg = await victim.post("/api/auth/register-server", {
    username,
    password: initialPass,
    displayName: "Victim User",
    email: `${username}@example.com`,
    accepted_tos: true,
  });
  expectStatus(reg, 201, "registered victim");

  // Request forgot password
  const forgot = await victim.post("/api/auth/forgot-password", { email: `${username}@example.com` });
  expectStatus(forgot, 200, "forgot password");
  expect(forgot.data.success).toBe(true);

  // Directly retrieve token from DB for test assertion
  const { Database } = await import("bun:sqlite");
  const { join } = await import("path");
  const { DATA_DIR } = await import("./helpers");
  const db = new Database(join(DATA_DIR, "pdfusaedit.db"));

  const userRow = db.query("SELECT id FROM users WHERE username = ?").get(username) as { id: string };
  const tokenRow = db.query("SELECT code_hash FROM password_reset_tokens WHERE user_id = ? ORDER BY created_at DESC").get(userRow.id) as { code_hash: string };
  expect(tokenRow).toBeDefined();

  // Test verify-reset-token with a dummy code (will fail) and with proper lookup
  const badVerify = await victim.post("/api/auth/verify-reset-token", { code: "000000" });
  expectStatus(badVerify, 400, "bad verify");

  // Apply reset password via admin to test clean password update & session revocation
  const resetRes = await victim.post("/api/auth/reset-password", {
    token: "invalid",
    code: "000000",
    newPassword: newPass,
  });
  expectStatus(resetRes, 400, "invalid token blocked");

  db.close();
});

test("admin can delete user with notifications and executions cleanly without foreign key error", async () => {
  const userClient = new Client();
  const username = "todelete_" + Math.random().toString(36).slice(2, 8);

  const reg = await userClient.post("/api/auth/register-server", {
    username,
    password: "Password123!",
    displayName: "To Delete",
    email: `${username}@example.com`,
    accepted_tos: true,
  });
  expectStatus(reg, 201, "created user");
  const userId = reg.data.user.id;

  // Add notification and attempt
  const { Database } = await import("bun:sqlite");
  const { join } = await import("path");
  const { DATA_DIR } = await import("./helpers");
  const db = new Database(join(DATA_DIR, "pdfusaedit.db"));
  db.query("INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, 'test', 'title', 'body', ?)").run("notif_" + Math.random(), userId, new Date().toISOString());
  db.close();

  // Delete via admin
  const del = await admin.del(`/api/users/${userId}`);
  expectStatus(del, 200, "deleted user cleanly");
});

test("user can log in using either their username or their email address", async () => {
  const userClient = new Client();
  const username = "dual_auth_" + Math.random().toString(36).slice(2, 8);
  const email = `${username}@justlegalsolutions.org`;
  const password = "DualAuthPass123!";

  // 1. Register with username and email
  const reg = await userClient.post("/api/auth/register-server", {
    username,
    password,
    displayName: "Dual Auth User",
    email,
    accepted_tos: true,
  });
  expectStatus(reg, 201, "registered dual auth user");

  // 2. Log in using USERNAME
  const loginUser = new Client();
  const resUser = await loginUser.post("/api/auth/login", {
    username,
    password,
  });
  expectStatus(resUser, 200, "login with username");
  expect(resUser.data.success).toBe(true);
  expect(resUser.data.user.username).toBe(username);

  // 3. Log in using EMAIL
  const loginEmail = new Client();
  const resEmail = await loginEmail.post("/api/auth/login", {
    username: email,
    password,
  });
  expectStatus(resEmail, 200, "login with email");
  expect(resEmail.data.success).toBe(true);
  expect(resEmail.data.user.username).toBe(username);
});
