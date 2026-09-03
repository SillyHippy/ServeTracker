import { describe, test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

describe("affidavit queue lists assigned Served cases only", () => {
  const admin = new Client();
  let clientId = "";
  let assignedCaseId = "";
  let unassignedCaseId = "";
  let fieldId = "";
  const USER = "aq_field_" + Date.now();

  beforeAll(async () => {
    const login = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(login, 200, "admin login");

    const usr = await admin.post("/api/users", {
      username: USER,
      password: "AqFieldPass123!",
      displayName: "Queue Field",
      legalName: "Queue Field",
      licenseNumber: "PS-AQ-001",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Tulsa"],
    });
    expectStatus(usr, 201, "create field user");
    fieldId = usr.data.user?.id || usr.data.id;
    await admin.put(`/api/users/${fieldId}`, { onboardingStatus: "active", status: "active" });

    const cli = await admin.post("/api/clients", {
      name: "Queue Mock LLC",
      email: "queue-mock@example.test",
      phone: "555-0199",
    });
    expectStatus(cli, 201, "create client");
    clientId = cli.data.client?.id || cli.data.id || cli.data.$id;

    const assigned = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "CJ-2026-AQ-ASSIGNED",
      case_name: "Queue Assigned v Mock",
      defendant_respondent: "Assigned Target",
      home_address: "1 Assigned St, Tulsa, OK",
      documents_to_serve: "Summons",
      assigned_to: fieldId,
    });
    expectStatus(assigned, 201, "create assigned case");
    assignedCaseId = assigned.data.case?.id || assigned.data.id;

    const unassigned = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "CJ-2026-AQ-UNASSIGNED",
      case_name: "Queue Unassigned v Mock",
      defendant_respondent: "Unassigned Target",
      home_address: "2 Unassigned St, Tulsa, OK",
      documents_to_serve: "Summons",
    });
    expectStatus(unassigned, 201, "create unassigned case");
    unassignedCaseId = unassigned.data.case?.id || unassigned.data.id;

    const serveAssigned = await admin.post("/api/serves", {
      case_id: assignedCaseId,
      case_number: "CJ-2026-AQ-ASSIGNED",
      person_being_served: "Assigned Target",
      status: "completed",
      serviceMethod: "personal",
      notes: "served assigned",
    });
    expectStatus(serveAssigned, 201, "serve assigned");

    const serveUnassigned = await admin.post("/api/serves", {
      case_id: unassignedCaseId,
      case_number: "CJ-2026-AQ-UNASSIGNED",
      person_being_served: "Unassigned Target",
      status: "completed",
      serviceMethod: "personal",
      notes: "served unassigned",
    });
    expectStatus(serveUnassigned, 201, "serve unassigned");
  });

  test("admin queue includes assigned Served case and excludes unassigned Served case", async () => {
    const res = await admin.get("/api/affidavits/queue");
    expectStatus(res, 200, "queue");
    const queue = res.data.queue || [];
    const ids = queue.map((q: { caseId: string }) => q.caseId);
    expect(ids).toContain(assignedCaseId);
    expect(ids).not.toContain(unassignedCaseId);
  });
});
