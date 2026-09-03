import { test, expect, beforeAll } from "bun:test";
import { Client, expectStatus, TINY_PNG, dataUrl } from "./helpers";

let admin: Client;
let serverA: Client;
let serverB: Client;
let serverAId = "";
let serverBId = "";
let caseId = "";
let caseNoMethodId = "";
let clientId = "";
let caseNum = "";
let nmNum = "";
let assetId = "";

const A_USER = "esig_a";
const A_PASS = "EsigPassA1!";
const B_USER = "esig_b";
const B_PASS = "EsigPassB1!";

async function setupServer(username: string, password: string, display: string): Promise<string> {
  const created = await admin.post("/api/users", {
    username,
    password,
    displayName: display,
    legalName: display + " Legal",
    licenseNumber: `PSL-${username.toUpperCase()}`,
    licenseJurisdiction: "OK",
    licenseExpiresAt: "2030-12-31",
  });
  expectStatus(created, 201, `create ${username}`);
  const id = created.data.user.id;
  const upd = await admin.put(`/api/users/${id}`, { onboardingStatus: "active" });
  expectStatus(upd, 200, `onboard ${username}`);
  return id;
}

async function loginUnlock(client: Client, username: string, tempPass: string, newPass: string) {
  const login = await client.post("/api/auth/login", { username, password: tempPass });
  expectStatus(login, 200, `${username} login`);
  const ch = await client.post("/api/me/change-password", { currentPassword: tempPass, newPassword: newPass });
  expectStatus(ch, 200, `${username} unlock`);
}

async function makeCase(documents: string, person: string): Promise<{ id: string; case_number: string }> {
  const created = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: `ES-${Math.floor(Math.random() * 90000 + 10000)}`,
    case_name: person,
    defendant_respondent: person,
    home_address: "10 Affidavit Lane, Tulsa, OK",
    documents_to_serve: documents,
  });
  expectStatus(created, 201, "create case");
  return { id: created.data.id, case_number: created.data.case_number };
}

async function logAttempt(caseId: string, person: string, method: string, caseNumber: string) {
  const r = await serverA.post("/api/serves", {
    case_id: caseId,
    case_number: caseNumber,
    person_being_served: person,
    status: "completed",
    service_method: method,
    accepted_by: method === "personal" ? "" : "Jane Doe",
    notes: "Delivered",
    service_address: "10 Affidavit Lane, Tulsa, OK",
  });
  expectStatus(r, 201, "log completed attempt");
}

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");
  const cl = await admin.post("/api/clients", { name: "E-Sign Client" });
  expectStatus(cl, 201, "create client");
  clientId = cl.data.id;

  serverAId = await setupServer(A_USER, A_PASS, "Esign Server A");
  serverBId = await setupServer(B_USER, B_PASS, "Esign Server B");

  serverA = new Client();
  await loginUnlock(serverA, A_USER, A_PASS, "EsigNewA1!");
  serverB = new Client();
  await loginUnlock(serverB, B_USER, B_PASS, "EsigNewB1!");

  const c1 = await makeCase("Summons; Petition", "Esign Target");
  caseId = c1.id;
  caseNum = c1.case_number;
  const c2 = await makeCase("Summons", "NoMethod Target");
  caseNoMethodId = c2.id;
  nmNum = c2.case_number;

  const assign = await admin.post(`/api/admin/cases/${caseId}/assign`, { serverId: serverAId });
  expectStatus(assign, 200, "assign case to A");
  const assign2 = await admin.post(`/api/admin/cases/${caseNoMethodId}/assign`, { serverId: serverAId });
  expectStatus(assign2, 200, "assign case2 to A");

  await logAttempt(caseId, "Esign Target", "personal", caseNum);
  // Second case: completed attempt WITHOUT service method (must block signing)
  const nm = await serverA.post("/api/serves", {
    case_id: caseNoMethodId,
    case_number: nmNum,
    person_being_served: "NoMethod Target",
    status: "completed",
    notes: "No method recorded",
    service_address: "10 Affidavit Lane, Tulsa, OK",
  });
  expectStatus(nm, 201, "log no-method attempt");
});

