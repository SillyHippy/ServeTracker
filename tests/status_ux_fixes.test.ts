import { describe, test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";
import {
  canonicalStatus,
  caseStatusLabel,
  isServedCaseStatus,
} from "../src/lib/caseFilters";

describe("case status display helpers", () => {
  test("Served casing and legacy completed label", () => {
    expect(isServedCaseStatus("Served")).toBe(true);
    expect(isServedCaseStatus("served")).toBe(true);
    expect(caseStatusLabel("completed")).toBe("Completed");
    expect(canonicalStatus("on-hold")).toBe("on-hold");
  });
});

describe("bad address flag on serve attempt", () => {
  const admin = new Client();
  let clientId = "";
  let caseId = "";

  beforeAll(async () => {
    const login = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(login, 200, "admin login");
    const cl = await admin.post("/api/clients", {
      name: "Bad Address Mock LLC",
      email: "badaddr-mock@example.test",
      phone: "555-0188",
    });
    expectStatus(cl, 201, "create client");
    clientId = cl.data.client?.id || cl.data.id || cl.data.$id;
    const cse = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: `SC-2026-BADADDR-${Date.now()}`,
      case_name: "Bad Address Test",
      defendant_respondent: "Nobody Here",
      home_address: "999 Fake Rd, Tulsa, OK",
      documents_to_serve: "Summons",
      status: "active",
    });
    expectStatus(cse, 201, "create case");
    caseId = cse.data.case?.id || cse.data.id;
  });

  test("bad_address sets attempt status and notifies admins", async () => {
    const serve = await admin.post("/api/serves", {
      case_id: caseId,
      person_being_served: "Nobody Here",
      status: "failed",
      bad_address: true,
      notes: "vacant / wrong unit",
      sendEmail: false,
      isTest: true,
    });
    expectStatus(serve, 201, "POST bad address");
    expect(String(serve.data.status || "").toLowerCase()).toBe("bad-address");

    const notifs = await admin.get("/api/notifications");
    expectStatus(notifs, 200, "notifications");
    const rows = Array.isArray(notifs.data.notifications)
      ? notifs.data.notifications
      : [];
    const hit = rows.find(
      (n: { type?: string; entity_id?: string }) =>
        n.type === "bad_address" && String(n.entity_id || "").length > 0,
    );
    expect(hit).toBeTruthy();
  });
});
