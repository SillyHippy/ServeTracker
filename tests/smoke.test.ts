import { test, expect } from "bun:test";
import { app, Client, expectStatus, errOf } from "./helpers";

test("smoke: health endpoint", async () => {
  const c = new Client();
  const r = await c.get("/api/health");
  expectStatus(r, 200, "health");
  expect(r.data.ok).toBe(true);
});

test("admin seed login works", async () => {
  const c = new Client();
  const r = await c.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");
  expect(r.data.user.role).toBe("admin");
  expect(r.data.user.mustChangePassword).toBe(false);
});