test("server enrolls signature with password + ack", async () => {
  const r = await serverA.post("/api/me/signature", {
    password: "EsigNewA1!",
    image_data: dataUrl(TINY_PNG),
    mime_type: "image/png",
    ack: true,
  });
  expectStatus(r, 201, "enroll signature");
  expect(r.data.status).toBe("enrolled");
  assetId = r.data.assetId;
  expect(assetId).toBeTruthy();
});

test("admin can enroll their own signature", async () => {
  const r = await admin.post("/api/me/signature", {
    password: "TestAdminPass123!",
    image_data: dataUrl(TINY_PNG),
    mime_type: "image/png",
    ack: true,
  });
  expectStatus(r, 201, "admin enroll signature");
  expect(r.data.status).toBe("enrolled");
});

test("wrong password or missing ack cannot enroll", async () => {
  const wrong = await serverA.post("/api/me/signature", {
    password: "wrongpass",
    image_data: dataUrl(TINY_PNG),
    mime_type: "image/png",
    ack: true,
  });
  expectStatus(wrong, 401, "wrong password");
  const noAck = await serverA.post("/api/me/signature", {
    password: "EsigNewA1!",
    image_data: dataUrl(TINY_PNG),
    mime_type: "image/png",
  });
  expectStatus(noAck, 400, "ack required");
});

test("signature bytes never appear in user/profile/list APIs", async () => {
  const list = await admin.get("/api/users");
  const u = (list.data as any[]).find((x: any) => x.id === serverAId);
  expect(u.signatureStatus.enrolled).toBe(true);
  expect(JSON.stringify(u)).not.toContain("iVBORw0KGgo");
  const detail = await admin.get(`/api/users/${serverAId}`);
  expect(JSON.stringify(detail.data)).not.toContain("iVBORw0KGgo");
  const me = await serverA.get("/api/me/profile");
  expect(JSON.stringify(me.data)).not.toContain("iVBORw0KGgo");
});

test("render endpoint is auth-gated and scoped to owner/admin", async () => {
  const anon = new Client();
  const anonRes = await anon.get(`/api/signatures/${assetId}/render`);
  expectStatus(anonRes, 401, "anonymous blocked");

  const other = await serverB.get(`/api/signatures/${assetId}/render`);
  expectStatus(other, 403, "server B blocked");

  const owner = await serverA.get(`/api/signatures/${assetId}/render`);
  expectStatus(owner, 200, "owner allowed");
  expect(String(owner.data.dataUrl)).toContain("data:image/png;base64,");

  const adm = await admin.get(`/api/signatures/${assetId}/render`);
  expectStatus(adm, 200, "admin allowed");
});

test("missing service method auto-prepares as Affidavit of Non-Service", async () => {
  const r = await admin.post("/api/affidavits/prepare", { caseId: caseNoMethodId });
  expectStatus(r, 200, "prepare auto non-service");
  expect(r.data.ready).toBe(true);
  expect(r.data.preview.title).toBe("AFFIDAVIT OF NON-SERVICE");
  expect(r.data.preview.kind).toBe("non-service");
});

test("forcing Service when no method is recorded is blocked", async () => {
  const r = await admin.post("/api/affidavits/prepare", { caseId: caseNoMethodId, affidavitKind: "service" });
  expectStatus(r, 400, "forced service blocked");
  const msg = String(r.data.error || r.data.blockers || "").toUpperCase();
  expect(msg).toContain("METHOD NOT RECORDED");
});

test("prepare returns readiness + preview for valid case", async () => {
  const r = await admin.post("/api/affidavits/prepare", { caseId });
  expectStatus(r, 200, "prepare ok");
  expect(r.data.ready).toBe(true);
  expect(r.data.preview.title).toBe("AFFIDAVIT OF SERVICE");
  expect(r.data.preview.methodRecorded).toBe(true);
  expect(r.data.assignedServer.legalName).toBe("Esign Server A Legal");
  expect(r.data.sourceHash).toBeTruthy();
});

