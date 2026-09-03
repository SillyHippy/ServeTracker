import { describe, test, expect, beforeAll } from "bun:test";
import { app, Client, expectStatus } from "./helpers";

describe("Manual Payment & Admin Profile Self-Management", () => {
  let admin: Client;
  let server: Client;
  let caseId: string;

  beforeAll(async () => {
    admin = new Client();
    const loginRes = await admin.post("/api/auth/login", {
      username: "admin",
      password: "TestAdminPass123!",
    });
    expectStatus(loginRes, 200);

    // Create a field server user
    const createSrv = await admin.post("/api/users", {
      username: "test_field_server_manual",
      password: "Password123!",
      displayName: "Field Server Manual",
      email: "server_manual@example.test",
      role: "server",
    });
    expectStatus(createSrv, 201);
    const srvId = createSrv.data.user?.id || createSrv.data.id;
    await admin.put(`/api/users/${srvId}`, { must_change_password: 0, mustChangePassword: false });

    server = new Client();
    const srvLogin = await server.post("/api/auth/login", {
      username: "test_field_server_manual",
      password: "Password123!",
    });
    expectStatus(srvLogin, 200);
    if (srvLogin.data.user?.mustChangePassword) {
      const ch = await server.post("/api/me/change-password", {
        currentPassword: "Password123!",
        newPassword: "Password1234!",
      });
      expectStatus(ch, 200);
    }

    // Create client & case
    const clRes = await admin.post("/api/clients", {
      name: "Acme Legal LLC",
      email: "acme@example.test",
    });
    expectStatus(clRes, 201);

    const cRes = await admin.post("/api/cases", {
      client_id: clRes.data.id,
      case_number: "CJ-2026-MANUAL-PAY-01",
      case_name: "John Doe",
      quoted_fee: 175,
      create_invoice: true,
    });
    expectStatus(cRes, 201);
    caseId = cRes.data.id;
  });

  test("Admin can self-update license credentials via PUT /api/me/profile", async () => {
    const res = await admin.put("/api/me/profile", {
      displayName: "Administrator Supreme",
      licenseNumber: "PSL-2026-OK-777",
      licenseJurisdiction: "Tulsa County / Oklahoma",
      licenseExpiresAt: "2029-01-01",
    });
    expectStatus(res, 200);
    expect(res.data.success).toBe(true);
    expect(res.data.user.licenseNumber).toBe("PSL-2026-OK-777");
    expect(res.data.user.licenseJurisdiction).toBe("Tulsa County / Oklahoma");
    expect(res.data.user.licenseExpiresAt).toBe("2029-01-01");
  });

  test("Field server cannot self-update license credentials", async () => {
    const res = await server.put("/api/me/profile", {
      displayName: "Hacked Server",
      licenseNumber: "ILLEGAL-BADGE",
    });
    expectStatus(res, 200);
    expect(res.data.user.licenseNumber).not.toBe("ILLEGAL-BADGE");
  });

  test("Admin can mark case as PAID manually with check notes", async () => {
    const res = await admin.post(`/api/cases/${caseId}/mark-paid`, {
      payment_method: "check",
      payment_notes: "Check #5041 from Acme Legal",
      paid_at: "2026-08-29T11:00:00.000Z",
    });
    expectStatus(res, 200);
    expect(res.data.payment_status).toBe("PAID");
    expect(res.data.payment_method).toBe("check");
    expect(res.data.payment_notes).toBe("Check #5041 from Acme Legal");
    expect(res.data.paid_at).toBe("2026-08-29T11:00:00.000Z");
  });

  test("Admin can revert case back to UNPAID if check bounced", async () => {
    const res = await admin.post(`/api/cases/${caseId}/mark-unpaid`, {});
    expectStatus(res, 200);
    expect(res.data.payment_status).toBe("UNPAID");
    expect(res.data.payment_method).toBe("");
    expect(res.data.paid_at).toBe("");
  });

  test("Field server gets 403 Forbidden on mark-paid", async () => {
    const res = await server.post(`/api/cases/${caseId}/mark-paid`, {
      payment_method: "cash",
    });
    expectStatus(res, 403);
  });
});
