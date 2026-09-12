import { describe, test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

describe("affidavit queue lists only successfully served people", () => {
  const admin = new Client();
  let caseId = "";
  let toniId = "";
  let stevenId = "";

  beforeAll(async () => {
    const login = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(login, 200, "admin login");

    const cli = await admin.post("/api/clients", {
      name: "Queue Success Only LLC",
      email: "queue-success-only@example.test",
      phone: "555-0188",
    });
    expectStatus(cli, 201, "create client");
    const clientId = cli.data.client?.id || cli.data.id;

    const cse = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "PG-2026-QUEUE-SUCCESS",
      case_name: "Guardianship Mock",
      defendant_respondent: "TONI F. WASHINGTON",
      home_address: "1 Queue St, Tulsa, OK",
      documents_to_serve: "Notice",
      assigned_to: "usr_admin_default",
      recipients: [
        { full_name: "Toni F. Washington", role: "Proposed Ward" },
        { full_name: "Steven Lance Washington", role: "Relative" },
      ],
    });
    expectStatus(cse, 201, "create 2-person case");
    caseId = cse.data.case?.id || cse.data.id;

    const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
    expectStatus(recs, 200, "list recipients");
    const rows = recs.data || [];
    expect(rows.length).toBe(2);
    toniId = rows.find((r: { full_name?: string }) => /Toni/i.test(String(r.full_name))).id;
    stevenId = rows.find((r: { full_name?: string }) => /Steven/i.test(String(r.full_name))).id;

    const toni = await admin.post("/api/serves", {
      case_id: caseId,
      case_number: "PG-2026-QUEUE-SUCCESS",
      recipient_id: toniId,
      person_being_served: "Toni F. Washington",
      status: "completed",
      serviceMethod: "personal",
      notes: "mock success",
      sendEmail: false,
      isTest: true,
    });
    expectStatus(toni, 201, "toni success");

    const steven = await admin.post("/api/serves", {
      case_id: caseId,
      case_number: "PG-2026-QUEUE-SUCCESS",
      recipient_id: stevenId,
      person_being_served: "Steven Lance Washington",
      status: "failed",
      notes: "not home",
      sendEmail: false,
      isTest: true,
    });
    expectStatus(steven, 201, "steven fail");
  });

  test("queue includes Toni only, not Steven", async () => {
    const res = await admin.get("/api/affidavits/queue");
    expectStatus(res, 200, "queue");
    const mine = (res.data.queue || []).filter((q: { caseId: string }) => q.caseId === caseId);
    expect(mine.map((q: { recipientId: string }) => q.recipientId)).toEqual([toniId]);
    expect(String(mine[0].personServed)).toMatch(/Toni/i);
    expect(stevenId).toBeTruthy();
  });
});