test("admin signs on behalf of assigned server with 1-click apply", async () => {
  const r = await admin.post(`/api/affidavits/${caseId}/sign`, {
    acknowledged: true,
  });
  expectStatus(r, 201, "admin sign");
  expect(r.data.execution.status).toBe("signed_not_notarized");
  expect(r.data.execution.applicationMode).toBe("admin_on_behalf");
  expect(r.data.execution.assignedServerId).toBe(serverAId);
  expect(r.data.execution.signedByUserId).toBe(serverAId);
  expect(r.data.execution.renderedHash).toBeTruthy();
  expect(r.data.execution.sourceHash).toBeTruthy();
});

test("server B cannot sign server A's case", async () => {
  const r = await serverB.post(`/api/affidavits/${caseId}/sign`, {
    password: "EsigNewB1!",
    acknowledged: true,
  });
  expectStatus(r, 403, "server B blocked");
});

test("server A signs its own case without re-entering password", async () => {
  const r = await serverA.post(`/api/affidavits/${caseId}/sign`, {
    acknowledged: true,
  });
  expectStatus(r, 201, "server self sign");
  expect(r.data.execution.applicationMode).toBe("server_self");
});

test("render embeds signature ONLY in left process-server line, notary line untouched", async () => {
  const r = await serverA.get(`/api/affidavits/${caseId}/render`);
  expectStatus(r, 200, "render");
  const html = String(r.data.html);
  expect(html).toContain("AFFIDAVIT OF SERVICE");
  expect(html).toContain("Esign Server A Legal");
  expect(html).toContain("data:image/png;base64,");
  // exactly one rendered signature image
  const sigCount = (html.match(/data:image\/png;base64,/g) || []).length;
  expect(sigCount).toBe(1);
  // notary side stays a blank sig-line (the notary td follows the 4% spacer,
  // so anchor on the notary content itself, not the first 48% td)
  expect(html).toContain("Notary Public");
  const rightLine = html.match(/STATE OF[\s\S]*?<div class="sig-line"><\/div>/);
  expect(rightLine).toBeTruthy();
  expect(rightLine![0]).not.toContain("data:image");
});

test("signed affidavit render includes all multiple photos per attempt", async () => {
  const multiCase = await makeCase("Summons; Petition", "MultiPhoto Target");
  await admin.post(`/api/admin/cases/${multiCase.id}/assign`, { serverId: serverAId });
  
  // Log attempt 1 with 2 photos
  const att1 = await serverA.post("/api/serves", {
    case_id: multiCase.id,
    case_number: multiCase.case_number,
    person_being_served: "MultiPhoto Target",
    status: "attempted",
    notes: "First attempt - gated",
    service_address: "10 Affidavit Lane, Tulsa, OK",
    photos: [
      { imageData: dataUrl(TINY_PNG), position: 1 },
      { imageData: dataUrl(TINY_PNG), position: 2 },
    ],
  });
  expectStatus(att1, 201, "log attempt 1 with 2 photos");

  // Log attempt 2 with 3 photos and completed personal service
  const att2 = await serverA.post("/api/serves", {
    case_id: multiCase.id,
    case_number: multiCase.case_number,
    person_being_served: "MultiPhoto Target",
    status: "completed",
    service_method: "personal",
    notes: "Second attempt - served",
    service_address: "10 Affidavit Lane, Tulsa, OK",
    photos: [
      { imageData: dataUrl(TINY_PNG), position: 1 },
      { imageData: dataUrl(TINY_PNG), position: 2 },
      { imageData: dataUrl(TINY_PNG), position: 3 },
    ],
  });
  expectStatus(att2, 201, "log attempt 2 with 3 photos");

  // Sign affidavit on admin on behalf of server A
  const signRes = await admin.post(`/api/affidavits/${multiCase.id}/sign`, {
    confirmation: "Esign Server A Legal",
    acknowledged: true,
  });
  expectStatus(signRes, 201, "admin sign multi-photo case");

  // Render signed affidavit
  const renderRes = await admin.get(`/api/affidavits/${multiCase.id}/render`);
  expectStatus(renderRes, 200, "render multi-photo affidavit");
  const html = String(renderRes.data.html);

  // Verify EXHIBIT PHOTOS section has all 5 photos across the 2 attempts
  expect(html).toContain("EXHIBIT PHOTOS (5)");
  expect(html).toContain("Attempt #1 — Photo #1");
  expect(html).toContain("Attempt #1 — Photo #2");
  expect(html).toContain("Attempt #2 — Photo #1");
  expect(html).toContain("Attempt #2 — Photo #2");
  expect(html).toContain("Attempt #2 — Photo #3");
});

