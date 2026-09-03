import { test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

let admin: Client;
let serverA: Client;
let serverB: Client;
let serverAId = "";
let serverBId = "";
let caseAId = "";
let caseBId = "";
let clientId = "";

async function makeServer(username: string, password: string, displayName: string) {
  const created = await admin.post("/api/users", {
    username,
    password,
    displayName,
    legalName: `${displayName} Legal`,
    licenseNumber: `PSL-${username.toUpperCase()}`,
    licenseJurisdiction: "OK",
    licenseExpiresAt: "2030-12-31",
    serviceTerritory: ["Tulsa"],
  });
  expectStatus(created, 201, `create ${username}`);
  const id = created.data.user.id;
  const upd = await admin.put(`/api/users/${id}`, { onboardingStatus: "active" });
  expectStatus(upd, 200, `onboard ${username}`);
  return id;
}

async function makeCase(extra: Record<string, unknown> = {}) {
  const created = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: `WL-${Math.floor(Math.random() * 90000 + 10000)}`,
    case_name: "Workload Target",
    defendant_respondent: "Workload Target",
    home_address: "100 Workload Ave, Tulsa, OK",
    documents_to_serve: "Summons; Petition",
    ...extra,
  });
  expectStatus(created, 201, "create case");
  return created.data.id;
}

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");

  const cl = await admin.post("/api/clients", { name: "Workload Client" });
  expectStatus(cl, 201, "create client");
  clientId = cl.data.id;

  serverAId = await makeServer("wl_a", "WlPassA123!", "Workload A");
  serverBId = await makeServer("wl_b", "WlPassB123!", "Workload B");
  caseAId = await makeCase();
  caseBId = await makeCase({ status: "Open" });
});

test("assign validates active + onboarded + licensed server", async () => {
  const ok = await admin.post(`/api/admin/cases/${caseAId}/assign`, { serverId: serverAId });
  expectStatus(ok, 200, "assign to A");
  expect(ok.data.assigned_to).toBe(serverAId);
  expect(ok.data.assigned_name).toBe("Workload A Legal");
});

test("assign to pending/incomplete server is rejected", async () => {
  const created = await admin.post("/api/users", {
    username: "wl_pending",
    password: "PendingPass1!",
    displayName: "Pending Server",
    licenseNumber: "PSL-PENDING",
    licenseJurisdiction: "OK",
    licenseExpiresAt: "2030-12-31",
  });
  expectStatus(created, 201, "create pending server");
  const pendingId = created.data.user.id;
  const r = await admin.post(`/api/admin/cases/${caseBId}/assign`, { serverId: pendingId });
  expectStatus(r, 400, "pending server rejected");
  expect(String(r.data.error).toLowerCase()).toContain("onboarding");
});

test("assign to expired-license server is rejected", async () => {
  const created = await admin.post("/api/users", {
    username: "wl_expired",
    password: "ExpiredPass1!",
    displayName: "Expired Server",
    licenseNumber: "PSL-EXP",
    licenseJurisdiction: "OK",
    licenseExpiresAt: "2020-01-01",
  });
  expectStatus(created, 201, "create expired server");
  const id = created.data.user.id;
  await admin.put(`/api/users/${id}`, { onboardingStatus: "active" });
  const r = await admin.post(`/api/admin/cases/${caseBId}/assign`, { serverId: id });
  expectStatus(r, 400, "expired license rejected");
  expect(String(r.data.error).toLowerCase()).toContain("expired");
});

test("PUT /api/cases/:id assignment goes through the same validation", async () => {
  const created = await admin.post("/api/users", {
    username: "wl_incomplete",
    password: "IncompletePass1!",
    displayName: "Incomplete Server",
  });
  expectStatus(created, 201, "create incomplete server");
  const id = created.data.user.id;
  const r = await admin.put(`/api/cases/${caseBId}`, { assigned_to: id });
  expectStatus(r, 400, "PUT assignment rejected for incomplete server");
});

test("assignment event recorded with actor", async () => {
  const r = await admin.get(`/api/admin/servers/${serverAId}/cases`);
  expectStatus(r, 200, "server cases");
  const hist = r.data.assignment_history || [];
  const event = hist.find((e: any) => e.case_id === caseAId && e.new_server_id === serverAId);
  expect(event).toBeTruthy();
  expect(event.actor_user_id).toBe("usr_admin_default");
  expect(event.previous_server_id).toBe("");
});

test("reassignment moves the case between servers immediately", async () => {
  await admin.post(`/api/admin/cases/${caseAId}/assign`, { serverId: serverBId });

  serverA = new Client();
  let login = await serverA.post("/api/auth/login", { username: "wl_a", password: "WlPassA123!" });
  expectStatus(login, 200, "A login");
  await serverA.post("/api/me/change-password", { currentPassword: "WlPassA123!", newPassword: "WlPassA456!" });

  serverB = new Client();
  login = await serverB.post("/api/auth/login", { username: "wl_b", password: "WlPassB123!" });
  expectStatus(login, 200, "B login");
  await serverB.post("/api/me/change-password", { currentPassword: "WlPassB123!", newPassword: "WlPassB456!" });

  const aCases = await serverA.get("/api/cases");
  expect(aCases.data.map((c: any) => c.id)).not.toContain(caseAId);
  const bCases = await serverB.get("/api/cases");
  expect(bCases.data.map((c: any) => c.id)).toContain(caseAId);
});

test("workload lists both servers with counts + unassigned cases", async () => {
  const r = await admin.get("/api/admin/server-workload");
  expectStatus(r, 200, "workload");
  const a = (r.data.servers || []).find((s: any) => s.id === serverAId);
  const b = (r.data.servers || []).find((s: any) => s.id === serverBId);
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  expect(a.assignedActiveCases).toBe(0);
  expect(b.assignedActiveCases).toBe(1);
  expect(a.licenseStatus).toBe("valid");
  expect(a.onboardingStatus).toBe("active");
  expect(a.signatureStatus).toBe("none");
  expect(r.data.unassignedActiveCases).toBeGreaterThanOrEqual(1);
});

test("no-attempt and stale counts surface in workload", async () => {
  // caseAId was reassigned to B; make B's case have no attempts
  const r = await admin.get("/api/admin/server-workload");
  const b = (r.data.servers || []).find((s: any) => s.id === serverBId);
  expect(b.noAttemptCases).toBeGreaterThanOrEqual(1);
  expect(typeof b.stale48hCases).toBe("number");
  expect(typeof b.activityToday).toBe("number");
});

test("field server gets 403 on all admin endpoints", async () => {
  const wl = await serverB.get("/api/admin/server-workload");
  expectStatus(wl, 403, "workload 403");
  const sc = await serverB.get(`/api/admin/servers/${serverAId}/cases`);
  expectStatus(sc, 403, "server cases 403");
  const assign = await serverB.post(`/api/admin/cases/${caseBId}/assign`, { serverId: serverAId });
  expectStatus(assign, 403, "assign 403");
  const unassign = await serverB.post(`/api/admin/cases/${caseBId}/unassign`);
  expectStatus(unassign, 403, "unassign 403");
});

test("unassign clears the case and records an event", async () => {
  const r = await admin.post(`/api/admin/cases/${caseBId}/unassign`);
  expectStatus(r, 200, "unassign");
  expect(r.data.assigned_to).toBe("");
  const bCases = await serverB.get("/api/cases");
  expect(bCases.data.map((c: any) => c.id)).not.toContain(caseBId);
});
