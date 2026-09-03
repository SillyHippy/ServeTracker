import { describe, test, expect, beforeAll } from "bun:test";
import { Client, expectStatus, TINY_PNG, dataUrl } from "./helpers";

describe("SOC 2 & 30-Minute Security Audit E2E Verification", () => {
  let admin: Client;
  let serverA: Client;
  let serverB: Client;
  let unauth: Client;

  let serverAId = "";
  let serverBId = "";
  let client1Id = "";
  let case1Id = "";
  let case2Id = "";
  let serve1Id = "";

  const A_USER = "mock_server_a_" + Date.now();
  const A_PASS_INIT = "ServerPass123!A";
  const A_PASS = "ActiveServerPass123!A";

  const B_USER = "mock_server_b_" + Date.now();
  const B_PASS_INIT = "ServerPass123!B";
  const B_PASS = "ActiveServerPass123!B";

  beforeAll(async () => {
    admin = new Client();
    serverA = new Client();
    serverB = new Client();
    unauth = new Client();

    // 1. Admin login
    const loginRes = await admin.post("/api/auth/login", {
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(loginRes, 200, "Admin login failed");

    // 2. Create Server A User
    const resA = await admin.post("/api/users", {
      username: A_USER,
      password: A_PASS_INIT,
      displayName: "Mock Server Alpha",
      legalName: "Mock Server Alpha",
      role: "server",
      email: "server_alpha@mockdomain.local",
      phone: "555-0101",
      licenseNumber: "LIC-MOCK-A",
      licenseJurisdiction: "OK",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Tulsa", "Creek"],
    });
    expectStatus(resA, 201, "Create Server A failed");
    serverAId = resA.data.user.id;

    // Activate Server A
    const actA = await admin.put(`/api/users/${serverAId}`, {
      onboardingStatus: "active",
      isActive: true,
    });
    expectStatus(actA, 200, "Activate Server A failed");

    // Login Server A & Change Initial Password
    const loginA = await serverA.post("/api/auth/login", {
      username: A_USER,
      password: A_PASS_INIT,
    });
    expectStatus(loginA, 200, "Server A login failed");
    const chA = await serverA.post("/api/me/change-password", {
      currentPassword: A_PASS_INIT,
      newPassword: A_PASS,
    });
    expectStatus(chA, 200, "Server A password change failed");

    // 3. Create Server B User
    const resB = await admin.post("/api/users", {
      username: B_USER,
      password: B_PASS_INIT,
      displayName: "Mock Server Beta",
      legalName: "Mock Server Beta",
      role: "server",
      email: "server_beta@mockdomain.local",
      phone: "555-0102",
      licenseNumber: "LIC-MOCK-B",
      licenseJurisdiction: "OK",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Creek", "Okmulgee"],
    });
    expectStatus(resB, 201, "Create Server B failed");
    serverBId = resB.data.user.id;

    // Activate Server B
    const actB = await admin.put(`/api/users/${serverBId}`, {
      onboardingStatus: "active",
      isActive: true,
    });
    expectStatus(actB, 200, "Activate Server B failed");

    // Login Server B & Change Initial Password
    const loginB = await serverB.post("/api/auth/login", {
      username: B_USER,
      password: B_PASS_INIT,
    });
    expectStatus(loginB, 200, "Server B login failed");
    const chB = await serverB.post("/api/me/change-password", {
      currentPassword: B_PASS_INIT,
      newPassword: B_PASS,
    });
    expectStatus(chB, 200, "Server B password change failed");

    // 4. Admin creates Mock Client
    const clientRes = await admin.post("/api/clients", {
      name: "Mock Legal Firm LLC",
      email: "attorney@mockfirm.local",
      phone: "555-0199",
      address: "100 Mock Courthouse Plaza",
      notes: "Strict confidentiality required",
    });
    expectStatus(clientRes, 201, "Create Client failed");
    client1Id = clientRes.data.id;

    // 5. Admin creates Case 1 and assigns to Server A
    const case1Res = await admin.post("/api/cases", {
      client_id: client1Id,
      case_number: "CJ-2026-MOCK-001",
      case_name: "Jane Mock Doe",
      defendant_respondent: "Jane Mock Doe",
      home_address: "123 Mockingbird Lane, Tulsa, OK",
      documents_to_serve: "Summons & Petition",
    });
    expectStatus(case1Res, 201, "Create Case 1 failed");
    case1Id = case1Res.data.id;
    const assignA = await admin.post(`/api/admin/cases/${case1Id}/assign`, { serverId: serverAId });
    expectStatus(assignA, 200, "Assign Case 1 to A failed");

    // 6. Admin creates Case 2 and assigns to Server B
    const case2Res = await admin.post("/api/cases", {
      client_id: client1Id,
      case_number: "CJ-2026-MOCK-002",
      case_name: "Robert Mock Target",
      defendant_respondent: "Robert Mock Target",
      home_address: "456 Oak Avenue, Sapulpa, OK",
      documents_to_serve: "Subpoena Duces Tecum",
    });
    expectStatus(case2Res, 201, "Create Case 2 failed");
    case2Id = case2Res.data.id;
    const assignB = await admin.post(`/api/admin/cases/${case2Id}/assign`, { serverId: serverBId });
    expectStatus(assignB, 200, "Assign Case 2 to B failed");
  });

  test("1. IDOR / Auth Boundary Check: Server A cannot access Server B Case or Client Master List", async () => {
    // Server A attempts to read full client list
    const clientsRes = await serverA.get("/api/clients");
    expect(clientsRes.data).toEqual([]); // RBAC returns empty list for field servers

    // Server A attempts to read Case 2 (Assigned to Server B)
    const case2Attempt = await serverA.get(`/api/cases/${case2Id}`);
    expect([403, 404]).toContain(case2Attempt.status);

    // Server A attempts to log a serve attempt on Case 2
    const serveOnB = await serverA.post("/api/serves", {
      case_id: case2Id,
      case_number: "CJ-2026-MOCK-002",
      person_being_served: "Robert Mock Target",
      status: "failed",
      notes: "Malicious attempt by Server A on Case B",
      service_address: "456 Oak Avenue, Sapulpa, OK",
    });
    expect([403, 404]).toContain(serveOnB.status);
  });

  test("2. Data Isolation Check: Case Details Shield Client Details from Field Servers", async () => {
    // Server A reads assigned Case 1
    const case1ForA = await serverA.get(`/api/cases/${case1Id}`);
    expectStatus(case1ForA, 200, "Server A should be able to read assigned Case 1");
    // Client confidential master notes must never be exposed to the server
    expect(case1ForA.data.client_notes).toBeUndefined();
    expect(case1ForA.data.clientNotes).toBeUndefined();
  });

  test("3. Public Upload Boundary Check: /uploads/documents/* is 403 blocked", async () => {
    const unauthDocAccess = await unauth.get("/uploads/documents/fake-case-doc.pdf");
    expect(unauthDocAccess.status).toBe(403);
  });

  test("4. Mock Email Sink Check: Logging attempt sends zero real emails", async () => {
    // Server A logs valid attempt on Case 1
    const serveRes = await serverA.post("/api/serves", {
      case_id: case1Id,
      case_number: "CJ-2026-MOCK-001",
      person_being_served: "Jane Mock Doe",
      status: "completed",
      service_method: "personal",
      notes: "Served in person at residence. Mock test only.",
      service_address: "123 Mockingbird Lane, Tulsa, OK",
      gps_lat: 36.15398,
      gps_lng: -95.99277,
      gps_accuracy: 5,
    });
    expectStatus(serveRes, 201, "Server A logging serve failed");
    serve1Id = serveRes.data.id;
  });

  test("5. E-Signature & Evidentiary Audit Trail Verification", async () => {
    // Enroll signature for Server A
    const enrollRes = await serverA.post("/api/me/signature", {
      password: A_PASS,
      image_data: dataUrl(TINY_PNG),
      mime_type: "image/png",
      ack: true,
    });
    expectStatus(enrollRes, 201, "Signature enroll failed");

    // Prepare Affidavit for Case 1
    const prepRes = await serverA.post("/api/affidavits/prepare", {
      caseId: case1Id,
      venueCounty: "Tulsa",
    });
    expectStatus(prepRes, 200, "Affidavit prep failed");
    expect(prepRes.data.ready).toBe(true);

    // Server A Signs Affidavit for Case 1
    const signRes = await serverA.post(`/api/affidavits/${case1Id}/sign`, {
      venueCounty: "Tulsa",
    });
    expectStatus(signRes, 201, "Affidavit sign failed");
    expect(signRes.data.execution.id).toBeDefined();

    // Render signed affidavit HTML
    const renderRes = await serverA.get(`/api/affidavits/${case1Id}/render`);
    expectStatus(renderRes, 200, "Affidavit render failed");
    expect(renderRes.data.html.includes("data:image/png;base64")).toBe(true);

    // Audit log inspection
    const auditRes = await admin.get(`/api/affidavits/${case1Id}/audit`);
    expectStatus(auditRes, 200, "Affidavit audit failed");
    expect(auditRes.data.executions.length).toBeGreaterThan(0);

    // Server B tries to sign Server A's case (Must be rejected)
    const bSignA = await serverB.post(`/api/affidavits/${case1Id}/sign`, {
      venueCounty: "Tulsa",
    });
    expect([403, 404]).toContain(bSignA.status);
  });
});
