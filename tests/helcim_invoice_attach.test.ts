import { describe, test, expect, beforeAll } from "bun:test";
import { app, Client, expectStatus } from "./helpers";

describe("Helcim invoice attach (staging, no live Helcim POST)", () => {
  const admin = new Client();
  const field = new Client();
  let clientId = "";
  let caseA = "";
  let caseB = "";
  let sourceInvoiceId = "";

  beforeAll(async () => {
    const login = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(login, 200, "admin login");

    const srv = await admin.post("/api/users", {
      username: "attach_field_mock",
      email: "attach_field_mock@example.test",
      password: "FieldPass123!",
      displayName: "Attach Field Mock",
      legalName: "Attach Field Mock",
      licenseNumber: "PS-ATTACH-001",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Tulsa"],
    });
    expect([200, 201]).toContain(srv.status);
    const fieldUserId = srv.data.user?.id || srv.data.id;
    await admin.put(`/api/users/${fieldUserId}`, {
      onboardingStatus: "complete",
      status: "active",
    });
    const flogin = await field.post("/api/auth/login", {
      username: "attach_field_mock",
      password: "FieldPass123!",
    });
    expectStatus(flogin, 200, "field login");

    const cl = await admin.post("/api/clients", {
      name: "MOCK Attach Law Firm",
      email: "mock-attach-client@example.test",
      phone: "555-0101",
    });
    expect([200, 201]).toContain(cl.status);
    clientId = cl.data.id || cl.data.$id;

    const created = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "CJ-2026-MOCK-ATTACH-SRC",
      case_name: "Attach Source Case",
      defendant_respondent: "Attach Source Case",
      assigned_to: fieldUserId,
      quoted_fee: 125,
      create_invoice: true,
    });
    expectStatus(created, 201, "source case with invoice");
    caseA = created.data.id || created.data.$id;
    sourceInvoiceId = created.data.invoice_id;

    const blank = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "CJ-2026-MOCK-ATTACH-TGT",
      case_name: "Attach Target Case",
      defendant_respondent: "Attach Target Case",
      assigned_to: fieldUserId,
      quoted_fee: 125,
    });
    expectStatus(blank, 201, "target case without invoice");
    caseB = blank.data.id || blank.data.$id;
  });

  test("preview attach returns proposed fields without writing", async () => {
    const preview = await admin.post(`/api/cases/${caseB}/invoice/attach`, {
      invoice_id: sourceInvoiceId,
      preview: true,
    });
    expect(preview.status).toBe(409);
    expect(preview.data.preview).toBe(true);
    expect(preview.data.proposed.invoice_id).toBe(sourceInvoiceId);
    expect(preview.data.current.invoice_id).toBe("");
    expect(preview.data.conflict?.caseId).toBe(caseA);

    const stillBlank = await admin.get(`/api/cases/${caseB}`);
    expectStatus(stillBlank, 200, "case still blank after preview");
    expect(stillBlank.data.invoice_id || "").toBe("");
  });

  test("attach links existing mock invoice onto blank case", async () => {
    const externalId = `mock_ext_${Date.now().toString(36)}`;
    const attached = await admin.post(`/api/cases/${caseB}/invoice/attach`, {
      invoice_id: externalId,
      quoted_fee: 140,
    });
    expectStatus(attached, 200, "attach invoice");
    expect(attached.data.invoice_id).toBe(externalId);
    expect(attached.data.payment_status).toBe("UNPAID");
    expect(String(attached.data.quoted_fee)).toBe("140");
    expect(String(attached.data.pay_url)).toContain("https://mock.helcim.test/order/?token=");
  });

  test("attach onto case that already has invoice is 409", async () => {
    const dup = await admin.post(`/api/cases/${caseB}/invoice/attach`, {
      invoice_id: "mock_other_invoice",
    });
    expectStatus(dup, 409, "duplicate attach on same case");
  });

  test("attach same invoice id onto second case is 409", async () => {
    const externalId = `mock_shared_${Date.now().toString(36)}`;

    const holder = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: `CJ-2026-MOCK-ATTACH-HOLD-${Date.now()}`,
      case_name: "Attach Holder Case",
      defendant_respondent: "Attach Holder Case",
      quoted_fee: 99,
    });
    expectStatus(holder, 201, "holder case");
    const holderId = holder.data.id || holder.data.$id;
    await admin.post(`/api/cases/${holderId}/invoice/attach`, {
      invoice_id: externalId,
      quoted_fee: 99,
    });

    const third = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: `CJ-2026-MOCK-ATTACH-THIRD-${Date.now()}`,
      case_name: "Attach Third Case",
      defendant_respondent: "Attach Third Case",
      quoted_fee: 99,
    });
    expectStatus(third, 201, "third case");
    const thirdId = third.data.id || third.data.$id;

    const conflict = await admin.post(`/api/cases/${thirdId}/invoice/attach`, {
      invoice_id: externalId,
    });
    expectStatus(conflict, 409, "invoice already on another case");
    expect(conflict.data.conflictCaseId).toBe(holderId);
  });

  test("field role cannot attach invoice (403)", async () => {
    const forbidden = await field.post(`/api/cases/${caseA}/invoice/attach`, {
      invoice_id: "mock_field_forbidden",
    });
    expectStatus(forbidden, 403, "field attach forbidden");
  });

  test("create invoice on case with existing invoice_id is 409", async () => {
    const blocked = await admin.post(`/api/cases/${caseA}/invoice`, { quoted_fee: 125 });
    expectStatus(blocked, 409, "create blocked when invoice attached");
  });

  test("case create with attach_invoice_id links existing mock invoice (intake flow)", async () => {
    const extId = `mock_intake_${Date.now().toString(36)}`;
    const created = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: `CJ-2026-MOCK-INTAKE-${Date.now()}`,
      case_name: "Intake Attach Case",
      defendant_respondent: "Intake Attach Case",
      quoted_fee: 150,
      attach_invoice_id: extId,
    });
    expectStatus(created, 201, "intake case with attach");
    expect(created.data.invoice_id).toBe(extId);
    expect(created.data.payment_status).toBe("UNPAID");
    expect(String(created.data.quoted_fee)).toBe("150");
  });

  test("case create rejects create_invoice and attach_invoice_id together", async () => {
    const bad = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: `CJ-2026-MOCK-BOTH-${Date.now()}`,
      case_name: "Both Flags Case",
      defendant_respondent: "Both Flags Case",
      quoted_fee: 99,
      create_invoice: true,
      attach_invoice_id: "mock_should_fail",
    });
    expectStatus(bad, 400, "mutually exclusive invoice flags");
  });

  test("webhook still flips attached UNPAID invoice to PAID", async () => {
    const fresh = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "CJ-2026-MOCK-ATTACH-WH",
      case_name: "Webhook Attach Case",
      defendant_respondent: "Webhook Attach Case",
      quoted_fee: 88,
    });
    expectStatus(fresh, 201, "webhook case");
    const freshId = fresh.data.id || fresh.data.$id;
    const invId = `mock_wh_${Date.now().toString(36)}`;
    await admin.post(`/api/cases/${freshId}/invoice/attach`, {
      invoice_id: invId,
      quoted_fee: 88,
    });

    const payload = JSON.stringify({
      invoice_id: invId,
      status: "PAID",
      paid_at: "2026-09-03T12:00:00.000Z",
    });
    const headers = {
      "Content-Type": "application/json",
      "x-helcim-webhook-secret": process.env.HELCIM_WEBHOOK_SECRET || "staging-helcim-webhook-secret",
    };
    const wh = await app(new Request("http://test.local/api/webhooks/helcim", {
      method: "POST",
      headers,
      body: payload,
    }));
    expect(wh.status).toBe(200);

    const got = await admin.get(`/api/cases/${freshId}`);
    expectStatus(got, 200, "case after webhook");
    expect(got.data.payment_status).toBe("PAID");
  });
});
