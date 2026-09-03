import { describe, test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

describe("unsuccessful attempt must not mark case Served", () => {
  const admin = new Client();
  let clientId = "";

  beforeAll(async () => {
    const login = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(login, 200, "admin login");
    const cl = await admin.post("/api/clients", {
      name: "Unsuccessful Mock LLC",
      email: "unsuccessful-mock@example.test",
      phone: "555-0199",
    });
    expectStatus(cl, 201, "create client");
    clientId = cl.data.client?.id || cl.data.id || cl.data.$id;
  });

  async function makeCase(suffix: string) {
    const cse = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: `CJ-2026-UNS-${suffix}`,
      case_name: "Unsuccessful v Mock",
      defendant_respondent: "Jane Unsuccessful Mock",
      home_address: "1 Mock St, Tulsa, OK",
      documents_to_serve: "Summons",
    });
    expectStatus(cse, 201, "create case");
    return cse.data.case?.id || cse.data.id;
  }

  test("failed status with leftover serviceMethod personal does not mark case Served", async () => {
    const caseId = await makeCase("FAIL");
    const serve = await admin.post("/api/serves", {
      case_id: caseId,
      case_number: "CJ-2026-UNS-FAIL",
      person_being_served: "Jane Unsuccessful Mock",
      status: "failed",
      notes: "dog barking, no answer",
      serviceMethod: "personal",
      service_method: "personal",
      sendEmail: false,
      isTest: true,
    });
    expectStatus(serve, 201, "POST unsuccessful");
    const got = await admin.get(`/api/cases/${caseId}`);
    expectStatus(got, 200, "GET case");
    const status = String(got.data.status || got.data.case?.status || "");
    expect(status.toLowerCase()).not.toBe("served");
    expect(status.toLowerCase()).not.toBe("completed");
    expect(status.toLowerCase()).not.toBe("closed");
  });

  test("completed status with personal method marks case Served", async () => {
    const caseId = await makeCase("OK");
    const serve = await admin.post("/api/serves", {
      case_id: caseId,
      case_number: "CJ-2026-UNS-OK",
      person_being_served: "Jane Unsuccessful Mock",
      status: "completed",
      serviceMethod: "personal",
      sendEmail: false,
      isTest: true,
    });
    expectStatus(serve, 201, "POST successful");
    const got = await admin.get(`/api/cases/${caseId}`);
    expect(String(got.data.status || "").toLowerCase()).toBe("served");
  });
});

describe("affidavit prepare without saved signature", () => {
  const admin = new Client();
  const field = new Client();
  let clientId = "";
  let caseId = "";
  const USER = "nosig_" + Date.now();
  const INIT = "NoSigInit123!";
  const NEXT = "NoSigNext456!";

  beforeAll(async () => {
    const login = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(login, 200, "admin login");
    const cl = await admin.post("/api/clients", {
      name: "NoSig Mock LLC",
      email: "nosig-mock@example.test",
      phone: "555-0188",
    });
    expectStatus(cl, 201, "create client");
    clientId = cl.data.client?.id || cl.data.id || cl.data.$id;

    const usr = await admin.post("/api/users", {
      username: USER,
      password: INIT,
      displayName: "No Signature Field",
      legalName: "No Signature Field",
      licenseNumber: "PS-NOSIG-001",
      licenseJurisdiction: "OK",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Tulsa"],
    });
    expectStatus(usr, 201, "create field user");
    const fieldId = usr.data.user?.id || usr.data.id;
    await admin.put(`/api/users/${fieldId}`, { onboardingStatus: "active", status: "active" });

    const cse = await admin.post("/api/cases", {
      client_id: clientId,
      case_number: "CJ-2026-NOSIG-001",
      case_name: "NoSig v Mock",
      defendant_respondent: "NoSig Target",
      home_address: "2 Mock St, Tulsa, OK",
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
    expectStatus(ch, 200, "change-password");
  });

  test("prepare returns ready:false and names missing saved signature", async () => {
    const r = await admin.post("/api/affidavits/prepare", { caseId });
    expect(r.status).toBe(400);
    expect(r.data.ready).toBe(false);
    expect(String(r.data.error || "").toLowerCase()).toContain("saved signature");
  });
});
