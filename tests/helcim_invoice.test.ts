import { describe, test, expect, beforeAll } from "bun:test";
import { app, Client, expectStatus } from "./helpers";

describe("Helcim mock invoice wiring (staging, no live API)", () => {
  const admin = new Client();
  const field = new Client();
  let clientId = "";
  let caseId = "";
  let invoiceId = "";
  let fieldUserId = "";

  beforeAll(async () => {
    const login = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(login, 200, "admin login");

    const srv = await admin.post("/api/users", {
      username: "helcim_field_mock",
      email: "helcim_field_mock@example.test",
      password: "FieldPass123!",
      displayName: "Helcim Field Mock",
      legalName: "Helcim Field Mock",
      licenseNumber: "PS-HELCIM-001",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Tulsa"],
    });
    expect([200, 201]).toContain(srv.status);
    fieldUserId = srv.data.user?.id || srv.data.id;
    await admin.put(`/api/users/${fieldUserId}`, {
      onboardingStatus: "complete",
      status: "active",
    });
    const flogin = await field.post("/api/auth/login", {
      username: "helcim_field_mock",
      password: "FieldPass123!",
    });
    expectStatus(flogin, 200, "field login");
    if (flogin.data.user?.mustChangePassword) {
      const ch = await field.post("/api/me/change-password", {
        currentPassword: "FieldPass123!",
        newPassword: "FieldPassPermanent123!",
      });
      expectStatus(ch, 200, "field change password");
    }

    const cl = await admin.post("/api/clients", {
      name: "MOCK Helcim Law Firm",
      email: "mock-helcim-client@example.test",
      phone: "555-0100",
    });
    expect([200, 201]).toContain(cl.status);
    clientId = cl.data.id || cl.data.$id;
  });

  test("admin case create with quoted_fee + create_invoice stores mock UNPAID invoice", async () => {
    const created = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "CJ-2026-MOCK-HELCIM-1",
      case_name: "Mock Defendant Helcim",
      defendant_respondent: "Mock Defendant Helcim",
      assigned_to: fieldUserId,
      quoted_fee: 110,
      create_invoice: true,
      email_invoice: true,
    });
    expectStatus(created, 201, "create case with invoice");
    caseId = created.data.id || created.data.$id;
    expect(created.data.payment_status).toBe("UNPAID");
    expect(String(created.data.quoted_fee)).toBe("110");
    expect(String(created.data.invoice_id)).toMatch(/^mock_/);
    expect(String(created.data.pay_url)).toContain("https://mock.helcim.test/order/?token=");
    expect(String(created.data.pay_url)).not.toContain("api.helcim.com");
    invoiceId = created.data.invoice_id;
  });

  test("duplicate UNPAID invoice is 409", async () => {
    const dup = await admin.post(`/api/cases/${caseId}/invoice`, { quoted_fee: 110 });
    expectStatus(dup, 409, "duplicate invoice");
  });

  test("field role cannot create invoice (403) and assigned case list strips pay_url", async () => {
    const forbidden = await field.post(`/api/cases/${caseId}/invoice`, { quoted_fee: 110 });
    expectStatus(forbidden, 403, "field invoice create");

    const list = await field.get("/api/cases");
    expectStatus(list, 200, "field cases list");
    const rows = Array.isArray(list.data) ? list.data : [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.pay_url).toBeUndefined();
      expect(row.invoice_id).toBeUndefined();
      expect(row.payment_status).toBeUndefined();
      expect(row.quoted_fee).toBeUndefined();
    }
  });

  test("webhook without secret is 401", async () => {
    const r = await app(new Request("http://test.local/api/webhooks/helcim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: invoiceId, status: "PAID" }),
    }));
    expect(r.status).toBe(401);
  });

  test("webhook with secret flips UNPAID to PAID and second call is idempotent", async () => {
    const payload = JSON.stringify({
      invoice_id: invoiceId,
      status: "PAID",
      paid_at: "2026-08-29T00:00:00.000Z",
    });
    const headers = {
      "Content-Type": "application/json",
      "x-helcim-webhook-secret": process.env.HELCIM_WEBHOOK_SECRET || "staging-helcim-webhook-secret",
    };
    const r1 = await app(new Request("http://test.local/api/webhooks/helcim", {
      method: "POST",
      headers,
      body: payload,
    }));
    expect(r1.status).toBe(200);
    const d1 = await r1.json() as { ok: boolean; alreadyPaid?: boolean };
    expect(d1.ok).toBe(true);
    expect(d1.alreadyPaid).toBeFalsy();

    const got = await admin.get(`/api/cases/${caseId}`);
    expectStatus(got, 200, "admin get case after pay");
    expect(got.data.payment_status).toBe("PAID");

    const r2 = await app(new Request("http://test.local/api/webhooks/helcim", {
      method: "POST",
      headers,
      body: payload,
    }));
    expect(r2.status).toBe(200);
    const d2 = await r2.json() as { alreadyPaid?: boolean };
    expect(d2.alreadyPaid).toBe(true);
  });

  test("resend invoice email is skipped under MOCK_EMAIL", async () => {
    const mail = await admin.post(`/api/cases/${caseId}/invoice/resend-email`, {});
    expectStatus(mail, 200, "resend email");
    expect(mail.data.success).toBe(true);
    expect(mail.data.skipped).toBe(true);
    expect(mail.data.sent).toBe(false);
  });
});
