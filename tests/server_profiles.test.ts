import { test, expect, beforeAll } from "bun:test";
import { Client, expectStatus, errOf } from "./helpers";

let admin: Client;
let serverA: Client;
let serverAId = "";
const A_USER = "profile_a";
const A_PASS = "ProfilePass123!";

const intake = {
  username: A_USER,
  password: A_PASS,
  displayName: "Profile Server A",
  legalName: "Alicia Field",
  email: "alicia@example.test",
  phone: "555-0100",
  licenseNumber: "PSL-9001",
  licenseJurisdiction: "OK",
  licenseExpiresAt: "2030-12-31",
  serviceTerritory: ["Tulsa", "Wagoner"],
  profileNotes: "internal admin note",
  role: "server",
};

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");
});

test("admin creates full server intake profile (forced server role, pending onboarding)", async () => {
  const r = await admin.post("/api/users", { ...intake, role: "admin" }); // role must be forced to server
  expectStatus(r, 201, "create user");
  expect(r.data.user.role).toBe("server");
  expect(r.data.user.onboardingStatus).toBe("pending");
  expect(r.data.user.mustChangePassword).toBe(true);
  expect(r.data.user.username).toBe(A_USER);
  serverAId = r.data.user.id;
  expect(serverAId).toBeTruthy();
});

test("admin list includes profile safe fields and never password hashes", async () => {
  const r = await admin.get("/api/users");
  expectStatus(r, 200, "list users");
  const u = (r.data as any[]).find((x: any) => x.id === serverAId);
  expect(u).toBeTruthy();
  expect(u.legalName).toBe("Alicia Field");
  expect(u.email).toBe("alicia@example.test");
  expect(u.licenseNumber).toBe("PSL-9001");
  expect(u.licenseJurisdiction).toBe("OK");
  expect(u.licenseExpiresAt).toBe("2030-12-31");
  expect(Array.isArray(u.serviceTerritory)).toBe(true);
  expect(u.profileNotes).toBe("internal admin note");
  expect(u.onboardingStatus).toBe("pending");
  expect(u.signatureStatus).toBeDefined();
  expect(u.passwordHash).toBeUndefined();
  expect(u.password_hash).toBeUndefined();
});

test("admin GET user detail returns full profile", async () => {
  const r = await admin.get(`/api/users/${serverAId}`);
  expectStatus(r, 200, "get user detail");
  expect(r.data.legalName).toBe("Alicia Field");
  expect(r.data.profileNotes).toBe("internal admin note");
  expect(r.data.activeCaseCount).toBe(0);
});

test("validation: rejects bad license date, malformed territory, duplicate username", async () => {
  const badDate = await admin.post("/api/users", { ...intake, username: "bad_date", licenseExpiresAt: "12/31/2030" });
  expectStatus(badDate, 400, "bad date");
  const badTerr = await admin.post("/api/users", { ...intake, username: "bad_terr", serviceTerritory: "Tulsa" });
  expectStatus(badTerr, 400, "bad territory");
  const dup = await admin.post("/api/users", { ...intake });
  expectStatus(dup, 400, "duplicate username");
  const noPass = await admin.post("/api/users", { ...intake, username: "no_pass", password: "" });
  expectStatus(noPass, 400, "missing password");
});

test("admin can complete onboarding + update profile fields", async () => {
  const r = await admin.put(`/api/users/${serverAId}`, {
    onboardingStatus: "active",
    serviceTerritory: ["Tulsa", "Rogers", "Creek"],
    profileNotes: "updated note",
  });
  expectStatus(r, 200, "update user");
  const detail = await admin.get(`/api/users/${serverAId}`);
  expect(detail.data.onboardingStatus).toBe("active");
  expect(detail.data.serviceTerritory).toEqual(["Tulsa", "Rogers", "Creek"]);
  expect(detail.data.profileNotes).toBe("updated note");
});

test("server cannot list users or read another server profile", async () => {
  serverA = new Client();
  const login = await serverA.post("/api/auth/login", { username: A_USER, password: A_PASS });
  expectStatus(login, 200, "server A login");
  // First login forces password change — change it before API access
  const ch = await serverA.post("/api/me/change-password", { currentPassword: A_PASS, newPassword: "NewPass456!" });
  expectStatus(ch, 200, "change password");

  const list = await serverA.get("/api/users");
  expectStatus(list, 403, "server list users");
  const detail = await serverA.get(`/api/users/${serverAId}`);
  expectStatus(detail, 403, "server read other profile");
});

test("server self profile: safe fields only, no notes, no hash", async () => {
  const r = await serverA.get("/api/me/profile");
  expectStatus(r, 200, "me profile");
  expect(r.data.username).toBe(A_USER);
  expect(r.data.profileNotes).toBe("updated note");
  expect(r.data.passwordHash).toBeUndefined();
  expect(r.data.onboardingStatus).toBe("active");
});

test("server self edit limited to contact fields", async () => {
  const r = await serverA.put("/api/me/profile", {
    displayName: "Alicia R. Field",
    email: "alicia.new@example.test",
    phone: "555-0199",
    licenseNumber: "PSL-HACKED",
  });
  expectStatus(r, 200, "self edit");
  const me = await serverA.get("/api/me/profile");
  expect(me.data.displayName).toBe("Alicia R. Field");
  expect(me.data.email).toBe("alicia.new@example.test");
  expect(me.data.phone).toBe("555-0199");
  expect(me.data.licenseNumber).toBe("PSL-9001"); // unchanged — self cannot edit license
});

test("server cannot PUT another user via admin endpoint", async () => {
  const r = await serverA.put(`/api/users/${serverAId}`, { displayName: "Hacked" });
  expectStatus(r, 403, "server admin update");
});