test("unassigned case cannot be prepared or signed", async () => {
  const freshCase = await makeCase("Summons", "Unassigned Target");
  const prep = await admin.post("/api/affidavits/prepare", { caseId: freshCase.id });
  expectStatus(prep, 400, "unassigned prepare blocked");
  expect(String(prep.data.error).toLowerCase()).toContain("assign");
});

test("signing without an enrolled signature is blocked", async () => {
  const fresh = await makeCase("Summons", "NoSig Target");
  await admin.post(`/api/admin/cases/${fresh.id}/assign`, { serverId: serverBId });
  const r = await admin.post(`/api/affidavits/${fresh.id}/sign`, {
    password: "TestAdminPass123!",
    confirmation: "Esign Server B Legal",
  });
  expectStatus(r, 400, "no signature blocked");
  expect(String(r.data.error).toLowerCase()).toContain("signature");
});

test("material case edit voids the latest execution", async () => {
  const upd = await admin.put(`/api/cases/${caseId}`, { documents_to_serve: "Summons; Petition; Amended Petition" });
  expectStatus(upd, 200, "material edit");

  const audit = await admin.get(`/api/affidavits/${caseId}/audit`);
  expectStatus(audit, 200, "audit");
  expect(audit.data.executions.length).toBeGreaterThanOrEqual(2);
  const latest = audit.data.executions[0];
  expect(latest.status).toBe("void");
  expect(latest.invalidationReason).toBe("material_change");

  const render = await serverA.get(`/api/affidavits/${caseId}/render`);
  expectStatus(render, 409, "no active signed version");
});

test("fresh sign after invalidation creates a new version", async () => {
  const r = await serverA.post(`/api/affidavits/${caseId}/sign`, {
    password: "EsigNewA1!",
    acknowledged: true,
  });
  expectStatus(r, 201, "re-sign");
  expect(r.data.execution.supersedesExecutionId).toBeTruthy();

  const audit = await admin.get(`/api/affidavits/${caseId}/audit`);
  const active = audit.data.executions.filter((e: any) => e.status === "signed_not_notarized");
  expect(active.length).toBe(1);
});

test("server license edit invalidates signed affidavits for their cases", async () => {
  const upd = await admin.put(`/api/users/${serverAId}`, { licenseNumber: "PSL-9002" });
  expectStatus(upd, 200, "license edit");
  const audit = await admin.get(`/api/affidavits/${caseId}/audit`);
  expect(audit.data.executions[0].status).toBe("void");
  expect(audit.data.executions[0].invalidationReason).toBe("server_credential_changed");
});

test("deactivation invalidates signed executions for assigned cases", async () => {
  // re-sign first so deactivation has an active execution to void
  const r = await serverA.post(`/api/affidavits/${caseId}/sign`, {
    password: "EsigNewA1!",
    acknowledged: true,
  });
  expectStatus(r, 201, "re-sign before deactivation");

  await admin.put(`/api/users/${serverAId}`, { isActive: false });
  const audit = await admin.get(`/api/affidavits/${caseId}/audit`);
  expect(audit.data.executions[0].status).toBe("void");
  expect(audit.data.executions[0].invalidationReason).toBe("server_deactivated");
  await admin.put(`/api/users/${serverAId}`, { isActive: true });

  // Reactivation does NOT restore revoked sessions — server A must re-login.
  const relog = await serverA.post("/api/auth/login", { username: A_USER, password: "EsigNewA1!" });
  expectStatus(relog, 200, "server A re-login after reactivation");
});

