import { describe, test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

describe("merge-gate blockers: PUT 403, mutation audit, Bearer after change-password", () => {
  const admin = new Client();
  const field = new Client();
  let fieldId = "";
  let clientId = "";
  let caseId = "";
  let serveId = "";
  const USER = "mg_field_" + Date.now();
  const INIT = "MgInitPass123!";
  const NEXT = "MgNextPass456!";

  beforeAll(async () => {
    const login = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(login, 200, "admin login");

    const cli = await admin.post("/api/clients", {
      name: "Merge Gate Mock LLC",
      email: "mock-mg@example.test",
      phone: "555-0100",
    });
    expectStatus(cli, 201, "create client");
    clientId = cli.data.client?.id || cli.data.id || cli.data.$id;

    const usr = await admin.post("/api/users", {
      username: USER,
      password: INIT,
      displayName: "Merge Gate Field",
      legalName: "Merge Gate Field",
      licenseNumber: "PS-MG-001",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Tulsa"],
    });
    expectStatus(usr, 201, "create field user");
    fieldId = usr.data.user?.id || usr.data.id;
    await admin.put(`/api/users/${fieldId}`, { onboardingStatus: "active", status: "active" });

    const cse = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "CJ-2026-MG-001",
      case_name: "Merge Gate v Mock",
      defendant_respondent: "Mock Target",
      home_address: "1 Mock St, Tulsa, OK",
      documents_to_serve: "Summons",
      assigned_to: fieldId,
    });
    expectStatus(cse, 201, "create case");
    caseId = cse.data.case?.id || cse.data.id;

    const flogin = await field.post("/api/auth/login", { username: USER, password: INIT });
    expectStatus(flogin, 200, "field login");
    const ch = await field.post("/api/me/change-password", {
      currentPassword: INIT,
      newPassword: NEXT,
    });
    expectStatus(ch, 200, "cookie change-password");

    const serve = await field.post("/api/serves", {
      case_id: caseId,
      case_number: "CJ-2026-MG-001",
      person_being_served: "Mock Target",
      status: "In Progress",
      notes: "first mock attempt",
    });
    expectStatus(serve, 201, "field POST serve");
    serveId = serve.data.serve?.id || serve.data.id;
  });

  test("field PUT /api/serves/:id on own assigned attempt is 403", async () => {
    const put = await field.put(`/api/serves/${serveId}`, { notes: "field edit should be rejected" });
    expect(put.status).toBe(403);
  });

  test("audit_logs records client, case, and serve mutations", async () => {
    const logs = await admin.get("/api/compliance/audit-logs?limit=200");
    expectStatus(logs, 200, "audit logs");
    const events = (logs.data.logs || logs.data || []).map((r: any) => String(r.event_type || ""));
    expect(events.some((e: string) => /client\.(create|created|insert)/i.test(e) || e === "client.create")).toBe(true);
    expect(events.some((e: string) => /case\.(create|created|insert)/i.test(e) || e === "case.create")).toBe(true);
    expect(events.some((e: string) => /serve\.(create|created|insert)/i.test(e) || e === "serve.create")).toBe(true);
  });

  test("change-password keeps Bearer session alive (no cookie)", async () => {
    const bearer = new Client();
    const login = await bearer.post("/api/auth/login", { username: USER, password: NEXT });
    expectStatus(login, 200, "bearer login");
    expect(typeof login.data.token).toBe("string");
    bearer.bearer = login.data.token;
    bearer.cookies.clear();

    const meBefore = await bearer.get("/api/auth/me");
    expectStatus(meBefore, 200, "bearer me before");

    const ch = await bearer.post("/api/me/change-password", {
      currentPassword: NEXT,
      newPassword: "MgBearerPass789!",
    });
    expectStatus(ch, 200, "bearer change-password");

    const meAfter = await bearer.get("/api/auth/me");
    expectStatus(meAfter, 200, "bearer me after change-password");
    expect(meAfter.data.user?.mustChangePassword).toBe(false);
  });
});
