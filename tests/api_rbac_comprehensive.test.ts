import { describe, test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

describe("Comprehensive API RBAC Audit", () => {
  const admin = new Client();
  const serverA = new Client();
  const serverB = new Client();
  const unauthed = new Client();

  let client1Id = "";
  let caseAId = "";
  let caseBId = "";
  let serveAId = "";
  let serverAId = "";
  let serverBId = "";

  beforeAll(async () => {
    // 1. Admin login
    const loginRes = await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    });
    expectStatus(loginRes, 200, "Admin login failed");

    // 2. Create Server A via POST /api/users
    const srvARes = await admin.post("/api/users", {
      username: "audit_server_a",
      email: "server_a_audit@justlegalsolutions.org",
      password: "ServerAPass123!",
      displayName: "Audit Server Alpha",
      legalName: "Audit Server Alpha LLC",
      licenseNumber: "PS-AUDIT-001",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Tulsa", "Creek"],
      ratesSummary: "Standard $60",
      notes: "Audit test server A",
    });
    expectStatus(srvARes, 201, "Create Server A failed");
    serverAId = srvARes.data.user?.id || srvARes.data.id;

    // Complete Server A onboarding so it's fully active
    await admin.put(`/api/users/${serverAId}`, {
      onboardingStatus: "complete",
      status: "active",
    });

    // 3. Create Server B via POST /api/users
    const srvBRes = await admin.post("/api/users", {
      username: "audit_server_b",
      email: "server_b_audit@justlegalsolutions.org",
      password: "ServerBPass123!",
      displayName: "Audit Server Beta",
      legalName: "Audit Server Beta LLC",
      licenseNumber: "PS-AUDIT-002",
      licenseExpiresAt: "2028-12-31",
      serviceTerritory: ["Tulsa", "Rogers"],
      ratesSummary: "Standard $60",
      notes: "Audit test server B",
    });
    expectStatus(srvBRes, 201, "Create Server B failed");
    serverBId = srvBRes.data.user?.id || srvBRes.data.id;

    // Complete Server B onboarding
    await admin.put(`/api/users/${serverBId}`, {
      onboardingStatus: "complete",
      status: "active",
    });

    // 4. Log in Server A & B and change their default password
    const srvALogin = await serverA.post("/api/auth/login", {
      username: "audit_server_a",
      password: "ServerAPass123!",
    });
    expectStatus(srvALogin, 200, "Server A login");
    const srvAChange = await serverA.post("/api/me/change-password", {
      currentPassword: "ServerAPass123!",
      newPassword: "ServerAPassPermanent123!",
    });
    expectStatus(srvAChange, 200, "Server A change password");

    const srvBLogin = await serverB.post("/api/auth/login", {
      username: "audit_server_b",
      password: "ServerBPass123!",
    });
    expectStatus(srvBLogin, 200, "Server B login");
    const srvBChange = await serverB.post("/api/me/change-password", {
      currentPassword: "ServerBPass123!",
      newPassword: "ServerBPassPermanent123!",
    });
    expectStatus(srvBChange, 200, "Server B change password");

    // 5. Admin creates client & cases
    const cliRes = await admin.post("/api/clients", {
      name: "Top Secret Client Inc",
      email: "secret@client.com",
      phone: "555-123-4567",
    });
    expectStatus(cliRes, 201, "Create client");
    client1Id = cliRes.data.client?.id || cliRes.data.id || cliRes.data.$id;

    // Case A assigned to Server A
    const caseARes = await admin.post("/api/cases", {
      client_id: client1Id,
      case_number: "CJ-2026-AUDIT-A",
      case_name: "Audit Alpha v Target A",
      defendant_respondent: "Target A",
      home_address: "100 Alpha St, Tulsa, OK",
      documents_to_serve: "Summons and Petition",
      assigned_to: serverAId,
    });
    expectStatus(caseARes, 201, "Create Case A");
    caseAId = caseARes.data.case?.id || caseARes.data.id;

    // Case B assigned to Server B
    const caseBRes = await admin.post("/api/cases", {
      client_id: client1Id,
      case_number: "CJ-2026-AUDIT-B",
      case_name: "Audit Beta v Target B",
      defendant_respondent: "Target B",
      home_address: "200 Beta St, Tulsa, OK",
      documents_to_serve: "Subpoena",
      assigned_to: serverBId,
    });
    expectStatus(caseBRes, 201, "Create Case B");
    caseBId = caseBRes.data.case?.id || caseBRes.data.id;

    // Server A logs a serve attempt on Case A
    const serveARes = await serverA.post("/api/serves", {
      case_id: caseAId,
      case_number: "CJ-2026-AUDIT-A",
      person_to_serve: "Target A",
      service_type: "Attempt",
      status: "In Progress",
      notes: "First attempt - no answer",
      latitude: "36.1539",
      longitude: "-95.9928",
    });
    expectStatus(serveARes, 201, "Log serve attempt");
    serveAId = serveARes.data.serve?.id || serveARes.data.id;
  });

  // --- CLIENTS RBAC ---
  test("Clients RBAC: field servers cannot see clients list (returns empty array)", async () => {
    const res = await serverA.get("/api/clients");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data).toEqual([]);
  });

  test("Clients RBAC: field servers cannot create/edit/delete clients (403)", async () => {
    const postRes = await serverA.post("/api/clients", { name: "Hacker Client" });
    expect(postRes.status).toBe(403);

    const putRes = await serverA.put(`/api/clients/${client1Id}`, { name: "Hacked Name" });
    expect(putRes.status).toBe(403);

    const delRes = await serverA.del(`/api/clients/${client1Id}`);
    expect(delRes.status).toBe(403);
  });

  // --- CASES RBAC ---
  test("Cases RBAC: field server only receives assigned cases with client details stripped", async () => {
    const res = await serverA.get("/api/cases");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    const cases = res.data;
    
    // Server A should see Case A
    const caseA = cases.find((c: any) => c.id === caseAId || c.caseNumber === "CJ-2026-AUDIT-A");
    expect(caseA).toBeDefined();
    // Client info must be completely stripped
    expect(caseA.clientId).toBeFalsy();
    expect(caseA.client_id).toBeFalsy();
    expect(caseA.clientName).toBeFalsy();
    expect(caseA.client_name).toBeFalsy();
    expect(caseA.clientEmail).toBeFalsy();

    // Server A must NOT see Case B (assigned to Server B)
    const caseB = cases.find((c: any) => c.id === caseBId || c.caseNumber === "CJ-2026-AUDIT-B");
    expect(caseB).toBeUndefined();
  });

  test("Cases RBAC: field server cannot create or delete cases (403)", async () => {
    const postRes = await serverA.post("/api/cases", {
      case_number: "CJ-HACK-001",
      case_name: "Illegal Case",
    });
    expect(postRes.status).toBe(403);

    const delRes = await serverA.del(`/api/cases/${caseAId}`);
    expect(delRes.status).toBe(403);
  });

  // --- SERVES RBAC ---
  test("Serves RBAC: GET /api/serves strips client details for field server", async () => {
    const res = await serverA.get("/api/serves");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    const serves = res.data;
    const myServe = serves.find((s: any) => s.id === serveAId);
    expect(myServe).toBeDefined();
    expect(myServe.clientId).toBeFalsy();
    expect(myServe.client_id).toBeFalsy();
    expect(myServe.clientName).toBeFalsy();
    expect(myServe.clientEmail).toBeFalsy();
  });

  test("Serves RBAC: field server cannot edit another server's serve attempts", async () => {
    // Server B logs a serve on Case B
    const serveBRes = await serverB.post("/api/serves", {
      case_id: caseBId,
      case_number: "CJ-2026-AUDIT-B",
      person_to_serve: "Target B",
      service_type: "Attempt",
      status: "In Progress",
      notes: "Server B attempt",
    });
    const serveBId = serveBRes.data.serve?.id || serveBRes.data.id;

    // Server A tries to edit Server B's attempt
    const hackEdit = await serverA.put(`/api/serves/${serveBId}`, {
      notes: "Hacked notes by Server A",
    });
    expect(hackEdit.status).toBe(403);
  });

  test("Serves RBAC: field server cannot PUT own assigned serve (403, immutable field logs)", async () => {
    const origGpsRes = await admin.get("/api/serves");
    const origServe = origGpsRes.data.find((s: any) => s.id === serveAId);
    expect(origServe).toBeDefined();
    const origNotes = origServe.notes;
    const origLat = origServe.latitude;

    const editRes = await serverA.put(`/api/serves/${serveAId}`, {
      notes: "Updated legitimate field note",
      latitude: "40.7128",
      longitude: "-74.0060",
    });
    expect(editRes.status).toBe(403);

    const verifyRes = await admin.get("/api/serves");
    const updatedServe = verifyRes.data.find((s: any) => s.id === serveAId);
    expect(updatedServe.latitude).toBe(origLat);
    expect(updatedServe.notes).toBe(origNotes);
  });

  test("Serves RBAC: field server cannot delete serve attempts (403)", async () => {
    const delRes = await serverA.del(`/api/serves/${serveAId}`);
    expect(delRes.status).toBe(403);
  });

  // --- USER PROFILES RBAC ---
  test("User Profiles RBAC: field servers cannot list all users (403)", async () => {
    const res = await serverA.get("/api/users");
    expect(res.status).toBe(403);
  });

  test("User Profiles RBAC: field server cannot edit another user (403)", async () => {
    const updateRes = await serverA.put(`/api/users/${serverBId}`, {
      ratesSummary: "$1000/hr",
    });
    expect(updateRes.status).toBe(403);
  });

  // --- CASE DOCUMENTS RBAC ---
  test("Case Documents RBAC: unassigned server cannot access case documents (403)", async () => {
    // Server A tries to get documents for Case B
    const res = await serverA.get(`/api/cases/${caseBId}/documents`);
    expect(res.status).toBe(403);
  });

  test("Case Documents RBAC: assigned server can access assigned case documents", async () => {
    const res = await serverA.get(`/api/cases/${caseAId}/documents`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  // --- AFFIDAVITS & SIGNATURES RBAC ---
  test("Affidavits RBAC: server A cannot sign Server B case (403)", async () => {
    const signRes = await serverA.post(`/api/affidavits/${caseBId}/sign`, {
      county: "Tulsa",
    });
    expect(signRes.status).toBe(403);
  });

  test("Affidavits RBAC: GET /api/affidavits/queue returns assigned served cases only for server", async () => {
    // Mark Case A as served
    await serverA.post("/api/serves", {
      case_id: caseAId,
      case_number: "CJ-2026-AUDIT-A",
      person_to_serve: "Target A",
      service_type: "Serve",
      service_method: "Personal Service",
      status: "Completed",
      notes: "Served successfully in hand",
    });

    const queueResA = await serverA.get("/api/affidavits/queue");
    expect(queueResA.status).toBe(200);
    const queueA = queueResA.data.queue || [];
    expect(queueA.some((q: any) => q.caseId === caseAId)).toBe(true);
    expect(queueA.some((q: any) => q.caseId === caseBId)).toBe(false);

    // Queue for Server A should not leak clientName
    const item = queueA.find((q: any) => q.caseId === caseAId);
    expect(item.clientName).toBeUndefined();
  });

  // --- UNAUTHENTICATED RBAC ---
  test("Unauthenticated requests to protected endpoints return 401", async () => {
    const clientsRes = await unauthed.get("/api/clients");
    expect(clientsRes.status).toBe(401);

    const casesRes = await unauthed.get("/api/cases");
    expect(casesRes.status).toBe(401);

    const servesRes = await unauthed.get("/api/serves");
    expect(servesRes.status).toBe(401);

    const usersRes = await unauthed.get("/api/users");
    expect(usersRes.status).toBe(401);

    const queueRes = await unauthed.get("/api/affidavits/queue");
    expect(queueRes.status).toBe(401);
  });
});