test("legacy affidavit endpoint opens to assigned server, keeps 403 for others", async () => {
  const assigned = await serverA.get(`/api/affidavit/${caseId}`);
  expectStatus(assigned, 200, "assigned server allowed");
  expect(assigned.data.assignedServer).toBeTruthy();
  expect(assigned.data.notaryBlock.notaryName).toBe("Kimberly Deason");

  const other = await serverB.get(`/api/affidavit/${caseId}`);
  expectStatus(other, 403, "other server blocked");
});

test("admin revoke of signature asset works and blocks future renders", async () => {
  const r = await admin.post(`/api/users/${serverAId}/signature/revoke`);
  expectStatus(r, 200, "admin revoke signature");
  const me = await serverA.get("/api/me/profile");
  expect(me.data.signatureStatus.enrolled).toBe(false);
  const render = await serverA.get(`/api/signatures/${assetId}/render`);
  expectStatus(render, 404, "revoked asset not renderable");
});

test("admin can prepare and sign multi-recipient affidavits individually", async () => {
  // Re-enroll signature for server A since previous test revoked it
  const signEnroll = await serverA.post("/api/me/signature", {
    image_data: dataUrl(TINY_PNG),
    password: "EsigNewA1!",
    ack: true,
  });
  expectStatus(signEnroll, 201, "re-enroll");

  const multiCaseRes = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: "MULTI-REC-2026",
    case_name: "VAN MAXWELL & AMBER MAXWELL",
    plaintiff_petitioner: "Lawrence",
    defendant_respondent: "VAN MAXWELL & AMBER MAXWELL",
    assigned_to: serverAId,
    assigned_name: "Server Alice",
    recipients: [
      { full_name: "VAN MAXWELL" },
      { full_name: "AMBER MAXWELL" },
    ],
  });
  expectStatus(multiCaseRes, 201, "multi-recipient case create");
  const multiCase = multiCaseRes.data;

  // Log unsuccessful attempt
  await admin.post("/api/serves", {
    case_id: multiCase.id,
    case_number: "MULTI-REC-2026",
    client_id: clientId,
    status: "failed",
    notes: "No answer",
  });

  const recsRes = await admin.get(`/api/recipients?case_id=${multiCase.id}`);
  const recs = recsRes.data;
  expect(recs.length).toBe(2);
  const vanRec = recs.find((r: any) => r.full_name === "VAN MAXWELL");
  const amberRec = recs.find((r: any) => r.full_name === "AMBER MAXWELL");
  expect(vanRec).toBeTruthy();
  expect(amberRec).toBeTruthy();

  // Prepare for Van
  const vanPrepRes = await admin.post("/api/affidavits/prepare", {
    caseId: multiCase.id,
    recipientId: vanRec.id,
  });
  expectStatus(vanPrepRes, 200, "prepare for Van");
  expect(vanPrepRes.data.preview.personServed).toBe("VAN MAXWELL");

  // Prepare for Amber
  const amberPrepRes = await admin.post("/api/affidavits/prepare", {
    caseId: multiCase.id,
    recipientId: amberRec.id,
  });
  expectStatus(amberPrepRes, 200, "prepare for Amber");
  expect(amberPrepRes.data.preview.personServed).toBe("AMBER MAXWELL");

  // Sign for Amber
  const amberSignRes = await admin.post(`/api/affidavits/${multiCase.id}/sign`, {
    recipientId: amberRec.id,
    acknowledged: true,
    ack: true,
    confirmation: "Server Alice",
  });
  expectStatus(amberSignRes, 201, "sign for Amber");

  // Render should reflect Amber Maxwell
  const renderRes = await admin.get(`/api/affidavits/${multiCase.id}/render`);
  expectStatus(renderRes, 200, "render signed");
  expect(renderRes.data.html).toContain("AMBER MAXWELL");
  expect(renderRes.data.html).toContain("PERSON SERVED / ATTEMPTED:</strong><br>AMBER MAXWELL");
});
